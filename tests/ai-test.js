/* tests/ai-test.js - SnakeAI engine suite (Phases A+B of docs/snake-ai-plan.md).
 * Loads src/snake-ai.js ALONE in a vm sandbox: the engine must have zero
 * game/DOM dependencies. Mirrors plan §5 assertions for the core tier. */
const fs = require("fs");
const vm = require("vm");
const path = require("path");

const code = fs.readFileSync(path.join(__dirname, "..", "src", "snake-ai.js"), "utf8");
const sb = { window: {} };
vm.runInNewContext(code, sb);
const AI = sb.SnakeAI;
const D = AI.debug;
const K = (x, y) => x + "," + y;

let fails = 0;
function check(name, cond) {
  if (!cond) { console.log("FAIL :: " + name); fails++; }
  else console.log("PASS :: " + name);
}
const P = (x, y) => ({ x, y });
function W(o) {
  return Object.assign({
    gw: 8, gh: 6, wrap: false, body: [P(1, 1)], dir: "r",
    foods: [], pineapples: [], bananas: [], poops: [], foes: [],
  }, o);
}

check("engine loads: window + globalThis aliases, no game deps",
  sb.window.SnakeAI === AI && sb.SnakeAI === AI);

// ---- determinism ----
const w0 = W({ body: [P(2, 2), P(1, 2)], foods: [P(5, 2)] });
const a = AI.choose(w0, { rng: D.mulberry32(42) });
const b = AI.choose(w0, { rng: D.mulberry32(42) });
check("determinism: same seed -> same move", a === b && "udlr".includes(a));

// ---- legal-move mirror of tick() ----
check("wall refused (wrap off), portal legal (wrap on)",
  !D.legalMoves(W({ body: [P(2, 0), P(2, 1)], dir: "r" })).includes("u") &&
  D.legalMoves(W({ body: [P(2, 0), P(2, 1)], dir: "r", wrap: true })).includes("u"));
check("180 reversal refused", !D.legalMoves(W({ body: [P(2, 2), P(1, 2)], dir: "r" })).includes("l"));
check("own neck lethal, own vacating tail legal (tail-chase)",
  !D.legalMoves(W({ body: [P(4, 5), P(4, 4), P(3, 4), P(3, 5)], dir: "u", gw: 8, gh: 8 })).includes("u") &&
  D.legalMoves(W({ body: [P(4, 5), P(4, 4), P(3, 4), P(3, 5)], dir: "u", gw: 8, gh: 8 })).includes("l") &&
  !D.occupancy(W({ body: [P(4, 5), P(4, 4), P(3, 4), P(3, 5)] })).has(K(3, 5)));
check("foe tail legal; foe eating keeps tail occupied",
  D.legalMoves(W({ body: [P(2, 3), P(3, 3)], dir: "l", foes: [{ body: [P(1, 2), P(1, 3)], dir: "d" }] })).includes("l") &&
  !D.legalMoves(W({ body: [P(2, 3), P(3, 3)], dir: "l", foods: [P(1, 3)],
    foes: [{ body: [P(1, 2), P(1, 3)], dir: "d", queue: ["d"] }] })).includes("l"));
check("visible poop lethal",
  !D.legalMoves(W({ body: [P(2, 2), P(3, 2)], dir: "l", poops: [P(1, 2)] })).includes("l"));
check("fruit cell legal",
  D.legalMoves(W({ body: [P(2, 2), P(3, 2)], dir: "l", foods: [P(1, 2)] })).includes("l"));

// ---- BFS ----
check("bfs wrap distance 1 vs straight 7",
  D.bfs(W({ gw: 8, body: [P(0, 2)], wrap: true }), P(0, 2), P(7, 2)) === 1 &&
  D.bfs(W({ gw: 8, body: [P(0, 2)] }), P(0, 2), P(7, 2)) === 7);
