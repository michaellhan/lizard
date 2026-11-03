# 07a: Feature status of upstream Study and Practice

**Scope.** This report grades the upstream solver snapshot in `solver/` (michaellhan/gto-solver main @ 9b907bd6, 2026-11-03) on each Study and Practice feature in the Lizard parity matrix. Each grade is checked against the implementing code and the tests that exercise it. The README is used only as a source of measured numbers. It is never taken as proof that a feature exists.

**Method.**
- I read the code under `solver/gto/` and `solver/gto/static/`, and grepped for features that might be missing.
- I counted tests with `grep -c '^test('` (Node) and `grep -c 'def test_'` (Python).
- I read the library index (`solver/gto/static/flop_library/index.json`, `mw_index.json`, `<spot>/report.json`) with small `python3 -c` snippets that do not import the solver.
- Nothing was run: no tests, no solves, no builds.
- Paths are relative to `/Users/mhan/Desktop/projects/lizard`.

**Evidence tags.**
- **[V]**: verified in code or data files.
- **[R]**: a measured number quoted from the upstream README, with its line.
- **[I]**: my inference.

**Grades.**
- **WORKING**: implemented end to end, reachable from the UI or the Advisor API, with tests.
- **PARTIAL**: the code exists but a meaningful part of the GTO Wizard equivalent is missing.
- **APPROXIMATE**: works through heuristics or modelled values rather than a solve.
- **NOT IMPLEMENTED**: absent.

**Effort.**
- **S**: 3 developer-days or less.
- **M**: up to about 2 weeks.
- **L**: more than 2 weeks, or bound by CPU time for library builds.

---

## 0. Summary

| # | Feature | Upstream grade |
|---|---|---|
| S1 | Presolved solution browser | **PARTIAL**: the browser works; the presolved coverage is narrow |
| S2 | Preflop solutions | **APPROXIMATE** |
| S3 | Postflop solutions | **WORKING** for heads-up, 3-way and 4-way; 5+ way is APPROXIMATE |
| S4 | Range matrix (13×13) and combo breakdown | **WORKING** |
| S5 | Action frequencies and EV | **WORKING** postflop; preflop EV only with the Solver source |
| S6 | Equity and EQR | **PARTIAL**: postflop only |
| S7 | Range comparison (two players / two nodes) | **PARTIAL** for two players; two nodes NOT IMPLEMENTED |
| S8 | Hand-class, draw and equity-bucket filters | **PARTIAL**: no equity buckets |
| S9 | Action and suit filters | **PARTIAL**: action filter on hover only; suit filter NOT IMPLEMENTED |
| S10 | Aggregate reports (flop and turn) | **PARTIAL** for flop; turn and river runout reports WORKING |
| S11 | Node navigation and comparisons | **PARTIAL**: navigation WORKING; comparison NOT IMPLEMENTED |
| P1 | Preflop trainer | **PARTIAL**, graded against an APPROXIMATE reference |
| P2 | Postflop trainer | **WORKING**, with few settings |
| P3 | Complete hands vs GTO opponents | **WORKING**; preflop opponents APPROXIMATE |
| P4 | Single-decision drills | **PARTIAL**: flop library only, 3 nodes |
| P5 | Custom drills | **PARTIAL** |
| P6 | Range builder | **WORKING** at class level |
| P7 | Multiple simultaneous tables | **WORKING** (2–4) |
| P8 | EV-loss scoring | **PARTIAL** |
| P9 | Session stats | **PARTIAL** |
| P10 | Coaching explanations | **PARTIAL** for rule-based; **WORKING** for AI (Practice only) |

**Key findings.**

1. **The Study engine is real and well tested. Presolved coverage is thin.**
   - **The engine:** `Advisor.study` (`solver/gto/advisor.py:3320`) returns a full range-vs-range answer at any node, solved live or read from the library. `solver/gto/static/study.js` (1,357 lines) renders it, with 31 Node tests in `solver/tests/js/study.test.js` and 15 Python tests in `solver/tests/test_study.py`.
   - **The presolved content [V]:**
     - preflop: hand-written charts, plus 2 stored preflop solves (`solver/gto/static/pf/6max_100bb.bin`, `6max_100bb_r5c3.bin`);
     - the flop first decisions of 18 heads-up 6-max 100bb spots;
     - 4 three-way spots on 185 flops each.
   - **Only 9 of the 18 heads-up spots** are on the current river-dealt tree with turn files: `srp_btn_bb` and the eight 3-bet pots. The other 9 single-raised spots list every flop under `old` (the older "blind river" entries) and have no turn files.
   - **Everything else is solved live in the browser** ("a Fast turn ~10 s in the browser" [R] `solver/README.md:427`).
   - **The project's own coverage fuzz** answered decisions as follows: charts 63%, live solves 24%, betting rules 12%, flop library 1.4% [R] `README.md:4684`.
2. **Preflop is approximate in both of Study's sources.**
   - **Charts** are "hand-written approximations of solver outputs" (`solver/gto/preflop.py:1-4`). They have no EVs. Their average error is 0.96 points over 26 published spots [R] `README.md:4550-4551`.
   - **The Solver source** is a real DCFR equilibrium over 169 classes. Its postflop is valued by a realization model (`solver/gto/pf_game.py:1-24`, `solver/gto/pf_study.py:1-10`). It opens tighter than published solves: UTG to SB 14.8 / 18.3 / 24.8 / 37.0 / 52.1%, against the charts' 18.7 / 22.9 / 30.0 / 45.1 / 44.7% [R] `README.md:543-546`.
   - **Practice never uses the preflop solve.** `grep preflop_solve` finds nothing in `practice.js`, `multitable.js` or `index.html`. Preflop practice is therefore graded by chart frequency, with no EV.
