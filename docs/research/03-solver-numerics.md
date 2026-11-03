# 03 - Solver numerics and architecture review

Project LIZARD reuses the user's GTO Solver snapshot vendored at `solver/` (upstream `michaellhan/gto-solver`
commit `9b907bd61a95758c48b1141cfadd854ba2c0eeaa`, imported 2026-11-03; `solver/UPSTREAM.json`). This review covers
how the solver computes its answers, how accurate those answers are, how the precomputed libraries are stored, and
what LIZARD has to preserve.

**Method.** Everything here comes from reading code and data files, without running anything heavy. No tests, solves,
builds or benchmarks were run, because the machine is shared with two library builds that have been running for days.
All paths are relative to `/Users/mhan/Desktop/projects/lizard` unless they are absolute.

Every claim carries one of these labels:

| Tag | Meaning |
|---|---|
| **[V]** | Verified by reading code or data in this checkout, or the read-only upstream `.work` build output |
| **[M]** | A measurement the upstream author recorded in `solver/README.md`, a docstring or a test comment. Quoted with its location, but not reproduced here |
| **[I]** | Inferred from code structure or from data I did not fully decode. Treat these as hypotheses to confirm |

---

## Executive summary

1. **One core algorithm, three engines.** Heads-up postflop solving uses Discounted CFR with a custom schedule,
   "dcfr-ramp": alpha 1.5; beta 0 (negative regrets halved each iteration) up to iteration 100, then 0.5; and an
   averaging exponent gamma = min(8, 3 + t/10). Updates alternate between players and regrets are stored as float32.
   The same iteration runs in numpy (the reference), in a compiled C core (a native `.so`, `core.wasm`, and
   `core-mt.wasm` with up to 7 helper threads), and in a separate 3/4-way C core. The C core uses Python's discount
   factors. Tests check it against numpy to a regret tolerance of 1e-5 to 1e-4, and check that it gives bit-identical
   results on any thread count. **[V]**
2. **Exploitability is measured inside the abstract game.** It is reported as a percentage of the street's starting
   pot. The game is abstracted by bet-size menus, half-bb rounding, river/turn suit classes, hand buckets and equity
   leaves, so "0.1% exploitable" means 0.1% *within that abstraction*. Versus full-game references, the README
   records: rivers exact to 4 decimals; turns at Accurate 0.14-0.23% of the pot; flops and library entries 0.2-0.5% of
   the pot. **[V]/[M]**
3. **Preflop is mostly hand-curated, not solved.** `gto/preflop.py` describes itself as "hand-written approximations
   of solver outputs". Its comments cite gtopreflop.com 23 times, Poker Academy 11, GTO Wizard 9, Preflop Wizard 8,
   BeyondGTO 6, pokalab 4, GTO Gecko 3 and GTO Ranges 2. Only `pf_game.py` is an equilibrium computed by the project's
   own solver, and it sits 2.5-3.0 points from the charts. The models of how much equity a hand realizes (EQR) are
   fits; five `expectedFailure` tests document where they disagree with the charts. **[V]/[M]**
4. **Library format.** Format 2 consists of `index.json`, per-flop `GTOFL3` entries (zlib-compressed: a JSON header,
   then strategies quantized to 1%, then EVs as int16 values plus a log-coded gap to the best action), and optional
   `GTOTN1` turn files. Lookups are keyed by a fingerprint of both ranges plus pot and stack, then by the
   suit-canonical flop, the tree hash, the sizes key and `MODEL_VERSION`. **There is no `T:<card>` node path.** Turn
   data is addressed by (flop action path, turn class, actions at the turn). **[V]**
5. **The published library is half on the older blind-river tree.** It holds 18 spots and 25,575 entries. Nine
   spots (`srp_btn_bb` and the eight 3-bet pots) use the river-dealt tree (hash `83dfa5b8d830`). Nine single-raised
   spots are still on the older blind-river tree (`31f56a470ae2`). The README line "The flop library was solved with
   the river on the turn's boards" is stale for half the spots. **[V]**
6. **The heads-up builds can be merged.** `hu-lib` (`srp_sb_bb_2max`: 358 indexed of 364 on disk) and `hu-lp-lib`
   (`lp_sb_bb_2max`: 148 of 150) use format 2 and the same tree key and model as the published river-dealt spots.
   Their turn files include EVs. Merging means appending the spot objects and copying only the entries the index
   lists. **[V]** That the range fingerprints are still valid is **[I]**: the build commits are ancestors of the
   snapshot, and no file affecting ranges or the solver changed in between.
7. **Bet labels can misstate the size.** In limped pots the label "bet 33%" is an actual 1.0 bb into a 2 bb pot,
   which is 50% of the pot. That comes from half-bb rounding with a 1 bb minimum. The UI should show real sizes.
   **[V]**
8. **Provenance data already exists but is scattered.** It is spread across `triage`, `solver`, `precomputed`,
   `approximate`, `off_solution` and `notes`. LIZARD should normalize these into one provenance record per result
   (proposed in section 10b).

---

## 1. Solving algorithms

### 1.1 The regret minimizer (heads-up)

- **Schemes.** `solver/gto/solver.py:1396` `CFR_SCHEMES` defines `dcfr-ramp` as the default
  (`Config.cfr = "dcfr-ramp"`). The alternatives are `dcfr-ramp-b0`, `dcfr` (gamma 4), `dcfr-reset4` (the averaging
  that postflop-solver uses), `dcfr+`, `lcfr`, `cfr+`, `pcfr+`, `pdcfr+` and the `hs-*` hyperparameter schedules.
  **[V]**
- **Gamma schedule.** `_gamma_ramp(t) = min(8.0, 3.0 + t / 10)` (`solver.py:1376`), so gamma reaches 8 at iteration
  50. The docstring explains the choice: gamma 8 throughout was 10-25% less exploitable after 50 iterations, but up to
  40% worse before iteration 20. **[V]/[M]**
- **Beta schedule.** `_beta_step(t) = 0.0 if t < 100 else 0.5` (`solver.py:1384`). Beta 0 means negative regrets are
  multiplied by t^0/(t^0+1) = 0.5 each iteration. The docstring gives the reason for switching to 0.5: 2 of 15
  Accurate turns jumped from 0.15-0.33% to 2-2.8% of the pot at about 180 iterations. **[V]/[M]**
- **Discount factors.** `_factors` (`solver.py:2059`) computes:
  - positive regrets: `pos_f = t^a / (t^a + 1)`
  - negative regrets: `neg_f = t^b / (t^b + 1)`
  - strategy sums: `ss_f = (t / (t + 1))^gamma`
  - `beta None` means CFR+ flooring. `reset4` restarts the strategy sums at every power of 4.

  `_discount` (`:2071`) applies these in place to float32 arrays. **[V]**
- **Alternating updates.** `run` (`:2082`) traverses player 0, then player 1, then discounts once per iteration. The
  opponent's strategies computed in player 0's pass are reused in player 1's pass. **[V]**
- **Averaging.** The answer is the average strategy, `avg_strategy0()` over `ssum`. Because gamma reaches 8, the
  average mostly reflects the last ~1/(gamma+1) of iterations (`_gamma_ramp` docstring). **[V]**
- **Warm start.** `warm_start` (`:2301`) and `lift_classes` (`:2329`) exist. For the library, warm start was rejected
  ("worse after 100 iters"; README, Precomputed flop library section, around line 4130+). **[M]**
- **Preflop and 3+ players use different minimizers.** `pf_game.py` runs DCFR level by level with linear averaging.
  Push/fold uses fictitious play (`pf_classes.py:65`). The multiway solver has its own CFR loop (section 5). **[V]**

### 1.2 Engines and equivalence

| Engine | Files | Notes |
|---|---|---|
| numpy reference | `solver/gto/solver.py` (`Solver._cfr`, `_traverse`) | BLAS is held to one thread (`NO_BLAS`, `solver.py:32`; `native.py`) **[V]** |
| C core, native | `solver/core/gtocore.c`; built `solver/core/build/gtocore-ebdf06ac71d2.so` | Loaded through `solver/gto/core.py`. `Solver.run` calls `core.run(...)` first and falls back to numpy for trees the core does not cover (`solver.py:2104-2107`) **[V]** |
| C core, wasm | `solver/gto/core.wasm` (73,780 bytes), `solver/gto/core-mt.wasm` (96,298 bytes, threaded) | Loaded by `solver/gto/static/worker.js:173`. Threads need cross-origin isolation (SharedArrayBuffer). The worker restarts without threads if the threaded module traps (`worker.js:98-135`). The README's "53 KB" figure is out of date **[V]** |
| Multiway C core | `solver/core/mwcore.c`, `solver/gto/mwcore.py`, `mwcore.wasm` (126,560 B), `mwcore-mt.wasm` (132,971 B) | `worker.js:178` **[V]** |

