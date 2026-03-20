'use strict';
// Use the current page origin so HTTPS environments don't break WebSockets (mixed content).
const ORIGIN = window.location.origin || `http://${window.location.hostname || 'localhost'}:3000`;
const API = `${ORIGIN}/api`;
let TOKEN = localStorage.getItem('ck_token') || '';

function setToken(t) { TOKEN = t; localStorage.setItem('ck_token', t); }
function clearToken() { TOKEN = ''; localStorage.removeItem('ck_token'); }

async function apiFetch(path, opts = {}) {
  const res = await fetch(API + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN, ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// ── WebSocket ──────────────────────────────────────────────────────────────
let ws = null;
const wsHandlers = {};
function onWS(type, fn) { wsHandlers[type] = fn; }

function connectWS() {
  const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${wsProto}//${window.location.host}`);
  ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', token: TOKEN }));
  ws.onmessage = (e) => {
    let msg; try { msg = JSON.parse(e.data); } catch { return; }
    if (wsHandlers[msg.type]) wsHandlers[msg.type](msg);
  };
  ws.onclose = () => setTimeout(connectWS, 3000);
}

function wsSend(obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); }

// Helper for frontend modules to decide whether to use WS or REST fallback.
function wsIsOpen() { return !!(ws && ws.readyState === 1); }

// ── ECDH + AES-GCM E2E Crypto ─────────────────────────────────────────────
const cryptoKeys = {}; // peerId -> CryptoKey (AES-GCM)

async function genECDHPair() {
  return crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey']);
}

async function exportPubKey(kp) {
  const buf = await crypto.subtle.exportKey('raw', kp.publicKey);
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

async function importPeerPubKey(b64) {
  const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  return crypto.subtle.importKey('raw', bin, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
}

async function deriveAES(myPrivKey, peerPubKey) {
  return crypto.subtle.deriveKey(
    { name: 'ECDH', public: peerPubKey },
    myPrivKey,
    { name: 'AES-GCM', length: 256 },
    false, ['encrypt', 'decrypt']
  );
}

async function encryptMsg(aesKey, plaintext) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const buf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, enc.encode(plaintext));
  return {
    ciphertext: btoa(String.fromCharCode(...new Uint8Array(buf))),
    iv: btoa(String.fromCharCode(...iv)),
  };
}

async function decryptMsg(aesKey, ciphertext, ivB64) {
  const ct = Uint8Array.from(atob(ciphertext), c => c.charCodeAt(0));
  const iv = Uint8Array.from(atob(ivB64), c => c.charCodeAt(0));
  const buf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, aesKey, ct);
  return new TextDecoder().decode(buf);
}

// Per-user ECDH keypair (persisted in memory per session)
let myECDHPair = null;
async function getMyECDHPair() {
  if (!myECDHPair) myECDHPair = await genECDHPair();
  return myECDHPair;
}

async function getOrEstablishAES(peerId) {
  if (!window.crypto || !window.crypto.subtle) return null;
  if (cryptoKeys[peerId]) return cryptoKeys[peerId];
  const kp = await getMyECDHPair();
  const myPub = await exportPubKey(kp);
  // Share our public key with server
  await apiFetch('/chat/pubkey', { method: 'POST', body: { peer_uid: peerId, pub_key: myPub } });
  // Broadcast via WS
  wsSend({ type: 'pub_key_share', for_uid: peerId, pub_key: myPub });
  // Try to get peer's key
  const { pub_key } = await apiFetch('/users/' + peerId + '/pubkey');
  if (pub_key) {
    const peerKey = await importPeerPubKey(pub_key);
    const aes = await deriveAES(kp.privateKey, peerKey);
    cryptoKeys[peerId] = aes;
    return aes;
  }
  return null; // peer hasn't shared key yet
}
