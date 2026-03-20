'use strict';
// ── Chat State ─────────────────────────────────────────────────────────────
let activeChatPeer = null;
let chatMessages = {};

function ensureChatDoodleCanvas() {
  const tab = document.getElementById('tab-chat');
  if (!tab) return null;
  let c = tab.querySelector('canvas.chat-doodles-canvas');
  if (!c) {
    c = document.createElement('canvas');
    c.className = 'chat-doodles-canvas';
    c.style.cssText = 'position:absolute;inset:0;z-index:0;pointer-events:none;mix-blend-mode:screen;opacity:.30';
    tab.appendChild(c);
  }
  return c;
}

function mulberry32(seed) {
  return function () {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function seedFromString(s) {
  s = String(s || '');
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function drawChalkText(ctx, text, x, y, size, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.rotate(((Math.random() * 2) - 1) * 0.08);
  ctx.font = `${Math.max(10, size)}px monospace`;
  ctx.fillStyle = `rgba(255,255,255,${Math.min(0.35, alpha)})`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

function drawDoodlePrimitive(ctx, subjectId, kind, x, y, s, rot) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.scale(s, s);

  const alpha = 0.18; // chalk intensity
  ctx.lineWidth = 2;
  ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
  ctx.fillStyle = `rgba(255,255,255,${alpha})`;

  function roundRectPath(rx, ry, rw, rh, r) {
    const rr = Math.max(0, Math.min(r, Math.min(rw, rh) / 2));
    ctx.beginPath();
    ctx.moveTo(rx + rr, ry);
    ctx.arcTo(rx + rw, ry, rx + rw, ry + rh, rr);
    ctx.arcTo(rx + rw, ry + rh, rx, ry + rh, rr);
    ctx.arcTo(rx, ry + rh, rx, ry, rr);
    ctx.arcTo(rx, ry, rx + rw, ry, rr);
    ctx.closePath();
  }

  // Each subject has a set of "kind" icons. They are intentionally small + separated.
  if (subjectId === 'math') {
    if (kind === 0) {
      // right-angle triangle
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(28, 0);
      ctx.lineTo(0, 22);
      ctx.closePath();
      ctx.stroke();
    } else if (kind === 1) {
      // graph axes + one curve
      ctx.beginPath();
      ctx.moveTo(-16, 12); ctx.lineTo(18, 12);
      ctx.moveTo(-16, 12); ctx.lineTo(-16, -14);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-10, 8);
      ctx.bezierCurveTo(-2, 2, 4, 2, 12, -6);
      ctx.stroke();
    } else if (kind === 2) {
      // pi symbol
      ctx.font = '18px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('π', 0, 0);
    } else if (kind === 3) {
      // parabola arc
      ctx.beginPath();
      ctx.moveTo(-16, 10);
      ctx.quadraticCurveTo(0, -8, 16, 10);
      ctx.stroke();
    }
  } else if (subjectId === 'phy') {
    if (kind === 0) {
      // atom (circle + orbit)
      ctx.beginPath();
      ctx.arc(0, 0, 14, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(0, 0, 22, 10, 0.7, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(7, -4, 3, 0, Math.PI * 2);
      ctx.fill();
    } else if (kind === 1) {
      // arrow / motion
      ctx.beginPath();
      ctx.moveTo(-18, 0);
      ctx.lineTo(18, 0);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(10, -7);
      ctx.lineTo(18, 0);
      ctx.lineTo(10, 7);
      ctx.stroke();
    } else if (kind === 2) {
      // lens/beam
      ctx.beginPath();
      ctx.arc(-2, -4, 8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-22, 0);
      ctx.quadraticCurveTo(-2, -12, 22, 0);
      ctx.stroke();
    } else if (kind === 3) {
      // F=ma text
      ctx.font = '16px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('F=ma', 0, 0);
    }
  } else if (subjectId === 'chem') {
    if (kind === 0) {
      // flask
      ctx.beginPath();
      ctx.moveTo(-10, 14);
      ctx.lineTo(-6, -2);
      ctx.quadraticCurveTo(0, -18, 6, -2);
      ctx.lineTo(10, 14);
      ctx.quadraticCurveTo(0, 18, -10, 14);
      ctx.stroke();
    } else if (kind === 1) {
      // reaction arrow
      ctx.beginPath();
      ctx.moveTo(-18, 0);
      ctx.lineTo(10, 0);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(6, -7);
      ctx.lineTo(18, 0);
      ctx.lineTo(6, 7);
      ctx.stroke();
    } else if (kind === 2) {
      // small molecule cluster
      ctx.beginPath();
      ctx.arc(-6, 0, 3, 0, Math.PI * 2);
      ctx.arc(6, 0, 3, 0, Math.PI * 2);
      ctx.arc(0, -6, 3, 0, Math.PI * 2);
      ctx.stroke();
    } else if (kind === 3) {
      // label
      ctx.font = '16px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('pH', 0, 0);
    }
  } else if (subjectId === 'cs') {
    if (kind === 0) {
      // angle brackets
      ctx.beginPath();
      ctx.moveTo(-12, -12);
      ctx.lineTo(-2, 0);
      ctx.lineTo(-12, 12);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(12, -12);
      ctx.lineTo(2, 0);
      ctx.lineTo(12, 12);
      ctx.stroke();
    } else if (kind === 1) {
      // binary digits
      ctx.font = '18px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('0101', 0, 0);
    } else if (kind === 2) {
      // small node graph
      ctx.beginPath();
      ctx.arc(-10, 0, 3, 0, Math.PI * 2);
      ctx.arc(0, -10, 3, 0, Math.PI * 2);
      ctx.arc(10, 0, 3, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-10, 0);
      ctx.lineTo(0, -10);
      ctx.lineTo(10, 0);
      ctx.stroke();
    } else if (kind === 3) {
      // flow arrow
      ctx.beginPath();
      ctx.moveTo(-14, 0);
      ctx.lineTo(14, 0);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(6, -7);
      ctx.lineTo(14, 0);
      ctx.lineTo(6, 7);
      ctx.stroke();
    }
  } else if (subjectId === 'bio') {
    if (kind === 0) {
      // cell box
      ctx.beginPath();
      roundRectPath(-14, -12, 28, 24, 10);
      ctx.stroke();
    } else if (kind === 1) {
      // DNA helix lines
      ctx.beginPath();
      ctx.moveTo(-16, 10);
      ctx.bezierCurveTo(-8, -2, -8, 2, 0, -10);
      ctx.bezierCurveTo(8, -2, 8, 2, 16, 10);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-16, -2);
      ctx.bezierCurveTo(-8, -10, -8, -6, 0, -14);
      ctx.bezierCurveTo(8, -10, 8, -6, 16, -2);
      ctx.stroke();
    } else if (kind === 2) {
      // small enzyme lock
      ctx.beginPath();
      ctx.arc(0, 0, 10, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-14, 0);
      ctx.lineTo(14, 0);
      ctx.stroke();
    } else if (kind === 3) {
      // label
      ctx.font = '16px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('DNA', 0, 0);
    }
  } else if (subjectId === 'eng') {
    if (kind === 0) {
      // quote marks
      ctx.font = '20px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('“”', 0, 0);
    } else if (kind === 1) {
      // book
      ctx.beginPath();
      ctx.rect(-14, -10, 28, 20);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, -10);
      ctx.lineTo(0, 10);
      ctx.stroke();
    } else if (kind === 2) {
      // pen diagonal
      ctx.beginPath();
      ctx.moveTo(-14, -8);
      ctx.lineTo(14, 8);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(6, 0);
      ctx.lineTo(14, 8);
      ctx.lineTo(10, 0);
      ctx.stroke();
    } else if (kind === 3) {
      ctx.font = '16px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('A=B', 0, 0);
    }
  } else if (subjectId === 'hist') {
    if (kind === 0) {
      // timeline tick
      ctx.beginPath();
      ctx.moveTo(-14, 0);
      ctx.lineTo(14, 0);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-2, -9);
      ctx.lineTo(-2, 9);
      ctx.stroke();
    } else if (kind === 1) {
      // scroll
      ctx.beginPath();
      roundRectPath(-16, -12, 32, 24, 10);
      ctx.stroke();
    } else if (kind === 2) {
      // arrow chain
      ctx.beginPath();
      ctx.moveTo(-14, 0);
      ctx.lineTo(2, 0);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-2, -7);
      ctx.lineTo(10, 0);
      ctx.lineTo(-2, 7);
      ctx.stroke();
    } else if (kind === 3) {
      ctx.font = '16px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('→', 0, 0);
    }
  } else if (subjectId === 'geo') {
    if (kind === 0) {
      // compass
      ctx.beginPath();
      ctx.arc(0, 0, 16, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(10, 0);
      ctx.stroke();
    } else if (kind === 1) {
      // coordinate axes
      ctx.beginPath();
      ctx.moveTo(-16, 0);
      ctx.lineTo(16, 0);
      ctx.moveTo(0, -16);
      ctx.lineTo(0, 16);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(8, -8, 3, 0, Math.PI * 2);
      ctx.stroke();
    } else if (kind === 2) {
      // angle marker
      ctx.beginPath();
      ctx.moveTo(-14, 0);
      ctx.lineTo(-2, 0);
      ctx.lineTo(-2, -12);
      ctx.stroke();
    } else if (kind === 3) {
      ctx.font = '16px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Δ', 0, 0);
    }
  } else {
    // default tiny dot
    ctx.beginPath();
    ctx.arc(0, 0, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function renderChatDoodleBackground(subjectId, peerUid) {
  const tab = document.getElementById('tab-chat');
  if (!tab) return;
  const canvas = ensureChatDoodleCanvas();
  if (!canvas) return;

  const rect = tab.getBoundingClientRect();
  const w = Math.max(320, Math.floor(rect.width));
  const h = Math.max(420, Math.floor(rect.height));
  canvas.width = w;
  canvas.height = h;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, w, h);

  const seed = seedFromString((peerUid || '') + '|' + (subjectId || ''));
  const rand = mulberry32(seed);

  // Density: fill the chat with many tiny elements, but keep them subtle.
  const base = Math.floor((w * h) / 12000);
  const count = Math.max(40, base); // ensure enough doodles even on small screens
  const safePad = 10;

  for (let i = 0; i < count; i++) {
    const kind = Math.floor(rand() * 4);
    const x = safePad + rand() * (w - safePad * 2);
    const y = safePad + rand() * (h - safePad * 2);
    const s = 0.7 + rand() * 0.8; // small scale variance
    const rot = (rand() * 2 - 1) * 0.9;

    // Add slight extra randomness for "unique" placement.
    ctx.save();
    // Slightly stronger chalk so elements are clearly visible
    ctx.globalAlpha = 0.30 + rand() * 0.18;
    drawDoodlePrimitive(ctx, subjectId, kind, x, y, s * 0.25, rot);
    ctx.restore();
  }
}

function hexToRgb(hex) {
  if (!hex) return { r: 16, g: 185, b: 129 };
  const h = String(hex).trim().replace('#', '');
  if (h.length !== 6) return { r: 16, g: 185, b: 129 };
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function hexToRgba(hex, alpha) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function findSubjectDefByName(name) {
  if (!name) return null;
  return SUBJECTS.find(s => (typeof s === 'string' ? s : s.n) === name) || null;
}

// Infer the "learning subject" between me and `peerUid`:
// peer teaches it AND I have it marked as learning.
function getConversationSubjectDef(peerUid) {
  const peer = ALL_USERS.find(u => u.uid === peerUid);
  if (!peer || !ME || !Array.isArray(ME.subjects) || !Array.isArray(peer.subjects)) return null;

  const myLearn = ME.subjects.filter(s => s.learn).map(s => s.name);
  const myTeach = ME.subjects.filter(s => s.teach).map(s => s.name);
  const peerTeach = peer.subjects.filter(s => s.teach).map(s => s.name);
  const peerLearn = peer.subjects.filter(s => s.learn).map(s => s.name);

  // Prefer the subject where peer is teaching and I am learning,
  // but also handle the reverse (I teach, peer learns).
  const match =
    peerTeach.find(n => myLearn.includes(n)) ||
    myTeach.find(n => peerLearn.includes(n)) ||
    peerTeach[0] ||
    myTeach[0] ||
    null;
  return findSubjectDefByName(match);
}

function openChatWith(uid){
  activeChatPeer=uid;
  goTab('chat', document.querySelector('[data-t=chat]'));
  renderChatWindow(uid);
}

async function renderChat(){
  const el=document.getElementById('chat-conv-list');if(!el)return;
  const conn=getConnected();
  if(!conn.length){el.innerHTML='<div class="empty" style="padding:2rem .5rem"><div>Connect with peers first!</div></div>';return;}
  el.innerHTML='';
  conn.forEach(uid=>{
    const p=ALL_USERS.find(u=>u.uid===uid)||{uid,name:'Peer',school:'',cls:''};
    const d=document.createElement('div');d.className='chat-conv-item'+(activeChatPeer===uid?' active':'');
    d.innerHTML=`${getAvatarHtml(uid, p.name, p.avatar, 36, .68)}
      <div class="chat-conv-info"><div class="chat-conv-name">${p.name}</div><div class="chat-conv-sub">${p.school}</div></div>
      <div class="chat-enc-badge" title="End-to-End Encrypted"><i class="ph-fill ph-lock-key"></i></div>`;
    d.onclick=()=>{ activeChatPeer=uid; document.querySelectorAll('.chat-conv-item').forEach(x=>x.classList.remove('active')); d.classList.add('active'); renderChatWindow(uid); };
    el.appendChild(d);
  });
  if(activeChatPeer) renderChatWindow(activeChatPeer);
}

async function renderChatWindow(uid){
  const panel=document.getElementById('chat-panel');
  const p=ALL_USERS.find(u=>u.uid===uid)||{uid,name:'Peer'};
  const subjectDef = getConversationSubjectDef(uid);

  // Apply subject theme to the whole chat tab (affects both header + list accents).
  const chatTab = document.getElementById('tab-chat');
  if (chatTab && subjectDef?.c) {
    chatTab.dataset.subject = subjectDef.id || '';
    chatTab.style.setProperty('--chat-accent', subjectDef.c);
    chatTab.style.setProperty('--chat-accent-emb', hexToRgba(subjectDef.c, 0.07));
    chatTab.style.setProperty('--chat-accent-embd', hexToRgba(subjectDef.c, 0.22));
  } else if (chatTab) {
    chatTab.dataset.subject = '';
    // Reset to defaults
    chatTab.style.removeProperty('--chat-accent');
    chatTab.style.removeProperty('--chat-accent-emb');
    chatTab.style.removeProperty('--chat-accent-embd');
  }

  const subjectLabel = subjectDef
    ? `${subjectDef.ic} ${subjectDef.n}`
    : `<i class="ph-fill ph-chalkboard"></i> Learning`;

  panel.innerHTML=`
    <div class="chat-header">
      ${getAvatarHtml(uid, p.name, p.avatar, 36, .68)}
      <div class="chat-header-info"><div class="chat-header-name">${p.name}</div>
        <div class="chat-header-sub">${subjectLabel} · <i class="ph-fill ph-lock-key"></i> Encrypted</div></div>
    </div>
    <div class="chat-msgs" id="chat-msgs-${uid}"></div>
    <div class="chat-input-row">
      <input class="chat-input" id="chat-input-${uid}" placeholder="Type a message…" onkeydown="if(event.key==='Enter')sendChat('${uid}')"/>
      <button class="btn-sm p chat-send-btn" onclick="sendChat('${uid}')">Send</button>
    </div>`;

  // Load history
  try{
    const rid=roomId(ME.uid,uid);
    const {messages}=await apiFetch('/chat/'+rid);
    chatMessages[uid]=messages||[];
    // Try to establish AES key
    await getOrEstablishAES(uid);
    renderChatMessages(uid);
    // Draw chalk doodles background for this subject.
    // Use peerUid so each conversation gets its own stable layout.
    renderChatDoodleBackground(subjectDef?.id, uid);
  }catch(e){console.warn('Chat load error',e);}
}

async function renderChatMessages(uid){
  const container=document.getElementById('chat-msgs-'+uid);if(!container)return;
  container.innerHTML='';
  const msgs=chatMessages[uid]||[];
  for(const m of msgs){
    let text=m.ciphertext;
    try{text=atob(m.ciphertext);}catch{}
    const isMine=m.sender_uid===ME.uid;
    const d=document.createElement('div');d.className='chat-bubble'+(isMine?' mine':'');
    d.innerHTML=`<div class="chat-text">${escHtml(text)}</div><div class="chat-meta">${isMine?'You':ALL_USERS.find(u=>u.uid===m.sender_uid)?.name||'Peer'} · ${new Date(m.ts).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</div>`;
    container.appendChild(d);
  }
  container.scrollTop=container.scrollHeight;
}

async function sendChat(uid){
  const inp=document.getElementById('chat-input-'+uid);if(!inp||!inp.value.trim())return;
  const text=inp.value.trim();inp.value='';
  const rid=roomId(ME.uid,uid);
  
  const ciphertext=btoa(text);
  const iv='none';
  const msgId='m_'+Date.now().toString(36);
  
  // Send via WebSocket (which also persists to DB on the server)
  wsSend({type:'chat_message',to:uid,room_id:rid,ciphertext,iv,id:msgId});
  // Add to local state
  if(!chatMessages[uid])chatMessages[uid]=[];
  chatMessages[uid].push({id:msgId,sender_uid:ME.uid,ciphertext,iv,ts:Date.now()});
  advanceQuest('chat_sent',1);
  renderChatMessages(uid);
}

function escHtml(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

// Handle incoming chat via WebSocket
function onIncomingChat(msg){
  if(!chatMessages[msg.from])chatMessages[msg.from]=[];
  chatMessages[msg.from].push({id:msg.id,sender_uid:msg.from,ciphertext:msg.ciphertext,iv:msg.iv,ts:msg.ts});
  if(activeChatPeer===msg.from) renderChatMessages(msg.from);
  else toast('New message from '+( ALL_USERS.find(u=>u.uid===msg.from)?.name||'peer'),'ok');
}

// Handle incoming public key (deprecated)
async function onPubKeyReceived(msg){}
