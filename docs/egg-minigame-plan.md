# Plan: Egg → baby snake → mini-game (solo mode only)

Goal: solo-mode-only feature where eating an apple can spawn an egg; after 3
more apples the egg hatches a slow AI baby snake that dodges everything;
touching the baby launches an overlay mini-game (smaller, brighter snake
board, 10 apples to win), then fireworks, a fade, a 3-second countdown, and
the main game resumes.

Design rule: keep the main game file thin. All egg/baby logic lives in
`egg-baby.js`, all mini-game logic lives in `minigame.js`. `game.js` only
adds ~60 lines of integration hooks. Classic scripts share global scope, so
the modules can reuse `CELL/GW/GH/canvas/ctx/drawCell/particles/sound
helpers` defined by game.js — load order matters (see §7).

---

## 1. Config block (add to `GAME_CONFIG`)

```js
egg: {
  chance: 0.03,        // per apple eaten
  hatchBites: 3,       // apples eaten while egg untouched → hatch
  babyLen: 3,
  babySpeedMul: 1.5,   // baby tick = main tickMs × 1.5 (slower)
  babyWidth: 6,        // narrower than main (8)
},
mini: {
  gridW: 20, gridH: 16, cell: 6,   // 120×96px overlay ≈ quarter of the
                                   // 256×192 board area, centered
  snakeLen: 3, grow: 2,            // same growth feel as solo config
  tickMs: 110,
  winApples: 10,
  fireworksMs: 2000,
  countdownMs: 3000,               // 3 ticks of "3,2,1" at 1s each
},
```

All numbers tunable later, same pattern as pineapple/banana blocks.

## 2. Egg lifecycle (`egg-baby.js`)

Globals: `let eggs = []`, `let baby = null`, `let bitesSinceEgg = 0`.

On each apple eaten in solo mode (`game.js` calls `eggRoll()` after the
pineapple/banana rolls — specials keep priority, max one special item per
bite):
- If `eggs.length === 0 && !baby`: roll `GAME_CONFIG.egg.chance`; spawn egg
  at a random free cell (reuse `occupiedSet()` plus eggs/baby cells).
- `bitesSinceEgg = 0`.
- Every subsequent apple eaten: if an egg is still on the board,
  `bitesSinceEgg++`; when it reaches `hatchBites` → remove egg, create
  `baby = { cells: [eggPos ×3 stacked], dir: away from egg side, score-ish,
  bulge-free }`, hatch chirp + tiny burst particles.
- **Egg destroyed on contact (confirmed)**: if the main snake's head enters
  an egg cell before hatching, the egg simply disappears — game continues
  normally, no death, no score/growth/poop/bulge, and the bite does NOT count
  toward the hatch counter. That egg can never hatch; later bites can still
  roll a fresh egg (chance applies per apple bite as usual).
- Reset `eggs`, `baby`, `bitesSinceEgg` in `startGame()` and `initMenu()`
  (same place fruits/poops reset).

Implementation: in `tick()`, after computing the new head, check
`eggAt(nx, ny)` → remove the egg from `eggs` and proceed with normal movement
(egg is not added to the lethal occupancy set, so the snake moves through and
the egg vanishes). Draw eggs as terrain under snakes.

## 3. Baby snake (`egg-baby.js`)

State object `baby = { cells, dir, prevDir?, acc, frozen }`. Own accumulator
inside `egg-baby.js`:

```js
function updateBaby(dt, tickMs) {
  baby.acc += dt * 1000;
  while (baby.acc >= tickMs * GAME_CONFIG.egg.babySpeedMul) {
    baby.acc -= tickMs * GAME_CONFIG.egg.babySpeedMul;
    babyMove();     // one cell step, same unshift/pop model as main snakes
  }
}
```

Movement reuses the same grid rules as main snakes: wrap-aware head when
`wrapMode` ON; when OFF, walls… **default: baby wraps/dies like terrain
awareness allows** — baby AI never walks into a wall when wrap OFF (it will
freeze instead; baby never dies). Body step: `unshift` new head, `pop` tail
(baby never grows; fixed 3 segments, no bulge, no poop ever — baby does not
eat).

