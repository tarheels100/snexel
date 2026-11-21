/* tests/ai-test.js — SnakeAI engine suite (Phase A of docs/snake-ai-plan.md).
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
      return { leftMenu, maxScore, tag: demoTag, eng: demoEngine, alive: players[0].alive };
    })();`, sb2);
  const r = sb2.demoRes;
  check("D1 demo soak: engine menu snake stays in attract mode + eats (restart-safe)", !r.leftMenu && r.maxScore > 0);
  check("Q toggles demo brain: legacy walker still runs", r.tag === "AI: RANDOM" && r.eng === false && r.alive);
}

console.log(fails ? `AI-SUITE: ${fails} FAILED` : "AI-SUITE GREEN (22 checks)");
process.exit(fails ? 1 : 0);
