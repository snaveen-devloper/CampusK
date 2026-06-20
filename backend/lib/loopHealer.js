'use strict';

/**
 * ─────────────────────────────────────────────────────────────
 *  CampusKarma — Self-Healing Loop Engine
 *  backend/lib/loopHealer.js
 * ─────────────────────────────────────────────────────────────
 *
 *  BREAKTHROUGH: Fault-Tolerant N-Way Karma Loops
 *
 *  Problem:  In a loop A→B→C→A, if user B becomes inactive /
 *            ghosts, every other member's mentorship stalls.
 *
 *  Solution: This engine runs on a cron schedule and:
 *    1. Identifies any "ghost" link — where the session tied to
 *       a loop link has been "upcoming" for >48 h with no activity
 *       from the responsible user.
 *    2. Runs a localised sub-graph search (same adjacency list
 *       from Johnson's algorithm) to find User D who:
 *         • Can teach what Ghost B was supposed to teach (to C)
 *         • Needs to learn what Ghost B was supposed to learn (from A)
 *       …thereby perfectly filling the hole in the loop.
 *    3. Creates a new Session row for the replacement pair.
 *    4. Updates the LoopHealth document with a heal_event audit entry.
 *    5. WebSocket-notifies all affected loop members in real time.
 *
 *  The result: the mentorship chain NEVER completely dies —
 *  it patches itself, exactly like a self-healing mesh network.
 * ─────────────────────────────────────────────────────────────
 */

const { v4: uuidv4 } = require('uuid');
const { models }     = require('../db');
const { User, Session, Activity } = models;
const LoopHealth = require('../models/LoopHealth');

// How long a session can sit "upcoming" before we consider the
// responsible user a ghost (48 hours in ms)
const GHOST_THRESHOLD_MS = 48 * 60 * 60 * 1000;

// How long a user must have been inactive (no last_active update)
// before we flag them as a ghost candidate
const INACTIVE_THRESHOLD_MS = 48 * 60 * 60 * 1000;

// ─── Helper: build adjacency for a subset of users ─────────────────────────
function buildLocalAdjacency(users) {
  const teachMap = {};
  const learnMap = {};

  for (const u of users) {
    teachMap[u.uid] = new Set();
    learnMap[u.uid] = new Set();
    if (Array.isArray(u.subjects)) {
      for (const s of u.subjects) {
        const name = (typeof s === 'string' ? s : s.name || '').toLowerCase();
        if (!name) continue;
        if (s.teach) teachMap[u.uid].add(name);
        if (s.learn)  learnMap[u.uid].add(name);
      }
    }
  }

  const adj = {};
  for (const u of users) {
    adj[u.uid] = [];
    for (const v of users) {
      if (v.uid === u.uid) continue;
      const overlap = [...teachMap[u.uid]].filter(s => learnMap[v.uid].has(s));
      if (overlap.length) adj[u.uid].push({ to: v.uid, subject: overlap[0] });
    }
  }
  return { adj, teachMap, learnMap };
}

// ─── Helper: find a user who can fill the ghost's role ─────────────────────
// The ghost was: prevMember → ghost (learns `incomingSubject`)
//                ghost → nextMember (teaches `outgoingSubject`)
// We need someone who: teaches `outgoingSubject` AND learns `incomingSubject`
// AND is not already in the loop.
async function findReplacement({ incomingSubject, outgoingSubject, excludeUids }) {
  const allUsers = await User.find({
    uid:      { $nin: excludeUids },
    is_banned: false
  }, 'uid name subjects teaching_score rep_score last_active');

  const candidates = [];

  for (const u of allUsers) {
    const subjs = Array.isArray(u.subjects) ? u.subjects : [];
    const teaches = subjs.filter(s => s.teach).map(s => (s.name || s.id || '').toLowerCase());
    const learns  = subjs.filter(s => s.learn).map(s => (s.name || s.id || '').toLowerCase());

    const canTeachOut = teaches.includes(outgoingSubject.toLowerCase());
    const canLearnIn  = learns.includes(incomingSubject.toLowerCase());

    if (canTeachOut && canLearnIn) {
      candidates.push({
        uid:   u.uid,
        name:  u.name,
        score: (u.teaching_score || 0) + (u.rep_score || 0),
      });
    }
  }

  // Pick the highest-reputation candidate
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0] || null;
}

