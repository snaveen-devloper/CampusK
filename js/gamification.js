'use strict';
// ── Store ─────────────────────────────────────────────────────────────────
function renderStore() {
  const el = document.getElementById('store-grid'); if (!el) return;
  const items = [
    {
      id: 'boost', name: 'Visibility Boost',
      desc: 'Pin yourself to the top of Discover for 24 hours. More connections, faster.',
      kp: 100, color: 'var(--em)', icon: 'ph-fill ph-rocket-launch',
      badge: 'Popular'
    },
    {
      id: 'shield', name: 'Streak Shield',
      desc: 'Miss a day without breaking your streak. One-time insurance for your momentum.',
      kp: 150, color: 'var(--bl)', icon: 'ph-fill ph-shield-check',
      badge: null
    },
    {
      id: 'xp2x', name: '2× XP Boost',
      desc: 'Double every XP point you earn for the next 24 hours. Level up twice as fast.',
      kp: 200, color: 'var(--am)', icon: 'ph-fill ph-chart-line-up',
      badge: 'Best Value'
    },
    {
      id: 'priority', name: 'Priority Match',
      desc: 'Your connection requests appear first. Peers see you before anyone else.',
      kp: 250, color: 'var(--cy)', icon: 'ph-fill ph-star-four',
      badge: null
    },
  ];

  // Balance header
  const balEl = document.getElementById('store-bal');
  if (balEl) balEl.textContent = (ME?.kp || 0) + ' KP available';

  el.innerHTML = items.map(item => {
    const owned = MY_BOOSTS[item.id];
    const canAfford = ME && ME.kp >= item.kp;
    return `
    <div class="store-card${owned ? ' boosted' : ''}">
      <div class="sc-top">
        <div class="sc-icon" style="background:${item.color}18;color:${item.color}">
          <i class="${item.icon}"></i>
        </div>
        ${item.badge ? `<span class="sc-badge" style="background:${item.color}20;color:${item.color}">${item.badge}</span>` : ''}
        ${owned ? `<span class="sc-active-pill"><i class="ph-fill ph-check-circle"></i> Active</span>` : ''}
      </div>
      <div class="sc-name">${item.name}</div>
      <div class="sc-desc">${item.desc}</div>
      <div class="sc-footer">
        <div class="sc-price"><i class="ph-fill ph-star" style="font-size:.8rem;color:var(--am)"></i> ${item.kp} KP</div>
        ${owned
          ? `<span class="pill g" style="font-size:.72rem">Activated</span>`
          : `<button class="sc-buy-btn${canAfford ? '' : ' disabled'}" onclick="${canAfford ? `buyItem('${item.id}','${item.name}',${item.kp})` : `toast('Need ${item.kp} KP to unlock','er')`}">
               ${canAfford ? '<i class="ph-fill ph-lightning"></i> Unlock' : `<i class="ph ph-lock"></i> ${item.kp} KP`}
             </button>`
        }
      </div>
    </div>`;
  }).join('');
}


// ── Karma Rank System ──────────────────────────────────────────────────────
// NOTE: Rank is based on LIFETIME KP (total earned, never decreases).
// We proxy it through ME.kp for now; ideally backend stores ME.lifetime_kp.
const KARMA_RANKS = [
  { name: 'Newcomer',  min: 0,    max: 99,   color: '#8899aa', icon: 'ph-fill ph-seedling',      bg: 'rgba(136,153,170,.12)' },
  { name: 'Scholar',   min: 100,  max: 299,  color: '#22d3ee', icon: 'ph-fill ph-book-open',      bg: 'rgba(34,211,238,.12)'  },
  { name: 'Expert',    min: 300,  max: 699,  color: '#818cf8', icon: 'ph-fill ph-brain',           bg: 'rgba(129,140,248,.12)' },
  { name: 'Mentor',    min: 700,  max: 1499, color: '#10b981', icon: 'ph-fill ph-chalkboard-teacher', bg: 'rgba(16,185,129,.12)' },
  { name: 'Elite',     min: 1500, max: 2999, color: '#f59e0b', icon: 'ph-fill ph-trophy',          bg: 'rgba(245,158,11,.12)'  },
  { name: 'Legend',    min: 3000, max: Infinity, color: '#f87171', icon: 'ph-fill ph-crown',       bg: 'rgba(248,113,113,.12)' },
];

