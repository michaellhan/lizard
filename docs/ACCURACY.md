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

Outside section 14, none of the numbers below were re-measured for this document: no solver, test or benchmark was
run while it was written. Section 14 was measured for it.

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
- **The exact engine underneath** agrees with an independent reference on 16 small spots: rivers, turns, one tiny flop
  and three-way rivers. That covers small exact trees, not the app's abstractions or real range sizes (section 14).
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

The sources match LIZARD's `ResultSource` (`web/src/solver/types.ts:11-20`) and what `ProvenanceBadge` shows.

| Source (badge) | What produced it | Typical accuracy | Tier |
|---|---|---|---|
| `library`: Precomputed solution | Offline DCFR solve of a stored heads-up flop (20 spots: 18 at 6-max 100bb cash, no rake, and 2 heads-up 2-max spots still being built), or a 3-way flop's first decisions (4 spots) | Heads-up: ≤ 0.15% in its own game (sample mean 0.109%, 200-500 iterations) [V]; about 0.2-0.5% given up against the full game [M]. 3-way: 0.06-0.08% [M] | Near-exact in its game; a borrowed spot (another table size's entry read as this one, `precomputed.borrowed`) is approximate, with no exploitability shown |
| `live`: Live solve, Accurate | DCFR solve in the browser (60 s by the legacy budgets) or the local server (30 s) | Rivers about 0.013% [M]; single-raised turns 0.14% median (0.06-0.41) natively [M]; 3-bet-pot turns about 0.01% [M] | Near-exact in its game |
| `live`: Live solve, Fast | Same, 8 s in the browser or 2.5 s + 2.5 s natively; stops early once settled | Rivers about 0.014% [M]; single-raised turns 0.93% median (0.61-2.72) natively, about 0.07-0.8% in the browser with the compiled core [M]; flops in a bucketed game | Near-exact to approximate |
| `live`: Live solve, Quick | 1.5 s (river 0.8 s), smaller game | Rivers about 0.04%; turns about 6.4-6.9% in the browser [M] | Approximate |
| `charts`: Preflop charts | Hand-written ranges (`gto/preflop.py`), plus rule-based adjustments for other formats, rake and ICM | About 0.96 points mean error over 26 published spots [M]; test bar is a mean under 2 points [V] | Heuristic, not a solve |
| `preflop-solve`: Preflop solve | This solver's own equilibrium of an abstract preflop game (`pf_game.py`, `pf_study.py`) | Converges to about 1.5 mbb/hand in its own game [V]; 2.4-3.0 points from the published spots [M] | Solved in a simplified model |
| `rules`: Heuristic rules | Monte Carlo betting rules for pots no solver takes (5+ players on the flop or turn), or a fallback | No equilibrium measure. Each answer reports its trial count and a ± between the top actions [V] | Heuristic, not a solve |
| `equity`: Equity estimate | Hero's equity against random hands, priced against the pot (`advisor.py:3836-3838`) | A rough last resort [V] | Heuristic, not a solve |
| `library-turn`: Stored turn from the flop library | A library flop's stored turn strategy, read at once (Study's answer at once, its runouts) | 0.50-0.81% of the pot (table below); no exploitability shown, since the response's numbers are the flop entry's | Approximate |
| `instant`: Answer at once | A read of another solution while the real solve runs: nearest stored flops, an earlier street's solve (heads-up or 3-way), this street's 3-way solve from an earlier decision, an unraked entry, an off-menu size. The badge shows the Advisor's own label | See the reads below; no exploitability shown | Approximate |

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
- In the browser, a heads-up post-flop *advice* answer more than 10× its mode's target is flagged
  `solver.approximate` with `target_pct` (`advisor.py:102, 3003-3018`; targets at `worker.js:265`). That means
  above 2-3% at Fast and above 1% at Accurate. The native server sets no target (`advisor.py:2885`), so it never
  sets this flag. **Study answers never carry it.** `advise()` returns `self.study(state)` for a Study request
  (`advisor.py:2982-2983`), and `_flag_short` runs only on the advice path (`advisor.py:3000`). So Lizard's Study
  badge shows a short solve's exploitability, for example "3.00% pot from equilibrium in the solved game", with no "approximate".
  Quality bands are planned (ROADMAP Phase 0).

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
> `client.test.ts` checks the mapping. The ModePicker hints now give these budgets, and say that a street can run
> longer: an unsettled street gets a second budget, a 3-way flop at least 15 s, and at Fast a heads-up street also
> gets the unspent `prior_budget` of each earlier street that cost nothing (a stored flop, or this hand's flop
> advice), on either backend (`Advisor.spare_prior`: `worker.js:252`, `native.py:132`; `advisor.py:4873, 5006`).
> Only the browser's Fast stops a heads-up street once settled (`hu_settled`, `worker.js:260`); the local server
> runs its whole budget.
>
> Study never sends `quick`, as classic Study offers only Fast and Accurate. Quick runs a Study request at Fast; a
> quick Study 4-way flop errors in the browser.

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
| Heads-up postflop | Solved in prize equity (`HUPayoffs`, `advisor.py:8136-8150`) [V] | Every tournament flop is a live solve: the libraries are skipped under ICM (`advisor.py:4742, 4826-4827`) [V]. A split pays the mean of a win and a loss: 0.25% of the pot given up on a river built to chop (section 14.6) |
| 3- and 4-way postflop | Solved with `MWPayoffs` [V] | Who wins when a player busts is averaged: 0.002-0.33% of the pot given up against the exact prize game on a 3-way river (`scripts/bench_mw_icm.py`) [M]. A chip-EV solve on a bubble gives up 3.3-5.5% [M] |
| 5+ way pots | Betting rules, in chips [M] | Not ICM-aware |
| Preflop | Push/fold solved in prize equity. Other spots: chip charts re-priced by a risk premium with `ICM_COMMIT = 1.0` (`advisor.py:226`), "judgment fit to the published shape" (`README.md:4599`) [V/M] | Heuristic. Study's preflop solver refuses tournaments (`pf_study.py:187-188`) [V] |
| Bounties (KO, PKO, mystery) | Proportional model (`icm.py:13-17, 201`) [V] | A convention, not a derivation. Mystery bounties use the average envelope, with no variance [V] |