// ─── Helper: create a fresh session for a healed link ──────────────────────
async function createHealedSession({ teacherUid, studentUid, subject, loopId }) {
  // Schedule it for 24 hours from now
  const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const dateStr = future.toISOString().split('T')[0];
  const [h, m]  = future.toTimeString().split(':');
  const timeStr = `${h}:${m}`;

  const session = await Session.create({
    id:       uuidv4(),
    peer1:    teacherUid,
    peer2:    studentUid,
    subject,
    date:     dateStr,
    time:     timeStr,
    status:   'upcoming',
    room_code: uuidv4().slice(0, 8).toUpperCase(),
    role1:    'teach',
    loop_id:  loopId,
    booked_at: Date.now(),
  });

  return session;
}

// ─── CORE: Heal a single broken link ───────────────────────────────────────
async function healLink({ loopDoc, linkIndex, wsClients }) {
  const link = loopDoc.links[linkIndex];
  if (!link || link.status !== 'missed') return false;

  const memberUids = loopDoc.member_uids;
  const ghostUid   = link.teacher_uid; // the one who ghosted

  // Determine the incoming/outgoing subjects for the ghost's position
  // ghostPrev → ghost (incomingSubject), ghost → ghostNext (outgoingSubject)
  const ghostPos        = memberUids.indexOf(ghostUid);
  const prevLinkIndex   = (linkIndex - 1 + loopDoc.links.length) % loopDoc.links.length;
  const incomingSubject = loopDoc.links[prevLinkIndex]?.subject || link.subject;
  const outgoingSubject = link.subject;

  console.log(`[loopHealer] 🩹 Healing link ${linkIndex}: ghost=${ghostUid} (teaches "${outgoingSubject}")`);

  const replacement = await findReplacement({
    incomingSubject,
    outgoingSubject,
    excludeUids: memberUids,
  });

  if (!replacement) {
    // No replacement found — mark this link (and loop) as broken
    loopDoc.links[linkIndex].status = 'broken';
    loopDoc.status = 'broken';
    await loopDoc.save();
    console.log(`[loopHealer] ❌ No replacement found for ghost ${ghostUid}. Loop ${loopDoc.loop_id} broken.`);
    return false;
  }

  // Build new member list with replacement swapped in
  const newMembers = memberUids.map(uid => uid === ghostUid ? replacement.uid : uid);

  // Create the two new sessions: prevMember→replacement and replacement→nextMember
  const prevMemberUid = newMembers[(ghostPos - 1 + newMembers.length) % newMembers.length];
  const nextMemberUid = newMembers[(ghostPos + 1) % newMembers.length];

  const sess1 = await createHealedSession({
    teacherUid: prevMemberUid,
    studentUid: replacement.uid,
    subject:    incomingSubject,
    loopId:     loopDoc.loop_id,
  });
  const sess2 = await createHealedSession({
    teacherUid: replacement.uid,
    studentUid: nextMemberUid,
    subject:    outgoingSubject,
    loopId:     loopDoc.loop_id,
  });

  // Update the LoopHealth document
  loopDoc.links[linkIndex] = {
    teacher_uid:     replacement.uid,
    student_uid:     nextMemberUid,
    subject:         outgoingSubject,
    session_id:      sess2.id,
    status:          'active',
    healed_at:       Date.now(),
    replacement_uid: replacement.uid,
  };
  // Also patch the previous link's student
  loopDoc.links[prevLinkIndex] = {
    ...loopDoc.links[prevLinkIndex].toObject(),
    student_uid:  replacement.uid,
    session_id:   sess1.id,
    status:       'active',
    healed_at:    Date.now(),
  };
  loopDoc.member_uids = newMembers;
  loopDoc.status      = 'active';
  loopDoc.heal_events.push({
    ts:              Date.now(),
    dropped_uid:     ghostUid,
    replacement_uid: replacement.uid,
    subject:         outgoingSubject,
    reason:          'inactivity',
  });
  await loopDoc.save();

  // Activity log
  await Activity.create({
    id:   uuidv4(),
    msg:  `Loop auto-healed: ${ghostUid} replaced by ${replacement.name} for "${outgoingSubject}"`,
    type: 'loop',
    ts:   Date.now(),
  });

  // WebSocket notifications to all affected live users
  if (wsClients) {
    const affectedUids = [...new Set([...newMembers, ghostUid])];
    for (const uid of affectedUids) {
      const ws = wsClients.get(uid);
      if (ws && ws.readyState === 1 /* OPEN */) {
        ws.send(JSON.stringify({
          type:          'loop_healed',
          loop_id:       loopDoc.loop_id,
          dropped_uid:   ghostUid,
          replacement:   { uid: replacement.uid, name: replacement.name },
          subject:       outgoingSubject,
          message:       uid === ghostUid
            ? 'You were removed from a learning loop due to inactivity.'
            : `Your learning loop was auto-repaired. ${replacement.name} joined in place of an inactive member.`,
        }));
      }
    }
  }

  console.log(`[loopHealer] ✅ Loop ${loopDoc.loop_id} healed. Replacement: ${replacement.uid}`);
  return true;
}

