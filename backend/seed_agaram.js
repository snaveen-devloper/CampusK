require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { initDB, models } = require('./db');

const MENTOR_NAMES = ['Priya Raman', 'Karthik Subramaniam', 'Aarthi Krishnan', 'Sanjay Kumar', 'Deepa Natarajan'];
const MENTEE_NAMES = [
  'Vetrivel S', 'Anbu M', 'Kavitha R', 'Suriya K', 'Malar P', 'Jeeva T', 'Nila V', 'Tamizh S',
  'Selva N', 'Arul J', 'Kani M', 'Muthu P', 'Bharathi K', 'Elango R', 'Oviya S', 'Kavin T', 
  'Amudha V', 'Kumaran N', 'Ezhil M', 'Mathi P'
];
const LOCATIONS = ['Villupuram', 'Madurai', 'Tirunelveli', 'Dharmapuri', 'Ariyalur', 'Ramanathapuram', 'Thanjavur'];
const CAREER_DOMAINS = ['Engineering', 'Medicine', 'Civil Service', 'Agriculture', 'Commerce'];

async function runSeed() {
  console.log('🌱 Starting Agaram Foundation Demo Seed...');
  await initDB();
  const { User, MentorCohort, AIFeedback, Session } = models;

  // Clear existing data to ensure a clean demo slate
  console.log('🧹 Clearing existing demo data...');
  await User.deleteMany({ email: { $regex: '@agaramdemo.com$' } });
  await MentorCohort.deleteMany({ cohort_id: { $regex: '^agaram_' } });
  await Session.deleteMany({ 'status': 'completed' });
  await AIFeedback.deleteMany({});

  const hash = await bcrypt.hash('password123', 10);
  
  // 1. Create 5 Mentors (Volunteers)
  console.log('👨‍🏫 Creating 5 Mentors...');
  const mentors = [];
  for (let i = 0; i < 5; i++) {
    const isAlumni = Math.random() > 0.6; // 40% are alumni
    const mentor = await User.create({
      uid: 'u_mentor_' + i,
      name: MENTOR_NAMES[i],
      email: `mentor${i}@agaramdemo.com`,
      password_hash: hash,
      user_type: 'mentor',
      school: 'TCS / Infosys', // Corporate volunteers
      location: LOCATIONS[Math.floor(Math.random() * LOCATIONS.length)],
      career_domain: CAREER_DOMAINS[i % CAREER_DOMAINS.length],
      languages: ['Tamil', 'English'],
      native_lang: 'Tamil',
      is_alumni: isAlumni,
      max_mentees: 8,
      current_mentees_count: 0,
      teaching_score: (Math.random() * 2 + 8).toFixed(1), // 8.0 - 10.0
      subjects: [
        { name: 'Physics', teach: true, learn: false },
        { name: 'Mathematics', teach: true, learn: false },
        { name: 'Computer Science', teach: true, learn: false }
      ],
      joined_at: Date.now() - 30 * 86400000 // Joined 30 days ago
    });
    mentors.push(mentor);
  }

  // 2. Create 20 Mentees (Students)
  console.log('🧑‍🎓 Creating 20 Rural Mentees...');
  const mentees = [];
  for (let i = 0; i < 20; i++) {
    const mentee = await User.create({
      uid: 'u_mentee_' + i,
      name: MENTEE_NAMES[i],
      email: `student${i}@agaramdemo.com`,
      password_hash: hash,
      user_type: 'mentee',
      school: 'Government Higher Secondary',
      location: LOCATIONS[Math.floor(Math.random() * LOCATIONS.length)],
      career_domain: CAREER_DOMAINS[Math.floor(Math.random() * CAREER_DOMAINS.length)],
      languages: ['Tamil'], // Pure Tamil medium
      native_lang: 'Tamil',
      subjects: [
        { name: 'Physics', teach: false, learn: true },
        { name: 'Mathematics', teach: false, learn: true }
      ],
      joined_at: Date.now()
    });
    mentees.push(mentee);
  }

  // 3. Fake 1 Cohort with Dormancy and Feedback data (So the dashboard isn't completely empty before matching)
  console.log('📊 Injecting 1 Active Cohort to show Dormancy Alerts...');
  const preMatchedMentor = mentors[0];
  const preMatchedMentees = [mentees[0], mentees[1]];
  
  const cohort = await MentorCohort.create({
    cohort_id: 'agaram_' + uuidv4().substring(0, 8),
    mentor_uid: preMatchedMentor.uid,
    mentee_uids: preMatchedMentees.map(m => m.uid),
    status: 'active'
  });
  
  preMatchedMentor.current_mentees_count = 2;
  await preMatchedMentor.save();

  // Create a session 8 days ago (over the 7-day dormancy limit)
  const eightDaysAgo = Date.now() - (8 * 86400000);
  await Session.create({
    id: 's_' + uuidv4().substring(0, 8),
    session_id: 'sess_dormant',
    room_code: 'RM1234',
    date: new Date(eightDaysAgo).toISOString().split('T')[0],
    time: '14:00',
    peer1: preMatchedMentor.uid,
    peer2: preMatchedMentees[0].uid,
    subject: 'Mathematics',
    status: 'completed',
    created_at: eightDaysAgo - 3600000,
    ended_at: eightDaysAgo
  });

  // Inject AI feedback for the report
  await AIFeedback.create({
    id: 'f_' + uuidv4().substring(0, 8),
    session_id: 'sess_dormant',
    mentor_uid: preMatchedMentor.uid,
    teacher_uid: preMatchedMentor.uid,
    student_uid: preMatchedMentees[0].uid,
    clarity_score: 8,
    engagement_score: 7,
    feedback_text: 'The student grasped algebraic variables quickly but needs more practice on polynomials.',
    generated_questions: [{ q: 'What is algebra?', options: [], ans: '' }],
    created_at: eightDaysAgo
  });

  console.log('\n✅ SEED COMPLETE!');
  console.log('You can now log into the Coordinator Dashboard and hit "Auto-Match All".');
  console.log('Test Accounts (Password: password123)');
  console.log('Mentor: mentor0@agaramdemo.com');
  console.log('Student: student0@agaramdemo.com\n');
  process.exit(0);
}

runSeed().catch(console.error);
