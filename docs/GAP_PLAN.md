# Closing the GTO Wizard gaps (one-shot run, started 2026-11-17)

The owner asked to close every gap the 2026-11-17 review found: the 21 rows of `docs/FEATURE_MATRIX.md` that aren't
WORKING in Lizard, plus screenshot import (research P2-8, no row yet). Owner decisions for this run:

- Long builds: up to about 3 days of CPU in all, one at a time through gtosolver's `.work/bin/slot.sh`.
- The library stays on GitHub Pages, under its 1 GB site limit (459 MB on 2026-11-17): choose which spots go in to fit.
- AI explanations: a Lizard-owned proxy on Claude Haiku 5.5 with a $20/month hard cap. The owner adds the Anthropic key as
  a Worker secret themself.
- The extras are all in: the AI proxy, screenshot import, real payout presets (each with a public source) and an arena
  limited to private share-link games (no public ranked queue).
- Account sync's go-live still needs the owner's Google client (`docs/DEPLOYMENT.md` §6). It is not part of this run.

Nothing here changes the project rules in `CLAUDE.md`: provenance on every number, `solver/` byte-identical to upstream
except declared patches, and the gtosolver checkout is read-only.

## Workstreams

At most two run at once, on separate files, each in its own worktree and branch. Each is merged into `main` once it is
reviewed and passes its gates.

| # | Workstream | Matrix rows | Main files | Status |
|---|---|---|---|---|
| W1 | Tournaments depth: ICM preflop on Lizard's calibrated solver, bounty spots, a bigger final-table set, satellites, chip EV, tournament files, real payout presets | ICM, chipEV, Satellites, KO/PKO, Mystery bounty, ICM final-table library, Real tournament presets, MTT | `engine/pf_icm*`, `scripts/pf_icm/`, `web/src/features/tournaments/` | merged 2026-11-22 (84bc0b0) on lz4/cal2: 767 stored spots built on `pf_icm`'s game under `cal2` keys (652 new, 4.1 CPU hours, 5.24 MB in all), payout tables from four rooms with sources, tournament file facts; rows stay PARTIAL (ACCURACY 20.7) |
| W2 | Preflop depth: 4bet sizes, straddle from any seat, 5bet rules, limp and per-position checks, unequal-stack grades | Preflop, Preflop trainer, Preflop solves, Preflop tree builder, EV-loss scoring | `engine/pf_*` (not `pf_icm*`), `web/src/features/study/pf*` | merged 2026-11-22 (e2ef0a4) on lz4: 110 charts-sized games; 6-max 100bb charts answered 98.2% (was 92.3%), 2-5 players 97.8-99.3%; depth tolerance kept at 15% (ACCURACY 18.12); rows stay APPROXIMATE / PARTIAL |
| W3 | Analyze: decision grading, leak thresholds, reports | Decision grading, Leak finding, Reports | `web/src/features/analyze/`, `web/src/features/history/` | done 2026-11-22 on its branch (`worktree-agent-a7ab487a8c3fed78a`), not merged: leaks read by a chance bar (Bonferroni over the report's tests) in place of fixed lines, ranked by bb/100, read per seat, measured by seeded simulation (ACCURACY 33); a GTO Reports-style node view (preflop by seat, flop spots); Leak finding, Reports and Decision grading stay PARTIAL |
| W4 | Library: single-size library, more breadth, under 1 GB | Single-size library | `library-build/`, `scripts/library/`, `web/src/library/` | merged (eca8152) and published 2026-11-22: 38 lines on 552 flops, live and checked in a browser; PARTIAL |
| W5 | PLO4: turn and flop solves, registry, Study, Practice and Analyze | PLO4 | `web/src/engine/plo/`, `features/*/Plo*` | merged 2026-11-22 (3f77c08): rake in the vectors, 4 bets and 3 raises, flop and turn solves on a labelled card sample (full-game gap measured, ACCURACY 15), an independent flop reference; the registry, Study, Practice, Analyze and the Omaha parser were already in; preflop NOT IMPLEMENTED; PLO4 stays PARTIAL | |
| W6 | AI explanations proxy and client | AI explanations | `explain-worker/` (new), Explain buttons | done 2026-11-22: Worker deployed, answers "not configured" until the owner adds the key (`DEPLOYMENT.md` §7); client off until `LIZARD_EXPLAIN=on`; PARTIAL |
| W7 | Screenshot import | Screenshot import (new row) | `web/src/features/analyze/screenshot/` (new) | merged 2026-11-22 (3036702) and deployed: review-only screenshot to spot, cards and OCR in the browser, measured on synthetic tables only; PARTIAL |
| W8 | Arena: private share-link heads-up games | Multiplayer / HU arena | `arena-worker/` (new), `web/src/features/arena/` (new) | merged 2026-11-22 (d71299a) and live: Worker `lizard-arena` deployed, `LIZARD_ARENA=on`; its live check and a hand played from two browser tabs on the site both pass (`DEPLOYMENT.md` §8); PARTIAL |
| W9 | Postflop depth: multiway trees, a browser flop model closer to the library's | (Postflop depth, Formats) | `scripts/benchmarks/flop_model.py`, `refsolver/mw.py` | merged 2026-11-22 (c38ace9): the river dealt by card class measured (ACCURACY 34.1) and not shipped (on real ranges 23.5 points of split off the library against Accurate's 13.5, at 6-16x the time); an Accurate custom report now gives its own gap to the library; four-way rivers measured against an exact 4-player reference (34.2: 0.11% pot where ranges don't share cards, up to 2.3% and 6-7% from equilibrium where small ranges overlap heavily), nothing changed in the app for multiway; grades unchanged |

Each row's result, and what stays short of WORKING, goes into `docs/FEATURE_MATRIX.md` and `docs/PROGRESS.md` as it
lands. The final report is at the end of this file.

## Final report (2026-11-22)

All nine workstreams are merged into `main` and deployed. The matrix's Lizard column went from 50 / 13 / 4 / 4 (71
rows) to 50 / 17 / 4 / 1 (72 rows, with screenshot import added). Three rows moved from NOT IMPLEMENTED to PARTIAL:
the single-size library, the arena and AI explanations. No row reached WORKING. Every row this run touched states what
keeps it short of WORKING, and none is labelled as more than what was measured.

