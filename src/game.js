"use strict";

/* ------------------------------------------------------------------ *
 *  Snexel — pixel-art snake (snek × pixel), 1 or 2 players
 * ------------------------------------------------------------------ */

const GW = 32, GH = 24, CELL = 8;          // 32x24 board, 8px per cell
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
ctx.imageSmoothingEnabled = false;

const PAL = {
  bg1: "#1a1e2b",
  bg2: "#2c3549",
  ink: "#141624",
  white: "#f8f4e4",
  shine: "#fcf0a0",
  p1: { body: ["#5ad171", "#4ab560"], dark: "#2a6b3d", light: "#8fe89f" },
  p2: { body: ["#f5a664", "#e3934f"], dark: "#96602f", light: "#ffd0a0" },
};

const FOOD = {
  R: "#e43a2f", D: "#a2262b", H: "#f97a5c", W: "#fff6e2", G: "#2f7a3f",
};
const FOOD_SPRITE = [
  "..G...",
  "..G...",
  ".RRRR.",
  "HRRRRD",
  "WRRRRD",
  "RRRRDD",
  ".DDDD.",
];

const POOP_COLORS = { L: "#a9714a", B: "#7a5030", D: "#452b18" };
const POOP_SPRITE = [
  "..LB..",
  ".LLB..",
  "LLBBB.",
  "LLBBBB",
  "LBBBBD",
  "LBBDDD",
  ".DDDDD",
];

// pineapple: gold body with diamond-ish texture + green crown (6x8, fills cell)
const PINE = { P: "#f2b32d", D: "#a8752a", L: "#ffd869", G: "#2f7a3f", g: "#5fae52", W: "#fff6e2" };
const PINEAPPLE_SPRITE = [
  ".G..G.",
  ".GGGG.",
  ".gGGg.",
  "LLPPPD",
  "LPDPDD",
  "LPPDPD",
  "LPDPDD",
  ".LPPPD",
];

/* ------------------------------------------------------------------ *
 *  Tunable game parameters — one set per mode.
 *  apples:   foods alive on the board when a game starts (each eat respawns
 *            one, so the count stays at this value)
 *  grow:     segments added per apple eaten (1 = classic bulge-then-grow)
 *  speedDiv: divisor applied to EVERY speed level's tick length
 *            (higher = faster); absolute clamp 60ms
 * ------------------------------------------------------------------ */
const GAME_CONFIG = {
  solo:   { apples: 2, grow: 2, speedDiv: 0.7 },
  versus: { apples: 2, grow: 1, speedDiv: 1 },   // try speedDiv 1.15 for livelier 2P
  // Pineapple bomb: spawns on its own limit when an apple is eaten (chance);
  // eating it blasts ALL poops and apples within radius tiles of the bite
  // (hidden piles included, silently), flashes that zone red briefly, and in
  // versus mode kills any opponent whose HEAD is caught inside the radius.
  pineapple: { radius: 5, maxOnScreen: 1, chance: 0.10 },
  // banana cross-fire: same roll/chance as pineapple, own cap of 1; eating it
  // blasts the ENTIRE row and column of the bite — wipes every poop, apple
  // and pineapple on that row/column (hidden piles included, silently),
  // pulses the row+column red, and in versus mode kills any opponent whose
  // HEAD sits on that row or column.
  banana: { maxOnScreen: 1, chance: 0.10 },
  // egg → baby pipeline (solo only): each apple bite rolls chance for an egg
  // (after pineapple/banana — one special item per bite). A waiting egg hatches
  // a shy 3-segment AI baby after hatchBites more apples; the baby is narrower
  // and slower, dodges every item and the snake, freezes when cornered, and is
  // captured (→ mini-game handoff in M4) on any overlap with the main snake.
  // Running over an unhatched egg squashes it: no death, no baby.
  egg: { chance: 0.03, hatchBites: 3, babyLen: 3, babySpeedMul: 1.5, babyWidth: 6,
         bannerMs: 1.5 },   // "Catch me if you can!" flash duration after hatch
  // mini-game (M3): classic 1-snake round on a bright centered 20x16 grid at
  // 6px cells — apples only, walls kill, wrap always OFF, flat clock; win at
  // goal apples → fireworks → fade → handoff back (M4 adds countdown/reward).
  mini: { gw: 20, gh: 16, cell: 6, snakeLen: 3, goal: 10, apples: 2, grow: 1,
          tickMs: 130, winMs: 0.6, fxMs: 2.0, diedMs: 0.8, fadeMs: 0.5,
          countMs: 3.35,     // entry "3 2 1 GO!" (1s per digit + 0.35s GO), same as the resume countdown
          shrink: 5 },       // mini-win reward: main snake loses this many tail segments
  // SnakeAI personalities (docs/snake-ai-plan.md §3/§4): presets wrap engine
  // opts; these knobs merge over them — tune freely (localStorage in D3).
  ai: {
    demo:   { shortcutSlack: 6, jitter: 1 },
    baby:   { jitter: 0.35, hesitation: 0.3, slack: 1 },
    cpu:    { easy: { jitter: 0.8 }, normal: { jitter: 0.4, slack: 2 },
              hard: { shortcutSlack: 2, oppLookahead: 3 } },
  },
};
const cfg = () => (mode === 2 ? GAME_CONFIG.versus : GAME_CONFIG.solo);

// single banana on the diagonal — stem top-right, tip bottom-left, brown
// outline (#4a3410) around gold body (#ffd93b) with highlight (#fff08a)
// and shade (#e0a812); stem/tip caps #8b5a2b + #5e3d17.
// Flat 8x8 row-major array (index = ry*8 + rx).
const BANANA = [
  null,      null,      null,      null,      null,      null,      '#5e3d17', null,
  null,      null,      null,      null,      null,      null,      '#8b5a2b', null,
  null,      null,      null,      null,      null,      '#4a3410', '#8b5a2b', '#4a3410',
  null,      null,      null,      null,      '#4a3410', '#fff08a', '#ffd93b', '#4a3410',
  null,      '#4a3410', '#4a3410', '#4a3410', '#fff08a', '#ffd93b', '#e0a812', '#4a3410',
  '#4a3410', '#8b5a2b', '#fff08a', '#fff08a', '#ffd93b', '#ffd93b', '#e0a812', '#4a3410',
  '#4a3410', '#8b5a2b', '#ffd93b', '#ffd93b', '#e0a812', '#e0a812', '#4a3410', null,
  null,      '#4a3410', '#4a3410', '#4a3410', '#4a3410', '#4a3410', null,      null,
];

const DIRS = { u: [0, -1], d: [0, 1], l: [-1, 0], r: [1, 0] };
const REV  = { u: "d", d: "u", l: "r", r: "l" };

const tileDist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

let state = "menu";          // menu | playing | paused | over
let mode = 1;
let poopMode = localStorage.getItem("snake_poop") === "1";
let musicMuted = localStorage.getItem("snake_music_muted") === "1";
let sfxMuted = localStorage.getItem("snake_sfx_muted") === "1";

// attract-mode demo is silent: title music keeps chilling, but the menu demo
// snake never plays eat/plop/level/boom/jingle SFX (demoQuiet gates them).
function demoQuiet() { return state === "menu"; }
let wrapMode = localStorage.getItem("snake_wrap") === "1";   // edges are portals, not walls

// Music track: "retro" = the handmade 4-bar chiptune loop below;
// "chill" = the procedural ChillMusic engine (chiptune-music.js, loaded as an
// ES module in index.html and exposed as window.ChillMusic).
let track = localStorage.getItem("snake_track") === "retro" ? "retro" : "chill";
let chill = null;                 // ChillMusic instance, created lazily
let chillStarted = false;         // engine.start() once; later gestures only resume its ctx
let poops = [];
let pineapples = [];            // bomb fruit — separate array + spawn roll
let bananas = [];               // cross-fire fruit — own array + own roll
let explosions = [];            // {x, y, t} blast zones pulsing red
let crossFlash = [];            // {x, y, t} banana row/column pulses
let players = [];
let foods = [];
let particles = [];
let eliminations = [];
let tickCount = 0;
let tickMs = 130;
let acc = 0;
let prev = 0;

// Speed levels: milestone bite counts with doubling intervals 8, 16, 32,
// then capped at +32 per level — cumulative bites 8, 24, 56, 88, 120, 152,
// 184, 216 … Speed floors at SPEED_MIN (reached at L6 = 152 bites); levels
// keep arriving every 32 bites past that as flavour level-ups.
const SPEED_START = 130;
const SPEED_MIN = 76;
const SPEED_DELTAS = [14, 12, 10, 8, 6, 4];   // levels 1..6, then flat
let level = 0;
let levelAt = 0;                              // performance.now() of last level-up

