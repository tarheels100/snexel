// Mini-game M3 tests: debug E entry (menu + mid-play), mini mechanics,
// win→fireworks→fade auto-exit, wall/self death, pause, Esc skip, freeze of
// the main game, wrap independence, music-stub contract, Z/X still work.
const fs = require('fs');
const noop = () => {};
const stubCtx = {
  fillRect: noop, globalAlpha: 1, imageSmoothingEnabled: false, fillStyle: '', fillText: noop,
  beginPath: noop, arc: noop, fill: noop, stroke: noop, strokeStyle: '', lineWidth: 1,
  textAlign: 'left', font: '',
};
let box = { v: 0.05, t: 0 };   // Math.random knob + fake clock
const rafQueue = [];           // real rAF emulation so loop-chain bugs surface
const raf = fn => { rafQueue.push(fn); return rafQueue.length; };
// fake AudioContext + fake JauntyMusic engine for the M4 audio/handoff phase
const fakeGain = () => {
  const gain = {
    value: 0,
    setValueAtTime: v => { gain.value = v; },
    exponentialRampToValueAtTime: v => { gain.value = v; },
    linearRampToValueAtTime: v => { gain.value = v; },
    setTargetAtTime: v => { gain.value = v; },
    cancelScheduledValues: noop,
  };
  return { gain, connect: noop };
};
const fakeAC = {
  currentTime: 0, sampleRate: 44100, state: "running", resume: () => Promise.resolve(), destination: {},
  createGain: fakeGain,
  createOscillator: () => ({ type: "", frequency: { setValueAtTime: noop, exponentialRampToValueAtTime: noop }, connect: noop, start: noop, stop: noop }),
  createBuffer: (ch, len) => ({ getChannelData: () => new Float32Array(len) }),
  createBufferSource: () => ({ buffer: null, connect: noop, start: noop, stop: noop }),
  createBiquadFilter: () => ({ type: "", frequency: { value: 0, setValueAtTime: noop, exponentialRampToValueAtTime: noop }, Q: { value: 0 }, gain: { value: 0, setValueAtTime: noop, exponentialRampToValueAtTime: noop }, connect: noop }),
  createDelay: () => ({ delayTime: { value: 0 }, connect: noop }),
  createWaveShaper: () => ({ curve: null, connect: noop }),
  createDynamicsCompressor: () => ({ connect: noop }),
};
class FakeJaunty {
  constructor(o) { this.ctx = o.ctx; this.playing = false; this.logs = []; }
  async start() { this.playing = true; this.logs.push("start"); }
  stop() { this.playing = false; this.logs.push("stop"); }
  setVolume(v) { this.logs.push("vol:" + v); }
  setIntensity(x) { this.logs.push("int:" + x); }
  eat() { this.logs.push("eat"); }
  win() { this.logs.push("win"); }
  gameOver() { this.logs.push("gameOver"); }
}
box.AC = function () { return fakeAC; };   // constructor form — ensureAudio does new AC()
box.jaunty = FakeJaunty;
const canvasStub = {          // persistent canvas object — game.js reads width/height
  getContext: () => stubCtx, width: 256, height: 192,
  textContent: '', innerHTML: '', style: {},
  classes: new Set(),
  classList: {
    add: c => canvasStub.classes.add(c),
    remove: c => canvasStub.classes.delete(c),
    has: c => canvasStub.classes.has(c),
  },
};
const handlers = [];           // multi-listener keydown registry (game.js + MiniGame)
const store = { snake_best: '0', snake_poop: '0', snake_music_muted: '0', snake_sfx_muted: '0', snake_wrap: '0', snake_track: 'chill' };
const sandbox = {
  document: { getElementById: () => canvasStub },
  window: {
    addEventListener: (ev, fn) => handlers.push({ ev, fn }),
    removeEventListener: (ev, fn) => {
      const i = handlers.findIndex(h => h.ev === ev && h.fn === fn);
      if (i >= 0) handlers.splice(i, 1);
    },
    requestAnimationFrame: raf,
  },
  localStorage: { getItem: k => store[k] ?? '0', setItem: (k, v) => { store[k] = String(v); } },
  requestAnimationFrame: raf,
  setInterval: () => 1, clearInterval: noop,          // retro music scheduler never fires in vm
  setTimeout: () => 1, clearTimeout: noop,
  handlers, noop, store, rafQueue, canvasStub, Set, Number, console, Float32Array, Promise,
  performance: { now: () => (box.t += 1) }, box,
  Math: Object.create(Math, { random: { value: () => box.v } }),
};