check("bfs routes through foe vacating tail; blocked when foe eats",
  D.bfs(W({ gw: 6, gh: 6, body: [P(0, 2)], foes: [{ body: [P(3, 0), P(3, 1), P(3, 2), P(3, 3), P(3, 4), P(3, 5)], dir: "u" }] }), P(0, 2), P(4, 2)) === 10 &&
  D.bfs(W({ gw: 6, gh: 6, body: [P(0, 2)], foods: [P(3, 1)],
    foes: [{ body: [P(3, 0), P(3, 1), P(3, 2), P(3, 3), P(3, 4), P(3, 5)], dir: "u", queue: ["d"] }] }), P(0, 2), P(4, 2)) === Infinity);

// ---- danger map ----
const pine = (foe) => W({ gw: 8, gh: 8, body: [P(1, 1)], pineapples: [P(4, 4)], foes: foe });
check("pineapple zone lethal when foe can reach fruit, high when far",
  D.dangerMap(pine([{ body: [P(2, 4), P(2, 5)], dir: "u" }]))[K(3, 4)] === 1e6 &&
  D.dangerMap(pine([{ body: [P(0, 0), P(1, 0)], dir: "r" }]))[K(3, 4)] === 40);
check("fruit cell itself is not danger",
  D.dangerMap(pine([{ body: [P(2, 4), P(2, 5)], dir: "u" }]))[K(4, 4)] === undefined);
check("banana row+column lethal when foe near, high when far",
  D.dangerMap(W({ gw: 8, gh: 8, body: [P(1, 1)], bananas: [P(3, 3)], foes: [{ body: [P(0, 3), P(0, 4)], dir: "u" }] }))[K(0, 3)] === 1e6 &&
  D.dangerMap(W({ gw: 8, gh: 8, body: [P(1, 1)], bananas: [P(3, 3)], foes: [{ body: [P(0, 3), P(0, 4)], dir: "u" }] }))[K(3, 0)] === 1e6 &&
  D.dangerMap(W({ gw: 8, gh: 8, body: [P(1, 1)], bananas: [P(3, 3)], foes: [{ body: [P(7, 7), P(6, 7)], dir: "l" }] }))[K(0, 3)] === 40);
check("foe projection cells marked high",
  D.dangerMap(W({ body: [P(1, 1)], foes: [{ body: [P(5, 2), P(6, 2)], dir: "l", queue: ["l"] }] }))[K(4, 2)] === 40);

// ---- flood-fill survivability ----
const ring = W({ gw: 6, gh: 6, body: [P(3, 1), P(2, 1), P(2, 2), P(2, 3), P(3, 3), P(4, 3), P(4, 2), P(4, 1)], dir: "l" });
check("pocket reach = 1, open side = survivable",
  D.reachableAfter(ring, P(3, 2)) === 1 && D.reachableAfter(ring, P(3, 0)) >= 9);
check("choose refuses the self-trap move into the ring pocket",
  AI.choose(ring, { floodFill: true, slack: 1, jitter: 1, rng: D.mulberry32(5) }) !== "d" &&
  D.legalMoves(ring).includes("d"));

// ---- target selection ----
check("heads toward nearest apple",
  AI.choose(W({ body: [P(2, 2), P(1, 2)], foods: [P(5, 2)], jitter: 1, rng: D.mulberry32(1) }), {}) === "r");
check("fruit kill bonus: prefers pineapple with foe head inside radius",
  AI.choose(W({ gw: 8, gh: 6, body: [P(3, 2), P(2, 2)], foods: [P(0, 2)], pineapples: [P(4, 2)],
    foes: [{ body: [P(4, 3), P(5, 3)], dir: "u" }] }, {}), { pineappleRadius: 5, jitter: 1, rng: D.mulberry32(2) }) === "r");
check("race-skip + flee: foe strictly closer to pineapple -> moves away, never into zone",
  ["r", "d"].includes(AI.choose(W({ gw: 8, gh: 6, body: [P(6, 4), P(6, 5)], dir: "u", pineapples: [P(4, 4)],
    foes: [{ body: [P(4, 3), P(5, 3)], dir: "u" }] }, {}), { pineappleRadius: 2, zoneReach: 3, jitter: 1, rng: D.mulberry32(3) })));

