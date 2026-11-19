// Sandbox test for the audio system: retro scheduler + SFX (fake AudioContext)
// and the ChillMusic engine (fake class), including track switching.
const fs = require("fs");

const handlers = {};
const timers = [];
const store = { snake_poop: "0", snake_track: "retro", snake_music_muted: "0", snake_sfx_muted: "0" };
const log = [];

class FakeOsc {
  constructor() {
    this.frequency = {
      value: 0,
      setValueAtTime: (f, t) => log.push(`freq ${Math.round(f)} @${t.toFixed(2)}`),
      exponentialRampToValueAtTime: (f, t) => log.push(`ramp ${Math.round(f)} @${t.toFixed(2)}`),
    };
    this.detune = { value: 0 };
  }
  set type(v) { log.push(`start ${v}`); }
  setPeriodicWave(w) { log.push("start wave"); }
  connect() {}
  start(t) {}
  stop(t) {}
}
class FakeGain {
  constructor() {
    this.gain = {
      value: 1,
      setValueAtTime: (v) => log.push(`gain ${v}`),
      cancelScheduledValues: () => {},
      linearRampToValueAtTime: (v, t) => log.push(`duck ${v}`),
      exponentialRampToValueAtTime: () => {},
    };
  }
  connect() {}
  disconnect() {}
}
class FakeAC {
  constructor() { this.currentTime = 0; this.state = "running"; this.sampleRate = 44100; }
  resume() {}
  createOscillator() { return new FakeOsc(); }
  createGain() { return new FakeGain(); }
  createBufferSource() { return { buffer: null, connect() {}, start: () => log.push("start buffer"), stop() {} }; }
  createBiquadFilter() { return { type: "", frequency: { setValueAtTime: () => {} }, connect() {} }; }
  createBuffer() { return { getChannelData: () => new Float32Array(44100) }; }
  get destination() { return {}; }
}
class FakeChill {
  constructor(opts) { this.volume = opts.volume; this.playing = false; this.muted = false; log.push(`chill ctor bpm=${opts.bpm} vol=${opts.volume}`); }
  async start() { this.playing = true; log.push("chill start"); }
  stop(fade) { this.playing = false; log.push(`chill stop ${fade}`); }
  setVolume(v) { this.volume = v; log.push(`chill vol ${v}`); }
  setIntensity(x) { this.intensity = x; log.push(`chill intensity ${x}`); }
  eat() { log.push("chill eat"); }
  gameOver() { log.push("chill gameOver"); }
}

const noop = () => {};
const window = { addEventListener: (ev, fn) => { handlers[ev] = fn; }, requestAnimationFrame: noop, ChillMusic: FakeChill, AudioContext: FakeAC };
const sandbox = {
  document: {
    getElementById: () => ({
      getContext: () => ({ fillRect: noop, globalAlpha: 1, imageSmoothingEnabled: false, fillStyle: "" }),
      textContent: "", innerHTML: "", style: {}, classList: { add: noop, remove: noop },
    }),
    addEventListener: noop,
  },
  window,
  localStorage: { getItem: k => store[k] ?? "0", setItem: (k, v) => { store[k] = String(v); } },
  requestAnimationFrame: noop,
  handlers, FakeAC, FakeOsc, FakeGain, FakeChill, noop, log, timers, store,
  setInterval: (fn, ms) => { timers.push(fn); return timers.length; },
  clearInterval: () => {},
  Math, AudioContext: FakeAC, console, performance: { now: () => 0 },
};

let src = fs.readFileSync(__dirname + "/../src/game.js", "utf8");