3. **Grading is inconsistent across modes.** This corrects report 02, which says "4 levels":
   - **Practice** uses 4 levels by frequency: Best move, Good, Inaccuracy, Mistake (`practice.js:418-424`). The thresholds are a frequency of 15% or more for ok, 3% or more for inaccuracy, else mistake (`index.html:1543-1544`). EV loss is shown but does not set the verdict.
   - **Drills** use 5 EV-based levels: Best, Correct, Inaccuracy, Mistake, Blunder. The cutoffs are under 2% of the pot for Inaccuracy and under 8% for Mistake (`drills.js:158-169`).
   - **The session analyzer** uses frequency, with `MIX_OK = 0.15` and `MIX_OFF = 0.03` (`session.js:20`).
4. **Practice is coupled to the page's engine.** `practice.js` and `multitable.js` drive the inline engine globals of `index.html`: `S`, `simulate()`, `act()`, `renderAll()`, `lastResult` and `gradeWith` (for example `practice.js:378`, `:428`; `multitable.js:248`). Study, the drills and the reports are much cleaner: they mostly use pure functions that the Node tests already export. Porting Practice is the largest UI job.
5. **Easy wins for Lizard on the client side.** The data needed for several missing features already arrives in every Study answer.
   - **Data already present:** each combo row is `[cards, reach, mix, EVs, equity, made, draw]` (`advisor.py:8465-8467`).
   - **Features it supports:** equity buckets, multi-select category and action filters, suit filters, sortable summary tables, and Compare EV / Best Action regret per hand.
   - **Cost:** about S each, with no engine work.

---

## 1. Study: feature matrix