Baby AI (`babyMove`, stateless, cheap):
- Candidate dirs: 4 minus reversal of `baby.dir`.
- Legal new-head cells: inside grid (or wrapped), not in main snake body
  (head cell included — baby actively avoids both hitting and being hit by
  the main snake), not own body cells, not any food/poop/pineapple/banana
  cell.
- Among legal moves pick the one maximizing distance to the nearest item
  (food/poop/fruits), with jitter (random among top-2) so it wanders like a
  shy creature rather than mechanically.
- No legal moves → `frozen` (sit still this tick; unfreeze next tick when a
  move opens up). Default: **baby never dies**, always catchable.

Rendering `drawBaby(t)`: reuse the snake block-shading style at
`GAME_CONFIG.egg.babyWidth` (6px blocks, centered in the 8px cell: offset
`+1`), brighter green palette (`BABY = { body:"#7ee06a", light:"#b6f79a",
dark:"#3f9a38" }`), eyes from existing `drawEyes` logic scaled down.

Capture check (called from `game.js` after main snakes move each tick):
- Capture rule (confirmed default): **any overlap** — any main-snake cell
  equals any baby cell → capture. Head touching a baby segment counts; a
  body slot sliding onto a cornered/frozen baby counts, guaranteeing eventual
  catch. Baby AI steering clear of the snake means contact is almost always
  the player's deliberate head-on capture.
- On capture: `baby = null`, `state = "minigame"`, call
  `MiniGame.start()`, duck music (§6), capture ding.

## 4. Mini-game engine (`minigame.js`)

Self-contained `MiniGame` object; phases: `"play" → "win" → "fade" →
"countdown" → done` (game.js flips main state back to `"playing"` when done).

Board: `MGW=GAME_CONFIG.mini.gridW, MGH=gridH, MCELL=cell` — overlay rect
centered on the canvas: origin `((canvas.width - MGW*MCELL)/2, (canvas.height
- MGH*MCELL)/2)` = (68, 48) with 20×16×6. Draw a brighter checkerboard
(`MINI_PAL = { bgA:"#2b2450", bgB:"#3a3168", border:"#ffd36e" }`) plus a
1px bright frame so it reads as a distinct "toy" board; everything inside
uses the brighter palette (snake lime `#a6ef7c`, apple `#ff7ab6`, sparks
`#ffe14e/#7cf2ff`).

Contents per phase:
- **play**: one snake (`snakeLen: 3`, grows `grow: 2` per apple), one apple
  at a time via own free-cell picker; own accumulator with
  `tickMs: 110`; input = WASD/arrows (solo controls, reversal via `REV`).
  Collision: self body + walls lethal (classic snake — mini ignores main
  wrap toggle; default decision point). No poop, no fruits, no levels.
  Eating: reuse `eatSound()` + `eatBurst()` (colors from mini palette).
  Win at `winApples: 10` → phase `"win"`.
- **win**: freeze snake/apple; banner text "MINI-GAME COMPLETE!" (reuse the
  `drawLevelBanner` pixel-font style); fireworks: 6–8 staggered bursts over
  2s spawning into the shared `particles` array via a `fireworkBurst(cx,cy)`
  helper (reuse particle machinery, mini-palette colors, `boomSound()` per
  burst at SFX-mute-respect).
- **fade**: ~0.5s `ctx.globalAlpha` fade of mini board; fireworks continue.
- **countdown**: board gone; main board visible; draw big "3", "2", "1"
  (one per second) via banner style + countdown beeps (short square wave,
  rising pitch, quiet — quieter than eat chomp like poop plop precedent).
  At 0 → `MiniGame.done = true`; game.js resumes.
- **Death during mini play** (default forfeit): death sound, brief red
  flash of the mini board, skip to `"fade" → "countdown"` → resume main with
  no penalty. (Alternative decision point: retry with fresh apple instead.)
- **Esc during mini**: forfeit, same path as death (default).

