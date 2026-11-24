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
| `node-lock`: Node-locked equilibrium of the restricted game | A re-solve with a mix held at one node (`engine/nodelock.py`, section 16). Not reachable from Study yet | Rivers 0.019% and flops 0.11% at Fast in one run on a loaded machine, by its own measure, which lets each player keep their own locks [M]. It's an equilibrium of the restricted game, not of the unlocked game. Class and combo locks on a turn are marked approximate | Solved, restricted game |

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
| Preflop solve (Study, and Practice's and Analyze's preflop by choice, sections 18-18.4; stored for 110 games) | Lizard's preflop solver since 2026-11-11 (`engine/pf_solve.py`): DCFR over the abstract preflop game, upstream's class-level model with flop values calibrated to published solves, each seat's own stack, 2 to 9 players (section 18.4) | About 1.5 mbb/hand in its own game [V]; 2.37 points from the published 6-max 100bb spots, 2.51 held out (upstream's model: 2.85 at the same rake, its shipped file 2.99); opens still tight (UTG 15.8% vs published 18.3%) [M] |
| Tournament preflop solve (Study; Practice for six stored presets, section 20) | DCFR over the same class-level game with each seat's own stack and ante, every outcome paid in prize equity (`engine/pf_icm.py`) | Matches push/fold where the models agree (within 0.1-0.5 points of jam share); levels off at 0.06-1.5 mbb/hand a seat in prize equity (3-handed to 6-max, 600-2,000 iterations), and 0.6-4.7 mbb for the same games in chips, from its 3-way valuation; the six stored presets are 0.015-1.28 mbb, section 20 [M] |
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
| Preflop | Push/fold solved in prize equity. Other spots: chip charts re-priced by a risk premium with `ICM_COMMIT = 1.0` (`advisor.py:226`), "judgment fit to the published shape" (`README.md:4599`) [V/M]. Lizard's Study (2026-11-11): a class-level preflop solve in prize equity on request, and six stored presets that Practice grades by, section 20 [M] | The charts' risk premium is heuristic. Upstream's preflop solver refuses tournaments (`pf_study.py:187-188`); Lizard's `engine/pf_icm_study.py` takes them in Study, and in Practice and Analyze for the six stored presets (section 20.5) [V] |
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
| A re-solve around a nodelock | `solver/` has none: locks act only in the best response (`gto/exploit.py`), so that is what was compared. The later re-solve in `engine/nodelock.py` has its own benchmark (section 16) |
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

**The turn (2026-11-10).** `web/src/engine/plo/turn/` solves a heads-up PLO4 turn and every river card after it in one DCFR run: the turn's tree, and where its betting closes with chips behind, each river card as its own river game of the solver above (its combos mapped back to the turn's, each river counting 1/40 at the turn, as a matchup that can be dealt sees 40 cards). All-in on the turn, every river card is a showdown. Exploitability is an exact best response through the turn and all its rivers, in % of the turn's pot.