| Feature | GTO Wizard equivalent | Upstream grade | Evidence (code; tests) | Limits / gaps | Notes for Lizard port |
|---|---|---|---|---|---|
| **S1 Presolved solution browser** | Study browser over "millions" of presolved spots, selected by format, depth and rake; instant | **PARTIAL** | **Code:**<br>• Panel: `solver/gto/static/study.js:1-7`<br>• Start list: `study.js:855-861` (New hand, Preflop solve, each library spot, the hand on the table)<br>• API: `solver/gto/advisor.py:3320-3350` (`Advisor.study`)<br>• Library reader: `solver/gto/flop_library.py:1-20`<br>• 3-way library: `solver/gto/mw_library.py`<br>• Data [V]: `index.json` has 18 heads-up spots, 552 or 1,755 flops each; `mw_index.json` has 4 spots × 185 flops; 2 stored preflop games<br>**Tests:**<br>• `solver/tests/test_study.py`: `test_flop_from_the_library` (:74), `test_turn_solved_live` (:179), `test_three_way` (:487)<br>• `solver/tests/test_study_store.py` (5)<br>• `study.test.js:509` "Study on a library flop's turn…"<br>• `study.test.js:615` "Study on a flop the library doesn't store…" | • Presolved content is limited to preflop, the flop first decisions of 18 heads-up spots, and 4 three-way spots.<br>• Turn files exist on 9 spots: `srp_btn_bb` and the 3-bet pots (1,203–1,755 flops). The 9 single-raised spots other than BTN vs BB are on the old blind-river tree with no turn files [V].<br>• Library entries are at most 0.15% of the pot from equilibrium (mean 0.109%) **in their abstracted game** [R] `README.md:4235`. The blind river costs 0.29 / 0.17% of the pot (OOP / IP) on BTN vs BB JcTd8d [R] `README.md:4246-4247`.<br>• 6-max 100bb only. The 40bb, 200bb and heads-up formats are described but not built in this snapshot: no spot in `index.json` has a `game` key [V]. The heads-up 2-max builds are still running outside the snapshot.<br>• No format, depth or rake selector; "The hand on the table" acts as the custom-game path.<br>• Deeper nodes are solved live: a Fast turn takes about 10 s in the browser [R] `README.md:427`. | • Keep the `Advisor.study` JSON (§3.1) as Lizard's "solution API", behind `worker.js` / Pyodide and `gto/server.py`.<br>• Every answer already carries provenance: `precomputed`, `approximate`, `solver.exploitability_pct`. Surface it as Lizard's coverage and accuracy label.<br>• Effort: UI **M**. Library breadth is CPU-bound (**L**): rebuild the 9 old-tree spots with turn files and add formats. |
| **S2 Preflop solutions** | Presolved preflop for every position and format, with EV, EQ and EQR per hand; custom preflop trees | **APPROXIMATE** | **Code:**<br>• Charts: `solver/gto/preflop.py:1-4` ("hand-written approximations of solver outputs"), 2–9 seats (`:17-26`)<br>• Solver source: `solver/gto/pf_study.py:1-48`, `solver/gto/pf_game.py:1-24`, `Advisor._study_pf` (`advisor.py:3352-3385`)<br>• Toggle: `study.js:865` (`pfHtml`)<br>• Stored games: `solver/gto/static/pf/` (2 files)<br>**Tests:**<br>• `solver/tests/test_pf_study.py` (22): `TestHeadsUp.test_equilibrium` (:333), `TestStored.test_btn_open` (:565), `TestAdvisor.test_flow` (:610)<br>• `solver/tests/test_pf_game.py` (18)<br>• `study.test.js:787`, `:817`, `:924` | • Charts: no EVs; Study shows strategy only (`viewsOf`, `study.js:300`).<br>• Solver source: strategy and EV, but no equity or EQR. Card removal is at class level. Flops are valued by a realization model, not solved.<br>• The solve opens tighter than published solves [R] `README.md:543-546`.<br>• The derived equilibrium "fits the published spots worse (2.4-3.0 points)" [R] `README.md:4556`.<br>• 2–6 players in the browser, 7 on the local server, none at 8–9; tournaments are refused.<br>• 2 games are stored; any other game is solved on demand. At about 0.21 s per iteration × about 800 iterations, 6-max takes roughly 3 minutes in Pyodide [I, from `pf_study.py:588-598`]. | • Wrap both sources, and label them "Charts (hand-made)" and "Model solve".<br>• Add preflop EQ from `pf_classes.equity_matrix` (**S**).<br>• Wrapping is **S**. GTO Wizard-grade preflop needs a postflop-solved preflop or licensed data (**L**). |
| **S3 Postflop solutions** | Presolved and custom solves, heads-up and 3-way, per combo, with many sizes | **WORKING** (heads-up, 3-way, 4-way); 5+ way flops and turns **APPROXIMATE** | **Code:**<br>• Discounted CFR (DCFR) in `solver/gto/solver.py` and the C core `solver/core/gtocore.c` (`README.md:1513` table)<br>• `Advisor._study_node` (`advisor.py:5174-5210`), `_study_mw_node` (`:5212-5270`), `_multiway_solve` (`:5272`)<br>• Size menus: `study.js:51-60`, offering Standard (flop 33/75, turn and river 33/75/125, raise 50), More, and Custom (up to 5 sizes, 5–500%)<br>**Tests:**<br>• `solver/tests/test_cfr.py` (7)<br>• `test_turn_river.py` (13)<br>• `test_multiway_solver.py` (61)<br>• `test_study_sizes.py` (4)<br>• `test_flop_library.py` (24)<br>• `test_mw_library.py` (12) | • The river matches the reference to about 1% [R] `README.md:1539`.<br>• Browser flop solves play the turn and river by hand buckets (32 Fast / 64 Accurate), with "from the turn the river is one card per class" [R] `README.md:~66-70`.<br>• 3-way: one turn and river size, one raise; streets below the solved one are bucketed [R] `README.md:4612`.<br>• 4-way: a smaller game. In Study, 5+ way flops are refused [R] `README.md:454`.<br>• Coverage fuzz: 12% of decisions are answered by betting rules [R] `:4684`. | • Reuse as is: this is upstream's core asset.<br>• Show `solver.iterations` and `exploitability_pct` on every node.<br>• **M**, mostly the size-menu and tree-editor UI. |
| **S4 Range matrix 13×13 and combo breakdown** | Strategy matrix, per-combo hand matrix, summary table (strategy, weight, EV, EQ, EQR) | **WORKING** | **Code:**<br>• `gridHtml` (`study.js:304-325`): 169 cells; strategy bars as tall as the range weight; EV, Equity and EQR shading<br>• `detailHtml` (`study.js:346-366`): each combo with its mix, EV and equity, sorted by EV<br>• Payload: `_study_range` (`advisor.py:8434-8480`)<br>**Tests:**<br>• `study.test.js:138` "the grid: 169 classes, the range's mix stacked, a focused action, numbers, and the opponent's range"<br>• `study.test.js:166`<br>• `test_study.py:193` `test_only_combos_in_the_range` | • One view mode (height = range weight); no horizontal, normalized or full-height modes.<br>• No sortable summary table, value/trash-removal scores or Blockers tab.<br>• Desktop uses hover; touch uses tap. | • The pure render functions are exported for the Node tests (`study.js:1356`). Port them to Lizard's components.<br>• **S** |
| **S5 Action frequencies and EV** | Actions table (frequency, % or bb toggle, EV); size grouping (S) | **WORKING** postflop; preflop EV only with the Solver source | **Code:**<br>• `actionsHtml` (`study.js:327-344`): frequency, combos, the EV of the hands taking each action; range totals with EV, equity and EQR<br>• Action records at `advisor.py:8447-8452`: `{action, amount_bb, freq, combos, ev_bb}`<br>• `rough_ev` when the range takes an action less than `RARE_BRANCH` = 1% (`advisor.py:244`, `:5192-5195`)<br>**Tests:**<br>• `study.test.js:166`<br>• `study.test.js:213` (rough_ev)<br>• `test_study.py:110` `test_rough_ev` | • EV is in bb "relative to folding now" only; there is no pot-% toggle.<br>• No size grouping.<br>• Preflop Charts have no EV.<br>• Instant (approximate) answers show the strategy only, until the node's own solve lands (`study.js:296-301`). | **S** |
| **S6 Equity and EQR** | EQ and EQR per hand and per range, preflop and postflop; equity distribution graph | **PARTIAL** | **Code:**<br>• `range_equities` (`solver/gto/breakdown.py:168-196`): on the flop a stride sample of runouts, with (combo pairs × runouts) kept near `PAIR_BOARD_OPS` = 4e7 (`:29`, `:158-165`); on the turn every river; on the river exact<br>• EQR (`study.js:234`): `c.evm / (c.eq * pot)`<br>• 3-way: `showdown_equities` (`solver/gto/multiway_solver.py:2275`)<br>• Equity curve and nut share at 80% or more: `breakdown.py:197-255`, `breakdown.js:73-108`<br>**Tests:**<br>• `test_breakdown.py`: `test_river_exact` (:73), `test_turn_symmetric` (:87)<br>• `study.test.js:117` "action labels, EQR and the cell numbers"<br>• `breakdown.test.js:68` | • No equity or EQR preflop (`viewsOf`, `study.js:300`).<br>• Postflop equity covers heads-up and 3-way, 4-way on the river only.<br>• None on instant answers.<br>• The flop equity is a sample. Its runout count is reported in `breakdown.runouts` [V]. | Add preflop equity from `pf_classes.equity_matrix`. **S/M** |
| **S7 Range comparison: two players / two nodes** | Ranges tab: OOP and IP side by side with summary bars, equity graph, hand/draw comparison; GTO Reports-style comparisons | **PARTIAL** for two players; two nodes **NOT IMPLEMENTED** | **Code:**<br>• Actor and opponent toggle (`whoHtml`, `study.js:294-295`): one grid at a time; the opponent grid shows weight and equity only (`advisor.py:8474-8480`)<br>• Breakdown: both players' category make-up (`breakdown.js:42-71`)<br>• Equity view: both curves, averages and nut advantage (`breakdown.js:73-108`)<br>• A grep for "compare" in the Study, Breakdown and report files finds nothing<br>**Tests:**<br>• `breakdown.test.js:46`, `:68`<br>• `study.test.js:396` | • No side-by-side grids, no range-text export, no diff view.<br>• The equity view is heads-up only.<br>• No comparison of two nodes or two solutions (sizes, rake, depth). | Diff two `Advisor.study` answers on the client. **M** |
| **S8 Hand-class, draw and equity-bucket filters** | Filters tab with categories and draw tiers (nut, broadway, mid, low flush draws); Ranges tab equity buckets, Simple or Advanced | **PARTIAL** | **Code:**<br>• `catsOf` / `filterRes` / `filterHtml` (`study.js:367-419`)<br>• 16 made-hand categories and 6 draw categories (`breakdown.py:20-26`)<br>• Breakdown's "Show these hands in the grid" (`breakdown.js:~66`)<br>**Tests:**<br>• `study.test.js:311` "the filter: one made hand or draw, the grid, the range's totals and the combos over its hands"<br>• `breakdown.test.js:172`<br>• `test_breakdown.py:25` `test_made_hands`, `:49` `test_draws` | • One category at a time; made-hand and draw filters can't be combined.<br>• No draw tiers.<br>• **No equity buckets**: only the curve and the share at 80% or more.<br>• Not available on the opponent grid or preflop. | Every combo row already carries its equity (`x[4]`) and category indices (`x[5]`, `x[6]`). Buckets and multi-select are client-side. **S** |
| **S9 Action and suit filters** | Click one or more actions to show only the hands that take them; include/exclude suits per card | **PARTIAL** (action); **NOT IMPLEMENTED** (suit) | **Code:**<br>• Hovering an action row sets `ST.focus` (`study.js:1318-1323`)<br>• The grid then shows only that action's segment (`study.js:314`); the EV view shows that action's EV (`:284`)<br>• No suit filter: grep finds `SUITS` only in card parsing and runout grouping<br>**Tests:**<br>• `study.test.js:138` ("a focused action") | • Mouseover only: on touch, a tap plays the action instead.<br>• One action at a time.<br>• Totals and combos are not recomputed. | Client-side over the combo rows. **S** |
| **S10 Aggregate reports (flop / turn)** | Flop reports over 1,755 weighted flops from any node; turn reports per card; Chart and Table views; EQR; grouping; highlighting; custom reports | **PARTIAL** (flop); turn and river runout reports **WORKING** | **Code (flop):**<br>• `solver/gto/static/reports.js:1-6`<br>• `texture` (`:18`); `VIEWS` (`:37`), which has 3 nodes: OOP first, IP vs check, OOP vs bet<br>• `rows` (`:62`); `average`, weighted by flop (`:86`); `html` (`:122`)<br>• Data [V]: `<spot>/report.json`; each flop has `{f, n, h, ev[2], eq[2], hash, w}`<br>**Code (turn and river):**<br>• `Advisor._runouts` (`advisor.py:3387-3417`)<br>• `solver/gto/static/runouts.js:1-5`, `GROUPS` (`:39`)<br>• `study.js:557-650`<br>**Tests:**<br>• `reports.test.js` (10), incl. `:171` "the shipped reports load, render and load a hand for every view"<br>• `runouts.test.js` (8)<br>• `test_runouts.py`: `test_against_brute_force` (:48), `test_stored_turns` (:127) | • Flop reports cover the 18 heads-up library spots only (the `mw_*` spots have no `report.json`) [V].<br>• 3 fixed nodes; no lead or raise nodes, no later streets.<br>• No EQR column, although EQR is computable from `ev` and `eq`.<br>• No Chart view, filtered-vs-all row, highlighting, size grouping, export or custom aggregate reports.<br>• Instant turn reports exist only where a spot stores turn files (9 spots). Elsewhere "Solve the flop" runs: a Fast turn report takes 0.3–1.2 s on 8 threads [R] `README.md:~343`.<br>• 3-way runout reports show strategy only.<br>• The README text "184 flops" (`README.md:325`) is stale: the index has 552 or 1,755 [V]. | • EQR, highlighting and grouping are client-side (**S**).<br>• Reports at any node need `build_report` to store more nodes (**M**).<br>• Custom aggregate reports are CPU-bound (**L**). |
| **S11 Node navigation and comparisons** | Spot selector with auto-fold and the J shortcut; deep links; saved spots (M); history | **PARTIAL** (navigation WORKING; comparison NOT IMPLEMENTED) | **Code:**<br>• `line()` and `back()` (`study.js:199-226`), `lineHtml` (`:512`)<br>• `act` (`:1077-1110`): step back, play an action, deal typed or random cards, open runouts<br>• Keys (`:1288-1294`): Esc, Backspace, B<br>• `startFrom` (`:1017`)<br>**Tests:**<br>• `study.test.js:55`, `:71` "the line: street headings, actions, preflop folds in a row as one step, and back", `:97` | • No auto-fold spot selector: every preflop action is played in turn, and folds in a row collapse into one step (`:206`).<br>• No Study deep links: the state lives in KV `gto-study` (`:660`).<br>• No saved spots, no comparison between nodes. | **M** |