function speedFor(lv) {
  let ms = SPEED_START;
  for (let i = 0; i < lv; i++) ms -= SPEED_DELTAS[i] ?? 0;
  return Math.max(60, Math.max(SPEED_MIN, ms) / (cfg().speedDiv || 1));
}

function levelForBites(bites) {
  let n = 0, need = 8, interval = 8;
  while (bites >= need) {
    n++;
    interval = Math.min(interval * 2, 32);   // doubling, capped: later levels every +32
    need += interval;
  }
  return n;
}
let best = Number(localStorage.getItem("snake_best") || 0);

const el = {
  p1: document.getElementById("p1score"),
  p2: document.getElementById("p2score"),
  p2wrap: document.getElementById("p2wrap"),
  best: document.getElementById("best"),
  overlay: document.getElementById("overlay"),
};

let audioCtx = null;

function ensureAudio() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  if (!audioCtx) audioCtx = new AC();          // may start suspended (autoplay policy)
  // Browsers keep contexts suspended until a gesture and do NOT auto-resume on
  // activation, so call resume() on EVERY gesture — whichever comes first.
  if (audioCtx.state === "suspended") audioCtx.resume();
  applyTrack();                                // idempotent; starts whichever track is selected
  if (chill && chill.ctx && chill.ctx.state === "suspended") chill.ctx.resume();
}

// 8-bit "pickup" chomp: square-wave rising arpeggio + low saw crunch layer
function eatSound() {
  if (!audioCtx || sfxMuted || demoQuiet()) return;
  const t = audioCtx.currentTime;

  const g1 = audioCtx.createGain();
  g1.connect(audioCtx.destination);
  g1.gain.setValueAtTime(0.18, t);
  g1.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
  const o1 = audioCtx.createOscillator();
  o1.type = "square";
  o1.frequency.setValueAtTime(523, t);        // C5
  o1.frequency.setValueAtTime(659, t + 0.05); // E5
  o1.frequency.setValueAtTime(784, t + 0.10); // G5
  o1.connect(g1);
  o1.start(t);
  o1.stop(t + 0.22);

  const g2 = audioCtx.createGain();
  g2.connect(audioCtx.destination);
  g2.gain.setValueAtTime(0.10, t);
  g2.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
  const o2 = audioCtx.createOscillator();
  o2.type = "sawtooth";
  o2.frequency.setValueAtTime(130, t);
  o2.frequency.exponentialRampToValueAtTime(55, t + 0.12);
  o2.connect(g2);
  o2.start(t);
  o2.stop(t + 0.12);
}

// subtle "plop": quiet triangle drop + tiny splat, quieter than eatSound.
// Plays when the pile actually becomes visible (bulge slides off the tail).
function poopSound() {
  if (!audioCtx || sfxMuted || demoQuiet()) return;
  const t = audioCtx.currentTime;

  const g1 = audioCtx.createGain();
  g1.connect(audioCtx.destination);
  g1.gain.setValueAtTime(0.10, t);         // noticeably quieter than eat's 0.18
  g1.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
  const o1 = audioCtx.createOscillator();
  o1.type = "triangle";
  o1.frequency.setValueAtTime(320, t);
  o1.frequency.exponentialRampToValueAtTime(120, t + 0.22);   // audible plopping descent
  o1.connect(g1);
  o1.start(t);
  o1.stop(t + 0.22);

  const g2 = audioCtx.createGain();
  g2.connect(audioCtx.destination);
  g2.gain.setValueAtTime(0.05, t + 0.02);
  g2.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
  const o2 = audioCtx.createOscillator();
  o2.type = "square";
  o2.frequency.setValueAtTime(160, t + 0.02);
  o2.frequency.exponentialRampToValueAtTime(70, t + 0.14);    // tiny splat tail
  o2.connect(g2);
  o2.start(t + 0.02);
  o2.stop(t + 0.14);
}

// Rising arpeggio fanfare on a speed level-up — brighter and quicker than eat.
function levelSound() {
  if (!audioCtx || sfxMuted || demoQuiet()) return;
  const t = audioCtx.currentTime;
  [659.25, 880, 1046.5].forEach((f, i) => {
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = "square";
    o.frequency.setValueAtTime(f, t);
    const at = t + i * 0.055;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(0.06, at + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0005, at + 0.09);
    o.connect(g);
    o.start(at);
    o.stop(at + 0.1);
  });
}

/* ---------------------------- music ---------------------------- */
// chill chiptune loop: Am - F - C - G at 92 BPM
// layers: warm triangle bass, quiet square arpeggio (8ths), sparse
// pentatonic lead with echo, very soft noise hats.
const MUSIC_BPM = 92;
const STEP16 = 60 / MUSIC_BPM / 4;         // 16th-note duration
const BAR_STEPS = 16;
const LOOP_STEPS = BAR_STEPS * 4;
let musicGain = null, musicTimer = null, nextStep = 0, nextStepTime = 0;
let noiseBuf = null;
let musicVol = 0.55;                        // master music level (ducked on pause/game over)

const midiHz = m => 440 * Math.pow(2, (m - 69) / 12);

// (RETRO_CHORDS, not CHORDS: chiptune-music.js declares CHORDS in the same
// global scope — classic scripts can't share identifier names.)
const RETRO_CHORDS = [
  { bass: 33, tones: [57, 60, 64] },       // Am: A2 bass, A C E
  { bass: 29, tones: [53, 57, 60] },       // F:  F2 bass, F A C
  { bass: 36, tones: [48, 52, 55] },       // C:  C2 bass, C E G
  { bass: 31, tones: [55, 59, 62] },       // G:  G1 bass, G B D
];

// sparse lead (A-minor pentatonic: A C D E G) — rests are intentional
const LEAD = [
  [[0, 76], [10, 72]],                      // E5, C5 over Am
  [[4, 72], [12, 69]],                      // C5, A4 over F
  [[0, 79], [8, 76]],                       // G5, E5 over C
  [[6, 74], [14, 76]],                      // D5, E5 over G
];

function startMusic() {
  if (!audioCtx || musicTimer) return;
  musicGain = audioCtx.createGain();
  musicGain.gain.setValueAtTime(musicTarget(musicVol), audioCtx.currentTime);
  musicGain.connect(audioCtx.destination);

  // one shared noise buffer for hats
  noiseBuf = audioCtx.createBuffer(1, audioCtx.sampleRate, audioCtx.sampleRate);
  const data = noiseBuf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

  nextStep = 0;
  nextStepTime = audioCtx.currentTime + 0.05;
  musicTimer = setInterval(scheduleMusic, 25);   // 25ms lookahead scheduler
}

// Single mute-aware target for the main track: Z-mute forces 0, and while
// state === "minigame" the main track is FULLY muted (JauntyMusic plays in
// its place — a duck like the pause one is clearly audible on speakers).
function musicTarget(v) { return musicMuted || state === "minigame" ? 0 : v; }

function setMusicVolume(v, fade = 0.3) {
  musicVol = v;
  const target = musicTarget(v);
  if (track === "chill" && chill) { chill.setVolume(target); return; }
  if (musicGain) {
    const t = audioCtx.currentTime;
    const cur = musicGain.gain.value ?? musicVol;
    if (musicGain.gain.cancelScheduledValues) musicGain.gain.cancelScheduledValues(t);
    musicGain.gain.setValueAtTime(cur, t);          // anchor current level
    musicGain.gain.linearRampToValueAtTime(target, t + fade);
  }
}

function musicNote(freq, t, dur, type, gain, dest = musicGain) {
  const g = audioCtx.createGain();
  g.connect(dest);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
  const o = audioCtx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  o.connect(g);
  o.start(t);
  o.stop(t + dur);
}

function musicHat(t) {
  if (!noiseBuf) return;
  const src = audioCtx.createBufferSource();
  src.buffer = noiseBuf;
  const f = audioCtx.createBiquadFilter();
  f.type = "highpass";
  f.frequency.setValueAtTime(5200, t);
  const g = audioCtx.createGain();
  g.gain.setValueAtTime(0.022, t);                 // barely-there hat
  g.gain.exponentialRampToValueAtTime(0.0005, t + 0.035);
  src.connect(f);
  f.connect(g);
  g.connect(musicGain);
  src.start(t, Math.random() * 0.7, 0.035);
}