Music hook (future different mini track):
```js
// minigame.js exposes:
MiniGame.music = null;         // future: window.MiniMusic engine
MiniGame.enterMusic() → if (MiniGame.music) MiniGame.music.start(ac,x) else
                      duck main music like pause (setMusicVolume 0.22)
MiniGame.exitMusic() → stop MiniGame.music, restore main track volume
```
Same engine contract as `window.ChillMusic` (start/stop/eat/intensity), so a
future mini chiptune drops in without touching either file.

## 5. game.js integration (keeps it thin, ~60 lines)

- New states: `"minigame"` and reuse countdown inside `MiniGame` (game.js
  treats `"minigame"` as "MiniGame owns the frame"):
  - `loop(t)`: when `state === "minigame"` → do NOT tick main game; call
    `MiniGame.update(dt)`; draw main board (frozen scene) + foods/poops/
    fruits frozen underneath, then `MiniGame.draw(t)` overlay, particles,
    banners; when `MiniGame.done` → `state = "playing"`, reset `acc = 0`,
    duck music restore via `exitMusic()`.
  - Otherwise normal tick; after tick's movement/collision pass call
    `updateBaby(dt, tickMs)` and `babyCaptureCheck()`.
- Apple-eat hook (existing eat block in `tick()`, solo branch): after the
  pineapple/banana roll section, `if (mode === 1) eggRoll();`
- Apple-eat counter hook: `if (eggs.length) bitesSinceEgg++` → hatch check
  inside `egg-baby.js` (`eggBite()` API).
- Reset hooks in `startGame()` / `initMenu()`: `resetEggBaby()`.
- Pause interplay: `P`/Esc during `"minigame"` → forfeit (default); music
  ducking hooks mirror pause behavior.
- HUD note: while `"minigame"`, main HUD dims (scores frozen — they already
  render in DOM, dim via a CSS class toggled on wrap element).
- `index.html`: add `<script src="src/egg-baby.js?v=n"></script>` and
  `<script src="src/minigame.js?v=n"></script>` AFTER `src/game.js` (game.js
  calls them at runtime only; they reference game.js globals at runtime too).
  Guard calls with `typeof eggRoll === "function"` so the game degrades
  gracefully if modules are missing.

## 6. Sounds (`egg-baby.js` / `minigame.js`, all respect `sfxMuted`)

- Egg spawn: soft two-note chirp (triangle, ~600→800Hz, gain 0.08).
- Hatch: quick rising pop + tiny noise rustle (quieter than eat chomp).
- Capture trigger: bright ding (square 880→1320Hz) + MiniGame start jingle
  (3-note arpeggio) so the overlay arrival is unmistakable.
- Mini eat: reuse `eatSound()` (shared global helper).
- Win: fanfare (reuse `levelSound()` shape, longer) + fireworks booms.
- Countdown beeps: 3 short squares rising pitch; final "go" blip.

## 7. Testing plan (same sandbox style as smoketest)

`minigame-test.js` (vm sandbox with stub canvas/audio):
- egg roll: apple eat with stubbed `Math.random < 0.03` → egg spawns;
  specials-priority: pineapple spawn case suppresses egg roll.
- egg contact: main head enters egg cell → egg removed, snake stays alive,
  no baby ever spawns from it, hatch counter irrelevant; later bites can
  still roll a fresh egg.
- hatch: 3 more apple eats → baby exists, eggs cleared, baby length 3.
- baby AI: baby never enters food/poop/body cells over a 200-tick simulated
  run; cornered baby freezes (no wall/body collision ever).
- capture: main head moved onto baby cell → state "minigame", baby gone,
  MiniGame.started.
- mini game: eat 10 stubbed apples → phase win → fireworks spawned →
  fade → countdown ticks 3/2/1 → done → main state resumes "playing".
- mini death: wall hit → forfeit path → resume main, scores unchanged.
- music: duck called on enter, restore on exit (stub spy functions).

Existing suites stay green: egg logic is solo-gated and additive; versus
mode code paths untouched. Add one regression to smoketest: versus apple eat
does NOT roll eggs.

