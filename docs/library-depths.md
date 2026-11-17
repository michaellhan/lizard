# Flop-library spots at other stack depths

Every stored flop spot used to be 100bb without antes. A player at any other depth got a live solve. This build adds
library spots at other depths. They are the solver's own format spots (`solver/gto/flop_library.py` `FORMAT_SPOTS`,
ids like `srp_btn_bb_40bb`): each is the 100bb spot's preflop line played at that depth, with that depth's ranges,
pot and stack.

## What existed (2026-11-11)

- `FORMAT_SPOTS` defines 40bb and 200bb, each with BTN, CO, SB, HJ and UTG opens the big blind calls, plus the big
  blind's 3bet against the button. It also defines `2max` (heads-up 100bb, built in gtosolver's `.work`).
  `build_flop_library.py --format TAG` builds a format's spots, but none had been built.
- Preflop ranges at a depth come from the charts as the advisor plays them there (`flop_library.spot_setup`).
  - At 20, 40 and 60bb, they are the 100bb charts moved by solves of that depth (`gto/pf_formats.py` `DEPTHS`,
    `pf_format_data.py`).
  - Deeper than 100bb, they are the 100bb charts, with the big blind's calls re-priced for implied odds by rules.
    BTN's opening range at 200bb has the same fingerprint as at 100bb, but the big blind defends 633 combos
    against 576.
  - These are charts, not solves of the game (see `docs/FEATURE_MATRIX.md`, Short stack and Deep stack). A library
    spot's flop solve stands on them, as the 100bb spots stand on the 100bb charts.
- Users type any stack from 10 to 250bb (Study, Solve, Practice). A library spot answers only at its exact stack and
  ranges (`FlopLibrary.spot` keys on fingerprints, pot and stack). Practice grades preflop against stored solves at
  20, 25, 30, 40, 50, 60, 80, 100, 125, 150 and 200bb (`web/src/solver/pfStored.ts`), so those stacks are the depths
  people practise at.
- The web already reads a spot's `game` everywhere. The heads-up builds paved the way:
  - the Library page groups spots by game and links to Study at that depth;
  - Instant flops deals only the spots of the hand's game (`heldSpots`);
  - the plan's drill matches your game;
  - Practice drills and Reports open Study with the spot's stack;
  - provenance names the spot by its id, which carries the depth.

  `web/src/library/depthSpots.test.ts` pins all of this for a 40bb spot.

## The first batch, and why

Memory decides most of the order. A worker's peak grows with its tree's cells. The solver's README measured heads-up
100bb trees of 63–73M cells at 2.1–3.0 GB, about 41 bytes a cell. While gtosolver's builds run, a process here stays
under about 1 GB (CLAUDE.md). Tree sizes (`solver.tree_cells`, rainbow to two-tone flops):

| Spot | 40bb | 100bb | 200bb |
|---|---|---|---|
| BTN/CO/SB vs BB, single-raised | 20–38M cells | 33–62M | 38–70M |
| BB 3bet vs BTN | 3.7–6.9M | 13–25M | 24–44M |

So the batches (`scripts/library/depths_build.py` `BATCHES`) are:

| Batch | Spots | Flops | Est. peak a process | Workers |
|---|---|---|---|---|
| `40bb-3bp` | `3bp_bb_btn_40bb` | 184 | ~0.3 GB | 2 |
| `40bb-srp-small` | `srp_btn_bb_40bb`, `srp_co_bb_40bb`, `srp_sb_bb_40bb` | the 73 of the 184 with at most 24M cells (rainbow) | ~1 GB | 2 |
| `40bb-srp` | the same three | the rest of the 184 (two-tone, monotone) | ~1.6 GB | 2 |
| `200bb` | `3bp_bb_btn_200bb`, `srp_btn_bb_200bb`, `srp_co_bb_200bb`, `srp_sb_bb_200bb` | 184 | ~1.8–2.9 GB | 1 |

The owner allowed up to 3 GB a process for this build on 2026-11-11, so all four run, in this order, with
`start --max-mb 3000`. `start` alone (1000 MB) runs only the first two. 200bb runs one worker, so the job holds
about 3 GB of the shared 16 GB rather than 6.

