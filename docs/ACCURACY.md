# Accuracy

This document explains how accurate LIZARD's poker answers are, how that accuracy is measured, and where it
breaks down. The first sections are for anyone using LIZARD. The later ones (provenance mapping, verification
commands) are for engineers. The solver itself is described in `docs/EXISTING_SOLVER_AUDIT.md`.

Paths are relative to `/Users/mhan/Desktop/projects/lizard/`. The tags are the same as in the audit:

| Tag | Meaning |
|---|---|
| **[V]** | Verified in code or data (`file:line`). |
| **[M]** | A measurement recorded upstream (README, a code comment, a test, a build log), quoted but not reproduced here. Most were taken on a 10-core Mac laptop, often while a library build was running. |
| **[I]** | Inferred, or a judgement. |

None of the numbers below were re-measured for this document: no solver, test or benchmark was run while it was
written.

---

## 1. The short version

- **Precomputed flops** (the library) are solved offline to at most **0.15% of the pot** from equilibrium inside
  their simplified game. A sample of 450 entries averaged 0.109% [V]. Compared with the full game, where every turn
  and river card is dealt and more bet sizes are allowed, they give up roughly **0.2-0.5% of the pot** [M].
- **Live solves** depend on the street, the mode, the device, and whether the page has threads.
  - **Rivers** are close to exact at every mode (about 0.01-0.04%) [M].
  - **Turns** at Accurate land around 0.1-0.3% [M]. Fast single-raised turns can be about 1% or worse on a slow or
    single-threaded device [M]. Quick turns are rough, about 6-7% in the browser [M].
- **Preflop charts are hand-made approximations** of published third-party solver results. They are not solved by
  this software. Their mean error against 26 published reference spots is about 1 percentage point [M].
- **Multiway pots** (3+ players) have no equilibrium guarantee. Pots with 5 or more players on the flop or turn
  are answered by heuristic betting rules, not a solve [V].
- **Tournament (ICM) answers** use the Malmuth-Harville model: exact for that model, but the model is itself an
  approximation. Preflop ICM adjustments and the bounty model are heuristics [V].
- **The rule:** every number LIZARD shows carries its provenance. Approximate answers are labelled. Charts and
  rules are never called "solved" (section 11).

---

## 2. How accuracy is measured

### 2.1 Exploitability, in % of the pot

- **Definition [V].** `Solver.exploitability` (`solver/gto/solver.py:2170-2197`) computes each player's best
  response to the other player's average strategy. It averages the two best-response gains, divides by the number
  of compatible hand pairs, and expresses the result in percent of the pot at the start of the street being solved
  (`root.pot_now`). An exact equilibrium of the solved tree scores 0.
- **What "% of the pot" means.** It is how much a perfect opponent who knew the whole strategy could win against it,
  on average per hand pair, as a share of the pot when the street began. For example:
  - 0.15% of a 5.5 bb single-raised flop pot is about 0.008 bb;
  - 1% of a 20 bb turn pot is 0.2 bb.

  Keep two things in mind. It is an average over both players' whole ranges, so a single hand can be further off.
  And it is a share of *this street's* pot, so figures from different streets are not directly comparable.
- **Raked and tournament games [V].** These are not zero-sum. Each best response is measured against what its
  player already gets under the average strategies (`solver.py:2183-2196`).

### 2.2 The abstraction caveat

The best response is computed **inside the same simplified game** the solver played (`solver.py:2170-2197`;
03 §7.1). That game has the same bet-size menu, the same grouping of turn and river cards into classes, and the
same hand buckets on later streets. So "0.1% exploitable" means 0.1% *within that abstraction*. Error from the
abstraction itself does not appear in the number. [I] Treat the reported figure as a lower bound on full-game
exploitability.

To estimate abstraction error, upstream used a second measure: **EV given up**. The strategy is handed to a
reference that plays a richer or exact game, and the reference measures how much worse the strategy does than
equilibrium. The references are:

- b-inary's open-source postflop-solver, which deals every turn and river card (`README.md:1739-1811`; the harness
  is excluded from this snapshot);
- the turn/river reference suite (`scripts/turn_river_reference.py`, `tests/data/turn_river_refs.json`);
- several `bench_*` scripts.

