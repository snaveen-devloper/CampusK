const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const fetch = require('node-fetch');
const { initDB, models } = require('../db');
const { Session, User, AIFeedback, Note } = models;

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

router.post('/analyze', auth, async (req, res) => {
  try {
    const { session_id, subject, pulse_checks_total, pulse_checks_correct, transcript } = req.body;
    if (!session_id || !subject) return res.status(400).json({ error: 'Missing session data' });

    await initDB();
    const sess = await Session.findOne({ id: session_id });
    if (!sess) return res.status(404).json({ error: 'Session not found' });

    const teacherUid = sess.role1 === 'teach' ? sess.peer1 : sess.peer2;
    const studentUid = sess.role1 === 'teach' ? sess.peer2 : sess.peer1;

    let clarity = 5.0, engagement = 5.0, feedback = "Session completed. Keep practicing!", repDelta = 0;
    let aiNotes = "";

    if (!process.env.ANTHROPIC_API_KEY) {
      if (pulse_checks_total > 0) {
        engagement = (pulse_checks_correct / pulse_checks_total) * 10;
        clarity = engagement >= 5 ? 8.5 : 4.0;
        feedback = `Student answered ${pulse_checks_correct} out of ${pulse_checks_total} pulse checks correctly.`;
        repDelta = engagement >= 5 ? 0.2 : -0.1;
      } else {
        clarity = 7.0; engagement = 6.0;
        feedback = "Good session, but try using Pulse Checks next time to verify understanding.";
        repDelta = 0.1;
      }
    } else {
      let prompt = `Analyze a teaching session on "${subject}"...`; // (Keep prompt same)

      try {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': process.env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json'
          },
          body: JSON.stringify({
            model: 'claude-3-haiku-20240307',
            max_tokens: 400,
            messages: [{ role: 'user', content: prompt }]
          })
        });

        const data = await response.json();
        
        if (!response.ok) {
          console.error("Claude API Error:", data);
          throw new Error(data.error?.message || "Claude API request failed");
        }

        let text = data.content?.[0]?.text;
        if (!text) {
          console.error("Claude API returned empty content:", data);
          throw new Error("No content in Claude response");
        }

        // Claude often wraps JSON in markdown code blocks: ```json { ... } ```
        // We need to strip those out before parsing.
        text = text.replace(/```json/g, '').replace(/```/g, '').trim();

        let resJson;
        try {
          resJson = JSON.parse(text);
        } catch (pe) {
          console.error("Failed to parse Claude JSON. Raw text:", text);
          throw pe;
        }

        clarity = parseFloat(resJson.clarity_score) || 7.0;
        engagement = parseFloat(resJson.engagement_score) || 7.0;
        feedback = JSON.stringify({ summary: resJson.feedback_text, suggestions: resJson.suggestions || [] });
        aiNotes = resJson.learning_notes || "";

        repDelta = (clarity > 7 && engagement > 7) ? 0.3 : (clarity < 5 ? -0.2 : 0.1);

        if (resJson.safety_audit && resJson.safety_audit.is_safe === false) {
          await User.updateMany({ $or: [{ uid: teacherUid }, { uid: studentUid }] }, { $inc: { strikes: 1 } });
        }

      } catch (err) {
        console.error("Claude Analyze failed:", err.message);
      }
    }

    await AIFeedback.create({
      id: uuidv4(),
      session_id,
      teacher_uid: teacherUid,
      student_uid: studentUid,
      clarity_score: clarity,
      engagement_score: engagement,
      feedback_text: feedback,
      rep_delta: repDelta,
      created_at: Date.now()
    });

    if (aiNotes) {
      await Note.create({
        id: uuidv4(),
        session_id,
        author_uid: teacherUid,
        title: `AI Notes: ${subject}`,
        content: aiNotes,
        is_public: false,
        ts: Date.now()
      });
    }

    const t = await User.findOne({ uid: teacherUid });
    const oldScore = t.teaching_score || 0;
    const count = t.sess_count || 1;
    let newScore = oldScore === 0 ? clarity : ((oldScore * (count - 1)) + clarity) / count;
    let newRep = (t.rep_score || 0) + repDelta;
    if (newRep < 0) newRep = 0;
    if (newScore > 10) newScore = 10;

    await User.updateOne({ uid: teacherUid }, { $set: { teaching_score: newScore, rep_score: newRep } });

    res.json({ success: true, clarity, engagement, repDelta });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/my-score', auth, async (req, res) => {
  try {
    await initDB();
    const u = await User.findOne({ uid: req.user.uid }, 'teaching_score rep_score');
    const feedbacks = await AIFeedback.find({ teacher_uid: req.user.uid })
      .sort({ created_at: -1 })
      .limit(5);

    res.json({
      teaching_score: u.teaching_score,
      rep_score: u.rep_score,
      recent_feedback: feedbacks
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
