const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { initDB, models } = require('../db');
const { User, Session } = models;
const { buildKarmaLoop } = require('../lib/loopMatcher');

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

/**
 * GET /api/matchmaking/loop
 * Preview a karma loop using currently online users
 * Query param: ?uids=uid1,uid2,uid3 (optional; defaults to all online users)
 */
router.get('/loop', auth, async (req, res) => {
  try {
    await initDB();

    let targetUsers;

    if (req.query.uids) {
      // Use a specific list of UIDs
      const uids = req.query.uids.split(',').map(s => s.trim()).filter(Boolean);
      targetUsers = await User.find({ uid: { $in: uids }, is_banned: false });
    } else {
      // Use all online users from WebSocket map
      const wsClients = req.app.locals.wsClients || new Map();
      const onlineUids = [...wsClients.keys()];
      if (onlineUids.length < 2) {
        return res.json({ loop: [], unmatched: onlineUids, is_closed: false, message: 'Not enough online users to form a loop.' });
      }
      targetUsers = await User.find({ uid: { $in: onlineUids }, is_banned: false });
    }

    if (targetUsers.length < 2) {
      return res.json({ loop: [], unmatched: [], is_closed: false, message: 'Need at least 2 users to form a loop.' });
    }

    const result = buildKarmaLoop(targetUsers);
    res.json(result);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

/**
 * POST /api/matchmaking/loop
 * Run the loop algorithm for a specified group and AUTO-CREATE skill sessions.
 * Body: { uids: ['uid1', 'uid2', ...] }
 */
router.post('/loop', auth, async (req, res) => {
  try {
    await initDB();
    const { uids } = req.body;
    if (!Array.isArray(uids) || uids.length < 2) {
      return res.status(400).json({ error: 'At least 2 UIDs required.' });
    }

    const targetUsers = await User.find({ uid: { $in: uids }, is_banned: false });
    if (targetUsers.length < 2) {
      return res.status(400).json({ error: 'Not enough valid users.' });
    }

    const { loop, unmatched, is_closed } = buildKarmaLoop(targetUsers);

    if (loop.length === 0) {
      return res.json({ sessions_created: [], unmatched, is_closed, message: 'No compatible teaching pairs found. Users may not have complementary skills.' });
    }

    // Generate a unique loop group ID
    const loopId = 'loop_' + uuidv4().substring(0, 8);

    // Create a Skill Session for each pair in the loop
    const today = new Date().toISOString().split('T')[0];
    const time = new Date().toTimeString().split(' ')[0].substring(0, 5);

    const createdSessions = [];
    for (const pair of loop) {
      const room_code = Math.random().toString(36).substring(2, 10).toUpperCase();
      const session = await Session.create({
        id: uuidv4(),
        peer1: pair.teacher_uid,
        peer2: pair.student_uid,
        subject: pair.subject,
        date: today,
        time,
        role1: 'teach',
        type: 'skill',
        room_code,
        loop_id: loopId,
        status: 'upcoming',
        booked_at: Date.now()
      });
      createdSessions.push({
        session_id: session.id,
        teacher_uid: pair.teacher_uid,
        student_uid: pair.student_uid,
        subject: pair.subject,
        room_code
      });
    }

    // Notify matched users via WebSocket if connected
    const wsClients = req.app.locals.wsClients || new Map();
    for (const pair of createdSessions) {
      const teacherWs = wsClients.get(pair.teacher_uid);
      const studentWs = wsClients.get(pair.student_uid);
      const payload = JSON.stringify({
        type: 'loop_matched',
        loop_id: loopId,
        session_id: pair.session_id,
        subject: pair.subject,
        room_code: pair.room_code
      });
      if (teacherWs && teacherWs.readyState === 1) teacherWs.send(JSON.stringify({ ...JSON.parse(payload), role: 'teach' }));
      if (studentWs && studentWs.readyState === 1) studentWs.send(JSON.stringify({ ...JSON.parse(payload), role: 'learn' }));
    }

    res.status(201).json({
      loop_id: loopId,
      is_closed,
      sessions_created: createdSessions,
      unmatched
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