// ─── MAIN: Run the full healing scan ───────────────────────────────────────
/**
 * Called by the cron job every 30 minutes.
 * @param {Map} wsClients - The live WebSocket client map from server.js
 */
async function runHealingCycle(wsClients) {
  console.log('[loopHealer] 🔍 Running healing cycle...');

  const activeLoops = await LoopHealth.find({ status: { $in: ['active', 'healing'] } });
  if (!activeLoops.length) {
    console.log('[loopHealer] No active loops to check.');
    return;
  }

  const now = Date.now();

  for (const loopDoc of activeLoops) {
    loopDoc.last_checked = now;
    let mutated = false;

    for (let i = 0; i < loopDoc.links.length; i++) {
      const link = loopDoc.links[i];
      if (link.status !== 'active') continue;

      // Check if the session tied to this link has stalled
      if (link.session_id) {
        const sess = await Session.findOne({ id: link.session_id });
        if (sess && sess.status === 'upcoming') {
          const elapsed = now - (sess.booked_at || 0);
          if (elapsed > GHOST_THRESHOLD_MS) {
            // Check if the user has been active recently
            const teacher = await User.findOne({ uid: link.teacher_uid }, 'last_active');
            const lastActiveMs = teacher?.last_active ? new Date(teacher.last_active).getTime() : 0;
            const isGhost = (now - lastActiveMs) > INACTIVE_THRESHOLD_MS;

            if (isGhost) {
              console.log(`[loopHealer] ⚠️  Ghost detected: ${link.teacher_uid} in loop ${loopDoc.loop_id}`);
              loopDoc.links[i].status   = 'missed';
              loopDoc.links[i].missed_at = now;
              loopDoc.status = 'healing';
              mutated = true;
              await healLink({ loopDoc, linkIndex: i, wsClients });
            }
          }
        }
      }
    }

    if (mutated || loopDoc.isModified()) await loopDoc.save();
  }

  console.log(`[loopHealer] ✅ Healing cycle complete. Checked ${activeLoops.length} loop(s).`);
}

// ─── Register a freshly detected loop into DB ──────────────────────────────
/**
 * Called from loops.js detectLoops() or a WebSocket handler
 * to persist a new loop into the LoopHealth collection.
 *
 * @param {{ uid_key, members, exchange, score, is_closed }} loop — from enrichCycle()
 */
async function registerLoop(loop) {
  const existing = await LoopHealth.findOne({ loop_id: loop.uid_key });
  if (existing) return existing; // already tracked

  const links = loop.exchange.map(ex => ({
    teacher_uid: ex.from_uid,
    student_uid: ex.to_uid,
    subject:     ex.teaches[0] || '',
    session_id:  null,
    status:      'active',
  }));

  const doc = await LoopHealth.create({
    loop_id:    loop.uid_key,
    member_uids: loop.members.map(m => m.uid),
    links,
    score:      loop.score || 0,
    is_closed:  loop.is_closed !== false,
    status:     'active',
    created_at: Date.now(),
  });

  console.log(`[loopHealer] 📋 Registered new loop: ${loop.uid_key} (${links.length} links)`);
  return doc;
}

// ─── Link a session to a loop after it is created ──────────────────────────
/**
 * Called from sessions.js route when a new session is created with a loop_id.
 */
async function linkSessionToLoop({ loopId, teacherUid, studentUid, sessionId }) {
  const loopDoc = await LoopHealth.findOne({ loop_id: loopId });
  if (!loopDoc) return;

  const link = loopDoc.links.find(
    l => l.teacher_uid === teacherUid && l.student_uid === studentUid
  );
  if (link) {
    link.session_id = sessionId;
    await loopDoc.save();
  }
}

module.exports = { runHealingCycle, registerLoop, linkSessionToLoop };
