# Touch controls plan — overlayed D-pads for touch devices

Goal: play Snexel on a phone/tablet with thumbs, no keyboard. Controls are
overlayed on the game board and **only appear on touch-screen devices**.
Keyboard behavior stays exactly as-is on desktop.

## Design decisions (confirmed)

1. **Detection** — CSS media query `@media (hover: none) and (pointer: coarse)`,
   mirrored in JS via `matchMedia` (no UA sniffing). Devices whose primary
   pointer is a finger get the pads; laptops with a trackpad never do. Touch
   laptops *will* show the pads — that's correct behavior for `pointer: coarse`
   (and mouse clicks on the pads work as a harmless bonus).
2. **Layout** — classic 3×3 cross D-pads overlaying the board's bottom corners:
   - **left pad → player 1** (green, matches WASD side), **right pad → player 2** (orange, arrow side). Versus = one pad per thumb, natural mapping.
   - **Solo**: *both* pads steer player 1 — either thumb works, no hunting for the "correct" side.
   - **Mini-game**: both pads steer the mini snake (it's always solo), since the mini board sits mid-canvas under both thumbs.
   - Translucent pixel-art buttons (~35% alpha) so snakes passing under them stay visible; brighten + press-offset on touch.
3. **Input model** — tap = one queued direction, exactly like a keydown:
   goes through the same queue + same 180°-reversal guard as keyboard.
   `pointerdown` only (no `click`) so there's no ghost double-trigger;
   `touchstart` gets `preventDefault()` to kill scroll/zoom/long-press menus.
4. **Action buttons** — one ⏚ pause chip (top-right of board) that toggles
   game pause and mini pause; menu/game-over overlays become tap targets
   (tap a listed option = pressing its key) rather than adding more chips.
   Esc-role chips only where needed: a small ✕ forfeit during the mini-game.
5. **New file** `src/touch.js` — classic script, `window.TouchControls`
   namespace, loaded after `minigame.js` (it needs `steerPlayer` +
   `MiniGame.touchSteer`). No new state; nothing persists.

## Work order

### Stage 1 — viewport fit (do this first; pads are useless on an
off-screen canvas) (~1h) ✅ IMPLEMENTED

- `styles.css`: on coarse-pointer devices, scale the canvas to the viewport:
  `width: min(100vw, calc(100vh * 256/192))` (keeps the 4:3 pixel aspect,
  `image-rendering: pixelated` still valid at non-integer scale), centered,
  with safe-area insets (`env(safe-area-inset-*)`). Hint text drops to 6px
  or hides below the board.
- Page-level `touch-action: manipulation` (kills double-tap zoom),
  `overscroll-behavior: none`, `-webkit-tap-highlight-color: transparent`,
  `user-select: none` on the screen area.
- Landscape phones: board fits height; portrait: fits width — pads anchor to
  the *canvas corners*, not the window, so they stay on the board either way.

**Implementation notes (shipped: styles.css?v=7 + index.html):**
- The plan assumed a fixed 1024×768 canvas, but `styles.css` already had a
  `--board-w` clamp scaling the board to viewport width/height — the
  "off-screen canvas" risk was already covered. Stage 1's actual deliverables
  became: gesture suppression, safe-area insets, phone-scale type, and a
  smaller vertical chrome budget.
- `--chrome: 190px` (desktop HUD/hint budget) is now a CSS var; touch devices
  drop it to 130px since HUD/hint type shrinks (11→8px, 8→6px), letting the
  board claim more of the screen.
- Touch width cap uses `100vw − 2·max(10px, safe-area-inset-left)` instead of
  `92vw`; the clamp floor drops to 200px for 320px-wide phones.
- Viewport meta existed already; added `viewport-fit=cover` so `env()` safe
  areas are non-zero on notched devices.
- Overlay typography scales down on touch (title 22→15px, lines 12→8px,
  notes 9→7px); long option lines wrap centered.
- Desktop layout untouched (media query gates everything); dvh stays the
  progressive enhancement over vh.

### Stage 2 — D-pad markup, CSS, and wiring (~2.5h) ✅ IMPLEMENTED

- `index.html`: `.touch-layer` inside `.screen-wrap` (position:relative),
  `pointer-events: none` container with `pointer-events: auto` buttons; two
  `.dpad` grids (`data-player="0"/"1"`) of ▲▼◀▶ buttons using Press Start 2P
  glyphs; pause chip + mini ✕ chip. Markup always present; hidden entirely by
  the media query on non-touch devices (zero JS/CSS cost for desktop).
