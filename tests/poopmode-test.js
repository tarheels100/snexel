const fs = require('fs');
const noop = () => {};
const store = { snake_best: '0', snake_poop: '0' };
const handlers = {};
const overlay = { innerHTML: '', style: {}, classList: { add: noop, remove: noop } };
const stubCtx = { fillRect: noop, globalAlpha: 1, imageSmoothingEnabled: false, fillStyle: '', fillText: noop };
const sandbox = {
  document: {
    getElementById: id =>
      id === 'overlay'
        ? overlay
        : { getContext: () => stubCtx, textContent: '', innerHTML: '', style: {}, classList: { add: noop, remove: noop } },
  },
  window: { addEventListener: (ev, fn) => { handlers[ev] = fn; }, requestAnimationFrame: noop },
  localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); } },
  requestAnimationFrame: noop,
  handlers, noop, Set, Number, console, store, overlay, performance: { now: () => 0 },
  Math: Object.create(Math, { random: { value: () => 0.99 } }),   // no pineapple rolls
};

let src = fs.readFileSync(__dirname + '/../src/game.js', 'utf8');
src += `
const out = [];
function key(c) { handlers.keydown({ code: c, preventDefault: noop }); }

// ---- menu toggle ----
key('Digit3');
out.push('toggle ON: poopMode=' + poopMode + ' ls=' + store.snake_poop);
key('KeyO');
out.push('options shows ON: ' + (overlay.innerHTML.includes('MODE #2 — <span class="g">ON') && !overlay.innerHTML.includes('poop')));
key('KeyO');   // back to title
key('Digit3');
out.push('toggle OFF: poopMode=' + poopMode + ' ls=' + store.snake_poop);
key('KeyO');
out.push('options shows OFF: ' + overlay.innerHTML.includes('MODE #2 — <span class="dimc">OFF'));
key('KeyO');   // back to title
key('Digit3'); // re-enable

// ---- demo snake eats in menu: no poop spawned ----
const demoHead = players[0].cells[0];
foods[0].x = demoHead.x + 1; foods[0].y = demoHead.y;
tick();
out.push('menu eat: score=' + players[0].score + ' poops=' + poops.length + ' (must be 0)');

// ---- 1P: pile hidden under bulge, revealed when bulge pops off tail ----
startGame(1);
const h = players[0].cells[0];
foods[0].x = h.x + 1; foods[0].y = h.y;
tick();
const appleCell = { x: h.x + 1, y: h.y };
out.push('after eat: poops=' + poops.length + ' at apple square: ' + (poops[0].x === appleCell.x && poops[0].y === appleCell.y) + ' visible=' + poops[0].visible);
foods[0].x = 0; foods[0].y = 0;   // keep future apples away from the snake

let revealedTick = 0;
for (let n = 1; n <= 6 && !poops[0].visible; n++) { tick(); if (poops[0].visible) revealedTick = n; }
out.push('revealed when bulge left tail on tick ' + revealedTick + ' (snake len ' + players[0].cells.length + ')');

// step onto the revealed pile
players[0].cells.forEach((c, i) => { c.x = appleCell.x + 1 + i; c.y = appleCell.y; });
players[0].dir = 'l'; players[0].queue = [];
tick();
out.push('head onto revealed poop: alive=' + players[0].alive + ' cause=' + players[0].cause + ' state=' + state);
out.push('game over note present: ' + overlay.innerHTML.includes('ran into its own pile-up'));

// ---- 2P: P1 eats; pile reveals after P1's bulge pops; P2 then steps on it ----
startGame(2);
const p1h = players[0].cells[0];
foods[0].x = p1h.x + 1; foods[0].y = p1h.y;
tick(); // P1 eats, hidden poop at (10,12)
foods.forEach((f, i) => { f.x = i; f.y = 0; });  // apples far from row 12
for (let n = 1; n <= 6 && !poops[0].visible; n++) tick();
const poopCell = poops[0];
out.push('2P: pile revealed=' + poopCell.visible + ' at (' + poopCell.x + ',' + poopCell.y + ')');
// P2 approaches from below, stepping onto the revealed square
players[1].cells.forEach((c, i) => { c.x = poopCell.x + i; c.y = poopCell.y + 1; });
players[1].dir = 'u'; players[1].queue = [];
tick();
out.push('P2 stepped on revealed poop: alive=[' + players.map(p => p.alive) + '] P2cause=' + players[1].cause);
out.push('game continues (P1 alive): state=' + state);
out.push('food not on visible poop: ' + foods.every(f => !poopAt(f.x, f.y)));
players[0].cells.forEach((c, i) => { c.x = GW - 1 - i; c.y = 3; });
players[0].dir = 'r'; players[0].queue = [];
tick();
out.push('P1 dies -> winner P1: state=' + state + ' overlay=' + overlay.innerHTML.includes('PLAYER 1 WINS'));
out.push('loser note: ' + overlay.innerHTML.includes('P2 ran into a pile-up'));

// ---- death before bulge reaches tail: hidden pile uncovered silently ----
startGame(1);
const h3 = players[0].cells[0];
foods[0].x = h3.x + 1; foods[0].y = h3.y;
tick();                                 // eat; bulge at (10,12), pile hidden
foods[0].x = 0; foods[0].y = 0;
out.push('pile hidden after eat: visible=' + poops[0].visible);
// crash into own body while bulge is still mid-body: up, left, down
key('KeyW'); tick();
key('KeyA'); tick();
key('KeyS'); tick();                    // head re-enters own body square
out.push('died on body: state=' + state + ' cause=' + players[0].cause + ' pile uncovered=' + poops[0].visible);

console.log(out.join('\\n'));
`;

require('vm').runInNewContext(src, sandbox);
