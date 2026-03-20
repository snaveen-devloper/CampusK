'use strict';
const express = require('express');
const router  = express.Router();
const jwt     = require('jsonwebtoken');
const { initDB, models } = require('../db');
const { User } = models;

// ── Auth middleware ───────────────────────────────────────────────────────────
function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// ── Cache helpers ─────────────────────────────────────────────────────────────
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes hard fallback

function getCache(app) {
  return app.locals.loopCache || null;
}

function setCache(app, data) {
  app.locals.loopCache = { ...data, ts: Date.now() };
}

function isCacheValid(app) {
  const c = getCache(app);
  return c && (Date.now() - c.ts) < CACHE_TTL_MS;
}

/** Call this whenever any user updates their subjects */
function invalidateLoopCache(app) {
  app.locals.loopCache = null;
}

// ── Step 1: Build directed skill graph ───────────────────────────────────────
/**
 * Returns:
 *   adjacency  { uid → [{to, subjects}] }
 *   userMap    { uid → {uid, name, subjects} }
 *   nodes      [{uid, name, subjects}]
 *   edges      [{from, to, subjects}]
 */
function buildSkillGraph(users) {
  const adjacency = {};
  const userMap   = {};
  const nodes     = [];
  const edges     = [];

  for (const u of users) {
    const subj = Array.isArray(u.subjects) ? u.subjects : [];
    userMap[u.uid] = { uid: u.uid, name: u.name, subjects: subj };
    adjacency[u.uid] = [];
    nodes.push({ uid: u.uid, name: u.name });
  }

  const uids = users.map(u => u.uid);

  for (let i = 0; i < uids.length; i++) {
    const a = userMap[uids[i]];
    const teaches = a.subjects.filter(s => s.teach).map(s => s.name || s.id);

    for (let j = 0; j < uids.length; j++) {
      if (i === j) continue;
      const b = userMap[uids[j]];
      const bNeeds = b.subjects.filter(s => s.learn).map(s => s.name || s.id);

      const matching = teaches.filter(t => bNeeds.includes(t));
      if (matching.length > 0) {
        adjacency[a.uid].push({ to: b.uid, subjects: matching });
        edges.push({ from: a.uid, to: b.uid, subjects: matching });
      }
    }
  }

  return { adjacency, userMap, nodes, edges };
}

// ── Step 2: Johnson's Algorithm (depth ≤ 4) ──────────────────────────────────
/**
 * Returns all simple directed cycles of length 3 or 4 in the graph.
 * Uses Johnson's canonical form: only visit nodes where uid >= startNode uid
 * to prevent A→B→C and C→B→A from both being returned.
 *
 * Each cycle is an array of uids: [start, n2, n3, ...] where the
 * implied last edge goes back to start.
 */
function findAllCycles(adjacency, allUids) {
  const cycles = [];

  for (const startUid of allUids) {
    // DFS stack: current path from startUid
    const stack = [startUid];
    const visited = new Set([startUid]);

    function dfs(current) {
      const neighbors = adjacency[current] || [];
      for (const { to } of neighbors) {
        // Canonical form: only expand to nodes with uid >= startUid
        // This prevents duplicate reversed cycles
        if (to < startUid) continue;

        if (to === startUid && stack.length >= 3 && stack.length <= 4) {
          // Found a cycle of length 3 or 4
          cycles.push([...stack]);
          continue;
        }

        if (!visited.has(to) && stack.length < 4) {
          stack.push(to);
          visited.add(to);
          dfs(to);
          stack.pop();
          visited.delete(to);
        }
      }
    }

    dfs(startUid);
  }

  return cycles;
}

// ── Step 3: Score each loop ───────────────────────────────────────────────────
/**
 * score = (uniqueSubjectsExchanged / totalSubjectsNeeded) * 100
 * 3-way loops get a 15% bonus.
 */
function scoreCycle(cycleUids, adjacency, userMap) {
  const uniqueExchanged = new Set();
  const allNeeded       = new Set();

  for (let i = 0; i < cycleUids.length; i++) {
    const from  = cycleUids[i];
    const to    = cycleUids[(i + 1) % cycleUids.length];
    const edge  = (adjacency[from] || []).find(e => e.to === to);
    if (edge) edge.subjects.forEach(s => uniqueExchanged.add(s));
  }

  for (const uid of cycleUids) {
    const u = userMap[uid];
    (u.subjects || []).filter(s => s.learn).forEach(s => allNeeded.add(s.name || s.id));
  }

  const base = allNeeded.size > 0 ? (uniqueExchanged.size / allNeeded.size) * 100 : 50;
  const threeWayBonus = cycleUids.length === 3 ? 1.15 : 1.0;
  return Math.min(Math.round(base * threeWayBonus), 100);
}