function getKarmaRank(kp) {
  kp = kp ?? (ME?.kp || 0);
  return KARMA_RANKS.find(r => kp >= r.min && kp <= r.max) || KARMA_RANKS[0];
}

function getNextKarmaRank(kp) {
  kp = kp ?? (ME?.kp || 0);
  const idx = KARMA_RANKS.findIndex(r => kp >= r.min && kp <= r.max);
  return idx >= 0 && idx < KARMA_RANKS.length - 1 ? KARMA_RANKS[idx + 1] : null;
}



async function buyItem(id, name, kp) {
  if (ME.kp < kp) { toast('Not enough Karma Points', 'er'); return; }
  try {
    await apiFetch('/store/buy', { method: 'POST', body: { item_id: id, item_name: name, kp } });
    ME.kp -= kp; MY_BOOSTS[id] = true; syncUI(); renderStore(); toast(name + ' activated!', 'ok');
  } catch (e) { toast(e.message, 'er'); }
}


async function buyInstant() {
  try {
    await apiFetch('/store/instant-kp', { method: 'POST' });
    ME.kp += 100; syncUI(); renderWallet(); toast('+100 Karma Points added!', 'ok');
  } catch (e) { toast(e.message, 'er'); }
}

// ── Wallet ─────────────────────────────────────────────────────────────────
function renderWallet() {
  const balEl = document.getElementById('w-bal');
  if(balEl) balEl.textContent = ME.kp;

  // Show rank card above transactions
  const rankCard = document.getElementById('w-rank-card');
  if (rankCard) {
    const rank = getKarmaRank(ME.kp);
    const next = getNextKarmaRank(ME.kp);
    const pct = next ? Math.round(((ME.kp - rank.min) / (next.min - rank.min)) * 100) : 100;
    rankCard.innerHTML = `
      <div class="kr-card" style="border-color:${rank.color}40;background:${rank.bg}">
        <div class="kr-top">
          <div class="kr-icon" style="color:${rank.color};background:${rank.color}18">
            <i class="${rank.icon}"></i>
          </div>
          <div class="kr-info">
            <div class="kr-label">Your Karma Rank</div>
            <div class="kr-name" style="color:${rank.color}">${rank.name}</div>
          </div>
          <div class="kr-kp">${ME.kp} <span>KP</span></div>
        </div>
        <div class="kr-bar-wrap">
          <div class="kr-bar-fill" style="width:${pct}%;background:${rank.color}"></div>
        </div>
        <div class="kr-footer">
          ${next
            ? `<span style="color:var(--t3);font-size:.72rem">${rank.min} KP</span>
               <span style="color:${rank.color};font-size:.72rem;font-weight:700">
                 <i class="ph-fill ph-lightning"></i> ${next.min - ME.kp} KP to <b>${next.name}</b>
               </span>
               <span style="color:var(--t3);font-size:.72rem">${next.min} KP</span>`
            : `<span style="color:${rank.color};font-size:.75rem;font-weight:700">
                 <i class="ph-fill ph-crown"></i> Maximum Rank Achieved!
               </span>`
          }
        </div>
        <div class="kr-note">🔒 Your rank is <b>permanent</b> — spending KP in the Store never lowers it.</div>
      </div>`;
  }

  const el = document.getElementById('tx-list'); if (!el) return;
  if (!MY_TXNS.length) { el.innerHTML = '<div class="empty"><div>No transactions yet</div></div>'; return; }
  el.innerHTML = MY_TXNS.slice(0, 20).map(t => `
    <div class="tx-row">
      <div class="tx-ic" style="background:${t.type === 'earn' ? 'var(--emb)' : 'var(--rdb)'};color:${t.type === 'earn' ? 'var(--em)' : 'var(--rd)'}">
        <i class="ph-fill ${t.type === 'earn' ? 'ph-arrow-circle-up' : 'ph-arrow-circle-down'}"></i>
      </div>
      <div class="tx-info"><div class="tx-d">${t.description}</div><div class="tx-m">${t.sub || ''} · ${t.date || 'Today'}</div></div>
      <div class="tx-a ${t.type === 'earn' ? 'plus' : 'minus'}">${t.amount > 0 ? '+' : ''}${t.amount} KP</div>
    </div>`).join('');
}


