/* snake-ai.js — Snexel AI engine core (Phase A of docs/snake-ai-plan.md).
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
 *         fruitKill }  (all optional; Phase C presets will wrap them).
 */
(function () {
  const REV = { u: "d", d: "u", l: "r", r: "l" };
  const DIRS = { u: [0, -1], d: [0, 1], l: [-1, 0], r: [1, 0] };
  const LETHAL = 1e6;          // big finite score, not Infinity (sortable)
  const HIGH = 40;

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
          if (!fruitAt(w, x, y)) m[k] = foeNear ? LETHAL : HIGH;
        }
      }
    }
    // banana: whole row + column cross-fire
    for (const b of w.bananas) {
      const foeNear = kill && foeReach(b.x, b.y) <= zoneReach;
      const set = foeNear ? LETHAL : HIGH;
      for (let x = 0; x < w.gw; x++) if (!fruitAt(w, x, b.y)) m[key(x, b.y)] = set;
      for (let y = 0; y < w.gh; y++) if (!fruitAt(w, b.x, y)) m[key(b.x, y)] = set;
    }
    // foe projections: 1 and 2 ticks ahead (contested cells)
    for (const f of w.foes) {
      let p = f.body[0];
      for (let step = 1; step <= 2; step++) {
        const d = step === 1
          ? (f.queue && f.queue.length ? f.queue[0] : f.dir)
          : f.dir;
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

  function choose(w, opts) {
    const o = opts || {};
    const rng = w.rng || o.rng || mulberry32(1);
    const moves = legalMoves(w, o);
    if (!moves.length) return REV[w.dir];   // cornered: accept death

    const dm = o.danger === false ? {} : dangerMap(w, o);
    const blocked = hazardBlocked(w);
    const head = w.body[0];

    // Pick target: fruit with kill bonus, skipped when a foe is strictly
    // closer (we'd lose the race and get detonated instead).
    let best = null;
    for (const f of [...w.foods, ...w.pineapples, ...w.bananas]) {
      const mine = bfsDist(w, head, (x, y) => x === f.x && y === f.y, blocked);
      if (mine === Infinity) continue;
      let value = 1;
      const foeDist = Math.min(...w.foes.map(f2 =>
        bfsDist(w, f2.body[0], (x, y) => x === f.x && y === f.y, blocked)));
      if (o.fruitKill !== false && foeDist < mine) continue;          // lose race
      const foeHeadInZone = w.foes.some(f2 =>
        f.kind === "pineapple" && Math.abs(f2.body[0].x - f.x) + Math.abs(f2.body[0].y - f.y) <= (o.pineappleRadius ?? 5)
        || f.kind === "banana" && (f2.body[0].x === f.x || f2.body[0].y === f.y));
      if (foeHeadInZone && (f.kind === "pineapple" || f.kind === "banana")) value += 2; // instant-win move
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
    debug: {
      legalMoves: (w, o) => legalMoves(w, o).map(m => m.d),
      occupancy: (w) => occupancy(w),
      dangerMap: (w, o) => dangerMap(w, o),
      bfs: (w, from, to) => bfsDist(w, from, (x, y) => x === to.x && y === to.y, hazardBlocked(w)),
      reachableAfter: (w, cand, o) => reachableAfter(w, cand, o).count,
      mulberry32,
      REV,
    },
  };
  window.SnakeAI = T;
  globalThis.SnakeAI = T;   // bare `SnakeAI` in vm test sandboxes
})();
