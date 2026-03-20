const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { initDB, models } = require('../db');
const { Attachment } = models;
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (req, file, cb) => {
    cb(null, 'file_' + Date.now() + path.extname(file.originalname));
  }
});
const upload = multer({ storage });

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
    const files = await Attachment.find({ uploader_uid: req.user.uid }).sort({ ts: -1 });
    res.json({ files });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/upload', auth, upload.single('file'), async (req, res) => {
  try {
    await initDB();
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const file = await Attachment.create({
      id: uuidv4(),
      uploader_uid: req.user.uid,
      filename: req.file.filename,
      original_name: req.file.originalname,
      url: `/uploads/${req.file.filename}`,
      size: req.file.size,
      mime: req.file.mimetype,
      ts: Date.now()
    });

    res.status(201).json({ file });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
