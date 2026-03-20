const mongoose = require('mongoose');

const requestSchema = new mongoose.Schema({
  id: { type: String, primaryKey: true, unique: true, required: true },
  from_uid: { type: String, required: true, ref: 'User' },
  to_uid: { type: String, required: true, ref: 'User' },
  subject: { type: String, required: true },
  note: { type: String, default: '' },
  status: { type: String, enum: ['pending', 'accepted', 'rejected'], default: 'pending' },
  ts: { type: Number, required: true, default: Date.now }
}, {
  timestamps: true
});

module.exports = mongoose.model('Request', requestSchema);
