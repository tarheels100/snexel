const fs = require('fs');
const noop = () => {};
const stubCtx = {
  fillRect: noop, globalAlpha: 1, imageSmoothingEnabled: false, fillStyle: '', fillText: noop,
  beginPath: noop, arc: noop, fill: noop, stroke: noop, strokeStyle: '', lineWidth: 1,
};
let box = { v: 0.99 };   // controllable Math.random: 0.99 = no pineapple rolls by default
const handlers = {};
const store = { snake_best: '0', snake_poop: '0', snake_music_muted: '0', snake_sfx_muted: '0', snake_wrap: '0', snake_track: 'chill' };
const sandbox = {
  document: {
    getElementById: () => ({
      getContext: () => stubCtx,
      textContent: '', innerHTML: '', style: {},
      classList: { add: noop, remove: noop },
    }),
  },
  window: {
    addEventListener: (ev, fn) => { handlers[ev] = fn; },
    requestAnimationFrame: noop,
    ChillMusic: class {
      constructor() { this.playing = false; }
      async start() { this.playing = true; }
      stop() { this.playing = false; }
      setVolume() {} setIntensity() {} eat() {} gameOver() {}
    },
  },
  localStorage: { getItem: k => store[k] ?? '0', setItem: (k, v) => { store[k] = String(v); } },
  requestAnimationFrame: noop,
  handlers, noop, store, Set, Number, console, performance: { now: () => 0 }, box,
  Math: Object.create(Math, { random: { value: () => box.v } }),
};

let src = fs.readFileSync(__dirname + '/../src/game.js', 'utf8');

