const mongoose = require('mongoose');

const aiFeedbackSchema = new mongoose.Schema({
  id: { type: String, primaryKey: true, unique: true, required: true },
  session_id: { type: String, required: true, ref: 'Session' },
  teacher_uid: { type: String, required: true, ref: 'User' },
  student_uid: { type: String, required: true, ref: 'User' },
  clarity_score: { type: Number, required: true },
  engagement_score: { type: Number, required: true },
  feedback_text: { type: String, required: true },
  rep_delta: { type: Number, default: 0 },
  created_at: { type: Number, required: true, default: Date.now }
}, {
  timestamps: true
});

module.exports = mongoose.model('AIFeedback', aiFeedbackSchema);
