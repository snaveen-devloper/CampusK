const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { initDB, models } = require('../db');
const { QuizQuestion, QuizAnswer, Session, User } = models;
const { v4: uuidv4 } = require('uuid');
const fetch = require('node-fetch');

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

router.get('/session/:sessionId', auth, async (req, res) => {
  try {
    await initDB();
    const questions = await QuizQuestion.find({ session_id: req.params.sessionId });
    res.json({ questions });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/question', auth, async (req, res) => {
  try {
    await initDB();
    const { session_id, question, options, correct_index } = req.body;
    const q = await QuizQuestion.create({
      id: uuidv4(),
      session_id,
      question,
      options,
      correct_index,
      asked_at: Date.now()
    });
    res.status(201).json({ question: q });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

function makeFallbackQuestions(subject, count = 3) {
  return Array.from({ length: count }, (_, i) => ({
    id: uuidv4(),
    question: `Quick check ${i + 1}: Key concept about "${subject}"?`,
    options: ['Option A', 'Option B', 'Option C', 'Option D'],
    correct_index: 0,
  }));
}

async function generateQuizQuestions(subject, count = 3) {
  if (!process.env.ANTHROPIC_API_KEY) return makeFallbackQuestions(subject, count);

  try {
    const prompt = `Generate ${count} multiple-choice quiz questions on the subject "${subject}" for a peer tutoring session.
Return valid JSON array: [{ "question": "...", "options": ["A","B","C","D"], "correct_index": 0 }]
Keep questions concise and test genuine understanding. No markdown, just the JSON array.`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-3-haiku-20240307',
        max_tokens: 800,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const data = await response.json();
    let text = data.content?.[0]?.text || '[]';
    // Claude sometimes returns JSON wrapped in markdown fences.
    text = text.replace(/```json/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(text);
    return parsed.map(q => ({
      id: uuidv4(),
      question: q.question,
      options: q.options,
      correct_index: q.correct_index,
    }));
  } catch {
    return makeFallbackQuestions(subject, count);
  }
}

// Generate a fresh set of questions for a session.
// Frontend expects `options` to be a JSON string (because it does JSON.parse(q.options)).
router.post('/generate', auth, async (req, res) => {
  try {
    await initDB();
    const { session_id, subject, question_count = 3 } = req.body;
    if (!session_id || !subject) return res.status(400).json({ error: 'session_id and subject are required' });

    // Replace any previous question set for this session, so "all_correct" logic is reliable.
    await QuizQuestion.deleteMany({ session_id });

    const questions = await generateQuizQuestions(subject, question_count);

    // Persist (overwrite by session is handled by caller re-generating new ids).
    const stored = [];
    for (const q of questions) {
      const doc = await QuizQuestion.create({
        id: q.id,
        session_id,
        question: q.question,
        options: q.options,
        correct_index: q.correct_index,
        asked_at: Date.now(),
      });
      stored.push(doc);
    }

    res.json({
      questions: stored.map(q => ({
        id: q.id,
        session_id: q.session_id,
        question: q.question,
        // Keep as JSON string for existing frontend parsing.
        options: JSON.stringify(q.options),
        correct_index: q.correct_index,
      })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Mark a question as "pushed/asked" for the frontend (no scoring here).
router.post('/push', auth, async (req, res) => {
  try {
    await initDB();
    const { question_id } = req.body;
    if (!question_id) return res.status(400).json({ error: 'question_id is required' });

    const q = await QuizQuestion.findOne({ id: question_id });
    if (!q) return res.status(404).json({ error: 'Question not found' });

    await QuizQuestion.updateOne({ id: question_id }, { $set: { asked_at: Date.now() } });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/answer', auth, async (req, res) => {
  try {
    await initDB();
    const { question_id, answer_index, teacher_uid } = req.body;
    const q = await QuizQuestion.findOne({ id: question_id });
    if (!q) return res.status(404).json({ error: 'Question not found' });

    const is_correct = answer_index === q.correct_index;
    const studentUid = req.user.uid;

    // Prevent obvious duplicate scoring attempts for REST fallback:
    // If a student already answered this question, just return correctness/all_correct.
    // (WS path should already be the primary scorer.)
    const existing = await QuizAnswer.findOne({ question_id: question_id, student_uid: studentUid });
    if (existing) {
      const allQs = await QuizQuestion.find({ session_id: q.session_id });
      const qIds = allQs.map(x => x.id);
      const answers = await QuizAnswer.find({ question_id: { $in: qIds }, student_uid: studentUid });
      const all_answered = answers.length === qIds.length;
      const all_correct = all_answered && answers.every(a => a.is_correct);
      return res.json({ is_correct, all_correct, existing: true });
    }

    const answer = await QuizAnswer.create({
      id: uuidv4(),
      question_id,
      student_uid: studentUid,
      answer_index,
      is_correct,
      answered_at: Date.now()
    });

    // Determine if student has mastered the whole set.
    const allQs = await QuizQuestion.find({ session_id: q.session_id });
    const qIds = allQs.map(x => x.id);
    const answers = await QuizAnswer.find({ question_id: { $in: qIds }, student_uid: studentUid });
    const all_answered = answers.length === qIds.length;
    const all_correct = all_answered && answers.every(a => a.is_correct);

    // REST fallback scoring (used only if WS isn't open on the frontend).
    const xp_earned = is_correct ? (all_correct ? 60 : 10) : 0;
    const kp_bonus = is_correct && teacher_uid ? 5 : 0;
    if (xp_earned) await User.updateOne({ uid: studentUid }, { $inc: { xp: xp_earned } });
    if (kp_bonus) await User.updateOne({ uid: teacher_uid }, { $inc: { kp: kp_bonus } });

    res.status(201).json({ answer, is_correct, all_correct, xp_earned, kp_bonus });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
