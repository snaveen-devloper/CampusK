const mongoose = require('mongoose');

const boostSchema = new mongoose.Schema({
  uid: { type: String, required: true, ref: 'User' },
  item_id: { type: String, required: true },
  active: { type: Boolean, default: true },
  bought_at: { type: Number, required: true, default: Date.now }
});

boostSchema.index({ uid: 1, item_id: 1 }, { unique: true });

module.exports = mongoose.model('Boost', boostSchema);
