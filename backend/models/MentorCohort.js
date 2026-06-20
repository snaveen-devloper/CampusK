const mongoose = require('mongoose');

/**
 * MentorCohort
 * 
 * Agaram Foundation Model: 1 Mentor guides a persistent group of 5-8 Mentees.
 * The mentor acts as an "Anna" or "Akka" (steady presence) for this specific cohort.
 * All subsequent 1-on-1 sessions are deeply tied to this cohort relationship.
 */
const mentorCohortSchema = new mongoose.Schema({
  cohort_id: { type: String, unique: true, required: true },
  mentor_uid: { type: String, required: true, ref: 'User' },
  mentee_uids: [{ type: String, ref: 'User' }], // Up to max_mentees (usually 8)
  program_type: { type: String, enum: ['vidhai', 'vazhikatigal', 'general'], default: 'general' },
  
  // Analytics at a glance for the mentor
  total_sessions_conducted: { type: Number, default: 0 },
  average_quiz_score: { type: Number, default: 0 },
  
  status: { type: String, enum: ['active', 'graduated', 'archived'], default: 'active' },
  created_at: { type: Number, default: Date.now }
}, {
  timestamps: true
});

module.exports = mongoose.model('MentorCohort', mentorCohortSchema);
