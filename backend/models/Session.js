const mongoose = require('mongoose');

const sessionSchema = new mongoose.Schema({
  id: { type: String, unique: true, required: true },
  peer1: { type: String, required: true, ref: 'User' },
  peer2: { type: String, default: null, ref: 'User' }, // null until student joins
  subject: { type: String, required: true },
  date: { type: String, required: true },
  time: { type: String, required: true },
  status: { type: String, default: 'upcoming' }, // upcoming | active | completed | ended
  room_code: { type: String, required: true },
  role1: { type: String, default: 'teach' },
  rated: { type: Boolean, default: false },
  rating: { type: Number, default: 0 },
  booked_at: { type: Number, required: true, default: Date.now },
  mastery_bonus: { type: Number, default: 0 },
  reminder_30_sent: { type: Boolean, default: false },
  reminder_5_sent: { type: Boolean, default: false },
  timezone: { type: String, default: 'Asia/Kolkata' },
  // Skill session fields
  type: { type: String, enum: ['regular', 'skill'], default: 'regular' },
  joined_at: { type: Number, default: null },
  ended_at: { type: Number, default: null },
  ai_validated: { type: Boolean, default: false },
  loop_id: { type: String, default: null } // matches users from a karma loop
}, {
  timestamps: true
});

module.exports = mongoose.model('Session', sessionSchema);
