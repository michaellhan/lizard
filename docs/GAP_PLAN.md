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
| W1 | Tournaments depth: ICM preflop on Lizard's calibrated solver, bounty spots, a bigger final-table set, satellites, chip EV, tournament files, real payout presets | ICM, chipEV, Satellites, KO/PKO, Mystery bounty, ICM final-table library, Real tournament presets, MTT | `engine/pf_icm*`, `scripts/pf_icm/`, `web/src/features/tournaments/` | queued |
| W2 | Preflop depth: 4bet sizes, straddle from any seat, 5bet rules, limp and per-position checks, unequal-stack grades | Preflop, Preflop trainer, Preflop solves, Preflop tree builder, EV-loss scoring | `engine/pf_*` (not `pf_icm*`), `web/src/features/study/pf*` | queued |
| W3 | Analyze: decision grading, leak thresholds, reports | Decision grading, Leak finding, Reports | `web/src/features/analyze/`, `web/src/features/history/` | queued |
| W4 | Library: single-size library, more breadth, under 1 GB | Single-size library | `library-build/`, `scripts/library/`, `web/src/library/` | code done on its branch 2026-11-17; the build is solving (`docs/single-size-library.md`); not merged or published |
| W5 | PLO4: turn and flop solves, registry, Study, Practice and Analyze | PLO4 | `web/src/engine/plo/`, `features/*/Plo*` | queued |
| W6 | AI explanations proxy and client | AI explanations | `explain-worker/` (new), Explain buttons | queued |
| W7 | Screenshot import | (new row) | `web/src/features/analyze/screenshot/` (new) | queued |
| W8 | Arena: private share-link heads-up games | Multiplayer / HU arena | `arena-worker/` (new), `web/src/features/arena/` (new) | queued |
| W9 | Postflop depth: multiway trees, a browser flop model closer to the library's | (Postflop depth, Formats) | `engine/tree_depth.py`, solver patches | queued |

Each row's result, and what stays short of WORKING, goes into `docs/FEATURE_MATRIX.md` and `docs/PROGRESS.md` as it
lands. The final report is at the end of this file.
