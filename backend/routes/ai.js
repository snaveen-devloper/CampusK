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


// ─────────────────────────────────────────────────────────────────────────────
// BREAKTHROUGH 1: AI Technical Mentor Guidance
// Provides hyper-specialized mentoring advice that human volunteers cannot
// always offer (specific coding stacks, niche academic fields, career paths).
// ─────────────────────────────────────────────────────────────────────────────
router.post('/guidance', auth, async (req, res) => {
  try {
    const { question, subject, career_goal, grade, language = 'en' } = req.body;
    if (!question) return res.status(400).json({ error: 'question is required' });

    await initDB();

    // Fallback response when no API key
    const fallback = () => res.json({
      guidance: `Great question about "${subject || question}"! As a mentor, I'd suggest breaking this topic into smaller chunks. Start with the fundamentals and build up. Don't hesitate to ask your human mentor for more specific examples from their experience.`,
      resources: [],
      next_steps: ['Practice this concept with a small example', 'Discuss with your mentor in your next session'],
      source: 'fallback'
    });

    if (!process.env.ANTHROPIC_API_KEY) return fallback();

    const systemPrompt = `You are an expert AI Technical Mentor helping a first-generation student from a rural background in Tamil Nadu, India. 
You are part of the Agaram Foundation's mentorship platform.
The student's grade/level: ${grade || 'college level'}
Their career goal: ${career_goal || 'not specified'}
Subject area: ${subject || 'general'}
Respond in simple, encouraging language. If the student prefers Tamil, switch to Tamil. Keep answers concise, practical, and motivating.`;

    const userPrompt = `My question: ${question}
Please give me:
1. A clear direct answer
2. 2-3 practical next steps I can take this week
3. 1-2 free online resources (real websites only)
Respond as JSON: { "guidance": "...", "next_steps": ["..."], "resources": [{"title":"...","url":"..."}] }`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-3-haiku-20240307',
        max_tokens: 600,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }]
      })
    });

    const data = await response.json();
    let text = data.content?.[0]?.text || '';
    text = text.replace(/```json/g, '').replace(/```/g, '').trim();

    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = { guidance: text, next_steps: [], resources: [] }; }

    // Log the interaction for engagement tracking
    await AIFeedback.create({
      id: uuidv4(),
      session_id: 'ai_mentor_' + uuidv4(),
      teacher_uid: 'ai_mentor',
      student_uid: req.user.uid,
      clarity_score: 9.0,
      engagement_score: 9.0,
      feedback_text: JSON.stringify({ question, guidance: parsed.guidance }),
      rep_delta: 0,
      created_at: Date.now()
    });

    res.json({ ...parsed, source: 'claude' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// BREAKTHROUGH 1b: AI Career Path Generator
// Generates a personalized career roadmap based on student interests + grade
// ─────────────────────────────────────────────────────────────────────────────
router.post('/career-path', auth, async (req, res) => {
  try {
    const { interests, grade, current_subjects } = req.body;
    if (!interests) return res.status(400).json({ error: 'interests required' });

    const fallback = {
      career_paths: [
        { title: 'Software Engineer', match_score: 85, roadmap: ['Learn core CS fundamentals', 'Pick one programming language', 'Build 2-3 projects', 'Apply for internships'] },
        { title: 'Data Analyst', match_score: 75, roadmap: ['Learn Excel, SQL basics', 'Study statistics', 'Learn Python/R', 'Get certified'] }
      ],
      recommended_subjects: current_subjects || [],
      mentor_suggestion: 'Discuss these paths with your human mentor to understand real-world fit.'
    };

    if (!process.env.ANTHROPIC_API_KEY) return res.json(fallback);

    const prompt = `A student (grade: ${grade || 'college'}) is interested in: ${interests}.
Their current subjects: ${current_subjects?.join(', ') || 'not specified'}.
They are a first-generation learner from rural Tamil Nadu.

Generate a career path analysis as JSON:
{
  "career_paths": [{ "title": "...", "match_score": 0-100, "roadmap": ["step1","step2","step3","step4"] }],
  "recommended_subjects": ["..."],
  "mentor_suggestion": "..."
}
Provide 2-3 realistic career paths. Keep steps simple and achievable.`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-3-haiku-20240307', max_tokens: 700, messages: [{ role: 'user', content: prompt }] })
    });

    const data = await response.json();
    let text = (data.content?.[0]?.text || '').replace(/```json/g, '').replace(/```/g, '').trim();
    try { res.json(JSON.parse(text)); } catch { res.json(fallback); }

  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// BREAKTHROUGH 3: Mentorship Health Score (per cohort)
// Returns an "engagement health" score for a mentor's full cohort
// ─────────────────────────────────────────────────────────────────────────────
router.get('/mentor-health', auth, async (req, res) => {
  try {
    await initDB();
    const MentorCohort = require('../models/MentorCohort');

    const cohort = await MentorCohort.findOne({ mentor_uid: req.user.uid, status: 'active' });
    if (!cohort) return res.json({ health_score: 0, at_risk_mentees: [], message: 'No active cohort found.' });

    const now = Date.now();
    const DORMANT_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

    const atRisk = [];
    let totalScore = 0;

    for (const menteeUid of cohort.mentee_uids) {
      const lastSession = await Session.findOne({
        $or: [{ peer1: menteeUid, peer2: req.user.uid }, { peer1: req.user.uid, peer2: menteeUid }],
        status: { $in: ['completed', 'live'] }
      }).sort({ ended_at: -1 });

      const lastAIFeedback = await AIFeedback.findOne({ student_uid: menteeUid }).sort({ created_at: -1 });

      const daysSinceSession = lastSession?.ended_at
        ? Math.floor((now - lastSession.ended_at) / (1000 * 60 * 60 * 24))
        : 999;

      const engagementScore = lastAIFeedback?.engagement_score || 0;
      const menteeHealth = Math.max(0, 100 - (daysSinceSession * 10) + (engagementScore * 5));

      totalScore += menteeHealth;
      if (daysSinceSession > 7 || engagementScore < 4) {
        atRisk.push({ uid: menteeUid, days_since_session: daysSinceSession, engagement_score: engagementScore, health: Math.round(menteeHealth) });
      }
    }

    const cohortHealthScore = cohort.mentee_uids.length > 0
      ? Math.min(100, Math.round(totalScore / cohort.mentee_uids.length))
      : 0;

    res.json({
      health_score: cohortHealthScore,
      total_mentees: cohort.mentee_uids.length,
      at_risk_mentees: atRisk,
      status: cohortHealthScore >= 70 ? 'healthy' : cohortHealthScore >= 40 ? 'needs_attention' : 'critical'
    });

  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;

