// chiptune-music.js
// Procedural, endlessly-varying lo-fi chiptune ambience using only the Web Audio API.
// No audio files needed. Key: A minor. Progression: Am9 - Fmaj7 - Cmaj7 - G6.
//
// Usage:
//   import { ChillMusic } from './chiptune-music.js';
//   const music = new ChillMusic({ bpm: 72 });
//   button.addEventListener('click', () => music.start());   // must be a user gesture
//   music.eat();  music.setIntensity(0.6);  music.gameOver();  music.toggleMute();

const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

const CHORDS = [
  { root: 45, tones: [57, 60, 64, 67, 71] }, // Am9
  { root: 41, tones: [53, 57, 60, 64, 69] }, // Fmaj7
  { root: 48, tones: [52, 55, 59, 64, 67] }, // Cmaj7
  { root: 43, tones: [50, 55, 59, 62, 64] }, // G6
];
const PENTATONIC = [69, 72, 74, 76, 79, 81, 84]; // A minor pentatonic
const ARP_PATTERN = [0, 1, 2, 3, 2, 1, 4, 3];

class ChillMusic {
  constructor({ bpm = 72, volume = 0.5, swing = 0.12, drums = true } = {}) {
    this.bpm = bpm;
    this.volume = volume;
    this.swing = swing;
    this.drums = drums;
    this.intensity = 0.2;
    this.ctx = null;
    this.playing = false;
    this.muted = false;
    this.step = 0;
    this.nextTime = 0;
    this.lastMelody = -1;
    try { this.muted = localStorage.getItem('snake-muted') === '1'; } catch (e) {}
  }

  // ---------- public API ----------

  async start() {
    if (!this.ctx) this._init();
    await this.ctx.resume();
    if (this.playing) return;
    this.playing = true;
    this.nextTime = this.ctx.currentTime + 0.1;
    this._applyVolume(2.0);
    this._applyIntensity(0.1);
    this.timer = setInterval(() => this._tick(), 30);
  }

