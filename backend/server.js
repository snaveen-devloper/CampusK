'use strict';
require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const http       = require('http');
const WebSocket  = require('ws');
const path       = require('path');
const fetch      = require('node-fetch');
const { v4: uuidv4 } = require('uuid');
const { initDB, models } = require('./db');
const { Message, Session, User, QuizQuestion, QuizAnswer, Activity, AIFeedback } = models;
const { detectLoops, invalidateLoopCache, router: loopsRouter } = require('./routes/loops');
const cron = require('node-cron');
const push = require('./push');
const { runHealingCycle, registerLoop } = require('./lib/loopHealer');

const app    = express();
const server = http.createServer(app);
const wss    = new WebSocket.Server({ server });

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '2mb' }));

// Init cache store
app.locals.loopCache = null;

// Serve frontend
app.use(express.static(path.join(__dirname, '..')));
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, '..', 'index.html')));

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/auth',        require('./routes/auth'));
app.use('/api/users',       require('./routes/users'));
app.use('/api/requests',    require('./routes/requests'));
app.use('/api/sessions',    require('./routes/sessions'));
app.use('/api/chat',        require('./routes/chat'));
app.use('/api/quiz',        require('./routes/quiz'));
app.use('/api/ai',          require('./routes/ai'));
app.use('/api/activity',    require('./routes/activity'));
app.use('/api/matchmaking', require('./routes/matchmaking'));
app.use('/api/coordinator', require('./routes/coordinator'));
app.use('/api/store',       require('./routes/store'));
app.use('/api/notes',       require('./routes/notes'));
app.use('/api/reports',     require('./routes/reports'));
app.use('/api/rooms',       require('./routes/rooms'));
app.use('/api/files',       require('./routes/files'));
app.use('/api/loops',       loopsRouter);
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// ── WebSocket state ───────────────────────────────────────────────────────────
const clients             = new Map();  // uid → ws
const reconnectTimers     = new Map();  // uid → setTimeout handle
const quizTimers          = new Map();  // question_id → setTimeout handle
const pendingPongUids     = new Set();  // uids awaiting pong response
app.locals.wsClients      = clients;

// ── Helpers ───────────────────────────────────────────────────────────────────
function broadcastOnlineCount() {
  const payload = JSON.stringify({ type: 'online_count', count: clients.size });
  for (const ws of clients.values()) {
    if (ws.readyState === WebSocket.OPEN) ws.send(payload);
  }
}

function wsSendTo(uid, obj) {
  const ws = clients.get(uid);
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
    return true;
  }
  return false;
}

/** Find all sessions that user `uid` is part of and has a live/upcoming status */
async function getActiveSessions(uid) {
  return Session.find({
    $or: [{ peer1: uid }, { peer2: uid }],
    status: { $in: ['upcoming', 'live', 'active'] }
  });
}

/** Find all connected peer UIDs for a user (accepted connection requests) */
async function getConnectedPeerUids(uid) {
  const { Request } = models;
  const conns = await Request.find({
    $or: [{ from_uid: uid }, { to_uid: uid }],
    status: 'accepted'
  });
  return conns.map(c => (c.from_uid === uid ? c.to_uid : c.from_uid));
}

/** Broadcast loop notifications to affected users */
async function notifyLoopChanges(app, changedUid) {
  try {
    // Invalidate and recompute
    invalidateLoopCache(app);
    const { loops } = await detectLoops(app);

    for (const loop of loops) {
      for (const member of loop.members) {
        if (clients.has(member.uid)) {
          wsSendTo(member.uid, { type: 'loop_discovered', loop });
        }
      }
    }
  } catch (err) {
    console.error('[loops] Notification error:', err.message);
  }
}

// ── AI quiz question generation ───────────────────────────────────────────────
async function generateQuizQuestions(subject, count = 3) {
  const fallback = () => Array.from({ length: count }, (_, i) => ({
    id:            uuidv4(),
    question:      `Quick check: Key concept ${i + 1} about ${subject}?`,
    options:       ['Option A', 'Option B', 'Option C', 'Option D'],
    correct_index: 0
  }));

  if (!process.env.ANTHROPIC_API_KEY) return fallback();

  try {
    const prompt = `Generate ${count} multiple-choice quiz questions on the subject "${subject}" for a peer tutoring session.
Return valid JSON array: [{ "question": "...", "options": ["A","B","C","D"], "correct_index": 0 }]
Keep questions concise and test genuine understanding. No markdown, just the JSON array.`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: {
        'x-api-key':         process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json'
      },
      body: JSON.stringify({
        model:      'claude-3-haiku-20240307',
        max_tokens: 800,
        messages:   [{ role: 'user', content: prompt }]
      })
    });

    const data = await response.json();
    const parsed = JSON.parse(data.content?.[0]?.text || '[]');
    return parsed.map(q => ({ id: uuidv4(), ...q }));
  } catch {
    return fallback();
  }
}

