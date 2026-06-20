const webpush = require('web-push');
const PushSubscription = require('./models/PushSubscription');
require('dotenv').config();

// ─── VAPID Setup ──────────────────────────────────────────────────────────────
if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
  const vapidKeys = webpush.generateVAPIDKeys();
  console.log('\n======================================================');
  console.log('VAPID KEYS NOT FOUND IN .env! PLEASE ADD THESE:');
  console.log(`VAPID_PUBLIC_KEY=${vapidKeys.publicKey}`);
  console.log(`VAPID_PRIVATE_KEY=${vapidKeys.privateKey}`);
  console.log('======================================================\n');
  process.env.VAPID_PUBLIC_KEY = vapidKeys.publicKey;
  process.env.VAPID_PRIVATE_KEY = vapidKeys.privateKey;
}

if (process.env.VAPID_PUBLIC_KEY) {
  process.env.VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY.replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
if (process.env.VAPID_PRIVATE_KEY) {
  process.env.VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY.replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

webpush.setVapidDetails(
  'mailto:' + (process.env.EMAIL_FROM || 'admin@campuskarma.com'),
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

// ─────────────────────────────────────────────────────────────────────────────
// BREAKTHROUGH 3 — SMS DUAL-CHANNEL FALLBACK
//
// Web Push only works when the PWA is installed AND the user is online.
// For rural Tamil Nadu students on basic Android phones with 2G connectivity,
// WEB PUSH IS UNRELIABLE. SMS works on ANY phone, ANY network, even offline.
//
// Architecture:
//   sendDualNotification(uid, { title, body, sms }) →
//     1. Attempts Web Push (silent on failure)
//     2. Sends SMS via Twilio if user has a phone number on file
//
// .env vars needed: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER
// ─────────────────────────────────────────────────────────────────────────────
let twilioClient = null;
if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
  try {
    const twilio = require('twilio');
    twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    console.log('📱 Twilio SMS client initialized.');
  } catch (e) {
    console.warn('⚠️  Twilio not installed. Run: npm install twilio  — SMS will be disabled.');
  }
} else {
  console.log('ℹ️  Twilio keys not in .env — SMS fallback disabled. Add TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER to enable.');
}

/**
 * Send an SMS to a phone number via Twilio.
 * @param {string} toPhone - Phone with country code e.g. '+919876543210'
 * @param {string} message - Plain text SMS body
 */
async function sendSMS(toPhone, message) {
  if (!twilioClient || !toPhone) return;
  try {
    await twilioClient.messages.create({
      body: message.substring(0, 320),
      from: process.env.TWILIO_FROM_NUMBER,
      to: toPhone
    });
    console.log(`[SMS] ✅ Sent to ${toPhone}`);
  } catch (e) {
    console.warn(`[SMS] ⚠️  Failed to ${toPhone}: ${e.message}`);
  }
}

/**
 * Core dual-channel sender.
 * Sends Web Push AND SMS (if user has a phone number saved).
 */
async function sendDualNotification(uid, payload) {
  // Channel 1: Web Push
  try {
    const subDoc = await PushSubscription.findOne({ uid });
    if (subDoc) {
      const pushPayload = JSON.stringify({
        title: payload.title || 'CampusKarma',
        body: payload.body || '',
        icon: payload.icon || '/icon.png',
        badge: payload.badge || '/badge.png',
        url: payload.url || '/',
        tag: payload.tag || 'campuskarma',
        requireInteraction: payload.requireInteraction || false
      });
      await webpush.sendNotification(subDoc.subscription, pushPayload);
    }
  } catch (error) {
    if (error.statusCode === 410) {
      await PushSubscription.deleteOne({ uid });
    } else {
      console.warn(`[Push] Failed for ${uid}:`, error.message);
    }
  }

  // Channel 2: SMS — works even when app is closed or user is offline
  if (twilioClient && payload.sms) {
    try {
      const { models } = require('./db');
      const user = await models.User.findOne({ uid }, 'phone');
      if (user && user.phone) {
        await sendSMS(user.phone, `[CampusKarma] ${payload.sms}`);
      }
    } catch (e) {
      console.warn(`[SMS Lookup] Failed for ${uid}:`, e.message);
    }
  }
}

// Backward-compatible alias
async function sendPushNotification(uid, payload) {
  return sendDualNotification(uid, payload);
}

async function notifyPeers(uids, payload) {
  return Promise.allSettled(uids.map(uid => sendDualNotification(uid, payload)));
}

// ─── Notification Templates ───────────────────────────────────────────────────

const notifyNewRequest = (recipientUid, senderName, subject) =>
  sendDualNotification(recipientUid, {
    title: 'New Connection Request',
    body: `${senderName} wants to exchange knowledge in ${subject}!`,
    url: '/?tab=requests',
    tag: 'request',
    sms: `${senderName} sent you a mentorship request for ${subject}. Log in to respond.`
  });

const notifyRequestAccepted = (senderUid, recipientName) =>
  sendDualNotification(senderUid, {
    title: 'Request Accepted 🤝',
    body: `${recipientName} accepted your request. You can now chat and schedule sessions.`,
    url: '/?tab=connections',
    sms: `${recipientName} accepted your request! Schedule your first session at campuskarma.app`
  });

const notifySessionReminder30 = (uid, peerName, subject, time) =>
  sendDualNotification(uid, {
    title: 'Session in 30 Minutes ⏳',
    body: `Your ${subject} session with ${peerName} starts at ${time}.`,
    url: '/?tab=sessions',
    tag: 'session_reminder',
    sms: `Reminder: Your ${subject} session with ${peerName} is in 30 mins (${time}). Join at campuskarma.app`
  });

const notifySessionReminder5 = (uid, peerName, subject) =>
  sendDualNotification(uid, {
    title: 'Session in 5 Minutes! 🚨',
    body: `Get ready! Your ${subject} session with ${peerName} is about to start.`,
    url: '/?tab=sessions',
    requireInteraction: true,
    tag: 'session_reminder',
    sms: `URGENT: Your ${subject} session with ${peerName} starts in 5 mins! Open campuskarma.app now.`
  });

const notifySessionStarting = (uid, peerName, subject, sessId) =>
  sendDualNotification(uid, {
    title: 'Session is Live! 🟢',
    body: `Join your ${subject} session with ${peerName} now.`,
    url: '/?tab=sessions',
    requireInteraction: true,
    tag: 'session_start',
    sms: `Your ${subject} session with ${peerName} is LIVE now! Join at campuskarma.app`
  });

const notifyBadgeEarned = (uid, badgeName, kpEarned) =>
  sendDualNotification(uid, {
    title: 'New Badge Unlocked! 🏆',
    body: `You earned the "${badgeName}" badge and +${kpEarned} KP!`,
    tag: 'achievement',
    sms: `Congrats! You earned the "${badgeName}" badge and +${kpEarned} Karma Points on CampusKarma!`
  });

const notifyLoopFound = (uid, loopMembers, type) =>
  sendDualNotification(uid, {
    title: `Karma ${type.charAt(0).toUpperCase() + type.slice(1)} Found! ♻️`,
    body: `You're part of a ${loopMembers.length}-person learning loop. Check it out!`,
    url: '/?tab=home',
    tag: 'karma_loop',
    sms: `You've been matched in a ${loopMembers.length}-way learning loop on CampusKarma! Check your dashboard.`
  });

const notifyKPEarned = (uid, amount, reason) =>
  sendDualNotification(uid, {
    title: 'Karma Points Earned! ⚡',
    body: `You earned +${amount} KP for ${reason}.`,
    tag: 'kp_earned'
    // No SMS for minor KP events to avoid overuse
  });

// ─── Agaram-Specific Dormancy Alert ──────────────────────────────────────────
/**
 * Critical for rural students — SMS ensures they are reached even without internet.
 * Called from the dormancy detection cron in server.js
 */
const notifyDormancyAlert = (uid, partnerName, daysSince, role) =>
  sendDualNotification(uid, {
    title: role === 'mentor' ? '📚 Check In With Your Mentee' : '🌟 Your Mentor Is Waiting',
    body: role === 'mentor'
      ? `You haven't connected with ${partnerName} in ${daysSince} days. Schedule a session!`
      : `It's been ${daysSince} days. Your mentor ${partnerName} is ready for your next session!`,
    url: '/?tab=sessions',
    tag: 'dormancy',
    requireInteraction: true,
    sms: role === 'mentor'
      ? `[Agaram] ${partnerName} hasn't had a session in ${daysSince} days. Please reach out! campuskarma.app`
      : `[Agaram] Your mentor ${partnerName} is waiting! It's been ${daysSince} days. Book your session: campuskarma.app`
  });

module.exports = {
  sendPushNotification,
  sendDualNotification,
  sendSMS,
  notifyPeers,
  notifyNewRequest,
  notifyRequestAccepted,
  notifySessionReminder30,
  notifySessionReminder5,
  notifySessionStarting,
  notifyBadgeEarned,
  notifyLoopFound,
  notifyKPEarned,
  notifyDormancyAlert,
  send: sendDualNotification // generic alias for older callers
};
