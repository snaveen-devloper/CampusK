const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { initDB, models } = require('../db');
const { Session, User, Transaction, Activity, AIFeedback, Note } = models;
const { v4: uuidv4 } = require('uuid');
const fetch = require('node-fetch');

function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// ── List my sessions ──────────────────────────────────────────────────────────
router.get('/', auth, async (req, res) => {
  try {
    await initDB();
    const sessions = await Session.find({
      $or: [{ peer1: req.user.uid }, { peer2: req.user.uid }]
    }).sort({ booked_at: -1 });
    res.json({ sessions });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Create regular session ────────────────────────────────────────────────────
router.post('/', auth, async (req, res) => {
  try {
    await initDB();
    const { peer2, subject, date, time, role1 } = req.body;
    if (!peer2) return res.status(400).json({ error: 'peer2 is required to book a regular session' });
    if (!subject || !date || !time) return res.status(400).json({ error: 'subject, date and time are required' });
    const session = await Session.create({
      id: uuidv4(),
      peer1: req.user.uid,
      peer2,
      subject,
      date,
      time,
      role1: role1 || 'teach',
      type: 'regular',
      room_code: Math.random().toString(36).substring(2, 10).toUpperCase(),
      booked_at: Date.now()
    });
    res.status(201).json({ session });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Create a Skill Session ───────────────────────────────────────────────────
// A skill session is initiated by peer1 (teacher). peer2 joins via room_code.
router.post('/skill', auth, async (req, res) => {
  try {
    await initDB();
    const { subject, loop_id } = req.body;
    if (!subject) return res.status(400).json({ error: 'Subject is required' });

    const room_code = Math.random().toString(36).substring(2, 10).toUpperCase();
    const session = await Session.create({
      id: uuidv4(),
      peer1: req.user.uid,
      peer2: null, // peer2 joins later via room_code
      subject,
      date: new Date().toISOString().split('T')[0],
      time: new Date().toTimeString().split(' ')[0].substring(0, 5),
      role1: 'teach',
      type: 'skill',
      room_code,
      loop_id: loop_id || null,
      booked_at: Date.now()
    });

    res.status(201).json({ session, room_code });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Join a Skill Session via room_code ────────────────────────────────────────
router.post('/join', auth, async (req, res) => {
  try {
    await initDB();
    const { room_code } = req.body;
    if (!room_code) return res.status(400).json({ error: 'room_code is required' });

    const session = await Session.findOne({ room_code, type: 'skill' });
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (session.peer2) return res.status(400).json({ error: 'Session already has two participants' });
    if (session.peer1 === req.user.uid) return res.status(400).json({ error: 'Cannot join your own session' });

    session.peer2 = req.user.uid;
    session.joined_at = Date.now();
    session.status = 'active';
    await session.save();

    // Notify via WebSocket if available
    // The WS notification logic will fire from the frontend via WS, so we just return the session.

    res.json({ session });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── End a Skill Session + trigger AI validation ───────────────────────────────
router.patch('/:id/end', auth, async (req, res) => {
  try {
    await initDB();
    const { pulse_checks_total = 0, pulse_checks_correct = 0, transcript = '' } = req.body;

    const session = await Session.findOne({ id: req.params.id });
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (session.peer1 !== req.user.uid && session.peer2 !== req.user.uid) {
      return res.status(403).json({ error: 'Not a participant' });
    }
    if (session.status === 'completed') return res.status(400).json({ error: 'Session already completed' });

    session.ended_at = Date.now();
    session.status = 'ended';
    await session.save();

    const teacherUid = session.role1 === 'teach' ? session.peer1 : session.peer2;
    const studentUid = session.role1 === 'teach' ? session.peer2 : session.peer1;

    // ── AI Validation ─────────────────────────────────────────────────────────
    let clarity = 5.0, engagement = 5.0, repDelta = 0, feedbackText = 'Session completed.';
    let aiNotes = '';
    let kpBonus = 0;

    if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY === 'your_anthropic_api_key_here') {
      // Fallback scoring
      if (pulse_checks_total > 0) {
        engagement = (pulse_checks_correct / pulse_checks_total) * 10;
        clarity = engagement >= 5 ? 8.5 : 4.0;
        feedbackText = `Knowledge check: ${pulse_checks_correct}/${pulse_checks_total} correct.`;
        repDelta = engagement >= 5 ? 0.2 : -0.1;
      } else {
        clarity = 7.0; engagement = 6.0;
        feedbackText = 'Good session. Try using Pulse Checks next time.';
        repDelta = 0.1;
      }
    } else {
      const prompt = `Analyze a peer teaching session on "${session.subject}".
Teacher sent ${pulse_checks_total} pulse-check questions. Student answered ${pulse_checks_correct} correctly.
Transcript:
<transcript>
${transcript || '(No transcript recorded)'}
</transcript>

Return valid JSON with: clarity_score (1-10), engagement_score (1-10), feedback_text (1-2 sentences), learning_notes (markdown).`;

      try {
        const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': process.env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json'
          },
          body: JSON.stringify({
            model: 'claude-3-haiku-20240307',
            max_tokens: 400,
            messages: [{ role: 'user', content: prompt }]
          })
        });
        const data = await apiRes.json();
        const parsed = JSON.parse(data.content?.[0]?.text || '{}');
        clarity = parseFloat(parsed.clarity_score) || 7.0;
        engagement = parseFloat(parsed.engagement_score) || 7.0;
        feedbackText = parsed.feedback_text || feedbackText;
        aiNotes = parsed.learning_notes || '';
        repDelta = (clarity > 7 && engagement > 7) ? 0.3 : (clarity < 5 ? -0.2 : 0.1);
      } catch(aiErr) {
        console.error('AI validation failed:', aiErr.message);
      }
    }

    // ── Karma Calculation ─────────────────────────────────────────────────────
    let teacherKP = 50;
    let teacherXP = 20;
    const studentXP = 10;

    if (clarity >= 8) { teacherKP += 25; } // Bonus for high clarity
    if (session.type === 'skill') {
      // AI knowledge transfer bonus
      teacherKP += 15; teacherXP += 15;
      kpBonus = 15;
    }

    // ── Apply rewards ─────────────────────────────────────────────────────────
    await User.updateOne({ uid: teacherUid }, { $inc: { kp: teacherKP, xp: teacherXP, sess_count: 1 } });
    if (studentUid) {
      await User.updateOne({ uid: studentUid }, { $inc: { xp: studentXP, sess_count: 1 } });
    }

    await Transaction.create({
      id: uuidv4(),
      uid: teacherUid,
      icon: '🎓',
      description: `Skill session: ${session.subject} (+${teacherKP} KP)`,
      amount: teacherKP,
      type: 'earn',
      ts: Date.now()
    });

    // ── Save AI Feedback ─────────────────────────────────────────────────────
    await AIFeedback.create({
      id: uuidv4(),
      session_id: session.id,
      teacher_uid: teacherUid,
      student_uid: studentUid || teacherUid,
      clarity_score: clarity,
      engagement_score: engagement,
      feedback_text: feedbackText,
      rep_delta: repDelta,
      created_at: Date.now()
    });

    if (aiNotes) {
      await Note.create({
        id: uuidv4(),
        session_id: session.id,
        author_uid: teacherUid,
        title: `AI Notes: ${session.subject}`,
        content: aiNotes,
        is_public: false,
        ts: Date.now()
      });
    }

    // ── Update teacher's reputation score ────────────────────────────────────
    const teacher = await User.findOne({ uid: teacherUid });
    const oldScore = teacher.teaching_score || 0;
    const count = teacher.sess_count || 1;
    let newScore = oldScore === 0 ? clarity : ((oldScore * (count - 1)) + clarity) / count;
    let newRep = (teacher.rep_score || 0) + repDelta;
    if (newRep < 0) newRep = 0;
    if (newScore > 10) newScore = 10;
    await User.updateOne({ uid: teacherUid }, { $set: { teaching_score: newScore, rep_score: newRep } });

    session.status = 'completed';
    session.rated = true;
    session.ai_validated = true;
    await session.save();

    await Activity.create({ id: uuidv4(), msg: `Skill session on "${session.subject}" completed.`, type: 'session', ts: Date.now() });

    res.json({
      success: true,
      clarity,
      engagement,
      feedback: feedbackText,
      kp_awarded: teacherKP,
      xp_awarded: teacherXP,
      kp_bonus: kpBonus
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Complete a session (after the WS hangup already applied baseline KP/XP)
// and generate AI feedback + notes. This endpoint exists because the
// frontend's session flow ends via WebRTC hangup first.
router.post('/:id/complete', auth, async (req, res) => {
  try {
    await initDB();
    const { pulse_checks_total = 0, pulse_checks_correct = 0, transcript = '' } = req.body;

    const session = await Session.findOne({ id: req.params.id });
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (session.peer1 !== req.user.uid && session.peer2 !== req.user.uid) {
      return res.status(403).json({ error: 'Not a participant' });
    }

    const teacherUid = session.role1 === 'teach' ? session.peer1 : session.peer2;
    const studentUid = session.role1 === 'teach' ? session.peer2 : session.peer1;

    // ── AI Validation ─────────────────────────────────────────────────────────
    let clarity = 5.0, engagement = 5.0, repDelta = 0, feedbackText = 'Session completed.';
    let aiNotes = '';

    if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY === 'your_anthropic_api_key_here') {
      // Fallback scoring
      if (pulse_checks_total > 0) {
        engagement = (pulse_checks_correct / pulse_checks_total) * 10;
        clarity = engagement >= 5 ? 8.5 : 4.0;
        feedbackText = `Knowledge check: ${pulse_checks_correct}/${pulse_checks_total} correct.`;
        repDelta = engagement >= 5 ? 0.2 : -0.1;
      } else {
        clarity = 7.0; engagement = 6.0;
        feedbackText = 'Good session. Try using Pulse Checks next time.';
        repDelta = 0.1;
      }
    } else {
      const prompt = `Analyze a peer teaching session on "${session.subject}".
Teacher sent ${pulse_checks_total} pulse-check questions. Student answered ${pulse_checks_correct} correctly.
Transcript:
<transcript>
${transcript || '(No transcript recorded)'}
</transcript>

Return valid JSON with: clarity_score (1-10), engagement_score (1-10), feedback_text (1-2 sentences), learning_notes (markdown).`;

      try {
        const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': process.env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: 'claude-3-haiku-20240307',
            max_tokens: 400,
            messages: [{ role: 'user', content: prompt }],
          }),
        });

        const data = await apiRes.json();
        let text = data.content?.[0]?.text || '{}';
        text = String(text).replace(/```json/g, '').replace(/```/g, '').trim();
        const parsed = JSON.parse(text);

        clarity = parseFloat(parsed.clarity_score) || 7.0;
        engagement = parseFloat(parsed.engagement_score) || 7.0;
        feedbackText = parsed.feedback_text || feedbackText;
        aiNotes = parsed.learning_notes || '';
        repDelta = (clarity > 7 && engagement > 7) ? 0.3 : (clarity < 5 ? -0.2 : 0.1);
      } catch (aiErr) {
        console.error('AI validation failed:', aiErr.message);
      }
    }

    // ── Save AI Feedback (no KP/XP changes here; hangup already did baseline rewards) ──
    await AIFeedback.create({
      id: uuidv4(),
      session_id: session.id,
      teacher_uid: teacherUid,
      student_uid: studentUid || teacherUid,
      clarity_score: clarity,
      engagement_score: engagement,
      feedback_text: feedbackText,
      rep_delta: repDelta,
      created_at: Date.now(),
    });

    if (aiNotes) {
      await Note.create({
        id: uuidv4(),
        session_id: session.id,
        author_uid: teacherUid,
        title: `AI Notes: ${session.subject}`,
        content: aiNotes,
        is_public: false,
        ts: Date.now(),
      });
    }

    // ── Update teacher's reputation score ────────────────────────────────────
    const teacher = await User.findOne({ uid: teacherUid });
    if (teacher) {
      const oldScore = teacher.teaching_score || 0;
      const count = teacher.sess_count || 1;
      let newScore = oldScore === 0 ? clarity : ((oldScore * (count - 1)) + clarity) / count;
      let newRep = (teacher.rep_score || 0) + repDelta;
      if (newRep < 0) newRep = 0;
      if (newScore > 10) newScore = 10;
      await User.updateOne({ uid: teacherUid }, { $set: { teaching_score: newScore, rep_score: newRep } });
    }

    session.rated = true;
    session.ai_validated = true;
    await session.save();

    await Activity.create({
      id: uuidv4(),
      msg: `Session AI feedback saved for "${session.subject}".`,
      type: 'session',
      ts: Date.now(),
    });

    res.json({ success: true, clarity, engagement, feedback: feedbackText });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Rate a session (peer rating) ─────────────────────────────────────────────
router.patch('/:id/rate', auth, async (req, res) => {
  try {
    await initDB();
    const { rating } = req.body;
    const session = await Session.findOne({ id: req.params.id });
    if (!session) return res.status(404).json({ error: 'Session not found' });
    
    session.rating = rating;
    session.rated = true;
    session.status = 'completed';
    await session.save();

    const teacherUid = session.role1 === 'teach' ? session.peer1 : session.peer2;
    const studentUid = session.role1 === 'teach' ? session.peer2 : session.peer1;

    await User.updateOne({ uid: teacherUid }, { $inc: { kp: 50, xp: 20, sess_count: 1 } });
    await User.updateOne({ uid: studentUid }, { $inc: { xp: 10, sess_count: 1 } });

    await Transaction.create({
      id: uuidv4(),
      uid: teacherUid,
      description: `Completed session: ${session.subject}`,
      amount: 50,
      type: 'earn',
      ts: Date.now()
    });

    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Cancel (delete) a session ───────────────────────────────────────────────
router.delete('/:id', auth, async (req, res) => {
  try {
    await initDB();
    const session = await Session.findOne({ id: req.params.id });
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (session.peer1 !== req.user.uid && session.peer2 !== req.user.uid) {
      return res.status(403).json({ error: 'Not a participant' });
    }
    await Session.deleteOne({ id: req.params.id });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
