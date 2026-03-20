const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  id: { type: String, primaryKey: true, unique: true, required: true },
  room_id: { type: String, required: true },
  sender_uid: { type: String, required: true, ref: 'User' },
  ciphertext: { type: String, required: true },
  iv: { type: String, required: true },
  ts: { type: Number, required: true, default: Date.now }
}, {
  timestamps: true
});

messageSchema.index({ room_id: 1, ts: 1 });

module.exports = mongoose.model('Message', messageSchema);