// ---- fuzz soak: core tier must never die ----
{
  const w = W({ gw: 14, gh: 10, wrap: true, body: [P(5, 2), P(4, 2), P(3, 2), P(2, 2)], dir: "r",
    foods: [P(7, 2), P(7, 5)], poops: [P(4, 5), P(8, 7), P(2, 6)] });
  const rng = D.mulberry32(7);
  const opts = { danger: true, floodFill: true, jitter: 3, slack: 1, rng };
  let dir = w.dir, deaths = 0, grew = 0;
  for (let step = 0; step < 300; step++) {
    const prev = w.dir;
    dir = AI.choose(w, opts);
    if (dir === D.REV[prev]) { deaths++; break; }
    const h = { x: (w.body[0].x + { u: 0, d: 0, l: -1, r: 1 }[dir]) % w.gw,
                y: (w.body[0].y + { u: -1, d: 1, l: 0, r: 0 }[dir]) % w.gh };
    h.x = (h.x + w.gw) % w.gw; h.y = (h.y + w.gh) % w.gh;
    // death mirrors tick(): body minus vacating tail, + visible poops
    const tail = w.body[w.body.length - 1];
    const hitBody = w.body.slice(0, -1).some(c => c.x === h.x && c.y === h.y) && !(tail.x === h.x && tail.y === h.y);
    const hitPoop = w.poops.some(p => p.x === h.x && p.y === h.y);
    if (hitBody || hitPoop) { deaths++; break; }
    const eat = w.foods.some(f => f.x === h.x && f.y === h.y);
    w.body.unshift(h);
    if (!eat) w.body.pop(); else grew++;
    if (eat) {
      let tries = 0, f = P(0, 0), busy = true;
      do {
        f = P(Math.floor(rng() * w.gw), Math.floor(rng() * w.gh));
        busy = w.body.some(c => c.x === f.x && c.y === f.y) ||
          w.poops.some(p => p.x === f.x && p.y === f.y) ||
          w.foods.some(c => c.x === f.x && c.y === f.y);
        tries++;
      } while (busy && tries < 200);
      w.foods = w.foods.filter(c => c.x !== h.x || c.y !== h.y);
      if (tries < 200) w.foods.push(f);
    }
    w.dir = dir;
  }
  check("300-tick fuzz soak (wrap+poops): never died, ate food", deaths === 0 && grew > 0);
}

