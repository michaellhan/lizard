# LIZARD roadmap

Status as of 2026-11-03. This plans the path from today's state to broad parity with the public feature set of GTO Wizard. Today's state, row by row, is in `docs/FEATURE_MATRIX.md`. The working rules (provenance labels, storage, no accounts, resource safety) are in `IMPLEMENTATION_PLAN.md` and are not repeated here.

## Where we start

- **The engine covers most features, often in part.** The bundled solver and its classic app (`solver/`, served at `/gto-solver/`) handle Study, Practice, drills, multitabling, hand-history analysis, reports, custom setups, ICM and bounties. Of 60 matrix rows, the engine is WORKING on 12, PARTIAL on 39 and APPROXIMATE on 4.
- **Lizard's own interface covers Study, a range editor, the library view, settings and engine diagnostics.** Practice, Analyze, Solve, Reports and Tournaments are placeholder pages that link to the classic app (`web/src/app/App.tsx:31-35`). Lizard was WORKING on 2 rows and PARTIAL on 17 when this was written; `FEATURE_MATRIX.md` has the current counts.
- **Much of the plumbing is ready but unused.** That includes:
  - the `SolverClient` queue with worker and HTTP backends;
  - provenance on every answer;
  - the `savedSpots` and `sessions` IndexedDB stores (`web/src/data/db.ts:41-45`);
  - a game-engine registry with a PLO4 placeholder.

## How phases are ordered

1. **Port before inventing.** Porting a classic feature into React reuses tested engine code and tested pure JS logic. The cost is UI work plus golden tests. These phases come first.
2. **Value to a studying player.** Practice, then hand review, then reports and range drills. These are the loops that bring people back.
3. **New numerics last.** New solver math (true node-lock re-solves, ICM preflop solves, PLO4) is slow to build and slow to validate. It also competes for the CPU that library builds need. It goes in the long-term phases, and only with a stated accuracy check.
4. **Label every number.** No phase may show a heuristic number without its provenance label. Where a feature's numbers are approximate, the UI says so in words, not just with an icon.

Effort sizes are rough: **S** is a few days, **M** is one to three weeks, **L** is more.

## Constraints that apply to every phase

- **Heads-up libraries are still being built.** The 2-max libraries (`srp_sb_bb_2max`, `lp_sb_bb_2max`) are built offline and published as they grow with `scripts/library/publish.sh`. New flops appear without a code change: `web/src/library/catalog.ts` reads `index.json`, `mw_index.json` and `lizard-library.json` with `cache: "no-cache"` (`:102`). `resolveLibrarySource` (`:124`) picks the Lizard library, which is published. Features must not assume a spot is present. They read coverage at run time and fall back to a live solve, labelled as such.
- **Static hosting only.** The site is GitHub Pages at `https://www.michael-han.com/lizard/`, using `BrowserRouter` with a basename. `scripts/postbuild.mjs` writes per-route `index.html` files and `404.html`. Several limits follow:
  - Nothing may need a server of ours at run time. Any server-side piece (the AI proxy, optional sync) is a separate service, and the app must work without it.
  - Every new route must be added to `web/src/app/routes.ts` so the postbuild writes its page.
  - Cross-origin isolation comes from the service worker (`web/src/main.tsx`), which is fragile on first load. Features must still work, more slowly, without threads.
  - Deployment notes in `docs/research/05` §0 record an expired Pages certificate (2026-11-02) and no http-to-https redirect. Fix both before a public launch.
- **No forced accounts.** Every feature works signed out, with data kept in the browser's IndexedDB. Sync, if built, is opt-in (Phase 11).
- **The origin is shared with the classic app.** `/lizard/` and `/gto-solver/` are one origin, so they share storage. Lizard keeps its own database name (`lizard`) and key prefixes. It never writes the classic databases (`gto-store`, `gto-session`, `gto-pf`), and reads them only on an explicit "import from the classic app" action. A script injection bug in either app exposes both, so the CSP and sanitizing work in `docs/research/06` §0 applies to every phase.
- **Resource safety.** While library builds run, development must not start solver test suites, full builds or solves on the same machine. Each phase's acceptance tests are split in two:
  - Fast unit and component tests (Vitest, stubbed solver), which run anywhere.
  - A small opt-in engine check against the real solver, run only when the machine is free.
- **Upstream churn.** The solver is a snapshot (`solver/`, upstream 9b907bd6), and upstream moves fast. Lizard changes to solver code are kept as small, declared patches, each listed with its reason, so a later snapshot can be taken.
- **Phones.** Every new page is checked at 375px width with no horizontal page scroll.
- **Bundle size.** First load is about 25 MB of solver assets. New features must not add to the critical path; port JS logic as lazy-loaded route chunks.

## Phase overview

| Phase | Title | Term | Main reuse | Effort |
|---|---|---|---|---|
| 0 | Study completion and honesty fixes | Near | Existing Study answer fields; `drills.js` grading | S–M |
| 1 | Practice and trainer with EV-loss scoring | Near | `practice.js`, `drills.js`, `multitable.js`, `Advisor.play` | L |
| 2 | Analyze: hand-history import and grading | Near | `hh.js`, `session.js` | L |
| 3 | Reports | Near | `reports.js`, `runouts.js`, `breakdown.js`, library `report.json` | M |
| 4 | Range-builder grading | Near | `study.js:420-511` scoring | S–M |
| 5 | Saved spots, drills, hands and ranges | Near | `savedSpots` store, `hands.js`, `store.js` backup format | M |
| 6 | Custom solve setup: ranges, stacks, sizes, rake, node locks | Mid | Advisor keys `ranges`, `sizes`, `rake`, `locks`, `optimize_sizes` | L |
| 7 | Tournaments | Mid | `icm.py`, bounties, `tournament` answer field | M–L |
| 8 | Comparisons | Mid | Two solver calls diffed in the client; `simple.js` | M |
| 9 | Solver depth for NLHE | Long | New numerics | L |
| 10 | PLO4 engine | Long | `GameEngine` interface only | L |
| 11 | Optional account sync | Long | `store.js` record schema | L |
| 12 | AI explanations through a server-side proxy | Long | Prompt builder in `practice.js` | M |

---

## Near term: port the classic features

### Phase 0: Study completion and honesty fixes

**Goal.** Make what Lizard already shows accurate and complete enough to build on. Also add the shared pieces (one grading scale, client-side filters) that later phases need.

