// CampusKarma WebRTC Engine — No 'use strict' to avoid silent failures
// ─────────────────────────────────────────────────────────────────────

// Base STUN & TURN config (TURN is required for 5G/Mobile/Strict Networks)
const DEFAULT_ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  // Free Public TURN server for Hackathons (Metered OpenRelay)
  {
    urls: 'turn:openrelay.metered.ca:80',
    username: 'openrelayproject',
    credential: 'openrelayproject'
  },
  {
    urls: 'turn:openrelay.metered.ca:443',
    username: 'openrelayproject',
    credential: 'openrelayproject'
  },
  {
    urls: 'turn:openrelay.metered.ca:443?transport=tcp',
    username: 'openrelayproject',
    credential: 'openrelayproject'
  }
];

// Optional: window.RTC_ICE_SERVERS can be injected from server/HTML
// e.g. <script>window.RTC_ICE_SERVERS = [{ urls:'turn:...', username:'u', credential:'p' }]</script>
let ICE_SERVERS = DEFAULT_ICE_SERVERS;
try {
  if (window && Array.isArray(window.RTC_ICE_SERVERS) && window.RTC_ICE_SERVERS.length) {
    ICE_SERVERS = DEFAULT_ICE_SERVERS.concat(window.RTC_ICE_SERVERS);
  }
} catch (e) {
  // window not defined (e.g., during build); fall back to default
}

const RTC_CONFIG = {
  iceServers: ICE_SERVERS,
  iceCandidatePoolSize: 10,
};

let pc = null;
let localStream = null;
let remoteStream = null;
let recorder = null;
let recordChunks = [];
let isScreenSharing = false;

// Quality check interval
let qualityInterval = null;

// Whiteboard state
let wbCtx = null;
let wbState = { isDrawing: false, lastX: 0, lastY: 0, color: '#000', size: 3, tool: 'pen' };
let wbPointsBatch = [];
let wbBatchTimer = null;

// Signaling Queue
let iceQueue = [];
let earlyOffer = null;
let lastInitArgs = null;

// Active session state
let sessionTimer = null;
let sessionSeconds = 0;

// ==========================================
// SESSION UI MANAGEMENT
// ==========================================

async function startVid(peerId, subject, sessId) {
  if (!peerId) { toast('No peer ID provided', 'er'); return; }
  console.log('[startVid] called:', peerId, subject, sessId);

  activeVid = { peerId, sessId, subject };

  // 1. Navigate to Studio tab
  const vidNavEl = document.querySelector('[data-t=vid]');
  if (vidNavEl) goTab('vid', vidNavEl);

  // 2. Show active call UI
  const active = document.getElementById('vid-active');
  const blank  = document.getElementById('vid-blank');
  if (active) active.style.display = 'flex';
  if (blank)  blank.style.display  = 'none';

  // 3. Fill peer info labels
  const peerData = (typeof ALL_USERS !== 'undefined' && ALL_USERS.find(u => u.uid === peerId)) || { name: 'Peer' };
  const pname = document.getElementById('vid-pname');
  const vsubj = document.getElementById('vid-subj');
  if (pname) pname.textContent = peerData.name || 'Peer';
  if (vsubj) vsubj.textContent = subject || '';

  // 4. Start session timer
  sessionSeconds = 0;
  clearInterval(sessionTimer);
  sessionTimer = setInterval(() => {
    sessionSeconds++;
    const m = String(Math.floor(sessionSeconds / 60)).padStart(2, '0');
    const s = String(sessionSeconds % 60).padStart(2, '0');
    const el = document.getElementById('vid-timer');
    if (el) el.textContent = `${m}:${s}`;
  }, 1000);

  // 5. ── DIRECT CAMERA CAPTURE ──────────────────────────────────────────
  //    Do this HERE in startVid, not deep inside initRTC.
  //    This makes camera preview work independent of WebRTC peer connection.
  updateRTCStatus('Opening Camera...');
  let stream = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: { echoCancellation: true, noiseSuppression: true }
    });
  } catch (err) {
    console.error('[startVid] getUserMedia failed:', err.name, err.message);
    updateRTCStatus('Cam Error');
    const hint = err.name === 'NotAllowedError' ? 'Allow camera in browser permissions' :
                 err.name === 'NotFoundError'   ? 'No camera found on this device' :
                 err.name === 'NotReadableError'? 'Camera in use by another app' : err.message;
    // Show visible error in the video area
    const wrap = document.querySelector('.vid-wrap');
    if (wrap) {
      wrap.style.position = 'relative';
      const d = document.createElement('div');
      d.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,.9);z-index:50;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.75rem;text-align:center;padding:1.5rem;border-radius:inherit';
      d.innerHTML = `<div style="font-size:2rem">📷</div><b style="color:#fff;font-size:1rem">Camera blocked</b><div style="color:#aaa;font-size:.82rem">${hint}</div><button onclick="startVid('${peerId}','${subject}','${sessId}')" style="margin-top:.5rem;padding:.5rem 1.5rem;background:var(--em);color:#000;border:none;border-radius:8px;cursor:pointer;font-weight:700">Retry</button>`;
      wrap.appendChild(d);
    }
    toast('Camera error: ' + hint, 'er');
    return;
  }

  // 6. Camera opened! Attach to local video element right now
  localStream = stream;
  // Ensure mic is actually enabled for WebRTC transmission.
  // (Some UI flows can leave tracks disabled; enabling here is safe.)
  try { localStream.getAudioTracks().forEach(t => { t.enabled = true; }); } catch(e) {}
  const localVid = document.getElementById('vid-local');
  if (localVid) {
    localVid.srcObject = stream;
    localVid.style.display = 'block';
    try { await localVid.play(); } catch(e) { console.warn('[startVid] localVid.play() blocked:', e); }
    console.log('[startVid] ✅ Camera stream attached to #vid-local');
  } else {
    console.error('[startVid] ❌ #vid-local element not found in DOM!');
  }
  const placeholder = document.getElementById('vid-local-placeholder');
  if (placeholder) placeholder.style.display = 'none';

  // 7. Enable mic/cam buttons
  ['vc-mic', 'vc-cam'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) { btn.classList.add('on'); btn.classList.remove('off'); }
  });

  updateRTCStatus('Camera On ✓');

  // 8. Now start WebRTC peer connection (for remote video/audio)
  setTimeout(() => initRTC(peerId, sessId, subject), 500);
}

