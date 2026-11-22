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
| W1 | Tournaments depth: ICM preflop on Lizard's calibrated solver, bounty spots, a bigger final-table set, satellites, chip EV, tournament files, real payout presets | ICM, chipEV, Satellites, KO/PKO, Mystery bounty, ICM final-table library, Real tournament presets, MTT | `engine/pf_icm*`, `scripts/pf_icm/`, `web/src/features/tournaments/` | code on its branch (def145b); waits for its rebase onto lz4/cal2 and the 767-spot rebuild |
| W2 | Preflop depth: 4bet sizes, straddle from any seat, 5bet rules, limp and per-position checks, unequal-stack grades | Preflop, Preflop trainer, Preflop solves, Preflop tree builder, EV-loss scoring | `engine/pf_*` (not `pf_icm*`), `web/src/features/study/pf*` | rebased onto lz4 on its branch, 110 `_ch` games rebuilt and measured (6-max 100bb charts: 98.2% answered, up from 92.3%); its docs and the depth-tolerance run still to finish before merging |
| W3 | Analyze: decision grading, leak thresholds, reports | Decision grading, Leak finding, Reports | `web/src/features/analyze/`, `web/src/features/history/` | queued |
| W4 | Library: single-size library, more breadth, under 1 GB | Single-size library | `library-build/`, `scripts/library/`, `web/src/library/` | merged (eca8152) and published 2026-11-22: 38 lines on 552 flops, live and checked in a browser; PARTIAL |
| W5 | PLO4: turn and flop solves, registry, Study, Practice and Analyze | PLO4 | `web/src/engine/plo/`, `features/*/Plo*` | merged 2026-11-22 (3f77c08): rake in the vectors, 4 bets and 3 raises, flop and turn solves on a labelled card sample (full-game gap measured, ACCURACY 15), an independent flop reference; the registry, Study, Practice, Analyze and the Omaha parser were already in; preflop NOT IMPLEMENTED; PLO4 stays PARTIAL | |
| W6 | AI explanations proxy and client | AI explanations | `explain-worker/` (new), Explain buttons | done 2026-11-22: Worker deployed, answers "not configured" until the owner adds the key (`DEPLOYMENT.md` §7); client off until `LIZARD_EXPLAIN=on`; PARTIAL |
| W7 | Screenshot import | Screenshot import (new row) | `web/src/features/analyze/screenshot/` (new) | merged 2026-11-22 (3036702) and deployed: review-only screenshot to spot, cards and OCR in the browser, measured on synthetic tables only; PARTIAL |
| W8 | Arena: private share-link heads-up games | Multiplayer / HU arena | `arena-worker/` (new), `web/src/features/arena/` (new) | merged 2026-11-22 (d71299a) and live: Worker `lizard-arena` deployed, `LIZARD_ARENA=on`; its live check and a hand played from two browser tabs on the site both pass (`DEPLOYMENT.md` §8); PARTIAL |
| W9 | Postflop depth: multiway trees, a browser flop model closer to the library's | (Postflop depth, Formats) | `engine/tree_depth.py`, solver patches | queued |

Each row's result, and what stays short of WORKING, goes into `docs/FEATURE_MATRIX.md` and `docs/PROGRESS.md` as it
lands. The final report is at the end of this file.