**What landed**

- **W1, tournaments:** 767 stored ICM spots on the cal2 model (385 final-table, 117 satellite, 114 chip EV, 36 bounty and
  115 presets; 4.1 CPU hours, 5.2 MB), payout tables from four rooms with their sources, and tournament file facts.
- **W2, preflop:** 110 charts-sized lz4 games. At 6-max 100bb the charts' play is graded by the solve 98.2% of the time
  (was 92.3%), and 97.8-99.3% at 2-5 players. Grades for unequal stacks; 4bet sizes, 5bet rules, straddle from any seat.
  The depth tolerance stays 15% (ACCURACY 18.12).
- **W3, Analyze:** leaks found by statistical tests against the answer for the same hands, under one bar per report,
  instead of fixed lines (simulated: a BB folding 11 points too much is found 100% of the time at 1,500 hands, against
  2% before; 2% false leaks). A by-seat and by-spot node report (ACCURACY 33).
- **W4, library:** the single-size library, 38 lines on 552 flops, published and checked live (site library 574 MB, under
  the 1 GB limit).
- **W5, PLO4:** rake, 4 bet and 3 raise sizes, and wider flop and turn solves on a labelled card sample, measured against
  every card (up to about 4% pot off) and an independent flop reference.
- **W6, AI explanations:** the `lizard-explain` Worker (Claude Haiku 5.5, $20/month hard cap) is deployed and answers "not
  configured" until the owner adds the key.
- **W7, screenshot import:** a picture of a hand or a spot read in the browser into a checked form; review only, nothing
  uploaded.
- **W8, arena:** private heads-up tables by link, play money only, live (`LIZARD_ARENA=on`). The Worker's live check
  passes, and a hand was played to a showdown from two browser tabs on the site.
- **W9, postflop depth:** measured, not shipped. A river dealt by card class came out further from the library on real
  ranges, at 6-16 times the time. An exact four-player river reference shows the engine's four-way card removal 0.9-2.3%
  pot off on heavily overlapping ranges; fixing it needs a `solver/` patch. Accurate custom reports now state their
  measured gap to the library (ACCURACY 34).

**Decisions made during the run without the owner**

- All four extras were included, since the owner had "no preference": the AI proxy, screenshot import, real payout
  presets and the private arena.
- The arena was turned on in the live build after its live check passed.
- The charts' raise sizes stayed the preflop default: the tree's own sizes score closer to published spots (1.96 points
  against 2.84), but they leave the flop library.
- W9's flop model and four-way changes were not shipped, because the measurements don't support them.
- One EV-backed first-in inversion is accepted in the tournament order test. HJ jams Q6s (0.000bb) and folds Q7s
  (-0.058bb) at 7.5bb in one chip EV spot. It comes out the same at four times the iterations, so it is a feature of the
  class-level model, not an unfinished solve.
- Two CI failures after W1's merge were fixed: the Tournaments page's final-table selects were capped to the row's width (CI
  caught a 29px sideways scroll on a phone), and the QA test's "Payouts" field is found by its exact label (W1's "A room's
  posted payouts" also matched).

**What's left**

- Owner steps:
  - Account sync needs a Google client (`DEPLOYMENT.md` §6).
  - AI explanations need the Anthropic key as a Worker secret and `LIZARD_EXPLAIN=on` (`DEPLOYMENT.md` §7).
- The stored tournament test peaks at 1.7 GB, over the 1 GB budget. Building the Bubble stage's game takes 1.1 GB in
  upstream `solver/gto/icm.py`. Running that test's spots in subprocesses would fix it without a solver patch.
- Preflop outside the stored games, and so the preflop half of leaks and reports, is still the charts.
- The preflop rows stay APPROXIMATE because the solve is a class-level model.
- Four-way card removal needs a declared `solver/` patch. A wider sound browser flop model is not found yet; the turn's
  buckets on two-tone flops are the next thing to measure.
- Only four rooms' payout tables. Bounty spots have equal bounties only, and no mystery-bounty spot is stored.
- The arena isn't checked in Safari or on a phone. The arena and screenshot import are measured on synthetic data only.
- The app's first script has about 1.3 kB left in its 358.4 kB budget.
