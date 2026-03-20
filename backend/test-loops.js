/**
 * CampusKarma — Loop Detection Verification Script
 * 
 * Uses your LIVE MongoDB database (reads from .env).
 * Run from the backend folder:
 *   node test-loops.js
 * 
 * What it does:
 *  1. Connects to your real MongoDB
 *  2. Loads all registered, non-banned users
 *  3. Runs Johnson's loop detection algorithm on live data
 *  4. Prints a summary of all discovered loops to the console
 *  5. Exits 0 on success, 1 on error
 */

'use strict';
require('dotenv').config();
const mongoose = require('mongoose');
const User     = require('./models/User');

// ─── Inline copy of the detection logic (no HTTP needed) ─────────────────────

function buildSkillGraph(users) {
  const adjacency = {};
  const userMap   = {};

  for (const u of users) {
    const subj = Array.isArray(u.subjects) ? u.subjects : [];
    userMap[u.uid] = { uid: u.uid, name: u.name, subjects: subj };
    adjacency[u.uid] = [];
  }

  const uids = users.map(u => u.uid);
  for (let i = 0; i < uids.length; i++) {
    const a      = userMap[uids[i]];
    const teaches = a.subjects.filter(s => s.teach).map(s => s.name || s.id);
    for (let j = 0; j < uids.length; j++) {
      if (i === j) continue;
      const b      = userMap[uids[j]];
      const bNeeds = b.subjects.filter(s => s.learn).map(s => s.name || s.id);
      const match  = teaches.filter(t => bNeeds.includes(t));
      if (match.length > 0) adjacency[a.uid].push({ to: b.uid, subjects: match });
    }
  }

  return { adjacency, userMap };
}

function findAllCycles(adjacency, allUids) {
  const cycles = [];
  for (const startUid of allUids) {
    const stack   = [startUid];
    const visited = new Set([startUid]);
    function dfs(current) {
      for (const { to } of (adjacency[current] || [])) {
        if (to < startUid) continue;
        if (to === startUid && stack.length >= 3 && stack.length <= 4) {
          cycles.push([...stack]);
          continue;
        }
        if (!visited.has(to) && stack.length < 4) {
          stack.push(to); visited.add(to);
          dfs(to);
          stack.pop(); visited.delete(to);
        }
      }
    }
    dfs(startUid);
  }
  return cycles;
}

function enrichCycle(cycleUids, adjacency, userMap) {
  const exchange = [];
  for (let i = 0; i < cycleUids.length; i++) {
    const from  = cycleUids[i];
    const to    = cycleUids[(i + 1) % cycleUids.length];
    const edge  = (adjacency[from] || []).find(e => e.to === to);
    exchange.push({
      from: userMap[from].name,
      to:   userMap[to].name,
      subjects: edge ? edge.subjects : []
    });
  }
  return {
    type:    cycleUids.length === 3 ? '3-Way Loop' : '4-Way Loop',
    members: cycleUids.map(uid => userMap[uid].name),
    exchange
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/campuskarma';
  console.log(`\n📦 Connecting to MongoDB: ${MONGODB_URI.replace(/:\/\/.*@/, '://<credentials>@')}`);

  await mongoose.connect(MONGODB_URI);
  console.log('✅ Connected\n');

  const rawUsers = await User.find({ is_banned: false }, 'uid name subjects');
  const users    = rawUsers.map(u => ({
    uid:      u.uid,
    name:     u.name,
    subjects: Array.isArray(u.subjects) ? u.subjects : []
  }));

  console.log(`👥 Total users loaded: ${users.length}`);

  if (users.length < 3) {
    console.log('\n⚠️  Need at least 3 registered users with complementary subjects to find loops.');
    console.log('   Register users via the app who teach different subjects that others want to learn.');
    await mongoose.disconnect();
    process.exit(0);
  }

  // Show subject overview
  console.log('\n📚 User subjects:');
  for (const u of users) {
    const teaches = u.subjects.filter(s => s.teach).map(s => s.name || s.id).join(', ') || '(none)';
    const learns  = u.subjects.filter(s => s.learn).map(s => s.name || s.id).join(', ') || '(none)';
    console.log(`   ${u.name.padEnd(20)} teaches: ${teaches.padEnd(30)} wants: ${learns}`);
  }

  const { adjacency, userMap } = buildSkillGraph(users);
  const edgeCount = Object.values(adjacency).reduce((s, arr) => s + arr.length, 0);
  console.log(`\n🔗 Skill graph: ${users.length} nodes, ${edgeCount} directed edges`);

  console.log('\n🔍 Running Johnson\'s loop detection (max depth 4)…');
  const start      = Date.now();
  const rawCycles  = findAllCycles(adjacency, Object.keys(adjacency));
  const elapsed    = Date.now() - start;

  // De-duplicate
  const seen   = new Set();
  const loops  = [];
  for (const cycle of rawCycles) {
    const key = [...cycle].sort().join('_');
    if (!seen.has(key)) { seen.add(key); loops.push(cycle); }
  }

  console.log(`⏱️  Completed in ${elapsed}ms`);
  console.log(`\n🎯 Found ${loops.length} unique loop(s):\n`);

  if (loops.length === 0) {
    console.log('   No loops detected yet.');
    console.log('   Tip: Create users where A teaches Math & learns Chemistry,');
    console.log('        B teaches Chemistry & learns Physics,');
    console.log('        C teaches Physics & learns Mathematics — this forms a 3-way loop!');
  } else {
    loops.forEach((cycle, i) => {
      const enriched = enrichCycle(cycle, adjacency, userMap);
      console.log(`Loop ${i + 1}: [${enriched.type}]`);
      console.log(`  Members: ${enriched.members.join(' → ')} → ${enriched.members[0]}`);
      enriched.exchange.forEach(ex => {
        console.log(`  ${ex.from} teaches ${ex.to}: ${ex.subjects.join(', ')}`);
      });
      console.log();
    });
  }

  await mongoose.disconnect();
  console.log('✅ Done. Disconnected from MongoDB.');
  process.exit(0);
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
