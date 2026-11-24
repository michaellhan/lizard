# Single-size library

GTO Wizard's "Single Size Solutions" store a full postflop tree for every preflop spot, with one bet size a node. This is
Lizard's version: 38 spots covering the 6-max 100bb preflop lines on a set of representative flops. Each flop's single
flop bet size is picked by the solver's own automatic sizing. Built 2026-11-17 (workstream W4 of `docs/GAP_PLAN.md`).

The owner's rule was: "Covering every preflop spot on fewer flops is better than a few spots on every flop." So the
build goes flop by flop, solving every spot on one flop before moving to the next, and a flop is published only once
(nearly) every spot holds it. The UI lists the flops covered.

## What it holds

- **Game:** 6-max, 100bb, the solver's standard ranges (the same `srp_*`, `3bp_*` and `4bp_*` setups as the main
  library and the breadth build; `scripts/library/build_single_size.py` `SPOTS` names each spot's base).
- **Spots (38):** every heads-up line of 6-max 100bb, that is 15 single-raised pots, 15 3bet pots and 15 4bet pots,
  at the library's preflop sizes.
  - 38 of the 45 lines are solved as spots of their own: 13 single-raised, 13 3bet and 12 4bet pots.
  - The other 7 are alias lines, which share a spot's ranges: HJ vs BTN, UTG vs CO, CO 3bet vs UTG, BTN 3bet vs HJ, UTG 4bet vs CO,
    HJ 4bet vs BTN and HJ 4bet vs SB. Each is read under its own label.
- **Flops:** `representative_flops(184)` first, then the rest of `representative_flops(552)` (the solver's
  stratified flop sets, the same ones the main library uses).
- **Tree:** each node has one bet size.
  - The flop bet is the solver-chosen size.
  - Turn and river bets are 75%.
  - Raises are 50% on the flop and 75% on the turn and river, at most 2 a street.
  - Single-raised pots use the library's classic tree (turn stored, river solved blind).
  - 3bet and 4bet pots also store each turn's river subgame in a turn file, as the classic library's deeper spots do.
- **Sizing:** upstream `advisor.py` `_optimize_sizes`, unchanged. It solves a wide tree first (25–200% and all-in, one
  street deep, one raise), then keeps the size the solver bets most often. That is the most-used size at either the
  out-of-position root or the in-position node after a check; a tie goes to the smaller size.
- **Quality:** the library's flop model (`flop_library.library_config`), solved for at least 200 iterations, then
  until under 0.15% of the pot from equilibrium, at most 1,000. The sizing solve stops at 0.3% (100–400 iterations). Every entry records its own iterations and exploitability, and the app shows them.

Sizes chosen in the first 244 entries (6 flops):

| Pot | Sizes picked |
| --- | --- |
| Single-raised | 25% (47), 33% (16), 50% (6), 75% (7), 100% (8), 200% (4) |
| 3bet | 25% (26), 33% (3), 75% (5), 200% (47) |
| 4bet | all-in on every flop (165–231% of the pot, depending on the stack) |

## Format

The library sits beside the classic library's files, in the same format-2 entries (GTOFL3 entries and GTOTN1 turn
files). The difference is that each flop has its own tree, so it has its own index, `ss_index.json` (`ss_format: 1`).

- **`flops`:** the flops covered on every spot, in build order.
- **`spots`:** for each spot, its line, seats, pot and stack. Per flop, it also holds:
  - the entry hash (`flops`);
  - the chosen size (`sizes`);
  - a key into `trees` (`flop_tree`);
  - which flops use the classic tree (`old`), and whether turn files exist (`turns`).

Readers:

- **The engine:** `engine/single_size.py`. `SingleSizeLibrary` is a `FlopLibrary` that picks the tree flop by flop. A
  wrap on `Advisor._advise_at` uses it when a request carries `single_size: true` and adds a `single_size` block to the
  answer (`stored`, `spot`, `flop`, `sizes`). The Pyodide worker imports it after `engine.bunching` (a build-time edit
  declared in `solver/UPSTREAM.json`).
- **The web app:** `web/src/library/singleSize.ts` reads the index, matches a hand to a spot, and builds the request.
  `web/src/solver/singleSize.ts` writes the provenance words "single-size tree with solver-chosen sizes".

The Study page offers it as a separate flop source (Library | Single size) on 6-max 100bb hands with no setup of
their own. With Single size picked, the page shows:

- whether this flop is held, and its size;
- which flops are covered.

A flop or line the library doesn't hold is asked from the main library or solved live, as usual. The Library page has
its own table for the single-size library, with flop counts, Study links that pick it, and the list of covered flops.

## The build

`scripts/library/build_single_size.py` writes into the main checkout's ignored
`library-build/sources/single-size`, with run state in `library-build/runs/single-size/` and the log in
`library-build/runs/single-size.log`.