// ── Step 4: Enrich loop with member info + exchange details ──────────────────
function enrichCycle(cycleUids, adjacency, userMap) {
  const members = [];
  const exchange = [];
  const allNeedsSet = new Set();
  const coveredSet  = new Set();

  for (const uid of cycleUids) {
    const u = userMap[uid];
    const teaches = u.subjects.filter(s => s.teach).map(s => s.name || s.id);
    const needs   = u.subjects.filter(s => s.learn).map(s => s.name || s.id);
    needs.forEach(n => allNeedsSet.add(n));
    members.push({ uid, name: u.name, teaches, needs });
  }

  for (let i = 0; i < cycleUids.length; i++) {
    const from    = cycleUids[i];
    const to      = cycleUids[(i + 1) % cycleUids.length];
    const edge    = (adjacency[from] || []).find(e => e.to === to);
    const subjs   = edge ? edge.subjects : [];
    subjs.forEach(s => coveredSet.add(s));
    exchange.push({
      from_uid:   from,
      from_name:  userMap[from].name,
      to_uid:     to,
      to_name:    userMap[to].name,
      teaches:    subjs
    });
  }

  const is_complete = [...allNeedsSet].every(n => coveredSet.has(n));
  const score = scoreCycle(cycleUids, adjacency, userMap);

  return {
    members,
    exchange,
    type:        cycleUids.length === 3 ? '3-Way Loop' : '4-Way Loop',
    score,
    is_complete,
    uid_key:     [...cycleUids].sort().join('_')  // for de-duplication
  };
}

// ── Core: run full detection and return enriched loops ────────────────────────
async function detectLoops(app) {
  if (isCacheValid(app)) {
    return getCache(app);
  }

  await initDB();
  const rawUsers = await User.find({ is_banned: false }, 'uid name subjects');
  const users = rawUsers.map(u => ({
    uid:      u.uid,
    name:     u.name,
    subjects: Array.isArray(u.subjects) ? u.subjects : []
  }));

  const { adjacency, userMap, nodes, edges } = buildSkillGraph(users);
  const allUids = Object.keys(adjacency);

  // Run Johnson's algorithm
  const rawCycles = findAllCycles(adjacency, allUids);

  // Enrich and deduplicate
  const seen = new Set();
  const loops = [];
  for (const cycle of rawCycles) {
    const enriched = enrichCycle(cycle, adjacency, userMap);
    if (!seen.has(enriched.uid_key)) {
      seen.add(enriched.uid_key);
      loops.push(enriched);
    }
  }

  loops.sort((a, b) => b.score - a.score);

  const result = { loops, nodes, edges, total_users_in_graph: users.length };
  setCache(app, result);
  return result;
}

// ── Exported helper for WS and other routes ──────────────────────────────────
module.exports.detectLoops        = detectLoops;
module.exports.invalidateLoopCache = invalidateLoopCache;

// ── GET /api/loops/mine ───────────────────────────────────────────────────────
router.get('/mine', auth, async (req, res) => {
  try {
    const { loops, total_users_in_graph } = await detectLoops(req.app);
    const myLoops = loops.filter(l => l.members.some(m => m.uid === req.user.uid));
    res.json({ loops: myLoops, total_users_in_graph });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/loops/graph ──────────────────────────────────────────────────────
router.get('/graph', auth, async (req, res) => {
  try {
    const { nodes, edges, total_users_in_graph } = await detectLoops(req.app);
    res.json({ nodes, edges, total_users_in_graph });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/loops/suggest ───────────────────────────────────────────────────
// Returns users who, if connected with the requester, would form a loop.
router.post('/suggest', auth, async (req, res) => {
  try {
    await initDB();
    const meUid = req.user.uid;
    const meUser = await User.findOne({ uid: meUid }, 'uid name subjects');
    if (!meUser) return res.status(404).json({ error: 'User not found' });

    const meSubj = Array.isArray(meUser.subjects) ? meUser.subjects : [];
    const myTeach = meSubj.filter(s => s.teach).map(s => s.name || s.id);
    const myLearn = meSubj.filter(s => s.learn).map(s => s.name || s.id);

    const allUsers = await User.find({ uid: { $ne: meUid }, is_banned: false }, 'uid name subjects');

    // Score each potential partner: how much would they close a loop?
    const suggestions = [];
    for (const u of allUsers) {
      const theirSubj  = Array.isArray(u.subjects) ? u.subjects : [];
      const theyTeach  = theirSubj.filter(s => s.teach).map(s => s.name || s.id);
      const theyLearn  = theirSubj.filter(s => s.learn).map(s => s.name || s.id);

      // They can give me something I need AND I can give them something they need
      const theyGiveMe  = theyTeach.filter(t => myLearn.includes(t));
      const iGiveThem   = myTeach.filter(t => theyLearn.includes(t));

      if (theyGiveMe.length > 0 || iGiveThem.length > 0) {
        suggestions.push({
          uid:        u.uid,
          name:       u.name,
          they_teach: theyGiveMe,   // subjects they teach that I need
          i_teach:    iGiveThem,    // subjects I teach that they need
          match_score: theyGiveMe.length + iGiveThem.length
        });
      }
    }

    suggestions.sort((a, b) => b.match_score - a.match_score);
    res.json({ suggestions: suggestions.slice(0, 10) });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports.router = router;
