/* ------------------------------------------------------------------ *
 *  minigame.js — self-contained mini snake round (milestone M3).
 *
 *  Classic script loaded AFTER game.js (shared global scope, same pattern
 *  as egg-baby.js). Everything lives inside one IIFE; only window.MiniGame
 *  (+ a globalThis alias for vm test sandboxes) is exposed.
 *
 *  M3 scope: full-screen takeover debug round (game.js wires the E key).
 *  - Own requestAnimationFrame loop + own keydown listener while active;
 *    game.js freezes entirely (no tick, no draw) during state "minigame".
 *  - Classic rules on a bright 20x16 overlay grid at 6px/cell: apples only,
 *    walls kill, wrap stays OFF regardless of the main wrap setting.
 *  - Phases: count → play → win → fireworks → fade → done. Death (wall/self)
 *    gets a red flash phase, then fade → done. P pauses; Esc quits early —
 *    including during the entry countdown ("3 2 1 GO!" over the mini board,
 *    mirroring game.js's resume countdown; steering is ignored until GO).
 *  - Music engine starts at GO, not at handoff — symmetric with the main
 *    track resuming only after the return countdown finishes.
 *  - MiniGame.music is a no-op stub matching the window.ChillMusic engine
 *    contract (start/stop/setVolume/setIntensity/gameOver/playing); M4 swaps
 *    a real engine in via MiniGame.setMusic().
 * ------------------------------------------------------------------ */
