# Plan: Option A — smooth snake motion (interpolated rendering)

Goal: the snake glides continuously between grid cells instead of jumping one
cell every `tickMs`. The **simulation stays discrete** (tick-based collision,
food, poop, fruits, levels — untouched); only the **drawing** interpolates.
This is the standard retro approach: low risk, big visual payoff.

Estimated effort: ~80–120 lines in `game.js`, 1–2 hours including tuning.

---

## 1. The timing hook (already exists)

`loop(t)` accumulates into `acc` and runs `tick()` while `acc >= tickMs`:

```js
acc += dt * 1000;
while (acc >= tickMs) { acc -= tickMs; tick(); }
```

After that loop, `acc` is the leftover time inside the current tick interval,
so the interpolation coefficient is simply:

```js
const frac = state === "playing" || state === "menu" || state === "options"
  ? Math.min(acc / tickMs, 1) : 0;
```

Pass `frac` (or store it in a module-level `renderFrac`) into `drawSnake`.
Clamp with `Math.min(..., 0.999)` so a segment never renders at its target
cell exactly while the tick boundary races.

## 2. Position snapshots (by visual slot, not segment identity)

Key insight of the current data model: segment coordinate objects **never
mutate** — eating does `cells.unshift(newHead)` and non-eat ticks `pop()`.
So visual slot `i` at tick N shows cell `cells[i]`, and between ticks slot `i`
moves from its old coordinate to `cells[i]` (= old `cells[i-1]`) — always an
adjacent cell, which is exactly what makes lerping safe.

Implementation:

- Add `let prevCells = null;` (array of `{x, y}` per snake slot).
- At the top of `tick()` (before any mutation), snapshot each alive snake:
  `p.prev = p.cells.map(c => ({ x: c.x, y: c.y }))`.
- Slot `i` renders at `lerp(p.prev[i], p.cells[i], frac)` where:
  - `i >= p.prev.length` (new tail slot from eat/grow ticks): `prev = cur`
    → the new segment sits still until it starts riding the chain. Correct
    for the bulge head too: prev = cur = apple cell, blob pops in place.
  - `p.prev.length > p.cells.length` (pop ticks): slots beyond `cells` were
    just popped — see §4 ghost tail.
- Reset snapshots in `startGame()` / `initMenu()` (`p.prev = copy of cells`)
  and when `acc = 0`.

Draw pixel position: `px = (prev.x + (cur.x - prev.x) * frac) * CELL` —
fractional fillRects on the 256×192 canvas blend edge pixels; `image-rendering:
pixelated` upscales cleanly. Do **not** round to integers: at 130ms/tick an
8px slide would only re-round every ~10 frames and look choppy again.

## 3. Bulge behavior

The bulge flag rides on the segment object, but the taper in `drawSnake` uses
the slot index (`1 - i/(n-1)`), which increments by 1 per tick. Interpolate
the taper factor between `prevIndex` and `curIndex` using `frac` so the swell
shrinks continuously as it rides toward the tail:

- `bulgeF = 1 - lerpIndex/(n-1)` with index easing — the blob glides down the
  body spine (its path is exactly the chain of cell centers).
- Optional ease-in at the apple: swell size 8→10 over the eat tick's `frac`
  instead of appearing at full size.
- Optional ease-out at the tail: when the flag clears, shrink 10→8 over the
  final tick's `frac` (can reuse the ghost tail from §4).

Poop reveal stays tick-logic — unchanged.

## 4. Tail pops — ghost segment

`pop()` removes the tail slot instantly at tick time; without a ghost the
snake's rear end would snap one cell. Store `p.popGhost = { from: prevTailXY,
to: prevNeckXY, pal, i }` on pop ticks and draw one extra shrinking segment
sliding from `from` to `to` over `frac`; clear it on the next tick. Optional —
without it everything else still works, the tail just pops discretely (same
as today).

## 5. Wrap mode crossings

A wrapping slot lerps `(31,y) → (0,y)` and would streak across the whole
board. Detect crossings: `|cur.x - prev.x| > 1` (or same for y). Portal rule:

- Sliding out through the right edge: draw at `x = prev.x + frac` (slides
  off-canvas; fillRect clips automatically).
- Sliding in from the left edge: draw the entering part at `x = -1 + frac`.
- Render both copies for the crossing slot (head is usually the mover, so
  this matters most for slot 0; body slots cross on the following tick and
  need the same rule — the crossing flag per slot handles it uniformly).

Eyes for the crossing head: draw at the entering-side position once the head
is on the new edge; simplest is eyes-only on the entering copy.

## 6. States and speed changes

- **Paused**: loop stops ticking; `frac` freezes mid-slide → snake visibly
  holds its position. On resume, `acc` continues. Fine; alternatively snap
  to grid (`frac = 0`) while paused if preferred.
- **Game over**: dead snakes aren't drawn (particles take over) — the kill
  happens at tick boundaries with grid-aligned explosion; no change needed.
- **Level-ups mid-frac**: `tickMs` shrinking just shortens the next interval;
  `frac = min(acc / newTickMs, 0.999)` handles the switch without glitches.
- **Menu/options demos**: ticks run there too, so the demo snake interpolates
  for free.

## 7. Eyes / bands / shading

Everything in `drawSnake` positions from the segment's pixel coords, so just
replace `c.x * CELL` / `c.y * CELL` with the lerped position. Eyes: use the
head's interpolated position + `p.dir` (direction is discrete — fine, it only
changes at ticks, matching input semantics).

## 8. Testing notes

- Simulation logic untouched → `smoketest.js`, `poopmode-test.js`,
  `sound-test.js` assertions stay valid as-is.
- Add draw-level regressions: call `drawSnake` at `frac = 0.5` mid-move
  (doesn't throw), wrap-crossing slot draws twice without streaking,
  eat-tick new-slot mapping renders stationary bulge at the apple cell.
- Stub canvas in tests already tolerates fractional fillRects.

## 9. Suggested implementation order

1. Snapshot + `frac` plumbing; lerp body slots; verify basic glide.
2. Eat/grow slot mapping (new slots stationary; bulge pops in place).
3. Bulge taper easing by interpolated index.
4. Wrap portal crossings.
5. Ghost tail (optional polish; can ship without).
6. Pause/game-over state rendering checks.
7. Regression tests + cache-version bump.

## 10. Things deliberately out of scope

- Continuous collision (heads hitting things mid-slide) — collisions remain
  tick-grid based, so a snake can visually overlap an obstacle for ≤1 tick;
  this is normal in interpolated snake games and avoids reworking every
  hit test (poop, fruits, snake bodies, wall/wrap logic).
- Interpolating fruit/poop/particle motion — they're static grid props.
- Option B (true float-coordinate kinematics) — 4+ hours, high risk, would
  require rewriting tick/collision/tests; not worth it here.
