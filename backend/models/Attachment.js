const mongoose = require('mongoose');

const attachmentSchema = new mongoose.Schema({
  id: { type: String, primaryKey: true, unique: true, required: true },
  note_id: { type: String, ref: 'Note' },
  uploader_uid: { type: String, required: true, ref: 'User' },
  filename: { type: String, required: true },
  original_name: { type: String, required: true },
  url: { type: String, required: true },
  size: { type: Number, required: true },
  mime: { type: String, required: true },
  ts: { type: Number, required: true, default: Date.now }
}, {
  timestamps: true
});

module.exports = mongoose.model('Attachment', attachmentSchema);