Section 4 quotes both kinds of number and says which is which.

### 2.3 Other measures used in places

| Where | Measure | Note |
|---|---|---|
| 3- and 4-way solves | Mean best-response gain of the players, % of the pot (`advisor.py:5423`) | There is no Nash guarantee with 3+ players. A small number means no single player gains much by deviating alone, not that the strategy is "the" equilibrium (`multiway_solver.py:1-10`) [V] |
| Preflop game solve (Study) | mbb per hand per seat; stops near `TARGET_MBB = 1.5` (`pf_study.py:68`) | Measured in an abstract preflop game (one size per raise, 169 classes, postflop valued by a realization model) [V] |
| Preflop charts | Percentage points of fold/call/raise share against published spots | Not an equilibrium measure at all [V] |
| Legacy badge | Under 3% "converged", under 10% "fair", above that "rough" (`advisor.py:200`, `help.js:147`) | LIZARD shows the number itself, with its source |

---

## 3. Accuracy by answer source

The sources match LIZARD's `ResultSource` (`web/src/solver/types.ts:11-18`) and what `ProvenanceBadge` shows.

| Source (badge) | What produced it | Typical accuracy | Tier |
|---|---|---|---|
| `library`: Precomputed solution | Offline DCFR solve of a stored heads-up flop (18 spots, 6-max 100bb cash, no rake), or a 3-way flop's first decisions (4 spots) | Heads-up: ≤ 0.15% in its own game (sample mean 0.109%, 200-500 iterations) [V]; about 0.2-0.5% given up against the full game [M]. 3-way: 0.06-0.08% [M] | Near-exact in its game |
| `live`: Live solve, Accurate | DCFR solve in the browser (60 s by the legacy budgets) or the local server (30 s) | Rivers about 0.013% [M]; single-raised turns 0.14% median (0.06-0.41) natively [M]; 3-bet-pot turns about 0.01% [M] | Near-exact in its game |
| `live`: Live solve, Fast | Same, 8 s in the browser or 2.5 s + 2.5 s natively; stops early once settled | Rivers about 0.014% [M]; single-raised turns 0.93% median (0.61-2.72) natively, about 0.07-0.8% in the browser with the compiled core [M]; flops in a bucketed game | Near-exact to approximate |
| `live`: Live solve, Quick | 1.5 s (river 0.8 s), smaller game | Rivers about 0.04%; turns about 6.4-6.9% in the browser [M] | Approximate |
| `charts`: Preflop charts | Hand-written ranges (`gto/preflop.py`), plus rule-based adjustments for other formats, rake and ICM | About 0.96 points mean error over 26 published spots [M]; test bar is a mean under 2 points [V] | Heuristic, not a solve |
| `preflop-solve`: Preflop solve | This solver's own equilibrium of an abstract preflop game (`pf_game.py`, `pf_study.py`) | Converges to about 1.5 mbb/hand in its own game [V]; 2.4-3.0 points from the published spots [M] | Solved in a simplified model |
| `rules`: Heuristic rules | Monte Carlo betting rules for pots no solver takes (5+ players on the flop or turn), or a fallback | No equilibrium measure. Each answer reports its trial count and a ± between the top actions [V] | Heuristic, not a solve |
| `equity`: Equity estimate | Hero's equity against random hands, priced against the pot (`advisor.py:3836-3838`) | A rough last resort [V] | Heuristic, not a solve |

Approximate reads also exist. They show at once while a real solve runs, or when nothing better is available.
Each is flagged `approximate` in the response:

| Read | Typical cost | Source |
|---|---|---|
| A library flop's stored turn strategy | 0.50-0.67% of the pot on the played card, 0.63-0.81% on other cards of its class (one flop) | `flop_library.py:903-905` [M] |
| Library entry read at a raked table (the entries are unraked) | 0.15-0.18% mean, 0.58% worst; stored EVs 5.7-11.4% of the pot too high, so EVs are hidden | `flop_library.py:972-975` [M] |
| Nearest stored flops, borrowed spots, off-menu sizes, an earlier street's solve | Lower confidence. In a 1,000-hand session, nearest flops and earlier-street reads matched the Fast answer's grade 62% of the time | `advisor.py:3110-3125` [M] |

