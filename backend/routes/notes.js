const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { initDB, models } = require('../db');
const { Note, User } = models;
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
    const notes = await Note.find({
      $or: [{ author_uid: req.user.uid }, { is_public: true }]
    }).sort({ ts: -1 }).lean();

    // Enrich with author names
    const uids = [...new Set(notes.map(n => n.author_uid))];
    const users = await User.find({ uid: { $in: uids } }, 'uid name').lean();
    const userMap = {};
    users.forEach(u => { userMap[u.uid] = u.name; });
    notes.forEach(n => { n.author_name = userMap[n.author_uid] || 'Unknown'; });

    res.json({ notes });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/', auth, async (req, res) => {
  try {
    await initDB();
    const { title, content, is_public, session_id, attachment_url, attachment_name, attachment_mime } = req.body;
    const note = await Note.create({
      id: uuidv4(),
      author_uid: req.user.uid,
      title,
      content,
      is_public: !!is_public,
      session_id: session_id || null,
      attachment_url: attachment_url || null,
      attachment_name: attachment_name || null,
      attachment_mime: attachment_mime || null,
      ts: Date.now()
    });
    res.status(201).json({ note });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.patch('/:id', auth, async (req, res) => {
  try {
    await initDB();
    const note = await Note.findOne({ id: req.params.id });
    if (!note) return res.status(404).json({ error: 'Note not found' });
    if (note.author_uid !== req.user.uid) return res.status(403).json({ error: 'Unauthorized' });

    const { title, content, is_public, attachment_url, attachment_name, attachment_mime } = req.body;
    const update = {};
    if (title !== undefined) update.title = title;
    if (content !== undefined) update.content = content;
    if (is_public !== undefined) update.is_public = !!is_public;
    if (attachment_url !== undefined) update.attachment_url = attachment_url;
    if (attachment_name !== undefined) update.attachment_name = attachment_name;
    if (attachment_mime !== undefined) update.attachment_mime = attachment_mime;

    await Note.updateOne({ id: req.params.id }, { $set: update });
    const updated = await Note.findOne({ id: req.params.id });
    res.json({ note: updated });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/:id/fork', auth, async (req, res) => {
  try {
    await initDB();
    const orig = await Note.findOne({ id: req.params.id, is_public: true });
    if (!orig) return res.status(404).json({ error: 'Note not found or not public' });

    const forked = await Note.create({
      id: uuidv4(),
      author_uid: req.user.uid,
      title: `[Fork] ${orig.title}`,
      content: orig.content,
      is_public: false,
      session_id: null,
      attachment_url: orig.attachment_url || null,
      attachment_name: orig.attachment_name || null,
      attachment_mime: orig.attachment_mime || null,
      ts: Date.now()
    });
    await Note.updateOne({ id: orig.id }, { $inc: { forks: 1 } });
    res.status(201).json({ note: forked });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', auth, async (req, res) => {
  try {
    await initDB();
    const note = await Note.findOne({ id: req.params.id });
    if (!note) return res.status(404).json({ error: 'Note not found' });
    if (note.author_uid !== req.user.uid) return res.status(403).json({ error: 'Unauthorized' });

    await Note.deleteOne({ id: req.params.id });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
