const mongoose = require('mongoose');

const reportSchema = new mongoose.Schema({
  id: { type: String, primaryKey: true, unique: true, required: true },
  from_uid: { type: String, required: true, ref: 'User' },
  target_uid: { type: String, required: true, ref: 'User' },
  reason: { type: String, required: true },
  detail: { type: String, default: '' },
  ts: { type: Number, required: true, default: Date.now }
}, {
  timestamps: true
});

module.exports = mongoose.model('Report', reportSchema);