function endVid() {
  clearInterval(sessionTimer);
  sessionTimer = null;

  hangupRTC(true);
  activeVid = null;

  // Navigate back to sessions tab
  const active = document.getElementById('vid-active');
  const blank = document.getElementById('vid-blank');
  if (active) active.style.display = 'none';
  if (blank) blank.style.display = 'flex';

  const el = document.getElementById('vid-timer');
  if (el) el.textContent = '00:00';
}

function toggleVC(type) {
  const btnId = type === 'mic' ? 'vc-mic' : 'vc-cam';
  const btn = document.getElementById(btnId);
  if (!btn) return;
  const isOn = btn.classList.contains('on');
  if (isOn) {
    btn.classList.remove('on'); btn.classList.add('off');
    if (type === 'mic') muteAudio(true);
    else muteVideo(true);
  } else {
    btn.classList.remove('off'); btn.classList.add('on');
    if (type === 'mic') muteAudio(false);
    else muteVideo(false);
  }
}

// ==========================================
// TEST CAMERA (standalone preview)
// ==========================================

async function testMyCamera() {
  console.log('[testMyCamera] called');
  toast('Opening camera preview...', 'ok');

  // Use the existing PiP box for preview, or create a floating test modal
  let testStream = null;
  try {
    testStream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
      audio: true
    });
  } catch (err) {
    console.error('[testMyCamera] getUserMedia failed:', err.name, err.message);
    const msg = err.name === 'NotAllowedError' ? 'Permission denied. Click the camera icon in the address bar and Allow.' :
                err.name === 'NotFoundError' ? 'No camera detected. Check your hardware.' :
                err.name === 'NotReadableError' ? 'Camera is in use by another app. Close other video apps.' : err.message;
    toast('\u26a0\ufe0f Camera Error: ' + msg, 'er');
    return;
  }

  // Show a floating test modal with a live preview
  const existing = document.getElementById('cam-test-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'cam-test-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:9999;display:flex;align-items:center;justify-content:center;';
  modal.innerHTML = `
    <div style="background:var(--bg);border:1px solid var(--bd);border-radius:var(--r3);padding:1.5rem;max-width:480px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,.5)">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem">
        <div style="font-size:1rem;font-weight:700;color:var(--t1)"><i class="ph-fill ph-video-camera" style="color:var(--em)"></i> Camera & Mic Preview</div>
        <button id="cam-test-close" style="background:none;border:none;color:var(--t2);font-size:1.2rem;cursor:pointer">&#x2715;</button>
      </div>
      <video id="cam-test-vid" autoplay playsinline muted style="width:100%;border-radius:var(--r2);background:#000;aspect-ratio:4/3;transform:scaleX(-1)"></video>
      <div id="cam-test-status" style="margin-top:.75rem;font-size:.82rem;color:var(--em);text-align:center">Camera & Mic working perfectly!</div>
      <div style="margin-top:1rem;text-align:center">
        <button class="btn-p" id="cam-test-close-btn" style="width:100%">Close Preview</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const vidEl = document.getElementById('cam-test-vid');
  vidEl.srcObject = testStream;
  vidEl.play();

  // Audio level meter
  let audioCtx, analyser, animId;
  try {
    audioCtx = new AudioContext();
    const source = audioCtx.createMediaStreamSource(testStream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    const buf = new Uint8Array(analyser.frequencyBinCount);
    const statusEl = document.getElementById('cam-test-status');
    const checkAudio = () => {
      analyser.getByteFrequencyData(buf);
      const avg = buf.reduce((a, b) => a + b, 0) / buf.length;
      if (statusEl) statusEl.style.color = avg > 5 ? 'var(--em)' : 'var(--t3)';
      animId = requestAnimationFrame(checkAudio);
    };
    checkAudio();
  } catch(e) { console.warn('Audio meter failed:', e); }

  const closeTest = () => {
    if (animId) cancelAnimationFrame(animId);
    if (audioCtx) audioCtx.close();
    testStream.getTracks().forEach(t => t.stop());
    modal.remove();
  };
  document.getElementById('cam-test-close').onclick = closeTest;
  document.getElementById('cam-test-close-btn').onclick = closeTest;
  modal.onclick = (e) => { if (e.target === modal) closeTest(); };
}

function muteAudio(mute) {
  if (!localStream) return;
  localStream.getAudioTracks().forEach(t => { t.enabled = !mute; });
}

function muteVideo(mute) {
  if (!localStream) return;
  localStream.getVideoTracks().forEach(t => { t.enabled = !mute; });
  const localVid = document.getElementById('vid-local');
  const placeholder = document.getElementById('vid-local-placeholder');
  if (mute) {
    if (localVid) localVid.style.display = 'none';
    if (placeholder) placeholder.style.display = 'flex';
  } else {
    if (localVid) localVid.style.display = 'block';
    if (placeholder) placeholder.style.display = 'none';
  }
}

function showVidError(html) {
  // Shows a persistent error banner inside the remote video area
  const wrap = document.querySelector('.vid-wrap') || document.getElementById('vid-active');
  if (!wrap) return;
  const existing = document.getElementById('vid-err-banner');
  if (existing) existing.remove();
  const d = document.createElement('div');
  d.id = 'vid-err-banner';
  d.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,.9);z-index:100;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;text-align:center;padding:2rem;gap:1rem;border-radius:inherit';
  d.innerHTML = `
    <div style="font-size:2.5rem">⚠️</div>
    <div style="font-size:1.1rem;font-weight:700">Problem Detected</div>
    <div style="font-size:0.9rem;line-height:1.5;color:rgba(255,255,255,0.8)">${html}</div>
    <div style="display:flex;gap:10px;margin-top:0.5rem">
      <button class="btn-p" onclick="startVid(activeVid?.peerId, activeVid?.subject, activeVid?.sessId)">Retry</button>
      <button class="btn-sm o" onclick="showWebRTCHelp()">Troubleshoot</button>
    </div>
  `;
  wrap.style.position = 'relative';
  wrap.appendChild(d);
}

function clearVidError() {
  const el = document.getElementById('vid-err-banner');
  if (el) el.remove();
}

async function initRTC(peerId, sessId, subject) {
  try {
    lastInitArgs = { peerId, sessId, subject };
    updateRTCStatus();
    if (!window.RTCPeerConnection) {
      toast('WebRTC is not supported in this browser.', 'er');
      return;
    }
    const myUid = (typeof ME !== 'undefined' && ME && ME.uid) ? ME.uid : 'guest';
    const isCaller = myUid < peerId; // deterministic caller assignment
    
    pc = new RTCPeerConnection(RTC_CONFIG);
    
    // ── SECURITY CHECK (non-blocking) ──
    if (!window.isSecureContext && !window.forceRTC) {
      console.warn('RTC: Non-secure context, attempting getUserMedia anyway');
      updateRTCStatus('Insecure');
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showVidError('<b>Camera API not available.</b><br>Browser blocked media access.');
      updateRTCStatus('Blocked');
      return;
    }

    // Get User Media — show persistent error in UI if it fails
    try {
      updateRTCStatus('Getting Camera...');
      // Try strict constraints first
      try {
        localStream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
          audio: { echoCancellation: true, noiseSuppression: true }
        });
      } catch(e) {
        console.warn('Strict constraints failed, falling back to basic constraints', e);
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      }
      
      // Update UI buttons to ON state once stream is successully acquired
      ['vc-mic', 'vc-cam'].forEach(id => {
        const btn = document.getElementById(id);
        if (btn) { btn.classList.add('on'); btn.classList.remove('off'); }
      });
      
      // Ensure mic tracks are enabled for transmission.
      // (Fixes "connected but no audio" when a previous mute state persists.)
      try { localStream.getAudioTracks().forEach(t => { t.enabled = true; }); } catch(e) {}
      
    } catch (err) {
      console.error('getUserMedia error:', err.name, err.message);
      updateRTCStatus('No Camera');
      let hint = err.name === 'NotAllowedError' ? 'Click the camera icon in your address bar and allow access.' :
                 err.name === 'NotFoundError' ? 'No camera found. Check hardware.' :
                 err.name === 'NotReadableError' ? 'Camera in use by another app.' : err.message;
      showVidError('<i class="ph-fill ph-warning" style="color:var(--rd);font-size:1.5rem"></i><br><b>Camera access failed</b><br><span style="font-size:.8rem;color:var(--t2)">' + hint + '</span><br><br><button class="btn-p" onclick="startVid(activeVid?.peerId, activeVid?.subject, activeVid?.sessId)">Retry</button>');
      return;
    }
    updateRTCStatus('Camera On');

    clearVidError();
    const localVid = document.getElementById('vid-local');
    const localPlaceholder = document.getElementById('vid-local-placeholder');
    if (localVid) {
      localVid.srcObject = localStream;
      localVid.style.display = 'block';
      localVid.play().catch(e => {
        console.warn('Local video autoplay blocked:', e);
        document.addEventListener('click', () => localVid.play().catch(()=>{}), { once: true });
      });
    }
    if (localPlaceholder) localPlaceholder.style.display = 'none';

    // The remote video is already in the DOM — just clear it until stream arrives
    const remoteVid = document.getElementById('vid-remote');
    if (remoteVid) remoteVid.srcObject = null;
    remoteStream = null;

    // Show avatar until remote stream arrives
    const mav = document.getElementById('vid-main-av');
    if (mav) mav.style.display = 'flex';

    // Add local tracks to peer connection
    console.log('RTC: Local stream obtained. Adding tracks...');
    localStream.getTracks().forEach(track => {
      pc.addTrack(track, localStream);
    });

    // Handle incoming remote tracks.
    // Some browsers fire `ontrack` separately for audio/video with different `event.streams`,
    // so we must *accumulate* tracks into a single MediaStream.
    pc.ontrack = (event) => {
      console.log('RTC: Remote track received!');
      if (!remoteStream) remoteStream = new MediaStream();
      // Add this track to our accumulated remote stream.
      // (Avoid overwriting `remoteStream` with `event.streams[0]` which may be video-only.)
      try {
        remoteStream.addTrack(event.track);
      } catch {
        // addTrack can throw if the track is already added; ignore.
      }

      const rv = document.getElementById('vid-remote');
      if (rv) {
        rv.srcObject = remoteStream;
        if (event && event.track && event.track.kind === 'audio') {
          rv.muted = false;
          rv.volume = 1;
        }
        rv.play().catch(e => {
          console.warn('Remote video play error:', e);
          // Autoplay can be blocked until the user interacts with the page.
          // Unlock playback on any user gesture.
          const unlock = () => rv.play().catch(()=>{});
          document.addEventListener('pointerdown', unlock, { once: true });
          document.addEventListener('keydown', unlock, { once: true });
          toast('Click anywhere to start remote audio', 'ok');
        });
      }

      const av = document.getElementById('vid-main-av');
      if (av) av.style.display = 'none';
    };

    // ICE Candidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        wsSend({ type: 'webrtc_ice', to: peerId, candidate: event.candidate });
      }
    };

    // Connection State
    pc.onconnectionstatechange = () => {
      const encBadge = document.getElementById('vid-enc');
      console.log('RTC State:', pc.connectionState);
      updateRTCStatus(pc.connectionState);
      if (pc.connectionState === 'connecting') {
        encBadge.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Connecting...';
      } else if (pc.connectionState === 'connected') {
        encBadge.innerHTML = '<i class="ph-fill ph-lock-key"></i> Encrypted P2P';
        encBadge.style.color = 'var(--em)';
      } else if (pc.connectionState === 'failed') {
        encBadge.innerHTML = '<i class="ph-fill ph-warning"></i> Failed';
        encBadge.style.color = 'var(--rd)';
      } else if (pc.connectionState === 'disconnected') {
        encBadge.innerHTML = '<i class="ph-fill ph-warning"></i> Disconnected';
        toast('Peer disconnected.', 'er');
      }
    };

    pc.onicegatheringstatechange = () => {
      if (pc.iceGatheringState === 'gathering') updateRTCStatus('Gathering');
    };

    // Signaling
    if (isCaller) {
      console.log('RTC: I am the caller. Creating offer...');
      updateRTCStatus('Offering');
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      wsSend({ type: 'webrtc_offer', to: peerId, offer });
    } else {
      console.log('RTC: I am the receiver. Waiting...');
      updateRTCStatus('Waiting');
    }

    monitorQuality();

    if (earlyOffer && earlyOffer.from === peerId) {
      console.log('RTC: Processing early offer...');
      const off = earlyOffer.offer;
      earlyOffer = null;
      handleOffer(off, peerId);
    }
  } catch (fatalError) {
    console.error('initRTC Fatal Error:', fatalError);
    updateRTCStatus('Error');
    showVidError('<i class="ph-fill ph-warning" style="color:var(--rd);font-size:2rem"></i><br><b>System Error Initializing WebRTC</b><br/><span style="font-size:0.8rem;color:var(--t2)">' + fatalError.message + '</span><br><br><span style="font-size:0.75rem;color:var(--t3)">Please take a screenshot of this error.</span>');
  }
}

async function handleOffer(offer, from) {
  console.log('RTC: Incoming offer from', from);
  if (!pc) {
    console.log('RTC: PC not ready, saving offer for later...');
    earlyOffer = { offer, from };
    // If we are already on the vid tab but haven't clicked join, maybe we should auto-init?
    // For now, let's assume the user MUST click join to get localStream.
    return;
  }
  await pc.setRemoteDescription(new RTCSessionDescription(offer));
  updateRTCStatus('Answering');
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  wsSend({ type: 'webrtc_answer', to: from, answer });
  processIceQueue();
}

async function handleAnswer(answer) {
  console.log('RTC: Incoming answer...');
  if (!pc) return;
  updateRTCStatus('Connecting');
  await pc.setRemoteDescription(new RTCSessionDescription(answer));
  processIceQueue();
}

async function handleIceCandidate(candidate) {
  if (!pc || !pc.remoteDescription) {
    console.log('RTC: Queuing ICE candidate (PC/RemoteDesc not ready)');
    iceQueue.push(candidate);
    return;
  }
  try {
    await pc.addIceCandidate(new RTCIceCandidate(candidate));
  } catch (e) { console.warn('ICE candidate error', e); }
}

function processIceQueue() {
  if (!pc || !pc.remoteDescription) return;
  console.log(`RTC: Processing ${iceQueue.length} queued ICE candidates`);
  while (iceQueue.length > 0) {
    const cand = iceQueue.shift();
    pc.addIceCandidate(new RTCIceCandidate(cand)).catch(e => console.warn('Queued ICE err', e));
  }
}

async function hangupRTC(sendSignal = true) {
  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
    localStream = null;
  }
  if (pc) {
    pc.close();
    pc = null;
  }
  remoteStream = null;
  iceQueue = [];
  earlyOffer = null;
  clearInterval(qualityInterval);
  if (sendSignal && activeVid) {
    wsSend({ type: 'webrtc_hangup', to: activeVid.peerId });
  }

  // ✅ FIX: Reset video elements WITHOUT replacing DOM (preserves IDs for next call)
  const localVid = document.getElementById('vid-local');
  const localPlaceholder = document.getElementById('vid-local-placeholder');
  const remoteVid = document.getElementById('vid-remote');
  const mainAv = document.getElementById('vid-main-av');

  if (localVid) { localVid.srcObject = null; localVid.style.display = 'none'; }
  if (localPlaceholder) { localPlaceholder.style.display = 'flex'; }
  if (remoteVid) remoteVid.srcObject = null;
  if (mainAv) mainAv.style.display = 'flex';

  updateRTCStatus('Ready');
}

function muteAudio(muted) {
  if (localStream) {
    localStream.getAudioTracks().forEach(t => t.enabled = !muted);
  }
}

async function testMyCamera() {
  updateRTCStatus('Testing...');
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    toast('Camera & Mic working perfectly!', 'ok');
    stream.getTracks().forEach(t => t.stop());
    updateRTCStatus('Media OK');
  } catch (err) {
    console.error('Test camera error:', err);
    const ip = window.location.hostname;
    const isSecure = window.isSecureContext;
    let msg = `<b>Test Failed:</b> ${err.message}.<br/><br/>`;
    if (!isSecure) {
      msg += `Your browser is blocking camera on insecure LAN. Please check <b>chrome://flags</b> for <b>${ip}</b>.`;
    } else {
      msg += `Ensure your camera isn't being used by another app.`;
    }
    showConnectionModal(msg, !isSecure);
    updateRTCStatus('Blocked');
  }
}

