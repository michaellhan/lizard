# LIZARD feature matrix

Status as of 2026-11-03. This compares LIZARD with the public feature set of GTO Wizard, one row per feature. Each row has two grades:

- **Engine / classic.** What the bundled solver and its own web app (the "classic" app, `solver/gto/static/`, served at `/gto-solver/`) can do today.
- **Lizard UI.** What the new React app (`web/src/`) does today.

The solver is a snapshot of michaellhan/gto-solver at 9b907bd6, in `solver/`. Paths below are relative to the repository root.

## How this was graded

- Lizard grades come from reading the code only. Nothing was built, run or solved for this pass, because two long library builds were using the machine. A grade of WORKING for Lizard means the code path is complete and has unit tests. It does not mean it was clicked through in a browser.
- Classic grades come from reading the code and tests, and from the status reviews in `docs/research/07a`, `07b` and `07c`. Where my grade is lower than those reviews, the Notes say so and why.
- The GTO Wizard column is one short neutral phrase from public sources, summarised in `docs/research/02-gtowizard-inventory.md` §3. It is not a claim about how their product works inside.

## Legend

| Grade | Meaning |
|---|---|
| WORKING | Works end to end in the code, with tests, and no core part is missing or heuristic. |
| PARTIAL | Works for a subset of cases, or a core part is missing. The Notes say which part. |
| APPROXIMATE | The feature exists, but the main numbers the user sees are heuristic, hand-made or not solver-grade. Examples are the hand-written preflop charts and the betting-rule fallbacks. |
| NOT IMPLEMENTED | Absent. For Lizard this includes features that are only a link to the classic app. |

When I was unsure, I chose the lower grade. Rows marked **(unsure)** in Notes are listed again at the end.

## Summary counts

| Category | Rows | Engine / classic: W / P / A / N | Lizard UI: W / P / A / N |
|---|---|---|---|
| Study | 11 | 4 / 6 / 1 / 0 | 2 / 6 / 1 / 2 |
| Practice | 10 | 2 / 7 / 1 / 0 | 0 / 0 / 0 / 10 |
| Analysis | 7 | 3 / 4 / 0 / 0 | 0 / 0 / 0 / 7 |
| Custom solving | 10 | 3 / 6 / 1 / 0 | 0 / 5 / 0 / 5 |
| Tournaments | 8 | 0 / 6 / 1 / 1 | 0 / 0 / 0 / 8 |
| Formats | 6 | 0 / 5 / 0 / 1 | 0 / 4 / 0 / 2 |
| Other | 8 | 0 / 5 / 0 / 3 | 0 / 2 / 0 / 6 |
| **Total** | **60** | **12 / 39 / 4 / 5** | **2 / 17 / 1 / 40** |

W = WORKING, P = PARTIAL, A = APPROXIMATE, N = NOT IMPLEMENTED.

In short, the engine covers most of the feature list, often in part. Lizard's React UI so far covers Study, a range editor, the library view, settings and engine diagnostics. Practice, Analyze, Solve, Reports and Tournaments are placeholder pages that link to the classic app (`web/src/app/App.tsx:31-35`, `web/src/features/classic/ClassicFeaturePage.tsx:7-53`).

## Facts that apply to many rows

- **Preflop numbers are mostly approximate.** The advice and Study use hand-written charts with no EV (`solver/gto/preflop.py:1-4`). A class-level preflop solver exists (`solver/gto/pf_study.py`, `pf_game.py`). It supports 2–6 players in the browser and 7 natively, equal stacks of 10–250bb, and no ICM. Its results are 2.4–3.0 points off published solves (`docs/research/03` §4). Classic Study can show it as a "Solver" source. Lizard cannot yet.
- **Postflop solves are real, but in an abstracted game.** Heads-up uses DCFR with an exact best-response exploitability (`solver/gto/solver.py:2170-2196`). That number is measured in the abstract game: flop solves bucket the later streets, and the bet menu is small. Three-way spots are solved, 4-way spots use a reduced game, and 5+ players on the flop or turn use betting rules (`docs/research/03` §5, §7).
- **The presolved library is small.** It has 18 heads-up 6-max 100bb lines (9 on the newer river-dealt tree with turn files, 9 on the older tree) and 4 three-way spots on 185 flops each. Lizard's merged library at `/lizard-library/` also has two heads-up 2-max spots, copied from offline builds that are still running: `srp_sb_bb_2max` (378 flops so far, planned 1,755) and `lp_sb_bb_2max` (168 so far, planned 552), as of library commit `7c6995b`. Heads-up flops not published yet are solved live. The classic `/gto-solver-library/` has no 2-max spots.
- **There are three grading scales in the classic app, and they disagree.**
  - Practice grades by frequency. Best, Good, Inaccuracy or Mistake; a frequency of 15% or more is fine (`solver/gto/static/practice.js:417-424`, `index.html:1543-1544`).
  - Drills grade by EV on five levels (`drills.js:154-169`).
  - The session analyzer uses mix thresholds of 0.15 and 0.03 (`session.js:528-532`).
