# AGENTS.md — Snexel

Guidance for AI agents working in this repo. Read `docs/design.md` for the
architecture, `docs/testing.md` for the test harness patterns, and
`docs/how-to-edit.md` for common change recipes.

## What this project is

**Snexel — Slither & Chill**: a pixel-art snake game in plain HTML/CSS/JS.
No build tools, no bundler, no framework, no npm dependencies. Open
`index.html` and it runs. The only external resource is the Google font
"Press Start 2P" (offline falls back to monospace). All audio is synthesized
live with Web Audio. Repo: https://github.com/tarheels100/snexel

## Hard rules (violating these breaks the game or the user's expectations)

1. **Classic scripts, one shared global scope.** All files in `src/` are
   loaded as plain `<script src>` in `index.html`. Two scripts must never
   declare the same top-level `const`/`let`/`function` name — a duplicate
   throws at load. Keep module-style files inside an IIFE that exposes ONLY a
   `window.X` namespace (`SnakeAI`, `EggBaby`, `MiniGame`, `TouchControls`,
   `ChillMusic`, `JauntyMusic`). Also set `globalThis.X` so bare identifiers
   resolve inside `vm` test sandboxes.
2. **Cache busting.** Every script/stylesheet link carries `?v=N`. When you
   change a file, bump its `?v=` in `index.html`. Bump all files you touch in
   one edit pass so a browser reload picks up the whole change.
3. **Verify with the test suites after every change.** See "Verification"
   below. Also run `node --check` on each changed file and on the concatenation
   of all seven scripts (the shared-scope duplicate-name check).
4. **Determinism.** AI/brains use seeded `mulberry32` RNG instances, never
   `Math.random` (spawn logic may use `Math.random`; tests stub it). Keep AI
   decisions reproducible.
5. **AI fairness.** Engines may only see *visible* poops and current fruit —
   never hidden piles or spawn RNG. Preserve this in any new brain.
6. **UI copy.** The player-facing text must never use the word "poop" — use
   puns ("ran into a pile-up", "MODE #2"). Backend identifiers (`poopMode`,
   `poops`, `snake_poop`) keep their names. Game name is **Snexel** (title
   screen/HUD all-caps `SNEXEL`, docs title-case).
7. **Touch controls.** Only shown on touch devices via
   `@media (hover: none) and (pointer: coarse)`. Icons must be **inline SVG
   pixel paths with explicit CSS colors** — text arrow/emoji glyphs render
   black or invisible on Android Chrome (three failed attempts documented in
   `docs/touch-controls-plan.md`). Never rely on `currentColor` inheritance
   for pad icons/borders. Inline `style.visibility` beats CSS rules —
   `touch.js` clears the inline value rather than setting `"visible"` so the
   `.touch-layer.idle .dpad` CSS keeps winning on non-driving screens.
8. **Don't kill processes broadly** (no `taskkill //F //IM node.exe`); target
   a specific PID, or use tool timeouts.
9. **Git commit messages with quotes/spaces** can hit git pathspec errors on
   Windows — write multiline messages to a temp file and use
   `git commit -F /tmp/commitmsg.txt`.
10. **`artifacts/` is gitignored** — device screenshots live there, don't
    commit them.

## Layout

| Path | Role |
| --- | --- |
| `index.html` | markup: HUD, canvas `.crt`, touch pads/chips, DOM overlay, script order + cache versions |
| `styles.css` | pixel styling, CRT scanlines/vignette, touch pads (media-query gated), safe-area insets |
| `src/game.js` | the whole main game: state machine, tick, draw, audio SFX, music routing, egg/mini hooks, demo snake, CPU wiring, keyboard handling (`handleKeyDown`) |
| `src/snake-ai.js` | standalone pure AI engine (`SnakeAI`) — zero DOM/rAF/sound deps |
| `src/egg-baby.js` | egg → baby pipeline (`EggBaby`) |
| `src/minigame.js` | capture mini-game engine (`MiniGame`) — own rAF loop + keyboard while active |
| `src/touch.js` | touch pads/chips routing (`TouchControls`) |
| `src/chiptune-music.js` | "retro" track engine (`ChillMusic` class-style contract) |
| `src/jaunty-music.js` | mini-game track (`JauntyMusic`, same contract + `eat()`/`win()`) |
| `tests/*.js` | Node `vm`-sandbox suites (see docs/testing.md) |
| `docs/` | design + plan docs (`design.md`, `testing.md`, `how-to-edit.md`, `snake-ai-plan.md`, `egg-minigame-plan.md`, `touch-controls-plan.md`, `smooth-motion-plan.md`) |
| `assets/` | favicons |

## Verification (run after every change)

```bash
for t in smoketest poopmode-test sound-test engine-test egg-test mini-test touch-test ai-test; do
  node tests/$t.js > /dev/null 2>&1 && echo "$t: GREEN" || echo "$t: FAIL";
done
node --check src/<changed>.js
cat src/snake-ai.js src/chiptune-music.js src/jaunty-music.js src/game.js \
  src/egg-baby.js src/minigame.js src/touch.js > /tmp/combined.js && node --check /tmp/combined.js
```

All suites must be green plus the combined-scope check before committing.

## Quick facts

- Canvas `256×192`, grid `32×24`, cells `8px` (`GW/GH/CELL` in game.js);
  `image-rendering: pixelated`.
- States: `"menu" | "options" | "playing" | "paused" | "over" | "minigame"`.
  `"minigame"` is owned by `MiniGame`; the main loop only reschedules itself
  (and runs the resume countdown) while in that state.
- Keys: `1`/`2` start, `O` options, `P` pause, `Esc` menu/forfeit,
  `Enter` rematch, `3`/`M` poop toggle, `4`/`N` wrap toggle, `Z`/`X` mute
  music/SFX, `T` track, `Q` demo-brain toggle (menu), `C` CPU toggle,
  `D` CPU difficulty cycle (only outside play), `E` debug mini launch.
- Persisted localStorage keys: `snake_poop`, `snake_wrap`, `snake_track`,
  `snake_music_muted`, `snake_sfx_muted`, `snake_cpu`, `snake_cpu_lv`,
  `snake_best`.
- Script order matters: music → snake-ai → game → egg-baby → minigame → touch.

## Known gotchas (see docs/testing.md for details)

- `tests/touch-test.js` body is itself a template literal passed to
  `vm.runInNewContext` — nested raw backticks silently truncate it; use
  string arrays joined with `'\\n'`.
- `SnakeAI.debug.legalMoves()` returns **dir strings** (`["u","r"]`), not
  objects — compare with `.includes(d)`, not `m.d`.
- vm sandboxes must emulate real `requestAnimationFrame` chaining (a loop
  that forgets to re-register rAF leaves a blank board — happened in
  minigame.js).
- Tests must assert *actual movement* (distinct head positions) so a frozen
  snake can't pass a soak check vacuously.
- Main music is FULLY muted during the mini-game via `musicTarget()` clamp;
  unmuting (`Z`) or track switching (`T`) mid-mini must not resurrect it.

## Current status

SnakeAI plan Phases A–D3 shipped (engine tiers, presets, demo attract snake,
baby flee tier, CPU versus). Egg/mini pipeline M1–M4 shipped; M5 (polish,
remove debug `E` key) pending. Optional pending: `docs/smooth-motion-plan.md`
Option A. Real-device touch verification on Android is ongoing — the SVG-icon
fix (commit `7b4ae7a`) is device-proven in prior screenshots.