function muteVideo(muted) {
  if (localStream) {
    localStream.getVideoTracks().forEach(t => t.enabled = !muted);
    const lp = document.getElementById('vid-local-placeholder');
    const lv = document.getElementById('vid-local');
    if (lp && lv) {
      if (muted) { lp.style.display='flex'; lv.style.display='none'; }
      else { lp.style.display='none'; lv.style.display='block'; }
    }
  }
}

// ==========================================
// PART 2: SCREEN SHARING
// ==========================================

async function toggleScreenShare() {
  if (isScreenSharing) {
    await stopScreenShare();
  } else {
    await startScreenShare();
  }
}

async function startScreenShare() {
  if (!pc || !activeVid) return;
  try {
    const screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: { cursor: 'always', displaySurface: 'monitor' },
      audio: false
    });
    
    const videoTrack = screenStream.getVideoTracks()[0];
    const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
    
    if (sender) {
      await sender.replaceTrack(videoTrack);
    }
    
    document.getElementById('vid-local').srcObject = screenStream;
    document.getElementById('vc-screen').classList.add('active');
    document.getElementById('vc-screen').title = 'Stop Sharing';
    isScreenSharing = true;

    wsSend({ type: 'session_event', event: 'screen_share_started', to: activeVid.peerId });

    videoTrack.onended = () => {
      stopScreenShare();
    };
  } catch (err) {
    console.error('Screen share error', err);
  }
}

