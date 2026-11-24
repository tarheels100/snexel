# Snexel — Slither & Chill

Chill pixel art snake game with some fun twists.

**Snexel** (snek × pixel) is built in plain HTML/CSS/JS — no build tools, no
dependencies (just a Google font with a local fallback). 1–2 players, plus
poop/wrap modes, bomb fruits, an egg→baby→mini-game pipeline, and three
procedural chiptune music tracks (Web Audio, all synthesized live).

## Run it

Just open `index.html` in a browser (any static file server or double-click).
Audio unlocks on the first key/click (browser autoplay policy).

## Controls

| Key | Action |
| --- | --- |
| `1` / `2` | Start solo / versus (WASD vs arrow keys; if P2 is the CPU, both WASD and arrows steer your snake) |
| `O` | Options screen (mode + audio toggles, track choice) |
| `Enter` / `Space` | Rematch after game over |
| `P` | Pause |
| `3` / `M` | Poop mode toggle — eating leaves a lethal poop pile on the apple square |
| `4` / `N` | Wrap mode toggle — board edges become portals |
| `Z` / `X` | Mute music / mute SFX |
| `T` | Switch main music track: chill ↔ retro |
| `C` | CPU opponent toggle — P2 is computer-driven in 2-player mode |
| `D` | CPU difficulty cycle (easy/normal/hard) — in menu/options/game-over only |
| `Q` | Debug: title demo snake brain — AI engine ↔ random walker |
| `E` | Debug: launch the mini-game directly |
| `Esc` | Back to title / forfeit mini-game |

All toggles persist in `localStorage` (keys `snake_poop`, `snake_wrap`,
`snake_music_muted`, `snake_sfx_muted`, `snake_track`, `snake_cpu`,
`snake_cpu_lv`, `snake_best`).

On touch devices (phones/tablets) the keyboard hint is replaced by thumb
D-pads placed *outside* the board — below it in portrait, to its sides in
landscape: left pad = P1, right pad = P2 (solo or vs CPU: either pad steers
your snake), plus pause and quit chips — above the board in portrait, stacked
to its right in landscape (quit returns to the title menu; mid mini-game it
forfeits) — and tap-to-press
overlay rows. Each pad's center cell flashes a fading ghost of the arrow you
tapped (mis-taps stay legible). Desktop never shows or wires them
(media-query detection).

## Features

- **Pixel board**: 256×192 canvas, 32×24 grid of 8px cells, checkerboard,
  CRT scanlines + vignette, chunky shaded snakes with directional eyes.
- **Eat bulge**: the head swells when biting; the bulge pops off with the tail.
- **Milestone speed levels**: levels at 8, 24, 56, 88, 120… bites with
  doubling intervals; banner + fanfare on level-up. Tunable via
  `GAME_CONFIG` at the top of `src/game.js`.
- **Special fruits**: pineapple (radius blast) and banana (row/column
  cross-fire) wipe terrain and, in versus, kill snakes caught in the blast.
- **Versus ends on score**: when one snake dies, the round ends immediately
  if the survivor has out-scored the fallen rival (they win); otherwise the
  survivor keeps playing until they out-score the rival's final score (win)
  or die themselves (loss or draw — whoever scored more wins; survival time
  never decides).
- **Touch controls (touch devices only)**: translucent thumb pads funnel
  through the same steering guards as keyboard; detected via
  `(hover: none) and (pointer: coarse)` — desktop stays keyboard-only.
- **Egg → baby → mini-game (solo only)**: apple bites may roll an egg; 3
  bites hatch a shy baby snake that dodges everything and freezes when
  cornered. Touching it hands off to a bright mini snake round (10 apples);
  win fireworks or forfeit, then a "3-2-1-GO!" countdown resumes the main
  game exactly where it left off (the mini round opens with its own countdown
  too). Winning the round sheds 5 segments off your main snake — a shorter
  snake is the reward. The main track is fully muted during the
  mini round — JauntyMusic plays there instead.

## Music

Three Web Audio engines, all classic scripts sharing one AudioContext:

- `src/chiptune-music.js` → `window.ChillMusic` — 72 BPM chill loop (main track).
- Retro loop inside `game.js` — 92 BPM Am–F–C–G chiptune (alt main track).
- `src/jaunty-music.js` → `window.JauntyMusic` — upbeat track for the mini-game.

## Layout

```
index.html      page + overlay/HUD
styles.css      pixel styling, scanlines
assets/         favicons (SVG + ICO w/ 16 & 32 PNGs + apple-touch 180)
src/            game.js, snake-ai.js, egg-baby.js, minigame.js, chiptune-music.js, jaunty-music.js, touch.js
tests/          node sandbox suites (vm-based, no framework)
docs/          	  architecture, testing, how-to-edit + feature plans
```

Scripts load as plain classic scripts (shared global scope), so keep unique
top-level names across files — verify with:

```sh
cat src/chiptune-music.js src/jaunty-music.js src/game.js src/egg-baby.js src/minigame.js src/touch.js | node --check /dev/stdin
```

## Tests

```sh
node tests/smoketest.js       # core game, modes, config, options/audio
node tests/poopmode-test.js   # poop reveal + lethality
node tests/sound-test.js      # SFX + music integration spies
node tests/engine-test.js     # ChillMusic engine against fake AudioContext
node tests/egg-test.js        # egg/baby lifecycle + AI
node tests/mini-test.js       # mini-game incl. M4 handoff/countdown/resume
node tests/touch-test.js      # touch routing incl. guards, chips, ghosts, desktop-off
node tests/ai-test.js         # SnakeAI engine: legality, danger, flood-fill, soak + demo wiring
```

Each prints `label=value (expect …)` lines — compare against the expectations.

## Planned features (design docs in `docs/`)

- Smooth interpolated snake motion (`smooth-motion-plan.md`)
- Snake AI engine (`snake-ai-plan.md`) — demo snake, smarter catchable baby,
  and human-vs-CPU mode (`cpu-snake-plan.md` is superseded by it).
  All phases A–D3 shipped. The title-screen demo snake runs
  `src/snake-ai.js` on a cached Hamiltonian cycle with checked shortcuts and
  BFS "darts" — it sweeps the board, darts straight at reachable apples from
  any side (never leaping past one), and never traps itself; hazards degrade
  it to the BFS tier. The engine also ships five presets (`demo`, `baby`,
  `easy`, `normal`, `hard`) including a flee mode tuned to keep the baby
  snake catchable. Press **Q** on the title screen to toggle the demo against
  the old random walker (small `AI:` tag shows which brain is running).
  **D2 shipped**: the baby snake now runs the engine flee tier — it arcs
  away from your head, dodges fruit/piles/blast zones, hesitates (~30% of
  ticks keep the old direction) so you can read it and intercept, and
  freezes when cornered instead of dying. **D3 shipped**: press **C**
  anywhere to make P2 a CPU snake in 2-player mode (HUD shows `CPU`), and
  **D** in the menu/options to cycle difficulty (easy / normal / hard). The
  CPU eats, dodges you, and never takes input from keys or touch pads; while
  it drives P2, the arrow keys and BOTH touch pads steer your snake.
- Overlayed touch D-pads, shown only on touch devices (`touch-controls-plan.md`)
  — stages 1–3 shipped; stage 4 (optional): swipe steering, orientation hint, haptics
- Egg/baby/mini-game milestone M5: polish + remove debug `E` key (`egg-minigame-plan.md`)

## License

MIT — see `LICENSE`.