// ── Profile ────────────────────────────────────────────────────────────────
function renderMyProfile() {
  const sp = document.getElementById('pr-subj');
  const active = (ME.subjects || []).filter(s => s.teach || s.learn);
  sp.innerHTML = active.length ? active.map(s => [s.teach ? `<span class="sp sp-t">${s.name}</span>` : '', s.learn ? `<span class="sp sp-l">${s.name}</span>` : ''].join('')).join('') : `<span style="color:var(--t3);font-size:.8rem">No interests set. <button class="btn-sm o" onclick="openEditInterests()">Add now</button></span>`;
  const lv = getLevel();
  const rank = getKarmaRank(ME.kp);
  document.getElementById('pr-stats').innerHTML = [
    ['Sessions', ME.sess_count || 0, lv.color],
    ['Streak', (ME.streak || 0) + 'd', 'var(--am)'],
    ['Level', lv.name, lv.color],
    ['Rank', rank.name, rank.color],
  ].map(([l, v, c]) => `<div class="sg-cell"><div class="sg-v" style="color:${c}">${v}</div><div class="sg-l">${l}</div></div>`).join('');
  renderBadges();
}

function renderBadges() {
  const el = document.getElementById('pr-badges'); if (!el) return;
  el.innerHTML = MY_BADGES.map(b => `<div class="badge-c${b.earned ? ' earned' : ' locked'}">
    <div class="badge-ic" style="background:${b.earned ? 'var(--amb)' : 'var(--s3)'};color:${b.earned ? 'var(--am)' : 'var(--t3)'}">🏅</div>
    <div class="badge-n">${b.name || b.n}</div><div class="badge-d">${b.desc}</div></div>`).join('');
}

// ── Edit Interests ─────────────────────────────────────────────────────────
let editSubjs = [];
function openEditInterests() {
  editSubjs = (ME.subjects || []).map(s => ({ ...s }));
  const el = document.getElementById('sei-list');
  el.innerHTML = SUBJECTS.map(subj => {
    const name = typeof subj === 'string' ? subj : subj.n;
    let s = editSubjs.find(x => x.name === name) || { name, teach: false, learn: false };
    if (!editSubjs.find(x => x.name === name)) editSubjs.push(s);
    return `<div class="sei-row" id="sei-${name.replace(/[^a-z]/gi, '_')}">
      <div class="sei-n">${name}</div>
      <div class="sei-tgls">
        <div class="sei-t teach${s.teach ? ' on' : ''}" onclick="toggleSei('${name}','teach')">Teach</div>
        <div class="sei-t learn${s.learn ? ' on' : ''}" onclick="toggleSei('${name}','learn')">Learn</div>
      </div></div>`;
  }).join('');
  document.getElementById('modal-interests').classList.add('on');
}
function toggleSei(name, type) { const s = editSubjs.find(x => x.name === name); if (s) s[type] = !s[type]; const row = document.getElementById('sei-' + name.replace(/[^a-z]/gi, '_')); if (row) row.querySelector('.sei-t.' + type).classList.toggle('on', s[type]); }
async function saveInterests() {
  const btn = document.querySelector('#modal-interests .btn-p');
  const oldText = btn.textContent;
  btn.disabled = true; btn.textContent = 'Saving...';
  try {
    ME.subjects = editSubjs.filter(s => s.teach || s.learn);
    await saveMe();
    if (typeof renderMyProfile === 'function') renderMyProfile();
    renderDiscover();
    closeOvl('modal-interests');
    toast('Interests updated!', 'ok');
  } catch (e) {
    console.error('[saveInterests]', e);
    toast('Failed to save: ' + e.message, 'er');
  } finally {
    btn.disabled = false; btn.textContent = oldText;
  }
}

