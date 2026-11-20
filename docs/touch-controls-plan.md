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

### Stage 2 — D-pad markup, CSS, and wiring (~2.5h)

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

### Stage 3 — presentation + tests (~2h)

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