---

## 4. Live solves in detail

### 4.1 Budgets and stopping rules

| Mode | Browser (legacy page) | Local server | Stops early? |
|---|---|---|---|
| Quick | flop/turn 1.5 s, river 0.8 s, plus 0.3 s per earlier street (`index.html:978`) | same | No settling check; never flagged approximate (`advisor.py:3011`) |
| Fast | 8 s + 3 s per earlier street (`index.html:974`) | 2.5 s + 2.5 s (`native.py:85-89`) | Browser: at the first check from iteration 300 where exploitability ≤ 0.2% (threaded) or 0.3% (one thread; turns from iteration 200) (`worker.js:260-261`). Server: runs its full budget |
| Accurate | 60 s + 12 s | 30 s + 12 s (`native.py:90-92`) | Runs its budget or 1,000 iterations |

- Checks happen at iterations 50, 100, 150, 200, 300, 400, 600 and 800 (`advisor.py:112`). The minimum is 10
  iterations and the maximum 1,000 (`solver.py:2083`).
- The budgets are **wall-clock seconds, not iteration counts**. A slower or busier device runs fewer iterations
  and gets a rougher answer.
- In the browser, a heads-up post-flop answer more than 10× its mode's target is flagged
  `solver.approximate` with `target_pct` (`advisor.py:102, 3003-3018`; targets at `worker.js:265`). That means
  above 2-3% at Fast and above 1% at Accurate. The native server sets no target (`advisor.py:2885`), so it never
  sets this flag.

