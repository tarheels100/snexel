/* snake-ai.js — Snexel AI engine core (Phases A+B of docs/snake-ai-plan.md).
 * Pure decision engine: no DOM, no rAF, no sound, no game globals.
 * Classic script inside an IIFE, so its internals NEVER collide with the
 * shared global scope; it exposes only window.SnakeAI (+ globalThis alias).
 *
 * Consumers build a world snapshot per tick:
 *   { gw, gh, wrap, body, dir, foods:[{x,y}], pineapples:[{x,y}],
 *     bananas:[{x,y}], poops:[{x,y}] (VISIBLE piles only — fairness rule),
 *     foes:[{body, dir, queue}], rng }          (body arrays head-first)
 *
 * SnakeAI.choose(world, opts) -> "u"|"d"|"l"|"r".
 * opts: { danger, floodFill, slack, jitter, pineappleRadius, zoneReach,
 *         fruitKill, cycle, shortcutSlack, cycleHazard, flee, avoidFruit,
 *         hesitation, oppLookahead }  (all optional).
 * SnakeAI.presets(name, knobs) -> opts for: demo | baby | easy | normal | hard
 * (plan §3). Knobs merge over the preset base, so GAME_CONFIG.ai can tune.
 */
(function () {
  const REV = { u: "d", d: "u", l: "r", r: "l" };
  const DIRS = { u: [0, -1], d: [0, 1], l: [-1, 0], r: [1, 0] };
  const LETHAL = 1e6;          // big finite score, not Infinity (sortable)
  const HIGH = 40;
  const LOW = 1;               // blast-zone noise when no rival can detonate it

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const key = (x, y) => x + "," + y;
  const ptKey = (p, w) => {
    const q = w.wrap
      ? { x: ((p.x % w.gw) + w.gw) % w.gw, y: ((p.y % w.gh) + w.gh) % w.gh }
      : p;
    return key(q.x, q.y);
  };
  const inBoard = (w, x, y) => x >= 0 && x < w.gw && y >= 0 && y < w.gh;

  function neighbors(w, p) {
    const out = [];
    for (const d in DIRS) {
      const x = p.x + DIRS[d][0], y = p.y + DIRS[d][1];
      if (w.wrap) {
        out.push({ x: ((x % w.gw) + w.gw) % w.gw, y: ((y % w.gh) + w.gh) % w.gh, d });
      } else if (inBoard(w, x, y)) {
        out.push({ x, y, d });
      }
    }
    return out;
  }

  function fruitAt(w, x, y) {
    for (const f of w.foods)       if (f.x === x && f.y === y) return { kind: "apple" };
    for (const p of w.pineapples)  if (p.x === x && p.y === y) return { kind: "pineapple" };
    for (const b of w.bananas)     if (b.x === x && b.y === y) return { kind: "banana" };
    return null;
  }

  // Snake eats next tick => its tail STAYS occupied (game: no tail pop on eat).
  function eatsNext(w, snake) {
    const d = snake.queue && snake.queue.length ? snake.queue[0] : snake.dir;
    const n = neighbors(w, snake.body[0]).find(n => n.d === d);
    return n ? fruitAt(w, n.x, n.y) !== null : false;
  }

  // Occupancy for legality checks — mirrors tick(): all bodies EXCEPT the
  // tail slots that vacate this tick (own tail; foe tails unless the foe eats).
  function occupancy(w) {
    const s = new Set();
    // own body: neck cells lethal; head isn't a target; tail vacates (the
    // tail-chase exception — fruit never spawns on a body cell, so the
    // candidate can never be BOTH tail and food).
    for (let i = 1; i < w.body.length - 1; i++) s.add(ptKey(w.body[i], w));
    for (const f of w.foes) {
      const eat = eatsNext(w, f);
      for (let i = 0; i < f.body.length; i++) {
        if (!eat && i === f.body.length - 1) continue;   // foe tail pops
        s.add(ptKey(f.body[i], w));
      }
    }
    return s;
  }

  function legalMoves(w, opts) {
    const o = opts || {};
    const occ = occupancy(w);
    const poop = new Set(w.poops.map(p => ptKey(p, w)));
    const out = [];
    for (const n of neighbors(w, w.body[0])) {
      if (n.d === REV[w.dir]) continue;                 // 180° never legal
      const k = key(n.x, n.y);
      if (occ.has(k) || poop.has(k)) continue;          // body / visible pile
      out.push({ x: n.x, y: n.y, d: n.d });             // fruit cells legal
    }
    return out;
  }

  // BFS step-distance from `from` to predicate goalFn through free cells.
  // blocked = occupancy + poops (goal cell exempt — it's the target).
  function bfsDist(w, from, goalFn, blocked) {
    const bl = blocked || (() => false);
    const seen = new Set([ptKey(from, w)]);
    let q = [{ x: from.x, y: from.y }], dist = 0;
    while (q.length) {
      if (q.some(p => goalFn(p.x, p.y))) return dist;
      const next = [];
      for (const p of q) {
        for (const n of neighbors(w, p)) {
          const k = key(n.x, n.y);
          if (seen.has(k) || bl(n.x, n.y)) continue;
          seen.add(k);
          next.push({ x: n.x, y: n.y });
        }
      }
      q = next; dist++;
    }
    return Infinity;
  }

  const hazardBlocked = (w) => {
    const occ = occupancy(w);
    const poop = new Set(w.poops.map(p => ptKey(p, w)));
    return (x, y) => occ.has(key(x, y)) || poop.has(key(x, y));
  };

  // Per-cell penalty map: foe bodies lethal, foe projections + blast zones
  // high/lethal depending on how close a foe is to the fruit that detonates.
  function dangerMap(w, opts) {
    const o = opts || {};
    const m = {};
    const occ = occupancy(w);
    for (const k of occ) m[k] = LETHAL;
    for (const p of w.poops) m[ptKey(p, w)] = LETHAL;

    const foeReach = (fx, fy) => {
      let best = Infinity;
      for (const f of w.foes) {
        best = Math.min(best, bfsDist(w, f.body[0],
          (x, y) => x === fx && y === fy, hazardBlocked(w)));
      }
      return best;
    };
    const zoneReach = o.zoneReach ?? 3;
    const kill = o.fruitKill ?? true;

    // pineapple: radius blast kills everyone but the eater
    const r = o.pineappleRadius ?? 5;
    for (const p of w.pineapples) {
      const foeNear = kill && foeReach(p.x, p.y) <= zoneReach;
      for (let x = 0; x < w.gw; x++) for (let y = 0; y < w.gh; y++) {
        if (Math.abs(x - p.x) + Math.abs(y - p.y) <= r) {
          const k = key(x, y);
          if (!fruitAt(w, x, y)) m[k] = foeNear ? LETHAL : (w.foes.length ? HIGH : LOW);
        }
      }
    }
    // banana: whole row + column cross-fire
    for (const b of w.bananas) {
      const foeNear = kill && foeReach(b.x, b.y) <= zoneReach;
      const set = foeNear ? LETHAL : (w.foes.length ? HIGH : LOW);
      for (let x = 0; x < w.gw; x++) if (!fruitAt(w, x, b.y)) m[key(x, b.y)] = set;
      for (let y = 0; y < w.gh; y++) if (!fruitAt(w, b.x, y)) m[key(b.x, y)] = set;
    }
    // foe projections: queued-dir forward simulation, 1..K ticks ahead.
    // K = max(2, oppLookahead): base 2 ticks is the contested-cell tier;
    // hard tier raises K to cut off / dodge rival routes further ahead.
    const K = Math.max(2, o.oppLookahead ?? 0);
    for (const f of w.foes) {
      let p = f.body[0];
      const seq = f.queue && f.queue.length ? f.queue : [f.dir];
      for (let step = 1; step <= K; step++) {
        const d = seq[step - 1] ?? f.dir;
        if (!d) break;
        const n = neighbors(w, p).find(n => n.d === d);
        if (!n) break;
        const k = key(n.x, n.y);
        if (m[k] === undefined) m[k] = HIGH;
        p = n;
      }
    }
    return m;
  }

  // Flood-fill of cells reachable after moving into `cand`: new body = cand +
  // body (tail pops unless cand is a fruit). Survivable if reachable cells ≥
  // new length + slack (classic self-trap guard).
  function reachableAfter(w, cand, opts) {
    const o = opts || {};
    const eat = fruitAt(w, cand.x, cand.y) !== null;
    const newBody = eat ? [cand, ...w.body] : [cand, ...w.body.slice(0, -1)];
    const blocked = new Set();
    for (let i = 1; i < newBody.length; i++) blocked.add(ptKey(newBody[i], w));
    for (const p of w.poops) blocked.add(ptKey(p, w));
    for (const f of w.foes) for (const c of f.body) blocked.add(ptKey(c, w));

    const seen = new Set([key(cand.x, cand.y)]);
    let q = [cand], count = 1;
    while (q.length) {
      const next = [];
      for (const p of q) for (const n of neighbors(w, p)) {
        const k = key(n.x, n.y);
        if (seen.has(k) || blocked.has(k)) continue;
        seen.add(k); count++; next.push({ x: n.x, y: n.y });
      }
      q = next;
    }
    return { count, need: newBody.length + (o.slack ?? 1) };
  }

  /* ---- Phase B: Hamiltonian cycle (cached per grid size) ----
   * Serpentine cycle for EVEN gw x gh: start (0,0), U-pair row serpentine
   * over columns x>=1, then column-0 spine back up to (0,0). Uses only
   * non-wrap edges, so it stays valid while wrap mode toggles mid-match.
   * Strict following is provably never self-colliding: the body is the
   * contiguous run behind the head, and the next cycle cell is occupied
   * only if len >= N (board full — never reached in play).
   */
  const cycleCache = new Map();
  function buildCycle(gw, gh) {
    if (gw < 2 || gh < 2 || (gw * gh) % 2 !== 0) return null;   // odd grids: BFS tier only
    const pts = [{ x: 0, y: 0 }];
    for (let k = 0; k < gh / 2; k++) {
      const y0 = 2 * k, y1 = 2 * k + 1;
      for (let x = 1; x < gw; x++) pts.push({ x, y: y0 });
      for (let x = gw - 1; x >= 1; x--) pts.push({ x, y: y1 });
    }
    for (let y = gh - 1; y >= 1; y--) pts.push({ x: 0, y });
    // sanity: cover all cells exactly once, consecutive (incl. wrap-around) adjacent
    const idx = new Map();
    pts.forEach((p, i) => { if (idx.has(key(p.x, p.y))) return null; idx.set(key(p.x, p.y), i); });
    if (idx.size !== gw * gh) return null;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) !== 1) return null;
    }
    return { pts, idx };
  }
  function cycleFor(gw, gh) {
    const k = `${gw}x${gh}`;
    if (!cycleCache.has(k)) cycleCache.set(k, buildCycle(gw, gh));
    return cycleCache.get(k);
  }

  // Cycle-tier decision: strict follow, shortcut toward food, or hazard skip.
  // Returns { d, gain, tier } or null -> caller degrades to the BFS tier.
  function cycleMove(w, o, c) {
    const N = c.pts.length;
    const head = w.body[0], tail = w.body[w.body.length - 1];
    const hi = c.idx.get(key(head.x, head.y));
    const ti = c.idx.get(key(tail.x, tail.y));
    if (hi === undefined || ti === undefined) return null;   // off-cycle (odd grid / bug)

    const dm = o.danger === false ? {} : dangerMap(w, o);
    const th = o.cycleHazard ?? HIGH;
    const poop = new Set(w.poops.map(p => ptKey(p, w)));
    const hazard = (x, y) => {
      const p = dm[key(x, y)];
      return (p !== undefined && p >= th) || poop.has(key(x, y));
    };
    const occ = occupancy(w);
    const legal = legalMoves(w, o);
    const len = w.body.length;
    const slackK = o.shortcutSlack ?? 2;
    const fd = (j) => (j - hi + N) % N;

    // strict follower: next cycle cell, if free & legal
    const nx = c.pts[(hi + 1) % N];
    const strict = legal.find(m => m.x === nx.x && m.y === nx.y && !hazard(nx.x, nx.y));
    let best = strict ? { d: strict.d, gain: 1 } : null;

    // shortcuts: jump ahead along the cycle toward a fruit. Conditions:
    //   1. landing cell legal + hazard-free
    //   2. every cycle cell SKIPPED (head..landing) unoccupied, hazard-free
    //      AND fruit-free (never leapfrog an apple on the way)
    //   3. slack: cycle distance from landing forward to the tail >= newLen + slackK
    //      (never outrun the tail around the loop)
    //   4. gain <= shortcutMax (demo: small darts only; grid-adjacent cells
    //      in a serpentine can be ~49 cycle steps apart, so an uncapped
    //      max-gain shortcut turns the sweep into endless straight dashes)
    const fruits = [...w.foods.map(p => ({ x: p.x, y: p.y, kind: "food" })),
      ...w.pineapples.map(p => ({ x: p.x, y: p.y, kind: "pineapple" })),
      ...w.bananas.map(p => ({ x: p.x, y: p.y, kind: "banana" }))];

    // BFS dart: serpentine cycle order makes an apple 4 cells BELOW the head
    // a ~600-step scenic detour (down to the bottom row, around, up the
    // spine, back down) and always approaches cells from above. If a fruit
    // is genuinely closer through open space than the sweep route, dart
    // toward it — any direction, any approach side. Conditions: landing
    // strictly reduces BFS distance vs the sweep route, landing within
    // dartRange, skipped cycle segment safe + fruit-free, tail slack kept.
    const blockedFn = (x, y) => occ.has(key(x, y)) || hazard(x, y);
    const specialMax = o.specialMaxDist ?? Infinity;
    const near = (pt) => {
      let bestF = null;
      for (const f of fruits) {
        const dd = bfsDist(w, pt, (x, y) => x === f.x && y === f.y, blockedFn);
        if (dd === Infinity) continue;
        const val = f.kind === "food" ? 1 : (dd <= specialMax ? (o.specialWeight ?? 1) : 0);
        if (val <= 0) continue;
        const score = val / Math.max(dd, 1);
        if (!bestF || score > bestF.score) bestF = { dist: dd, score };
      }
      return bestF;
    };
    const dartRange = o.dartRange ?? Infinity;
    let dart = null;
    const headNear = near(head);
    if (headNear && headNear.dist <= dartRange) {
      const strictNear = strict ? near(nx) : null;
      const need = strictNear ? strictNear.dist : headNear.dist;
      for (const m of legal) {
        if (strict && m.d === strict.d) continue;
        if (hazard(m.x, m.y)) continue;
        const j = c.idx.get(key(m.x, m.y));
        if (j === undefined) continue;
        const g = fd(j);
        if (g <= 1) continue;
        const mNear = near({ x: m.x, y: m.y });
        if (!mNear || mNear.dist >= need) continue;      // must beat the sweep
        // A dart is one physical grid step - cycle skipped-segment rules do
        // not apply (we are not leaping along the cycle). Darts always get a
        // flood-fill room check (stricter than the BFS tier's, on purpose),
        // regardless of the floodFill knob.
        if (reachableAfter(w, { x: m.x, y: m.y }, o).count < len + (o.slack ?? 1)) continue;
        if (!dart || mNear.dist < dart.dist) dart = { d: m.d, gain: g, dist: mNear.dist };
      }
      if (dart) best = { d: dart.d, gain: dart.gain };
    }

    for (const f of fruits) {
      if (dart) break;                                 // darting beats gain shortcuts
      const fi = c.idx.get(key(f.x, f.y));
      if (fi === undefined || hazard(f.x, f.y)) continue;
      const fdist = fd(fi);
      if (fdist <= 1) continue;                    // adjacent food handled by strict/legal moves
      const sw = f.kind === "food" ? 1 : (o.specialWeight ?? 1);
      if (f.kind !== "food" && fdist > (o.specialMaxDist ?? Infinity)) continue;  // distant spectacle: don't leave the cycle for it
      for (const m of legal) {
        const j = c.idx.get(key(m.x, m.y));
        if (j === undefined) continue;
        const g = fd(j);
        if (g <= 1 || g > fdist || g > (o.shortcutMax ?? Infinity)) continue;  // land at or before the fruit, never past it
        let ok = true;
        for (let s = 1; s < g; s++) {
          const sc = c.pts[(hi + s) % N];
          if (occ.has(key(sc.x, sc.y)) || hazard(sc.x, sc.y) || fruitAt(w, sc.x, sc.y)) { ok = false; break; }
        }
        if (!ok) continue;
        const newLen = len + (fruitAt(w, m.x, m.y) ? 1 : 0);
        const toTail = (ti - j + N) % N;
        if (toTail < newLen + slackK) continue;    // would outrun the tail around the loop
        if (!best || g * sw > best.gain) best = { d: m.d, gain: g * sw };
      }
    }
    if (!best) return null;                        // hazards block the cycle ahead -> BFS tier
    debugStats.gain = best.gain;
    return { d: best.d, gain: best.gain, tier: "cycle" };
  }

  let debugStats = { gain: 1, tier: "bfs" };    // last choose() tier, for tests

  /* ---- Phase C: presets (plan §3) — one engine, five personalities ---- */
  const PRESETS = {
    demo:   { cycle: true, shortcutSlack: 6, shortcutMax: 8, dartRange: 24, danger: true, floodFill: true, slack: 2, jitter: 1, zoneReach: 3, fruitKill: true, specialWeight: 0.5, specialMaxDist: 8 },
    baby:   { flee: true, avoidFruit: true, danger: true, floodFill: true, slack: 1, jitter: 0.35, hesitation: 0.3 },
    easy:   { danger: true, floodFill: false, jitter: 0.8 },                 // distracted human
    normal: { danger: true, floodFill: true, slack: 2, jitter: 0.4, zoneReach: 3, fruitKill: true },
    hard:   { cycle: true, shortcutSlack: 2, shortcutMax: 24, dartRange: 10, danger: true, floodFill: true, slack: 2, jitter: 0.1, fruitKill: true, zoneReach: 4, oppLookahead: 3 },
  };
  function presets(name, knobs) {
    const base = PRESETS[name];
    if (!base) throw new Error("unknown SnakeAI preset: " + name);
    return Object.assign({}, base, knobs || {});
  }

  /* ---- Phase C: flee mode (baby preset, plan §3.1) ----
   * Maximize BFS distance from the nearest foe head; never enters fruit
   * (avoidFruit) or hazards; flood-fill keeps it out of dead-end corners
   * until genuinely cornered (caller's freeze fallback stays). Hesitation
   * keeps the old direction ~30% of ticks so a human can intercept — the
   * baby must stay catchable or the egg→mini-game pipeline dies.
   */
  function fleeMove(w, o, rng, dm) {
    const legalAll = legalMoves(w, o);
    const legal = o.avoidFruit ? legalAll.filter(m => !fruitAt(w, m.x, m.y)) : legalAll;
    if (!legal.length) return null;                    // cornered -> caller fallback
    if (w.dir && rng() < (o.hesitation ?? 0)) {
      const keep = legal.find(m => m.d === w.dir);
      if (keep) return keep.d;
    }
    const heads = (w.foes || []).map(f => f.body[0]);
    const len = w.body.length;
    let scored = legal.map(m => {
      let s = 0;
      if (heads.length) {
        s = Math.min(...heads.map(h => bfsDist(w, m, (x, y) => x === h.x && y === h.y, hazardBlocked(w))));
      }
      const p = dm[key(m.x, m.y)];
      if (p !== undefined) s -= p;                     // steer clear of blast zones/poops
      const reach = o.floodFill ? reachableAfter(w, m, o).count : 0;
      return { d: m.d, s, reach };
    });
    if (o.floodFill) {
      const need = len + (o.slack ?? 1);
      const safe = scored.filter(e => e.reach >= need);
      if (safe.length) scored = safe;
      else scored.sort((a, b) => b.reach - a.reach);   // trapped: maximize freedom, die last
    }
    scored.sort((a, b) => b.s - a.s);
    if (rng() < (o.jitter ?? 0) && scored.length > 1) return scored[1].d;
    return scored[0].d;
  }

  function choose(w, opts) {
    const o = opts || {};
    debugStats = { gain: 1, tier: "bfs" };
    if (o.cycle) {
      const c = cycleFor(w.gw, w.gh);
      if (c) {
        const mv = cycleMove(w, o, c);
        if (mv) { debugStats = { gain: mv.gain, tier: mv.tier }; return mv.d; }
        // cycle unusable (hazard on it / off-cycle) -> degrade to BFS tier below
      }
    }
    const rng = w.rng || o.rng || mulberry32(1);
    if (o.flee) {
      debugStats.tier = "flee";
      const fdm = o.danger === false ? {} : dangerMap(w, o);
      const fd = fleeMove(w, o, rng, fdm);
      if (fd) return fd;
      return w.dir ? REV[w.dir] : "r";                 // cornered: caller's freeze fallback
    }
    const moves = legalMoves(w, o);
    if (!moves.length) return REV[w.dir];   // cornered: accept death

    const dm = o.danger === false ? {} : dangerMap(w, o);
    const blocked = hazardBlocked(w);
    const head = w.body[0];

    // Pick target: fruit with kill bonus, skipped when a foe is strictly
    // closer (we'd lose the race and get detonated instead).
    let best = null;
    // kind is derived from the source array, so consumers don't have to tag
    // their fruit objects (game.js pushes plain {x, y}).
    for (const f of [...w.foods.map(p => ({ x: p.x, y: p.y, kind: "food" })),
                     ...w.pineapples.map(p => ({ x: p.x, y: p.y, kind: "pineapple" })),
                     ...w.bananas.map(p => ({ x: p.x, y: p.y, kind: "banana" }))]) {
      const mine = bfsDist(w, head, (x, y) => x === f.x && y === f.y, blocked);
      if (mine === Infinity) continue;
      let value = 1;
      const foeDist = Math.min(...w.foes.map(f2 =>
        bfsDist(w, f2.body[0], (x, y) => x === f.x && y === f.y, blocked)));
      if (o.fruitKill !== false && foeDist < mine) continue;          // lose race
      const foeHeadInZone = w.foes.some(f2 =>
        f.kind === "pineapple" && Math.abs(f2.body[0].x - f.x) + Math.abs(f2.body[0].y - f.y) <= (o.pineappleRadius ?? 5)
        || f.kind === "banana" && (f2.body[0].x === f.x || f2.body[0].y === f.y));
      if (f.kind === "pineapple" || f.kind === "banana") {
        if (foeHeadInZone && o.fruitKill !== false) value = 3;        // guaranteed kill move
        else {
          if (mine > (o.specialMaxDist ?? Infinity)) continue;        // distant spectacle: ignore
          value = o.specialWeight ?? 1;                               // mild interest (demo: 0.5)
        }
      }
      const score = value / Math.max(mine, 1);
      if (!best || score > best.score) best = { f, dist: mine, score };
    }

    const foeHeadDist = (p) => Math.min(...w.foes.map(f =>
      Math.abs(f.body[0].x - p.x) + Math.abs(f.body[0].y - p.y)), 999);

    const scored = moves.map(mv => {
      let s = 0;
      const pen = dm[key(mv.x, mv.y)] || 0;
      s -= pen >= LETHAL ? LETHAL : pen;
      if (best) {
        const d = bfsDist(w, mv, (x, y) => x === best.f.x && y === best.f.y,
          blocked);
        s -= d === Infinity ? 300 : d * 10;
      } else {
        s += foeHeadDist(mv) * 10;                 // wander: keep away from foes
      }
      if (o.floodFill) {
        const { count, need } = reachableAfter(w, mv, o);
        if (count < need) s -= LETHAL / 2;         // self-trap: near-banned
      }
      return { d: mv.d, s };
    });
    scored.sort((a, b) => b.s - a.s);
    const n = Math.max(1, Math.min(o.jitter ?? 1, scored.length));
    return scored[Math.floor(rng() * n)].d;
  }

  const T = {
    choose,
    presets,
    debug: {
      legalMoves: (w, o) => legalMoves(w, o).map(m => m.d),
      occupancy: (w) => occupancy(w),
      dangerMap: (w, o) => dangerMap(w, o),
      bfs: (w, from, to) => bfsDist(w, from, (x, y) => x === to.x && y === to.y, hazardBlocked(w)),
      reachableAfter: (w, cand, o) => reachableAfter(w, cand, o).count,
      mulberry32,
      REV,
      cycleFor: (gw, gh) => buildCycle(gw, gh),      // fresh build (uncached) for cover tests
      cycleIndex: (w, x, y) => { const c = cycleFor(w.gw, w.gh); return c ? c.idx.get(key(x, y)) : undefined; },
      lastTier: () => debugStats,
      PRESETS,
    },
  };
  window.SnakeAI = T;
  globalThis.SnakeAI = T;   // bare `SnakeAI` in vm test sandboxes
})();