// ---- Phase B: Hamiltonian cycle + shortcuts ----
{
  const TD = { u: [0, -1], d: [0, 1], l: [-1, 0], r: [1, 0] };
  const c = D.cycleFor(32, 24);
  let coverOk = !!c && c.pts.length === 768;
  const seen = new Set();
  for (const p of c.pts) seen.add(p.x + "," + p.y);
  for (let i = 0; i < c.pts.length; i++) {
    const a = c.pts[i], b = c.pts[(i + 1) % c.pts.length];
    if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) !== 1) coverOk = false;
  }
  check("Hamiltonian cycle: 768 cells, each exactly once, closed adjacency", coverOk && seen.size === 768);
  check("cycle cached for 20x16 too; odd-height grid degrades to null",
    D.cycleFor(20, 16).pts.length === 320 && D.cycleFor(32, 23) === null);

  // solo soak mirroring tick() death rules: wall / body (tail-pop logic) / poop
  function soak(opts, ticks, seed, poopCount, lenCap) {
    const gw = 32, gh = 24;
    const rng = D.mulberry32(seed);
    const w = { gw, gh, wrap: false, body: [{ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1 }],
      dir: "r", foods: [], pineapples: [], bananas: [], poops: [], foes: [], rng };
    for (let i = 0; i < poopCount; i++) w.poops.push({ x: (rng() * gw) | 0, y: (rng() * gh) | 0 });
    const poopS = new Set(w.poops.map(p => p.x + "," + p.y));
    const freeCell = () => {
      for (let t = 0; t < 200; t++) {
        const x = (rng() * gw) | 0, y = (rng() * gh) | 0;
        const k = x + "," + y;
        if (!w.body.some(b => b.x === x && b.y === y) && !poopS.has(k) && !w.foods.some(f => f.x === x && f.y === y)) return { x, y };
      }
      return null;
    };
    const f0 = freeCell(); if (f0) w.foods.push(f0);
    let ate = 0, dead = false, maxGain = 1, tierBfs = 0;
    for (let t = 0; t < ticks; t++) {
      const d = AI.choose(w, opts);
      const lt = D.lastTier();
      if (lt.tier !== "cycle") tierBfs++;
      if (lt.gain > maxGain) maxGain = lt.gain;
      const nx = w.body[0].x + TD[d][0], ny = w.body[0].y + TD[d][1];
      const eats = w.foods.some(f => f.x === nx && f.y === ny);
      const occ = new Set(w.body.slice(1, eats ? w.body.length : w.body.length - 1).map(p => p.x + "," + p.y));
      if (nx < 0 || nx >= gw || ny < 0 || ny >= gh || occ.has(nx + "," + ny) || poopS.has(nx + "," + ny)) { dead = true; break; }
      w.dir = d;
      w.body.unshift({ x: nx, y: ny });
      if (!eats) w.body.pop();
      if (eats) {
        ate++;
        if (lenCap && w.body.length > lenCap) w.body.pop();
        const f = freeCell(); if (f) w.foods.push(f);
      }
    }
    return { dead, ate, maxGain, tierBfs, len: w.body.length };
  }

  const strict = soak({ cycle: true, shortcutSlack: 10000, danger: true }, 1000, 7, 0, 300);
  check("strict cycle follower: 1000-tick solo soak, zero deaths, ate food, always cycle tier",
    !strict.dead && strict.ate > 0 && strict.tierBfs === 0);

  const fast = soak({ cycle: true, shortcutSlack: 2, danger: true }, 1000, 42, 0, 120);
  check("shortcuts (slack 2): alive 1000 ticks, real jumps used (gain > 1)",
    !fast.dead && fast.ate > 0 && fast.maxGain > 1);

  const hazardous = soak({ cycle: true, shortcutSlack: 2, danger: true, floodFill: true, slack: 2 }, 1000, 99, 30, 80);
  check("cycle tier with 30 scattered poops: alive 1000 ticks (skip or degrade)", !hazardous.dead && hazardous.ate > 0);
}