async function stopScreenShare() {
  if (!pc || !localStream || !activeVid) return;
  try {
    const cameraTrack = localStream.getVideoTracks()[0];
    const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
    if (sender && cameraTrack) {
      await sender.replaceTrack(cameraTrack);
    }
    document.getElementById('vid-local').srcObject = localStream;
    document.getElementById('vc-screen').classList.remove('active');
    document.getElementById('vc-screen').title = 'Share Screen';
    isScreenSharing = false;

    wsSend({ type: 'session_event', event: 'screen_share_stopped', to: activeVid.peerId });
  } catch (err) { }
}

// ==========================================
// PART 3: SESSION RECORDING
// ==========================================

function toggleRecording() {
  if (recorder && recorder.state !== 'inactive') {
    stopRecording();
  } else {
    startRecording();
  }
}

async function startRecording() {
  if (!localStream || !remoteStream) {
    toast('Waiting for both streams to start recording...', 'er');
    return;
  }
  
  try {
    const audioCtx = new AudioContext();
    const dest = audioCtx.createMediaStreamDestination();
    
    if(localStream.getAudioTracks().length) {
      const src1 = audioCtx.createMediaStreamSource(localStream);
      src1.connect(dest);
    }
    if(remoteStream.getAudioTracks().length) {
      const src2 = audioCtx.createMediaStreamSource(remoteStream);
      src2.connect(dest);
    }
    
    const combined = new MediaStream([
      ...localStream.getVideoTracks(),
      ...dest.stream.getAudioTracks()
    ]);
    
    recorder = new MediaRecorder(combined, { mimeType: 'video/webm;codecs=vp9,opus' });
    recordChunks = [];
    
    recorder.ondataavailable = e => {
      if (e.data.size > 0) recordChunks.push(e.data);
    };
    
    recorder.start(1000);
    
    const btn = document.getElementById('vc-record');
    btn.classList.add('active');
    btn.innerHTML = '<span class="blink" style="width:8px;height:8px;background:var(--rd);border-radius:50%;display:inline-block;margin-right:4px;"></span> REC';
    
  } catch(e) {
    toast('Recording failed to start: ' + e.message, 'er');
  }
}

