// Touch-control wiring tests (stage 3): routing through the SAME guards as
// keyboard — pads → steerPlayer / MiniGame.touchSteer, chips → pause/forfeit,
// overlay rows → handleKeyDown(data-key), board tap → countdown skip — plus
// syncChips visibility and last-tap ghosts. Two sandboxes: touch-enabled
// (matchMedia coarse, fake DOM) and desktop (matchMedia false, DOM trap).
const fs = require('fs');
const vm = require('vm');
const nodeSetTimeout = setTimeout;   // real timer for the ghost-fade phase
const noop = () => {};

const results = [];
function check(name, cond) { results.push((cond ? "PASS" : "FAIL") + " :: " + name); }

const stubCtx = {
  fillRect: noop, globalAlpha: 1, imageSmoothingEnabled: false, fillStyle: '', fillText: noop,
  beginPath: noop, arc: noop, fill: noop, stroke: noop, strokeStyle: '', lineWidth: 1,
  textAlign: 'left', font: '',
};
let box = { v: 0.05, t: 0 };
const raf = fn => 1;                   // main loop queued but never pumped: taps drive state
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
box.AC = function () { return fakeAC; };

function fakeEl(id) {
  const el = { id, textContent: '', innerHTML: '', style: {}, dataset: {}, classes: new Set(), listeners: [] };
  el.classList = {
    add: c => el.classes.add(c),
    remove: c => el.classes.delete(c),
    has: c => el.classes.has(c),
    toggle: (c, on) => on === undefined ? (el.classes.has(c) ? el.classes.delete(c) : el.classes.add(c)) : (on ? el.classes.add(c) : el.classes.delete(c)),
  };
  el.addEventListener = (ev, fn) => el.listeners.push({ ev, fn });
  return el;
}
const canvasStub = fakeEl("game");
canvasStub.getContext = () => stubCtx; canvasStub.width = 256; canvasStub.height = 192;
const crtEl = fakeEl("crt"), layerEl = fakeEl("layer");
const pauseEl = fakeEl("t-pause"), quitEl = fakeEl("t-quit");
const ghost0 = fakeEl("t-ghost-0"), ghost1 = fakeEl("t-ghost-1");
const overlayEl = fakeEl("overlay");
const documentStub = {
  getElementById: id =>
    id === "game" ? canvasStub
    : id === "overlay" ? overlayEl
    : id === "t-pause" ? pauseEl
    : id === "t-quit" ? quitEl
    : id === "t-ghost-0" ? ghost0
    : id === "t-ghost-1" ? ghost1
    : fakeEl(id),
  querySelector: sel => sel === ".crt" ? crtEl : sel === ".touch-layer" ? layerEl : fakeEl(sel),
};

const handlers = [];           // window listeners: game keydown + pointerdown unlock (+ mini when started)
const store = { snake_best: '0', snake_poop: '0', snake_music_muted: '0', snake_sfx_muted: '0', snake_wrap: '0', snake_track: 'chill' };
const sandbox = {
  document: documentStub,
  window: {
    addEventListener: (ev, fn) => handlers.push({ ev, fn }),
    removeEventListener: (ev, fn) => {
      const i = handlers.findIndex(h => h.ev === ev && h.fn === fn);
      if (i >= 0) handlers.splice(i, 1);
    },
    requestAnimationFrame: raf,
    matchMedia: q => ({ matches: true, media: q }),   // TOUCH DEVICE
  },
  localStorage: { getItem: k => store[k] ?? '0', setItem: (k, v) => { store[k] = String(v); } },
  requestAnimationFrame: raf,
  setInterval: () => 1, clearInterval: noop,          // touch/chill schedulers never fire in vm; tests call debug.syncChips()
  setTimeout: (fn, ms) => nodeSetTimeout(fn, ms),     // REAL timer — ghost-fade phase must actually run
  clearTimeout: noop,
  handlers, noop, store, crtEl, layerEl, pauseEl, quitEl, ghost0, ghost1, overlayEl, Set, Number, console, Float32Array, Promise, process,
  cpuHandlers: [], pad0: fakeEl('t-dpad-0'), pad1: fakeEl('t-dpad-1'), fakeEl, noop, canvasStub,
  fs, vm, __dirname, results,
  check: (name, cond) => results.push((cond ? "PASS" : "FAIL") + " :: " + name),
  performance: { now: () => (box.t += 1) }, box,
  Math: Object.create(Math, { random: { value: () => box.v } }),
};
sandbox.globalThis = sandbox;