- **Lizard sends only the basics.** Its Study request carries players, stack, board, the line and `study: true` (`web/src/features/study/studyState.ts:31-33`). It sends no rake, ranges, sizes, antes, payouts or preflop-solve flag, although the client types allow some of them (`web/src/solver/types.ts`).
- **Two Lizard over-claims were found by this review and fixed the same day (2026-11-03).** The Practice route summary said "scored by EV loss" (`web/src/app/routes.ts:18`), and the placeholder page listed "EV-loss grading" for Practice. Classic Practice verdicts are frequency-based; only Drills use EV. Both now say so.

## Study

| Feature | GTO Wizard (public) | Engine / classic | Lizard UI | Evidence | Notes |
|---|---|---|---|---|---|
| Solution browser | Presolved spots browsed node by node, many formats | PARTIAL | PARTIAL | `solver/gto/static/study.js:199-226`, `:1017`; `solver/gto/advisor.py:3320`; `web/src/features/study/StudyPage.tsx:36-41`; `docs/research/07a` S1 | Classic: any node solves live, but presolved coverage is the 22 spots above. Lizard has four presets (6-max, HU and 9-max at 100bb, and 6-max at 40bb). Other player counts and stacks work only by editing the URL (`studyState.ts:112-139`). There are no rake, ante or tournament inputs, and no Breakdown or Reports tabs. |
| Preflop | Preflop solutions per position and format, with EV | APPROXIMATE | APPROXIMATE | `solver/gto/preflop.py:1-4`; `pf_study.py:66-69`; `study.js:865`; `web/src/solver/provenance.ts:39`, `:89` | Classic: charts by default, plus the optional class-level Solver source. Lizard shows charts only, labelled "Preflop charts", with no EV and no Solver source. |
| Postflop | Postflop strategies for presolved and custom spots | WORKING | PARTIAL | `solver/gto/solver.py`; `multiway_solver.py`; `StudyPage.tsx:92`, `:182-186`; `web/src/features/library/LibraryPage.tsx:113` | Classic: HU, 3-way and 4-way, labelled by source. The exploitability is within the abstraction. Lizard: HU is complete. **(unsure)** 3-way answers return an `opponents` list instead of `opponent_grid`, so Lizard shows no opponent range there. The Library page also hides the Study link for 3-way spots. |
| Range matrices | 13x13 strategy grid | WORKING | WORKING | `study.js:304-325`; `web/src/components/RangeMatrix.tsx`; `RangeMatrix.test.tsx` | Both have 169 cells, with mix, weight, EV and equity views. Bar height is the class's range weight only. |
| Combo view | Per-combo strategy and metrics | WORKING | WORKING | `study.js:346-366`; `web/src/features/study/ComboPanel.tsx:52-79` | Lizard's combo table has reach, mix, EV and equity, sorted by EV. It has no per-combo EQR and no whole-range summary table. |
| Frequencies & EV | Action frequencies, with EV per hand and per action | WORKING | PARTIAL | `study.js:327-344`; `advisor.py:244`, `:8447-8452`; `StudyPage.tsx:291-309`; `web/src/state/settings.ts:13` | Classic has preflop EV only with the Solver source. Lizard shows frequency, combos and EV, with "≈" when the EV is rough, but it has no preflop EV. The "EV in bb / % of pot" setting is saved but never applied. |
| Equity & EQR | Equity and equity realization per hand and range | PARTIAL | PARTIAL | `solver/gto/breakdown.py:168-196`; `study.js:234`; `ComboPanel.tsx:6-9`; `StudyPage.tsx:52` | Postflop only. Flop equities are sampled. Classic has EQR shading and an equity curve. Lizard shows EQR per class in the combo panel only, with no EQR grid view and no curve. |
| Range comparison | Both players' ranges side by side | PARTIAL | PARTIAL | `study.js:294-295`; `solver/gto/static/breakdown.js:42-108`; `StudyPage.tsx:182-186` | Both show one grid at a time behind an actor/opponent toggle. Neither compares two nodes. Lizard has no breakdown or equity-curve panels, and no toggle in 3-way spots. |
| Filters | Hand-class, draw and equity-bucket filters | PARTIAL | NOT IMPLEMENTED | `study.js:367-419`; `breakdown.py:20-26`; `RangeMatrix.tsx:20-21` | Classic has 16 made-hand and 6 draw categories, one at a time. Lizard's matrix has a `hidden` prop for action filters, but nothing passes it. |
| Aggregate reports | Flop and turn reports across many boards | PARTIAL | NOT IMPLEMENTED | `solver/gto/static/reports.js:1-6`, `:37`; `runouts.js:1-5`; `advisor.py:3387-3417`; `web/src/app/App.tsx:34` | Classic flop reports cover library spots only, at three nodes, with no EQR column. Turn and river runout reports work (07a S10). Lizard's Reports page is a link to the classic app. |
| Node navigation | Spot selector, deep links, saved spots | PARTIAL | PARTIAL | `study.js:199-226`, `:1077-1110`, `:1288-1294`; `studyState.ts:112-139`; `web/src/data/db.ts:41` | Classic: step back, keys and `#h=` links, but no auto-fold selector. Lizard: each line has a URL, with back and reset. It has no auto-fold selector, no keyboard shortcuts and no saved spots; the `savedSpots` store exists but nothing uses it. |