> **LIZARD gap, fixed 2026-11-03 [V].** `applyMode` first sent only `quick` and `speed`. The worker builds its
> Advisors without budgets (`worker.js:240-245`), so every browser mode ran at the Advisor's default 4 s + 2 s
> (`advisor.py:2860`), and browser Accurate was not the measured 60-second mode.
>
> `applyMode` (`web/src/solver/client.ts`, `MODE_BUDGETS`) now sends the legacy page's budgets
> (`index.html:974-978`) for each mode and backend, as `budget` + `prior_budget`:
>
> | Mode | Browser | Local server |
> |---|---|---|
> | Fast | 8 s + 3 s | 2.5 s + 2.5 s (the server's own default) |
> | Accurate | 60 s + 12 s | 30 s + 12 s |
> | Quick, postflop (with `quick`) | 1.5 s + 0.3 s (river 0.8 s) | same |
>
> `client.test.ts` checks the mapping. The ModePicker hints now state these budgets.

### 4.2 Measured accuracy by street

"Own game" is exploitability inside the solved abstraction. "Vs reference" is EV given up, or per-combo EV error,
against a richer reference.

| Street, mode, host | Iterations, time | Own game (% pot) | Vs reference (% pot) | Source |
|---|---|---|---|---|
| River, Fast, native | 1,000, 0.17 s | 0.014 | 0.008 / 0.009 given up (OOP / IP) | `README.md:1756` [M] |
| River, Accurate, native | 1,000, 0.21 s | 0.013 | 0.006 / 0.010 | `README.md:1757` [M] |
| River, Quick, browser | (0.8 s) | about 0.04 | n/a | `help.js:101` [M] |
| River root menu (33/75/125/250%) | n/a | n/a | 0.1-0.6 per combo vs a six-size menu | `native.py:60-61` [M] |
| Turn single-raised, Fast, native | 81 (54-105), 4.8 s | 0.93 (0.61-2.72) | 0.19 / 0.25 given up (max 0.50); root mix 9.6 points off | `README.md:1758` [M] |
| Turn single-raised, Accurate, native | 334 (205-435), 29.8 s | 0.14 (0.06-0.41) | 0.010 / 0.010 (max 0.076) | `README.md:1759` [M] |
| Turn 3-bet pot, Fast / Accurate, native | 863 / 1,000 | 0.007 / 0.008 | under 0.005 | `README.md:1760-1761` [M] |
| Turn after a library flop, Fast, browser + core | 282, 11.2 s | 0.07 | n/a | `README.md:1829` [M] |
| Turn after a library flop, Accurate, browser + core | 486, 60.5 s | 0.07 | n/a | `README.md:1830` [M] |
| Turn, Fast, browser, loaded machine, one thread | about 105 | 0.3-0.8 | 0.34-0.55 per-combo EV vs rich reference | `worker.js:211-213` [M] |
| Turn, Accurate, browser + core | about 450-490 | n/a | 0.08-0.33 | `worker.js:216-217` [M] |
| Turn, Quick, browser | (1.5 s) | 6.4-6.9 | n/a | `help.js:101` [M] |
| Flop K72r (not stored), Fast / Accurate, browser + core | 646 / 1,000 | 0.03 / 0.01 | c-bet 2.5 / 1.8 points off vs a solve over every turn (12 flops, 400 iterations) | `README.md:1835-1836`, `worker.js:225-226` [M] |

The tight flop numbers are in a heavily bucketed game (section 7). The full-game comparison in the last column is
the honest one for flops.

### 4.3 Threads: single-threaded vs cross-origin isolated

- **Isolated with 4+ threads [V].** When the page is cross-origin isolated (COOP/COEP) the worker loads
  `core-mt.wasm` with `min(7, cores - 1)` helpers (`worker.js:107,143`). With at least 4 threads, Fast plays
  Accurate's richer turn tree (river 33/75/125%) and settles at 0.2% (`worker.js:235-265`). Threads give 2.5-3×
  the iterations [M]. On five single-raised turns, threaded Fast is about 0.12% per-combo EV off at 300 iterations
  [M] (`worker.js:232-234`).
- **Not isolated, or fewer than 4 cores [V].** Fast keeps its own smaller tree (river 33/125%, a 33/75% menu on
  shallow turns) and settles at 0.3%. That tree stays about 0.34% per-combo EV off however long it runs [M]
  (`worker.js:257`).
- **Measured side by side [M]** (`README.md:1846-1849`): an Accurate turn with a 15 s budget, beside a running
  library build, reached 191 iterations and 0.32% on 8 threads. Without isolation (1 thread) it reached 80
  iterations and 1.2%.
- **Fallbacks [V].** If the threaded module traps, the worker restarts single-threaded. If no core loads, it falls
  back to NumPy (`worker.js:98-152`). A Fast turn in NumPy is about 5-7% of the pot from equilibrium [M]
  (`worker.js:264`). LIZARD should show the thread count and core state next to the answer.

---

## 5. Precomputed library in detail

- **What is stored [V].** 18 heads-up spots, all 6-max, 100bb, unraked, at the charts' opening sizes. Thirteen
  spots hold all 1,755 canonical flops; five flatted-open spots hold 552 each. Each entry stores the flop
  strategies at nodes the opponent reaches with at least 5% of their range (`flop_library.py:42`), in 1% steps.
  Nine spots also store turn files: the first turn decision and in-position-after-check, in 5% steps.
- **Build target [V].** 200-1,000 iterations, stopping under 0.15% of the pot (`scripts/build_flop_library.py:296-299`).
  Sampled headers (25 per spot, 450 in all) showed 0.058-0.150%, mean 0.109%, at 200-500 iterations.
- **Two tree models [V].** Nine spots (`srp_btn_bb` and the eight 3-bet pots) deal the river with 64 strength
  buckets per card. The other nine single-raised spots are on the older "blind river" tree, where the river is
  played on the turn's boards. Upstream measured the blind river costing 0.29-0.54% of the pot against the full
  game, against 0.04-0.27% dealt (`flop_library.py:53-60`) [M]. The answer reports `same_tree` but not which model.
  [I] LIZARD should show it as a caveat.
- **Lookups miss** on custom ranges, other stacks or formats, rake (unless read as an approximation), a hero hand
  off the spot's range, a non-library bet menu, node locks, pool mode, all-in-everywhere mode, and any tournament
  (`advisor.py:4826-4827`) [V]. A miss falls back to a live solve, or first to an approximate read.
- **Fragile fingerprints [V].** Entries are keyed by a hash of the chart ranges. Any chart change invalidates the
  spot's entries silently, so answers become slower live solves without an error.

---

## 6. Preflop

| Component | What it is | Accuracy |
|---|---|---|
| 6-max 100bb charts (`gto/preflop.py`) | Hand-written ranges "approximations of solver outputs" (`preflop.py:3`), tuned to published aggregate frequencies (gtopreflop.com, the GTO Wizard blog, Poker Academy and others; `tests/preflop_refs.py:1-20`) [V] | 0.96 points mean over 26 spots (`README.md:4547-4551`) [M]. Squeezes, 4-bet responses and cold calls vs 3-bets have one published figure each; 5-bets and limped pots have none and are judgement [M] |
| Other formats (`pf_formats.py`) | The 100bb charts shifted by deltas from solves of the abstract preflop game | Approximate. About a point of noise per decision; antes solved only at 20/40/100bb; straddle 6-handed only (`README.md:4566-4577`) [M] |
| Push/fold (≤ 12 bb raising first in; under 20 bb generally) | Fictitious play over 169 classes (`pf_classes.py:65`) [V] | An equilibrium of a jam-or-fold model; callers treated alike and independently [V] |
| Preflop solve (Study) | DCFR over the abstract preflop game (`pf_game.py`) | About 1.5 mbb/hand in its own game [V]; 2.4-3.0 points from published spots; opens tighter in places (UTG 14.8% vs the charts' 18.7%) [M] |
| Rake, pool (exploit) adjustments | Rules on top of the charts | Fitted to one published raked solve, or to public population data plus judgement (`README.md:4578-4579; pool: `README.md:1529``) [M] |

Five `@expectedFailure` tests (`tests/test_gto.py:2797-2932`) document that the equity-realization models disagree
with the charts. For example, out-of-position openers call 2-2.5× the charts' frequency. So model-based preflop
output is not consistent with the charts [V]. Live preflop all-in equity samples 400 boards (`advisor.py:217`).
[I] That is roughly ±2.5% standard error per combo.

---

## 7. Abstraction limits

### 7.1 Bet-size menus

| Tree | Flop | Turn | River | Raises | Source |
|---|---|---|---|---|---|
| Library | 33 / 75% | 75% | 75% | flop 50%, later 75% | `flop_library.py:48-49` [V] |
| Browser Fast, one thread | 33 / 75% | 33 / 75 / 125% (shallow: 33 / 75%) | 33 / 125% | flop 50%, later 75% | `worker.js:237-242` [V] |
| Browser Fast, 4+ threads; Accurate | 33 / 75% | 33 / 75 / 125% | 33 / 75 / 125% | same | `worker.js:236-245` [V] |
| River root (both speeds) | | | 33 / 75 / 125 / 250% | | `worker.js:237` [V] |
| 3-way flop solve | 33 / 75% | 50% | 50% | a bet and one raise, raise 75% | `advisor.py:61`, `multiway_solver.py:71-72` [V] |
| 3-way turn solve | | 33 / 75 / 125% | 50% | same | `advisor.py:67` [V] |
| 4-way | 33% | 50% | 50% | no raise but hero's | `advisor.py:96` [V] |

- Inside a flop solve, the turn and river use a single size (`later_sizes`, 75%). An all-in is offered when the
  stack behind is at most 2.5× the pot. At most 2 raises are allowed per street (`solver.py:77-140`) [V].
- Custom menus are capped at 3 sizes per street (5 in Study) (`advisor.py:250-251`). Too large a tree is trimmed
  (`TRIMS`) [V].
- A size the menu lacks is read from the nearest stored sizes, adjusted for price (`off_tree.py`). That read is
  approximate [V].
- **Labels can misstate small-pot sizes [V].** Bets are rounded to half a big blind with a 1 bb minimum, but
  labelled with the nominal fraction (`solver.py:1244, 1278`). In a 2 bb limped pot, "bet 33%" is 1 bb, which is
  50%. LIZARD shows chip amounts, or percentages computed from them.

### 7.2 Turn and river treatment

| Root street | How later streets are played | Source |
|---|---|---|
| River | Every combo on the actual board; exact within the menu | 03 §2.5 [V] |
| Turn | River cards grouped into suit-swap classes (13 on a rainbow turn, 22-24 with a flush suit). Above SPR 8, river hands grouped into 32 strength buckets | `worker.js:206-210`, `solver.py:129, 1062` [V] |
| Flop (live) | One turn card per rank class (13 rainbow, 26 two-tone). Turn and river played by hand buckets: Fast 32 buckets over every third river, Accurate 64 over every river. Flop all-ins valued as equity leaves over at least 4 rivers per turn | `worker.js:220-224`, `solver.py:56` [V] |
| Flop (library) | Turn by rank class; river dealt with 64 strength buckets per card (9 spots) or played blind on the turn's boards (9 spots) | section 5 [V] |
| 3-way flop/turn | Later streets by 16 hand buckets (Fast flop: 12 buckets, every third river) | `advisor.py:59, 91` [V] |

There is no random sampling in the default trees. `n_turns` sampling exists only as a non-default option
(`solver.py:85`) [V].

### 7.3 Rake

Live solves pay rake on the matched pot (`solver.py:1092`). The library is unraked, and a raked read of it is
approximate (section 3). Preflop rake is one re-pricing rule fitted to one published raked solve [M].

---

## 8. Multiway

- **3-way [V].** The 3-player CFR solver uses exact card removal across three ranges (`multiway_solver.py:1-35`). It
  runs on every street in the multiway C core. Browser measurements [M] (`worker.js:286-296`):

  | Spot | Iterations | Mean best-response gain |
  |---|---:|---:|
  | Accurate flop, first to act | 400 (13 s) | 0.05% |
  | Fast flop | 203 | 0.25% |
  | Quick flop | 114 | 0.43% |
  | Quick turn | 87 | 0.58% |

  Native Fast reaches 0.7-1.05% on a flop in 5 s (`native.py:107-112`) [M].
- **4-way [V].** A smaller game: one bet per street, pairwise card removal, everyone at the shortest stack behind.
  Fast flop: 200 iterations, 0.03% [M]. In the browser a Quick 4-way flop goes to the rules.
- **5+ players [V].** Flops and turns use the heuristic betting rules ("not a solve here", `advisor.py:6446`).
  Rivers are solved up to 5 players at Fast and 6 at Accurate (`worker.js:312`).
- **Earlier 3-way streets [M]** are narrowed by the solve your advice there came from. Without one they are narrowed
  by the rules, which are about 0.44 (total variation) off a solve's ranges (`README.md:4613-4625`).
- **Without the multiway core [V]**, the browser plays smaller games and leaves 4-way flops and turns to the rules
  (`worker.js:300-306`).

---

## 9. Tournament math

| Piece | Status | Limits |
|---|---|---|
| ICM equity (`icm.py`) | Malmuth-Harville, exact by dynamic programming, O(2^n·n) [V] | Up to 12 players modelled (`icm.py:25`). Bigger fields become average-stack stand-ins with compressed payouts (`icm.py:166-195`). No future-game model (`README.md:4597`) [M] |
| Heads-up postflop | Solved in prize equity (`HUPayoffs`, `advisor.py:8136-8150`) [V] | Every tournament flop is a live solve: the libraries are skipped under ICM (`advisor.py:4742, 4826-4827`) [V] |
| 3- and 4-way postflop | Solved with `MWPayoffs` [V] | Who wins when a player busts is averaged: 0.002-0.33% of the pot given up against the exact prize game on a 3-way river (`scripts/bench_mw_icm.py`) [M]. A chip-EV solve on a bubble gives up 3.3-5.5% [M] |
| 5+ way pots | Betting rules, in chips [M] | Not ICM-aware |
| Preflop | Push/fold solved in prize equity. Other spots: chip charts re-priced by a risk premium with `ICM_COMMIT = 1.0` (`advisor.py:226`), "judgment fit to the published shape" (`README.md:4599`) [V/M] | Heuristic. Study's preflop solver refuses tournaments (`pf_study.py:187-188`) [V] |
| Bounties (KO, PKO, mystery) | Proportional model (`icm.py:13-17, 201`) [V] | A convention, not a derivation. Mystery bounties use the average envelope, with no variance [V] |

---

## 10. Known failure modes

1. **A short budget gives a rough answer.** A busy or slow device runs fewer iterations; 19 iterations on a limped
   turn were 38% of the pot from equilibrium (`advisor.py:135`) [M]. `CAP_ITERS = 30` is a floor for trimmed trees
   [V]. The browser flags the worst cases as approximate (section 4.1); the native server does not.
2. **Rarely taken lines are barely trained.** When the solve takes the villain's line less than 10% of the time,
   the Advisor widens the villain's range (`RARE_LINE`, `advisor.py:190`) [V]. EVs of actions hero's range takes
   under 1% of the time (`RARE_BRANCH`, `advisor.py:244`) are marked `rough_ev` and shown with "≈". Such EVs were
   6.0% of the pot off on average at 100 iterations and 1.6% at 400 (`advisor.py:236-243`) [M].
3. **The two beta-0 swings.** Before the beta schedule switched to 0.5 at iteration 100, 2 of 15 Accurate turns
   jumped from about 0.2% to 2-2.8% at about 180 iterations. The current default fixes this
   (`solver.py:1384-1395`) [M].
4. **Silent library misses** after any chart or tree change (section 5) [V].
5. **Blind-river library entries** are measurably worse than dealt-river ones, and the answer does not say which
   model it used [V].
6. **The legacy catch-all.** Any exception produces a rules, chart or equity answer marked `fallback`, with
   `fallback_reason` (`advisor.py:3020-3040`) [V]. A LIZARD view that ignores `fallback` would present a heuristic as
   a solve.
7. **Evaluator test coverage** is smaller than the README's "18,000 random hands" (`README.md:1538`): the treys
   comparison checks 38 boards × 200 combos, about 7,600 pairs (`tests/test_gto.py:53-64`) [V].
8. **NumPy fallback.** If the wasm core fails, a Fast turn after a library flop ran 42 iterations and reached
   2.19% of the pot, against 282 and 0.07% with the core (`README.md:1829`) [M].

---

## 11. The rule LIZARD follows, and how it is implemented today

**Rule.**
1. Every number on screen carries its provenance: the source, the exploitability in % of the pot (labelled "in the
   solved game") where one exists, the iterations, and whether it is partial or approximate.
2. Approximate answers are labelled.
3. Charts, rules and equity estimates are never called "solved" or "GTO". "Solved" is used only for library entries
   and live solves with a stated exploitability.

**Implementation.** `web/src/solver/provenance.ts` derives a `Provenance` record from each response.
`ProvenanceBadge.tsx` shows it, with "≈" when approximate. `sourceOf` (`provenance.ts:21-28`) checks these
conditions in order:

1. `fallback` maps to rules, charts or equity;
2. `precomputed` maps to library;
3. `pf_solve` or `study: "pf_progress"` maps to preflop-solve;
4. preflop maps to charts;
5. `solver.iterations > 0` maps to live;
6. anything else is "unknown".

**Gaps found against the Advisor's actual responses [V].** The first three rows and the last were fixed on
2026-11-03, with tests in `provenance.test.ts` and `client.test.ts`. The others are open.

| Response | What the Advisor sends | What LIZARD showed | Fix |
|---|---|---|---|
| Stored-turn reads (Study, runouts) | `approximate: {source: "store"}` and `solver: {iterations, exploitability_pct, by: "the flop library"}` with no `precomputed` (`advisor.py:3673-3675, 7118-7120`) | "Live solve", with the *flop* entry's exploitability, which does not describe the turn strategy (0.5-0.8% off, section 3) | **Fixed:** source `library-turn`, "Stored turn from the flop library", approximate, with no exploitability shown |
| Instant (early) answers | Top-level `approximate: {source: store\|near\|prev\|solve\|unraked\|offtree, label}`, no `solver` (`advisor.py:7036-7041`) | "Unlabelled · in progress" | **Fixed:** source `instant`, "Answer at once", followed by the Advisor's label, approximate |
| 5+-way heuristic answers | `multiway: true`, no `solved`, no `solver`, no `fallback` (`advisor.py:6442-6447`) | "Unlabelled", not marked approximate | **Fixed:** `multiway` with no `solved` and no `solver` maps to rules ("Heuristic rules (not a solve)"), approximate |
| Triage answers | `triage: {source, confidence}` | Ignored | Show the confidence |
| Push/fold, other formats, pool, ICM preflop | `street: "preflop"` | "Preflop charts" | Add a sub-label (push/fold equilibrium, format delta, pool, ICM-adjusted) |
| Library answers | `precomputed.same_tree` | Not shown | Caveat for blind-river entries |
| Any browser answer | Budgets not sent (section 4.1) | Mode label implies 8 s or 60 s | **Fixed:** budgets sent (section 4.1). The thread count is shown in the header pill and on the Engine page |

---

## 12. How to verify

These commands exist in the repository. Run them from `solver/` with the project venv
(`PYTHONPATH=. ../.venv/bin/python`, as in the root `package.json`). **Do not run them while library builds are
running**: the suites and benchmarks are CPU-heavy, and timing-based results change under load. Use
`nice -n 19` and one module at a time.

**Tests that pin accuracy**

```bash
PYTHONPATH=. ../.venv/bin/python -m unittest tests.test_cfr -v          # closed-form games: exact strategies, exact exploitability
PYTHONPATH=. ../.venv/bin/python -m unittest tests.test_turn_river -v   # river theory, river classes, turn/river reference solves
PYTHONPATH=. ../.venv/bin/python -m unittest tests.test_core -v         # C core vs NumPy, thread determinism (needs a C compiler)
PYTHONPATH=. ../.venv/bin/python -m unittest tests.test_flop_library -v # library format; shipped library matches charts and tree
PYTHONPATH=. ../.venv/bin/python -m unittest tests.test_gto.TestPublishedPreflopReferences tests.test_gto.TestPublishedBlindFrequencies -v
npm run test:solver        # (from the Lizard root) the whole Python suite, about 12 minutes
npm run test:solver-js     # (from the Lizard root) the Node suite
```

**Benchmarks and measurements** (usage taken from each script's docstring)

```bash
python scripts/bench_solver.py                              # fixed 150 iterations, 3 flops: it/s and exploitability reached
python scripts/bench_solver.py --curve --configs fast       # exploitability against solving time
python scripts/bench_solver.py --algos dcfr,pcfr+,pdcfr+    # regret minimizers at fixed iteration counts
python scripts/turn_river_reference.py --measure --configs browser-fast,native-fast   # vs stored rich references
python scripts/preflop_reference.py -v                      # charts vs the 26 published spots, mean error
python scripts/bench_multiway.py --board Kh7d2c9s4h --iters 10,30,100   # 3-way best-response gains by iteration
PYTHONPATH=. python scripts/bench_mw_icm.py                 # 3-way prize payoffs vs exact ICM on a river
python scripts/flop_library_coverage.py                     # share of heads-up flop decisions the library answers
python scripts/instant_coverage.py                          # share of a session answered from precomputed data
python scripts/sanity_sweep.py --quick                      # pre-deploy bug-signature sweep (about 3 min)
```

**Single answers**, with the exploitability in `solver.exploitability_pct`:

```bash
python -m gto.cli --hero BTN --hole AhKd --board Ks7d2c --preflop "UTG:f,HJ:f,CO:r2.5,BTN:c,SB:f,BB:f" --flop "CO:b2" --json
python -m gto.server --port 8765     # then: curl -X POST localhost:8765/advise -d @examples/flop.json
```

**Caveats**
- `scripts/bench_browser.mjs` measures the real worker under Pyodide in Node. It needs Pyodide 0.26.4 installed in
  a separate directory (see its header).
- `scripts/bench_postflop_solver.py` cannot run from this snapshot: its AGPL harness `scripts/pfbench` is excluded
  (`bench_postflop_solver.py:48`, exits at `:437`). The postflop-solver figures above can only be re-measured with
  that harness restored outside the shipped tree.
- No script in the repo prints the stored exploitability of library entries. The field is `expl` in each entry's
  JSON header (`flop_library.py:1003`). This document's 450-entry sample used a throwaway reader, not a repo
  command.

---

## 13. Open questions

- None of the [M] numbers were reproduced for this document. Several were taken on a busy machine, and README
  sections are not all current. Re-measure on a quiet machine, record the baseline under `docs/research/baselines/`,
  and update this document.
- Only 450 of the 25,575 library entries were sampled for stored exploitability.
- How much the abstraction understates full-game error is measured on a handful of spots only (tens of flops and
  turns). Treat the "vs reference" figures as indicative.
- Mobile devices were not measured. Expect fewer iterations per second than the desktop figures, and therefore
  rougher answers at the same budget [I].