// ── WebSocket connection handler ──────────────────────────────────────────────
wss.on('connection', (ws) => {
  let authedUid       = null;
  let pongTimeout     = null;

  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {

      // ── Section 0: Auth ────────────────────────────────────────────────────
      case 'auth': {
        try {
          const jwt     = require('jsonwebtoken');
          const payload = jwt.verify(msg.token, process.env.JWT_SECRET);
          authedUid     = payload.uid;

          // Cancel any pending reconnect cleanup for this uid
          if (reconnectTimers.has(authedUid)) {
            clearTimeout(reconnectTimers.get(authedUid));
            reconnectTimers.delete(authedUid);
            // Notify session partner this user has resumed
            const activeSessions = await getActiveSessions(authedUid);
            for (const sess of activeSessions) {
              const partnerId = sess.peer1 === authedUid ? sess.peer2 : sess.peer1;
              if (partnerId) wsSendTo(partnerId, { type: 'session_resume', uid: authedUid });
            }
          }

          clients.set(authedUid, ws);
          ws.send(JSON.stringify({ type: 'auth_ok', uid: authedUid }));
          broadcastOnlineCount();

          // Notify connected peers that this user is online
          try {
            const peerUids  = await getConnectedPeerUids(authedUid);
            const onlineNow = peerUids.filter(uid => clients.has(uid));
            // Tell this user which of their peers are online
            ws.send(JSON.stringify({ type: 'peers_online', uids: onlineNow }));
            // Tell each online peer that this user is now online
            for (const pUid of onlineNow) {
              wsSendTo(pUid, { type: 'peer_online', uid: authedUid });
            }
          } catch (e) {
            console.error('[auth] Presence error:', e.message);
          }
        } catch {
          ws.send(JSON.stringify({ type: 'auth_fail' }));
        }
        break;
      }

      // ── Section 0b: Chat (E2EE) ───────────────────────────────────────────
      case 'chat_message': {
        if (!authedUid) return;
        await Message.create({
          id:         msg.id || uuidv4(),
          room_id:    msg.room_id,
          sender_uid: authedUid,
          ciphertext: msg.ciphertext,
          iv:         msg.iv,
          ts:         Date.now()
        });
        wsSendTo(msg.to, {
          type:       'chat_message',
          from:       authedUid,
          room_id:    msg.room_id,
          ciphertext: msg.ciphertext,
          iv:         msg.iv,
          id:         msg.id,
          ts:         Date.now()
        });
        break;
      }

      // ── Section 0c: Public key exchange ───────────────────────────────────
      case 'pub_key_share': {
        if (!authedUid) return;
        const recipWs = clients.get(msg.for_uid);
        if (recipWs && recipWs.readyState === WebSocket.OPEN) {
          recipWs.send(JSON.stringify({ ...msg, from: authedUid }));
        }
        break;
      }

      // ── Section 0d: Misc relay ────────────────────────────────────────────
      case 'live_transcript':
      case 'session_event': {
        if (!authedUid) return;
        const recipWs = clients.get(msg.to);
        if (recipWs && recipWs.readyState === WebSocket.OPEN) {
          recipWs.send(JSON.stringify({ ...msg, from: authedUid }));
        }
        break;
      }

      // ══════════════════════════════════════════════════════════════════════
      // SECTION A: WebRTC SIGNALING
      // ══════════════════════════════════════════════════════════════════════

      case 'webrtc_offer': {
        if (!authedUid) return;
        try {
          // Validate session exists between the two peers
          const sess = await Session.findOne({
            $or: [
              { peer1: authedUid, peer2: msg.to },
              { peer1: msg.to,    peer2: authedUid }
            ],
            status: { $in: ['upcoming', 'live', 'active'] }
          });

          if (!sess) {
            console.error('[webrtc_offer] No valid session found', {
              authedUid,
              to: msg.to,
              sessionStatus: undefined,
              hint: 'Expected Session between peers with status upcoming/live/active'
            });
            ws.send(JSON.stringify({ type: 'error', message: 'No valid session found to start call' }));
            return;
          }

          // Forward offer to recipient
          wsSendTo(msg.to, {
            type:       'webrtc_offer',
            from:       authedUid,
            offer:      msg.offer,
            session_id: msg.session_id || sess.id,
            room_code:  msg.room_code  || sess.room_code
          });

          // Mark session as live
          await Session.updateOne(
            { id: sess.id },
            { $set: { status: 'live', started_at: Date.now() } }
          );

          // Log to activity
          await Activity.create({
            id:   uuidv4(),
            msg:  `Session started: ${sess.subject}`,
            type: 'session',
            ts:   Date.now()
          });
        } catch (e) {
          console.error('[webrtc_offer]', e.message);
          ws.send(JSON.stringify({ type: 'error', message: e.message }));
        }
        break;
      }

      case 'webrtc_answer': {
        if (!authedUid) return;
        wsSendTo(msg.to, { type: 'webrtc_answer', from: authedUid, answer: msg.answer });
        break;
      }

      case 'webrtc_ice': {
        if (!authedUid) return;
        // Forward all ICE candidates (multiple may arrive)
        wsSendTo(msg.to, { type: 'webrtc_ice', from: authedUid, candidate: msg.candidate });
        break;
      }

      case 'webrtc_hangup': {
        if (!authedUid) return;
        try {
          // Forward hangup to peer
          wsSendTo(msg.to, { type: 'webrtc_hangup', from: authedUid });

          // Find the session
          const sess = await Session.findOne({
            $or: [
              { peer1: authedUid, peer2: msg.to },
              { peer1: msg.to,    peer2: authedUid }
            ],
            status: { $in: ['live', 'active'] }
          });

          if (sess) {
            const teacherUid = sess.role1 === 'teach' ? sess.peer1 : sess.peer2;
            const studentUid = sess.role1 === 'teach' ? sess.peer2 : sess.peer1;

            // Mark session completed
            await Session.updateOne(
              { id: sess.id },
              { $set: { status: 'completed', ended_at: Date.now() } }
            );

            // Award XP to both, KP to teacher
            await User.updateOne({ uid: teacherUid }, { $inc: { xp: 100, kp: 50, sess_count: 1 } });
            if (studentUid) {
              await User.updateOne({ uid: studentUid }, { $inc: { xp: 100, sess_count: 1 } });
            }

            // Activity log
            await Activity.create({
              id:   uuidv4(),
              msg:  `Session on "${sess.subject}" completed.`,
              type: 'session',
              ts:   Date.now()
            });

            // Notify both peers
            wsSendTo(teacherUid, { type: 'session_complete', xp_earned: 100, kp_earned: 50 });
            if (studentUid) {
              wsSendTo(studentUid, { type: 'session_complete', xp_earned: 100, kp_earned: 0 });
            }
          }
        } catch (e) {
          console.error('[webrtc_hangup]', e.message);
        }
        break;
      }

      // ══════════════════════════════════════════════════════════════════════
      // SECTION B: QUIZ SYSTEM
      // ══════════════════════════════════════════════════════════════════════

      // ── Teacher pushes a question (relay only) ───────────────────────────
      // Frontend sends `quiz_push` with the question payload.
      // Backend only relays it to the recipient; scoring happens in `quiz_answer`.
      case 'quiz_push': {
        if (!authedUid) return;
        try {
          const { to } = msg;
          const recipWs = clients.get(to);
          if (recipWs && recipWs.readyState === WebSocket.OPEN) {
            recipWs.send(JSON.stringify({ ...msg, from: authedUid }));
          }
        } catch (e) {
          console.error('[quiz_push] Relay error:', e.message);
        }
        break;
      }

      case 'quiz_start': {
        if (!authedUid) return;
        try {
          const { session_id, subject, question_count = 3 } = msg;

          const sess = await Session.findOne({ id: session_id });
          if (!sess) { ws.send(JSON.stringify({ type: 'error', message: 'Session not found' })); return; }

          const studentUid = sess.peer1 === authedUid ? sess.peer2 : sess.peer1;

          // Generate questions (AI or fallback)
          const questions = await generateQuizQuestions(subject, question_count);

          // Store in DB
          const storedQs = [];
          for (const q of questions) {
            const doc = await QuizQuestion.create({
              id:            q.id,
              session_id:    session_id,
              question:      q.question,
              options:       JSON.stringify(q.options),
              correct_index: q.correct_index
            });
            storedQs.push(doc);
          }

          const questionIds = storedQs.map(q => q.id);

          // Send full question list to student
          wsSendTo(studentUid, {
            type:              'quiz_ready',
            questions:         questions.map(q => ({ id: q.id, question: q.question, options: q.options })),
            time_per_question: 30
          });

          // Acknowledge to teacher
          ws.send(JSON.stringify({ type: 'quiz_ready_ack', question_ids: questionIds }));
        } catch (e) {
          console.error('[quiz_start]', e.message);
          ws.send(JSON.stringify({ type: 'error', message: e.message }));
        }
        break;
      }

      case 'quiz_next_question': {
        if (!authedUid) return;
        try {
          const { question_id, student_uid, time_limit = 30 } = msg;

          const qrow = await QuizQuestion.findOne({ id: question_id });
          if (!qrow) return;

          const options = typeof qrow.options === 'string' ? JSON.parse(qrow.options) : qrow.options;

          // Get context for question numbering
          const allQs = await QuizQuestion.find({ session_id: qrow.session_id });
          const qIndex = allQs.findIndex(q => q.id === question_id);

          // Mark as asked
          await QuizQuestion.updateOne({ id: question_id }, { $set: { asked_at: Date.now() } });

          // Send question to student
          wsSendTo(student_uid, {
            type:             'quiz_question',
            question_id,
            question:         qrow.question,
            options,
            time_limit,
            question_number:  qIndex + 1,
            total_questions:  allQs.length
          });

          // Start server-side timer — auto-expire if no answer
          if (quizTimers.has(question_id)) clearTimeout(quizTimers.get(question_id));
          const timer = setTimeout(async () => {
            quizTimers.delete(question_id);
            // Check if already answered
            const answered = await QuizAnswer.findOne({ question_id, student_uid });
            if (!answered) {
              wsSendTo(student_uid,  { type: 'quiz_timeout', question_id });
              wsSendTo(authedUid,    { type: 'quiz_timeout', question_id, student_uid });
            }
          }, time_limit * 1000);
          quizTimers.set(question_id, timer);
        } catch (e) {
          console.error('[quiz_next_question]', e.message);
        }
        break;
      }

      case 'quiz_answer': {
        if (!authedUid) return;
        try {
          const { question_id, answer_index, teacher_uid, time_taken_ms } = msg;

          const qrow = await QuizQuestion.findOne({ id: question_id });
          if (!qrow) return;

          // Clear server-side timer
          if (quizTimers.has(question_id)) {
            clearTimeout(quizTimers.get(question_id));
            quizTimers.delete(question_id);
          }

          const options       = typeof qrow.options === 'string' ? JSON.parse(qrow.options) : qrow.options;
          const is_correct    = answer_index === qrow.correct_index;
          const speed_bonus   = (is_correct && time_taken_ms && time_taken_ms < 30000)
            ? Math.max(0, Math.floor((30000 - time_taken_ms) / 3000))
            : 0;
          const xp_earned     = is_correct ? 10 + speed_bonus : 0;

          await QuizAnswer.create({
            id:           uuidv4(),
            question_id,
            student_uid:  authedUid,
            answer_index,
            is_correct,
            answered_at:  Date.now()
          });

          if (is_correct) {
            await User.updateOne({ uid: authedUid },   { $inc: { xp: xp_earned } });
            await User.updateOne({ uid: teacher_uid }, { $inc: { kp: 5 } });
          }

          // Result to student
          ws.send(JSON.stringify({
            type:         'quiz_result',
            question_id,
            is_correct,
            correct_index: qrow.correct_index,
            xp_earned,
            speed_bonus,
            explanation:  `Correct answer was: ${options[qrow.correct_index]}`
          }));

          // Update to teacher
          wsSendTo(teacher_uid, {
            type:          'student_answered',
            student_uid:   authedUid,
            question_id,
            is_correct,
            answer_index,
            correct_index: qrow.correct_index,
            time_taken_ms
          });
        } catch (e) {
          console.error('[quiz_answer]', e.message);
        }
        break;
      }

      case 'quiz_end': {
        if (!authedUid) return;
        try {
          const { session_id } = msg;

          const sess = await Session.findOne({ id: session_id });
          if (!sess) return;

          const studentUid = sess.peer1 === authedUid ? sess.peer2 : sess.peer1;

          // Compute stats from DB
          const allQs   = await QuizQuestion.find({ session_id });
          const qIds    = allQs.map(q => q.id);
          const answers = await QuizAnswer.find({ question_id: { $in: qIds }, student_uid: studentUid });

          const total_questions = allQs.length;
          const correct         = answers.filter(a => a.is_correct).length;
          const accuracy        = total_questions ? Math.round((correct / total_questions) * 100) : 0;
          const total_xp_earned = answers.reduce((sum, a) => sum + (a.is_correct ? 10 : 0), 0);

          // Update teacher's rolling teaching score
          const teacher = await User.findOne({ uid: authedUid });
          if (teacher) {
            const oldScore  = teacher.teaching_score || 0;
            const count     = teacher.sess_count || 1;
            const newClarity = accuracy / 10; // normalize accuracy% → /10 scale
            const newScore  = oldScore === 0 ? newClarity : ((oldScore * (count - 1)) + newClarity) / count;
            await User.updateOne({ uid: authedUid }, { $set: { teaching_score: Math.min(newScore, 10) } });
          }

          const stats = { total_questions, correct, accuracy, total_xp_earned };

          // Send summary to both
          ws.send(JSON.stringify({ type: 'quiz_summary', stats, badges_earned: [] }));
          wsSendTo(studentUid, { type: 'quiz_summary', stats, badges_earned: [] });

          // Trigger async AI analysis (fire-and-forget)
          if (sess.peer2) {
            fetch(`http://localhost:${process.env.PORT || 3000}/api/ai/analyze`, {
              method:  'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.INTERNAL_TOKEN || ''}` },
              body:    JSON.stringify({
                session_id,
                subject:              sess.subject,
                pulse_checks_total:   total_questions,
                pulse_checks_correct: correct,
                transcript:           ''
              })
            }).catch(e => console.error('[quiz_end] AI analyze error:', e.message));
          }
        } catch (e) {
          console.error('[quiz_end]', e.message);
        }
        break;
      }

      // ══════════════════════════════════════════════════════════════════════
      // SECTION D: LOOP NOTIFICATIONS
      // ══════════════════════════════════════════════════════════════════════

      case 'loop_check': {
        if (!authedUid) return;
        try {
          await notifyLoopChanges(ws._server || app, authedUid);
          ws.send(JSON.stringify({ type: 'loop_check_done' }));
        } catch (e) {
          console.error('[loop_check]', e.message);
        }
        break;
      }

      // ── Keepalive ──────────────────────────────────────────────────────────
      case 'ping': {
        ws.send(JSON.stringify({ type: 'pong' }));
        break;
      }

      case 'pong': {
        // Client responded — remove from pending set
        if (authedUid) pendingPongUids.delete(authedUid);
        if (pongTimeout) { clearTimeout(pongTimeout); pongTimeout = null; }
        break;
      }
    }
  });

  // ── Disconnect handler ───────────────────────────────────────────────────
  ws.on('close', async () => {
    if (!authedUid) return;
    clients.delete(authedUid);
    broadcastOnlineCount();

    // Notify connected peers that this user went offline
    try {
      const peerUids = await getConnectedPeerUids(authedUid);
      for (const pUid of peerUids) {
        wsSendTo(pUid, { type: 'peer_offline', uid: authedUid });
      }

      // Notify active session partners of disconnect
      const activeSessions = await getActiveSessions(authedUid);
      for (const sess of activeSessions) {
        const partnerId = sess.peer1 === authedUid ? sess.peer2 : sess.peer1;
        if (partnerId) wsSendTo(partnerId, { type: 'peer_disconnected', uid: authedUid });
      }
    } catch (e) {
      console.error('[ws.close] Presence error:', e.message);
    }

    // 30-second grace window for reconnection
    const timer = setTimeout(async () => {
      reconnectTimers.delete(authedUid);
      // Permanent disconnect — no additional action needed;
      // state already cleaned up above
    }, 30_000);
    reconnectTimers.set(authedUid, timer);
  });

  ws.on('error', (err) => {
    console.error('[ws] Socket error:', err.message);
  });
});