// ── Report ─────────────────────────────────────────────────────────────────
function openReport(peerId) {
  reportReason = null; document.querySelectorAll('.report-opt').forEach(o => o.classList.remove('on'));
  const conn = getConnected(); const allPeers = [...conn, ...ALL_USERS.filter(u => !conn.includes(u.uid)).map(u => u.uid)];
  if (!allPeers.length) { toast('No users to report', 'er'); return; }
  document.getElementById('report-peer').innerHTML = allPeers.map(uid => { const p = ALL_USERS.find(u => u.uid === uid) || { name: 'User' }; return `<option value="${uid}"${uid === peerId && peerId !== 'self' ? ' selected' : ''}>${p.name}</option>`; }).join('');
  document.getElementById('report-detail').value = '';
  document.getElementById('modal-report').classList.add('on');
}
function selectReport(el, reason) { reportReason = reason; document.querySelectorAll('.report-opt').forEach(o => o.classList.remove('on')); el.classList.add('on'); }
async function submitReport() {
  if (!reportReason) { toast('Please select a reason', 'er'); return; }
  const pid = document.getElementById('report-peer').value;
  const detail = document.getElementById('report-detail').value.trim();
  await apiFetch('/store/report', { method: 'POST', body: { target_uid: pid, reason: reportReason, detail } });
  closeOvl('modal-report'); toast('Report submitted. We review within 24 hours.', 'ok');
}

// ── AI Insights Tab ────────────────────────────────────────────────────────
async function renderAIInsights() {
  const el = document.getElementById('tab-ai'); if (!el) return;
  const scoreEl = document.getElementById('ai-teaching-score');
  const feedEl = document.getElementById('ai-feedback-list');
  if (scoreEl) scoreEl.textContent = (ME.teaching_score || 0).toFixed(1) + '/10';
  if (feedEl) { feedEl.innerHTML = '<div style="font-size:.78rem;color:var(--t3)">Loading...</div>'; }
  try {
    const { recent_feedback, teaching_score, rep_score } = await apiFetch('/ai/my-score');
    if (scoreEl) scoreEl.textContent = (teaching_score || 0).toFixed(1) + '/10';
    const repEl = document.getElementById('ai-rep-score'); if (repEl) repEl.textContent = (rep_score || 0).toFixed(1);
    if (!feedEl) return;
    if (!recent_feedback || !recent_feedback.length) { feedEl.innerHTML = '<div class="empty"><div>Complete sessions to get AI feedback!</div></div>'; return; }
    feedEl.innerHTML = recent_feedback.map(f => {
      let fb = { summary: 'Good session!', suggestions: [] };
      try { fb = JSON.parse(f.feedback_text); } catch {
        fb = { summary: String(f.feedback_text || 'Good session!'), suggestions: [] };
      }
      return `<div class="card cp" style="margin-bottom:.65rem">
        <div style="display:flex;justify-content:space-between;margin-bottom:.5rem">
          <span style="font-size:.78rem;font-weight:700;color:var(--em)">Clarity: ${(f.clarity_score || 0).toFixed(1)}/10</span>
          <span style="font-size:.78rem;font-weight:700;color:var(--cy)">Engagement: ${(f.engagement_score || 0).toFixed(1)}/10</span>
        </div>
        <div style="font-size:.8rem;color:var(--t2);line-height:1.5">${fb.summary || ''}</div>
        ${(fb.suggestions || []).length ? `<div style="margin-top:.5rem"><div style="font-size:.7rem;color:var(--t3);font-weight:700;margin-bottom:.3rem">TIPS</div>${fb.suggestions.map(s => `<div style="font-size:.75rem;color:var(--t2);margin-bottom:.2rem">• ${s}</div>`).join('')}</div>` : ''}
      </div>`;
    }).join('');
  } catch (e) { if (feedEl) feedEl.innerHTML = '<div class="empty"><div>No AI feedback yet.</div></div>'; }
}

