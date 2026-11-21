# Plan: Snexel AI engine (snake-ai.js) — build first, wire later

Goal: one **standalone, advanced snake AI engine** (`src/snake-ai.js`) that
three consumers share:

1. **Title-screen demo snake** (attract mode) — replaces the current wander;
   looks skilled, never dies, occasionally shortcuts toward apples.
2. **Baby snake** (egg-baby.js) — replaces the current greedy dodge AI; smarter
   evasion, but still **catchable** (the egg→capture→mini-game pipeline must
   keep firing — this is a hard product constraint, not a bug).
3. **Human-vs-CPU mode** (later milestone) — a rival snake in versus games with
   difficulty tiers, fruit tactics, and personality.

The engine is built and tested FIRST (Phases A–C) with zero game wiring; the
mode work (Phase D) comes after, per the user's ordering.

Supersedes `cpu-snake-plan.md` (kept for reference — its §2.1 legal-move mirror
and §6 gotchas apply verbatim to this engine).

---

## 1. Module architecture

Classic `<script src>` file, same conventions as egg-baby/minigame/touch:
`window.SnakeAI` + `globalThis.SnakeAI` alias, IIFE, debug API, no init-time
calls into other modules (everything receives world data).

```js
SnakeAI.choose(world, preset) -> dir    // pure: returns "u|d|l|r"
SnakeAI.preset(name) -> opts            // demo | baby | easy | normal | hard
SnakeAI.debug = { cycleFor(gw,gh), dangerMap(world), bfs(world,from,to), seed(s) }
```

**World snapshot** (built by the consumer each tick, ~O(768), trivial):

```js
{ gw, gh, wrap,              // board + wrap mode
  body,                      // this snake's cells, head first
  head, dir,                 // current heading (AI never returns REV[dir])
  foods, pineapples, bananas,
  poops,                     // VISIBLE piles only — fairness rule, §7
  foes,                      // other snakes: { body, head, dir, queue }
  rng }                      // seeded PRNG, never Math.random directly
```

Pure decision = deterministic given (world, preset, rng state). Tests drive it
directly; the game builds worlds cheaply.

### 1.1 Legal-move filter (mirrors `tick()` death rules exactly)