let src = ['game.js', 'egg-baby.js', 'minigame.js', 'touch.js']
  .map(f => fs.readFileSync(__dirname + '/../src/' + f, 'utf8')).join('\n');

src += `
function key(c) { handlers.filter(h => h.ev === 'keydown').forEach(h => h.fn({ code: c, preventDefault: noop })); }
// delegated pointerdown on .crt; closest() answers per selector from the map
function pd(map) {
  let pded = false;
  crtEl.listeners.filter(l => l.ev === 'pointerdown')
    .forEach(l => l.fn({ target: { closest: sel => map[sel] ?? null }, preventDefault: () => { pded = true; } }));
  return pded;
}
const tapPad = (pad, dir) => pd({ "[data-dir]": { dataset: { pad: String(pad), dir } } });
const tapChip = action => pd({ "[data-action]": { dataset: { action } } });
const tapRow = code => pd({ "[data-key]": { dataset: { key: code } } });
const tapBoard = () => pd({});
const TC = TouchControls.debug;
const jq = a => JSON.stringify(a);

// ---- boot: wired once, pads idle on the title screen ----
check('touch enabled + single pads listener + global pointerdown unlock',
  TC.enabled && crtEl.listeners.filter(l => l.ev === 'pointerdown').length === 1 && handlers.some(h => h.ev === 'pointerdown'));
TC.syncChips();
check('menu: layer idle, chips off, ghost reset',
  layerEl.classes.has('idle') && !pauseEl.classes.has('on') && !quitEl.classes.has('on') && ghost0.style.opacity === '0');

// ---- overlay row taps press the keyboard logic ----
check('tap [1 PLAYER] row starts solo + preventDefault',
  tapRow('Digit1') && state === 'playing' && mode === 1 && players.length === 1);
TC.syncChips();
check('playing: pads active, pause chip on',
  !layerEl.classes.has('idle') && pauseEl.classes.has('on'));

// ---- solo: BOTH pads steer P1, reversal guard honored (vs LAST QUEUED dir) ----
tapPad(0, 'u');
check('solo pad0 queues P1 turn + lights ghost SVG up-arrow',
  jq(players[0].queue) === '["u"]' && ghost0.innerHTML.includes('M3 0h2v1') && ghost0.style.opacity === '1');
tapPad(1, 'd');
check('solo pad1 reaches P1 (d rejected as reversal of queued u) + ghost down SVG',
  jq(players[0].queue) === '["u"]' && ghost1.innerHTML.includes('M3 7h2v1'));
tapPad(1, 'l');
check('pad1 legal l lands in P1 queue (proves pad1 -> solo P1 routing)',
  jq(players[0].queue) === '["u","l"]' && ghost1.innerHTML.includes('M0 3h1v2'));
tapPad(0, 'r');
check('reversal (r after queued l) rejected, ghost right-arrow still marked',
  jq(players[0].queue) === '["u","l"]' && ghost0.innerHTML.includes('M7 3h1v2'));
players[0].queue.length = 0;
tapRow('Escape');
check('tap Esc row returns to title', state === 'menu');

// ---- versus: pad index maps to player ----
tapRow('Digit2');
check('tap [2 PLAYERS] row starts versus', mode === 2 && players.length === 2);
tapPad(0, 'u'); tapPad(1, 'd');
check('versus split: pad0 -> P1, pad1 -> P2',
  jq(players[0].queue) === '["u"]' && jq(players[1].queue) === '["d"]');
tapPad(1, 'u');
check('versus P1 reversal rejected', jq(players[1].queue) === '["d"]');
players[0].queue.length = 0; players[1].queue.length = 0;

// ---- pause chip toggles both ways ----
check('pause chip pauses game + RESUME overlay',
  tapChip('pause') && state === 'paused' && overlayEl.innerHTML.includes('RESUME'));
tapChip('pause');
check('pause chip resumes', state === 'playing');

// ---- options screen rows toggle settings ----
tapRow('Escape');
check('Esc row from play returns to title', state === 'menu');
tapRow('KeyO');
check('tap [OPTIONS] row opens options', state === 'options');
tapRow('Digit3'); tapRow('Digit4'); tapRow('KeyZ'); tapRow('KeyT');
check('taps toggle poop/wrap/mute/track (persisted)',
  store.snake_poop === '1' && store.snake_wrap === '1' && store.snake_music_muted === '1' && store.snake_track === 'retro');
tapRow('KeyZ'); tapRow('Escape');
check('unmute + Esc row back to title', store.snake_music_muted === '0' && state === 'menu');

// ---- mini round: pads steer the mini game; chips pause/forfeit ----
tapRow('Digit1');
state = 'minigame';
MiniGame.start({ onDone: () => { state = 'playing'; } });
MiniGame.debug.skipCountdown();
check('mini entered: play phase, dir r', MiniGame.debug.phase() === 'play' && MiniGame.debug.dir() === 'r');
tapPad(0, 'u');
check('mini steer: pad routes to MiniGame, main queue untouched',
  jq(MiniGame.debug.turnQueue()) === '["u"]' && jq(players[0].queue) === '[]');
tapPad(0, 'd');
check('mini reversal rejected', jq(MiniGame.debug.turnQueue()) === '["u"]');
TC.syncChips();
check('mini: pause chip AND ✕ chip both on', pauseEl.classes.has('on') && quitEl.classes.has('on'));
tapChip('pause');
check('pause chip pauses mini phase', MiniGame.debug.phase() === 'paused');
tapChip('pause');
check('pause chip resumes mini', MiniGame.debug.phase() === 'play');
tapChip('quit');
check('quit chip forfeits mini', ['fade', 'done'].includes(MiniGame.debug.phase()));
let n = 0;
while (MiniGame.isActive() && n < 12) { MiniGame.frame(0.2); n++; }
check('mini exited -> onDone restored playing', !MiniGame.isActive() && state === 'playing');

// ---- board tap skips the resume countdown ----
miniFrom = 'playing';                 // direct MiniGame.start bypasses enterMiniGame; finishCountdown must resume the game
state = 'minigame';
countdown = { step: 3, t: 3.3, done: false };
check('tap frozen board skips countdown', tapBoard() && state === 'playing' && countdown === null);
countdown = null;

// ---- game-over hides pads & chips ----
state = 'over';
TC.syncChips();
check('over: pads idle, both chips off',
  layerEl.classes.has('idle') && !pauseEl.classes.has('on') && !quitEl.classes.has('on'));

// ---- last-tap ghost fades out on the real clock ----
state = 'playing';
tapPad(0, 'u');
check('ghost lit right after tap', ghost0.style.opacity === '1' && TC.lastTap[0].dir === 'u');

setTimeout(() => {
  TC.syncChips();
  check('ghost faded after ~600ms of real time', ghost0.style.opacity === '0');

  // ---- keyboard regression: extracted handlers still steer keys ----
  tapRow('Escape'); tapRow('Digit1');
  key('KeyW');
  check('keyboard steer via extracted handler', jq(players[0].queue) === '["u"]');
  key('KeyA');
  check('keyboard legal chain u->l accepted (guard is queue-relative)', jq(players[0].queue) === '["u","l"]');
  key('KeyD');
  check('keyboard reversal (d after queued l) rejected', jq(players[0].queue) === '["u","l"]');

  // ---- D3: CPU opponent on touch — right pad inert + hidden ----
  {
    const cpuSrc = ['snake-ai.js', 'game.js', 'egg-baby.js', 'minigame.js', 'touch.js']
      .map(f => fs.readFileSync(__dirname + '/../src/' + f, 'utf8')).join('\\n');
    const cpuStore = { snake_best: '0', snake_poop: '0', snake_music_muted: '0', snake_sfx_muted: '0', snake_wrap: '0', snake_track: 'chill', snake_cpu: '1', snake_cpu_lv: 'normal' };
    const cpuDoc = {
      getElementById: id =>
        id === 'game' ? canvasStub
        : id === 'overlay' ? overlayEl
        : id === 't-pause' ? pauseEl
        : id === 't-quit' ? quitEl
        : id === 't-ghost-0' ? ghost0
        : id === 't-ghost-1' ? ghost1
        : id === 't-dpad-0' ? pad0
        : id === 't-dpad-1' ? pad1
        : fakeEl(id),
      querySelector: sel => sel === '.crt' ? crtEl : sel === '.touch-layer' ? layerEl : fakeEl(sel),
    };
    const cpuSb = {
      document: cpuDoc,
      window: { addEventListener: (ev, fn) => cpuHandlers.push({ ev, fn }), requestAnimationFrame: () => 1, matchMedia: q => ({ matches: true, media: q }) },
      localStorage: { getItem: k => cpuStore[k] ?? '0', setItem: (k, v) => { cpuStore[k] = String(v); } },
      requestAnimationFrame: () => 1, setInterval: () => 1, clearInterval: noop, clearTimeout: noop,
      setTimeout: () => 1,                 // ghost fade timers never fire in vm
      Set, Number, console, Float32Array, Promise, Date,
      pad0, pad1, cpuHandlers,
      check: (name, cond) => results.push((cond ? 'PASS' : 'FAIL') + ' :: ' + name),
      performance: { now: () => 1 },
    };
    cpuSb.globalThis = cpuSb;
    // NOTE: no backticks here — this whole file body is itself a template
    // literal, and nested raw backticks would truncate it. Plain string concat.
    const d3code = [
      "function ckey(c) { cpuHandlers.filter(h => h.ev === 'keydown').forEach(h => h.fn({ code: c, preventDefault: () => {} })); }",
      "ckey('Digit2');",
      "TouchControls.debug.steerPad(1, 'u');",   // right pad hits the CPU snake
      "TouchControls.debug.steerPad(0, 'u');",   // left pad still steers the human
      "TouchControls.debug.syncChips();",
      "check('D3 touch: versus starts with CPU P2', mode === 2 && players[1].cpu === true);",
      "check('D3 touch: right pad taps are inert for CPU', players[1].queue.length === 0);",
      "check('D3 touch: left pad still steers human P1', players[0].queue.includes('u'));",
      "check('D3 touch: syncChips hides the P2 pad, keeps P1 pad', pad1.style.visibility === 'hidden' && pad0.style.visibility === '');",
      "ckey('KeyC');",
      "check('D3 touch: C toggles CPU off + persists', localStorage.getItem('snake_cpu') === '0');",
      "startGame(2);",
      "TouchControls.debug.steerPad(1, 'd');",
      "TouchControls.debug.syncChips();",
      "check('D3 touch: rematch P2 human, right pad steers + inline hidden cleared', !players[1].cpu && players[1].queue.length === 1 && pad1.style.visibility === '');",
    ].join('\\n');
    vm.runInNewContext(cpuSrc + '\\n' + d3code, cpuSb);
  }

  // ---- desktop sandbox: touch.js loads with NO listeners, NO DOM access ----
  const acc = [];
  const docTrap = new Proxy({}, { get: (t, k) => { acc.push(String(k)); return undefined; } });
  const deskCtx = {
    window: { matchMedia: q => ({ matches: false, media: q }) },
    document: docTrap, Date, console,
  };
  deskCtx.globalThis = deskCtx;
  vm.runInNewContext(fs.readFileSync(__dirname + '/../src/touch.js', 'utf8'), deskCtx);
  check('desktop: disabled, DOM never touched', deskCtx.TouchControls.debug.enabled === false && acc.length === 0);

  console.log(results.join('\\n'));
  const fails = results.filter(r => r.startsWith('FAIL')).length;
  if (fails) { console.log('TOUCH-SUITE: ' + fails + ' FAILURES'); process.exit(1); }
  console.log('TOUCH-SUITE GREEN (' + results.length + ' checks, 2 sandboxes)');
}, 700);
`;

vm.runInNewContext(src, sandbox);