## Practice

All Practice rows are NOT IMPLEMENTED in Lizard: the route renders a placeholder that links to `/gto-solver/practice/` (`web/src/app/App.tsx:31`, `ClassicFeaturePage.tsx:7-53`). The `sessions` store in `web/src/data/db.ts:45` is ready but unused.

| Feature | GTO Wizard (public) | Engine / classic | Lizard UI | Evidence | Notes |
|---|---|---|---|---|---|
| Preflop trainer | Preflop spots graded against the solution | APPROXIMATE | NOT IMPLEMENTED | `practice.js:171`, `:417-424`, `:623-627`; `index.html:1485`, `:1543-1544` | Preflop is played inside "Any hand" mode and graded by chart frequency, with no EV. The charts are hand-written. 07a grades this PARTIAL; I grade it APPROXIMATE because the reference itself is approximate. |
| Postflop trainer | Postflop spots with board and hand filters | PARTIAL | NOT IMPLEMENTED | `practice.js:169-196`; `multitable.js:37-40` | Four pot types, with the preflop auto-played. There are no board or texture filters and no street or spot modes. Practice solves at Quick, so turn grading is rough. **(unsure)** 07a grades this WORKING with few settings. |
| Full-hand play | Full hands against solver opponents | WORKING | NOT IMPLEMENTED | `practice.js:1-9`, `:74-131`, `:197-214`; `advisor.py:6461-6519` | Ring game for 2–9 players, with side pots and rake. Preflop opponents play the charts, and 5+ way flops and turns use betting rules. |
| Drills | Repeat one decision at a chosen node | PARTIAL | NOT IMPLEMENTED | `solver/gto/static/drills.js:1-11`, `:23-92`, `:154-169` | Graded by EV on five levels and decoded in JS without the solver. Flop library spots only, at three nodes. |
| Custom drills | Saved, named drill configurations | PARTIAL | NOT IMPLEMENTED | `session.js:451`, `:784`; `drills.js:213-233` | A leak in the analyzer becomes a drill set of up to 40 spots, kept in memory. There is no drill editor, no saved or named drills and no export. |
| Range-builder trainer | Paint a range and get a score | PARTIAL | NOT IMPLEMENTED | `study.js:420-511`; `web/src/features/ranges/RangesPage.tsx`; `rangeText.ts` | Classic paints and scores by hand class only, so suit-dependent strategies cannot be graded. There is no undo and no per-category result. 07a grades it WORKING at class level. Lizard has an editor (paint, brush weight, text in/out) without grading. |
| Multitabling | Up to four tables at once | WORKING | NOT IMPLEMENTED | `solver/gto/static/multitable.js:1-14`, `:25`; `practice.js:907-936` | 2–4 tables share one solver queue, so live solves run one at a time. |
| EV-loss scoring | EV lost per decision, in bb and % of pot | PARTIAL | NOT IMPLEMENTED | `index.html:1478`, `:1485-1540`; `practice.js:836-846`; `drills.js:158-169` | EV loss is computed, but Practice verdicts use frequency. Preflop has no EV, and there are three different scales. |
| Session stats | Per-session and lifetime trainer stats | PARTIAL | NOT IMPLEMENTED | `practice.js:18`, `:31`, `:836-850`; `drills.js:173-183` | One running total until "Start over", the last 60 decisions, and per-drill streaks. There are no dated sessions and no pot-type split. |
| Coaching / feedback | Per-decision feedback (plain-language output is on their public roadmap) | PARTIAL | NOT IMPLEMENTED | `practice.js:431-444`, `:485-496`, `:604-687`; `solver/cloudflare/explain-proxy/` | The rule-based text restates frequencies and EVs. AI explanations appear only on Practice and multitable verdicts, through the upstream proxy at a hard-coded URL. |

