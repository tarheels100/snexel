# design.md — Snexel architecture & design

Architecture reference for anyone new to the codebase. Complements
`AGENTS.md` (rules) and `testing.md` (test harness). Plan docs
(`snake-ai-plan.md`, `egg-minigame-plan.md`, `touch-controls-plan.md`,
`smooth-motion-plan.md`) record decisions for specific features.

## 1. Big picture

One HTML page, seven classic scripts sharing a single global scope, one
canvas, one Web Audio context. No build step. Everything renders on a
`256×192` canvas at `32×24` grid of `8px` cells with
`image-rendering: pixelated`, plus a CSS scanline/vignette overlay for the
CRT look. The font is Press Start 2P (Google Fonts, monospace fallback).

```
index.html
 ├─ styles.css                 chrome, CRT effects, touch pads (media-gated)
 ├─ src/chiptune-music.js      "retro" music engine   → window.ChillMusic
 ├─ src/jaunty-music.js        mini-game music        → window.JauntyMusic
 ├─ src/snake-ai.js            pure AI engine         → window.SnakeAI
 ├─ src/game.js                main game (the hub)    → globals + handleKeyDown
 ├─ src/egg-baby.js            egg→baby pipeline      → window.EggBaby
 ├─ src/minigame.js            capture mini-game      → window.MiniGame
 └─ src/touch.js               touch pads/chips       → window.TouchControls
```

