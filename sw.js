self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(clients.claim()));

self.addEventListener('push', event => {
  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch(e) {
      data = { title: 'CampusKarma', body: event.data.text() };
    }
  }

  event.waitUntil(
    self.registration.showNotification(data.title || 'CampusKarma', {
      body: data.body || '',
      icon: data.icon || '/icon.png',
      badge: data.badge || '/badge.png',
      tag: data.tag || 'campuskarma',
      data: { url: data.url || '/' },
      actions: data.actions || [],
      requireInteraction: data.requireInteraction || false,
      vibrate: [100, 50, 100],
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then(windowClients => {
      // Focus existing tab if open
      const existing = windowClients.find(c => c.url.includes(url));
      if (existing) return existing.focus();
      // Open new tab
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});

// Offline cache for shell
const CACHE = 'campuskarma-v4';
const SHELL = [
  '/', 
  '/index.html', 
  '/campuskarma.css', 
  '/chat-doodles/math.svg',
  '/chat-doodles/phy.svg',
  '/chat-doodles/chem.svg',
  '/chat-doodles/cs.svg',
  '/chat-doodles/bio.svg',
  '/chat-doodles/eng.svg',
  '/chat-doodles/hist.svg',
  '/chat-doodles/geo.svg',
  '/js/api.js', 
  '/js/auth.js', 
  '/js/ui.js',
  '/js/webrtc.js',
  '/js/session-quiz.js',
  '/js/gamification.js'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL).catch(console.warn))
  );
});

self.addEventListener('fetch', e => {
  // Network-first for everything except maybe large static assets
  if (e.request.method !== 'GET') return;
  
  // Skip cross-origin or chrome-extension requests
  if (!e.request.url.startsWith(self.location.origin)) return;

  e.respondWith(
    fetch(e.request)
      .then(response => {
        // If valid response, update cache
        if (response && response.status === 200 && SHELL.some(p => e.request.url.endsWith(p))) {
          const clone = response.clone();
          caches.open(CACHE).then(cache => cache.put(e.request, clone));
        }
        return response;
      })
      .catch(() => {
        // Fallback to cache if network fails
        return caches.match(e.request);
      })
  );
});