```bash
PY=/Users/mhan/Desktop/projects/lizard/.venv/bin/python
B=scripts/library/build_single_size.py
$PY $B status                     # supervisor, entries done, s/entry, KB/entry, ETA, the log's tail
$PY $B plan                       # spots, phases, entry count
# start (or resume) detached, from the run directory so slot.sh doesn't tie it to a checkout's slot:
cd /Users/mhan/Desktop/projects/lizard/library-build/runs/single-size && \
  nohup /Users/mhan/Desktop/projects/gtosolver/.work/bin/slot.sh $PY <checkout>/$B start --jobs 2 --hours 48 \
  > ../single-size.log 2>&1 & disown
$PY $B index                      # rewrite ss-index.json from what's on disk (the build does this every 20 entries)
```

- `start` freezes the script and `solver/` into `runs/single-size/code-<hash>/`, then runs the frozen copy. Later edits
  to the checkout can't change a running build.
- A supervisor restarts the workers after a crash or a lost worker. Finished entries are kept, and each flop's sizing
  solve is cached in `<flop>.sizing.json`.
- Each worker is watched:
  - a 3bet or 4bet entry that goes over 1,000 MB is solved again on the classic tree (one that goes over on the
    classic tree is left out, and the 90% rule below lets its flop publish anyway);
  - a stalled entry is retried.
- The deadline (`runs/single-size/deadline.json`, 48 h from the first start) stops it cleanly and writes
  `deadline-reached`. A later `start --hours N` sets a new deadline.

## Cost (trial, then live)

- **Trial (2026-11-17, a few flops each of BTN vs BB in all three pot types):**
  - 4bet pots on the dealt tree: 2–4 s, 0.28–0.47 GB.
  - 3bet pots on the dealt tree: 10–17 s, 0.55–0.76 GB.
  - Single-raised pots on the dealt tree: 43 s and 1.2–1.4 GB, over the 1 GB a process budget. That is why
    single-raised pots use the classic tree, where they took 6–15 s and 0.35–0.54 GB.
- **Live, first 244 entries:**
  - 6 s an entry; 4.6 KB an entry with its turn file;
  - peak 842 MB;
  - 88 entries on the classic tree.
- **All 552 flops:** 20,976 entries, about 35 CPU hours, about 16–23 h with 2 workers.
  - About 95 MB, and about 63 files a flop: 552 flops come to about 35,000 files.

## Budget

- GitHub Pages allows 1 GB a site, and the owner wants at least 100 MB of headroom.
- The library site's stage is capped at 900 MB (`MAX_TOTAL` in `assemble.py`). The single-size part has its own cap
  of 250 MB (`SS_BYTES`).
- At release b3d8a40c the library held 482 MB and 78,598 files. With all 552 single-size flops, that becomes about
  575 MB and about 114,000 files.
- `MAX_FILES` went from 90,000 to 120,000 for this. GitHub Pages limits bytes, not files, and 49,298 files deployed
  in 80 s.

The other options, more flops or wider sizing, were weighed:

- **1,104 flops:** about 190 MB, which still fits the budget. It would need about 150,000 files and another 35 CPU
  hours. This is a later step if it's wanted.
- **Two sizes a node:** about 3 times the entry size, for less benefit than more flops.

## Publishing (`scripts/library/assemble.py`)

`add_single_size` stages the single-size source after the classic, heads-up, 3-way, breadth and nuts sources.

- A flop goes in, in build order, once 90% of the spots hold it (`SS_SHARE_PCT`), while the single-size bytes stay
  within `SS_BYTES` and the stage stays within the file cap. A spot that is missing a flop simply leaves it to a live
  solve.
- No spot ever ends up with fewer flops than in the previous release's `ss_index.json`.
- Entries are validated like every other source's (sha1, turn-file hash, report hash).
- The summary in `lizard-library.json` gets a `singleSize` block.

The tests are `SingleSizeTest` in `scripts/library/test_assemble.py` and `scripts/engine/test_single_size.py`.

### Integration, once the build has run

1. Check the build:
   - `build_single_size.py status` should show no supervisor and every entry done (or `deadline-reached`).
   - Run `build_single_size.py index` once, so `ss-index.json` is current.
2. Merge the branch into `main`. Main's `assemble.py` before that doesn't know the source and ignores it.
3. Check the size without publishing: assemble into a scratch directory, then count it.

   ```bash
   S=$(mktemp -d)/stage
   /Users/mhan/Desktop/projects/gtosolver/.work/bin/slot.sh .venv/bin/python scripts/library/assemble.py \
     --out "$S" --previous library-build/lizard-library
   du -sm "$S"; find "$S" -type f | wc -l; python3 -m json.tool "$S/lizard-library.json" | grep -A8 singleSize
   ```

   It must stay under 900 MB and 120,000 files; `assemble.py` refuses otherwise. Expect about 575 MB and about
   114,000 files.