- Extract from `game.js`'s keydown handler a shared
  `steerPlayer(i, dir)` (direction legality + `p.queue.push` + audio unlock).
  Keyboard handler calls it; touch calls it with the pad's player index —
  one guard for both input paths, versus/solo rules unchanged.
- Add public `MiniGame.touchSteer(dir)` using MiniGame's existing reversal
  guard + queue (mirror of its arrow-key handler), and make `MiniGame.togglePause()` public.
- `touch.js`:
  - install listeners only when `matchMedia("(hover: none) and (pointer: coarse)").matches`;
  - pad routing: `state === "minigame"` → both pads `MiniGame.touchSteer`;
    else solo → both pads steer player 0; versus → pad → player index;
    ignore during `menu`/`options`/`over` (pads are hidden then anyway);
  - pause chip: `state === "minigame"` ? mini pause : game pause;
  - overlay taps: click handlers mapping to `startGame(1/2)`, `initMenu()`,
    `initOptions()`, rematch — keyboard still works in parallel;
  - debug API: `debug.enabled`, `debug.press(pad, dir)` for tests.

**Implementation notes (shipped: game.js?v=40, minigame.js?v=6, touch.js?v=1,
styles.css?v=8, index.html):**
- Anchor element is `.crt` (the class index.html actually uses), not
  `.screen-wrap`; pads/chips are DOM *inside* it, below the overlay div so
  overlays visually cover them while showing.
- `steerPlayer(i, dir)` extracted as planned; additionally the whole keydown
  handler became named `handleKeyDown(e)` — overlay taps call
  `handleKeyDown({code})` directly instead of dispatching synthetic
  KeyboardEvents (works in vm tests, one logic path for keys+taps).
- `MiniGame` gained `touchSteer(dir)` (shared `queueDir` guard),
  `togglePause()`, and `forfeit()` (beyond plan — backs the ✕ chip).
- One delegated `pointerdown` on `.crt` (closest `[data-dir]` → pad,
  `[data-action]` → chip, `[data-key]` → overlay row, else countdown-skip).
