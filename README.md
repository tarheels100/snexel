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
| `1` / `2` | Start solo / versus (WASD vs arrow keys) |
| `O` | Options screen (mode + audio toggles, track choice) |
| `Enter` / `Space` | Rematch after game over |
| `P` | Pause |
| `3` / `M` | Poop mode toggle — eating leaves a lethal poop pile on the apple square |
| `4` / `N` | Wrap mode toggle — board edges become portals |
| `Z` / `X` | Mute music / mute SFX |
| `T` | Switch main music track: chill ↔ retro |
| `E` | Debug: launch the mini-game directly |
| `Esc` | Back to title / forfeit mini-game |

All toggles persist in `localStorage` (keys `snake_poop`, `snake_wrap`,
`snake_music_muted`, `snake_sfx_muted`, `snake_track`, `snake_best`).

## Features

- **Pixel board**: 256×192 canvas, 32×24 grid of 8px cells, checkerboard,
  CRT scanlines + vignette, chunky shaded snakes with directional eyes.
- **Eat bulge**: the head swells when biting; the bulge pops off with the tail.
- **Milestone speed levels**: levels at 8, 24, 56, 88, 120… bites with
  doubling intervals; banner + fanfare on level-up. Tunable via
  `GAME_CONFIG` at the top of `src/game.js`.
- **Special fruits**: pineapple (radius blast) and banana (row/column
  cross-fire) wipe terrain and, in versus, kill snakes caught in the blast.
- **Egg → baby → mini-game (solo only)**: apple bites may roll an egg; 3
  bites hatch a shy baby snake that dodges everything and freezes when
  cornered. Touching it hands off to a bright mini snake round (10 apples);
  win fireworks or forfeit, then a "3-2-1-GO!" countdown resumes the main
  game exactly where it left off (the mini round opens with its own countdown
  too). Winning the round sheds 3 segments off your main snake — a shorter
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
src/            game.js, egg-baby.js, minigame.js, chiptune-music.js, jaunty-music.js
tests/          node sandbox suites (vm-based, no framework)
docs/        	  design plans + an integration example
```

Scripts load as plain classic scripts (shared global scope), so keep unique
top-level names across files — verify with:

```sh
cat src/chiptune-music.js src/jaunty-music.js src/game.js src/egg-baby.js src/minigame.js | node --check /dev/stdin
```

## Tests

```sh
node tests/smoketest.js       # core game, modes, config, options/audio
node tests/poopmode-test.js   # poop reveal + lethality
node tests/sound-test.js      # SFX + music integration spies
node tests/engine-test.js     # ChillMusic engine against fake AudioContext
node tests/egg-test.js        # egg/baby lifecycle + AI
node tests/mini-test.js       # mini-game incl. M4 handoff/countdown/resume
```

Each prints `label=value (expect …)` lines — compare against the expectations.

## Planned features (design docs in `docs/`)

- Smooth interpolated snake motion (`smooth-motion-plan.md`)
- CPU-controlled snake for versus mode (`cpu-snake-plan.md`)
- Egg/baby/mini-game milestone M5: polish + remove debug `E` key (`egg-minigame-plan.md`)

## License

MIT — see `LICENSE`.
