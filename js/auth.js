'use strict';
function switchAuthTab(tab){
  document.querySelectorAll('.auth-tab').forEach((t,i)=>t.classList.toggle('on',i===(tab==='login'?0:1)));
  document.getElementById('form-login').classList.toggle('on',tab==='login');
  document.getElementById('form-signup').classList.toggle('on',tab==='signup');
  document.getElementById('auth-err').style.display='none';
  const titleEl=document.getElementById('auth-panel-title');
  const subEl=document.getElementById('auth-panel-sub');
  if(titleEl) titleEl.textContent = tab==='login' ? 'Welcome back' : 'Create your account';
  if(subEl) subEl.textContent = tab==='login' ? 'Sign in to continue your learning journey' : 'Join thousands of students already learning & teaching';
}


async function doSignup(){
  const btn=document.getElementById('signup-btn');
  const userType=document.getElementById('s-usertype').value;
  const name=document.getElementById('s-name').value.trim();
  const email=document.getElementById('s-email').value.trim().toLowerCase();
  const location=document.getElementById('s-loc').value.trim();
  const careerDomain=document.getElementById('s-career').value.trim();
  const school=document.getElementById('s-school').value.trim();
  const pass=document.getElementById('s-pass').value;

  if(!userType||!name||!email||!location||!careerDomain||!school||!pass){showAuthErr('Please fill all fields.');return;}
  if(pass.length<6){showAuthErr('Password must be at least 6 characters.');return;}
  
  btn.disabled=true;btn.textContent='Creating account…';
  try{
    const payload = { 
      name, email, school, password: pass, 
      user_type: userType, location, career_domain: careerDomain 
    };
    const {token,user}=await apiFetch('/auth/signup',{method:'POST',body:payload});
    setToken(token);ME=user;ME.subjects=Array.isArray(ME.subjects)?ME.subjects:[];ME.ratings=Array.isArray(ME.ratings)?ME.ratings:[];
    btn.disabled=false;btn.textContent='Create Account';
    showOb();
  }catch(e){showAuthErr(e.message);btn.disabled=false;btn.textContent='Create Account';}
}

async function doLogin(){
  const btn=document.getElementById('login-btn');
  const email=document.getElementById('l-email').value.trim().toLowerCase();
  const pass=document.getElementById('l-pass').value;
  if(!email||!pass){showAuthErr('Please enter email and password.');return;}
  btn.disabled=true;btn.textContent='Signing in…';
  try{
    const {token,user}=await apiFetch('/auth/login',{method:'POST',body:{email,password:pass}});
    setToken(token);ME=user;ME.subjects=Array.isArray(ME.subjects)?ME.subjects:[];ME.ratings=Array.isArray(ME.ratings)?ME.ratings:[];
    btn.disabled=false;btn.textContent='Sign In';
    await loadAndLaunch();
  }catch(e){showAuthErr(e.message);btn.disabled=false;btn.textContent='Sign In';}
}

function showAuthErr(msg){
  const el=document.getElementById('auth-err');el.textContent=msg;el.style.display='block';
}

async function doLogout(){
  if(!confirm('Sign out of CampusKarma?'))return;
  clearToken();ME=null;ALL_USERS=[];MY_REQS=[];MY_SESS=[];
  document.getElementById('scr-app').classList.remove('on');
  document.getElementById('scr-auth').classList.add('on');
  switchAuthTab('login');
}

// ── Onboarding ─────────────────────────────────────────────────────────────
let teachSet=new Set(),learnSet=new Set();

function buildObGrids(){
  ['teach-grid','learn-grid'].forEach((gid,li)=>{
    const g=document.getElementById(gid);g.innerHTML='';
    SUBJECTS.forEach(subj=>{
      const sName=typeof subj==='string'?subj:subj.n;
      const d=document.createElement('div');d.className='sg-chip';d.textContent=sName;
      const cls=li?'learn':'teach';const set=li?learnSet:teachSet;
      if(set.has(sName))d.classList.add(cls);
      d.onclick=()=>{if(set.has(sName)){set.delete(sName);d.classList.remove(cls);}else{set.add(sName);d.classList.add(cls);}};
      g.appendChild(d);
    });
  });
  const lg=document.getElementById('lang-grid');if(lg){
    lg.innerHTML='';
    ['English','Hindi','Tamil','Telugu','Malayalam','Kannada','Bengali','Marathi','Gujarati'].forEach(l=>{
      const d=document.createElement('div');d.className='sg-chip'+(ME.native_lang===l?' teach':'');d.textContent=l;
      d.onclick=()=>{document.querySelectorAll('#lang-grid .sg-chip').forEach(x=>x.classList.remove('teach'));d.classList.add('teach');ME.native_lang=l;};
      lg.appendChild(d);
    });
  }
}

function showOb(){
  teachSet.clear();learnSet.clear();buildObGrids();
  document.getElementById('scr-auth').classList.remove('on');
  document.getElementById('scr-ob').classList.add('on');
  showObStep(0);
}

