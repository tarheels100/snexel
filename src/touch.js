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

  // hoisted routing functions (debug API works even when disabled)
  function steerPad(padIdx, dir) {
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
    if (pauseChip) pauseChip.classList.toggle("on", state === "playing" || inMini);
    if (quitChip) quitChip.classList.toggle("on", inMini && MiniGame.isActive());
  }

  const T = {
    enabled,
    debug: { enabled, steerPad, tapKey, chipPause, chipQuit, syncChips },
  };
  window.TouchControls = T;
  globalThis.TouchControls = T;   // bare `TouchControls` in vm test sandboxes

  if (!enabled) return;

  const crt = document.querySelector(".crt");
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
