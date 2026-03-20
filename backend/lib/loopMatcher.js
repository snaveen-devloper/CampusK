'use strict';

/**
 * Loop Matchmaking Algorithm — CampusKarma
 *
 * Builds a directed "karma loop" connecting N users such that:
 *   User A teaches → User B, User B teaches → User C, ... User N teaches → User A
 *
 * Every user in the loop will have at least one session as a TEACHER and
 * at least one as a STUDENT, ensuring knowledge flows in a circle.
 *
 * Algorithm:
 *  1. Build a bipartite compatibility graph: edge (A→B) if A can teach something B needs
 *  2. Greedily find a Hamiltonian path using rank-weighted DFS
 *  3. If the last node can also teach the first node, we get a perfect closed loop
 *  4. Otherwise, return the longest chain found (open loop) and flag unmatched users
 *
 * @param {Array} users - Array of user objects:
 *   { uid, name, subjects: [{name, teach, learn}], teaching_score, rep_score }
 * @returns {{ loop: Array, unmatched: Array, is_closed: boolean }}
 *   loop: Array of { teacher_uid, student_uid, subject }
 */
function buildKarmaLoop(users) {
  if (!users || users.length < 2) {
    return { loop: [], unmatched: users.map(u => u.uid), is_closed: false };
  }

  // ── Step 1: Extract teach/learn sets per user ────────────────────────────
  const teachMap = {}; // uid → Set of subjects they can teach
  const learnMap = {}; // uid → Set of subjects they want to learn

  for (const u of users) {
    teachMap[u.uid] = new Set();
    learnMap[u.uid] = new Set();

    if (Array.isArray(u.subjects)) {
      for (const s of u.subjects) {
        const name = typeof s === 'string' ? s : s.name;
        if (!name) continue;
        if (s.teach) teachMap[u.uid].add(name.toLowerCase());
        if (s.learn) learnMap[u.uid].add(name.toLowerCase());
      }
    }
  }

  // ── Step 2: Build compatibility graph ────────────────────────────────────
  // edges[uid] = array of { to_uid, subject, weight }
  // weight = teacher.teaching_score + teacher.rep_score for ranking
  const edges = {};
  for (const u of users) {
    edges[u.uid] = [];
    for (const v of users) {
      if (v.uid === u.uid) continue;
      // Find subjects u can teach that v wants to learn
      const overlap = [...teachMap[u.uid]].filter(s => learnMap[v.uid].has(s));
      if (overlap.length > 0) {
        const weight = (u.teaching_score || 0) + (u.rep_score || 1.0);
        edges[u.uid].push({ to_uid: v.uid, subject: overlap[0], weight });
      }
    }
    // Sort by weight descending so best matches are tried first
    edges[u.uid].sort((a, b) => b.weight - a.weight);
  }

  // ── Step 3: Greedy Hamiltonian path with backtracking ────────────────────
  const uids = users.map(u => u.uid);
  let bestPath = [];
  let bestAssignments = [];

  function dfs(currentUid, visited, path, assignments) {
    if (path.length > bestPath.length) {
      bestPath = [...path];
      bestAssignments = [...assignments];
    }

    for (const edge of (edges[currentUid] || [])) {
      if (visited.has(edge.to_uid)) continue;
      visited.add(edge.to_uid);
      path.push(edge.to_uid);
      assignments.push({ teacher_uid: currentUid, student_uid: edge.to_uid, subject: edge.subject });
      dfs(edge.to_uid, visited, path, assignments);
      path.pop();
      assignments.pop();
      visited.delete(edge.to_uid);

      // Early exit if we've found a path covering all users
      if (bestPath.length === uids.length) return;
    }
  }

  // Try starting from each user; pick the best result
  for (const startUid of uids) {
    if (bestPath.length === uids.length) break; // Already found full path
    const visited = new Set([startUid]);
    dfs(startUid, visited, [startUid], []);
  }

  // ── Step 4: Check if loop can be closed (last teaches first) ─────────────
  let is_closed = false;
  const finalLoop = [...bestAssignments];

  if (bestPath.length >= 2) {
    const lastUid = bestPath[bestPath.length - 1];
    const firstUid = bestPath[0];
    const closingEdge = (edges[lastUid] || []).find(e => e.to_uid === firstUid);
    if (closingEdge) {
      finalLoop.push({ teacher_uid: lastUid, student_uid: firstUid, subject: closingEdge.subject });
      is_closed = true;
    }
  }

  const matchedUids = new Set(bestPath);
  const unmatched = uids.filter(uid => !matchedUids.has(uid));

  return { loop: finalLoop, unmatched, is_closed };
}

module.exports = { buildKarmaLoop };