// ---- Phase C: presets, flee mode, opponent lookahead ----
{
  const TD = { u: [0, -1], d: [0, 1], l: [-1, 0], r: [1, 0] };
  const pDemo = AI.presets("demo"), pBaby = AI.presets("baby"),
        pEasy = AI.presets("easy"), pNormal = AI.presets("normal"), pHard = AI.presets("hard");
  check("presets: shapes, knob merge, unknown throws",
    pDemo.cycle && pBaby.flee && pBaby.avoidFruit && pEasy.floodFill === false &&
    pHard.oppLookahead === 3 && AI.presets("demo", { shortcutSlack: 1 }).shortcutSlack === 1 &&
    pDemo.shortcutSlack === 6 && (() => { try { AI.presets("nope"); return false; } catch (e) { return true; } })());

  const wq = { gw: 8, gh: 8, wrap: false, body: [P(2, 2), P(2, 3), P(3, 3), P(3, 4)], dir: "u",
    foods: [P(5, 2)], pineapples: [], bananas: [], poops: [], foes: [] };
  check("preset decisions are deterministic", AI.choose(wq, pDemo) === AI.choose(wq, pDemo));

  const trap = { gw: 6, gh: 6, wrap: false, body: [P(3, 1), P(2, 1), P(2, 2), P(2, 3), P(3, 3), P(4, 3), P(4, 2), P(4, 1)], dir: "l",
    foods: [P(3, 2)], pineapples: [], bananas: [], poops: [], foes: [] };
  check("easy dives into a self-trap; normal refuses it",
    D.legalMoves(trap).includes("d") && AI.choose(trap, pEasy) === "d" && AI.choose(trap, pNormal) !== "d");

  const corridor = { gw: 8, gh: 8, wrap: false, body: [P(0, 3), P(0, 4)], dir: "u",
    foods: [], pineapples: [], bananas: [], poops: [],
    foes: [{ body: [P(3, 4), P(4, 4), P(5, 4)], dir: "l", queue: ["l", "l", "l"] }] };
  const dmH = D.dangerMap(corridor, { oppLookahead: 3 });
  const dmB = D.dangerMap(corridor, {});
  check("oppLookahead simulates the foe's queued path further ahead",
    dmH["0,4"] >= 40 && dmB["0,4"] === undefined && dmB["1,4"] >= 40);

  const enclosed = { gw: 8, gh: 8, wrap: false, body: [P(0, 0), P(1, 0), P(1, 1)], dir: "l",
    foods: [], pineapples: [], bananas: [], poops: [],
    foes: [{ body: [P(0, 1), P(0, 2), P(1, 2)], dir: "u", queue: [] }] };
  check("cornered baby returns an illegal dir (caller freeze fallback)",
    D.legalMoves(enclosed).length === 0 && !D.legalMoves(enclosed).includes(AI.choose(enclosed, pBaby)));

  // scripted chase: human-style interceptor aims one cell ahead of the baby
  function babyChase(seed) {
    const gw = 32, gh = 24;
    const rng = D.mulberry32(seed);
    const poops = [], foods = [];
    for (let i = 0; i < 8; i++) poops.push({ x: (rng() * gw) | 0, y: (rng() * gh) | 0 });
    for (let i = 0; i < 3; i++) foods.push({ x: (rng() * gw) | 0, y: (rng() * gh) | 0 });
    const S = (p) => p.x + "," + p.y;
    let bBody = [{ x: 24, y: 12 }, { x: 23, y: 12 }, { x: 22, y: 12 }], bDir = "l";
    let pBody = [{ x: 6, y: 6 }, { x: 7, y: 6 }, { x: 8, y: 6 }, { x: 9, y: 6 }, { x: 10, y: 6 }], pDir = "l";
    const poopS = new Set(poops.map(S)), foodS = new Set(foods.map(S));
    let viol = 0, froze = 0, fled = 0, captured = -1;
    for (let t = 0; t < 160; t++) {
      const bw = { gw, gh, wrap: false, body: bBody, dir: bDir, foods, pineapples: [], bananas: [], poops,
        foes: [{ body: pBody, dir: pDir, queue: [] }], rng };
      const bd = AI.choose(bw, pBaby);
      const legal = D.legalMoves(bw);
      if (!legal.length) froze++;                          // cornered: freeze (baby stays)
      else if (!legal.includes(bd)) viol++;                // stepped somewhere illegal = bug
      else { bDir = bd; bBody.unshift({ x: bBody[0].x + TD[bd][0], y: bBody[0].y + TD[bd][1] }); bBody.pop(); }
      if (foodS.has(S(bBody[0])) || poopS.has(S(bBody[0]))) viol++;

      const tx = bBody[0].x + TD[bDir][0], ty = bBody[0].y + TD[bDir][1];   // intercept ahead of head
      let bestStep = null, bestD = 1e9;
      for (const d of ["u", "d", "l", "r"]) {
        if (d === AI.debug.REV[pDir]) continue;
        const nx = pBody[0].x + TD[d][0], ny = pBody[0].y + TD[d][1];
        if (nx < 0 || nx >= gw || ny < 0 || ny >= gh || poopS.has(nx + "," + ny)) continue;
        if (pBody.slice(1, pBody.length - 1).some(c => c.x === nx && c.y === ny)) continue;
        const dist = Math.abs(nx - tx) + Math.abs(ny - ty);
        if (dist < bestD) { bestD = dist; bestStep = { d, nx, ny }; }
      }
      const before = Math.abs(pBody[0].x - bBody[0].x) + Math.abs(pBody[0].y - bBody[0].y);
      if (bestStep) { pDir = bestStep.d; pBody.unshift({ x: bestStep.nx, y: bestStep.ny }); pBody.pop(); }
      if (bBody.some(c => c.x === pBody[0].x && c.y === pBody[0].y)) { captured = t; break; }
      const after = Math.abs(pBody[0].x - bBody[0].x) + Math.abs(pBody[0].y - bBody[0].y);
      if (after > before) fled++;
    }
    return { captured, viol, froze, fled };
  }
  const ch1 = babyChase(3), ch2 = babyChase(11), ch3 = babyChase(42);
  check("baby preset: flees, never touches fruit/poop/rival, zero illegal steps",
    ch1.viol === 0 && ch2.viol === 0 && ch3.viol === 0);
  check("baby stays catchable: scripted chase captures within 120 ticks (3 seeds)",
    ch1.captured >= 0 && ch1.captured <= 120 && ch2.captured >= 0 && ch2.captured <= 120 &&
    ch3.captured >= 0 && ch3.captured <= 120 && ch1.fled > 5);

  // hard vs normal head-to-head soak (wrap ON, poops ON)
  function versus(seedA, seedB, ticks) {
    const gw = 32, gh = 24;
    const rngA = D.mulberry32(seedA), rngB = D.mulberry32(seedB);
    let aBody = [{ x: 3, y: 3 }, { x: 2, y: 3 }, { x: 1, y: 3 }, { x: 1, y: 2 }], aDir = "r", aAlive = true, aScore = 0, aTicks = 0;
    let bBody = [{ x: 28, y: 20 }, { x: 29, y: 20 }, { x: 30, y: 20 }, { x: 30, y: 19 }], bDir = "l", bAlive = true, bScore = 0, bTicks = 0;
    const poops = []; for (let i = 0; i < 12; i++) poops.push({ x: (rngA() * gw) | 0, y: (rngA() * gh) | 0 });
    const foods = []; const S = (p) => p.x + "," + p.y;
    const spawn = () => {
      for (let t = 0; t < 100; t++) {
        const x = (rngB() * gw) | 0, y = (rngB() * gh) | 0, k = x + "," + y;
        if (poops.some(p => S(p) === k) || foods.some(f => S(f) === k) ||
          (aAlive && aBody.some(b => S(b) === k)) || (bAlive && bBody.some(b => S(b) === k))) continue;
        foods.push({ x, y }); return;
      }
    };
    spawn(); spawn();
    for (let t = 0; t < ticks; t++) {
      if (!aAlive && !bAlive) break;
      const aw = { gw, gh, wrap: true, body: aBody, dir: aDir, foods, pineapples: [], bananas: [], poops,
        foes: bAlive ? [{ body: bBody, dir: bDir, queue: [] }] : [], rng: rngA };
      const bw = { gw, gh, wrap: true, body: bBody, dir: bDir, foods, pineapples: [], bananas: [], poops,
        foes: aAlive ? [{ body: aBody, dir: aDir, queue: [] }] : [], rng: rngB };
      const ad = aAlive ? AI.choose(aw, pHard) : null;
      const bd = bAlive ? AI.choose(bw, pNormal) : null;
      const na = ad ? { x: (aBody[0].x + TD[ad][0] + gw) % gw, y: (aBody[0].y + TD[ad][1] + gh) % gh } : null;
      const nb = bd ? { x: (bBody[0].x + TD[bd][0] + gw) % gw, y: (bBody[0].y + TD[bd][1] + gh) % gh } : null;
      const eatA = !!(na && foods.some(f => S(f) === S(na))), eatB = !!(nb && foods.some(f => S(f) === S(nb)));
      const occA = new Set(aBody.slice(1, eatA ? aBody.length : aBody.length - 1).map(S));
      const occB = new Set(bBody.slice(1, eatB ? bBody.length : bBody.length - 1).map(S));
      const poopS = new Set(poops.map(S));
      const crush = !!(na && nb && na.x === nb.x && na.y === nb.y);
      if (aAlive) {
        if (crush || occA.has(S(na)) || (bAlive && occB.has(S(na))) || poopS.has(S(na))) aAlive = false;
        else { aDir = ad; aBody.unshift(na); if (!eatA || aBody.length > 40) aBody.pop();
          if (eatA) { aScore++; foods.splice(foods.findIndex(f => S(f) === S(na)), 1); poops.push(na); spawn(); }
          aTicks++; }
      }
      if (bAlive) {
        if (crush || occB.has(S(nb)) || (aAlive && occA.has(S(nb))) || poopS.has(S(nb))) bAlive = false;
        else { bDir = bd; bBody.unshift(nb); if (!eatB || bBody.length > 40) bBody.pop();
          if (eatB) { bScore++; foods.splice(foods.findIndex(f => S(f) === S(nb)), 1); poops.push(nb); spawn(); }
          bTicks++; }
      }
    }
    return { aTicks, bTicks, aScore, bScore };
  }
  const v = versus(5, 12, 200);
  check("versus soak (hard vs normal, wrap+poops): both alive >= 50 ticks, both scored",
    v.aTicks >= 50 && v.bTicks >= 50 && v.aScore > 0 && v.bScore > 0);
}

