const mongoose = require('mongoose');
const User = require('./models/User');
const Request = require('./models/Request');
const Session = require('./models/Session');
const Message = require('./models/Message');
const { QuizQuestion, QuizAnswer } = require('./models/Quiz');
const Transaction = require('./models/Transaction');
const Activity = require('./models/Activity');
const Note = require('./models/Note');
const { StudyRoom, RoomMember } = require('./models/StudyRoom');
const Attachment = require('./models/Attachment');
const Boost = require('./models/Boost');
const Report = require('./models/Report');
const AIFeedback = require('./models/AIFeedback');
const Quest = require('./models/Quest');
const PushSubscription = require('./models/PushSubscription');
const ScheduledJob = require('./models/ScheduledJob');

let isConnected = false;

async function initDB() {
  if (isConnected) return mongoose.connection;

  const MONGODB_URI = process.env.MONGO_URL || process.env.MONGODB_URI || 'mongodb://localhost:27017/campuskarma';

  try {
    await mongoose.connect(MONGODB_URI);
    isConnected = true;
    console.log('📦 Connected to MongoDB');
    return mongoose.connection;
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    process.exit(1);
  }
}

module.exports = { 
    initDB,
    models: {
        User,
        Request,
        Session,
        Message,
        QuizQuestion,
        QuizAnswer,
        Transaction,
        Activity,
        Note,
        StudyRoom,
        RoomMember,
        Attachment,
        Boost,
        Report,
        AIFeedback,
        Quest,
        PushSubscription,
        ScheduledJob
    }
};