**Deliverables.**
- **Done on 2026-11-03, after this roadmap was written:**
  - the wording fixes: the Practice summary and placeholder no longer claim EV-loss scoring, and the
    `RangesPage.tsx` comment no longer names a competitor's feature;
  - per-mode time budgets are sent (`applyMode`, `MODE_BUDGETS`);
  - provenance for stored turns, answers at once and 5+-way heuristics (`docs/ACCURACY.md` §11).
- **Done on 2026-11-03 (second session; `docs/PROGRESS.md`):** the convergence bands, the EV unit (and `colorByAction`
  removed), the 3-way display and Library links, the action filter, the hand-class and draw filters, the EQR grid
  view, the player and stack inputs, and the grading module (`web/src/grading/grade.ts`, with the thresholds below and
  `GRADE_RULES` in words). The preflop Solver source is done too (third session, 2026-11-03): a Charts | Solver toggle
  in Study (`pf=solver` in the link) that asks `preflop_solve`, offers to solve a game the engine doesn't hold and runs
  it only on Solve, in 4 s chunks with progress and Stop, and keeps finished solves in IndexedDB (`lizard-pf`, a cache
  apart from the app's database, so no migration; `web/src/features/study/pfSolve.ts`, `PreflopSolve.tsx`), labelled
  "Preflop solve (class-level model)", with the classic's custom raise sizes (`pfSizes.ts`, Study's "Sizes" form, `pfs=`
  in the link, sent as `pf_sizes`). Phase 0 has nothing open.
- **Convergence label.** The abstraction wording is done: `describe` (`web/src/solver/provenance.ts:113-127`) says "in the solved game", and "mean best-response gain" for 3- and 4-way answers. Still to do: add the classic bands (converged under 3% of the pot, fair under 10%, rough otherwise, approximate when flagged; `solver/gto/static/index.html:1932-1937`) and the target when present. Update `web/src/components/ProvenanceBadge.tsx`.
- **Settings that do nothing.** Apply `evUnit` (bb or % of pot) in `StudyPage.tsx` action buttons and `ComboPanel.tsx`, or remove the setting. Do the same for `colorByAction` (`web/src/state/settings.ts:13-15`).
- **3-way display.**
  - Render the `opponents` list of 3-way answers in `StudyPage.tsx`, with one toggle per opponent; today only `opponent_grid` is read (`:94`, `:184-188`).
  - Show the Study link for 3-way spots in `web/src/features/library/LibraryPage.tsx:113`.
- **Action filters.** Clicking an action hides the others in the grid, through the existing `hidden` prop of `web/src/components/RangeMatrix.tsx:20-21`.
- **Hand-class and draw filters.** Port `catsOf`, `filterRes` and `filterHtml` from `solver/gto/static/study.js:367-419`. The categories come from the answer (`breakdown.py:20-26`).
- **EQR grid view.** Add an `eqr` view to `RangeMatrix.tsx` and to `StudyPage.tsx`'s view state (`:54`). It uses the fields `ComboPanel.tsx:6-9` already uses.
- **Preflop Solver source.** Add a Charts | Solver toggle that sends `preflop_solve` (as `study.js:45-49` does). It shows progress for `pf_progress` answers, and keeps exported solves in IndexedDB in place of classic's `gto-pf` cache.
  - Lizard-side changes: a new store or use of `kv`, through a new migration in `web/src/data/db.ts`.
  - Label it "Preflop solve (class-level model)". It covers 2–6 players, equal stacks of 10–250bb and no ICM.
- **Player and stack inputs.** Players 2–9 and stack 10–250bb in the Study header, instead of four presets (`StudyPage.tsx:36-41`). The URL already accepts them (`studyState.ts:112-139`).
- **One grading module, `web/src/grading/`.**
  - Port `grade()` from `solver/gto/static/drills.js:154-169` (`MIX` 0.1, `TOL` 0.011, `RARE` 0.03) and the EV-loss computation of `gradeWith` (`index.html:1485-1540`).
  - Expose the five grades named in `IMPLEMENTATION_PLAN.md` §8: Best, Correct, Inaccuracy, Mistake, Blunder. The plan names them but sets no numbers, so take the thresholds from `drills.js`:
    - Best is within 0.011bb of the best EV.
    - Correct is an action the hand plays 10% of the time or more.
    - Otherwise, an EV loss below 2% of the pot is an Inaccuracy, below 8% a Mistake, and anything larger a Blunder.
  - Where no EV exists (chart preflop), grade by frequency as `drills.js` does. Label the grade "frequency only, no EV".
  - Do not copy the upstream comment wording that names a competitor's trainer.
  - Publish the thresholds on the page that shows grades.

Moves matrix rows: Filters, Equity & EQR, Range comparison, Postflop (3-way), Convergence display, Preflop, Frequencies & EV, Preferences.

**Dependencies.** None. This phase is first because Phases 1, 2 and 4 import the grading module.

**Acceptance tests.**
- `provenance.test.ts`: every label containing an exploitability figure includes the abstraction wording. Bands match the classic thresholds at 2.99, 3.0, 9.99 and 10.0.
- `grading/*.test.ts`: port the cases from `solver/tests/js/drills.test.js:147`, `:165` and check the same verdicts. A chart-only spot never yields an EV-based grade.
- `RangeMatrix.test.tsx`: with `hidden` set, the hidden actions' share is drawn empty. The `eqr` view shades by `evm/(eq*pot)`.
- `StudyPage` component test with a stubbed 3-way answer: one toggle per opponent, and each grid renders.
- Filter tests on a fixture answer: the counts per category match the classic `study.test.js:311` fixture.
- `evUnit = "pot"` changes every EV shown in Study.
- Engine check (opt-in): a 6-max BTN vs BB flop from the library shows the "Precomputed solution" label with its stored exploitability and the abstraction caveat. A stored turn shows "Stored turn from the flop library" with no exploitability figure. A live turn shows a band.

**Risks.**
- Label wording can drift from the engine's meaning; keep the wording in one place (`provenance.ts`).
- The preflop solve is CPU-heavy in the browser. Run it only on request, with a Stop button, never automatically.

### Phase 1: Practice and trainer with EV-loss scoring

**Goal.** Give users the main training loop in Lizard. Play hands and repeat drills against solver opponents, with each decision graded by EV lost where an EV exists.

