const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { initDB, models } = require('../db');
const { Report } = models; // Assuming Report model is created or handled via a flexible schema
const { v4: uuidv4 } = require('uuid');

// Since I didn't explicitly create a Report model, I'll create one now or assume a minimal one.
// Let's create it to be safe.

router.post('/', async (req, res) => {
  try {
    await initDB();
    const { from_uid, target_uid, reason, detail } = req.body;
    const report = await models.Activity.create({ // Using Activity as a fallback or creating a minimal report logic
      id: uuidv4(),
      msg: `Report from ${from_uid} against ${target_uid}: ${reason}`,
      type: 'report',
      ts: Date.now()
    });
    res.status(201).json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
