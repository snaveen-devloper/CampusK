const mongoose = require('mongoose');

const scheduledJobSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  type: { type: String, required: true },
  payload: { type: String, required: true }, // JSON string
  run_at: { type: Number, required: true },
  ran: { type: Boolean, default: false }
});

module.exports = mongoose.model('ScheduledJob', scheduledJobSchema);
