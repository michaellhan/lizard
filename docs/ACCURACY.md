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

**Not checked for the flop.** No independent reference: the NumPy turn reference would need a turn-card axis over 49 cards, and its dense tensors are already its limit at the turn. The flop rests on the decomposition check above (its value equals the turns solved apart, which are themselves held to the reference) and on exact equity. A flop's limit is 18 million units an iteration, counting every turn's and river's, so only narrow ranges at a size or so a street fit.

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