Equivalence tests:

- **`solver/tests/test_core.py:525` `TestSameAsNumpy`** runs a list of spots in both engines and compares them. The
  default regret tolerance is 1e-5, loosened to 1e-4 for a flop played by buckets and 5e-5 for loops. The tolerance on
  average strategies is 1e-4, or 5e-4 for the library 3-bet spot. **[V]**
- **`test_core.py:97` `test_same_numbers_on_any_number_of_threads`** requires bit-identical results across thread
  counts. **[V]**
- These classes are skipped when no C compiler is present (`skipUnless` on five classes). **[V]**
- **Recorded speedups [M]** (README "Compiled core" table, around `solver/README.md:1819`):
  - flop K72r Fast: numpy 62 iterations reach 2.44%; the core reaches 0.03% in 646 iterations
  - Accurate: 1000 iterations in 16.4 s, 0.01%
  - per-iteration timing: turn Th 14.5 ms vs 54.7 ms
- **Recorded thread scaling [M]** (`README.md` "Threads", around line 1843): 17.3 ms per iteration on 1 thread, 11.0
  on 2, 6.9 on 4, 5.9 on 8.

### 1.3 Budgets per mode

Each budget is a pair of seconds: [current street, each earlier street re-solved to narrow ranges]
(`solver/gto/static/index.html:970-974`). **[V]**

| Mode | Server (native) | Browser (wasm) | Source |
|---|---|---|---|
| Quick | flop [1.5, 0.3], turn [1.5, 0.3], river [0.8, 0.3]; a 3-way river 1.8 s | same | `index.html:978`, `advisor.py:67` (`MW_QUICK_BUDGET`), `advisor.py:107` (`TRIAGE_BUDGETS`) |
| Fast | [2.5, 2.5] | [8, 3] | `index.html:974`, `native.py:85` |
| Accurate | [30, 12] | [60, 12] | same |
| 3-way Fast (native) | 5.0 s | - | `native.py:114` `MW_FAST_BUDGET` |

Iteration limits:

- `Solver.run` defaults to `min_iters=10` and `max_iters=1000` (`solver.py:2082`). **[V]**
- Advisor heads-up checks happen at `HU_CHECKS = (50, 100, 150, 200, 300, 400, 600, 800)` (`advisor.py:112`), and
  only from `HU_SETTLED_FROM = 300` iterations on, per street (`advisor.py:115`). **[V]**
- In the browser, Fast stops at the first check where exploitability is at most `hu_settled`: 0.2% with threads, 0.3%
  single-threaded. Single-threaded turns start checking from 200 iterations (`worker.js:253-261`). **[V]**
- Answer targets are `expl_target` = 0.2/0.3 for Fast and 0.1 for Accurate (`worker.js:265`). An answer more than
  `OVER_TARGET = 10` times its target is flagged "approximate" (`advisor.py:102`, `:3005-3014`). **[V]**
- Native has no `hu_settled`, so a native solve runs its full budget. **[V]**
- 3-way solves stop when the mean best-response gain is under `MW_SETTLED = 0.1`% of the pot. They check at
  `MW_CHECKS = (25, 50, 100, 200, 400, 700)` and keep `MW_RESERVE = 2.5` iterations of time back
  (`advisor.py:140-143`). **[V]**
- **Tree size cap.** `MAX_CELLS = 24,000,000` with `CELL_S = 8e-9` seconds per cell (`advisor.py:133-134`). A tree
  above the cap raises `TreeTooBig` and is trimmed (`TRIMS`). `CAP_ITERS = 30` is the minimum number of iterations a
  capped tree must reach. **[V]**

### 1.4 Stopping rules (`Solver.run`, `solver.py:2082-2133`) [V]

1. `should_stop()` raises `Cancelled`.
2. With a `reserve`, no iteration starts if, at the mean iteration time so far, it would end past the budget with
   `reserve` iterations' time kept back. Without one, iterations continue until one ends past the budget, which can
   overrun by up to one iteration.
3. `max_per` raises `TooSlow` when the first iteration takes longer than `max_per` seconds.
4. The run stops at `max_iters`. Settled checks (`hu_settled`, `expl_target`) are applied by the Advisor around these
   runs, not inside `Solver.run`.

### 1.5 Threads

- Native solving is single-threaded per solve, with BLAS pinned to one thread.
- The browser uses up to 7 helper threads in `core-mt.wasm` (`worker.js:~98-135`). `native.THREADED_FAST = 4`
  (`native.py:78`).
- Results do not depend on thread count; `test_core.py:97` requires identical output. **[V]**

---

## 2. Game tree abstraction

### 2.1 `Config` defaults (`solver/gto/solver.py:77-210`) [V]

| Field | Default | Meaning |
|---|---|---|
| `bet_sizes` | flop [0.33, 0.75], turn/river [0.5, 1.0] | fraction of the pot |
| `raise_sizes` | [0.5, 1.0] | fraction of the pot after calling |
| `max_raises` | 2 | raise cap per street |
| `allin_spr` | 2.5 | jam instead of bet or raise when remaining stack ≤ 2.5 × pot |
| `depth` | 2 | streets solved below the root street |
| `n_turns` | 6 | sampled turns when not using classes |
| `river_play` | True | the river is played (not an equity leaf) |
| `turn_classes` | True | turns grouped into suit-swap classes |
| `later_sizes` | turn/river 0.75 | the single size used on later streets inside a flop solve |
| `river_buckets` / `river_strength` / `river_dealt` / `river_classes` | None / None / None / False | river abstractions (2.6) |
| `river_strength_spr` | 8.0 | above this root SPR the river is played by strength buckets |
| `rake_rate`, `rake_cap` | 0, None | `Config.rake()` = rate × pot, capped |
| `seed` | 7 | sampling seed |
| `cfr` | "dcfr-ramp" | |
| also | `root_allin`, `keep_sizes`, `icm`, `root_bets`, `root_raises`, `sizes_key` | |

### 2.2 Bet menus by mode

| Tree | Flop | Turn | River | Raises | Model flags | Source |
|---|---|---|---|---|---|---|
| Native Fast | 33/75 | 33/75/125 | 33/125 | flop 0.5, turn/river 0.75 | `river_buckets=32, turn_buckets, bucket_river_step=3, river_classes, river_strength=32` | `native.py:85-89` |
| Native Accurate | 33/75 | 33/75/125 | 33/75/125 | same | `river_classes, river_strength=32` | `native.py:90-92` |
| River root | - | - | 33/75/125/250 | | | `native.py:84` `ROOT_SIZES` |
| Shallow turn | - | below SPR 4.5: bet 33/75 | river 75 | | | `native.py:69` `FAST_SPR_SIZES` |
| Library (`LS`) | 33/75 | 75 | 75 | flop 0.5, turn/river 0.75 | `river_play, turn_classes, flop_leaf_rivers 4, river_dealt 64` | `flop_library.py:48-49, 65` |
| 3-way | 33/75 | 50 | 50 | `raise_frac` 0.75 | buckets 16, classes | `advisor.py:61`, `mw_index.json` tree |
| 4-way | 33 | 50 | 50 | | | `advisor.py:96` |

- The browser's own Fast and Accurate configs are strings in `worker.js:~195-360`. The library tree is "the browser's
  Accurate config" (`flop_library.py:46-48`). **[V]**
- Custom menus are limited to `MAX_SIZES = 3` per street (`advisor.py:250`). **[V]**

### 2.3 Sizing arithmetic and labels (`TreeBuilder._decision`, `solver.py:1218-1300`) [V]

- **Bet:** `amt = max(round(frac * pot_total * 2) / 2, 1.0)`. The bet is rounded to half a bb, with a 1 bb minimum.
  Its label is `f"bet {int(round(frac * 100))}%"`, the *nominal* fraction.