## 8. Effort estimate

| Phase | Work | Estimate |
|---|---|---|
| `egg-baby.js`: egg lifecycle + sprites + sounds | ~120 lines | 1.5–2 h |
| Baby movement + AI + rendering + capture | ~140 lines | 2 h |
| `minigame.js`: board, snake, input, apples, win/death phases | ~220 lines | 3 h |
| game.js integration + states + resets + HTML scripts | ~70 lines | 1.5 h |
| Fireworks/countdown/banner visuals + sounds | ~120 lines | 1.5–2 h |
| Tests | ~150 lines | 1.5–2 h |
| **Total** | ~820 lines | **~10–12 h** |

## 8.1 Milestones (recommended build order)

One-shot is feasible, but the risky part is the `game.js ↔ minigame.js`
handoff (§5) — bugs there are invisible until the whole flow runs in a
browser — and the overlay/egg/baby/fireworks visuals need human review at
pixel scale (like the banana sprite iterations). Each milestone below is
independently shippable and green-tested before the next layer builds on it.

### M1 — Egg lifecycle ✅ DONE (`egg-baby.js` + game.js hooks, `game.js?v=29`, `egg-baby.js?v=1`)

- Scope: `GAME_CONFIG.egg` block; `eggRoll()` wired into the solo apple-eat
  branch AFTER pineapple/banana rolls (one special per bite, priority order);
  free-cell placement via `occupiedSet()` + egg cells; `eggAt(nx,ny)`
  destroy-on-contact in `tick()` (not lethal, no score/growth/poop/bulge,
  doesn't count toward hatch); `bitesSinceEgg` counter + hatch stub (logs
  "hatch!" until M2 exists); egg sprite (6×7, off-white with speckles,
  subtle blink); spawn chirp + hatch pop sounds; resets in `startGame()` /
  `initMenu()`; `index.html` script tag after `game.js`, version bump.
- Exit criteria: sandbox tests — roll fires only solo, only when no egg/baby,
  suppressed by specials; contact removes egg and snake survives; hatch after
  3 apples. Playable in browser (eggs appear/vanish) even before baby AI.

### M2 — Baby snake ✅ DONE (`egg-baby.js`)

- Scope: hatch creates 3-segment baby at egg position; own accumulator
  (`tickMs × babySpeedMul`) stepping via unshift/pop (never grows, never
  eats, never poops); avoidance AI (legal moves exclude main snake head+body,
  own body, foods/poops/fruits; jitter among top-2; freeze when cornered);
  `drawBaby` (6px blocks centered in cell, brighter green palette, tiny
  eyes); `babyCaptureCheck()` any-overlap → `baby = null` + placeholder
  banner "MINI-GAME NEXT HERE" (M3 replaces it); capture ding sound.
- Exit criteria: 200-tick simulated run never enters obstacle cells;
  cornered baby freezes; browser loop works end-to-end (egg → hatch → dodge
  → touch → banner), so the feature is fully demo-able at this point.

### M3 — Mini-game core standalone ✅ DONE (`minigame.js`, `game.js?v=31`, debug `E` key)

- Scope: `MiniGame` object with own grid (20×16×6px, centered overlay rect,
  bright checkerboard + frame), classic snake (3 segments, grow 2, walls
  lethal, self-body lethal), one apple at a time, WASD/arrows input with
  reversal guard, own tick accumulator (`tickMs: 110`), eat sound/burst with
  mini palette, win at 10 apples → "MINI-GAME COMPLETE!" banner, death →
  forfeit flag. Debug entry key `E` (temporarily) to play it WITHOUT the
  real capture handoff, so its loop is verified before integration.
- Exit criteria: standalone tests — 10-apple win sequence, wall death sets
  forfeit, snake growth correct; browser debug key plays the mini-game fully.
- Keep `E` debug key until M5; then remove (or keep behind a dev flag).

### M4 — Handoff + presentation ✅ DONE (`game.js?v=32`, `egg-baby.js?v=2`, `minigame.js?v=3`, `jaunty-music.js?v=1`)

