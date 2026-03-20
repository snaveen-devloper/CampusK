const mongoose = require('mongoose');

const questSchema = new mongoose.Schema({
  uid: { type: String, primaryKey: true, unique: true, required: true },
  date: { type: String, required: true },
  progress: { type: Object, default: {} }
});

module.exports = mongoose.model('Quest', questSchema);
