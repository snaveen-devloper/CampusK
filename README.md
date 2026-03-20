# 🎓 CampusKarma

> **A peer-to-peer tutoring and learning platform built for students, powered by reputation.**

CampusKarma connects students within the same campus to teach and learn from each other. Earn **Karma Points (KP)** by helping your peers, climb **Karma Ranks**, and build a trusted academic reputation — all within your campus community.

---

## 🏆 Hackathon Goals

| Goal | Status |
|---|---|
| Real-time peer learning with WebRTC video calls | ✅ |
| Karma Points reputation & rank system | ✅ |
| AI-powered session scheduling & matchmaking | ✅ |
| PWA (installable, offline-capable) | ✅ |
| Gamification (quests, badges, leaderboard) | ✅ |
| Custom DiceBear avatar personalization | ✅ |

---

## ✨ Features

- **Peer Matching** — AI-assisted subject matching between students who want to teach/learn
- **1-on-1 Sessions** — WebRTC-powered encrypted video calls with in-call quiz support
- **Karma Points** — Earn KP by teaching; spend them in the Karma Store
- **Karma Ranks** — Newcomer → Rising Star → Scholar → Mentor → Sage → Legend (permanent, never decrease)
- **Study Rooms** — Collaborative group video rooms
- **AI Insights** — Auto-generated performance analysis and suggestions
- **Notes Sharing** — Post and browse peer study notes with attachments
- **Real-time Chat** — End-to-end encrypted direct messaging
- **PWA Ready** — Installable as a mobile app, works offline

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | Vanilla HTML/CSS/JS (Single Page App) |
| **Backend** | Node.js + Express |
| **Database** | SQLite (via `sqlite3`) + Mongoose schema definitions |
| **Real-time** | WebSockets (`ws`) |
| **Video** | WebRTC |
| **Auth** | JWT + bcrypt |
| **Push Notifications** | Web Push (VAPID) |
| **Avatars** | DiceBear API |

---

## 📁 Project Structure

```
campuskarma/
├── index.html              # Main SPA entry point
├── campuskarma.css         # Global stylesheet
├── manifest.json           # PWA manifest
├── sw.js                   # Service worker
├── js/                     # Frontend JS modules
│   ├── state.js            # Global app state & helpers
│   ├── api.js              # API fetch wrapper
│   ├── auth.js             # Login / signup screens
│   ├── ui.js               # Core UI renders (home, discover, requests)
│   ├── gamification.js     # Wallet, quests, store, karma rank
│   ├── chat.js             # Real-time chat UI
│   ├── session-quiz.js     # Sessions, calendar, and in-call quiz
│   ├── notes.js            # Notes tab
│   ├── rooms.js            # Study rooms
│   └── webrtc.js           # WebRTC video engine
└── backend/
    ├── server.js           # Express + WebSocket server entrypoint
    ├── db.js               # SQLite database connection
    ├── push.js             # Web Push notification helper
    ├── routes/             # API route handlers
    │   ├── auth.js, users.js, sessions.js, loops.js
    │   ├── quiz.js, notes.js, chat.js, rooms.js
    │   ├── store.js, requests.js, matchmaking.js
    │   ├── ai.js, activity.js, files.js, reports.js
    ├── models/             # Mongoose/SQLite data schemas
    └── lib/
        └── loopMatcher.js  # AI-style loop matching algorithm
```

---

## 🚀 Installation

### Prerequisites
- Node.js ≥ 18
- npm ≥ 9

### 1. Clone the repository
```bash
git clone https://github.com/YOUR_USERNAME/campuskarma.git
cd campuskarma
```

### 2. Set up the backend
```bash
cd backend
npm install
cp .env.example .env
# Edit .env and fill in your VAPID keys (see below)
```

### 3. Generate VAPID keys (for Push Notifications)
```bash
npx web-push generate-vapid-keys
# Paste the output into backend/.env
```

### 4. Start the server
```bash
npm start
# Server starts on http://localhost:3000
```

### 5. Open the app
Open `http://localhost:3000` in your browser (Chrome/Firefox recommended for WebRTC).

---

## ⚙️ Environment Variables

Copy `backend/.env.example` to `backend/.env` and fill in the values:

| Variable | Description |
|---|---|
| `VAPID_PUBLIC_KEY` | Web Push public key |
| `VAPID_PRIVATE_KEY` | Web Push private key |
| `JWT_SECRET` | Secret string for JWT signing (any random string) |

---

## 📱 PWA Installation

On mobile Chrome: tap the browser menu → **"Add to Home Screen"**.  
On desktop Chrome: click the install icon in the address bar.

---

## 🧑‍💻 Development

```bash
cd backend
npm run dev   # Starts server with --watch (auto-restart on file changes)
```

---

## 🗺️ Roadmap

- [ ] Multi-campus federation
- [ ] AI-powered study plan generator
- [ ] Blockchain-verified Karma credentials
- [ ] Mobile native app (React Native)

---

## 📄 License

MIT License — free to use, modify, and distribute.

---

## 👥 Team

Built with ❤️ for the hackathon. Powered by caffeine and Karma Points.
# CampusKarma