function stopRecording() {
  if (!recorder) return;
  recorder.stop();
  recorder.onstop = () => {
    const blob = new Blob(recordChunks, { type: 'video/webm' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `CampusKarma_Session_${Date.now()}.webm`;
    a.click();
    URL.revokeObjectURL(url);
    
    const btn = document.getElementById('vc-record');
    btn.classList.remove('active');
    btn.innerHTML = '<i class="ph-fill ph-record"></i>';
    toast('Recording saved to your device', 'ok');
  };
}

// ==========================================
// PART 4: TEXT CHAT (During Session)
// ==========================================

async function sendSessionChatMsg(text) {
  if (!text || !activeVid) return;
  const input = document.getElementById('vid-chat-input');
  input.value = '';
  
  // Use js/chat.js existing architecture mapping
  const rid = roomId(ME.uid, activeVid.peerId);
  
  // Add local UI
  appendSessionChat('You', text, true);
  
  // Send via WS using reliable base64
  const ciphertext = btoa(text);
  const iv = 'none';
  
  const msgId = 'm_' + Date.now().toString(36);
  wsSend({ type: 'chat_message', to: activeVid.peerId, room_id: rid, ciphertext, iv, id: msgId });
}

function appendSessionChat(senderName, text, isMine) {
  const container = document.getElementById('vid-chat-messages');
  if (!container) return;
  const d = document.createElement('div');
  d.style.cssText = `padding:8px 12px; max-width:90%; ${isMine ? 'background:var(--em);color:#fff;align-self:flex-end;border-radius:14px 14px 2px 14px;' : 'background:var(--s2);color:var(--t1);align-self:flex-start;border-radius:14px 14px 14px 2px;'}`;
  d.innerHTML = `<div style="font-size:.65rem;opacity:.8;margin-bottom:2px">${senderName}</div><div>${text.replace(/</g,'&lt;')}</div>`;
  container.appendChild(d);
  container.scrollTop = container.scrollHeight;
}

// We intercept incoming WS in gamification.js / api.js and trigger this if inside session
async function handleSessionIncomingChat(msg) {
  if (!activeVid || msg.from !== activeVid.peerId) return;
  
  let text = msg.ciphertext;
  try { text = atob(msg.ciphertext); } catch{}
  
  const p = ALL_USERS.find(u => u.uid === msg.from);
  appendSessionChat(p ? p.name.split(' ')[0] : 'Peer', text, false);
  
  // Check if panel is hidden
  const panel = document.getElementById('vid-chat-panel');
  if (panel.style.display === 'none') {
    const badge = document.getElementById('vc-chat-badge');
    badge.style.display = 'block';
  }
  // Subtle sound
  try { new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=').play(); } catch{}
}
// Clear badge when panel is opened using index.html edits
document.getElementById('vc-chat').addEventListener('click', () => {
  document.getElementById('vid-chat-panel').style.display='flex';
  document.getElementById('vc-chat-badge').style.display='none';
});

// ==========================================
// PART 5: COLLABORATIVE WHITEBOARD
// ==========================================

function initWhiteboard() {
  const panel = document.getElementById('whiteboard-panel');
  if (panel.style.display === 'flex') return; // already open
  panel.style.display = 'flex';
  
  const canvas = document.getElementById('wb-canvas');
  if (!wbCtx) {
    wbCtx = canvas.getContext('2d');
    
    const resizeCanvas = () => {
      canvas.width = canvas.parentElement.clientWidth;
      canvas.height = canvas.parentElement.clientHeight - 40; // minus toolbar
    };
    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();
    
    // Setup drawing events
    const startDraw = (e) => {
      wbState.isDrawing = true;
      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX || e.touches[0].clientX) - rect.left;
      const y = (e.clientY || e.touches[0].clientY) - rect.top;
      wbState.lastX = x; wbState.lastY = y;
      wbPointsBatch = [{x: x/canvas.width, y: y/canvas.height}];
    };
    
    const draw = (e) => {
      if (!wbState.isDrawing) return;
      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX || e.touches[0].clientX) - rect.left;
      const y = (e.clientY || e.touches[0].clientY) - rect.top;
      
      wbCtx.beginPath();
      wbCtx.moveTo(wbState.lastX, wbState.lastY);
      wbCtx.lineTo(x, y);
      
      if (wbState.tool === 'highlighter') {
        wbCtx.strokeStyle = wbState.color + '40'; // semi-transparent
        wbCtx.lineWidth = 20;
      } else if (wbState.tool === 'eraser') {
        wbCtx.strokeStyle = '#ffffff';
        wbCtx.lineWidth = 20;
      } else {
        wbCtx.strokeStyle = wbState.color;
        wbCtx.lineWidth = wbState.size;
      }
      
      wbCtx.lineCap = 'round';
      wbCtx.lineJoin = 'round';
      wbCtx.stroke();
      
      wbState.lastX = x; wbState.lastY = y;
      wbPointsBatch.push({x: x/canvas.width, y: y/canvas.height});
      
      // Batch send to peer
      if (!wbBatchTimer) {
        wbBatchTimer = setTimeout(flushWhiteboardBatch, 50);
      }
    };
    
    const endDraw = () => {
      if(wbState.isDrawing) flushWhiteboardBatch();
      wbState.isDrawing = false;
    };
    
    canvas.addEventListener('mousedown', startDraw);
    canvas.addEventListener('mousemove', draw);
    canvas.addEventListener('mouseup', endDraw);
    canvas.addEventListener('mouseout', endDraw);
    
    canvas.addEventListener('touchstart', startDraw);
    canvas.addEventListener('touchmove', draw);
    canvas.addEventListener('touchend', endDraw);
  }
}

function flushWhiteboardBatch() {
  clearTimeout(wbBatchTimer);
  wbBatchTimer = null;
  if (!activeVid || wbPointsBatch.length === 0) return;
  
  wsSend({
    type: 'session_event',
    event: 'whiteboard_stroke',
    to: activeVid.peerId,
    data: {
      points: wbPointsBatch,
      color: wbState.color,
      size: wbState.size,
      tool: wbState.tool
    }
  });
  wbPointsBatch = [];
}

function setWbColor(c) { wbState.color = c; wbState.tool = 'pen'; }
function setWbSize(s) { wbState.size = s; }
function setWbTool(t) { wbState.tool = t; }

function closeWhiteboard() {
  document.getElementById('whiteboard-panel').style.display = 'none';
}

function clearWhiteboard(send = false) {
  if (wbCtx) {
    const canvas = document.getElementById('wb-canvas');
    wbCtx.clearRect(0, 0, canvas.width, canvas.height);
  }
  if (send && activeVid) {
    wsSend({ type: 'session_event', event: 'whiteboard_clear', to: activeVid.peerId });
  }
}

function handleRemoteWhiteboardStroke(data) {
  const canvas = document.getElementById('wb-canvas');
  if (!canvas || !wbCtx || !data.points || data.points.length < 2) return;
  
  wbCtx.beginPath();
  wbCtx.moveTo(data.points[0].x * canvas.width, data.points[0].y * canvas.height);
  
  if (data.tool === 'highlighter') {
    wbCtx.strokeStyle = data.color + '40';
    wbCtx.lineWidth = 20;
  } else if (data.tool === 'eraser') {
    wbCtx.strokeStyle = '#ffffff';
    wbCtx.lineWidth = 20;
  } else {
    wbCtx.strokeStyle = data.color;
    wbCtx.lineWidth = data.size;
  }
  wbCtx.lineCap = 'round';
  wbCtx.lineJoin = 'round';
  
  for (let i = 1; i < data.points.length; i++) {
    wbCtx.lineTo(data.points[i].x * canvas.width, data.points[i].y * canvas.height);
  }
  wbCtx.stroke();
}

// ==========================================
// PART 6: POMODORO TIMER
// ==========================================

let pomoMode = 'work'; // 'work' or 'break'

function togglePomo() {
  const btn = document.querySelector('.pomo .btn-sm');
  if (typeof pomoRunning === 'undefined') window.pomoRunning = false;
  if (typeof pomoSecs === 'undefined') window.pomoSecs = 25 * 60;
  
  if (window.pomoRunning) {
    clearInterval(window.pomoInterval);
    window.pomoRunning = false;
    btn.textContent = 'Resume';
  } else {
    window.pomoRunning = true;
    btn.textContent = 'Pause';
    window.pomoInterval = setInterval(() => {
      if (window.pomoSecs <= 0) {
        clearInterval(window.pomoInterval);
        try { new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=').play(); } catch{}
        if (pomoMode === 'work') {
          pomoMode = 'break';
          window.pomoSecs = 5 * 60;
          toast('Take a 5-minute break!', 'ok');
          if (typeof activeVid !== 'undefined' && activeVid) wsSend({ type: 'session_event', event: 'pomodoro_break', to: activeVid.peerId });
        } else {
          pomoMode = 'work';
          window.pomoSecs = 25 * 60;
          toast('Break over — resuming work!', 'ok');
          if (typeof activeVid !== 'undefined' && activeVid) wsSend({ type: 'session_event', event: 'pomodoro_resume', to: activeVid.peerId });
        }
        // Auto-start next phase
        window.pomoRunning = false;
        togglePomo();
        return;
      }
      window.pomoSecs--;
      const m2 = Math.floor(window.pomoSecs / 60), s2 = window.pomoSecs % 60;
      document.getElementById('pomo-timer').textContent = String(m2).padStart(2, '0') + ':' + String(s2).padStart(2, '0');
    }, 1000);
  }
}

function handlePomodoroBreak() {
  toast('Peer suggests a 5-minute break! <i class="ph ph-coffee"></i>', 'ok');
  try { new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=').play(); } catch{}
}

function handlePomodoroResume() {
  toast('Peer resumed work! <i class="ph ph-briefcase"></i>', 'ok');
}

// ==========================================
// PART 7: SESSION QUALITY MONITORING
// ==========================================

function monitorQuality() {
  qualityInterval = setInterval(async () => {
    if (!pc) return;
    try {
      const stats = await pc.getStats();
      stats.forEach(async report => {
        if (report.type === 'inbound-rtp' && report.kind === 'video') {
          const packetsLost = report.packetsLost || 0;
          const packetsReceived = report.packetsReceived || 1;
          const lossRate = packetsLost / (packetsLost + packetsReceived);
          
          if (lossRate > 0.1) {
            const lbl = document.getElementById('vc-quality-label');
            if (lbl && lbl.textContent !== 'LOW') {
              showQualityWarning('Poor connection — reducing quality');
              lbl.textContent = 'LOW';
              // Actually downgrade sender bitrates if we have access to localStream
              if (localStream) {
                const videoTrack = localStream.getVideoTracks()[0];
                const sender = pc.getSenders().find(s => s.track === videoTrack);
                if (sender) {
                  const params = sender.getParameters();
                  if (!params.encodings) params.encodings = [{}];
                  params.encodings[0].maxBitrate = 500000;
                  await sender.setParameters(params);
                }
              }
            }
          } else if (lossRate < 0.02) {
            const lbl = document.getElementById('vc-quality-label');
            if (lbl && lbl.textContent === 'LOW') {
              lbl.textContent = 'HD';
              if (localStream) {
                const videoTrack = localStream.getVideoTracks()[0];
                const sender = pc.getSenders().find(s => s.track === videoTrack);
                if (sender) {
                  const params = sender.getParameters();
                  if (!params.encodings) params.encodings = [{}];
                  delete params.encodings[0].maxBitrate;
                  await sender.setParameters(params);
                }
              }
            }
          }
        }
      });
    } catch(e) {}
  }, 5000);
}

function showQualityWarning(msg) {
  toast(msg, 'er');
  const d = document.getElementById('vid-quality');
  if (d) {
    d.innerHTML = '<i class="ph-fill ph-warning-circle"></i> ' + msg;
    setTimeout(() => { if (d.innerHTML.includes(msg)) d.innerHTML = ''; }, 3000);
  }
}

// ==========================================
// PART 8: HANDLE INCOMING WS EVENTS
// ==========================================

// Hooks into ws.onmessage in js/gamification.js or can override globally
function installWebRTCHandlers() {
  if (typeof onWS === 'undefined') return;
  
  onWS('webrtc_offer', msg => { console.log('RTC: Offer from', msg.from); handleOffer(msg.offer, msg.from); });
  onWS('webrtc_answer', msg => { console.log('RTC: Answer from', msg.from); handleAnswer(msg.answer); });
  onWS('webrtc_ice', msg => { console.log('RTC: ICE from', msg.from); handleIceCandidate(msg.candidate); });
  onWS('webrtc_hangup', msg => { console.log('RTC: Hangup'); hangupRTC(false); });

  // Server can send `{ type: 'error', message: '...' }` if session validation fails.
  onWS('error', msg => {
    if (!msg) return;
    const m = msg.message || 'WebRTC error';
    console.warn('WS error:', m);
    toast(m, 'er');
    showVidError('<b>Connection error</b><br/><span style="color:var(--t2)">' + m + '</span>');
  });

  // Legacy/Correction handlers to avoid confusion in gamification.js
  onWS('rtc_offer', msg => { console.log('RTC: Received legacy rtc_offer handler'); handleOffer(msg.offer, msg.from); });

  // If chat comes through standard chat_message while in session
  const oldChatHandler = typeof onIncomingChat !== 'undefined' ? onIncomingChat : null;
  onWS('chat_message', msg => {
    if (activeVid && msg.from === activeVid.peerId) {
      handleSessionIncomingChat(msg);
    }
    if (oldChatHandler) oldChatHandler(msg);
  });

  // Since gamification.js ALSO maps session_event, we need to carefully extend it
  const oldSessionHandler = wsHandlers['session_event'];
  onWS('session_event', msg => {
    if (oldSessionHandler) oldSessionHandler(msg);

    if (msg.event === 'screen_share_started') {
      toast('Peer is sharing screen', 'ok');
    } else if (msg.event === 'screen_share_stopped') {
      toast('Screen share ended', 'ok');
    } else if (msg.event === 'whiteboard_stroke') {
      initWhiteboard();
      handleRemoteWhiteboardStroke(msg.data);
    } else if (msg.event === 'whiteboard_clear') {
      clearWhiteboard(false);
    } else if (msg.event === 'pomodoro_break') {
      handlePomodoroBreak();
    } else if (msg.event === 'pomodoro_resume') {
      handlePomodoroResume();
    }
  });

  onWS('session_reminder', msg => {
    if (msg.minutes === 5) {
      const pId = msg.session.peer1 === ME.uid ? msg.session.peer2 : msg.session.peer1;
      toast(`Session in 5 mins! <button class="btn-sm p" style="margin-left:10px;pointer-events:auto" onclick="startVid('${pId}', '${msg.session.subject}', '${msg.session.id}')">Join</button>`, 'ok');
    } else {
      toast(`Reminder: Session in ${msg.minutes} mins`, 'ok');
    }
  });

  onWS('session_starting', msg => {
    toast(`Session is LIVE! <button class="btn-sm r" style="margin-left:10px;pointer-events:auto" onclick="goTab('sessions', document.querySelector('[data-t=sessions]'))">View</button>`, 'ok');
  });
}

function showConnectionModal(html, showBypass = false) {
  // Simple injection of a blocking UI for security warnings
  const existing = document.getElementById('rtc-help-modal'); if (existing) existing.remove();
  const d = document.createElement('div');
  d.id = 'rtc-help-modal';
  d.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:9999;display:flex;align-items:center;justify-content:center;padding:2rem';
  
  const bypassCode = `window.forceRTC=true; this.parentElement.parentElement.parentElement.remove(); toast('Retrying...', 'ok'); if(lastInitArgs) initRTC(lastInitArgs.peerId, lastInitArgs.sessId, lastInitArgs.subject);`;

  d.innerHTML = `
    <div style="background:var(--bg);border:1px solid var(--bd);padding:2rem;border-radius:var(--r3);max-width:450px;width:100%;box-shadow:0 20px 50px rgba(0,0,0,0.5)">
      <div style="font-size:3rem;margin-bottom:1rem">🔒</div>
      <h2 style="margin-bottom:1rem;color:var(--t1)">Insecure Context</h2>
      <div style="font-size:.9rem;line-height:1.6;color:var(--t2);margin-bottom:1.5rem">${html}</div>
      <div style="display:flex;flex-direction:column;gap:.75rem">
        <button class="btn-p" style="width:100%" onclick="this.parentElement.parentElement.parentElement.remove()">Close & Try Again</button>
        ${showBypass ? `<button class="btn-sm o" style="width:100%;opacity:.7" onclick="${bypassCode}">Bypass (If flags are set)</button>` : ''}
      </div>
    </div>
  `;
  document.body.appendChild(d);
}

/**
 * Human-friendly mapping of technical RTC states
 */
const STATUS_MAP = {
  'READY': 'Ready to Join',
  'OFFERING': 'Starting Call...',
  'WAITING': 'Waiting for Peer...',
  'CONNECTING': 'Connecting P2P...',
  'CONNECTED': 'Live Connection',
  'STREAMING': 'Streaming Media',
  'CAM ERROR': 'Check Camera',
  'BLOCKED': 'Access Blocked',
  'DISCONNECTED': 'Peer Left',
  'FAILED': 'Network Failed'
};

function updateRTCStatus(status = '') {
  const el = document.getElementById('rtc-diagnosis');
  if (!el) return;
  
  const isSecure = window.isSecureContext;
  const hasMedia = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  
  // Friendly icons + simple labels
  const secureIcon = isSecure ? '🛡️' : '🔓';
  const mediaIcon = hasMedia ? '📽️' : '❌';
  
  const upperStatus = status.toUpperCase() || 'READY';
  const friendlyStatus = STATUS_MAP[upperStatus] || upperStatus;

  el.innerHTML = `
    <div style="display:flex;gap:12px;font-size:0.7rem;font-weight:700;color:var(--t2);align-items:center;background:var(--s1);padding:6px 14px;border-radius:100px;border:1px solid var(--bd);box-shadow:0 2px 8px rgba(0,0,0,0.1);cursor:pointer" onclick="showWebRTCHelp()">
      <span title="Security">${secureIcon}</span>
      <span title="Camera Access">${mediaIcon}</span>
      <span style="color:var(--em);border-left:1px solid var(--bd);padding-left:12px;margin-left:2px">${friendlyStatus}</span>
    </div>
  `;
}

/**
 * Visual Troubleshooting Guide for the user
 */
function showWebRTCHelp() {
  const existing = document.getElementById('rtc-help-modal'); if (existing) existing.remove();
  const d = document.createElement('div');
  d.id = 'rtc-help-modal';
  d.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.9);z-index:99999;display:flex;align-items:center;justify-content:center;padding:1.5rem';
  
  const isSecure = window.isSecureContext;
  const isIP = window.location.hostname.match(/^\d+\.\d+\.\d+\.\d+$/);

  d.innerHTML = `
    <div style="background:var(--bg);border:1px solid var(--bd);padding:2rem;border-radius:var(--r3);max-width:500px;width:100%;box-shadow:0 30px 80px rgba(0,0,0,0.6);max-height:90vh;overflow-y:auto">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.5rem">
        <h2 style="margin:0;color:var(--t1);font-size:1.3rem">WebRTC Tool Guide</h2>
        <button onclick="this.parentElement.parentElement.parentElement.remove()" style="background:none;border:none;color:var(--t3);font-size:1.5rem;cursor:pointer">&times;</button>
      </div>

      <div style="display:flex;flex-direction:column;gap:1.5rem">
        
        <!-- Security Section -->
        <div>
          <h4 style="margin:0 0 0.5rem;color:${isSecure ? 'var(--em)' : 'var(--rd)'}">${isSecure ? '🛡️ Connection Secure' : '🔓 Insecure Connection'}</h4>
          <p style="font-size:0.85rem;color:var(--t2);margin:0">
            ${isSecure ? 'Your connection is encrypted (HTTPS/Localhost). Camera access is allowed by the browser.' 
                      : 'You are on an insecure origin (HTTP/IP). Modern browsers block camera access here by default.'}
          </p>
          ${isIP ? `
            <div style="margin-top:0.8rem;padding:0.8rem;background:rgba(255,165,0,0.1);border-radius:8px;border:1px solid rgba(255,165,0,0.2);font-size:0.8rem">
              <b>Fix for Android/Chrome (IP):</b><br/>
              1. Copy: <code>chrome://flags/#unsafely-treat-insecure-origin-as-secure</code><br/>
              2. Paste into browser address bar.<br/>
              3. Search for "Insecure origin", enable it and add <b>${window.location.origin}</b> to the list.<br/>
              4. Relaunch Chrome.
            </div>` : ''}
        </div>

        <!-- Camera Section -->
        <div>
          <h4 style="margin:0 0 0.5rem;color:var(--t1)">📽️ Permissions Guide</h4>
          <p style="font-size:0.85rem;color:var(--t2);margin:0">
            Click the <b>lock icon</b> or <b>camera icon</b> in your browser address bar and ensure "Camera" and "Microphone" are set to <b>Allow</b>.
          </p>
        </div>

        <!-- Hardware Section -->
        <div>
          <h4 style="margin:0 0 0.5rem;color:var(--t1)">⚙️ Hardware Busy?</h4>
          <p style="font-size:0.85rem;color:var(--t2);margin:0">
            If your camera light is on but the screen is black, another app (Zoom, Meet, FaceTime) might be using it. Close them and refresh this page.
          </p>
        </div>
      </div>

      <button class="btn-p" style="width:100%;margin-top:2rem" onclick="this.parentElement.parentElement.parentElement.remove()">I Understand</button>
    </div>
  `;
  document.body.appendChild(d);
}

// Call on load
setTimeout(() => { 
  installWebRTCHandlers();
  updateRTCStatus();
}, 1000);
