/* ------------------------------------------------------------------ *
 *  egg-baby.js — solo-mode egg → baby-snake pipeline (milestones M1+M2).
 *
 *  Loaded as a classic script AFTER game.js (shared global scope, same
 *  pattern as chiptune-music.js). All internals stay inside this IIFE and
 *  only the window.EggBaby namespace is exposed, so the combined global
 *  scope of all scripts stays collision-free. game.js calls it through
 *  `window.EggBaby` guards, so the game runs fine even without this file.
 *
 *  Lifecycle (solo mode only):
 *   - each apple bite, after the pineapple/banana rolls, may spawn an egg
 *   - an unhatched egg squashed by the snake's head vanishes silently —
 *     no death, no baby, no bite counted toward hatching
 *   - after GAME_CONFIG.egg.hatchBites further apples, the egg hatches a
 *     3-segment baby: narrower, slower, dodges every item and the snake
 *   - cornered baby freezes (never dies) so it is always catchable
 *   - any overlap with the main snake captures it: green burst + ding +
 *     placeholder banner (the mini-game handoff lands in milestone M4)
 * ------------------------------------------------------------------ */
(() => {
  let eggs = [];           // {x, y} — at most one egg at a time
  let baby = null;         // {cells, dir, acc} while alive
  let bitesSinceEgg = 0;   // apples eaten while the egg waits
  let captureAt = 0;       // ding timestamp (debug/tests)
  let pendingHandoff = false;   // set on capture; game.js consumes via takeHandoff()
  let hatchBanner = 0;          // seconds left of the "Catch me if you can!" flash

  /* ---- sprites & palettes ---- */

  // 6x7 egg centered inside the 8px cell: cream oval, dark outline,
  // highlight that shimmers, a couple of speckles.
  const EGGC = { O: "#6b5a44", W: "#efe6cf", H: "#fff9ec", S: "#c2a87c", B: "#fffdf4" };
  const EGG_SPRITE = [
    "..OO..",
    ".OWWO.",
    "OWHWSO",
    "OWSWWO",
    "OWHWOO",
    "OWWWSO",
    ".OOOO.",
  ];

  // baby snake: brighter greens than PAL.p1, 6px blocks offset +1 in the cell
  const BABY = { body: ["#7ee06a", "#5cc94f"], light: "#b6f79a", dark: "#3f9a38", white: "#ffffff", ink: "#141024" };

  /* ---- egg lifecycle ---- */

  function rollEgg() {
    if (mode !== 1 || state !== "playing") return;
    if (eggs.length || baby) return;                 // one egg/baby at a time
    if (Math.random() >= GAME_CONFIG.egg.chance) return;
    const occ = occupiedSet();                        // already includes eggs+baby via hook
    let x = (Math.random() * GW) | 0, y = (Math.random() * GH) | 0;
    let tries = 0;
    while (occ.has(x + "," + y) && tries++ < 80) {
      x = (Math.random() * GW) | 0; y = (Math.random() * GH) | 0;
    }
    if (occ.has(x + "," + y)) return;                 // packed board: skip
    eggs.push({ x, y });
    bitesSinceEgg = 0;
    eggChirp();
  }

  // called on every APPLE bite (solo): counts toward hatching an waiting egg
  function registerBite() {
    if (mode !== 1 || !eggs.length) return;
    bitesSinceEgg++;
    if (bitesSinceEgg >= GAME_CONFIG.egg.hatchBites) hatch();
  }

  // snake head entered an egg cell: squash it — game just continues
  function contactEgg(x, y) {
    const i = eggs.findIndex(e => e.x === x && e.y === y);
    if (i < 0) return;
    eggs.splice(i, 1);
    bitesSinceEgg = 0;
    eggSquash(x, y);
  }

  function hatch() {
    const e = eggs.shift();
    // pick a body direction whose trailing 2 cells fit inside the board
    let dir = null;
    for (const d of ["r", "l", "d", "u"]) {
      const [dx, dy] = DIRS[d];
      if ([0, 1, 2].every(i => {
        const x = e.x - dx * i, y = e.y - dy * i;
        return x >= 0 && x < GW && y >= 0 && y < GH;
      })) { dir = d; break; }
    }
    if (!dir) dir = "r";
    const [dx, dy] = DIRS[dir];
    const cells = [];
    for (let i = 0; i < GAME_CONFIG.egg.babyLen; i++) {
      cells.push({
        x: Math.min(GW - 1, Math.max(0, e.x - dx * i)),
        y: Math.min(GH - 1, Math.max(0, e.y - dy * i)),
      });
    }
    baby = { cells, dir, acc: 0 };
    bitesSinceEgg = 0;
    hatchBanner = GAME_CONFIG.egg.bannerMs;   // taunt flash, decayed by updateBaby
    hatchBurst(e.x, e.y);
    hatchPop();
  }

  function resetEggBaby() {
    eggs = []; baby = null; bitesSinceEgg = 0; captureAt = 0;
    hatchBanner = 0;
    pendingHandoff = false;
  }

  /* ---- baby movement + AI ---- */

  function updateBaby(dt, tickMs) {
    hatchBanner = Math.max(0, hatchBanner - dt);   // flash decays even if the baby vanishes mid-flash
    if (!baby || state !== "playing" || mode !== 1) return;
    const step = tickMs * GAME_CONFIG.egg.babySpeedMul;   // slower than the main snake
    baby.acc += dt * 1000;
    while (baby.acc >= step) { baby.acc -= step; babyMove(); }
  }

  function babyMove() {
    if (!baby) return;
    const cand = Object.keys(DIRS).filter(d => d !== REV[baby.dir]);
    for (let i = cand.length - 1; i > 0; i--) {          // shuffle for tie-breaks
      const j = (Math.random() * (i + 1)) | 0;
      [cand[i], cand[j]] = [cand[j], cand[i]];
    }
    // everything the baby dodges: snake bodies (head included — it avoids
    // both hitting and being hit), own body, foods, visible poops, fruits.
    const blocked = new Set();
    for (const p of players) if (p.alive) for (const c of p.cells) blocked.add(c.x + "," + c.y);
    baby.cells.forEach(c => blocked.add(c.x + "," + c.y));
    const items = [];
    for (const f of foods) { blocked.add(f.x + "," + f.y); items.push(f); }
    for (const po of poops) if (po.visible) { blocked.add(po.x + "," + po.y); items.push(po); }
    for (const p of pineapples) { blocked.add(p.x + "," + p.y); items.push(p); }
    for (const b of bananas) { blocked.add(b.x + "," + b.y); items.push(b); }
    const tail = baby.cells[baby.cells.length - 1];

    const legal = [];
    for (const d of cand) {
      let nx = baby.cells[0].x + DIRS[d][0], ny = baby.cells[0].y + DIRS[d][1];
      if (wrapMode) { nx = (nx + GW) % GW; ny = (ny + GH) % GH; }
      else if (nx < 0 || nx >= GW || ny < 0 || ny >= GH) continue;
      if (blocked.has(nx + "," + ny) && !(nx === tail.x && ny === tail.y)) continue;
      // run from whatever item is nearest to the candidate cell
      const dist = items.length ? Math.min(...items.map(it => tileDist(it, { x: nx, y: ny }))) : 99;
      legal.push({ d, x: nx, y: ny, dist });
    }
    if (!legal.length) return;                     // cornered → freeze, never dies
    legal.sort((a, b) => b.dist - a.dist);
    const pick = (legal.length > 1 && Math.random() < 0.3) ? legal[1] : legal[0];
    baby.dir = pick.d;
    baby.cells.unshift({ x: pick.x, y: pick.y });
    baby.cells.pop();                              // fixed length — baby never grows
  }

  // any overlap between the main snake and the baby captures it (solo)
  function babyCaptureCheck() {
    if (!baby || mode !== 1 || state !== "playing") return;
    for (const p of players) {
      if (!p.alive) continue;
      for (const c of p.cells) {
        if (baby.cells.some(b => b.x === c.x && b.y === c.y)) {
          captureAt = performance.now();
          pendingHandoff = true;   // M4: game.js jumps into the mini-game next frame
          babyBurst(baby.cells[0].x, baby.cells[0].y);
          baby = null;
          captureDing();
          return;
        }
      }
    }
  }

  // Consume the capture flag exactly once (game.js calls it in loop() after tick).
  function takeHandoff() {
    const h = pendingHandoff;
    pendingHandoff = false;
    return h;
  }

  /* ---- drawing ---- */

  function drawEggs(t) {
    const blink = ((t / 320) | 0) % 2;
    eggs.forEach(e => {
      const px = e.x * CELL + 1, py = e.y * CELL + 1;
      EGG_SPRITE.forEach((row, ry) => {
        for (let rx = 0; rx < row.length; rx++) {
          const ch = row[rx];
          if (ch === ".") continue;
          drawCell(px + rx, py + ry, blink && ch === "H" ? EGGC.B : EGGC[ch], 1, 1);
        }
      });
    });
  }

  function drawBaby(t) {
    if (!baby) return;
    baby.cells.forEach((c, i) => {
      const px = c.x * CELL + 1, py = c.y * CELL + 1;
      const s = GAME_CONFIG.egg.babyWidth;
      drawCell(px, py, BABY.body[i % 2], s, s);
      ctx.fillStyle = BABY.light;
      ctx.fillRect(px, py, s, 1);
      ctx.fillRect(px, py, 1, s);
      ctx.fillStyle = BABY.dark;
      ctx.fillRect(px, py + s - 1, s, 1);
      ctx.fillRect(px + s - 1, py, 1, s);
      if (i === 0) drawBabyEyes(px, py, baby.dir);
    });
    // hatch taunt: "CATCH ME IF YOU CAN!" blinking over the board, fading out
    if (hatchBanner > 0) {
      const dur = GAME_CONFIG.egg.bannerMs;
      ctx.globalAlpha = Math.min(1, hatchBanner / (dur * 0.35)) * (0.8 + 0.2 * Math.sin(performance.now() / 90));
      ctx.fillStyle = BABY.light;
      ctx.font = "12px 'Press Start 2P', monospace";
      ctx.textAlign = "center";
      ctx.fillText("CATCH ME IF YOU CAN!", canvas.width / 2, canvas.height / 2 + 10);
      ctx.textAlign = "left";
      ctx.globalAlpha = 1;
    }
  }

  function drawBabyEyes(px, py, dir) {
    const eyes = dir === "r" ? [[4, 1], [4, 4]]
               : dir === "l" ? [[1, 1], [1, 4]]
               : dir === "u" ? [[1, 1], [4, 1]]
               : [[1, 4], [4, 4]];
    const [dx, dy] = DIRS[dir];
    eyes.forEach(([ex, ey]) => {
      drawCell(px + ex, py + ey, BABY.white, 1, 1);
      drawCell(px + ex + dx, py + ey + dy, BABY.ink, 1, 1);   // pupil nudged toward travel dir
    });
  }

  // M4 replaces this placeholder banner with the real mini-game handoff.
  /* ---- particles ---- */

  function puff(x, y, colors, n, sp, up) {
    const cx = x * CELL + CELL / 2, cy = y * CELL + CELL / 2;
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      const s = sp + Math.random() * sp;
      particles.push({
        x: cx + (Math.random() - 0.5) * 4,
        y: cy + (Math.random() - 0.5) * 4,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s - up,
        life: 0.3 + Math.random() * 0.3,
        max: 0.6,
        s: 1 + (Math.random() * 2 | 0),
        color: colors[Math.random() * colors.length | 0],
      });
    }
  }
  const eggSquash  = (x, y) => puff(x, y, ["#efe6cf", "#c2a87c", "#6b5a44"], 6, 40, 10);
  const hatchBurst = (x, y) => puff(x, y, ["#efe6cf", "#fff9ec", "#ffd93b", "#b6f79a"], 8, 70, 30);
  const babyBurst  = (x, y) => puff(x, y, ["#7ee06a", "#b6f79a", "#fff9ec"], 10, 90, 25);

  /* ---- sounds (all respect sfxMuted; audio globals from game.js) ---- */

  function eggChirp() {
    if (!audioCtx || sfxMuted) return;
    const t = audioCtx.currentTime;
    [[620, 0.0], [860, 0.09]].forEach(([f, at], i) => {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = "triangle";
      o.frequency.setValueAtTime(f, t + at);
      o.frequency.exponentialRampToValueAtTime(f * 1.3, t + at + 0.1);
      g.gain.setValueAtTime(0.0001, t + at);
      g.gain.linearRampToValueAtTime(i === 0 ? 0.06 : 0.08, t + at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + at + 0.12);
      o.connect(g); g.connect(audioCtx.destination);
      o.start(t + at); o.stop(t + at + 0.14);
    });
  }

  // quick rising pop + tiny leaf rustle — quieter than the eat chomp
  function hatchPop() {
    if (!audioCtx || sfxMuted) return;
    const t = audioCtx.currentTime;
    const g1 = audioCtx.createGain();
    g1.connect(audioCtx.destination);
    g1.gain.setValueAtTime(0.10, t);
    g1.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    const o1 = audioCtx.createOscillator();
    o1.type = "triangle";
    o1.frequency.setValueAtTime(220, t);
    o1.frequency.exponentialRampToValueAtTime(540, t + 0.18);   // "breaking out" rise
    o1.connect(g1); o1.start(t); o1.stop(t + 0.2);

    const src = audioCtx.createBufferSource();
    src.buffer = noiseBuffer();
    const f = audioCtx.createBiquadFilter();
    f.type = "bandpass"; f.frequency.setValueAtTime(2400, t + 0.05);
    const ng = audioCtx.createGain();
    ng.gain.setValueAtTime(0.04, t + 0.05);                     // shell rustle, very quiet
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    src.connect(f); f.connect(ng); ng.connect(audioCtx.destination);
    src.start(t + 0.05, Math.random() * 0.4, 0.12);
  }

  // brighter three-note ding than levelSound — announces the capture event
  function captureDing() {
    if (!audioCtx || sfxMuted) return;
    const t = audioCtx.currentTime;
    [880, 1174, 1396].forEach((f, i) => {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = "square";
      o.frequency.setValueAtTime(f, t);
      const at = t + i * 0.05;
      g.gain.setValueAtTime(0.0001, at);
      g.gain.linearRampToValueAtTime(0.12, at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, at + 0.13);
      o.connect(g); g.connect(audioCtx.destination);
      o.start(at); o.stop(at + 0.15);
    });
  }

  /* ---- occupancy hook + debug for tests ---- */

  function addOccupancy(s) {          // game.js occupiedSet(): fruit spawns avoid these
    for (const e of eggs) s.add(e.x + "," + e.y);
    if (baby) for (const c of baby.cells) s.add(c.x + "," + c.y);
  }

  const ns = {
    rollEgg, registerBite, contactEgg, updateBaby, babyCaptureCheck,
    resetEggBaby, drawEggs, drawBaby, addOccupancy, takeHandoff,
    hasBaby: () => !!baby,
    debug: {
      eggs: () => eggs,
      baby: () => baby,
      placeEgg: (x, y) => { eggs = [{ x, y }]; bitesSinceEgg = 0; },
      stepBaby: () => babyMove(),
      captureAt: () => captureAt,
      bites: () => bitesSinceEgg,
      handoff: () => pendingHandoff,
      banner: () => hatchBanner,
    },
  };
  // classic-script namespace, same pattern as window.ChillMusic. Also set on
  // globalThis so bare `EggBaby` identifier lookups resolve in vm test
  // sandboxes (in browsers globalThis === window, so this is a no-op alias).
  window.EggBaby = ns;
  globalThis.EggBaby = ns;
})();