function emitStep(s, t) {
  if (musicMuted) return;              // scheduler keeps advancing so unmute resumes in-sync
  const bar = (s / BAR_STEPS) | 0;
  const st = s % BAR_STEPS;
  const ch = RETRO_CHORDS[bar];

  // bass: root pulse, fifth answer, short root tail — relaxed, not thumping
  if (st === 0) musicNote(midiHz(ch.bass), t, 0.22, "triangle", 0.10);
  else if (st === 8) musicNote(midiHz(ch.bass + 7), t, 0.18, "triangle", 0.085);
  else if (st === 12) musicNote(midiHz(ch.bass), t, 0.14, "triangle", 0.075);

  // arpeggio: chord tones an octave up, gentle 8th pulses
  if (st % 2 === 0) musicNote(midiHz(ch.tones[(st / 2) % ch.tones.length] + 12), t, 0.09, "square", 0.03);

  // soft hat on the off-beats
  if (st % 4 === 2) musicHat(t);

  // sparse lead with a faint echo
  for (const [stepIdx, midi] of LEAD[bar]) {
    if (st === stepIdx) {
      musicNote(midiHz(midi), t, 0.24, "square", 0.055);
      musicNote(midiHz(midi), t + STEP16 * 3, 0.2, "square", 0.022);
    }
  }
}

function scheduleMusic() {
  if (!audioCtx || !musicGain) return;
  const horizon = audioCtx.currentTime + 0.12;
  // If the audio clock sat frozen (ctx suspended pre-unlock), don't dump the
  // whole backlog at once — jump the scheduler near the live clock instead.
  if (horizon - nextStepTime > 0.5) {
    nextStep = (nextStep + Math.round((horizon - 0.3 - nextStepTime) / STEP16)) % LOOP_STEPS;
    nextStepTime = horizon - 0.3;
  }
  while (nextStepTime < horizon) {
    emitStep(nextStep, nextStepTime);
    nextStep = (nextStep + 1) % LOOP_STEPS;
    nextStepTime += STEP16;
  }
}

/* --------------------- music engine B: chill ambience ---------------------
   ChillMusic owns its own AudioContext and scheduling; game.js only drives it:
   start/stop on track switch, duck via setVolume, hooks on eat/death/restart.
   Our musicMuted flag stays the source of truth — we duck the engine's volume
   to 0 instead of using its own toggleMute (so its localStorage key is unused).
*/
function startChill() {
  if (!window.ChillMusic) {          // script failed to load → stay on retro
    track = "retro";
    startMusic();
    return;
  }
  if (musicTimer) { clearInterval(musicTimer); musicTimer = null; }
  if (!chill) {
    chill = new window.ChillMusic({ bpm: 72, volume: musicTarget(musicVol) });
    chill.muted = false;             // our mute flag governs, not the engine's
  }
  if (!chillStarted) {
    chillStarted = true;
    chill.setVolume(musicTarget(musicVol));
    chill.setIntensity(0.1);
    chill.start();                   // engine resumes its ctx + schedules after unlock
  }
  if (chill.ctx && chill.ctx.state === "suspended") chill.ctx.resume();
}

function stopChill(fade = 0.4) {
  chillStarted = false;
  if (chill) chill.stop(fade);
}

function applyTrack() {
  if (track === "chill") startChill();
  else { stopChill(0.4); startMusic(); }
}

/* ---------------------------- snakes ---------------------------- */

function makeSnake(x, y, dir, pal, ai = false) {
  const [dx, dy] = DIRS[dir];
  const cells = [];
  for (let i = 0; i < 4; i++) cells.push({ x: x - dx * i, y: y - dy * i });
  return { cells, dir, queue: [], pal, score: 0, alive: true, ai };
}

function startGame(m) {
  mode = m;
  setMusicVolume(0.55, 0.3);                // music back to full level
  if (track === "chill" && chill) chill.setIntensity(0.1);    // reopen the chill track
  players = [makeSnake(9, 12, "r", PAL.p1)];
  if (m === 2) players.push(makeSnake(GW - 10, 12, "l", PAL.p2));
  foods = [];
  poops = [];
  pineapples = [];
  bananas = [];
  explosions = [];
  crossFlash = [];
  if (window.EggBaby) EggBaby.resetEggBaby();
  const apples = m === 2 ? GAME_CONFIG.versus.apples : GAME_CONFIG.solo.apples;
  for (let i = 0; i < apples; i++) spawnFood();
  particles = [];
  eliminations = [];
  tickCount = 0;
  level = 0;
  levelAt = 0;
  tickMs = speedFor(0);
  acc = 0;
  state = "playing";
  hideOverlay();
  updateHud();
}

function initMenu() {
  state = "menu";
  setMusicVolume(0.55, 0.3);
  players = [makeSnake(10, 12, "r", PAL.p1, true)];
  foods = [spawnFood()];
  poops = [];
  pineapples = [];
  bananas = [];
  explosions = [];
  crossFlash = [];
  if (window.EggBaby) EggBaby.resetEggBaby();   // safe pre-load: guarded
  particles = [];
  acc = 0;
  tickMs = speedFor(0) + 20;   // menu demo ambles a bit slower
  level = 0;
  levelAt = 0;
  el.p1.textContent = "–";
  el.p2.textContent = "–";
  el.p2wrap.style.visibility = "hidden";
  el.best.textContent = best;
  showOverlay(`
    <div class="ov-inner">
      <div class="ov-title">SNEXEL</div>
      <div class="ov-sub">Slither &amp; Chill</div>
      <div class="ov-lines">
        <div data-key="Digit1"><span class="key">1</span><span class="g">1 PLAYER</span></div>
        <div data-key="Digit2"><span class="key">2</span><span class="o">2 PLAYERS</span> — WASD vs ARROWS</div>
      </div>
      <div class="ov-note"><span class="key" data-key="KeyO">O</span>OPTIONS&nbsp; <span class="key">P</span>PAUSE&nbsp; <span class="key" data-key="Escape">Esc</span>MENU&nbsp; best: ${best}</div>
    </div>`);
}

// M3 debug mini-game handoff: freeze the main game, hand canvas+keyboard to
// MiniGame, restore the previous state when it finishes. Main-game score /
// length / tickMs / acc survive untouched; music ducks under the mini SFX.
let miniFrom = "menu";
let jaunty = null;      // JauntyMusic engine instance (created once audio unlocks; reused across rounds)
let countdown = null;   // M4 "3 2 1 GO" resume countdown — game.js-owned, after MiniGame fades out

function enterMiniGame() {
  if (!window.MiniGame || state === "minigame") return;
  miniFrom = state;                       // "playing" | "menu"
  state = "minigame";
  hideOverlay();                          // menu/options DOM overlay must not sit over the mini board
  el.p1.style.opacity = el.p2.style.opacity = el.best.style.opacity = "0.4";  // dim main HUD (plan §5)
  setMusicVolume(musicVol, 0.3);             // main track FULLY muted while state === "minigame" (musicTarget clamp)
  if (!jaunty && window.JauntyMusic && audioCtx) {
    jaunty = new window.JauntyMusic({ ctx: audioCtx, volume: musicMuted ? 0 : 0.5 });
  }
  MiniGame.setMusic(jaunty || null);      // null → silent stub until audio unlocks
  MiniGame.start({
    // M4: MiniGame fades out; game.js then runs the countdown before resuming.
    // Winning the round pays out: the main snake sheds tail segments (reward:
    // shorter snake = easier board). onDone receives "won"|"wall"|"body"|"skipped".
    onDone: (reason) => {
      if (reason === "won") shrinkMainSnake(GAME_CONFIG.mini.shrink);
      countdown = { t: 0, step: -1 };
    },
  });
}

// Mini-win reward: cut up to n segments off each living snake's tail (the
// head is never cut). Segments removed mid-bulge surface any hidden pile
// under them — same precedent as an explosion before the bulge reaches the
// tail — and shed a small green puff where they detach.
function shrinkMainSnake(n) {
  for (const p of players) {
    if (!p.alive) continue;
    const cut = Math.min(n, p.cells.length - 1);
    if (cut <= 0) continue;
    for (const c of p.cells.slice(p.cells.length - cut)) {
      if (c.bulge) revealPoop(c.x, c.y);
      const cx = c.x * CELL + CELL / 2, cy = c.y * CELL + CELL / 2;
      for (let k = 0; k < 3; k++) {
        particles.push({
          x: cx + (Math.random() - 0.5) * 4, y: cy + (Math.random() - 0.5) * 4,
          vx: (Math.random() - 0.5) * 90, vy: (Math.random() - 0.5) * 90 - 30,
          life: 0.3 + Math.random() * 0.3, max: 0.6, s: 2,
          color: k === 0 ? PAL.white : p.pal.body[k % 2],
        });
      }
    }
    p.cells.splice(p.cells.length - cut, cut);
    p.cells[0].bulge = false;   // any bulge run is gone with the cut tail
  }
}