- Scope: capture → `state = "minigame"`, main tick frozen; `loop()` branch
  drives `MiniGame.update/draw`; phases win → fireworks (6–8 staggered
  `fireworkBurst`s into shared `particles`, mini colors, boom sounds) →
  ~0.5s `globalAlpha` fade → countdown "3,2,1" banner with rising beeps →
  resume (`state = "playing"`, `acc = 0`, prev-snapshot reset); Esc forfeits
  (same path as death); music duck on enter (0.22, like pause) + restore on
  exit; `MiniGame.music` stub (future mini track, ChillMusic contract).
- Exit criteria: browser end-to-end — egg → hatch → catch → overlay plays →
  win or die/Esc → fireworks/fade/countdown → main resumes exactly where it
  left off (scores, snake position, level speed intact). Pause (`P`) during
  main game unaffected; versus mode verified egg-free.
- This milestone is where in-browser review of overlay size/palette/fireworks
  readability happens — budget iteration time here.

### M5 — Tests + polish (~2 h)

- Scope: full sandbox suite per §7 (roll, contact, hatch, AI, capture,
  mini win/death/forfeit paths, countdown resume, music duck spies) +
  versus regression (apple eat never rolls eggs); remove debug `E` key;
  cache-version bumps for `game.js`, `chiptune-music.js` (unchanged but
  bust-check), new scripts; combined-scope `node --check` for
  chiptune + game + egg-baby + minigame (global-scope collision habit):
  `cat src/chiptune-music.js src/jaunty-music.js src/game.js src/egg-baby.js src/minigame.js | node --check /dev/stdin`.
- Exit criteria: all suites green (`node tests/*.js` from repo root), `node --check` clean on combined files,
  no leftover debug hooks, localStorage untouched by this feature (no new
  persisted state needed).

M1–M4 are complete (M5 pending). Notes on deviations from the plan
(2025 implementation pass, verified by `egg-test.js` (12 assertions) and
`mini-test.js` (39 assertions), all older suites green):

1. **Namespace loading**: `egg-baby.js` is an IIFE exposing `window.EggBaby`
   AND a `globalThis.EggBaby` alias — the alias is required so bare
   `EggBaby` identifier lookups resolve in vm-sandbox tests (browsers:
   `globalThis === window`, no-op). game.js hooks are all
   `window.EggBaby`-guarded, so the game runs fine without the file and
   old single-file test suites are unaffected.
2. **occupiedSet hook**: added `EggBaby.addOccupancy(s)` — eggs AND baby
   cells now block fruit spawns (plan only required egg placement to avoid
   occupied cells; this also keeps apples from landing on the baby).
3. **Squash details**: crushed eggs also reset `bitesSinceEgg` and emit a
   small silent cream puff (plan said "just disappears" — puff added for
   feedback).
4. **Hatch body direction** auto-picks the first of r/l/d/u whose trailing
   2 cells fit inside the board (clamped fallback) — unspecified in plan.
5. **Baby AI specifics**: dodges snake head+body, own body (own tail
   chase allowed), foods, VISIBLE poops only (hidden ones fair-play safe),
   fruits; prefers the legal move maximizing distance to the nearest item,
   30% jitter to the runner-up, shuffled tie-breaks; freezes when cornered.
6. **Capture placeholder**: green burst + 3-note square ding (880/1174/1396
   Hz, gain 0.12 — louder than levelSound to mark the event) + fading
   "BABY CAUGHT! MINI-GAME (M4)" banner ~1.4s; game keeps playing until M4.
7. **Debug API** (`EggBaby.debug`: eggs/baby refs, placeEgg, stepBaby,
   captureAt, bites) added for deterministic vm tests — beyond-plan, small.
8. **mini config block deferred** to M3 (M1 scope was the egg block only).
9. **egg-test.js** uses a fake `performance.now` clock and must press
   `Escape` before each restart (1/2 keys only act in menu/over states).

M3 (mini-game) deviations:

