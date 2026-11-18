# Practice QA sweep

`scripts/qa/` plays seeded Practice hands through the page's own code against the browser worker's Advisor, run
natively, and checks every decision, every opponent move and every finished hand against a set of invariants. It
writes one JSON line per record, plus a summary, and exits non-zero when a hard invariant fails.

## Why it exists

The owner kept finding Practice errors by hand. Some were grades that contradicted their own words. Others were
"converged" badges on answers whose ranges came from the betting rules, opponents folding when a check was free, and
preflop moves the charts play graded as mistakes. Each was found one hand at a time, in the browser. The sweep plays
hundreds of hands the same way the page does and checks the same things automatically, on every decision.

## Running it

From the repository root:

```sh
npm run qa:sweep:quick        # node scripts/qa/run.mjs --quick: 4 configs, about 3-5 minutes
npm run qa:sweep              # node scripts/qa/run.mjs: the default matrix, 21 configs, about 30-45 minutes
```

| Option | Meaning |
|---|---|
| `--seed N` | Base seed (default 1). The same seed deals the same hands and draws the same moves. |
| `--hands N` | Hands per config, overriding the matrix. |
| `--only TEXT` | Run only the configs whose name contains TEXT. |
| `--out DIR` | Output directory (default `qa-out/<profile>-<time>`, gitignored). |
| `--explore X` | Share of your moves picked uniformly among the options instead of from the answer's mix (default 0.12), so off-mix moves get graded too. |

