const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { initDB, models } = require('../db');
const { Request, User, Activity } = models;
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
    const requests = await Request.find({
      $or: [{ from_uid: req.user.uid }, { to_uid: req.user.uid }]
    }).sort({ ts: -1 });
    res.json({ requests });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/', auth, async (req, res) => {
  try {
    await initDB();
    const { to_uid, subject, note } = req.body;
    if (!to_uid || !subject) return res.status(400).json({ error: 'To UID and subject required' });

    const newRequest = await Request.create({
      id: uuidv4(),
      from_uid: req.user.uid,
      to_uid,
      subject,
      note: note || '',
      ts: Date.now()
    });

    await Activity.create({
      id: uuidv4(),
      msg: `New help request for ${subject}`,
      type: 'request',
      ts: Date.now()
    });

    res.status(201).json({ request: newRequest });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.patch('/:id', auth, async (req, res) => {
  try {
    await initDB();
    const { status } = req.body;
    if (!status) return res.status(400).json({ error: 'Status required' });

    const request = await Request.findOne({ id: req.params.id });
    if (!request) return res.status(404).json({ error: 'Request not found' });
    if (request.to_uid !== req.user.uid) return res.status(403).json({ error: 'Unauthorized' });

    request.status = status;
    await request.save();

    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
