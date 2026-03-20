const mongoose = require('mongoose');

const activitySchema = new mongoose.Schema({
  id: { type: String, primaryKey: true, unique: true, required: true },
  msg: { type: String, required: true },
  type: { type: String, default: 'info' },
  ts: { type: Number, required: true, default: Date.now }
}, {
  timestamps: true
});

module.exports = mongoose.model('Activity', activitySchema);