let src = fs.readFileSync(__dirname + '/../src/game.js', 'utf8') + '\n' +
          fs.readFileSync(__dirname + '/../src/egg-baby.js', 'utf8') + '\n' +
          fs.readFileSync(__dirname + '/../src/minigame.js', 'utf8');

src += `
const out = [];
function key(c) { handlers.filter(h => h.ev === 'keydown').forEach(h => h.fn({ code: c, preventDefault: noop })); }
const D = MiniGame.debug;
// pump queued rAF callbacks until pred() holds (browser-style frame driving)
function drive(pred, max) {
  let n = 0;
  while (!pred() && n < max) {
    const fn = rafQueue.shift();
    if (!fn) break;
    box.t += 16;
    fn(box.t);
    n++;
  }
  return pred();
}

// ---- E from the title: takeover, main menu untouched, entry countdown first ----
key('KeyE');
out.push('entry menu: state=' + state + ' active=' + MiniGame.isActive() + ' phase=' + D.phase() + ' (expect minigame true count)');
out.push('count gates music: start=' + !D.musicEvents().includes('start') + ' (expect true)');
MiniGame.debug.skipCountdown();
out.push('music stub: start=' + D.musicEvents().includes('start') + ' playing=' + MiniGame.music.playing + ' (expect true true)');
const g0 = D.grid();
out.push('grid: ' + JSON.stringify(g0) + ' (expect ox=68 oy=48 gw=20 gh=16 cell=6)');

// ---- mini snake eats + grows + bulge ----
let head = D.cells()[0];
D.placeApple(head.x + 1, head.y);
MiniGame.frame(0.13);                 // acc 130 >= tickMs 130 → one tick
out.push('eat: score=' + D.score() + ' len=' + D.len() + ' alive=' + D.alive() + ' fx=' + D.fx().length + ' head=' + JSON.stringify(D.cells()[0]) + ' (expect 1, 4, true, >0, {11,8})');
out.push('intensity ramp: ' + D.musicEvents().filter(e => e.startsWith('int:')).join(','));
// tail leaves eaten square → bulge pops
head = D.cells()[0];
D.placeApple(head.x + 1, head.y);
MiniGame.frame(0.13);
out.push('second eat: score=' + D.score() + ' bulgeLeft=' + (D.cells()[0].bulge ? 'yes' : 'popped') + ' (expect 2)');

// ---- win → fireworks → fade → auto-exit back to menu ----
D.setScore(9);
head = D.cells()[0];
D.placeApple(head.x + 1, head.y);
MiniGame.frame(0.13);
out.push('win: phase=' + D.phase() + ' score=' + D.score() + ' (expect win 10)');
for (let i = 0; i < 3; i++) MiniGame.frame(0.25);      // past winMs 0.6
out.push('fireworks: phase=' + D.phase() + ' (expect fireworks)');
MiniGame.frame(2.2);                                   // bursts spawn; past fxMs 2.0 → fade
out.push('firework bursts: fx=' + D.fx().length + ' phase=' + D.phase() + ' (expect >0, fade)');
MiniGame.frame(0.6);                                   // past fadeMs → finish → countdown starts
out.push('exit: countdown=' + (state === "minigame" && !MiniGame.isActive()) + ' reason=' + D.lastReason() +
         ' stop=' + D.musicEvents().includes('stop') + ' int1=' + D.musicEvents().includes('int:1.00') +
         ' eat=' + D.musicEvents().includes('eat') + ' win=' + D.musicEvents().includes('win') + ' (expect true won true true true true)');
out.push('countdown resume: state=' + drive(() => state === "menu", 400) + ' pending=' + rafQueue.length + ' (expect true >0)');

// ---- P pause freezes the mini world ----
key('KeyE');
MiniGame.debug.skipCountdown();
const lenA = D.len(), scoreA = D.score(), posA = JSON.stringify(D.cells()[0]);
key('KeyP');
for (let i = 0; i < 4; i++) MiniGame.frame(0.2);
out.push('pause: phase=' + D.phase() + ' moved=' + (JSON.stringify(D.cells()[0]) !== posA) + ' (expect paused false)');
key('KeyP');
MiniGame.frame(0.13);
out.push('resume: phase=' + D.phase() + ' moved=' + (JSON.stringify(D.cells()[0]) !== posA) + ' (expect play true)');

// ---- Esc quits early ----
key('Escape');
MiniGame.frame(0.6);
out.push('esc quit: phase=' + D.phase() + ' countdown=' + (state === "minigame" && !MiniGame.isActive()) + ' reason=' + D.lastReason() + ' (expect null true skipped)');
out.push('esc resume: state=' + drive(() => state === "menu", 400) + ' (expect true)');

// ---- mid-play death (wall) restores main game intact, wrap OFF by design ----
wrapMode = true;                       // main wrap ON must NOT leak into the mini grid
key('Digit1');
const scoreMain = players[0].score, lenMain = players[0].cells.length, tickMsMain = tickMs, accMain = acc;
key('KeyE');
MiniGame.debug.skipCountdown();
const sn = D.cells();
sn.splice(0, sn.length, { x: 0, y: 8 }, { x: 1, y: 8 }, { x: 2, y: 8 });
D.setDir('l');
MiniGame.frame(0.13);
out.push('mini wall death: phase=' + D.phase() + ' alive=' + D.alive() + ' (expect died false)');
MiniGame.frame(0.9); MiniGame.frame(0.6);
out.push('death countdown: state=' + state + ' reason=' + D.lastReason() + ' wrapKept=' + wrapMode + ' (expect minigame wall true)');
drive(() => state === "playing", 400);
out.push('death exit: state=' + state + ' reason=' + D.lastReason() + ' wrapKept=' + wrapMode +
         ' score=' + players[0].score + ' len=' + players[0].cells.length +
         ' tickMsKept=' + (tickMs === tickMsMain) + ' accZero=' + (acc === 0) + ' (expect playing wall true 0 ' + lenMain + ' true true)');

// ---- self-collision death ----
key('Escape'); key('KeyE');
MiniGame.debug.skipCountdown();
const sn2 = D.cells();
sn2.splice(0, sn2.length, { x: 2, y: 3 }, { x: 2, y: 4 }, { x: 3, y: 4 }, { x: 3, y: 3 });
D.setDir('d');                            // head (2,3) steps onto body slot (2,4) — not the tail
MiniGame.frame(0.13);
out.push('self death: phase=' + D.phase() + ' reason=' + D.reason() + ' (expect died body)');
MiniGame.frame(0.9); MiniGame.frame(0.6);
drive(() => state === "menu", 400);                   // died → fade → countdown → menu
out.push('self exit: state=' + state + ' reason=' + D.lastReason() + ' (expect menu body)');

// ---- Z/X still work during the mini-game ----
key('KeyE');
key('KeyZ');
out.push('Z during mini: musicMuted=' + musicMuted + ' (expect true)');
key('KeyZ');
out.push('Z back: musicMuted=' + musicMuted + ' (expect false)');
key('Escape'); MiniGame.frame(0.6);
drive(() => state === "menu", 400);

// ---- main keyboard is ignored during the mini-game ----
key('KeyE');
key('ArrowUp');                          // ignored during the entry countdown
MiniGame.frame(0.13);
out.push('steer during count: dir=' + D.dir() + ' head=' + JSON.stringify(D.cells()[0]) + ' (expect r {10,8})');
MiniGame.debug.skipCountdown();
key('ArrowUp');                          // must steer the MINI, not the main game
out.push('keys: miniDir=' + D.dir() + ' mainDir=' + players[0].dir + ' (mini may turn u, main stays r)');
MiniGame.frame(0.13);
out.push('mini turned: head=' + JSON.stringify(D.cells()[0]) + ' mainFrozen=' + (players[0].cells[0].x === 10) + ' (expect {10,7}, frozen true)');
key('Escape'); MiniGame.frame(0.6);
drive(() => state === "menu", 400);

// ---- music engine swap (contract honored): direct MiniGame.start keeps the swapped engine; ----
// ---- enterMiniGame owns its own JauntyMusic engine (tested in the M4 phase below) ----
const fake = { playing: false, log: [], start() { this.playing = true; this.log.push('start'); }, stop() { this.playing = false; this.log.push('stop'); }, setVolume(v) { this.log.push('vol:' + v); }, setIntensity(x) { this.log.push('int:' + x); }, gameOver() { this.log.push('gameOver'); }, eat() { this.log.push('eat'); }, win() { this.log.push('win'); } };
MiniGame.setMusic(fake);
MiniGame.start({ onDone: () => {} });    // direct start — game.js's enterMiniGame would setMusic(null) here
MiniGame.debug.skipCountdown();
head = D.cells()[0];
D.placeApple(head.x + 1, head.y);
MiniGame.frame(0.13);
key('Escape'); MiniGame.frame(0.6);      // forfeit → fade → finish → music.stop
out.push('engine swap: log=' + fake.log.join(',') + ' (expect start,int:0.1,eat,stop)');
MiniGame.setMusic(null);                 // back to stub
out.push('swap done: active=' + MiniGame.isActive() + ' (expect false)');

// ---- regression: reversed steers must NOT kill (handler + tick guards) ----
key('KeyE');                              // fresh mini from title, snake heads right
MiniGame.debug.skipCountdown();           // past the entry countdown
key('ArrowLeft');                         // 180° reversal — must be ignored
MiniGame.frame(0.13);
out.push('reversal: dir=' + D.dir() + ' alive=' + D.alive() + ' head=' + JSON.stringify(D.cells()[0]) + ' (expect r true {11,8})');
key('ArrowUp'); MiniGame.frame(0.13);     // legal turn
key('ArrowDown');                         // reversal of NEW dir — ignored
MiniGame.frame(0.13);
out.push('anti-turn: dir=' + D.dir() + ' alive=' + D.alive() + ' head=' + JSON.stringify(D.cells()[0]) + ' (expect u true {11,6})');
key('Escape'); MiniGame.frame(0.6);
drive(() => state === "menu", 400);

// ---- regression: main game.js rAF chain must survive the mini-game ----
for (let d = 0; d < 12; d++) {       // bounded drain: game.js loop self-reschedules, never while-drainable
  const fn = rafQueue.shift();
  box.t += 16;
  fn(box.t);
}
key('KeyE');
for (let i = 0; i < 12; i++) {            // pump queued frames like a browser
  const fn = rafQueue.shift();
  if (!fn) break;
  box.t += 16;
  fn(box.t);
}
out.push('chain during mini: pending=' + rafQueue.length + ' state=' + state + ' (expect ~2, minigame)');
key('Escape');                            // quit; pump until MiniGame's loop fades out
drive(() => !MiniGame.isActive(), 100);   // fade ~0.5s via its own loop callbacks
out.push('chain countdown: state=' + state + ' active=' + MiniGame.isActive() + ' (expect minigame false)');
drive(() => state === "menu", 400);       // countdown pumps through game.js's surviving loop
out.push('chain after mini: state=' + state + ' miniActive=' + MiniGame.isActive() + ' pending=' + rafQueue.length + ' (expect menu false >0)');
let drew = true;
for (let i = 0; i < 6; i++) {             // main loop redraws board, keeps chaining
  const fn = rafQueue.shift();
  if (!fn) { drew = false; break; }
  box.t += 16;
  try { fn(box.t); } catch (err) { drew = 'THREW: ' + err.message; break; }
}
out.push('main loop after resume: ok=' + drew + ' pending=' + rafQueue.length + ' (expect true >0)');

// ---- M4: jaunty engine wiring, capture handoff, countdown resume (audio unlocked) ----
window.AudioContext = box.AC;             // audio unlocks from here on (keydown calls ensureAudio)
window.JauntyMusic = box.jaunty;
key('Digit1');                            // fresh playing game (state is menu)
GAME_CONFIG.pineapple.chance = 0; GAME_CONFIG.banana.chance = 0;
box.v = 0.99;                             // egg roll chance 0.03 never fires
EggBaby.debug.placeEgg(20, 20);
for (let i = 0; i < 3; i++) {             // 3 apple bites hatch a baby at the egg cell
  foods[0].x = players[0].cells[0].x + DIRS[players[0].dir][0];
  foods[0].y = players[0].cells[0].y + DIRS[players[0].dir][1];
  tick();
}
const bb = EggBaby.debug.baby();
out.push('hatch e2e: baby=' + (bb ? 'len' + bb.cells.length : 'none') + ' score=' + players[0].score + ' banner=' + (EggBaby.debug.banner() > 0) + ' (expect len3, 3, true)');
players[0].cells = [{ x: bb.cells[0].x - 1, y: bb.cells[0].y }, { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }];
players[0].dir = 'r';
tick();                                   // head steps onto the baby's head cell → capture
out.push('capture flag: handoff=' + EggBaby.debug.handoff() + ' babyGone=' + !EggBaby.debug.baby() + ' (expect true true)');
drive(() => state === "minigame", 50);    // game.js loop consumes takeHandoff → captureHandoff()
out.push('handoff: state=' + state + ' miniActive=' + MiniGame.isActive() + ' engine=' + (jaunty ? 'yes' : 'no') +
         ' start=' + (jaunty && jaunty.logs.includes('start')) + ' hudDim=' + canvasStub.style.opacity +
         ' overlayHidden=' + !canvasStub.classList.has("show") +
         ' mainSilent=' + (musicGain && musicGain.gain.value === 0) + ' (expect minigame true yes false 0.4 true true)');
MiniGame.debug.skipCountdown();           // jump past the entry countdown → GO
out.push('mini GO: start=' + jaunty.logs.includes('start') + ' phase=' + D.phase() + ' (expect true play)');
key('KeyZ');
out.push('Z during mini: volMute=' + jaunty.logs.includes('vol:0') + ' (expect true)');
key('KeyZ');
out.push('Z unmute: volBack=' + jaunty.logs.includes('vol:0.5') + ' mainStillMuted=' + (musicGain.gain.value === 0) + ' (expect true true)');
key('Escape');                            // forfeit → fade → countdown → resume playing
drive(() => !MiniGame.isActive(), 100);
out.push('mini done: reason=' + D.lastReason() + ' stop=' + jaunty.logs.includes('stop') + ' (expect skipped true)');
drive(() => state === "playing", 400);
out.push('resume intact: state=' + state + ' score=' + players[0].score + ' len=' + players[0].cells.length +
         ' accZero=' + (acc === 0) + ' hudRestored=' + canvasStub.style.opacity +
         ' musicBack=' + (musicGain.gain.value === 0.55) +
         ' pending=' + rafQueue.length + ' (expect playing 3 4 true 1 true >0)');

// ---- M4 reward: winning the mini sheds 5 main snake segments ----
key('KeyE');                              // debug entry mid-play (jaunty persists)
MiniGame.debug.skipCountdown();
const lenPre = players[0].cells.length;
D.setScore(9);
let hw = D.cells()[0];
D.placeApple(hw.x + 1, hw.y);
MiniGame.frame(0.13);                     // 10th apple → win
out.push('mini win: phase=' + D.phase() + ' reason=' + D.reason() + ' jauntyWin=' + jaunty.logs.includes('win') + ' (expect win won true)');
drive(() => !MiniGame.isActive(), 300);   // win+fireworks+fade → finish → shrink + countdown
out.push('win shrink: len=' + players[0].cells.length + ' headKept=' + JSON.stringify(players[0].cells[0]) + ' (expect ' + Math.max(1, lenPre - 5) + ')');
drive(() => state === "playing", 400);
out.push('win resume: state=' + state + ' len=' + players[0].cells.length + ' score=' + players[0].score +
         ' musicBack=' + (musicGain.gain.value === 0.55) + ' (expect playing ' + Math.max(1, lenPre - 5) + ' 3 true)');

console.log(out.join('\\n'));
`;

require('vm').runInNewContext(src, sandbox);
