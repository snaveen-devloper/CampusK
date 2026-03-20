const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { initDB, models } = require('../db');
const { User, Boost, Transaction, Report } = models;

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

router.get('/items', auth, async (req, res) => {
  res.json({
    items: [
      { id: 'boost', name: 'Visibility Boost', desc: 'Top of Discover for 24h', kp: 100, color: '#10b981', icon: '⚡' },
      { id: 'shield', name: 'Streak Shield', desc: 'Protect streak for 1 day', kp: 150, color: '#6366f1', icon: '🛡' },
      { id: 'xp2x', name: 'XP Double', desc: '2× XP for 24 hours', kp: 200, color: '#f59e0b', icon: '📈' },
      { id: 'priority', name: 'Priority Match', desc: 'Requests seen first', kp: 250, color: '#06b6d4', icon: '🎯' }
    ]
  });
});

router.post('/buy', auth, async (req, res) => {
  try {
    await initDB();
    const { item_id, item_name, kp } = req.body;
    if (!item_id || !kp) return res.status(400).json({ error: 'Missing logic' });

    const u = await User.findOne({ uid: req.user.uid });
    if (u.kp < kp) return res.status(400).json({ error: 'Not enough KP' });

    await User.updateOne({ uid: req.user.uid }, { $inc: { kp: -kp } });
    await Boost.updateOne(
        { uid: req.user.uid, item_id },
        { $set: { active: true, bought_at: Date.now() } },
        { upsert: true }
    );
    
    await Transaction.create({
      id: uuidv4(),
      uid: req.user.uid,
      icon: '🛍',
      description: `Bought ${item_name}`,
      amount: -kp,
      type: 'spend',
      ts: Date.now()
    });

    res.json({ success: true, kp_remaining: u.kp - kp });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/instant-kp', auth, async (req, res) => {
  try {
    await initDB();
    await User.updateOne({ uid: req.user.uid }, { $inc: { kp: 100 } });
    await Transaction.create({
      id: uuidv4(),
      uid: req.user.uid,
      icon: '⚡',
      description: `Instant KP Top-up`,
      amount: 100,
      type: 'earn',
      ts: Date.now()
    });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/report', auth, async (req, res) => {
  try {
    await initDB();
    const { target_uid, reason, detail } = req.body;
    if (!target_uid) return res.status(400).json({ error: 'No target specified' });

    await Report.create({
      id: uuidv4(),
      from_uid: req.user.uid,
      target_uid,
      reason,
      detail: detail || '',
      ts: Date.now()
    });

    const target = await User.findOneAndUpdate(
        { uid: target_uid },
        { $inc: { strikes: 1 } },
        { new: true }
    );
    
    if (target && target.strikes >= 3) {
      target.is_banned = true;
      await target.save();
    }
    
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
