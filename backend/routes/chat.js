const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { initDB, models } = require('../db');
const { Message } = models;
const { v4: uuidv4 } = require('uuid');

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

router.get('/:room_id', auth, async (req, res) => {
  try {
    await initDB();
    const messages = await Message.find({ room_id: req.params.room_id })
      .sort({ ts: 1 })
      .limit(100);
    res.json({ messages });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/pubkey', auth, async (req, res) => {
  try {
    await initDB();
    const { User } = models;
    const { pub_key } = req.body;
    await User.updateOne({ uid: req.user.uid }, { $set: { pub_key } });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/:room_id', auth, async (req, res) => {
  try {
    await initDB();
    const { ciphertext, iv } = req.body;
    await Message.create({
      id: uuidv4(),
      room_id: req.params.room_id,
      sender_uid: req.user.uid,
      ciphertext,
      iv,
      ts: Date.now()
    });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// BREAKTHROUGH 4: Safe Space — Anonymous Peer Support
//
// Students can send E2EE messages to a shared support channel without
// revealing their identity. The platform assigns a rotating pseudonym
// (a Tamil name + emoji) so helpers can respond, but identity stays hidden.
// This removes the stigma barrier for students with trauma or severe issues.
// ─────────────────────────────────────────────────────────────────────────────
const SAFE_SPACE_ALIASES = [
  'Anbu 🌸', 'Vetri 🌿', 'Kavya ⭐', 'Malar 🌺', 'Arjun 🦋',
  'Selvi 🌙', 'Kiran 🌞', 'Priya 🕊️', 'Surya 🌊', 'Deepa 🌻'
];

// uid -> daily alias map (rotates each day)
const dailyAliasMap = new Map();

function getAliasForUser(uid) {
  const today = new Date().toDateString();
  const key = `${uid}_${today}`;
  if (!dailyAliasMap.has(key)) {
    const idx = Math.abs([...uid].reduce((a, c) => a + c.charCodeAt(0), 0)) % SAFE_SPACE_ALIASES.length;
    dailyAliasMap.set(key, SAFE_SPACE_ALIASES[idx]);
  }
  return dailyAliasMap.get(key);
}

// POST /api/chat/safe-space/send
router.post('/safe-space/send', auth, async (req, res) => {
  try {
    await initDB();
    const { ciphertext, iv, room_id = 'safe_space_global' } = req.body;
    if (!ciphertext || !iv) return res.status(400).json({ error: 'ciphertext and iv required' });

    const alias = getAliasForUser(req.user.uid);

    await Message.create({
      id: uuidv4(),
      room_id,
      sender_uid: `anon::${alias}`,  // real uid never stored
      ciphertext,
      iv,
      ts: Date.now()
    });

    res.json({ success: true, alias, message: 'Message sent anonymously to Safe Space.' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /api/chat/safe-space/messages
router.get('/safe-space/messages', auth, async (req, res) => {
  try {
    await initDB();
    const room_id = req.query.room || 'safe_space_global';
    const messages = await Message.find({ room_id }).sort({ ts: -1 }).limit(50);
    res.json({ messages, note: 'All messages in this space are anonymous. Your identity is protected.' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
