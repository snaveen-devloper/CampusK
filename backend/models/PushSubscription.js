const mongoose = require('mongoose');

const pushSubscriptionSchema = new mongoose.Schema({
  uid: { type: String, required: true, unique: true, ref: 'User' },
  subscription: { type: Object, required: true },
  created_at: { type: Number, default: Date.now }
});

module.exports = mongoose.model('PushSubscription', pushSubscriptionSchema);
