const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { initDB, models } = require('../db');
const { Message } = models;

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
    const { v4: uuidv4 } = require('uuid');
    
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

module.exports = router;