---

## 2. Practice: feature matrix

| Feature | GTO Wizard equivalent | Upstream grade | Evidence (code; tests) | Limits / gaps | Notes for Lizard port |
|---|---|---|---|---|---|
| **P1 Preflop trainer** | Trainer from presolved preflop with EV grading, preflop-line filters, Spot mode | **PARTIAL** (graded against an APPROXIMATE reference) | **Code:**<br>• Practice's "Any hand" mode plays preflop (`practice.js:171`)<br>• Opponents play from the charts (`Advisor.play`, `advisor.py:6461-6519`)<br>• Your move is graded by `gradeWith` (`index.html:1485`) and `gradeClass` (`index.html:1543-1544`)<br>• No preflop EV: `practice.js:623`, `:627`<br>• The session analyzer's "Preflop only" scope applies to imported hand histories (`session.js:20`)<br>**Tests:**<br>• `practice.test.js:72`, `:671`<br>• `session.test.js:298`, `:313` | • No preflop-only mode: the drill modes skip preflop (`practice.js:169-178`).<br>• Graded against hand-written charts by frequency alone (15% or more = ok); no EV loss.<br>• The preflop solve is not used.<br>• The only setting is the seat picker (`practice.js:896-906`). | Build a preflop Spot mode on `pf_study` answers, which carry per-class EVs. **M** |
| **P2 Postflop trainer** | Trainer starting from flop, turn or river; board, texture and hand filters; Full Hand / Street / Spot modes; difficulty | **WORKING** (few settings) | **Code:**<br>• Practice drill modes Raised pot / 3-bet pot / Blind vs blind (`practice.js:169-196`): the preflop is auto-played until a heads-up flop of that pot type (`DRILL_TRIES` 400), then you play to the end<br>• Multitable "Instant flops" (`multitable.js:37-40`)<br>**Tests:**<br>• `practice.test.js:702` "drills: the preflop is played for you, ungraded, and dealt again until the pot is the drill's…"<br>• `multitable.test.js:423` | • 4 pot-type choices.<br>• No board, texture or hand filters; no Street mode.<br>• No difficulty, size grouping, frequency input, RNG or timebank (grep finds none).<br>• Practice solves at Quick (about 2 s), so turn grading is rough (`practice.test.js:749`; README: turns need Accurate). | **M** |
| **P3 Complete hands vs GTO opponents** | Full Hand mode; Play Mode | **WORKING** (preflop opponents APPROXIMATE; 5+ way uses heuristics) | **Code:**<br>• `practice.js:1-9`, `deal` (`:149`), opponent moves (`:197-214`)<br>• `settle` with side pots and rake (`:74-88`), `finish` (`:326`)<br>• Ring game with a moving button and rebuys (`:99-131`)<br>• `Advisor.play` (`advisor.py:6461-6519`)<br>**Tests:**<br>• `practice.test.js` (28): `:55`, `:72` "opponents move by asking the solver for their own hand's move; you are graded; showdown and score", `:311`<br>• `test_coverage.py:155` `test_play` | • Preflop opponents play the hand-written charts.<br>• Heads-up postflop moves are read off your own solve, giving "an edge the size of a blocker" [R] `README.md:4700-4704`.<br>• 5+ way flops and turns use betting rules.<br>• Opponents are always GTO: the `opponents` key is dropped (`advisor.py:6474`). | Extract a framework-free hand engine from `index.html` (`S`, `simulate()`, `act()`) first. **L** |
| **P4 Single-decision drills** | Spot mode: one decision repeated, on any street and node | **PARTIAL** (WORKING within the flop library) | **Code:**<br>• `solver/gto/static/drills.js:1-11`; `candidates` (`:98`), `problem` (`:141`)<br>• `grade` (`:154-169`): 5 levels, `MIX` 0.1, `TOL` 0.011, `RARE` 0.03<br>• `addScore` (`:173`), keys (`:188`)<br>• Entries are decoded in JS, with no solver needed (`:23-92`)<br>**Tests:**<br>• `drills.test.js` (13): `:104`, `:147` "grading: the best EV, or a played mix, is correct…", `:165` | • Flop only and library spots only.<br>• 3 nodes (OOP first, IP vs check, OOP vs bet); filters on texture only; no hand or "close decisions" filter. | Reuse the decoder as is (**S**). Drills at any node need more stored nodes (**M**). |
| **P5 Custom drills** | Saved trainer configs ("My Drills"): edit, duplicate, tags, sort, export/import; a built-in library | **PARTIAL** | **Code:**<br>• Session leaks become drill sets: `drillSet` (`session.js:451`, `SET_MAX` 40), `leaks` (`:529`), "Drill this leak" (`:784`)<br>• `startSet` (`drills.js:233`); the set is not kept (`:213`)<br>• Per-drill history keyed by spot and view (`drills.js:214-218`)<br>**Tests:**<br>• `session.test.js:607` "a session's leaks with their decisions, and a leak's drill set…"<br>• `drills.test.js:250`, `:274` | • No drill editor; configurations are not named or saved (only the last spot, view and filter).<br>• No export/import, tags or built-in library.<br>• Drill sets live in memory only. | Store drill configs in IndexedDB, with JSON export and import. **M** |
| **P6 Range builder** | Paint a range's strategy and get a 0–100% grade against GTO; pin, suits, category painting, lock, undo; results by category | **WORKING** (class level) | **Code:**<br>• `study.js:420-511`: `blankPaint` (`:425`), `brush` (`:430`), `scoreBuild` (`:441`), grade labels 90 / 80 / 65% (`:458`), panels (`:462-511`)<br>• Works at any Study node, preflop included<br>**Tests:**<br>• `study.test.js:244` "the range builder: a blank paint, brushes, the score, and its grid, panel and detail" | • Paints by hand class and is scored against the class-average mix (`paint.f[cls]` vs `c.f`). Suit-dependent strategies such as flush draws can't be expressed or graded.<br>• No category painting, lock or undo/redo.<br>• No per-category or equity-bucket results.<br>• The tally lives in memory only.<br>• No EV loss preflop with the Charts source. | Add combo-level paint (the combo rows exist), category brushes and undo. **S/M** |
| **P7 Multiple simultaneous tables** | Up to 4 tables, each with its own controls and info panel | **WORKING** | **Code:**<br>• `solver/gto/static/multitable.js:1-14`: 2–4 tables, one request in flight, priority by what it unblocks (`INSTANT` 0.5 s, `SHORT` 4 s at `:25`)<br>• Picker: `practice.js:907-936`<br>**Tests:**<br>• `multitable.test.js` (13): `:68`, `:105`, `:170` "instant answers go first, and a long solve in flight gives way…", `:299` | • One solver queue, so live solves are serialized.<br>• One drill mode for all tables; no timebank. | Port the scheduler logic. **M** |
| **P8 EV-loss scoring** | EV loss in bb and % of the pot per decision; GTOW Score from −100% to +100%; blunders judged by EV | **PARTIAL** | **Code:**<br>• `gradeWith` (`index.html:1485-1540`): loss = best EV − your EV, with fields `m, f, b, bf, l, e, o, h, rv, r, x`<br>• Practice verdict by frequency (`index.html:1543-1544`); multiway rules by % of the pot (`HEUR_OK` 3 / `HEUR_MEH` 10, `:1478`)<br>• Practice "bb lost / decision" (`practice.js:836-846`)<br>• Drills grade by EV (`drills.js:158-169`)<br>**Tests:**<br>• `practice.test.js:563`, `:610`, `:671`<br>• `drills.test.js:147`, `:165` | • In Practice the verdict ignores EV size, and Practice shows no % of the pot.<br>• Preflop has no EV, so no EV loss.<br>• No GTOW-style score.<br>• Three different scales (Practice, drills, session). | Use `drills.js` `grade()` everywhere and add a score formula Lizard defines itself. **S** |
| **P9 Session stats** | Sessions page, lifetime stats filtered by format and date, by-pot-type panel, practiced-hands table with replay | **PARTIAL** | **Code:**<br>• Practice score `ZERO` (`practice.js:18`): `{hands, decisions, best, good, evDecisions, evLost, net}`, shown by `stats()` (`:836`)<br>• Review mistakes (`REVIEW_KEEP` 60, shows 6; `:31`, `:850`)<br>• Multitable session score (`multitable.js:701`)<br>• Drills history (`drills.js:173-183`)<br>• Session analyzer for hand histories (`session.js:1-15`, `report` `:373`, `HISTORY_MAX` 200 `:20`)<br>**Tests:**<br>• `practice.test.js:563`<br>• `multitable.test.js:299`<br>• `session.test.js:221`, `:377`, `:401` | • The Practice score is one running total until Start over: no per-session records, dates or pot-type split.<br>• No table or replay of practice hands; only the last 60 decisions are kept.<br>• Rich stats exist only for imported hand histories. | Store per-session records and reuse `session.js` `report()` on practice decisions. **M** |
| **P10 Coaching explanations (rule-based and AI)** | None: "plain-language solver output" is on GTO Wizard's roadmap (02 §3.10) | **PARTIAL** (rule-based); **WORKING** (AI, Practice only) | **Code (rule-based):**<br>• `why()` (`practice.js:431-444`)<br>• `heroRead` (`:529`): made hand, draws with outs, texture, position<br>**Code (AI):**<br>• `EXPLAIN_PROXY` (`:485`), `AI_SYSTEM` (`:487-496`), `prompt` (`:604-639`), streaming (`:687`)<br>• Worker: `solver/cloudflare/explain-proxy/src/index.js`, `proxy.js`<br>**Tests:**<br>• `explain.test.js` (10): `:55`, `:106`, `:205`, `:305`<br>• `solver/cloudflare/explain-proxy/test/index.test.js` | • The rule-based text only restates frequencies and EVs.<br>• AI explanations appear only on Practice and multitable verdict cards, not in Study, drills, the session analyzer or the range builder.<br>• The prompt carries the hand's own mix, EVs and hand read, but no range-level data.<br>• Defaults to the upstream author's deployed `workers.dev` proxy (origins restricted) or the user's own key in localStorage. The key's location is recorded in §5; no value is copied here. | Deploy Lizard's own proxy, make its URL configurable, and add Study's range data to the prompt. **S** (proxy), **M** (grounding) |

