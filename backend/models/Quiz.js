const mongoose = require('mongoose');

const quizQuestionSchema = new mongoose.Schema({
  id: { type: String, primaryKey: true, unique: true, required: true },
  session_id: { type: String, required: true, ref: 'Session' },
  question: { type: String, required: true },
  options: { type: [String], required: true },
  correct_index: { type: Number, required: true },
  asked_at: { type: Number }
});

const quizAnswerSchema = new mongoose.Schema({
  id: { type: String, primaryKey: true, unique: true, required: true },
  question_id: { type: String, required: true, ref: 'QuizQuestion' },
  student_uid: { type: String, required: true, ref: 'User' },
  answer_index: { type: Number, required: true },
  is_correct: { type: Boolean, required: true },
  answered_at: { type: Number, required: true, default: Date.now }
});

module.exports = {
  QuizQuestion: mongoose.model('QuizQuestion', quizQuestionSchema),
  QuizAnswer: mongoose.model('QuizAnswer', quizAnswerSchema)
};