---

## 10. Known failure modes

1. **A short budget gives a rough answer.** A busy or slow device runs fewer iterations; 19 iterations on a limped
   turn were 38% of the pot from equilibrium (`advisor.py:135`) [M]. `CAP_ITERS = 30` is a floor for trimmed trees
   [V]. The browser flags the worst advice cases as approximate (section 4.1); Study answers and the native server
   do not. Lizard's Study badge shows the exploitability itself.
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
9. **A trend across sessions compares grades, not play alone.** Analyze's "Your sessions" keeps one basis on a line,
   so charts and solves never share one, and a read later checked at Fast still counts as the read it was. Three
   things can still move a number with no change in play: a chart or library change (a grade isn't tied to the version
   it was graded on), a real shift in the spots dealt (sessions aren't split by table size, so the answer in a row
   moves with them), and what you chose to grade. The rows test at 2.58 standard errors with no correction for how many
   there are: about 1 in 100 rows is called by chance at sides up to 600/300, 1.35% at 30/30, and up to 2.9% for a 1%
   or 99% action at sides 10 to 1 or worse, by exact binomials and seeded simulation through the real `shifts` [M]. A
   steady player whose frequency wobbles from night to night would be called more often, as the hands are then not
   independent: 2 to 4 in 100 in a big database, under an assumed wobble of 3 to 5 points, not measured from play.

---

## 11. The rule LIZARD follows, and how it is implemented today

