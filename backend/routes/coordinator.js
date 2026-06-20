const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { initDB, models } = require('../db');

// ─── Admin/Coordinator Auth ───────────────────────────────────────────────────
function coordAuth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    // Only users with user_type admin or the master coordinator key
    if (decoded.user_type !== 'admin' && req.headers['x-coordinator-key'] !== process.env.COORDINATOR_KEY) {
      return res.status(403).json({ error: 'Coordinator access required' });
    }
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/coordinator/overview
// The main dashboard numbers — coordinator sees the full system state at a glance
// ─────────────────────────────────────────────────────────────────────────────
router.get('/overview', coordAuth, async (req, res) => {
  try {
    await initDB();
    const { User, MentorCohort, Session, AIFeedback } = models;

    const [
      totalMentors,
      totalMentees,
      activeCohorts,
      totalSessions,
      completedSessions,
      allFeedback
    ] = await Promise.all([
      User.countDocuments({ user_type: 'mentor', is_banned: false }),
      User.countDocuments({ user_type: 'mentee', is_banned: false }),
      MentorCohort.find({ status: 'active' }),
      Session.countDocuments({}),
      Session.countDocuments({ status: 'completed' }),
      AIFeedback.find({}).sort({ created_at: -1 }).limit(500)
    ]);

    // Compute unmatched mentees
    const assignedUids = new Set();
    activeCohorts.forEach(c => c.mentee_uids.forEach(u => assignedUids.add(u)));
    const unmatchedMentees = totalMentees - assignedUids.size;

    // Average engagement score
    const avgEngagement = allFeedback.length
      ? (allFeedback.reduce((sum, f) => sum + (f.engagement_score || 0), 0) / allFeedback.length).toFixed(1)
      : 0;

    // At-risk cohorts (no session in 7 days)
    const now = Date.now();
    const DORMANT_MS = 7 * 24 * 60 * 60 * 1000;
    let atRiskCount = 0;
    for (const cohort of activeCohorts) {
      for (const menteeUid of cohort.mentee_uids) {
        const lastSession = await Session.findOne({
          $or: [
            { peer1: cohort.mentor_uid, peer2: menteeUid },
            { peer1: menteeUid, peer2: cohort.mentor_uid }
          ],
          status: { $in: ['completed', 'live'] }
        }).sort({ ended_at: -1 });
        if (!lastSession || (now - (lastSession.ended_at || now)) > DORMANT_MS) {
          atRiskCount++;
          break; // count cohort once
        }
      }
    }

    res.json({
      total_mentors: totalMentors,
      total_mentees: totalMentees,
      active_cohorts: activeCohorts.length,
      unmatched_mentees: unmatchedMentees,
      total_sessions: totalSessions,
      completed_sessions: completedSessions,
      avg_engagement_score: parseFloat(avgEngagement),
      at_risk_cohorts: atRiskCount,
      system_health: atRiskCount === 0 ? 'healthy' : atRiskCount < 5 ? 'needs_attention' : 'critical'
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/coordinator/match-all
// THE CORE COORDINATOR ACTION: One click → matches ALL unassigned students
// This is the automation of the coordinator's entire seasonal matching workflow
// ─────────────────────────────────────────────────────────────────────────────
router.post('/match-all', coordAuth, async (req, res) => {
  try {
    await initDB();
    const { User, MentorCohort } = models;

    // Fetch available Mentors
    const mentors = await User.find({
      user_type: 'mentor',
      is_banned: false,
      $expr: { $lt: ['$current_mentees_count', '$max_mentees'] }
    });

    // Find all currently assigned mentee UIDs
    const activeCohorts = await MentorCohort.find({ status: 'active' });
    const assignedUids = new Set();
    activeCohorts.forEach(c => c.mentee_uids.forEach(u => assignedUids.add(u)));

    const unassignedMentees = await User.find({
      user_type: 'mentee',
      is_banned: false,
      uid: { $nin: Array.from(assignedUids) }
    });

    if (unassignedMentees.length === 0) return res.json({ message: 'All mentees are already matched.', matched: 0, unmatched: 0 });
    if (mentors.length === 0) return res.json({ message: 'No mentors with open slots.', matched: 0, unmatched: unassignedMentees.length });

    const matchScore = (mentor, mentee) => {
      let score = 0;
      const mLangs = (mentor.languages || []).map(l => l.toLowerCase());
      const tLangs = (mentee.languages || []).map(l => l.toLowerCase());
      if (!mLangs.find(l => tLangs.includes(l))) return -1;
      score += 50;

      const teaches = (mentor.subjects || []).filter(s => s.teach).map(s => (s.name || s.id || '').toLowerCase());
      const needs = (mentee.subjects || []).filter(s => s.learn).map(s => (s.name || s.id || '').toLowerCase());
      const matched = teaches.filter(s => needs.includes(s));
      if (matched.length === 0) return -1;
      score += matched.length * 20;

      if (mentor.location && mentee.location && mentor.location.toLowerCase() === mentee.location.toLowerCase()) score += 30;
      if (mentor.career_domain && mentee.career_domain && mentor.career_domain.toLowerCase() === mentee.career_domain.toLowerCase()) score += 25;
      if (mentor.is_alumni) score += 20;
      score += Math.min(25, (mentor.teaching_score || 0) * 2.5); // Success rate
      if (mentor.current_mentees_count < mentor.max_mentees - 2) score += 15; // Bandwidth bonus

      return score;
    };

    const assignments = [];
    const unmatched = [];

    for (const mentee of unassignedMentees) {
      let best = null, bestScore = -1;
      for (const mentor of mentors) {
        if (mentor.current_mentees_count >= mentor.max_mentees) continue;
        const s = matchScore(mentor, mentee);
        if (s > bestScore) { bestScore = s; best = mentor; }
      }

      if (best) {
        let cohort = await MentorCohort.findOne({ mentor_uid: best.uid, status: 'active' });
        if (!cohort) {
          cohort = await MentorCohort.create({ cohort_id: 'agaram_' + uuidv4().substring(0, 8), mentor_uid: best.uid, mentee_uids: [] });
        }
        cohort.mentee_uids.push(mentee.uid);
        await cohort.save();
        best.current_mentees_count += 1;
        await best.save();
        assignments.push({ mentee_uid: mentee.uid, mentor_uid: best.uid, score: bestScore, cohort_id: cohort.cohort_id });
      } else {
        unmatched.push(mentee.uid);
      }
    }

    res.json({
      message: `Matched ${assignments.length} students. ${unmatched.length} could not be matched (no compatible mentor available).`,
      matched: assignments.length,
      unmatched: unmatched.length,
      assignments
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/coordinator/alerts
// Live action queue — coordinator sees only what needs their attention today
// ─────────────────────────────────────────────────────────────────────────────
router.get('/alerts', coordAuth, async (req, res) => {
  try {
    await initDB();
    const { User, MentorCohort, Session } = models;
    const now = Date.now();
    const alerts = [];

    // Unmatched mentees
    const activeCohorts = await MentorCohort.find({ status: 'active' });
    const assignedUids = new Set();
    activeCohorts.forEach(c => c.mentee_uids.forEach(u => assignedUids.add(u)));
    const unmatchedMentees = await User.find({ user_type: 'mentee', is_banned: false, uid: { $nin: Array.from(assignedUids) } }, 'uid name location languages');
    if (unmatchedMentees.length > 0) {
      alerts.push({ type: 'unmatched_students', severity: 'high', count: unmatchedMentees.length, message: `${unmatchedMentees.length} students are waiting to be assigned a mentor.`, action: 'match-all' });
    }

    // Dormant cohorts > 7 days
    let dormantCount = 0;
    const dormantPairs = [];
    for (const cohort of activeCohorts) {
      for (const menteeUid of cohort.mentee_uids) {
        const last = await Session.findOne({ $or: [{ peer1: cohort.mentor_uid, peer2: menteeUid }, { peer1: menteeUid, peer2: cohort.mentor_uid }], status: 'completed' }).sort({ ended_at: -1 });
        const days = last?.ended_at ? Math.floor((now - last.ended_at) / 86400000) : 999;
        if (days >= 7) {
          dormantCount++;
          dormantPairs.push({ mentor_uid: cohort.mentor_uid, mentee_uid: menteeUid, days_since: days });
        }
      }
    }
    if (dormantCount > 0) {
      alerts.push({ type: 'dormant_pairs', severity: dormantCount > 10 ? 'critical' : 'medium', count: dormantCount, message: `${dormantCount} mentor-mentee pairs haven't had a session in 7+ days.`, pairs: dormantPairs.slice(0, 10) });
    }

    // Mentors at full capacity
    const fullMentors = await User.countDocuments({ user_type: 'mentor', $expr: { $gte: ['$current_mentees_count', '$max_mentees'] } });
    if (fullMentors > 0) alerts.push({ type: 'full_mentors', severity: 'info', count: fullMentors, message: `${fullMentors} mentors are at full capacity.` });

    res.json({ alerts, generated_at: new Date().toISOString() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/coordinator/cohorts
// Full list of all cohorts with mentor details and health scores
// ─────────────────────────────────────────────────────────────────────────────
router.get('/cohorts', coordAuth, async (req, res) => {
  try {
    await initDB();
    const { User, MentorCohort, Session, AIFeedback } = models;
    const cohorts = await MentorCohort.find({ status: 'active' });
    const now = Date.now();
    const result = [];

    for (const cohort of cohorts) {
      const mentor = await User.findOne({ uid: cohort.mentor_uid }, 'name uid location languages career_domain is_alumni teaching_score');
      let totalHealth = 0;
      const menteeDetails = [];
      for (const muid of cohort.mentee_uids) {
        const mentee = await User.findOne({ uid: muid }, 'name uid location grade');
        const last = await Session.findOne({ $or: [{ peer1: cohort.mentor_uid, peer2: muid }, { peer1: muid, peer2: cohort.mentor_uid }], status: 'completed' }).sort({ ended_at: -1 });
        const feedback = await AIFeedback.findOne({ student_uid: muid }).sort({ created_at: -1 });
        const days = last?.ended_at ? Math.floor((now - last.ended_at) / 86400000) : 999;
        const health = Math.max(0, Math.min(100, 100 - days * 10 + (feedback?.engagement_score || 0) * 5));
        totalHealth += health;
        menteeDetails.push({ uid: muid, name: mentee?.name, days_since_session: days === 999 ? null : days, engagement_score: feedback?.engagement_score || null, health: Math.round(health) });
      }
      result.push({
        cohort_id: cohort.cohort_id,
        mentor: { uid: mentor?.uid, name: mentor?.name, location: mentor?.location, is_alumni: mentor?.is_alumni, teaching_score: mentor?.teaching_score },
        mentee_count: cohort.mentee_uids.length,
        mentees: menteeDetails,
        cohort_health: cohort.mentee_uids.length > 0 ? Math.round(totalHealth / cohort.mentee_uids.length) : 0
      });
    }

    result.sort((a, b) => a.cohort_health - b.cohort_health); // Worst first
    res.json({ cohorts: result, total: result.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/coordinator/report
// Donor-ready impact report — "Our mentorship works"
// ─────────────────────────────────────────────────────────────────────────────
router.get('/report', coordAuth, async (req, res) => {
  try {
    await initDB();
    const { User, MentorCohort, Session, AIFeedback } = models;

    const [totalMentors, totalMentees, completedSessions, allFeedback, cohorts] = await Promise.all([
      User.countDocuments({ user_type: 'mentor' }),
      User.countDocuments({ user_type: 'mentee' }),
      Session.countDocuments({ status: 'completed' }),
      AIFeedback.find({}).sort({ created_at: -1 }),
      MentorCohort.find({ status: 'active' })
    ]);

    const assignedMentees = new Set();
    cohorts.forEach(c => c.mentee_uids.forEach(u => assignedMentees.add(u)));

    const avgClarity = allFeedback.length ? (allFeedback.reduce((s, f) => s + (f.clarity_score || 0), 0) / allFeedback.length).toFixed(1) : 0;
    const avgEngagement = allFeedback.length ? (allFeedback.reduce((s, f) => s + (f.engagement_score || 0), 0) / allFeedback.length).toFixed(1) : 0;
    const highEngagement = allFeedback.filter(f => (f.engagement_score || 0) >= 7).length;
    const improvingRate = allFeedback.length ? Math.round((highEngagement / allFeedback.length) * 100) : 0;

    res.json({
      report_title: 'Agaram Foundation — Mentorship Impact Report',
      generated_at: new Date().toISOString(),
      summary: {
        total_mentors: totalMentors,
        total_students: totalMentees,
        students_matched: assignedMentees.size,
        match_rate_pct: totalMentees > 0 ? Math.round((assignedMentees.size / totalMentees) * 100) : 0,
        active_cohorts: cohorts.length,
        sessions_completed: completedSessions,
        avg_session_clarity: parseFloat(avgClarity),
        avg_session_engagement: parseFloat(avgEngagement),
        students_improving_pct: improvingRate
      },
      donor_headline: `${assignedMentees.size} students are actively mentored. ${improvingRate}% show improving engagement scores across ${completedSessions} completed sessions.`
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