4. Publish by the usual path in `docs/DEPLOYMENT.md` §2. That is `scripts/library/publish.sh` through `slot.sh`, or
   simply wait for the 6-hourly launchd run, which picks the source up once the branch is merged.
5. Deploy the app (push `main`; the Pages workflow builds it) so the Study picker and the Library table ship.
6. Mark the `docs/FEATURE_MATRIX.md` row WORKING for the covered flops once the live `ss_index.json` reads in Study.

## Ante and straddle games (2026-11-24, W13)

Six heads-up spots in two games beside the 100bb ones, on the same one-size tree and flop sets
(`build_single_size.py --set games`, `GAME_SPOTS`; source `library-build/sources/ss-games`):

| Spot | Game | Line | Pot / stack (bb) |
| --- | --- | --- | --- |
| `ss_srp_btn_bb_ante` | 6-max 100bb, 1bb big-blind ante (0.17bb a seat) | BTN opens 2.5, BB calls | 6.52 / 97.33 |
| `ss_srp_co_bb_ante` | same | CO opens 2.5, BB calls | 6.52 / 97.33 |
| `ss_srp_sb_bb_ante` | same | SB opens 3, BB calls | 7.02 / 96.83 |
| `ss_3bp_bb_btn_ante` | same | BTN opens 2.5, BB 3bets 10, BTN calls | 21.52 / 89.83 |
| `ss_srp_btn_utg_straddle` | 6-max 100bb, 2bb straddle from UTG | BTN opens 5, UTG calls | 11.5 / 95 |
| `ss_srp_co_utg_straddle` | same | CO opens 5, UTG calls | 11.5 / 95 |

- **Ranges:** not the charts. Each spot's two ranges entering the flop come from Lizard's stored preflop solve of the
  same game (`engine/pf_solve.py`, keys `lz4_6max_100bb_a0.17_ch` and `lz4_6max_100bb_s_ch`, W11's files): each seat's
  reach at its last decision times its share of that move, by hand class. `build_single_size.py pf-ranges --set games`
  writes them to `pf-ranges.json` (with each game file's sha1), checking that the solve's raise sizes are the line's; the
  index carries them as `pf_ranges` and the game file as `pf`. The raise sizes are the charts' (the stored solve plays
  them), so the lines are the charts' lines.
- **Reading:** a single-size request in that game (the setup's ante exactly 0.17, or the straddle and no ante) on that
  exact line plays those ranges (`engine/single_size.py` `game_spot`), so the stored entry's fingerprint matches and is
  read. The answer's `single_size.game` and `single_size.ranges` name the game and the preflop solve, and provenance says
  "ranges entering the flop from Lizard's stored preflop solve of this game (…), not the charts; preflop is
  approximate". Any other ante or a straddle with an ante plays the charts as before, with no game spot.
- **Study:** the flop source (Library / Single size) is offered at 6-max 100bb with no setup, or with exactly one of
  these games; the note lists the game's own covered flops and says whose ranges they are. The Library page lists the
  game spots with their ranges' source, each game's covered flops, and Study links that carry `ante=0.17` or
  `straddle=1`.
- **Flops:** the 184, then the rest of the 552, then the rest of the 1,755 in a golden-ratio stride (so a stop partway
  still spreads over the textures), within a 14-hour run (about 28 CPU hours at 2 workers).
- **Publishing:** `assemble.py --ss-games` (default the source above) puts them into the same `ss_index.json` after the
  100bb spots, on their own flops by the same 90% rule, within `SS_GAMES_BYTES` (100 MB) and what the file cap leaves; the
  100bb spots' `flops` list stays theirs. `lizard-library.json`'s `singleSize.games` carries the target and each game's
  flops. About 7 files a flop for the six spots (single-raised entries 1 file, the 3bet pot 2): 552 flops is about 3,900
  files and 25 MB, which fits beside the 111,655 files published; more than about 1,150 flops needs a higher file cap or
  the R2 path.
- **Not covered:** the straddle's SB open (6bb) and the 3bet and 4bet pots in the straddled game, other antes and stacks,
  multiway. The preflop solve is a class-level model at the charts' raise sizes (approximate, labeled so).

Tests: `scripts/engine/test_single_size_games.py` (a one-entry library built on a fake pf-ranges file; the real stored
games where W11's files are in `engine/pf/`), `test_assemble.py` `SingleSizeGamesTest`, and the web tests named in the
FEATURE_MATRIX row.

Once the build has run: `build_single_size.py status --set games`, then `build_single_size.py index --set games`, merge
W11 (the stored game files) and this branch, then assemble and publish by the usual path (above).
