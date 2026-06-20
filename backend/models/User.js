const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  uid: { type: String, primaryKey: true, unique: true, required: true },
  name: { type: String, required: true },
  email: { type: String, unique: true, required: true },
  password_hash: { type: String, required: true },
  school: { type: String, required: true },
  cls: { type: String, default: 'General' },
  kp: { type: Number, default: 100 },
  xp: { type: Number, default: 20 },
  streak: { type: Number, default: 0 },
  last_active: { type: String, default: '' },
  subjects: { type: mongoose.Schema.Types.Mixed, default: [] },
  level: { type: Number, default: 1 },
  ratings: { type: [Object], default: [] }, // Array of rating objects
  sess_count: { type: Number, default: 0 },
  strikes: { type: Number, default: 0 },
  is_banned: { type: Boolean, default: false },
  is_new: { type: Boolean, default: true },
  color: { type: String, default: '#10b981' },
  pub_key: { type: String, default: '' },
  teaching_score: { type: Number, default: 0 },
  rep_score: { type: Number, default: 0 },
  native_lang: { type: String, default: 'en' },
  phone: { type: String, default: '' }, // For SMS fallback (Twilio) — stored with country code e.g. +919876543210
  
  // ── Agaram Foundation Specific Fields ─────────────────────────
  user_type: { type: String, enum: ['mentor', 'mentee', 'admin', 'unassigned'], default: 'unassigned' },
  
  // For Mentees (Students)
  grade: { type: String, default: '' }, // Replaces or supplements 'cls'
  location: { type: String, default: '' }, // Important for rural geographic matching
  languages: { type: [String], default: ['Tamil'] }, 
  
  // For Mentors (Volunteers)
  volunteer_roles: { type: [String], default: ['mentoring'] }, // e.g., 'mentoring', 'verification', 'workshops'
  max_mentees: { type: Number, default: 8 },
  current_mentees_count: { type: Number, default: 0 },
  career_domain: { type: String, default: '' },
  is_alumni: { type: Boolean, default: false }, // "Circle of trust" - former beneficiaries returning to help
  
  joined_at: { type: Number, required: true, default: Date.now }
}, {
  timestamps: true
});

// For backward compatibility with the frontend that expect 'uid'
userSchema.virtual('id').get(function() {
  return this.uid;
});

module.exports = mongoose.model('User', userSchema);
