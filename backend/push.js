const webpush = require('web-push');
const PushSubscription = require('./models/PushSubscription');
require('dotenv').config();

// Auto-generate VAPID keys if missing
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

webpush.setVapidDetails(
  'mailto:' + (process.env.EMAIL_FROM || 'admin@campuskarma.com'),
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

async function sendPushNotification(uid, payload) {
  try {
    const subDoc = await PushSubscription.findOne({ uid });
    if (!subDoc) return; // Not subscribed

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
  } catch (error) {
    if (error.statusCode === 410) {
      // Subscription expired or unsubscribed
      await PushSubscription.deleteOne({ uid });
    } else {
      console.warn(`Push notification failed for ${uid}:`, error.message);
    }
  }
}

async function notifyPeers(uids, payload) {
  return Promise.allSettled(uids.map(uid => sendPushNotification(uid, payload)));
}

// ==========================================
// TEMPLATES
// ==========================================

const notifyNewRequest = (recipientUid, senderName, subject) =>
  sendPushNotification(recipientUid, {
    title: 'New Connection Request',
    body: `${senderName} wants to exchange knowledge in ${subject}!`,
    url: '/?tab=requests',
    tag: 'request'
  });

const notifyRequestAccepted = (senderUid, recipientName) =>
  sendPushNotification(senderUid, {
    title: 'Request Accepted 🤝',
    body: `${recipientName} accepted your request. You can now chat and schedule sessions.`,
    url: '/?tab=connections'
  });

const notifySessionReminder30 = (uid, peerName, subject, time) =>
  sendPushNotification(uid, {
    title: 'Session in 30 Minutes ⏳',
    body: `Your ${subject} session with ${peerName} starts at ${time}.`,
    url: '/?tab=sessions',
    tag: 'session_reminder'
  });

const notifySessionReminder5 = (uid, peerName, subject) =>
  sendPushNotification(uid, {
    title: 'Session in 5 Minutes! 🚨',
    body: `Get ready! Your session with ${peerName} on ${subject} is about to start.`,
    url: '/?tab=sessions',
    requireInteraction: true,
    tag: 'session_reminder'
  });

const notifySessionStarting = (uid, peerName, subject, sessId) =>
  sendPushNotification(uid, {
    title: 'Session is Live! 🟢',
    body: `Click here to join your ${subject} session with ${peerName} now.`,
    url: '/?tab=sessions',
    requireInteraction: true,
    tag: 'session_start'
  });

const notifyBadgeEarned = (uid, badgeName, kpEarned) =>
  sendPushNotification(uid, {
    title: 'New Badge Unlocked! 🏆',
    body: `You earned the "${badgeName}" badge and +${kpEarned} KP!`,
    tag: 'achievement'
  });

const notifyLoopFound = (uid, loopMembers, type) =>
  sendPushNotification(uid, {
    title: `Karma ${type.charAt(0).toUpperCase() + type.slice(1)} Found! ♻️`,
    body: `You're part of a ${loopMembers.length}-person learning loop. Check it out!`,
    url: '/?tab=home',
    tag: 'karma_loop'
  });

const notifyKPEarned = (uid, amount, reason) =>
  sendPushNotification(uid, {
    title: 'Karma Points Earned! ⚡',
    body: `You earned +${amount} KP for ${reason}.`,
    tag: 'kp_earned'
  });

module.exports = {
  sendPushNotification,
  notifyPeers,
  notifyNewRequest,
  notifyRequestAccepted,
  notifySessionReminder30,
  notifySessionReminder5,
  notifySessionStarting,
  notifyBadgeEarned,
  notifyLoopFound,
  notifyKPEarned
};
