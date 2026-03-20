const mongoose = require('mongoose');

const noteSchema = new mongoose.Schema({
  id: { type: String, primaryKey: true, unique: true, required: true },
  session_id: { type: String, ref: 'Session' },
  author_uid: { type: String, required: true, ref: 'User' },
  title: { type: String, required: true },
  content: { type: String, default: '' },
  is_public: { type: Boolean, default: false },
  forks: { type: Number, default: 0 },
  attachment_url: { type: String, default: null },
  attachment_name: { type: String, default: null },
  attachment_mime: { type: String, default: null },
  ts: { type: Number, required: true, default: Date.now }
}, {
  timestamps: true
});

module.exports = mongoose.model('Note', noteSchema);