**Measured [M] (`turn/solver.test.ts`).** On a 4 by 3 combo spot checked through, the turn solve's value equals the 48 rivers solved one at a time by the river solver, weighted by their matchups, within the two solves' exploitabilities; the river matchups sum to 40 times the turn's, to 9 places. A turn all-in called is worth each matchup's equity over the river, as `engine/plo/equity.ts` counts it exactly, to 9 places (a code path apart from the solver's showdowns). A spot with turn bets, a raise and an all-in closes to 0.05% of the pot. In a browser on the dev server: AAxx against JT98 on Js9s4d2h, 75% a street, 5,853 by 144 combos, reached 0.35% of the pot in 45 iterations, 5.3 s, 56 MB.

**Measured [M] against a reference of its own (`turn/reference.test.ts`, 2026-11-10).** `scripts/engine/plo_turn_reference.py` is a NumPy CFR+ that shares no code with the turn solver: blockers as matrices asked of every pair and every river card, the 48 river cards as one axis of dense tensors solved side by side, both trees worked out in cents. Its own checks (`test_plo_turn_reference.py`): checked down, the value is `plo_reference.equity_exact` over the 40 rivers to 9 places, and any strategy's best responses bracket the value from both sides. Three spots, from 3x2 to 6x5 combos (one bet a street; a turn raise all-in, with closings that are showdowns over the river and closings with a river left; weighted ranges with two turn sizes and a raise each street), each solved to 0.001% of the pot: the same turn tree and the same river tree at every closing, path for path; the same hands and matchups; the reference's strategy, put into the TypeScript on the turn and on every river card, measured to the same best responses and value to 5 places; and the TypeScript's own solve lands on a value inside the reference's bracket (pot 10: -5.0000 and -4.8667; pot 12: -2.3422).

**Not checked for the turn.** Large spots aren't cross-checked, the reference being dense. A turn's limit is 12 million combo-terminals an iteration, so wide ranges with two sizes a street are refused.

**The flop (2026-11-10).** `web/src/engine/plo/flop/` solves a heads-up PLO4 flop and every turn and river after it in one DCFR run: the flop's tree, and where its betting closes with chips behind, each turn card as its own turn solve of the solver above, every river of it included (each turn counting 1/41 at the flop, as a matchup that can be dealt sees 41 turn cards). All-in on the flop, each turn card is a showdown over its rivers. Exploitability is an exact best response through the flop, every turn and every river, in % of the flop's pot. The street solver is shared: the river solve inside a turn and the turn solve inside a flop are the same code (`turn/street.ts`), refactored with every turn and river test passing unchanged.

**Measured [M] (`flop/solver.test.ts`).** The turn matchups sum to 41 times the flop's, to 9 places. Checked down, the flop's value equals each matchup's equity over every turn and river as `engine/plo/equity.ts` counts it exactly, to 9 places; all-in on the flop, likewise at the bigger pot. Checked through the flop with bets on the turn and river, its value equals the 49 turns solved one at a time by the turn solver, weighted by their matchups, within the solves' exploitabilities. With bets on every street it reaches 0.1% of the pot, and the turn and river views' two EVs add to their pots. Cost (`flop/measure.test.ts`, Node under slot.sh): 51 to 57 ns a unit; AAKK against JT98 on Js9s4d at 75% a street, 36 by 144 combos, 16.2 million units, 0.83 s an iteration, 0.10% of the pot in 145 iterations, 233 MB by the bound and 700 MB resident. In a browser on the dev server, the same spot reached 0.083% in 172 iterations, 48.6 s.

**Each action's EV with best play after it (2026-11-10).** The reports of the river, turn and flop solves carry, beside each combo's EV by action played on at the average strategy, its EV by action with a best response from there on against the other seat's average (`bestEv`), worked out in the same walk. Below an action a strategy never takes the average is untrained (DCFR's average keeps the early iterations' near-uniform play there), so the first can charge such an action for play no one would choose: on the default river, a one-pair hand's never-taken pot bet read 53bb lost, against 10.4bb with best play after it. The PLO drill grades by the second. Measured [M] (`river/solver.test.ts`, `turn/solver.test.ts`): on every node, combo and action, the best-play EV is never under the average's (to 0.0001bb), and equals it where no decision of the hero's follows.

**Not checked for the flop (2026-11-10; since 2026-11-22 it has a reference, below).** No independent reference: the NumPy turn reference would need a turn-card axis over 49 cards, and its dense tensors are already its limit at the turn. The flop rests on the decomposition check above (its value equals the turns solved apart, which are themselves held to the reference) and on exact equity. A flop's limit is 18 million units an iteration, counting every turn's and river's, so only narrow ranges at a size or so a street fit.

**Rake, more sizes, a flop reference and card samples (2026-11-22, W5).**

*Rake.* A spot can carry rake: a percent of the final pot (the street's pot and both bets matched), up to a cap, paid by the winner and split in a tie (`river/tree.ts` `Rake`, `rakeOn`; every fold and showdown node holds its rake, an all-in closing on the turn or flop holds the rake of its pot). The two values then add to less than nothing, so exploitability is the mean of each seat's gain from its best response over its own value, each value measured apart (`river/solver.ts` `exploitabilityOf`); with no rake it is the old figure. Measured [M] (`river/rake.test.ts`): a win and a tie by hand (4.5 and -5 at a 5% rake; -0.15 each in a tie), the values' sum below 0 and convergence as without rake, the turn's all-in closing and a river's showdown holding their rake. Sizes: up to 4 bet sizes and 3 raise sizes a street (was 3 and 2), under the same work and memory limits.

*An independent flop reference (`scripts/engine/plo_flop_reference.py`).* A NumPy CFR+ sharing no code with the TypeScript: dense tensors over (turn, river, OOP combo, IP combo), chance weights and rake folded into two payoff tensors at each terminal node, the trees built in its own code. Its own checks (`test_plo_flop_reference.py`, 7 tests, 4.8 s): checked down, the value is `plo_reference.equity_exact`; swapping seats negates it; rake by hand; the pick spreads ranks and suits; exact sampled weights add to 1 and the solver's split weights are within 0.1; on the full deck the split weights are exact; any strategy's best responses bracket the value. Three spots, each solved to 0.001% of the pot and written to `web/src/engine/plo/vectors/flop.json` (230 KB): one bet a street on every card (2x2 combos, 49 turns, 2,875 iterations, 0.00091%); a 5% rake capped at 1 with a flop all-in (3,525 iterations, 0.00099%); and 9 sampled turns and 9 rivers each, raked 5% capped at 2 (3x2 combos, 11,375 iterations, 0.00099%). Measured [M] (`flop/reference.test.ts`, 12 tests): the same trees, hands, matchups and card samples; the sample's weight error the same as the reference's; the reference's strategy put into the TypeScript on the flop, every turn and every river, measured to the same values and best responses to 5 places; and the TypeScript's own solve reaching 0.001%, inside the reference's bracket where there's no rake.

*Card samples (`engine/plo/sample.ts`).* A flop or turn too wide to solve on every card can be solved on K of the next street's cards (K from 9 to the full deck; on the page 24, 16, 12 or 9). The cards are picked, not drawn: down the candidates from the highest rank, every (N / K)th position names a rank, and of that rank's cards the one of the suit furthest behind its share is taken, so each rank and each suit, the flush suit too, gets its share. The sampled game is a smaller game, solved and measured exactly as such: the next card is one of the K, each matchup seeing K - a - b of them (a and b the sampled cards its two hands hold). That weight doesn't split by hand, which the solver's blocker sums need, so the weight used is M / ((K - a - B)(K - b - A)) with A and B the ranges' mean a and b and M = K - A - B: exact for any matchup where either hand holds its range's mean, and exact on the full deck. How far each matchup's weights add from 1 is measured and shown ("chance weights within x% of exact for every matchup"): on the spots below, at most 1.2% to 3.4%, 0.1% to 0.6% on average.

*The pick, measured.* A first pick, suit by suit and each suit by rank, left out whole ranks a wrap needs. All-in equity over the sampled turns and rivers against every card, on four spots (AAKK v JT98 on Js9s4d; AAKK,AAQQ v QJT9ds,JT98ds on Ts7h2h; KKQQ,KKJJ,KKTT,KK99 v QJT9 and KKxx ds v QJT9 on Kh8d3c): suit-first put the range's equity off by up to 11.4 points at 12 or 16 cards a street (RMS by matchup up to 12.5 points); ranks-then-suits by at most 5.6 points at 9 cards, 4.7 at 12, 2.9 at 16 and 2.7 at 24 (RMS by matchup 1.9 to 9.4 points). Ranks-then-suits is what ships. Even so, a narrow range's equity on a sample is a few points off, matchup by matchup, and that's what the strategies below pay for.

*How far a sample is from the full game, measured [M] (`flop/sample.measure.test.ts`, Node under slot.sh, 2026-11-22).* On three spots small enough to solve on every card, at 75% a street with an all-in, pot 10 and 100 behind: the full solve to 0.05% of the pot; then for each sample its own solve to 0.05% (in the sampled game), and the measure that matters: its flop strategy held in a full solve while every turn and river is solved under it, and the full game's exploitability of that (what the flop strategy gives away in the real game when every later street is played well).

| Spot (OOP x IP combos) | Every card | 24 / 24 | 16 / 16 | 12 / 12 | 9 / 9 |
|---|---|---|---|---|---|
| AAKK v JT98, Js9s4d (36 x 144) | 16.2M units, 0.40 s an iteration, 0.048% in 94 s; OOP -3.25 | 0.84% (sampled game's value -3.51, 24 s) | 1.25% (-1.60, 18 s) | 4.21% (-0.73, 6 s) | 1.44% (-3.81, 3 s) |
| AAKK,AAQQ v QJT9ds,JT98ds, Ts7h2h (72 x 54) | 11.3M, 0.39 s, 0.049% in 118 s; OOP -0.40 | 1.84% (+1.15, 27 s) | 1.54% (-0.17, 11 s) | 1.77% (+0.44, 6 s) | 1.60% (+0.52, 4 s) |
| KKQQ,KKJJ,KKTT,KK99 v QJT9, Kh8d3c (72 x 256) | 29.4M, 0.39 s, 0.048% in 25 s; OOP +4.99 | 0.048% (+4.99, 10 s) | 0.045% (+4.99, 4 s) | 0.037% (+5.00, 2 s) | 0.108% (+4.99, 2 s) |

Each cell: the full game's exploitability of the sample's flop strategy, in % of the flop's pot (against 0.05% for the full solve); in brackets the sampled game's own value for OOP and its solve time. The work of a sample is 25%, 11%, 6% and 3.5% of every card's. Weight errors on these: at most 0.8% to 4.7% a matchup, 0.10% to 0.61% on average. The flop's first decision, combo by combo, moved 16% to 36% (half the summed difference in frequencies, by weight) on the first two spots and 2% to 6% on the third.

What it says. Where one range is far ahead (the third spot) a sample loses nothing measurable. Where it's close, draws against made hands, a sampled flop strategy gives away 0.8% to 4.2% of the pot in the real game, 20 to 80 times the full solve's distance, and the sampled game's own value can be 15% of the pot off (the second spot at 24 cards: +1.15 against -0.40). It doesn't fall steadily as the sample grows: which cards are picked moves it as much as how many. The first pick (suit first) did worse on the first spot: 1.26% at 24 cards, 3.77% at 16.

Wider spots, where every card can't be solved, measured by two samples of the same size picked half a stretch apart (`samplePhase` 0.5 and 0): KKxx ds v QJT9 on Kh8d3c (385 x 256; every card 57.5M units and 836 MB, three times the browser's limit), two 12-card samples (3.6M units, 5 s each) gave OOP +5.00 both times, the first decision 3.7% apart. AAxx ds v JT98 on Js9s4d (758 x 144; every card 80.9M and 1.2 GB), two 12-card samples (5.1M, 42 s and 50 s) gave OOP +2.87 and -0.28, 31% of the pot apart, betting 6% and 30% of the time at the first decision, 24% apart combo by combo. At 16 cards (8.6M to 9.1M units, 70 s and 75 s) the same spot's two samples gave +0.59 and +1.84, 12.5% of the pot apart, betting 20% and 13%, 18.5% apart: closer, still far.

So a sample is a sketch: labelled approximate, with its exploitability said to be the sampled game's, and the page saying what's measured here.

*Solve times on this Mac (Node 24 under slot.sh at nice 5, the other project's builds running, 2026-11-22).* 23 to 25 ns a unit of work (51 to 57 ns on 2026-11-10 under a heavier load): every card of AAKK v JT98 0.40 s an iteration, 94 s to 0.05%; its samples 14 to 106 ms an iteration, 3 to 24 s; the reference spots under a second each. Phones aren't measured: nothing here can run one.


## 16. Node lock

`engine/nodelock.py` holds a mix at chosen nodes and re-solves everything else. It sits outside `solver/` and runs the engine's own tree and iteration, so the answer is an equilibrium of the restricted game: the game in which the locked hands must play that mix. It isn't an equilibrium of the unlocked game, and it isn't a best response, which is what `gto/exploit.py` gives.

**What the figures mean.** Each player's best response keeps that player's own locks. Exploitability is the average of those two gains, in % of the root's pot, so a converged lock reads near 0 even when the lock itself is a bad play. What the lock gives up is `lock_cost`: the player's free best response minus the same player's best response under the lock. When a lock leaves an action at 0, the opponent's answers on that line are never trained, so the free best response beats untrained play and `lock_cost` runs large (10-18bb on app spots). There the change in value is the better guide, and the panel says so.

**Method.** `scripts/benchmarks/nodelock_bench.py` compares the engine in exact mode with an LP of the restricted game: `refsolver/`, the separate sequence-form reference of section 14, with the holds added (`refsolver/locks.py`), solved by HiGHS. Each case checks that the trees match cell for cell, that both sides hold the same cells, and that value and exploitability are within 0.05% of the pot. Exploitability is also re-measured by the reference's own best response. Raw numbers are in `scripts/benchmarks/results/nodelock.json`: a clean run of 295 s through `slot.sh` on an Apple M4, one thread, on a loaded machine, so the times are a loaded machine's.

**Measured [M]: 31 of 31 cases pass** at top iterations, on 8 spots (6 rivers, 2 turns), covering whole-range, class and single-combo locks, both players, a merged turn information set, chosen runouts and every runout, weighted ranges and hands outside the range.

| Cases | Iterations | Worst value gap (% pot) | Worst exploitability (% pot) | Time, peak memory |
|---|---|---|---|---|
| 18 rivers | 30,000 | 0.00000012 | 0.00017 | up to 0.34 s, 44 MB |
| 13 turns | 3,000 | 0.000044 | 0.0023 | up to 0.49 s, 50 MB |
| All 31 | 3,000 | 0.000044 | 0.0060 | |
| All 31 | 300 | 0.0014 | 0.104 | |

- At 300 iterations one case misses the tolerance: `flush-combo` at 0.104%, which is convergence, gone by 3,000.
- The engine's exploitability and the reference's measure of the same strategy agree within 0.000012 points.
- The mix is held exactly: read back in float32 the error is 0, and at most 0.000000024 against the float64 asked for. The LP took up to 15.7 s and 189 MB.

Four more checks stand apart from the case table:

| Check | Result |
|---|---|
| Lock an equilibrium's own strategy (10 runs) | The value shouldn't move. The LP moved at most 1.2e-13% of the pot, and the engine's gap was at most 0.0000022% |
| Sign: one player locked, 30 cases | The other player can't end up below their equilibrium value. Lowest gain -2.7e-15bb by the LP, -1.4e-9bb by the engine |
| Every node of one player locked (5 runs) | The other's best response is the answer, exactly. Gap at most 0.000019% of the pot. The LP agreed to 4e-14bb on 4 runs; `turn-one-size` was checked by the walker alone |
| Compiled core against numpy, 3 spots | Strategies differ, up to 0.45 on reached cells (0.09 unlocked), because equilibria aren't unique. Playing one against the other, neither gains more than 0.0086% of the pot, so they are the same quality of answer. The core took 0.157 s where numpy took 1.92 s |

**No power: 5 cases.** Passing here says little, because the lock didn't move the LP's value at all: `river-class-root`, `river-class-ip-bets`, `flush-combo`, `two-sizes-combo` and `low-turn-river-all`. They still check that a lock that costs nothing does no harm, but a broken pin could pass them. Four more moved it by less than the 0.05% tolerance: `weighted-combo` 0.0046%, `turn-river-combo-runout` 0.0078%, `turn-combo-root` 0.010% and `low-turn-river-runout` 0.030%. Their gaps at top iterations are far smaller than those moves, but the pass mark alone doesn't separate them from no lock. The other 22 moved value by 0.089% to 28.25% of the pot (`ties-whole-facing-bet`), and those are the cases with real power.

**Spoiled on purpose.** To show the benchmark can fail, the engine was given seven wrong locks and judged against the LP of the right one. These simulate faults: the engine's code wasn't edited.

| Fault | Value gap (% pot) | Caught |
|---|---|---|
| Mix off by 0.05 on a river | 0.27 | Yes |
| Mix off by 0.05 on a turn | 0.57 | Yes |
| The pin leaks to the merged sibling line on one runout | 0.0033 | **No** |
| The same leak on every river | 0.27 | Yes |
| The lock does nothing | 0.089 | Yes |
| A combo's lock covers its class | 0.68 | Yes |
| All runouts in place of one | 1.94 | Yes |

The uncaught row is a real blind spot. On one runout the fault moves value by 0.0033% and exploitability by 0.0063%, both inside the 0.05% tolerance, so a leak confined to one runout is smaller than this benchmark can see. Only the wide form of that fault shows. The guard for it is structural, not numerical: `test_only_the_named_line_is_held` in `scripts/engine/test_nodelock.py` checks that a lock on one line leaves its merged sibling unpinned.

**App-like spots (no LP) [M].** 300 iterations on a real range pair, flop `Kd7c2h` (pot 6) and turn `Kd7c2h5s` (pot 20), under the app's abstraction: flop locks 0.055-0.069% in the abstract game, 0.5 s, 85 MB, against 0.048% unlocked; turn locks 0.078-0.109%, 1.2 s, 167 MB, against 0.105% unlocked. These figures are inside the abstract game, so they say nothing about distance from the full game. Through `engine/study_lock.py` at Fast, on a loaded machine: river 300 iterations, 0.08 s, 0.019%; turn, 137 iterations in a 6 s budget, 0.387%; flop 300 iterations, 1.6 s, 0.11% against 0.09% unlocked.

**In a browser, on the wasm core [M] (2026-11-05).** The three checks the native core gave numbers for, run in a page on the real worker with `solver.core` true, 8 threads, 300 iterations, each mix read back as asked:

| Spot | Value, bb | Exploitability, % pot | Lock cost, bb | Solve |
|---|---|---|---|---|
| `Kd7c2h`, BB held 50/50 check and bet 33%, whole range | -1.8131 (native -1.8129) | 0.0874 (native 0.0963, numpy 0.0919) | 10.148 (10.148) | 0.56 s |
| `Kd7c2h` after a check, BTN's AKs and KQs held to check | -1.2611 (-1.2611) | 0.0769 (0.0766) | 0.032 (0.032) | 0.18 s |
| `Kd7c2h5s`, BB held to check, whole range | 0.0547 (0.0547) | 0.1765 (0.1788) | 16.719 (16.719) | 0.53 s |

The wasm core and the native one differ in thread timing, not in what they compute, and the gaps are within what a repeat run moves. Through the page itself: an Accurate lock on a heads-up turn ran 1,000 iterations to 0.027% of the pot against 0.032% unlocked, moved BB's check from 72.9% to the 100% asked for, and a run cancelled at 800 of 1,000 iterations said "Stopped." and left the engine able to solve again. The browser's process grew about 300 MB over that turn's two Accurate solves.

**Warm starts don't help.** At 1,000 iterations on `turn-one-size`, exploitability was 0.0039% cold, 0.0042% from the unlocked solve and 0.0028% from another lock. A lock is run cold, and a cancelled one starts over. Holding the lock costs nothing measurable: 0.41 s against 0.42 s at 3,000 iterations, and 1.4 ms to measure.

**Not checked.**

| Not covered | Why it matters |
|---|---|
| The browser, past those spots | Three spots and an Accurate turn on the wasm core, not the benchmark's 31 cases. The LP comparison above is native, compiled core or numpy |
| Locks under river classes, turn classes or buckets | The benchmark is exact mode. A class or combo lock on a turn is marked approximate for that reason: river classes assume symmetric ranges |
| A lock below the root | The app locks only the node on screen. A combo below buckets or river classes is refused |
| Spots larger than the benchmark's | The LP's largest spots are small, so app-sized ranges have no reference, only the engine's own measure |
| Rake | One note in the answer. No value under rake was compared; the LP needs zero-sum payoffs |
| Accurate mode | Its node mapping is tested, and one turn was locked at Accurate by hand. None runs in the tests, and no flop has been locked at Accurate |
| Earlier streets | By default they don't react: ranges enter the street as the unlocked hand left them. "Hold it from the flop / turn" (below) lets the street before react, in that street's coarser tree. Two streets back (a river lock moving the flop) isn't offered |
| An Accurate flop lock's memory | The baseline stays in memory to be compared, so two solves sit side by side. Accurate flop heaps can reach about 590 MB alone, so an estimated 1.2 GB; left unmeasured with the machine under 40% free, and the panel says so |

**One street back (2026-11-11).** A turn or river node can be held from the street before (`engine/study_lock.py` `reach_back`, "Hold it from the flop" or "from the turn" in Study's panel). The lock goes into the solve of the street before, whose tree has that node below a chance node. Its line from this street's root is lifted under that street's line and the card's token (`engine/nodelock.py` `lift`, `runout_token`). That street then re-solves around it as every node above a lock does, so the ranges entering this street react. The engine core is the one the LP checks above: nodelock_bench's `turn-merged`, `turn-merged-both-lines`, `turn-merged-every-river`, `turn-merged-ip-folds`, `turn-river-all-runouts` and `turn-river-combo-runout` each hold a river lock in a solve rooted at the turn, and all pass within 0.05% of the pot (they moved value by 0.008% to 5.7% of the pot).

What's new is the tree it's held in. The street before plays this street more coarsely than this street's own solve does: a flop's tree has the turn by card class with one size (75%), and hands from the turn on by bucket. So:

- only a whole-range lock is taken;
- a card of a class is held as its class's played card, with a note;
- a mix on an action that tree hasn't got is refused, with that tree's actions given back.

The answer is labelled approximate and "that tree's numbers". On an exact flop (`scripts/engine/test_nodelock.py` `OneStreetBack`: `Kd7c2h`, 22 and three suited hands against QQ, AKs and A2s, pot 6, stack 9, every card dealt) at 400 iterations, OOP was held never betting the turn after a check-check, on every turn card:

| | Unlocked | Turn lock held from the flop |
|---|---|---|
| OOP's value, bb | 0.5762 | 0.5427 (−0.56% of the pot) |
| Exploitability, % pot | 0.048 | 0.031 in the restricted game |
| OOP's flop check | 46.4% | 39.3% |
| IP's flop bet after a check | 24.9% | 43.3% |
| IP facing a flop bet: call, all-in | 49.0%, 21.5% | 33.5%, 35.3% |
| Lock cost to OOP | | 0.80 bb |

The test holds what must hold whatever the lock: the restricted game solved to under 0.3% of the pot, the held player not gaining and the other not losing beyond 0.3% of the pot, and the flop moving by more than a point. Through Study at Fast (`scripts/engine/test_study_lock.py` `ReachBack`), BB's turn lead held at 100% from the flop moved BB's flop check from 91.7% to 100% and BTN's check behind from 27.5% to 22%, at 0.09% of the pot in the restricted game. That is one run at Fast's budget: in the full test suite, under load, the
same lock moved the flop by 0.35 points, so the test checks only that the flop moves and that the moves are reported
consistently. No reference covers the coarse trees themselves (section 21 has what the flop's abstraction costs).

**Not established.** Agreement on 31 small cases is evidence about these code paths, not a proof. It says the restricted game is solved correctly in exact mode, not that a held mix is a good model of any player.

## 17. Turn report samples

The aggregate turn report on Reports (`web/src/features/reports/turnReport.ts`) reads a sample of a spot's flops of a texture, with no solve. Its numbers carry two errors: the stored turns' own, in section 1 and the table of sources, and the sample's, which is what its margin covers. This section is about the sample.

**Cost, measured [M], 2026-11-05.** A flop takes two files, its turn file and its entry: the turn file holds strategies, and only the entry says how much of each combo reaches a line. Over all 1,755 flops on disk, the mean for the two together runs from 9 KB (`3bp_co_hj`) to 31 KB (`srp_sb_bb_2max`). The ranges, about 10.5 KB, are already read with the report when the page opens. 40 flops are 80 requests and 0.4 to 1.2 MB. On the live site, from a laptop, eight requests at a time, 12 flops of `srp_btn_bb` (25 requests, 257 KB) took 0.81 s and 5 of `srp_sb_bb_2max` (11 requests, 141 KB) 0.39 s, so 40 flops should take under 3 s there; through the dev server's proxy in a real browser, 13 flops of `srp_btn_bb` took 0.9 s, 2026-11-05. Decoding and summing took 8.4 ms a flop in Node on a busy laptop. A phone wasn't measured.

**How it's drawn.** The texture's flops with stored turns are sorted so alike ones sit together, then read in a van der Corput walk from a start the seed sets. Each flop is equally likely, any stretch from the start of the walk is spread evenly, so a stopped or extended sample stays fair, and reading every flop gives the whole. Each flop read counts by its weight of the 22,100.

**The margin.** Half a 95% interval on a ratio of sums, by linearization, with the finite population correction, t on the flops that carry the weight (Kish's count). It's the simple random sampling formula, and the walk is more even than that, so it runs wide on the rows with many flops. A row behind fewer than 8 flops gets none.

**Checked against the whole [M].** Every flop of all 11 spots with stored turns, summed locally from the assembled library, whose file hashes match the live index, gave the true table. Then 100 seeds were drawn at each size, over 10 textures, the 2 largest flop lines of each and both decisions. An error is the worst action's, in points of frequency.

| Flops read | Row | Mean margin | RMS error | Largest error | Within its margin |
|---|---|---:|---:|---:|---:|
| 20 | All turns | ±2.4 | 1.1 | 8.6 | 97.6% |
| 20 | Class, behind 20 or more flops | ±2.8 | 1.2 | 15.6 | 97.8% |
| 20 | Class, behind 8 to 19 flops | ±4.3 | 2.1 | 22.8 | 94.1% |
| 40 | All turns | ±1.6 | 0.65 | 4.7 | 98.6% |
| 40 | Class, behind 20 or more flops | ±2.5 | 1.15 | 11.2 | 96.9% |
| 40 | Class, behind 12 to 19 flops | ±3.6 | 1.8 | 14.0 | 94.0% |
| 40 | Class, behind 8 to 11 flops | ±4.5 | 2.1 | 14.7 | 95.0% |
| 80 | All turns | ±1.0 | 0.4 | 3.3 | 99.4% |
| 80 | Class, behind 20 or more flops | ±1.8 | 0.8 | 8.6 | 97.8% |
| 160 | All turns | ±0.6 | 0.2 | 1.7 | 99.5% |
| 160 | Class, behind 20 or more flops | ±1.1 | 0.45 | 5.6 | 98.5% |

Over every row with a margin, 96.7% were within it at 40 flops. At 40 flops 1.8% of rows had none, with an RMS error of 2.3 points and a largest of 16.4. Pooled figures hide single cells: over the 2,638 combinations of spot, texture, line, decision and row at 40 flops, the 5th percentile of coverage was 85% and the 1st 57%. The worst twelve of those are rows where nearly every flop plays an action 0% of the time, so the margin is near zero: their RMS error is 0.33 points at most, under 0.1 on nine of them. The sorted walk beat a plain shuffle (RMS error 0.71 against 1.08 on the All turns row, 5 spots, coverage 98% against 92.5%). Drawing by weight, which would need duplicates and no way to read the whole, was little better (0.64), so it wasn't used.

**The mix itself [M].** On 9 flops of `srp_btn_bb`, `3bp_bb_sb` and `srp_sb_bb_2max`, 40 flop lines and 334 class rows at both decisions, the page's mix was compared with the solver's own reader of stored turns (`solver/gto/runouts.py` `store_parts`), which Study's stored report is built on: 0.16 points apart on average, 1.73 at most. The two differ in that the solver removes each card's own blocked combos where the file plays its class's one card. Every card of every class in every turn file on disk does the same thing to the board, so no class is split between rows.

**Not covered.**

| What | Why it matters |
|---|---|
| The solves' own error | The margin is the sample's only. The stored turn plays one bet size, in 5% steps, and a class's cards alike |
| Flops without stored turns | The report is over those that have them. Five spots store 1,203 of 1,755 flops, 62% by weight, and that part isn't a random one: 235 of 455 rainbow flops, 257 of 286 monotone. The page says the share |
| Lines under 1% of hand pairs | Not stored, so an average is over the flops that store the line. 3-10% of stored lines also can't be weighed, as a flop decision on the way is too rare for the entry to hold; those are left out and counted on the page |
| A turn facing a bet | No file holds one |
| Which seed | The table is over seeds; one report is one draw, and a largest error above is a real possibility on a row |
| A phone | Time and memory there weren't measured |

## 18. Practice's preflop graded by the preflop solve

A New session option (on by default since 2026-11-10 wherever a game is stored; it was off before) grades a preflop decision by EV against the stored preflop solve, in place of the chart's frequency (`web/src/features/practice/pfGrade.ts`). It first existed only for the two stored games, 6-max 100bb with no rake or with 5% capped at 3bb, with no ante, straddle, carried chips or own sizes; section 18.3 widens that to 110 games. Practice never starts a solve. Your buttons and the opponents stay the charts', so turning it on changes no move, only the grade.

The solve's limits are section 6's: about 1.5 mbb/hand in its own abstract game, 2.4-3.0 points from published spots, and not consistent with the charts. Every grade from it is labelled `preflop-solve`, marked approximate, with the model named. An EV here is your hand's class's, against the solve's own ranges. The opponents at the table play the charts, so a Best means the model's best, not the best against that table.

**When a decision is graded by it.** Settled at the spot, before you choose, so that what you pick can't decide what grades you. The solve's node must be this very spot: the same pot and call, no earlier raise moved to the solve's size, your options the same in kind and size both ways, your class still in its range, and the node not rough. Anything else keeps the chart's frequency grade under the chart's own label, and the decision says why. A size is never mapped onto the solve's: an EV of a raise to 12bb isn't one of a raise to 10bb.

**Coverage [M], 2026-11-05.** `scripts/pf_practice_coverage.py`: native Python, 30,000 hands on one seed, every seat dealt, your seat moving a place a hand, opponents from `Advisor.play`, sizes as the table takes them. 3,260 decisions of the same rules run through the real `pfRead` in Node agreed with the script on every one, and on the pot. Your moves come by policy: as the chart plays your hand, at random among your options, or as the solve plays your class.

| You play | Decisions | Answered by the solve | Your own option's size isn't the solve's | The line left the solve's sizes | Class folded in the solve | Other options, or off the tree |
|---|---:|---:|---:|---:|---:|---:|
| The charts | 30,625 | 70.1% | 26.0% | 3.4% | 0.3% | 0.1% |
| At random | 32,745 | 65.7% | 23.9% | 7.6% | 2.7% | 0.1% |
| The solve | 30,530 | 70.7% | 26.2% | 3.0% | 0.0% | 0.1% |
| The charts, 5% capped at 3bb | 30,625 | 70.1% | 26.0% | 3.4% | 0.3% | 0.1% |

The rough rule refused nothing in the unraked game and 3 decisions in the raked one. 30.8% of hands with a decision (9,041 of 29,371, on the charts) had at least one the solve couldn't grade.

The share isn't even, and it's lowest where a preflop mistake costs most. On the charts:

| Spot | Share of decisions | Answered | | Seat | Answered |
|---|---:|---:|---|---|---:|
| First in | 50.8% | 100.0% | | UTG | 95.5% |
| Facing an open | 40.8% | 46.7% | | HJ | 95.5% |
| Facing a 3-bet | 7.7% | 3.7% | | CO | 93.1% |
| Facing a 4-bet | 0.6% | 8.3% | | BTN | 90.9% |
| Facing a 5-bet or more | 0.1% | 0.0% | | SB | 23.3% |
| | | | | BB | 12.0% |

The largest cause is one size: the blinds' chart 3-bets to 10bb and the solve's tree to 12bb, 6,227 of the 7,960 option refusals and most of what the blinds lose, then 4-bets to 20bb against 17.25bb (1,025). Allowing sizes within 0.25bb instead of the engine's 0.05bb moved coverage about a point (71.1% against 69.9% on 3,000 hands), so the rule stays strict.

**What a grade reads as [M].** Of the decisions answered:

| You play | Best | Correct | Inaccuracy | Mistake | Blunder | EV lost a decision |
|---|---:|---:|---:|---:|---:|---:|
| The charts | 90.8% | 0.3% | 1.4% | 5.1% | 2.4% | 0.0167bb |
| At random | 47.0% | 0.3% | 1.6% | 9.6% | 41.4% | 0.2769bb |
| The solve | 99.7% | 0.3% | 0.0% | 0.0% | 0.0% | 0.0001bb |

So playing the charts exactly is called below Correct 8.9% of the time. That's the two disagreeing, as section 6 says they do, not a mistake found in you. The last row is a check that the grade reads the solve it's drawn from.

**The other way, not built [M].** With your raise buttons at the solve's size wherever the line is on its tree, coverage on the charts would be 96.1% (first in and facing an open 100%, facing a 3-bet 59.2%, a 4-bet 8.4%, SB 98.6%, BB 92.7%). It would change what you play: a blind's raise to 12bb isn't the chart's, and the flop library's lines are kept by size, so those hands would leave the library for live solves.

**The browser's path.** The stored files in `web/public/solver/pf/` are byte-identical to `solver/gto/static/pf/`, and both are in the manifest. Natively, with `sys.platform` set to `emscripten` and `js.siteFetch` reading the site's folder, `Advisor.advise` loaded each file once, 0.3 s the first time and 0.5 ms a node after, and answered `{study: "node"}` for both games and `pf_unsolved` for another game, which Practice takes as a refusal. Those answers went through the real `SolverClient` in the tests (`pfGrade.test.ts`, on `web/src/test/fixtures/pf_nodes.json`) and came back `preflop-solve`.

**Not established.** No browser or real worker has run this yet, and Pyodide's load time isn't measured. No fuller model checks a verdict: nothing here says a grade by the solve is better for you than the chart's, only what each one is. A class's EV doesn't tell its combos apart. The coverage is of the charts' lines as they stand, and moves if the charts or the tree do.

| A session's numbers | How they're kept |
|---|---|
| The score strip | Best or Correct and EV lost as ever, plus a line with each basis's own count |
| History's streets | A street graded both ways has a row a way, so preflop by EV and by frequency are two rows |
| History's session rows | A figure a way, as the lifetime totals below; a session from before that mixes ways shows only its count |
| By seat, by pot, trends | Already a row a basis |
| Lifetime totals by kind and by pot | **Split, 2026-11-06**: a figure a way, by EV, by the preflop solve, by frequency, with no share or EV lost across them. Decisions from before the split was kept that mix ways stand apart, in no figure, with a count. Before this, the share spanned both bases and EV lost added preflop-solve bb to postflop solves' bb |
| Review | A miss by the solve is its own record, retried against the solve or refused in words; a chart's is retried against the chart |
| Analyze's kept hands | A kept hand is its history: Analyze grades its preflop against the charts by frequency, under that label, whatever graded it at the table |

### 18.1 The solve's raise sizes, and Analyze, 2026-11-06

This supersedes "The other way, not built" above and the "Analyze's kept hands" row of the last table. Both stand as what was true on 2026-11-05.

**The option.** A second tick box, off by default and shown only while the first is ticked: "Offer the solve's raise sizes" (`pfSizes`, `web/src/features/practice/pfGrade.ts` `pfReadAt` with `ownSizes`). Where the node answers and your options are the solve's in kind (raise, call, fold, whatever their sizes), your buttons are the solve's and the decision is graded by it. Anywhere the solve wouldn't grade the spot, the chart's size and the chart's grade stay, with why, so a button never carries a size nothing can grade. The rule is still settled before you choose, and it's the same rule on a retry, in Analyze and in the coverage script.

**Raises are kept to the cent.** Of the tree's raise sizes (opens 2.5, 3; 3-bets 7.5, 10, 12, 12.5, 14.5, 17; 4-bets 17.25, 23, 24.75, 27.6, 28.75, 33, 33.35, 39.1, 39.6), most 4-bets aren't on the table's half big blind. Rounded, a 17.25bb raise would be a size the solve has no EV for, and the line would leave its tree at the very decision graded. So a solve-sized raise is recorded as it stands (`practice.ts` `moveOfOption` with `exact`), which only happens with this option on; the table's half big blind still rounds everything else, a chart's answer at the same table included. These moves go through the kept hand and the hand history (`history.test.ts`, 17.25, 27.6 and 33.35bb).

**The cost, said on the form.** The flop library's lines are kept by size (`solver/gto/flop_library.py`: a blind's 3-bet is `r10`), so a blind's 3-bet to 12bb is not on one, and that hand's flop is answered by a live solve. Read from the keys, not timed here: how much slower a session is with the option on isn't measured.

**Coverage [M], 2026-11-06.** `scripts/pf_practice_coverage.py --own-sizes`, native Python, 30,000 hands on the same seed as above, routed through `slot.sh`. "--own-sizes" was tightened for this: it used to answer the spot and still play the rounded size, and used the solve's size at spots the solve couldn't grade; now each raise is at the size the app plays and only where the app plays it, so a line goes on from the right chips. The 96.1% above came from the older form. Measured again this way, on the charts, it's 96.2%, so that figure held.

| You play | Decisions | Answered by the solve | The line left the solve's sizes | Class folded in the solve | Other options, rough, or off the tree |
|---|---:|---:|---:|---:|---:|
| The charts | 30,625 | 96.2% | 3.4% | 0.3% | 0.1% |
| At random | 32,765 | 89.5% | 7.4% | 2.7% | 0.3% |
| The solve | 30,539 | 96.8% | 3.1% | 0.0% | 0.2% |
| The charts, 5% capped at 3bb | 30,625 | 96.2% | 3.4% | 0.3% | 0.1% |

1,151 of 29,371 hands with a decision (3.9%, on the charts) had at least one the solve couldn't grade, against 30.8% without the option. Most of what's left isn't your size at all: the opponents stay the charts', so a 3-bet from a blind is to 10bb and the line has left the tree before you act. That's where it stays low:

| Spot | Share of decisions | Answered | | Seat | Answered |
|---|---:|---:|---|---|---:|
| First in | 50.8% | 100.0% | | UTG | 97.9% |
| Facing an open | 40.8% | 100.0% | | HJ | 97.1% |
| Facing a 3-bet | 7.7% | 59.2% | | CO | 96.0% |
| Facing a 4-bet | 0.6% | 8.4% | | BTN | 94.3% |
| Facing a 5-bet or more | 0.1% | 27.3% | | SB | 98.7% |
| | | | | BB | 92.7% |

The grades, of the decisions it answered:

| You play | Best | Correct | Inaccuracy | Mistake | Blunder | EV lost a decision |
|---|---:|---:|---:|---:|---:|---:|
| The charts | 88.5% | 0.3% | 1.9% | 6.2% | 3.0% | 0.0272bb |
| At random | 43.8% | 0.3% | 2.4% | 10.5% | 42.9% | 0.4318bb |
| The solve | 99.7% | 0.3% | 0.0% | 0.0% | 0.0% | 0.0001bb |

These aren't comparable row for row with section 18's grades table: this one also counts the blinds' 3-bets and the spots they lead to, where the charts and the solve play differently, so a chart player's EV lost by this measure goes up (0.0167bb to 0.0272bb a decision). That isn't play getting worse.

**The rule checked across the two languages [M].** Four runs dumped each decision with the worker's own answer (`Advisor.advise` with `study` and `preflop_solve`): 3,701 decisions at random, on the charts and on the solve, raked and unraked, with and without the option. The TypeScript `pfRead` and `optionsAt` gave the Python's verdict and the Python's raise size on every one: 0 disagreements. That was a throwaway script, not a test in the repo.

**Analyze.** Analyze now asks the stored solve (`web/src/features/analyze/grading.ts`), reading the same file the table does and never running one, for a 6-max 100bb hand of equal stacks with no ante or straddle, and no rake or 5% capped at 3bb. On a screen each graded preflop decision says `preflop solve` or `charts`, and the report keeps the two as separate rows, never added: basis, situation, frequency, leak and comparison.

- A kept Practice hand reads the spot by the table's rule, at the sizes that hand was played at, so a decision the table graded by the solve gets the same grade. It's kept whether the session offered the solve's sizes (`setup.pfSizes`).
- A hand from a Practice session without the option is read the same way, so its decisions can be the solve's in Analyze though the table graded them by the chart. Each says which.
- A site's hand has no buttons, so it's the move made: on the tree at the tree's size, the solve; a raise of another size, the chart, saying why. A history says no rake percentage or cap, so a site's hand is asked as the game with no rake, and each decision says that in its note.
- Anything else is unchanged: one question, the chart's answer, as before, tournaments included. A chart's grade kept from before is asked again once in a stored game; it then either takes the solve's grade or says why not.
- Where the file can't be read the chart's grade stands, with why, and that reason is kept, so that decision isn't asked again by itself.

**Not established.** No browser has run the option, the Analyze change or the link question: browser steps 7h and 7i are written and unrun at the time of this note. Nothing here says a solve-sized raise is better for you than the chart's: the verdicts above are the class-level model's. The Analyze parity is tested against the fixture nodes and the rule above, not over played sessions. Analyze's EV lost in a report says how much of it is the preflop solve's, but a session's trend and a hand's total add it to what a solve said after the flop.

### 18.2 Nothing adds unlike grades (2026-11-06)

The owner asked for EV and frequency to stay apart, and for preflop-solve bb never to be added to postflop bb. Where that now holds:

| Where | What it shows |
|---|---|
| History, rows by kind, pot and session | A figure a way: by EV, by the preflop solve, by frequency |
| Practice's score and its table rail | The same, once a session has been graded more than one way; one rate only where one way graded everything |
| Analyze's summary, Winnings, the Plan's cost of a leak | EV lost by a solve of the spot, and by the preflop solve, each on its own |
| Analyze's report tables, by seat, street, spot and the rest | One row where one way graded it; otherwise a figure a way under the row, and no share or EV lost for the row as a whole |
| The JSON export's summary | The two EVs in separate fields |
| A leak drill's score line, and its row in History | One line where one way graded it; otherwise a figure a way. Picks kept before this that mix ways are counted apart |
| The Plan's order of leaks | By EV lost to a solve of the spot, then by EV lost to the preflop solve, then by frequency. The two are never added or weighed against each other |
| Analyze's EV-lost filter | A hand passes if either kind alone reaches the step |

Practice's stored and live drills need no split: a stored drill's score covers one street, by EV on the flop and by mix on the
turn, and a live drill refuses an answer without EVs. One place still puts the kinds side by side: "The most EV lost" ranks single
decisions of both kinds, each labelled, with nothing added. A leak drill graded only by the preflop solve and kept before this
still reads as plain EV.

### 18.3 The stored grid: 2 to 6 players, 20 to 200bb (2026-11-10)

Upstream stores two games (6-max 100bb, unraked and 5% capped at 3bb). Lizard now stores 108 more beside them: 2 to 6 players
at 20, 25, 30, 40, 50, 60, 80, 100, 125, 150 and 200bb, equal stacks, no ante or straddle, the engine's sizes, unraked and
5% capped at 3bb (`engine/pf_stored.py`). Wherever section 18 says "the stored game", it now means any of the 110.

**What they are.** The same model and the same solve as upstream's two: `pf_study.Spec(players, stack, rake)`, pf_game's
DCFR over the 169 classes for `STORED_ITERS` (1,500) iterations, packed by `pf_study.pack` with the stored (quantized)
strategy's exploitability in the header. Built by `scripts/pf/build_stored.py` into `engine/pf/`, one thread, through the
shared CPU slot, in 49 minutes in all (heads-up under 1 s a game, 6-max up to 212 s). 1.1 MB in all, 0.7 KB to 83 KB a
file. Each game's line is in `engine/pf/built.jsonl`.

| Players | Games | Stored strategy from equilibrium, mbb/hand a seat | Longest build |
|---|---:|---|---:|
| 2 | 22 | 0.05 to 0.22 | 0.8 s |
| 3 | 22 | 0.05 to 0.70 | 2.1 s |
| 4 | 22 | 0.09 to 1.10 | 12 s |
| 5 | 22 | 0.13 to 1.34 | 92 s |
| 6 | 20 | 0.12 to 1.26 | 212 s |

Every one is under the 1.5 mbb a live solve stops at (`TARGET_MBB`), as `scripts/engine/test_pf_stored.py` checks, with
each file unpacked against its own game's tree. That is distance from equilibrium **in the model's own game**. Nothing here
measures the model against a fuller solve at these depths and table sizes. Section 6's 2.4 to 3.0 points from published
spots was measured at 6-max 100bb only, and the realization model's depth factors (`pf_study.DEPTH_SCALE`) were fitted at
20, 40, 100 and 200bb. 25 to 150bb are interpolated between those.

**How the worker gets them.** `solver/` is untouched. `engine/pf_stored.py` adds the keys to `pf_study.STORED` and, natively,
reads the files from `engine/pf/`. The worker imports it once at start (a build-time edit declared in `solver/UPSTREAM.json`),
and `scripts/build-solver-assets.mjs` copies the files to the site's `pf/`, where the worker already fetched upstream's two.
They come down only when a game is asked for. The bundle's version now hashes every stored file, so a rebuilt solve is a new
version in a grade's stamp. The page's list (`web/src/solver/pfStored.ts`) is held to the Python grid and to the files by
`pfStored.test.ts`, so the page never offers a game the worker would answer `pf_unsolved`.

**Where it's used.** The same three places, through the same gate (`practice.ts` `pfBlocked`):
- Practice's "Grade preflop by the preflop solve", now offered at any stored game, and refused elsewhere naming the nearest
  stored depth;
- Analyze, for a hand of equal stacks at a stored game;
- a saved setup that carries the option.

Study's Solver source answers these at once rather than solving. The opponents still play the charts, and every grade is
labelled the class-level model.

**On by default, 2026-11-10 (owner's decision).** Practice's box starts ticked wherever the game is stored: the session the
page deals on load (6-max 100bb), every New session form, and a setup link (which carries no grade of its own). A box taken off
is kept off for that session (`pfSolve: false`). A saved scenario keeps what it was saved with, so one saved before this, without
the option, is still graded by the charts. Nothing about the grade changed, only who sees it without asking: the same
class-level model, the same rule, the same 30% of 6-max 100bb decisions it can't answer, which keep the chart's frequency grade
and say why. Analyze is unchanged (its own box, `grading.ts`).

**Coverage [M], 2026-11-10.** `scripts/pf_practice_coverage.py`, now with `--players` and `--stack`. Native, 5,000 hands a game
on the section's seed, you playing the charts, unraked:

| Game | Answered | First in | Facing an open | Facing a 3-bet | With the solve's sizes | EV lost a decision (sizes on) |
|---|---:|---:|---:|---:|---:|---:|
| Heads-up 100bb | 82.2% | 78.4% | 89.8% | 79.7% | 95.8% | 0.055bb |
| 3 players 50bb | 64.5% | 100% | 24.3% | 18.3% | 92.3% | 0.047bb |
| 4 players 40bb | 67.0% | 100% | 31.5% | 44.7% | 67.0% | 0.024bb |
| 5 players 25bb | 83.9% | 100% | 67.4% | 60.1% | 83.9% | 0.021bb |
| 6 players 60bb | 69.7% | 100% | 48.4% | 0.0% | 90.7% | 0.021bb |
| 6 players 150bb | 71.0% | 100% | 48.1% | 3.5% | 96.0% | 0.031bb |
| 6 players 200bb | 70.7% | 100% | 48.4% | 3.9% | 95.6% | 0.031bb |

The deep 6-max games behave as 100bb did: the blinds' 3-bet size is most of what's refused, and the solve's sizes take it to
about 96%.

**At 25 to 60bb the sizes don't help.** Most refusals there are your options differing in kind. Facing an open, the chart's
table offers all-in, call or fold, and the solve's tree offers a raise to 12bb (or 14.5bb), call or fold. At 4 players 40bb that
is 68.5% of the decisions facing an open, and at 5 players 25bb 32.6%. The rule doesn't score a jam against a raise, so these
stay on the charts by frequency and say why. Facing a 3-bet at 6 players 60bb nothing is answered: the 4-bet is a raise to
17.25bb in the tree and an all-in at the table. A tree with a jam in the 3-bet's place at those depths would be another model,
and it isn't built.

Heads-up first in is 78.4% without the sizes because the small blind's chart open is not the tree's 3bb open.

**Not established.** A browser checked one game: Practice at 4 players 40bb, two preflop decisions graded by the solve, the
badge's 1.03 mbb/hand matching `4max_40bb.bin`'s and not the 6-max file's (`web/e2e/qa.e2e.ts` 7j). The other 106 are checked
natively, by the file test and the coverage runs above. Raked games' coverage wasn't measured separately (at 6-max 100bb it
matched the unraked game's to the decimal).

### 18.4 Lizard's preflop solver: calibrated flop values, own stacks, 7 to 9 players (2026-11-11)

Every preflop solve request (Study's Solver source, and Practice's and Analyze's grade by the preflop solve) now goes to
`engine/pf_solve.py` instead of upstream's `Advisor._study_pf`. This is a build-time edit of the worker, declared in
`solver/UPSTREAM.json`; `solver/` is untouched. A tournament's request (payouts or bounties) still goes to the Advisor,
which refuses it as before. The solver is still a class-level model: the same 169 classes, the same DCFR, and flops
valued by a realization model, not solved. It differs from upstream's in three ways.

1. **Calibrated flop values** (`engine/pf_model.py`). Upstream's library model gives each heads-up flop's share of the
   pot per class pair. On top of that, ten corrections are fitted per pot type:
   - a constant share moved between aggressor and caller (in or out of position);
   - a scale on the edge over all-in equity;
   - the river correction's weight in single-raised and 3bet pots.

   The fit is to the published 6-max 100bb solves in `solver/tests/preflop_refs.py`: the 26 certain spots, at their rake
   of 5% capped at 4bb. The method is one-at-a-time perturbations (11 solves), a ridge-regularised Gauss-Newton step,
   and a verifying solve at the result (`scripts/pf/calibrate.py`; its 18 runs in `scripts/pf/calib_runs.jsonl`). The parameters and what they were measured at are in
   `engine/pf_calib.py`, which is generated. With the default parameters, the model is upstream's exactly
   (`scripts/engine/test_pf_engine.py`).
2. **Each seat's own stack** (`engine/pf_engine.py`):
   - a raise is capped at the deepest stack still able to call it;
   - a shorter stack calls all-in for less;
   - pots are split into layers (main, side, an uncalled excess back to its owner);
   - each heads-up flop is valued at its effective depth.

   With every stack equal, the tree and every terminal value are pf_game's (tested to 1e-9). A heads-up game is zero-sum
   to the chip. A seat covered by everyone plays exactly the game at its own depth.
3. **7 to 9 players.** At most two players see a flop, and nobody cold 4bets or cold-calls a 3bet. That keeps 9-handed
   at 4,795 nodes (6-max upstream: 11,010) and about 70 s to its target natively. Answers there say so (`pf_limits`, in
   the provenance line).

The payoff is pluggable (`pf_engine.ChipPayoff`; a nonlinear payoff gets exact side-pot handling), for an ICM payoff
later. Nothing here uses one.

**Against the published solves [M].** These are `pf_equilibrium.report`'s mean absolute error, in points, over every
published action of the 26 certain spots, as section 6 and docs/research/03 §4 measure it. Spots out means outside
their tolerance. The 15 hand facts were never fitted. Every row is solved for 700 iterations, except the two stored files
(1,500).

| Model | Rake | Mean error | Spots out | Hand facts off |
|---|---|---:|---:|---:|
| Upstream's, stored file as shipped (`6max_100bb_r5c3`) | 5% cap 3bb | 2.99 | 16 / 26 | 12 / 15 |
| Upstream's, solved at the references' rake | 5% cap 4bb | 2.85 | 16 / 26 | 11 / 15 |
| **Calibrated (adopted)** | 5% cap 4bb | **2.37** | **14 / 26** | **10 / 15** |
| Calibrated, stored file as shipped (`lz1_6max_100bb_r5c3`, 1,500 iterations) | 5% cap 3bb | 2.49 | 13 / 26 | 10 / 15 |
| Calibrated, held out (each half of the spots scored in the solve fitted on the other half) | 5% cap 4bb | 2.51 | 13 / 26 | — |
| Preflop charts (`gto/preflop.py`, for comparison) | 5% cap 4bb | 0.96 | — | — |

By kind of spot, upstream's model → calibrated:
- opens: 4.54 → 3.52 points (6 of 7 out either way);
- facing an open: 1.87 → 1.57 (5 → 4 out);
- facing a 3bet: 3.42 → 2.91 (5 → 4 out).

The largest moves:
- BTN opens 36.7% → 40.8% (published 43.7%);
- BB facing the SB's open calls 26.6% → 35.4% (33.8%) and 3bets 24.2% → 19.2% (16.2%);
- CO facing the BTN's 3bet calls 11.9% → 18.2% (16.9%);
- SB facing the BB's 3bet calls 14.7% → 19.7% (21.4%).

One hand fact came in: UTG opens AJo/KQo (67% → 100%). None went out. UTG's 44 moved 34% → 75%, still short of the
95%+ wanted.

What it doesn't fix:
- Opens are still 3–4 points tight from UTG to CO.
- Openers still 4bet too much against a 3bet.
- The facts that need a mixed hand stay pure (A5o 3bets, Ax 4bet bluffs, 22 from UTG, A4o on the BTN). A class-level
  model with one value a class pair plays those pure.

The held-out error is the honest figure: about a third of a point better than upstream's model, not a solve's accuracy.
The charts stay closer to the published solves (0.96), so the charts stay the default everywhere. The Solver source is
still offered and still labelled approximate.

**Tried and not adopted.** Valuing classes outside a library spot's range by a smooth fit of the range's own values
(`ext`, in place of upstream's measured model joined at the range's edge). It fixes the BTN's A2o (100% → 0%) and cuts
spots out from 16 to 12. But the mean error stays at 2.85 points, and it breaks three facts that held (BB calls A2s,
UTG flats QQ facing a 3bet, BB 3bets JJ+). The code stays (`Params.ext`, off).

**Not measured.**
- Every reference is 6-max 100bb. The corrections are applied unchanged at other depths and table sizes, on top of
  upstream's depth factors (`pf_study.DEPTH_SCALE`, fitted at 20, 40, 100 and 200bb).
- Nothing measures the unequal-stack or 7–9 player games against a fuller solve. They are the same model on a correct
  tree, nothing more.
- A sanity check, not a reference: heads-up 100bb, the SB raises 60.5% and limps 36.8% (upstream's model: 49.6% and
  48.6%), and the BB facing a 2.5bb open folds 27.2%.

**The stored grid.** It holds the same 110 games as section 18.3 (2 to 6 players; 20 to 200bb; equal stacks; no rake
or 5% capped at 3bb), rebuilt with this model by `scripts/pf/build_stored.py --engine` into `engine/pf/lz1_*.bin`. The
lines are logged in `engine/pf/lz1_built.jsonl`. The build took 63 minutes of one core through the shared slot.

Each file stores the strategy as the page reads it, quantized, with its exploitability in the header:

| Players | Games | mbb/hand a seat | Longest build |
|---|---:|---|---:|
| 2 | 22 | 0.04 to 0.22 | 1 s |
| 3 | 22 | 0.04 to 1.03 | 4 s |
| 4 | 22 | 0.08 to 1.60 | 20 s |
| 5 | 22 | 0.13 to 1.65 | 84 s |
| 6 | 22 | 0.15 to 1.50 | 422 s |

The grid is 110 files, 1.18 MB. Six games were over the 1.5 mbb target at 1,500 iterations: 40bb at 4, 5 and 6
players, 5-max 50bb, and 6-max 150 and 200bb. They were re-solved at 3,000 iterations (`engine/pf_solve.STORED_ITERS_OF`;
a stored solve says that count). Four came under the target. 4-max and 5-max 40bb level off at 1.60 and 1.65 mbb.
Unquantized it is the same: 1.69, 1.65 and 1.60 at 750, 1,500 and 3,000 iterations, so quantization isn't the cause. A
live solve stops these by its stall rule too. Their headers carry the figure shown.

Unraked, the shipped 6-max 100bb file scores 7.79 points against upstream's 7.06 (23 and 25 spots out). The references
are raked (5% capped at 4bb), so the calibration was fitted to the raked game; an unraked game is measured only against
them, and there it is further off. No unraked references are in the repo.

Upstream's 108 files (`engine/pf_stored.py`) stay in the repo and the worker still loads their list. Nothing asks for
them now, because every chip-game preflop request goes to `engine/pf_solve.py`. They can go once the ICM work no longer
needs `pf_study`'s stored path.

The old and new files are not two answers to one game: the keys differ (`lz1_` prefix), so a browser's cache
(`lizard-pf`), a grade's stamp and the site's `pf/` never mix them. The bundle's version hashes every file, so this is
a new version.

**Checked in a browser** (local dev server, 2026-11-11), Study's Solver source:
- **3 players, BTN 40 / SB 18 / BB 60bb.** Upstream refused unequal stacks. Offered as about 5 s; solved to 2,000
  iterations at 0.22 mbb/hand. The BTN opens 33.3%. The SB facing the open goes all-in 19.0%, calls 4.5% and folds
  76.5%.
- **9 players, 100bb.** Offered as about 2 minutes; solved to 500 iterations at 1.10 mbb/hand in about 80 s. UTG opens
  9.0%. The line states the tree's limits.

Nothing else was clicked through: Practice's and Analyze's grade use the same request, and their own e2e steps weren't
re-run.

### 18.5 Tree options, a memory cap, and the charts' 3bet size for grading (2026-11-13)

Four things, measured apart: what the tree can now be asked for, how big a tree a browser is allowed to solve, how much
of a 6-max session the grade can put an EV on, and what the charts' 3bet size costs in accuracy.

**The tree's options** (`engine/pf_solve.py` `Spec`, `spec_of`; `engine/pf_engine.py` `build`). Each is off by default,
so every stored game and every number measured before this section is unchanged (an engine test asserts the default
trees still have 11,010 nodes at 6-max and 4,795 at 9-handed, and that a default switch leaves the key alone):

| Option | `pf_tree` | In the link | What it adds |
|---|---|---|---|
| Limps from any seat | `open_limps` | `pfs=L` | Any seat may limp first in or over-limp. A raise over limpers goes to the open plus 1bb a limper; the big blind checks or raises to 3.5bb (plus 1bb a limper past the first). Never with a straddle; heads-up it is ignored (the small blind's complete already is the first-in call) |
| Opens by position | `opens` | `pfs=o.UTG:2.2` | That seat's own first-in raise, 2 to 5bb. An open equal to the table's default is dropped, so it never makes a new key |
| Up to three see a flop | `flop3` | `pfs=f3:1` / `f3:0` | On up to 6 players, off from 7 |
| Cold calls of a 3bet, cold 4bets | `cold` | `pfs=cold:1` / `cold:0` | On up to 6 players, off from 7 |

Each has its own key suffix (`_L`, `_o{POS}{v}`, `_f3`/`_f2`, `_c1`/`_c0`, written only where the value isn't that table
size's default), its own words in the game's label and in `pf_limits`, and a note in the answer's `pf_tree`, which
Study's provenance line repeats. No stored game carries any of them, so each solves live in the browser.

What they cost in tree size (nodes, the figure the memory estimate is built on):

| Players | Default | Limps | 2-way, no cold calls | 3-way flops | Cold calls | Both |
|---|---:|---:|---:|---:|---:|---:|
| 6-max | 11,010 | 28,947 | 1,135 | — | — | — |
| 7 | 1,979 | — | 1,979 | 6,585 | 20,773 | 30,667 |
| 8 | 3,177 | — | 3,177 | 12,389 | — | 75,321 |
| 9 | 4,795 | — | 4,795 | 21,385 | 109,179 | 168,526 |

**The memory a solve needs, and the cap.** Peak resident memory was measured natively over building the game, iterating
and the exploitability check: 6-max (11,010 nodes, 6 seats) 749 MB, 9-handed (4,795 x 9) 588 MB, 4-max (764 x 4) 138 MB.
Fitted, `MB = 90 + 0.0118 x nodes x seats` (`MB_BASE`, `MB_PER_WORK`), which is within 20% of all three (an engine test).
`pf_unsolved` now carries `estimate_mb`, `nodes` and `max_mb`. The worker refuses outright, with `pf_none` and the
reason in words, a tree estimated past 2,048 MB when it is running in a browser (`MAX_MB_BROWSER`: Pyodide's heap is
32-bit); natively nothing is refused. On top of that the page holds a solve to a per-device cap
(`web/src/features/study/pfCap.ts`): a quarter of `navigator.deviceMemory` up to 2,048 MB, 1,024 MB where the browser
reports no memory (Safari, Firefox), 768 MB on a touch device. Over the cap the panel says how much the tree needs,
what the cap is and why, what to take off, and offers the charts instead; there is no Solve button.

The estimate is the tree's, not a measurement of that tab, and a browser's own limit is not `navigator.deviceMemory`:
a tab can be killed well under the cap, and a device with no report may hold more than 1,024 MB. The cap is a guess
sized to be safe, not a promise. Nothing here was measured in a browser other than Chrome.

**How much of a 6-max session the grade can put an EV on.** `pfGrade.ts` reads only a spot whose chips, options and
sizes are its own. The charts' blinds 3bet to 4x the open (10bb over 2.5bb) and the solve's tree raises 4.8x (12bb, the
published solves' size), so most blind 3bet lines were refused and kept the chart's frequency grade. Each 6-max game is
now stored a second time at `blind_3bet` 4 (`engine/pf/lz1_6max_*_blind_3bet4.bin`, 22 files: 11 depths, raked and not),
and Practice's and Analyze's grade asks for that one at 6 players in a cash game (`pfStored.ts` `pfGradeSizes`). Study
still solves the tree's own 4.8x.

The 22 files were solved the same way as the rest of the grid (1,500 iterations), and 21 of them land between 0.35 and
1.44 mbb/hand a seat. One doesn't: 6-max 40bb at the 4x 3bet levels off above the grid's 1.5 target, at 1.793 mbb after
1,500 iterations, 1.759 after 3,000 and 1.745 after 6,000, which is what is stored. Its own-size twin stops at 1.496.
The 4x 3bet puts more of the tree in 3bet pots at 40bb, where a class-level model's flop values are furthest from a
solve, and doubling the work moves it 0.014; a live solve's stall rule would stop there too. It is the only file in the
grid above 1.65, and the figure is in its header where the page reads it.

Measured on 30,000 hands a run (`scripts/pf_practice_coverage.py`, now on Lizard's engine, `--chart-sizes` for the
after), 6-max 100bb, you playing the charts:

| | Decisions answered | Hands holding one it can't grade | First in | Facing an open | Facing a 3bet | SB | BB |
|---|---:|---:|---:|---:|---:|---:|---:|
| Before | 70.2% | 30.8% | 100% | 46.7% | 3.9% | 23.4% | 12.0% |
| After | 93.0% | 7.3% | 100% | 99.0% | 21.1% | 91.2% | 81.8% |

Raked (5% capped at 3bb) the same: 70.2% to 93.0%. Playing at random, 65.6% to 86.3%; playing the solve itself, 70.7%
to 93.3% (that last row is a check that the grade reads the solve it is drawn from: 99.7% Best).

What is still refused is mostly 4bet sizes: the chart 4bets to 20bb where the tree raises to 17.25bb (1,025 of the
2,133 remaining), then 17 against 17.25 (285) and 25.5 against 23 (264). Facing a 3bet is still only 21.1% answered.
A grade that allowed a size within some tolerance instead of exactly would answer more; it isn't built, because the EV
read would then be another spot's.

**What the chart size costs in accuracy.** Both games solved 700 iterations at the references' rake and scored the same
way as section 18.4 (`scripts/pf/measure_tree.py`):

| Game | Mean error | Spots out | Facts off | mbb/hand |
|---|---:|---:|---:|---:|
| The tree's own 4.8x (reproduced) | 2.37 | 14/26 | 10 | 1.38 |
| The charts' 4x | 3.16 | 15/26 | 10 | 1.10 |

By kind: opens 3.52 to 3.36, facing an open 1.57 to 1.59, facing a 3bet 2.91 to 4.89. The whole rise is in three spots
where the reference's opener faces a 12bb blind 3bet and the chart-sized game's faces 10bb (CO vs BB 1.13 to 5.31, BTN
vs SB 2.23 to 6.64, BTN vs BB 2.92 to 7.77). That is the two games differing, not the model getting worse: a 10bb 3bet
is a different spot, and the published solves hold no 10bb one to compare with. It is why Study keeps the 4.8x tree,
and why the grade's label is unchanged: both are the calibrated class-level model, APPROXIMATE.

**Checked in a browser** (local dev server, 2026-11-13), Study's Solver source:
- **3 players, BTN 25 / SB 40 / BB 40bb**, set in the new Tree form (the link carries `stacks=BTN:25`). Offered as about
  5 s and about 93 MB; solved to 2,000 iterations at 0.46 mbb/hand, the BTN raising 41.1% first in. The line reads
  "each seat's own stack (side pots; not measured against a fuller solve)".
- **9 players, 100bb, 3-way flops and cold calls on.** Refused, as it should be: "This tree needs about 17,987 MB to
  solve, more than 2,048 MB on this device (a quarter of the 16 GB this browser reports)", with the charts offered.
  Counting that 168,526-node tree took about 15 s before the refusal.
- **7 players, 100bb, 3-way flops on.** Offered as about 2 minutes and about 634 MB, so the fuller 7-handed tree does
  fit a desktop tab. It was not solved: a 2-minute browser solve wasn't run while the machine's library builds were
  using it, so nothing is measured about a 7-handed 3-way-flop solve's accuracy.

Not done: no straddle from a seat other than UTG, no 5bet rules, and the limp and per-position-open trees are not
measured against the published solves (none of them has limps or uneven opens, so there is nothing there to measure
against). A limped 3-handed 40bb game converges under 1.5 mbb/hand in 1,500 iterations, which is all that is claimed.

### 18.6 Hands past a library range's edge: QTo opened over QJo (2026-11-16)

**The report.** The Solver source's HJ first-in range at 6-max 100bb opened QTo 97% and folded QJo 100%. That
ordering is implausible: QJo has more equity than QTo against almost any range, and its kicker is higher and more connected.

**What it wasn't [V].** The page showed the solve exactly. The stored `lz1_6max_100bb` answered QTo raise 97% at EV
0.000bb and QJo fold 100% with a raise EV of −0.043bb, and the grid draws those numbers unchanged: cells are keyed by
class name on both sides (`engine` `CLASSES`, `web/src/engine/nlhe/cards.ts` `classLabel`), with no numeric index to
go wrong. Each offsuit class holds exactly its 12 combos (`gto.pf_classes`: 78 offsuit classes of 12, 78 suited of 4,
13 pairs of 6, 1,326 in all). Equity against a random hand is right (QJo 56.4%, QTo 55.7%). The solve was converged:
1.17 mbb/hand a seat, with the node's regret 0.

**The cause [V].** The flop values. A preflop class meets a flop at a share of the pot taken from the flop library
(`pf_game.LibraryModel`), which measured only the classes inside each spot's own range. In `srp_hj_bb`, HJ's library
range holds QJo but not QTo. Upstream valued a class outside the range by its measured model's excess over equity,
shifted to meet the library's values at the range's weakest classes. That join ran high just past the edge. At the
calibrated corrections, against the BB's library range, QJo met 0.535 of the pot and QTo 0.580, though QTo has less
equity (0.499 against 0.515). Against the CO the figures were QJo 0.338 and QTo 0.412. Opening QTo was simply the best
response to those values.

**The same fault elsewhere [V].** A dominance audit of every first-in range in the 6-max 100bb games (raked, unraked
and chart-sized) flagged a better hand folding while a worse one raised. The clear cases all had the worse hand just
outside the library range and the better one inside:
- HJ: QTo over QJo and KTo;
- CO: A4o over A5o, Q9o over QTo and K9o;
- BTN: A2o over A3o, Q7o over Q8o and K7o;
- SB: K6o over K7o.

Over every library spot, 40 classes outside a range met more of the pot (by over 0.005) than the class with the next
better kicker inside it.

The audit also flagged connectors raised over one-gappers, like 65s over 75s, 98s over T8s and 64s over 74s. Those
are inside the library's measured ranges, and a real solve opens connectors over gappers too, so they are not taken as
faults.

**The fix [V].** `ext = 2` (`pf_model.LowerEdgeLibraryModel`) values a class outside a spot's range at the lower of
upstream's join and the smooth fit that section 18.4 tried as `ext = 1`. The fit is a nearest neighbour of the same
shape inside the range, moved by a fit on hand shape and equity. Inside the range nothing changes. Against the BB,
QTo now meets 0.505 of the pot, below QJo's 0.535; against the CO, 0.310 against 0.338. Over every library spot, 7
classes outside a range still beat their better kicker, all by 0.016 of the pot or less, and 5 of them are ace-wheel
hands (A2o, A4o).

**Against the published solves [M]**, measured as section 18.4: 26 certain spots at their rake, 700 iterations
(`scripts/pf/calibrate.py eval`, runs in `scripts/pf/calib_runs.jsonl`). The ten corrections were not refitted.

| Model | Mean error | Spots out | Hand facts off |
|---|---:|---:|---:|
| Upstream's | 2.85 | 16 / 26 | 11 / 15 |
| Upstream's with the lower edge (nothing else) | 2.69 | 13 / 26 | 10 / 15 |
| Calibrated, `ext = 0` (lz1, as shipped until today) | 2.37 | 14 / 26 | 10 / 15 |
| Calibrated, `ext = 1` (the smooth fit alone) | 2.30 | 8 / 26 | 11 / 15 |
| **Calibrated, `ext = 2` (adopted, lz2)** | **1.84** | **5 / 26** | 12 / 15 |
| Held out, `ext = 0` → `ext = 2` (each half scored in the solve fitted on the other) | 2.51 → 2.01 | 13 → 9 | — |

Two hand facts went out, and none that held came in:
- BB calls A2s against the BTN (99.7% → 0%);
- UTG opens KTo at most 25% (0% → 28.5%).

Two that were off moved most of the way: the BTN's A2o (100% → 13%, wanted at most 5%) and its A4o (0% → 38%, wanted
60%+). UTG's 44 went from 75% to 0%, wanted 95%+; it was off before too.

First-in opens at the references' rake, `ext = 0` → `ext = 2`: UTG 15.8% → 16.5%, HJ 19.0% → 21.5%, CO 25.5% → 29.0%,
BTN 40.8% → 43.3%, SB 49.1% → 46.5%. Section 18.4 found the opens 3–4 points tight from UTG to CO; these close most of
that.

**The model's key is now `lz2`** (`engine/pf_solve.MODEL_TAG`, `web/src/solver/pfStored.ts`), so no stored file,
browser cache entry or stamp mixes the two models' solves. The stored grid was rebuilt as `engine/pf/lz2_*.bin`
(132 games, 8,319 s of solving through slot.sh; every game within the StoredGrid bounds, the farthest 1.605 mbb
for lz2_6max_40bb_blind_3bet4 at 6,000 iterations and 1.257 mbb among the 1,500-iteration games). In lz2_6max_100bb
the HJ opens QJo 87% and folds QTo (98% and 0% with rake), and none of the audit's kicker pairs is inverted; what
the audit still flags is a lower card that is more connected (98s over T8s, 53s over 63s, A5o over A6o), as published
solves have it, and one plain oddity: the SB folds Q8o and raises J8o (no rake).

**Tests.** `scripts/engine/test_pf_engine.py` `RangeEdge`:
- no class outside a library range meets more of the pot than its better kicker inside it by over 0.02 (`ext = 0`
  fails this 20+ times);
- the stored 6-max 100bb game keeps the audit's pairs in order: HJ QJo ≥ QTo; CO QTo and K9o ≥ Q9o; BTN A3o ≥ A2o and
  Q8o, K7o ≥ Q7o; SB K7o ≥ K6o.

**Not done.** The ten corrections were fitted with `ext = 0` and not refitted at `ext = 2`; a refit might gain more.
Nothing here measures depths or table sizes other than 6-max 100bb, as section 18.4 says of the calibration. The
charts stay the default (0.96 points).

### 18.7 The opener facing a 3bet: hands out of order, too many 4bets (2026-11-16)

**The report.** The Solver source's 6-max 100bb game, raked (`lz2_6max_100bb_r5c3`), played UTG facing the BTN's
3bet out of rank order:
- pairs: QQ 4bet 100% and JJ called 100%, then TT 4bet 54% / called 33%, 99 4bet 15% / folded 85%, 88 called 66%, 77
  folded, 66 called 31%, 55 folded;
- suited hands: QJs and T9s folded.

It also 4bet too much and called too little against the published references (4bet / call, % of the opened range):

| Spot | lz2 | References |
|---|---|---|
| UTG vs BTN | 23.2 / 18.2 | 18.7 / 24.4 |
| HJ vs CO | 22.6 / 13.3 | 18.1 / 18.3 |
| CO vs BTN | 21.6 / 16.9 | 19.2 / 16.9 |
| CO vs BB | 14.2 / 17.5 | 9.6 / 22.4 |

UTG opened 16.6% against the references' 18.3%.

**Reproduced [V].** `scripts/pf/vs3bet.py --stored` on the lz2 file gives every figure above. It also measures the
opener facing a 3bet hand by hand, at all 15 seat pairs, against a full 6-max 100bb solve kept locally
(PokerData's, personal-use licence; read from `~/Desktop/projects/poker-reference`, never committed or shipped; this
section quotes only distances to it). Three measures:
- **Per-hand gap:** half the L1 distance of each class's 4bet/call/fold mix from the solve's, weighted by the solve's
  combos at the node.
- **Hands out of order** (`engine/pf_order.py`): a pair from 77 up, or a suited hand T-high or better with a 7+
  kicker, that continues (4bet + call) more than 20 points less often than a weaker hand of its family. The solve
  itself has none at any of the 15 spots. Below those families real solves aren't monotone (22 over 33-55, 66 over 77
  out of position, K6s and A5s as 4bet bluffs), so they are left out.
- **Totals:** the 4bet and call shares of the range, against the solve and against the published references.

lz2: gap 27.3 points, 7 hands out of order.

**The cause [V].** The per-class flop values in 3bet and 4bet pots are rank-sawtoothed by the flop sample.
- A class's value is measured over a sample of flops shared by every class, so a rank the sample deals more often
  lifts every hand holding it.
- `pf_eqr`'s per-class residuals, which value every 4bet pot and every class past a library range's edge, run 66
  −0.06, 55 +0.01, 44 −0.05, 33 −0.08, 22 +0.00 in every pot type and role.
- The library's three 3bet spots are 184 flops each, and every in-position 3bet pot uses BTN-vs-CO's. The caller's
  share there runs 99 0.372 < 88 0.395 and 77 0.349 < 66 0.392.
- The river correction (`advisor._river_fix`) adds a step of its own, from 0 at 77 to +0.1 at 66.

A class-level solve plays each class almost purely, so each step becomes a flip between neighbours: 88 calls, 99
folds.

**The fix [V].** `s2` and `s3` (`engine/pf_model.py` `smooth_shares`) smooth a 3bet / 4bet pot's share matrix along
each family of hands: the pairs, and the suited and offsuit hands of each high card by kicker. Each class's main
effect, meaning its mean excess over equity as aggressor and as caller, moves `s` of the way to its family's trend in
rank: a quadratic for 6 or more members, a line for 3-5. How a class does against one class rather than another is
kept. `s2 = s3 = 0.5`; the ten corrections are unchanged.

**Measured [M].** 700-iteration solves at the references' rake (5% capped at 4bb) and at 5% capped at 0.5bb
(`scripts/pf/calibrate.py eval --rakes "0.05,4;0.05,0.5"`). The references are the 26 published spots of section
18.4; gap, out-of-order and totals are the opener facing a 3bet as above. Rows are rakes 4bb / 0.5bb.

| Model | References: error / out (4bb) | Per-hand gap | Out of order | Totals vs the full solve | Totals vs published |
|---|---:|---:|---:|---:|---:|
| lz2 | 1.84 / 5 | 26.6 / 25.1 | 9 / 8 | 9.1 / 7.0 | 3.1 / 3.9 |
| **s2 = s3 = 0.5 (adopted, lz3)** | 2.01 / 6 | **25.9 / 24.6** | **3 / 3** | 9.2 / 6.8 | 3.2 / 3.9 |
| s2 = s3 = 1 | 2.18 / 7 | 25.7 / 24.4 | 4 / 7 | | |
| s2 = s3 = 0.25 | 1.87 / 7 | 26.2 / 25.0 | 5 / 4 | | |
| s3 = 0.5 alone | 1.83 / 5 | 26.6 / 24.9 | 5 / 5 | | |
| s2 = 0.5 alone | 1.91 / 5 | 25.6 / 24.5 | 5 / 8 | | |
| refit, vs-3bet shares weighted ×3 | 1.98 / 10 | 25.1 / 23.5 | 1 / 3 | 8.0 / 5.4 | |
| refit, weighted ×1 | 2.02 / 8 | 25.5 / 23.9 | 2 / 3 | | |

The refits (`calibrate.py fit --w3bet`) refit the ten corrections with the references' vs-3bet call and 4bet shares
weighted. They gain about a point of gap but put 8-10 of the 26 spots out of tolerance, and they don't hold out: each
half's fit at the looser ridges predicted the other half at 2.87-3.58 points. They weren't adopted.

lz3 holds out at 2.26 points against lz2's 2.01 and upstream's 2.85 (each half of the references scored in the solve
fitted on the other, `s` fixed). Hand facts off: 11 of 15 (lz2 12).

**The stored games, 1,500 iterations [V]** (`vs3bet.py --stored`):

| Game | Per-hand gap | Out of order | Totals vs the full solve | Totals vs published |
|---|---:|---:|---:|---:|
| 6-max 100bb, no rake: lz2 → lz3 | 25.7 → 24.6 | 12 → 3 | 6.5 → 6.1 | 3.5 → 3.8 |
| 6-max 100bb, 5% capped at 3bb: lz2 → lz3 | 27.3 → 26.7 | 7 → 4 | 9.2 → 9.8 | 3.1 → 3.8 |

No pair is out of order in either lz3 game. What remains is A9s continuing more than ATs facing a blind 3bet (and A8s
once, no rake).

UTG facing the BTN's 3bet in the raked game now plays:
- AA-QQ 4bet, JJ calls, TT 4bets 41% and calls 59%, 99-66 fold;
- AKs 4bets, AQs calls, AJs and ATs mix, A9s and KQs call.

**Not fixed [M]: the volume.** No correction or smoothing tried moves the 4bet share much. At 5% capped at 3bb, in the
three published spots where the opener has position against the 3bettor (UTG vs BTN, HJ vs CO, CO vs BTN), it 4bets
21-24% of its range where they 4bet 18-19%, and calls 12-18% where they call 17-24%. Against the blinds it is within
about 5 points. Rake moves it less than the full solve: from the 4bb cap to the 0.5bb cap its calls rise about 5
points, while the full solve (at 0.5bb) calls about 15 points more than the published ones (at 4bb). Part of that gap
is between those solvers, so it was not taken as a target.

So every node at or after a 3bet in Lizard's solve now says so. `engine/pf_solve.Solve.node` adds `pf_3bet` (the
text `AFTER_3BET`) when the line holds two or more raises. `web/src/solver/provenance.ts` `preflopSolveOf` marks the
node approximate with those words, and the label ends "· approximate".

**The model's key is now `lz3`** (`MODEL_TAG`, `web/src/solver/pfStored.ts`). The stored grid was rebuilt as
`engine/pf/lz3_*.bin` through slot.sh (132 games, 7,306 s of solving; every game within the StoredGrid bounds, the farthest 1.524 mbb
for lz3_6max_40bb_blind_3bet4 at 6,000 iterations and 1.149 mbb among the 1,500-iteration games).

**Tests.**
- `scripts/engine/test_pf_engine.py` `HandOrder`:
  - the smoothing flattens a sawtooth and keeps a trend;
  - smoothed, the pairs meet more of a 3bet pot by rank, and 77 over 88 in a 4bet pot is halved (unsmoothed:
    0.021 and 0.054 of the pot out of order);
  - the stored 6-max 100bb games, raked and not, have no pair out of order facing a 3bet and at most 4 hands in all.

  The full solve is used only as a measure, never a fit target, so hand order is held out.
- `Protocol`: a node after a 3bet carries `pf_3bet`, one before it doesn't. Its export round trip now allows the
  export's 1/255 steps; it had compared mixes exactly and passed on lz2 by chance of rounding.
- `web/src/solver/provenance.test.ts`: the node is marked approximate with the text.

### 18.8 EV gaps the model can't tell apart (2026-11-18)

A preflop grade said "Inaccuracy, 0.02bb lost" for folding 8d7s on the button at 6-max 100bb, folded to. The stored game
(lz3_6max_100bb_blind_3bet4, the one Practice grades by) raises 87o 100% at an EV of 0.022bb over folding; the charts,
from the published solves, fold it half the time (`solver/gto/preflop.py` RFI, `87o:0.5`), so there raising and folding
are worth the same. The grade followed its rules; the rules took the class-level model's EVs as finer than they are.

The same thing, larger, is section 18's own table: playing the charts exactly was graded below Correct 8.9% of the time,
2.4% of it Blunders. Measured again (30,000 hands of chart play, 6-max 100bb at the charts' sizes,
`scripts/pf_practice_coverage.py --policy chart --chart-sizes --seed 7`), the chart's play lost to the stored game's best
by a median 0.05bb first in, 0.16bb facing an open and 0.83bb facing a 3-bet where it was graded below Correct; the
largest, 4-betting QQ against a 3-bet (the chart 90%), "lost" 8.8bb.

**How fine the model's EVs are [M].** Where the charts weight a hand's action between 15% and 85%, the published solves
play it both ways, so its EV equals the alternative's. On those plays, the chart's action trails the stored game's best
action by, at the 90th percentile:

| Decision | Plays | Median pot | 90th percentile, bb | % of the pot |
|---|---:|---:|---:|---:|
| First in | 553 | 1.5bb | 0.076 | 5.1% |
| Facing an open | 1,719 | 4bb | 0.32 | 7.9% |
| Facing a 3-bet | 217 | 13bb | 1.47 | 10.9% |
| Facing a 4-bet | 29 (lz4) | 34bb | 4.37 | 13.3% |

(lz3; the lz4 rebuild's game gives 5.1%, 7.9%, 11.0% and 13.3%.) Measured by class instead of by play, on the 31 opens
the charts mix, raise and fold differ by 0.051bb at the median and 0.079bb at the 90th percentile.

**The rule.** The noise grows with the pot, and 4 + 2.75 ln(pot) % of the pot fits it (5.1%, 7.8%, 11.1%, 13.7% at those
pots). A grade by the preflop solve (`web/src/grading/grade.ts` `pfNoisePct`, `noiseOf`) now calls an action within that
of its best Correct, and past it grades only the excess against the 2% and 8% thresholds, so a gap just over the noise is
an Inaccuracy, not a Blunder; folding aces first in (8.25bb) is still a Blunder. The EV lost is shown as measured, and the
"why" says what the model can tell apart there. Practice, the live and preflop drills, Review's retries, Analyze and its
leak drill all pass the answer's source in. Every other source's EVs keep the 0.011bb tie.

**What it does [M].** The same 30,000 hands, graded by the rule:

| You play | Rule | Best | Correct | Inaccuracy | Mistake | Blunder | Below Correct |
|---|---|---:|---:|---:|---:|---:|---:|
| The charts | before | 92.5% | 0.1% | 2.0% | 4.1% | 1.3% | 7.4% |
| The charts | noise | 92.5% | 6.0% | 0.7% | 0.6% | 0.1% | 1.4% |
| At random | before | 44.1% | 0.1% | 2.4% | 8.9% | 44.4% | 55.7% |
| At random | noise | 44.1% | 9.8% | 3.0% | 8.9% | 34.3% | 46.2% |

(lz4, the game being rebuilt now, seed 7; 30,617 and 32,725 decisions. The EV lost a decision is unchanged, 0.0185bb and
0.3801bb: only the verdicts move.) Playing the published solves' charts is called below Correct one time in 70 instead of
one in 14, and random play is still graded below Correct almost half the time.

**Not established.** The noise is measured at 6-max 100bb, and since section 18.10 at heads-up 100 and 20bb and 3-max
100bb, where the curve stays (heads-up, the grade is capped instead); other depths and table sizes use the same curve.
It treats the charts' weights as the published solves' indifference, which they are only to the charts' rounding (many
are written 0.5). The preflop drill stopped every grade at an Inaccuracy (`PreflopDrill.tsx`) until section 27 took the
cap off, and every other source's EVs kept the 0.011bb tie until section 27 gave each answer a noise of its own.

### 18.9 Untrained moves, hand order, 13 to 19bb, and the tournament presets (2026-11-18)

**Moves the stored solve never makes.** pf_study.pack stores each hand a player never brings to a node as folding there,
so a move no hand in the range makes is priced against seats that never trained against it: its EV is that of folding to
whatever comes next. At 6-max 40bb at the charts' sizes the HJ never 3-bets UTG's 2.5bb open, and the stored EV of the
3-bet is -7.5bb for AA as for 72o, so the grade called the chart's AA 3-bet a 12.8bb Blunder. Now a move the range makes
under 0.5% of the time (`UNTRAINED_SHARE`) that even its strongest hand loses 0.5bb or more by, against folding
(`UNTRAINED_LOSS`), leaves the whole spot to the chart, and the grade says why (`web/src/features/practice/pfGrade.ts`
`untrainedMoves`, tests `pfGrade.test.ts` on real stored answers, `web/src/test/fixtures/pf_untrained.json`). That is
8,856 of the grid's 47,018 graded nodes, 1.6% of decisions by reach. Folding AA first in at 40bb is still a Blunder by
the solve, and AA's trap call facing a squeeze at 50bb (0.46% of UTG's range, +9.1bb) is learned and stays graded.
[M] The audit's never-trained moves (under 0.5% of the range, EVs flat across the live classes within 0.5bb, even the
strongest class losing over 0.5bb): 3,266 in the cash grid's 132 games and 488 in the 115 tournament presets, every one
graded by its EV before, none now. `scripts/engine/test_pf_offpath.py` holds that at 0 (CI's quick set by default,
every game with `PF_OFFPATH_ALL=1`).

**The charts' hand order.** Over the audit's sweep of the charts as served (moved by `pf_formats`, re-priced by
`Advisor._priced`, jams from push/fold; 2 to 9 players, 10 to 200bb, antes, straddles and rake; about 41,900 nodes), a
hand continued 0.25 or more less often than one it dominates (the pairs, each high card's kickers with A2-A5 apart, each
offsuit hand below its suited twin; both hands arriving at 5% or more), K4o continuing over K5o. The charts as served are
now repaired outside `solver/` (`engine/pf_charts.py`, `engine/pf_dominance.py`, imported by the worker at start):
continue frequency pooled along each chain where it breaks the order, and AA-KK-QQ-JJ, AKs-AQs, AKo-AQo and AKs-AKo's
raises, where the stronger raises less, set to the isotonic regression over that order, each weighted by the combos
arriving, so every action keeps its share of the range. A local server runs upstream without `engine/`, so there the
charts are upstream's (13 to 19bb on the 100bb charts, hands out of order as before); the published site and Practice
run the worker, which has them.

**How a node is repaired (reworked after review, 2026-11-18) [M].** Each node's answer is upstream's (its re-priced
calls, `Advisor._priced`, or a tournament's open, `_icm_open`), priced against upstream's ranges, and then repaired by
the combos the served ranges bring. The first version priced against the repaired ranges, so one node's repair could
tip another's knife-edge re-draw: at 9-max 100bb, with the small blind squeezing more AA (0.09 to 0.71), UTG's AKs
folded 98.8% to the squeeze where it had jammed 83.4%. Over the review's 14-game sweep, 44 premium class-nodes not
facing an all-in folded 0.3 or more more often than upstream (AA, KK, QQ, JJ, AKs, AKo arriving at 20% or more; 171
with the calls of a jam, which follow the jams as below); now none do, and that AKs jams 83.4% again (`test_pf_charts.py` `test_no_premium_folds_more_than_upstream_has_it`, over
9-max 100bb with up to three players in and 7-max 100bb). A hand that reaches a node only through an earlier repair
(upstream's ranges bring under 1% of its combos there) plays the chart's own answer there: at 6-max 200bb J9s 3-bets
over UTG's open only because the repair pools it with JTs, and facing the 5-bet upstream's re-draw had given it a call it
never weighed, which pooled with JTs went all-in for 200bb. Both fold there now
(`test_a_hand_only_a_repair_brings_plays_the_charts_answer`). The premiums' overlapping steps are solved at once: one
chain after another had left AQs at 0.375 where the order allows its 0.70 (AKs, AKo and AQo 0.864).

**Jams.** The jams (`Advisor._push`) are repaired too, and an open- or 3-bet-jam's range, which the later streets and
the calls of it read (`_jam_range`), is now the advice's own jams. Upstream's split from its own advice even unrepaired,
its push/fold flatting alternative reading the chart's calls rather than the re-priced ones: at 6-max 15bb the big
blind jammed 33 100% over a HJ open and a CO call while the range held none, and at 6-max 40bb the CO's 3-bet jam over
UTG's open and the HJ's call held A8s 88%, which the advice never jams. Over 6-max 10, 15 and 25bb, 9-max 15bb with an
ante and heads-up 15bb, the advice's jam frequency and the range now agree to the grid's rounding (`test_pf_charts.py`
`Jams`). Since the no-rake charts (50264fb, `gto/pf_norake.py`) the advice at a table without rake jams from the chart
moved to no rake, so the jam range is read from that chart too (`engine/pf_charts.py` `advice_strategy`): read from the
raked chart it had the HJ's AKo over a 6-max 15bb UTG open in the range 69% while the advice jams it 90%; now all 113
jam nodes of those games agree, and at 5% rake capped at 4bb (6-max and heads-up 15bb) they agree as before. A jam
ends the betting, so no flop library spot reads these ranges; the ranges entering a flop stay the charts'. Facing a jam, a call is by equity against that range, so the calls move with it: over the review's 14 games,
10,230 jam-facing nodes, 1,639 class-nodes call 0.05 or more less often and 1,841 more often (premiums 643 and 523).
That CO jam is one: the small blind's AKs had 45.3% against the old range and calls 35% of the time, 44.0% against the
jams the advice makes, and calls 3%, with 45.9% needed.

**Library nodes.** The nodes that feed a published flop library spot are left as they were: the decisions of the
players who reach its flop, on its line, at its table size and at the decider's effective depth, with no ante or
straddle, whatever a folded or deeper seat holds. (The first version bailed out on any table with unequal stacks and
repaired those nodes too, moving 26 of the 57 spots' ranges there.) The list is the 57 heads-up spots the repo builds
(`flop_library` `SPOTS` and `FORMAT_SPOTS`, `scripts/library/build_breadth.py` `SPOTS`; `test_pf_charts.py` holds it to
them): the library's 53, and four `FORMAT_SPOTS` not built yet (HJ and UTG against the big blind at 40 and 200bb) [M]:

| Over the sweep (41,889 nodes) | Before | After | Of them at library nodes |
|---|---:|---:|---:|
| Continue inversions | 6,267 | 115 | 77 (77 before) |
| AA or KK flatting over 60% while the next hand down raises more | 469 | 2 | 2 (2 before) |
| Raise inversions (0.5 or more, the weaker not a wheel ace; not repaired outside the premiums) | 2,151 | 851 | 66 (66 before) |

Before, by node: 185 first in, 3,998 facing an open, 1,995 facing a 3-bet, 58 a 4-bet, 9 a 5-bet, 22 over limps. The 38
left away from library nodes: 14 are the big blind's check or raise over a heads-up limp (2-max 20 and 40bb, offsuit
kings raising more than suited), which has no fold to continue against; 24 face an all-in, where the call is by equity
against the jam in `Advisor._vs_jam` and, inline, in `preflop_ranges`, so repairing the advice alone would split it from
the ranges the later streets play. The 2 flats left: 8-max 100bb, the big blind's KK over UTG's and UTG1's opens
(`srp_utg_bb_8max`, `srp_utg1_bb_8max`). The first version's sweep counted 108, 2 and 894; the 7 more continue
inversions are the four unbuilt spots' nodes, now left as they were.

**Fingerprints [M].** All 57 heads-up spots' ranges are the same with the repair as without, also at a table where a
seat that folds has another stack and the player who closes the action is deeper (`test_pf_charts.py` `LibrarySpots`).
The library index's 53 fingerprints, recomputed with `engine/pf_charts.py` imported in the worker's order, all match.
Repairing every node would have changed 26: srp_co_bb, 3bp_bb_btn, 3bp_sb_btn, 3bp_bb_co, srp_sb_bb_2max,
lp_sb_bb_2max, srp_btn_bb_40bb, srp_co_bb_40bb, srp_sb_bb_40bb, 3bp_bb_btn_40bb, srp_co_bb_200bb, 3bp_bb_btn_200bb,
srp_btn_bb_8max, srp_sb_bb_8max, srp_co_bb_8max, srp_utg_bb_8max, srp_hj_bb_8max, 4bp_utg_hj, 4bp_co_btn, 4bp_btn_sb,
srp_lj_bb_8max and srp_utg1_bb_8max (22 of the library's), and the four unbuilt ones. The four 3-way spots
(mw_co_btn_bb, mw_btn_sb_bb, mw_hj_ip_bb, mw_utg_btn_bb) did not match before and still don't; the repair moves only the
big blind's range in each, by 2.86, 0.98, 2.41 and 2.25 combos of 384 to 428, and no opener's or caller's. Measured
against the ranges each spot was built on (`engine/mw_built.py` on claude/postflop-engine), the big blind's
`flop_approx.range_dist` goes from 0.1495 to 0.1495, 0.1437 to 0.1437, 0.1648 to 0.1647 and 0.1419 to 0.1417: a hair
closer, nowhere further.

**13 to 19bb.** Above push/fold (12bb) and below the shallowest moved chart (20bb) the charts were the 100bb ones,
unmoved: the 6-max button opened 45.1% at 13 to 19bb, as at 100bb, and 36.6% at 20bb. Those depths now play the 20bb
game's moves, re-priced to the table's depth as any chart's are: the button opens 36.6%, and the big blind defends its
open 53.4% at 15bb (48.4% before; 53.4% at 20bb). The answer's note says so: "the 20bb chart, played at 15bb (the 100bb
chart moved by solves of the 20bb game)" (upstream's wording, "of this game", was wrong at 15bb). 12bb is push/fold as
before. No flop library spot is at these depths (`test_pf_charts.py` `Shallow`).

**Tournament presets.** The 115 stored presets were solved on upstream's flop model (`pf_study.flop_model`), whose join
at a library range's edge valued a class just outside it above its neighbours inside (section 18.6 has the cash grid's
case): the Early preset's hijack opened QTo 100% and folded QJo. They are re-solved on the cash grid's calibrated model
(`engine/pf_model.py`; `engine/pf_icm.py` `flop_model`, the key tagged `cal1` so no cached solve of the old model is
read), 1,500 iterations each as before. The tag carries the model's inputs: `pf_icm.model_digest` hashes the class
equities (`gto/pf_equity.py`) and the calibration (`engine/pf_calib.py`), and with any other digest every game keys as
`cal1-<digest>`, so the stored presets stop being read and `test_pf_icm_stored.py` fails until they are solved again
(`scripts/pf_icm/build_stored.py all --missing`). Now the hijack opens QJo 51% and folds QTo. [M] Over every preset's non-rough
nodes (the same thresholds, an inversion EV-backed where the weaker hand's best EV over folding is 0.05bb or more above
the stronger's):

| 115 presets | Before | After |
|---|---:|---:|
| Hands out of order | 13,726 | 11,019 |
| EV-backed | 8,823 | 6,275 |
| Raising first in | 544 | 87 |
| Raising first in, EV-backed | 240 (in 59 presets) | 0 |
| mbb/hand from equilibrium, median and most | 0.18, 1.62 | 0.16, 2.09 |

The most is the 3-left, 10bb-average final table with the short stack in the big blind. `scripts/engine/test_pf_icm_order.py`
holds the EV-backed first-in count at 0 over all 575 first-in nodes. A hand's EV for a move it never takes is read off
the replies to the hands that do take it, so "EV-backed" is the solve's own reading, not a measured price.

**Not re-solved: the cash grid.** The stored cash grid (`engine/pf/lz3_*.bin`) is not rebuilt here, and its hands out of
order stay. Its audit (the same thresholds, non-rough nodes): 9,600 inversions in 114 of the 132 games, 7,914
EV-backed. None raising first in; 192 heads-up facing an open; 1,416 heads-up in 3-bet and bigger pots (facing a 3-bet
949, a 4-bet 338, a 5-bet 128, a 3-bet over a limp 1); 6,306 multiway (facing an open and a call 1,991, a 3-bet 1,087, a
4-bet 2,798, a 5-bet 430). In the 6-max games at the charts' sizes, which Practice grades 6-max by: 2,872 (71 facing an
open, 318, 116 and 42 heads-up facing a 3-bet, 4-bet and 5-bet, 2,325 multiway). A grade there takes the solve's EVs as
they are, within section 18.8's noise allowance; nodes at or after a 3-bet are labelled approximate (section 18.7).

### 18.10 Heads-up: moves a hand never makes, and where the solve parts from the charts (2026-11-18)

The Practice QA sweep (`docs/QA.md`) found the heads-up 100bb small blind's chart play graded a Mistake or Blunder on
one hand in seven: SB 8dTd limped as the chart does 99%, and the solve called it a 0.65bb Blunder (its raise 1.0bb, its
limp 0.35bb). Two causes, two fixes.

**A move a hand never makes was valued as that move and then folding [M].** `pf_study.pack` stores every class a player
never brings to a node as folding there, and the node's EVs are read off the stored strategy, so the limp of a class the
solve never limps was the limp and then a fold to the big blind's iso-raise. T8s's limp read 0.352bb against its raise's
1.0; AA's limp 1.19bb. Now each player's classes with no reach at a node of theirs play their best response there,
against the others' strategies, on a line the solve trained the others against (every move of the seat's own on the way
made by at least 0.5% of its range, pfGrade.ts `UNTRAINED_SHARE`), taking only moves the solve trained, a fold, or a
move that ends the betting (`engine/pf_offpath.py`, mixed into `engine/pf_solve.py`'s and `engine/pf_icm_study.py`'s
Solve; tests `scripts/engine/test_pf_engine.py` `OffPathValues`). Nothing else moves: those classes have no reach, so no
other player's value changes, nor the solve's mixes, its on-path EVs or the range's EV; solving, exploitability and the
stored files are untouched. T8s's limp reads 0.90bb now and AA's 3.26. Over 30,000 hands of chart play
(`scripts/pf_practice_coverage.py --policy chart`, seed 20261105), graded by section 18.8's rule:

| Table | Best | Correct | Inaccuracy | Mistake | Blunder | Mistake or Blunder | EV lost a decision |
|---|---:|---:|---:|---:|---:|---:|---:|
| Heads-up 100bb, before | 74.8% | 13.2% | 2.2% | 5.1% | 4.7% | 9.8% | 0.0614bb |
| Heads-up 100bb, the fill | 75.3% | 15.0% | 2.7% | 5.0% | 2.0% | 7.0% | 0.0421bb |
| Heads-up 20bb, before | 80.3% | 13.6% | 3.5% | 1.9% | 0.7% | 2.6% | 0.0204bb |
| Heads-up 20bb, the fill | 80.3% | 13.8% | 3.7% | 1.9% | 0.3% | 2.2% | 0.0190bb |
| 6-max 100bb (charts' sizes), the fill | 92.1% | 6.6% | 0.5% | 0.6% | 0.1% | 0.7% | 0.0181bb |

**Where it parts from the charts, it isn't noise [M].** Measured as section 18.8 measured 6-max (where the charts play a
hand 15-85% one way, the 90th percentile of the stored game's gap, % of the pot), against 4 + 2.75 ln(pot):

| Decision | 6-max 100bb (again) | Heads-up 100bb | Heads-up 20bb | 3-max 100bb | The curve |
|---|---:|---:|---:|---:|---:|
| First in (1.5bb) | 4.7% | 7.6% | 5.7% | 6.0% | 5.1% |
| Facing an open (4bb) | 7.8% | 15.7% | 6.5% | 11.6% | 7.8% |
| Facing a 3-bet (13bb; 23bb at 20bb) | 11.9% | 12.2% | 2.9% | 16.3% | 11.1% |
| Facing a 4-bet (33bb) | 14.1% | 9.9% | - | 7.0% | 13.6% |

(Plays at mixed hands: 536, 1,703, 212 and 26 at 6-max; 1,943, 827, 141 and 29 heads-up at 100bb; 3,875, 246 and 28 at
20bb; 592, 94, 89 and 12 at 3-max.) At 20bb heads-up the curve fits; at 100bb the gap is 1.5 to 2 times it. But most of
the heads-up verdicts aren't at mixed hands: of the 1,742 Mistakes and Blunders at 100bb, 1,209 (69%) are at hands the
charts play 85% or more one way, where the stored game plays them another. It raises 32o, 42o and 43o first in where the
charts fold them (by 0.11-0.20bb), raises 65o and 54o where they limp, and limps QTo and 92s where they raise; its small
blind raises 52% and limps 41% where the charts raise 59% and limp 30%. Scaling the noise doesn't reach that: twice the
curve still leaves 2.4% Mistake or Blunder at 100bb (three times, 0.8%).

**The rule.** A grade by the heads-up preflop solve can't condemn a line (`web/src/grading/grade.ts` `HEADS_UP_PF`, read
off the answer's `players` by `grading/basis.ts` `basisOf`): past the noise it stops at Inaccuracy, the EV lost shown as
measured, and says "The heads-up preflop solve often parts from the published solves' charts, by more than its noise, so
it can't condemn a line"; a clear blunder (20% of the pot or more past the noise) is still a Blunder, so folding aces
first in still is. Every surface that grades a preflop-solve answer passes the answer in (Practice, the preflop and live
drills, Review's retries, Analyze). The same 30,000 hands:

| Table | Best | Correct | Inaccuracy | Mistake | Blunder | Mistake or Blunder |
|---|---:|---:|---:|---:|---:|---:|
| Heads-up 100bb | 75.3% | 15.0% | 9.6% | 0.0% | 0.1% | 0.12% |
| Heads-up 20bb | 80.3% | 13.8% | 5.9% | 0.0% | 0.0% | 0.00% |

The sweep's `--pf-agree` (every class at nine spots through the Practice path, the chart's most played move graded by
the solve; `docs/QA.md`, "Preflop: the chart against the solve") by combos, before and after both fixes. The heads-up
rows now have no Mistake or Blunder; by each class's loss past the noise, without the cap, they would have 9.4% (100bb
small blind: 92o's raise 14% of the pot past the noise, QJs's limp 11%, 43o's fold 8.5%), 2.3% (100bb big blind: 77's
3-bet, 14%), 0% and 1.7% (20bb). 3-max and 6-max are as they were, up to the 6-max small blind's 3.6% (98o, T8o and 87o
folded where the solve raises, A2o raised where it folds; 0.11-0.18bb).

| Spot | Below Correct, before → now | Mistake or Blunder, before → now |
|---|---:|---:|
| Heads-up 100bb, SB first in | 16.4% → 12.5% | 14.0% → 0.0% |
| Heads-up 100bb, BB facing a raise to 3 | 2.7% → 2.3% | 2.7% → 0.0% |
| Heads-up 20bb, SB first in | 3.9% → 3.6% | 0.6% → 0.0% |
| Heads-up 20bb, BB facing a raise to 3 | 2.6% → 2.6% | 1.7% → 0.0% |
| 3-max 100bb, BTN first in | 2.7% → 2.7% | 0.9% → 0.9% |
| 6-max 100bb, four spots | 0.5-3.6% → 0.0-3.6% | 0.0-3.6% → 0.0-3.6% |

**Not established.** 3-max 100bb is not capped: its chart play is a Mistake or Blunder 1.3% of the time (12,274
decisions), twice 6-max's and a fifth of heads-up's, and its mixed-hand gap is 1.2-1.5 times the curve on under 100
plays facing an open or a 3-bet. 4 and 5 players and other depths are unmeasured. The tournament presets' heads-up
answers (`engine/pf_icm_study.py`) are capped the same way without a measure of their own. Heads-up chart play is now
graded Inaccuracy one decision in ten at 100bb: what the heads-up model says is shown, not counted against you.

**Measured again on the no-rake charts; the cap holds at every depth (later 2026-11-18) [M].** The tables above were
taken before the charts moved to no rake where the game has none (section 18.9) and jam ranges followed the advice's
own jams. The same 30,000 hands of chart play each (`scripts/pf_practice_coverage.py --policy chart`, seed 20261105,
the chart's own sizes where they're the solve's; the script now also counts each verdict without the heads-up cap):

| Table | Best | Correct | Inaccuracy | Mistake | Blunder | Mistake or Blunder | EV lost a decision |
|---|---:|---:|---:|---:|---:|---:|---:|
| Heads-up 20bb | 82.6% | 13.0% | 3.5% | 0.8% | 0.0% | 0.8% | 0.0158bb |
| Heads-up 20bb, 5% capped at 3bb | 87.4% | 11.0% | 1.3% | 0.3% | 0.0% | 0.3% | 0.0109bb |
| Heads-up 25bb | 77.2% | 17.4% | 3.0% | 2.2% | 0.2% | 2.4% | 0.0197bb |
| Heads-up 30bb | 71.8% | 14.3% | 5.3% | 5.3% | 3.3% | 8.6% | 0.0288bb |
| Heads-up 40bb | 81.7% | 12.5% | 3.0% | 2.1% | 0.6% | 2.7% | 0.0329bb |
| Heads-up 60bb | 78.1% | 13.5% | 4.6% | 2.4% | 1.4% | 3.8% | 0.0282bb |
| Heads-up 100bb | 77.4% | 14.2% | 2.3% | 5.1% | 1.0% | 6.1% | 0.0383bb |
| 3-max 100bb | 93.5% | 4.8% | 0.8% | 0.8% | 0.1% | 0.9% | 0.0175bb |
| 6-max 100bb (charts' sizes) | 93.6% | 5.7% | 0.3% | 0.3% | 0.1% | 0.4% | 0.0136bb |

(Without the cap; the 3-max and 6-max rows have none.) With the cap, every heads-up row has no Mistake, and Blunders,
clear ones (20% of the pot or more past the noise), on 0.5% of 30bb decisions, 0.2% at 60bb, 0.1% at 100bb and none at
20, 25 or 40bb.

By its rate, heads-up 20bb (0.8%, 0.3% raked) is 3-max's (0.9%), which isn't capped, so the cap was tried there off
(only deeper than 20bb, by the answer's depth). It was put back: at 20bb what the solve condemns is still the chart's
main move at hands the charts play one way. The sweep's `--pf-agree` (`docs/QA.md`) found three, all the big blind
facing a raise to 3: A9o calling (the chart's 97%) where the solve shoves, 0.45bb; 77 calling (98%) where it shoves,
0.42bb; KQs shoving (100%) where it calls, 0.43bb: 1.7% of the hands dealt there. The matrix's 2max-20bb hand 3 is the
A9o, graded a Mistake with the cap off: the one grade the change moved in that config. Nothing says the solve is right
there over the charts, so the grade would condemn the chart's own advice on a disagreement of two models, which is what
the cap is for. 3-max's rate stays a question of its own (above). Not measured: 50, 80 and 125 to 200bb heads-up.

### 18.11 Where the charts and the solve part (2026-11-18)

Practice graded four 6-max 100bb chart moves as Mistakes by the stored preflop solve (lz3_6max_100bb_blind_3bet4,
no rake, the charts' sizes): the small blind first in raising A2o (the chart's 100%) and folding 87o (71%), and the big
blind over a button open to 2.5 3-betting AJo and A5o (60% each). The solve folds A2o (its raise -0.145bb), raises 87o
(+0.114bb), and calls AJo (1.357bb against the 3-bet's 0.893) and A5o (0.236 against -0.169).

**Why the solve parts there [M].** Not the charts: they agree with `solver/tests/preflop_refs.py` (A5o 3-bets 40-90%
there, AQs, AKo and JJ+ always). The small blind's pair comes of `advisor._river_fix`, a hand-shape term (offsuit
non-connectors -0.05, suited +0.10, connectors to J-high +0.15, 22-66 +0.10, times equity) applied to single-raised
pots' flop values at r1 = 0.626. It sets 87o above A2o, and nothing measured settles which is right (the full
reference's small blind limps, so its A2o at 0% is limp-or-fold, not a fold over a raise). The big blind's pair is a
defect of the flop model. r2 = 0.734 applies the same term to the 3-bet pots' library values, which were solved with
the river dealt, so the river counts twice. The term goes on both players' targets, so `LibraryModel._solve_ac`, which
fits the caller exactly, charges the surplus to the 3-bettor as a flat -0.026 of the pot. A re-solve of the big blind's
subgame with r2 = 0 takes AJo's gap from 0.46bb to 0.03 and A5o's from 0.40 to 0.24 (most of the rest is ext=2's low
A6o-A9o, which s2's smoothing pulls A5o down with). Ruled out: the button 4-betting too much (10.1% of its range, the
published 10.3%) and missing blockers (rank-level card removal is in `PAIR_COMPAT`).

**How wide [M].** A sweep graded the chart's most played move by the solve for every class at every first-in node and
at the blinds facing one open, in 14 stored games: 6-max 20, 40, 100 and 200bb at the charts' sizes, and 3- to 5-max
100bb, each raked and not, 20,280 class-spots in all. It found a Mistake or Blunder at 133 of them, 70 of those at
hands the charts play one way. The largest group, 50 hits (23 without rake, 27 raked), was the 20bb small blind facing
an open: the chart flatted 99, 88, AQo and AJs where the solve jams. That one was the charts' bug (below).

**A model fix, tried and not shipped [M].** One variant replaced the river term with the library's measured correction
(river dealt minus blind, 1,755 `srp_btn_bb` flops) and smoothed only classes in range. It fixed three of the four
classes (AJo stays a Mistake, at the boundary), but doubled 6-max 100bb's hard hits (8 to 16): the big blind over a CO
open 3-bet J9s, T9s, 98s and 87s pure where the chart calls 60-80%. It also took the 3-bet hand order from 3 hands out of
order to 7-8. That fix waits for a later model, which must be no worse in any of the 14 games.

**The rule.** A grade by the preflop solve can't condemn a move the charts play 10% or more at the same spot (MIX, at
the page's 0.1% precision). Past the noise the grade stops at Inaccuracy, the EV lost is shown as measured, and the
words say the charts (not a solve) play it N% and the solve M%: "they part here by more than the solve's noise, and
nothing here settles which is right" (`web/src/grading/grade.ts` `CHART_PARTS`). A clear blunder (20% of the pot or more
past the noise) is still a Blunder, and the heads-up cap (18.10) comes first. It counts only the charts or push/fold
(`CHART_SOURCES`): a rules or equity fallback isn't chart play. A tournament's prize-equity answer and the solve's own
sizes (`pfOptions`, the ICM presets) have no chart beside them. The charts' frequencies travel in the grade's basis on
every surface that grades by the solve:
- Practice, lined up by move and size, a jam only with a jam (`pfGrade.ts` `chartFreqs`).
- The preflop drill, which asks the chart once per node (`PreflopDrill.tsx`).
- Review's retries, matched by action name (`mistakes.ts` `retried`).
- Analyze.

The QA sweep counts the capped grades as `pf.parts` (soft), and `pf.chart` (hard) fires where a surface lost the
chart or the cap didn't hold (`docs/QA.md`). Tests: `gradeAnswer.test.ts`, `pfGrade.test.ts`, `checks.test.ts`,
`DrillsPanel.test.tsx`.

**The 20bb small blind's flats: the charts' own bug [M].** At short stacks a raise becomes a jam drawn from the
push/fold equilibrium, with the hand's flat as the alternative it must beat (`advisor._flat_ev`, section 26). That flat
was weighed by how often the chart continues, raise share included. So a hand the chart only 3-bets counted a flat's EV
it never plays, and the equilibrium jammed other hands in its place. In the stored 20bb game, 99 over a CO open jams for
2.765bb against the call's 1.343, yet the chart flatted it. Now the flat is weighed by the chart's call share alone
(`engine/pf_charts.py` `flat_ev`, installed over `advisor._flat_ev`; nodes that feed a published library spot keep
upstream's). For a hand the chart raises and never flats, the jam is weighed against folding (what the jam doesn't
take still calls, below). Over CO and BTN opens, 99, 88, AQo and AJs
now jam, and A9o over a BTN open goes from jamming 56% to folding 98%, which the solve agrees with (its jam -0.038bb).
Tests: `scripts/engine/test_pf_charts.py` `FlatAlternative`.

Class-spots it moved:

| Games | Moved | Moved by 0.25+ |
|---|---:|---:|
| 20bb, no rake | 150 | 89 |
| 20bb, raked | 192 | 129 |
| 40bb, no rake | 63 | 35 |
| 40bb, raked | 79 | 50 |
| 100bb, 200bb and 3- to 5-max | 0 | 0 |

At 20bb, by combos, the chart's mix gives up less against the solve: 0.448 → 0.385% of the pot without rake and
0.436 → 0.287% raked. The share of the mix graded Mistake or Blunder falls from 1.11% to 0.82%, and from 0.87% to 0.51%
raked. At 40bb the solve's tree 3-bets to a size where the charts jam, so nothing grades the jam there. Read as the
solve's 3-bet, the moved mixes give up less as well:

| 40bb | EV given up, % of the pot | Better by 0.5%+ of the pot | Worse by 0.5%+ |
|---|---|---:|---:|
| No rake | 2.85 → 1.53 | 36 | 9 |
| Raked | 2.97 → 1.22 | 39 | 8 |

An example from the small blind over a 40bb CO open, where the chart 3-bets A5s-A3s and folds A6s. The old weighting
flatted A5s-A3s, which the chart never calls, and jammed A6s 95%. Now A5s-A3s jam 94-95% and A6s folds (the solve calls
it there; the chart's fold costs 3.9% of the pot, one of the 9 worse).

**The implied odds, tried twice and kept [M].** `_flat_ev` sets the flat's realization so the chart's weakest flats
(the bottom 5% by equity) break even, then adds implied odds on the stack behind: 6% of it for 22-99, 3% for suited
hands below the broadways. At the 20bb small blind the weakest flats are those same hands, so their implied odds count
twice. Two changes were measured over the 20bb and 40bb games (no other game moves):
- No implied term. The small blind then jams 77 and 66 over a button open, as the solve does, and 20bb chart play past
  the noise falls (0.057% to 0.047% of the pot without rake, 0.055% to 0.046% raked). But the big blind's weakest
  flats are offsuit hands with no implied weight, so it lost odds it had earned: it jams 22-66, A2s and K8s where the
  solve calls. The chart's mix then gives up more without rake (0.385% to 0.398%), and at 40bb the moved mixes, read
  as the solve's 3-bet, give up more too (1.96% to 2.70% without rake, 1.56% to 1.96% raked).
- The realization set with the weakest flats' own implied odds counted. Better at 20bb (0.385% to 0.375%, and 0.287%
  to 0.279% raked) and at 40bb without rake (1.38% to 1.23% over the 39 class-spots it moved). Worse at 40bb raked:
  1.34% to 1.72% over 21, with 3 worse by 0.5% of the pot or more and none better.

Neither is better in every game, so the flat keeps upstream's implied odds.

**What the jam doesn't take [M].** Upstream's `_push` serves the share of the chart's continuing range that doesn't jam
as a call, and the fix leaves that alone. So a hand the chart only 3-bets, whose jam the equilibrium now weighs against
folding, is still served as a flat where the jam loses. Over a 20bb HJ open without rake, A2s, A3s, A5s, 65s, 76s, 98s
and T9s flat 100%; A4s flats 64% and jams the rest, and AJo flats 93%. The solve has those flats inside its noise there
(A2s's is -0.207bb against folding, the noise 0.31bb). A4s's mix is one neither model would play alone: its jam share
is where the equilibrium has jamming level with folding, while upstream's flat EV for it is positive. The solve has
A4s's jam level with folding (-0.002bb) and its flat at -0.124bb, so the mix gives up less than upstream's 100% flat.
A review (2026-11-19) found that this file and `engine/pf_charts.py` had said such hands fold. Two ways to fold that
share were measured over the 20bb and 40bb games:
- The call held to the chart's call share, the rest folding. Worse in three of the four. At 20bb without rake the
  chart's mix gives up 0.385% → 0.409% of the pot, and Mistake or worse goes from 0.82% to 1.06% of the mix (AJo over
  a HJ open folds 93%, where the solve jams it for +0.558bb). At 40bb, read as the solve's 3-bet, 1.64% → 1.89% of the
  pot, and 0.70% → 1.06% raked. 20bb raked is about even (0.287% → 0.293%).
- Only the combos the equilibrium never jams folding. Better at 20bb raked: the small blind's 33, 44, 55, 76s, 87s and
  T9s flats over CO and button opens stop being hard hits, and Mistake or worse goes from 0.51% to 0.48% of the mix.
  Better at 40bb: 2.26% → 2.19%, and 0.55% → 0.51% raked. Worse at 20bb without rake: 0.385% → 0.393%, and 0.82% →
  0.96%.

Neither is better in every game, so the rest still calls. Count the 20bb class-spots where the served call takes 5% or
more from the chart's raise share: 144 without rake, 131 raked. The solve grades none of those calls Mistake or worse
without rake, and 8 raked, at 2.1-3.4% of the pot past the noise:
- QTs over a HJ open (the advice's 10%).
- 44-66 and 76s over a CO open.
- T9s, 87s and 76s over a button open.

Where the advice plays them 10% or more, the cap shows them as Inaccuracies, though the chart itself only 3-bets those
hands.

**The sweep after both.** Hard hits fell from 133 to 119 with the flat fix (20bb: 23 → 18 without rake, 27 → 18
raked; the other games as they were). With the cap, 3 remain, down from 12 before the flat fix: all clear blunders, all
the raked 20bb small blind flatting a pair where the solve jams:

| Hand | Opener | The chart's call | Past the noise |
|---|---|---:|---:|
| 99 | UTG | 75% | 25.2% of the pot |
| 77 | HJ | 100% | 20.0% |
| 77 | BTN | 90% | 29.2% |

The chart's top move is graded Inaccuracy instead of Mistake at 128 class-spots.

**Practice, measured [M].** `scripts/pf_practice_coverage.py` plays 6,000 seeded 6-max hands per game through the
Practice path. Every seat plays the charts at the charts' sizes, and each decision the stored solve can grade is graded.
Its new `--upstream-flat` switch plays the flat as upstream's, for the charts before the flat fix. The table gives the
share of those decisions graded Mistake or Blunder, with neither change, each alone, and both:

| Game | Neither | The cap alone | The flat fix alone | Both | EV lost per decision |
|---|---:|---:|---:|---:|---|
| 20bb, no rake | 0.9% | 0.0% | 0.5% | 0.0% | 0.0155 → 0.0117bb |
| 20bb, raked | 0.3% | 0.1% | 0.2% | 0.0% | 0.0128 → 0.0112bb |
| 40bb, no rake | 0.8% | 0.1% | 0.8% | 0.1% | 0.0087 → 0.0088bb |
| 40bb, raked | 0.7% | 0.0% | 0.6% | 0.1% | 0.0116 → 0.0117bb |

At 40bb the flat fix changes no graded decision: the spots it moved are those where the solve's tree 3-bets to a size
and the charts jam, which the solve doesn't grade. What stays is Blunders: clear ones, or moves the charts play under
10%. Of the chart's own most played move, the solve graded these Mistake or worse:
- 20bb without rake: 2 of 4,813 before (the small blind flatting 99 over a CO open, the chart's 97%), and 1 of 4,733
  after. That one is the big blind calling 44 (the chart's 100%) after a button open and a small blind call, 1.75bb.
- 20bb raked: 5 of 4,678 before (88 and 99 flatted over CO, HJ and UTG opens) and 2 of 4,706 after (99 over a UTG
  open, the chart's 75%).
- 40bb: none of about 4,300 in either game, before or after.

The script lacked Practice's untrained-move rule (`pfGrade.ts` `untrainedMoves`, section 18.9) until now, so its
counts before 2026-11-19 graded those moves by their untrained EVs. At 6-max 40bb the HJ's 3-bet over a UTG open is
-7.5bb for every class, AA's included. That alone gave 8 Blunders of the chart's main move in 4,489 decisions, and
0.0279bb lost per decision instead of 0.0088. Practice never graded them so: it grades that node by the chart. Its
untrained nodes are 9.9% of 20bb decisions (9.4% raked) and 4.4% at 40bb (1.1% raked). None of the 222 nodes of the 14-game
sweep above has an untrained move, so its counts stand.

`node scripts/qa/run.mjs --pf-agree` now covers 14 spots and adds a column for the grades the cap stopped. It finds no
hard `pf.follow` or `pf.chart`, so it exits 0 (it exited 1 on the four 6-max classes before). The capped grades are
listed below.
- 6-max 100bb: the small blind's A2o and 87o, the big blind's AJo and A5o over a button open, the small blind's AQo over
  a UTG open, and the big blind's A8s and KJo over a small blind open: 0.11-0.64bb.
- The 20bb small blind over a button open: 77-44 flatted where the solve jams, 0.43-1.11bb.
- The 40bb small blind first in: seven classes, 0.12-0.31bb. It folds T8o, 98o and 87o where the solve raises, and
  raises 73s, 63s, 85o and K4o where the solve folds.
- The 200bb small blind first in: A2o and 87o again.

The heads-up spots have none.

**Not established.**
- The model's river term stays: the solve still calls AJo and A5o and folds A2o, and the grades say so as
  Inaccuracies. The fix (no river term on river-dealt spots, a term that sums to zero, a clamp on ext=2's edge) is a
  model change: a new model tag and a rebuilt grid, behind the 14-game no-worse gate.
- The 20bb small blind still flats small pairs where the solve jams. Over a button open that is 77-44 without rake
  (capped Inaccuracies). Raked, it is 99 over a UTG open and 77 over HJ and button opens, clear blunders at 20-29% of
  the pot past the noise. The doubled implied odds above are one cause (without them 77 and 66 jam), but removing them
  moves the big blind the wrong way. A fix that separates the two seats is not measured.
- The cap takes the charts' word that a move is played. The charts are themselves approximate, so a capped Inaccuracy
  can be the charts' error rather than the solve's. At a short stack the word is the advice's: a flat the jam left over (above) counts as
  the charts', though the chart itself only 3-bets the hand.
- 40bb is checked only by reading the jam as the solve's 3-bet.

### 18.12 The grade at the charts' raise sizes, unequal stacks in Analyze, a straddle from any seat, 5bet rules (2026-11-22)

Every figure here is of the `lz4` model (section 31). The work was first measured on `lz3` on 2026-11-17 and measured
again on lz4 after it landed, so lz3 figures appear only where they are named as such.

**The charts' whole raise rule [V].** Section 18.5 stored the 6-max games at the charts' 3bet size only (a blind's
3bet to 4x the open). The grade then still refused most decisions after a 3bet, because the charts size the rest
differently from the tree too (`gto/advisor.py` `_default_size`):
- a cold 4bet adds the opener's chips: 20bb over an open and a 3bet to 7.5bb, where the tree's is 17.25bb;
- a squeeze adds a caller's chips beyond its blind: 12bb, not 12.5bb;
- every size goes to the half big blind: 17bb, not 17.25bb.

The tree now takes the whole rule (`engine/pf_engine.py` `build(sizing="chart")`, `pf_tree {"sizing": "chart"}`, key
suffix `_ch`, its words in the label and `pf_limits`). Test `test_chart_sizes_are_the_charts` walks 40 raise nodes
each at 6-max 100bb and 200bb, 5-max 40bb and heads-up 100bb, and asks the charts (`Advisor.advise`) at each. Every
raise is theirs to the cent, and every all-in is where they go all-in.

The grid is stored at those sizes at 2 to 6 players: 11 depths, no rake and 5% capped at 3bb, 110 games
(`engine/pf/lz4_*_ch.bin`). Each ran 1,500 iterations through slot.sh, 3,726 s in all, 996 KB. The farthest is 1.236
mbb/hand a seat (`lz4_5max_50bb_ch`). They replace the 22 `_blind_3bet4` files. Practice's and Analyze's grade asks
for them in every cash game of 2 to 6 players (`pfStored.ts` `pfGradeSizes`, `pfChartKey`). Study's Solver source
keeps the tree's own sizes, which are the published solves'.

`scripts/pf/build_stored.py --missing` had the flaw section 31 found in the tournament builder, in another form: it
skipped a game whose file existed. The key names the model tag and every tree option, so a game on another model or
table already got its own file; but a tree rule changed under the same key (as the charts' raise rule did while this
was built) left the old file standing. It now reads the file's header (`PFS1` and the tree's decision count) and
rebuilds a file that isn't its game's tree.

A crash found on the way. With unequal stacks and the charts' sizes, a raise could follow three all-ins. The
showdown evaluator takes three players at most, so four all-in crashed it ("2 is not in list" in `_prep_terminals`). A
raise is no longer offered over three all-ins, as a call's cap already had it. Test `test_no_raise_over_three_all_ins`
covers two unequal tables, sizes the tree's and the charts', and checks the 6-max 100bb chart tree still has 5,091
nodes.

**What it answers [V]** (`scripts/pf_practice_coverage.py --chart-sizes`, playing the charts, 6-max 100bb, 30,000
hands a run; before is lz4's `_blind_3bet4` games at b3ace5f):

| | No rake, before | No rake, `_ch` | 5% capped at 3bb, before | 5% capped at 3bb, `_ch` |
|---|---:|---:|---:|---:|
| Decisions answered | 92.3% | 98.2% | 93.2% | 98.9% |
| Facing an open | 97.4% | 99.5% | 99.0% | 100.0% |
| Facing a 3bet | 20.3% | 83.2% | 23.6% | 88.2% |
| Facing a 4bet | 22.3% | 67.0% | 25.0% | 72.9% |
| Facing a 5bet or more | 20.0% | 44.4% | 30.2% | 72.1% |
| Lowest seat | BB 77.8% | BTN 96.5% | BB 81.9% | CO 98.0% |
| Hands holding a decision it can't grade | 2,324 (7.9%) | 541 (1.84%) | 2,060 (7.0%) | 345 (1.17%) |
| EV lost per graded decision | 0.0133bb | 0.0193bb | 0.0119bb | 0.0150bb |

Before, most misses were sizes (no rake: 1,822 own-size, 221 line-size). After, none is. Without rake, 300 decisions
are a move the solve never trains (section 18.9's rule leaves them to the chart: 289 of them a raise, 258 facing a 3bet,
such as the CO's cold 4bet over UTG's open and the HJ's 3bet, which the solve never makes and prices as folding to
whatever comes next), 146 a class the
solve's range never holds there, 56 an option the tree lacks (a call where the tree has only a raise or a fold), 39 a
line the solve rarely reaches. On lz3 these figures were 99.2% answered and 0.83% of hands; the gap is section 18.9's
untrained-move rule, which came after that measurement and now refuses those 4bets instead of grading them by an EV
nobody trained. The EV lost per decision rises because the newly graded decisions are 3bet and 4bet pots, where the
charts and the solve differ most. Playing every option evenly answers 90.2% (7.8% of decisions are classes the solve
folds earlier). Playing the solve's own mix answers 98.8%.

At 2 to 5 players (10,000 hands each, playing the charts, no rake, 100bb):

| Players | Answered | Facing a 3bet | Facing a 4bet | Hands with a decision it can't grade | EV lost a decision |
|---|---:|---:|---:|---:|---:|
| 2 | 97.8% | 74.4% | 67.5% | 234 of 9,595 (2.4%) | 0.0419bb |
| 3 | 99.3% | 92.9% | 74.2% | 62 of 9,035 (0.69%) | 0.0315bb |
| 4 | 99.2% | 93.8% | 71.4% | 77 of 9,509 (0.81%) | 0.0255bb |
| 5 | 99.0% | 91.2% | 76.6% | 97 of 9,717 (1.0%) | 0.0221bb |

None of the misses is a size: they are classes the range never holds there, options the tree lacks, lines the solve
rarely reaches, and at 4 and 5 players a few untrained moves (4 and 24). Heads-up misses more: 4.0% of decisions facing
an open and 25.6% facing a 3bet, all classes the solve's range doesn't hold there. These figures are what Practice's
form now says at each table size ("about 1 hand in 40" heads-up, 145 at 3 players, 125 at 4, 100 at 5, 55 at 6;
`SetupForm.tsx` `PF_UNGRADED`). Before this the grade read the tree's own sizes at 2 to 5 players, which this script
doesn't measure, so there is no before column.

**What the charts' sizes cost against the published solves [V]** (`scripts/pf/measure_tree.py --chart`, 700
iterations at the references' 5% capped at 4bb, scored as section 18.4):

| Game | Mean error | Spots out | Facts off | mbb/hand |
|---|---:|---:|---:|---:|
| The tree's own sizes (lz4) | 1.96 | 5/26 | 11 | 0.92 |
| The charts' sizes (lz4) | 2.84 | 8/26 | 11 | 1.30 |
| The charts themselves (section 31) | 1.14 | | | |

As in section 18.5, the rise is where the two games are different spots. The worst are the opener facing a blind's 3bet
(10bb in the charts' game, 12bb in the references): BTN vs SB 8.3 points (2.5 in the tree's own game), BTN vs BB 7.3
(3.0), CO vs BB 4.4 (2.3). Then UTG vs the BTN's 3bet at 7.4 (5.2), where the 4bet behind it is 17bb against 17.25bb.
So the grade's games are further from the published solves than Study's, and the charts stay the default (target 5 of
the plan changes nothing). Both are labelled the class-level model, approximate, after a 3bet with section 18.7's
reason. (On lz3: 2.90 for the charts' sizes, 2.01 for the tree's own, the charts 0.96.)

**Unequal stacks in Analyze's grade [V].** A site's hand is rarely at a stored depth with equal stacks, and Analyze had
graded those by the charts only. Three ways were weighed:
- solve each hand's own stacks live (Lizard's solver takes them): about 30 s to 5 minutes a hand at 6 players, too slow
  for a history import;
- read the stored game at the hero's own stack: wrong whenever a covering or covered opponent changes the spot;
- read the stored game nearest every live seat's effective stack, and only where all of them are near it.

The third is built (`web/src/features/analyze/grading.ts` `pfDepthAt`). At each decision:
- the seats still in are those not folded before it;
- each one's effective stack is its own or the deepest other live stack, whichever is smaller;
- the stored game is the depth nearest the hero's effective stack, by ratio;
- the deviation is the largest |effective / depth − 1| over the seats still in.

At 15% or less (`PF_DEPTH_TOL`) the decision is asked of that game, as equal stacks at its depth. Each move is still checked against
the hand's real chips, so an all-in for less or a raise the game sizes differently is refused, not misread. Past it the
chart grade stays and says why, naming the nearest depth and how far off which seat is. A grade made this way says so
in its note ("read against the stored 80bb game, the nearest your stacks: you have 87bb effective, and every seat still
in is within 9% of 80bb"), and the record keeps the depth (`pfDepth`). Practice is unchanged: it deals equal stacks at
a stored depth, so its grade is the exact game.

The tolerance is measured (`scripts/pf_depth_tolerance.py`). Each test table was solved at its own stacks, natively at
the charts' sizes and 1,500 iterations like the grid (0.80 to 1.05 mbb/hand a seat on lz4). Then 3,000 hands were played on
it with the charts' mix and 3,000 with every option evenly, and each decision was graded both by its own solve and by
the nearest stored game read as Analyze reads it. The tables, UTG to BB:
- equal at 89, 110, 69, 35 and 170bb (each between two stored depths);
- 100/90/110/100/85/120;
- one short seat (UTG 40, the rest 100);
- one deep seat (UTG 200);
- a short big blind (BB 60);
- 70/130/100/80/120/100.

By each decision's deviation, decisions both ways could read (the charts' mix / every option evenly), lz4:

| Deviation | Decisions | Same verdict | Two or more classes apart | Mean \|EV lost diff\| | p95 \|EV lost diff\| |
|---|---:|---:|---:|---:|---:|
| 0-5% | 6,356 / 6,221 | 98.4% / 97.9% | 0.6% / 0.7% | 0.003 / 0.042bb | 0.005 / 0.073bb |
| 5-10% | 3,458 / 3,338 | 98.2% / 98.0% | 0.7% / 0.4% | 0.004 / 0.061bb | 0.006 / 0.101bb |
| 10-15% | 14,212 / 14,058 | 98.1% / 97.5% | 0.9% / 0.8% | 0.003 / 0.036bb | 0.006 / 0.111bb |
| 15-20% | 675 / 672 | 98.8% / 98.2% | 0.6% / 0.1% | 0.002 / 0.067bb | 0.002 / 0.200bb |
| 20-30% | 773 / 812 | 96.9% / 95.8% | 1.6% / 1.2% | 0.004 / 0.101bb | 0.012 / 0.234bb |
| Over 30% | 4,717 / 4,628 | 98.8% / 97.2% | 0.5% / 0.9% | 0.002 / 0.076bb | 0.000 / 0.175bb |

The stored game could not read 0.3% to 1.0% of decisions in the buckets up to 15%, mostly an all-in whose chips differ
from the stored game's (91 of them at 35bb against the 40bb game, playing the charts).

**The tolerance stays 15% [I].** Up to 15%, the stored game's verdict matches the table's own solve on 97.5 to 98.4% of
decisions, about as often as at 0-5%. Past 15% the lz4 figures are less one-sided than lz3's were (on lz3 the 15-20%
bucket's mean EV gap was 5 to 8 times the 10-15% one). Playing the charts, 15-20% agrees as well as below it (98.8%,
0.002bb). Playing every option evenly, the mean EV gap is 1.8 times the 10-15% figure (0.067 against 0.036bb) and so is
the p95 (0.200 against 0.111bb). From 20% to 30% both ways get worse: verdicts agree on 96.9% and 95.8%, with the
largest two-class shares and p95 gaps in the table. The 15-20% bucket is small (675 decisions), so the data doesn't argue
for 20% clearly enough to widen the tolerance; 15% stays. The over-30% bucket agrees well again. Those decisions come from the tables with one short seat (UTG 40, BB 60) while that seat
is still in, and from the most uneven table (70/130/100/80/120/100). Many are likely opens with the far-off seat yet
to act, which it barely changes. The script doesn't break this down, so that is a guess. A rule that weighed only the seats that can still change the decision might admit them.
That isn't built.

Two more things the tables show:
- With UTG at 200bb and the rest at 100bb, every decision falls in the 0-5% bucket, since UTG plays 100bb effective.
  The deep seat costs nothing.
- While a short seat is in, the rule refuses the decision. A site's table with one short stack will often keep the
  chart grade until that seat folds.

These are verdict agreement and EV gaps between two class-level solves. The stored grid's own error, against a fuller
solve, is on top of them.

**A straddle from any seat [V].** `pf_tree {"straddler": "BTN"}`, with a straddle in the setup, or `straddle: "BTN"`
in the request. The straddler posts 2bb and acts last before the flop (a Mississippi straddle). The first to act is the
seat after the big blind, and an open is 2.5x the straddle. Key suffix `_s{POS}`, words in the label and `pf_limits`.
On the first seat it is the old straddle exactly (same key, same tree), and the blinds can't straddle. Test
`test_straddle_from_any_seat` covers the action order, folding to the straddler, the sizes, and convergence: both of
its games stay under 1.5 mbb/hand a seat in 1,500 iterations (`test_pf_engine.py`, 43 tests OK on lz4). Study's
Tree form doesn't offer it. Its table and the charts play the first seat's straddle only, so a node shown from another
seat's tree would not match the table it is shown on. A request can ask for it.

**5bet rules [V].** `pf_tree {"five": ...}`, Study's Tree form ("5bet": all-in, none, or a raise times the 4bet), and
`pfs=5x:0` or `5x:2.2` in the link:
- unset or `"jam"`: the 5bet is all-in, as before (no new key);
- `"none"`: facing a 4bet, call or fold;
- a number from 1.8 to 3.5: a 5bet to that many times the 4bet, then the 6bet all-in.

A 5bet pot's flop is valued as a 4bet pot's. Key suffix `_5x{v}`, words in the label. Test `test_five_bet_rules` checks
the deepest raise count (4 with the default, 3 with none, 5 sized at 3-handed 200bb) and the size of every 5bet, and
both games converge under 1.5 mbb in 1,500 iterations (passing on lz4). `pfSolve.test.tsx`
covers the form and the link. No published solve has a sized 5bet, so neither rule is measured against one.

**The limp trees [V].** `scripts/pf/measure_limps.py`, 1,500 iterations, lz4:

| Game, spot | Lizard (lz4) | Published |
|---|---|---|
| 6-max 100bb, 5% capped at 4bb, the SB may complete: SB folded to | raise 41.7, limp 7.7, fold 50.6 | gtopreflop raise 43.4 / limp 2.3; thinkgto raise 33.1 / limp 20.5 |
| the same, BB facing the complete | raise 44.4, check 55.6 | none |
| the same without the complete (the stored tree): SB folded to | raise 45.7, fold 54.3 | raise-only solves 43.5 |
| Heads-up 50bb, 0.12bb ante, no rake: SB first in | raise 56.0, limp 39.8, fold 4.2 | GTO Wizard raise 64, fold 4 (limp about 32, derived) |
| the same, BB facing the limp | raise 46.6, check 53.4 | GTO Wizard raise 34 |

What this shows:
- The two published 6-max solves disagree by 18 points on the small blind's limp, so there is no single figure to meet.
  Lizard's 7.7% limp sits between them, nearer gtopreflop's, with the raise share 1.7 points under gtopreflop's.
- The complete costs the rest of the tree a little: the 26-spot score is 2.16 points with it (10 of 26 out) and 2.02
  without (8 of 26 out), 9 facts off either way, both at 1,500 iterations, 0.39 mbb/hand a seat.
- Heads-up, the fold share matches, but Lizard limps about 8 points more and raises 8 less than GTO Wizard. Its big
  blind raises over a limp 12.6 points more often (46.6% against 34%).

That big blind's raise is the largest miss. The 26 spots the flop values were calibrated to (section 18.4) hold no
decision inside a limped pot, so a limped pot's value is among the model's least supported [I].

**Opens by position.** No published solve or chart set found gives a game whose seats open different sizes. The 26
reference spots (`solver/tests/preflop_refs.py`) all open 2.5bb from every seat but the SB's 3bb. So that tree is not
measured against any reference. The 6-max 100bb tree with limps from every seat needs about 2.1 GB, over this
machine's 1 GB a process. Only the small blind's limp has published shares, so that tree isn't measured either.

**The class-level model** is section 31's `lz4` (1.96 points in sample; held-out error not measured again). The rows stay
APPROXIMATE.

**Checked on lz4:** `test_pf_engine.py` (43 tests) and `test_pf_stored.py` (4) OK; `test_pf_offpath.py` quick and with
`PF_OFFPATH_ALL=1`; the full vitest suite; the e2e steps changed for the `_ch` files (7g, 7h, 7j in `e2e/qa.e2e.ts`, and
the "both boxes ticked" step of `e2e/checks.e2e.ts`) against a built preview. The untrained-move fixture
(`pf_untrained.json`, `scripts/pf/untrained_nodes.py`) was rebuilt on the `_ch` games: the rare move that stays graded is
now the BTN's call of a 60bb all-in over an open and a 3bet (0.48% of its range, AA +58.7bb), since in the chart-sized
50bb game UTG's call of a squeeze is 2.5% of its range and no longer rare.

**Not checked in a browser:** the Analyze note, Practice's form at 2 to 5 players and Study's 5bet field are covered by
unit tests only (`grading.test.ts`, `SetupForm.test.tsx`, `pfSolve.test.tsx`).

### 18.13 Stored games with antes and straddles (2026-11-24)

**The set** (`engine/pf_solve.py` `forced_games`, 240 games, keyed by `Spec.key` like the grid: `lz4_6max_100bb_s`,
`lz4_6max_100bb_s_r5c3_ch`, `lz4_9max_40bb_a0.11_ch`):

| | Players | Depths (bb) | Rake | Sizes | Games |
|---|---|---|---|---|---|
| 2bb straddle from the first seat (UTG from 4 players, the button at 3) | 3 to 9 | 50, 100, 150, 200 | none, 5% capped at 3bb | tree's, charts' | 112 |
| a 1bb big-blind ante's share a seat, to the cent | 2 to 9 | 20, 25, 30, 40, 50, 60, 80, 100 | none | tree's, charts' | 128 |

The ante is what a 1bb big-blind ante comes to a seat (0.5 heads-up, then 0.33, 0.25, 0.2, 0.17, 0.14, 0.13, 0.11 at 9
players), the convention Practice's tables already use (`stageAnte`), so a Practice ante asks the stored key exactly. A
site's hand averages its antes over the seats (a 1bb big-blind ante at 6 players is 0.1667bb a seat); within 0.005bb of
the stored share it is read against the stored game, and the grade says so (`grading.ts` `pfSiteGame`, `pfAnteNote`).
Only the first seat's straddle is stored, as it is the only one the tables and the history parser play. Rake is stored
with straddles only (the cash games that straddle are raked; the antes are tournament-like). The ante depths stop at
100bb: a 6-max 200bb anted game is about 1.1 GB to solve, past what a process here keeps under. Order: the straddled
100bb and 200bb games, then the antes at 20 to 60bb, then the rest, so a build stopped part way has the most played.

**The charts' sizes hold with a straddle and an ante.** Over 40 sampled nodes each of the chart-sized trees (6-, 9- and
4-max straddled; 6-, 9-, 8- and 2-max anted, and 6-max at 100bb anted), every raise size in the tree was the Advisor
charts' own size at that node: 0 mismatches.

**Target.** The grid holds a game to 1.5 mbb/hand a seat. Straddled games don't get there: the 4-max 100bb straddled
chart game measured (stored strategy, mbb/hand a seat) 2.82 at 500 iterations, 2.45 at 1,500, 2.44 at 3,000, 2.45 at
4,500 and 2.47 at 9,000, a floor of the class-level game rather than a lack of iterations. A straddle's and an ante's
chips make every pot bigger, and a strategy's error costs in proportion, so a forced game is held to 1.5 mbb per 1.5bb
of chips in before anyone acts (`build_stored.py` `target`): 3.5 with a straddle (1.5 in units of its 2bb and 1bb
blinds), 2.52 at 6-max with the 0.17 ante, 2.49 at 9-max with 0.11. It is solved 1,500 iterations at a time until
within that or 4,500, and installed if within it at 1,500 or within 1.2 times it after more, as the grid's games are
held to 1.8 against 1.5.

**The sample** (built through the CPU slot, one process; the first nine ran before the target above, to 4,500 where the
old 1.5 target wasn't met):

| Game | Iterations | Seconds | mbb/hand a seat | Bytes |
|---|---|---|---|---|
| `lz4_4max_100bb_s_ch` | 4,500 | 12.9 | 2.450 | 1,982 |
| `lz4_4max_100bb_s` | 4,500 | 17.9 | 2.264 | 2,584 |
| `lz4_6max_100bb_s_ch` | 4,500 | 129.4 | 3.049 | 13,068 |
| `lz4_6max_100bb_s` | 4,500 | 237.3 | 3.008 | 16,908 |
| `lz4_6max_100bb_s_r5c3_ch` | 1,500 | 40.8 | 1.027 | 15,057 |
| `lz4_9max_100bb_s_ch` | 1,500 | 52.3 | 0.184 | 13,442 |
| `lz4_9max_100bb_s` | 1,500 | 51.9 | 0.181 | 15,917 |
| `lz4_6max_30bb_a0.17_ch` | 4,500 | 37.7 | 1.962 | 4,380 |
| `lz4_6max_30bb_a0.17` | 4,500 | 97.3 | 1.887 | 6,922 |
| `lz4_3max_40bb_a0.33_ch` | 1,500 | 0.7 | 0.781 | 477 |
| `lz4_3max_40bb_a0.33` | 1,500 | 1.3 | 0.480 | 769 |
| `lz4_9max_40bb_a0.11_ch` | 1,500 | 22.1 | 0.113 | 6,030 |
| `lz4_9max_40bb_a0.11` | 1,500 | 58.2 | 0.159 | 13,745 |
| `lz4_6max_100bb_a0.17` | 4,500 | 651.8 | 2.132 | 49,876 |
| `lz4_6max_100bb_a0.17_ch` | 1,500 | 86.9 | 2.173 | 32,163 |

Raked and 9-handed games converge fast; unraked straddled ones level off between 2.3 and 3.0. The largest game of the
set, 6-max 100bb with antes, peaked at 828 MB resident (957 MB footprint) while solving and measuring in place
(`stored_mbb` measures the packed strategy on the solving game itself instead of a second copy). The 15 files are 193 KB;
at the sample's 10 bytes per decision (7 to 34) the 240 come to about 1.7 MB. The whole set was estimated at about 3.75
CPU hours at 1,500 iterations each, plus the games that need 3,000 or 4,500.

**The stored answer is a live solve's** (`scripts/engine/test_pf_forced.py` `SameAsLive`). Run for the file's
iterations, a live solve's strategy is the file's within 2.5/255 wherever a class reaches a node (the file's 1/255 steps).
A live solve run to its own stop (the worker's Solve: its target, the stall rule or 2,000 iterations), against the file,
first in:

| Game | Live iterations | Live mbb | Stored mbb | Largest gap, an action's share of the range | Mean class gap | Largest single class |
|---|---|---|---|---|---|---|
| `lz4_4max_100bb_s` | 2,000 | 2.341 | 2.264 | 0.08% | 0.16% | 0.311 |
| `lz4_4max_100bb_s_ch` | 2,000 | 2.454 | 2.450 | 0.08% | 0.11% | 0.179 |
| `lz4_3max_40bb_a0.33` | 2,000 | 0.475 | 0.480 | 0.10% | 0.10% | 0.196 |
| `lz4_3max_40bb_a0.33_ch` | 2,000 | 0.733 | 0.781 | 0.22% | 0.17% | 0.305 |
| `lz4_6max_30bb_a0.17_ch` | 2,000 | 1.964 | 1.962 | 0.10% | 0.13% | 0.408 |
| `lz4_6max_100bb_s_ch` | 1,000 | 3.282 | 3.049 | 0.15% | 0.25% | 0.409 |
| `lz4_9max_40bb_a0.11_ch` | 200 | 1.378 | 0.113 | 0.65% | 0.97% | 0.615 |

The ranges agree within a quarter of a percent wherever the live solve gets near the stored game's distance; a single
class near indifference between two moves can sit 0.2 to 0.4 apart, as two runs of the same game settle it differently.
The 9-handed live solve stops after 200 iterations by its own rule, 12 times further from equilibrium than the file, and
is 0.65% of the range off: the stored game is the better answer there. The test holds the two small games to 0.5% (share)
and 0.5% (mean class gap).

**Not measured:** how far these games are from a fuller solve with antes or a straddle. The model's flop values are
fitted to published solves without either, and every answer says so. The rows stay APPROXIMATE.

## 19. Nut advantage on Reports (2026-11-06)

Reports' Nut adv is each range's nut share and the lead between them, by flop: a range's weight at 80% equity or more against the
other range, over its weight with an equity. That's Study's definition, from the same two solver functions, read from
`ranges.json` by `scripts/library/nuts.py` and published as `<spot>/nuts.json`. No solve stores it, so it is calculated, not
solved, and the page and CSV say so. It covers two-player spots; a 3-way spot has no column.

The equity behind it runs over a sample of runouts, thinned to bound the work (`breakdown._runouts`). Against every runout, in
20 flops drawn at random:

| Flops | Share off, on average | Share off, at most | Lead off, at most |
|---|---|---|---|
| 8 of `srp_btn_bb` | 0.71 points | 4.1 | 2.5 |
| 12 of `srp_btn_bb` and `3bp_bb_btn` | 0.41 | 2.1 | 1.6 |

That is noisier than the stored range equity (0.04 of a point on average, under Aggregate reports in `FEATURE_MATRIX.md`),
because a share is a count across a line: a group of hands that sit near 80% can cross it together on a small change. Random
runouts did no better: 540 of them, at three times the time, were off by 0.35 on average and 4.4 at most. Every runout would
take about 2.5 s a flop, about 19 hours on one core over the library, so the step keeps Study's sample and the page states the
error. A small lead may be no lead. This sample of flops is small, and no flop's share has been checked by a second engine.

## 20. Tournament preflop solved in prize equity (2026-11-11)

`engine/pf_icm.py` solves a tournament's preflop as a game in which every outcome is paid in prize equity, and
`engine/pf_icm_study.py` answers Study's Solver source with it when a spot has payouts or bounties. The worker imports it
through a build-time edit declared in `solver/UPSTREAM.json`. It's the cash solve's game (`pf_game.py`: 169 hand
classes, card removal by `PAIR_COMPAT`, discounted CFR, the same flop model) with these changes:

- Each seat plays its own stack less its ante. A short blind posts what it has. A jam is offered beside the open at 25bb
  effective or less. A raise over a short all-in plays to the deepest stack that can call it.
- Every terminal is paid by `icm.Model.value_batch` (Malmuth-Harville, at most 12 seats plus field stand-ins, bounties by
  the proportional model) in chip equivalents of prize equity, so a winner-take-all pays chips exactly. A pot with
  unequal all-ins splits into side pots, and a bust pays its bounty to whoever wins the busted player's last chips.
- A seat that has folded is paid its prize equity as the hand plays out (`ICMGame.bystanders`). If the two players
  left can bust each other, a folded seat gains. Chips give it nothing either way.
- Three players at most reach a showdown (two from 7-handed on), as in the cash game. A raise is refused once three
  others are all-in for less, since they can't fold.
- The sizes are the cash game's: 2.5bb opens (3bb from the small blind, which may also limp), and 3bets to 3x, or 4.8x
  from a blind. Practice's chart opponents play these sizes, which a stored preset needs (20.5). The first version
  opened 2.2bb (2bb at 25bb or less), as solved MTT charts do. The spec's key includes the sizes, so a stored file with
  other sizes is never loaded.

### 20.1 Checks against the engine's own models (`scripts/engine/test_pf_icm.py`, 13 tests, about 15 s)

| Check | Result |
|---|---|
| In chips at equal stacks, against `pf_game.Game` on the same tree (2- and 3-handed) | Strategies equal to 1e-12, same exploitability |
| Winner-take-all prizes against chips (4-handed, unequal stacks) | Payoffs equal to 1e-14, strategies to 1e-12 |
| Heads-up push/fold against `pf_classes.push_fold` | Jam 72.85% vs 72.84% at 5bb, 58.70% vs 58.66% at 10bb, 45.9% vs 45.4% at 15bb |
| 3-handed 10bb jam-or-fold, 50/30/20, against the advisor's push/fold in prize equity, with the same game (no overcalls, folded seats paid nothing) | Button jams 38.4% vs 38.3%; BB calls a small blind's jam 23.3% vs 23.2% |
| The same, 4-handed (CO first in) | 42.3% vs 42.3% at equal 10bb stacks; 25.8% vs 24.9% at 8/15/6/11bb |

### 20.2 What prize equity changes (3-handed, 10bb each, jam or fold)

| Prizes | Button jams | BB calls an SB jam |
|---|---|---|
| Chips (and winner-take-all, identical) | 32.7% | 37.3% |
| 50/30/20 | 25.6% | 23.3% |
| Satellite, 2 seats | 19.7% | 9.8% |

KO bounties of 20 on every head (3-handed, 20/8/20bb, 60/40) widen the big blind's call of the 8bb small blind's jam
from 30.7% to 43.0%, since it covers.

The full model jams tighter than the advisor's push/fold because folded seats gain (BTN 25.5% against 38.4% in the
same 3-handed spot). A fold by the button there is worth +0.17bb of prize equity, because the blinds may bust each other.
The advisor values a fold at nothing. A direct best response checks this for 72o (EV 0.0267bb against the game's own
0.0267). Which is closer to real play is a modelling question: the bystander gain is real ICM, while a range-average
share of who busts is the model's simplification.

### 20.3 Convergence (mbb/hand of prize equity a seat, the solve's own game)

Measured by `scripts/pf_icm/convergence.py` with the 2.5bb opens. Figures are the mean over seats, with the worst seat
in brackets where it stands out.

| Game | Nodes | Exploitability by iterations |
|---|---|---|
| 3-handed 15/9/22bb, 0.1bb ante, 50/30/20 | 60 | 6.8 at 100, 0.65 at 200, 0.15 at 400, 0.064 at 800 |
| Sit & go bubble: CO 24, BTN 16, SB 9, BB 18bb, 0.25bb ante, 50/30/20 | 202 | 1.29 at 500, 1.28 at 1,000, 1.29 at 2,000 (BB 4.2) |
| The same in chips | 202 | 4.6 at 500, 4.7 at 2,000 (BB 10.5) |
| The same in chips at equal 24bb (the cash solve's game) | 197 | 3.1 at 300, 2.8 at 1,200 |
| The same in chips, heads-up pots only | 112 | 0.034 at 300, 0.0018 at 1,200 |
| 6-max, 20bb each, 0.125bb ante, 50/30/20 | 1,525 | 9.1 at 100, 2.2 at 300, 1.5 at 600 |
| 6-max, 25/12/40/18/30/22bb, 50/30/20 | 2,703 | 3.7 at 100, 0.85 at 300, 0.61 at 600 |
| The same two in chips | 1,525 / 2,703 | 2.2 / 0.64 at 600 (the equal one is the cash solve's game) |

The solve levels off rather than converging to zero, and the cause is the 3-way pot. A game with heads-up pots only
converges to 0.002. The cash solve at equal stacks levels off at 2.8 in the same table, which is what upstream's
`STALL` rule is for. A 3-way showdown is valued from each player's range-average share against the other two (six
hand orders, weighted by those shares). That makes the payoff depend on the strategies, so CFR settles on a floor.
With unequal stacks the side pots raise the floor (4.7 in chips on the sit & go bubble). Prize equity lowers it (1.3
there), since a bubble makes 3-way all-ins rarer. With the first version's 2.2bb opens the same tables levelled off
higher: 1.83 on the sit & go bubble (267 nodes), and 2.1 and 2.5 at 6-max (3,311 nodes for the unequal one).

A small tree runs to `pf_study.MAX_ITERS` (2,000) and reports its distance. The badge shows it ("1.28 mbb/hand from
equilibrium"), so a game that stopped above the 1.5 target says how far.

### 20.4 Speed and size

Natively, the sit & go bubble (202 nodes) runs 2,000 iterations in about 5 s. 6-max at 20bb (1,525 nodes) runs 600 in
about 19 s, and the unequal 6-max (2,703 nodes) 600 in about 24 s. A browser takes roughly 1.75x that, pf_study's
measured ratio. In the dev build's browser worker, the first version's sit & go bubble ran 2,000 iterations in 31 s with
the pane hidden, which throttles the page. The panel had estimated 5 s, so `estimate_seconds` (pf_study's rule, scaled
by nodes and seats) runs low on these trees. The browser takes up to 70,000 nodes x seats (`BROWSER_WORK`), and the
local server 300,000:

| Table | Nodes | Browser |
|---|---|---|
| Heads-up, 3 left, sit & go bubble (2-4 players) | 22-202 | yes, seconds |
| Final-table bubble (5 players, 8-40bb) | 895 | yes |
| 6-max at 20bb | 1,525 | yes |
| MTT bubble (8 players, 6-48bb) | 13,088 (with 2.2bb opens) | no: local server |
| Final table (9 players, 6-62bb), Early (8 at 60bb) | 24,924 / 33,978 (with 2.2bb opens) | no: local server |

### 20.5 Stored presets, and Practice graded by them (2026-11-11)

Six stage and format presets are solved once (`scripts/pf_icm/build_stored.py`, 1,500 iterations, as for the cash grid)
and stored in `engine/pf_icm/` with a manifest (`stages.json`). The worker reads them from the site's `pf/` folder. So
Study answers them at once, and Practice grades a session set to one of them, as long as it is set up as the preset
sets it, not played out, and has no bounties. The 8- and 9-player presets were left out here, as their trees were over the
browser's size cap and took 2-5 GB to build natively; they are stored since 2026-11-13 (20.6).

| Preset | Nodes | mbb/hand a seat | Build | File |
|---|---|---|---|---|
| Final-table bubble (5 players, 20/40/8/28/14bb, 9 paid, another table of 5) | 895 | 0.95 | 20 s | 7.3 KB |
| Three left (30/55/15bb) | 78 | 0.12 | 2 s | 1.1 KB |
| Heads-up (40/60bb) | 22 | 0.015 | 1 s | 0.4 KB |
| Sit & go bubble (24/16/9/18bb, 50/30/20) | 202 | 1.28 | 5 s | 2.3 KB |
| Sit & go, 6 players (75bb, 65/35, no ante) | 7,542 | 1.13 | 176 s | 50.8 KB |
| Double or nothing (6 at 50bb, 3 paid, no ante) | 4,667 | 0.57 | 87 s | 23.5 KB |

`scripts/pf_icm/coverage.py` measures how much of Practice's preflop the solve grades. It plays 1,000 hands a preset,
moving your seat each hand, and makes the checks `pfGrade.ts` makes:

| How the hand is played | Decisions graded by the solve |
|---|---|
| The charts' opponents and buttons, as before (`--charts`) | 4.8% on the sit & go bubble (100 hands). The charts open 2.5bb where the tree opened 2bb, and offer no jam beside the open |
| The opponents drawn from the solve and your buttons its options. You play the solve's mix where it answers, else the chart's | 100.0% on every preset (12,897 decisions) |
| The same, but you pick any option evenly | 93-97% a preset. The rest are lines the solve doesn't take with your class ("it holds no EV for it"), or rarely plays |

So in these sessions the preflop is played on the solve's tree (`PracticeHand.pfOptions`). Where the solve reads the
spot, your options are its own. Each opponent's preflop move is drawn from the solve's mix for that hand class
(`pf_icm_study.play`, asked by the request's `pf_play`, and only for a stored key). Two details keep the table and the
tree alike:

- A jam bigger than anyone left can call is played on the tree to the deepest of them. The node reports the rest
  (`uncalled_bb`), which `chipsOff` takes off the table's pot.
- An opponent's raise keeps the tree's size to the cent (4-bets to 17.25bb).

Checked in a browser (dev build, 2026-11-11) over 18 hands of the sit & go bubble: 17 preflop decisions were graded by
the solve and one by the push/fold model. That one came after my test loop raised T4s from the small blind, a class the
solve had folded by then, and the grade says so.

### 20.6 Seven to nine players, and the final-table set (2026-11-13)

From 7 players the tree drops one more family of lines, as `engine/pf_engine.py`'s 7+ tree does: once the pot has been
raised twice, a player who hasn't put chips in by choice can only fold. There are no cold 4bets, and no cold calls of a
3bet or of a jam over a raise (`build(cold4=False)`). At most two players see a flop, as before. The solve's label and
each answer (`pf_limits`, shown on the badge) say so, and the key hashes it, so 2 to 6 player keys are unchanged. These
lines are rare at a full table, but they made most of its nodes:

| Table | Nodes before | Nodes now | Browser (70,000 nodes x seats) |
|---|---|---|---|
| Bubble (8 players, 6-48bb) | 12,226 | 1,310 | yes |
| Early (8 at 60bb) | 24,470 | 2,148 | yes |
| Final table (9 players, 6-62bb) | 23,356 | 2,096 | yes |
| 9 players at 200bb, equal | over the native cap | 5,593 | yes |

Every table up to the 250bb stack limit now fits the native cap (the biggest is 6 players at 200bb or more: 14,157 nodes,
85,000 of 300,000). Stored at 1,500 iterations (`scripts/pf_icm/build_stored.py`, one process a game):

| Preset | Nodes | mbb/hand a seat | Build | File |
|---|---|---|---|---|
| Early | 2,148 | 0.12 | 49 s | 14.9 KB |
| Bubble | 1,310 | 0.24 | 32 s | 8.6 KB |
| Final table | 2,096 | 0.20 | 55 s | 12.6 KB |
| Sit & go, 9 players (75bb, 50/30/20, no ante) | 3,318 | 0.08 | 65 s | 17.8 KB |

The final-table set (`pf_icm_stored.FINAL_TABLE_SET`, the page's `finalTableStacks`) is 105 spots: 3 to 9 left; 10,
15, 20, 30 or 40bb average; equal stacks, the chip leader on the button with twice the average, or a short big blind
with 40% of it (the rest share what's left, to 0.1bb). Every spot pays a 9-paid final table's prizes left
(30/20/14/10.5/8/6.5/5/3.5/2.5) and has the stages' 1bb big-blind ante as each seat's share, no other tables and no
bounties.

| Players left | Nodes | mbb/hand a seat | Build (15 spots) | Files |
|---|---|---|---|---|
| 3 | 42-82 | 0.04-1.62 | 17 s | 15 KB |
| 4 | 137-401 | 0.08-0.75 | 54 s | 34 KB |
| 5 | 378-1,552 | 0.11-0.80 | 225 s | 81 KB |
| 6 | 924-5,002 | 0.15-0.80 | 658 s | 179 KB |
| 7 | 632-1,102 | 0.02-0.10 | 228 s | 82 KB |
| 8 | 985-1,720 | 0.02-0.10 | 333 s | 118 KB |
| 9 | 1,464-2,542 | 0.02-0.08 | 528 s | 161 KB |

That is 34 minutes of one core and 670 KB; the 115 stored files are 809 KB in all. The 7 to 9 handed spots converge
further than the 5 and 6 handed ones because their trees end sooner. Each number is the solve's distance from the
equilibrium of its own simplified game, not from a full-tree solve (20.3). The 1.62 mbb spot is 3 left at 10bb with a
short big blind, where most hands are jams.

### 20.7 The tournament preflop on the cash grid's engine, and the 767-spot set (2026-11-17, rebuilt 2026-11-22)

**Two engines, one game.** `engine/pf_icm_calib.py` (2026-11-17) plays `engine/pf_icm.py`'s tournament tree on the cash
grid's engine instead: `engine/pf_engine.py`'s game, `engine/pf_model.py`'s calibrated flop values, and every outcome paid
by the prize model through pf_engine's pluggable payoff. It prices folded seats in one vectorised pass, and pays a bust's
bounty to the seat that won the busted player's chips. Neither `pf_engine.py` nor `pf_model.py` is edited. At the time,
pf_icm's own game (`ICMGame`) valued flops with upstream's library flop model, and the new engine was closer on all four
published chip-EV references:

| Reference (source) | Upstream flop model (11-17) | pf_engine + calibrated (11-17) |
|---|---|---|
| 40bb MTT, SB vs CO open (Poker Academy, 9-handed, 1bb BB ante) | 10.57 | 7.57 |
| 40bb MTT, SB vs BTN open (same) | 19.07 | 12.17 |
| Heads-up 50bb, SB first in (GTO Wizard, 0.12bb ante) | 9.07 | 4.47 |
| Heads-up 50bb, BB vs SB limp (same) | 17.10 | 11.90 |
| Mean | 13.95 | 9.03 |

The numbers are mean absolute errors over the node's fold / call / raise shares, in percentage points
(`scripts/pf_icm/compare_models.py`, 1,000 iterations each).

From 2026-11-18, `ICMGame` takes `pf_model.py`'s calibrated flop values itself (section 18.9, tag `cal1`). From
2026-11-22 it runs on the exact equity table (tag `cal2`, section 31). The comparison was then
run again on that base (`compare_models_refs.json`, `compare_models_icm.json`,
`library-build/runs/w1_check2.log`):

- **Chip EV:** the two engines read the same on all four references to 0.1 point: 6.77, 10.53, 5.10 and 12.40, a mean of
  8.70.
- **Prize equity:** over 22 spots (16 final-table spots at 3, 5, 6 and 9 left, 15 and 30bb, in the new shapes and the
  top-heavy structure, plus the Final-table bubble and the Sit & go bubble), first-in raise-or-jam shares by seat differ
  by 0.0 to 1.43 points on average per spot (mean 0.29), 3.7 at most.
- **Class by class:** at 300 iterations the two differ by about 0.02 of a class's frequency on average. Each prices a
  three-way pot and a folded seat its own way (`test_pf_icm.py` `Calibrated.test_close_to_pf_icms_game`).
- **Speed:** pf_engine's version takes 1.1 to 3.6 times as long (median 1.8): 654 s against 365 s for the 22 spots.

So `ICMGame` stays the game that Study and the stored spots solve. `pf_icm_calib.py` is a cross-check from the cash
grid's engine, and its tests run with the engine tests.

One fault was found and fixed while writing the cross-check. pf_engine's nonlinear payoff (prize equity) gives a
three-way all-in's side pot to the deeper of its two contenders whenever the main pot's winner can't take it, which
favours the deeper stack. `pf_icm_calib.Game` splits it evenly between the two, the same even weighting pf_engine gives
the losers of the main pot. Chip EV, being linear, splits it by heads-up equity per class. `ICMGame` orders the hands by
their range-level shares, which is finer than either.

**The stored set** (`engine/pf_icm_stored.py` `ALL`, written out as `engine/pf_icm/sets.json`, which the web's
`PF_ICM_PRESETS` is tested equal to) grows from 115 spots to 767:

| Set | Spots | What varies |
|---|---|---|
| Stages and formats | 10 | as before (the spin is the cash grid's) |
| Final table | 490 | 3 to 9 left at 10, 15, 20, 30 or 40bb average. The 105 as before (equal, chip leader on the button, short big blind; Lizard's 9-paid prizes); the same 105 on each of three posted structures (flat, standard, top-heavy: the first nine places of WSOP Online's top 20%, 15% and 10% paid tables); and 70 more with the chip leader in the big blind or the short stack on the button |
| Bounty | 36 | KO and PKO on Early, Bubble, Final-table bubble and Final table (3 levels each), and PKO 2.5 or 5 a head on the final-table set at 6 and 9 left, 15 and 30bb, in its three shapes. Every seat has the same bounty, and the field's is the same |
| Satellite | 117 | 3 to 9 left with one or two fewer seats than players (2 seats at least), 10, 15 or 25bb average, the three shapes |
| Chip EV | 114 | every stage but Double or nothing (the cash grid holds it), and the final-table set's 105 stacks in chips |

**Keys.** A stored key is the game's key as the worker computes it, with `pf_icm.FLOP_MODEL_TAG` in it. `cal2` means the
exact equity table and the calibration whose digest is `MODEL_DIGEST`; any other table or calibration keys as
`cal2-<digest>`. A file solved on another table is therefore never read.

- `build_stored.py` counts an entry as current only when its file is there under the key its request's game has now.
- `index` writes `web/src/features/practice/pfIcmBuilt.json`: the tag, and the spots built under it. The page matches
  only those spots.
- The 115 presets re-solved on main under `cal2` keep their keys, so only the 652 new spots were built.

**The build** (`library-build/runs/w1_pf_icm_build.log`): 652 spots built through slot.sh on 2026-11-22, 2 workers,
14,755 s of solving (4.1 CPU hours), no failures, about 285 MB a process at most. With the 115 presets, all 767 are
current under `cal2` keys, 5.24 MB in all.

| Set | Built | Seconds | mbb/hand a seat (min to max, median) | Size |
|---|---|---|---|---|
| Final table (new) | 385 | 8,461 | 0.019 to 3.41, median 0.19 | 2,591 KB |
| Bounty | 36 | 1,632 | 0.039 to 14.45, median 0.78 | 400 KB |
| Satellite | 117 | 2,159 | 0 to 1.69, median 0.014 | 718 KB |
| Chip EV | 114 | 2,502 | 0.088 to 12.43, median 1.56 | 687 KB |

Prize-equity spots level off under 4 mbb/hand a seat (the highest, 3.41, is the top-heavy 3 left at 10bb with a short
big blind). Chip-EV and bounty spots level off higher: a short big blind's three-way side pots set a floor the solver
doesn't get under in its iterations, up to 12.4 in chips and 14.45 with bounties (Bubble, KO 0.4 a head). Even 14.45
mbb is 1.4% of a big blind: under 1% of the smallest preflop pot (1.5bb), below the grade's Inaccuracy line of 2% of the
pot (`grade.ts` `INACCURACY_PCT`). The tests hold prize-equity spots under 4 and chip-EV and bounty spots under 15
(`test_pf_icm_stored.py`, `pfIcmBuilt.test.ts`).

A slice on pf_engine's version before the switch, at 1,500 iterations (files not kept):

| Spot | Nodes | mbb/hand a seat | Build | Peak memory |
|---|---|---|---|---|
| 3 left, 10bb, equal stacks, chip EV | 54 | 1.23 | 1.0 s | 95 MB |
| Satellite, 2 seats for 3 left, 10bb, chip leader on the button | 42 | 0.000 | 1.9 s | 94 MB |
| 3 left, 15bb, short big blind, top-heavy payouts | 54 | 0.31 | 2.9 s | 98 MB |
| 6 left, 15bb, chip leader on the button, PKO 2.5 a head | 1,407 | 0.45 | 43.6 s | 198 MB |
| 9 left, 30bb, chip leader on the button | 1,713 | 0.04 | 49.4 s | 285 MB |

## 21. Flop abstraction error (2026-11-11)

A live flop solve doesn't play the game it is asked about. Below the flop it plays the turn by rank class, the turn and
river by hand bucket, and the river cards by sample (docs/research/03 §2.5). The exploitability on its badge is
measured inside that smaller game. `scripts/benchmarks/abstraction.py` measures what the badge can't see, in the way
upstream measured its library against an outside solver, but with Lizard's exact mode (section 14) as the full game:

1. solve the spot in one of the app's flop models, natively, to its own iterations (Fast 400, Accurate 1,000, the
   library 300);
2. solve the same spot and menu exactly, with every turn and river dealt per combo, for 1,000 iterations;
3. for each player, solve the exact game again with that player's every flop decision held, combo by combo, at the
   model's mix (`engine/nodelock.py` `hold_strategy`), and everything after the flop re-solved, that player's own
   later play included.

**Given up** is the player's value in step 2 minus their value in step 3, in % of the pot. It is the EV the model's
flop strategy loses against every card dealt when both players play the turn and river perfectly afterwards. As a
control, the exact solve's own flop held the same way (`exact-self`) must give up nothing beyond convergence.

**The models.** Fast and Accurate are the browser's (`solver/gto/static/worker.js`). Fast plays the turn by rank class
and the turn and river by 32 hand buckets, over every third river. Accurate uses 64 buckets over every river. The
library model is `flop_library.library_config`: the turn by rank class per combo, the river dealt, and 64 buckets on
each card. Three variants show which part costs what: Fast with 8 buckets (`fast-k8`), and one part alone with the rest
exact, either the turn classes (`turn-classes`) or the river by 32 strength buckets without its card (`river-strength`).

**The spots.** The ranges are narrow on purpose, because the exact game holds every turn and river per combo at about 34 bytes
a cell: about 30 combos a player, 24M to 28M cells and 830 to 950 MB a solve. The flop menu is 33/75% with a 50% raise
and one raise a street. The turn and river play one size, 75%, which is the menu every live flop solve plays below the
flop (`Config.later_sizes`), so what's measured is the card and hand abstraction, not a smaller menu.

| Spot | Board | Pot, stack | Ranges |
|---|---|---|---|
| `srp-K72` | Ks7d2c | 5.5, 97.5 | 77, 22, K9s, QJs, JTs, 98s, 65s / AA, KK, AKs, KQs, QQ, A5s |
| `srp-JT8` | JdTd8c | 5.5, 97.5 | 88, T9s, 97s, Q9s, AdXd, 65s / AA, JJ, AJs, KQs, 98s, KdQd, A5s |
| `3bp-AJ3` | AhJd3c | 20, 80 | AA, KK, AKs, AQs, A5s, KQs, 76s / AJo (half), QJs, JTs, TT, 33, KJs |

**Measured [M]**, `results/abstraction.json`, native, one thread, through `slot.sh`. Given up is in % of the pot, OOP
then IP. "Own game" is the figure the model's badge would show. The exact solves were 0.019% to 0.087% from
equilibrium, and 0.009% to 0.074% with a flop held.

| Model | K72 own game | K72 given up | JT8 own game | JT8 given up | AJ3 own game | AJ3 given up |
|---|---|---|---|---|---|---|
| exact-self (control) | 0.087 | 0.001, 0.000 | 0.029 | 0.000, 0.000 | 0.019 | 0.000, 0.000 |
| Fast | 0.036 | 2.17, 2.25 | 0.031 | 1.00, 4.85 | 0.069 | 0.64, 0.22 |
| Accurate | 0.005 | 2.23, 2.33 | 0.006 | 0.78, 5.41 | 0.027 | 0.47, 0.26 |
| Library | 0.499 | 0.25, 0.34 | 0.143 | 0.48, 2.14 | 0.113 | 0.09, 0.12 |
| Fast at 8 buckets | 0.116 | 1.72, 0.88 | 0.040 | 2.13, 5.41 | 0.068 | 1.84, 1.16 |
| Turn classes alone | 0.096 | 0.26, 0.25 | 0.029 | 0.15, 0.02 | 0.022 | 0.09, 0.13 |
| River strength alone | 0.005 | 2.39, 1.62 | 0.007 | 0.38, 2.10 | 0.010 | 1.22, 2.14 |

Over the six player-spots, Fast gave up 1.85% of the pot on average and 4.85% at most. Accurate gave up 1.91% and
5.41%, and the library model 0.57% and 2.14%. Their own badges read 0.005% to 0.5%. The largest flop frequency gaps
against the exact solve, per spot and model, were 24 to 75 points on one decision's action, range-wide.

**What it shows.**

- **The badge understates the distance from the full game.** It does so by one to three orders of magnitude, on every
  spot and model. The control gives up nothing (0.001% at most), so the gap is the abstraction, not the method.
- **Accurate is no closer than Fast.** Its extra buckets and iterations bring its own-game figure to 0.005%, but the
  full-game cost stays the same or grows: its game is solved better, not made closer to the full one.
- **The library model is 3 to 8 times closer** than either browser model, though its own figure is the largest of the
  three. It keeps the river card and buckets on each card.
- **Most of the cost is the river abstraction,** in particular playing the river by strength without its card. That
  variant alone gave up up to 2.4%; the turn classes alone at most 0.26%. The parts don't add up to the whole:
  equilibria aren't unique, and errors from different parts can cancel.
- **Fewer buckets isn't consistently worse.** Fast at 8 buckets gave up less than Fast on K72 for IP, and more on AJ3.
  These ranges put one or two combos in a bucket, so bucket count isn't what limits the models here.

**Surfaced.** Since this measures the answers people see, a heads-up flop answer from the browser's Fast or Accurate
(live, or a node lock on it) or from the flop library carries it in its provenance, beside its own figure
(`web/src/solver/abstraction.ts`): "this flop model gave up 1.9% pot on average, up to 4.9%, against the full game on 3
narrow test spots". It isn't put on Quick, a local server's solves (their configs are the server's own), turns, rivers,
multiway pots or tournament spots, none of which were measured. The band and the approximate flag are unchanged: they
describe convergence in the solved game, which the figure beside them still is.

**Not established.**

| Not covered | Why it matters |
|---|---|
| Real ranges | 30 combos a player, not 500 to 600. With real ranges a bucket holds 10 to 20 combos where here it holds one or two, which could push the cost either way; the 8-bucket variant didn't move it one way consistently |
| Bigger menus | One raise a street, two flop sizes; the turn and river at one size in both games |
| More spots | Three boards. JT8, the wet board, cost most; a spread over many boards would need a faster exact game |
| The browser | Native, compiled core. The browser runs the same configs on the wasm core, which section 16 found to agree with native |
| Turns | A turn solve deals every river per combo and buckets nothing on the turn itself; only river classes were measured here (section 16's river-class lock notes) |

The solves took about 1.2 hours of one core through `slot.sh`: 1 to 3 minutes a held solve, 830 to 950 MB, and up to
990 MB for the library model's own solve on JT8.

## 22. Bigger heads-up trees (2026-11-11)

The Solve page offers up to 5 bet and 5 raise sizes a street and a raise cap of 1 to 4 bets and raises a street.
Settings offers a tree cap: Phone 12M, Standard 24M (upstream's `MAX_CELLS`) or Large 32M cells; native runs allow
up to 64M (`engine/tree_depth.py`, `web/src/solver/treeDepth.ts`). These apply to heads-up solves only. A tree past
the cap is cut to fit by upstream's `TRIMS`: fewer sizes, then fewer raises, with a note saying so. On a turn or river,
upstream also caps the tree by what the mode's time allows (`advisor.py` `_cells_cap`), so on a slow device a bigger
cap helps only where that time allows.

**Cells [M].** `scripts/benchmarks/tree_depth.py cells` counted them by walking the tree, with no arrays built. The
setup: BTN open against a BB defence, 594 and 574 combos, at the worker's Fast config; Accurate's turns and rivers are
the same trees, and its flops are a little larger. The menus are the same each street: `app` is 33/75% with a 50%
raise; `3x3` is 33/75/125% with 50/100/200% raises; `5x3` is 25/33/50/75/125% with those raises; `5x5` also adds
33/50/75% raises. Millions of cells at a raise cap of 1, 2, 3 and 4:

| Root | app | 3x3 | 5x3 | 5x5 |
|---|---|---|---|---|
| Flop `Ks7d2c`, pot 5.5 | 0.1, 0.4, 0.6, 0.6 | 0.2, 0.9, 1.5, 1.8 | 0.3, 1.6, 2.8, 3.4 | 0.3, 2.4, 6.9, 14.3 |
| Turn `Ks7d2c5h`, pot 11 | 1.3, 4.2, 6.2, 6.5 | 2.8, 12.4, 17.7, 18.0 | 7.0, 39.1, 54.7, 55.6 | 7.0, 91.4, 200.7, 250.7 |
| River `Ks7d2c5h9s`, pot 22 | under 0.05 at every cap | 0.0, 0.1, 0.1, 0.1 | 0.0, 0.1, 0.1, 0.1 | 0.0, 0.2, 0.3, 0.4 |

The turn is where the cap binds, because a turn solve deals every river per combo. A flop solve plays the turn and
river at one size by bucket (`Config.later_sizes`), so even its largest menu stays under Phone's cap. On a turn:

- 3 sizes and 3 raises (17.7M) fit Standard;
- 5 sizes at 2 raises (39M) pass every browser cap and are cut;
- 5x5 at 4 raises (251M) passes even the native 64M.

The raise cap counts the bet: at 2, a bet and a raise; after that, the player facing a bet may only fold, call or go
all-in. That is the engine's `Config.max_raises`, and the page's words say it the same way.

**Memory [M].** `tree_depth.py memory` solved each tree briefly in a process of its own, natively on one thread, and
read its peak resident memory. For turns, from 2.8M to 17.7M cells (136 to 602 MB), the peak fits 47 MB plus 33 bytes
a cell. That gives about 424 MB at Phone's 12M, 801 MB at Standard's 24M and 1,052 MB at Large's 32M. A flop's cell costs
more, about 51 bytes (772 MB for the 14.3M-cell 5x5 flop at 4 raises), but no flop menu the page allows builds past
19M. Upstream notes that Pyodide's heap ran about 10% under native on the same tree (`advisor.py`, above `MAX_CELLS`),
so these figures are the high end for the browser. The worker's heap is 2 GB, shared with the solves it keeps; before a
solve bigger than the room left, `engine/tree_depth.py` evicts kept solves to make room (`_make_room`).
`web/src/solver/treeDepth.ts` shows these figures in Settings ("12M cells, up to ~0.4 GB").

**Not established.**

- **A browser's own peak.** It wasn't measured in a browser, and a phone's tab may be killed before the worker's heap
  fills. Standard is the default on every device; Phone is offered for small ones, not set from a measured limit.
- **Time.** The cap is in cells, and a turn or river solve's time cap still applies (`_cells_cap`), so a slow device may
  solve a smaller tree than its cap allows. How long a Large tree takes to converge in the browser wasn't measured.
- **Accuracy at depth.** Bigger menus aren't compared against an outside solver here. They are the same engine on a
  bigger tree, with its exploitability measured in that tree as before.

The Solve page's controls (the raise cap and up to 5 sizes) and the Settings tree cap were checked in the browser on
2026-11-11, on a local build without a solve.

## 23. Bunching (2026-11-13)

An option on the Solve page and in Study (`engine/bunching.py`): the ranges entering the flop are weighed by the hands
the seats that folded preflop were holding. Each remaining combo h gets F(h) = P(no folder holds a card of h), from the
folders' card moments under their fold ranges (the charts' or the preflop solve's), and every street is solved live on
the weighted ranges. Measured by `scripts/engine/measure_bunching.py` (through the shared slot, 5 min, peak 496 MB).

### 23.1 The combinatorics (`scripts/engine/test_bunching.py`, 23 tests, about 17 s)

- One and two folders: the moments are exact (matrix sums), and match brute force over every deal of small random fold
  ranges to 1e-12, F and the next card's odds included.
- Three or more: rejection-sampled, 60,000 deals. Against brute force on three folders, every combo's F is within 4.5
  of its stated standard errors, with the mean |z| under 1. The stated error, sqrt(F(1-F)/60,000), is 0.26-0.31% of F
  on the spots below, and the badge says it.
- The plan (moments, factors, the next card's odds) takes 0.02-0.07 s natively for the charts' folds; reading the
  preflop solve's folds adds about 0.5 s the first time.

### 23.2 How much the folds move the ranges

From the charts' folds, at 100bb: each remaining range's combos before and after weighting, and the lowest factor F in
the range over its highest (the weight the most-blocked combo keeps against the least-blocked one):

| Spot | Folders | Remaining combos (even -> weighted) | Lowest F / highest F |
|---|---|---|---|
| UTG vs BB, Kd7c2h | HJ, CO, BTN, SB | UTG 223 -> 210, BB 337 -> 319 | UTG 0.89, BB 0.91 |
| BTN vs BB, Kd7c2h | UTG, HJ, CO, SB | BTN 535 -> 474, BB 513 -> 469 | BTN 0.78, BB 0.83 |
| BTN vs SB and BB, Kd7c2h | UTG, HJ, CO | BTN 535 -> 486, SB 50 -> 46, BB 353 -> 333 | BTN 0.82, SB 0.86, BB 0.86 |

("Weighted" is relative to the combo the folds block least, so only the ratios inside a range matter.) A BTN open faces
four tight folds that hold most of the low cards: 22's factor is 0.64 and AA's 0.82, so 22 keeps 78% of the weight AA
keeps. UTG faces folds from wide
ranges that hold every card more evenly, so the effect there is about half as big.

### 23.3 What it changes in the solve

Each spot's flop solved twice at the worker's Accurate config (to 0.01-0.02% of the pot, natively), once on the even
deal and once bunched, every library put aside both times. Read at the first actor's root and at the last actor's node
after checks: the range's frequencies (check / bet 33% / bet 75%, %), the class-weighted mean change of each hand
class's mix (points) and EV (bb), and the node's EV (bb). For scale, the last two columns are the same spot unbunched
at Fast against Accurate.

| Spot, node | Even deal | Bunched | Class mix Δ | Class EV Δ | Node EV even -> bunched | Fast vs Accurate: mix Δ, EV Δ |
|---|---|---|---|---|---|---|
| UTG vs BB Kd7c2h, BB first | 100 / 0 / 0 | 100 / 0 / 0 | 0.0 | 0.023 | 1.58 -> 1.57 | 0.0, 0.125 |
| UTG vs BB Kd7c2h, UTG after a check | 1.0 / 85.1 / 13.9 | 0.2 / 88.7 / 11.2 | 5.9 | 0.033 | 3.920 -> 3.932 | 21.6, 0.069 |
| UTG vs BB 8h6d4c, BB first | 91.3 / 0 / 8.7 | 91.4 / 0 / 8.6 | 3.1 | 0.042 | 2.284 -> 2.265 | 6.8, 0.089 |
| UTG vs BB 8h6d4c, UTG after a check | 45.0 / 45.2 / 9.8 | 44.6 / 46.3 / 9.1 | 9.0 | 0.040 | 3.257 -> 3.272 | 16.3, 0.091 |
| BTN vs BB Kd7c2h, BB first | 100 / 0 / 0 | 100 / 0 / 0 | 0.0 | 0.031 | 1.94 -> 1.93 | 0.0, 0.071 |
| BTN vs BB Kd7c2h, BTN after a check | 26.7 / 58.3 / 14.9 | 24.2 / 64.2 / 11.6 | 12.4 | 0.029 | 3.561 -> 3.576 | 17.3, 0.075 |
| BTN vs BB 8h6d4c, BB first | 90.4 / 3.1 / 6.5 | 92.1 / 3.3 / 4.7 | 4.5 | 0.045 | 2.372 -> 2.367 | 6.1, 0.107 |
| BTN vs BB 8h6d4c, BTN after a check | 56.4 / 0.2 / 43.4 | 56.2 / 0.3 / 43.4 | 6.0 | 0.036 | 3.243 -> 3.228 | 19.3, 0.095 |
| 3-way Kd7c2h, SB first | 61.1 / 35.2 / 3.7 | 63.9 / 32.0 / 4.2 | 5.3 | 0.038 | 3.173 -> 3.146 | 12.0, 0.135 |
| 3-way Kd7c2h, BTN after two checks | 59.4 / 40.5 / 0.1 | 59.7 / 40.0 / 0.3 | 6.1 | 0.040 | 3.199 -> 3.202 | 13.7, 0.230 |

(3-way: BTN opens 2.5bb, SB and BB call; the 3-player solver's Accurate game, 400 iterations, 0.07% of the pot mean
best-response gain.)

What that says:

- **Range frequencies move up to 6 points.** The largest: BTN's small c-bet on Kd7c2h, 58.3% -> 64.2%, its big bet
  14.9% -> 11.6% (the BB's range keeps fewer of the low pairs and gutshots the folds hold, so it is a little stronger
  and BTN bets smaller). Most nodes move 0-3 points.
- **EVs move by hundredths of a bb**: a node's EV by at most 0.027 bb (0.5% of the pot), a hand class's by 0.02-0.05 bb
  on average. Both are about half of how far Fast and Accurate are apart on the same spot.
- **A hand class's mix moves 3-12 points** (combo-weighted mean), less than Fast against Accurate (6-22). Two converged
  solves of nearly the same game can also differ in classes that are indifferent between actions, so part of that
  column is the solution's own freedom, not the folds.

So bunching is a real but small correction on these spots, smaller than the gap between the two speeds. It matters most
where tight folds face a late-position open (BTN vs BB), and least where the folds come from wide early ranges.

### 23.4 What the model leaves out

- **Each player's factor alone.** The exact weight of a pair of hands (one per remaining player) is J = P(no folder
  holds a card of either), not F(h1) F(h2). Over 400,000 sampled folder deals and about 2,700 pairs drawn from the two
  ranges, J / (F1 F2), normalised to its mean, has a root-mean-square spread (the two halves' covariance, so sampling
  noise of 0.04-0.07% is taken out) of 0.29% (UTG vs BB), 0.41% (BTN vs BB) and 0.30% (3-way, BTN and BB), with 95%
  of pairs within 0.58-0.84%. That is a twentieth or less of how far F itself varies across a range (9-22%). The 3-way spot's third player isn't in
  this measurement.
- **The runouts are dealt evenly.** The folds make the next card's odds uneven too: on BTN vs BB Kd7c2h a turn ace is
  8.80% likely against 8.16% even (+7.8% of itself), a king 6.37% (6.12%), a deuce 5.88% (6.12%); on UTG vs BB the ace
  is 8.49%. The solves still deal every turn and river card evenly (upstream's chance nodes, buckets and compiled core
  would all need the weights); Study shows these odds under the switch, said as not played.
- **The flop only.** The factor is conditioned on the flop; a turn's solve narrows from the same weighted flop ranges.
  The turn card's own effect on the folds is the size of the odds above.
- **Postflop folds** aren't counted: their hands are a postflop range, not a preflop fold.

### 23.5 Cost

- **Natively**, a bunched flop solve takes the same time as an even one on the same tree (heads-up 2.7-3.4 s against
  2.8-3.5 s at Accurate; the 3-way 27 s against 19 s, within what the shared machine's load moves a run by), plus the
  plan's 0.02-0.07 s.
- **The real cost is the library.** The flop libraries hold solves of the even deal, so a bunched flop is always solved
  live. In a browser (dev build, threaded core, Fast) on 2026-11-13: BTN vs BB 8h6d4c answered from the library in 0.6
  s, bunched by a live solve in 0.8 s (300 iterations, 0.11% of the pot); 3-way Kd7c2h from the 3-way library in 1.0 s,
  bunched in 5.6 s (400 iterations, 0.07%); UTG vs BB Ts8s3d from the preflop solve's folds in 1.6 s. A device without
  threads takes longer (Fast's flop budget is 8 s).

**Not established.** 4-way pots take the weighted ranges the same way but weren't measured or tested. No comparison with
another solver's bunching was made.

## 24. Custom flop reports against the library (2026-11-13)

(Numbered 24 because the bunching branch took 23 the same day.)

A flop report of your own spot (Reports, "Report over flops" from Solve or Study) solves one flop at a time in the
browser's worker at Fast or Accurate, over the solver's representative set of 9, 25, 49, 95 or 184 flops. Each flop
stands for 1/n of all 22,100. The library's own report of a stored spot holds all 1,755 flop classes, each weighted by
how often it is dealt, solved offline in the library's flop model. To see what a custom report gets wrong,
`scripts/benchmarks/custom_report.py` reports a spot the library stores with the library turned off, the way a custom
report solves a spot the library doesn't store, and compares it with the library's report.

**How.**

- The spot is 6-max 100bb, BTN opens 2.5bb and BB calls (`srp_btn_bb`): 5.5bb pot, 97.5bb behind.
- The live side is the worker's Fast Advisor as `solver/gto/static/worker.js` builds it with 4 or more threads, which
  most browsers give it: Accurate's turn tree, the river inside at 33/75/125%, and the heads-up solve stopped once
  0.2% of the pot from equilibrium, from its 300th iteration.
- It asks the same two questions the page's report asks (`customReport.ts` `solveFlop`): the flop's root, then in
  position after BB's check. Both are study requests.
- It runs natively on one thread, through the shared slot. A solve's numbers don't depend on its threads.
- Every flop stopped at 300 iterations, as in the browser checks, at 0.06% to 0.16% of the pot from equilibrium in its
  own game (mean 0.10%). The time budget never cut a solve short.
- 1.0 to 3.5 s a flop natively (1.7 s on average), 2.6 minutes for 95 flops, 425 MB peak.
- The library side is `library-build/lizard-library/srp_btn_bb/report.json`, the assembled release.
- Results: `scripts/benchmarks/results/custom_report_srp_btn_bb_25.json` and `…_95.json`.

**The averages** (each weighted as its report weights it):

| Column | Library, all 1,755 flops | Library, the 25 | Live Fast, the 25 | Library, the 95 | Live Fast, the 95 |
|---|---|---|---|---|---|
| BB checks | 98.8% | 98.9% | 98.5% | 98.3% | 97.7% |
| BTN bets after the check | 56.1% | 56.0% | 59.5% | 55.0% | 58.2% |
| of those bets, at 75% | 71.8% | 72.9% | 56.1% | 71.4% | 56.4% |
| BB's EV (bb) | 2.04 | 2.04 | 2.03 | 2.06 | 2.05 |
| BB's EV (% pot) | 37.0 | 37.0 | 36.8 | 37.4 | 37.2 |
| BB's equity | 45.5% | 45.5% | 45.6% | 45.6% | 45.7% |

**The differences**, split into their two causes:

- **Sampling** is the library over the set minus the library over every flop: the error of using n flops, not 1,755.
- **Model** is live Fast minus the library, on the same flops: Fast's flop model against the library's.
- **Report** is what a user sees: the live report minus the library's report, both causes together.
- **Per flop** is the mean (and largest) absolute difference flop by flop, live against the library.

| Column | Sampling, 25 | Sampling, 95 | Model, 25 | Model, 95 | Report, 25 | Report, 95 | Per flop mean (max), 25 | Per flop mean (max), 95 |
|---|---|---|---|---|---|---|---|---|
| BB checks (points) | 0.1 | -0.2 | -0.4 | -0.6 | -0.3 | -0.8 | 0.4 (3.0) | 0.9 (8.0) |
| BTN bets after the check (points) | -0.1 | -0.6 | 3.5 | 3.1 | 3.4 | 2.5 | 4.0 (10.4) | 3.8 (17.1) |
| of those bets, at 75% (points) | 1.1 | 0.5 | -16.8 | -15.0 | -15.7 | -14.5 | 18.0 (42.2) | 16.3 (49.3) |
| BB's EV (bb) | -0.00 | 0.01 | -0.01 | -0.01 | -0.01 | -0.00 | 0.02 (0.04) | 0.02 (0.06) |
| BB's EV (% pot) | -0.0 | 0.2 | -0.2 | -0.2 | -0.2 | -0.0 | 0.3 (0.7) | 0.3 (1.1) |
| BB's equity (points) | -0.0 | 0.1 | 0.1 | 0.1 | 0.1 | 0.1 | 0.2 (0.6) | 0.2 (0.8) |

**What this says.**

- **Sampling is small on this spot.** The representative sets are drawn by texture and weight, and 25 flops land
  within about 1 point of the full library's averages on every column (0.6 at 95). A spot whose strategy changes more
  from flop to flop than this one could need more flops; the set sizes stay offered for that.
- **EV, equity and BB's check agree.** EVs are within 0.3% of the pot a flop on average (1.1% at most, on 6d6c5h), and
  the report's average EV within 0.2%. Equity is within 0.2 points. BB checks within 1 point on average. These
  columns can be read as the library's.
- **In position bets a little more often, and much smaller.** Fast bets after the check 3 to 4 points more often than
  the library. Of its bets, 56% are at 75% pot where the library's are 71-73%. That is 15-17 points lower on
  average, lower on 76 of the 95 flops, and up to 49 points on one flop (Qc7d5c).
  - This is the flop model below the flop, not the sample. Fast plays the turn by rank class and the turn and river by
    32 hand buckets over every third river (section 21). The library plays the turn per combo, deals the river and
    uses 64 buckets.
  - Section 21 measured what each model gives up against the full game: Fast 1.9% of the pot on average, the library
    0.6%. So where they disagree, the library is the better guide.
  - The size split sits where the two sizes are close in value. A coarser game below the flop moves it a long way at
    little cost, which is why the EVs still agree.
- **Accurate wasn't measured here.** Its flop model is closer to the library's (64 buckets over every river), but it
  takes longer a flop. Section 21's Accurate figure (1.9% mean, 5.4% at most) is what a report at Accurate shows.

**On the page.** A custom report's provenance says it was solved live at its tier over n sampled flops of the
representative set, with each solve's distance from equilibrium and the iterations, and its flop model's abstraction
error from section 21. A Fast report also carries this comparison in its abstraction line (`FAST_VS_LIBRARY` in
`customReport.ts`): "EVs were 0.35% pot off a flop on average and in position's bet size split 16 points".

**Not established.**

- Other spots. Only BTN vs BB single-raised was compared. 3bet pots, shallower stacks and other positions may differ,
  most likely in the size split.
- Accurate against the library.
- The turn. A custom report stops at the flop.
- The browser's own numbers. The browser runs the same engine through Pyodide, and a solve's numbers don't depend on
  the threads, but this comparison ran natively. The browser checks (2026-11-13: 6-max 60bb CO vs BB, 9 and 25 flops, and
  40bb BTN vs BB, 9 flops, at Fast) stopped every flop at 300 iterations, 0.04% to 0.12% of the pot from equilibrium, as here.

## 25. Player profile re-solve (2026-11-13)

`engine/profile_solve.py` holds one player to an assumed profile at every decision of theirs and re-solves the other
player against it. The profile is derived from the equilibrium by a fixed, documented rule: at each of the profiled
player's decisions, the equilibrium's mix with the engine's `TendencyLock` laid on it (`gto/exploit.py`; folds move by
hand strength, their weakest calls folding first and their strongest folds calling first; bluffs move among their weak
hands; bets and raises scale every hand alike), each node's range being the one the profile itself brings there. Those
mixes are pinned with `engine/nodelock.py`'s pins and the rest re-solved by CFR on the same tree. With every decision of
one player held, the restricted game's equilibrium for the other player is their best response to the held strategy,
so the re-solve should equal a best response computed apart.

**What the figures mean.** *Convergence* is what the exploiting player's best response still gains against the held
profile, in % of the street's root pot: 0 once the re-solve is that best response. *Gap* is the re-solve's value against
an independent best response: the engine's best-response walk over the equilibrium solve's tree with `TendencyLock` laid
on during the walk, a code path apart from the re-solve's CFR and its pins. *Pins* compares that walk's best response
with the re-solve's own best response to its pinned strategy: it checks that the pins are the strategy the rule gives.

**Method.** `scripts/benchmarks/profile_bench.py`, through `slot.sh`, 34 s, raw numbers in
`scripts/benchmarks/results/profile.json`. Exact trees (every card dealt, per combo), pot 10, stack 40: two rivers
(`2c7d9hJsKd` at bets 50% and 100% with one raise, 5 profiled decisions; `Ah8d5c3s3h` at 33/75/150% with two raises,
9) and a turn with every river dealt (`2c7d9hJs`, bet 75%, 12 decisions and 13,920 to 18,705 pinned cells). Each spot
runs the four presets on both players, 64 runs in all.

**Measured [M]: every run within 0.0034% of the pot of the independent best response.**

| Spot | Iterations | Worst convergence (% pot) | Worst gap (% pot) | Worst pins (% pot) | Time |
|---|---|---|---|---|---|
| River, 2 sizes | 300 / 1,000 / 3,000 | 0.00047 / 0.00021 / 0.00015 | 0.00047 / 0.00021 / 0.00015 | 0.0000096 | up to 0.03 s |
| River, 3 sizes, 2 raises | 300 / 1,000 / 3,000 | 0.00091 / 0.00062 / 0.00032 | 0.00091 / 0.00062 / 0.00032 | 0.0000065 | up to 0.04 s |
| Turn, every river | 100 / 400 | 0.0034 / 0.0012 | 0.0034 / 0.0012 | 0.0000058 | up to 0.17 s |

- The gap tracks the convergence figure, as it should: the re-solve approaches the best response from below.
- The held player can't move: their best-response gain under their own pins is at most 0.0000061% of the pot.
- The check has power here: in every run the exploit beat the exploiter's equilibrium strategy against the profile by
  0.63bb or more (6.3% of the pot), so a re-solve that ignored the profile would miss by that much.
- Warm (from the equilibrium) and cold starts reach the same value (`test_profile_solve.py`).

**Spoiled on purpose.** The re-solve run with the wrong profile and checked against the right one (river, 2 sizes,
3,000 iterations, both players): all 8 caught.

| Fault | Gap (% pot), OOP / IP profiled |
|---|---|
| Calling station checked as Nit | +1.23 / -0.73 |
| Fold -20 checked as fold -25 | +2.00 / +1.94 |
| Bluff -50 checked as bluff -45 | -0.063 / -0.37 |
| The equilibrium (bet -1) checked as Calling station | +6.29 / +11.22 |

The smallest, five points of bluffing, is 0.063% of the pot, 200 times the worst gap above.

**The app's trees [M].** Through Study's request at the worker's Fast config (`scripts/engine/test_study_lock.py` FAST,
the engine natively, on a loaded machine), the values the panel shows, bb per pair dealt at the street's root:

| Spot | Exploiter at equilibrium | Their equilibrium strategy vs the profile | Re-solved exploit | Best response apart | Convergence | Time |
|---|---|---|---|---|---|---|
| River, BTN Calling station | 0.855 | 0.960 | 2.587 | 2.587 | 0.0004% | 3.9 s |
| River, BB Nit | -0.855 | -0.753 | 0.325 | 0.325 | 0.0004% | 0.1 s |
| Turn, BB Calling station | 0.367 | 0.570 | 2.795 | 2.795 | 0.0029% | 9.5 s |
| Turn, BB Calling station, from the flop | 2.115 | 2.403 | 4.674 | 4.674 | 0.0027% | 14.6 s |
| Flop, BB Calling station | 0.805 | 2.284 | 11.118 | 11.118 | 0.0004% | 1.3 s |
| Flop, BTN Maniac | -0.805 | 0.652 | 13.113 | 13.113 | 0.0002% | 1.1 s |

These are inside the abstract game each street's solve plays (buckets, card classes, its bet menu), so they say how close
the re-solve is to the best response *in that game*, not in the full game; the flop's abstraction error is section 21.

**In a browser, on the wasm core [M].** Study, 6-max 100bb, BTN opens and BB calls, `Kd7c2h5s9d` after a called flop
c-bet and a checked turn, BB to act, BTN held to Calling station at Fast: 300 iterations, 0.0004% of the pot left; BB's
exploit 2.61bb against 0.97bb for its equilibrium strategy and 0.86bb at equilibrium, and the best response computed apart
2.61bb; BB's 250% bet 0.0% → 27.3%. The turn `Kd7c2h5s` with BB held from the flop: flop re-solve 300 iterations
(0.0006%), turn 129 iterations in its 8 s budget (0.0061%), BTN's exploit 4.68bb against 2.41bb. Exploit practice against Calling
station at Quick: the flop's advice stopped at Quick's aim (10 iterations, 0.50% of the pot left), the turn's re-solved
on the flop and turn to 0.0000% in 257 iterations.

**Not established.**

- Profiles are heads-up, after the flop, cash only. "From the flop" holds the profile in every postflop solve of the
  hand; preflop the ranges are the equilibrium's (the charts or the preflop solve).
- The rule is one fixed derivation from the equilibrium. GTO Wizard describes its profiles as incentives the solver
  re-solves under, so the profiled player also adjusts; here they don't, which is what makes the answer the exploiter's
  best response, checkable as above.
- The equilibrium side is a live solve with the flop library left out, so it can differ a little from a stored flop
  answer shown above it.

## 26. The charts' multiway calls and short-stack jams out of order (2026-11-17)

A report: Study's BB over a CO open and a BTN call called T9o 3% but T8o 55-60% and J9o 45%. Charts source (the
default), not the preflop solve: every class's combos share one mix there, so it is not an aggregation or index error.
`scripts/engine/test_pf_mw_equity.py` holds what follows.

**Cause 1: multiway equity from one 400-board sample.** The chart's heads-up calls are re-drawn for the callers
(`Advisor._priced`) by each class's equity against both ranges, and continue frequency ramps over 2 points of it
(`PRICE_BLEND`). That equity (`_preflop_equity_multi_calc`) was a Monte Carlo average over the same 400 boards everywhere,
and a class's estimate moved 1.1-1.9 points from one sample to another (sd over 12 samples), as much as the whole ramp.
The fixed sample read T9o at 24.9% (12 samples: 26.6%) and T8o at 25.7% (24.4%), so at 100bb without rake the BB called
T9o 7.4%, T8o 36.3%, J9o 86.6%, 98o 0.4%. The same luck sits in every spot, so T9o fell below T8o in 11 of the 60
multiway spots swept (BB and SB over every open and call, 100 and 40bb, with and without rake).
Fix: control variates. The same boards' estimate of each villain's heads-up equity has the same luck and that equity
has a closed form (`pf_classes.equity_vs`), so each class's estimate moves by its regression on those errors
(`_multi_control`). Sample-to-sample sd 1.24 → 0.32 points (0.40 against three ranges); error against an independent
6,400-board reference 1.18 → 0.59 points RMS in four spots (the reference's own noise is 0.31). The BB now calls JTo
100%, J9o 92%, T9o 33%, T8o 0%, 98o 1%.

**Cause 2: a sliver of a flat weighed as a whole one.** A short-stack raise is a jam from the push/fold equilibrium,
against the hand's flat as its alternative (`_flat_ev`), and every hand the chart continued with at all took the whole
flat's EV. At 40bb over a UTG open and a HJ call the button's re-priced calls left A9s 0.6%, A8s 1.8%, A7s 0: A8s and A9s
were held to 1.4bb flats and folded, A7s jammed 87%. Fix: the flat's EV times how often the chart continues. Since
2026-11-18 (section 18.11) that is how often it flats, its raises left out (`engine/pf_charts.py` `flat_ev`): a hand
the chart only 3-bets counted a flat it never plays, so the 20bb small blind flatted 99, 88, AQo and AJs where both
class-level solves jam.

**Sweep, true dominance only** (same top card, next kicker; A6/A5 left out for the wheel): continuing 25 points or more
below the dominated hand, 19 cases before, 14 after, none of them T9o/T8o. (Same kicker over a higher top card, 74s
over 64s, is not dominance in a multiway pot and wasn't counted.) Of the 14: 7 are one marginal class jamming among
near-equal ones (A8s over A9s, A3s over A4s and A5s: the equilibrium jams the class whose jam beats its alternative,
A8s +0.02bb, A9s -0.34bb); 5 are K5s/K4s with the BB over an open and a small-blind call (K4s's equity is 0.6 points
above K5s's against those ranges in the larger sample; the fixed sample reads 1.2); 2 are the SB at 40bb, where the 40bb
chart itself 3bets K9s 78% and KTs 1% (the moves data: a pure class-level solve's bluff choice).

**Not established.**
- The class-vs-class equity table (`solver/gto/pf_equity.py`) is itself 3,000 random boards: against 60,000 boards an
  entry is off by 0.55 points (sd, up to 2.3) and whole rows by up to 0.5 (T9o -0.48, T8o -0.33, J9o -0.05). The
  correction above takes it as exact, so its error remains, and it feeds the heads-up re-pricing, push/fold and the
  class-level preflop solve. An exact table moves the stored preflop solves' model (a new model tag and a rebuild).
- The format charts' moves (`gto/pf_format_data.py`) carry the class-level solves' pure choices between neighbours.

## 27. One grading rule for every surface (2026-11-18)

An audit went over every place Lizard grades a decision: Practice, the live drill, Review's retries (asked again and
kept), Analyze and its leak drill, the stored flop drills, the preflop drill and PLO. What it found:

- **One answer, three verdicts.** The same river answer and pick (a live solve's 2% bet giving up 4.5% of the pot)
  graded through each surface's own path:

  | Answer | Practice | Live drill | Retry, asked again | Retry, kept | Analyze |
  |---|---|---|---|---|---|
  | Converged (0.25%) | Mistake | Mistake | Mistake | Mistake | Mistake |
  | Rough band (12%) | Mistake | refused | Mistake | Inaccuracy | Inaccuracy |
  | Short of target | Mistake | Inaccuracy | Mistake | Inaccuracy | Inaccuracy |
  | Ranges partly from the rules | Mistake | Inaccuracy | Mistake | Mistake | Mistake |
  | Rules fallback | Mistake | refused | Mistake | Mistake | not graded |

  A preflop-solve Blunder in Practice was an Inaccuracy in the preflop drill, which capped every grade.
- **A tie of 0.011bb, far finer than the answers.** Every answer but the preflop solve called a gap over a cent a miss,
  so the solve's own noise was graded as your mistake (below).
- **Words against the tables.** The "why" rounded to whole percents ("never plays this" beside 0.4%, "always" beside
  another action at 0.4%, "only 10%" on a grade below Correct); a 50/50 chart hand's other half was graded below Best;
  an action played 0% was named best over the hand's main play by a cent; a Correct printed its loss and added it to the
  score; Practice's range line called the class's average "your hand"; Analyze named the most frequent action best and
  sorted misses by raw EV; empty, NaN and all-zero answers threw or printed "?". A property check over random answers
  found 20 invariants broken.
- **Drill bets priced off the tree.** A library drill labelled "bet 33% (1.82bb)" where the tree bets 2bb (the solver
  rounds a bet to the half big blind, 1bb at least: `solver/gto/solver.py:1244`), and the pots and study links after it
  carried the difference.

**The rule [V].** Every surface now grades through `gradeAnswer` (`web/src/grading/grade.ts`) with what it knows of the
answer, built from the answer's provenance by `basisOf` (`web/src/grading/basis.ts`):

- **Noise.** The preflop solve keeps its own (section 18.8). Any other answer with EVs: at least 0.5% of the pot (the
  engine's own tie, `advisor.py` `BR_TIE_MIN`), at least twice the solve's measured distance from equilibrium, and for
  the flop library at least two stored EV steps (2% of the flop's starting pot). An action within the noise of the best
  is Correct, and past it only the excess is graded against the 2% and 8% thresholds. The EV given up is shown as
  measured.
- **Best.** Yours where it holds the top EV to 0.011bb; else, of the actions within the noise of the top, the most
  played, so an action played 0% is never named over one the hand plays that close. The EV lost is measured against the
  top EV (yours where you hold it, else the most played of the actions at it), and the words name that action, so the
  loss said is its EV less yours to the cent; where the best named differs, both are named, the best as the most played
  within the answer's noise of the top EV. Analyze's miss cards and tables add "(top EV raise)" the same way.
- **A rough move.** A move the engine marks `rough_ev` (the range at the node takes it under 1%, `advisor.py`
  `RARE_BRANCH`) has its measured error added to its noise: 6.0% of the pot at 100 iterations, 2.4% at 300, 1.6% at 400,
  0.6% at 1,000, between them by the log of the iterations (`grade.ts` `roughErrPct`; the mean gap of such actions'
  EVs to postflop-solver's on single-raised heads-up turns, `docs/cfr_research.md`). Past both, the excess is graded as
  any other. The stored flop drills mark rough the same way, from the range reaching the node (`drills.ts` `roughAt`),
  and so do Review's retries of a stored answer, so a drill and Practice grade a pick alike. The engine marks
  `rough_ev` on heads-up answers and on Study's 3-way reads (`advisor.py` `_postflop`, `_study_node`,
  `_study_mw_node`), not on 3-way advice (`_multiway_solve`), so a 3-way Practice answer's rare moves get no allowance;
  the library drills are heads-up (two seats), so no drill differs from Practice there.
- **What can't condemn a line.** Where the answer's error isn't measured the verdict stops at Inaccuracy and says why:
  the rules or equity fallback; a solve cut short before it measured itself; ranges that lean on the betting rules; a
  rough or short-of-target band; a read of another solution whose error is unmeasured. A filled range and a resolved rare
  line don't cap: the solve measured those. The preflop drill's blanket cap is gone, so its grades match Practice's.
- **A clear blunder still counts.** Past the noise, a loss of 20% of the pot or more is a Blunder even from an answer
  that can't condemn a line (`grade.ts` `CLEAR_PCT`), with its reason kept ("… but this gives up 39.2% of the pot past
  its noise, 20% or more: a clear blunder, graded as measured") and shown in Practice, the drills, Review, Analyze's
  miss cards and tables, the leak drill and PLO. 20% was set by judgment, not measured: it is well past the gaps
  measured between a quick answer and a reference (below: under 1.4% of the pot at the 95th percentile; a rough EV's
  mean error, 6% at 100 iterations).
- **Leaning on the rules: one test.** `provenance.ts` `leansOnRules`, kept on the provenance and read by `basisOf`: an
  opponent's rare line the rules read and nothing resolved, a range the rules widened, an earlier street narrowed by the
  rules, or one narrowed by a solve followed under half the time (`LEAN_TRUST`, 50); the answer's notes are read where it
  gives no structured flags. A narrowing followed half the time or more is said in the provenance label but doesn't cap.
  Before, any unsettled narrowing capped, whatever its trust.
- **The score.** A Best or Correct counts nothing, and a decision below Correct counts only what it gave up past the
  noise. Each decision still shows the loss as measured, labelled "within the answer's noise, not counted", "just past
  the answer's noise, too little to grade, not counted" (where the two rounded numbers read the loss larger but the
  excess is under 0.01bb or 0.1% of the pot), or "part of the hand's mix, not counted". The score's help says so, and
  History says its EV lost per stretch counted all of it before this date. Analyze's report totals (EV lost, mean per
  decision, by kind, the mistakes list and its order), its Winnings card and the Plan count the same past-the-noise loss
  (`report.ts` `countedBb`), and say so; a decision graded before this date counts all of it. The hands list's "EV lost"
  filter still searches each decision's loss as measured, the number the hand shows.
- **Words.** One decimal, as the tables; "never" and "always" only at 0.0% and 100.0%; frequencies within half a point
  of the top are all Best. Analyze's tables and miss cards use the grade's best and the noise. Practice's range line
  reads "AKo, all combos: … · your A♥K♦: … (graded on this)".
- **Retries keep the answer's basis.** Practice's "retry this spot" grades with the basis the spot was first graded on
  (`SessionRetry.tsx`), so a rough or capped answer grades the same the second time.
- **Drill bets** follow the tree's rounding everywhere a drill prices one (labels, pots, the hand so far, study links).

`web/src/grading/crossSurface.test.ts` grades one answer through all eight surfaces' paths and checks they agree on the
verdict, the cap, the EV lost and what the score counts. Each surface is driven through its own entry point, not a copy
of it: Practice's `practiceBasis` and `flopPotOf` (the flop's pot off the table), Analyze's `gradeDecision` on an
imported hand (the pot off the hand) with what it keeps, the drill's stored pot less the bet, the session retry's
`retrySpot`, and a PLO solve's own provenance (`ploRiverProvenance`, converged and cut short). `grade.props.test.ts`
checks 15 invariants over 12,000 seeded answers of every kind and the odd inputs.

**How the live noise was set [M].** Four heads-up turn spots (single-raised: BB first to act, BTN facing a check, BB
facing a bet; 3-bet: CO first), each solved at Fast (169-305 iterations, 0.09-0.28% of the pot from equilibrium; the
3-bet spot ran to 1,000 iterations, 0.01%) and at 1,000 iterations as the reference (0.01-0.02%). Every combo and action,
6,819 pairs. Fast's EV gap from an action to the best is off the reference's by 0.11-0.18% of the pot at the median and
0.32-1.09% at the 90th percentile, 2.3-3.9 times the solve's distance from equilibrium (95th: 0.42-1.39%, 3.0-5.0 times);
on actions either solve plays 0.5% or more, 0.11-0.12% at the 90th and 0.21-0.36% at the 95th. Fast's grades against the
reference's, each at its own noise (the first and third columns are shares of all 6,819 pairs, played or not):

| Rule | Fast below Correct | of them, the reference OK | Fast OK, the reference below | Played picks below Correct | Picks played 0.5-10% below Correct |
|---|---:|---:|---:|---:|---:|
| Before (0.011bb) | 60.5% | 5.3% | 1.0% | 2.6% | 20.5% |
| 2×, floor 0.25% | 55.9% | 2.7% | 1.3% | 0.8% | 6.4% |
| **2×, floor 0.5%** | **51.5%** | **5.0%** | **0.6%** | **0.5%** | **4.3%** |
| 3×, floor 0.5% | 51.0% | 4.5% | 0.9% | 0.4% | 3.1% |
| 2×, floor 1% | 45.3% | 3.2% | 0.7% | 0.2% | 1.2% |

(Played picks: actions Fast plays 0.5% or more, 2,569 of the pairs; 0.5-10%, 327.) Nowhere does Fast call OK what the
reference grades Mistake or worse. The verdict differs from the reference's on 9.3% of pairs against 7.4% before: the
new Correct/Inaccuracy line sits where Fast and the reference differ by a few hundredths of a bb. At these solves'
distances twice the exploitability is under the floor in three spots of four, so the floor does the work and the factor
of 2 moved nothing measurable (0×, 1× and 2× give the same table row to 0.1 point); the factor was set from the ratio
above, for solves further out.

**The flop library [M].** The library's own answers played exactly, 4-5 flops from each of its 22 spots (`index.json`;
multiway spots included), every node short of a raise (the first column weighted by how often a hand reaches the
node, the others counting hand and action pairs):

| Noise | Playing the stored mix, below Correct | Picks played 0.5-10% below Correct (20,862) | of them facing a bet (8,689) |
|---|---:|---:|---:|
| Before (0.011bb) | 0.23% | 30.5% | 46.8% |
| 1 step | 0.09% | 9.9% | 21.9% |
| **2 steps** | **0.04%** | **5.5%** | **12.7%** |
| 3 steps | 0.03% | 3.4% | 8.2% |

(Single-raised at 2 steps: 4.9% and 12.7%; 3-bet: 7.3% and 12.6%.) An equilibrium plays only actions of equal EV, so a
stored action's gap to the best is the library's own error. First to act, actions played 0.5-10% sit within one step
98.0-98.8% of the time and within two 99.5-99.9%. Facing a bet they sit further: a call within one step 65-79% and
within two 80-87%, a raise 84-86% and 92-93%, a fold 42-64% and 65-77%, an all-in in a 3-bet pot 6% and 16% (150
plays); the 90th percentile is 2-6 steps (12 for that all-in). Two steps covers nearly all of the first and most of the second, and what's
left past it is graded on the excess.

**Preflop [M].** Section 18.8's measure stands (the charts graded below Correct 7.4% → 1.4%); the drill now gives the
same grades.

**Fixes after review (2026-11-18) [M].** A review of the change found the caps too blunt and some surfaces still apart.
Measured after the fixes (`web/src/grading` tests; the scratch scripts graded through `gradeAnswer` itself):

- **Caps on 244 recorded Practice decisions** (real Advisor answers from three audit sessions: live solves, loose
  play, Quick on any spot; each of their 784 actions graded as a pick): capped 137 → 128 (leaning on the rules 98 → 89,
  as narrowings followed half the time or more no longer cap; the rules or equity fallback 39). Picks giving up 8% of
  the pot or more graded Blunder: 27 → 117 of 190; 20% or more: 10 → 89 of 89. Of the 73 picks past 8% still short
  of Blunder (63 Inaccuracy, 9 Mistake, 1 Correct), 37 lean on the rules, 25 are the fallback, 6 are inside a rough
  move's allowance and 5 inside the answer's noise.
- **Rough moves on the four live turns above** (2,435 picks of moves Fast marks rough, against the 1,000-iteration
  reference graded uncapped): the old cap at Inaccuracy agreed with the reference on 982, the allowance on 986. Of the
  reference's 51 Blunders the cap called all 51 Inaccuracy; the allowance calls 10 Blunder and 41 Mistake. Of its 1,183
  Mistakes the cap called all Inaccuracy; the allowance 580 Mistake, 462 Inaccuracy and 141 Correct. Where the
  reference calls a pick OK, the cap graded 95 below Correct and the allowance none. Over all 6,819 pairs, of the
  reference's 724 Blunders Fast gives 674 Blunder, 45 Mistake and 5 Inaccuracy, none capped.
- **The drill against Practice** on the same stored answers (`srp_hj_bb`, up to 400 flops, the first decision and
  facing a bet, every combo and action): 62,237 picks, 0 graded differently, against 5,430 before the drill marked rough
  moves.
- **One-off checks:** an unsettled narrowing followed 95% of the time no longer caps a clear blunder (it read
  Inaccuracy); a Correct whose loss reads larger than its noise by a rounding says "just past", not "within"; a loss is
  named against the action it's measured from; a Practice retry of a capped spot is capped again (it was graded
  uncapped); Analyze's totals no longer add losses its decisions label "not counted".

**Not established.**
- The live noise is measured on four heads-up turn spots at Fast, all within 0.3% of equilibrium. Solves further out
  (the fair band, 3-10%, where twice the distance is 6-20% of the pot), rivers, 3-way pots and Quick are unmeasured; the
  factor and the floor are tuned on those four spots, not derived.
- The library's two steps are measured on 4-5 flops a spot, and facing a bet a fold the library itself plays 0.5-10% is
  still past two steps 23-35% of the time.
- The clear-blunder line (20% of the pot past the noise) is set by judgment, not derived; between 8% and 20% an answer
  that can't condemn a line still stops at Inaccuracy (62 of the 73 picks above short of Blunder).
- A rough move's error is measured on single-raised heads-up turns (`solver/docs/cfr_research.md`); 3-bet pots ran
  lower (0.2-0.6% of the pot), rivers and the flop library's stored rare moves are unmeasured, and the allowance calls
  141 of the reference's 1,183 Mistakes among rough moves Correct.
- A 3-way answer marks no rough moves on the advice path, so its rare moves get no allowance in Practice.
- Decisions graded and kept before 2026-11-18 carry no basis; the leak drill still caps those by their old `capped`
  flag, clear blunders included, and Analyze's totals count all of their loss.
- History's EV lost before 2026-11-18 counted all of it, so an older stretch reads higher; the page says so.
- The cross-surface test drives each surface's grading code with one answer, not each page in a browser.

## 28. The 3-way library after a chart change, and Quick's 3-way answers (2026-11-18)

Measured natively on this Mac (no browser), through `slot.sh` beside two library builds, so the times are a busy
machine's. `scripts/engine/test_mw_near.py`, `test_mw_quick.py` and `scripts/library/test_published_fps.py` hold what
follows. `engine/mw_near.py` and `engine/mw_quick.py` run in the browser worker only (`scripts/pyodide/worker-edits.mjs`
imports them, as it does `tree_depth` and `bunching`). A local `python -m gto.server` answers as upstream does: these
four spots unread, and Quick's 3-way streets behind a bet narrowed by the rules.

**The 3-way library went unread.** A 3-way spot is found by the fingerprints of the three ranges its preflop line gives
entering the flop. b10afc8 (2026-11-17, section 26) moved the big blind's range in all four spots, so from then on no
pot matched one and every 3-way flop was solved live (Quick in its small game). Nothing said so.

The spots are now served as built (`engine/mw_near.py`). The ranges they were built on come from the solver at the
build's commit, 5b49b94 (2026-11-16): `scripts/library/mw_built_ranges.py` recomputes them offline, checks them against
the published fingerprints and writes `engine/mw_built.py`. A pot whose ranges are what the spot's own line gives today
reads the stored entries when today's ranges are near the built ones. Near means the three distances
(`flop_approx.range_dist`, 0-2; half of it is the share of weight that moved) sum to at most `NEAR_DIST` = 0.25, and
each built range holds at least `NEAR_COVER` = 0.9 of today's weight. Upstream borrows another table's pot at up to
0.5 (`MW_BORROW_DIST`); 0.25 is half again the largest move here (0.165) and well inside that.

| Spot | Range that moved | Distance | Weight moved | Cover |
|---|---|---|---|---|
| CO opens, BTN and BB call | BB | 0.150 | 7.5% | 96.6% |
| BTN opens, SB and BB call | BB | 0.144 | 7.2% | 98.5% |
| HJ opens, BTN and BB call | BB | 0.165 | 8.2% | 97.9% |
| UTG opens, BTN and BB call | BB | 0.142 | 7.1% | 97.7% |

The other two ranges of each spot are unchanged.

Priced as `solver/scripts/bench_mw_formats.py` prices a borrowed spot, on 6 stored flops a spot (KcTd5h, AcQd5h,
KcQcJd, QcTc3d, JcTd4h, AcJd3h). Each seat's first decision with checks in front of it gives 72 decisions. Today's
ranges were solved on the library's game until settled (300-400 iterations, 0.05-0.10% of the pot from equilibrium).
Each mix was then priced by that solve's EVs, as the share of the pot it gives up:

| Mix played | Mean | Max |
|---|---|---|
| The stored entry, as built | 0.010% | 0.044% |
| The live Fast solve at 200 iterations (what answered without the library) | 0.057% | 0.16% |
| Floor: the built ranges' own re-solve against the entry | 0.0001% | 0.005% |

By spot, the stored entries' means are 0.0098-0.0108%. Only first decisions behind checks were priced, not lines with
a bet or raise in them, and only 6 flops a spot.

The answer carries `precomputed.borrowed` with `built` ({commit, date, seats, pot_seats}). Its text reads, for example,
"this spot as built on the charts of 2026-11-16, which have changed since: BB's range differs from this pot's by 7.5% of
its weight; CO and BTN's are the same". It names the pot's seats. HJ's open called by CO and BB reads the HJ, BTN and BB
spot, and its text ends "HJ and CO's are the same; CO sits where the spot's BTN did". The web's badge is that text
(`provenance.ts` reads `built`; another table's spot still reads "another table's spot read as this one (...)"). The
answer is approximate. The stored solve's iterations and distance from equilibrium aren't shown, since they were
measured on the built ranges. Its mix and per-action EVs are shown, and graded, as stored, and every surface grades it
as a read of another solution (section 27): a verdict stops at Inaccuracy short of a clear blunder (20% of the pot past
the noise), and says why (test `provenance.approxReason.test.ts`).

`scripts/library/test_published_fps.py` recomputes every published spot's fingerprints (53 heads-up, 4 three-way) from
today's code in under a second, so CI fails a chart change that moves a spot. The four stale spots are held to today's
fingerprints, and must stay within `NEAR_DIST`. The rebuild on today's ranges is written, not run
(`docs/DEPLOYMENT.md`, "Rebuilding the 3-way spots after a chart change"). One entry took 16 s and 0.52 GB (300
iterations, 0.086% of the pot), so all 7,020 come to about 38 CPU hours.

**Flop lines the library stores in part.** A stored 3-way flop holds only the first decisions behind checks (the
street's start, after one check, after two). Once someone bet before your decision, the walk through the stored solve
met a line it doesn't hold. Upstream then narrowed the whole flop by the betting rules, at both speeds: the library's
answer stood in for the street's solve, so the solve from the street's start that any other 3-way flop gets never ran.
Now the street is walked again with the library set aside, and solved from its start as a pot outside the library is
(`engine/mw_near.py`). Six-max 100bb, BB's decision after a bet and a call:

| Decision (BB's) | Before (Quick) | Now, Quick | Now, Fast |
|---|---|---|---|
| Qs7s6d, UTG opens 2.5, BTN and BB call; BB checks, UTG bets 4, BTN calls. Kh7h | 0.92 s, the rules; fold | 3.2 s: 51 iterations, 1.7% of the pot, followed 72%, 2.0 s; fold (raise -2.19, call -2.83) | 9.7 s: 117 iterations, 0.6%, followed 98%; fold (raise -3.99, call -4.27) |
| Kd7s2c, CO opens 2.5, BTN and BB call; BB checks, CO bets 4, BTN calls. QhJh | 0.61 s, the rules; fold | 2.3 s: 100 iterations, 0.5%, followed 100%, 1.7 s; fold | 9.0 s: 206 iterations, 0.2%; fold |

The answers didn't change here; the ranges under them did. A decision whose line the stored solve holds (BTN's after BB
checks and UTG bets 4 on Qs7s6d) is still narrowed through it, at no added time (1.8 s at Quick).

**Later streets narrowed through a spot served as built.** That BTN decision stood on the stored solve's ranges, built
on the old charts. So does any turn or river after a flop line the library holds. The answer itself was a live solve,
and nothing said so. Now the narrowing note names the spot as built ("ranges narrowed through the precomputed 3-way
solve of this spot as built on the charts of 2026-11-16 (...)", or "through the solve your advice came from, the
precomputed 3-way solve of this spot as built ..." when your flop advice was the library's). The answer carries
`ranges_built` (street, spot, commit, date, distance, cover and text), `solver.approximate`,
`solver.approximate_reason`, and a note that starts "Approximate: the ranges through the flop come from the
precomputed 3-way solve of this spot as built". The web shows the answer approximate today (the band). It shows the
reason once it reads `approximate_reason` or `ranges_built`. Checked at both speeds on BTN's decision above (distance
0.142) and on BB's turn after CO's open is called and Kd7s2c checks through (0.150).

**Quick 3-way streets behind a bet.** Before, when someone bet or raised before your decision on a 3-way street, Quick
narrowed that street by the betting rules alone; Fast solves it from its start (`mw_current_solve`, section 26's
Qs7s6d). Now Quick solves it too (`engine/mw_quick.py`), in Quick's own small game (6 buckets on the flop, 8 on the
turn, the river's own game). The solve runs for at most 2.0 s on the flop, 1.5 s on the turn and 0.6 s on the river. It
stops early once the narrowing would follow it fully (0.5% of the pot on the flop, 2% on the turn and river), checked at
25, 50, 100, 150, 200, 300, 400 and 700 iterations. The node's own solve keeps its whole budget after it.

That first version broke Quick at narrowing budgets of 1.2 s and up. Upstream's build deadline for a Quick 3-way solve
(0.75 of 1.8 s from the request's start) passed during the narrowing, so the rules answered. The deadline now counts
from the narrowing's end. The narrowing solve's own game is built against a deadline too: 0.75 of its seconds
(`MW_QUICK_BUILD`, upstream's share for a Quick solve). A game not built by then leaves the street to the rules, and a
note says so ("a quick answer's narrowing solve of this street wasn't built in 1.5 s, so the betting rules narrow it").

The library's spots are now narrowed through their stored solves (above), so this was measured on pots outside it: UTG
or CO opens to 3 rather than 2.5, BTN and BB call. Six-max 100bb, after a warm-up request, two runs each (the times are
the runs' range):

| Decision (BTN's) | Answer time, before → now | Narrowing solve | Answer, before → now |
|---|---|---|---|
| Qs7s6d, UTG opens 3; BB checks, UTG bets 4.5. Kh7h | 1.0-1.2 → 3.3 s | 79-85 iterations, 0.8-0.9% of the pot, followed 92-94%, 2.0 s | raise 100% (+0.25bb, call -1.81) → fold (raise -0.65 to -0.69, call -1.27; Fast folds too) |
| Kd7s2c, UTG opens 3; BB checks, UTG bets 3. KhQh | 0.6-0.7 → 2.8 s | 145-148, 0.3%, 100%, 2.0 s | raise 100% (+15.48, call +14.42) → call 100% (call +18.55, raise +18.35; Fast calls) |
| 9h8d3c, CO opens 3; BB checks, CO bets 3.5. Tc9c | 0.8 → 3.0 s | 100, 0.5%, 100%, 1.6 s | raise 100% → raise 100% (Fast raises) |
| Turn 2h after the flop checks through; BB checks, UTG bets 7. Kh7h | 0.3 → 1.8-1.9 s | 50, 1.2%, 100%, 1.3 s | raise 100% → raise 100% (call -0.41 → +1.17) |
| River 4c after the turn checks through; BB bets 6, UTG calls. Kh7h | 0.04 → 0.14 s | 25, 1.1%, 100%, 0.1 s | raise 100% (+1.38, call +1.11) → raise 100% (+0.39, call -1.04) |

So outside the library a Quick 3-way decision behind a bet takes about 2.1-2.3 s longer on the flop, 1.5 s on the turn
and 0.1 s on the river. On the flop that is three to four times the time it took before. This wasn't measured in a
browser. The narrowing stops on time, not
at a number of iterations, so a slower browser should add about the same time and run fewer iterations. Those leave
it less settled and followed less (`trust_of`), and the note says by how much. Upstream measured a 3-way flop solve in
the browser at about native speed (`advisor.py` above `MW_FAST_STREETS`: 203 iterations in 8 s against 111-125 in
5 s natively on a loaded machine), so a browser 2-3x slower is the worst case. Peak RSS over these requests (one
process each, `cache_mb` 400) rose from 308-347 MB to 308-408 MB; the Fast library-line requests above peaked at 703 MB
over 11 requests in one process. The narrowing solves sit in the worker's 3-way cache under `cache_mb`. 4-way and larger
streets are unchanged (upstream solves only 3-way streets from their start), so the 1.36 GB a 4-way Quick turn reached
in the audit is untouched.

**Fast after Quick at the same node stood on the rules.** The hand's 3-way solves are kept by their place in the hand,
not by mode. A Quick answer stored its node solve there, and a Fast request at that node then took it as its own line
and skipped the street's narrowing. On the turn decision above, Fast after Quick answered in 0.67 s by the rules. Now
it narrows through a 183-iteration solve (0.1% of the pot) in 9.3 s. On the Qs7s6d flop, Fast after Quick raised K7s
100% (+0.89); now it folds, as a fresh Fast request does. A Quick request's keys now carry the mode. The street being
advised on never takes the node's own solve for its narrowing, so a repeated request narrows as the first did.

**A rare earlier line at Quick.** After a line an earlier heads-up street's solve rarely takes (3% or less), Fast solves
the street again from that node; Quick used the rules' range. Quick now re-solves too, for at most 0.5 s. That reaches
a library flop, or a street already solved in the hand; a street Quick doesn't solve keeps the rules and says so. The
re-solve is kept only when the narrowing would follow it fully (`trust_of` 1: 0.5% of the pot on the flop, 2% on the
turn and river). One short of that, which a slow device's 0.5 s can be, is dropped: the rules' range stays, and
`off_solution` doesn't call the line resolved. Two
library-flop lines (BTN's 33% bet on Qs8d4c, which the stored solve plays 3%; BTN's 33% bet on JhTc4s before a
check-raise, 0%) were re-solved in 300 iterations. The answer took 1.94-1.96 s instead of 1.86, and 1.92-1.93 s instead
of 1.87. The node's own solve ran 81-91 iterations instead of 105 (0.46-0.54% of the pot instead of 0.26%), and 74-76
instead of 83 (0.77-0.82% instead of 0.48%). The Qs8d4c answer still checks; the JhTc4s one moves from bet 75% 57% to
bet 33% 53%. Rechecked with that gate, the Qs8d4c line's re-solve reached 0.04% of the pot in 300 iterations and was
kept; the answer took 1.87-1.89 s over three runs and still checks.

**Quick's 3-way flop game is small.** A Quick 3-way flop is solved with 6 hand buckets a player on the turn and river
and one bet size of half the pot. Upstream measured those buckets' values 5.3-10.9% of the pot from a 32-bucket
game's, against 2.2-3.1 for Fast's 12. Its distance from equilibrium is measured in that small game, so a full run read
"converged". The answer now carries `solver.approximate` (the provenance band "approximate"), `solver.approximate_reason`
and a note that starts with "Approximate: a quick answer's 3-way flop is solved in a small game". The reason is there
because the answer has no `target_pct`, so the band's "short of its target" reading doesn't fit it. The web keeps it
(`Provenance.approximateReason`), says it in the approximate label, and a grade on the answer stops at Inaccuracy short
of a clear blunder with that reason ("This answer is approximate: a quick answer's 3-way flop is solved in a small
game ..."), not "short of its target" (`grade.ts` `capGist`; test `provenance.approxReason.test.ts`). The same goes for
a later street narrowed through a spot served as built (`ranges_built`). Quick's 3-way turn game (8 buckets) isn't
marked.

## 29. Practice's Quick grades re-checked at Fast (2026-11-18)

Practice plays at Quick unless the setting is Accurate (a Fast setting plays Quick's budgets after the flop, as the
classic trainer does). Quick's answer is a shorter solve. Advisor's own measure over 1,000 hands against Fast gave the
same grade 88% of the time for a Quick solve within 1% of the pot (settled), and 62% for nearest-flop and
earlier-street reads (section 3, and FEATURE_MATRIX's Decision grading row). An unsettled Quick solve and the betting
rules weren't measured. So a settled Practice grade at Quick reads differently at Fast about one time in eight; for the
rest the rate isn't known.

**What changes.** While the solver has nothing else to do, the Room asks each graded decision of this session again at
Fast and grades your same move against that answer (`web/src/features/practice/recheck.ts`, `room.ts`). It goes
through the one grading entry point every Practice grade uses (`practice.ts` `decide`, so `gradeAnswer` on
`practiceBasis`), on Fast's answer with Fast's own provenance: mode `fast`, its distance from equilibrium and band, its
caps. Fast's grade then replaces Quick's in the decision and its hand, the session's score, cells and sources,
History's record, the table's tally, Review's list, Retry and Copy for AI. The decision keeps what Quick said (`quick`:
verdict, best action, EV lost, source), so those surfaces say "Re-checked at Fast: Mistake → Correct" or "Re-checked at
Fast: same grade", and the sentence beside it names each answer by its source: "a Quick solve" or "the Fast solve" only
for a solve, otherwise what it was ("Quick's answer, Heuristic rules (not a solve)"). How settled Fast's solve is, is
its band's to say (the badge: "(converged)" under 3% of the pot, as for any answer); the sentence says Fast's is a short
solve too and points to the badge, never "converged" or "not converged" by itself. A retry of a re-checked spot is
asked at Fast at least (`retry.ts` `askedAt`), and a retry open when its decision's re-check lands starts again at
Fast, so a Quick answer never stands beside a Fast grade. A kept miss moves with the grade: still a miss, the same
record gets Fast's answer and grade (`recheckedMiss`); now Best or Correct, the miss is taken back from the record it
went into, found by id or, as `keepMistake` found it, by spot (`data/mistakes.ts` `takeBackMiss`, `takenBack`). The
record goes where that miss was its only one; where it went into an earlier record, that record comes back as it was
before (`prior`, which `missedAgain` keeps beside a Practice miss at Quick), with any retries made since. A record
whose only miss it was but that you've retried keeps it as it was. The Review page's queue shows a re-checked miss with
Fast's provenance, without the "Re-checked" words.

**What isn't asked.** Anything Fast answers the same way: the charts, the preflop solve, push/fold, the library's own
spot (a borrowed one is approximate and is asked), and the betting rules where Fast also leaves the spot to them (five
or more players in before the river, six or more on it). Nor a decision after Reveal, off a read's profile, ungraded,
partial, or answered at Fast or Accurate already. Nothing is re-checked in Accurate, nor with the setting off
(Settings, "Re-check Quick grades at Fast when the solver is idle", on by default), nor where a stop isn't cheap. A
Fast answer that falls back to the betting rules or an equity estimate where Quick's answer didn't isn't taken: the
decision is marked with why, and Quick's grade stands.

**Order and priority.** Only hands that have ended are asked. Quick and Fast share one Advisor and its solve cache, and
a solve's key has no budget, so Fast's request for a hand still played would find that hand's Quick street solve and
run it on, and the hand's later streets would then read a different solve (measured natively by the reviewers: the
turn spot's call EV went from -2.68 to -5.22 and it was solved again). Order is hand by hand: the hands with a flagged
read first, as Analyze's triage checks its flagged reads first (below Correct or capped, rough or approximate, leaning
on the rules, low confidence, or 2% of the pot given up: `triage.ts`'s `DEEP_LOSS`, held equal by a test), then the
other hands, each the latest first, and a hand's decisions in street order, as Analyze asks them, since a flop's solve
narrows its turn (`recheck.ts` `recheckQueue`); at most 60 wait, the oldest hands dropped. A re-check is the
scheduler's lowest group (`scheduler.ts` `RECHECK`, below your spot, a short or long one and every look-ahead). A new
one starts only while no table has anything coming on its timer and every table is between hands or has waited for you
at your turn for 5 s (`RECHECK_IDLE`): a move of yours stops it, and what the move asks waits for that stop (about
0.1 s on the worker, more where the solver doesn't read the stop flag). It's stopped the moment anything else wants the
solver, then asked again later. One that fails for its spot, or that something outside the Room cancels twice, is
marked (the decision keeps why: "Not re-checked at Fast (...): this grade is on ...") and never asked again. A solver
that can't be reached, or a worker that didn't start, says nothing of the spot: every re-check waits, unmarked, and
none goes until a table's request has an answer ("Re-checks at Fast paused" in the score strip).

**What it doesn't do.** The backlog is in memory: a reload rebuilds it only from the hands still on the tables (above
one table), so older hands of a reloaded session keep Quick's grade. Its counts (done, changed, couldn't be graded) are
kept with the session (`session.ts` `rechecked`), so a reload above one table keeps them. A re-check run while you
think at your turn adds Fast's solves to the cache the tables share (700 MB in the worker, least recently used out
first, the latest two always kept), so under memory pressure it can push out an earlier street's solve of the hand in
play, which that hand's next street would then solve again or narrow by the betting rules (traced in `advisor.py`
`_keep`, not measured). A hand kept in Analyze holds the moves and cards, not the grades (`practice/history.ts`
`practiceRecord`), so it has nothing to update and is never kept twice. Measured only on a fake client (tests
`recheck.test.ts`, `room.test.ts`, `scheduler.test.ts`, `session.test.ts`, `grade.test.ts`, `SessionRetry.test.tsx`,
`data/mistakes.test.ts`): how often Fast changes a Practice grade on the real worker, and how many re-checks a session
gets through, are not yet measured. The QA sweep's native measure of the same question, each answer asked in its
hand's context, is section 30: the move made got the same verdict at Quick and Fast 90.7% of the time at live nodes.
Checked once in a browser on the real worker (2026-11-18, 3-max single-raised pot): a turn call graded by a live
solve waited as "Re-checking at Fast: 1 left" until the hand ended, then both postflop decisions were re-checked
("Re-checked at Fast: 2 done"), the river's Blunder reading "Re-checked at Fast: same grade" with Fast's EVs.

## 30. Quick against Fast and Accurate in Practice (2026-11-18)

The Practice QA sweep (`docs/QA.md`, seed 1, natively through `slot.sh`) asks a sample of your postflop decisions again
at Fast, and a few at Accurate, in a process of their own that is first asked the hand's earlier requests at that speed,
then grades every action of the decision by both. Measured after the day's fixes, on the harness that asks each
reference in the hand's context. A reference whose context was lost on the way (the solve cache evicted a 3-way street
it narrows through, or its rules-narrowed streets aren't among Quick's) is left out (`ref.context`, 4 in the matrix),
and one without the move Quick graded (`ref.missing`, 3: Fast had no 50% bet where Quick's small 3-way flop game offers
one) has nothing to compare. Where either answer was a live solve:

| Run | Reference | The move made: same verdict | Every action: same verdict | Same side of Correct | Quick condemns what the reference passes | Quick passes what it condemns |
|---|---|---:|---:|---:|---:|---:|
| Default matrix (21 configs, 324 hands) | Fast | 97/107 (90.7%) | 333/378 (88.1%) | 351/378 (92.9%) | 2 (0.5%) | 2 (0.5%) |
| | Accurate | 4/5 | 8/16 | 13/16 | 0 | 0 |
| `--quick` (4 configs, 42 hands) | Fast | 14/14 | 49/55 | 50/55 | 0 | 0 |

(Library flops included, the matrix's moves agree 124 of 134 times at Fast, 92.5%, and 6 of 7 at Accurate; `--quick`'s
26 of 26 at Fast and 2 of 2 at Accurate, both of those at library flops.) "Condemns" is a Mistake or Blunder against a
Best or Correct. So Quick and Fast give a different verdict to about one action in eight at a live node and one in
fourteen crosses between Best/Correct and the rest, mostly Best or Correct against Inaccuracy. The four crossings were
at three nodes: a 125% river bet in a heads-up 100bb limped pot (Quick Best, Fast Mistake), a 6-max 200bb river 33% bet
neither plays (Quick Correct, Fast Mistake), and two turn bets in a 6-max ante pot (Quick Mistake, Fast Correct; EVs
1.14 and 1.07 against 1.40 and 1.33).

The triage's three serious flips (6max-100bb-loose-any hand 9: QsQd facing a 3-way turn bet, Fast fold Best and call
Blunder against Quick's call Best) were the harness, not Quick: the Fast reference was asked cold, so the rules narrowed
the hand's flop. Asked in context, Fast says call Best, as Quick does. Nothing in Quick was changed for it; Practice's
re-check of Quick grades at Fast (section 29) is not part of these runs, which ask each reference in its own process.

**Not established.** One seed: 107 moves at live nodes against Fast and 5 against Accurate, so a rate of 0.5% each way
is two decisions. The times are native; Quick stops on a time budget, so in a slower browser it runs fewer iterations
and may part from Fast more often than this. Library flops agree by construction (both read the same entry) and are
counted only in the bracketed totals.

## 31. The class equity table enumerated exactly; preflop model lz4 (2026-11-22)

Section 26 left one cause open: the 169x169 all-in equity table between hand classes (`solver/gto/pf_equity.py`) was
3,000 random boards. It feeds the charts' heads-up and multiway re-pricing (`pf_classes.equity_vs`, the control
variates' target), push/fold, Lizard's class-level preflop solver (`engine/pf_solve.py`) and the tournament solver
(`engine/pf_icm.py`).

**The table.** `solver/scripts/build_preflop_equity.py exact` (declared in `solver/UPSTREAM.json`) sums every board: the
134,459 boards distinct up to a relabelling of the suits, each weighted by the number of boards it stands for. A
relabelling maps each class onto itself, so a class pair's sum is the same on all of them (a single combo pair's is not,
and the builder checks the class sums of live boards, C(48,5) per pair of combos that don't share a card). About 7
minutes. Checked by brute force over all 1,712,304 boards of the remaining cards: AKs vs QQ 46.049% and T9o vs 87s
62.121%, both equal to the table. Known values: AA vs KK 81.95% (old table 82.31), AKo vs QQ 43.24% (42.71). The old
table was off by 0.68 points RMS and 2.44 at most.

**The model, lz4.** The calibrated flop values (`engine/pf_calib.py`) are unchanged; the stored grid (132 games,
`engine/pf/lz4_*.bin`) was re-solved on the new table: 10,966 s, mean 0.51 mbb/hand a seat (lz3 0.56), the highest the
6-max 40bb game at the charts' 3bet size, 1.507 (1.524). Against the published 6-max 100bb solves at their rake
(`scripts/pf/calibrate.py eval`, 700 iterations, the same parameters): 1.96 points, 5 of 26 spots out, 11 of 15 hand facts
off, 1 hand out of order facing a 3bet; the same run on the old table reproduces lz3's 2.01, 6, 11 and 3. Held-out error
not measured again. First-in raises at 6-max 100bb move by at most 1 point (the SB 48.6 -> 47.9% without rake).

**Hand order facing a 3bet** (`engine/pf_order.py`, stored 6-max 100bb): 2 out of order without rake (lz3 3) and 7 at 5%
capped at 3bb (lz3 4), none of them pairs. All 9 are suited aces from A7s to ATs facing a blind's 3bet, choosing between
a 4bet bluff and a fold whose EVs are within 0.1bb (raked, HJ vs the BB: A7s 4bets 99% at +0.07bb, A8s 55% at +0.03, A9s
51% at -0.01). That is a choice among near-indifferent bluffs, which the class-level model plays one way per class where
a solve mixes; the test's bound (`test_pf_engine.py` `MAX_OUT_OF_ORDER`) is 7 now, with that reason beside it.

**The charts' multiway calls** (section 26's sweep, true dominance, today's code with each table): 18 cases on the old
table, 17 on the exact one. The K5s/K4s cases (the BB over an open and a small-blind call) are gone. What remains is not
the table's: the SB over a UTG open and a call, without rake, folds JTs and calls J9s 24% on the old table and 33% on the
new, and calls Q9s over QTs; the chart and its no-rake move (`gto/pf_norake.py`) do that on either table.

**The charts against the published spots** (`solver/tests/preflop_refs.py`, through the re-priced advice): on the exact
table the big blind defends 0.5-1.1 points more against every open (BB vs UTG folds 75.6%, was 76.3%; published 78.6%),
and the mean error over the certain references goes from 0.96 to 1.14 points. Two shares now sit past their tolerance by
under half a point (BB vs UTG open 3.04 points off within 3; BTN open vs SB 3bet 4.35 within 4), and the raked BB's Q9o
against a button open continues 52% (was 33%; published 27%, bound 50%), at the edge of the re-pricing's ramp. The
re-pricing is quantile-based (`Advisor._priced`): nothing in it was fitted to the old table's numbers that could be
re-fitted alone, so it is left as it is and the test names these three (`test_gto.py` `OVER`, the Q9o bound 0.55).

**Tests whose numbers came from the old table** (each with its reason beside it): the push/fold and tree solvers part on
one class at 5bb heads-up (96o mixed 16% against 75%, both converged; bound 1 point of the range, as the test's second
check); at 40bb the button jams one marginal suited ace among near-equal ones (A7s now, A8s before; at most one of
A7s-A9s); `3bp_bb_btn`'s A2o past the range's edge is 2.1 points of flop share over A3o (1.5 before, the gap 2); the
chart nodes feeding library spots hold 24 inversions (the 200bb big blind's weakest suited hands); upstream's t^8
averaging is compared with t^3 at 200 iterations (at 120 it sits on a bump of the new game's descent); its 2-way game
reaches 0.64 mbb at 600 iterations (bound 0.7, was 0.6); the off-path fill takes the 20bb SB's AJo jam-call gap from
0.505 to 0.332bb (0.02bb past the noise; the grade stops at Inaccuracy, the chart calling).

**The tournament presets** (`engine/pf_icm/*.bin`, 115 games) were solved again on the new table under keys tagged `cal2`
(`pf_icm.FLOP_MODEL_TAG`, `MODEL_DIGEST` 7ab4dad9426f). `scripts/pf_icm/build_stored.py all --missing` had skipped every
game, as it compared each game's request and not its key; it now compares the key too.

**The published library spots.** The new table moves the 200bb big blind's range at its edge (K5o, 83s, T2s, 93s,
74o, K3s, J8s), so all four published 200bb spots (srp BTN, CO and SB vs BB, the BB's 3bet of the BTN; built
2026-11-13 to 16) no longer match the fingerprints the library finds them by; no other heads-up spot moved. Each
range moved 0.0-1.2% of its weight (range_dist 0.000-0.024; each spot's two sum to 0.0015, 0.0028, 0.0223 and 0.0239),
and every built range holds all of today's. Rebuilding them is the depths build's 200bb batch, about 18 hours on a
heavy slot at 1.5 GB a worker (over the 1 GB a process the gtosolver builds leave). Instead `engine/hu_near.py` serves
such a spot as built, as `engine/mw_near.py` serves the 3-way spots: today's ranges of the spot's own line read its
entries through upstream's own borrowing (`flop_approx.near_exact`, within its bars `NEAR_EXACT_COVER` 0.97 and
`NEAR_EXACT_DIST` 0.6), labelled approximate with the difference ("this spot as built on the charts of 2026-11-16, which
have changed since: BB's range differs from this pot's by 1.2% of its weight"). The built ranges are
`engine/hu_built.py`, recomputed at eca8152 by `scripts/library/hu_built_ranges.py` and checked against the published
fingerprints. The four 3-way spots, already served as built, moved again and stay inside `mw_near.NEAR_DIST`;
`scripts/library/published_fps.json` says why for all eight.

**Not rebuilt here.**
- The four 200bb library spots (above): served as built until the 200bb batch is rebuilt.
- `solver/gto/pf_norake_data.py` (the no-rake move, `MODEL = 'lz3'`) is from lz3's solves; its builder isn't in this
  repo. It moves the charts by no-rake/raked ratios, which the table's error enters on both sides.
- The format charts' moves (`gto/pf_format_data.py`) and upstream's two stored files (`gto/static/pf/`) are from solves
  on the old table; upstream's model grid (`engine/pf/` without a tag) is no longer reached (cash goes to
  `engine/pf_solve.py`, tournaments to `engine/pf_icm_study.py`).
- Sections 18.8 to 18.11 measured grades on the lz3 grid and were not measured again.

## 32. The format charts' moves smoothed along hand families (2026-11-22)

A report: 6-max 40bb, the small blind facing a HJ open 3bet K9s 78% and KTs 1%, and called QTs 41% where Q9s 3bet 39%.
The format charts (other depths, antes, 7 to 9 players, a straddle, heads-up) are the 100bb chart plus a per-class move,
the format game's class-level solve minus the 100bb one (`solver/gto/pf_formats.py` `moves`/`apply`, data
`gto/pf_format_data.py`, built by `solver/scripts/build_pf_formats.py`). Among near-indifferent bluffs a class-level
solve plays each class purely and picks which one arbitrarily, and the two solves pick differently, so the difference
flips sign between neighbours (K9s +0.78 raise, KTs 0).

**Sweep** (`scripts/engine/pf_format_inversions.py`): every heads-up chart line of every format game (raise first in,
facing an open, the opener facing a 3bet, the 3bettor facing the 4bet, the opener facing the 5bet; 691 decisions), as
upstream's `preflop.strategy_for` serves it, counting a weaker class continuing 25 points or more more often than the
one dominating it (the next kicker up with the same top card, A5/A6 left out; the suited twin; the next pair up).

| game | decisions | before | after |
|---|---:|---:|---:|
| 6-max 20bb | 41 | 22 | 7 |
| 6-max 40bb | 50 | 28 | 18 |
| 6-max 60bb | 57 | 26 | 4 |
| 6-max 20bb ante | 41 | 53 | 10 |
| 6-max 40bb ante | 50 | 76 | 51 |
| 6-max 100bb ante | 65 | 63 | 6 |
| 7-handed 100bb | 86 | 11 | 2 |
| 8-handed 100bb | 107 | 32 | 24 |
| 9-handed 100bb | 128 | 42 | 31 |
| 6-max straddle | 54 | 57 | 5 |
| heads-up 20bb | 3 | 17 | 10 |
| heads-up 40bb | 4 | 10 | 0 |
| heads-up 100bb | 5 | 9 | 9 |
| total | 691 | 446 | 177 |

13 of them are in the 100bb chart the moves are added to, before and after; all are kicker steps. 271 went, 175 stayed,
2 are new (K7s over K8s, the SB facing a BTN open with the ante, at 40 and 100bb).

**Fix, in the build.** Each decision's per-class move is replaced by its family's around it before it is encoded
(`build_pf_formats.py` `family_smooth`, `SMOOTH = 1.0`): pairs form one family, and each high card's suited and offsuit
hands by kicker one each, and the move is a Gaussian-weighted average over one kicker step (weights 1, 0.61, 0.14 for the
class, its neighbours, theirs), weighted by how often the class reaches the decision in both solves (the move's existing
reach guard), then multiplied by that guard as before. The value hands (JJ, QQ, KK, AA, AKs, AKo: `VALUE`, each the top of its
family) are left out of the families, keeping their own moves and lending none: their move is no pick among
near-indifferent neighbours, and smoothed with them a first build moved a premium's action 25 points or more 615 times
over the sweep's decisions (the 9-handed UTG facing a squeeze raised AKs 31% and flatted 65%, taking AQs's flats, where
it had raised 100%; `scripts/engine/test_pf_charts.py` HandOrder caught it); now none. Nothing is hand-edited; unsmoothed (`SMOOTH = 0`) the build from
the same solves is byte-identical to the shipped file. The known case: KTs 3bets 20%, K9s 35%, K8s 26%; QTs calls 17%,
Q9s 3bets 6% and calls 10% (the range raises 7.2% and calls 3.2%; before, 7.5 and 3.2).

**Solves used.** The format games' class-level solves of 2026-10-29 (the shipped file's own), on the old 3,000-board
equity table: the moves come from their stored strategy sums, so the exact table of section 31 does not enter a rebuild
without re-solving. No 8-handed solve of today's tree is on disk, and re-solving it needs about 3 GB (stopped at 2.9 GB,
over the 1 GB a process the gtosolver builds leave), so the stored 8-handed moves are kept and smoothed once with unit
weights (`--keep players:8 --smooth-kept players:8`; never pass `--smooth-kept` again on a smoothed file).

**Held decisions.** The published flop library's spots at 40bb, heads-up and 8 players take their ranges from these
moves (`engine/pf_charts.py` `PUBLISHED`), and their flops were solved on the old ranges
(`scripts/engine/test_pf_charts.py` LibrarySpots checks the fingerprints); smoothing moved 16 of them. So every move
entry read on a published spot's line, for a player who reaches the flop, keeps its old move: 38 decisions (40bb 11,
the same 11 with the ante, 8 players 14, the heads-up limp 2), listed by `scripts/pf/format_held.py` and passed as
`--hold`. A held 40bb decision holds its ante move too, since the chart with the ante adds both and their pure choices
cancel only while both come from one build (holding the depth alone made 9 new inversions with the ante). No published
spot's range moves. Most of what remains is at these decisions, at 9 players (which plays the 8-handed moves), and at
lines the 100bb solve never reaches (the guard: J9s over JTs facing a 5bet at 60bb and with the straddle). Since
2026-11-18 the browser repairs the served charts' order anyway (`engine/pf_dominance.py`, section 18.9) except at nodes
feeding a library spot; this sweep measures upstream's answer, which is the repair's input and what a local server
serves.

Rebuild (from `solver/`, with DIR holding the format solves):

    HOLD=$(../.venv/bin/python ../scripts/pf/format_held.py)
    slot.sh ../.venv/bin/python scripts/build_pf_formats.py --write --dir DIR --keep players:8 --smooth-kept players:8 --hold "$HOLD"

**Published references** (`solver/scripts/preflop_format_reference.py`): the 6 certain ones all inside tolerance, mean
0.92 points, as before. The 40bb MTT small blind against a CO open goes from fold 78.1 / call 11.1 / raise 10.8 (outside
the ±4 against 72.6 / 14.4 / 13.1) to 76.3 / 12.2 / 11.5; against a BTN open 74.5 / 11.7 / 13.8 (was 75.2 / 10.9 /
13.9); heads-up 50bb SB first in limps 37.2% (36.9). Tests: `solver/tests/test_gto.py` TestPreflop, TestTableSizes,
TestPreflopSubgame, TestOpenerVs3bet, TestPublishedBlindFrequencies, TestPublishedPreflopReferences, TestRake,
TestAdvisor (76, OK) and `scripts/engine` (369). `test_pf_charts.py` FlatAlternative's example hands for a share a
20bb small blind's jam doesn't take are A4s, 65s and A5s now (A2s, 76s and AJo were the ones the chart only 3-bet
before).

**Not established.**
- The format games re-solved on the exact equity table (section 31) and with `engine/pf_model.py`'s
  `LowerEdgeLibraryModel`: the 8-handed BB against UTG1 and heads-up 20bb keep a diagonal pattern (63s, 74s, 85s over
  the next kicker) that looks like the library's edge-join overvaluation (section 18.6). Needs the 8-handed game at about
  3 GB.
- The 38 held decisions keep their pure choices until the 16 library spots they feed are rebuilt on smoothed ranges.
- Smoothing is a prior (neighbouring classes play alike), not a solve: σ = 1 kicker step was picked by the sweep and
  the references, not measured against a combo-level solve of a format game.

## 33. Leaks read by chance's bar, measured by simulation (2026-11-22)

Analyze's leak list (`web/src/features/analyze/report.ts` `readLeaks`) used to mark a leak by fixed lines: a frequency
10 points or more off the answer's with its 95% range clear of that, a preflop situation under 80% in the mix, a spot
losing 0.5bb a decision, each over 30 decisions. Those lines ignore how much a sample can say: a 6-point shift is never
a leak however many hands show it, and a database read on many rows at once gets no correction for the number of looks.

**Now** (`web/src/features/analyze/leakStats.ts`): every row is a test against the answer for the same hands.

- A frequency row pairs each decision's action (took that kind of action or not) with that hand's own answer share; the
  test is on the mean difference, its spread no narrower than the answer's own mix makes (`pairTest`: the larger of the
  sample variance and the mean m(1 - m)), so a player who draws from the answer's mix is no leak.
- A preflop situation graded by frequency (the charts, push/fold) is tested on how often you were in the mix against how
  often the answer's own mix would be (`okChance`: the most played, any tied with it, anything 10% or more, as
  `grade.ts` grades), one-sided.
- Rows graded by EV (the flop library, the preflop solve's class-level model, kept apart) test the EV given up past the
  answer's noise against zero (`meanTest`).
- The bar is Bonferroni over the tests a report makes on rows of 30 decisions or more: |z| at least the normal quantile
  of 1 - 0.05/(2m), so about one report in twenty shows any false leak however many rows it reads (1.96 for one test,
  3.48 for a hundred). Rows of 10 to 29 decisions past the bar, and rows of 30 or more between 1.96 and the bar, are
  listed as thin ("not yet past the bar"), not as leaks.
- Leaks that cost EV come first, by bb per 100 hands (the EV given up past the noise over the report's hands, times
  100); frequency-only leaks follow by the size of the gap. Each preflop row is also read per seat, the seat named when
  one seat says more than the pooled row; rows that are the same decisions as another (VPIP and PFR when only opens are
  in the sample) are listed once.

**Simulation** (`web/src/features/analyze/leaks.sim.test.ts`, `LEAK_SIM=1`, about 30 s through `slot.sh`): seeded
6-max databases of made-up hands through the real `readLeaks` and `grade`: RFI from each seat, BB defence, SB facing an
open, facing an open, facing a 3bet, mixes shaped like the charts (70% of hands pure, the rest split between two
actions), and a flop c-bet in about one hand in six graded by EV. Play is drawn from the answer's own mix, or with one
leak that moves a share of the rest of the mix to one kind of action. A false alarm is a database whose report shows
any leak at all; a leak is found when a row naming its situation is listed. The same databases through the old lines
(the `report.ts` of commit 1d02275):

| case | 500 hands | 1,500 hands | 5,000 hands | old lines at 500 / 1,500 / 5,000 |
|---|---:|---:|---:|---:|
| no leak: any false leak, of 400 databases | 0.5% | 2.0% | 1.8% | 0% / 0% / 0% |
| BB folds 20% of the rest more (about 11 points), of 100 | 51% | 100% | 100% | 0% / 2% / 5% |
| BB folds 10% of the rest more (about 5.5 points) | 3% | 62% | 100% | 0% / 0% / 0% |
| opens 15% of the rest more (about 10 points) | 100% | 100% | 100% | 0% / 0% / 0% |
| c-bets 30% of the rest more, graded by EV | 63% | 100% | 100% | 7% / 36% / 94% |

The false-alarm rate stays under the 5% the bar is set for (it is conservative because the tests overlap: VPIP, PFR and
Open read many of the same decisions). The old lines never cried wolf, and found almost nothing either: a leak had to
be over 10 points and its whole 95% range past the line. The suite runs a small version (40 databases of 1,500 hands
with no leak: 10% at most; 20 of 3,000 hands with the 20% BB leak: 80% found at least).

**Limits.** The preflop rows are tested against whatever graded them: outside the stored preflop games that is the
charts, which are approximate, so a "leak" there is a gap to the charts, said on the row ("against the charts, by
frequency, not a solve"). The simulation's mixes are chart-shaped, not the charts themselves; real databases have
correlated decisions (one player, one style), which this does not model. Report time over 150,000 decisions is 1.45 s
(`scale.test.ts`, limit 6 s).

## 34. A browser flop model closer to the library's, and four-way rivers against an exact reference (2026-11-22)

Two questions from the gap plan (W9), each measured before anything changed in the app. Neither change was shipped:
what was measured is below, with why.

### 34.1 The river dealt by card class inside a flop solve

Section 21 found the browser's flop models give up 1.9% of the pot on average against the full game (up to 4.9% Fast,
5.4% Accurate), where the library's model gives up 0.6% (up to 2.1%), and that most of the cost is the river played
blind: by 32 buckets of river strength without its card. The library deals every river card and plays each by 64
buckets of strength there, with the turn per combo. That model doesn't fit in the browser: natively, one thread, with the
compiled core run as the browser runs it (no deferred games, no BLAS leaf batches), a single-raised flop with real
ranges (BTN vs BB, 100bb, the worker's 33/75/125% turn and river menu) is 5.8M cells, 0.32 s an iteration and 690 MB on
Ks7d2c with 8 buckets a card, and 10.5M cells on JdTd8c, where Fast's whole solve is 0.44M cells and 3.3 ms an
iteration. Even one river card per class with the turn per combo (8 buckets a card) was 452 ms an iteration and
1.34 GB on JdTd8c. The size comes from entering 13-46 river boards under each turn line combo by combo, not from the
bucket count.

**What was built** (`scripts/benchmarks/flop_model.py`, Lizard-side, patching `gto.solver` at import; `solver/` is
unchanged): the turn stays in Fast's or Accurate's hand buckets, and the river is dealt as one card per class of the
turn's board (a rank's cards, a suit with two or more board cards apart: 13 rivers on a rainbow turn, about 24 with a
flush suit), with `river_dealt` buckets of strength on each card. The compiled core has no chance node in bucket space,
so the river is upstream's river-strength entry with tables that deal the card: its buckets are (class, strength) pairs,
the showdown and fold tables block diagonal (a pot is contested on one card), and a turn bucket enters each pair with the
root-weighted share of its combos that land there, scaled so that a pair of hands meets on each class with the share of
the rivers that class stands for. It stays zero-sum; a config without `river_dealt` builds upstream's tree cell for cell
(`scripts/engine/test_flop_model.py`). It replaces the blind river only where upstream plays one (root stack to pot of 8
or more): dealt in the 3bet pot too, it gave up more there than the river on the turn's boards (below).

**Against the full game**, section 21's harness and spots (`results/abstraction_w9.json`; given up, % of the pot, OOP
then IP; the exact solves as there). Fast was run again as a control and reproduced its earlier figures to the third
decimal. The `-d` rows on AJ3 deal the river in the 3bet pot, which the shipped gate wouldn't (there the gated model is
Accurate's own row).

| Model | K72 own game | K72 given up | JT8 own game | JT8 given up | AJ3 own game | AJ3 given up | Mean, most |
|---|---|---|---|---|---|---|---|
| Fast (control, run again) | 0.036 | 2.17, 2.25 | 0.031 | 1.00, 4.85 | 0.069 | 0.64, 0.22 | 1.85, 4.85 |
| Accurate (section 21) | 0.005 | 2.23, 2.33 | 0.006 | 0.78, 5.41 | 0.027 | 0.47, 0.26 | 1.91, 5.41 |
| Library (section 21) | 0.499 | 0.25, 0.34 | 0.143 | 0.48, 2.14 | 0.113 | 0.09, 0.12 | 0.57, 2.14 |
| Fast, dealt by class, 4 a card | 0.031 | 1.79, 6.68 | 0.069 | 2.78, 15.49 | 0.073 | 1.48, 1.57 | 4.96, 15.49 |
| Fast, dealt by class, 8 a card | 0.291 | 0.41, 0.36 | 0.052 | 1.08, 5.56 | 0.060 | 1.22, 0.98 | 1.60, 5.56 |
| Accurate, dealt by class, 8 a card | 0.102 | 0.69, 0.38 | 0.014 | 1.08, 5.79 | 0.013 | 1.20, 0.99 | 1.69, 5.79 |
| the same, gated (3bet pot as Accurate) | | | | | | 0.47, 0.26 | 1.44, 5.79 |

On the dry flop the dealt river does what section 21 suggested: Ks7d2c's cost falls from 2.2% of the pot to 0.4-0.7,
the library's level. On the two-tone flop it doesn't move (in position 5.4 to 5.6-5.8: the turn's hand buckets, which
merge draws with made hands, look like the larger part there, and dealing the river doesn't touch them), and 4 buckets a
card is far worse than the blind river (15.5% on JT8).

**Against the library on real ranges**, section 24's harness (`custom_report.py --model`, 6-max 100bb BTN vs BB, the
representative 95 flops, the library off, each flop stopped as Fast's are, from its 300th iteration at 0.2% of the pot;
per flop, mean absolute difference from the library's report):

| Model | BB checks (points) | BTN bets after the check (points) | of those, at 75% (points) | BB's EV (% pot) | Time, 95 flops | Peak |
|---|---|---|---|---|---|---|
| Fast (section 24) | 0.9 | 3.8 | 16.3 (max 49.3) | 0.35 (max 1.09) | 157 s | 425 MB |
| Accurate | 0.9 | 2.9 | 13.5 (max 40.4) | 0.26 (max 0.91) | 184 s | 527 MB |
| Accurate, dealt by class, 8 a card | 0.9 | 5.0 | 23.5 (max 72.7) | 0.40 (max 1.46) | 2,289 s | 774 MB |

On the representative 25 the same order holds (Fast 18.0 points of split and 0.29% EV, Accurate 14.9 and 0.17%).
At 16 a card (`--model accurate-d16`, the representative 25) the first 10 flops, all rainbow, came closer than Accurate
on in position's betting after the check (2.0 points off per flop against 2.9, its average lean 0.4 points against
2.8), at 25 s a flop natively against 1.1. The 11th flop, the first two-tone one, took the process past 900 MB, and the
run was stopped there to keep under the 1 GB a process may use on this machine; it has no size-split figure (the
harness writes its columns at the end).

With real ranges a bucket on each card holds about 75 combos where on section 21's spots it held four, and the dealt
river at 8 a card moves in position's betting further from the library's than the blind river's 32 buckets did: it bets
4.5 points more often than the library after the check and puts 23 points less of it at 75%. The narrow spots flattered
it, as section 21 warned they might.

**Cost.** Natively, one thread, as the browser runs the core, real ranges: an iteration of Accurate's flop takes 4.7 ms
on Ks7d2c and 8.2 ms on JdTd8c; dealt by class at 8 a card, 26-30 ms (166 MB) and 130 ms (364 MB), 6 and 16 times as
long; a 3bet pot's 1.2 ms becomes 14 ms. In the custom report a rainbow flop took about 9 s and a two-tone one 30-38 s
where Accurate took 1.4 s. The showdown tables are dense across classes (the core multiplies the whole block-diagonal
matrix), which is most of the extra on two-tone turns, where the widest turn sets the width for all.

**Decision: nothing shipped.** The one setting the browser affords where it helps (8 a card) helps the dry flop of a
narrow benchmark, not the two-tone one, and on real ranges takes Accurate further from the library at 6-16 times the
cost. Fast and Accurate keep their models, and the figures on their answers (section 21's, `abstraction.ts`) stand.
What changed for users: an Accurate custom report now says what Accurate measured against the library's report (the
second row above: 0.26% of the pot, 13.5 points of split), as a Fast report has said its own since section 24
(`customReport.ts` `ACCURATE_VS_LIBRARY`). The turn's hand buckets are the next thing to measure on two-tone flops;
`abstraction.py` has no variant that isolates them yet.

### 34.2 Four-way rivers against an exact reference

Section 14's reference solved three-way rivers by brute force over triples of hands. It now takes four players
(`refsolver/mw.py`: an (n0, n1, n2, n3) table with every quadruple that shares a card removed, the same DCFR and exact
best responses; `test_reference.py` `FourWay`). The engine's four-player solve removes cards pair by pair
(`multiway_solver._term_pw`); with three players it removes them for all three at once and matches the reference to
0.0001% of the pot (section 14). Three four-way rivers (Ks7d2c3h9s, 40bb pot, 80bb behind, 50% pot bets, 7-8 combos a
player; `spots.py`), the engine as the app runs a four-way river (`exact=True`, which is pairwise from four players):

| Spot | Hands | Iter | Value diff (% pot) | NashConv by the reference (% pot) | NashConv, engine's own (% pot) | Engine's own values against the reference's walk of its strategy (bb) | Largest TV | Engine s | Ref s |
|---|---|---|---|---|---|---|---|---|---|
| `4way-river-one-bet` (ranges share cards) | 8x7x7x7 | 300 | 2.77 | 5.89 | 0.36 | 1.31 | 0.96 | 5.8 | 14.2 |
| | | 3000 | 2.29 | 5.99 | 0.59 | 1.12 | 0.82 | 38.6 | |
| `4way-river-raise` (the same, a raise allowed) | 8x7x7x7 | 300 | 0.89 | 6.44 | 1.55 | 0.62 | 1.00 | 20.8 | 78.4 |
| | | 3000 | 0.88 | 6.95 | 2.10 | 0.62 | 1.00 | 209.1 | |
| `4way-river-no-overlap` (no card in two ranges) | 6x6x6x6 | 300 | 0.16 | 0.28 | 0.14 | 0.02 | 0.42 | 3.7 | 12.1 |
| | | 3000 | 0.11 | 0.24 | 0.05 | 0.02 | 0.37 | 36.7 | |

(`results/benchmark.json`; the reference's own NashConv 0.00004%, 0.07% and 0.002%; the engine ran in numpy, no
four-player core.)

Where no card is in two ranges, removing cards pair by pair is exact, and the engine's four-player CFR lands within
0.11% of the pot of the reference's values and 0.24% from equilibrium in the exact game: the four-player solve itself
is sound. Where the ranges share cards (the first two spots put the same kings, queens and aces in several ranges, on
purpose), the engine's own game is a different game: its values for its own strategy are 0.6-1.3 bb (1.5-3.3% of the
pot) from what the same strategy earns with every card removed exactly, and in the exact game it is 6-7% of the pot from
equilibrium however long it runs. These ranges are small and overlap far more than real ones (a real range of a few
hundred combos blocks a few percent of another's), so this bounds the error from above rather than measuring a real
pot; it is still the reason four-way answers are labelled approximate, and now a measured one.

**What could be made sounder, and wasn't.** Exact removal for four ranges takes inclusion-exclusion over every pair,
triple and quadruple of hands sharing cards: the three-player exact term the engine has already costs O(n x 52) a
terminal, and the four-player one would need the triple overlaps on top. It would be a change to
`solver/gto/multiway_solver.py`, and only fixes the river: four-way flops and turns are also the engine's reduced game
(8 or 6 hand buckets, one bet a street, the shortest stack), which no reference here can solve exactly. A four-way
river in the app is already solved per combo on one bet a street; with ranges that overlap as real ones do, the measured
error above should shrink, but that was not measured. Five or more players stay on the betting rules. Nothing was
changed in the app for multiway; FEATURE_MATRIX's Multiway row carries these figures.
