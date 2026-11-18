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
npm run qa:sweep              # node scripts/qa/run.mjs: the default matrix, 21 configs, about 20 minutes
node scripts/qa/run.mjs --seed 1 --config 6max-100bb-gto-srp --hand 0   # one hand of one config, a replay
node scripts/qa/run.mjs --pf-agree                                      # the chart against the preflop solve, every class
```

A Quick or Fast answer stops on a time budget, so a replay deals the same cards and draws the same moves, but where an
answer near a frequency boundary came out differently the line can part from the run's after it. Preflop (the charts and
the stored solve) and library answers replay exactly.

| Option | Meaning |
|---|---|
| `--seed N` | Base seed (default 1). The same seed deals the same hands and draws the same moves. |
| `--hands N` | Hands per config, overriding the matrix. |
| `--only TEXT` | Run only the configs whose name contains TEXT. |
| `--config NAME` | Run only the config of exactly that name (from either profile). |
| `--hand N[,M...]` | Play only those hand numbers of each config. Each hand deals and draws from its own seed, so a hand replays alone, and the summary prints this command for each hard example. A replay asks every postflop decision again at Fast (and the first two at Accurate). |
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
  restarts mid-config if its RSS passes the cap. A restart in the middle of a hand is followed by the hand's earlier
  postflop requests asked again (`kept` on the next record), so the next answer stands on the hand's earlier streets as
  the page's own process, which doesn't restart, would have them.
- After every config has played, a reference process re-asks the sampled decisions at Fast and Accurate. Before each
  one it asks the hand's earlier postflop requests (each opponent's move with its seed, and your decisions) at the
  reference's speed (`warmed`), and if its process restarts for the answer itself it does so again (`cold` if that
  happens twice). A later street's answer depends on what its process solved earlier in the hand: a 3-way turn narrows
  the flop through the flop's solve, or else by the betting rules, so a reference asked cold answers a different
  question from the one Quick answered.

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
- One stored tournament preset: Final-table bubble, 5 players at 40bb with a 0.2bb ante, graded with ICM on the preflop solve's own options.

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
  Correct (hard). The chart's other moves at MIX or more are soft. Where two or more moves tie for the chart's most
  played (a 50/50 hand), they are hard only if the solve grades every one of them below Correct, otherwise each one
  graded down is soft: before 2026-11-18 whichever the chart listed first was hard and the other soft. Graded by the
  charts: the chart's most played move is Best.
- `pf.untrained`: a node with a move the solve never learned an EV for (`untrainedMoves`) is never graded by EV.

**Coverage.** What answered each spot type is tallied: library, live, rules, charts, preflop solve, push-fold. Two
shares are flagged:

- heads-up 6-max 100bb single-raised flops against GTO opponents, with no rake, ante or straddle, answered by the
  library (want 50% or more);
- 3-way flops served by the library or a live solve (want 80% or more).

**Quick against a reference.** A seeded sample of your postflop Quick decisions (26 in `--quick`, 220 in the matrix)
is asked again at Fast, and a smaller subset (2 and 12) at Accurate, on the reference advisor. The same action is
graded on both answers, and the summary counts agreement, "Quick condemns, the reference passes" and "Quick passes,
the reference condemns" (soft `ref.condemns` and `ref.passes`, with both answers' frequency and EV).

Your move is mostly drawn from Quick's own mix, which Quick grades Best or Correct by frequency alone, so the move made
says little about the grade a player choosing anything else would see. So every action at the node is also graded on
both answers (`all` in the reference record), and the summary gives those rates where either answer was a live solve:
a library flop is the same entry at every speed, so a library pair agrees by construction and is left out.

**Opponents.** Every opponent move is flagged for:

- a fold when checking was free (`opp.freeFold`, hard: should be 0);
- a river fold of the nuts (soft);
- a flop or turn fold of two pair or better made with its own cards, facing three quarters of the pot or less
  (`opp.strongFold`, soft);
- facing a pot-size bet or more with nothing (no pair, no draw, no straight or better), whether it called.

Rates are tallied by opponent kind (`live.sim.test.ts`'s measures, on real answers). An opponent move the table refused
is a hard `opp.refused`.

**Performance.** Wall time per decision by mode and street (soft `perf.slow` for Quick over 15 s), and each advisor's
peak RSS per config. Every record carries the advisor's peak RSS after its request, and the request that takes a
process past 1 GB (the project's rule for one process) is a soft `perf.rss`. A decision's time leaves out the time the slot wrapper held a new process before it could answer
(the config's first request, or the first after a restart at the RSS cap). That time is counted in the config's
"waiting to start" instead.

**Plumbing.** These are hard:

- `answer.error`: a request failed, timed out, or came back as an error.
- `answer.empty`: an answer had no actions.
- `decide.error`: `decide` refused an option of the answer.
- `flow.need`: `needOf` asked for something one table never asks for.

## Measured

Both runs used seed 1, on 2026-11-18, on this Mac with the library builds running. The slot wrapper starts a process at
once when a CPU slot is free; otherwise it polls every 15 s until one is.

### `--quick`

The run took 181 s of wall time, 77 s of it waiting for the slot wrapper to start a process. It played:

- 4 configs and 42 hands;
- 71 of your decisions, all graded;
- 288 opponent moves;
- 28 reference answers (26 Fast and 2 Accurate).

The advisor's peak RSS was 548-1205 MB, and the reference's was 843 MB. Twice a process went over the 900 MB cap after a
request and was restarted. The 1205 MB was reached inside one request, in the loose-opponent config's multiway pots. The
memory guard never acted on the sweep.

Three hard violations, the same in three runs:

| check | count | where |
|---|---|---|
| `prov.settled` | 2 | 6max-100bb-gto-srp, hands 0 and 1, turn. The ranges come from the rules after an opponent's rare bet or raise (BB's turn bet of 125% is 8.7% in the solve; BB's turn raise to 14 is 5.9%), and the answer still shows a converged band (0.03-0.04% of the pot) next to its approximate label. |
| `pf.follow` | 1 | 3max-100bb-live-any, hand 0, BTN 8cJd first in. The chart raises 50% and folds 50%; the preflop solve folds 100% and grades the raise Inaccuracy (0.08bb, 0.4% of the pot past its noise). |

Earlier runs of the same seed also found `prov.settled` on river answers whose earlier streets were narrowed by the rules,
or by a narrowing solve followed 0%. Those also showed a converged band (0.09%).

Soft, measured:

- 4 converged bands after an opponent's rare line was solved again.
- One chart move mixed at 25% (BB 8sJh calling a HJ open), graded Inaccuracy by the solve.

What answered:

- Heads-up 6-max 100bb single-raised flops against GTO opponents: the library, 9 of 10.
- 3-way flops: live solves, 2 of 2.
- 4-way flops: the rules, 2 of 2.
- Turns and rivers: live solves.
- Preflop: the charts' answer at every spot. The preflop solve graded 28 of the 37 decisions. The charts graded 9,
  because the solve's tree doesn't hold the line (6) or its options aren't yours (3).

Quick against Fast agreed on 25 of 26, and against Accurate on 2 of 2. Neither ever condemned what the other passed.

No opponent:

- folded when checking was free;
- folded the nuts on the river;
- called with nothing facing a pot-size bet.

Timing:

- No Quick decision took over 15 s.
- Quick averaged 0.03-0.85 s a decision by street (preflop 0.4 s, at most 1.9 s), because an opponent's move on the same
  street has usually just solved the spot.
- Fast references averaged 0.07-2.7 s by street, at most 6.2 s.
- The Accurate turn took 16.5 s.

### The default matrix

Re-run on 2026-11-18 after the triage's harness fixes, so its hands draw differently from the first run's. The fixes:
each hand on its own random stream, every action compared with the reference, RSS per request, the tie and pot
fixes, and every answer asked in the hand's context (the reference warmed, the main process kept). The first run, on
the old harness, found the same two kinds of hard violation.

The run took 1169 s (19.5 minutes) of wall time, no config cut. 595 s of it was spent waiting for the slot wrapper to
start a process: at each config's start, at each of 18 restarts at the RSS cap, and for the reference process. It
played:

- 21 configs and 324 hands;
- 496 of your decisions, all graded;
- 3303 opponent moves;
- 147 reference answers (139 Fast and 8 Accurate).

The number of references is what the sampling found: 70% of the postflop decisions, up to 220. Before 114 of them the
reference was asked 195 earlier requests of the hand (none answered cold). Three times the main process restarted in
the middle of a hand, and the next request came after 11 requests asked again.

**23 hard violations**, 19 `prov.settled` and 4 `pf.follow`. Each comes from one of two product defects.

`prov.settled` (19, in 11 of the 21 configs, live answers only, never the library): a converged band (0-0.3% of the
pot) on an answer whose ranges are not the solve's own. The reasons:

- 11: an opponent's rare line was not solved again (with the seat's range widened in 7).
- 5: the rules narrowed a street.
- 1: both of those.
- 2: a turn's narrowing solve stopped unsettled on its time budget (3.6% and 2.2% of the pot), so the ranges follow it
  80-97%.

The cause is `web/src/solver/provenance.ts`: `provenanceOf` sets the band from the solve's own exploitability (lines
223-226) and then marks the answer approximate for its ranges (`rangesOffOf`, lines 246-252) without revisiting the
band. The badge reads "0.04% pot from equilibrium in the solved game (converged) · approximate". The grade is not
affected: the same answers lean on the rules (`leansOnRules`), and their grades stop at Inaccuracy.
`node scripts/qa/repro/prov-settled.mjs` shows it on a minimal answer, with no solver.

`pf.follow` (4, the same four as the first run): the chart's most played move graded below Correct by the preflop
solve, in a preflop-solve session (the default where the solve applies: `practice.ts` `pfByDefault`):

- Heads-up SB 8dTd at 100bb: the chart limps 99%, the solve raises 100% (EV 1.0 against 0.35), so the limp is a
  Blunder (0.65bb).
- 2-max 20bb SB 2h3s folding: Inaccuracy, 0.10bb.
- 2-max 20bb BB 9cAh calling a raise to 3: Mistake, 0.45bb.
- 6-max 20bb SB AcJd facing a CO open: Mistake, 0.45bb.

"Preflop: the chart against the solve" below has the rates over every class.

18 soft violations:

- 8 converged bands after a rare line was solved again.
- 3 chart moves the solve grades down:
  - a mixed one (BB 8sJh calling 25%, Inaccuracy);
  - two of a 50/50 tie whose other move the solve grades Best (2-max BB QcTs folding to a raise, Mistake 0.61bb; 3-max
    BTN Kc6d raising, Inaccuracy).
- 4 `perf.rss`:
  - an opponent's flop move in a 5-way pot took the main process to 1169 MB (6max-100bb-loose-any hand 4);
  - the reference went to 1037-1061 MB on three Fast answers, two of them heads-up limped turns.
- 3 `ref.missing`: Fast had no 50% bet where Quick's small 3-way flop game offered one.

What answered:

- Preflop: the charts 98.1% (push-fold 1.9%) of 309 decisions. The preflop solve graded 139 of them and the charts
  169. The charts graded the rest because the solve's tree doesn't hold the line (18), its options aren't yours (13), it
  never plays the size (5), or the line left its sizes (4).
- Heads-up 6-max 100bb single-raised flops against GTO opponents with no rake, ante or straddle: the library, 18 of 18.
- At a library spot's preflop line, every live answer but one came where the library has nothing:
  - a flop the spot hasn't built (40bb and 200bb hold 184 flops, the heads-up limped pot 208);
  - or a line the entry doesn't store (a raise the other player reaches with under 5% of their range).
- The one is a hole (2max-100bb-gto-any hand 3). The heads-up limped pot's tree bets 33% and 75% of a 2bb pot, and
  33% (0.66bb) is under the smallest bet. `_legal_to` (`solver/gto/advisor.py`) lifts it to 1bb, a size the tree
  doesn't hold, so after "SB bet 1" on a flop the library holds (Ac5d3h), the answer was solved live.
- 3-way flops: live solves, 9 of 9. 4-way flops: the rules, 4 of 4.

Quick against the reference, where either answer was a live solve:

| reference | the move made: agree | Quick condemns | Quick passes | every action: agree | Best/Correct or not agree | Quick condemns | Quick passes |
|---|---|---|---|---|---|---|---|
| Fast | 99/110 (90.0%) | 0 | 0 | 342/388 (88.1%) | 361/388 (93.0%) | 2 (0.5%) | 2 (0.5%) |
| Accurate | 5/5 | 0 | 0 | 14/19 | 19/19 | 0 | 0 |

So Quick and Fast give a different verdict to about one action in eight at a live node, and one in fourteen crosses
between Best/Correct and the rest; most are Best or Correct against Inaccuracy. Four cross between a pass and a Mistake
or Blunder, at three nodes and all small in big blinds:

- 2-max 100bb limped river (BB 3sAd): a 125% bet, Quick Best and Fast Mistake (EV 0.07 against 0.03). Quick's river
  stood on a turn narrowing that stopped unsettled.
- 2-max 100bb turn (SB TdAc): a 75% bet, Quick Correct and Fast Mistake (EV 3.27 against Fast's 3.07, best 3.26).
- 6-max ante turn (BB 6d6s): 33% and 75% bets, Quick Mistake and Fast Correct (EV 1.14 and 1.07 against 1.40 and 1.33).

The first matrix run on the new harness showed three serious flips at one 3-way hand (6max-100bb-loose-any hand 9,
UTG QsQd on Kd9h8s4s facing BB's 6.5bb turn bet). Fast said fold Best and call Blunder (EV -5.78), against Quick's
call Best (EV 7.52). The cause was the harness, which asked the Fast reference cold: its process hadn't solved the
hand's flop, so the rules narrowed the flop. Asked in context, Fast says call Best (EV 7.94), as Quick does. The main
process had the same fault after a restart at the RSS cap. Replaying that hand without the fix, its Quick turn came
after a restart, said "ranges through the flop from the betting rules", and graded fold Best.

No opponent folded when checking was free, folded the nuts on the river, folded two pair or better to three quarters
of the pot or less, or called with nothing facing a pot-size bet (0 of 6).

Timing: no Quick decision took over 15 s (the slowest 1.88 s; by street 0.03-0.68 s on average). Fast references
averaged 0.35-1.54 s by street, at most 11 s. The Accurate references sampled only flops and rivers, at most 1.9 s.

Peak RSS stayed under 1 GB in 20 of the 22 peaks:

- 6max-100bb-loose-any reached 1236 MB, on a preflop-solve decision after the 5-way flop move above had taken it to
  1169 MB.
- The reference process reached 1126 MB.

Each was reached inside one request; the process restarted at the cap afterwards. A peak depends on what the process
did earlier. Hand 4 alone peaks at 736 MB, and hands 0-4 together reach 1229 MB on the same opponent move:
`node scripts/qa/run.mjs --seed 1 --config 6max-100bb-loose-any --hand 0,1,2,3,4`. A peak reached while earlier
requests are asked again is in the config's peak but on no record.

### Preflop: the chart against the solve

`node scripts/qa/run.mjs --pf-agree` asks every one of the 169 classes at nine spots through the Practice path, and
grades the chart's most played move by the solve. It took about 13 minutes. Share of the hands dealt (by combos) where
the move the chart plays most is graded below Correct, and Mistake or Blunder:

| spot | below Correct | Mistake or Blunder | worst |
|---|---|---|---|
| 2-max 100bb, SB first in | 16.4% | 14.0% | QJs: limps 71%, the solve raises; Blunder 1.11bb. A8s, 22, A7s, A6s limped 97-100%: Blunder 0.84-1.02bb |
| 2-max 100bb, BB facing a raise to 3 | 2.7% | 2.7% | 77 and 88 3-bet 100%, the solve calls: Blunder 1.46 and 1.16bb |
| 2-max 20bb, SB first in | 3.9% | 0.6% | A5s limps 98%, the solve raises: Blunder 0.38bb |
| 2-max 20bb, BB facing a raise to 3 | 2.6% | 1.7% | A9o calls 97%, the solve shoves: Mistake 0.45bb |
| 3-max 100bb, BTN first in | 2.7% | 0.9% | K5o: raises 50% (a tie), the solve folds: Mistake 0.12bb |
| 6-max 100bb, UTG first in | 0.5% | 0.0% | 22 raises 80%: Inaccuracy 0.09bb |
| 6-max 100bb, BTN first in | 1.8% | 0.9% | K5o raises 50%: Mistake 0.13bb |
| 6-max 100bb, SB first in | 3.6% | 3.6% | 98o, T8o, 87o fold 100%, the solve raises; A2o raises 100%, the solve folds: Mistake 0.11-0.18bb |
| 6-max 100bb, BB facing a BTN open to 2.5 | 3.0% | 2.7% | AJo and A5o 3-bet 60%, AQo 100%, the solve calls: Mistake 0.41-0.46bb |

The heads-up 100bb small blind is where they part most: the charts limp a wide range the solve raises, and the solve
values the raise up to a big blind more, so following the chart there is a Mistake or Blunder on one hand in seven.

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
- **A reference in its own process.** The reference advisor is asked the hand's earlier postflop requests at its own
  speed, so a Fast reference stands on Fast's own earlier streets, not on what Quick solved. That is the comparison
  wanted (a player at Fast would have Fast's earlier streets), and its solve cache is its own.
- **Not played:** exploit practice and node locks, multi-table charts (one table only), drills from the library, the
  run-out after your fold, Reveal, and PLO.