function showObStep(n){
  [0,1,2].forEach(i=>{
    const el=document.getElementById('obs'+i); if(el) el.classList.toggle('on',i===n);
    const pp=document.getElementById('pp'+i); if(pp) pp.classList.toggle('on',i<=n);
  });
}

async function obNext(step){
  if(step===0){
    if(teachSet.size===0){toast('Select at least one subject you can teach','er');return;}
    showObStep(1);
  }else if(step===1){
    if(learnSet.size===0){toast('Select at least one subject you want to learn','er');return;}
    showObStep(2);
  }else{
    ME.subjects=SUBJECTS.map(s=>{const n=typeof s==='string'?s:s.n;return{name:n,teach:teachSet.has(n),learn:learnSet.has(n)};}).filter(s=>s.teach||s.learn);
    ME.is_new=false;
    await apiFetch('/users/me',{method:'PATCH',body:{subjects:ME.subjects,is_new:false,native_lang:ME.native_lang||'English'}});
    document.getElementById('scr-ob').classList.remove('on');
    await loadAndLaunch();
  }
}

// ── Load & Launch ──────────────────────────────────────────────────────────
async function loadAndLaunch(){
  try{
    const [usersRes,reqsRes,sessRes,txnRes,actRes,questRes,boostRes]=await Promise.all([
      apiFetch('/users'),
      apiFetch('/requests'),
      apiFetch('/sessions'),
      apiFetch('/users/me/transactions'),
      apiFetch('/activity'),
      apiFetch('/users/me/quests'),
      apiFetch('/users/me/boosts'),
    ]);
    ALL_USERS = (usersRes.users || []).filter(u => u.uid !== ME.uid && !u.is_banned);
    MY_REQS = reqsRes.requests || [];
    MY_SESS = sessRes.sessions || [];
    MY_TXNS = txnRes.transactions || [];
    ACTIVITY = actRes.activities || [];
    MY_QUESTS = questRes.quests || buildFreshQuests();
    MY_BOOSTS = boostRes.boosts || {};
    MY_BADGES = BADGE_DEFS.map(b => ({ ...b, earned: b.chk ? b.chk(ME) : false }));

    syncUI();
    updateStreak();
    advanceQuest('login', 1);
    document.getElementById('scr-splash').classList.remove('on');
    document.getElementById('scr-app').classList.add('on');
    connectWS();
    setupWSHandlers();
    renderChat();
    setupPushNotifications();
  }catch(e){console.error('Launch error:',e);}
}

async function saveMe(patch={}){
  const payload={
    subjects:ME.subjects,kp:ME.kp,xp:ME.xp,streak:ME.streak,
    last_active:ME.last_active,level:ME.level,is_new:ME.is_new,...patch
  };
  await apiFetch('/users/me',{method:'PATCH',body:payload});
}

function updateStreak(){
  const today=toDateStr(new Date());
  if(ME.last_active===today)return;
  const yesterday=toDateStr(addDays(new Date(),-1));
  ME.streak=ME.last_active===yesterday?(ME.streak||0)+1:1;
  ME.last_active=today;
}

function advanceQuest(type,n=1){
  const today=toDateStr(new Date());
  if(!MY_QUESTS.date||MY_QUESTS.date!==today){MY_QUESTS=buildFreshQuests();}
  const qd=QUEST_DEFS.find(q=>q.type===type);if(!qd)return;
  const p=MY_QUESTS.progress[qd.id];
  if(p&&!p.claimed&&p.done<qd.target){p.done+=n;saveQuestsRemote();}
}

async function claimQuest(qid){
  const qd=QUEST_DEFS.find(q=>q.id===qid);if(!qd)return;
  MY_QUESTS.progress[qid].claimed=true;
  ME.kp+=qd.kp;ME.xp=(ME.xp||0)+qd.xp;
  await saveMe();await saveQuestsRemote();checkLevelUp();
  syncUI();toast('Quest completed! +'+qd.xp+' XP, +'+qd.kp+' KP','ok');
}

async function saveQuestsRemote(){
  await apiFetch('/users/me/quests',{method:'PUT',body:{date:MY_QUESTS.date,progress:MY_QUESTS.progress}});
}

// ── Web Push Notifications ──────────────────────────────────────────────────
async function setupPushNotifications() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  try {
    const reg = await navigator.serviceWorker.register('/sw.js');
    const { publicKey } = await apiFetch('/users/vapid-key');
    if (!publicKey) return;
    
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      console.warn('Push notifications permission denied.');
      return;
    }
    
    // Check if already subscribed to avoid duplicate DB calls
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey)
      });
    }
    
    await apiFetch('/users/push-subscribe', { 
      method: 'POST', 
      body: { subscription: JSON.stringify(sub) } 
    }).catch(console.warn);
  } catch(e) {
    console.warn('Push setup failed:', e);
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
