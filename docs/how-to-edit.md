# how-to-edit.md — recipes & landmines

Practical cookbook for common changes. Rules live in `AGENTS.md`; architecture
in `design.md`; test patterns in `testing.md`.

## Always, after any src/styles change

1. Bump `?v=` in `index.html` for every file you touched (styles.css too).
   Do all bumps in one edit pass so a reload is coherent.
2. Run all eight suites + combined `node --check` (see `testing.md`).
3. Commit with `git commit -F /tmp/commitmsg.txt` (quoted words/spaces in
   messages can trigger git pathspec errors on Windows). Push to `origin main`.

## Add a keyboard toggle that persists

Mirror the existing pattern in `handleKeyDown` (src/game.js):

```js
let wrapMode = localStorage.getItem("snake_wrap") === "1";
...
if (code === "Digit4" || code === "KeyN") {
  wrapMode = !wrapMode;
  localStorage.setItem("snake_wrap", wrapMode ? "1" : "0");
  initMenu();            // or repaint(); — screens must reflect the change
  repaint();             // if called during options
}
```

Notes:
- Global toggles go *before* the state-machine dispatch so they work in any
  state. If a key doubles as gameplay (e.g. `D` steers P1 during play),
  guard it: `if (code === "KeyD" && (state === "menu" || state === "options" || state === "over"))`.
- Add matching rows in `initOptions()`/`initMenu()` overlay HTML with
  `data-key="KeyX"` so touch chips can press them (touch.js routes
  `[data-key]` taps into `handleKeyDown({code})`).
- Add a `tests/` check for persistence (`store[...]` after toggle) and, if
  the toggle affects gameplay, a behavior check.

## Add a touch chip or overlay button

- Markup in `index.html` inside `.touch-layer`: use `data-action` (handled by
  touch.js chip logic) or `data-key` (generic key press). Buttons need
  explicit `aria-label`.
- Icons: inline SVG pixel paths (`viewBox="0 0 8 8"`) — never text glyphs
  (Android renders arrows/emoji black). Color them with explicit CSS rules
  targeting the pad/chip class, never `currentColor`.
- Visibility: CSS media query gates touch UI; pad "not drivable" hiding is
  handled by `.touch-layer.idle` in `TouchControls.syncChips()`. Do not set
  inline `visibility: "visible"` — it beats CSS; clear inline instead.

## Add a special fruit / hazard

1. Add a `GAME_CONFIG` block (counts/chance/radius).
2. Spawn inside `tick()`'s eat path with the "one special per bite" roll
   order (pineapple → banana → egg), respecting `maxOnScreen` caps and
   `occupiedSet()` (which includes snake bodies, visible poops, eggs, baby).
3. Draw it in `drawMainScene()` between board and snakes; sprite = small
   array-of-arrays pixel map via `drawCell`, shimmer with time `t`. Keep it
   inside one 8px cell.
4. Wire eating effect in `tick()`; include its cell in occupancy; add a death
   `cause` string if it can kill, and a game-over overlay line for it.
5. Update `SnakeAI` world/danger map so brains treat it correctly
   (`fruits[].kind`, hazard cells, lethal-vs-high semantics) — engine tests
   must cover the new hazard semantics.
6. Add a suite check (spawn, effect, kills, occupancy) + a soak if it can
   kill snakes.

## Tune the AI

Prefer knob changes over engine edits:

- `GAME_CONFIG.ai.{demo,baby,cpu.easy,cpu.normal,cpu.hard}` merges over
  `SnakeAI.presets(name)` — tune speeds/slacks/jitters there.
- Knob meanings (see `snake-ai-plan.md` §3–§4): `cycle` tier on/off,
  `shortcutSlack` cycle-room required for jumps, `shortcutMax` max jump,
  `dartRange` chase radius, `slack` flood-fill room below which a move is a
  self-trap, `jitter` randomness among runners-up, `hesitation` chance to
  keep the old direction (baby interceptability!), `zoneReach` steps a foe
  must be near blast fruit for it to be lethal to the brain,
  `specialWeight`/`specialMaxDist` spectacle-fruit temptation,
  `oppLookahead` foe projection depth.
- Behavior changes need soak checks on pinned seeds (alive + ate + tier),
  and movement assertions (distinct heads) so a frozen snake can't pass.

## Keep the baby catchable

Any baby behavior change must keep: hesitation (~30%), freeze-when-cornered
(no death), slower clock, and capture-by-overlap. A perfect evader kills the
egg→mini-game pipeline — `egg-test.js` chase soak asserts capture within a
few dozen steps.

## Audio changes

- One shared `AudioContext` (`audioCtx` in game.js); new engines take
  `{ctx}` and must respect the mute contract (`setVolume`, plus
  `musicTarget()` clamp semantics — main track stays fully muted while
  `state === "minigame"`).
- New SFX: one-shot oscillator/noise bursts, gated by `sfxMuted` AND
  `demoQuiet()` (menu is silent). Keep relative loudness: eat chomp loudest,
  plop quietest of the eat-related sounds; countdown beeps quiet but
  unmistakable.
- Never start playback without `ensureAudio()` having run (browser autoplay
  policy unlocks on first `keydown`/`pointerdown`).

## UI copy

- Never use the word "poop" in player-facing text — puns only
  ("ran into a pile-up"). Identifiers keep real names.
- Title/HUD: `SNEXEL` all caps; docs prose: **Snexel**.
- Overlay rows follow the existing markup shape
  (`<div data-key="KeyX"><span class="key">X</span>LABEL — <span class="g">STATE</span></div>`).

## Landmines (each caused a real bug)

- Duplicate top-level names across scripts → load-time SyntaxError; the
  combined `node --check` catches it.
- Mini-game takeover without rescheduling the main rAF loop → blank board
  after mini ends.
- Unmute-order: unmute AFTER flipping `state` off `"minigame"`, or
  `musicTarget()` re-clamps to 0.
- `EggBaby`/foe world reads `p.queue` (game.js field) — `p.turnQueue` is
  undefined and silently disables baby awareness.
- `SnakeAI.debug.legalMoves()` returns dir strings; compare `.includes(d)`.
- Tests asserting only "alive" can pass on a frozen snake.
- Inline `style` beats CSS rules (pad visibility clearing, HUD opacity
  restore) — remember to reset inline styles when handing back.
- Nested template literals in `tests/touch-test.js` truncate the driver.
- Cache versions: browsers happily serve stale `?v=` scripts — bump them.
