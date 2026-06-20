'use strict';
const mongoose = require('mongoose');

/**
 * LoopHealth — tracks every active N-way karma loop and the
 * health of each 1-on-1 link inside it.
 *
 * A "link" is one directed 1-on-1 session slot in the loop:
 *   teacher_uid → student_uid on subject
 *
 * status lifecycle:
 *   active   → The link has an upcoming/live session
 *   missed   → Session was auto-marked missed (no completion in 72h)
 *   healed   → A replacement user was found and inserted
 *   broken   → No replacement could be found (loop terminated)
 */
const linkSchema = new mongoose.Schema({
  teacher_uid:   { type: String, required: true },
  student_uid:   { type: String, required: true },
  subject:       { type: String, required: true },
  session_id:    { type: String, default: null },   // linked Session._id
  status:        { type: String, default: 'active', enum: ['active','missed','healed','broken'] },
  missed_at:     { type: Number, default: null },
  healed_at:     { type: Number, default: null },
  replacement_uid: { type: String, default: null }, // who replaced the ghost
}, { _id: false });

const healEventSchema = new mongoose.Schema({
  ts:            { type: Number, default: Date.now },
  dropped_uid:   { type: String, required: true },
  replacement_uid: { type: String, required: true },
  subject:       { type: String, required: true },
  reason:        { type: String, default: 'inactivity' },
}, { _id: false });

const loopHealthSchema = new mongoose.Schema({
  loop_id:       { type: String, unique: true, required: true }, // stable uid_key from loops.js
  member_uids:   [String],          // ordered: A→B→C→…→A
  links:         [linkSchema],      // one per directed edge
  score:         { type: Number, default: 0 },
  is_closed:     { type: Boolean, default: true },
  status:        { type: String, default: 'active', enum: ['active','healing','broken','completed'] },
  heal_events:   [healEventSchema], // audit trail of every auto-heal
  created_at:    { type: Number, default: Date.now },
  last_checked:  { type: Number, default: null },
}, { timestamps: true });

module.exports = mongoose.model('LoopHealth', loopHealthSchema);