## Analysis

All Analysis rows are NOT IMPLEMENTED in Lizard: the Analyze route links to the classic session analyzer (`App.tsx:32`).

| Feature | GTO Wizard (public) | Engine / classic | Lizard UI | Evidence | Notes |
|---|---|---|---|---|---|
| Hand-history import | Import hands from major sites | WORKING | NOT IMPLEMENTED | `solver/gto/static/hh.js:23-24`, `:99-110`, `:118-119`, `:233` | Eight site families. Omaha hands are rejected. |
| Bulk upload | Many files at once | WORKING | NOT IMPLEMENTED | `session.js:862-899` | Files and folders. One session's decisions are kept (`session.js:21`). |
| Decision grading | Each decision graded against a solve | PARTIAL | NOT IMPLEMENTED | `session.js:258`, `:347-368`; `index.html:1485-1544` | Preflop is graded by frequency against the charts. Postflop decisions are graded by a live solve when one runs. The analyzer's scale is different from the trainer's. |
| Leak finding | Leaks found across many hands | PARTIAL | NOT IMPLEMENTED | `session.js:528-532` (`LEAK`) | Fixed thresholds. Preflop leaks are measured against hand-written charts. **(unsure)** It could be APPROXIMATE, because the preflop half rests on charts. |
| Frequency comparison vs GTO | Your frequencies against the solution's, by spot | PARTIAL | NOT IMPLEMENTED | `session.js:347-368` (`FREQS`, 13 rows) | A fixed table of 13 frequencies. There is no spot-level drill-down from a frequency row. |
| Reports | Summary reports over a database | PARTIAL | NOT IMPLEMENTED | `session.js:14`, `:20`, `:373`, `:479-483`, `:900-924` | One current session plus a history of up to 200 summaries. CSV and JSON export. |
| Saved hands | Save, tag and replay hands | WORKING | NOT IMPLEMENTED | `solver/gto/static/hands.js:1-7`, `:161`, `:309-321`; `store.js:292-305` | Tags, notes, search, export/import and backup. |

## Custom solving