| Environment variable | Meaning |
|---|---|
| `QA_LIBRARY` | Flop library directory. Default `/Users/mhan/Desktop/projects/lizard/library-build/lizard-library`. Opened read only. |
| `QA_PYTHON` | Python executable. Default `/Users/mhan/Desktop/projects/lizard/.venv/bin/python`. |
| `QA_SLOT` | CPU slot wrapper each advisor process runs under. Default gtosolver's `.work/bin/slot.sh`; set it empty to run them directly. |
| `QA_THREADS` | Native solver threads per advisor (default 2). |
| `QA_CACHE_MB` | Solve cache size (default 150; the worker's is 700). |
| `QA_RSS_CAP_MB` | An advisor restarts once its current RSS passes this after a request (default 900). |
| `QA_DROP_PF` | `1` (default) drops the stored preflop solves read for a request once it is answered; `0` keeps them, as the worker does. |

One advisor process runs at a time, under the slot wrapper:

- The main one is started fresh for each config, so each config has a clean cache and its own peak RSS. It also
  restarts mid-config if its RSS passes the cap.
- After every config has played, a reference process re-asks the sampled decisions at Fast and Accurate, with a cold
  cache.

The slot wrapper can hold a new process until a CPU slot is free. When that happens the sweep logs "waiting for a CPU
slot" every 30 s, and the summary's Configs table shows how long each config waited. The Node side is light; it needs
jiti, which comes with the dev dependencies (`npm install`).

Output, under `qa-out/<profile>-<time>/`:

- `decisions.jsonl`: one record per line, of five kinds.
  - `hero`: your decision, with the answer's source, band, label, the grade, and every action's verdict at the node.
  - `opp`: an opponent's move, with its flags.
  - `hand`: a finished hand.
  - `ref`: a reference comparison.
  - `config`: one config, with its wall time, the advisor's peak RSS and how many times it restarted.

  Every record carries its config, the hand's seed, the hand number, and the violations found on it. Hero, opponent
  and reference records also carry the street and the line.
- `summary.json` and `summary.md`: the tallies below.

Exit codes: 0 when there is no hard violation, 1 when there is at least one, 2 on a harness error.

## What it plays

Each config is a Practice session as the page would start it (`scripts/qa/matrix.ts`). The seat moves, the pot drill,
opponents, ante, straddle and rake are set as on the setup form. The preflop solve is on where the game is stored
(`pfByDefault`) unless the config turns it off. A tournament preset is read through `TournamentFields` the way the form
reads it.

The sweep mirrors the room (`room.ts`):

1. `flow.ts` `needOf` says what is next.
2. Opponents move through `SolverClient.play` and `moveOf`.
3. Your spot is asked through `SolverClient.solve`, and in a preflop-solve session the solve's node is asked next to
   it.
4. `pfGrade.ts` `gradedOn` picks which answer grades the decision.
5. `practice.ts` `decide` grades it.
6. A drill redeals until it reaches its pot, and `finish` settles the hand.

The solver transport is `scripts/qa/py.ts`, so the page's client applies the mode, the tree cap, bunching and
`provenanceOf` exactly as the browser does. The Python side, `scripts/qa/advserver.py`, mirrors `worker.js` as
`scripts/pyodide/worker-edits.mjs` publishes it:

- It installs the engine modules in the worker's order: `engine.pf_stored`, `pf_icm_study`, `tree_depth`, `pf_charts`,
  `bunching`, `mw_near`, `mw_quick`, then `gto.advisor`.
- It uses the worker's Fast and Accurate configs (the threaded variant).
- It reads the flop and 3-way libraries.
- It sends a preflop-solve request, a node lock and an exploit read to the same handlers as the worker.
- It serialises the answer with plain `json.dumps`.

**Mode.** Practice's Fast setting plays Quick (`room.ts`: `fixedMode ?? (accurate ? "accurate" : "quick")`), so Quick
is the mode under test. One config plays Fast as the room's fixed mode.

The default matrix covers:

- 2, 3, 6 and 9 players.
- 20, 40, 100 and 200bb, plus one 15bb config.
- Opponents: gto, live and loose.
- Pots: srp, 3bet and any hand.
- Rake 5% capped at 3bb on one config, a 0.12bb ante on one, and the straddle on one.
- The preflop solve on (the default) and off.
- One stored tournament preset: Final-table bubble, 5 players at 25bb, with ICM.

`--quick` covers:

- 6-max 100bb against GTO opponents, any hand (mostly preflop, graded by the preflop solve).
- 6-max 100bb single-raised pots (library flops, then live turns and rivers).
- 3-max 100bb against live opponents.
- 6-max 100bb against loose opponents, who deal you playable hands and see more multiway flops.

## The checks

Each check returns violations tagged `hard` or `soft`. A soft check is measured and reported but does not fail the
run. The checkers are pure TypeScript in `web/src/qa/checks.ts` and `summary.ts`. They call the page's own code
(`practice.ts` `gradeMix`, `practiceBasis`, `table.ts`, `history.ts`, `hh/replay.ts`, `provenance.ts`) and never a copy
of it. `web/src/qa/checks.test.ts` tests them on hand-made fixtures in CI, with no solver. `npm run qa:typecheck` typechecks the harness in `scripts/qa/`.

**The table and the records** (every finished hand)

- `table.legal`: every recorded move was legal where it was recorded, by `table.ts`'s rules. This covers whose turn it
  was, a check facing a bet, a call with nothing to call, bet versus raise, an under-raise, a raise of the whole stack
  that should be recorded as all-in, and moves recorded before the board card was out.
- `table.pot`: each seat's chips at the table equal an independent ledger built from the lines. The ledger counts
  antes, blinds a stack can cover, calls, bets and raises to their size, all-ins, and an uncalled bet given back.
  (`sim.pot` is defined as the sum, so it is checked against this ledger rather than against itself.)
- `table.chips`: chips are conserved. The stacks after the hand plus the rake equal the stacks before it, and the pot
  paid out plus the rake equals the chips put in. After your fold, the others are settled as `chipsAfter` settles
  them, and your result is minus what you put in.
- `records.replay` and `records.result`: `history.ts`'s hand history is read back by Analyze's importer. It must reach
  the end and give the same chips in per seat, the same stacks, the same players left and the same result
  (`records.sim.test.ts`'s checks, on real hands).

**Provenance honesty** (every decision; the answer that graded it, plus the chart's answer and the solve's node when
both were asked)

- `prov.source`:
  - No answer is "Unlabelled".
  - A preflop-solve request is answered by `preflop-solve`.
  - A preflop spot is answered by charts, push-fold, rules, equity or the preflop solve, and a postflop spot is not.
  - The answer is for the street asked.
  - Soft: a library answer off the flop, a live answer with no iterations, and a chart answer with an EV on every
    action.
- `prov.label`: an approximate answer says why, through a label, a band of `approximate`, or a source that names
  itself as no solve (charts, push-fold, rules, equity). Those self-naming sources are always marked approximate.
- `prov.honesty`, `prov.band` and `prov.settled` apply when the answer's own fields say its ranges or numbers aren't
  its own solve's: the betting rules, an unsettled narrowing, an unresolved rare line, a widened range, a spot served
  as built (`ranges_built`) or another table's spot (`precomputed.borrowed`). Then:
  - the answer must be approximate and carry a label;
  - another spot's solver numbers are not shown;
  - a built or borrowed answer has no settled band;
  - and never a `converged` band (hard).

  A converged band after an opponent's rare line that was solved again is only soft.
- `prov.lean`: where those fields lean on the rules (what `leansOnRules` counts), the grade's basis says so.

**Grade sanity** (every decision, grading every action at your node with the basis built exactly as `practice.ts`
builds it, not only the action taken)

- `grade.mix`: an action played at least MIX (10%) is Best or Correct.
- `grade.top`: the top-EV action (within TOL) is Best.
- `grade.monotone`: among the actions left to EV, the verdict never improves as the EV given up past the noise grows.
- `grade.cap`: a capped grade has a `capWhy`, and a `clearWhy` grade is a Blunder.
- `grade.nan`: no loss, percentage, noise or word is NaN, undefined or Infinity.
- `grade.words`: the loss is measured against the top EV, and the stated loss, whyText's "gives up only X against the
  top EV, NAME" and lossWords' "EV given up: X" all equal EV(named top) − EV(action) to the cent.
- `grade.best`: the best action named is played, or is the action graded.
- `grade.decided`: the grade `decide` kept matches the same action graded again.

**Preflop**

- `pf.follow`, graded by the solve: the solve's own most played move, and the chart's most played move, are Best or
  Correct (hard). The chart's other moves at MIX or more are soft. Graded by the charts: the chart's most played move
  is Best.
- `pf.untrained`: a node with a move the solve never learned an EV for (`untrainedMoves`) is never graded by EV.

**Coverage.** What answered each spot type is tallied: library, live, rules, charts, preflop solve, push-fold. Two
shares are flagged:

- heads-up 6-max 100bb single-raised flops against GTO opponents answered by the library (want 50% or more);
- 3-way flops served by the library or a live solve (want 80% or more).

**Quick against a reference.** A seeded sample of your postflop Quick decisions (26 in `--quick`, 220 in the matrix)
is asked again at Fast, and a smaller subset (2 and 12) at Accurate, on the reference advisor. The same action is
graded on both answers, and the summary counts agreement, "Quick condemns, the reference passes" and "Quick passes,
the reference condemns" (soft `ref.condemns` and `ref.passes`, with both answers' frequency and EV).

**Opponents.** Every opponent move is flagged for:

- a fold when checking was free (`opp.freeFold`, hard: should be 0);
- a river fold of the nuts (soft);
- facing a pot-size bet or more with nothing (no pair, no draw, no straight or better), whether it called.

Rates are tallied by opponent kind (`live.sim.test.ts`'s measures, on real answers). An opponent move the table refused
is a hard `opp.refused`.

**Performance.** Wall time per decision by mode and street (soft `perf.slow` for Quick over 15 s), and each advisor's
peak RSS per config.

**Plumbing.** These are hard:

- `answer.error`: a request failed, timed out, or came back as an error.
- `answer.empty`: an answer had no actions.
- `decide.error`: `decide` refused an option of the answer.
- `flow.need`: `needOf` asked for something one table never asks for.

## Measured

`--quick`, seed 1, on 2026-11-18 (this Mac, with the library builds running):

The run took 214 s of wall time, about 110 s of it waiting for the slot wrapper to start a process: a fresh process
waits at least one 15 s poll, and the first waited 31 s for a slot held by another session. It played:

- 4 configs and 42 hands;
- 71 of your decisions, all graded;
- 288 opponent moves;
- 28 reference answers (26 Fast and 2 Accurate).

The advisor's peak RSS was 1004-1137 MB, reached during a 3-way flop solve or a postflop solve right after a
preflop-solve read. The process restarted right after each, and the memory guard never acted on it.

Three hard violations, the same in two runs:

| check | count | where |
|---|---|---|
| `prov.settled` | 2 | 6max-100bb-gto-srp, hands 0 and 1, turn. The ranges come from the rules after an opponent's rare bet or raise (BB's turn bet of 125% is 9.3% in the solve; BB's turn raise to 14 is 5.8%), and the answer still shows a converged band (0.04% of the pot) next to its approximate label. |
| `pf.follow` | 1 | 3max-100bb-live-any, hand 0, BTN 8cJd first in. The chart raises 50% and folds 50%; the preflop solve folds 100% and grades the raise Inaccuracy (0.08bb, 0.4% of the pot past its noise). |

Other runs of the same seed also found `prov.settled` on a river answer whose earlier streets were narrowed by the
rules, or by a narrowing solve followed 0% (39.3% of the pot from equilibrium after 10 iterations). Each was again shown
with a converged band of 0.09%.

Soft, measured:

- 4 converged bands after an opponent's rare line was solved again.
- One chart move mixed at 25% (BB 8sJh calling a HJ open) graded Inaccuracy by the solve.
- Two Quick preflop decisions over 15 s, both in multiway preflop pots (SB 4c2c facing a UTG open and a BTN call, 16.0
  s; BTN 8cJd first in at 3-max, 15.3 s).

What answered:

- Heads-up 6-max 100bb single-raised flops against GTO opponents: the library, 9 of 10.
- 3-way flops: live solves, 2 of 2.
- 4-way flops: the rules, 2 of 2.
- Turns and rivers: live solves.
- Preflop: the charts' answer at every spot. The preflop solve graded 28 of the 37 decisions; the charts graded 9,
  because the solve's tree doesn't hold the line (6) or its options aren't yours (3).

Quick against Fast agreed on 24 of 26, and against Accurate on 2 of 2. Neither ever condemned what the other passed.
No opponent folded when checking was free, folded the nuts on the river, or called with nothing facing a pot-size bet.
Quick took 0.02-1.2 s a decision on average by street, because an opponent's move on the same street has usually just
solved the spot. Fast references took 0.2-3 s on average, with a maximum of 15.3 s, and the Accurate turn took 17.8 s.

The default matrix was not run for this note; its 30-45 minutes is estimated from these per-hand times and the
15 s per process start (22 starts).

## What it doesn't cover

- **Browser rendering.** Nothing is drawn. The badge, the grade card and the words on screen are not checked, only the
  data they are made from. That remains Playwright's job (`web/e2e/`).
- **Pyodide speed.** The advisor runs natively on 2 threads. The browser runs wasm on its helpers, which is several
  times slower, so the times measure the engine's work, not what a phone or laptop waits. Quick's time budget also
  stops a native solve later in the solve than a wasm one, so some answers differ from the browser's.
- **The worker's memory.** The solve cache is 150 MB instead of 700. The stored preflop solve read for a request is
  dropped once it is answered, then read again (0.4 s) at the next preflop-solve request, to the same answer. A 6-max
  one holds about 580 MB, and with it resident a postflop solve took the process to 1.0-1.2 GB. The worker keeps it, so
  a browser playing a 6-max preflop-solve session holds that much more than the sweep does. Nothing is stopped part
  way or answered progressively; Practice asks untimed in any case.
- **Your opponents' draws.** The page asks `play` with no seed; the sweep passes a seeded one so a run repeats. Quick
  and Fast solves stopped on a time budget are not exactly repeatable across runs, so two runs of one seed can part
  after the first time-budget answer.
- **A reference asked cold.** The reference advisor has its own cache, so a Fast reference doesn't reuse what Quick
  solved on the opponent's turn. That is the comparison wanted, but it is not what the page would show at Fast in the
  same session.
- **Not played:** exploit practice and node locks, multi-table charts (one table only), drills from the library, the
  run-out after your fold, Reveal, and PLO.