**Deliverables.**
- **Done on 2026-11-03 (second session; `docs/PROGRESS.md`):**
  - the table engine (`web/src/poker/`: seats, hand evaluation, betting rounds, side pots, settlement to the cent with
    rake; the classic cases ported and a 10,000-hand conservation fuzz);
  - a typed `play()` on the solver client, mapped to the worker's `play` field and the server's `/play`;
  - the Practice page's full-hand mode for 2–9 players, with your seat moving each hand, opponents moved by
    `Advisor.play`, and a verdict per decision from `grade.ts` (EV lost where every action has an EV, otherwise by
    frequency and said so), the hand's mix and the provenance label;
  - sessions saved to the `sessions` store, with the last six listed on the page;
  - single-decision drills, in Practice's Drills tab: entries decoded in the page (`web/src/library/entry.ts`), the
    three nodes and the texture filter, the spot's coverage, EV grading with the stored solve's provenance, "Open in
    Study", and drill sessions saved.
  - Since then: "Open this spot in Study" from a full-hand decision (`practice.ts` `studyOf`), the rule-based
    "why" text in Practice and Drills (`grade.ts` `whyText`), and the History page (`web/src/features/history/`):
    every kept session by day, lifetime totals by kind, and Practice's finished hands by pot type (2026-11-03).
  - **Still open in Phase 1:** the drill modes (pot types in full hands), multitabling, chips carried from hand to
    hand, sizes of your own, antes and straddles, and the 20-hand engine check.
- **Table engine, `web/src/poker/`.** Pure TypeScript:
  - dealing, blinds and antes, betting rounds, side pots and rake settlement, and the ring game with a moving button;
  - ported from `practice.js:74-131`, `:149-214` and `:326`, and the table logic in `index.html`;
  - no React in this module, so Phase 2 can reuse it for replays.
- **Opponent moves.** Use `Advisor.play`, through the worker message's `play` field (`web/src/solver/protocol.ts:46-47`). Add a typed `play()` to `web/src/solver/client.ts`, and make sure `http-transport.ts` maps it to the server's `/play`.
- **Practice page, `web/src/features/practice/`.**
  - Full-hand mode for 2–9 players.
  - The drill modes: single-raised, 3-bet and blind-vs-blind pots (`practice.js:169-196`).
  - A verdict card per decision, with the grade, EV lost in bb and % of pot, the solver's mix for the hand, and the provenance label.
  - "Open in Study" for the decision's node.
- **Drills.** Single-decision drills on library flops, decoded in the client with no solver (`drills.js:23-92`, `:98-169`). They use the texture filters, show the spot's coverage from the catalog, and say when a spot has no stored nodes.
- **Multitabling.** 2–4 tables, ported from `multitable.js:1-40` with the same queue priority (instant answers first, a long solve gives way). Phones get one table plus tabs.
- **Session records.** Each practice session is saved to the existing `sessions` store (`web/src/data/db.ts:45`, `SessionRecord`): hands, decisions, grades and EV lost, with start and end time. The history page lists sessions by date with totals by pot type.
- **Grading.** Uses the Phase 0 module only. Preflop decisions say "graded against charts by frequency; no EV" until Phase 9.
- **Rule-based "why" text.** Ported from `practice.js:431-444` and `:529`. There is no AI call in this phase.

Moves matrix rows: every Practice row except Range-builder trainer and Custom drills, and Session stats.

**Dependencies.** Phase 0's grading module and provenance wording.

**Acceptance tests.**
- `poker/*.test.ts`: port the side-pot, rake and showdown cases from `solver/tests/js/practice.test.js` (28 tests; `:55`, `:72`, `:311`) and `table.test.js`. Chips are conserved in every random hand of a seeded fuzz of 10,000 hands.
- Drill decode: decoding the fixture entries gives the same strategies as `drills.test.js:104`.
- Multitable scheduler: port `multitable.test.js:170` (instant first, long solves yield).
- Session persistence: a stubbed session is written to `sessions` and read back after a reload (fake-indexeddb). It survives a database migration.
- Grades: on a stubbed answer, an action the hand plays under 10% of the time that loses 0.5% of the pot is an Inaccuracy, not a Mistake. The same loss on an action played 10% or more is Correct. A chart preflop decision is graded by frequency and marked so.
- Engine check (opt-in): play 20 seeded hands at Quick through the worker. No request errors, and every verdict has a provenance label.

**Risks.**
- **Scope.** The classic table logic is spread through `index.html`. Extract it carefully and test it before building UI.
- **Speed.** Live turn and river grading at Quick is rough (`practice.test.js:749`). Label such grades "rough (quick solve)" and let users regrade at Fast.
- **Preflop opponents play hand-written charts.** Say so in the table header.
- **Expectations.** A frequency-only preflop grade will look stricter or looser than EV-based ones. Keep the two visibly separate.

### Phase 2: Analyze: hand-history import and grading

> **Status, 2026-11-03.** Done: the parsers (`web/src/hh/`, golden files from the classic parser), the replay on the
> table engine (the straddle added to it), the import (paste, files, a folder; `features/analyze/analyze.ts`, the
> classic `prepare`), the v4 `hands` and `decisions` stores with duplicates kept once and an import deleted with its
> decisions, the hands table with filters, and each hand replayed with Study links. Grading at the two scopes that
> solve nothing (preflop against the charts by frequency, flops from the library by EV; `features/analyze/grading.ts`)
> in a queue that stops and resumes, each grade on its move with its provenance, and the report (`report.ts`: by
> street, situation and spot, the classic leaks and frequency table, the most EV lost, off the chart, CSV and JSON).
> "Drill this leak" (`leakDrill.ts`, `LeakDrillPanel.tsx`): a leak's decisions dealt again, misses first, graded
> against the mix kept with each grade (nothing solved), the progress kept as an `analysis` session that resumes.
> Your stats as played (`stats.ts`, `StatsPanel.tsx`): VPIP, PFR, RFI by seat, 3-bet, squeeze, fold to 3-bet, 4-bet,
> c-bet, fold to c-bet, check-raise, barrels, went to showdown, each over its own chances with a 95% interval and its
> hands, and bet sizes. The hands table's filters (seat, pot type, site, stakes, days) apply to the report, the drill
> and the stats. Each hand takes your tags and a note, the table filters by tag and searches every word, and hands
> and grades are in the backup. Still open: turns and rivers (live solves, or the classic's Quick triage, through
> the same queue), an EV-lost filter, a history across sessions, realized results (the parser doesn't read winnings
> yet), a dropped folder.

**Goal.** Let users import their own hand histories, see each decision graded, and find leaks. Everything stays in the browser.

**Deliverables.**
- **Parsers, `web/src/hh/`.** A TypeScript port of `solver/gto/static/hh.js`:
  - eight site families (`:23-24`), tournament metadata (`:99-110`) and big-blind antes (`:233`);
  - rejects Omaha with a clear message (`:118-119`).