Measured on 2026-11-11 (one entry, nice 10, outside `heavy`): a `3bp_bb_btn_40bb` flop (5c4d2h) took 9 s at a
463 MB peak and reached 0.018% exploitability in 200 iterations, so the 3bet batch would take about 15 minutes with
2 workers. Under `heavy` (efficiency cores) the build itself runs about 20 s an entry at 274 MB a process, so the
3bet batch takes about 30 minutes and the larger trees about twice the README's speed estimates. The other peaks and times in the table are estimates from tree sizes until `status` reports real ones.
The same entry, assembled into a stage with `--formats`, answered a 40bb hand in the native advisor
(`precomputed.spot` `3bp_bb_btn_40bb`, label "BB 3bet vs BTN, 40bb"), while the same hand at 100bb still read
`3bp_bb_btn`.

- **Spots:** the four most-played heads-up pots, the top of `SPOTS` by frequency: BTN, CO and SB opens the big blind
  calls, and the big blind's 3bet against the button.
- **40bb first:** it is the most common short depth and a stored Practice depth. Its ranges come from solved moves,
  the best chart data any non-100bb depth has. It is also the cheapest to solve, since a shallow stack makes a small
  tree.
- **200bb next:** it is the common deep depth and a stored Practice depth. Its ranges are rule-priced, so they are
  less faithful, and its trees are the largest. None of them fits in 1 GB, so they run last.
- **184 flops:** the representative set (`representative_flops(184)`) first, as every spot started. 552 and every
  flop come later, by use.
- **Left out:** HJ and UTG opens, which `FORMAT_SPOTS` also lists. They are less played heads-up to the flop.
- **Not built:** 20bb and 60bb. They have charts but no `FORMAT_SPOTS` entry, and 20bb sits beside push/fold. 150bb
  has charts only through rules. Antes have no format spots. Adding any of these needs a `FORMAT_SPOTS` entry, which
  is an upstream change; see "Next batches".

Size: up to about 30 KB a flop with turn files (as `srp_sb_bb_2max`), so the four batches (1,472 entries) add about
45 MB to a ~390 MB stage. `assemble.py` caps the stage at 900 MB.

## Running it

`scripts/library/depths_build.py` runs the batches one after another inside one `heavy -x` job. That job holds one
machine-wide slot (efficiency cores, nice 10) until its last batch ends, with each batch's workers and a fresh
process per entry. A watchdog stops a batch if any of its processes passes `--max-mb` × 1.15; that batch is marked, and the
next one goes on.

It runs from a frozen copy of `solver/`, and the supervisor runs from a copy of the script, both in
`library-build/runs/depths/` with its pid, log and state. A removed worktree or a re-imported `solver/` can't break a
running build. It writes to `library-build/sources/depths/` in the main checkout.

```bash
.venv/bin/python scripts/library/depths_build.py status
```

```bash
.venv/bin/python scripts/library/depths_build.py start --max-mb 3000
```

```bash
.venv/bin/python scripts/library/depths_build.py stop
```

- `status` shows entries on disk per spot, seconds per entry, peak RAM and the projected hours left.
- `start` resumes after a stop or a reboot: entries already on disk are kept. It runs the batches within `--max-mb`
  (default 1000; this build runs at 3000).

`assemble.py` takes `library-build/sources/depths` by default (`FORMAT_SOURCES`, `--formats DIR`), the way it takes
the heads-up builds:

- only entries the build's index lists are taken, each hash-checked;
- each spot carries its `game`;
- a spot never shrinks below the last release;
- a format build's spot without a `game`, or with an id another source already has, is left out, so it can never
  overwrite a 100bb spot;
- each spot's target is its batch's flop count (`depth_plans`).

The 6-hourly publish picks the spots up once this is on `main`.

## Next batches

In order:

1. `3bp_bb_btn_40bb` to every flop: at ~0.3 GB a process, it is cheap.
2. HJ and UTG vs BB at 40bb and 200bb, on 184 flops. They are already in `FORMAT_SPOTS`.
3. The 40bb spots to 552 flops.
4. 25bb and 60bb (stored Practice depths). These need `FORMAT_SPOTS` entries and so an upstream change in
   gto-solver, then a re-import.
5. Heads-up 40bb (`2max_40bb`), which has charts (`pf_formats.HU_DEPTHS`). This also needs an upstream entry.
