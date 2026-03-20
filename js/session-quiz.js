'use strict';
// ── Calendar / Sessions ────────────────────────────────────────────────────
function renderCal() {
  const el = document.getElementById('cal-el'); if (!el) return;
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const DNS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
  const y = calDate.getFullYear(), m = calDate.getMonth();
  const first = new Date(y, m, 1).getDay(), total = new Date(y, m + 1, 0).getDate();
  const today = new Date();
  const sessDates = new Set(MY_SESS.filter(s => s.status !== 'done').map(s => s.date));
  let cells = DNS.map(d => `<div class="cal-dn">${d}</div>`).join('');
  for (let i = 0; i < first; i++)cells += `<div class="cday other"></div>`;
  for (let day = 1; day <= total; day++) {
    const ds = `${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const isTd = today.getFullYear() === y && today.getMonth() === m && today.getDate() === day;
    const isSel = selDate === ds, hasEv = sessDates.has(ds);
    const cls = ['cday', isTd ? 'today' : '', isSel ? 'sel' : '', hasEv ? 'has-ev' : ''].filter(Boolean).join(' ');
    cells += `<div class="${cls}" onclick="selectDay('${ds}')">${day}</div>`;
  }
  el.innerHTML = `<div class="cal-nav"><div class="cal-nav-btn" onclick="calNav(-1)">◀</div><div class="cal-mon">${MONTHS[m]} ${y}</div><div class="cal-nav-btn" onclick="calNav(1)">▶</div></div><div class="cal-grid">${cells}</div>`;
  renderSessions();
}
function calNav(d) { calDate = new Date(calDate.getFullYear(), calDate.getMonth() + d, 1); renderCal(); }
function selectDay(ds) { selDate = selDate === ds ? null : ds; renderCal(); }

// Whether the user has opted into seeing past sessions
let showSessHistory = false;

function sessDateTime(s) {
  if (!s.date) return new Date(0); // treat no-date sessions as very old
  // time may be "HH:MM" or "HH:MM:SS" — normalise to "HH:MM"
  const t = (s.time || '00:00').replace(/^(\d{2}:\d{2})(:\d{2})?$/, '$1');
  return new Date(s.date + 'T' + t + ':00');
}

function renderSessions() {
  const el = document.getElementById('sess-list'); if (!el) return;
  const now = new Date();

  let base = selDate ? MY_SESS.filter(s => s.date === selDate) : MY_SESS;

  // Today as YYYY-MM-DD string (date-only, no time)
  const todayStr = now.getFullYear() + '-' +
    String(now.getMonth()+1).padStart(2,'0') + '-' +
    String(now.getDate()).padStart(2,'0');

  // A session is "historic" if it's already 'done' or its date is strictly before today
  // (Today's upcoming/live sessions stay visible regardless of time)
  const isExpired = s =>
    s.status === 'done' ||
    (!s.date || s.date < todayStr);


  let active  = base.filter(s => !isExpired(s));
  let history = base.filter(s => isExpired(s));

  // Sort active: live first → then by nearest date+time
  active.sort((a, b) => {
    if (a.status === 'live' && b.status !== 'live') return -1;
    if (b.status === 'live' && a.status !== 'live') return 1;
    return sessDateTime(a) - sessDateTime(b);
  });
  // Sort history: most-recent first
  history.sort((a, b) => sessDateTime(b) - sessDateTime(a));

  const list = showSessHistory ? [...active, ...history] : active;
  const DAY = ['Su','Mo','Tu','We','Th','Fr','Sa'];
  const fmt12 = t => {
    if (!t || t.includes('M')) return t || '—';
    const [h, m] = t.split(':');
    const ap = +h >= 12 ? 'PM' : 'AM';
    return `${+h % 12 || 12}:${m} ${ap}`;
  };

  el.innerHTML = '';

  if (!list.length) {
    el.innerHTML = `<div class="empty"><div>No upcoming sessions${selDate ? ' on this date' : ''}</div><button class="btn-sm p" style="margin-top:.5rem" onclick="openBookModal()">Book Session</button></div>`;
  } else {
    list.forEach((s, idx) => {
      // Insert "Past Sessions" divider when history starts
      if (showSessHistory && active.length && idx === active.length) {
        const div = document.createElement('div');
        div.style.cssText = 'font-size:.7rem;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:.8px;padding:.75rem 0 .3rem;border-top:1px solid var(--bd);margin-top:.35rem';
        div.textContent = 'Past Sessions';
        el.appendChild(div);
      }

      const pUid = s.peer1 === ME.uid ? s.peer2 : s.peer1;
      const p = ALL_USERS.find(u => u.uid === pUid) || { uid: pUid, name: 'Peer' };
      const dt = sessDateTime(s);
      const past = isExpired(s) && s.status !== 'live';

      const sp = s.status === 'live'
        ? '<span class="pill r"><span class="blink"></span>Live</span>'
        : s.status === 'done'
          ? '<span class="pill g">Done</span>'
          : past
            ? '<span class="pill" style="background:var(--s3);color:var(--t3)">Expired</span>'
            : '<span class="pill a">Upcoming</span>';

      const d = document.createElement('div');
      d.className = 'sess-card' + (past ? ' sess-past' : '');
      const validDt = dt.getTime && !isNaN(dt.getTime());
      const dayStr  = validDt ? DAY[dt.getDay()] : '—';
      const dateStr = validDt ? `${dt.getDate()}/${dt.getMonth()+1}` : '—';
      d.innerHTML = `<div class="s-time-col">
          <div class="sday">${dayStr}</div>
          <div class="sdate-num">${dateStr}</div>
          <div class="stime">${fmt12(s.time)}</div>
        </div>
        <div class="s-body">
          <div class="s-name">${p.name}</div>
          <div class="s-subj">${s.subject}</div>${sp}
          <div class="s-acts">
            ${s.status === 'live' ? `<button class="btn-sm p" onclick="startVid('${pUid}','${s.subject}','${s.id}')">Join</button>` : ''}
            ${s.status === 'upcoming' && !past ? `<button class="btn-sm o" onclick="cancelSess('${s.id}')">Cancel</button>` : ''}
            ${s.status === 'done' && !s.rated ? `<button class="btn-sm a" onclick="openRate('${s.id}')">Rate</button>` : ''}
          </div>
        </div>`;
      el.appendChild(d);
    });
  }

  // History toggle button — Phosphor icon, no emoji
  if (history.length) {
    const btn = document.createElement('button');
    btn.className = 'sess-history-btn';
    btn.innerHTML = showSessHistory
      ? `<i class="ph ph-eye-slash"></i> Hide History`
      : `<i class="ph ph-clock-counter-clockwise"></i> View History (${history.length})`;
    btn.onclick = () => { showSessHistory = !showSessHistory; renderSessions(); };
    el.appendChild(btn);
  }

}


async function cancelSess(id) {
  try {
    await apiFetch('/sessions/' + id, { method: 'DELETE' });
    MY_SESS = MY_SESS.filter(s => s.id !== id); renderCal(); toast('Session cancelled', 'ok');
  } catch (e) { toast('Could not cancel: ' + e.message, 'er'); }
}

// ── Book Modal ─────────────────────────────────────────────────────────────
function openBookModal(peerId) {
  const conn = getConnected();
  if (!conn.length) { toast('Connect with a peer first', 'er'); return; }
  const sel = document.getElementById('bk-peer');
  sel.innerHTML = conn.map(uid => { const p = ALL_USERS.find(u => u.uid === uid) || { uid, name: 'Peer' }; return `<option value="${uid}"${uid === peerId ? ' selected' : ''}>${p.name}</option>`; }).join('');
  updateBkSubj();
  document.getElementById('bk-date').value = selDate || toDateStr(new Date());
  document.getElementById('bk-time').value = '16:00';
  document.getElementById('modal-book').classList.add('on');
}
function updateBkSubj() { const uid = document.getElementById('bk-peer').value; const p = ALL_USERS.find(u => u.uid === uid); const subjNames = SUBJECTS.map(s => typeof s === 'string' ? s : s.n); const all = [...new Set([...(p?.subjects || []).map(s => s.name), ...subjNames])]; document.getElementById('bk-subj').innerHTML = all.map(s => `<option>${s}</option>`).join(''); }

async function confirmBook() {
  const peer2 = document.getElementById('bk-peer').value;
  const subject = document.getElementById('bk-subj').value;
  const date = document.getElementById('bk-date').value;   // YYYY-MM-DD from <input type="date">
  const rawTime = document.getElementById('bk-time').value; // HH:MM from <input type="time">
  const role = document.getElementById('bk-role').value;
  if (!peer2) { toast('Please select a partner', 'er'); return; }
  if (!date) { toast('Please select a date', 'er'); return; }
  if (!rawTime) { toast('Please select a time', 'er'); return; }
  const time = rawTime;
  try {
    const { session } = await apiFetch('/sessions', { method: 'POST', body: { peer2, subject, date, time, role1: role } });
    if (!session) throw new Error('Session not returned from server');
    const newSess = { id: session.id, peer1: ME.uid, peer2, subject, date, time, role1: role, status: 'upcoming', room_code: session.room_code, rated: false, booked_at: Date.now() };
    MY_SESS.unshift(newSess);
    if (role === 'learn') ME.kp = Math.max(0, (ME.kp || 0) - 50);
    advanceQuest('sessions_booked', 1); syncUI(); renderCal(); closeOvl('modal-book');
    toast('Session booked! Room: ' + session.room_code, 'ok');
  } catch (e) { toast('Session failed: ' + e.message, 'er'); }
}

// ── Request Modal ──────────────────────────────────────────────────────────
function openReqModal(peerId) {
  reqPeerId = peerId;
  const p = ALL_USERS.find(u => u.uid === peerId); if (!p) return;
  document.getElementById('req-peer-info').innerHTML = `<div style="display:flex;align-items:center;gap:.85rem;padding:.85rem;background:var(--s2);border:1px solid var(--bd);border-radius:var(--r2)">${getAvatarHtml(p.uid, p.name, p.avatar, 40, .72)}<div><div style="font-size:.88rem;font-weight:700">${p.name}</div><div style="font-size:.72rem;color:var(--t2)">${p.cls} · ${p.school}</div></div></div>`;
  const allS = [...new Set([...myTeach(), ...(p.subjects || []).filter(s => s.learn).map(s => s.name)])];
  const subjNames = SUBJECTS.map(s => typeof s === 'string' ? s : s.n);
  document.getElementById('req-subj').innerHTML = (allS.length ? allS : subjNames).map(s => `<option>${s}</option>`).join('');
  document.getElementById('req-note').value = '';
  document.getElementById('modal-req').classList.add('on');
}

async function confirmReq() {
  const pid = reqPeerId;
  const subj = document.getElementById('req-subj').value;
  const note = document.getElementById('req-note').value.trim();
  try {
    const { request } = await apiFetch('/requests', { method: 'POST', body: { to_uid: pid, subject: subj, note } });
    MY_REQS.push(request); ME.xp = (ME.xp || 0) + 10;
    advanceQuest('requests_sent', 1); syncUI(); renderDiscover(); closeOvl('modal-req');
    toast('Request sent!', 'ok');
  } catch (e) { toast(e.message, 'er'); }
}

// ── Video Call ─────────────────────────────────────────────────────────────
let videoQuestions = []; let currentQuizQ = null; let quizAnsweredCount = 0; let quizCorrectCount = 0;
let recognition = null; let fullSessionTranscript = ""; let isMicMuted = false;
// Mastery tracking state
let masteryMap = {}; // { [question_id]: 'pending' | 'wrong' | 'correct' }
let totalPushed = 0;
let isTeacherSide = false; // whether this client should generate/push quiz questions + finalize AI scoring

// ── Mastery Helpers ─────────────────────────────────────────────────────────
function isMasteryComplete() {
  if (totalPushed === 0) return true; // no questions pushed = open session
  return Object.keys(masteryMap).length === totalPushed &&
    Object.values(masteryMap).every(s => s === 'correct');
}

function updateMasteryBar() {
  const bar = document.getElementById('mastery-bar');
  const label = document.getElementById('mastery-label');
  const endBtn = document.getElementById('vc-end');
  if (!bar || !label) return;
  const correctCount = Object.values(masteryMap).filter(s => s === 'correct').length;
  const pct = totalPushed > 0 ? Math.round((correctCount / totalPushed) * 100) : 0;
  bar.style.width = pct + '%';
  const allDone = isMasteryComplete();
  bar.style.background = totalPushed === 0 ? 'var(--cy)' : allDone ? 'var(--em)' : correctCount > 0 ? 'var(--am)' : 'var(--rd)';
  const icon = totalPushed === 0 ? '' : allDone ? '🏆 ' : '📝 ';
  label.textContent = totalPushed === 0
    ? 'No quiz questions yet'
    : allDone ? '100% Mastered!'
      : `${icon}${correctCount}/${totalPushed} Mastered (${pct}%)`;
  // Lock/unlock End Call
  if (endBtn) {
    endBtn.disabled = !allDone;
    endBtn.title = allDone ? 'End session' : 'Student must master all questions first';
    endBtn.style.opacity = allDone ? '1' : '0.45';
    endBtn.style.cursor = allDone ? 'pointer' : 'not-allowed';
  }
}

async function startVid(peerId, subject, sessId) {
  const p = ALL_USERS.find(u => u.uid === peerId) || { uid: peerId, name: 'Peer' };
  activeVid = { peerId, subject, sessId }; sessionStartTime = Date.now();
  videoQuestions = []; quizAnsweredCount = 0; quizCorrectCount = 0;
  masteryMap = {}; totalPushed = 0;
  isMicMuted = false;
  // Determine whether current user is the "teacher" side for this session.
  const sess = (sessId && typeof MY_SESS !== 'undefined') ? MY_SESS.find(s => s.id === sessId) : null;
  if (sess) {
    const teacherUid = sess.role1 === 'teach' ? sess.peer1 : sess.peer2;
    isTeacherSide = teacherUid === ME.uid;
  } else {
    // Fallback: if we can't resolve the session record, allow teacher features.
    isTeacherSide = true;
  }
  document.getElementById('vid-pname').textContent = p.name;
  document.getElementById('vid-subj').textContent = subject;
  // Avatar fallback (shown until remote stream arrives)
  const mav = document.getElementById('vid-main-av');
  mav.style.cssText = avStyle(p.uid, p.name, 80, 1.4); mav.textContent = initials(p.name); mav.style.display = '';
  document.getElementById('vid-blank').style.display = 'none';
  document.getElementById('vid-active').style.display = 'flex';
  goTab('vid', document.querySelector('[data-t=vid]'));
  document.getElementById('vid-timer').textContent = '00:00';
  // Reset control buttons
  document.getElementById('vc-mic').className = 'vc on';
  document.getElementById('vc-cam').className = 'vc on';
  let sec = 0; vidInterval = setInterval(() => { sec++; document.getElementById('vid-timer').textContent = String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0'); }, 1000);
  pomoSecs = 25 * 60; pomoRunning = false; document.getElementById('pomo-timer').textContent = '25:00';
  // Kick off real WebRTC P2P connection
  initRTC(peerId, sessId, subject);
  // Load pre-generated questions only for the teacher.
  const panel = document.getElementById('teacher-quiz-panel');
  if (panel) panel.style.display = isTeacherSide ? '' : 'none';
  if (sessId && isTeacherSide) {
    try {
      const r = await apiFetch('/quiz/generate', { method: 'POST', body: { session_id: sessId, subject } });
      videoQuestions = r.questions || [];
    } catch { videoQuestions = []; }
  }
  if (isTeacherSide) renderTeacherQuizPanel();
  updateMasteryBar();
  startWebSpeechSTT(peerId);
}

function startWebSpeechSTT(peerId) {
  if (!('webkitSpeechRecognition' in window)) return;
  recognition = new webkitSpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = 'en-US'; // We could make this dynamic for multilingual

  recognition.onresult = (event) => {
    if (isMicMuted) return;
    let interimTrans = '';
    let finalTrans = '';
    for (let i = event.resultIndex; i < event.results.length; ++i) {
      if (event.results[i].isFinal) finalTrans += event.results[i][0].transcript;
      else interimTrans += event.results[i][0].transcript;
    }

    if (finalTrans) {
      fullSessionTranscript += finalTrans + " ";
      wsSend({ type: 'live_transcript', to: peerId, text: finalTrans, isFinal: true });
      showSubtitles('You: ' + finalTrans);
    } else if (interimTrans) {
      wsSend({ type: 'live_transcript', to: peerId, text: interimTrans, isFinal: false });
      showSubtitles('You: ' + interimTrans);
    }
  };

  recognition.onend = () => {
    if (activeVid && !isMicMuted) {
      console.log("Restarting STT for stability...");
      try { recognition.start(); } catch (e) { }
    }
  };

  try { recognition.start(); } catch (e) {
    console.warn("STT Start failed, retrying in 2s...");
    setTimeout(() => { if (activeVid && !isMicMuted) startWebSpeechSTT(peerId); }, 2000);
  }
}

function showSubtitles(text) {
  const subBox = document.getElementById('vid-subtitles');
  if (!subBox) return;
  subBox.textContent = text;
  subBox.style.opacity = '1';
  clearTimeout(window._subTm);
  window._subTm = setTimeout(() => subBox.style.opacity = '0', 4000);
}

function onIncomingTranscript(msg) {
  if (!activeVid) return;
  const p = ALL_USERS.find(u => u.uid === msg.from);
  const name = p ? p.name.split(' ')[0] : 'Peer';
  showSubtitles(name + ': ' + msg.text);
  if (msg.isFinal) {
    fullSessionTranscript += `${name}: ${msg.text}\n`;
  }
}

function renderTeacherQuizPanel() {
  const panel = document.getElementById('teacher-quiz-panel'); if (!panel) return;
  if (!videoQuestions.length) { panel.innerHTML = '<div style="font-size:.75rem;color:var(--t3)">No questions loaded</div>'; return; }
  panel.innerHTML = videoQuestions.map((q, i) => {
    const state = masteryMap[q.id];
    const stateIcon = !state ? '' : state === 'correct' ? ' <span style="color:var(--em)">✅</span>' : ' <span style="color:var(--rd)">❌</span>';
    const isPushed = !!state;
    const isCorrect = state === 'correct';
    return `<div class="quiz-q-item" id="qqitem-${i}" style="border-left:3px solid ${isCorrect ? 'var(--em)' : isPushed ? 'var(--rd)' : 'var(--bd)'}">
      <div style="font-size:.75rem;font-weight:600;margin-bottom:.35rem">${q.question}${stateIcon}</div>
      ${isCorrect
        ? '<span style="font-size:.67rem;color:var(--em)"><i class="ph ph-check-circle"></i> Mastered</span>'
        : isPushed
          ? `<button class="btn-sm r" style="font-size:.68rem" onclick="pushQuizQuestion(${i})">🔴 Re-push (Re-explain first)</button>`
          : `<button class="btn-sm p" style="font-size:.68rem" onclick="pushQuizQuestion(${i})">Push to Student</button>`}
    </div>`;
  }).join('');
}

async function pushQuizQuestion(idx) {
  if (!activeVid) return;
  if (!isTeacherSide) return;
  currentQuizQ = videoQuestions[idx];
  const { peerId, sessId } = activeVid;
  // Track mastery state: set to pending if not already correct
  if (masteryMap[currentQuizQ.id] !== 'correct') {
    if (!masteryMap[currentQuizQ.id]) totalPushed++; // first push only increments count
    masteryMap[currentQuizQ.id] = 'pending';
  }
  await apiFetch('/quiz/push', { method: 'POST', body: { question_id: currentQuizQ.id } });
  let opts = [];
  try {
    opts = Array.isArray(currentQuizQ.options) ? currentQuizQ.options : JSON.parse(currentQuizQ.options || '[]');
  } catch {
    opts = [];
  }
  wsSend({ type: 'quiz_push', to: peerId, session_id: sessId, question_id: currentQuizQ.id, question: currentQuizQ.question, options: opts, time_limit: 30 });
  toast('Quiz question pushed to student!', 'ok');
  renderTeacherQuizPanel();
  updateMasteryBar();
}

// Student receives quiz via WS
function showQuizPopup(msg) {
  const popup = document.getElementById('quiz-popup');
  document.getElementById('qp-question').textContent = msg.question;
  const opts = document.getElementById('qp-options'); opts.innerHTML = '';
  (msg.options || []).forEach((opt, i) => {
    const btn = document.createElement('button'); btn.className = 'qp-opt-btn'; btn.textContent = opt;
    btn.onclick = () => submitQuizAnswer(msg.question_id, i, msg.from);
    opts.appendChild(btn);
  });
  // Timer
  let t = msg.time_limit || 30; document.getElementById('qp-timer').textContent = t + 's';
  if (window._quizTm) clearInterval(window._quizTm);
  window._quizTm = setInterval(() => { t--; document.getElementById('qp-timer').textContent = t + 's'; if (t <= 0) { clearInterval(window._quizTm); submitQuizAnswer(msg.question_id, -1, msg.from); } }, 1000);
  popup.classList.add('on');
}

async function submitQuizAnswer(questionId, answerIdx, teacherUid) {
  if (window._quizTm) clearInterval(window._quizTm);
  document.getElementById('quiz-popup').classList.remove('on');
  wsSend({ type: 'quiz_answer', question_id: questionId, answer_index: answerIdx, teacher_uid: teacherUid });
  // REST fallback only when WS isn't available.
  if (!wsIsOpen()) {
    try {
      const r = await apiFetch('/quiz/answer', { method: 'POST', body: { question_id: questionId, answer_index: answerIdx, teacher_uid: teacherUid } });
      quizAnsweredCount++;
      if (r.is_correct) {
        quizCorrectCount++;
        ME.xp = (ME.xp || 0) + (r.all_correct ? 60 : 10); // match existing UI semantics
        toast(r.all_correct ? '🏆 100% Mastered! +60 XP — session can now end!' : 'Correct! +10 XP 🎉', 'ok');
        if (activeVid) wsSend({ type: 'session_event', event: 'question_mastered', data: { question_id: questionId }, to: activeVid.peerId });
      } else {
        toast('❌ Incorrect — your teacher will re-explain and re-push!', 'er');
        if (activeVid) wsSend({ type: 'session_event', event: 'reteach_needed', data: { question_id: questionId }, to: activeVid.peerId });
      }
    } catch { }
  }
  syncUI();
}

function onStudentAnswered(msg) {
  const icon = msg.is_correct ? '<i class="ph-fill ph-check-circle"></i>' : '<i class="ph-fill ph-x-circle"></i>';
  toast(`Student answered ${icon} — ${msg.is_correct ? '+5 KP bonus!' : '🔴 Re-explain & re-push needed!'}`, msg.is_correct ? 'ok' : 'er');
  if (msg.is_correct) {
    ME.kp += 5; document.getElementById('sb-ukp').textContent = ME.kp + ' KP';
    // Mark this question correct in teacher's mastery map
    if (msg.question_id) masteryMap[msg.question_id] = 'correct';
  } else {
    if (msg.question_id) masteryMap[msg.question_id] = 'wrong';
  }
  renderTeacherQuizPanel();
  updateMasteryBar();
}

function onQuizResult(msg) {
  quizAnsweredCount++;
  if (msg.is_correct) {
    quizCorrectCount++;
    const xp = (typeof msg.xp_earned === 'number') ? msg.xp_earned : 10;
    ME.xp = (ME.xp || 0) + xp;
  }
  toast(msg.is_correct ? ('Correct! +' + ((typeof msg.xp_earned === 'number') ? msg.xp_earned : 10) + ' XP 🎉') : 'Wrong! Teacher will re-explain', 'er');
  syncUI();
}

function toggleVC(t) {
  const b = document.getElementById('vc-' + t); b.classList.toggle('on'); b.classList.toggle('off');
  const isOff = b.classList.contains('off');
  if (t === 'mic') {
    isMicMuted = isOff;
    muteAudio(isOff);                                         // mute the live stream track
    if (isOff && recognition) recognition.stop();
    else if (!isOff && recognition) try { recognition.start(); } catch (e) { }
  } else if (t === 'cam') {
    muteVideo(isOff);                                         // toggle camera track
  }
  toast(t === 'mic' ? (isOff ? 'Mic muted' : 'Mic on') : (isOff ? 'Camera off' : 'Camera on'), 'ok');
}
// Pomodoro logic moved to webrtc.js

async function endVid() {
  // ── Mastery Gate ───────────────────────────────────────────────────────────
  if (!isMasteryComplete()) {
    toast('⚠️ Student has not mastered all topics yet. Re-push unanswered/wrong questions first.', 'er');
    return;
  }
  // ──────────────────────────────────────────────────────────────────────────
  if (!confirm('End this session?')) return;
  clearInterval(vidInterval); window.pomoRunning = false; clearInterval(window.pomoInterval);
  if (recognition) { recognition.stop(); recognition = null; }
  await hangupRTC(true);
  document.getElementById('vid-blank').style.display = 'flex';
  document.getElementById('vid-active').style.display = 'none';
  document.getElementById('vc-mic').className = 'vc on';
  document.getElementById('vc-cam').className = 'vc on';
  // Hide the cam-off placeholder if visible
  const lp = document.getElementById('vid-local-placeholder'); if (lp) lp.style.display = 'none';
  const lv = document.getElementById('vid-local'); if (lv) lv.style.display = 'block';
  pomoRunning = false;
  if (!activeVid) return;
  const { peerId, subject, sessId } = activeVid;
  const durMin = Math.round((Date.now() - sessionStartTime) / 60000) || 1;
  const sessionMastered = isMasteryComplete() && totalPushed > 0;
  activeVid = null;

  // Teacher finalizes session AI feedback (hangup already applied the KP/XP baseline).
  if (sessId && isTeacherSide) {
    const pulse_checks_total = totalPushed;
    const pulse_checks_correct = Object.values(masteryMap).filter(s => s === 'correct').length;
    try {
      await apiFetch('/sessions/' + sessId + '/complete', {
        method: 'POST',
        body: {
          pulse_checks_total,
          pulse_checks_correct,
          transcript: fullSessionTranscript,
        }
      });
      toast('AI analysis ready! Check AI Insights tab.', 'ok');
    } catch (e) {
      console.warn('[session complete] failed:', e?.message || e);
      toast('AI feedback failed: ' + (e?.message || 'unknown error'), 'er');
    }
  }

  // Show session report
  showSessionReport(subject, durMin, sessionMastered);
  syncUI();
  setTimeout(() => { const si = MY_SESS.findIndex(s => (s.peer1 === ME.uid || s.peer2 === ME.uid) && !s.rated); if (si >= 0) openRate(MY_SESS[si].id); }, 1000);
}

function showSessionReport(subject, durMin, mastered = false) {
  const pulseTotal = isTeacherSide ? totalPushed : quizAnsweredCount;
  const pulseCorrect = isTeacherSide ? Object.values(masteryMap).filter(s => s === 'correct').length : quizCorrectCount;
  const pct = pulseTotal > 0 ? Math.round((pulseCorrect / pulseTotal) * 100) : 0;
  const bonusXP = mastered ? 50 : 0;
  document.getElementById('sr-subject').textContent = subject;
  document.getElementById('sr-duration').textContent = durMin + ' min';
  document.getElementById('sr-quiz').textContent = pulseCorrect + '/' + pulseTotal + ' Pulse Checks (' + pct + '% mastery)';
  document.getElementById('sr-xp').textContent = '+' + ((pulseCorrect * 10) + 100 + bonusXP) + ' XP earned this session';
  // Mastery badge
  const badge = document.getElementById('sr-mastery-badge');
  if (badge) {
    badge.style.display = mastered ? 'flex' : 'none';
    badge.innerHTML = mastered
      ? '<span style="font-size:1.4rem">🏆</span><div><div style="font-weight:700;color:var(--em)">Learning Verified!</div><div style="font-size:.72rem;color:var(--t2)">100% mastery achieved · +50 XP bonus</div></div>'
      : '';
  }
  document.getElementById('modal-session-report').classList.add('on');
}

// ── Rate Session ───────────────────────────────────────────────────────────
function openRate(sessId) { rateIdx = sessId; curStar = 0; setStar(0); document.getElementById('rate-txt').value = ''; document.getElementById('modal-rate').classList.add('on'); }
function setStar(n) { curStar = n; document.querySelectorAll('.star').forEach((s, i) => s.classList.toggle('on', i < n)); }
async function submitRate() {
  if (!curStar) { toast('Please select a rating', 'er'); return; }
  await apiFetch('/sessions/' + rateIdx, { method: 'PATCH', body: { rating: curStar } });
  const s = MY_SESS.find(x => x.id === rateIdx); if (s) { s.rated = 1; s.rating = curStar; }
  ME.kp += 15; ME.xp = (ME.xp || 0) + 20; checkLevelUp(); syncUI();
  closeOvl('modal-rate'); toast('Rating submitted! +15 KP', 'ok');
}