10. **Music stub records calls** (`debug.musicEvents`) and `MiniGame.setMusic(engine)`
    was added so M4 can swap a real ChillMusic-style engine in; the stub honors
    the contract (start/stop/setVolume/setIntensity/gameOver/playing).
11. **Growth convention** mirrors the main `tick()`: `grow: 1` = net +1 segment
    per apple (the new head counts as one of the `grow` cells).
12. **`GAME_CONFIG.mini`** carries extra fields beyond the plan sketch:
    `snakeLen`, `winMs`, `fxMs`, `diedMs`, `fadeMs` (all tunable).
13. **Freeze mechanism**: `loop()` early-returns *before* the accumulator, so
    main score/length/tickMs/acc are provably untouched across a mid-play
    mini round (test asserts exact equality).
14. **Global keys still live during the mini-game**: Z/X/T (audio) and 3/4
    (poop/wrap toggles) run before the minigame guard in the keydown handler;
    3/4 toggling mid-mini is harmless (mini ignores wrapMode — walls always
    kill, verified by test).
15. **Death presentation**: ~0.8s red-flash "MINI-GAME OVER" phase + sawtooth
    crash sweep, then fade. `onDone(reason)` returns "won"/"wall"/"body"/
    "skipped"; `debug.lastReason()` survives finish() for tests.
16. **Esc skips fireworks too** (win/fireworks → immediate fade-out).
17. **Frame ring drawn with layered fillRects** (no strokeRect) so the vm
    canvas stub stays simple; fireworks palette is the plan's HSV rainbow.
18. **Own keydown listener** installed on start, removed on finish — vm tests
    need a multi-listener `window.addEventListener` stub, and the canvas stub
    must provide `width`/`height` (mini grid offset derives from them:
    ox=68, oy=48).

M3 browser bug-fixes (found by user, fixed + regression-tested):

19. **Reversal kill**: mini `handleKey` pushed any steer into the queue,
    including 180° reversals — pressing the opposite direction put the head
    into the neck for instant death. Now mirrors the main game: handler
    rejects `d === last || d === REV[last]` (last = queued tail or current
    dir), and `tick()` ignores a shifted reversal (`if (d !== REV[g.dir])`).
20. **Blank board after mini ends**: `game.js` schedules the next frame at the
    END of `loop()`, and the `state === "minigame"` early-return skipped that
    reschedule — the rAF chain died, so nothing ever redrew after the
    mini-game finished (page reload required). Fixed: the minigame branch
    now calls `requestAnimationFrame(loop)` before returning.
21. **Test harness now emulates the rAF chain** (`mini-test.js` pumps queued
    callbacks like a browser): asserts both loops keep rescheduling during
    the mini and the main loop redraws after resume. Drain must be BOUNDED
    (`for` loop, not `while (queue.length)`) — the self-rescheduling loop
    never lets the queue empty (this caused a 4.5-min hang).

M4 (handoff) deviations:

22. **Handoff signal**: `egg-baby` sets a one-shot `pendingHandoff` flag in
    `babyCaptureCheck()`; game.js consumes it via `EggBaby.takeHandoff()` in
    the loop right after the tick accumulator (same frame, before drawing).
    `debug.handoff()` exposes the flag. The M2 placeholder banner
    (`drawCaptureBanner`) was removed from egg-baby — the handoff jingle +
    countdown replaced it.
23. **`loop()` does NOT drive MiniGame.update/draw** — MiniGame keeps its own
    rAF loop + keydown listener from M3; game.js's minigame branch just
    reschedules itself and (during the countdown) draws the frozen main
    scene + banner. The plan's "loop drives MiniGame" wording was superseded
    by the self-contained engine.
24. **Resume countdown is game.js-owned**, after MiniGame's fade-out: 1s per
    digit "3,2,1" + ~0.35s "GO!", rising square beeps 440/550/660 then 880
    Hz (gains ≤ 0.1), banner over the frozen board (particles/baby do NOT
    advance — `drawMainScene(0, t)`). Escape/Space/P during the countdown
    skip it instantly. `finishCountdown()`: HUD opacity back to 1, music
    volume restored (0.55, mute-aware), `acc = 0`, `state = playing` — or
    `initMenu()` if the round was started from the title (`E`).