**Rule.**
1. Every number on screen carries its provenance: the source, the exploitability in % of the pot (labelled "in the
   solved game", and for 3- and 4-way answers called the mean best-response gain) where one exists, the
   iterations, and whether it is partial or approximate.
2. Approximate answers are labelled.
3. Charts, rules and equity estimates are never called "solved" or "GTO". "Solved" is used only for library entries
   and live solves with a stated exploitability.

**Implementation.** `web/src/solver/provenance.ts` derives a `Provenance` record from each response.
`ProvenanceBadge.tsx` shows it, with "≈" when approximate. `sourceOf` (`provenance.ts:34-48`) checks these
conditions in order:

1. `fallback` maps to rules, charts or equity;
2. `precomputed` maps to library;
3. a stored turn (`isStoredTurn`, `provenance.ts:30-32`: `approximate.source` or a top-level `source` is "store")
   maps to library-turn. `solver.by` "the flop library" is not used, because `_study_near` sets it on a flop answer
   too;
4. `pf_solve` or `study: "pf_progress"` maps to preflop-solve;
5. preflop maps to charts;
6. a top-level `approximate` maps to live when its source is "solve" and the response has no `solver.by` (this
   street's own solve stopped at a look, or one cut to fit Quick). Otherwise it maps to instant: "solve" with
   `solver.by` is a read of an earlier decision's 3-way solve on this street (`_study_mw_prev`), and "near",
   "prev", "unraked" and "offtree" are reads of other solutions;
7. `multiway` with no `solved` and no `solver` (the 5+-way flop or turn heuristic) maps to rules;
8. `solver.iterations > 0` maps to live;
9. anything else is "unknown".

For library-turn, instant and a borrowed library spot (`precomputed.borrowed`: another table size's spot read as
this one) the response's `solver` numbers belong to another solve, so they are not shown. That solve is the flop
entry, the previous street's solve, or the other table's spot on its own ranges. The badge shows the Advisor's label
for what the answer was read from, or the borrowed spot's description, and marks it approximate. Preflop charts are
marked approximate too. Up to engine 9b907bd6 a pot of a heads-up spot's pot and stack (6 bb with 97 behind, 2 bb with 99
behind) could not be borrowed once such a spot was in the index: `near_exact` raised, the advisor treated that as no
library, and an 8- or 9-handed SB vs BB pot was solved live instead. Those answers were labelled as live solves, so
nothing shown was wrong; from 1a14605e they read the 6-max spot and say so.

`describe` writes the exploitability as "X% pot from equilibrium in the solved game", or "mean best-response gain"
for a 3- or 4-way answer.

**Gaps found against the Advisor's actual responses [V].** The first three rows and the last were fixed on
2026-11-03, with tests in `provenance.test.ts` and `client.test.ts`. An independent review the same day found two
further mislabels: a flop read off the nearest stored flops showed as a stored turn, and a turn read off the
flop's solve showed as a live solve with the flop's numbers. Both are fixed by the order above. A second review
found three more: a 3-way read of an earlier decision's solve showed as live; borrowed spots showed as an exact
library answer; and charts were not marked approximate. These are fixed as described above. The other rows are
open.

| Response | What the Advisor sends | What LIZARD showed | Fix |
|---|---|---|---|
| Stored-turn reads (Study, runouts) | `approximate: {source: "store"}` and `solver: {iterations, exploitability_pct, by: "the flop library"}` with no `precomputed` (`advisor.py:3673-3675, 7118-7120`) | "Live solve", with the *flop* entry's exploitability, which does not describe the turn strategy (0.5-0.8% off, section 3) | **Fixed:** source `library-turn`, "Stored turn from the flop library", approximate, with no exploitability shown |
| Instant (early) answers | Top-level `approximate: {source: store\|near\|prev\|solve\|unraked\|offtree, label}`, no `solver` (`advisor.py:7036-7041`) | "Unlabelled · in progress" | **Fixed:** source `instant`, "Answer at once", followed by the Advisor's label, approximate |
| 5+-way heuristic answers | `multiway: true`, no `solved`, no `solver`, no `fallback` (`advisor.py:6442-6447`) | "Unlabelled", not marked approximate | **Fixed:** `multiway` with no `solved` and no `solver` maps to rules ("Heuristic rules (not a solve)"), approximate |
| Triage answers | `triage: {source, confidence, label}` | Fixed (2026-11-03) | `provenanceOf` keeps the confidence (`describe` says it), a Quick solve reads "Live solve (Quick)", a read of the street's own solve reads "Answer at once" (`sourceOf`, mark "approx": a mix with no EVs, nothing solved for it), Analyze's report keeps each basis apart (`report.ts` `byBasis`), and measured times go under Quick, not the request's Fast (`client.ts`) |
| Push/fold, other formats, pool, ICM preflop | `street: "preflop"` | "Preflop charts" | Add a sub-label (push/fold equilibrium, format delta, pool, ICM-adjusted) |
| Library answers | `precomputed.same_tree` | Not shown | Caveat for blind-river entries |
| Any browser answer | Budgets not sent (section 4.1) | Mode label implies 8 s or 60 s | **Fixed:** budgets sent (section 4.1). The thread count is shown in the header pill and on the Engine page |

---

## 12. How to verify

These commands exist in the repository. Run them from `solver/` with the project venv
(`PYTHONPATH=. ../.venv/bin/python`, as in the root `package.json`). **Do not run them while library builds are
running**: the suites and benchmarks are CPU-heavy, and timing-based results change under load. Use
`nice -n 19` and one module at a time.

The numerical benchmark against an independent reference runs from the Lizard root, with its own venv: see section
14.2.

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

---

## 14. Numerical benchmark against an independent reference

This section is the exception to the note at the top: everything in it was measured for this document, on the date
and machine below, by the commands below. Raw numbers are in `scripts/benchmarks/results/`. It answers one question:
**on small spots, on the same tree and ranges, does the engine reach the same answer as a solver written separately
from the game's rules?** It says nothing directly about the answers the app gives on real spots (see 14.6).

### 14.1 The reference, and how independent it is

`scripts/benchmarks/refsolver/` imports no engine code, and that is checked: `ref_worker.py` refuses to write its
result if any `gto` module was loaded, and `test_reference.py` greps the package. It has its own hand evaluator, tree
walker, card-removal arithmetic, best response, prize model and rake arithmetic.

| Part | What it is |
|---|---|
| Exact method | A sequence-form LP (von Stengel; Koller, Megiddo, von Stengel) solved twice, once from each side, by HiGHS through scipy. Zero-sum heads-up only: `highs-ds` on rivers, `highs-ipm` on turns and the wide river. |
| Iterative method | Its own DCFR in float64, for what the LP can't do: raked games, which aren't zero-sum, the flop, whose LP was not attempted, and three-way pots, where no LP gives an equilibrium. |
| Best response | Exact, in float64, walking the tree it built itself. Every "by the reference" number below comes from this, applied to the engine's exported strategies. |
| Evaluator | Checked on every 5-card and 7-card hand against the published counts (14.3). |

What is **not** independent, so a shared mistake here would not show:

- **The tree's rules are restated, not rediscovered.** The size rounding, the all-in rule, the raise cap and the rake
  base are the engine's own rules, read from `solver/gto/solver.py` and written again in `refsolver/rules.py`, because
  the point is to solve the same game. Comparing trees node by node proves the two agree, not that the rule is what a
  poker room does.
- **Same author, same idea of the layout.** The reference was written by the same agent that read the engine for its
  menu, not by a separate team. Its DCFR is the same family of method as the engine's, in the same per-board, per-hand
  array layout. The LP shares neither, so it is the independent check on method, and the DCFR is checked against it.
- **The spots are read by a helper.** `engine_worker.py` is the only benchmark file that imports `gto`. It uses
  `refsolver.cards` to turn a spot's text into combos, so both sides get the same range by construction: a range-parsing
  mistake would be shared. Comparing the engine's own range parser is outside this benchmark.
- **HiGHS and scipy** are outside dependencies, trusted as such. They are dev-only: `scripts/benchmarks/.venv`, never
  shipped.

### 14.2 How to run it

The machine for every number below: Apple M4 (10 cores), 16 GB, macOS 26.5.2 arm64, Python 3.9.6, numpy 2.0.2, scipy
1.13.1, Lizard at commit `8d902b6` with uncommitted edits outside `solver/`, engine at upstream `1a14605`, compiled core,
one thread, `nice -n 10`, run through `slot.sh` beside other builds. **Times are a loaded machine's**: read them as
sizes, not speeds. Measured 2026-11-05.

```bash
python3 -m venv scripts/benchmarks/.venv                    # dev only: nothing in the app depends on it
scripts/benchmarks/.venv/bin/pip install numpy==2.0.2 treys==0.1.8 scipy==1.13.1
SLOT=/Users/mhan/Desktop/projects/gtosolver/.work/bin/slot.sh   # while the precomputation builds run
PY=scripts/benchmarks/.venv/bin/python
$SLOT nice -n 10 $PY scripts/benchmarks/run_benchmark.py        # every spot: 6 minutes; --spots a,b for some
$SLOT nice -n 10 $PY scripts/benchmarks/invariants.py           # the checks in 14.5: 20 seconds
$SLOT nice -n 10 $PY scripts/benchmarks/check_evaluator.py      # every 5- and 7-card hand: 90 seconds
$PY scripts/benchmarks/run_benchmark.py --table                 # the tables below, from the results
python -m unittest discover -s scripts/benchmarks               # the reference on known games: 12 s, numpy only
```

Each spot runs the reference and the engine in separate processes (`ref_worker.py`, `engine_worker.py`), so the
engine's strategies reach the reference only as exported numbers. The engine's `Config` deals every turn and river,
with no buckets, card classes or sampling. Each iteration count is a fresh solve, because the engine's schedule depends
on its horizon. Raw results: `scripts/benchmarks/results/benchmark.json`, `invariants.json`, `evaluator_counts.json`.

The tolerances are fixed in `compare.py`: game value within **0.05% of the pot** and the
engine's exploitability, by the reference's best response, under **0.05% of the pot** (three-way: the sum of all three
gains under 0.10%, and the engine's own walk within 0.05%). Exploitability is half the sum of the two players' gains
(`br - value`), the same quantity as section 2.1. That is well defined in raked and three-way games too. There the two
gains are each a player's distance from a best response, and no longer bracket a single game value.

### 14.3 Hand evaluator

Against the standard counts of hold'em hand ranks, by enumerating every hand (`check_evaluator.py`), all match:
2,598,960 five-card hands in 7,462 distinct values, and 133,784,560 seven-card hands in 4,824 distinct values, each
category exact. Against the engine's evaluator: every hand on each of 3,000 random boards, 1,081 hands each, 0 boards
with any difference in order.

### 14.4 Results

Hands are OOP x IP combos. `Value diff` is the largest difference in either player's value between the engine's
strategies, walked by the reference, and the reference's solution. `Expl` is by the reference's best response.
`Largest TV` and `Mean TV` are total variation between the two strategies, on infosets reached at least once per
thousand deals, and reach-weighted over all. `Differ / within indiff.`: infosets past 0.05 TV and that reach floor,
and how many of those are explained by an indifference (every action the engine plays more than the reference earns
within 0.10% of the pot of the best one, against the reference's opponent). `Ref s` is the whole reference process,
including the bounds and the DCFR check. `lp` means exact; `cfr` means the reference's DCFR, so on those rows both
sides are iterative and each is measured by the reference's exact best response.

| Spot | Reference | Hands | Iter | Value OOP ref (bb) | Value diff (bb) | Value diff (% pot) | Expl engine (% pot) | Expl ref (% pot) | Largest TV | Mean TV | Differ / within indiff. | Engine s | Engine MB | Ref s | Ref MB | Pass |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| river-one-size | lp | 40x55 | 300 | 2.6557 | 1.27e-07 | 0.00000 | 0.00046 | 1.1e-15 | 1.000 | 0.0521 | 28 / 28 | 0.003 | 39 | 4.6 | 70 | yes |
| river-one-size | lp | 40x55 | 3000 | 2.6557 | 3.31e-09 | 0.00000 | 0.00014 | 1.1e-15 | 1.000 | 0.0496 | 28 / 28 | 0.014 | 39 | 4.6 | 70 | yes |
| river-one-size | lp | 40x55 | 30000 | 2.6557 | 2.79e-11 | 0.00000 | 0.00001 | 1.1e-15 | 1.000 | 0.0480 | 28 / 28 | 0.118 | 39 | 4.6 | 70 | yes |
| river-two-sizes | lp | 40x55 | 300 | 3.1278 | 2.17e-04 | 0.00108 | 0.00603 | 8.9e-15 | 0.982 | 0.0657 | 53 / 51 | 0.006 | 39 | 13.5 | 103 | yes |
| river-two-sizes | lp | 40x55 | 3000 | 3.1278 | 6.32e-09 | 0.00000 | 0.00040 | 8.9e-15 | 0.972 | 0.0635 | 51 / 51 | 0.033 | 39 | 13.5 | 103 | yes |
| river-two-sizes | lp | 40x55 | 30000 | 3.1278 | 9.41e-11 | 0.00000 | 0.00019 | 8.9e-15 | 0.905 | 0.0623 | 49 / 49 | 0.307 | 39 | 13.5 | 103 | yes |
| river-low-spr | lp | 40x55 | 300 | 3.2870 | 1.60e-05 | 0.00004 | 0.00208 | 4.4e-15 | 1.000 | 0.1357 | 48 / 48 | 0.003 | 39 | 2.2 | 61 | yes |
| river-low-spr | lp | 40x55 | 3000 | 3.2870 | 1.07e-07 | 0.00000 | 0.00027 | 4.4e-15 | 1.000 | 0.1352 | 52 / 52 | 0.009 | 39 | 2.2 | 61 | yes |
| river-low-spr | lp | 40x55 | 30000 | 3.2870 | 1.86e-09 | 0.00000 | 0.00003 | 4.4e-15 | 1.000 | 0.1413 | 52 / 52 | 0.071 | 39 | 2.2 | 61 | yes |
| river-flush | lp | 18x10 | 300 | -0.7317 | 1.63e-04 | 0.00082 | 0.14511 | 1.0e-14 | 0.900 | 0.0588 | 26 / 17 | 0.004 | 39 | 7.0 | 60 | NO |
| river-flush | lp | 18x10 | 3000 | -0.7317 | 2.82e-07 | 0.00000 | 0.00368 | 1.0e-14 | 0.749 | 0.0701 | 32 / 28 | 0.017 | 39 | 7.0 | 60 | yes |
| river-flush | lp | 18x10 | 30000 | -0.7317 | 1.35e-08 | 0.00000 | 0.00009 | 1.0e-14 | 0.721 | 0.0715 | 33 / 33 | 0.146 | 39 | 7.0 | 60 | yes |
| river-board-plays | lp | 43x19 | 300 | -1.1772 | 1.43e-06 | 0.00001 | 0.00620 | 1.1e-15 | 1.000 | 0.0676 | 20 / 20 | 0.003 | 39 | 2.7 | 60 | yes |
| river-board-plays | lp | 43x19 | 3000 | -1.1772 | 3.10e-08 | 0.00000 | 0.00048 | 1.1e-15 | 1.000 | 0.0679 | 20 / 20 | 0.011 | 39 | 2.7 | 60 | yes |
| river-board-plays | lp | 43x19 | 30000 | -1.1772 | 1.39e-09 | 0.00000 | 0.00005 | 1.1e-15 | 1.000 | 0.0698 | 20 / 20 | 0.093 | 39 | 2.7 | 60 | yes |
| river-weighted | lp | 36x44 | 300 | 5.7403 | 2.77e-04 | 0.00139 | 0.01834 | 4.4e-15 | 0.734 | 0.0930 | 54 / 54 | 0.003 | 39 | 4.5 | 66 | yes |
| river-weighted | lp | 36x44 | 3000 | 5.7403 | 2.66e-07 | 0.00000 | 0.00076 | 4.4e-15 | 0.764 | 0.0913 | 59 / 59 | 0.014 | 39 | 4.5 | 66 | yes |
| river-weighted | lp | 36x44 | 30000 | 5.7403 | 5.82e-09 | 0.00000 | 0.00012 | 4.4e-15 | 0.765 | 0.0920 | 61 / 61 | 0.122 | 39 | 4.5 | 66 | yes |
| river-app-menu | lp | 125x141 | 300 | -0.6848 | 6.66e-06 | 0.00003 | 0.08370 | 6.3e-14 | 0.806 | 0.1293 | 251 / 234 | 0.011 | 39 | 12.2 | 312 | NO |
| river-app-menu | lp | 125x141 | 3000 | -0.6848 | 8.62e-06 | 0.00004 | 0.00193 | 6.3e-14 | 0.885 | 0.0768 | 160 / 160 | 0.081 | 39 | 12.2 | 312 | yes |
| river-app-menu | lp | 125x141 | 10000 | -0.6848 | 5.22e-07 | 0.00000 | 0.00029 | 6.3e-14 | 0.884 | 0.0741 | 156 / 156 | 0.263 | 40 | 12.2 | 312 | yes |
| river-rake-5pct-cap2 | cfr | 40x55 | 300 | 1.8669 | 8.62e-05 | 0.00043 | 0.00246 | 1.0e-05 | 0.149 | 0.0056 | 9 / 9 | 0.004 | 39 | 4.2 | 25 | yes |
| river-rake-5pct-cap2 | cfr | 40x55 | 3000 | 1.8669 | 4.43e-06 | 0.00002 | 0.00010 | 1.0e-05 | 0.083 | 0.0031 | 3 / 3 | 0.018 | 39 | 4.2 | 25 | yes |
| river-rake-5pct-cap2 | cfr | 40x55 | 30000 | 1.8669 | 4.60e-07 | 0.00000 | 0.00001 | 1.0e-05 | 0.029 | 0.0011 | 0 / 0 | 0.163 | 39 | 4.2 | 25 | yes |
| river-rake-5pct-nocap | cfr | 40x55 | 300 | 1.7499 | 9.21e-05 | 0.00046 | 0.00171 | 7.3e-06 | 0.160 | 0.0060 | 9 / 9 | 0.003 | 39 | 4.3 | 25 | yes |
| river-rake-5pct-nocap | cfr | 40x55 | 3000 | 1.7499 | 2.82e-06 | 0.00001 | 0.00002 | 7.3e-06 | 0.077 | 0.0030 | 3 / 3 | 0.015 | 39 | 4.3 | 25 | yes |
| river-rake-5pct-nocap | cfr | 40x55 | 30000 | 1.7499 | 1.43e-06 | 0.00001 | 0.00000 | 7.3e-06 | 0.026 | 0.0010 | 0 / 0 | 0.134 | 39 | 4.3 | 25 | yes |
| turn-one-size | lp | 18x20 | 300 | 9.3607 | 5.21e-05 | 0.00026 | 0.02387 | 2.2e-14 | 0.143 | 0.0302 | 6 / 6 | 0.057 | 45 | 53.5 | 209 | yes |
| turn-one-size | lp | 18x20 | 3000 | 9.3607 | 1.35e-08 | 0.00000 | 0.00090 | 2.2e-14 | 0.133 | 0.0292 | 6 / 6 | 0.429 | 44 | 53.5 | 209 | yes |
| turn-rake | cfr | 18x20 | 300 | 8.2854 | 4.80e-04 | 0.00240 | 0.02495 | 1.3e-04 | 0.067 | 0.0081 | 3 / 3 | 0.064 | 45 | 5.1 | 32 | yes |
| turn-rake | cfr | 18x20 | 3000 | 8.2854 | 1.14e-05 | 0.00006 | 0.00114 | 1.3e-04 | 0.016 | 0.0022 | 0 / 0 | 0.485 | 45 | 5.1 | 32 | yes |
| turn-low-spr | lp | 20x17 | 300 | 1.5344 | 7.62e-06 | 0.00003 | 0.00800 | 2.8e-13 | 0.500 | 0.0255 | 12 / 12 | 0.026 | 43 | 6.4 | 108 | yes |
| turn-low-spr | lp | 20x17 | 3000 | 1.5344 | 3.22e-08 | 0.00000 | 0.00052 | 2.8e-13 | 0.500 | 0.0247 | 12 / 12 | 0.125 | 43 | 6.4 | 108 | yes |
| flop-tiny | cfr | 13x22 | 300 | 2.0837 | 1.86e-04 | 0.00093 | 0.01592 | 2.1e-04 | 0.336 | 0.0220 | 52 / 52 | 1.080 | 93 | 21.0 | 154 | yes |
| flop-tiny | cfr | 13x22 | 3000 | 2.0837 | 2.92e-06 | 0.00001 | 0.00074 | 2.1e-04 | 0.138 | 0.0034 | 8 / 8 | 5.883 | 93 | 21.0 | 154 | yes |

| Spot | Hands | Iter | Values ref (bb) | Value diff (% pot) | NashConv engine (% pot) | NashConv ref (% pot) | Largest TV | Mean TV | Engine s | Engine MB | Ref s | Ref MB | Pass |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 3way-river-one-size | 24x26x22 | 300 | 5.551 / 23.417 / 1.032 | 0.0011 | 0.00128 | 0.00001 | 0.005 | 0.0001 | 0.13 | 39 | 39.3 | 39 | yes |
| 3way-river-one-size | 24x26x22 | 3000 | 5.551 / 23.417 / 1.032 | 0.0001 | 0.00011 | 0.00001 | 0.000 | 0.0000 | 1.24 | 39 | 39.3 | 39 | yes |
| 3way-river-one-size | 24x26x22 | 30000 | 5.551 / 23.417 / 1.032 | 0.0000 | 0.00001 | 0.00001 | 0.000 | 0.0000 | 12.44 | 39 | 39.3 | 39 | yes |
| 3way-river-low-spr | 24x26x22 | 300 | 5.355 / 23.861 / 0.784 | 0.0337 | 0.01966 | 0.00116 | 0.197 | 0.0091 | 0.16 | 39 | 50.6 | 43 | yes |
| 3way-river-low-spr | 24x26x22 | 3000 | 5.355 / 23.861 / 0.784 | 0.0052 | 0.00213 | 0.00116 | 0.148 | 0.0024 | 1.59 | 39 | 50.6 | 43 | yes |
| 3way-river-low-spr | 24x26x22 | 30000 | 5.355 / 23.861 / 0.784 | 0.0077 | 0.00241 | 0.00116 | 0.135 | 0.0049 | 15.86 | 39 | 50.6 | 43 | yes |
| 3way-river-rake | 24x26x22 | 300 | 5.021 / 21.887 / 0.849 | 0.0057 | 0.00155 | 0.00000 | 0.007 | 0.0001 | 0.13 | 39 | 38.9 | 39 | yes |
| 3way-river-rake | 24x26x22 | 3000 | 5.021 / 21.887 / 0.849 | 0.0004 | 0.00014 | 0.00000 | 0.001 | 0.0000 | 1.25 | 39 | 38.9 | 39 | yes |
| 3way-river-rake | 24x26x22 | 30000 | 5.021 / 21.887 / 0.849 | 0.0000 | 0.00002 | 0.00000 | 0.000 | 0.0000 | 12.35 | 39 | 38.9 | 39 | yes |

**What these show.**

- **The trees are the same.** All 16 spots, node by node: players, actions in order, chips, rake, boards.
- **No disagreement in value.** At 3,000 iterations and above, every heads-up spot is within 0.00006% of the pot of
  the reference, and every three-way spot within 0.0077%. On the seven exact-LP rivers and two exact-LP turns, the
  LP's value lies inside the bracket set by the engine's two best responses on every run.
- **The engine's own exploitability is right.** On every heads-up run, what the engine reports matches the
  reference's best response on its strategies within 0.00001% of the pot. Nothing in this benchmark contradicts section
  2.1's measure, on trees this size.
- **Strategies differ, and that is expected.** Largest TV is often near 1.0 on the exact rivers, and mean TV 0.03 to
  0.14. The LP returns a vertex, while CFR's average sits inside the set of equilibria, so a hand that is exactly
  indifferent can read as pure on one side and mixed on the other. On every run at 3,000 iterations or more but one,
  every flagged infoset is within an indifference, most of them to rounding (gaps of 1e-13 bb or less). The LP's bounds agree: where
  they were run (rivers, turns), the engine's root frequencies at 3,000+ iterations are at most 0.0053 percentage points
  outside the range of every optimal plan. The strategy numbers alone would have been a false alarm.
- **The DCFR agrees with the LP.** On each LP spot it reaches the LP's value within 5e-6 bb, which is the check that
  the reference's iterative rows can be trusted.
- **CEV identities hold.** Zero-sum and rake conservation (the two players' values sum to minus the rake) hold to
  2e-14 bb on the reference's walk of the engine's strategies, and three-way chips to 2e-14. The engine's own values
  match that walk within 5e-6 bb (float32 rounding), its displayed root EVs within 4e-5 bb per combo and action, and
  those EVs mixed by its strategy give its value within 3e-6 bb.
- **The engine's two paths agree.** River-two-sizes at 3,000 iterations, compiled core against numpy (`GTO_CORE=0`):
  exploitability 0.00040% and 0.00032%, largest TV 0.006 on reached infosets. They are not bit-identical. The largest
  TV anywhere is 0.155, on an infoset that is reached too rarely to matter. Numpy took 5.5 s to the core's 0.03 s.

### 14.5 Invariants

`invariants.py`: all pass. Each one is checked, not assumed, and a spoiled answer has to fail (the last row).

| Check | What was compared | Largest difference |
|---|---|---|
| Polar river, closed form | Air's bet and the catcher's call, value: engine, reference, against the hand solution; no rake, 5%, 5% capped at 2 | Frequencies 0.0003; value 0.0004 bb (engine, 20,000 iterations) |
| Locked node, by hand | Engine's best response into a locked river: action EVs -4 and +8, and a `TendencyLock` fold +30 giving -4, worked on paper | 0 |
| Locked node, on a spot | Engine's best response, per combo and action, against the reference's own, with a `TendencyLock` and an arbitrary per-combo lock, 40 combos | 1.2e-5 bb |
| Node subgame | The ranges reaching a node in the whole solve, solved alone by the engine and by the LP, against the value inside the whole. River facing a bet; a river after a turn checks through | Whole vs LP 1.4e-5 bb; alone vs LP 1.6e-6 bb |
| Prize model | Malmuth-Harville against walking every finishing order, 4 cases | 1e-14 |
| ICM terminals | Engine's prize equity at each terminal against the reference's, from its own count | 4e-15 chip equivalents |
| River in prize equity | Non-zero-sum, DCFR on both sides: tree identical, values 1.04476 / -2.02025 on both | 8e-6 chip equivalents |
| Winner-take-all | The same river in prizes and in chips | 3e-6 bb |
| Bubble direction | Two players in a pot lose prize equity to the third: the values sum to -0.975, chips to 0 | sign only: a sanity check |
| Determinism | The same solve twice, engine and LP | Identical |
| Would it notice? | Engine's answer spoiled on purpose: 5% toward uniform (exploitability 1.31%), hands crossed (40.2%), half a blind off at one showdown, actions reordered. Each must fail | All four failed, the clean run passed |

The ICM terminal check also found a bug, **in the reference**: a player busted by the hand got nothing, instead of the
place left to them. The engine was right, and the reference was fixed.

### 14.6 Failures, and what this does not show

**Failed the tolerance (2 of 44 runs).** Neither is a disagreement. Both are 300-iteration runs short of converged, and
the engine reports the same number itself:

| Run | Exploitability | Same spot at more iterations |
|---|---|---|
| river-flush, 300 iterations | 0.145% (engine says 0.145%) | 0.0037% at 3,000 |
| river-app-menu, 300 iterations | 0.084% (engine says 0.084%) | 0.0019% at 3,000 |

**Outside an indifference, though passing.** River-flush at 3,000 iterations has 4 of 32 flagged infosets with an action
0.026 bb short of the best one (0.13% of the pot), against the 0.10% ceiling. They clear at 30,000. River-two-sizes
and river-app-menu have 2 and 17 such infosets at 300 iterations, none at 3,000.

**Three-way, one spot that doesn't settle.** 3way-river-low-spr gets no better with iterations: NashConv 0.0021% at
3,000 and 0.0024% at 30,000, value difference 0.0052% then 0.0077%, largest TV about 0.14. The reference stalls too,
at 0.0012%. Both are small and pass, but three-way CFR has no convergence guarantee, the two sides may be near
different equilibria, and no indifference check exists for three-way strategies here. Passing means each is hard to
exploit, not that they are the same.

**A known approximation, measured (engine's side).** In prize equity the engine pays a split the mean of a win and a
loss (`solver/gto/icm.py`, `HUPayoffs.showdown`), which it documents. The rule is that each player gets their half
back. At the all-in of a 60-chip pot that is 0.80 chip equivalents apart. On a river built to chop often, at a bubble,
the engine's solve, 0.00003% in its own payoffs, is **0.25% of the pot** exploitable in the true payoffs, and its
reported values are off by up to 0.67% of the pot. Its comment says ties are rare, and on most boards they are; this
spot is the worst case on purpose and not a typical cost. Three-way is not measured.

**Not compared, and why.**

| Not compared | Why |
|---|---|
| The app's real solves: bucketed flops, card classes, river classes, sampled runouts, later-street size limits | Those are abstractions of the game, so "identical tree" doesn't apply. Everything above is the exact game. This benchmark checks the engine underneath, not section 2.2's abstraction error |
| The precomputed library, preflop charts, and rule fallbacks | Not this engine's exact mode. The charts aren't solved at all |
| The browser build | Native compiled core and numpy only. The browser's path (Pyodide) was not run |
| Wide ranges | The largest spot is 125 x 141 combos. Real ranges at real menus are far larger |
| A flop by exact method | The LP was not attempted. `flop-tiny` has 9,608 betting rows, against 678 for `turn-one-size`, whose LP already has about 19,000 rows and took 12 s. So the flop's "reference" is DCFR, and the tree has only one flop bet (all-in) |
| Rake or ICM by exact method | The LP needs zero-sum payoffs. Those rows are DCFR against DCFR, plus the closed form on the polar river |
| A re-solve around a nodelock | The engine has none: locks act only in the best response (`gto/exploit.py`), so that is what was compared |
| Three-way turns and flops, 4+ way pots | Reference only covers one street, three players; `MWConfig(exact=True)` is what was pinned. Pots of 5+ are rules anyway (section 8) |
| Tournament payouts beyond one 3-left structure | One bubble, heads-up only. `MWPayoffs`, bounties, and stand-in field models were not run |
| The engine's range parser and the app's presets | Both sides take the same combo list, by construction |

**Not established.** Two solvers agreeing on 16 small spots is evidence about the code paths they ran, not a proof.
River-flush's OOP checks every hand in all equilibria (the LP's bounds show it), so that spot tests only IP's bets and the
responses. In `flop-tiny`, OOP checks the flop too, on both sides (over 99.99%). Passing here says the engine's exact mode is right on
these trees, and nothing about how close an abstracted answer is to the full game.

## 15. PLO4 river solve

`web/src/engine/plo/river/` solves one heads-up PLO4 river by discounted CFR, with every combo of both ranges and exact blockers, on a listed tree. It's a TypeScript solver written apart from the Python engine, and it shares nothing with it.

**Measured [M].** Six small spots (2x1 up to 40x40 combos) against `scripts/engine/plo_river_reference.py`, a NumPy CFR+ with its own evaluator and tree: identical trees and matchups, value within 0.00002bb, both solves under 0.001% of the pot from equilibrium, and the two hand-solvable toys at 2.5 and -10/9. Each side's strategy measured by the other's best response gave the same value to 4 or more decimal places (TS measuring Python's is a test; Python measuring TS's was run once and isn't kept as a test).

**What the figure means.** Exploitability on the page is from exact best responses on the listed tree: the average of each seat's gain, in % of the river's pot. It's exact for that tree, and silent on what a size outside the tree would win.

**Not checked.** Large spots aren't cross-checked, the reference being a dense matrix. The ranges are typed, so nothing says they are the ranges a solved hand would reach the river with. Earlier streets, rake and node locks aren't there. Speed on a phone isn't measured.