---

## 3. Evidence details

### 3.1 The `Advisor.study` answer at a node [V]

The shape is assembled from `solver/gto/advisor.py:5196-5210` (heads-up), `:5256-5262` (3-way) and `:8434-8480` (`_study_range`). Rounding is to 3 decimals for frequencies and 2 for bb.

```json
{
  "study": "node", "street": "flop", "actor": "BB", "opponent": "BTN",
  "position": "OOP", "players": 6, "board": "Kc7d2h",
  "pot_bb": 5.5, "to_call_bb": 0.0, "stack_bb": 97.5,
  "actions": [{"action": "check", "amount_bb": null, "freq": 0.83, "combos": 310.2, "ev_bb": 1.71, "rough_ev": true}],
  "grid": {"actions": ["check", "bet 33%"], "cells": {"AKs": {"w": 1.0, "f": [0.4, 0.6], "ev": [3.1, 3.2], "evm": 3.16, "eq": 0.71}}},
  "combos": {"AKs": [["AsKs", 1.0, [0.4, 0.6], [3.1, 3.2], 0.71, 8, 5]]},
  "categories": {"made": [["quads", "Quads or better"]], "draws": [["combo", "Combo draw"]]},
  "range_combos": 372.4, "range_ev_bb": 2.1, "range_eq": 0.46,
  "opponent_combos": 290.0, "opponent_eq": 0.54,
  "opponent_grid": {"actions": ["in range"], "cells": {"AKs": {"w": 0.5, "f": [1.0], "eq": 0.6}}},
  "solver": {"iterations": 300, "solve_seconds": 2.1, "nodes": 90, "active_combos": 640, "exploitability_pct": 0.11},
  "precomputed": {}, "notes": [], "seconds": 0.03,
  "breakdown": {}
}
```