// ── Gamification ───────────────────────────────────────────────────────────
function checkLevelUp() {
  const oldLv = LEVELS.find(l => l.level === ME.level) || LEVELS[0];
  const newLv = getLevel();
  if (newLv.level > oldLv.level) { ME.level = newLv.level; showLevelUp(newLv); }
  checkBadges();
}
function showLevelUp(lv) {
  const el = document.getElementById('levelup');
  document.getElementById('lu-badge').style.cssText = `background:${lv.color}20;color:${lv.color};border:2px solid ${lv.color}40;`;
  document.getElementById('lu-badge').textContent = lv.name;
  document.getElementById('lu-sub').textContent = 'You reached ' + lv.name + '! Keep going!';
  const cf = document.getElementById('confetti-el'); cf.innerHTML = '';
  const cols = [lv.color, '#f59e0b', '#10b981', '#6366f1', '#ef4444'];
  for (let i = 0; i < 30; i++) { const p = document.createElement('div'); p.className = 'c-piece'; p.style.cssText = `left:${Math.random() * 100}%;top:${-10 + Math.random() * 10}px;background:${cols[i % cols.length]};animation-delay:${Math.random() * 1.5}s;animation-duration:${1.5 + Math.random()}s;transform:rotate(${Math.random() * 360}deg)`; cf.appendChild(p); }
  el.style.display = 'flex';
}
function checkBadges() {
  let changed = false;
  MY_BADGES.forEach(b => { if (!b.earned && b.chk(ME)) { b.earned = true; changed = true; toast('Badge unlocked: ' + b.name + '!', 'ok'); } });
  if (changed) {
    renderBadges();
    const hbEl = document.getElementById('h-badges');
    if(hbEl) hbEl.textContent = MY_BADGES.filter(b => b.earned).length;
  }
}

// ── Streak ─────────────────────────────────────────────────────────────────
function updateStreak() {
  const today = toDateStr(new Date());
  if (ME.last_active === today) return;
  const yesterday = toDateStr(addDays(new Date(), -1));
  ME.streak = ME.last_active === yesterday ? (ME.streak || 0) + 1 : 1;
  ME.last_active = today;
}

// ── Toast ──────────────────────────────────────────────────────────────────
let toastTm = null;
function toast(msg, type = 'ok') {
  const el = document.getElementById('toast-el');
  document.getElementById('toast-msg').textContent = msg;
  el.className = 'toast ' + (type === 'er' ? 'er' : 'ok') + ' on';
  if (toastTm) clearTimeout(toastTm);
  toastTm = setTimeout(() => el.classList.remove('on'), 3000);
}

// ── Overlay helpers ────────────────────────────────────────────────────────
function closeOvl(id) { document.getElementById(id).classList.remove('on'); }

// ── WebSocket Handlers ─────────────────────────────────────────────────────
function setupWSHandlers() {
  onWS('chat_message', onIncomingChat);
  onWS('quiz_push', showQuizPopup);
  onWS('quiz_result', onQuizResult);
  onWS('student_answered', onStudentAnswered);
  onWS('live_transcript', onIncomingTranscript);
  onWS('new_request', () => { apiFetch('/requests').then(r => { MY_REQS = r.requests || []; syncUI(); }); });
  onWS('session_event', (msg) => {
    if (msg.event === 'live') {
      apiFetch('/sessions').then(r => { MY_SESS = r.sessions || []; renderSessions(); });
    }
    // Mastery events sent by the student side
    if (msg.event === 'question_mastered' && msg.data?.question_id) {
      masteryMap[msg.data.question_id] = 'correct';
      if (typeof renderTeacherQuizPanel === 'function') renderTeacherQuizPanel();
      if (typeof updateMasteryBar === 'function') updateMasteryBar();
    }
    if (msg.event === 'reteach_needed' && msg.data?.question_id) {
      masteryMap[msg.data.question_id] = 'wrong';
      if (typeof renderTeacherQuizPanel === 'function') renderTeacherQuizPanel();
      if (typeof updateMasteryBar === 'function') updateMasteryBar();
      toast('🔴 Student got it wrong — re-explain then re-push the question!', 'er');
    }
  });
  onWS('online_count', (msg) => {
    // Update home tab online count
    const oc = document.getElementById('online-count');
    if (oc) oc.textContent = (msg.count || 0) + ' online';
    // Update analytics card
    const anOnline = document.getElementById('an-online');
    if (anOnline) anOnline.textContent = msg.count || 0;
  });
  onWS('room_peer_joined', (msg) => {
    if (typeof onRoomPeerJoined === 'function') onRoomPeerJoined(msg);
  });
}