// egg-baby flagged a baby capture — announce it and jump into the mini-game.
function captureHandoff() {
  startJingle();
  enterMiniGame();
}

// bright 3-note square arpeggio so the overlay arrival is unmistakable (plan §6)
function startJingle() {
  if (!audioCtx || sfxMuted || demoQuiet()) return;
  const t = audioCtx.currentTime;
  [523.25, 659.25, 783.99].forEach((f, i) => {
    const g = audioCtx.createGain();
    g.connect(audioCtx.destination);
    g.gain.setValueAtTime(0.12, t + i * 0.09);
    g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.09 + 0.16);
    const o = audioCtx.createOscillator();
    o.type = "square";
    o.frequency.setValueAtTime(f, t + i * 0.09);
    o.connect(g); o.start(t + i * 0.09); o.stop(t + i * 0.09 + 0.18);
  });
}

// three quiet rising beeps (3,2,1) + a longer "GO" blip — quiet like the poop-plop precedent
// (shared: minigame.js's entry countdown calls these with the same step semantics)
function countdownBeep(step) {
  if (!audioCtx || sfxMuted) return;
  const t = audioCtx.currentTime;
  const go = step >= 3;
  const g = audioCtx.createGain();
  g.connect(audioCtx.destination);
  g.gain.setValueAtTime(go ? 0.1 : 0.07, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + (go ? 0.2 : 0.09));
  const o = audioCtx.createOscillator();
  o.type = "square";
  o.frequency.setValueAtTime(go ? 880 : [440, 550, 660][step], t);
  o.connect(g); o.start(t); o.stop(t + (go ? 0.22 : 0.1));
}

// big digit over the frozen board, banner style; "GO!" after the three beeps
function drawCountdownBanner(step) {
  const label = step >= 3 ? "GO!" : String(3 - step);
  ctx.globalAlpha = step >= 3 ? 1 : 0.8 + 0.2 * Math.sin((countdown.t % 1) * Math.PI);
  ctx.fillStyle = step >= 3 ? "#7cf2ff" : "#ffd36e";
  ctx.font = "24px 'Press Start 2P', monospace";
  ctx.textAlign = "center";
  ctx.fillText(label, canvas.width / 2, canvas.height / 2 + 10);
  ctx.textAlign = "left";
  ctx.globalAlpha = 1;
}

function finishCountdown() {
  countdown = null;
  el.p1.style.opacity = el.p2.style.opacity = el.best.style.opacity = "1";
  if (miniFrom === "menu") initMenu();    // redraws the title overlay + demo snake (state = "menu")
  else state = "playing";                 // scores, snake position, level speed intact
  setMusicVolume(0.55, 0.3);              // unmute AFTER the state flip (musicTarget no longer clamps)
  acc = 0;                                // restart the main clock cleanly from the frozen scene
}

function initOptions() {
  state = "options";
  showOverlay(`
    <div class="ov-inner">
      <div class="ov-title">OPTIONS</div>
      <div class="ov-sub">MODES &amp; AUDIO</div>
      <div class="ov-lines">
        <div data-key="Digit3"><span class="key">3</span>MODE #2 — <span class="${poopMode ? "g" : "dimc"}">${poopMode ? "ON" : "OFF"}</span></div>
        <div data-key="Digit4"><span class="key">4</span>WRAP MODE — <span class="${wrapMode ? "g" : "dimc"}">${wrapMode ? "ON" : "OFF"}</span> — edges are portals</div>
        <div data-key="KeyZ"><span class="key">Z</span>MUSIC — <span class="${musicMuted ? "dimc" : "g"}">${musicMuted ? "MUTED" : "ON"}</span></div>
        <div data-key="KeyX"><span class="key">X</span>SFX — <span class="${sfxMuted ? "dimc" : "g"}">${sfxMuted ? "MUTED" : "ON"}</span></div>
        <div data-key="KeyT"><span class="key">T</span>TRACK — <span class="${track === "retro" ? "g" : "dimc"}">RETRO CHIP</span> / <span class="${track === "chill" ? "g" : "dimc"}">CHILL AMBIENCE</span></div>
      </div>
      <div class="ov-note"><span class="key" data-key="Escape">Esc</span>BACK — toggles work anywhere, even mid-game</div>
    </div>`);
}

/* ---------------------------- food ---------------------------- */

function occupiedSet(extra = []) {
  const s = new Set();
  for (const p of players) for (const c of p.cells) s.add(c.x + "," + c.y);
  for (const f of foods) s.add(f.x + "," + f.y);
  for (const po of poops) if (po.visible) s.add(po.x + "," + po.y);
  for (const p of pineapples) s.add(p.x + "," + p.y);
  for (const b of bananas) s.add(b.x + "," + b.y);
  for (const c of extra) s.add(c.x + "," + c.y);
  if (window.EggBaby) EggBaby.addOccupancy(s);   // eggs + baby block fruit spawns
  return s;
}

function spawnFood() {
  const occ = occupiedSet();
  let f = null;
  for (let tries = 0; tries < 80 && !f; tries++) {
    const x = (Math.random() * GW) | 0, y = (Math.random() * GH) | 0;
    if (!occ.has(x + "," + y)) f = { x, y };
  }
  if (!f) {
    outer: for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++)
      if (!occ.has(x + "," + y)) { f = { x, y }; break outer; }
  }
  if (f) foods.push(f);
  return f;
}

function foodAt(x, y) {
  return foods.findIndex(f => f.x === x && f.y === y);
}

function pineappleAt(x, y) {
  return pineapples.findIndex(p => p.x === x && p.y === y);
}

function bananaAt(x, y) {
  return bananas.findIndex(b => b.x === x && b.y === y);
}

function spawnBanana() {
  const occ = occupiedSet();
  let b = null;
  for (let tries = 0; tries < 80 && !b; tries++) {
    const x = (Math.random() * GW) | 0, y = (Math.random() * GH) | 0;
    if (!occ.has(x + "," + y)) b = { x, y };
  }
  if (!b) {
    outer: for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++)
      if (!occ.has(x + "," + y)) { b = { x, y }; break outer; }
  }
  if (b) bananas.push(b);
  return b;
}

function spawnPineapple() {
  const occ = occupiedSet();
  let p = null;
  for (let tries = 0; tries < 80 && !p; tries++) {
    const x = (Math.random() * GW) | 0, y = (Math.random() * GH) | 0;
    if (!occ.has(x + "," + y)) p = { x, y };
  }
  if (!p) {
    outer: for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++)
      if (!occ.has(x + "," + y)) { p = { x, y }; break outer; }
  }
  if (p) pineapples.push(p);
  return p;
}

function poopAt(x, y) {
  return poops.some(po => po.visible && po.x === x && po.y === y);
}