// ---- D1 wiring: game.js + engine share one scope (classic scripts) ----
{
  const noop = () => {};
  const stubCtx = {
    fillRect: noop, globalAlpha: 1, imageSmoothingEnabled: false, fillStyle: '', fillText: noop,
    beginPath: noop, arc: noop, fill: noop, stroke: noop, strokeStyle: '', lineWidth: 1,
  };
  const handlers = {};
  const store = { snake_best: '0', snake_poop: '0', snake_music_muted: '0', snake_sfx_muted: '0', snake_wrap: '0', snake_track: 'chill' };
  const demoRng = D.mulberry32(11);
  const sb2 = {
    document: { getElementById: () => ({ getContext: () => stubCtx, textContent: '', innerHTML: '', style: {}, classList: { add: noop, remove: noop } }) },
    window: { addEventListener: (ev, fn) => { handlers[ev] = fn; }, requestAnimationFrame: noop },
    localStorage: { getItem: k => store[k] ?? '0', setItem: (k, v) => { store[k] = String(v); } },
    requestAnimationFrame: noop,
    handlers, Set, Number, console, performance: { now: () => 0 },
    Math: Object.create(Math, { random: { value: () => demoRng() } }),
  };
  const gameSrc = fs.readFileSync(path.join(__dirname, "..", "src", "game.js"), "utf8");
  const eggSrc = fs.readFileSync(path.join(__dirname, "..", "src", "egg-baby.js"), "utf8");
  // fresh context for the egg-silence run: a vm context cannot re-declare
  // game.js top-level consts, so this second run needs its own sandbox
  const handlers3 = {};
  const store3 = { snake_best: '0', snake_poop: '0', snake_music_muted: '0', snake_sfx_muted: '0', snake_wrap: '0', snake_track: 'chill' };
  const sb3 = {
    document: { getElementById: () => ({ getContext: () => stubCtx, textContent: '', innerHTML: '', style: {}, classList: { add: noop, remove: noop } }) },
    window: { addEventListener: (ev, fn) => { handlers3[ev] = fn; }, requestAnimationFrame: noop },
    localStorage: { getItem: k => store3[k] ?? '0', setItem: (k, v) => { store3[k] = String(v); } },
    requestAnimationFrame: noop,
    handlers: handlers3, Set, Number, console, performance: { now: () => 0 },
    Math: Object.create(Math, { random: { value: D.mulberry32(202) } }),
  };
  vm.runInNewContext(code + "\n" + gameSrc + `
    globalThis.demoRes = (() => {
      let leftMenu = false, maxScore = 0;
      for (let i = 0; i < 200; i++) {
        tick();
        if (state !== "menu" || !players[0].alive) leftMenu = true;
        if (players[0].score > maxScore) maxScore = players[0].score;
      }
      handlers.keydown({ code: "KeyQ", preventDefault: () => {} });
      tick(); tick();

      // Demo silence: with an audio stub present, every SFX call in the menu
      // must build ZERO nodes; the same calls in play must build nodes.
      let gains = 0;
      const fakeNode = () => ({ connect: () => {}, start: () => {}, stop: () => {}, gain: { setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {}, linearRampToValueAtTime: () => {} }, frequency: { setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} }, Q: { setValueAtTime: () => {} } });
      audioCtx = { currentTime: 0, sampleRate: 22050, destination: {}, createGain: () => { gains++; return fakeNode(); }, createOscillator: () => fakeNode(), createBiquadFilter: () => fakeNode(), createBuffer: () => ({ copyToChannel: () => {}, getChannelData: () => new Array(22050).fill(0), length: 22050 }), createBufferSource: () => fakeNode() };
      sfxMuted = false;
      eatSound(); poopSound(); levelSound(); boomSound(); bananaSound(); startJingle();
      const menuGains = gains;                      // all menu-gated -> 0
      state = "playing";
      eatSound(); poopSound(); levelSound(); boomSound(); bananaSound(); startJingle();
      return { leftMenu, maxScore, tag: demoTag, eng: demoEngine, alive: players[0].alive, menuGains, playNodes: gains - menuGains, cycleOpts: DEMO_AI_OPTS.cycle === true };
    })();`, sb2);
  const r = sb2.demoRes;
  check("D1 demo soak: engine menu snake stays in attract mode + eats (restart-safe)", !r.leftMenu && r.maxScore > 0);
  check("Q toggles demo brain: legacy walker still runs", r.tag === "AI: RANDOM" && r.eng === false && r.alive);
  check("menu demo SFX silent; gameplay eats still play", r.menuGains === 0 && r.playNodes > 0);
  check("D1 demo switched to Phase B cycle tier (conservative shortcuts)", r.cycleOpts && !r.leftMenu);

  // egg/baby sounds gated in menu too: chirp/hatch/ding make no nodes there
  vm.runInNewContext(code + "\n" + eggSrc + "\n" + gameSrc + `
    globalThis.demoRes = (() => {
      let gains = 0;
      const fakeNode = () => ({ connect: () => {}, start: () => {}, stop: () => {}, gain: { setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {}, linearRampToValueAtTime: () => {} }, frequency: { setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} }, Q: { setValueAtTime: () => {} } });
      audioCtx = { currentTime: 0, sampleRate: 22050, destination: {}, createGain: () => { gains++; return fakeNode(); }, createOscillator: () => fakeNode(), createBiquadFilter: () => fakeNode(), createBuffer: () => ({ copyToChannel: () => {}, getChannelData: () => new Array(22050).fill(0), length: 22050 }), createBufferSource: () => fakeNode() };
      sfxMuted = false;
      state = "menu";
      EggBaby.debug.placeEgg(10, 12);
      EggBaby.registerBite(); EggBaby.registerBite(); EggBaby.registerBite();   // hatch -> hatchPop (gated)
      const menuGains = gains;
      state = "playing";
      EggBaby.debug.placeEgg(12, 10);
      EggBaby.registerBite(); EggBaby.registerBite(); EggBaby.registerBite();   // hatch again -> nodes
      return { menuGains, playNodes: gains - menuGains, hatched: EggBaby.hasBaby() };
    })();
  `, sb3);
  const es = sb3.demoRes;
  check("hatch pop silent in menu demo; plays in real play", es.menuGains === 0 && es.playNodes > 0 && es.hatched);
}

console.log(fails ? `AI-SUITE: ${fails} FAILED` : "AI-SUITE GREEN (37 checks)");
process.exit(fails ? 1 : 0);
