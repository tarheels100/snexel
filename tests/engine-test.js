// Sandbox test for chiptune-music.js as a CLASSIC script: verifies it exposes
// window.ChillMusic and that start/_tick/_playStep/eat/gameOver/stop/mute all
// run without errors against a fake AudioContext.
const fs = require("fs");

const timers = [];
const log = [];
const store = {};
const noop = () => {};

class FakeOsc {
  constructor() {
    this.frequency = {
      _v: 0,
      get value() { return this._v; },
      set value(v) { this._v = v; log.push(`freq ${Math.round(v)}`); },
      setValueAtTime: (f) => log.push(`freq ${Math.round(f)}`),
      exponentialRampToValueAtTime: (f) => log.push(`ramp ${Math.round(f)}`),
      setTargetAtTime: () => {},
    };
    this.detune = { value: 0 };
  }
  set type(v) { log.push(`start ${v}`); }
  setPeriodicWave() { log.push("start wave"); }
  connect() {}
  start() {}
  stop() {}
}
class FakeGain {
  constructor() {
    this.gain = {
      value: 1,
      setValueAtTime: (v) => log.push(`gain ${v}`),
      setTargetAtTime: (v) => log.push(`target ${v}`),
      cancelScheduledValues: noop,
      linearRampToValueAtTime: (v) => log.push(`to ${v}`),
      exponentialRampToValueAtTime: noop,
    };
  }
  connect() {}
  disconnect() {}
}
class FakeAC {
  constructor() { this.currentTime = 0.2; this.state = "running"; this.sampleRate = 44100; }
  resume() { return Promise.resolve(); }
  createOscillator() { return new FakeOsc(); }
  createGain() { return new FakeGain(); }
  createBufferSource() { return { buffer: null, connect() {}, start: () => log.push("noise start"), stop() {} }; }
  createBiquadFilter() {
    return { type: "", Q: { value: 1 }, frequency: { value: 0, setValueAtTime: noop, setTargetAtTime: (v) => log.push(`filter ${Math.round(v)}`) }, connect() {} };
  }
  createDelay() { return { delayTime: { value: 0 }, connect() {} }; }
  createWaveShaper() { return { curve: null, connect() {} }; }
  createDynamicsCompressor() { return { connect() {} }; }
  createPeriodicWave() { return {}; }
  createBuffer() { return { getChannelData: () => new Float32Array(44100) }; }
  get destination() { return {}; }
}

const sandbox = {
  window: { AudioContext: FakeAC },
  document: { addEventListener: noop },
  localStorage: { getItem: k => store[k] ?? "0", setItem: (k, v) => { store[k] = String(v); } },
  setInterval: (fn) => { timers.push(fn); return timers.length; },
  clearInterval: noop,
  Math, Float32Array, console, log, store, timers, AudioContext: FakeAC,
};

const src = fs.readFileSync(__dirname + "/../src/chiptune-music.js", "utf8") + `
(async () => {
  console.log("classic load:", typeof window.ChillMusic === "function");

  const m = new window.ChillMusic({ bpm: 72, volume: 0.5 });
  await m.start();
  console.log("started:", m.playing, "| master ramp-up:", log.some(l => l === "target 0.5"), "| scheduler:", timers.length > 0);

  // drive ~14 seconds (~34 eighth-note steps)
  log.length = 0;
  for (let k = 0; k < 40; k++) { m.ctx.currentTime += 0.35; timers[0](); }

  console.log("pad chord tone (Am9: C4 tone 262Hz):", log.includes("freq 262"));
  console.log("bass (Am9 root A2=110Hz):", log.includes("freq 110"));
  console.log("kick: sine + pitch sweep:", log.includes("start sine") && log.includes("ramp 42"));
  console.log("pulse-wave arp/melody:", log.includes("start wave"));
  console.log("noise hats:", log.includes("noise start"));
  const peaks = log.filter(l => l.startsWith("to ")).map(l => Number(l.slice(3)));
  console.log("tone peaks max:", Math.max(...peaks), "| <=0.3:", Math.max(...peaks) <= 0.3);
  log.length = 0;
  m.setIntensity(0.2);
  console.log("filter opened at intensity:", log.includes("filter 2360"));   // 1800 + 0.2*2800

  log.length = 0;
  m.eat();
  const pent = [587, 659, 784, 880];   // A minor pentatonic midi 74/76/79/81
  console.log("eat blip in key:", log.some(l => pent.includes(Number(l.slice(5)))), "| pulse wave:", log.includes("start wave"));

  log.length = 0;
  m.setIntensity(1);
  console.log("intensity 1 filter:", log.includes("filter 4600"));

  log.length = 0;
  m.gameOver();
  console.log("gameOver sweep:", log.includes("freq 440") && log.includes("ramp 70"), "| muffle:", log.includes("filter 500"));

  log.length = 0;
  m.stop(1);
  console.log("stop fades master:", log.includes("target 0"), "| playing:", m.playing);

  log.length = 0;
  console.log("toggleMute ->", m.toggleMute(), "| master:", log.includes("target 0"), "| ls=" + store["snake-muted"]);
  log.length = 0;
  console.log("toggleMute ->", m.toggleMute(), "| master:", log.includes("target 0.5"), "| ls=" + store["snake-muted"]);
})();
`;

require("vm").runInNewContext(src, sandbox);