- Overlay templates gained `data-key` attrs: menu rows (Digit1/Digit2/O/Esc),
  options rows (Digit3/Digit4/Z/X/T/Esc — so touch users CAN toggle
  poop/wrap/mute/track, resolving the plan's "out of scope" note), pause
  RESUME (KeyP), game-over REMATCH/Esc.
- Chip visibility: `setInterval(syncChips, 120ms)` polls state (no event hook
  exists for state transitions); pause chip shows while playing or mid-mini,
  ✕ chip only mid-round (not during countdown).
- Tapping the frozen board during the resume countdown skips it (Escape).
- Solo routing: both pads steer P1; versus pad→player index; mini rounds:
  both pads steer MiniGame regardless of mode.
- Pads/chips use `touch-action: none`; small-phone media query shrinks the
  cross to 36px cells so both pads fit a ~300px board.
- `window.TouchControls` + `globalThis.TouchControls` alias; debug API is
  `debug.{enabled, steerPad, tapKey, chipPause, chipQuit, syncChips}`.
- Listeners install only when `matchMedia("(hover: none) and (pointer: coarse)")`
  matches; tests don't load touch.js yet (Stage 3 adds `touch-test.js`).
  (Shipped in Stage 3: touch-test.js loads game+egg+mini+touch in one vm scope.)

**Placement revision (post-device-test, styles.css?v=10 + touch.js?v=2):**
the plan's corner-overlay pads were replaced by pads OUTSIDE the board —
- portrait: below the board (corners of its width); landscape: to the sides,
  vertically centered against it — via orientation media queries; pads
  overflow `.crt` (absolute children escape it) and `.game` reserves the
  strip with padding (landscape board-width cap subtracts both strips).
- pad cell size is one knob, `--pad: 44px` (36px on ≤340px phones); every
  offset/reservation calc reads `3*var(--pad) + 16px`.
- keyboard hint hidden on touch devices (its keys are meaningless there).
- pads hidden entirely when nothing is drivable (menu/options/pause/over or
  countdown): `syncChips` toggles `.idle` on the layer; chips keep their own
  logic, and overlay taps still press menu/rematch/resume.

### Stage 3 — presentation + tests (~2h) ✅ IMPLEMENTED

**Implementation notes (shipped: touch.js?v=3, minigame.js?v=7, styles.css?v=11, index.html):**
- Ghost is the pad's EMPTY CENTER CELL (`.tghost`, grid-area 2/2): the tapped
  arrow glyph appears there and `syncChips` (120ms poll) decays
  `style.opacity` over ~600ms — no CSS animation/rAF needed, and the decay is
  deterministic in vm tests via a real `setTimeout`.
- Player colors moved to the `.dpad` level so buttons AND ghost inherit via
  `currentColor` (`border: 2px solid currentColor`).
- Glyphs carry U+FE0E (variation selector-15): Android's emoji font otherwise
  hijacks ▲◀▶▼/✕ into black emoji that ignore CSS `color` — device report
  said pads rendered black; FE0E forces the text presentation (touch.js?v=4,
  index.html markup entities `&#9650;&#xFE0E;` etc).
- `MiniGame.debug.turnQueue()` getter added (v7) — the routing proof; `turn(d)`
  stays the test-only push setter.
- `touch-test.js`: 34 checks, TWO sandboxes — touch-enabled (fake DOM: crt /
  layer / chips / ghosts, delegated pointerdown with per-selector `closest()`)
  and desktop (matchMedia false + a `document` Proxy trap proving ZERO DOM
  access). Covers: listener wiring, menu/options/game-over row taps incl.
  preventDefault, solo both-pads→P1, versus pad→player, reversal guards
  (queue-relative — legal `u→l` chains pass, `r` after queued `l` dies),
  mini routing + mini pause/forfeit + countdown board-tap skip (`miniFrom`
  forced since `MiniGame.start` is called directly), syncChips idle/chip
  visibility across menu/play/mini/over, ghost lit→faded on a real clock,
  keyboard regression through the extracted `handleKeyDown`/`steerPlayer`.
- Real-verification of visuals still needs the manual mobile checklist below.

- Active state: brighter fill, 1px pixel "press" offset, player-colored border;
  a fading ghost of the last pressed arrow so mis-taps are legible.
- `tests/touch-test.js` (vm sandbox, DOM stub registry of fake buttons with
  recorded handlers + fake `matchMedia`): coarse=true → listeners installed;
  press left pad up → players[0].queue gets "u"; reversal rejected; versus
  routing pad0→p0 pad1→p1; minigame routing both pads → mini queue; pause
  chip toggles both states; coarse=false → nothing installed.
- Regression: keyboard steering path unchanged (`steerPlayer` refactor is
  behavior-preserving); audio unlock still fires on the pads' pointerdown
  (existing global pointerdown listener already covers it).
- Manual mobile checklist (real device): portrait + landscape, solo + versus,
  mini-game steering, pause/resume, wrap-mode edges, iOS Safari zoom/scroll
  dead, no stray taps through overlays.

### Stage 4 — optional niceties (later, unranked)

- Swipe on the board = steer (dominant axis, >24px delta) as a pad-free
  alternative for solo; nice, but pads are primary for versus.
- Device orientation prompt hint in `.hint` for portrait phones.
- Haptics (`navigator.vibrate` 10ms on eat) if device supports it.

## Total estimate: ~5.5h (Stages 1–3), + ~1h for Stage 4.

## Risks

- **Canvas scaling at non-integer sizes**: `pixelated` keeps crispness, but
  test odd viewport widths (e.g. 1023px) — if shimmer looks uneven, snap the
  canvas CSS size to multiples of 8/6px cells via `clamp()` steps.
- **Hybrid devices** (touch + trackpad): `hover: none` heuristic may hide the
  pads on rare hybrids; acceptable — keyboard is still available. If it ever
  bites, fall back to `(pointer: coarse)` alone.
- **Two thumbs on a phone in versus**: pads overlay board corners where snakes
  often travel; the 35% translucency mitigates but don't make buttons opaque.
- **iOS gesture conflict**: preventDefault on pad `touchstart` is required;
  verify taps don't dead-zone the board's own pointerdown audio unlock.

## Out of scope (for now)

- On-screen keyboards for the O/Z/X/T/3/4 global keys (rare enough; the
  Options overlay can later gain tap toggles — easy follow-on).
- Mobile browser PWA/install.
- Gamepad.