- **Raise:** `raise_to = b_op + round(frac * pot_after_call * 2) / 2`, at least the minimum raise
  `2 * b_op - b_me`. Raise labels use amounts ("raise to 7").
- **All-in:** offered when `remaining <= cfg.allin_spr * pot_total`, when the raise cap is reached, or when
  `root_allin` is set.
- **Finding: labels misstate small-pot sizes.** The actual fraction behind each label:

  | Pot | "bet 33%" actually | "bet 75%" actually |
  |---|---|---|
  | 2.0 bb (limped) | 1.0 bb = **50.0%** | 1.5 bb = 75.0% |
  | 5.5 | 36.4% | 72.7% |
  | 6.0 | 33.3% | 75.0% |
  | 16.5 | 33.3% | 75.8% |
  | 20.5 | 34.1% | 75.6% |

  LIZARD should display chip amounts, or compute percentages from those amounts, never from the label.

### 2.4 Rake (`solver.py:1090`) [V]

- Rake is `self.cfg.rake(2 * min(inv[0], inv[1]))`, taken on the matched pot. Equity leaves are raked on the pot as
  it stands.
- Library entries are solved **without rake**. A raked table may read them anyway; `RAKE_READ` (`flop_library.py:972`)
  records what that costs. Across 60 flops, the mix gives up 0.15-0.18% of the pot (worst 0.35-0.58), about what a
  50-iteration Fast solve gives up. The stored EVs run 5.7-11.4% of the pot high. Raked reads therefore show no EVs.
  **[V]/[M]**

### 2.5 How later streets are treated

- **River root.** Every combination is played on the actual board. Rivers are reported exact: "their best responses
  to our whole river strategy measure it at our own number to 4 decimals" (README, postflop-solver section,
  `README.md:1739-1811`). **[M]** That exactness holds for the river's own menu; it does not cover sizes outside the
  menu.
- **Turn root.** The river is played. With `river_classes`, river cards that are suit-swap equivalent share one
  strategy; with `river_strength` (32 buckets above `river_strength_spr` 8.0), hands are bucketed by strength
  (`_street_over`, `solver.py:1045`). **[V]**