- **Analyzer core, `web/src/features/analyze/`.**
  - Port the pure parts of `session.js`: the runner (`:258`), the frequency table (`FREQS`, `:347-368`), the leak rules (`LEAK`, `:528-532`), the report (`:373`), and CSV and JSON export (`:479-483`, `:900-924`).
  - Run solves through a worker queue that can be paused and resumed.
- **Bulk upload.** Files and folders by drag and drop (`session.js:862-899`). Show progress per file, and say what was skipped and why.
- **Storage.** A new IndexedDB migration in `web/src/data/db.ts` (the next free version) adds `hands` and `decisions` stores. Indexes cover date, site, stakes, position and grade.
  - Unlike classic, which keeps one session's decisions (`session.js:21`), every graded decision is kept.
  - A size meter and a "delete this import" action keep storage under control.
- **Hands table.** Filter by date, position, pot type and grade. Each row has a replay (Phase 1 table engine), "Open in Study" and "Drill this leak".
- **Leaks view.** Your frequencies against the reference, with the reference's source shown per row (charts, preflop solve or live solve). Use the Phase 0 grading scale, and retire the analyzer's separate 0.15 and 0.03 thresholds, documenting the change.

Moves matrix rows: all Analysis rows.

**Dependencies.**
- Phase 0 grading.
- Phase 1 table engine (replay).
- Phase 5 is not required: "Drill this leak" can start as an in-memory set and become saved in Phase 5.

**Acceptance tests.**
- `hh/*.test.ts`: every fixture in `solver/tests/js/hh.test.js` and `hh_synth.js` parses to the same structure as the classic parser (golden JSON produced once from the classic code and checked in).
- Analyzer: the leak list and the 13-row frequency table for the `session.test.js` fixture match the classic output, except for the documented threshold change.
- Storage: importing the same file twice does not duplicate hands (hand id key). Deleting an import removes its hands and decisions.
- Bulk import of 5,000 synthetic hands stays responsive, with parsing off the main thread. Measure on a free machine.
- No upload: a network check in the test (stubbed `fetch`) shows no request carries hand data.

**Risks.**
- **Parser drift.** Site formats change, and the classic parser is the only reference. Keep golden fixtures and add new ones from user bug reports, with personal data removed.
- **Long jobs.** Postflop grading by live solve is slow for big imports. Grade preflop first, then postflop in the background, and show partial results.
- **Storage limits.** Mobile Safari evicts storage. Ask for persistent storage (`navigator.storage.persist`) and offer export.
- **Privacy.** Hand histories contain other players' screen names. Keep them local, and offer "hide names" in exports.

### Phase 3: Reports

**Goal.** Show strategy across many flops for a spot: how often each action happens on which kinds of boards. Then drill into turn and river runouts.

**Deliverables.**
- **Done on 2026-11-03 (second session; `docs/PROGRESS.md`):** the flop report (`web/src/features/reports/`): the
  classic three decisions, texture filters and groups, weighted averages and sorting, ported with the
  `reports.test.js` cases; read from each library spot's `report.json` through `web/src/library/files.ts` with no
  solve; each player's EQR, sorting on every column, a CSV of the rows shown with its source, a Study link per flop,
  and the coverage (stored flops and their share of all 22,100) with a list of which spots have reports. Long reports
  list 300 flops until asked for all (averages, groups and the CSV take every flop). **Still open in Phase 3:** turn
  and river runout reports (live solves, opt-in), a chart view, in position facing a lead, and 3-way spots.
- **Reports page, `web/src/features/reports/`.**
  - Port `solver/gto/static/reports.js` (texture classes `:18`, views `:37`, rows `:62`, weighted averages `:86`).
  - It reads `<spot>/report.json` from the library source chosen by `web/src/library/catalog.ts`.
  - Chart and table views. Group by texture, high card, pairing and suits. Highlight a row to open it in Study.
- **Add what classic lacks.** An EQR column (EV over equity times pot), sorting on every column, and CSV export.
- **Runout reports.** Turn and river runouts for a node, porting `runouts.js` and calling `Advisor._runouts` (`advisor.py:3387-3417`) through the study request. Show the measured run time before starting (Fast about 2–3 s, Accurate up to about 31 s without threads; `solver/README.md`).
- **Coverage notice.** Reports exist only for library spots. The page lists which spots have reports and updates as new library builds publish.

Moves matrix rows: Aggregate reports, and part of Equity & EQR.

**Dependencies.**
- Phase 0's EQR view and filters, for consistent definitions.
- The library publishing `report.json` for its spots. Check which published spots include it.

**Acceptance tests.**
- Port `solver/tests/js/reports.test.js` and `runouts.test.js` cases. The weighted averages for the fixture report equal the classic numbers to 4 decimals.
- A spot without `report.json` shows the coverage notice, not an error.
- The EQR column equals `ev / (eq * pot)` on fixture rows, and is blank where equity is zero.
- Engine check (opt-in): one Fast turn runout report on a library flop completes and is labelled "Live solve" with a band.

**Risks.**
- **Thin coverage.** Reports exist only for the 6-max 100bb heads-up lines and later the 2-max builds. The UI must not imply any spot can be reported.
- **Flop sampling.** The classic report reads stored flops, not all 1,755 flop classes. Say how many flops each report covers.

### Phase 4: Range-builder grading

**Goal.** Turn the existing range editor into a trainer. The user paints a strategy for a node and gets a score against the solver's strategy.

**Deliverables.**
- **Done on 2026-11-03 (second session; `docs/PROGRESS.md`):** the scoring port (`web/src/features/ranges/build.ts`,
  with `study.test.js:244` ported, plus 100% for the solver's own mix and 0% for an action it never takes); "✎ Build" in
  Study at any node, library and preflop chart answers included (`web/src/features/study/BuildMode.tsx`): brushes and
  amounts, drag painting, Fill all, Reset, undo and redo per stroke, a lock per class, the score with the answer's
  provenance, the difference grid, the biggest differences, each hand compared, and "Graded against the preflop
  charts" on chart answers; a combo-by-combo score next to the class mixes' own (the class-level shortfall named in
  Risks); each score kept in IndexedDB (sessions, kind "build") and listed at its node. **Still open in Phase 4:**
  painting by hand category, single-combo syntax, and text import into the builder (the Ranges page keeps its editor).
- **Scoring, `web/src/features/ranges/`.** Port `blankPaint`, `brush` and `scoreBuild` from `solver/gto/static/study.js:420-458`, with the grade labels at 90, 80 and 65% (`:458`). Painting stays at hand-class level.
- **Pick a node.** Choose any Study node (via the Study URL) or a library spot. The target strategy comes from the same `study` answer.
- **Results.**
  - Overall score, a per-class difference grid, the classes that cost the most, and EV lost where EVs exist.
  - Preflop with the chart source says "graded against charts".