src += `
const out = [];
function key(c) { handlers.keydown({ code: c, preventDefault: noop }); }

key('Digit2');
out.push('start2P: state=' + state + ' players=' + players.length + ' foods=' + foods.length);

key('KeyW'); key('ArrowUp');
tick(); tick();
out.push('turns: P1 dir=' + players[0].dir + ' P2 dir=' + players[1].dir);

// eat test: put food directly in front of P1 head along its dir
const [dx, dy] = DIRS[players[0].dir];
foods[0].x = players[0].cells[0].x + dx; foods[0].y = players[0].cells[0].y + dy;
const len0 = players[0].cells.length;
tick();
out.push('eat: score=' + players[0].score + ' len ' + len0 + '->' + players[0].cells.length + ' foods=' + foods.length + ' tickMs=' + tickMs);

// level curve: bite 2 = first level-up (milestones 2,6,14,30,62,126… doubling)
// milestones: intervals 8, 16, 32, capped at +32 → cumulative 8, 24, 56, 88…
// solo mode so P2 can't interfere with the deterministic bite count
key('Escape'); key('Digit1');
for (let i = 0; i < 8; i++) {
  foods[0].x = players[0].cells[0].x + DIRS[players[0].dir][0];
  foods[0].y = players[0].cells[0].y + DIRS[players[0].dir][1];
  tick();
}   // 8 bites -> first level-up
out.push('bite8: level=' + level + ' tickMs=' + tickMs.toFixed(1) +
  ' (expect ' + speedFor(levelForBites(8)).toFixed(1) + ' at current speedDiv)');
try { drawLevelBanner(); out.push('banner draw after level-up: ok'); }
catch (e) { out.push('banner draw THREW: ' + e.message); }
key('Escape'); key('Digit2');   // restore versus mode for the remaining collision tests
out.push('curve: ' + [7, 8, 24, 56, 88, 120, 152, 184].map(b => b + '->L' + levelForBites(b) + '@' + speedFor(levelForBites(b)) + 'ms').join(' '));

// config knobs: solo grow=2, speedDiv=1.5
GAME_CONFIG.solo.grow = 2; GAME_CONFIG.solo.speedDiv = 1.5;
key('Escape'); key('Digit1');
out.push('cfg solo start: tickMs=' + tickMs.toFixed(1) + ' (expect 86.7)');
foods[0].x = players[0].cells[0].x + DIRS[players[0].dir][0]; foods[0].y = players[0].cells[0].y + DIRS[players[0].dir][1];
tick();
out.push('cfg grow=2 eat: len=' + players[0].cells.length + ' (expect 6) score=' + players[0].score);
GAME_CONFIG.solo.grow = 1; GAME_CONFIG.solo.speedDiv = 1;

// config knobs: versus apples=3
GAME_CONFIG.versus.apples = 3;
key('Escape'); key('Digit2');
out.push('cfg versus start: foods=' + foods.length + ' (expect 3) players=' + players.length);
GAME_CONFIG.versus.apples = 2;

// ---- pineapple bomb ----
key('Escape'); key('Digit1');             // fresh solo, controlled random
box.v = 0.05;                            // 0.05 < chance 0.10 -> apple eat rolls a pineapple
foods[0].x = players[0].cells[0].x + DIRS[players[0].dir][0];
foods[0].y = players[0].cells[0].y + DIRS[players[0].dir][1];
tick();
box.v = 0.99;
out.push('pineapple roll: pines=' + pineapples.length + ' (expect 1)');
try { drawPineapple(pineapples[0], 0); out.push('pineapple sprite draw: ok'); }
catch (e) { out.push('pineapple sprite THREW: ' + e.message); }
const hx = players[0].cells[0].x, hy = players[0].cells[0].y;
pineapples[0].x = hx + 1; pineapples[0].y = hy;
poops = [{ x: hx + 3, y: hy, visible: true }, { x: 1, y: 1, visible: true }];
foods[0].x = 1; foods[0].y = 1;                 // far apple survives the blast
foods.push({ x: hx + 2, y: hy + 2 });           // near apple is inside the blast
try { drawExplosions(); out.push('no-blast zone draw: ok'); }
catch (e) { out.push('no-blast zone THREW: ' + e.message); }
tick();                                          // eat pineapple -> boom
out.push('boom: score=' + players[0].score + ' len=' + players[0].cells.length +
  ' pines=' + pineapples.length + ' poops=' + poops.length + '(expect 1 far)' +
  ' foods=' + foods.length + ' (expect 2 refilled) blasts=' + explosions.length +
  ' alive=' + players[0].alive);
try { drawExplosions(); out.push('blast zone draw: ok'); }
catch (e) { out.push('blast zone THREW: ' + e.message); }

key('Escape'); key('Digit2');              // versus: blast kills opponent head only
const h1 = players[0].cells[0];
pineapples.push({ x: h1.x + 1, y: h1.y });
players[1].cells = [{ x: h1.x + 3, y: h1.y + 1 }, { x: h1.x + 4, y: h1.y + 1 },
                    { x: h1.x + 5, y: h1.y + 1 }, { x: h1.x + 6, y: h1.y + 1 }];
players[1].dir = 'l'; players[1].queue = [];
tick();                                  // P1 eats pineapple; P2 head caught (dist ~2)
out.push('versus boom kill: P1 alive=' + players[0].alive + ' P2 alive=' + players[1].alive +
  ' P2cause=' + players[1].cause + ' state=' + state);

key('Escape'); key('Digit1');              // banana roll + cross blast (solo)
pineapples.push({ x: 0, y: 0 });           // pineapple cap reached -> banana gets the roll
box.v = 0.05;
foods[0].x = players[0].cells[0].x + DIRS[players[0].dir][0];
foods[0].y = players[0].cells[0].y + DIRS[players[0].dir][1];
tick();                                   // apple eaten: pineapple roll capped out, banana roll hits
box.v = 0.99;
out.push('banana roll: bananas=' + bananas.length + ' (expect 1)');
try { drawBanana(bananas[0], 0); out.push('banana sprite draw: ok'); }
catch (e) { out.push('banana sprite THREW: ' + e.message); }
const bx = players[0].cells[0].x + 1, by = players[0].cells[0].y;   // bite cell ahead
bananas[0].x = bx; bananas[0].y = by;
pineapples[0].x = 0; pineapples[0].y = by;                // pineapple on banana's ROW -> destroyed
poops = [{ x: 5, y: by, visible: true }, { x: bx, y: 3, visible: true }, { x: 1, y: 1, visible: true }];
foods[0].x = 1; foods[0].y = 1;                           // far apple survives
foods.push({ x: 12, y: by });                             // apple on banana's row -> destroyed
tick();                                                   // eat banana -> row+column blast
out.push('cross blast: score=' + players[0].score + ' len=' + players[0].cells.length +
  ' bananas=' + bananas.length + ' pines=' + pineapples.length + ' (expect 0)' +
  ' poops=' + poops.length + ' (expect 1 far) foods=' + foods.length + ' (expect 2)' +
  ' cross=' + crossFlash.length + ' alive=' + players[0].alive);
try { drawCrossFlash(); out.push('cross zone draw: ok'); }
catch (e) { out.push('cross zone THREW: ' + e.message); }

key('Escape'); key('Digit2');              // versus: opponent head on banana row dies
const bh = players[0].cells[0];
bananas.push({ x: bh.x + 1, y: bh.y });
players[1].cells = [{ x: 20, y: bh.y }, { x: 21, y: bh.y }, { x: 22, y: bh.y }, { x: 23, y: bh.y }];
players[1].dir = 'l'; players[1].queue = [];   // new head (19,12) shares row 12 -> killed
 tick();
out.push('versus cross kill: P1 alive=' + players[0].alive + ' P2 alive=' + players[1].alive +
  ' P2cause=' + players[1].cause + ' state=' + state);

key('Escape'); key('Digit2');              // fresh versus for the collision tests below

// wall death for P1
players[0].cells.forEach((c, i) => { c.x = GW - 1 - i; c.y = 5; });
players[0].dir = 'r'; players[0].queue = [];
tick();
out.push('wall: P1 alive=' + players[0].alive + ' particles=' + particles.length + ' state=' + state);

// self collision: head will run into its own neck
players = [makeSnake(5, 10, 'u', PAL.p1)];
players[0].cells = [{x:5,y:10},{x:5,y:9},{x:4,y:9},{x:4,y:10}];
players[0].dir = 'u'; // newHead (5,9) is body[1]
eliminations = []; foods = [{x:20,y:20}];
tick();
out.push('self-collide: alive=' + players[0].alive);

// head-to-head in 2P
players = [makeSnake(5, 10, 'r', PAL.p1), makeSnake(7, 10, 'l', PAL.p2)];
eliminations = []; foods = [{x:20,y:20}];
tick();
out.push('head-to-head: alive=[' + players.map(p => p.alive) + '] state=' + state);

// criss-cross swap (A enters B's vacating tail, B enters A's vacating tail)
players = [makeSnake(5, 10, 'r', PAL.p1), makeSnake(6, 10, 'l', PAL.p2)];
players[1].dir = 'l'; // heads adjacent -> both die head-to-head next tick, so instead:
players = [makeSnake(4, 10, 'r', PAL.p1), makeSnake(7, 10, 'l', PAL.p2)];
// P1 cells: (4,10)(3,10)(2,10)(1,10); P2 cells: (7,10)(8,10)(9,10)(10,10) -> swap through gap, no collision
eliminations = []; foods = [{x:20,y:20}];
tick();
out.push('advance past each other: alive=[' + players.map(p => p.alive) + '] heads=' +
  players.map(p => p.cells[0].x).join(','));

// winner determination: P2 survives longer
players = [makeSnake(0, 5, 'r', PAL.p1), makeSnake(GW - 1, 15, 'l', PAL.p2)];
eliminations = []; foods = [{x:16,y:12}];
players[0].alive = false; // pretend P1 already died earlier... do it properly:
players = [makeSnake(1, 5, 'r', PAL.p1), makeSnake(GW - 2, 15, 'l', PAL.p2)];
eliminations = []; foods = [{x:16,y:12}];
players[1].cells.forEach((c,i)=>{ c.y = 23 + i; }); // force P2 to hit top? dir l, set wall via y
players[1].cells[0].y = GH - 1; players[1].cells.forEach((c,i)=> c.y = GH - 1 + i); // out of bounds tail... simpler: move P2 head to bottom wall
players = [makeSnake(1, 5, 'r', PAL.p1), makeSnake(20, 22, 'l', PAL.p2)];
eliminations = []; foods = [{x:16,y:12}];
players[1].cells = [{x:20,y:23},{x:19,y:23},{x:18,y:23},{x:17,y:23}];
players[1].dir = 'd';
tick(); // P2 hits bottom wall, P1 keeps moving (P1 dir r, safe)
out.push('P2 died, P1 alive=' + players[0].alive);
players[0].cells.forEach((c,i)=>{ c.x = GW - 1 - i; c.y = 5; });
players[0].dir = 'r';
tick(); // P1 hits wall -> game over, P1 was last eliminated -> P1 wins
out.push('game over: state=' + state + ' winner logic ran');

// ---- mute options ----
key('Escape');                         // back to menu
key('KeyZ'); key('KeyX');
out.push('mute toggles: music=' + musicMuted + ' sfx=' + sfxMuted + ' ls=' + store.snake_music_muted + ',' + store.snake_sfx_muted);
key('KeyO');
out.push('options open: state=' + state + ' shows muted: ' + (el.overlay.innerHTML.includes('MUSIC — <span class="dimc">MUTED') && el.overlay.innerHTML.includes('SFX — <span class="dimc">MUTED')));
key('KeyZ');                           // unmute music only
out.push('music back ON: ' + (!musicMuted && sfxMuted) + ' ls=' + store.snake_music_muted + ',' + store.snake_sfx_muted + ' options ON: ' + el.overlay.innerHTML.includes('MUSIC — <span class="g">ON'));
key('KeyX');
out.push('both unmuted: ' + (!musicMuted && !sfxMuted) + ' ls=' + store.snake_music_muted + ',' + store.snake_sfx_muted);
key('KeyO');                           // back to title
out.push('back to title: state=' + state + ' menu lean: ' + (!el.overlay.innerHTML.includes('MUTED') && !el.overlay.innerHTML.includes('WRAP MODE') && el.overlay.innerHTML.includes('1 PLAYER')));

// ---- music track choice ----
key('KeyO');
const t0 = track;
key('KeyT');
out.push('track ' + t0 + ' -> ' + track + ' ls=' + store.snake_track + ' options marks current green: ' + el.overlay.innerHTML.includes('class="g">' + (track === 'retro' ? 'RETRO' : 'CHILL')));
key('KeyT');
out.push('back: ' + track + ' ls=' + store.snake_track + ' CHILL green: ' + el.overlay.innerHTML.includes('class="g">CHILL'));
key('KeyO');                           // back to title

// ---- wrap mode ----
key('KeyO'); key('Digit4');
out.push('wrap ON: ' + wrapMode + ' ls=' + store.snake_wrap + ' options shows: ' + el.overlay.innerHTML.includes('WRAP MODE — <span class="g">ON'));
key('Escape');                         // back to menu
startGame(1);
players[0].cells.forEach((c, i) => { c.x = GW - 1 - i; c.y = 7; });
players[0].dir = 'r'; players[0].queue = [];
foods.forEach(f => { f.x = 15; f.y = 15; });
tick();
out.push('horizontal wrap: head x ' + (GW - 1) + ' -> ' + players[0].cells[0].x + ' alive=' + players[0].alive);
players[0].cells.forEach((c, i) => { c.x = 4; c.y = i; });
players[0].dir = 'u'; players[0].queue = [];
tick();
out.push('vertical wrap: head y 0 -> ' + players[0].cells[0].y + ' alive=' + players[0].alive);
key('Digit4');
startGame(1);
players[0].cells.forEach((c, i) => { c.x = GW - 1 - i; c.y = 9; });
players[0].dir = 'r'; players[0].queue = [];
tick();
out.push('wrap OFF: wall death=' + (!players[0].alive && players[0].cause === 'wall') + ' ls=' + store.snake_wrap);

console.log(out.join('\\n'));
`;

require('vm').runInNewContext(src, sandbox);
