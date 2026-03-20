const mongoose = require('mongoose');

const studyRoomSchema = new mongoose.Schema({
  id: { type: String, primaryKey: true, unique: true, required: true },
  code: { type: String, unique: true, required: true },
  host_uid: { type: String, required: true, ref: 'User' },
  subject: { type: String, required: true },
  capacity: { type: Number, default: 4 },
  created_at: { type: Number, required: true, default: Date.now }
}, {
  timestamps: true
});

const roomMemberSchema = new mongoose.Schema({
  room_id: { type: String, required: true, ref: 'StudyRoom' },
  uid: { type: String, required: true, ref: 'User' },
  joined_at: { type: Number, required: true, default: Date.now }
});

roomMemberSchema.index({ room_id: 1, uid: 1 }, { unique: true });

module.exports = {
  StudyRoom: mongoose.model('StudyRoom', studyRoomSchema),
  RoomMember: mongoose.model('RoomMember', roomMemberSchema)
};
