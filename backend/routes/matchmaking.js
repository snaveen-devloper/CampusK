const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { initDB, models } = require('../db');
const { User, Session, MentorCohort } = models;
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

/**
 * POST /api/matchmaking/agaram
 * Agaram Foundation Matchmaking algorithm: Mentors -> Mentees Cohort Matching
 * Auto-assigns students to open mentor slots based on subject and language.
 */
router.post('/agaram', auth, async (req, res) => {
  try {
    await initDB();
    
    // 1. Fetch available Mentors
    const mentors = await User.find({ 
      user_type: 'mentor', 
      is_banned: false,
      $expr: { $lt: ['$current_mentees_count', '$max_mentees'] } 
    });

    // 2. Fetch unassigned Mentees
    // Assuming unassigned mentees are those without an active MentorCohort
    const activeCohorts = await MentorCohort.find({ status: 'active' });
    const assignedMenteeUids = new Set();
    for (const c of activeCohorts) {
      c.mentee_uids.forEach(uid => assignedMenteeUids.add(uid));
    }

    const unassignedMentees = await User.find({
      user_type: 'mentee',
      is_banned: false,
      uid: { $nin: Array.from(assignedMenteeUids) }
    });

    if (unassignedMentees.length === 0) {
      return res.json({ message: 'No unassigned mentees found.', assignments: [] });
    }
    if (mentors.length === 0) {
      return res.json({ message: 'No available mentors with open slots found.', assignments: [] });
    }

    const newAssignments = [];

    // Helper to evaluate match score between Mentee and Mentor
    // BREAKTHROUGH 5: Multi-dimensional algorithmic scoring
    // Scores across 4 dimensions for high "Pairing Success Rate"
    const matchScore = (mentor, mentee) => {
      let score = 0;
      
      // Dimension 1: Language Match (Crucial for rural students — gate condition)
      const mentorLangs = (mentor.languages || []).map(l => l.toLowerCase());
      const menteeLangs = (mentee.languages || []).map(l => l.toLowerCase());
      const commonLang = mentorLangs.find(l => menteeLangs.includes(l));
      if (!commonLang) return { score: -1, matchingSubjs: [] }; // Hard gate: must share language

      score += 50; // Language match

      // Dimension 2: Subject/Skill Match
      const mentorTeaches = (mentor.subjects || []).filter(s => s.teach).map(s => (s.name || s.id).toLowerCase());
      const menteeNeeds = (mentee.subjects || []).filter(s => s.learn).map(s => (s.name || s.id).toLowerCase());
      const matchingSubjs = mentorTeaches.filter(s => menteeNeeds.includes(s));
      if (matchingSubjs.length === 0) return { score: -1, matchingSubjs: [] }; // Hard gate: must share subject

      score += (matchingSubjs.length * 20);

      // Dimension 3: Geographic Location (Bonus for rural areas)
      if (mentor.location && mentee.location && mentor.location.toLowerCase() === mentee.location.toLowerCase()) {
        score += 30;
      }

      // Dimension 4 (BT5): Career Domain Alignment — personality/goal fit
      // A mentee interested in engineering benefits most from a mentor in engineering
      if (mentor.career_domain && mentee.career_domain &&
          mentor.career_domain.toLowerCase() === mentee.career_domain.toLowerCase()) {
        score += 25;
      }

      // Dimension 5 (BT5): Alumni Trust — Agaram's "Circle of Trust"
      // Former beneficiaries who return as mentors get priority — they best understand the journey
      if (mentor.is_alumni) {
        score += 20; // Alumni mentors are preferred: they share lived experience
      }

      return { score, matchingSubjs };
    };

    // 3. Greedy Assigner
    for (const mentee of unassignedMentees) {
      // Find best mentor for this mentee
      let bestMentor = null;
      let highestScore = -1;
      let matchedSubjects = [];

      for (const mentor of mentors) {
        if (mentor.current_mentees_count >= mentor.max_mentees) continue;
        
        const match = matchScore(mentor, mentee);
        if (match.score > highestScore) {
          highestScore = match.score;
          bestMentor = mentor;
          matchedSubjects = match.matchingSubjs;
        }
      }

      if (bestMentor) {
        // Find or create cohort for this mentor
        let cohort = await MentorCohort.findOne({ mentor_uid: bestMentor.uid, status: 'active' });
        if (!cohort) {
          cohort = await MentorCohort.create({
            cohort_id: 'agaram_' + uuidv4().substring(0, 8),
            mentor_uid: bestMentor.uid,
            mentee_uids: [],
            program_type: 'general'
          });
        }

        // Add mentee to cohort
        cohort.mentee_uids.push(mentee.uid);
        await cohort.save();

        // Update mentor count
        bestMentor.current_mentees_count += 1;
        await bestMentor.save();

        newAssignments.push({
          mentee_uid: mentee.uid,
          mentor_uid: bestMentor.uid,
          cohort_id: cohort.cohort_id,
          matched_subjects: matchedSubjects
        });
      }
    }

    res.json({
      message: `Successfully matched ${newAssignments.length} mentees to mentors.`,
      assignments: newAssignments
    });

  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