**Load order matters:** music engines first (game.js references them),
`snake-ai` before `game` (game wires the demo/CPU brains at load), `game`
before `egg-baby`/`minigame` (those call game globals like `GAME_CONFIG`,
`PAL`, `demoQuiet`, `countdownBeep` at init/steer time), `touch.js` last
(wires game.js's `steerPlayer`/`handleKeyDown` and `MiniGame` API).

**Namespace contract:** `snake-ai`, `egg-baby`, `minigame`, `touch`, and the
music files keep all internals inside an IIFE and expose only `window.X`
plus `globalThis.X` (the latter makes bare `X` resolvable in vm test
sandboxes). `game.js` is the only file that freely declares top-level
globals; every other file must not collide with them — the combined
`node --check` over all seven scripts catches duplicate `const`/`function`
names (this bit us once: `CHORDS` in game.js vs chiptune; renamed to
`RETRO_CHORDS`).

## 2. game.js — the hub (~1.6k lines)

### State machine
`state ∈ {"menu","options","playing","paused","over","minigame"}`, driven
by `handleKeyDown(e)` (named function; touch overlay taps invoke it directly
with `{code}` instead of synthesizing KeyboardEvents). Order inside
`handleKeyDown`: global toggles that work in ANY state (`3/M` poop, `4/N`
wrap, `C` cpu, `D` cpu level **outside play only**, `Z/X` mutes, `T` track)
→ demo `Q` → debug `E` → `minigame` state (MiniGame owns keys; resume
countdown skips on Esc/Space/P) → menu → options → steering arrows/WASD →
over → pause/resume.

- **menu** = attract mode: one demo snake (SnakeAI engine or legacy random
  walker, `Q` toggles, canvas tag shows `AI: ENGINE/RANDOM`). Silent
  (`demoQuiet()` gates all SFX in menu). If the demo snake would die,
  `tick()` calls `initMenu()` instead of game-over — title never shows "OVER".
  The demo snake eats for looks only: score, HUD, levels, and music
  intensity are play-only (`tick()` gates them on `state === "playing"`).
- **options** = DOM overlay with rows for poop/wrap/audio/track/CPU toggles;
  each row has `data-key` so touch taps press it.
- **playing** = main clock: `tick()` steps each `tickMs` via the rAF
  accumulator; speed from `speedFor(level)` where `levelForBites(bites)`
  uses doubling milestones `8, 24, 56, 88, 120, 152, 184…` (interval doubles,
  capped +32). `SPEED_START=130`, `SPEED_MIN=76`, `SPEED_DELTAS=[14,12,10,8,6,4]`,
  divided by `cfg().speedDiv` (higher divisor = faster; both modes 0.7 =
  matching chill tempo; set versus to 1 for a livelier duel).
  Steering: solo = WASD **and** arrows both steer P1; versus = WASD → P1,
  arrows → P2 — but when P2 is CPU-driven, arrows fall back to steering P1
  (`steerPlayer` ignores CPU players entirely).
- **minigame** = board frozen; main loop only reschedules rAF + runs the
  resume countdown (see §5).

### Tick rules (the death/physics contract)
Per snake: apply queued turn (no 180° reversal vs current dir), advance head.
Death causes tracked in `p.cause`: wall (unless `wrapMode` — edges are
portals), self body, foe head-on-head overlap (versus), foe body, visible
poop pile. **Vacating-tail exception**: moving into the cell the tail is
about to leave is safe. Eating: grow (`cfg().grow` segments, bulge animation
`cells[0].bulge` — a tapering 10→9→8px pop that travels with the tail),
score, eat burst particles + `eatSound()`. In poop mode the eaten square
becomes a pile **hidden under the bulge** until the bulged tail leaves it
(`revealPoop`), then it's lethal terrain and the quiet `poopSound()` plop
fires at *reveal*, not at eat.

### Versus end rule + winner (score decides, survival time does not)
`tick()` end-check after deaths: if exactly one snake is dead and the
survivor's score exceeds the fallen rival's, `gameOver()` fires
**immediately** (survivor wins — checked every tick, so they win the moment
they overtake). Equal-score deaths never end the round: the survivor keeps
playing until they overtake (win) or die (then everyone is dead). `gameOver()`
then declares the winner purely by score: highest scorer wins ("WINS!" if
alive, "WINS ON SCORE!" for same-tick deaths where the dead snake scored
more), tie → `DRAW!`. Elimination order is never consulted.

### Special items (one per bite, rolled after pineapple then banana)
- **Pineapple** (`GAME_CONFIG.pineapple`): eating blasts all poops/apples
  within `radius` tiles (hidden piles included, silently), red zone flash,
  and in versus kills any foe whose HEAD is inside the radius. Death copy:
  "boom" cause.
- **Banana** (`GAME_CONFIG.banana`): eating cross-fires the entire row +
  column (same wipe rules, `drawCrossFlash()`), kills foes on that row/col.
- **Egg** (`GAME_CONFIG.egg`, solo only): 3% roll per bite; unhatched eggs
  are squashed by running over them; after `hatchBites` more apples a shy
  3-segment baby appears (see §4). Spawn occupancy (`addOccupancy`) never
  places fruit/eggs on snakes, piles, or other specials.

### Rendering pipeline (`drawMainScene(dt, t)`, called every frame)
board checker → poops → eggs → apples → pineapples → bananas → explosions →
cross-flash → snakes (chunky blocks, light/dark edge shading, directional
eyes) → baby → particles → level banner (play/paused) → menu `AI:` tag →
`EggBaby.updateBaby(dt, tickMs)`. Sprites are small pixel arrays drawn via
`drawCell`; the apple is a `6×7` inset that fits inside one cell; sprites
shimmer with time `t`. Overlay screens are DOM (`showOverlay(html)` into
`#overlay`), not canvas.

### Audio subsystem
One `AudioContext` created early (`ensureAudio()`), playback unlocks on the
first gesture — `keydown` **and** `pointerdown` listeners. SFX are one-shot
oscillator/noise bursts (`eatSound`, `poopSound`, `levelSound`, `boomSound`,
`bananaSound`, `captureDing`/`eggChirp`/`hatchPop` in egg-baby,
`startJingle`, `countdownBeep`). `sfxMuted` gates them; `demoQuiet()` also
gates them in menu (except `countdownBeep`).
Music: two engines, switched mid-game (`T`) via `applyTrack()` — "chill"
(`window.ChillMusic`, 72 BPM) and "retro" (`window.ChillMusic` with retro
settings — game.js keeps its own `RETRO_CHORDS`). Volume routing goes
through one clamp: `musicTarget(v) = musicMuted || state === "minigame" ? 0 : v`,
so the main track is **fully** muted while the mini-game plays (JauntyMusic
takes over, sharing the same AudioContext). `setMusicVolume(v, fade)` anchors
the current gain then ramps. Pause ducks to 0.22; resume restores 0.55.
Chill intensity rises with score (`chill.setIntensity()`), eat/gameOver hook
calls into the engine.

### SnakeAI wiring in game.js
- `DEMO_AI_OPTS = SnakeAI.presets("demo", GAME_CONFIG.ai.demo)` (guarded —
  engine-less sandboxes fall back to the legacy walker).
- `demoWorld(p, rng)` builds the engine snapshot per tick (body, dir, queue,
  foes = other alive snakes, foods/kinds, **visible poops only**, wrap,
  seeded rng). `aiPickDir(p)` prefers `p.aiOpts` (CPU path) else the demo
  path with `demoBrainRng = mulberry32(20260120)`.
- **CPU mode** (`C` toggle, `snake_cpu`; level `D` cycle easy/normal/hard,
  `snake_cpu_lv`): `startGame(2)` gives P2 `ai`/`cpu` flags +
  `SnakeAI.presets(cpuLv, GAME_CONFIG.ai.cpu[cpuLv])` + its own `brainRng`;
  `steerPlayer(i, dir)` early-returns for CPU snakes (keys and pads can't
  steer them); HUD `#p2tag` reads "CPU"; touch hides the right pad (§6);
  if SnakeAI isn't loaded, falls back to a human P2.

## 3. src/snake-ai.js — the engine (pure, standalone)

`SnakeAI.choose(world, opts)` returns `"u"|"d"|"l"|"r"`. Zero DOM/rAF/sound/
game-global deps — loads alone in a vm sandbox. World: `{gw, gh, wrap, snake
{x,y,len,dir,body}, foes[], fruits[{x,y,kind}], poops[], rng}`.

Decision tiers (in priority order):
1. **Hamiltonian cycle** (when `opts.cycle`): serpentine U-pair cycle built
   per grid size (validated full-cover + adjacency, cached; needs even `gh`,
   else `null` → BFS tier). Uses only non-wrap edges → stays valid while
   wrap toggles mid-match. Shortcuts toward fruit allowed only when the
   landing cell is legal+hazard-free, every skipped cycle cell is empty and
   hazard-free, cycle-distance from landing to tail ≥ newLen +
   `shortcutSlack`, and the path never leaps *past* fruit. `shortcutMax`
   caps jump length. If the next cycle cell is a hazard, degrade to BFS.
2. **BFS dart** (`dartRange`): any legal step strictly reducing BFS distance
   to a reachable fruit beats the sweep, bounded by range; safety = flood
   fill of the room after the step (not cycle slack — darts aren't committed
   to the cycle). Darts beat gain shortcuts (`if (dart) break`).
3. **BFS target tier**: pick the best fruit to chase — race-skip fruits foes
   are strictly closer to; kill bonus when a foe head sits in a blast zone;
   special fruit attractiveness gated by `specialWeight`/`specialMaxDist`
   (distant spectacle fruit doesn't derail the sweep); wander = flee nearest
   foe when nothing is worth chasing.
4. **Flee mode** (`opts.flee`, baby preset): maximize BFS distance from the
   nearest foe head, hazard penalty, flood-fill survival filter (slack),
   `hesitation` keeps the old direction ~30% of ticks (so the baby stays
   interceptable), `jitter` picks among runners-up. Cornered → returns an
   illegal dir; callers must handle a freeze fallback.

Danger map: pineapple radius / banana row+column are LETHAL only when a foe
is ≤ `zoneReach` BFS steps from that fruit (detonation risk), HIGH when a
foe exists but can't reach, LOW with **no foes** (solo snakes walk through
blast zones); fruit cell itself always safe; `oppLookahead K` forward-simulates
foe queued dirs to mark deeper projections HIGH. Flood fill (`reachableAfter`)
bans self-trap moves below `len + slack`. Legal-move filter mirrors `tick()`
exactly (wrap, walls, reversal, visible poops, body, vacating-tail exception,
foe tail blocks only when that foe eats next tick). Seeded `mulberry32` RNG
keeps decisions deterministic. Debug API: `legalMoves` (**dir strings**),
`occupancy`, `dangerMap`, `bfs`, `reachableAfter`, `mulberry32`, `REV`,
`lastTier()`, `cycleFor()`, `cycleIndex()`, `PRESETS`, `presets(name, knobs)`
(merge knobs over preset; unknown name throws).

Presets: `demo` (cycle + slack 6, dartRange 24, mild specials), `baby` (flee,
avoidFruit, hesitation 0.3), `easy` (no flood fill — self-traps), `normal`
(BFS + flood fill), `hard` (cycle + aggressive shortcuts + oppLookahead 3).

## 4. src/egg-baby.js — egg → baby pipeline

`EggBaby` namespace (game.js calls it behind `window.EggBaby` guards so the
game runs without the file). Lifecycle: `registerBite()` after each apple
eat rolls eggs (game rolls pineapple/banana first — one special per bite);
eggs sit on the board (`drawEggs(t)` shimmer + roll); `contactEgg(x,y)`
squashes an unhatched egg (no death); after `hatchBites` bites an egg hatches
a baby (`hatchPop`, taunt banner "CATCH ME IF YOU CAN!" fading over
`bannerMs`). The baby runs its **own slower clock** inside
`updateBaby(dt, tickMs)` (`babySpeedMul`), narrower (`babyWidth`), never
dies: `babyMove()` dispatches to `engineBabyMove()` when SnakeAI is loaded
(preset `baby`, `babyRng = mulberry32(777)`, foes = alive players reading
**`p.queue`** — game.js's real field name), legacy scorer otherwise; if the
engine's answer isn't in `legalMoves()` the baby holds direction (cornered
freeze). `babyCaptureCheck()` — any overlap of baby with a main snake body
sets `pendingHandoff`; `takeHandoff()` is consume-once, game.js's loop
consumes it right after the tick accumulator → `captureHandoff()`.
`resetEggBaby()` clears eggs/baby on start/menu. `addOccupancy(s)` feeds the
game's spawn occupancy set so eggs/baby cells aren't re-spawned on.

## 5. src/minigame.js — capture mini-game

Full-screen takeover round: classic single-snake game on a bright centered
`20×16` @ `6px` grid (offset computed from canvas size), apples only, walls
kill, wrap always OFF, flat `tickMs`. **Own rAF loop + own keydown listener
while active**; game.js's main loop must still reschedule itself during
`state === "minigame"` or the board stays blank after it ends (regression we
hit). Phases: `count` ("3 2 1 GO!" banner + `countdownBeep` over the mini
board; steering ignored until GO, Esc skips) → `play` → `win` (goal apples,
`winMs`) → `fireworks` (`fxMs`) → `fade` (`fadeMs`) → `done`; death →
`died` flash → fade. `onDone(reason)` hands back to game.js with
`"won"|"wall"|"body"|"skipped"`. Public API: `start(opts)`, `isActive()`,
`setMusic(engine)` (default silent stub recording calls for tests; real
engine = JauntyMusic), `touchSteer(dir)`, `togglePause()`, `forfeit()`, plus
`debug` (incl. `turnQueue()`, `skipCountdown()`).

Handoff in game.js: `enterMiniGame()` dims HUD, hides DOM overlay, starts
JauntyMusic, sets `state="minigame"`; `onDone` applies the win reward
(`shrinkMainSnake(GAME_CONFIG.mini.shrink)` — tail-only cuts, head never cut,
bulge-cut surfaces hidden piles, green puffs) and starts the **resume
countdown**: frozen `drawMainScene(0)` + big digits + beeps for 3.35s
(Esc/Space/P skip), then `finishCountdown()` flips state back to
playing/menu, restores HUD opacity, unmutes music AFTER the state flip, and
resets `acc` so the main clock restarts cleanly from the frozen scene.

## 6. src/touch.js — touch controls

Detects touch via `matchMedia("(hover: none) and (pointer: coarse)")`; on
desktop it installs **zero listeners** (touch-test proves DOM untouched).
One delegated `pointerdown` on `.crt`; `closest()` resolves nearest
`[data-*]`: `[data-dir]` pad buttons → `steerPad(padIdx, dir)`,
`[data-action]` chips → pause/quit, `[data-key]` overlay rows →
`tapKey(code)` (calls game.js's `handleKeyDown({code})`), board tap during
the mini countdown → skip. Chips: pause ⇄ `KeyP` (mini ⇄
`MiniGame.togglePause()`); ✕ quit ⇄ `Esc` during play/pause (quits to the
title menu) and ⇄ `MiniGame.forfeit()` in mini. Both chips stay visible
while driving **and while paused**, so the title is always reachable on
mobile. The pause overlay's rows (`RESUME`, `QUIT TO TITLE`) are tappable
too. Routing: solo = both pads steer P1; versus = left pad P1, right pad P2
— when P2 is CPU, **both pads steer the human P1** (same fallback as the
arrow keys) and both pads stay visible; mini round = both pads →
`MiniGame.touchSteer`.
Chips live OUTSIDE the board and ABOVE the HUD row (side by side at its
right end — never over the board, never over the pads, in both orientations).
Placement rules sit at the END of styles.css because they share specificity
with the base `.tchip` rule (file order is the tiebreaker); the touch HUD gets
an explicit `--hud-h` so the chips' negative `top` lands exactly above it, and
`.hud` `margin-top` reserves that strip.
Steering goes through game.js `steerPlayer` (same reversal guard as keys),
so rejected taps never queue. **Pad visibility**: `syncChips()` (120ms poll)
marks `.touch-layer.idle` when nothing is drivable (CSS hides pads but keeps
chips); pad inline visibility is always *cleared*, so CSS `.idle .dpad`
owns it. Last-tap ghost arrow in each
pad center: SVG innerHTML, opacity decayed over ~600ms by the same poll, no
CSS animation. Icons are inline SVG pixel paths with explicit CSS colors
(`.dpad.p1 svg { fill: var(--p1) }` etc.) — never glyphs, never
currentColor. Layout is orientation-aware: portrait pads below the board,
landscape pads to the sides (`--pad` sizes, tight-phone smaller), safe-area
insets, `touch-action: none`. Debug API: `{enabled, steerPad, tapKey,
chipPause, chipQuit, syncChips, markGhost, lastTap}`.

## 7. Persistence & config

`GAME_CONFIG` (game.js, top) is the tuning surface: solo/versus item counts,
growth, speedDiv; pineapple/banana/egg/mini blocks; `ai` knobs merged over
engine presets. Player toggles persist: `snake_poop`, `snake_wrap`,
`snake_track` (default "chill"), `snake_music_muted`, `snake_sfx_muted`,
`snake_cpu`, `snake_cpu_lv`, `snake_best`.

## 8. Design principles worth preserving

- **Fairness**: brains see only visible poops/current fruit, never hidden
  piles or spawn RNG.
- **Catchability**: baby must stay interceptable (hesitation, freeze when
  cornered, never dies); perfect evasion kills the egg→mini pipeline.
- **Nothing ever blanks the screen**: rAF chaining survives every takeover;
  attract mode restarts instead of showing game over.
- **Silence rules**: menu is SFX-free; main music fully muted in mini-game;
  plop quieter than chomp; SFX always sit on top of music.
- **Copy rules**: no "poop" wording in UI; puns instead; SNEXEL all-caps on
  screen.
- **One visual language**: 8px pixel grid, chunky shading, palette in
  `PAL`, banners drawn in canvas with Press Start 2P.
- **Tune in GAME_CONFIG**, not inside engines; presets merge knobs.

## 9. Pending work (as of last commit)

- M5 (`egg-minigame-plan.md`): extend tests, browser verify, decide removing
  debug `E` key, cache bumps.
- `smooth-motion-plan.md` Option A (interpolated rendering) — planned, not
  implemented.
- Browser/device verification for D3 CPU versus and final SVG touch pads.
