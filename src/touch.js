/* ---------------- touch controls (stage 2 of docs/touch-controls-plan.md) ---------
 * Overlay thumb pads + action chips + tap-to-press overlay rows, on TOUCH
 * DEVICES ONLY. Detection mirrors the CSS media query: the pads live in the
 * DOM but are display:none unless (hover:none)+(pointer:coarse) matches, and
 * this script installs ZERO listeners when that query doesn't match, so
 * desktop stays pure-keyboard with no cost.
 *
 * Routing — everything funnels through the SAME guards as keyboard:
 *   - pads            → steerPad(padIdx, dir): MiniGame.touchSteer while a
 *                       mini round is live; steerPlayer(padIdx or 0) while
 *                       playing. Solo: BOTH pads steer P1 (either thumb).
 *                       Versus: left pad = P1, right pad = P2.
 *   - overlay rows    → data-key attr → handleKeyDown({code}): the exact
 *                       keyboard logic (start 1P/2P, options toggles, track
 *                       switch, rematch, resume, back-to-title).
 *   - pause chip      → MiniGame.togglePause mid-round, KeyP otherwise.
 *   - ✕ chip          → MiniGame.forfeit (visible only mid-mini-round).
 *   - tap frozen board during the "3 2 1 GO!" countdown → skip (Escape).
 * Audio unlock rides game.js's global pointerdown handler + handleKeyDown's
 * ensureAudio(); taps are real gestures so both fire.
 *
 * One delegated pointerdown on .crt handles pads/chips/overlay rows in DOM
 * order (nearest [data-*] wins via closest()). debug.* exposes the routing
 * functions directly so vm tests can drive them without a DOM.
 */
(function () {
  const enabled = !!(window.matchMedia && window.matchMedia("(hover: none) and (pointer: coarse)").matches);

  // last-tap ghost: the pad's center cell briefly shows the arrow you just
  // tapped, fading over ~600ms (opacity decayed by syncChips' 120ms poll).
  // Icons are inline SVG pixel arrows with NO fill attribute — CSS paints
  // them per pad (styles.css). Device Chrome rendered every TEXT arrow
  // character black regardless of font stack / emoji / variation selectors;
  // SVG shapes are immune to fonts entirely.
  const ARROW = {
    u: "M3 0h2v1H3zM2 1h4v1H2zM1 2h6v1H1zM0 3h8v1H0zM3 4h2v4H3z",
    d: "M3 7h2v1H3zM2 6h4v1H2zM1 5h6v1H1zM0 4h8v1H0zM3 0h2v4H3z",
    l: "M0 3h1v2H0zM1 2h1v4H1zM2 1h1v6H2zM3 0h1v8H3zM4 3h4v2H4z",
    r: "M7 3h1v2H7zM6 2h1v4H6zM5 1h1v6H5zM4 0h1v8H4zM0 3h4v2H0z",
  };
  const svgIcon = d => `<svg viewBox="0 0 8 8" aria-hidden="true"><path d="${d}"/></svg>`;
  const GLYPH = { u: svgIcon(ARROW.u), d: svgIcon(ARROW.d), l: svgIcon(ARROW.l), r: svgIcon(ARROW.r) };
  const lastTap = [null, null];      // {dir, t} per pad — debug-readable
  let ghostEls = [null, null];       // bound to the DOM when enabled
  let padEls = [null, null];         // pad containers — P2 pad hides when CPU drives P2

  function markGhost(padIdx, dir) {
    lastTap[padIdx] = { dir, t: Date.now() };
    const g = ghostEls[padIdx];
    if (g) { g.innerHTML = GLYPH[dir] || ""; g.style.opacity = "1"; }
  }

  // hoisted routing functions (debug API works even when disabled)
  function steerPad(padIdx, dir) {
    markGhost(padIdx, dir);
    if (state === "minigame") { if (window.MiniGame) MiniGame.touchSteer(dir); return; }
    if (state !== "playing") return;
    steerPlayer(mode === 2 ? padIdx : 0, dir);
  }
  function tapKey(code) {
    handleKeyDown({ code, preventDefault() {} });   // same handler keyboard uses
  }
  function chipPause() {
    if (state === "minigame") { MiniGame.togglePause(); return; }
    if (state === "playing" || state === "paused") tapKey("KeyP");
  }
  function chipQuit() {
    if (state === "minigame") MiniGame.forfeit();
  }
  function syncChips() {
    if (!enabled) return;
    const inMini = state === "minigame" && !countdown;
    const driving = state === "playing" || inMini;
    // menu/options/pause/game-over: hide the pads entirely (they sit outside
    // the board now, so the overlay can't cover them); chips keep their own
    // visibility logic.
    if (layer) layer.classList.toggle("idle", !driving);
    // D3: the right pad is pointless when the CPU drives P2 — hide it.
    // Otherwise CLEAR the inline value so the CSS `.idle .dpad` rule still wins.
    const cpuP2 = mode === 2 && players[1] && players[1].cpu;
    if (padEls[0]) padEls[0].style.visibility = "";
    if (padEls[1]) padEls[1].style.visibility = (driving && cpuP2) ? "hidden" : "";
    if (pauseChip) pauseChip.classList.toggle("on", driving);
    if (quitChip) quitChip.classList.toggle("on", inMini && MiniGame.isActive());
    for (let i = 0; i < 2; i++) {
      const g = ghostEls[i];
      if (!g) continue;
      const last = lastTap[i];
      const k = !driving || !last ? 0 : 1 - (Date.now() - last.t) / 600;
      g.style.opacity = k > 0 ? String(k.toFixed(2)) : "0";
    }
  }

  const T = {
    enabled,
    debug: { enabled, steerPad, tapKey, chipPause, chipQuit, syncChips, markGhost, lastTap },
  };
  window.TouchControls = T;
  globalThis.TouchControls = T;   // bare `TouchControls` in vm test sandboxes

  if (!enabled) return;

  const crt = document.querySelector(".crt");
  const layer = document.querySelector(".touch-layer");
  ghostEls = [document.getElementById("t-ghost-0"), document.getElementById("t-ghost-1")];
  padEls = [document.getElementById("t-dpad-0"), document.getElementById("t-dpad-1")];
  const pauseChip = document.getElementById("t-pause");
  const quitChip = document.getElementById("t-quit");

  crt.addEventListener("pointerdown", e => {
    const pad = e.target.closest("[data-dir]");
    if (pad) { e.preventDefault(); steerPad(+pad.dataset.pad, pad.dataset.dir); return; }
    const chip = e.target.closest("[data-action]");
    if (chip) { e.preventDefault(); chip.dataset.action === "pause" ? chipPause() : chipQuit(); return; }
    const row = e.target.closest("[data-key]");
    if (row) { e.preventDefault(); tapKey(row.dataset.key); return; }
    // tap anywhere else on the board skips the resume countdown
    if (state === "minigame" && countdown) { e.preventDefault(); tapKey("Escape"); }
  });

  setInterval(syncChips, 120);    // chips appear/hide with state; no event hook into state changes
})();