- **Combo row:** `[cards, reach, mix[A], ev[A], equity|null, made_idx, draw_idx]`. The last two index into `categories`.
- **`precomputed`** appears only on a library answer. **`breakdown`** appears only when the request sets `"breakdown": true`.
- **3-way answers** add `"multiway": true` and `"opponents": [{seat, combos, eq, grid}]`. Their `position` reads "k of n to act".
- **Other states:**
  - `{"study": "deal", "street", "allin"}` and `{"study": "over", "winner" | "showdown"}` (`advisor.py:743-747`);
  - preflop solve states `pf_unsolved`, `pf_none`, `pf_progress` and `pf_export` (`:3352-3385`);
  - runout reports `{"study": "runouts", …}` (`:3387`).
- **Dropped from Study requests:** `STUDY_DROPS = ("hero", "hole", "opponents", "locks", "jam", "library_only", "optimize_sizes")` (`:2855`). Study is therefore always at equilibrium, with no node-locking.

### 3.2 Library coverage in this snapshot [V]

These figures come from reading `index.json` and `mw_index.json`, and from counting `.bin` files.

| Spot group | Spots | Flops stored | Turn files | Tree |
|---|---|---|---|---|
| `srp_btn_bb` | 1 | 1,755 | 1,755 | current (river dealt) |
| `srp_{co,hj,utg,sb}_bb` | 4 | 1,755 each | none | old (blind river; `old` lists every flop) |
| `srp_{hj_co,btn_sb,utg_hj,co_sb,utg_btn}` | 5 | 552 each | none | old |
| 3-bet pots: `3bp_bb_btn`, `btn_co`, `sb_btn`, `sb_co`, `hj_utg` | 5 | 1,755 each | 1,203 each | current |
| `3bp_bb_co` | 1 | 1,755 | 1,698 | current |
| `3bp_co_hj`, `3bp_bb_sb` | 2 | 1,755 each | 1,755 each | current |
| 3-way: `mw_co_btn_bb`, `mw_btn_sb_bb`, `mw_hj_ip_bb`, `mw_utg_btn_bb` | 4 | 185 each | none | (no `report.json`) |