  stop(fade = 1.0) {
    if (!this.playing) return;
    this.playing = false;
    clearInterval(this.timer);
    this.master.gain.cancelScheduledValues(this.ctx.currentTime);
    this.master.gain.setTargetAtTime(0, this.ctx.currentTime, fade / 3);
  }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.ctx && this.playing) this._applyVolume(0.1);
  }

  toggleMute() {
    this.muted = !this.muted;
    try { localStorage.setItem('snake-muted', this.muted ? '1' : '0'); } catch (e) {}
    if (this.ctx) this._applyVolume(0.1);
    return this.muted;
  }

  // 0..1. Opens the filter, adds drums and a busier arpeggio. Tie it to score or speed.
  setIntensity(x) {
    this.intensity = Math.max(0, Math.min(1, x));
    if (this.ctx) this._applyIntensity(0.6);
  }

  // Short pentatonic blip so it always sounds in key with the music.
  eat() {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime + 0.01;
    const a = PENTATONIC[Math.floor(Math.random() * 4) + 2];
    this._tone({ freq: midi(a), t, dur: 0.09, wave: this.pulse25, peak: 0.16, attack: 0.002, dest: this.master });
    this._tone({ freq: midi(a + 12), t: t + 0.07, dur: 0.14, wave: this.pulse25, peak: 0.14, attack: 0.002, dest: this.master });
  }

  // Descending sweep + muffles the music. Call setIntensity() again on restart to reopen it.
  gameOver() {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.setPeriodicWave(this.pulse50);
    o.frequency.setValueAtTime(440, t);
    o.frequency.exponentialRampToValueAtTime(70, t + 0.6);
    g.gain.setValueAtTime(0.18, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.65);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + 0.7);
    this.filter.frequency.setTargetAtTime(500, t, 0.15);
  }

  // ---------- setup ----------

  _init() {
    const ctx = (this.ctx = new (window.AudioContext || window.webkitAudioContext)());

    this.master = ctx.createGain();
    this.master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.Q.value = 0.7;
    const crush = ctx.createWaveShaper(); // light bit-crush for grit
    crush.curve = this._crushCurve(48);
    this.bus = ctx.createGain();

    this.bus.connect(crush);
    crush.connect(this.filter);
    this.filter.connect(this.master);
    this.master.connect(comp);
    comp.connect(ctx.destination);

    // Dotted-eighth echo, darkened on each repeat
    this.delay = ctx.createDelay(2);
    this.delay.delayTime.value = (60 / this.bpm) * 0.75;
    const fb = ctx.createGain();
    fb.gain.value = 0.38;
    const dampen = ctx.createBiquadFilter();
    dampen.type = 'lowpass';
    dampen.frequency.value = 1800;
    this.delay.connect(dampen);
    dampen.connect(fb);
    fb.connect(this.delay);
    dampen.connect(this.bus);

    // Slow "tape wobble" pitch drift, applied to every tone
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.35;
    this.wobble = ctx.createGain();
    this.wobble.gain.value = 7; // cents
    lfo.connect(this.wobble);
    lfo.start();

    // Noise buffer for drums
    this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

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
    this.filter.frequency.setTargetAtTime(1800 + this.intensity * 2800, this.ctx.currentTime, timeConst);
  }

  _crushCurve(levels) {
    const n = 4096, c = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
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
    const stepDur = 60 / this.bpm / 2; // eighth notes
    while (this.nextTime < this.ctx.currentTime + 0.15) {
      const swingOffset = this.step % 2 ? this.swing * stepDur : 0;
      this._playStep(this.step, this.nextTime + swingOffset, stepDur);
      this.nextTime += stepDur;
      this.step++;
    }
  }

  _playStep(i, t, stepDur) {
    const chord = CHORDS[Math.floor(i / 16) % CHORDS.length];
    const cs = i % 16; // step within chord (2 bars)
    const bs = i % 8; // step within bar
    const intensity = this.intensity;

    // Pad: soft detuned triangles, new chord every 2 bars
    if (cs === 0) {
      const len = stepDur * 16 + 0.6;
      chord.tones.slice(0, 4).forEach((n) => {
        [-6, 6].forEach((det) =>
          this._tone({ freq: midi(n), t, dur: len, type: 'triangle', peak: 0.045, attack: 0.9, release: 1.4, detune: det })
        );
      });
    }

    // Bass
    const bass = { 0: [0, 3], 6: [7, 2], 8: [0, 3], 12: [12, 2] }[cs];
    if (bass && (cs !== 12 || Math.random() < 0.5)) {
      this._tone({ freq: midi(chord.root + bass[0]), t, dur: stepDur * bass[1], type: 'triangle', peak: 0.3, attack: 0.01, release: stepDur });
    }

    // Arpeggio (pulse 25%), busier with intensity
    if (Math.random() < 0.3 + 0.45 * intensity) {
      const n = chord.tones[ARP_PATTERN[i % 8] % chord.tones.length];
      this._tone({ freq: midi(n), t, dur: 0.4, wave: this.pulse25, peak: 0.055, attack: 0.005, send: 0.5 });
    }

    // Sparse melody (pulse 50%)
    if ([0, 6, 10].includes(cs) && Math.random() < 0.4) {
      let idx;
      do { idx = Math.floor(Math.random() * PENTATONIC.length); } while (idx === this.lastMelody);
      this.lastMelody = idx;
      this._tone({ freq: midi(PENTATONIC[idx]), t, dur: stepDur * 3, wave: this.pulse50, peak: 0.06, attack: 0.02, release: stepDur * 2, send: 0.6 });
    }

    // Drums: soft boom-bap, fades in with intensity
    if (this.drums) {
      const lvl = 0.4 + 0.6 * intensity;
      if (bs === 0 || bs === 5) this._kick(t, lvl);
      if (bs === 2 || bs === 6) this._noise({ t, dur: 0.13, peak: 0.1 * lvl, type: 'highpass', freq: 1500 });
      if (bs % 2 === 1) this._noise({ t, dur: 0.04, peak: 0.05 * lvl, type: 'bandpass', freq: 3500 });
    }
  }

  // ---------- voices ----------

  _tone({ freq, t, dur, type = 'triangle', wave = null, peak = 0.2, attack = 0.01, release = null, send = 0, detune = 0, dest = null }) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    if (wave) o.setPeriodicWave(wave); else o.type = type;
    o.frequency.value = freq;
    o.detune.value = detune;
    this.wobble.connect(o.detune);

    release = release ?? Math.max(0.01, dur - attack);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.setValueAtTime(peak, t + Math.max(attack, dur - release));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    o.connect(g);
    g.connect(dest || this.bus);
    if (send) {
      const s = ctx.createGain();
      s.gain.value = send;
      g.connect(s);
      s.connect(this.delay);
    }
    o.start(t);
    o.stop(t + dur + 0.05);
    o.onended = () => {
      try { this.wobble.disconnect(o.detune); } catch (e) {}
      g.disconnect();
    };
  }

  _kick(t, level) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    g.gain.setValueAtTime(0.45 * level, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    o.connect(g); g.connect(this.bus);
    o.start(t); o.stop(t + 0.25);
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

// Classic-script loading (works from plain file:// pages, where browsers block
// module imports). game.js reads window.ChillMusic. If you prefer ES modules,
// change this back to `export class ChillMusic` and import it instead.
window.ChillMusic = ChillMusic;