25. **Music**: real engine swap instead of a stub — `jaunty-music.js`
    (classic-script IIFE, `window.JauntyMusic`, ChillMusic-compatible
    contract + `eat()`/`win()`), constructed once with the shared
    `audioCtx` and `volume: musicMuted ? 0 : 0.5`; `enterMiniGame()` calls
    `MiniGame.setMusic(jaunty || null)` (silent stub until audio unlocks),
    and `Z` during the mini also routes `jaunty.setVolume(0|0.5)`. MiniGame's
    win calls `music.win()`, apple eats call `music.eat()`.
26. **HUD/overlay presentation**: `enterMiniGame()` hides the DOM overlay
    (menu/options must not sit over the mini board) and dims the score HUD
    (`#p1score/#p2score/#best` → opacity 0.4) for the round; restored on
    countdown finish.
27. **Capture jingle**: 3-note square arpeggio (C5/E5/G5, 0.09s spacing,
    gain 0.12) fires at handoff so the overlay arrival is audible.
28. **Fireworks stayed inside MiniGame** (its own fx list on the mini board,
    from M3) rather than bursting into the main game's shared `particles`.
29. **Music restore is deferred to countdown finish** (not at MiniGame
    exit), so the main track stays silent through the "3,2,1" sequence —
    intentional sequencing, the countdown is the mini-game's outro.
30. **`enterMiniGame()` owns the engine**: externally swapped engines are
    overridden at start (the engine-swap regression test now calls
    `MiniGame.start()` directly to verify the contract); `E` debug entry is
    kept (plan says remove at M5 — decide then).
31. **Main-track mute during mini (`game.js?v=33`, user-reported faint
    background music)**: the plan's 0.22 pause-style duck was clearly
    audible on desktop speakers alongside JauntyMusic. Replaced with
    `musicTarget(v) = musicMuted || state === "minigame" ? 0 : v` — a single
    mute-aware clamp used by `setMusicVolume`, `startMusic` and `startChill`,
    so the main track ramps to FULL silence on mini entry and Z-unmute or
    T track-switch mid-mini cannot resurrect it. `finishCountdown()` flips
    the state BEFORE restoring 0.55 (otherwise the clamp would swallow the
    restore). Pause/gameOver ducks (0.22/0.34) unchanged.

## 9. Decision points (all confirmed by user)

1. **Confirmed**: egg is destroyed if the snake hits it before hatching —
   game continues, no baby from that egg (not lethal, not edible).
2. **Confirmed**: baby halts when cornered (never dies) and avoids hitting /
   being hit by the main snake.
3. **Confirmed**: mini-game failure skips straight to the countdown and
   resumes the main game; no penalty.
4. **Confirmed**: mini-game is classic snake — only apples spawn, walls kill
   (mini ignores the main wrap toggle).
5. **Confirmed**: at most one special item per apple bite
   (pineapple > banana > egg priority). *(Spawn rolls fire on apple bites,
   not every tick.)*
6. **Confirmed**: no main-game reward for winning the mini-game.
7. Capture = any body overlap (default chosen; see §3).
8. Esc forfeits the mini-game (default; same forfeit path as death).
9. Solo only — eggs never roll in versus (per spec).

## 10. Out of scope / future hooks kept open

- Mini-game-specific music engine: the `MiniGame.music` stub (ChillMusic
  contract) is now fed a real `JauntyMusic` instance by `enterMiniGame()`;
  `MiniGame.setMusic(engine)` still allows swapping other engines.
- Difficulty variants for the baby (flee distance, jitter amount).
- Multiple baby snakes / eggs in versus.
- Smooth interpolated motion compatibility (see `smooth-motion-plan.md`):
  baby and mini-snake follow the same prev/current snapshot pattern, so the
  interpolation plan extends to them unchanged.
- Mini-game leaderboard/persisted best (localStorage precedent exists).
