'use strict';
// ── State ──────────────────────────────────────────────────────────────────
let ME = null;
let ALL_USERS = [];
let MY_REQS = [];
let MY_SESS = [];
let MY_TXNS = [];
let MY_BADGES = [];
let MY_QUESTS = {};
let MY_BOOSTS = {};
let ACTIVITY = [];
let reqTab = 'recv';
let calDate = new Date();
let selDate = null;
let curStar = 0;
let rateIdx = null;
let reqPeerId = null;
let activeVid = null;
let vidInterval = null;
let pomoInterval = null;
let pomoSecs = 25*60;
let pomoRunning = false;
let reportReason = null;
let viewCount = 0;
let sessionStartTime = null;

const SUBJECTS = [
  { id: 'math', n: 'Mathematics', ic: '<i class="ph-fill ph-calculator"></i>', c: '#f43f5e' },
  { id: 'phy', n: 'Physics', ic: '<i class="ph-fill ph-atom"></i>', c: '#8b5cf6' },
  { id: 'chem', n: 'Chemistry', ic: '<i class="ph-fill ph-flask"></i>', c: '#14b8a6' },
  { id: 'cs', n: 'Computer Science', ic: '<i class="ph-fill ph-monitor"></i>', c: '#3b82f6' },
  { id: 'bio', n: 'Biology', ic: '<i class="ph-fill ph-dna"></i>', c: '#84cc16' },
  { id: 'eng', n: 'English', ic: '<i class="ph-fill ph-book-open"></i>', c: '#f59e0b' },
  { id: 'hist', n: 'History', ic: '<i class="ph-fill ph-bank"></i>', c: '#a855f7' },
  { id: 'geo', n: 'Geography', ic: '<i class="ph-fill ph-globe-hemisphere-west"></i>', c: '#10b981' }
];

const COLORS = ['#10b981','#6366f1','#f59e0b','#ef4444','#06b6d4','#8b5cf6','#ec4899','#14b8a6','#f97316','#a855f7'];
const LEVELS = [
  {level:1,name:'Seed',minXp:0,color:'#10b981',next:300},
  {level:2,name:'Sprout',minXp:300,color:'#06b6d4',next:800},
  {level:3,name:'Scholar',minXp:800,color:'#6366f1',next:1800},
  {level:4,name:'Loop Master',minXp:1800,color:'#f59e0b',next:3500},
  {level:5,name:'Legend',minXp:3500,color:'#ef4444',next:99999},
];
const BADGE_DEFS = [
  { id: 'b_first', name: 'First Step', n: 'First Step', desc: 'Completed your first tutoring session', ic: '<i class="ph-fill ph-medal" style="color:#10b981"></i>', kp: 0, chk: (me) => (me.sess_count||0) >= 1 },
  { id: 'b_helper', name: 'Helper', n: 'Helper', desc: 'Taught 5 sessions', ic: '<i class="ph-fill ph-hands-clapping" style="color:#3b82f6"></i>', kp: 0, chk: (me) => (me.sess_count||0) >= 5 },
  { id: 'b_scholar', name: 'Scholar', n: 'Scholar', desc: 'Learned 5 sessions', ic: '<i class="ph-fill ph-student" style="color:#a855f7"></i>', kp: 0, chk: (me) => (me.sess_count||0) >= 5 },
  { id: 'b_super', name: 'Super Teacher', n: 'Super Teacher', desc: 'Taught 20 sessions', ic: '<i class="ph-fill ph-crown" style="color:#f59e0b"></i>', kp: 0, chk: (me) => (me.sess_count||0) >= 20 },
  { id: 'b_fast', name: 'Fast Responder', n: 'Fast Responder', desc: 'Accepted request in under 1 min', ic: '<i class="ph-fill ph-lightning" style="color:#f43f5e"></i>', kp: 0, chk: (me) => false },
  { id: 'b_streak7', name: '7-Day Streak', n: '7-Day Streak', desc: 'Active 7 days in a row', ic: '<i class="ph-fill ph-fire" style="color:#f97316"></i>', kp: 0, chk: (me) => (me.streak||0) >= 7 }
];

const QUEST_DEFS = [
  { id: 'q_login', name: 'Login Today', desc: 'Log in today', xp: 10, kp: 0, ic: '<i class="ph-fill ph-sign-in" style="color:#eab308"></i>', max: 1, target: 1, type: 'login' },
  { id: 'q_teach', name: 'Teach Session', desc: 'Teach 1 session', xp: 30, kp: 10, ic: '<i class="ph-fill ph-chalkboard-teacher" style="color:#3b82f6"></i>', max: 1, target: 1, type: 'teach' },
  { id: 'q_learn', name: 'Learn Session', desc: 'Learn 1 session', xp: 20, kp: 0, ic: '<i class="ph-fill ph-books" style="color:#ec4899"></i>', max: 1, target: 1, type: 'learn' },
  { id: 'q_req', name: 'Connect', desc: 'Send 2 requests', xp: 15, kp: 0, ic: '<i class="ph-fill ph-paper-plane-tilt" style="color:#14b8a6"></i>', max: 2, target: 2, type: 'requests_sent' }
];

function toDateStr(d){return d.toISOString().split('T')[0];}
function addDays(d,n){const r=new Date(d);r.setDate(r.getDate()+n);return r;}
function initials(name){return(name||'?').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();}
function colorFor(uid){const h=(uid||'').split('').reduce((a,c)=>a+c.charCodeAt(0),0);return COLORS[h%COLORS.length];}
function avStyle(uid,name,size=28,fontSize=.6){
  const c=uid==='me'?'#10b981':colorFor(uid);
  return `width:${size}px;height:${size}px;font-size:${fontSize}rem;background:${c}18;border:1.5px solid ${c}44;color:${c};`;
}

function getAvatarHtml(uid, name, avatarUrl, size=28, fontSize=.6) {
  if (avatarUrl) {
    return `<img src="${avatarUrl}" class="av-img" style="width:${size}px;height:${size}px;border-radius:50%;object-fit:cover;border:1.5px solid var(--bd2);flex-shrink:0;">`;
  }
  const c = uid === 'me' ? (ME?.color || colorFor('me')) : colorFor(uid);
  return `<div class="av" style="width:${size}px;height:${size}px;font-size:${fontSize}rem;background:${c}18;border:1.5px solid ${c}44;color:${c};border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-weight:700">${initials(name)}</div>`;
}

function getLevel(){const xp=ME?.xp||0;for(let i=LEVELS.length-1;i>=0;i--){if(xp>=LEVELS[i].minXp)return LEVELS[i];}return LEVELS[0];}
function roomId(uid1,uid2){return [uid1,uid2].sort().join('_');}
function buildFreshQuests(){const today=toDateStr(new Date());const q={date:today,progress:{}};QUEST_DEFS.forEach(qd=>q.progress[qd.id]={done:0,claimed:false});return q;}