src += `
const key = c => handlers.keydown({ code: c, preventDefault: noop });
const driveRetro = () => { if (musicTimer) timers[musicTimer - 1](); };
const chillLog = () => log.filter(l => l.startsWith("chill")).join(", ");

// retro track (persisted choice) — audio unlocks on first keypress
key("Digit1");
console.log("audio unlocked:", !!audioCtx, "| retro scheduler:", musicTimer !== null, "| chill active:", !!chill);

// ---- retro loop: drive ~16 seconds (4 bars of the 4-bar loop) ----
audioCtx.currentTime = 0; log.length = 0;
for (let k = 0; k < 40; k++) { audioCtx.currentTime += 0.4; driveRetro(); }
// bass roots in Hz: midi 33/29/36/31 -> 55/44/65/49
const bassRoots = [55, 44, 65, 49].map(r => log.some(l => l.startsWith("freq " + r + " ")));
console.log("bass roots per bar:", bassRoots);
console.log("arp square present:", log.some(l => l.startsWith("start square")));
// lead midi 76/72/69/79/74 -> 659/523/440/784/587
console.log("lead notes:", [659, 523, 440, 784, 587].map(m => log.some(l => l.startsWith("freq " + m))));
const hats = log.filter(l => l.startsWith("start buffer")).length;
console.log("hats:", hats, "| >=16:", hats >= 16);
const gains = log.filter(l => l.startsWith("gain")).map(l => Number(l.split(" ")[1]));
console.log("music gains max:", Math.max(...gains), "| <=0.1:", Math.max(...gains) <= 0.1);
console.log("no chill hooks on retro:", chillLog() === "");

// ---- retro eat SFX ----
key("Digit3");   // poop mode on
const mh = players[0].cells[0];
foods[0].x = mh.x + 1; foods[0].y = mh.y;
log.length = 0; tick();
console.log("eat tick layers:", log.filter(l => l.startsWith("start")).join(", "), "| poops:", poops.length);
log.length = 0;
players[0].cells[0].x += 1; tick();
console.log("plain move sounds:", log.length);

// ---- retro ducking ----
log.length = 0; key("KeyP");
console.log("pause duck:", log.filter(l => l.startsWith("duck")).join(", "));
log.length = 0; key("KeyP");
console.log("resume volume:", log.filter(l => l.startsWith("duck")).join(", "));

// ---- switch to chill ----
log.length = 0; key("KeyT");
console.log("switch:", track, "ls=" + store.snake_track, "| retro timer cleared:", musicTimer === null, "|", chillLog());

// eat: chomp SFX still fires, engine gets in-key blip + intensity
const mh2 = players[0].cells[0];
foods[0].x = mh2.x + 1; foods[0].y = mh2.y;
log.length = 0; tick();
console.log("chill eat:", chillLog(), "| sfx layers:", log.filter(l => l.startsWith("start")).length > 0);

// ducks now route to the engine
log.length = 0; key("KeyP"); key("KeyP");
console.log("chill duck/resume:", log.filter(l => l.startsWith("chill vol")).join(", "));

// death: sweep hook + muffled duck; restart reopens intensity
players[0].cells.forEach((c, i) => { c.x = GW - 1 - i; c.y = 3; });
players[0].dir = "r"; players[0].queue = [];
foods.forEach(f => { f.x = 5; f.y = 12; });
log.length = 0; tick();
console.log("chill gameOver:", log.includes("chill gameOver"), "| duck on over:", log.some(l => l.startsWith("chill vol 0.34")));
log.length = 0; key("Enter");
console.log("restart:", log.includes("chill intensity 0.1"), "| vol back:", log.some(l => l.startsWith("chill vol 0.55")));

// ---- mute with chill active ----
log.length = 0; key("KeyZ");
console.log("chill mute:", log.some(l => l.startsWith("chill vol 0")), "ls=" + store.snake_music_muted);
log.length = 0;
const mh3 = players[0].cells[0]; foods[0].x = mh3.x + 1; foods[0].y = mh3.y; tick();
console.log("muted eat: chomp still fires:", log.filter(l => l.startsWith("start")).length > 0, "| engine blip skipped:", !log.some(l => l.startsWith("chill eat")));
log.length = 0; key("KeyZ");
console.log("chill unmute:", log.some(l => l.startsWith("chill vol 0.55")));

// ---- sfx mute + switch back to retro ----
log.length = 0; key("KeyX");
const mh4 = players[0].cells[0]; foods[0].x = mh4.x + 1; foods[0].y = mh4.y; tick();
console.log("sfx muted: sounds:", log.filter(l => l.startsWith("start")).length, "| ate:", players[0].score >= 1);
log.length = 0; key("KeyX"); key("KeyT");   // sfx unmute + track switch back
console.log("switch back:", track, "ls=" + store.snake_track, "| chill stopped:", !chill.playing, "| scheduler:", musicTimer !== null, "|", chillLog());
log.length = 0; audioCtx.currentTime += 2; driveRetro();
console.log("retro notes back:", log.some(l => l.startsWith("freq")));
`;

require("vm").runInNewContext(src, sandbox);