(() => {
  const MINI_KEYS = {
    KeyW: "u", ArrowUp: "u", KeyS: "d", ArrowDown: "d",
    KeyA: "l", ArrowLeft: "l", KeyD: "r", ArrowRight: "r",
  };

  // much brighter palette than the main board (plan §5 presentation)
  const MG = { body: ["#6eff8e", "#3fd06a"], light: "#c8ffb0", dark: "#2a9455", white: "#ffffff", ink: "#141024" };
  const APPLE = { R: "#ff4f8b", r: "#ff2e63", H: "#ffd2e6", G: "#6eff8e", D: "#241026" };
  const APPLE_SPRITE = [".G...", ".RRR.", "RHRRD", "RRRRD", ".RRR."];  // 5x5 inside a 6px cell
  const FX_COLORS = ["#ff4f8b", "#ffd93b", "#6eff8e", "#5ad3ff", "#c9a6ff", "#ff9f43"];

  let g = null;            // mini world while active (null = off)
  let musicEvents = [];    // debug log of music-engine calls
  let music = makeStubMusic();
  let onKeyDown = null;
  let lastReason = null;   // survives finish() so tests can inspect the outcome

  /* ---- music stub: mirrors the ChillMusic contract, M4 swaps real ---- */

  function makeStubMusic() {
    const rec = k => musicEvents.push(k);
    return {
      playing: false,
      start() { this.playing = true; rec("start"); },
      stop() { this.playing = false; rec("stop"); },
      setVolume(v) { rec("vol:" + v); },
      setIntensity(x) { rec("int:" + x.toFixed(2)); },
      gameOver() { rec("gameOver"); },
      eat() { rec("eat"); },
      win() { rec("win"); },
    };
  }
  function setMusic(engine) { music = engine || makeStubMusic(); }

  /* ---- start / handoff ---- */

  function start(opts = {}) {
    if (g) return;
    const cfg = GAME_CONFIG.mini;
    musicEvents = [];
    g = {
      gw: cfg.gw, gh: cfg.gh, cell: cfg.cell, goal: cfg.goal, grow: cfg.grow,
      tickMs: cfg.tickMs,
      ox: (canvas.width - cfg.gw * cfg.cell) / 2,      // centered rect (68, 48)
      oy: (canvas.height - cfg.gh * cfg.cell) / 2,
      snake: [], dir: "r", queue: [], alive: true, score: 0,
      apples: [], bulge: [], acc: 0,
      phase: "count", phaseT: 0, countStep: -1, fade: 0, reason: null,
      fx: [], fxTimer: 0,
      onDone: opts.onDone || (() => {}),
    };
    const cx = (cfg.gw / 2) | 0, cy = (cfg.gh / 2) | 0;
    for (let i = 0; i < cfg.snakeLen; i++) g.snake.push({ x: cx - i, y: cy });
    for (let i = 0; i < cfg.apples; i++) spawnApple();

    onKeyDown = e => handleKey(e);
    window.addEventListener("keydown", onKeyDown);
    // music starts at GO (end of the entry countdown), not at handoff

    let prev = performance.now();
    const step = t => {
      if (!g) return;
      const dt = Math.min(0.1, (t - prev) / 1000);
      prev = t;
      frame(dt);
      if (g) window.requestAnimationFrame(step);
    };
    window.requestAnimationFrame(step);
  }

  function handleKey(e) {
    if (!g) return;
    const code = e.code;
    if (code === "Escape") {
      if (["play", "paused", "win", "fireworks", "count"].includes(g.phase)) goFade(g.reason || "skipped");
      return;
    }
    if (code === "KeyP") {
      if (g.phase === "play") g.phase = "paused";
      else if (g.phase === "paused") g.phase = "play";
      return;
    }
    const d = MINI_KEYS[code];
    if (d && g.phase === "play" && g.queue.length < 3) {
      // same guard as the main game's turn handler: no reversals — a
      // reversed steer would put the head straight into the neck
      const last = g.queue.length ? g.queue[g.queue.length - 1] : g.dir;
      if (d !== last && d !== REV[last]) g.queue.push(d);
    }
  }

  /* ---- mini rules: apples only, walls kill, wrap OFF by design ---- */

  function spawnApple() {
    const occ = new Set();
    for (const c of g.snake) occ.add(c.x + "," + c.y);
    for (const a of g.apples) occ.add(a.x + "," + a.y);
    let x = (Math.random() * g.gw) | 0, y = (Math.random() * g.gh) | 0;
    let tries = 0;
    while (occ.has(x + "," + y) && tries++ < 80) {
      x = (Math.random() * g.gw) | 0; y = (Math.random() * g.gh) | 0;
    }
    if (!occ.has(x + "," + y)) g.apples.push({ x, y });
  }

  function tickMini() {
    if (!g || !g.alive || g.phase !== "play") return;
    if (g.queue.length) {                       // reversal-proof, like main tick()
      const d = g.queue.shift();
      if (d !== REV[g.dir]) g.dir = d;
    }
    const h = g.snake[0];
    const nx = h.x + DIRS[g.dir][0], ny = h.y + DIRS[g.dir][1];
    if (nx < 0 || nx >= g.gw || ny < 0 || ny >= g.gh) return die("wall");
    const eat = g.apples.findIndex(a => a.x === nx && a.y === ny);
    const vacate = eat < 0 ? g.snake[g.snake.length - 1] : null;   // tail slot frees up
    for (const c of g.snake) {
      if (c.x === nx && c.y === ny && !(vacate && c.x === vacate.x && c.y === vacate.y)) return die("body");
    }
    g.snake.unshift({ x: nx, y: ny, bulge: eat >= 0 });
    if (eat >= 0) {
      const gone = g.apples.splice(eat, 1)[0];
      g.bulge.push({ x: gone.x, y: gone.y });
      g.score++;
      miniBurst(nx, ny);
      eatBlip();
      music.setIntensity(Math.min(g.score / g.goal, 1));
      if (music.eat) music.eat();           // engine coin blip (JauntyMusic has one)
      // +1 segment per apple (the new head counts as one of the `grow` cells,
      // same convention as the main game's tick())
      for (let i = 1; i < g.grow; i++) {
        const t = g.snake[g.snake.length - 1];
        g.snake.push({ x: t.x, y: t.y });
      }
      if (g.score >= g.goal) win(); else spawnApple();
    } else {
      g.snake.pop();
    }
  }

  function beginPlay() {
    g.phase = "play";
    g.acc = 0;
    music.start();               // engine kicks in at GO (JauntyMusic in M4)
  }

  function die(reason) {
    g.alive = false;
    g.reason = reason;
    g.phase = "died";
    g.phaseT = 0;
    music.gameOver();
    deathSound();
  }

  function win() {
    g.reason = "won";
    g.phase = "win";
    g.phaseT = 0;
    music.setIntensity(1);
    if (music.win) music.win();             // engine victory arpeggio
    winFanfare();
  }

  function goFade(reason) {
    g.reason = reason;
    g.phase = "fade";
    g.fade = 0;
  }

  function finish() {
    const reason = g.reason, done = g.onDone;
    window.removeEventListener("keydown", onKeyDown);
    onKeyDown = null;
    music.stop();
    g = null;
    lastReason = reason;         // "won" | "wall" | "body" | "skipped"
    done(reason);                // game.js flips state back (M3) / countdown (M4)
  }

  /* ---- per-frame update + full-canvas presentation ---- */

  function frame(dt) {
    if (!g) return;
    const cfg = GAME_CONFIG.mini;
    draw();
    g.fx.forEach(p => { p.x += p.vx * dt; p.y += p.vy * dt + 40 * dt; p.life -= dt; });
    g.fx = g.fx.filter(p => p.life > 0);

    switch (g.phase) {
      case "count":
        g.phaseT += dt;
        const step = Math.min(3, Math.floor(g.phaseT));   // 1s per digit, GO for the last 0.35s
        if (step !== g.countStep) { g.countStep = step; countdownBeep(step); }   // shared beeps from game.js
        if (g.phaseT >= cfg.countMs) beginPlay();
        break;
      case "play":
        g.acc += dt * 1000;
        while (g.acc >= g.tickMs) { g.acc -= g.tickMs; tickMini(); }
        break;
      case "paused":
        break;                                    // frozen world; draw still runs
      case "win":
        g.phaseT += dt;
        if (g.phaseT >= cfg.winMs) { g.phase = "fireworks"; g.phaseT = 0; g.fxTimer = 0; }
        break;
      case "fireworks":
        g.phaseT += dt;
        g.fxTimer -= dt;
        if (g.fxTimer <= 0) { fxBurst(); g.fxTimer = 0.28; }
        if (g.phaseT >= cfg.fxMs) goFade("won");
        break;
      case "died":
        g.phaseT += dt;
        if (g.phaseT >= cfg.diedMs) goFade(g.reason);
        break;
      case "fade":
        g.fade += dt;
        if (g.fade >= cfg.fadeMs) finish();
        break;
    }
  }

  function draw() {
    ctx.fillStyle = "#0d0819";
    ctx.fillRect(0, 0, canvas.width, canvas.height);            // dark vignette ground
    ctx.fillStyle = "#ffd93b";                                  // bright frame ring
    ctx.fillRect(g.ox - 4, g.oy - 4, g.gw * g.cell + 8, g.gh * g.cell + 8);
    ctx.fillStyle = "#1b1231";
    ctx.fillRect(g.ox - 1, g.oy - 1, g.gw * g.cell + 2, g.gh * g.cell + 2);
    for (let y = 0; y < g.gh; y++) {
      for (let x = 0; x < g.gw; x++) {
        ctx.fillStyle = ((x + y) & 1) ? "#2b1c46" : "#332153";  // bright purple checker
        ctx.fillRect(g.ox + x * g.cell, g.oy + y * g.cell, g.cell, g.cell);
      }
    }
    g.apples.forEach(a => drawApple(a));
    const flash = g.phase === "died" && ((g.phaseT * 10 | 0) % 2) ? "#ff5a5a" : null;
    if (g.alive || flash) drawSnake(flash);
    drawParticles();
    hud();
    if (g.phase === "count") drawCountBanner(Math.max(0, g.countStep));
    if (g.phase === "fade") {
      ctx.fillStyle = `rgba(6,3,12,${Math.min(1, g.fade / GAME_CONFIG.mini.fadeMs)})`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  }

  function drawApple(a) {
    const px = g.ox + a.x * g.cell + 0, py = g.oy + a.y * g.cell + 1;
    const blink = ((performance.now() / 320) | 0) % 2;
    APPLE_SPRITE.forEach((row, ry) => {
      for (let rx = 0; rx < row.length; rx++) {
        const ch = row[rx];
        if (ch === ".") continue;
        drawCell(px + rx, py + ry, blink && ch === "H" ? "#ffeef4" : APPLE[ch], 1, 1);
      }
    });
  }

  function drawSnake(flashColor) {
    const n = g.snake.length;
    g.snake.forEach((c, i) => {
      const px = g.ox + c.x * g.cell + 1, py = g.oy + c.y * g.cell + 1;
      const s = 4;                                   // 4px block inside the 6px cell
      const col = flashColor || MG.body[i % 2];
      drawCell(px, py, col, s, s);
      if (!flashColor) {
        ctx.fillStyle = MG.light;
        ctx.fillRect(px, py, s, 1);
        ctx.fillRect(px, py, 1, s);
        ctx.fillStyle = MG.dark;
        ctx.fillRect(px, py + s - 1, s, 1);
        ctx.fillRect(px + s - 1, py, 1, s);
      }
      if (i === 0) {
        // bulge pops when the tail leaves the eaten square (main-game rule)
        if (c.bulge && g.bulge.length) {
          const tail = g.snake[n - 1];
          if (tail.x !== g.bulge[0].x || tail.y !== g.bulge[0].y) { c.bulge = false; g.bulge.shift(); }
        }
        if (c.bulge) drawCell(px, py, col, 5, 5);    // bulge fills the 6px cell
        if (!flashColor) drawEyes(px, py, g.dir);
      }
    });
  }

  function drawEyes(px, py, dir) {
    const eyes = dir === "r" ? [[2, 1], [2, 3]]
               : dir === "l" ? [[1, 1], [1, 3]]
               : dir === "u" ? [[1, 1], [3, 1]]
               : [[1, 3], [3, 3]];
    const [dx, dy] = DIRS[dir];
    eyes.forEach(([ex, ey]) => {
      drawCell(px + ex, py + ey, MG.white, 1, 1);
      drawCell(px + ex + dx, py + ey + dy, MG.ink, 1, 1);
    });
  }

  function hud() {
    ctx.textAlign = "center";
    ctx.font = "7px 'Press Start 2P', monospace";
    if (g.phase === "win" || g.phase === "fireworks") {
      ctx.fillStyle = "#ffd93b";
      ctx.fillText("YOU WIN!", canvas.width / 2, g.oy - 10);
    } else if (g.phase === "died") {
      ctx.fillStyle = "#ff5a5a";
      ctx.fillText("MINI-GAME OVER", canvas.width / 2, g.oy - 10);
    } else {
      ctx.fillStyle = "#ffe9a8";
      ctx.fillText(`SCORE ${g.score}/${g.goal}`, canvas.width / 2, g.oy - 10);
    }
    ctx.font = "6px 'Press Start 2P', monospace";
    ctx.fillStyle = "#b9a6d8";
    ctx.fillText("P PAUSE   ESC QUIT", canvas.width / 2, g.oy + g.gh * g.cell + 14);
    ctx.textAlign = "left";
  }

  // entry countdown digit over the mini board — same look as game.js's
  // resume banner: yellow digits pulsing, cyan "GO!" at the end
  function drawCountBanner(step) {
    const label = step >= 3 ? "GO!" : String(3 - step);
    ctx.globalAlpha = step >= 3 ? 1 : 0.8 + 0.2 * Math.sin((g.phaseT % 1) * Math.PI);
    ctx.fillStyle = step >= 3 ? "#7cf2ff" : "#ffd36e";
    ctx.font = "24px 'Press Start 2P', monospace";
    ctx.textAlign = "center";
    ctx.fillText(label, canvas.width / 2, canvas.height / 2 + 10);
    ctx.textAlign = "left";
    ctx.globalAlpha = 1;
  }

  /* ---- particles ---- */

  function burst(cx, cy, colors, n, sp, life) {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      const s = sp + Math.random() * sp;
      g.fx.push({
        x: cx + (Math.random() - 0.5) * 3, y: cy + (Math.random() - 0.5) * 3,
        vx: Math.cos(a) * s, vy: Math.sin(a) * s - 20,
        life: life + Math.random() * life * 0.5, max: life * 1.5,
        s: 1 + (Math.random() * 2 | 0),
        color: colors[Math.random() * colors.length | 0],
      });
    }
  }
  const miniBurst = (x, y) => burst(g.ox + x * g.cell + 3, g.oy + y * g.cell + 3, ["#ff4f8b", "#ffd2e6", "#6eff8e"], 6, 45, 0.35);
  const fxBurst = () => {
    burst(g.ox + Math.random() * g.gw * g.cell, g.oy + Math.random() * g.gh * g.cell, FX_COLORS, 12, 70, 0.5);
    popSound();
  };

  function drawParticles() {
    g.fx.forEach(p => {
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x, p.y, p.s, p.s);
    });
    ctx.globalAlpha = 1;
  }

  /* ---- sounds (audio globals come from game.js) ---- */

  function tone(type, f0, f1, gain, dur, at = 0) {
    const o = audioCtx.createOscillator();
    const g2 = audioCtx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, audioCtx.currentTime + at);
    o.frequency.exponentialRampToValueAtTime(f1, audioCtx.currentTime + at + dur);
    g2.gain.setValueAtTime(0.0001, audioCtx.currentTime + at);
    g2.gain.linearRampToValueAtTime(gain, audioCtx.currentTime + at + 0.02);
    g2.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + at + dur);
    o.connect(g2); g2.connect(audioCtx.destination);
    o.start(audioCtx.currentTime + at); o.stop(audioCtx.currentTime + at + dur + 0.02);
  }

  function eatBlip() {
    if (!audioCtx || sfxMuted) return;
    tone("square", 880, 1320, 0.09, 0.12);          // bright pinky bite, lighter than main chomp
  }

  function winFanfare() {
    if (!audioCtx || sfxMuted) return;
    [660, 880, 1100, 1320].forEach((f, i) => tone("square", f, f, 0.11, 0.14, i * 0.07));
  }

  function deathSound() {
    if (!audioCtx || sfxMuted) return;
    tone("sawtooth", 300, 50, 0.12, 0.4);           // mini crash sweep
    const src = audioCtx.createBufferSource();
    src.buffer = noiseBuffer();
    const f = audioCtx.createBiquadFilter();
    f.type = "lowpass"; f.frequency.setValueAtTime(600, audioCtx.currentTime);
    const ng = audioCtx.createGain();
    ng.gain.setValueAtTime(0.05, audioCtx.currentTime);
    ng.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.2);
    src.connect(f); f.connect(ng); ng.connect(audioCtx.destination);
    src.start(audioCtx.currentTime, Math.random() * 0.4, 0.2);
  }

  function popSound() {
    if (!audioCtx || sfxMuted) return;
    const src = audioCtx.createBufferSource();
    src.buffer = noiseBuffer();
    const f = audioCtx.createBiquadFilter();
    f.type = "bandpass"; f.frequency.setValueAtTime(1400 + Math.random() * 800, audioCtx.currentTime);
    const ng = audioCtx.createGain();
    ng.gain.setValueAtTime(0.04, audioCtx.currentTime);             // tiny firework pops
    ng.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.12);
    src.connect(f); f.connect(ng); ng.connect(audioCtx.destination);
    src.start(audioCtx.currentTime, Math.random() * 0.4, 0.12);
  }

  /* ---- namespace + debug for tests ---- */

  const debug = {
    phase: () => g && g.phase,
    reason: () => g && g.reason,
    lastReason: () => lastReason,
    score: () => g && g.score,
    len: () => g && g.snake.length,
    cells: () => g && g.snake,            // live array — tests may restructure it
    dir: () => g && g.dir,
    setDir: d => { if (g && g.phase === "play") g.dir = d; },
    alive: () => g && g.alive,
    apples: () => g && g.apples,
    fx: () => g && g.fx,
    turn: d => { if (g && g.phase === "play") g.queue.push(d); },
    step: () => tickMini(),               // advance one mini tick directly
    skipCountdown: () => { if (g && g.phase === "count") beginPlay(); },   // tests: jump past the entry countdown
    placeApple: (x, y) => {
      if (!g) return;
      if (g.apples.length) { g.apples[0].x = x; g.apples[0].y = y; }
      else g.apples.push({ x, y });
    },
    setScore: n => { if (g) g.score = n; },
    musicEvents: () => musicEvents,
    grid: () => g && { ox: g.ox, oy: g.oy, gw: g.gw, gh: g.gh, cell: g.cell },
  };

  const ns = {
    start, frame,
    isActive: () => !!g,
    setMusic,
    debug,
  };
  Object.defineProperty(ns, "music", { get: () => music });

  // classic-script namespace, same pattern as window.ChillMusic / EggBaby;
  // the globalThis alias makes bare `MiniGame` resolve in vm test sandboxes.
  window.MiniGame = ns;
  globalThis.MiniGame = ns;
})();
