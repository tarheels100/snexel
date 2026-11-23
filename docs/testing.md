# testing.md — test harness patterns & how to add checks

Eight Node suites under `tests/`, all driven by `vm.runInNewContext` running
the real browser sources inside stubbed sandboxes — there is no npm, no test
framework. A suite prints `PASS ::`/`FAIL ::` lines and ends with
`<NAME>-SUITE GREEN (n checks)` or lists failures; exit code 0 only when all
checks pass.

Run everything:

```bash
for t in smoketest poopmode-test sound-test engine-test egg-test mini-test touch-test ai-test; do
  node tests/$t.js > /dev/null 2>&1 && echo "$t: GREEN" || echo "$t: FAIL";
done
```

Plus the shared-scope check (classic scripts share one global scope — this
catches duplicate top-level names across files):

```bash
cat src/snake-ai.js src/chiptune-music.js src/jaunty-music.js src/game.js \
  src/egg-baby.js src/minigame.js src/touch.js > /tmp/combined.js && node --check /tmp/combined.js
```

## Suites

| Suite | Loads | Covers |
| --- | --- | --- |
| `smoketest.js` | game.js (+ ChillMusic stub) | start 1P/2P, turns, eat+grow, level milestones, overlay/HUD basics, wrap, pause |
| `poopmode-test.js` | game.js | poop reveal-on-pop lifecycle, lethal piles, death causes, toggle persistence |
| `sound-test.js` | game.js (+ AudioContext stub) | audio unlock on gesture, SFX node counts, mute gates, music routing |
| `engine-test.js` | game.js | tick physics: reversal refusal, wall/wrap, self-collision, vacating tail, foe head-on-head |
| `egg-test.js` | egg-baby.js + game.js | egg roll gating, squash, hatch, baby avoidance soak (must MOVE), capture consume-once, versus gate, pause gate, menu reset |
| `mini-test.js` | minigame.js (+ game.js for handoff) | phases count→play→win→fireworks→fade→done, reversal guard, music stub contract, end-to-end capture handoff, rAF reschedule after mini |
| `touch-test.js` | game.js + egg-baby + minigame + touch.js | routing (solo/versus/mini), overlay `data-key` taps, reversal guards, chip/pad visibility, ghost fade, CPU pad inert/hidden, desktop zero-listener proof |
| `ai-test.js` | snake-ai.js alone, then integrations | engine tiers (cycle/dart/shortcut/flee), presets, determinism, fairness, soaks; D1 demo wiring, D2 baby wiring, D3 CPU versus |

## Sandbox anatomy (see `tests/smoketest.js`)

Tests concatenate the browser source plus a driver script into one string and
run it in a sandbox that stubs the browser:

- `document.getElementById(...)` → object with `getContext()` returning a
  no-op ctx, `style`, `classList`, `textContent`, `innerHTML`. For DOM-state
  assertions, map specific ids to *shared* stub objects the driver can read
  (e.g. touch-test maps `t-dpad-0/1` to `pad0/pad1` so it can inspect
  `style.visibility`).
- `window.addEventListener` captures handlers into a `handlers` map; drivers
  fire `handlers.keydown({code})` instead of real events.
- `localStorage` backed by a plain `store` object (assert persisted values).
- `requestAnimationFrame`: usually a no-op; when the test must prove loop
  behavior (mini-game takeover, rAF chain survival), implement a bounded
  drain queue that actually chains callbacks (minigame.js once stopped
  rescheduling itself → blank board after mini; only a real-chain sandbox
  caught it). Keep drains bounded (e.g. N iterations) to avoid hangs.
- `Math` re-created with a controllable `random` (`box.v`) so spawn rolls are
  deterministic (e.g. `0.99` = no pineapple/banana/egg rolls).
- Because game.js declares top-level globals, driver code appended after the
  source can read/mutate `state`, `players`, `foods`, `tickMs`, call `tick()`
  directly, etc. Namespace files are reached via `window.EggBaby` etc.

## Patterns that keep tests honest

- **Assert movement, not just liveness.** A frozen snake passes any "alive"
  soak vacuously; egg-test asserts >10 distinct head positions in the avoid
  soak and >1 distinct head in the chase soak before capture.
- **Pin seeds.** Brains use `SnakeAI.debug.mulberry32(seed)`; soak checks use
  several fixed seeds and assert exact reproducible results where the seed is
  pinned.
- **Pin knobs when isolating tiers.** Pure cycle tests set `dartRange: 0` so
  dart behavior doesn't leak into sweep-only assertions.
- **Assertions must mirror real rules** — e.g. legal-move tests compare
  against `tick()` semantics including wrap, reversal, vacating tail, and
  foe-eats-next tail blocking; hidden poops are excluded (fairness rule).
- **Don't assert implementation names** in UI copy (mode #2 wording is
  pun-based); assert the absence of forbidden words instead.

## Known harness gotchas

1. **`tests/touch-test.js` nested template literals.** The whole driver is
   itself a template literal passed to `vm.runInNewContext`; a raw backtick
   inside inner driver code silently truncates the outer template (symptom:
   SyntaxError at an unexpected offset or checks vanishing). Inner code must
   use string arrays joined with `'\\n'` (escaped) or plain concatenation.
2. **`SnakeAI.debug.legalMoves()` returns dir STRINGS** (`["u","d","r"]`),
   not objects. Compare `legal.includes(d)`. (This exact bug froze the baby
   snake every tick — commit `72d202b`.)
3. **Sandbox globals vs outer scope.** Variables defined in the outer Node
   file are NOT visible inside `runInNewContext` unless passed in the sandbox
   object (touch-test passes `pad0/pad1/canvasStub/handlers` explicitly; the
   inner rAF stub uses its own inline function, not the outer `raf`).
4. **Fake element identity.** If `getElementById` returns a fresh object per
   call, assertions read a different object than the code mutated. Map ids to
   shared stub objects when asserting DOM state.
5. **CPU/player flags:** code sets `p.cpu = true` but leaves it *undefined*
   for humans — assert `!p.cpu`, not `p.cpu === false`.

## Adding a check

1. Pick the suite matching the subsystem (or add a new suite with the sandbox
   anatomy above).
2. Append driver code after the loaded sources; for `check(name, cond)`
   suites, follow the existing helper; smoketest-style suites push `out`
   lines and compare against expected strings at the bottom.
3. Run the suite; then run all eight suites + the combined `node --check`.
4. If the change touched `index.html` script versions, keep them in sync with
   what tests load (tests read files from `src/`, so versions don't affect
   them — but browsers do care).