// reveal the pile hidden under a bulged segment, with its plop
// deep boom + noise crunch, straight to master (independent of music mute)
function boomSound() {
  if (!audioCtx || sfxMuted || demoQuiet()) return;
  const t = audioCtx.currentTime;
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.type = "sawtooth";
  o.frequency.setValueAtTime(240, t);
  o.frequency.exponentialRampToValueAtTime(45, t + 0.35);
  g.gain.setValueAtTime(0.14, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
  o.connect(g);
  g.connect(audioCtx.destination);
  o.start(t);
  o.stop(t + 0.42);
  const src = audioCtx.createBufferSource();
  src.buffer = noiseBuffer();
  const f = audioCtx.createBiquadFilter();
  f.type = "lowpass";
  f.frequency.setValueAtTime(1400, t);
  f.frequency.exponentialRampToValueAtTime(200, t + 0.3);
  const ng = audioCtx.createGain();
  ng.gain.setValueAtTime(0.16, t);
  ng.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
  src.connect(f);
  f.connect(ng);
  ng.connect(audioCtx.destination);
  src.start(t, Math.random() * 0.5, 0.3);
}

function revealPoop(x, y) {
  for (const po of poops) {
    if (!po.visible && po.x === x && po.y === y) {
      po.visible = true;
      poopSound();
    }
  }
}

/* ---------------------------- ticking ---------------------------- */

// D1 wiring: the title-screen demo snake is driven by the SnakeAI engine
// (docs/snake-ai-plan.md Phase D1). Q toggles engine vs the old random
// walker so engine upgrades are visible side-by-side in the attract mode.
let demoEngine = true;
let demoTag = "AI: ENGINE";
const DEMO_AI_OPTS = window.SnakeAI
  ? SnakeAI.presets("demo", GAME_CONFIG.ai.demo)
  : { cycle: true, shortcutSlack: 6, danger: true, floodFill: true, slack: 2, jitter: 1, zoneReach: 3 };
// Phase C preset "demo" (engine optional so game-only vm sandboxes load):
// Hamiltonian cycle tier + conservative shortcuts; if hazards (pineapple/
// banana zones) block the cycle it degrades to the BFS tier — trap deaths
// there restart the demo silently (attract-mode rule). Q compares against
// the legacy random walker.
// one long-lived seeded RNG: advances per tick (organic) but reproducible.
const demoBrainRng = window.SnakeAI ? window.SnakeAI.debug.mulberry32(20260120) : null;

function demoWorld(p) {
  const foes = players.filter(q => q !== p && q.alive)
    .map(q => ({ body: q.cells, dir: q.dir, queue: q.queue }));
  return {
    gw: GW, gh: GH, wrap: wrapMode,
    body: p.cells, dir: p.dir,
    foods, pineapples, bananas,
    poops: poops.filter(po => po.visible),   // fairness: hidden piles unseen
    foes,
    rng: demoBrainRng,
  };
}

function aiPickDir(p) {
  if (demoEngine && window.SnakeAI) {
    p.dir = SnakeAI.choose(demoWorld(p), DEMO_AI_OPTS);
    return;
  }
  // legacy random walker (Q toggle fallback / sandbox without the engine)
  const [dx, dy] = DIRS[p.dir];
  const cand = Object.keys(DIRS).filter(d => d !== REV[p.dir]);
  // shuffle
  for (let i = cand.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [cand[i], cand[j]] = [cand[j], cand[i]];
  }
  const occ = occupiedSet();
  for (const d of cand) {
    const [nx, ny] = DIRS[d];
    const hx = p.cells[0].x + nx, hy = p.cells[0].y + ny;
    if (hx < 0 || hx >= GW || hy < 0 || hy >= GH) continue;
    if (occ.has(hx + "," + hy) && !(hx === p.cells[3].x && hy === p.cells[3].y)) continue;
    p.dir = d;
    return;
  }
}

function tick() {
  tickCount++;

  for (const p of players) {
    if (!p.alive) continue;
    if (p.ai) aiPickDir(p);
    if (p.queue.length) {
      const d = p.queue.shift();
      if (d !== REV[p.dir]) p.dir = d;
    }
  }

  const alive = players.filter(p => p.alive);
  const heads = alive.map(p => {
    let x = p.cells[0].x + DIRS[p.dir][0];
    let y = p.cells[0].y + DIRS[p.dir][1];
    if (wrapMode) {                        // walk off an edge, appear on the opposite side
      x = (x + GW) % GW;
      y = (y + GH) % GH;
    }
    return { x, y };
  });
  const eats = heads.map(h => foodAt(h.x, h.y));
  const pines = heads.map(h => pineappleAt(h.x, h.y));
  const bans = heads.map(h => bananaAt(h.x, h.y));

  // occupancy from snake bodies only (poop handled after reveal pass)
  const occ = new Set();
  alive.forEach((p, i) => {
    const keepTail = eats[i] >= 0 || pines[i] >= 0 || bans[i] >= 0;
    p.cells.forEach((c, j) => {
      if (!keepTail && j === p.cells.length - 1) return;
      occ.add(c.x + "," + c.y);
    });
  });

  const died = new Set();
  const causes = [];

  // head-to-head: both lose
  for (let i = 0; i < alive.length; i++) {
    for (let j = i + 1; j < alive.length; j++) {
      if (heads[i].x === heads[j].x && heads[i].y === heads[j].y) {
        died.add(i); died.add(j);
        causes[i] = causes[j] = "crash";
      }
    }
  }

  alive.forEach((p, i) => {
    if (died.has(i)) return;
    const h = heads[i];
    if (!wrapMode && (h.x < 0 || h.x >= GW || h.y < 0 || h.y >= GH)) { died.add(i); causes[i] = "wall"; }
    else if (occ.has(h.x + "," + h.y)) { died.add(i); causes[i] = "body"; }
  });

  // reveal pass: a moving snake whose bulged tail segment leaves the eaten
  // square uncovers the hidden pile — that's when it "appears", so plop now.
  alive.forEach((p, i) => {
    if (died.has(i) || eats[i] >= 0) return;
    const tail = p.cells[p.cells.length - 1];
    if (tail.bulge) revealPoop(tail.x, tail.y);
  });

  // stepping onto a revealed pile is lethal
  alive.forEach((p, i) => {
    if (died.has(i)) return;
    const h = heads[i];
    if (poopAt(h.x, h.y)) { died.add(i); causes[i] = "poop"; }
  });

  // attract mode: the menu demo snake never ends the game — if anything would
  // kill it (engine cornered, legacy walker trapped), the demo just restarts.
  if (state === "menu" && died.size) { initMenu(); return; }

  // apply movement for survivors
  const boomKills = [];
  const crossKills = [];
  alive.forEach((p, i) => {
    if (died.has(i)) return;
    p.cells.unshift(heads[i]);
    if (eats[i] >= 0 || pines[i] >= 0 || bans[i] >= 0) {
      p.cells[0].bulge = true;   // segment created at the fruit's cell
      if (bans[i] >= 0) {
        // banana cross-fire: blast the whole row and column of the bite.
        bananas.splice(bans[i], 1);
        crossBurst(heads[i].x, heads[i].y);
        bananaSound();
        crossFlash.push({ x: heads[i].x, y: heads[i].y, t: performance.now() });
        poops = poops.filter(po => po.x !== heads[i].x && po.y !== heads[i].y);
        foods = foods.filter(f => f.x !== heads[i].x && f.y !== heads[i].y);
        pineapples = pineapples.filter(p => p.x !== heads[i].x && p.y !== heads[i].y);
        while (foods.length < cfg().apples) spawnFood();
        alive.forEach((q, j) => {                       // eater spared; heads only
          if (j !== i && !died.has(j) && q.alive &&
              (q.cells[0].x === heads[i].x || q.cells[0].y === heads[i].y)) crossKills.push(q);
        });
      } else if (pines[i] >= 0) {
        // pineapple bomb: wipe poops + apples within radius, flash the zone,
        // shockwave-kill an opponent's head; pineapple bites grow/score like
        // apples but leave no poop (the bomb IS the cleanup).
        pineapples.splice(pines[i], 1);
        boomBurst(heads[i].x, heads[i].y);
        boomSound();
        explosions.push({ x: heads[i].x, y: heads[i].y, t: performance.now() });
        const R = GAME_CONFIG.pineapple.radius;
        poops = poops.filter(po => tileDist(po, heads[i]) > R);   // hidden piles too, silently
        foods = foods.filter(f => tileDist(f, heads[i]) > R);
        pineapples = pineapples.filter(p => tileDist(p, heads[i]) > R);
        bananas = bananas.filter(b => tileDist(b, heads[i]) > R); // banana is a fruit too
        while (foods.length < cfg().apples) spawnFood();          // refill blasted apples
        alive.forEach((q, j) => {                                // eater spared, only heads die
          if (j !== i && !died.has(j) && q.alive && tileDist(q.cells[0], heads[i]) <= R) boomKills.push(q);
        });
      } else {
        eatBurst(heads[i].x, heads[i].y);
        eatSound();
        foods.splice(eats[i], 1);
        spawnFood();
        // special fruits: one roll per apple bite — pineapple first, banana
        // only if pineapple is capped or missed; each has its own cap of 1
        if (pineapples.length < GAME_CONFIG.pineapple.maxOnScreen &&
            Math.random() < GAME_CONFIG.pineapple.chance) spawnPineapple();
        else if (bananas.length < GAME_CONFIG.banana.maxOnScreen &&
            Math.random() < GAME_CONFIG.banana.chance) spawnBanana();
        // egg pipeline (solo only): this bite counts toward hatching a waiting
        // egg, then the egg roll runs — specials keep priority, one per bite
        if (mode === 1 && window.EggBaby) {
          EggBaby.registerBite();
          EggBaby.rollEgg();
        }
      }
      if (track === "chill" && chill) {
        if (!musicMuted) chill.eat();                          // in-key pentatonic blip
        chill.setIntensity(Math.min(totalBites() / 30, 1));    // drums/arp/filter open up
      }
      if (poopMode && state === "playing" && eats[i] >= 0) {
        // hidden under the bulged segment; revealed when it reaches the tail
        poops.push({ x: heads[i].x, y: heads[i].y, visible: false });
      }
      p.score++;
      // grow `cfg().grow` segments per apple: the new head segment counts as
      // one; extra copies stack at the tail and stretch the bulge run.
      const tail = p.cells[p.cells.length - 1];
      for (let g = 1; g < cfg().grow; g++) p.cells.push({ x: tail.x, y: tail.y });
      // milestone level-ups (shared speed, ramped by TOTAL bites)
      const lv = levelForBites(totalBites());
      if (lv > level) {
        level = lv;
        levelAt = performance.now();
        tickMs = speedFor(level);
        levelSound();
      }
      updateHud();
    } else {
      p.cells.pop();
    }
  });

  // egg contact: survivors glide over an unhatched egg and squash it silently
  // (eggs are never lethal, never food — just squishable terrain)
  if (mode === 1 && window.EggBaby) {
    alive.forEach((p, i) => { if (!died.has(i)) EggBaby.contactEgg(heads[i].x, heads[i].y); });
  }

  // deaths
  died.forEach(i => killSnake(alive[i], causes[i]));
  boomKills.forEach(q => { if (q.alive) killSnake(q, "boom"); });    // pineapple blast deaths
  crossKills.forEach(q => { if (q.alive) killSnake(q, "banana"); }); // banana cross deaths
  // baby capture (solo): any snake↔baby overlap removes the baby and opens
  // the mini-game handoff — until M4, a placeholder banner + ding fires
  if (mode === 1 && window.EggBaby) EggBaby.babyCaptureCheck();
  if (players.every(p => !p.alive)) gameOver();
}

function totalBites() { return players.reduce((s, p) => s + p.score, 0); }

function killSnake(p, cause = "crash") {
  p.alive = false;
  p.cause = cause;
  eliminations.push({ idx: players.indexOf(p), t: tickCount });
  // snake explodes before its bulge reaches the tail: uncovered piles appear
  // (silently — the death particle burst is the audio cue here)
  for (const po of poops) {
    if (!po.visible && p.cells.some(c => c.x === po.x && c.y === po.y)) po.visible = true;
  }
  for (const c of p.cells) {
    for (let k = 0; k < 2; k++) {
      particles.push({
        x: c.x * CELL + (Math.random() * CELL | 0),
        y: c.y * CELL + (Math.random() * CELL | 0),
        vx: (Math.random() - 0.5) * 140,
        vy: (Math.random() - 0.5) * 140,
        life: 0.5 + Math.random() * 0.5,
        max: 1,
        s: 2,
        color: Math.random() < 0.75 ? p.pal.body[k % 2] : PAL.white,
      });
    }
  }
}

// juicy burst at the apple's square when a snake bites it
function noiseBuffer() {
  if (!noiseBuf) {
    noiseBuf = audioCtx.createBuffer(1, audioCtx.sampleRate, audioCtx.sampleRate);
    const ch = noiseBuf.getChannelData(0);
    for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}

// Wider, faster spark burst for the pineapple bomb.
function boomBurst(x, y) {
  const sparks = [PINE.P, PINE.L, FOOD.R, FOOD.H, PAL.shine, PAL.white];
  const cx = x * CELL + CELL / 2, cy = y * CELL + CELL / 2;
  for (let k = 0; k < 24; k++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 90 + Math.random() * 160;
    particles.push({
      x: cx + (Math.random() - 0.5) * 6,
      y: cy + (Math.random() - 0.5) * 6,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      life: 0.4 + Math.random() * 0.5,
      max: 0.95,
      s: 1 + (Math.random() * 4 | 0),
      color: sparks[Math.random() * sparks.length | 0],
    });
  }
}

// sparks along the banana's row and column, like tracer shots
function crossBurst(x, y) {
  const sparks = ["#ffd93b", "#fff08a", FOOD.R, PAL.shine];
  for (let k = 0; k < GW; k++) {
    particles.push({
      x: k * CELL + CELL / 2 + (Math.random() - 0.5) * 3,
      y: y * CELL + CELL / 2 + (Math.random() - 0.5) * 3,
      vx: (Math.random() - 0.5) * 60,
      vy: (Math.random() - 0.5) * 160,
      life: 0.35 + Math.random() * 0.4,
      max: 0.75,
      s: 1 + (Math.random() * 3 | 0),
      color: sparks[Math.random() * sparks.length | 0],
    });
  }
  for (let k = 0; k < GH; k++) {
    particles.push({
      x: x * CELL + CELL / 2 + (Math.random() - 0.5) * 3,
      y: k * CELL + CELL / 2 + (Math.random() - 0.5) * 3,
      vx: (Math.random() - 0.5) * 160,
      vy: (Math.random() - 0.5) * 60,
      life: 0.35 + Math.random() * 0.4,
      max: 0.75,
      s: 1 + (Math.random() * 3 | 0),
      color: sparks[Math.random() * sparks.length | 0],
    });
  }
}

// double zap whoosh + deep boom tail + noise sweep (master bus, ignores music mute)
function bananaSound() {
  if (!audioCtx || sfxMuted || demoQuiet()) return;
  const t = audioCtx.currentTime;
  for (let k = 0; k < 2; k++) {
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = "square";
    o.frequency.setValueAtTime(1600 - k * 500, t + k * 0.07);
    o.frequency.exponentialRampToValueAtTime(300, t + k * 0.07 + 0.16);
    g.gain.setValueAtTime(0.06, t + k * 0.07);
    g.gain.exponentialRampToValueAtTime(0.001, t + k * 0.07 + 0.18);
    o.connect(g);
    g.connect(audioCtx.destination);
    o.start(t + k * 0.07);
    o.stop(t + k * 0.07 + 0.2);
  }
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.type = "sawtooth";
  o.frequency.setValueAtTime(200, t + 0.1);
  o.frequency.exponentialRampToValueAtTime(50, t + 0.4);
  g.gain.setValueAtTime(0.12, t + 0.1);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
  o.connect(g);
  g.connect(audioCtx.destination);
  o.start(t + 0.1);
  o.stop(t + 0.46);
  const src = audioCtx.createBufferSource();
  src.buffer = noiseBuffer();
  const f = audioCtx.createBiquadFilter();
  f.type = "bandpass";
  f.frequency.setValueAtTime(2500, t + 0.05);
  f.frequency.exponentialRampToValueAtTime(400, t + 0.35);
  const ng = audioCtx.createGain();
  ng.gain.setValueAtTime(0.12, t + 0.05);
  ng.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
  src.connect(f);
  f.connect(ng);
  ng.connect(audioCtx.destination);
  src.start(t + 0.05, Math.random() * 0.5, 0.35);
}

function eatBurst(x, y) {
  const juice = [FOOD.R, FOOD.R, FOOD.H, FOOD.W, PAL.white];
  const cx = x * CELL + CELL / 2, cy = y * CELL + CELL / 2;
  for (let k = 0; k < 9; k++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 50 + Math.random() * 110;
    particles.push({
      x: cx + (Math.random() - 0.5) * 4,
      y: cy + (Math.random() - 0.5) * 4,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp - 40,        // slight upward bias
      life: 0.3 + Math.random() * 0.35,
      max: 0.65,
      s: 1 + (Math.random() * 3 | 0),   // mixed 1–3px juice chunks
      color: juice[Math.random() * juice.length | 0],
    });
  }
}

function gameOver() {
  state = "over";
  setMusicVolume(0.34, 0.5);                // music sinks under the results
  if (track === "chill" && chill) chill.gameOver();           // descending sweep + muffle
  const top = Math.max(...eliminations.map(e => e.t));
  const finalists = eliminations.filter(e => e.t === top);
  let msg;
  let note = "";
  const causeText = c => ({
    wall: "hit the wall",
    body: "crashed into a snake",
    poop: "ran into a pile-up",
    crash: "head-on-head collision",
    boom: "blasted by a pineapple",
    banana: "caught in a banana blast",
  }[c] || "crashed");
  if (players.length === 1) {
    msg = `<div class="ov-score">SCORE&nbsp;<span class="g">${players[0].score}</span> — LENGTH&nbsp;<span class="g">${players[0].cells.length}</span></div>`;
    if (players[0].cause === "poop") note = `ran into its own pile-up`;
    else if (players[0].cause === "boom") note = `blasted by a pineapple`;
    else if (players[0].cause === "banana") note = `caught in a banana blast`;
  } else {
    let winnerIdx = null;
    if (finalists.length === 1) {
      winnerIdx = finalists[0].idx;
      msg = `<div class="ov-score"><span class="${winnerIdx === 0 ? "g" : "o"}">PLAYER ${winnerIdx + 1} WINS!</span></div>`;
    } else {
      const a = players[finalists[0].idx].score, b = players[finalists[1].idx].score;
      if (a === b) {
        msg = `<div class="ov-score">DRAW!</div>`;
      } else {
        winnerIdx = a > b ? finalists[0].idx : finalists[1].idx;
        msg = `<div class="ov-score"><span class="${winnerIdx === 0 ? "g" : "o"}">PLAYER ${winnerIdx + 1} WINS ON SCORE!</span></div>`;
      }
    }
    msg += `<div class="ov-score"><span class="g">P1 ${players[0].score}</span> &nbsp; <span class="o">P2 ${players[1].score}</span></div>`;
    const loserIdx = winnerIdx !== null ? 1 - winnerIdx : null;
    const special = ["poop", "boom", "banana"];
    if (loserIdx !== null && special.includes(players[loserIdx].cause)) {
      note = `P${loserIdx + 1} ${causeText(players[loserIdx].cause)}`;
    } else if (winnerIdx === null) {
      const sp = players.find(p => special.includes(p.cause));
      if (sp) note = causeText(sp.cause);
    }
  }
  if (totalBites() > best) {
    best = totalBites();
    localStorage.setItem("snake_best", best);
  }
  el.best.textContent = best;
  showOverlay(`
    <div class="ov-inner">
      <div class="ov-title">GAME OVER</div>
      ${msg}
      ${note ? `<div class="ov-note">${note}</div>` : ""}
      <div class="ov-lines"><div data-key="Enter"><span class="key">↵</span>REMATCH &nbsp; <span class="key" data-key="Escape">Esc</span>MENU</div></div>
    </div>`);
}

/* ---------------------------- drawing ---------------------------- */

function drawCell(x, y, color, w = CELL, h = CELL) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

function drawBoard() {
  for (let y = 0; y < GH; y++) {
    for (let x = 0; x < GW; x++) {
      ctx.fillStyle = (x + y) % 2 === 0 ? PAL.bg1 : PAL.bg2;
      ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
    }
  }
}

function drawFood(f, t) {
  const blink = ((t / 280) | 0) % 2;
  // 6x7 sprite centered inside the 8x8 cell, leaving a 1px margin so it
  // clearly reads as occupying exactly one grid square (the hit cell).
  const px = f.x * CELL + 1, py = f.y * CELL + 1;
  FOOD_SPRITE.forEach((row, ry) => {
    for (let rx = 0; rx < row.length; rx++) {
      let ch = row[rx];
      if (ch === ".") continue;
      if (ch === "W" && blink) ch = "H";
      drawCell(px + rx, py + ry, FOOD[ch], 1, 1);
    }
  });
}

// pineapple: gold body with diamond texture, 6x8 crown sprite, sparkle blink
// banana: diagonal, spans the full 8x8 cell corner-to-corner
function drawBanana(f, t) {
  const blink = ((t / 320) | 0) % 2;
  const px = f.x * CELL, py = f.y * CELL;
  for (let i = 0; i < BANANA.length; i++) {
    let c = BANANA[i];
    if (!c) continue;
    if (blink && c === "#fff08a") c = "#fffbe0";   // shimmer on the highlight pixels
    drawCell(px + (i % 8), py + (i >> 3), c, 1, 1);
  }
}

function drawPineapple(f, t) {
  const blink = ((t / 320) | 0) % 2;
  const px = f.x * CELL + 1, py = f.y * CELL;      // 8 rows tall, 1px x inset
  PINEAPPLE_SPRITE.forEach((row, ry) => {
    for (let rx = 0; rx < row.length; rx++) {
      let ch = row[rx];
      if (ch === ".") continue;
      if (ch === "L" && blink) ch = "W";
      drawCell(px + rx, py + ry, PINE[ch], 1, 1);
    }
  });
}

function drawPoops() {
  poops.filter(po => po.visible).forEach(po => {
    const px = po.x * CELL + 1, py = po.y * CELL + 1;
    POOP_SPRITE.forEach((row, ry) => {
      for (let rx = 0; rx < row.length; rx++) {
        const ch = row[rx];
        if (ch === ".") continue;
        drawCell(px + rx, py + ry, POOP_COLORS[ch], 1, 1);
      }
    });
  });
}

function drawEyes(px, py, dir) {
  const w = PAL.white, k = PAL.ink;
  const eyes = dir === "r" ? [[5, 1], [5, 5]]
             : dir === "l" ? [[1, 1], [1, 5]]
             : dir === "u" ? [[1, 1], [5, 1]]
             : [[1, 5], [5, 5]];
  const pupils = eyes.map(([ex, ey]) => [ex + 1, ey + 1]);
  eyes.forEach(([ex, ey]) => drawCell(px + ex, py + ey, w, 2, 2));
  pupils.forEach(([ex, ey]) => drawCell(px + ex, py + ey, k, 1, 1));
}

function drawSnake(p) {
  const pal = p.pal;
  const n = p.cells.length;
  p.cells.forEach((c, i) => {
    // Bulge: a segment created by eating swells slightly and tapers as its
    // index moves toward the tail; it disappears when it reaches the tail.
    const bulge = c.bulge ? Math.max(0, 1 - i / Math.max(1, n - 1)) : 0;
    const grow = Math.round(2 * bulge);
    const off = Math.round(grow / 2);
    const px = c.x * CELL - off, py = c.y * CELL - off;
    const s = CELL + grow;
    drawCell(px, py, pal.body[i % 2], s, s);
    ctx.fillStyle = pal.light;
    ctx.fillRect(px, py, s, 1);
    ctx.fillRect(px, py, 1, s);
    ctx.fillStyle = pal.dark;
    ctx.fillRect(px, py + s - 1, s, 1);
    ctx.fillRect(px + s - 1, py, 1, s);
    if (i === 0) {
      drawCell(px, py, pal.body[0], s, s);   // clean head base
      drawEyes(c.x * CELL, c.y * CELL, p.dir); // eyes stay aligned to the grid
    }
  });
}

function drawParticles(dt) {
  particles = particles.filter(pt => pt.life > 0);
  for (const pt of particles) {
    if (state !== "paused") {
      pt.life -= dt;
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
    }
    if (pt.life <= 0) continue;
    ctx.globalAlpha = Math.max(0, pt.life / pt.max);
    drawCell(pt.x | 0, pt.y | 0, pt.color, pt.s || 2, pt.s || 2);
    ctx.globalAlpha = 1;
  }
}

/* ---------------------------- overlays / HUD ---------------------------- */

function showOverlay(html) {
  el.overlay.innerHTML = html;
  el.overlay.classList.add("show");
}
function hideOverlay() { el.overlay.classList.remove("show"); }

function updateHud() {
  el.p1.textContent = players[0] ? players[0].score : "–";
  el.p2.textContent = mode === 2 && players[1] ? players[1].score : "–";
  el.p2wrap.style.visibility = mode === 2 ? "visible" : "hidden";
  el.best.textContent = best;
}

/* ---------------------------- input ---------------------------- */

const DIR_OF = {
  KeyW: "u", KeyS: "d", KeyA: "l", KeyD: "r",
  ArrowUp: "u", ArrowDown: "d", ArrowLeft: "l", ArrowRight: "r",
};

// Keyboard input — extracted as a named function so touch.js can route taps
// through the SAME logic (handleKeyDown({code})) instead of duplicating it.
function handleKeyDown(e) {
  const code = e.code;
  ensureAudio();   // unlock audio on first keypress (browser gesture rule)

  const repaint = () => {
    if (state === "menu") initMenu();
    else if (state === "options") initOptions();
  };

  // mode + mute toggles work in any state; repaint whatever screen is showing
  if (code === "Digit3" || code === "KeyM") {
    poopMode = !poopMode;
    localStorage.setItem("snake_poop", poopMode ? "1" : "0");
    repaint();
    return;
  }
  if (code === "Digit4" || code === "KeyN") {
    wrapMode = !wrapMode;
    localStorage.setItem("snake_wrap", wrapMode ? "1" : "0");
    repaint();
    return;
  }

  if (code === "KeyZ" || code === "KeyX") {
    if (code === "KeyZ") {
      musicMuted = !musicMuted;
      localStorage.setItem("snake_music_muted", musicMuted ? "1" : "0");
    } else {
      sfxMuted = !sfxMuted;
      localStorage.setItem("snake_sfx_muted", sfxMuted ? "1" : "0");
    }
    setMusicVolume(musicVol, 0.1);   // recomputes mute-aware target (Z-mute + minigame clamp)
    if (jaunty && state === "minigame") jaunty.setVolume(musicMuted ? 0 : 0.5);
    repaint();
    return;
  }
  if (code === "KeyT") {
    track = track === "chill" ? "retro" : "chill";
    localStorage.setItem("snake_track", track);
    applyTrack();
    setMusicVolume(musicVol, 0.2);
    repaint();
    return;
  }
  // D1 debug toggle: demo snake brain — SnakeAI engine vs legacy random walker.
  if (code === "KeyQ") {
    demoEngine = !demoEngine;
    demoTag = demoEngine ? "AI: ENGINE" : "AI: RANDOM";
    return;
  }

  // M3 debug entry: E launches the mini-game from the title or mid-play.
  // (M4 replaces this with the egg-capture handoff + countdown.)
  if (code === "KeyE" && window.MiniGame && (state === "menu" || state === "playing")) {
    enterMiniGame();
    return;
  }
  if (state === "minigame") {          // MiniGame owns the keyboard (Z/X/T above still work)
    if (countdown && (code === "Escape" || code === "Space" || code === "KeyP")) finishCountdown();
    return;
  }

  if (state === "menu") {
    if (code === "KeyO") { initOptions(); return; }
    if (code === "Digit1" || code === "Enter" || code === "Space") startGame(1);
    else if (code === "Digit2") startGame(2);
    return;
  }

  if (state === "options") {
    if (code === "Escape" || code === "Enter" || code === "Space" || code === "KeyO") initMenu();
    return;
  }

  if (code === "ArrowUp" || code === "ArrowDown" || code === "ArrowLeft" || code === "ArrowRight" || code === "Space") {
    e.preventDefault();
  }

  if (state === "over") {
    if (code === "Enter" || code === "Space") startGame(mode);
    else if (code === "Escape") initMenu();
    return;
  }

  if (state === "playing" && (code === "KeyP" || code === "Escape")) {
    if (code === "KeyP") {
      state = "paused";
      setMusicVolume(0.22, 0.25);           // music ducks under the pause overlay
      showOverlay(`<div class="ov-inner"><div class="ov-title">PAUSED</div>
        <div class="ov-lines"><div data-key="KeyP"><span class="key">P</span>RESUME</div></div></div>`);
    } else {
      initMenu();
    }
    return;
  }
  if (state === "paused") {
    if (code === "KeyP" || code === "Escape" || code === "Enter") {
      state = "playing";
      setMusicVolume(0.55, 0.25);
      hideOverlay();
    }
    return;
  }

  const dir = DIR_OF[code];
  if (!dir) return;

  if (mode === 1) {
    steerPlayer(0, dir);                    // WASD and arrows both control P1
  } else {
    if (code.startsWith("Key")) steerPlayer(0, dir);
    if (code.startsWith("Arrow")) steerPlayer(1, dir);
  }
}
window.addEventListener("keydown", handleKeyDown);

// Shared steering for keyboard AND touch pads (touch.js): queue a turn for
// player i with the no-reversal guard. The guard compares against the LAST
// QUEUED direction (not p.dir) so rapid chains like u→l→d still work, while
// a 180° reversal never enters the queue — it would drive the head into the
// neck on the next tick.
function steerPlayer(i, dir) {
  const p = players[i];
  if (!p || !p.alive) return;
  const last = p.queue.length ? p.queue[p.queue.length - 1] : p.dir;
  if (dir !== last && dir !== REV[last]) p.queue.push(dir);
}

// "LV n SPEED UP" banner over the board, fading out over ~1 second.
function drawLevelBanner() {
  if (level === 0) return;
  const now = performance.now();
  if (now - levelAt > 1000) return;
  const k = (now - levelAt) / 1000;
  const txt = `LV ${level}${level <= SPEED_DELTAS.length ? " SPEED UP" : ""}`;
  ctx.globalAlpha = Math.max(0, 1 - k * k);
  ctx.textAlign = "center";
  ctx.font = "7px 'Press Start 2P', monospace";
  ctx.fillStyle = "#141024";                 // pixel drop-shadow
  ctx.fillText(txt, canvas.width / 2 + 1, canvas.height / 2 + 1);
  ctx.fillStyle = "#ffe66d";
  ctx.fillText(txt, canvas.width / 2, canvas.height / 2);
  ctx.globalAlpha = 1;
  ctx.textAlign = "left";
}

// Banana cross flash: entire row + column pulse red, center cell white,
// fading out in ~0.9s.
function drawCrossFlash() {
  const now = performance.now();
  crossFlash = crossFlash.filter(c => now - c.t < 900);
  crossFlash.forEach(c => {
    const k = (now - c.t) / 900;
    const pulse = 0.55 + 0.45 * Math.sin(k * Math.PI * 6);
    ctx.globalAlpha = (1 - k) * 0.28 * pulse;
    ctx.fillStyle = FOOD.R;
    ctx.fillRect(0, c.y * CELL, canvas.width, CELL);
    ctx.fillRect(c.x * CELL, 0, CELL, canvas.height);
    ctx.globalAlpha = (1 - k) * 0.85;
    ctx.fillStyle = PAL.shine;
    ctx.fillRect(c.x * CELL, c.y * CELL, CELL, CELL);
    ctx.globalAlpha = 1;
  });
}

// Blast zone: pulsing red disc + expanding shockwave ring, fading in ~0.9s.
function drawExplosions() {
  const now = performance.now();
  explosions = explosions.filter(e => now - e.t < 900);
  const R = GAME_CONFIG.pineapple.radius * CELL;
  explosions.forEach(e => {
    const k = (now - e.t) / 900;
    const cx = (e.x + 0.5) * CELL, cy = (e.y + 0.5) * CELL;
    const pulse = 0.55 + 0.45 * Math.sin(k * Math.PI * 6);
    ctx.globalAlpha = (1 - k) * 0.3 * pulse;
    ctx.fillStyle = FOOD.R;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = (1 - k) * 0.85;
    ctx.strokeStyle = PAL.shine;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, R * (0.25 + 0.75 * k), 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  });
}

/* ---------------------------- main loop ---------------------------- */

function loop(t) {
  const dt = Math.min(0.1, (t - prev) / 1000);
  prev = t;

  // Mini-game takeover (M3/M4): main game fully frozen — no acc, no tick, no
  // draw, no HUD updates; MiniGame runs its own loop. When MiniGame finishes,
  // onDone starts the resume countdown: the frozen board stays on screen with
  // "3, 2, 1, GO!" banners + beeps, then finishCountdown() flips the state back.
  // We must still reschedule ourselves, or the rAF chain dies and the board
  // stays blank after the mini-game ends.
  if (state === "minigame") {
    requestAnimationFrame(loop);
    if (countdown) {
      countdown.t += dt;
      const step = Math.min(3, Math.floor(countdown.t));   // 1s per digit, GO for the last 0.35s
      if (step !== countdown.step) { countdown.step = step; countdownBeep(step); }
      drawMainScene(0, t);                                 // frozen scene (particles/baby don't advance)
      drawCountdownBanner(step);
      if (countdown.t >= 3.35) finishCountdown();
    }
    return;
  }

  if (state === "playing" || state === "menu" || state === "options") {
    acc += dt * 1000;
    while (acc >= tickMs) {
      acc -= tickMs;
      tick();
    }
    // M4 capture handoff: egg-baby flagged a baby capture — jump into the
    // mini-game immediately (same frame, before anything is drawn).
    if (window.EggBaby && EggBaby.takeHandoff()) {
      captureHandoff();
      requestAnimationFrame(loop);
      return;
    }
  }

  drawMainScene(dt, t);

  requestAnimationFrame(loop);
}

// Full main-board draw. Countdown calls it with dt = 0 for a frozen scene.
function drawMainScene(dt, t) {
  drawBoard();
  drawPoops();
  if (window.EggBaby) EggBaby.drawEggs(t);          // terrain under snakes
  foods.forEach(f => drawFood(f, t));
  pineapples.forEach(f => drawPineapple(f, t));
  bananas.forEach(f => drawBanana(f, t));
  drawExplosions();
  drawCrossFlash();
  players.forEach(p => { if (p.alive) drawSnake(p); });
  if (window.EggBaby) EggBaby.drawBaby(t);
  drawParticles(dt);
  if (state === "playing" || state === "paused") drawLevelBanner();
  if (state === "menu") {                        // attract-mode debug tag (top-left, lean overlay untouched)
    ctx.fillStyle = "#7ce8c6";
    ctx.font = "8px 'Press Start 2P', monospace";
    ctx.fillText(demoTag, 4, 10);
  }
  if (window.EggBaby) EggBaby.updateBaby(dt, tickMs);   // baby runs its own slower clock
}

initMenu();
ensureAudio();          // create contexts now; playback unlocks on the first gesture
window.addEventListener("pointerdown", ensureAudio);
requestAnimationFrame(loop);