- **Shared tree:** `{flop_bet: [0.33, 0.75], flop_raise: [0.5], bet/raise turn & river: [0.75], max_raises: 2, allin_spr: 2.5}`.
- **Coverage claim:** the library answers 83.6% of heads-up flop decisions in the 6-max 100bb game the charts play [R] `README.md:4196`.
- **Heads-up 2-max builds:** observed read-only, not in the snapshot.
  - `srp_sb_bb_2max`: 293 of 474 flops in `.work/hu-lib` (742 `.bin` files), last-logged exploitability about 0.12%.
  - `lp_sb_bb_2max`: 30 of 424 in `.work/hu-lp-lib` (316 `.bin` files), about 0.10%.

### 3.3 Grading scales [V]

| Where | Verdict levels | Basis | Thresholds |
|---|---|---|---|
| Practice / multitable (`practice.js:418-424`; `index.html:1543`) | Best move, Good, Inaccuracy, Mistake (+ Not graded) | frequency of your action | Best = the top-frequency action; ok f ≥ 0.15; meh f ≥ 0.03 (or a rough solve); else Mistake. Multiway rules: by % of the pot lost, ≤ 3 ok, ≤ 10 meh |
| Drills (`drills.js:154-169`) | Best, Correct, Inaccuracy, Mistake, Blunder | EV loss (frequency when there are no EVs) | Best if loss ≤ `TOL` 0.011; Correct if f ≥ `MIX` 0.10; Inaccuracy under 2% of the pot; Mistake under 8%; else Blunder |
| Session analyzer (`session.js:20`) | the Practice classes | frequency | `MIX_OK` 0.15, `MIX_OFF` 0.03 |
| Range builder (`study.js:458`) | Excellent, Good, Fair, Off | accuracy = 1 − combo-weighted total-variation distance (`:441-457`) | ≥ 0.90, ≥ 0.80, ≥ 0.65 |
| GTO Wizard (02 §3.3) | Best, Correct, Inaccuracy, Wrong, Blunder, plus GTOW Score | frequency with EV | Inaccuracy under 3.5% frequency; the blunder cutoff is not published |

### 3.4 Where answers come from: practice versus study

- **Preflop.** Practice opponents and your grade both use the charts (`advisor.py:6469-6472`). Study adds the optional preflop solve.
- **Postflop, heads-up.** One solve, from the hero's view, serves both the hero's grade and the opponent's move (`advisor.py:6464-6470`).
- **Speed.** Practice at Fast asks for Quick answers of about 2 s (`practice.test.js:749`; `README.md:~70`). Turn verdicts are therefore graded against rough solves. `g.r` marks "rough solve: a hint, not a verdict" (`practice.js:470`) [V].

---

## 4. GTO Wizard sub-features upstream lacks

These are confirmed absent by grep and reading. GTO Wizard sources are in report 02 §3.

**Study**
- Metrics:
  - Compare EV, which colours hands by which of two chosen actions has the higher EV;
  - Best Action, the regret per hand;
  - Range-weight and "All" metrics;
  - a bb / % of pot toggle.
  - The regret appears only as a node-level `regret_bb`, in the preflop solve (`pf_study.py:517`).
- Matrix modes: horizontal, normalized and full height; custom action colours and themes.
- Tables and tabs:
  - a sortable summary table with value-removal and trash-removal scores;
  - a Blockers tab;
  - a side-by-side Ranges tab;
  - range-text copy and export in PioSolver or GTO+ format. Upstream only *imports* PIO-style ranges (`index.html:749`).
