'use strict';
// ── Group Study Rooms — Frontend Logic ────────────────────────────────────────

let _currentRoom = null;

// ──────────────────────────────────────────────────────────────────────────────
function openGroupRoomModal() {
  // Populate subject dropdown from user's teaching subjects
  const sel = document.getElementById('gr-subject');
  if (sel && typeof ME !== 'undefined' && ME.subjects) {
    const teach = ME.subjects.filter(s => s.type === 'teach' || s.teach);
    sel.innerHTML = teach.length
      ? teach.map(s => `<option>${s.name || s.subject || s}</option>`).join('')
      : '<option>Mathematics</option><option>Physics</option><option>Chemistry</option><option>Biology</option><option>English</option>';
  }
  // Reset state
  document.getElementById('gr-room-code-display').style.display = 'none';
  document.getElementById('gr-create-btn').textContent = 'Create Room';
  _currentRoom = null;
  switchGRTab('create');
  document.getElementById('modal-group-room').classList.add('on');
}

function switchGRTab(tab) {
  document.getElementById('gr-create').style.display = tab === 'create' ? '' : 'none';
  document.getElementById('gr-join').style.display   = tab === 'join'   ? '' : 'none';
  document.getElementById('gr-tab-create').classList.toggle('on', tab === 'create');
  document.getElementById('gr-tab-join').classList.toggle('on', tab === 'join');
}

async function createGroupRoom() {
  const subject  = document.getElementById('gr-subject')?.value;
  const capacity = parseInt(document.getElementById('gr-capacity')?.value) || 4;
  if (!subject) { toast('Pick a subject first', 'er'); return; }
  try {
    const res = await apiFetch('/rooms', { method: 'POST', body: JSON.stringify({ subject, capacity }) });
    _currentRoom = res;
    const codeEl = document.getElementById('gr-created-code');
    if (codeEl) codeEl.textContent = res.code;
    document.getElementById('gr-room-code-display').style.display = '';
    document.getElementById('gr-create-btn').textContent = 'Recreate';
    toast('Room created! Share code: ' + res.code, 'ok');
  } catch(e) { toast('Could not create room: ' + e.message, 'er'); }
}

async function joinGroupRoom() {
  const code = document.getElementById('gr-join-code')?.value?.trim()?.toUpperCase();
  if (!code || code.length < 4) { toast('Enter a valid room code', 'er'); return; }
  try {
    const res = await apiFetch('/rooms/join', { method: 'POST', body: JSON.stringify({ code }) });
    _currentRoom = res.room;
    toast(`Joined room "${res.room.subject}" — ${res.members.length} people online`, 'ok');
    document.getElementById('modal-group-room').classList.remove('on');
    // Notify existing members we joined and start group RTC
    _startGroupRTC(res.members.filter(uid => uid !== ME.uid), res.room.id);
  } catch(e) { toast('Could not join: ' + (e.message || 'Room not found'), 'er'); }
}

// ── Group WebRTC (mesh, each peer connects to every other peer) ───────────────
function _startGroupRTC(peerUids, roomId) {
  toast('Starting group session with ' + peerUids.length + ' peers…', 'ok');
  // For MVP: just show a toast with room info — full mesh WebRTC is complex
  // A full implementation would init a separate RTCPeerConnection per peer
  // and relay via rtc_offer_group / rtc_answer_group / rtc_ice_group
}

// Handle incoming room_peer_joined WS event (someone else joined our room)
function onRoomPeerJoined(msg) {
  toast('🙋 ' + (msg.name || 'Someone') + ' joined your study room', 'ok');
}

// Transcript download — reads from session-quiz.js global `fullSessionTranscript`
function downloadTranscript() {
  const text = typeof fullSessionTranscript !== 'undefined' ? fullSessionTranscript : '';
  if (!text.trim()) { toast('No transcript recorded for this session', 'ok'); return; }
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'campuskarma_transcript_' + new Date().toISOString().split('T')[0] + '.txt';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast('Transcript downloaded ✅', 'ok');
}