// ── Heartbeat: every 30s ping all clients, drop non-responders in 5s ─────────
setInterval(() => {
  for (const [uid, ws] of clients.entries()) {
    if (ws.readyState !== WebSocket.OPEN) {
      clients.delete(uid);
      continue;
    }
    // If already pending a pong from a previous cycle, close
    if (pendingPongUids.has(uid)) {
      ws.terminate();
      clients.delete(uid);
      pendingPongUids.delete(uid);
      continue;
    }
    pendingPongUids.add(uid);
    ws.send(JSON.stringify({ type: 'ping' }));
    // Give client 5s to respond
    setTimeout(() => {
      if (pendingPongUids.has(uid)) {
        const deadWs = clients.get(uid);
        if (deadWs) deadWs.terminate();
        clients.delete(uid);
        pendingPongUids.delete(uid);
      }
    }, 5_000);
  }
}, 30_000);

// ── Expose invalidation helper to other routes ────────────────────────────────
app.locals.invalidateLoopCache = () => invalidateLoopCache(app);

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

initDB().then(() => {
  // Start Cron Jobs
  cron.schedule('* * * * *', async () => {
    try {
      const sessions = await Session.find({ status: { $in: ['upcoming', 'live'] } });
      if (!sessions.length) return;

      const uids = new Set();
      sessions.forEach(s => { if(s.peer1) uids.add(s.peer1); if(s.peer2) uids.add(s.peer2); });
      const users = await User.find({ uid: { $in: [...uids] } });
      const userMap = {};
      users.forEach(u => userMap[u.uid] = u);

      const nowMs = Date.now();
      
      for (const sess of sessions) {
        if (!sess.peer2) continue; // No partner yet
        
        // Parse date "YYYY-MM-DD" and time "HH:MM" (convert 12h to 24h for legacy records), assume IST (+05:30)
        let hhmm = sess.time;
        if (hhmm.includes('M')) {
          const [timePart, ap] = hhmm.trim().split(' ');
          let [h, m] = timePart.split(':');
          if (ap === 'PM' && h !== '12') h = String(+h + 12);
          if (ap === 'AM' && h === '12') h = '00';
          hhmm = `${h.padStart(2, '0')}:${m}`;
        }
        const sessDateStr = `${sess.date}T${hhmm}:00+05:30`;
        const sessTimeMs = new Date(sessDateStr).getTime();
        if (isNaN(sessTimeMs)) continue; // skip bad dates
        
        const diffMinutes = Math.floor((sessTimeMs - nowMs) / 60000);
        
        const p1Uid = sess.peer1;
        const p2Uid = sess.peer2;
        const p1 = userMap[p1Uid];
        const p2 = userMap[p2Uid];
        const p1Name = p1 ? p1.name : 'Peer';
        const p2Name = p2 ? p2.name : 'Peer';
        
        if (sess.status === 'upcoming') {
          // 30-min reminder
          if (diffMinutes <= 30 && diffMinutes > 5 && !sess.reminder_30_sent) {
            sess.reminder_30_sent = true;
            await sess.save();
            push.notifySessionReminder30(p1Uid, p2Name, sess.subject, sess.time);
            push.notifySessionReminder30(p2Uid, p1Name, sess.subject, sess.time);
            wsSendTo(p1Uid, { type: 'session_reminder', minutes: 30, session: sess });
            wsSendTo(p2Uid, { type: 'session_reminder', minutes: 30, session: sess });
          }
          
          // 5-min reminder
          if (diffMinutes <= 5 && diffMinutes > 0 && !sess.reminder_5_sent) {
            sess.reminder_5_sent = true;
            await sess.save();
            push.notifySessionReminder5(p1Uid, p2Name, sess.subject);
            push.notifySessionReminder5(p2Uid, p1Name, sess.subject);
            wsSendTo(p1Uid, { type: 'session_reminder', minutes: 5, session: sess });
            wsSendTo(p2Uid, { type: 'session_reminder', minutes: 5, session: sess });
          }
          
          // Live/Start
          if (diffMinutes <= 0) {
            sess.status = 'live';
            await sess.save();
            push.notifySessionStarting(p1Uid, p2Name, sess.subject, sess.id);
            push.notifySessionStarting(p2Uid, p1Name, sess.subject, sess.id);
            wsSendTo(p1Uid, { type: 'session_starting', session_id: sess.id, room_code: sess.room_code });
            wsSendTo(p2Uid, { type: 'session_starting', session_id: sess.id, room_code: sess.room_code });
          }
        } else if (sess.status === 'live') {
          // Auto complete if 2 hours passed
          if (diffMinutes <= -120) {
            sess.status = 'completed';
            sess.ended_at = nowMs;
            await sess.save();
          }
        }
      }
    } catch (err) {
      console.error('[CRON] Error:', err.message);
    }
  });

  cron.schedule('30 18 * * *', async () => {
    console.log('[CRON] Running daily reset job (18:30 UTC / midnight IST)...');
    // Daily resets & streak breaking logic goes here
  });

  // ── Self-Healing Loop Engine: every 30 minutes ─────────────────────────────
  cron.schedule('*/30 * * * *', async () => {
    try {
      await runHealingCycle(clients);
    } catch (err) {
      console.error('[CRON][loopHealer] Error:', err.message);
    }
  });

  // Make registerLoop available to routes (e.g., loops.js detectLoops)
  app.locals.registerLoop = registerLoop;

  // ── BREAKTHROUGH 3: Dormancy Detection — Proactive Engagement Monitoring ────
  // Runs every day at 9am IST. Finds mentor-mentee pairs that have gone silent
  // (no session in 7+ days) and sends a proactive nudge BEFORE they drop off.
  cron.schedule('30 3 * * *', async () => { // 3:30 UTC = 9:00 IST
    console.log('[CRON][Dormancy] Running engagement monitoring...');
    try {
      const { MentorCohort } = models;
      const activeCohorts = await MentorCohort.find({ status: 'active' });
      const DORMANT_DAYS = 7;
      const now = Date.now();

      for (const cohort of activeCohorts) {
        for (const menteeUid of cohort.mentee_uids) {
          const lastSession = await Session.findOne({
            $or: [
              { peer1: cohort.mentor_uid, peer2: menteeUid },
              { peer1: menteeUid, peer2: cohort.mentor_uid }
            ],
            status: { $in: ['completed', 'live'] }
          }).sort({ ended_at: -1 });

          const daysSince = lastSession?.ended_at
            ? Math.floor((now - lastSession.ended_at) / (1000 * 60 * 60 * 24))
            : 999;

          if (daysSince >= DORMANT_DAYS) {
            const mentee = await User.findOne({ uid: menteeUid }, 'name');
            const mentor = await User.findOne({ uid: cohort.mentor_uid }, 'name');

            // WebSocket nudge (if online)
            wsSendTo(cohort.mentor_uid, {
              type: 'dormancy_alert',
              mentee_uid: menteeUid,
              mentee_name: mentee?.name || 'your mentee',
              days_since: daysSince,
              message: `⚠️ You haven't had a session with ${mentee?.name || 'your mentee'} in ${daysSince} days. Schedule one now to keep momentum!`
            });
            wsSendTo(menteeUid, {
              type: 'dormancy_alert',
              mentor_uid: cohort.mentor_uid,
              mentor_name: mentor?.name || 'your mentor',
              days_since: daysSince,
              message: `Your mentor ${mentor?.name || ''} is available. It's been ${daysSince} days — reconnect for your next session!`
            });

            // Dual-channel: Web Push + SMS (Twilio) — SMS reaches rural students even offline
            push.notifyDormancyAlert(cohort.mentor_uid, mentee?.name || 'your mentee', daysSince, 'mentor').catch(() => {});
            push.notifyDormancyAlert(menteeUid, mentor?.name || 'your mentor', daysSince, 'mentee').catch(() => {});

            console.log(`[Dormancy] Nudged pair: ${cohort.mentor_uid} ↔ ${menteeUid} (${daysSince} days dormant)`);
          }
        }
      }
    } catch (err) {
      console.error('[CRON][Dormancy] Error:', err.message);
    }
  });

  server.listen(PORT, '0.0.0.0', () => {
    const os = require('os');
    const nets = os.networkInterfaces();
    let localIp = 'localhost';
    for (const name of Object.keys(nets)) {
      for (const net of nets[name]) {
        if (net.family === 'IPv4' && !net.internal) {
          localIp = net.address;
          break;
        }
      }
    }
    console.log(`\n🎓 CampusKarma server running on http://localhost:${PORT}`);
    console.log(`🔌 WebSocket + Cron Scheduling Active`);
    console.log(`🔁 Loop detection engine ready`);
    console.log(`📱 LAN access at http://${localIp}:${PORT}`);
  });
}).catch(err => {
  console.error('Failed to initialize database', err);
  process.exit(1);
});