| Feature | GTO Wizard (public) | Engine / classic | Lizard UI | Evidence | Notes |
|---|---|---|---|---|---|
| Preflop solves | Custom preflop trees and solves | APPROXIMATE | NOT IMPLEMENTED | `solver/gto/pf_study.py:66-69`, `:197-198`; `pf_game.py:1-24`; `docs/research/03` §4 | A class-level game with a realization model, not a full-tree solve. Equal stacks only, no ICM. **(unsure)** It is a real equilibrium of a simplified model, so PARTIAL could be argued. |
| Postflop solves | Custom postflop solves from any setup | WORKING | PARTIAL | `solver/gto/solver.py`; `advisor.py:3320`; `studyState.ts:31-33` | Classic: live solves in the abstracted game, set up by replaying a hand. Lizard solves any Study line at default sizes, but has no spot builder. |
| Heads-up | Heads-up custom solving | WORKING | PARTIAL | `solver.py:2170-2196`; `web/src/library/catalog.ts:102`; `scripts/library/assemble.py` | Lizard's heads-up library is partial: `srp_sb_bb_2max` 378 of 1,755 planned flops, `lp_sb_bb_2max` 168 of 552 (library `7c6995b`), with the builds still running. Other flops and lines are solved live, and there is no spot builder. |
| Multiway | Multiway custom solving | PARTIAL | PARTIAL | `solver/gto/multiway_solver.py`; `docs/research/03` §5 | 3-way solved, 4-way reduced, 5+ on betting rules. Lizard has the 3-way display gap noted under Study. |
| Custom ranges | Edit the ranges that enter a solve | PARTIAL | NOT IMPLEMENTED | `solver/gto/ranges.py`; `advisor.py:4701-4710`; `web/src/features/ranges/RangesPage.tsx` | Classic accepts ranges only entering the flop, with no export. Lizard's range editor is not connected to the solver. |
| Stacks & bet sizes | Per-player stacks and custom bet sizes | PARTIAL | PARTIAL | `advisor.py:298-318` (`MAX_SIZES` 3, study 5); `solver.py:82`; `studyState.ts:31-33` | Classic: per-seat stacks and up to 3 sizes (5 in Study), at most 2 raises per street. Lizard: one stack for all seats and no size input. |
| Node locking | Lock a node and re-solve | PARTIAL | NOT IMPLEMENTED | `solver/gto/exploit.py:400-652` | Classic locks are tendency locks with a best response, not an equilibrium re-solve with the lock held. **(unsure)** It could be APPROXIMATE. |
| Rake | Rake settings for cash solves | PARTIAL | NOT IMPLEMENTED | `solver/gto/solver.py:160-177` | Postflop rake is in the solve. Preflop rake is approximate, and a raked table reads the unraked library entry, labelled approximate. |
| Automatic sizing | Solver-chosen bet sizes | PARTIAL | NOT IMPLEMENTED | `advisor.py:7985-8021` (`_optimize_sizes`) | Picks from a wide menu after a first solve, for the hero's node only. |
| Convergence display | Solve accuracy shown | WORKING | PARTIAL | `index.html:1932-1937`; `web/src/solver/provenance.ts:96-105`; `web/src/components/ProvenanceBadge.tsx` | Classic shows converged, fair or rough bands with the target. Lizard shows "X% pot from equilibrium", iterations and "in progress", and names approximate reads (stored turn, answer at once with the Advisor's label), but no bands or target. Neither says the figure is measured within the abstraction. **(unsure)** |

## Tournaments

All Tournament rows are NOT IMPLEMENTED in Lizard: the route links to the classic app (`App.tsx:35`), and Study sends no payouts or bounties. Classic Study does accept them (`solver/README.md` Study section).

| Feature | GTO Wizard (public) | Engine / classic | Lizard UI | Evidence | Notes |
|---|---|---|---|---|---|
| chipEV | Presolved and custom chipEV tournament spots | PARTIAL | NOT IMPLEMENTED | `advisor.py:448-481`, `:3714`; `pf_formats.py:22-23` | Every solve is in chips unless payouts or bounties are set. Antes are applied as chart adjustments, so MTT-style preflop is approximate. 07c grades this WORKING; I grade it lower for the preflop part. |
| ICM | ICM solves, preflop and postflop | PARTIAL | NOT IMPLEMENTED | `solver/gto/icm.py:28`, `:434-485`, `:487-585`; `pf_classes.py:65-125`; `advisor.py:1762-1775` | Postflop prize-equity solves are real (HU, 3-way, 4-way). Preflop push/fold uses fictitious play in prize equity. Every other preflop spot is a chip chart plus a heuristic risk premium. The model is Malmuth-Harville, with at most 12 players plus stand-ins for the field. |
| MTT / final table | Final-table and stage presets | PARTIAL | NOT IMPLEMENTED | `index.html:714-720`, `:873-921`; `icm.py:166-195` | Payouts and field are typed by hand. There are no stage or final-table presets and no tournament library. |
| Satellites | Satellite payout handling | NOT IMPLEMENTED | NOT IMPLEMENTED | `icm.py:247-262`, `:587` | No "satellite" anywhere in `gto/`. Flat payouts can be typed, but they are untested, and a bubble factor can become infinite and is reported as null. |
| KO / PKO | Knockout and progressive bounty solves | PARTIAL | NOT IMPLEMENTED | `icm.py:197-230`, `:274-360`; `solver/tests/test_bounty.py` (13 tests) | Uses a proportional bounty model. It is solved for push/fold and postflop; other preflop spots get a discount on the risk premium. **(unsure)** 07c grades this WORKING for the solved parts. |
| Mystery bounty | Mystery bounty solving | APPROXIMATE | NOT IMPLEMENTED | `icm.py:201-230`; `index.html:733-735` | Each envelope is valued at the average envelope left. There is no distribution or variance. |
| Payout structures | Preset and imported payout structures | PARTIAL | NOT IMPLEMENTED | `index.html:875`; `icm.py:179-195`, `:587` | Any list can be typed, up to 200 places, compressed onto the 12-player model. There are no presets and no import. |
| Bubble factors | Not found in public sources | PARTIAL | NOT IMPLEMENTED | `icm.py:378-431`; `advisor.py:484-510`, `:4650-4653`; `solver/tests/test_icm.py:57`; `index.html:2019` | The engine computes and tests them. The classic UI shows them only as one note line. |

## Formats

| Feature | GTO Wizard (public) | Engine / classic | Lizard UI | Evidence | Notes |
|---|---|---|---|---|---|
| 2–9 handed NLHE | Heads-up to 9-max | PARTIAL | PARTIAL | `advisor.py:3705`; `preflop.py:25`; `pf_formats.py:24-25`; `web/src/engine/registry.ts:21`; `studyState.ts:127` | Preflop is charts; 7–9 handed come from adjustment tables, and 9-handed reuses 8-handed. Postflop is solved up to 4-way. Lizard offers 2, 6 and 9 players from presets; others work only through the URL. |
| Cash | Cash games with rake variants | PARTIAL | PARTIAL | `solver.py:160-177`; `solver/README.md:57-68`, `:1107-1128` | Classic has rake, stakes and the library, with hand-tuned preflop charts. 07c grades it WORKING; I grade it PARTIAL because of the charts. Lizard has no rake or stakes input. |
| MTT | Tournament formats | PARTIAL | NOT IMPLEMENTED | See Tournaments | No Spin or SnG presets. Every flop is solved live. |
| Short stack | Short-stack formats | PARTIAL | PARTIAL | `pf_formats.py:43-47`; `advisor.py:221-231`; `StudyPage.tsx:40` | Push/fold is solved at 12bb and below. Charts are adjusted from solves at 20, 40 and 60bb. Postflop is solved live. Lizard has a 6-max 40bb preset. |
| Deep stack | Deep-stack formats | PARTIAL | PARTIAL | `pf_formats.py:16-21`; `solver.py:82`; `studyState.ts:126` | Preflop deeper than 100bb is 100bb's charts re-priced by rules (approximate). Postflop is a live solve with at most 2 raises per street. 07c grades this APPROXIMATE preflop. Lizard reaches deep stacks only through the URL. |
| PLO4 | Pot-limit Omaha, a separate plan | NOT IMPLEMENTED | NOT IMPLEMENTED | `solver/gto/cards.py:45`; `evaluator.py:1-8`; `hh.js:118-119`; `web/src/engine/registry.ts:35-42` | Two-card hands everywhere. Lizard has a placeholder registry entry marked not solvable. |

## Other

| Feature | GTO Wizard (public) | Engine / classic | Lizard UI | Evidence | Notes |
|---|---|---|---|---|---|
| Saved solutions | Saved spots, solves, drills and reports | PARTIAL | NOT IMPLEMENTED | `study.js:246-270`; `hands.js`; `index.html:1307`; `web/src/data/db.ts:41-45` | Classic keeps the 6 latest preflop solves, saved hands and `#h=` links, but has no named saved solves. Lizard's `savedSpots` store has no UI. |
| Study plans | Structured lessons with drills | NOT IMPLEMENTED | NOT IMPLEMENTED | grep finds no plan or lesson code in `gto/static` | The nearest thing is the analyzer's "Drill this leak". |
| Preferences / progress | Saved settings and trainer stats | PARTIAL | PARTIAL | `store.js:26-30`; `drills.js:170-178`; `web/src/state/settings.ts:13-38`; `SettingsPage.tsx:72` | Classic keeps preferences, plus per-mode scores and analyzer history, in the browser. 07c grades it WORKING; I grade it PARTIAL because there are no lifetime stats across modes. Lizard saves mode, backend and library source; `evUnit` and `colorByAction` are saved but not applied, and there is no progress tracking. |
| Multiplayer / HU arena | Human-vs-human play and ranked heads-up | NOT IMPLEMENTED | NOT IMPLEMENTED | `solver/gto/server.py:1-12` | Bots only. Human play would need a server. |
| Mobile | Installable web app; one native app for ranked play | PARTIAL | PARTIAL | `index.html:5`, `:233-625`; `sw.js:1-6`; `web/src/main.tsx`; `web/index.html` | Both are responsive. Neither has a web app manifest or offline caching; the service worker only adds isolation headers. **(unsure)** Lizard was not checked at phone width in this pass. |
| AI explanations | Not offered (plain-language output is on their roadmap) | PARTIAL | NOT IMPLEMENTED | `practice.js:478-496`; `solver/cloudflare/explain-proxy/src/proxy.js:1-14`; `docs/research/06` §0 | Practice verdicts only. The proxy is shared, and its Origin check can be forged. Lizard must not reuse it as is. |
| Solution comparisons | Compare actions, nodes, depths, rake, ICM vs chipEV | PARTIAL | NOT IMPLEMENTED | `solver/gto/static/simple.js:1-11`; `advisor.py:4008-4009`, `:4650-4653`; `study.js:500` | Classic has the one-size view (each size's EV lost against the full menu), GTO % beside locked answers, and chart vs solver preflop. There is no two-solution diff. **(unsure)** NOT IMPLEMENTED could be argued. |
| Account sync | Account login with server-side sync | NOT IMPLEMENTED | NOT IMPLEMENTED | `store.js:1-21`, `:292`, `:305` | Classic has manual backup and restore with merge, on a record schema built for later sync. Lizard has neither. |

## Grades I was unsure of

- **Leak finding (classic, PARTIAL).** It could be APPROXIMATE, because preflop leaks are measured against hand-written charts.
- **Postflop trainer (classic, PARTIAL).** 07a says WORKING with few settings. I graded it lower for the missing filters and modes, and for the rough turn grading at Quick.
- **Preflop solves (classic, APPROXIMATE).** It is a real equilibrium of a simplified class-level model, so PARTIAL could be argued.
- **Node locking (classic, PARTIAL).** It is a tendency lock plus a best response, not a re-solve, so APPROXIMATE could be argued.
- **KO / PKO (classic, PARTIAL).** 07c says WORKING for the solved parts. The non-push/fold preflop part is heuristic.
- **Solution comparisons (classic, PARTIAL).** It is only the one-size view plus GTO % beside exploit answers, so NOT IMPLEMENTED could be argued.
- **Postflop in Lizard (PARTIAL).** The missing 3-way opponent range is inferred from the response shape, not seen in a browser.
- **Convergence display in Lizard (PARTIAL).** The number is shown, but without bands, a target or the abstraction caveat.
- **Mobile (both, PARTIAL).** Not checked at phone width in this pass.
- **Lower than the research reviews.** Five more rows are graded below 07a or 07c by a stricter rule: classic chipEV, cash, preferences/progress, range-builder trainer, and preflop trainer.
- **All Lizard grades.** They come from code reading and unit tests only. No build or browser run was done.
