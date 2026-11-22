// egg-baby pipeline tests (milestones M1+M2): roll gating, squash, hatch,
// baby avoidance/freeze, capture, versus gate, cadence, resets.
const fs = require('fs');
const noop = () => {};
const stubCtx = {
  fillRect: noop, globalAlpha: 1, imageSmoothingEnabled: false, fillStyle: '', fillText: noop,
  beginPath: noop, arc: noop, fill: noop, stroke: noop, strokeStyle: '', lineWidth: 1,
};
let box = { v: 0.99, t: 0 };   // Math.random knob + fake performance clock
const handlers = {};
const store = { snake_best: '0', snake_poop: '0', snake_music_muted: '0', snake_sfx_muted: '0', snake_wrap: '0', snake_track: 'chill' };
const sandbox = {
  document: {
    getElementById: () => ({
      getContext: () => stubCtx,
      textContent: '', innerHTML: '', style: {},
      classList: { add: noop, remove: noop },
    }),
  },
  window: { addEventListener: (ev, fn) => { handlers[ev] = fn; }, requestAnimationFrame: noop },
  localStorage: { getItem: k => store[k] ?? '0', setItem: (k, v) => { store[k] = String(v); } },
  requestAnimationFrame: noop,
  handlers, noop, store, Set, Number, console,
  performance: { now: () => (box.t += 1) }, box,
  Math: Object.create(Math, { random: { value: () => box.v } }),
};

let src = fs.readFileSync(__dirname + '/../src/snake-ai.js', 'utf8') + '\n' +
          fs.readFileSync(__dirname + '/../src/game.js', 'utf8') + '\n' +
          fs.readFileSync(__dirname + '/../src/egg-baby.js', 'utf8');