- Filters:
  - equity buckets;
  - draw tiers;
  - suit filters;
  - multi-select action filters combined with category filters;
  - Performed% and Represented% in Breakdown;
  - Manhattan plots.
- Navigation: the J spot shortcut with auto-folds, Study deep links, saved spots (M), and a solution selector across formats, depths and rakes.
- Comparing two solutions or two nodes.
- Reports:
  - flop reports from any node;
  - an EQR column;
  - a Chart view and a "filtered" row compared with all flops;
  - conditional highlighting;
  - action grouping (All / Grouped / Simple);
  - saved filters;
  - export;
  - custom aggregate reports;
  - reports for 3-way spots.

**Practice**
- Modes and settings:
  - a Street mode;
  - Standard / Grouped / Simple difficulty;
  - Frequency input mode;
  - High/Low RNG;
  - a 7/15/25 s timebank;
  - game speed, auto new hand, pause after mistakes, and hard mode.
- Deal filters: board, texture and hand filters for full-hand practice, "Only close decisions", and preflop-line filters.
- Alternating roles; a pop-out info panel; hand-history replay of practiced hands.
- Scoring: a GTOW-style score, average frequency difference, and EV loss as % of the pot in Practice.
- Sessions and stats: a sessions page, lifetime stats filtered by date and format, and a practiced-hands table.
- Drills: saved drill configs with tags, sort and export/import; a built-in drills library; study plans; a daily quiz.
- Training against custom solutions or node-locked player profiles. Upstream has locks and an exploit pool in the advice, but Practice opponents are always GTO.
- Range builder:
  - per-suit (pinned) painting;
  - category painting;
  - lock;
  - undo/redo;
  - results by category and equity bucket;
  - a sizing-group re-grade.

**Upstream features GTO Wizard lacks (02 §3.10, §5)**
- AI explanations in Practice.
- The "Simple" one-size view (`solver/gto/static/simple.js:1-11`), an analogue of dynamic sizing at any heads-up node.
- Browser-local solving of any game the table can set up, including ICM and bounties in Study (`README.md:~410-416`).
- River runout reports.
- Session leaks turned into drill sets.
- "Turns" links from flop reports into Study.

---

## 5. Port recommendations (ordered)

1. **Use `Advisor.study` as the single data contract (§3.1)** for Lizard's Study, Range Builder and Practice grading. Lizard's main build is a UI over it.
   - Show `precomputed`, `approximate`, `solver.exploitability_pct` and `rough_ev` on every screen as honest accuracy labels.
   - Effort: **M**.
2. **Add the client-side Study features first.** They need no engine work, and the combo rows already hold the data:
   - equity buckets;
   - multi-select category, action and suit filters;
   - Compare EV and Best-Action regret per hand;
   - a sortable summary table;
   - an EQR column in the reports;
   - range-text export.
   - Effort: **S** each.
3. **Use one grading scale.**
   - Adopt `drills.js` `grade()`, which is EV-based with 5 levels.
   - Replace Practice's frequency verdict (`index.html:1543`) with it.
   - Add a Lizard-defined score.
   - Feed preflop EVs from `pf_study` where a solve exists, and otherwise label preflop grades "chart-based, no EV".
   - Effort: **S**.
4. **Extract a hand engine** from the inline script of `index.html` (`S`, `simulate`, `act`, `settle` from `practice.js:74`) before porting Practice and multitable. Their 41 Node tests (28 + 13) are the regression net. Effort: **L**.
5. **Library work (CPU-bound, L):**
   - rebuild the 9 old-tree single-raised spots with the river dealt and with turn files;
   - store more nodes per flop, so that reports and drills can open at any node;
   - add the heads-up 2-max spots once the running builds finish;
   - consider `report.json` for the 3-way spots.
6. **Preflop labelling (S).** Ship Charts and Model solve as clearly labelled sources. Do not present either as GTO Wizard-grade presolved preflop.
7. **AI coach (S/M).**
   - Deploy a Lizard-owned proxy and make `EXPLAIN_PROXY` configurable. It is currently hard-coded to the upstream author's worker at `practice.js:485`.
   - The upstream Anthropic key is a Worker secret, set with `npx wrangler secret put ANTHROPIC_API_KEY` (`solver/cloudflare/explain-proxy/wrangler.toml:2`). It is not in the repo. A user's own key is stored in localStorage `gto-anthropic-key` (`practice.js:486`).
   - Extend explanations to Study, drills and the session analyzer, and ground them on the range data in §3.1.

## 6. Corrections to other reports and docs

- **Report 02 §3.3 says upstream verdicts have 4 levels.** That is true of Practice only. The drills already use 5 levels with EV-based Blunder (`drills.js:158-169`).
- **The upstream README says "a table of its 184 flops"** (`README.md:325`). This is stale: report files cover 552 or 1,755 flops [V].
- **Report 02 says "18 HU spots".** That is right, but half of them (9 single-raised pots) are still old blind-river entries with no turn files [V]. This affects both accuracy claims and instant turn coverage.

## 7. What I verified and what I inferred

- **Verified [V]:**
  - all file:line citations, constants and thresholds;
  - the JSON shapes (from code);
  - the library counts (from the data files);
  - the absence claims (from grep);
  - the test names and counts.
  - The repository holds 678 Python and 377 Node tests in all; none were run.
- **README [R]:** accuracy, coverage and timing numbers, as marked with their lines.
- **Inferred [I]:**
  - the preflop solve time in the browser (from `estimate_seconds`);
  - the effort sizes;
  - that suit-dependent strategies are lost in the range builder. This follows from class-level paint and scoring (`study.js:425-457`) but was not exercised.