Per candidate dir (reversal excluded):
- wrap-aware head `(x+GW)%GW`, `(y+GH)%GH` computed BEFORE collision checks;
- wall lethal only when wrap OFF;
- occupancy = all snake bodies **minus the tail slot vacating this tick**
  (the game's tail-chase exception — omit it and the AI self-blocks stupidly);
- visible poops lethal; hidden piles SAFE (fairness, §7);
- fruit cells are legal (they're food, not terrain).
No legal move → any reversal, accept death (same as a cornered human).

## 2. Core algorithms (Phase A)

### 2.1 Danger map

Per-tick grid of penalties built from the snapshot:
- static: poops (+∞), pineapple blast radius (+∞ inside, high near edge),
  banana row/column (+∞ on the cross line);
- dynamic: foe body cells (+∞), foe head ±1-step projections (+high),
  contested cells (one step ahead of a foe's head along its queued dir)
  (+high — refuses head-on-head coin flips);
- own body: +high near head, low near tail (tail-chase allowance).
All decisions score moves through this map.

### 2.2 Target search — BFS, not straight-line

BFS over empty cells (wrap-aware neighbors) to the nearest reward (apple/fruit;
fruits get value weights; pineapple gets a bonus when a foe head is inside the
radius — an instant-win move; banana same for its row/column). Tie-break: path
length, then post-arrival flood-fill (§2.3), then seeded jitter among top-N.

### 2.3 Survivability — flood-fill self-trap rule

A move is *safe* if, after hypothetically stepping there, reachable empty cells
≥ body length + slack. The classic snake self-trap guard; cheap (one flood
fill per candidate, ≤4/tick).

### 2.4 Hamiltonian cycle + shortcuts (Phase B — "advanced" tier)

32×24 (and mini-grid 20×16) are both even → a serpentine Hamiltonian cycle
exists; precompute once per `(gw, gh)` key and cache (row-pair zigzag, ~50
lines). Cycle-following alone is **guaranteed never to self-collide**. The
advanced part is **shortcuts**: on each tick, consider jumping ahead along the
cycle toward the target food if `cycleIdx(head)` ordering stays legal and the
slack test passes (`freeCells − remainingCyclePath ≥ bodyLen + slackK`); fall
back to strict cycle-following when unsafe or when hazards sit on the cycle
(poop/blast cells are removed from the usable cycle segment → if the cycle
breaks, degrade to BFS tier; never follow a cycle into a hazard).
Aggressiveness knob: `shortcutSlack` (easy: never, normal: conservative,
hard: aggressive). Wrap mode note: the cycle uses only non-wrap edges, so it
remains valid when wrap toggles ON/OFF mid-match; wrap merely makes more
shortcuts reachable.

### 2.5 Opponent modeling (hard tier only)

Forward-simulate each foe `K` ticks using its queued dirs (we see `queue`,
same as a human could); mark projected cells in the danger map; CPU cuts off
a foe's route only when its own flood-fill slack allows (aggression knob).

## 3. Presets (Phase C) — one engine, three personalities

| preset       | goal priority              | safety          | jitter | notes |
|--------------|----------------------------|-----------------|--------|-------|
| `demo`       | nearest food, fruits liked | cycle + shortcuts (conservative) | low | death-proof attract mode |
| `baby`       | **flee**: maximize BFS distance from player head, avoid foods/fruits/poops | flood-fill survival, never enters corner traps unless forced | medium | must stay catchable (§3.1) |
| `easy`       | nearest food               | legal moves only, no trap checks  | high  | dies like a distracted human |
| `normal`     | nearest food + fruit bonus | legal + flood-fill + contested    | medium | a decent human can beat it |
| `hard`       | food + kill bonuses        | Hamiltonian + shortcuts + opp model | low   | boss tier |

### 3.1 Baby catchability guarantee (product constraint)

The baby must stay *annoying but capturable*: capture = player head enters a
baby cell (`babyCaptureCheck` unchanged). Rules for the `baby` preset:
- never eats food, never enters hazards (current behavior preserved);
- flee weights player **head proximity** over board freedom, but the
  flood-fill slack keeps it out of dead-end corners *until genuinely cornered*
  (current freeze-at-corner behavior is kept as the fallback);
- medium jitter + a `hesitationMs` knob (30% of ticks it keeps the old dir) so
  it is readable and interceptable — a perfect evader that is uncapturable
  would freeze the egg→mini-game pipeline; the ai-test asserts capture within
  a scripted chase ≤ 120 ticks.

## 4. Integration hooks (Phase D and consumer wiring)

- **Demo**: `initMenu()` sets `players[0].cpu = preset("demo")`; menu tick calls
  `p.dir = SnakeAI.choose(worldOf(state), p.preset)` before movement. ~15 lines.
- **Baby**: `updateBaby()` replaces its inline avoidance scoring with
  `SnakeAI.choose(world-with-player-snake-as-foe, preset("baby"))`; the own
  tail-chase exception maps to the engine's vacating-tail rule. Capture/hatch/
  banner code untouched. egg-test regressions must pass; may need baby-preset
  assertions updated (avoidance still holds, corner freeze still reachable).
- **CPU opponent** (later): `players[i].cpu` fields set from an options toggle
  (`P2 = CPU`, difficulty row; localStorage `snake_cpu`/`snake_cpu_lv`); in
  `tick()` the CPU player's dir comes from the engine; HUD shows "CPU" beside
  P2. Key/menu: new binding for CPU match (avoid 3/4 — taken by poop/wrap;
  use `5` or `C`). Versus egg-roll gate unchanged. Touch pads unaffected
  (they only steer human pads).
- `GAME_CONFIG.ai = { demo:{...}, baby:{...}, cpu:{ easy:{jitter}, normal:{...},
  hard:{shortcutSlack, oppLookahead} } }` — plain tunable knobs, config-block
  pattern like existing `GAME_CONFIG`.

## 5. Testing plan (`tests/ai-test.js`)

Same vm-sandbox style as existing suites (seeded `rng` injected; `box.v` for
random where game code is involved):

- **Determinism**: same (world, preset, seed) → same dir, twice.
- **Legal-move mirror**: refuses wall (wrap off), body, reversal, visible poop;
  ACCEPTS vacating tail; accepts fruit cells; wrap-head handling matches tick().
- **Flood-fill**: refuses a move into a spiral trap (open < len + slack).
- **Hamiltonian**: cycle covers all 768 cells exactly once; strict follower
  survives 1000-tick solo fuzz with random foods, zero collisions.
- **Shortcuts**: every shortcut tick re-verified legal (ordering + slack); a
  fuzzed 1000-tick hard-tier solo run stays alive with poops scattered.
- **Fruit offense/defense**: pineapple chosen when foe head inside radius;
  banana when foe head on its line; flees a zone when foe is ≤2 BFS steps
  from that fruit.
- **Baby preset**: never steps on food/poop/foe; flees scripted head chase;
  capture reachable ≤ 120 ticks (pipeline guard); corner-freeze fallback fires.
- **Soak**: hard vs normal headless versus match (wrap ON, poop ON, 200 ticks):
  both alive ≥ 50 ticks, both scores > 0 — catches oscillation/contested bugs.
- **Regression**: existing egg-test (baby avoidance) and smoketest suites stay
  green with the engine wired behind a flag.

## 6. Milestones & estimates

| Phase | Work | Est | Status |
|---|---|---|---|
| A — core engine: legal moves, danger map, BFS, flood-fill | ~150 lines | 3–4 h | ✅ done (`src/snake-ai.js` + `tests/ai-test.js`, 20 checks) |
| B — Hamiltonian cycle + shortcuts + cache | ~120 lines | 3–4 h | ✅ done (`snake-ai.js` cycle tier + 5 soak tests) |
| C — presets, personality knobs, extra `ai-test.js` cases | ~180 lines | 2–3 h | ✅ done (`snake-ai.js` presets/flee/opp + 7 checks) |
| D1 — demo snake wiring + browser check | ~20 lines | 1 h | ✅ done (`game.js?v=41` + `snake-ai.js?v=1`) |
| D2 — baby snake wiring + egg-test regressions | ~40 lines | 2 h | pending |
| D3 — human-vs-CPU mode (options UI, tick wiring, HUD, soak) | ~120 lines | 3–4 h | pending |

Engine first (A→C ≈ 8–11 h) fully tested standalone; then wiring D1→D2; the
versus mode (D3) lands last, exactly as requested. Cache versions bumped per
file as usual (`snake-ai.js?v=1…`).

**Phase A implementation notes** (shipped):
- `src/snake-ai.js` — IIFE exposing only `window.SnakeAI` / `globalThis.SnakeAI`;
  zero DOM/rAF/sound/game-global deps (loads alone in a vm sandbox).
- `choose(world, opts)` knobs: `danger, floodFill, slack, jitter,
  pineappleRadius, zoneReach, fruitKill`; presets wrap these in Phase C.
- Vacating-tail exception mirrors `tick()`: own tail never blocks; foe tail
  blocks only when the foe eats next tick (`eatsNext`).
- Danger map marks pineapple radius / banana row+column LETHAL only when a foe
  is ≤ `zoneReach` BFS steps from that fruit (detonation risk), else HIGH;
  fruit cells stay safe; foe 1–2-step projections marked HIGH.
- Target picker: race-skip when a foe is strictly closer to a fruit; kill
  bonus when a foe head sits in a blast zone; wander away from foes when no
  fruit is worth chasing.
- Flood-fill (`reachableAfter`) bans self-trap moves below `len + slack`.
- `tests/ai-test.js`: determinism, legal-move mirror vs `tick()`, BFS wrap +
  foe-tail routing (blocked when foe eats), danger semantics, ring-pocket trap
  refusal, kill-bonus targeting, race-skip flee, 300-tick wrap/poop fuzz soak.
- `index.html` untouched until wiring (Phase D); combined 7-script
  `node --check` green — engine's IIFE adds no shared-scope globals.

**D1 implementation notes** (shipped):
- `index.html` loads `src/snake-ai.js?v=1` before `game.js?v=41`.
- `aiPickDir()` now routes through `SnakeAI.choose(demoWorld(p), DEMO_AI_OPTS)`
  (`danger, floodFill, slack 2, jitter 2, zoneReach 3`); the legacy random
  walker remains as fallback when the engine isn't loaded.
- `demoWorld(p)` builds the snapshot per tick; hidden poops filtered out
  (fairness rule); other alive snakes map to `foes` (ready for D3).
- `demoBrainRng` = one long-lived seeded `mulberry32(20260120)` — moves are
  organic but reproducible; `tests/ai-test.js` reproduces the menu scenario.
- **Q debug toggle** switches the demo brain engine ↔ legacy; the canvas
  shows a small `AI: ENGINE / AI: RANDOM` tag top-left in the menu only
  (title overlay stays lean).
- **Attract-mode restart rule**: if anything would kill the menu demo snake
  (engine cornered in a spiral, legacy walker trapped), `tick()` calls
  `initMenu()` instead of game-over — the title screen never shows "OVER".
  Verified by a 200-tick menu soak in `ai-test.js` (engine ate, stayed in
  attract mode, Q toggle + legacy path green).
- **Attract mode is silent**: `demoQuiet()` gates every SFX (eat/plop/level/
  boom/banana/jingle + egg chirp/hatch/ding) while `state === "menu"` — the
  title music keeps chilling but the demo snake makes no noise. Gameplay SFX
  untouched; `ai-test.js` proves zero audio nodes built in menu, nodes built
  in play.

**Phase B implementation notes** (shipped):
- `buildCycle(gw, gh)`: serpentine U-pair cycle — start (0,0), row-pair
  zigzag over columns x≥1, column-0 spine back up; validated (cover +
  adjacency incl. close edge) at build time; cached per `gw x gh` in a Map.
  Works for any gw≥2 with even gh; odd grids return null → BFS tier.
  Uses only non-wrap edges → valid while wrap toggles mid-match.
- `cycleMove()` tier in `choose()` when `opts.cycle`:
  - strict follow = next cycle cell (provably never self-collides: body is
    the contiguous run behind the head; next cell occupied only if len ≥ N);
  - shortcuts toward fruit: landing legal + hazard-free, every SKIPPED cycle
    cell unoccupied/hazard-free, and `cycleDist(landing→tail) ≥ newLen +
    shortcutSlack` (never outrun the tail around the loop); land at or
    before the fruit, never past it;
  - hazard on the cycle ahead (poop / blast zone ≥ `cycleHazard`) → jump the
    hazard if a legal shortcut exists, else **degrade to BFS tier** — the
    cycle is never followed into a hazard;
  - `debug.lastTier()` exposes `{ tier, gain }` per tick for test proofs.
- `ai-test.js` Phase B soaks (all green): cycle covers 768 cells once with
  closed adjacency; 20×16 cached, 32×23 → null; strict follower 1000 ticks
  zero deaths + always cycle tier; slack-2 shortcuts 1000 ticks alive with
  real jumps (gain > 1); 30 scattered poops 1000 ticks alive (skip/degrade).

**Phase C implementation notes** (shipped):
- `SnakeAI.presets(name, knobs)` → opts object; `PRESETS`: demo (cycle,
  conservative slack 6), baby (flee + avoidFruit + hesitation), easy
  (no flood-fill, jitter 0.8), normal (BFS + flood-fill, jitter 0.4), hard
  (cycle slack 2 + oppLookahead 3, jitter 0.1); knobs merge over the base
  so `GAME_CONFIG.ai` tunes from game.js; unknown preset throws.
- Flee mode (`opts.flee`): maximize BFS distance from nearest foe head,
  hazard penalty via danger map, flood-fill survival filter (trapped →
  maximize freedom, die last), hesitation (`opts.hesitation`: ~30% ticks
  keep the old dir → readable + interceptable), jitter among runner-up.
  Cornered (no legal non-fruit move) → returns an illegal dir so the
  caller's freeze fallback keeps working (egg-baby §M2 semantics).
- Opponent model (`opts.oppLookahead K`): danger map forward-simulates each
  foe's queued dirs 1..max(2,K) ticks and marks projected cells HIGH.
- `GAME_CONFIG.ai` in game.js: demo/baby/cpu{easy,normal,hard} knobs;
  `DEMO_AI_OPTS = SnakeAI.presets("demo", GAME_CONFIG.ai.demo)` with an
  engine-optional fallback so game-only vm sandboxes still load.
- `ai-test.js` Phase C checks (all green, suite now 37): preset shapes +
  knob merge + throw; deterministic preset decisions; easy dives a ring
  trap normal refuses; oppLookahead marks deeper projected cells; cornered
  baby returns illegal dir (freeze fallback); baby flees with zero illegal
  steps across 3 seeds; **scripted interceptor chase captures the baby
  within 120 ticks on all 3 seeds** (§3.1 pipeline guard); hard-vs-normal
  versus soak (wrap+poops, 200 ticks): both alive ≥ 50 ticks, both scored.

**Phase C follow-up: demo spectacle-fruit chill** (shipped after device
review — the demo kept derailing whenever a pineapple/banana spawned):
- Blast zones are only threats when a rival exists: danger map marks them
  `LOW` (noise) with zero foes, `HIGH` with foes but out of reach, `LETHAL`
  when a foe can reach the fruit. A solo snake can walk through any blast
  zone — only the eater dies, and the eater is always spared.
- Special fruit attractiveness is knob-controlled: `specialWeight` (demo
  0.5) and `specialMaxDist` (demo 8) gate BOTH the BFS target picker and
  cycle shortcuts — a distant pineapple no longer pulls the sweep across
  the board; nearby ones still tempt. Kill-bonus targeting (rival head in
  zone) overrides the gate.
- Fruit `kind` is derived from the source arrays, so game.js can keep
  pushing plain `{x, y}` objects.

## 7. Gotchas & fairness rules

1. **Vacating-tail exception** must mirror `tick()` (§1.1) everywhere.
2. **Fairness**: `choose()` only sees VISIBLE poops and current fruit positions
   — never hidden piles or spawn RNG. Cheat toggle (anticipate reveals) off by
   default; if ever enabled, options screen must label it.
3. **Danger ∞ vs cycle**: hazards on the Hamiltonian cycle force the BFS tier;
   test both wrap ON/OFF so cycle validity never depends on wrap.
4. **Speed scaling**: decisions happen per tick; `tickMs` shrinking with level
   tiers scales automatically — only jitter needs retune at high speed.
5. **Baby catchability** (§3.1) is a feature, not a bug — hard-tier evasion is
   for the versus opponent only.
6. **No rAF/DOM in the engine** — pure math module; consumers own timing,
   rendering, sounds; engine stays vm-testable and reusable for the mini-game
   if ever wanted.
7. Perf: worst case ~4 flood-fills + 2 BFS + danger-map build per tick ≈
   tens of thousands of ops at ≤16 ticks/s — negligible even on phones.

## 8. Out of scope

- Learning/adaptive AI — tiered heuristics are enough and testable.
- Interpolated-motion awareness (`smooth-motion-plan.md`) — engine works on
  the discrete grid; visuals interpolate after decisions.
- CPU for the mini-game or solo mode (no opponent); demo/baby/versus cover it.