src += `
const out = [];
function key(c) { handlers.keydown({ code: c, preventDefault: noop }); }

// ---- M1: roll gating & placement ----
key('Digit1');                 // solo start resets the pipeline
foods.length = 0;              // deterministic placements
box.v = 0.02;                  // below the 3% egg chance
EggBaby.rollEgg();
out.push('roll: eggs=' + EggBaby.debug.eggs().length + ' at=' + JSON.stringify(EggBaby.debug.eggs()[0]) + ' (expect 1 at {x:0,y:0})');
EggBaby.rollEgg();
out.push('cap: eggs=' + EggBaby.debug.eggs().length + ' (expect 1 — one egg at a time)');

// ---- M1: squash on head contact (no death, no baby) ----
key('Escape'); key('Digit1');        // fresh game: snake head (9,12) facing r
EggBaby.debug.placeEgg(10, 12);
tick();                        // head steps onto the egg cell
out.push('squash: eggs=' + EggBaby.debug.eggs().length + ' alive=' + players[0].alive + ' score=' + players[0].score + ' baby=' + (EggBaby.debug.baby() ? 'yes' : 'no') + ' (expect 0 true 0 no)');

// ---- M1/M2: hatch after 3 apple bites ----
key('Escape'); key('Digit1');
GAME_CONFIG.pineapple.chance = 0;   // keep rolls deterministic
GAME_CONFIG.banana.chance = 0;
box.v = 0.99;                       // egg roll never fires during bites
EggBaby.debug.placeEgg(20, 20);
for (let i = 0; i < 3; i++) {
  foods[0].x = players[0].cells[0].x + DIRS[players[0].dir][0];
  foods[0].y = players[0].cells[0].y + DIRS[players[0].dir][1];
  tick();
}
const b = EggBaby.debug.baby();
out.push('hatch: eggs=' + EggBaby.debug.eggs().length + ' baby=' + (b ? 'len' + b.cells.length : 'none') + ' bites=' + EggBaby.debug.bites() + ' score=' + players[0].score + ' (expect 0 eggs, len3, bites0, score3)');
out.push('hatch banner flash: ' + (EggBaby.debug.banner() > 0) + ' (expect true)');
EggBaby.updateBaby(2, 130);               // dt-driven decay of the taunt flash
out.push('banner decayed: ' + (EggBaby.debug.banner() === 0) + ' (expect true)');

// ---- M2: avoidance — 200 steps, never touches snake/food/wall ----
box.v = 0.99;                       // no jitter picks; deterministic legal move
foods[0].x = b.cells[0].x; foods[0].y = b.cells[0].y - 1;   // items hugging the head
foods[1].x = b.cells[0].x + 1; foods[1].y = b.cells[0].y;
let viol = 0;
const heads = new Set();
for (let i = 0; i < 200; i++) {
  EggBaby.debug.stepBaby();
  const h = b.cells[0];
  heads.add(h.x + ',' + h.y);
  if (h.x < 0 || h.x >= GW || h.y < 0 || h.y >= GH) viol++;
  for (const f of foods) if (f.x === h.x && f.y === h.y) viol++;
  for (const p of players) if (p.alive) for (const c of p.cells) if (c.x === h.x && c.y === h.y) viol++;
  if (b.cells.length !== 3) viol++;
}
out.push('avoid: 200 steps violations=' + viol + ' len=' + b.cells.length + ' (expect 0, 3)');
out.push('avoid moved: distinct heads=' + heads.size + ' (expect >10 — engine must actually move)');
out.push('avoid tier: ' + EggBaby.debug.tier().tier + ' (expect flee)');

// ---- M2: cornered baby freezes instead of dying ----
b.cells = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }];
b.dir = 'u';
players[0].cells = [{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }];   // blocks the only open side
players[0].dir = 'l';
foods.length = 0;
const before = JSON.stringify(b.cells);
EggBaby.debug.stepBaby();
out.push('corner: frozen=' + (JSON.stringify(b.cells) === before) + ' alive-snake=' + players[0].alive + ' (expect true true)');

// ---- M2/M4: capture on any overlap — baby gone, handoff flag set once ----
players[0].cells = [{ x: 0, y: 1 }, { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }];
players[0].dir = 'd';
tick();                          // head (0,2); body still covers baby's cell (0,0)
out.push('capture: baby=' + (EggBaby.debug.baby() ? 'alive' : 'gone') + ' dingAt=' + (EggBaby.debug.captureAt() > 0) +
         ' handoff=' + EggBaby.takeHandoff() + ' again=' + EggBaby.takeHandoff() +
         ' state=' + state + ' score=' + players[0].score + ' (expect gone, true, ding true, handoff true then false, playing, score3)');

// ---- D2: greedy chase vs the engine-fleeing baby — real capture check ----
key('Escape'); key('Digit1');
GAME_CONFIG.pineapple.chance = 0; GAME_CONFIG.banana.chance = 0;
box.v = 0.99;
EggBaby.debug.placeEgg(20, 20);
for (let i = 0; i < 3; i++) {
  foods[0].x = players[0].cells[0].x + DIRS[players[0].dir][0];
  foods[0].y = players[0].cells[0].y + DIRS[players[0].dir][1];
  tick();
}
const bb = EggBaby.debug.baby();
players[0].cells = [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }];
players[0].dir = 'r'; players[0].turnQueue = [];
const aw = (v, dv) => wrapMode ? (v + dv + GW) % GW : v + dv;
let stepN = 0, caught = false;
const chaseHeads = new Set();
for (let t = 0; t < 140 && !caught; t++) {
  EggBaby.debug.stepBaby();
  const bh = bb.cells[0], ph = players[0].cells[0];
  chaseHeads.add(bh.x + ',' + bh.y);
  const dx = Math.sign(bh.x - ph.x), dy = Math.sign(bh.y - ph.y);
  const cd = dx !== 0 ? (dx > 0 ? 'r' : 'l') : (dy > 0 ? 'd' : 'u');
  if (cd !== REV[players[0].dir]) players[0].dir = cd;
  players[0].cells.unshift({ x: aw(ph.x, DIRS[cd][0]), y: aw(ph.y, DIRS[cd][1]) });
  players[0].cells.pop();
  stepN++;
  if (bb.cells.some(c => players[0].cells.some(p => p.x === c.x && p.y === c.y))) caught = true;
}
out.push('chase: caught=' + caught + ' steps=' + stepN + ' tier=' + EggBaby.debug.tier().tier + ' (expect true, <=140, flee)');
out.push('chase fled: distinct baby heads=' + chaseHeads.size + ' (expect >1 — baby actually fled)');

// ---- M1: versus gate — eggs/baby never roll in 2P ----
box.v = 0.99;                        // spawns land far from snakes
key('Escape'); key('Digit2');
foods[0].x = players[0].cells[0].x + DIRS[players[0].dir][0];
foods[0].y = players[0].cells[0].y + DIRS[players[0].dir][1];
tick();
out.push('versus gate: eggs=' + EggBaby.debug.eggs().length + ' baby=' + (EggBaby.debug.baby() ? 'yes' : 'no') + ' (expect 0 no)');

// ---- M2: baby clock is slower than main tick, gated by pause ----
key('Escape'); key('Digit1');
foods.length = 0;
EggBaby.debug.placeEgg(15, 10);
EggBaby.registerBite(); EggBaby.registerBite(); EggBaby.registerBite();   // hatch immediately
const b2 = EggBaby.debug.baby();
const h0 = JSON.stringify(b2.cells[0]);
EggBaby.updateBaby(0.1, 130);    // step = 130*1.5 = 195ms; acc 100 → no move yet
out.push('cadence: movedEarly=' + (JSON.stringify(b2.cells[0]) !== h0) + ' (expect false)');
EggBaby.updateBaby(0.1, 130);    // acc 200 ≥ 195 → one step
out.push('cadence: movedLate=' + (JSON.stringify(b2.cells[0]) !== h0) + ' (expect true)');
state = 'paused';
const h1 = JSON.stringify(b2.cells[0]);
EggBaby.updateBaby(0.5, 130);
out.push('pause gate: moved=' + (JSON.stringify(b2.cells[0]) !== h1) + ' (expect false)');

// ---- resets: menu clears eggs+baby ----
state = 'playing';    // Escape while paused resumes the game; go via playing to reach menu
key('Escape');
out.push('menu reset: eggs=' + EggBaby.debug.eggs().length + ' baby=' + (EggBaby.debug.baby() ? 'yes' : 'no') + ' (expect 0 no)');

console.log(out.join('\\n'));
`;

require('vm').runInNewContext(src, sandbox);