- **Flop root (live).** The turn is played by suit classes (`turn_classes`; 13 classes on a rainbow flop, 26 on
  two-tone, per the `TURN_MAGIC` comment at `flop_library.py:656-666`). Later streets use a single size
  (`later_sizes` 0.75). The river is one of:
  - (a) **blind**: played on the turn's boards ("old tree")
  - (b) **dealt**: `river_dealt=64` strength buckets on each river card (the library's current model)
  - (c) **bucketed**: `river_buckets=32` (native Fast)

  An all-in on the flop is an equity leaf evaluated on at least `FLOP_LEAF_RIVERS = 4` rivers per turn card
  (`solver.py:56`, `_flop_leaf_boards` at `:656`). **[V]**
- **Cost of the blind river [M]** (`flop_library.py:53-60`, README library section):
  - 3-bet pots, blind: 0.40% (OOP) / 0.29% (IP) of the pot against every card, with 3-bettor bet frequencies of 0-11%
    where the full game bets 16-55%
  - 3-bet pots, dealt: 0.10 / 0.15 at 400 iterations; the shipped entries (200-300 iterations) 0.11 / 0.27
  - single-raised JcTd8d: blind 0.29 / 0.17, dealt 0.04 / 0.07
  - Kc7d2h: blind 0.40 / 0.48, dealt 0.18 / 0.25
  - other flops (KcTd6h 0.54/0.27, 8c6d4c 0.30/0.28, AcJd3h 0.30/0.26, Qc5h5d 0.48/0.32): the library "give[s] up
    0.2-0.5% of the pot against every card dealt"
  - an all-in leaf on the flop is within 4% of exact
- **Flop strategy accuracy [M]** (README "Flop", around `README.md:1638`): the default tree is within 1.4 points of
  c-bet frequency on average (worst 3.8) of a tree that plays every turn. Browser Accurate (64 buckets) at 400
  iterations is 1.8 points off; Fast is 3.6 points off. In the bucket game, exploitability is 0.2-0.4% at 200
  iterations.

### 2.6 Tree identity

- `tree_key(cfg)` (`flop_library.py:330`) produces `{"sizes": {...}, "model": {...}}`. `tree_hash` (`:439`) is
  sha1[:12] of it. `old_tree()` (`:354`) is the key before the dealt-river model. **[V]**
- `MODEL_VERSION = 1` (`:38`) must be bumped when the flop game changes in a way the key cannot see; every stored
  entry is then ignored. **[V]**
- Library lookups compare only `sizes` and `model.version` with the advisor's tree (`:1166-1170`). A blind-tree entry
  and a dealt-tree entry are both accepted for the same advisor config. The answer reports `same_tree`, which is true
  when the model dicts are equal (`:1221`). **[V]**

---

## 3. Hand evaluation

- **Implementation.** `solver/gto/evaluator.py` (146 lines) is built on treys (0.1.8, MIT;
  `solver/docs/legal/third-party-notices.md:12`). It uses treys' `LookupTable`, its own `_flush_table`, and a plain
  table `_PLAIN` (6188 × 169, int16) with `_SLOT` and a threading lock. `eval_board` and `eval_boards` return
  `strength = 7463 - treys_rank`, with -1 for blocked combos. **[V]**
- **Tests.** `solver/tests/test_gto.py:38-70` (`test_eval`, `test_eval_boards`) compare against treys' `Evaluator`
  on 8 special boards plus 30 random boards × 200 combos. **[V]**
- **Coverage gap.** The README claims the evaluator is "identical to treys on 18,000 random hands" (README
  "Evaluator", around line 1538). The current tests cover about 7,600 combo-boards, so that claim is not reproduced
  as written. **[V]/[M]**
- **Equity.**
  - `pf_equity.py` holds generated preflop class-vs-class equities: 3000 random boards (seed 7) via
    `scripts/build_preflop_equity.py`, stored as uint16/65535.
  - Live preflop all-in equity samples `PREFLOP_BOARDS = 400` boards (`advisor.py:217`), or `MULTI_BOARDS = 400`
    against several ranges. That is Monte Carlo with about ±2.5% standard error per combo at 400 boards **[I]**:
    binomial error at p ≈ 0.5, before ties.
  - `pf_classes.py:36` `equity_matrix` and `:49` `equity_vs`.
  - Runouts come from `test_runouts.py` and the `runouts.js` front end.
  **[V]**

---

## 4. Preflop

### 4.1 Where preflop numbers come from

| Component | Kind | Evidence |
|---|---|---|
| `gto/preflop.py` charts: RFI, vs-open, 3-bet/4-bet, heads-up `HU_SB` (`:106`), `HU_BB_VS_SB` (`:110`), `HU_SB_VS_3BET` (`:526`), `HU_BB_VS_4BET` (`:533`) | **Hand-curated, tuned to third-party published solves** | Module header: "hand-written approximations of solver outputs". Source comments at lines 91-94, 121-169, 226-271, 354-387, 431-484, 560-568 name gtopreflop.com (23 mentions), Poker Academy (11), GTO Wizard (9), Preflop Wizard (8), BeyondGTO (6), pokalab (4), GTO Gecko (3), GTO Ranges+/thinkgto (2) **[V]** |
| `gto/exploit.py` pool adjustments | **Heuristic, third-party informed** | Upswing 10, GTOkiller 7, GTO Wizard 4, Maxploit 3 mentions **[V]** |
| `solver/docs/preflop_research.md` | research notes | Cites PokerCoaching (`:164`) and GTO Wizard HU 50bb (`:336`) **[V]** |
| `gto/pf_game.py` | **Solver-derived** equilibrium: an abstract preflop game solved by DCFR level by level, linear averaging | Measured 2.5-3.0 points off the charts; BTN opens 37.6% (README) **[M]** |
| `gto/pf_solve.py` | Solver-derived, with fixed realization factors `REALIZE = {"3bet": {ip 1.0, oop 0.80}, "4bet": {ip 1.0, oop 0.90}}` | **[V]** |
| `gto/pf_formats.py` + `pf_format_data.py` | Other formats (stacks, table sizes): `chart(game) = chart_100 + solve_game - solve_100`, with deltas in the generated `DELTAS` | **Solver-derived delta applied to hand-curated base [V]** |
| `gto/pf_game_data.py` | Generated `MW_CORR` multiway corrections over 600 boards | **[V]** |
| `pf_realize.py` (generated: 6 3-bet pots, "128 flops, 5.0s per solve"), `pf_realize_model.py` (R² 0.21-0.74), `pf_eqr.py` (round-2 fixed point, 102 flops per spot, 120 iterations) | Realization (EQR) models fit to postflop solves | **[V]** headers. Pre-action realization values in `pf_eqr.py`: 1oop-aggr 0.98, 1oop-caller 1.01, 1ip-aggr 1.16, 1ip-caller 0.85, 2oop-aggr 0.91, 2oop-caller 1.01, 2ip-aggr 1.15, 2ip-caller 0.90, 3oop-aggr 1.07, 3oop-caller 1.02, 3ip-aggr 1.22, 3ip-caller 0.96 |
| `pf_libvals.py` | Values derived from the flop library | **[V]** |
| `pf_study.py` | `AVG_POWER 8`, target about 1.5 mbb/hand | **[V]** |
| `pf_classes.py:65` | Push/fold by fictitious play | **[V]** |

**Recorded accuracy [M].**

- The charts are within 1.0 points on average of the 26 published reference spots (`tests/preflop_refs.py`;
  `TestPublishedPreflopReferences`, `TestPublishedBlindFrequencies`).
- Realization in BTN vs BB single-raised pots is 1.13 / 0.85, against published 1.14-1.18 / 0.79-0.87.

### 4.2 Known preflop model failures (`expectedFailure`, `solver/tests/test_gto.py`) [V]

| Line | Test | Documented reason (from comments) |
|---|---|---|
| 2797 | `test_pairs_in_order` | The raw realization table is noisy per class: 99 gets 1.76 bb vs 88 2.31 |
| 2811 | `TestRealizationTable.test_stable_across_flop_halves` | Splitting flops into halves gives 0.55 / 0.45 |
| 2834 | `test_close_to_charts` | UTG vs CO calls 14% (chart 26%); BTN vs SB 50% (chart 36%) |
| 2909 | `TestRealizationModel` stable halves | The 3-bettor's call share moves 10-11 points between halves |
| 2932 | `TestRealizationModel.test_close_to_charts` | Out-of-position openers call 2-2.5× the charts |

**Consequence.** The EQR-driven preflop ranges are not consistent with the charts. LIZARD must present the charts as
the curated answer and label any EQR or `pf_game` output as model-based.

---

## 5. Multiway

- **3-player solver.** `solver/gto/multiway_solver.py` explicitly offers no Nash guarantee for 3+ players and reports
  `nash_conv`, the sum of the players' best-response gains (header lines 1-40). It uses:
  - exact 3-range card removal by inclusion-exclusion in O(52n)
  - ties scored as `W_q W_r + E_q E_r / 12`
  - `MWConfig` (`:69-110`): flop bet 0.33, turn/river 0.5, `raise_frac 0.75`, `max_raises 2`, `allin_spr 1.5`,
    `exact True`, `alternate True`, `later "deal"|"buckets"`, `buckets 16`, `classes`, `icm`, `root_raise`,
    `root_jam`
  - iterations in `mwcore.c`

  **[V]**
- **4-way** uses pairwise kernels (`MW4_BETS`, `advisor.py:96`). N-player rivers are supported. **[V]**
- **5+ players.** `mw_nway_max` is 5 (Fast) or 6 (Accurate) in `worker.js`, and `Advisor.mw_nway_max = 6`. Beyond
  that, or where no solve applies, the answer comes from **betting rules** (heuristic), labeled `triage.source =
  "rules"`. **[V]**
- **Recorded accuracy [M].**
  - N-player kernels are within 0.3-0.7% of the exact 3-way kernels (2.2% worst).
  - A 4-way spot reaches 0.14% in 100 iterations.
  - The 3-way library is 0.06-0.08% of the pot.
  - Native 3-way Fast: a flop first to act reaches 0.7-1.05% in 111-125 iterations; turns 0.1%; 4-way flops 0.04% at
    200 iterations (`native.py:104-112`).
- **ICM in multiway.** `MWConfig.icm` uses `icm.MWPayoffs` (`icm.py:487`). A chip-EV solve on a bubble gives up
  3.3-5.5% versus a prize-EV solve at 0.002-0.015% (README). **[M]**
- **3-way library.** `solver/gto/mw_library.py` has `FORMAT 1`, `MODEL_VERSION 1`, index `mw_index.json`, and 8
  spots listed of which 4 are built. `REP_FLOPS` holds 184 flops plus `EXTRA_FLOPS ["Kc7d2h"]`, making 185 per spot.
  Borrowing is allowed within `MW_BORROW_DIST 0.5` / `MW_BORROW_COVER 0.9`. Answers carry
  `"solver": {"iterations": None, "exploitability_pct": None, "by": "the 3-way flop library"}` (`advisor.py:6649`).
  **[V]**

---

## 6. Tournament math

- **`solver/gto/icm.py` [V].**
  - Malmuth-Harville computed exactly by dynamic programming, O(2^n · n), with `MAX_PLAYERS = 12`: `equities`
    (`:28`), `_mh` (`:53`), `equities_batch`
  - `field_stacks` (`:166`), `compress_payouts` (`:179`), `parse_payouts` (`:587`)
  - `Bounties` (`:201`): a proportional PKO model, which is a heuristic convention, not a game-theoretic derivation
  - `Model` (`:232`), `HUPayoffs` (`:434`), `MWPayoffs` (`:487`)
- **Push/fold.** At or below `PUSH_FOLD_STACK = 12` bb, an open is all-in (`advisor.py:228`); solved by fictitious
  play in `pf_classes.push_fold`. `ICM_COMMIT = 1.0` scales the risk premium for calls (`advisor.py:226`). The charts
  are written for `CHART_STACK = 100` bb (`:229`). **[V]**
- **Tests.** `solver/tests/test_icm.py` and `solver/tests/test_bounty.py`; `test_multiway_solver.py::TestTournament`.
  **[V]**
- **Accuracy tier.** The MH equity computation is exact for its model, but Malmuth-Harville is itself only an
  approximation of real tournament equity. The bounty model and preflop ICM adjustments are heuristic.

---

## 7. Measuring accuracy

### 7.1 Exploitability (`Solver.exploitability`, `solver.py:2170-2197`) [V]

- Each player's best response to the other's average strategy is evaluated by the core's BR pass, or in numpy by
  `_best_response` at `:2134`, which responds by bucket in a bucket game.
- The result is `(v0 + v1) / 2 / pairs / root.pot_now * 100`: the mean best-response gain in percent of the street's
  starting pot, normalized by the compatible hand pairs.
- In raked or ICM games, which are not zero-sum, each best response is measured against what its player gets under
  the average strategies.
- `br_values` records the per-player values.

**Caveat.** The best response is computed in the same abstract tree, with the same buckets and classes. It is a
lower
bound on full-game exploitability, not a full-game number.

### 7.2 Reference measurements in the repository [M]

**postflop-solver comparison** (`README.md:1739-1811`, dated 2026-10-29, compiled core). The harness is
`solver/scripts/bench_postflop_solver.py`. It needs `scripts/pfbench` (AGPL-3.0), which is excluded from this
snapshot (`UPSTREAM.json`; `bench_postflop_solver.py:48`, exits at `:437`).

| Spot | Mode | Iterations / time | Exploitability (own) | EV given up vs postflop-solver |
|---|---|---|---|---|
| River | Fast | 1000 / 0.17 s | 0.014% | 0.008 / 0.009 (max 0.016) |
| River | Accurate | - | 0.013% | 0.006 / 0.010 |
| Turn, single-raised pot | Fast | 81 / 4.8 s | 0.93% (0.61-2.72) | 0.19 / 0.25 (max 0.50); root mix 9.6 points off |
| Turn, single-raised pot | Accurate | 334 / 29.8 s | 0.14% | 0.010 / 0.010 (max 0.076) |
| Turn, 3-bet pots | Fast / Accurate | 863 / 1000 | 0.007% / 0.008% | < 0.005 |

**Turn/river reference suite** (`scripts/turn_river_reference.py`, `solver/tests/test_turn_river.py`,
`tests/data/turn_river_refs.json`, `.npz`; README table around `README.md:1566`):

- Browser Fast turn EV error 7.1 → 1.0 → 0.47; frequency error 7.9 → 3.1 → 1.8
- Browser Accurate 2.3 → 0.18 (0.08-0.33); frequency 5.7 → 0.7
- Native Fast about 0.47; native Accurate 0.23 (0.11-0.32)
- River root 3.1 → 0.3

**River theory tests** (`TestRiverTheory`): bluff shares 25.4 / 30.9 / 34.5 vs theory 25.3 / 35.8 / 40.0; defence
65.0 / 43.5 / 31.9 vs 66.2 / 44.3 / 33.3.

**Closed-form games** (`solver/tests/test_cfr.py`): AKQ, clairvoyance and [0,1] games are matched exactly, with
exploitability exact to 4 places. **[V]** (test file read)

### 7.3 What the UI shows today [V]

- The answer JSON carries `solver.exploitability_pct` (`advisor.py:5160-5166`).
- `study.js:529` classifies roughness: under 3% is fine, 3-10% is "meh", above that is "bad". `UNSETTLED = 3.0`
  (`advisor.py:200`) is the page's "converged" cutoff.
- `runouts.js:154-165` and `study.js:544-593` write "N iterations, X% of the pot from equilibrium".
- `simple.js:70` uses exploitability as a tolerance when comparing actions.

### 7.4 Library accuracy targets [V]/[M]

- `scripts/build_flop_library.py`: `--min-iters 200`, `--max-iters 1000`, `--check 100`, `--target 0.15`. Entries are
  built to at most 0.15% of the pot in their own game. **[V]**
- README: mean 0.109%, 300-800 iterations. **[M]**
- Live heads-up build logs (read-only, **[V]**):
  - `hu_2max.log`: 367 entries, 300-400 iterations, exploitability 0.077-0.148% (mean 0.113), 58-10,662 s (mean
    148 s)
  - `hu_lp.log`: 154 entries, 300-500 iterations, 0.096-0.150% (mean 0.122), mean 118 s
- **Losses on top of the stored exploitability [M]:**
  - a third flop size that is not stored gives up ≤ 0.02
  - stored turn strategies give up 0.50 / 0.67 on the played card and 0.81 / 0.63 on other cards in the class
    (`turn_node` docstring, `flop_library.py:897-905`)
  - turn EVs are 0.15-0.36% off
  - nearest-flop and off-tree reads are lower confidence (section 8.6)
- **Coverage [M]** (`test_coverage.py`; README): the library answers 83.6% of heads-up flop decisions. A fuzz over
  6,628 decisions gave charts 63%, live 24%, rules 12%, library 1.4%.

---

## 8. Precomputed library formats

### 8.1 Layout [V]

```
<library>/index.json                      # format 2 index (all spots)
<library>/<spot_id>/<flop>.bin            # GTOFL3 entry, flop in canonical form (e.g. Kc7d2h)
<library>/<spot_id>/<flop>.turn.bin       # GTOTN1 turn file (optional; spot "turns")
<library>/<spot_id>/report.json           # the spot's summary (page "report"), hash in spot.report
<library>/<spot_id>/ranges.json           # both ranges entering the flop, 1/10000 weights + fps
<library>/mw_index.json                   # the 3-way library index (gto/mw_library.py), format 1
```

- Files are fetched as `<spot>/<flop>.bin?v=<hash>` (`FlopLibrary.entry`, `flop_library.py:1110`).
- The local copy `solver/gto/static/flop_library/` is gitignored and must not be committed (`UPSTREAM.json`
  excluded list). It currently holds all 18 published spot folders, `index.json`, `mw_index.json` and the 4 built 3-way spot folders.

### 8.2 `index.json` (format 2) [V]

The shape, from the published index (732,218 bytes; identical to the local copy) and the HU build indexes:

```json
{
  "format": 2,
  "tree": {"sizes": {"flop_bet": [0.33, 0.75], "flop_raise": [0.5], "bet_turn": [0.75], "bet_river": [0.75],
                     "raise_turn": [0.75], "raise_river": [0.75], "max_raises": 2, "allin_spr": 2.5, "depth": 2,
                     "rake": null},
           "model": {"river_play": true, "turn_classes": true, "flop_leaf_rivers": 4, "version": 1}},
  "spots": [
    {"id": "srp_btn_bb", "label": "BTN vs BB single-raised pot",
     "line": "UTG:f,HJ:f,CO:f,BTN:r2.5,SB:f,BB:c",
     "seats": ["BB", "BTN"],                        // [OOP, IP]
     "fp": ["bf187f8767c1fbc7", "8e8dab4d6a65fb88"], // range_fp of the two ranges entering the flop
     "pot": 5.5, "stack": 97.5,
     "tree": {"sizes": {...}, "model": {..., "river_dealt": 64}},   // this spot's tree (else the index's)
     "flops": {"2h2d2c": "d749b47d1b", "...": "..."},              // canonical flop -> sha1(entry)[:10]
     "turns": true,                                 // or a list of flops with a .turn.bin, or absent
     "report": "6d522c1bda",                        // hash of report.json
     "old_tree": {"sizes": {...}, "model": {...no river_dealt...}}, // only on spots with blind-river entries
     "old": ["2h2d2c", "..."],                      // flops whose entry is on old_tree
     "game": {"players": 2, "stack": 100.0, "ante": 0.0, "straddle": false}  // non-6-max formats only
    }
  ]
}
```

- The spot key is `(fp0, fp1, round(pot, 2), round(stack, 2))` (`flop_library.py:1092-1099`).
- An index whose `format` is not 2 is treated as empty (`:1089`).
- `write_index` (`scripts/build_flop_library.py:220`) writes `index.json.tmp` and then `os.replace`s it. It drops turn
  files that are not listed. `write_entry` (`:111`) writes each entry atomically through a `.tmp` file. **[V]**

### 8.3 Entry `.bin` (GTOFL3, `pack` / `decode`, `flop_library.py:485-650`) [V]

An entry is `b"GTOFL3"` + zlib( `<I` header length + JSON header + body ).

**Header:**

- spot, fp, pot, stack, board (canonical), seats
- `iters`, `seconds`, `expl` (the stored exploitability, % of the pot)
- `format: 2` and `tree` (the `tree_hash`, sha1[:12])
- `q: 100` and `ev: [step, D_LIN=32, D_BASE=1.04]`, where `step = EV_STEP 0.01 × pot`
- optionally `players` (3-way entries)
- `nodes`: a list of `{path, player, names, fold0, freqs, combos}`

**Body:**

1. Per player, a bitmask over suit-isomorphic representative combos (`iso_reps`).
2. Per node:
   - (A-1) × k uint8 strategy steps, in 1% units; the last action takes the remainder
   - k int16 node values (best-action EV / step), stored as low bytes then high bytes
   - per action (rows that are not fold, if `fold0`), a uint8 code for the gap below the best action: linear in steps
     up to 32% of the pot, then 4% geometric steps

**Stored nodes and sharing:**

- A node is stored when the other player reaches it with at least `STORE_LINE = 5%` of their range (`stored_paths`,
  `:365`).
- Combos in the same suit-isomorphism class share one stored value.
- `decode()` returns `{"head", "masks": [oop, ip] (1326 bools), "nodes": [{path, player, names, fold0, freqs, combos,
  strat (A, n_p), evs (A, n_p)}]}`. Paths are lists of action names from the flop root, for example
  `["check", "bet 33%"]`.
- `report.json` encodes the same paths `|`-joined, for example `"check|bet 33%"`.

### 8.4 Turn file `.turn.bin` (GTOTN1, `flop_library.py:656-935`) [V]

A turn file is `b"GTOTN1"` + zlib( header + body ).

**Header:**

- `format` (1, or 2 with EVs), `board`, `entry` (`entry_hash` = sha1[:12] of the entry bytes), `q: 20` (5% steps),
  `reach`
- `classes: [[played card, class cards]]`
- `lines: [{path, share, pot, nodes: [{at, player, names}]}]`

**What is stored:**

- Lines are flop action paths taken by at least `TURN_LINE` = 1% of hand pairs.
- Nodes are `TURN_NODES = ((), ("check",))`: the first turn decision, plus the in-position decision after a check.
- Combos are those reached with at least `TURN_REACH` = 0.5% of the maximum reach, excluding the played card.

**Body:**

1. Per line, two 1326-bit masks.
2. Per node and class, (A-1) × k uint8 steps.
3. Format 2 then appends int16 range EVs of shape (K, 2) per line, and action EVs of shape (K, A) per node. These are
   in units of `ev × pot` (`TURN_EV_STEP 0.001`, or the first of `TURN_EV_STEPS` that fits), with
   `TURN_EV_NONE = -32768` meaning empty.

**Lookup.** `turn_node(t, path, at, card)` (`:897`) finds the class containing the card, the line with that `path`,
and the node with that `at`. A non-played card of a class reads the played card's strategy, with combos mapped by
image. A turn file is only accepted when `head.entry.startswith(index hash)` (`FlopLibrary.turns`, `:1129-1143`).

> **There is no `T:<card>` node-path notation anywhere** in `solver/gto/`, `solver/scripts/`, `solver/tests/` or the
> static JS (searched with grep). If LIZARD wants a single string address for turn nodes, it must define its own, for
> example `"<flop path>|T:<class played card>|<turn path>"`, and translate it to `(path, card, at)` at the boundary.
> It must never be written into library files. **[V]**

### 8.5 `report.json` and `ranges.json` [V]

```json
// report.json (REPORT_FORMAT 1, build_report at flop_library.py:1322; REPORT_RUNOUTS 8)
{"format": 1, "id": "srp_sb_bb_2max", "label": "...", "line": "SB:r3,BB:c", "seats": ["BB", "SB"],
 "pot": 6.0, "stack": 97.0, "game": {...},
 "nodes": {"": ["check", "bet 33%", "bet 75%"], "check|bet 33%": ["fold", "call", "raise to 7"], "...": []},
 "flops": [{"f": "3c2h2d", "hash": "6b08a58f0d", "w": 12.0,          // w: the flop's weight (combinatorial)
            "ev": [1.6, 4.4], "eq": [0.446, 0.554],                  // range EVs (bb) and equities, [oop, ip]
            "n": {"": [1.0, 0.0, 0.0], "check": [0.02, 0.241, 0.739]},   // range frequencies per node
            "h": {"": "2s2c", "check": "Ks9d"}}]}                    // a sample hand per node
// ranges.json
{"format": 1, "id": "srp_sb_bb_2max", "fp": ["be1e8f5e7b61b5b6", "8e09a13ab78f9ab8"],
 "w": [[10000, 10000, ...1326], [...1326]]}   // weights x 1e4, cards.ALL_COMBOS order
```

`range_fp` (`flop_library.py:315`) is sha1 of int32 `round(w × 1e4)`, truncated to 16 hex characters. Changing any
chart weight by 0.0001 changes the fingerprint, and every entry for that spot then misses. **[V]**

### 8.6 Lookup path and failure modes (`FlopLibrary.solution`, `flop_library.py:1145-1232`) [V]

1. The board must be a 3-card flop and the index non-empty.
2. The spot is found by `range_fp(full0), range_fp(full1), pot, stack`, or is a **borrowed** spot supplied by
   `flop_approx.near_exact` (`{"spot", "cover", "dist"}`).
3. The sizes key and model version must equal the advisor tree's. Rake may be ignored when `unraked`; section 2.4
   gives the measured cost.
4. The flop is canonicalized (`canonical`, `:250`; there are 1755 canonical flops), and the entry is fetched and
   validated: `head.fp == spot.fp` and `head.tree == tree_hash(entry_tree)`.
5. Combos are mapped to their canonical form (`combo_map`). Every live combo must be in the entry's masks; otherwise
   the lookup misses. For a borrowed spot, combos outside the entry are dropped unless they are the hero's hand.
6. A depth-1 flop tree is built with `TreeBuilder`. Every stored node path and name list must match; otherwise the
   lookup misses. Stored strategies are written into `ssum` and `regret`.

**Answer shape.** `LibrarySolution.info()` (`:1046-1049`) returns:

```json
{"spot", "label", "board", "iterations", "exploitability_pct", "same_tree",
 "borrowed": {"spot", "cover", "dist", "text"}}
```

It reaches the answer as `"precomputed"` (`advisor.py:5169`), with `"solver": {..., "by": "the flop library"}`
(`advisor.py:3674-3675`, `:7120`, `:7165`).

**Misses.** A lookup misses on:

- custom ranges, other stacks or table formats, or changed charts
- rake (unless read unraked)
- a turn or river board
- the hero's hand being off the spot's range
- a non-library menu

On a miss, the Advisor falls back through these, in order:

- the nearest stored flops (`gto/flop_approx.py`; a learned correction in `flop_approx_model.py`, 18 spots × 80
  flops)
- off-tree price reading (`gto/off_tree.py`: methods near / interp / mdf / prop / nearmdf)
- a library flop's stored turn
- an earlier street's live solve
- a Quick solve
- the betting rules

The confidence assigned to each (`advisor.py:3110-3125`) is **high** for charts and the spot's own entry; **medium**
for a borrowed spot, a stored turn, or a Quick solve within `TRIAGE_SETTLED` (1.0%); **low** for nearest flops,
off-size reads, earlier street solves, rougher Quick solves, and rules. The measured agreement with a Fast solve:
stored turn 13/13, Quick within the settled threshold 88%, nearest flops and earlier street 62%. **[V]**/[M]

### 8.7 Published library inventory (`www.michael-han.com/gto-solver-library/index.json`, fetched read-only) [V]

| Spot | Pot / stack | Flops | Tree | Turn files |
|---|---|---|---|---|
| srp_btn_bb | 5.5 / 97.5 | 1755 | dealt (83dfa5b8d830) | all |
| 3bp_bb_btn | 20.5 / 90 | 1755 | dealt | 1203 |
| 3bp_btn_co | 16.5 / 92.5 | 1755 | dealt | 1203 |
| 3bp_sb_btn | 21 / 90 | 1755 | dealt | 1203 |
| 3bp_sb_co | 21 / 90 | 1755 | dealt | 1203 |
| 3bp_hj_utg | 16.5 / 92.5 | 1755 | dealt | 1203 |
| 3bp_bb_co | 20.5 / 90 | 1755 | dealt | 1698 |
| 3bp_co_hj | 16.5 / 92.5 | 1755 | dealt | all |
| 3bp_bb_sb | 20 / 90 | 1755 | dealt | all |
| srp_co_bb, srp_sb_bb, srp_hj_bb, srp_utg_bb | 5.5-6.0 / 97-97.5 | 1755 each | **all `old` (blind, 31f56a470ae2)** | none |
| srp_hj_co, srp_btn_sb, srp_utg_hj, srp_co_sb, srp_utg_btn | 6.0-6.5 / 97.5 | 552 each | **all `old` (blind)** | none |

- Totals: 18 spots, 25,575 entries (72.65 MB), 12,978 turn files (167.57 MB). Every flop of the 9 old-tree spots is
  in its `old` list.
- `SPOTS` (`flop_library.py:77-97`) also defines `lp_sb_bb` (`FORMAT_ONLY`). `SPOT_FLOPS` (`:111-114`) gives 1755 or
  552 per spot, and 552 for both `srp_sb_bb_2max` and `lp_sb_bb_2max`.
- **Stale documentation.** `solver/README.md:4733` ("The flop library was solved with the river on the turn's boards")
  is accurate only for the 9 old-tree spots.

### 8.8 The running heads-up builds (read-only inspection, 2026-11-03) [V] unless noted

| | `.work/hu-lib` | `.work/hu-lp-lib` |
|---|---|---|
| Spot | `srp_sb_bb_2max` ("SB vs BB single-raised pot, heads-up", line `SB:r3,BB:c`) | `lp_sb_bb_2max` (line `SB:c,BB:x`) |
| Seats / pot / stack | ["BB", "SB"] / 6.0 / 97.0 | ["BB", "SB"] / 2.0 / 99.0 |
| fp | be1e8f5e7b61b5b6, 8e09a13ab78f9ab8 | (in its index) |
| `game` | {"players": 2, "stack": 100.0, "ante": 0.0, "straddle": false} | same |
| Index format / top tree | 2 / identical to the published index | 2 / identical |
| Spot tree | identical to the published river-dealt spots (`river_dealt: 64`) | identical |
| Entries listed / on disk | 358 / 364 (unlisted: QcJc5d, QcJc6d, QcJd2c, QcJd3c, QcTd8d, QcTd9c) | 148 / 150 (unlisted: Ac9d8h, AcTd3h) |
| Turns | `true`; turn files are format 2 (with EVs, `--turn-evs`) | same |
| Integrity | each listed hash = sha1(entry)[:10]; report hash matches; ranges.json fp matches | same |
| Target | `SPOT_FLOPS` 552; log `[289/474 ... ~528 min left]` | 552; log `[26/424 ... ~774 min left]` |

- **Only finished entries are listed.** The index is rewritten periodically, so an entry written after the last
  rewrite exists on disk but is not yet listed. `.tmp` files are in-progress writes.
- **Merge procedure** (to run only on LIZARD's own copy, never in `.work`):
  1. Append each HU spot object to the published index's `spots`.
  2. Copy only the `.bin` and `.turn.bin` files the index lists, plus `report.json` and `ranges.json`. Do not copy
     unlisted or `.tmp` files.
  3. Verify `sha1(entry)[:10]`, the header `fp` and `tree`, and that the turn header's `entry` starts with the listed
     hash.
- **No key collisions.** The 6-max `srp_sb_bb` has the same pot and stack (6.0 / 97.0) but different fingerprints,
  so the spot keys do not collide. Format-specific spots carry `game`. Borrowed 6-max spots are labeled "6-max ..."
  (`flop_library.py:1224`).
- **Compatibility evidence [I].** The build commits `f3a0edda` (open) and `983cfef7` (limped) are ancestors of
  `9b907bd6`. Between them and the snapshot, the changes touch only `core/mwcore.c`, `gto/advisor.py`,
  `flop_approx.py`, `flop_library.py` (89 lines changed), `multiway_solver.py`, `mw_library.py`, `mwcore.py`, `off_tree.py`,
  `routes.py` and `server.py`. Nothing in `solver.py`, `core.py`, `gtocore.c`, `preflop.py`, `pf_formats.py`,
  `pf_format_data.py` or `evaluator.py` changed. So fingerprints, tree keys and decoding should still match. The
  fingerprints were not recomputed, because that requires importing the solver.

### 8.9 `mw_index.json` (3-way, format 1) [V]

```json
{"format": 1,
 "tree": {"bet": {"flop": [0.33, 0.75], "turn": 0.5, "river": 0.5}, "raise_frac": 0.75, "max_raises": 2,
          "allin_spr": 1.5, "later": "buckets", "buckets": 16, "classes": true, "bucket_river_step": 1,
          "exact": true, "rake": null, "version": 1},
 "spots": [{"id": "mw_co_btn_bb", "label": "CO open, BTN and BB call",
            "line": "UTG:f,HJ:f,CO:r2.5,BTN:c,SB:f,BB:c", "seats": ["BB", "CO", "BTN"],
            "fp": ["...", "...", "..."], "pot": 8.0, "stack": 97.5, "flops": {"4c3c2c": "b0f8a84955"}}]}
```

The built spots are `mw_co_btn_bb`, `mw_btn_sb_bb`, `mw_hj_ip_bb` and `mw_utg_btn_bb`, with 185 flops each. Entries
reuse GTOFL3 with `head.players = 3` and one mask per player (`decode`, `flop_library.py:629`).

---

## 9. Known limits and failure modes

These are grouped by source: the README "Known limits" section (`solver/README.md:4545-4735`), the code, and tests.

1. **Abstraction error is invisible to exploitability.** Menus, bucketing, suit classes, `later_sizes` 0.75 and equity
   leaves are not counted in the reported number (section 7.1). **[V]**
2. **Library entries come from two tree models.** Nine spots use the blind river, which is worse by 0.2-0.4% of the
   pot (section 2.5). `same_tree` reports whether an entry matches the advisor's tree, but the UI does not show it
   prominently. **[V]**
3. **Unraked library read at raked tables.** This gives up 0.15-0.18% of the pot (worst 0.58), and EVs run 6-11%
   high, so they are hidden (`RAKE_READ`). **[V]/[M]**
4. **Stored turns.** They give up 0.5-0.9% of the pot and cover only the first decision and the in-position decision
   after a check. **[M]**
5. **Fast at single-threaded browser speeds.** The turn's root mix can be about 10 points off, with exploitability up
   to 2.7% (postflop-solver table). **[M]**
6. **A short budget means a rough answer.** On a busy machine fewer iterations run. `OVER_TARGET` and `rough_ev`
   (`advisor.py:237`) flag this; `CAP_ITERS 30` sets a floor. One measurement: 19 iterations on a limped turn were
   38% of the pot from equilibrium (`advisor.py:135`). **[V]/[M]**
7. **Rarely taken lines are poorly trained.** These are lines under `RARE_LINE` 10% or `RARE_BRANCH` 1%. The solver
   widens the villain's range (`widened`) or re-solves (`RARE_RESOLVE`). **[V]**
8. **Multiway.** There is no Nash guarantee. 5+ players (or 6+ at Accurate) fall back to rules. **[V]**
9. **Preflop.** The charts are curated, and EQR is inconsistent with them (the five `expectedFailure` tests).
   `pf_game` is 2.5-3.0 points off. **[V]/[M]**
10. **Bet labels.** Nominal labels misstate small-pot sizes (section 2.3). **[V]**
11. **Evaluator test coverage** is smaller than the README claim (section 3). **[V]**
12. **Fragile fingerprints.** Any edit to a chart, rounding change or range-builder change invalidates every library
    entry for that spot. There is no warning, just misses. **[V]**
13. **`TreeTooBig` and trims.** A large custom menu gets trimmed; that should be surfaced as a provenance caveat.
    **[V]**
14. **The postflop-solver harness is AGPL.** It is excluded from the snapshot and must stay out of shipped code
    (`third-party-notices.md:64`). Benchmarks cannot be rerun from this checkout without restoring it in a separate,
    unshipped location. **[V]**

---

## 10. Recommendations

### 10a. Modules LIZARD should treat as frozen numerics (wrap, do not modify)

| Area | Files | Why |
|---|---|---|
| Heads-up CFR and trees | `solver/gto/solver.py`, `solver/gto/core.py`, `solver/core/gtocore.c`, `solver/gto/core*.wasm`, `solver/core/build/*.so` | Engine equivalence (1e-5) and the tree key depend on these together |
| Multiway | `solver/gto/multiway_solver.py`, `solver/gto/mwcore.py`, `solver/core/mwcore.c`, `solver/gto/mwcore*.wasm` | Same reason |
| Cards, ranges, evaluation | `solver/gto/cards.py`, `solver/gto/ranges.py`, `solver/gto/evaluator.py` | Combo order is part of every stored file |
| Library I/O | `solver/gto/flop_library.py` (FORMAT, MAGIC, `canonical`, `combo_map`, `range_fp`, `tree_key`, `tree_hash`, `pack`/`decode`, `encode_turns`/`decode_turns`), `solver/gto/mw_library.py` | Byte-level compatibility with 240 MB of published data and the running builds |
| Preflop charts and formats | `solver/gto/preflop.py`, `pf_formats.py`, `pf_format_data.py` | Any change alters `range_fp` and silently invalidates the library |
| Generated data | `pf_equity.py`, `pf_realize.py`, `pf_realize_model.py`, `pf_eqr.py`, `pf_libvals.py`, `pf_game_data.py`, `flop_approx_model.py` | Regenerate only with their build scripts |
| Tournament | `solver/gto/icm.py`, `solver/gto/pf_classes.py` | Exact or closed-form pieces with dedicated tests |
| Speed configs | `solver/gto/native.py` `SPEEDS`, `worker.js` config strings, `advisor.py` budget and threshold constants, `index.html` `BUDGETS` | They define what "Fast" and "Accurate" mean in every measurement quoted above |

LIZARD's own code should sit on top of these. It can read `Advisor` answers and `FlopLibrary`, decode files, and
build its own UI. If a numerical change is ever needed, make it upstream, behind the regression gate below.

### 10b. One provenance record on every result

Today the data is spread across `triage`, `solver`, `precomputed`, `approximate`, `off_solution`, `widened`, `notes`
and the `by` strings. The proposal is to normalize these in one adapter function, without changing upstream:

```json
"provenance": {
  "source": "library | library_borrowed | library_turn | approx_nearest_flop | off_tree | live | live_quick | earlier_street | charts | pf_formats | pf_game | push_fold | mw_library | rules | fallback",
  "tier": "exact | near_exact | approximate | heuristic",
  "confidence": "high | medium | low",                 // triage.confidence where present
  "convergence": {"iterations": 300, "solve_seconds": 2.41, "exploitability_pct_pot": 0.11,
                  "measured_in": "abstract_game", "target_pct": 0.2, "settled": true, "rough": false},
  "tree": {"hash": "83dfa5b8d830", "sizes": {"flop_bet": [0.33, 0.75], "...": "..."},
           "model": {"river": "dealt64 | blind | buckets32 | strength32 | exact", "turn_classes": true},
           "same_tree": true, "trimmed": false, "off_tree": null, "widened": false,
           "actual_sizes_bb": {"bet 33%": 1.0}},
  "library": {"spot": "srp_btn_bb", "flop": "Kc7d2h", "canonical": "Kc7d2h", "entry_hash": "d749b47d1b",
              "index_sha": "...", "borrowed": null, "unraked": null},
  "engine": {"solver_commit": "9b907bd6", "lizard_version": "x.y.z", "backend": "native | wasm | wasm-mt | numpy",
             "threads": 4, "cfr": "dcfr-ramp", "speed": "quick | fast | accurate", "budget_s": [8, 3]},
  "inputs": {"ranges_fp": ["...", "..."], "pot_bb": 5.5, "stack_bb": 97.5, "rake": null, "icm": null},
  "caveats": ["blind river (old tree)", "unraked entry at a raked table", "..."]
}
```

How to fill it from existing fields:

| Field | Filled from |
|---|---|
| `source` / `confidence` | `triage.source` / `confidence`; also the `by` string ("the flop library", "hand buckets", "the 3-way flop library", "the flop's solve") |
| `convergence` | `solver.iterations`, `solve_seconds`, `exploitability_pct`, `approximate`, `target_pct` |
| `tree.same_tree`, `library.borrowed`, `library.unraked` | `precomputed` (= `LibrarySolution.info()`) |
| `tree.off_tree` | `off_solution` |
| `tree.trimmed` | `solver.cells` |
| `engine.solver_commit` | `solver/UPSTREAM.json` |

For library answers `iterations` and `exploitability_pct` may be null; take them from `precomputed`. Show
`exploitability_pct_pot` with the qualifier "in the solved game" everywhere.

### 10c. Regression gate before any numerical change

Run this only when the machine is free (not while the builds run). Compare against a baseline captured once and
stored under `docs/research/baselines/`.

1. **Algorithm identity:**
   - `solver/tests/test_cfr.py` (closed forms)
   - `solver/tests/test_core.py` (`TestSameAsNumpy`, the thread test, and the other compiler-gated classes; a C
     compiler must be present, otherwise they are skipped)
2. **Heads-up accuracy:**
   - `solver/tests/test_gto.py`: `test_eval`/`test_eval_boards`, `TestRiverTheory`, `TestRiverClasses`,
     `TestRiverStrength`, `TestFlopStrategy`, `TestPublishedPreflopReferences`, `TestPublishedBlindFrequencies`, plus
     the five `expectedFailure` tests, which must still fail as expected
   - `solver/tests/test_turn_river.py` (`TestTurnRiverReferences` against `tests/data/turn_river_refs.json`/`.npz`)
3. **Library I/O:**
   - `solver/tests/test_flop_library.py` (`TestCanonicalFlops`, `TestFlopLibrary`, `TestShippedLibrary` at `:807`,
     `TestOtherGames`)
   - `solver/tests/test_mw_library.py` (`TestShippedMWLibrary`)
   - `test_instant*.py`, `test_off_tree.py`, `test_rake_read.py`, `test_coverage.py`
4. **Multiway and tournament:**
   - `solver/tests/test_multiway_solver.py` (`TestCardRemoval`, `TestShowdownEquities`, `TestCore`, `TestFourWay`,
     `TestSidePots`, `TestNWay`, `TestTournament`)
   - `test_icm.py`, `test_bounty.py`
5. **Preflop:** `test_pf_game.py`, `test_pf_formats.py` (`TestShipped`), `test_pf_study.py`, `test_preflop_locks.py`.
6. **New tests LIZARD should add:**
   - **Golden decode tests.** Pin a handful of published entries (one per tree model, one 3-way, one HU) by hash.
     Assert on the decoded header fields, the stored node paths, and frequencies to within 1e-4. Assert that
     `range_fp(chart range) == index fp` for every spot; this catches silent chart drift. (There is a format-1 fixture
     already: `solver/tests/data/flop_v1_3bp_btn_co_Qc9c2d.bin`.)
   - **Size-label test.** Actual bet amounts against the labels for pots 2.0, 5.5, 6.0, 16.5 and 20.5.
   - **Pinned external benchmark.** Keep the postflop-solver comparison as an offline, unshipped harness (AGPL). Pin
     its version and the 2026-10-29 numbers in section 7.2. Accept changes only within tolerance: river ≤ 0.02 EV
     given up; Accurate turn ≤ 0.02 mean / 0.1 max.
   - **Determinism.** Same seed and same thread count must give an identical strategy hash. Record it in the
     provenance record (`engine`).

### 10d. Draft for `docs/ACCURACY.md`

The draft below is meant to go in `docs/ACCURACY.md` as written.

> **How accurate is LIZARD?** Every answer is labeled with where it came from and how close to equilibrium it is.
> "Exploitability" is how much a perfect opponent could gain against the strategy, in percent of the pot, measured
> **inside the simplified game that was solved** (its bet sizes, and on earlier streets its grouping of similar
> cards and hands). Real-game error is somewhat larger. The figures below come from the solver's recorded tests and
> benchmarks.
>
> **Exact**
> - Hand rankings (identical to the treys evaluator in tests).
> - Board and suit symmetry (canonical flops, combo mapping).
> - ICM equities under the Malmuth-Harville model (an exact computation of an approximate model).
> - River solves within their bet-size menu: matching an external solver to within about 0.01% of the pot.
>
> **Near-exact** (within about 0.15% of the pot of equilibrium in the solved game)
> - Accurate-mode turn solves: about 0.14-0.23% of the pot from full-game references; 3-bet-pot turns below 0.01%.
> - Precomputed flop library entries for their exact spot (≤ 0.15% in the solved game; mean about 0.11%).
> - 3-way library entries (0.06-0.08%).
>
> **Approximate**
> - Flop strategies versus the full game. This includes library flops: 0.2-0.5% of the pot when the river is dealt
>   by strength buckets, up to about 0.5% on older "blind river" entries.
> - Fast-mode turn solves (up to about 1-3% of the pot on slow devices).
> - Stored turn strategies from the library (0.5-0.9%).
> - Nearest-flop and off-size reads; borrowed spots.
> - Library reads at raked tables (about 0.15-0.2% extra, EVs hidden).
> - Bucketed multiway solves (no equilibrium guarantee for 3+ players).
> - Monte Carlo preflop all-in equities (400 boards).
>
> **Heuristic**
> - Preflop charts: hand-written approximations tuned to published third-party solver outputs, within about 1 point
>   on average of 26 published reference spots.
> - Preflop adjustments for rake, ICM, bounties and other formats (deltas from a simplified preflop model).
> - Equity-realization models (known to disagree with the charts in places).
> - 5+-way pots (betting rules).
> - Exploitative pool adjustments.

---

## Appendix: commands used (all read-only and light)

- `grep`/`sed`/`wc` over `solver/`.
- `python3 -I -c` JSON reads of `index.json`, `report.json`, `ranges.json`, `mw_index.json` and the build logs. The
  solver was never imported.
- `GIT_OPTIONAL_LOCKS=0 git diff --stat` and `merge-base` checks in the upstream checkout. These do not modify it.
- One `curl` of the published `index.json` into the session scratchpad.
- Nothing was written outside this report and the scratchpad. No process was signalled. No `.tmp` file was touched.

## Not verified, or open

- Fingerprint recomputation for the HU spots against this snapshot's charts. It needs the solver imported; run it
  when the machine is free.
- Per-entry `expl`/`iters` of the published library: an earlier pass found every entry at or below 0.15% with
  200-700 iterations. This pass did not re-check all 25,575 headers; the build's `--target 0.15` is consistent with
  that result.
- The precise standard error of the 400-board preflop equity is an estimate, not a measurement.