// ── Init ───────────────────────────────────────────────────────────────────
async function init() {
  if (TOKEN) {
    try {
      const { user } = await apiFetch('/auth/me');
      ME = user; ME.subjects = Array.isArray(ME.subjects) ? ME.subjects : []; ME.ratings = Array.isArray(ME.ratings) ? ME.ratings : [];
      if (ME.is_new) { document.getElementById('scr-splash').classList.remove('on'); showOb(); }
      else { await loadAndLaunch(); document.getElementById('scr-splash').classList.remove('on'); }
      return;
    } catch { clearToken(); }
  }
  document.getElementById('scr-splash').classList.remove('on');
  document.getElementById('scr-auth').classList.add('on');
}

setTimeout(init, 1200);
document.querySelectorAll('.ovl').forEach(o => o.addEventListener('click', function (e) { if (e.target === this) this.classList.remove('on'); }));

// ── Analytics Rendering ─────────────────────────────────────────────────────
async function renderAnalytics() {
  try {
    const data = await apiFetch('/users/me/analytics');
    // Stat cards
    const sessEl    = document.getElementById('an-sessions');
    const kpEl      = document.getElementById('an-kp-earned');
    const accEl     = document.getElementById('an-accuracy');
    if (sessEl) sessEl.textContent = data.sessThisWeek ?? '0';
    if (kpEl)   kpEl.textContent   = '+' + (data.kpEarned ?? '0') + ' KP';
    if (accEl)  accEl.textContent   = data.quizAccuracy != null ? data.quizAccuracy + '%' : 'N/A';

    // Online count card (updated by WS, but bootstrap it here too)
    const onlineSnap = await apiFetch('/users/online').catch(() => ({ count: 0 }));
    const anOnline = document.getElementById('an-online');
    if (anOnline) anOnline.textContent = onlineSnap.count ?? 0;

    // Top subjects bar chart (CSS only)
    const chartEl = document.getElementById('an-subjects-chart');
    if (chartEl) {
      const subjects = data.topSubjects || [];
      if (!subjects.length) {
        chartEl.innerHTML = '<div style="font-size:.78rem;color:var(--t3);padding:.5rem">No sessions taught yet this week</div>';
      } else {
        const maxVal = subjects[0]?.[1] || 1;
        chartEl.innerHTML = subjects.map(([subj, count]) => `
          <div style="display:flex;align-items:center;gap:.65rem;margin-bottom:.55rem">
            <div style="font-size:.74rem;color:var(--t2);width:90px;text-overflow:ellipsis;overflow:hidden;white-space:nowrap;flex-shrink:0">${subj}</div>
            <div style="flex:1;background:rgba(255,255,255,.06);border-radius:50px;height:8px;overflow:hidden">
              <div style="width:${Math.round((count/maxVal)*100)}%;height:100%;background:var(--em);border-radius:50px;transition:width .6s ease"></div>
            </div>
            <div style="font-size:.72rem;font-weight:700;color:var(--em);min-width:20px;text-align:right">${count}</div>
          </div>`).join('');
      }
    }
  } catch { /* Analytics non-critical */ }
}

// ── Offline / Online detection ─────────────────────────────────────────────
(function setupOfflineBanner() {
  const banner = document.getElementById('offline-banner');
  if (!banner) return;
  function updateBanner() {
    banner.style.display = navigator.onLine ? 'none' : 'block';
    // Push content down so banner doesn't overlap UI
    document.body.style.paddingTop = navigator.onLine ? '' : '38px';
  }
  window.addEventListener('offline', updateBanner);
  window.addEventListener('online', () => {
    updateBanner();
    toast('Back online 🌐', 'ok');
  });
  updateBanner(); // Set initial state
})();

