// jaunty-music.js
// Upbeat, bouncy, deliberately tinny chiptune for the minigame. Web Audio only, no audio files.
// Key: C major. 16-bar loop at 144 BPM (A section: bars 1-8, B section: bars 9-16).
// Polka-style "oom-pah": square-wave bass on the beats, pulse-wave chord stabs on the off-beats,
// a thin 12.5% / 25% pulse lead, light swing and a snare fill before the loop point.
//
// Classic script (IIFE, no module export): exposes window.JauntyMusic.
// Same interface as ChillMusic, so the two engines are interchangeable:
//   const mini = new JauntyMusic({ ctx: audioCtx });
//   mini.start();  mini.eat();  mini.win();  mini.setIntensity(0.8);  mini.gameOver();  mini.stop();
//
// To switch tracks, fade one out and start the other:
//   chill.stop(1.0);  mini.start();

(function () {

const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
const NOTE_INDEX = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const n = (name) => {
  const m = /^([A-G])(#|b)?(\d)$/.exec(name);
  return 12 * (Number(m[3]) + 1) + NOTE_INDEX[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
};

// ---------- composition (all in 16th-note steps, 16 steps per bar) ----------

const CHORDS = {
  C:  { stab: [64, 67, 72], bass: [48, 55], arp: [60, 64, 67, 72] },
  Am: { stab: [64, 69, 72], bass: [45, 52], arp: [57, 60, 64, 69] },
  F:  { stab: [65, 69, 72], bass: [53, 48], arp: [53, 57, 60, 65] },
  G:  { stab: [62, 67, 71], bass: [55, 50], arp: [55, 59, 62, 67] },
  Dm: { stab: [62, 65, 69], bass: [50, 45], arp: [50, 53, 57, 62] },
  Em: { stab: [64, 67, 71], bass: [52, 47], arp: [52, 55, 59, 64] },
  G7: { stab: [62, 65, 71], bass: [55, 50], arp: [55, 59, 62, 65] },
};

const PROGRESSION = ['C', 'Am', 'F', 'G', 'C', 'Am', 'Dm', 'G', 'F', 'G', 'Em', 'Am', 'Dm', 'G', 'C', 'G7'];

// Lead melody: [startStep, note, lengthInSteps]
const LEAD_RAW = [
  /* 1  C  */ [[0, 'E5', 2], [2, 'G5', 2], [4, 'C6', 4], [8, 'B5', 2], [10, 'G5', 2], [12, 'E5', 4]],
  /* 2  Am */ [[0, 'C6', 2], [2, 'A5', 2], [4, 'E5', 4], [8, 'A5', 2], [10, 'C6', 2], [12, 'B5', 2], [14, 'A5', 2]],
  /* 3  F  */ [[0, 'F5', 2], [2, 'A5', 2], [4, 'C6', 4], [8, 'A5', 2], [10, 'F5', 2], [12, 'A5', 4]],
  /* 4  G  */ [[0, 'G5', 2], [2, 'B5', 2], [4, 'D6', 4], [8, 'C6', 2], [10, 'B5', 2], [12, 'G5', 2], [14, 'F5', 2]],
  /* 5  C  */ [[0, 'E5', 2], [2, 'G5', 2], [4, 'C6', 4], [8, 'E6', 2], [10, 'D6', 2], [12, 'C6', 4]],
  /* 6  Am */ [[0, 'C6', 2], [2, 'B5', 2], [4, 'A5', 4], [8, 'E5', 2], [10, 'A5', 2], [12, 'C6', 4]],
  /* 7  Dm */ [[0, 'D6', 2], [2, 'C6', 2], [4, 'A5', 2], [6, 'F5', 2], [8, 'A5', 2], [10, 'D6', 2], [12, 'C6', 4]],
  /* 8  G  */ [[0, 'B5', 4], [4, 'G5', 2], [6, 'B5', 2], [8, 'D6', 4], [12, 'B5', 2], [14, 'G5', 2]],
  /* 9  F  */ [[0, 'A5', 2], [2, 'A5', 2], [4, 'C6', 2], [6, 'A5', 2], [8, 'F6', 4], [12, 'E6', 2], [14, 'C6', 2]],
  /* 10 G  */ [[0, 'B5', 2], [2, 'B5', 2], [4, 'D6', 2], [6, 'B5', 2], [8, 'G6', 4], [12, 'F6', 2], [14, 'D6', 2]],
  /* 11 Em */ [[0, 'G5', 2], [2, 'B5', 2], [4, 'E6', 4], [8, 'D6', 2], [10, 'B5', 2], [12, 'G5', 4]],
  /* 12 Am */ [[0, 'A5', 2], [2, 'C6', 2], [4, 'E6', 4], [8, 'D6', 2], [10, 'C6', 2], [12, 'A5', 4]],
  /* 13 Dm */ [[0, 'F5', 2], [2, 'A5', 2], [4, 'D6', 4], [8, 'C6', 2], [10, 'A5', 2], [12, 'F5', 4]],
  /* 14 G  */ [[0, 'G5', 2], [2, 'B5', 2], [4, 'D6', 4], [8, 'F6', 2], [10, 'D6', 2], [12, 'B5', 2], [14, 'G5', 2]],
  /* 15 C  */ [[0, 'E6', 2], [2, 'D6', 2], [4, 'C6', 4], [8, 'G5', 2], [10, 'E5', 2], [12, 'G5', 4]],
  /* 16 G7 */ [[0, 'B5', 2], [2, 'D6', 2], [4, 'F6', 2], [6, 'D6', 2], [8, 'B5', 4], [12, 'G5', 2], [14, 'B5', 2]],
];
// Index by bar, then by start step
const LEAD = LEAD_RAW.map((bar) => {
  const byStep = {};
  bar.forEach(([step, name, len]) => { byStep[step] = [n(name), len]; });
  return byStep;
});

const ARP_PATTERN = [0, 1, 2, 3, 2, 1, 3, 2];

class JauntyMusic {
  constructor({ bpm = 144, volume = 0.5, swing = 0.1, ctx = null } = {}) {
    this.bpm = bpm;
    this.volume = volume;
    this.swing = swing; // 0 = straight, ~0.15 = bouncy
    this.intensity = 0;
    this.ctx = ctx; // optionally share an existing AudioContext (e.g. chill.ctx)
    this.playing = false;
    this.muted = false;
    this.step = 0;
    this.nextTime = 0;
    try { this.muted = localStorage.getItem('snake-muted') === '1'; } catch (e) {}
  }

  // ---------- public API (same as ChillMusic) ----------

  async start() {
    if (!this.master) this._init();
    await this.ctx.resume();
    if (this.playing) return;
    this.playing = true;
    this.step = 0;
    this.nextTime = this.ctx.currentTime + 0.08;
    this._applyVolume(0.15);
    this._applyIntensity(0.05);
    this.timer = setInterval(() => this._tick(), 25);
  }

  stop(fade = 0.5) {
    if (!this.playing) return;
    this.playing = false;
    clearInterval(this.timer);
    this.master.gain.cancelScheduledValues(this.ctx.currentTime);
    this.master.gain.setTargetAtTime(0, this.ctx.currentTime, Math.max(0.02, fade / 3));
  }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.master && this.playing) this._applyVolume(0.1);
  }

  toggleMute() {
    this.muted = !this.muted;
    try { localStorage.setItem('snake-muted', this.muted ? '1' : '0'); } catch (e) {}
    if (this.master) this._applyVolume(0.1);
    return this.muted;
  }

  // 0..1. Speeds the track up by as much as 15% and adds a 16th-note arpeggio layer from 0.5 up.
  // Also reopens the filter after gameOver().
  setIntensity(x) {
    this.intensity = Math.max(0, Math.min(1, x));
    if (this.master) this._applyIntensity(0.3);
  }

  // Classic two-note coin blip, in key
  eat() {
    if (!this.master || this.muted) return;
    const t = this.ctx.currentTime + 0.01;
    this._tone({ freq: midi(n('B5')), t, dur: 0.07, wave: this.pulse50, peak: 0.14, attack: 0.002, sustain: 0.8, dest: this.out });
    this._tone({ freq: midi(n('E6')), t: t + 0.07, dur: 0.2, wave: this.pulse50, peak: 0.14, attack: 0.002, sustain: 0.5, dest: this.out });
  }

  // Short victory arpeggio
  win() {
    if (!this.master || this.muted) return;
    const t = this.ctx.currentTime + 0.01;
    ['C6', 'E6', 'G6', 'C7'].forEach((name, i) => {
      this._tone({ freq: midi(n(name)), t: t + i * 0.075, dur: i === 3 ? 0.4 : 0.09, wave: this.pulse25, peak: 0.13, attack: 0.002, sustain: 0.6, dest: this.out });
    });
  }

  // Falling "womp" and muffles the music. Call setIntensity() on restart to reopen it.
  gameOver() {
    if (!this.master || this.muted) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.setPeriodicWave(this.pulse50);
    o.frequency.setValueAtTime(587, t);
    o.frequency.exponentialRampToValueAtTime(110, t + 0.55);
    g.gain.setValueAtTime(0.16, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    o.connect(g); g.connect(this.out);
    o.start(t); o.stop(t + 0.65);
    this.lowpass.frequency.setTargetAtTime(500, t, 0.12);
  }

  // ---------- setup ----------

  _init() {
    const ctx = this.ctx || (this.ctx = new (window.AudioContext || window.webkitAudioContext)());

    this.master = ctx.createGain();
    this.master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();

    // Tinny chain: bit-crush -> high-pass (no low end) -> presence boost -> low-pass (for gameOver)
    const crush = ctx.createWaveShaper();
    crush.curve = this._crushCurve(48);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 380;
    hp.Q.value = 0.5;
    const presence = ctx.createBiquadFilter();
    presence.type = 'peaking';
    presence.frequency.value = 3200;
    presence.Q.value = 0.9;
    presence.gain.value = 4;
    this.lowpass = ctx.createBiquadFilter();
    this.lowpass.type = 'lowpass';
    this.lowpass.frequency.value = 14000;
    this.lowpass.Q.value = 0;

    this.bus = ctx.createGain();
    this.bus.connect(crush);
    crush.connect(hp);
    hp.connect(presence);
    presence.connect(this.lowpass);
    this.lowpass.connect(this.master);
    this.master.connect(comp);
    comp.connect(ctx.destination);

    // SFX go straight to the master (clean, not through the tinny chain)
    this.out = this.master;

    // Short slap-back echo for the lead
    this.delay = ctx.createDelay(1);
    this.delay.delayTime.value = (60 / this.bpm / 4) * 2;
    const fb = ctx.createGain();
    fb.gain.value = 0.25;
    this.delay.connect(fb);
    fb.connect(this.delay);
    this.delay.connect(this.bus);

    // Noise buffer for drums
    this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    this.pulse125 = this._pulse(0.125);
    this.pulse25 = this._pulse(0.25);
    this.pulse50 = this._pulse(0.5);

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) ctx.suspend();
      else if (this.playing) ctx.resume();
    });
  }

  _applyVolume(timeConst) {
    const target = this.muted ? 0 : this.volume;
    this.master.gain.cancelScheduledValues(this.ctx.currentTime);
    this.master.gain.setTargetAtTime(target, this.ctx.currentTime, timeConst / 3);
  }

  _applyIntensity(timeConst) {
    const now = this.ctx.currentTime;
    this.lowpass.frequency.setTargetAtTime(14000, now, timeConst);
    this.delay.delayTime.setTargetAtTime(this._stepDur() * 2, now, timeConst);
  }

  _stepDur() {
    return 60 / (this.bpm * (1 + 0.15 * this.intensity)) / 4; // one 16th note
  }

  _crushCurve(levels) {
    const len = 4096, c = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      const x = (i / (len - 1)) * 2 - 1;
      c[i] = Math.round(x * levels) / levels;
    }
    return c;
  }

  _pulse(duty, harmonics = 24) {
    const real = new Float32Array(harmonics + 1);
    const imag = new Float32Array(harmonics + 1);
    for (let k = 1; k <= harmonics; k++) real[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * duty);
    return this.ctx.createPeriodicWave(real, imag);
  }

  // ---------- scheduling ----------

  _tick() {
    while (this.nextTime < this.ctx.currentTime + 0.15) {
      const stepDur = this._stepDur();
      const swingOffset = this.step % 4 === 2 ? this.swing * 2 * stepDur : 0; // delay off-beat 8ths
      this._playStep(this.step, this.nextTime + swingOffset, stepDur);
      this.nextTime += stepDur;
      this.step++;
    }
  }

  _playStep(i, t, stepDur) {
    const bar = Math.floor(i / 16) % 16;
    const s = i % 16;
    const chord = CHORDS[PROGRESSION[bar]];

    // Lead: thin pulse, staccato, with a slap-back echo. Switches to a fuller pulse in the B section.
    const lead = LEAD[bar][s];
    if (lead) {
      this._tone({
        freq: midi(lead[0]), t, dur: lead[1] * stepDur * 0.88,
        wave: bar < 8 ? this.pulse125 : this.pulse25,
        peak: 0.08, attack: 0.003, sustain: 0.6, send: 0.18,
      });
    }

    // Off-beat chord stabs
    if (s % 4 === 2) {
      chord.stab.forEach((note) =>
        this._tone({ freq: midi(note), t, dur: stepDur * 0.7, wave: this.pulse25, peak: 0.03, attack: 0.002, sustain: 0.4 })
      );
    }

    // Oom-pah bass on the beats
    if (s % 4 === 0) {
      this._tone({ freq: midi(chord.bass[(s / 4) % 2]), t, dur: stepDur * 3, wave: this.pulse50, peak: 0.2, attack: 0.002, sustain: 0.5 });
    }

    // 16th-note arpeggio layer once the intensity is up
    if (this.intensity >= 0.5) {
      const note = chord.arp[ARP_PATTERN[s % 8]];
      this._tone({ freq: midi(note), t, dur: stepDur * 0.9, wave: this.pulse25, peak: 0.028, attack: 0.002, sustain: 0.3 });
    }

    // Drums: kick on 1 and 3, snare on 2 and 4, hats on the 8ths, snare roll in the last beat of bar 16
    if (s === 0 || s === 8) this._kick(t);
    if (s === 4 || (s === 12 && bar !== 15)) this._noise({ t, dur: 0.1, peak: 0.12, type: 'highpass', freq: 1800 });
    if (bar === 15 && s >= 12) this._noise({ t, dur: 0.07, peak: 0.08 + 0.02 * (s - 12), type: 'highpass', freq: 1800 });
    if (s % 2 === 0) this._noise({ t, dur: 0.03, peak: s % 4 === 2 ? 0.045 : 0.025, type: 'highpass', freq: 7000 });
  }

  // ---------- voices ----------

  _tone({ freq, t, dur, wave, peak = 0.1, attack = 0.003, sustain = 0.55, send = 0, dest = null }) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.setPeriodicWave(wave);
    o.frequency.value = freq;

    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.linearRampToValueAtTime(peak * sustain, t + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    o.connect(g);
    g.connect(dest || this.bus);
    if (send) {
      const sg = ctx.createGain();
      sg.gain.value = send;
      g.connect(sg);
      sg.connect(this.delay);
    }
    o.start(t);
    o.stop(t + dur + 0.05);
    o.onended = () => g.disconnect();
  }

  _kick(t) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(200, t);
    o.frequency.exponentialRampToValueAtTime(70, t + 0.07);
    g.gain.setValueAtTime(0.22, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
    o.connect(g); g.connect(this.bus);
    o.start(t); o.stop(t + 0.13);
  }

  _noise({ t, dur, peak, type, freq }) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.bus);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }
}

window.JauntyMusic = JauntyMusic;
// bare-identifier alias for vm test sandboxes (browsers: globalThis === window, no-op)
if (typeof globalThis !== "undefined") globalThis.JauntyMusic = JauntyMusic;

})();
