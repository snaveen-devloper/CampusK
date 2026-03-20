const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { initDB, models } = require('../db');
const { User, Session, Transaction, QuizAnswer, Request, Activity, Boost, Quest } = models;
const { v4: uuidv4 } = require('uuid');
const { detectLoops, invalidateLoopCache } = require('./loops');

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

router.get('/', auth, async (req, res) => {
  try {
    await initDB();
    const users = await User.find({ is_banned: false }, 'uid name school cls level kp teaching_score rep_score native_lang subjects color');
    res.json({ users });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/online', auth, (req, res) => {
  const clients = req.app.locals.wsClients || new Map();
  res.json({ count: clients.size, uids: [...clients.keys()] });
});

router.get('/me/analytics', auth, async (req, res) => {
  try {
    await initDB();
    const uid = req.user.uid;
    const now = Date.now();
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;

    const recentSess = await Session.find({
      $or: [{ peer1: uid }, { peer2: uid }],
      booked_at: { $gt: weekAgo },
      status: 'completed'
    });
    const sessThisWeek = recentSess.length;

    const txns = await Transaction.find({ uid, ts: { $gt: weekAgo } });
    const kpEarned = txns.filter(t => t.type === 'earn').reduce((s, t) => s + t.amount, 0);
    const kpSpent  = Math.abs(txns.filter(t => t.type === 'spend').reduce((s, t) => s + t.amount, 0));

    const taught = recentSess.filter(s => (s.role1 === 'teach' && s.peer1 === uid) || (s.role1 === 'learn' && s.peer2 === uid));
    const subjectCount = {};
    taught.forEach(s => { subjectCount[s.subject] = (subjectCount[s.subject] || 0) + 1; });
    const topSubjects = Object.entries(subjectCount).sort((a, b) => b[1] - a[1]).slice(0, 4);

    const allAnswers = await QuizAnswer.find({ student_uid: uid });
    const totalQ = allAnswers.length;
    const correctQ = allAnswers.filter(a => a.is_correct).length;
    const quizAccuracy = totalQ > 0 ? Math.round((correctQ / totalQ) * 100) : null;

    res.json({ sessThisWeek, kpEarned, kpSpent, topSubjects, quizAccuracy, totalQuizzes: totalQ });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/leaderboard', auth, async (req, res) => {
  try {
    await initDB();
    const users = await User.find({ is_banned: false }, 'uid name school kp level color')
      .sort({ kp: -1 })
      .limit(20);
    res.json({ leaderboard: users });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/:uid', auth, async (req, res) => {
  try {
    await initDB();
    const user = await User.findOne({ uid: req.params.uid }, '-password_hash');
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.patch('/me', auth, async (req, res) => {
  try {
    await initDB();
    const { subjects, name, school, cls, native_lang, is_new } = req.body;
    const update = {};
    if (subjects) update.subjects = subjects;
    if (name) update.name = name;
    if (school) update.school = school;
    if (cls) update.cls = cls;
    if (native_lang) update.native_lang = native_lang;
    if (is_new !== undefined) update.is_new = !!is_new;

    await User.updateOne({ uid: req.user.uid }, { $set: update });

    // If subjects changed, invalidate loop cache and notify affected users
    if (subjects) {
      try {
        invalidateLoopCache(req.app);
        // Recompute and push WS notifications to all users whose loop set changed
        const { loops } = await detectLoops(req.app);
        const clients = req.app.locals.wsClients || new Map();
        for (const loop of loops) {
          for (const member of loop.members) {
            const ws = clients.get(member.uid);
            if (ws && ws.readyState === 1) {
              ws.send(JSON.stringify({ type: 'loop_discovered', loop }));
            }
          }
        }
      } catch (loopErr) {
        console.error('[users] Loop re-detection error:', loopErr.message);
      }
    }

    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/:uid/pubkey', auth, async (req, res) => {
  try {
    await initDB();
    const { User } = models;
    const user = await User.findOne({ uid: req.params.uid }, 'pub_key');
    res.json({ pub_key: user ? user.pub_key : null });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/me/transactions', auth, async (req, res) => {
  try {
    await initDB();
    const txns = await Transaction.find({ uid: req.user.uid }).sort({ ts: -1 }).limit(50);
    res.json({ transactions: txns });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/me/boosts', auth, async (req, res) => {
  try {
    await initDB();
    const rows = await Boost.find({ uid: req.user.uid, active: true });
    const boosts = {};
    rows.forEach(r => { boosts[r.item_id] = true; });
    res.json({ boosts });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/me/quests', auth, async (req, res) => {
  try {
    await initDB();
    const today = new Date().toISOString().split('T')[0];
    let q = await Quest.findOne({ uid: req.user.uid });
    if (q && q.date === today) {
      res.json({ quests: { date: q.date, progress: q.progress } });
    } else {
      res.json({ quests: null });
    }
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.put('/me/quests', auth, async (req, res) => {
  try {
    await initDB();
    const { date, progress } = req.body;
    await Quest.updateOne(
        { uid: req.user.uid },
        { $set: { date, progress } },
        { upsert: true }
    );
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/:uid/endorse', auth, async (req, res) => {
  // Original logic was in users.js:195
  try {
    await initDB();
    const fromUid = req.user.uid;
    const targetUid = req.params.uid;
    if (fromUid === targetUid) return res.status(400).json({ error: 'Cannot endorse yourself' });

    const conn = await Request.findOne({
      $or: [
        { from_uid: fromUid, to_uid: targetUid, status: 'accepted' },
        { from_uid: targetUid, to_uid: fromUid, status: 'accepted' }
      ]
    });
    if (!conn) return res.status(403).json({ error: 'Must be connected to endorse' });

    await Transaction.create({
      id: uuidv4(),
      uid: targetUid,
      icon: 'star',
      description: `Endorsement from ${req.user.name}`,
      amount: 50,
      type: 'earn',
      ts: Date.now()
    });
    
    // Recalculate Reputation Graph
    await recalculateReputation();
    
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

async function recalculateReputation() {
  const users = await User.find({}, 'uid rep_score');
  const endorsements = await Request.find({ status: 'accepted' }, 'from_uid to_uid');
  
  let scores = {};
  users.forEach(u => scores[u.uid] = 1.0);

  for (let i = 0; i < 3; i++) {
    let newScores = {};
    users.forEach(u => newScores[u.uid] = 1.0);

    endorsements.forEach(e => {
      newScores[e.to_uid] += (scores[e.from_uid] * 0.15);
      newScores[e.from_uid] += (scores[e.to_uid] * 0.15);
    });

    scores = newScores;
  }

  for (const uid in scores) {
    await User.updateOne({ uid }, { $set: { rep_score: scores[uid] } });
  }
}

router.get('/vapid-key', (req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY || '' });
});

router.post('/push-subscribe', auth, async (req, res) => {
  try {
    await initDB();
    const { PushSubscription } = models;
    const { subscription } = req.body;
    if (!subscription) return res.status(400).json({ error: 'Subscription missing' });
    
    await PushSubscription.updateOne(
      { uid: req.user.uid },
      { $set: { subscription: typeof subscription === 'string' ? JSON.parse(subscription) : subscription, created_at: Date.now() } },
      { upsert: true }
    );
    res.json({ success: true, publicKey: process.env.VAPID_PUBLIC_KEY });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/push-subscribe', auth, async (req, res) => {
  try {
    await initDB();
    const { PushSubscription } = models;
    await PushSubscription.deleteOne({ uid: req.user.uid });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
