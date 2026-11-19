# Plan: CPU-controlled snake for 2-player versus mode

Goal: replace player 2's arrow-key input with an AI that plays well against a
human — smart enough to feel like a skilled rival, tunable from "distracted
human" to "unbeatable boss".

## 1. Input hook (the cheap part)

Human input lands in `players[i].dir` + `players[i].queue` via `keydown`.
A CPU snake swaps the source: in `tick()`, before movement application, if
`p.cpu` then `p.dir = aiChoose(p, players, world)` (skip reversal via `REV`
like a human turn does). Everything downstream — collision, eat logic, bulge,
poop reveal, fruit blasts, level speed — stays untouched. ~30 lines of wiring.

Add `cpu: false` + `difficulty` fields to the snake object; set them in
`startGame(mode)` based on the options toggle.

## 2. AI architecture

Stateless per tick (~8 decisions/sec max; flood-fills on a 768-cell board are
trivial perf in JS). No history needed except optional personality state.

### 2.1 Legal-move filter (must mirror `tick()` death rules exactly)

For each candidate direction (excluding reversal):
- Compute wrap-aware head (`wrapMode`: `(x+GW)%GW`, `(y+GH)%GH` before checks).
- Walls lethal **only when wrap OFF** (same as game logic).
- Occupancy = both snake bodies **minus the tail slot that pops this tick**
  (the game's vacating-tail exception — omit this and the AI refuses to
  tail-chase and self-blocks stupidly).
- Visible poops lethal (`poopMode`).
- Hidden piles: treat as SAFE at easy/normal for fairness; hard tier may
  anticipate piles that will reveal as bulges reach tails (optional cheat
  toggle, off by default).

If no legal move exists, pick any reversal (accept death) — same outcome as
a cornered human.

### 2.2 Target selection — BFS, not straight-line distance

Shortest *reachable* path to the nearest apple through empty cells (wrap-aware
neighbors). Straight-line greedy fails behind snake-body walls; BFS fixes it.
Tie-break: path length, then flood-fill of remaining open area after arrival
(classic self-trap rule: reachable-empty ≥ snake length).

### 2.3 Difficulty tiers

- **Easy**: greedy BFS to nearest food among safe moves, random tie-break, no
  self-trap checks → dies like a distracted human. Good first opponent.
- **Normal**: greedy + flood-fill safety + avoids *contested cells* (cells one
  step ahead of the opponent's head — refuses head-on-head coin flips).
- **Hard**: Hamiltonian-cycle follower. A serpentine cycle over 32×24 exists
  (both dimensions even); precompute once at startup (~50 lines). Normally
  follows the cycle one step behind itself (guaranteed never self-collides),
  but takes **shortcuts toward food** when a slack check proves the shortcut
  preserves cycle ordering (standard "unbeatable snake AI" technique).
  Difficulty = shortcut aggressiveness knob.

### 2.4 Fruit tactics (this game's special flavor)

- **Opportunity**: eating a pineapple kills any opponent head within
  `GAME_CONFIG.pineapple.radius`; a banana kills any head on its row/column.
  When the opponent's head is caught in that zone, the CPU should seek that
  fruit hard — it's an instant win move. Score = food value + kill bonus.
- **Defense**: the eater is always spared, but *camping* in a fruit's blast
  zone while the opponent can reach the fruit next tick is suicide. Rule: if
  our head is in a fruit's zone (radius / row / column) and the opponent is
  within ~2 BFS steps of that fruit → flee the zone this tick.
- **Cleanup**: poops clutter paths; hard tier can deliberately eat pineapple
  to wipe piles blocking its route.
- Bananas/pineapples are otherwise just high-value food (they grow/score like
  apples) — normal tier prefers them when safe and reachable.

### 2.5 Personality knobs (make it feel human, not robotic)

Per-difficulty weights:
- `jitter`: choose randomly among the top-N safe moves (N≥2) so motion isn't
  machine-perfect; too much jitter reads as dumb — tune per tier.
- `aggression`: 0 = coexist, 1 = cut off the opponent's predicted path (move
  into cells one ahead of their head when safe).
- `reaction lag`: easy tier ignores fresh food re-spawns for a few ticks.

## 3. UI & wiring

- Options menu (already exists, opened with `O`): add **"P2 = CPU"** toggle
  row + **difficulty** row (Easy/Normal/Hard), following the existing poop/wrap
  row pattern; persist via `localStorage` keys `snake_cpu` and `snake_cpu_lv`.
- HUD/overlay: render "CPU" beside P2's score; game-over overlay untouched —
  `cause` strings already cover crash/wall/body/poop/boom/banana.
- Optional: drive the title-screen demo snake with the easy AI so attract mode
  looks alive (~15 lines reuse).

## 4. Testing plan

Deterministic, mirroring the existing sandbox style (`box.v` stubbed
`Math.random` in smoketest):
- **Greedy**: picks direction toward food; never reverses.
- **Safety**: refuses wall/body/poop cells; refuses self-trap moves
  (flood-fill < snake length).
- **Tail-chase**: accepts moving into the opponent's vacating tail cell.
- **Fruit offense**: targets pineapple exactly when opponent head is inside
  radius; banana when opponent head shares its row/column.
- **Fruit defense**: leaves a blast zone when opponent is near the fruit.
- **Cycle tier**: Hamiltonian follower survives a 1000-tick solo simulated
  run with zero self-collisions.
- **Soak**: Hard vs Normal headless match (wrap ON + poop ON, 50+ ticks):
  no early deaths, both scores > 0 — catches oscillation bugs.

## 5. Effort estimate

| Phase | Work | Estimate |
|---|---|---|
| Wiring + easy greedy BFS (MVP) | ~100 lines | 2–3 h |
| Flood-fill safety, contested cells, wrap/poop rules | ~150 lines | 2 h |
| Fruit offense/defense + personality knobs | ~80 lines | 1–2 h |
| Options UI, difficulty, persistence | ~50 lines | 1 h |
| Tests (deterministic + soak) | ~120 lines | 1–1.5 h |
| Hamiltonian hard tier (optional) | ~200 lines | 3–4 h |

Polished non-Hamiltonian: ~6–7 h total. With hard tier: ~9–10 h.

Recommended order: ship MVP + Normal tier first (a CPU that a decent human
can beat is a good milestone), then fruit tactics, then Hamiltonian only if a
boss-tier opponent is wanted.

## 6. Gotchas

1. **Vacating-tail exception** — occupancy checks must replicate `tick()` or
   the AI self-blocks and never tail-chases.
2. **Fruit defense is predictive** — needs opponent reachability (BFS steps),
   not just current blast-zone containment; this is the only forecasting in
   the design.
3. **Wrap-aware BFS** — neighbor generation must wrap when `wrapMode` is ON;
   when OFF, edge cells are lethal. Toggling wrap mid-match changes the AI's
   map — recompute nothing, just re-evaluate per tick (stateless design
   handles it).
4. **Speed changes** — level-ups shrink `tickMs`; AI decides per tick, so it
   automatically scales with game speed; no tuning needed beyond jitter.
5. **Fairness** — never let easy/normal AI see hidden poop piles or the RNG
   for upcoming fruit spawns; keep `aiChoose` reading only what a human sees.

## 7. Out of scope

- CPU for solo mode (pointless — solo has no opponent; demo snake is optional).
- Learning/adaptive AI — tiered heuristics are enough and testable.
- Interpolated-motion awareness (see `smooth-motion-plan.md`) — AI works on
  the discrete grid regardless; visuals interpolate after the fact.
