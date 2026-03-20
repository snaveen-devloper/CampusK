const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { initDB, models } = require('../db');
const { StudyRoom, RoomMember, User } = models;
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

router.get('/', auth, async (req, res) => {
  try {
    await initDB();
    const rooms = await StudyRoom.find().sort({ created_at: -1 });
    res.json({ rooms });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/', auth, async (req, res) => {
  try {
    await initDB();
    const { subject, capacity } = req.body;
    const room = await StudyRoom.create({
      id: uuidv4(),
      code: Math.random().toString(36).substring(2, 8).toUpperCase(),
      host_uid: req.user.uid,
      subject,
      capacity: capacity || 4,
      created_at: Date.now()
    });

    await RoomMember.create({
      room_id: room.id,
      uid: req.user.uid,
      joined_at: Date.now()
    });

    res.status(201).json({ room });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/:id/join', auth, async (req, res) => {
  try {
    await initDB();
    const room = await StudyRoom.findOne({ id: req.params.id });
    if (!room) return res.status(404).json({ error: 'Room not found' });

    const memberCount = await RoomMember.countDocuments({ room_id: room.id });
    if (memberCount >= room.capacity) return res.status(400).json({ error: 'Room full' });

    await RoomMember.updateOne(
        { room_id: room.id, uid: req.user.uid },
        { $setOnInsert: { joined_at: Date.now() } },
        { upsert: true }
    );

    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