- **Editing aids.** Undo and redo, a "lock" per class, and painting by category using the Phase 0 filters. These are new in Lizard; classic has none.
- **Text ranges.** Keep `rangeText.ts` import and export, and add single-combo syntax as a stated limitation or a follow-up.
- **Score history** in `kv`, or in the Phase 5 store once it exists.

Moves matrix rows: Range-builder trainer.

**Dependencies.** Phase 0 (filters, grading wording).

**Acceptance tests.**
- Port `solver/tests/js/study.test.js:244`. Scoring the fixture paint gives the classic score exactly.
- Painting the solver's own mix scores 100%. Painting all-fold on a node with no folds scores 0%.
- Undo and redo restore exact weights.

**Risks.**
- **Class-level painting.** It cannot express suit-dependent strategies such as flush draws, so scores on flops are capped by that. Show the best score possible at class level next to the user's score.

### Phase 5: Saved spots, drills, hands and ranges

**Goal.** Let users keep and return to their work: spots, drill sets, ranges and hands, all stored locally, with backup and restore.

**Deliverables.**
- **Done on 2026-11-03 (second session; `docs/PROGRESS.md`):** saved spots ("☆ Save spot" in Study,
  `web/src/features/study/SaveSpot.tsx`; one spot per line, saving again updates it; the provenance of the answer seen
  is kept with it); saved ranges (named, from the Ranges editor, opened by `/ranges?range=<id>`, in a new
  `savedRanges` store, database version 3); the Saved page (`web/src/features/saved/SavedPage.tsx`: list, search,
  rename, delete, open in Study or Ranges); backup and restore (`web/src/data/backup.ts`: saved spots, saved ranges
  and sessions in the classic record shape, format `lizard-backup`, schema 1, restored by merging). Saved hands (2026-11-03): the
  Phase 2 imports and Practice hands (Keep in Analyze, or every hand by a setting), written as hand histories, with
  tags, notes and search, in the backup. Saved drills (2026-11-03): "☆ Save drill" in Practice's drills and in a leak
  drill, listed on the Saved page, in a `savedDrills` store (database version 5) and the backup. The backup prompt (2026-11-03): saves counted since the last
  backup made here, a line under the header past 10 (`app/BackupNudge.tsx`). The classic import (2026-11-03): "Import
  its My hands" in Analyze (`web/src/features/analyze/classic.ts`) reads `gto-store` hands read only, on request
  (fixture test `classic.test.ts`: the database is the same after, and none is created where there's none); hands
  with an ante, a straddle or a tournament's prizes are left out and counted. The classic settings: only its speed
  (`gto-speed`) has a Lizard counterpart, and "Use its speed" in Settings reads it on request and sets the solve mode.
  **Still open in Phase 5:** settings in the backup (left out on purpose for now). The record shape still wants the review named in Risks
  before account sync builds on it.
- **Saved spots.** Use the existing `savedSpots` store (`web/src/data/db.ts:41`, index `byUpdated`, interface `SavedSpot`).
  - A "Save spot" button in Study stores the line (the `studyState.ts` URL encoding), a name, tags, a note and the provenance of the answer seen.
  - A Saved page lists, searches, renames and deletes saved spots.
- **Saved drills.** Named drill configurations (spot, node, filters), plus the analyzer's "Drill this leak" sets (`session.js:451`, up to 40 spots), which classic keeps only in memory. Add this through a new migration if `savedSpots` is not a good fit.
- **Saved ranges.** Named ranges from the range editor, for use as inputs in Phase 6.
- **Hands.** Phase 2 imports plus Practice hands marked "save", with tags and notes (as classic `hands.js:1-7`).
- **Backup and restore.**
  - One JSON file for everything, with a version field. Restore merges, so the newer record wins and nothing is deleted, as classic does (`store.js:292`, `:305`). Use the same record shape, `{id, v, created, updated, dev, data}`, so Phase 11 can sync it.
  - "Import from the classic app" reads the classic `gto-store` hands and settings on the same origin, read-only, on request.
- **Deep links.** Every saved item opens by URL. Links never carry personal data or hand histories in query strings; spots use the line encoding only.

Moves matrix rows: Saved solutions, Node navigation (saved spots), Custom drills, Saved hands (shared with Phase 2).

**Dependencies.** None for saved spots, which can ship any time after Phase 0. Saved drills and hands follow Phases 1 and 2.

**Acceptance tests.**
- `db.test.ts`: every historical database version upgrades to the new one with data intact.
- Round trip: back up, clear, restore, and every record is equal. Restoring an older backup over newer data keeps the newer record.
- Saving a spot and reopening it from the list gives the same line and the same request (`studyRequest` equality).
- The classic import reads a fixture `gto-store` database (fake-indexeddb) and never writes to it.

**Risks.**
- **Storage eviction on phones.** Prompt for backup after a number of saves.
- **Schema lock-in.** The record shape is the future sync format. Review it before the first release that writes it.

---

## Mid term: new interfaces on existing engine features

### Phase 6: Custom solve setup: ranges, stacks, sizes, rake, node locks

**Goal.** Let users set up their own spot (ranges, per-seat stacks, bet sizes, rake) and solve it, and lock opponents' tendencies to see the best response. Every such answer is labelled for what it is.

**Deliverables.**
- **Done on 2026-11-03 (second session; `docs/PROGRESS.md`):** the Solve page (`web/src/features/solve/SolvePage.tsx`,
  `setup.ts`): each seat's stack, bet sizes per street and raise sizes (up to 3, 5–500% of the pot), rake and its cap
  (0–25%), ante, straddle, and each seat's range entering the flop (typed, or a saved range), checked before any
  request and opened in Study, which sends them as the engine's keys and shows "Your setup: … Edit setup". A hand-edited
  link that fails the checks is never asked. Checked in the browser: the same heads-up spot with and without 5% rake
  gives different EVs, both converged. Node locks (`web/src/features/study/locks.ts`, `LockPanel.tsx`): in Study under a
  heads-up node after the flop, a read on the opponent (the engine's presets or numbers) asked for one hand through the
  advice, at equilibrium and against the read: the hand's best response with GTO % beside it, the range's best
  response and the change per class, always labelled the best response, not an equilibrium re-solve. Automatic sizing
  (`autoSize.ts`, `AutoSizePanel.tsx`): one hand's advice with `optimize_sizes`, showing the first solve's wide menu and
  the sizes kept, labelled on the badge, with the kept menu against this spot's on the Compare page (the range's EV on
  each). Solve times per mode (`web/src/solver/timings.ts`): measured in the user's own browser from live answers
  (the engine's seconds, by backend, mode, street and table), the medians on the mode buttons and in Settings. **Still
  open in Phase 6:** multiway locks after the flop (the engine locks heads-up only there: an engine change), and the
  local server option (after its patch). Preflop locks are in, on the charts (approximate).
- **Solve page, `web/src/features/solve/`**, replacing the placeholder at `App.tsx:38`. It builds a request with the Advisor keys the engine already accepts:
  - `ranges` (custom ranges entering the flop; `advisor.py:3722`, `:4701-4710`), with saved ranges from Phase 5;
  - per-seat stacks (`_state_stacks`);
  - `sizes`: up to 3 per street, 5 in Study (`advisor.py:298-318`, `:3721`);
  - `rake` and `rake_cap` (`advisor.py:3712-3713`; `solver.py:160-177`), with antes and the straddle option.
- **Solve controls.** Mode (Quick, Fast or Accurate, with measured times), progress and the convergence band (Phase 0), Stop, and the answer in the Study views.
- **Node locks and exploits.**
  - Lock UI over `locks` (`solver/gto/exploit.py:400-652`), labelled "best response to a locked tendency, not an equilibrium re-solve".
  - Show the GTO frequency beside the exploit frequency (`advisor.py:4008-4009`).
  - Study requests drop `locks` and `optimize_sizes` (`STUDY_DROPS`, `advisor.py:2855`). Lock and auto-size answers are therefore per hand, through `advise`, not whole-range Study views. Either show them per hand, or add a declared engine patch that returns the range answer, with tests.
- **Automatic sizing.** `optimize_sizes` (`advisor.py:7985-8021`), shown with the one-size view's EV given up per size (`simple.js`).
- **Rake labels.** A raked spot that reads the unraked library entry is marked approximate, as the engine reports.
- **Local server option.** Settings already allow the HTTP backend.
  - Document how to run `solver/gto/server.py` locally, so users with a desktop can run longer native solves.
  - Before advertising it, add a declared patch for an origin allowlist and a per-run token, because the server answers with `Access-Control-Allow-Origin: *` today (`server.py:38`).

Moves matrix rows: Custom ranges, Stacks & bet sizes, Rake, Node locking, Automatic sizing, Postflop solves, Heads-up, Multiway, Cash.

**Dependencies.**
- Phase 5 (saved ranges and spots).
- Phase 0 (convergence wording).
- Any engine patch for range-wide lock answers must land in a declared patch set, with tests run when the machine is free.

**Acceptance tests.**
- Request builder tests: every UI setting maps to the documented Advisor key and range, and out-of-range input is refused in the UI before it reaches the solver (more than 3 sizes, rake above 25%).
- A locked answer always carries the "best response" label and the GTO frequency. A test fails if any locked answer renders without them.
- Engine check (opt-in): a custom-range HU turn at Fast, with and without rake, shows different EVs and both labels.
- The local server, after the patch, refuses a request from a non-allowlisted origin and without the token.

**Risks.**
- **Users will read best-response answers as equilibria.** The labelling is the main defence.
- **Abstraction limits.** At most 2 raises per street and small size menus (`solver.py:82`). Show the tree that was actually solved.
- **Browser memory.** Bigger trees and multiway spots can exhaust memory on phones. Measure and cap per device, and suggest the local server.

### Phase 7: Tournaments

**Goal.** Bring the existing ICM and bounty engine into Lizard. Every number shows which model produced it and where that model is approximate.

**Deliverables.**
- **Done on 2026-11-03 (second session; `docs/PROGRESS.md`):** the Tournaments page (`/tournaments`: `SolvePage.tsx`
  with `kind="tournament"`, `web/src/features/tournaments/tournament.ts`): the prizes left (typed as `50 30 20`, up to
  200 places, or one of three generic shapes of Lizard's own), each seat's stack, ante and straddle, the players at
  other tables (count and average stack, sent as `field`), and KO, PKO (everyone's bounty, a seat's own, the other
  tables' average) or mystery bounties (the average envelope, or the pool and the envelopes left), checked before any
  request and sent by Study with no rake. Every tournament answer's badge names its model ("prize-equity solve (ICM)",
  "push/fold equilibrium in prize equity", "a call priced in prize equity", "chip chart with a risk premium" with
  "approximate", "a tournament, but the fallback plays chips", plus the bounty model), and a Tournament panel shows
  the player to act's prize equity, bubble factor against each opponent, and what busting each covered opponent is
  worth. Checked in the browser: preflop push/fold and chart answers, and a flop live solve in prize equity.
  Also done: "Compare with chip EV" in Study (`ChipCompare.tsx`: the same node with no tournament, both answers'
  actions side by side with their badges), and a large field compressed onto the 12-player model named on the badge
  ("54 players modelled by 12"). Satellites: Lizard's own engine tests (`scripts/engine/test_tournament.py`, in CI)
  check flat payouts (finite bubble factors on the bubble, null once every player left is paid, never a crash), and
  then a "Satellite, N seats" shape; preflop stays the chip chart with a risk premium, said on the page.
  The bubble factor table for every pair (`icm.ts`, the page's port of the engine's prize model, pinned to its numbers;
  `BubbleTable.tsx`: on the Tournaments page, and "Every pair" under Study's Tournament panel, with each pair's equity to
  call an all-in), and a 15%-paid curve preset for the players left (`paidCurve`).
  Analyze: a tournament hand's decisions each have a "with prizes" link to the Tournaments page (the same line, stacks
  and ante; a hand history has no prizes left, so they're typed there); its own Study links and grades stay in chips.
  ICM against chips per hand class: "Compare with chip EV" links to the Compare page (tournament A, chips B, each class's
  change), and a chip answer's push/fold all-in is named on its badge ("push/fold equilibrium in chips").
  **Still open in Phase 7:** a satellite-aware preflop (push/fold covers only all-ins), and tournaments in Practice.
- **Tournament setup, `web/src/features/tournaments/`.**
  - A payout editor (prizes left, up to 200 places; parsing as `parsePayouts`, `index.html:875`).
  - The field: other tables' stacks, or players and total chips (`advisor.py:448-481`).
  - The bounty format (off, KO, PKO, mystery) with bounty sizes or envelope and pool (`index.html:714-738`).
- **Study and Solve in prize equity.** Send `payouts`, `field` and bounties with Study and Solve requests (the engine already accepts them in Study). Show the answer's `tournament` block (`advisor.py:484-510`): equity share, bubble factors, who covers whom, and bounty notes.
- **Model labels in the UI, everywhere a tournament number appears.**
  - Postflop: "prize-equity solve".
  - Push/fold: "push/fold equilibrium in prize equity".
  - Other preflop: "chip chart with a risk premium (approximate)".
  - Mystery: "average envelope".
- **ICM vs chipEV.** Run the same spot twice and show both, ahead of the general compare view in Phase 8.
- **Bubble factors and risk premium.** A table per pair of players (`icm.py:378-431`), not a single note line.
- **Payout presets.** A few generic structures (winner-take-all, flat top 3, a typical 15% paid curve). Lizard writes these itself, not copied from any site.
- **Satellites.** Validate flat payouts as a satellite model. Add tests for "more places paid than players left" (where the bubble factor becomes infinite and is reported as null). Only then add a "satellite" preset.

Moves matrix rows: all Tournament rows, and MTT.

**Dependencies.**
- Phase 0 (labels).
- Phase 6 (per-seat stacks; tournament stacks are rarely equal).

**Acceptance tests.**
- Port `solver/tests/js/icm.test.js` and `bounty.test.js` cases for payout parsing and display.
- Request builder: a tournament setup produces the exact Advisor keys, and no rake (tournaments are never raked, `advisor.py:3709-3712`).
- Every tournament answer rendered in a component test shows one of the model labels. A test fails on an unlabelled one.
- Satellite tests (Python, run when the machine is free): flat payouts give finite or null bubble factors as documented, never a crash.
- Engine check (opt-in): the README example, six 20bb stacks paying 50/30/20, reproduces the documented ICM call and jam rates within rounding.

**Risks.**
- **ICM preflop is mostly heuristic.** Users will compare it with dedicated ICM tools. Lead with the label, and keep push/fold (which is solved) separate.
- **Large fields.** These are compressed onto a 12-player model with stand-ins (`icm.py:166-195`). Say so when the field is large.

### Phase 8: Comparisons

**Goal.** Let users compare two answers side by side: two actions, two nodes, two depths, rake against no rake, ICM against chipEV, or charts against the preflop solve.

**Deliverables.**
- **Done on 2026-11-03 (second session; `docs/PROGRESS.md`):** the compare view (`web/src/features/compare/`,
  `/compare?a=…&b=…`, each side a Study link): both spots asked one after the other through the one solver queue
  (each side's status, and Stop), what differs, each side's badge, a warning first when the sources differ or either
  is approximate, the actions with B − A in frequency and EV (EV changes within both answers' distance from
  equilibrium greyed as noise), the range's totals, a diff grid per class for any one action, and the biggest
  differences. Study links each answer to it: a tournament in chip EV, with or without rake postflop, another stack.
  Tests: the diff of an answer with itself is zero, the warning for mixed or approximate sources. Compare EV: under a
  solved node's grid in Study, one action's EV minus another's per class (`evgap.ts`, `EvGapPanel.tsx`), with the
  classes where each is worth most more, the check that classes taking both are near zero, and the rough-EV caveat.
  The one-size view (`oneSize.ts`, `OneSizePanel.tsx`; the `simple.test.js` cases ported): in Study, "One bet size" or
  "One raise size", one solve a request at Fast with progress, Stop and Continue, the best single size and what each
  gives up. The charts against the preflop solve: a preflop spot's "Compare this spot" link, the sources named as what's
  compared. The picker for any two nodes (`SpotPicker.tsx`, `pin.ts`): on the Compare page each side from the saved
  spots, the spot pinned in Study, or a pasted Study link, with Swap; Study's "Pin as A" and "with the pinned spot".
  Two size menus (`compare.ts` `sizesOnly`, `menusOf`, `menuWords`): Study's "with flop bets … % compare menus" at a
  heads-up decision after the flop, and on the Compare page what each menu offers, how much of the range bets or raises,
  which is worth more to the player to act (noise-aware), and any bet or raise per class. Phase 8 has nothing open.
- **A compare view, `web/src/features/compare/`.**
  - Two Study requests, each with its own provenance, and a diff grid per class (frequency and EV difference).
  - Changes in the range's totals.
  - A "biggest differences" list.
- **Compare EV.** For one node, the EV difference between two actions per class, from the combo rows Study already returns.
- **Preset comparisons.** Same spot at two stacks, raked against unraked, chips against prize equity (Phase 7), and charts against the preflop solve (Phase 0).
- **The one-size view.** Each size's EV given up against the full menu (`simple.js:1-11`).
- **Mixed sources.** When the two sides have different provenance (library against live, charts against solve), the diff says so at the top.

Moves matrix rows: Solution comparisons, Range comparison.

**Dependencies.** Phases 0, 6 and 7 for the inputs being compared.

**Acceptance tests.**
- The diff of an answer with itself is zero everywhere.
- Mixed-provenance diffs always show the warning.
- Port the `simple.test.js` cases (11 tests) for the one-size view.

**Risks.**
- **Run time.** Two live solves take twice as long; queue them and show progress for each.
- **Noise.** Diffs between two approximate solves can be noise. Show each side's convergence band, and grey out differences smaller than the two bands combined.

---

## Long term: new numerics and optional services

### Phase 9: Solver depth for NLHE

**Goal.** Replace the approximate parts that matter most with solved ones, each with a measured accuracy check. This is new numerics, and it is the most expensive phase per feature.

**Deliverables.** Each item ships separately, behind its own provenance label.
- **Preflop.**
  - Extend the class-level preflop solve to unequal stacks, 7–9 players in the browser, antes and the straddle. Measure against published solves, as `docs/research/03` §4 did (today 2.4–3.0 points).
  - Offer it as the default source only where it beats the charts on that measure.
- **ICM preflop solve.** Prize-equity payoffs in the preflop game (using `icm.Model`), replacing the chip chart plus risk premium.
- **True node-lock re-solve.** Hold a locked strategy fixed inside CFR and solve the rest to equilibrium, instead of a best response to a tendency.
- **Bigger trees.** More sizes and raises per street where memory allows, with per-device caps.
- **Library breadth.** More depths, 2-max and 3-way spots, and turn files for the older-tree spots. These are built offline in the separate library pipeline (`library-build/`), never on a machine that is also serving development.

**Dependencies.**
- A stable engine patch process (see "Upstream churn").
- Machine time free of other builds.
- Phases 0–8, so there is UI to show the results.

**Acceptance tests.**
- Each solver change has Python tests for its convergence or exploitability, plus a comparison against a reference solve, with the tolerance stated in the change.
- The provenance label changes only when the new source is in use.
- Library builds pass the existing index validation, and appear in the Library page without a code change.

**Risks.**
- **High cost.** This is solver research. Results may not beat the current approximations.
- **CPU contention** with library builds.
- **Upstream may solve the same problems differently.** Check upstream before starting each item.

### Phase 10: PLO4 engine

**Goal.** Add pot-limit Omaha (four cards) as a second game. It is a separate engine behind the existing `GameEngine` interface, not a change to the NLHE solver.

**Deliverables.**
- **Engine work, a separate solver track.** A PLO4 evaluator, combos and isomorphism, pot-limit betting, and a postflop solver sized for the browser. Hold'em code assumes two hole cards throughout (`solver/gto/cards.py:45`, `evaluator.py:1-8`, `advisor.py:3733`).
- **Lizard-side work.**
  - Replace the placeholder registration in `web/src/engine/registry.ts:35-51` (`solverSupported: false`, `classGrid: null`).
  - Add a condensed range view for PLO, since there is no 13x13 grid.
  - Make Study, Practice and Analyze game-aware through the registry. Today the hand-history parser rejects Omaha (`hh.js:118-119`).
- **Labels.** Start with postflop heads-up from given ranges, plainly labelled, before any preflop.

**Dependencies.**
- Phases 0–5, so the app is game-agnostic in its views.
- A PLO solver that has been validated against reference solves.

**Acceptance tests.**
- Evaluator exhaustive checks against a reference evaluator on sampled hands.
- Pot-limit bet sizing tests.
- Exploitability measurement on small trees.
- Lizard component tests showing NLHE-only features hidden or marked for PLO.

**Risks.**
- **Problem size.** PLO is far larger. Browser memory and time may make solves too coarse to be useful, so measure early and stop if needed.
- **Maintenance.** It doubles the maintenance surface.

### Phase 11: Optional account sync

**Goal.** Let users who want it sync their saved data across devices. Nobody is ever required to sign in.

**Deliverables.**
- **A separate small service.** Not part of the static site. It stores encrypted record blobs, using the Phase 5 record shape, `{id, v, created, updated, dev, data}`.
- **Client.** A sync module in `web/src/data/`, off by default and enabled from Settings. It uses end-to-end encryption with a user passphrase, so the server cannot read hands.
- **Conflicts.** Newer record wins, as in restore. Deletions use tombstones.
- **Manual backup stays.** Backup and restore remain the main no-account path.

**Dependencies.**
- Phase 5 (record shape, backup).
- A hosting decision for the service, outside GitHub Pages.

**Acceptance tests.**
- With sync off, the app makes no requests to the sync host.
- Two simulated devices converge after offline edits.
- Server data is unreadable without the passphrase. Losing the passphrase loses only the server copy, not local data.

**Risks.**
- **It is an ongoing service,** with cost, abuse handling and privacy duties.
- **Passphrase loss** cannot be recovered by design. Say so.

### Phase 12: AI explanations through a server-side proxy

**Goal.** Plain-language explanations of a decision, grounded in the solver's numbers, without putting any API key in the browser bundle.

**Deliverables.**
- **A Lizard-owned proxy service.** Based on the design of `solver/cloudflare/explain-proxy/`, but not sharing its quota.
  - The key is held only as a server secret.
  - The model and system prompt are fixed on the server.
  - The client sends structured decision data (spot, mix, EVs, grade), not free text. The server builds the prompt, so the proxy cannot be used as a general chatbot.
  - Per-IP and global limits, and an origin check treated as a soft signal only, since it can be forged (`docs/research/06` §0).
- **Client.** An "Explain" button on Practice verdicts, analyzer decisions and Study nodes, adapting the prompt builder in `practice.js:604-639`.
  - Answers carry a label: "AI explanation of the numbers above; may be wrong."
  - The app works fully when the proxy is down or the quota is used.
- **No keys in the client.** Lizard does not offer a bring-your-own-key field. The classic app keeps a user key in `localStorage` (`gto-anthropic-key`, noted in `store.js:19`), which is readable by any script on the shared origin. Lizard never reads it.

**Dependencies.**
- Phases 1 and 2 (verdicts to explain).
- A hosting decision and budget for the proxy.

**Acceptance tests.**
- A build-time check fails if the bundle contains anything matching an API-key pattern.
- The proxy rejects a request whose fields fall outside the schema, and rejects prompts above the size cap.
- Rate limits are enforced per IP and in total.
- With the proxy stubbed as unreachable, no page breaks.

**Risks.**
- **Cost and abuse.**
- **Hallucinated reasoning** that contradicts the numbers. Keep answers short, grounded only in fields sent, and always shown next to the numbers.

---

## Not scheduled

- **Study plans.** Ordered drill sets with progress. This is cheap once Phases 1, 4 and 5 exist; lesson content is the expensive part.
- **Installable app and offline use.** A web app manifest and an offline cache for the app shell. The solver assets (about 25 MB) need a deliberate cache policy.
- **Human-vs-human play or a ranked heads-up arena.** This needs a real-time server, matchmaking and anti-collusion work. It does not fit static hosting.
- **Live-table assistance.** Out of scope by the ethical rules in `IMPLEMENTATION_PLAN.md` §0.

## Matrix rows by phase

| Phase | Matrix rows it moves |
|---|---|
| 0 | Filters, Equity & EQR, Range comparison, Postflop (3-way), Preflop (Solver source), Frequencies & EV, Convergence display, Preferences, 2–9 handed, Short and Deep stack inputs |
| 1 | Preflop trainer, Postflop trainer, Full-hand play, Drills, Multitabling, EV-loss scoring, Session stats, Coaching/feedback (rule-based) |
| 2 | Hand-history import, Bulk upload, Decision grading, Leak finding, Frequency comparison, Reports (analysis), Saved hands |
| 3 | Aggregate reports |
| 4 | Range-builder trainer |
| 5 | Saved solutions, Custom drills, Node navigation (saved spots) |
| 6 | Postflop solves, Heads-up, Multiway, Custom ranges, Stacks & bet sizes, Node locking, Rake, Automatic sizing, Cash |
| 7 | chipEV, ICM, MTT/final table, Satellites, KO/PKO, Mystery bounty, Payout structures, Bubble factors, MTT |
| 8 | Solution comparisons |
| 9 | Preflop solves, and the APPROXIMATE preflop parts of many rows |
| 10 | PLO4 |
| 11 | Account sync |
| 12 | AI explanations, Coaching/feedback (AI) |
