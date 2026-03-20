const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  id: { type: String, primaryKey: true, unique: true, required: true },
  uid: { type: String, required: true, ref: 'User' },
  icon: { type: String, default: 'gift' },
  description: { type: String, required: true },
  sub: { type: String, default: '' },
  amount: { type: Number, required: true },
  type: { type: String, enum: ['earn', 'spend'], default: 'earn' },
  date: { type: String, default: 'Today' },
  ts: { type: Number, required: true, default: Date.now }
}, {
  timestamps: true
});

module.exports = mongoose.model('Transaction', transactionSchema);
