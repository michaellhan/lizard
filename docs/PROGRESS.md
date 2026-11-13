# Progress log

Chronological, newest last. Every entry says what changed, which tests were actually run and their results, the
commits, and whether the two heads-up precompute builds were left alone. Read this, `CLAUDE.md` and
`docs/ROADMAP.md` before resuming.

## How to resume

1. `git status` and `git log --oneline` in `/Users/mhan/Desktop/projects/lizard` (this repo). Never run git in
   `/Users/mhan/Desktop/projects/gtosolver`, and never touch `gto-wt/*`.
2. Check the builds only with read-only commands, for example
   `ps -axo pid,etime,rss,command | grep build_flop_library`. Do not signal, renice or restart them.
3. `npm install`, `npm run check`, then pick the next item in `docs/ROADMAP.md`.
4. Newly finished heads-up flops publish themselves every 6 hours by launchd (`docs/DEPLOYMENT.md` §4). To publish sooner:
   `/Users/mhan/Desktop/projects/gtosolver/.work/bin/slot.sh scripts/library/publish.sh`.

## 2026-11-03 — Phase 1: audit, repo, first deploy

### Research and audit

Six research agents ran one or two at a time (the plan's cap during the builds). Their raw reports are in
`docs/research/`:

- `01` codebase audit;
- `02` the inventory of GTO Wizard's public features (public pages only; nothing scraped or copied);
- `03` solver numerics;
- `04` frontend/UX;
- `05` hosting and deployment;
- `06` testing, security and risk;
- `07a–c` per-feature status against this repo.

The synthesized documents are `EXISTING_SOLVER_AUDIT.md`, `ACCURACY.md`, `FEATURE_MATRIX.md`, `ROADMAP.md`,
`ARCHITECTURE.md` and `DEPLOYMENT.md`.

### Repository

- New, separate directory `/Users/mhan/Desktop/projects/lizard`. The existing gto-solver checkout was neither moved
  nor modified.
- `solver/` is a snapshot of gto-solver at `9b907bd61a95758c48b1141cfadd854ba2c0eeaa`. Provenance and local patches
  are recorded in `solver/UPSTREAM.json`.
- GitHub: `michaellhan/lizard` (private) and `michaellhan/lizard-library` (private; served by Pages). No secrets,
  keys or `.env` files are in either repo. The large library data is not in the app repo (`.gitignore`); it lives
  in `lizard-library`.

### Code

- `web/`: React 19 + TypeScript + Vite 8, Tailwind 4, Zustand, `idb`.
  - Typed solver client (`web/src/solver/`):
    - worker and local-HTTP transports;
    - progress (partials), cancellation (Atomics when isolated, otherwise worker restart);
    - typed errors and provenance (library vs live, iterations, exploitability).
  - Study: preflop and postflop node browsing, 13×13 matrices, combos, frequencies and EV, and deep links
    (`/lizard/study/?p=…&s=…&pre=…&b=…`).
  - Library coverage page; Ranges editor (paint and text ranges); Engine status and self-test page; Settings.
  - IndexedDB with versioned migrations (v1→v2 is tested).
- `scripts/build-solver-assets.mjs`: builds the worker bundle from `solver/`. The worker's cache is renamed to
  `lizard:solver` so it cannot collide with the classic app on the same origin.
- `scripts/postbuild.mjs`: per-route `index.html` and `404.html`, for deep links on Pages.
- `scripts/library/assemble.py` and `publish.sh`: merge the 6-max library with the heads-up build outputs, read-only,
  validating every copied file; then publish to `/lizard-library/`.
- `.github/workflows/deploy.yml`: checks, build, then Pages deploy.
- Security: a CSP meta tag; the service worker sets COOP/COEP plus `frame-ancestors 'self'` and `nosniff`; http is
  redirected to https in the app.

### Tests actually run (at `758e003`)

| Suite | Result | Where |
|---|---|---|
| Web (Vitest): 9 files | 38/38 pass | local and CI |
| Typecheck (`tsc -b`) and ESLint | clean | local and CI |
| Library assembler (`scripts/library/test_assemble.py`) | 6/6 pass | local and CI |
| Solver quick: `tests.test_bundle`, `tests.test_routes` | 12/12 pass | local and CI |
| Solver quick: `routes.test.js`, `solver_state.test.js` | 32/32 pass | local and CI |
| Solver full suites (Python 678 OK with 5 expected failures; Node 411/411) | **not re-run** | baseline from the audit of the upstream snapshot |

The full solver suite takes about 12 minutes of CPU, so it was deliberately not re-run while the builds were
running. The Python solver code is unchanged from the snapshot, apart from the two guarded deploy scripts and the
build-time cache rename in `worker.js`.

### Deployment (verified on the live URL, not inferred from CI)

- App: https://www.michael-han.com/lizard/ — commit `758e003`, workflow run 41629225798 (success, 1m5s).
- Library: https://www.michael-han.com/lizard-library/ — library commit `5fad69f` (20 spots, 40,389 files; heads-up
  `srp_sb_bb_2max` 378 flops, `lp_sb_bb_2max` 148 flops).
- Checked:
  - every route returned 200, and an unknown path returned 404 with the app;
  - `crossOriginIsolated` was true and the service worker controlled the page;
  - Study answered TdTc8h from `srp_btn_bb` (6-max) and from `srp_sb_bb_2max` (heads-up, "0.14% pot from
    equilibrium · 300 iterations");
  - the engine self-test passed;
  - `/`, `/gto-solver/` and `/gto-solver-library/index.json` still returned 200.

### Fix after the first deploy: Library coverage denominator

- The Library page showed `lp_sb_bb_2max` as "148 / 184", guessing the target from the flop count; the build's plan
  is 552. Now `assemble.py` writes each spot's planned count into `lizard-library.json`, taken from the solver's
  `SPOT_FLOPS`. The page reads that file, and shows a bare count when a library has none (the upstream one).
- Tests: the assembler test asserts the targets; the catalog tests cover a published plan and the no-plan case.
  Assembler 6/6 passed after the change.

### Fixes from the audit's findings (commit `0054204`)

The doc agents read the Lizard code against the Advisor and found three real defects. All are fixed, with tests.

1. **Speed modes sent no time budget.**
   - Every browser mode ran at the Advisor's default 4 s + 2 s, so Accurate was not the measured 60-second mode.
   - `applyMode` now sends the classic app's budgets for each mode and backend: browser Fast 8 + 3 s, Accurate
     60 + 12 s; server Fast 2.5 + 2.5 s, Accurate 30 + 12 s; postflop Quick 1.5 s (river 0.8 s) + 0.3 s with `quick`.
   - The ModePicker hints state these numbers.
2. **Answers were labelled with the wrong source.**
   - Stored-turn reads were labelled "Live solve" with the flop entry's exploitability. They are now "Stored turn
     from the flop library", approximate, with no exploitability shown.
   - Instant answers were "Unlabelled". They are now "Answer at once", followed by the Advisor's own label.
   - 5+-way heuristic answers were unlabelled. They are now "Heuristic rules (not a solve)".
3. **Practice claimed EV-loss scoring**, but classic Practice grades by frequency (Drills use EV). The wording is
   corrected, and a comment naming a competitor's product feature was reworded.

Tests after the fixes: web 39/39 (one new case in `provenance.test.ts`; extended assertions in `client.test.ts` and
`catalog.test.ts`, where the old `targetFlops` case was replaced by a no-plan case), typecheck and lint clean,
assembler 6/6.

Deployed by workflow run 41630891243 (success). Verified live on bundle `index-BDhF1YPR.js`, the same file as the
local build:
- Library page: `lp_sb_bb_2max` "168 / 552", 3-way and upstream rows show a bare count.
- Study, heads-up, TdTc8h, turn 2s after checks on the flop: "Stored turn from the flop library" at once, then
  "Answer at once · this street's solve so far (100 iterations, 0.95% …)" and (200 iterations, 0.36% …), both in
  progress, then "Live solve · 0.20% pot from equilibrium · 300 iterations" at 8.3 s. That fits the 8 s Fast
  budget now being sent.

Library republished as `7c6995b` (20 spots, 40,429 files; `srp_sb_bb_2max` 378, `lp_sb_bb_2max` 168; the first
publish with per-spot targets). The live `index.json` matched.

`6deaad4`: `assemble.py` writes no target for a spot without a plan, instead of guessing 184 / 552 / 1,755.
Assembler 7/7.

### Independent review of `758e003..6deaad4` (workflow, at most 2 agents at a time)

Two read-only reviewers (solver client; library and docs) reported 25 findings. A skeptic checked the 8 most severe:
7 confirmed, 1 refuted. The lead checked the 17 unverified low ones against the code; all but one held. The one that
did not: the heads-up fingerprints were in fact checked this session. Fixed in the next commit:

1. **High: a flop read off the nearest stored flops was labelled "Stored turn".** `_study_near` sets
   `solver.by: "the flop library"` too. Stored turns are now told only by `approximate.source` or `source` "store".
2. **High: a turn read off the flop's live solve was labelled "Live solve"**, showing the flop solve's
   exploitability and iterations. Any top-level `approximate` now decides first: "solve" (a look at this street's
   own solve) is live; the rest are "Answer at once", with the other solve's numbers hidden.
3. **High: the heads-up SRP target was 552**, but the build continues to all 1,755 flops (IMPLEMENTATION_PLAN.md).
   `assemble.py` has a cited `BUILD_PLANS` override.
4. **Medium: Study could send `quick`**, which classic Study never does; a quick 4-way Study flop errors in the
   browser. Study now offers Fast and Accurate only, `applyMode` never sends `quick` with `study`, and Quick runs a
   Study request at Fast.
5. **Low: further hardening.**
   - Quick's street is counted in cards, not characters, and Study URLs normalise their board.
   - The catalog survives a `lizard-library.json` without `spots`, and the Library page shows an error instead of
     hanging on "Loading…".
   - `SolverDiagnostics` allows the `null` numbers the Advisor sends.
   - The ModePicker hints say a street can run past its budget.
6. **Docs.** Fixed stale citations, the `sourceOf` order, the 2-max library status, the ARCHITECTURE mode and
   provenance sections, and a ROADMAP acceptance check that contradicted the app. The audit now matches CLAUDE.md
   on reading the build folders, and DEPLOYMENT documents `target` and the 10-minute HTML cache.

Tests: web 39/39 (new or extended cases in `provenance.test.ts`, `client.test.ts`, `catalog.test.ts`,
`studyState.test.ts`), typecheck and lint clean, assembler 7/7 (one asserts the real `SPOT_FLOPS` parse).

Deployed `26740a6` by workflow run 41634120219 and verified live (bundle `index-HzrPKOaR.js`, the same as the local
build). Library republished as `03329ce`: the same flops, with the `srp_sb_bb_2max` target 1,755 in
`lizard-library.json`.

### Second verification round (of `26740a6`)

A second read-only workflow checked the provenance code against every Advisor response shape and the docs against
the code. Fixed:

1. **A 3-way read of an earlier decision's solve showed as "Live solve".** `_study_mw_prev` sends
   `approximate.source` "solve" with `solver.by`. "solve" now means live only without `solver.by`; with it, "Answer
   at once" and the other solve's numbers hidden.
2. **Borrowed library spots looked exact.** An entry read from another table size (`precomputed.borrowed`) is now
   approximate, shows the borrowed spot's description, and hides the other spot's exploitability.
3. **Preflop charts were not marked approximate.** They are now, as the rules and equity fallbacks were.
4. **The stored-turn label was hidden.** The badge now shows the Advisor's label for stored turns too.
5. **The exploitability wording.** The badge now says "X% pot from equilibrium in the solved game", and for 3- and
   4-way answers "mean best-response gain", which is what the Advisor measures there.
6. **Provenance recorded the requested mode**, not the one run. A Study request asked at Quick runs at Fast, and
   now says so (`effectiveMode`).
7. **`publish.sh` could report success early.** It waited only for `index.json`, so a publish that changed only
   `lizard-library.json` (as `03329ce` did) reported live at once. It now waits until both match what was pushed.
8. **The Combo view was graded WORKING without a test.** `ComboPanel.test.tsx` covers the EQR formula, the table's
   columns and sort order, and the opponent view. `src/test/setup.ts` now unmounts after each test (Testing
   Library does so by itself only with Vitest globals, which are off).
9. **Docs.**
   - ACCURACY: Study answers never carry the over-target `approximate` flag (`advisor.py:2982-2983, 3000`); 20
     heads-up spots, not 18; the `sourceOf` order and the borrowed and charts rules.
   - ARCHITECTURE: the 4 s + 2 s default is the browser worker's (the local server falls back to `SPEEDS`), and the
     provenance table.
   - FEATURE_MATRIX and ROADMAP: the convergence wording is done, bands remain; the library target cites `03329ce`.
   - Study, Settings and the ModePicker describe the modes as they run.

Tests: web 43/43 in 10 files (new `ComboPanel.test.tsx`; more cases in `provenance.test.ts` and `client.test.ts`),
typecheck and lint clean, assembler 7/7, `bash -n publish.sh` clean, solver quick suites 12/12 and 32/32.

Deployed `09b55db` by workflow run 41636890021 and verified live (bundle `index-v5KspPoD.js`, the same as the local
build). Study heads-up TdTc8h, turn 2s: "Stored turn from the flop library · the precomputed flop solve's view of
the turn (…)", then "Live solve · this street's solve so far (200 iterations, 0.36% …) · in progress", then "Live
solve · 0.20% pot from equilibrium in the solved game · 300 iterations" at 3.5 s. The Library page shows
`srp_sb_bb_2max` "378 / 1755" and `lp_sb_bb_2max` "168 / 552" (library `03329ce`).

### Third review round (of `09b55db`)

A read-only workflow (2 reviewers, then one skeptic per finding, at most 2 agents at a time) reported 13 findings:
11 confirmed, 2 refuted. Two were real display bugs that predate this commit:

1. **Missing values shown as zeros.** The Advisor sends EVs and equities it does not have as `null` (`_no_values`,
   `advisor.py:8423-8431`). That covers every answer at once, every look, and a 4-way answer's equities. Lizard
   tested `!== undefined` and printed "EV 0.00bb", "Equity 0.0%" and "equity 0.0%" in the header. Now:
   - `pct` and `bb` print "–" for null;
   - the combo panel, the matrix labels and the header leave such values out;
   - a matrix cell without a value is drawn neutral;
   - as in classic Study, an approximate answer offers the strategy view only, and the equity view needs the
     range's equity (`features/study/views.ts`);
   - the types allow `null`.
2. **Per-action EVs never showed.** The Advisor names the field `ev_bb`; Lizard read `ev`. The action buttons now
   show the EV, with "≈" when it is rough (`actionLine`).
3. **`publish.sh`'s "nothing changed" exit could never be reached.** Every assembly wrote a fresh `assembledAt`.
   `assemble.py` now keeps the previous summary's time when nothing else in it changed.
4. **The mode texts described the browser only.** Only the browser's Fast stops a settled heads-up street
   (`worker.js:260`); the local server runs its whole budget. At Fast, either backend gives a heads-up street the
   unspent budget of each earlier street that cost nothing (`spare_prior`). The ModePicker, the Settings page and
   ACCURACY §4.1 say so.
5. **Docs.** Fixed:
   - the PROGRESS account of the old `publish.sh` check, which had the two files the wrong way round;
   - stale citations in ARCHITECTURE (`applyMode`) and FEATURE_MATRIX (Preflop, Preferences, Postflop, Frequencies
     & EV, Equity & EQR, Range comparison);
   - the `instant` row in ACCURACY.

Tests: web 48/48 in 11 files. New: `views.test.ts`, a null-values case in `ComboPanel.test.tsx` and in
`RangeMatrix.test.tsx`; both null cases fail on the old components. Typecheck and lint clean. Assembler 8/8, with
a new test that an unchanged run keeps the time.

Deployed `7c28833` by workflow run 41640635230 and verified live (bundle `index-TdDf0aVC.js`, the same as the local
build). Every route returned 200, an unknown path 404, and `/`, `/gto-solver/` and `/gto-solver-library/index.json`
200. Study heads-up TdTc8h, turn 2s, with AJs selected:
- the stored turn and both looks show the strategy view only. The combo panel shows combos and mix, with no EV,
  equity or EQR. The stored turn's action buttons show its stored EVs (EV 2.36 and 4.31), and the looks show none;
- the final answer ("Live solve · 0.20% pot from equilibrium in the solved game · 300 iterations") offers Strategy,
  EV and Equity, with "equity 49.5%" in the header. AJs shows EV 2.90bb, equity 60.3% and EQR 0.80, and the
  per-action and per-combo EVs are filled.

### Precompute builds

Both heads-up builds were left untouched throughout: no signals, renice, restarts or writes. Lizard only read
their output directories (`.work/hu-lib`, `.work/hu-lp-lib`), copying files into its own stage after validating
them. `quiet.sh` was never used. Heavy steps ran niced.

### Known limitations at the end of Phase 1

- Practice, Analyze, Solve, Reports and Tournaments are placeholders that link to the classic app. They are graded
  NOT IMPLEMENTED in Lizard in `FEATURE_MATRIX.md`.
- The Ranges editor has no grading; single-combo ranges are not parsed.
- PLO4 is not supported.
- Domain-wide issues that predate Lizard (`DEPLOYMENT.md` §3):
  - the Pages certificate for `www.michael-han.com` expired with ACME state `bad_authz`;
  - http is not redirected by the domain.

### Next

Following `IMPLEMENTATION_PLAN.md` and `ROADMAP.md`:
- port the Practice trainer onto the typed client;
- add Playwright smoke tests (study deep link, engine self-test), run against the preview build;
- then hand-history import.

## 2026-11-03 — Second session: Phase 0 (Study completion)

### How this session started

A second Claude Code session was asked to continue `IMPLEMENTATION_PLAN.md` only after the first had finished. It
waited without touching the repository. Completion was checked three ways before any edit:
- the app's own session state (`isRunning: false`);
- the first session's transcript, which ended with its final report ("done (success)");
- none of its files (transcript, subagents, workflows) changed for over 15 minutes.

The waiting cost one `stat` every 2 minutes. The first session left a hung background `node --test` (from 06:19, 0%
CPU). It was left alone, because killing it would wake that session.

### Code

- **Grading module, `web/src/grading/grade.ts`.** One scale for every trainer, ported from classic `drills.js`
  (`MIX` 0.1, `TOL` 0.011, `RARE` 0.03): Best, Correct, Inaccuracy (under 2% of the pot), Mistake (under 8%),
  Blunder. Without EVs (preflop charts) it grades by frequency only, with `byEv: false`, and counts no EV lost.
  `GRADE_RULES` states the thresholds in words; `emptyScore`, `addScore` and `summary` keep running scores.
- **Convergence bands.** `bandOf` in `provenance.ts`: converged under 3% of the pot, fair under 10%, else rough,
  and "approximate" with the target when the solver flags an answer. The badge text shows it, e.g. "0.11% pot from
  equilibrium in the solved game (converged)".
- **Study** (`StudyPage.tsx`):
  - **New hand:** any table size from 2 to 9 and any stack from 10 to 250bb, replacing the four presets;
  - **Range toggles:** one per player, including both opponents in 3-way spots (the answer's `opponents` list);
  - **Hand-category filter:** made hands and draws, ported from `study.js` `catsOf`/`filterRes`
    (`features/study/filters.ts`). The grid, the action frequencies and EVs, and the range's totals are recomputed
    over the category's combos, and no EVs are made up for an answer at once;
  - **Action legend:** shows one action, drawing the others empty; in the EV view it shades by that action's EV;
  - **EQR grid view:** EV / (equity × pot);
  - **EV unit:** bb or % of the pot, per Settings, on the action buttons and the class panel. The unused
    `colorByAction` setting was removed.
- **Library page:** 3-way spots link to Study.
- **Protocol types:** `categories` is `[id, label]`; added `opponents`, `range_ev_bb` and `OpponentRange`.

### Tests actually run

| Suite | Result |
|---|---|
| Web (Vitest) | 66/66 in 14 files. New files: `grade.test.ts` (the classic drills cases, thresholds, chart-only grading), `filters.test.ts` (the classic `study.test.js` filter fixture), `StudyPage.test.tsx` (stubbed solver: 3-way toggles, filter, EV in % of pot, new hand, action focus). New cases in `provenance.test.ts` (bands at 2.99/3.0/9.99/10.0), `RangeMatrix.test.tsx` (hidden actions, EQR) and `views.test.ts` |
| Typecheck and ESLint | clean |
| `npm run build` | built (`index-CfZyBMyn.js` before the final docs-only edits) |

The solver suites were not run: no solver code changed.

### Checked in the browser (local production build, `vite preview`)

- 6-max BTN vs BB, Kd7c2h, from the library: the badge read "Precomputed solution · srp_btn_bb · 0.11% pot from
  equilibrium in the solved game (converged) · 300 iterations". The filter listed 15 categories; "Top pair, good
  kicker" showed 12.9 of 512.7 combos with BB checking 100%. The EQR view shaded only the filtered classes. There
  were no console errors.
- 3-way, CO open with BTN and BB calling, Ac4c2d, from `mw_co_btn_bb`: toggles BB, CO and BTN, each with its own grid
  (70 and 21 classes in range for CO and BTN). The badge read "0.09% pot mean best-response gain in the solved game
  (converged)".
- At 375px there is no page-level horizontal scroll.

Only library spots were opened, so no live solve ran.

### Precompute builds

Untouched. Read-only `ps` checks only. Memory stayed at 63–70% free. Swap sat at about 6.9 of 8 GB throughout,
already that high before this session, and did not grow.

### Next

- Phase 0's last item: the preflop Solver source.
- Phase 1: Practice on the typed client.

### Deploy of `bc8a369`, checked live

GitHub Actions run 41645407510 succeeded. The live bundle was `index-CfZyBMyn.js`, the same as the local build.
`/lizard/`, `/lizard/study/` and `/lizard/library/` returned 200, as did the classic `/gto-solver/` and the
library's `index.json`. Study's new controls (players, stack, filters, EQR view) were checked on the live site.

## 2026-11-03: Phase 1, Practice (second session)

### Code

- **Table engine, `web/src/poker/`.** Pure TypeScript with no React, ported from the classic `index.html` table
  logic (`simulate`, `recordOf`, `sidePots`, `settle`):
  - `seats.ts`: the seats for 2 to 9 players and their order of action;
  - `evaluate.ts`: seven-card hand ranking and hand names ("two pair, kings and sevens");
  - `table.ts`: betting rounds, with sizes to the half big blind and an all-in for less not reopening the betting.
    Uncalled bets are returned and side pots settled to the cent. The odd cent goes to the first winner in
    postflop order. Rake is taken in proportion, with a cap and no flop, no drop. The deal is seeded.
- **Solver client.** `play(state, {seat, hole, seed})` returns the opponent's move from `Advisor.play`. The worker
  gets its `play` field; the HTTP transport posts to `/play`. Practice at Fast uses Quick budgets, as classic does.
- **Practice page, `web/src/features/practice/`.** Full hands for 2 to 9 players and 10 to 250bb. Your seat moves
  one place each hand, starting at the button.
  - **Opponents:** each moves by `Advisor.play`, its size fitted to the table.
  - **Your options:** the solver's actions for your hand. Where your spot has no answer, the legal moves are offered,
    ungraded, and the page says why.
  - **Grading:** each decision is graded by `grade.ts`. It uses EV lost where every action has an EV; otherwise it
    goes by frequency and says "graded by how often the chart plays it". It shows the mix with your choice marked and
    the provenance label.
  - **The hand:** a hand log, the showdown said in a line ("Your Q-high flush beats SB's two pair…"), and a running
    score (net bb, share of good decisions, EV lost).
  - **Sessions:** saved to the `sessions` store (`putSession`, `recentSessions`); the last six are listed.
  - **Also on the page:** the grading thresholds, and a link to the classic trainer for what isn't ported.
- `PlayingCard.tsx`: cards in the theme's four-color deck.
- The Practice route renders the new page; `routes.ts` marks it "partial".

### Tests actually run

| Suite | Result |
|---|---|
| Web (Vitest) | 99/99 in 19 files. New files: `poker/evaluate.test.ts`, `poker/table.test.ts`, `features/practice/practice.test.ts`, `features/practice/PracticePage.test.tsx` (stubbed solver: a full heads-up hand, the ungraded fallback) and `solver/http-transport.test.ts`. `poker/table.test.ts` has the classic side-pot, rake, odd-cent and showdown cases, plus a seeded 10,000-hand chip-conservation fuzz (about 1 s). There are new cases in `client.test.ts`, `worker-transport.test.ts` and `db.test.ts` |
| Typecheck and ESLint | clean |
| `npm run build` | built (`index-b6DGF87z.js`) |

The solver suites were not run: no solver code changed.

### Checked in the browser (local production build, `vite preview`)

- Heads-up, worker transport, Fast:
  - preflop was graded by frequency and labeled "Preflop charts · approximate";
  - on the flop, a live solve answered with "Live solve · 0.20% pot from equilibrium in the solved game (converged) ·
    300 iterations" and the mix table, and the grade was "No EV given up";
  - hands ended as "You won 1bb" and "You folded · −2.5bb".
- 6-max: the opponents moved in order and your seat moved one place on "Next hand".
- At 375px there is no page-level horizontal scroll. There were no console errors.

### Not done in Phase 1

The drill modes and single-decision drills, multitabling, "Open in Study", chips carried from hand to hand, your own
sizes, antes and straddles, the "why" text, the opt-in 20-hand engine check, and the sessions history page.

### Precompute builds

Untouched. Read-only `ps` checks only. Memory stayed at 61–70% free; two of the build's worker processes were busy
throughout.

### Deploy of `4d3b353`, checked live

GitHub Actions run 41649237725 succeeded. The live bundle is `index-b6DGF87z.js`, the same as the local build.
`/lizard/`, `/lizard/practice/`, `/lizard/study/` and `/lizard/library/` returned 200.

On the live `/lizard/practice/`, a 6-max hand was dealt on load:
- the worker moved UTG, HJ and CO (CO opened 2.5bb);
- the BTN was offered the solver's raise, call and fold; fold was graded "Best" by the chart's frequency, under
  "Preflop charts · approximate";
- the log read "preflop: CO raises to 2.5, You fold".

The only console errors were Cloudflare's injected analytics beacon (`static.cloudflareinsights.com`), which the
page's CSP (`script-src 'self'`) blocks. It comes from the host, not the app. Allowing it would mean loosening the
CSP, which is the owner's call, so it was left as is.

## 2026-11-03: Phase 1, drills (second session)

### Code

- **Library entries in the page, `web/src/library/entry.ts`.** A typed port of classic `drills.js`: the format-2
  `.bin` decode (DecompressionStream), the suit-isomorphism classes, the hand order and `handWeights`.
  `web/src/library/files.ts` reads a library's index, a spot's `report.json` and `ranges.json` (fingerprint
  checked) and its entries. Each file is asked for with the version the index gives it, and the last 40 entries are
  kept.
- **Drill logic, `web/src/features/practice/drills.ts`.** From `drills.js` and `reports.js`:
  - the texture classes;
  - the three nodes (out of position first, in position after a check, out of position facing a bet);
  - the (flop, node) draws by weight, the hand drawn by range weight in a random suit relabelling;
  - the pot and bet, and the node as a Study URL;
  - the provenance of the stored solve: "Precomputed solution · <spot> · <expl>% … · <iters> iterations", with a new
    transport `"file"` (read in the page, no solver), which the badge's tooltip says.
- **Drills tab, `DrillsPanel.tsx`.** Practice now has "Full hands" and "Drills" tabs (`?tab=drills`). A hand under way
  is kept while you drill.
  - **Choosing a drill:** spot (the two-player spots of the library Settings picks), decision and texture filters,
    all in the URL. The page shows the spot's coverage and says when no flop stores the decision with that texture.
  - **Answering:** keys 1–9 answer and Enter or Space deals the next hand. The verdict, EV given up, the hand's mix
    and EVs, and the provenance badge are shown, with "Open in Study" to the same node.
  - **Sessions:** saved as `drill` sessions; earlier sessions of the same drill are listed.
- `VerdictTag` moved to `web/src/components/`.
- **Test fixtures.** The snapshot's library is git-ignored (315 MB), so CI couldn't read it. A 148 KB subset is
  committed in `web/src/test/fixtures/flop_library`: three spots and 13 flops, with entries and ranges byte for byte
  and the index and reports trimmed to those flops. `scripts/library/make_web_fixtures.py` regenerates it, and
  `src/test/library.ts` reads it. One extra check (every spot has draws for each drill) runs over the whole snapshot
  where it is on disk and is skipped in CI.

### Tests actually run

| Suite | Result |
|---|---|
| Web (Vitest) | 116/116 in 22 files (one skipped in CI: the whole-snapshot check). New: `library/entry.test.ts` (classic decode cases on the shipped entries: frequencies from the weighted strategy, iso classes, weights), `practice/drills.test.ts` (draws, texture filter, every shipped spot drillable, dealing by weight over 3,600 deals, pot, Study node, provenance label), `practice/DrillsPanel.test.tsx` (stubbed fetch over the shipped files: deal, grade, keys, the filter, no-flop message, session saved) and a tab test in `PracticePage.test.tsx` |
| Typecheck and ESLint | clean |
| `npm run build` | built (`index-0h6F-ScU.js`) |
| Library assembler (`scripts/library`) | OK |

### Checked in the browser (local production build, `vite preview`, library proxied from the live site)

- Lizard library, srp_btn_bb, BB facing a bet: J♠4♠ on A♥8♥6♥ facing a 75% bet. The "2" key called: Blunder,
  1.49bb or 15.4% of the 9.63bb pot, fold 100% at EV 0.00, under "Precomputed solution · srp_btn_bb · 0.11% pot from
  equilibrium in the solved game (converged) · 300 iterations".
- Enter dealt the next hand (about 1–2 s for a new entry over the proxy).
- "Open in Study" opened Study at the same node (Ac7s3d, BB facing 1.82), answered from the library. Study shows the
  pot as 7.5bb where the drill shows the library's 7.32bb; classic drills show the same 7.32bb.
- Heads-up srp_sb_bb_2max, SB after a check, at 375px: no horizontal scroll, no console errors. The engine stayed
  idle throughout the drills.

### Precompute builds

Untouched. Memory stayed at about 61% free.

### Next

- Commit, push and check the deploy of the drills.
- Then, as feasible at low CPU: Phase 4 range-builder grading and Phase 5 saved spots. The preflop Solver source
  (Phase 0) stays on request only.

### Deploy of `12e1a34`, checked live

- Pages run 41652080142 succeeded. `https://www.michael-han.com/lizard/practice/` returns 200 and serves
  `index-0h6F-ScU.js`, the bundle built and checked locally.
- `/lizard/practice/?tab=drills` in the browser: the Lizard library's 20 spots are listed; srp_btn_bb reports "1,755
  flops stored; 1,755 store this decision."; a hand dealt (Q♣9♣ on 8♠5♥2♠ facing a 75% bet) and the "2" key graded
  the call under "Precomputed solution · srp_btn_bb · 0.12% pot from equilibrium in the solved game (converged) · 300
  iterations".

## 2026-11-03: Phase 4, range-builder grading (second session)

### Code

- `web/src/features/ranges/build.ts`: the classic builder ported from `study.js:420-458` (`passiveOf`, `blankPaint`,
  `brush`, `scoreBuild`, `grade` at 90/80/65%, the six biggest differences), plus Lizard's own: `paintClasses`
  (skipping locked classes), `solutionPaint`, an undo history (`record` a step, `amend` within a drag, `undo`,
  `redo`), and `scoreByCombo`: the paint graded against each combo's own mix and EVs, with the score of the solver's
  class mixes painted exactly as the reference (what a class-level paint can't express; not claimed as the best
  class paint). It is null unless every class in the range has its combo rows.
- `web/src/features/study/BuildMode.tsx`: "✎ Build" in Study at any node with two or more actions, once the answer is
  complete (a partial answer would show its mix early). Brushes per action and a Lock tool, amounts 100/75/50/25%,
  click or drag painting (every hand on the path, in 6px steps, as classic), Fill all, Reset, Undo and Redo (buttons,
  Ctrl/Cmd+Z, Shift+Ctrl/Cmd+Z, Ctrl+Y; one step a stroke), keys 1–9 for brushes. "Check my range" gives the accuracy
  and grade, EV given up in bb a combo and % of the pot, the combo-by-combo line, each action's share both ways, a
  grid with the solver's mix above yours outlined by the difference, the biggest differences, and each hand compared.
  The score sits under the answer's ProvenanceBadge; chart answers say "Graded against the preflop charts: an
  approximation, not a solve", other approximate answers say so too. Each score is a session record (kind "build",
  `web/src/data/db.ts`; no migration, the kind index takes any string) and the last five at the node are listed.
- `StudyPage.tsx`: the Build toggle beside the views; while building, the action buttons stay (to play on) without
  their frequencies and EVs; what's painted is kept per node while Study moves on and back.

### Tests actually run

| Suite | Result |
|---|---|
| Web (Vitest) | 128/128 in 24 files (one skipped in CI). New: `ranges/build.test.ts` (the `study.test.js:244` cases exactly: acc 0.55, EV loss 9/16, gto [0.55, 0.2625, 0.1875], preflop 12/18; the solver's own mix 100% and an unplayed action 0%; locks; undo and redo to the exact weights; the combo score and its reference), `study/BuildMode.test.tsx` (brushes, keys, undo/redo, locks, a drag's path, the score and its provenance, saved and listed, chart answers, coming back to a node) and a Study toggle test |
| Typecheck and ESLint | clean |
| `npm run build` | built (`index-D3s809J_.js`) |
| Library assembler (`scripts/library`) | OK |

### Checked in the browser (local production build, `vite preview`, library proxied from the live site)

- srp_btn_bb, BTN after BB checks on Ac7s3d (library answer): the action buttons lost their frequencies while
  building; key 3 and one quick drag painted the whole top row bet 75%; "Check my range" gave 53.1% accurate · Off, EV
  given up 0.015bb a combo (0.27% of the pot), under "Precomputed solution · srp_btn_bb · 0.12% pot from equilibrium in
  the solved game (converged) · 300 iterations". Combo by combo the same 53.1% (for one-action paints the two are
  equal by construction); the solver's class mixes painted exactly score 73.3% that way. The score was listed under
  "Your ranges at this node".
- 375px: no horizontal scroll; the grid has `touch-action: none` while painting only. No console errors.
- Preflop UTG (charts): the score reads "Graded against the preflop charts: an approximation, not a solve." with no EV
  line.
- Fixed after this check: losses under 0.01bb in the biggest differences print to three decimals (they read
  "−0.00bb").

### Precompute builds

Untouched. Memory stayed at 61–65% free; every check ran under `nice`.

### Deploy of `e08734b`, checked live

- Pages run 41654692532 succeeded; `https://www.michael-han.com/lizard/study/` returns 200 and serves
  `index-D3s809J_.js`, the bundle built and checked locally.
- On the live site, srp_btn_bb BTN after a check on Ac7s3d: "✎ Build", then "Check my range" on the blank (all-check)
  paint gave 51.9% accurate · Off (the solver's check share, as it should be), EV given up 0.021bb a combo (0.38% of
  the pot), under the library answer's provenance; combo by combo 51.9%, the class mixes' own 73.3%.

### Next

- Phase 5 (saved spots: the `savedSpots` store exists in `db.ts` since version 1; Save spot in Study, a Saved
  page, backup and restore), as feasible at low CPU. Still open in Phase 4: painting by category, single combos, text
  import into the builder.

## 2026-11-03: Phase 5, saved spots, saved ranges and backup (second session)

### Code

- `web/src/data/db.ts`: database version 3 adds a `savedRanges` store (index `byUpdated`) and the `SavedRange` type;
  `SavedSpot` (store since version 1, unused until now) gains `line`, `note` and `seen` (the source and label of the
  answer seen when it was saved). The upgrade from version 2 keeps every record (`db.test.ts`).
- `web/src/data/saved.ts`: put, list (latest changed first), delete, look up a spot by its line, tags read from text,
  and the search (every word must match the name, tags, note or the line as shown).
- `web/src/features/study/SaveSpot.tsx`: "☆ Save spot" at the end of Study's line bar. The name defaults to the line
  ("BTN raise 2.5 · BB call · Ac7s3d · BB check"); tags and a note are optional. It stores the line (the Study URL
  encoding), the request (`studyRequest`) and the answer's provenance. A line is saved once: saving it again, or
  clicking twice quickly, updates that spot. The button reads "★ Saved" on a saved line.
- `web/src/features/saved/SavedPage.tsx`, route `/saved` (nav "Saved", status partial): saved spots with search,
  edit (name, tags, note), delete after a second click, and "Open in Study" at the line; saved ranges with "Open in
  Ranges" and delete; "Download backup" and "Restore from a file".
- `web/src/features/ranges/RangesPage.tsx`: "Save range" under a name (the same name updates it), "Open a saved
  range", and `/ranges?range=<id>`.
- `web/src/data/backup.ts`: one JSON file (format `lizard-backup`, schema 1) with saved spots, saved ranges and the
  session history, each record in the classic `store.js` shape `{id, v, created, updated, dev, data}` with a per-browser
  `dev` id. Restore merges as classic does: a record missing here is added, of two with one id the later `updated`
  stays, nothing here is deleted; damaged, deleted or foreign records are skipped and counted; a non-Lizard file or a
  newer schema is refused with a message. Settings are not in the backup.

### Tests actually run

| Suite | Result |
|---|---|
| Web (Vitest) | 140/140 in 26 files (one skipped in CI). New: `data/backup.test.ts` (lists, search, an exact round trip through the file's text in the classic record shape, the merge rules, damaged records and refused files, the file name), `features/saved/SavedPage.test.tsx` (list, search, edit, delete, "Open in Study" at the line with `studyRequest` equality, download and a merging restore, the empty states, saving and reopening a range), a Study test (save with name, tags, note and provenance; saving again keeps the id) and the version 2→3 upgrade in `db.test.ts` |
| Typecheck and ESLint | clean |
| `npm run build` | built (`index-C-mpoQNK.js`); postbuild wrote 11 route pages + 404.html, `saved` among them |

### Checked in the browser (local production build, `vite preview`, library proxied from the live site)

- Study, srp_btn_bb, BTN after BB checks on Ac7s3d: "☆ Save spot" proposed "BTN raise 2.5 · BB call · Ac7s3d · BB
  check" and showed the answer's source; saved with tags "srp, ace-high", then "★ Saved".
- `/lizard/saved` (its postbuild page) listed it with the tags, "6-max 100bb · BTN raise 2.5 · BB call · Ac7s3d · BB
  check" and "the answer then: Precomputed solution · srp_btn_bb · 0.12% pot from equilibrium in the solved game
  (converged) · 300 iterations". "Open in Study" opened the same line, marked "★ Saved".
- Ranges: "Save range" as "UTG open test" (226.0 combos), listed on the Saved page.
- Backup: the download was intercepted in the page (no file written to disk): `lizard-backup-2026-11-03.json` with 1
  spot, 1 range and 6 sessions. Restoring it with one extra spot gave "Restored: 1 added, 0 updated, 8 kept (as new
  or newer here). Nothing here was deleted."; the extra spot was then deleted from the list.

### Precompute builds

Untouched. Memory stayed at 57–65% free; every check ran under `nice`.

### Deploy of `5327328`, checked live, and a fix

- Pages run 41656535926 succeeded; `https://www.michael-han.com/lizard/saved/` returns 200 and serves
  `index-C-mpoQNK.js`, the bundle checked locally; Study shows "☆ Save spot" on the live site.
- Found live: the Saved page stayed at "…". The browser's `lizard` database was at version 2 and another
  connection (most likely a Lizard tab or page still running the previous bundle in the browser pane; the previous
  code never closes its connection) held it open, so this bundle's upgrade to version 3 waited forever and nothing
  that reads the database loaded. Any user with an old Lizard tab open would hit the same thing after this deploy.
- Fix (`web/src/data/db.ts`, `web/src/app/DbNotice.tsx`): the shared connection now closes itself when a newer tab
  asks to upgrade (`blocking`), and the page says what is happening in both cases: an older tab holding the data
  ("Close or reload that tab and this page carries on") or a newer tab that took it over ("Reload this page"). Tests:
  `app/DbNotice.test.tsx` (an older tab's connection: the notice, then the upgrade once it closes; a newer tab's
  upgrade: this tab closes, says so, and keeps nothing). Old tabs still running the version-2 code can't be fixed
  after the fact; the notice tells the user to close them.
- Deployed as `74eb296` (run 41657468459, `index-DSV4qKWd.js`); live, the Saved page still showed "…" and no notice:
  this tab's open was queued behind another context's own waiting upgrade, and a queued open hears no `blocked`
  event. So the notice now also shows when opening takes more than 3 seconds (`DB_WAIT_NOTICE_MS`); test
  `app/DbNotice.queued.test.tsx` (an old tab's connection, another tab's upgrade waiting on it, this tab's open
  queued behind: no event, the notice after 3 s, then the upgrade and this open once the old tab closes).

- Deployed as `bd3a6e2` (run 41658189382, `index-DNPusrrR.js`); live, the Saved page showed the notice ("Another
  Lizard tab (most likely one open since before an update) is holding this browser's saved data…"). The holder was
  this session's own earlier browser tab on the live drills page, still running `index-0h6F-ScU.js` (database
  version 2). Reloading that tab released it, and the waiting Saved page carried on by itself: the notice went and
  both lists loaded (0 saved). Diagnosis and fix confirmed end to end.

## 2026-11-03: Phase 3, flop reports (second session)

### Code

- `web/src/features/reports/reports.ts`: the classic `reports.js` pure parts ported (the three decisions: out of
  position first, in position after a check, out of position facing in position's most common bet; columns, rows,
  texture filter, sorting with ties broken high flop first, weighted averages over the flops that store the
  decision, groups), plus Lizard's: EQR (EV over equity times the pot, blank where equity is 0), sorting by EQR,
  coverage (stored flops and their share of the 22,100), the Study line at each row's decision, the report's
  provenance (the library's stored solves, read in the page from `report.json`; no convergence figure is claimed
  for the report itself, each flop's is in Study), and the CSV of the rows shown at the stored precision with a
  source column. The texture classes are the drills' (`features/practice/drills.ts`, already a port of the same
  code). `ReportFlop` gains its `ev` and `eq`.
- `web/src/features/reports/ReportsPage.tsx`, route `/reports` (status partial, was a classic link): the library
  chosen in Settings, spot, decision, texture filters and grouping, all in the URL; a provenance badge and the
  coverage line; the table (strategy bar, each action's share, both players' EV, equity and EQR; a group's row
  filters to it; every header sorts); "Download CSV"; "Which spots have reports". A report of more than 300 flops
  lists 300 until "Show all" (a re-sort of all 1,755 rows took about 250 ms; with 300, about 30 ms). A spot still
  being built says "All stored flops" on its average row.

### Tests actually run

| Suite | Result |
|---|---|
| Web (Vitest) | 156/156 in 30 files. New: `reports/reports.test.ts` (the classic `reports.test.js` cases: views and rows, filter, sort, weighted averages, groups; EQR and its sort; coverage; Study at each decision, the bet faced at its size; the CSV; every fixture spot's report, and every snapshot spot's when the snapshot is on disk), `reports/ReportsPage.test.tsx` (provenance and coverage, the columns, a row's EQR and Study link, view/group/filter/sort in the URL, 300-row listing and "Show all", the CSV of the rows shown, a library with no reports, an unreadable library) |
| Typecheck and ESLint | clean |
| `npm run build` | built; postbuild wrote 11 route pages + 404.html |

### Checked in the browser (local production build, `vite preview`, library proxied from the live site)

- srp_btn_bb: "Precomputed solution · srp_btn_bb · flop report over its 1755 stored flops", "1755 of 1,755 flops
  stored, standing for 100.0% of all 22,100". BB first: check 98.7% on average. BB vs bet grouped by pairing:
  unpaired 82.8%, paired 16.9%, trips 0.2% of flops (each group's share of the 22,100), the two EVs summing to the
  5.5bb pot. Sorting by Call, then the Study link of Tc7c6c (BB vs 33%: fold 32.7%, call 54.9%, raise 12.3%) opened
  Study at BB check, BTN bet 1.82 with fold 32.7%, call 54.9%, raise 12.4%, under the library's provenance.
- CSV: `lizard-report-srp_btn_bb-oop.csv`, all 1,755 flops (not only the 300 listed), the source on each line
  (the download was intercepted in the page, no file written).
- lp_sb_bb_2max (heads-up limped pot): 168 of 1,755 flops, 18.2% of all flops; its Study link is a heads-up line.
- 375px: no horizontal page scroll; the table scrolls in its box, equity and EQR columns hidden. No console errors.

### Precompute builds

Untouched. Memory stayed at 60–62% free; every check ran under `nice`.

### Deploy of `5f1b6e8`, checked live

Deploy run 41659523320 passed. `/lizard/reports/` serves `index-Bkq4RDGM.js` (CI's build). Opened
`/lizard/reports/?spot=srp_btn_bb&view=vsbet&group=pair` live: the same provenance line and coverage as the local
build, and the same averages (all flops fold 46.6%, call 41.5%, raise 12.0%; unpaired 82.8%, paired 16.9%, trips
0.2% of flops).

## 2026-11-03: Phase 2, the hand-history parser (second session)

### Code

- `web/src/hh/parse.ts`: `parseHandHistory` and `splitHands`, ported line for line from the classic
  `solver/gto/static/hh.js` (eight site families, iPoker's XML, tournaments, antes, straddles, run-it-twice,
  every warning and error message). Errors are a `HandHistoryError`. `HH_SITES` names the sites for the import box.
- `web/src/hh/replay.ts`: the classic `importHand` on Lizard's table engine: every seat its own stack, an all-in's
  stack set to what the history shows, and a warning with the place where the history and the table part ways.
- `web/src/poker/table.ts`: the straddle, as the classic page plays it (the first seat posts 2bb and acts last
  preflop; 3 or more players). The table engine had left it out.
- `scripts/hh/make_golden.mjs` writes `web/src/hh/golden/`: the classic parser's output for each of the 23
  fixtures and for the analyzer's two synthetic sessions (60 hands, seed 3; 50 hands, seed 11). Run with node; it
  needs no build.

### Tests actually run

| Suite | Result |
|---|---|
| Web (Vitest) | 192/192 in 32 files. New: `hh/parse.test.ts` (the golden files; 1,500 mutated histories give the classic parser's hand or its message, run against the snapshot's `hh.js`; the classic suite's parsed details, other sites, odd histories, errors, tournaments, seat names; `splitHands`), `hh/replay.test.ts` (the classic suite's 23 import cases: setup, every street's actions, the pot won; the short all-in; parting ways), a straddle case in `poker/table.test.ts` |
| Typecheck and ESLint | clean |

### Next

- Analyze (ROADMAP Phase 2; the hand-history
  parsers and the analyzer core are pure code, the grading of postflop decisions needs live solves and should
  start with preflop and library flops). Still open in Phase 5: saved drills, saved hands, the classic `gto-store`
  import, a backup prompt after N saves.

## 2026-11-03: Phase 2, Analyze's import (second session)

### Code

- `web/src/data/db.ts`: database v4 adds the `hands` store (by played, site, import, your seat and pot type) and the
  `decisions` store (by hand, verdict, street and seat; empty until grading lands). The upgrade keeps v3's data.
- `web/src/data/hands.ts`: hands kept once each (the classic key `site|number|cards`, so a hand in two imports is
  kept from the first), listed newest played first, an import deleted with its hands and their decisions.
- `web/src/features/analyze/analyze.ts`: the classic `session.js` core that grading doesn't need: hand numbers,
  `prepare` (what's skipped and why: not Hold'em, no hero, no decision of yours, already read, unreadable), your
  decisions, preflop situations and pot types; plus the played date per site, a hand's summary record, and a Study
  link at each of your decisions (none where Study can't set the hand up: an ante or a straddle).
- `web/src/features/analyze/AnalyzePage.tsx` at `/analyze`, replacing the placeholder: paste, pick files or a
  folder, or drop files; progress; what was read, kept and skipped, by file; the imports with a storage meter and
  delete; the hands table with seat, pot and site filters in the URL; a hand replayed street by street with its
  stacks, the pot and how it ended, and a Study link at each of your moves. It says it grades nothing yet.

### Tests actually run

| Suite | Result |
|---|---|
| Web (Vitest) | 206/206 in 35 files. New: `data/hands.test.ts`, the v3 → v4 upgrade in `data/db.test.ts`, `features/analyze/analyze.test.ts` (the classic session.test.js cases for splitting, hand numbers, `prepare`'s skips over every fixture and a 60-hand synthetic session, preflop situations; dates, summaries, Study links), `features/analyze/AnalyzePage.test.tsx` (paste, a re-paste kept once, filters in the URL, a hand replayed with its 4 Study links, files with a non-history skipped, an MTT hand with no Study links, the row limit, deleting an import, a missing hand) |
| Typecheck and ESLint | clean |
| Build | passes; one `index.html` per route |

### Checked in the browser (local build)

- 42 pasted hands (two fixtures and a 40-hand synthetic session) read in 110 ms: 41 kept, 1 skipped (a walk).
- The PokerStars SRP hand: the replay matches the history; its flop Study link opens Study at BB's check on
  Qs8d3c with "Precomputed solution · srp_btn_bb".
- The GG straddle hand replays to the end ("UTG straddles", pot 89.5bb, folded turn) and has no Study links.
- 375px: no page overflow (the table scrolls inside its box). No console errors.

### Precompute builds

Untouched. Memory stayed at 67–69% free; every check ran under `nice`.

### Deploy of `0a175f9`, checked live

Deploy run 41663657147 passed. `/lizard/analyze/` serves `index-BMtxQysJ.js`, the local build's bundle; the
browser's `lizard` database upgraded to v4 on opening it.

## 2026-11-03: Phase 2, grading imported decisions (second session)

### Code

- `web/src/features/analyze/grading.ts`: the classic analyzer's grading at the two scopes that solve nothing.
  Preflop against the charts (graded by frequency: the charts have no EVs, no EV lost is counted) and flops from the
  library (`library_only`: a flop it doesn't hold comes back "not a flop-library spot", never solved). The request
  is the classic page's `payload` (every seat's stack where they differ, the ante, the straddle); your move is
  matched as `gradeWith` does (the nearest size; a move the chart leaves out played 0%; a postflop all-in the answer
  has no all-in for asked again with `jam`); an all-in nobody can match is graded as the call (`gradedMove`). The
  grade is Lizard's one scale (`grading/grade.ts`, as Practice). Only a chart or library answer is graded; a
  rules or equity fallback is kept as not graded, with why. `gradeHands` runs the queue: hand after hand, each
  decision kept skipped, stops on a signal, a solver failure thrown with what was graded kept.
- `web/src/features/analyze/report.ts`: the classic report over the kept decisions: tallies, by street, preflop by
  situation, flop by spot, the `FREQS` table (its preflop and flop rows), `LEAK` thresholds and leaks with their
  decisions, the most EV lost, off the chart, why the rest aren't graded, CSV (the classic columns less triage and
  timing) and JSON.
- `web/src/features/analyze/GradingPanel.tsx`: the panel (scope, Grade / Stop, progress, Forget the grades) and the
  report; on the replayed hand each of your moves shows its grade, its title the answer's mix and provenance.
- `web/src/data/db.ts`: `DecisionRecord` gains the fields the report reads (situation, pot type, facing, position,
  role, the mix, the matched and most frequent actions, EV lost in % of the pot, a note, why not graded). No
  schema change. `data/hands.ts`: `listDecisions`, `clearDecisions`.

### Tests actually run

| Suite | Result |
|---|---|
| Web (Vitest) | 218/218 in 37 files. New: `features/analyze/grading.test.ts` (the request at each decision on the fixtures, ante and straddle; situations and role; all-in as a call; matching: same action, nearest size, a 0% move off the chart, the chart's raise for a jam, the library's sizes by EV; what's kept with its provenance; not graded: skipped, rules, error, cancelled; the jam asked again), `report.test.ts` (tallies, groups, frequencies, leaks at and under their thresholds, CSV quoting, JSON), a grading case in `AnalyzePage.test.tsx` (a stubbed solver: 9 decisions asked, the flops of the library only; grades on the hand with their titles; the report's summary, off-chart list and situation rows; asked again: nothing asked; Forget) |
| Typecheck and ESLint | clean |
| Build | passes |

### Checked in the browser (local build, the real worker)

- 41 kept hands, library scope: 64 decisions in about 10 s, the worker's boot included. 45 graded (42 preflop
  against the charts, 3 flops from `srp_btn_bb`, `srp_utg_bb`, `srp_sb_bb` with EVs and their provenance, e.g.
  "Precomputed solution · srp_btn_bb · 0.11% pot from equilibrium in the solved game (converged) · 300
  iterations"); 19 flops "not a flop-library spot". No console errors.
- Stop after 13 hands kept 22 decisions; Grade again asked only the other 42, and the report came out the same.
- The PokerStars hand shows Best on the preflop raise and the flop bet, their titles naming the charts (not a
  solve) and the library entry.
- CSV and JSON export intercepted in the page (no file written): 64 rows, the provenance in `source`.
- 375px: no page overflow.

### Precompute builds

Untouched. Memory stayed at 65–67% free; every check ran under `nice`.

### Next

- Turn and river grading: a live solve per decision (or the classic's Quick triage) through the same queue, in the
  user's browser; with a time estimate and the queue yielding to Study and Practice.
- Report filters (seat, pot type, EV lost) and "Drill this leak" (a drill set from a leak's decisions): the drill
  is done, see below.
- Still open in Phase 5: saved drills, saved hands from Practice, the classic `gto-store` import, a backup prompt.

### Deploy of `31a014f`, checked live

Deploy run 41666533441 passed. `/lizard/analyze/` serves the new bundle: its intro says preflop and flop decisions
can be graded against the charts and the library, turns and rivers not yet.

## 2026-11-03: Phase 2, "Drill this leak" (second session)

Phase 6's flow ends "create drill -> save and resume"; this is that step for the analyzer's leaks.

### Code

- `web/src/features/analyze/leakDrill.ts`: the leak in the URL (`?drill=pf:RFI`, `freq:…`, `spot:…`), the
  decisions to drill (graded ones whose mix is kept, in hands still kept; misses first, then the most EV lost, the
  rarest in the answer, the newest), the action before each decision, a pick graded on `grade.ts` against the kept
  mix (by EV where every action has one, else by frequency), and the progress as an `analysis` session
  (`leak-drill|<leak>`). Nothing is asked of the solver.
- `web/src/features/analyze/LeakDrillPanel.tsx`: the drill above the report: your seat, cards and board, the action
  before, your options; after a pick its grade, the answer's table, what you played in the hand and its grade, the
  provenance ("From the preflop charts, by frequency (not a solve)" or the library entry), "Open in Study" and
  "Open the hand". Score, Start over, Close. Each pick is saved; opening the leak again resumes.
- `GradingPanel.tsx`: "Drill this leak" on each leak; its link and the drill's hand link keep the page's other
  params (filters, the open hand). `data/db.ts`: `getSession`.

### Tests actually run

| Suite | Result |
|---|---|
| Web (Vitest) | 224/224 in 38 files. New: `features/analyze/leakDrill.test.ts` (the URL param, the order and what's left out, the action before on the fixture, a pick graded by EV and by frequency, the session round trip), a drill case in `AnalyzePage.test.tsx` (graded with the stubbed solver, the flop leak's drill from the URL: options, a Mistake losing 0.12bb (2.2% of the pot), the answer's table, provenance, Study and hand links keeping a filter; remounted: resumed with everything drilled; Start over; Close) |
| Typecheck and ESLint | clean |
| Build | passes |

### Checked in the browser (local build, the 41 graded hands)

- The report's two leaks (RFI 76% in the mix, Open (RFI)) each link to their drill; with `?pos=HJ` set the link
  keeps it.
- RFI drill: 21 decisions, misses first (HJ 8♦9♠, an open the charts fold: fold graded Best, the hand's raise shown
  as its Mistake, "From the preflop charts, by frequency (not a solve)"). The pick was saved as the
  `leak-drill|pf:RFI` session; after a reload the drill resumed at decision 2 of 21.
- "Open the hand" opens that hand with the drill kept. 375px: no page overflow. No console errors.

### Precompute builds

Untouched. Memory 65–66% free; every check ran under `nice`.

### Next

- Turn and river grading through the same queue (live solves or Quick triage, in the user's browser).
- Report filters (seat, pot type, EV lost) and a history across sessions.
- Phase 5: named drills and a drill list (the leak drills are kept as sessions already), saved hands from Practice,
  the classic `gto-store` import, a backup prompt.

### Deploy of `52504ea`, checked live

Deploy run 41668033216 passed. `/lizard/analyze/` serves `index-qpOxx8en.js`, the local build's bundle; the drill
opens from `?drill=pf:RFI` and, with nothing graded in that browser, says so.

## 2026-11-03: Phase 2/6, your stats as played and the hands filters (second session)

### Code

- `web/src/features/analyze/stats.ts`: each hand's moves read on the table engine as they stood (so an all-in counts
  as a raise only where it raises), and for each stat whether you had the chance and took it: VPIP, PFR, RFI (and
  your seat), 3-bet, squeeze, fold to 3-bet, 4-bet, flop c-bet, fold to flop c-bet, flop check-raise, turn and
  river barrels, went to showdown; your bets after the flop in % of the pot. `STATS` states each denominator.
  `tallyStats` (RFI by seat in seat order, bet sizes in six buckets, hands whose replay stopped left out),
  `wilson` (95% interval), `statsOf` (a chunk at a time, cached per hand, stops on a signal).
- `StatsPanel.tsx`: "Your stats" under the hands table: rate, chances, 95% range ("few" under 30), the hands behind
  each stat as links, bet sizes by street. Counted from the histories; it says nothing is graded or solved.
- `analyze.ts` `filterHands` / `HAND_FILTERS`: the table's filters gain stakes (the big blind as the history writes
  it) and the days played (from / to, the site's clock), and Clear filters; the report ("Over the N hands the
  filters show, of M kept"), the leak drill and the stats follow them. The table says when no hand matches.

### Tests actually run

| Suite | Result |
|---|---|
| Web (Vitest) | 230/230 in 39 files. New: `features/analyze/stats.test.ts` (each stat on seven fixtures: a limped check-raise, a cold 4-bet, a straddled c-bet size, a call of an all-in; the tally by seat and size; Wilson values; the chunked count, its cache and abort; every filter), a stats case in `AnalyzePage.test.tsx` (the four kept hands' rates, intervals and bet sizes; a stat's hands opening one; a seat filter on the stats and the report; stakes and a date to nothing; Clear filters) |
| Typecheck and ESLint | clean |
| Build | passes |

### Checked in the browser (local build, the 41 kept hands)

- Counted in about 50 ms. RFI 7 of 21 (33%) matches the grading report's "Open (RFI): you 33% (21 decisions)",
  counted by other code from the graded decisions.
- Your seat BTN: 8 hands, the report says "Over the 8 hands the filters show, of 41 kept"; RFI's hands list 3
  taken, 2 not, each opening the hand. `?bb=$1&from=2024-05-01`: 39 of 41, everything follows.
- 375px: no page overflow; the stats table scrolls in its box with the definitions readable. No console errors.

### Precompute builds

Untouched. Memory 59–66% free; every check ran under `nice`.

### Next

- Turn and river grading through the same queue (live solves or Quick triage, in the user's browser).
- Realized results (needs the parser to read what each seat collected; the parser is held to the classic one by
  golden files, so this is a change to both), EV-lost and tag filters, a history across sessions.
- Phase 5: named drills and a drill list, saved hands from Practice, the classic `gto-store` import, a backup prompt.

### Deploy of `d725f98`, checked live

Deploy run 41669655218 passed. `/lizard/analyze/` serves `index-Dty8SF63.js`, the local build's bundle, which holds
the stats, the drill and the new filters (that browser keeps no hands, so the table and stats don't show there).

## 2026-11-03: Phase 6, tags, notes and search on kept hands; hands and grades in the backup (second session)

### Code

- `data/db.ts`: `HandRecord` gains optional `tags`, `note`, `updatedAt` (no schema change, no new index).
  `data/hands.ts`: `putHandNotes` (empty ones removed; an import again leaves them, as it leaves the hand);
  `importsOf` counts the hands with your tags or note, and deleting an import says so on its button.
- `analyze.ts`: `HAND_FILTERS` gains `tag` and `q`; `handMatches` searches every word over the number, site, seat,
  cards, board, pot type, end, date, stakes, tournament, tags and note. The report, drill and stats follow them.
- `AnalyzePage.tsx`: "Add tags or a note" on the open hand (Tags, Note, Save, Cancel); the table shows each hand's
  tags and a "note" mark, a Tag filter when any hand has one, and a search box.
- `data/backup.ts`: `hands` and `decisions` join the backup in the same record shape (a hand's `updated` is its
  last note change, else its import), with their own checks (a damaged one is skipped). A backup from before has
  no such stores and restores as before. The Saved page says what the file holds and counts hands and grades.

### Tests actually run

| Suite | Result |
|---|---|
| Web (Vitest) | 233/233 in 39 files. New: `hands.test.ts` (notes kept, kept across an import again, counted per import, emptied, a missing hand), `backup.test.ts` (hands with notes and grades round-trip; a later note here kept, a later one in the file wins; a damaged hand skipped), the tag and search filters in `stats.test.ts`, a tags case in `AnalyzePage.test.tsx` (add, kept after a remount, Tag filter, search by the note's words and by stakes) and the delete button's count |
| Typecheck and ESLint | clean |
| Build | passes |

### Checked in the browser (local build, the 41 kept hands)

- Tagged the BTN 7♦4♣ open "loose open, review" with a note; the row shows them, the Tag filter lists both, the
  tag and a search on the note's words each find that one hand, and the stats say "the 1 hand the filters show".
- Saved page: Download backup intercepted in the page (no file written): 1 spot, 1 range, 7 sessions, 41 hands, 64
  graded decisions, 117 kB, the tagged hand with its tags, note and change time. Restoring that file: "0 added, 0
  updated, 114 kept". No console errors.

### Precompute builds

Untouched. Memory 58–59% free; every check ran under `nice`.

### Next

- Turn and river grading through the same queue (live solves or Quick triage, in the user's browser).
- Saved hands from Practice (the Saved hands row's last gap), named drills and a drill list, the classic
  `gto-store` import, a backup prompt.
- Realized results (needs the parser to read what each seat collected, with the classic parser), an EV-lost filter,
  a history across sessions.


### Deploy of `17b8314`, checked live

Deploy run 41670559221 passed. `/lizard/` serves `index-JerAHBaU.js`, the local build's bundle, which holds "Add
tags or a note", the hand search and the backup's graded-decision count.

## 2026-11-03: Phase 5/6, hands played in Practice kept in Analyze (second session)

### Code

- `features/practice/history.ts`: a finished Practice hand written as a hand history in PokerStars' layout under
  Lizard's own header ("Lizard Practice Hand #L<session start>-<hand>"), which the parser reads as a site it doesn't
  name. Seats named by position, you as "You"; a "Dealt to" line for every seat (so seats still to act after your
  fold are dealt in); each move as what it adds, a raise's size and total, "and is all-in"; the bet nobody called
  returned as the table returns it; the board only as far as it was dealt; opponents' cards only at a showdown they
  reached; who collected what (nothing after your fold, which ends the hand for you). `practiceRecord` keeps it under
  the site "Lizard Practice" (`PRACTICE_SITE` in `data/hands.ts`), stakes "1bb", one import per Practice session.
- `PracticePage.tsx`: at a hand's end, "Keep in Analyze" (then "Kept in Analyze · Open it there", linking to the
  hand) and "Keep every hand" (setting `keepHands`, off by default; ticking it keeps the hand on screen too).
- `AnalyzePage.tsx`: the hand's heading shows the kept record's site; a Practice hand says it was played in Practice.
- Analyze grades a kept Practice hand as an imported one (preflop charts, flop library). Practice's own grades from
  its live solves are not carried over (a follow-up: they'd be the only turn and river grades).
- `practice.ts` `studyOf`: each decision keeps the Study line where it was made; the last-decision panel links it
  ("Open this spot in Study →"). Checked in the browser: a BTN fold to UTG 2.5 / HJ 7.5 / CO fold opened Study at
  that line, BTN to act, on the preflop charts (labelled approximate).

### Tests actually run

| Suite | Result |
|---|---|
| Web (Vitest) | 239/239 (the Study link added to two cases in `PracticePage.test.tsx`) in 40 files. New: `features/practice/history.test.ts` (written and read back on the table engine, move by move: a single-raised pot to a showdown, your fold preflop and on the flop with no unshown card written, all folding to you with the uncalled bet, a jam and its call heads-up, a flop bet all-in, nine-handed names UTG/UTG1/UTG2), a keep case in `PracticePage.test.tsx` (the button, the link, the record; Keep every hand keeping the next hand as it ends) |
| Typecheck and ESLint | clean |
| Build | passes |

### Checked in the browser (local build)

- Folded the button to an HJ open, kept it: "Kept in Analyze · Open it there" opened Analyze on "Lizard Practice
  hand #L…-1", replayed (UTG folds, HJ raises to 2.5, CO folds, You fold; pot 4bb), its own import row, the Site
  filter listing "Lizard Practice". Grading it: the fold graded Best against the preflop charts.
- 375px: the row wraps, no page overflow. Ticking Keep every hand kept that hand; the next one (folded in the CO)
  was kept as it ended. The setting was turned back off. No console errors. Only preflop hands were played (chart
  answers), so no solve ran.

### Precompute builds

Untouched. Memory 53–68% free; every check ran under `nice`.

### Next

- Practice's own grades carried with a kept hand (its live solves: turn and river grades Analyze doesn't have yet).
- Turn and river grading in Analyze (live solves or Quick triage, in the user's browser).
- Named drills and a drill list, the classic `gto-store` import, a backup prompt.
- Realized results (needs the parser to read what each seat collected, with the classic parser), an EV-lost filter,
  a history across sessions.

### Deploy of `5bf8948`, checked live

Deploy run 41673252108 passed. `/lizard/` serves `index-DGeTYf8_.js`, which holds "Keep in Analyze", "Keep every
hand" and the "Lizard Practice" site.

### Deploy of `24625cf`, checked live

Deploy run 41673943784 passed. `/lizard/` serves `index-CQ8VwABi.js`, which holds "Open this spot in Study".

## 2026-11-03: Phase 5, Practice preflop only and your seat (second session)

### Code

- `practice.ts`: `newHand(…, opts)` takes `HandOptions`: `seat` ("moves", the default; "random", drawn from the
  hand's seed; or a seat, which a smaller table without it turns back into "moves") and `preflopOnly`. A preflop-only
  hand is over as the preflop closes with you and someone else in: `finish` gives `cut: true` (nothing settled, net
  0) and `shownCards` shows no opponent's cards. A walk or your fold ends it as before.
- `PracticePage.tsx`: the setup gains "Your seat" (Moves each hand, Random, each seat) and "Play" (Full hands,
  Preflop only), kept with the session (and its record's meta). Preflop only, the hand ends "You see the flop:
  preflop only, the hand stops here", and the session counts no net (the score strip and past sessions leave it out).
- `history.ts`: a preflop-only hand kept in Analyze ends its history with that line and is kept with end
  "preflop only"; its stats count VPIP, PFR, RFI and 3-bets, and no flop seen.

### Tests actually run

| Suite | Result |
|---|---|
| Web (Vitest) | 243/243 in 40 files. New: seat choices and the preflop-only stop with a walk in `practice.test.ts`; a preflop-only hand written and read back in `history.test.ts`; a preflop-only session from the big blind in `PracticePage.test.tsx` (stopped hand, face-down cards, no net, the seat kept) |
| Typecheck and ESLint | clean |
| Build | passes |

### Checked in the browser (local build)

- 6-max, Your seat BB, Preflop only: BTN raised, SB folded, you called; "You see the flop…", no board, BTN's cards
  face down, the score strip without Net. Next hand: BB again. Kept in Analyze: "Lizard Practice hand", end
  "preflop only", pot 5.5bb. No console errors. Preflop only: no solve ran.

### Precompute builds

Untouched. Memory 61–67% free; every check ran under `nice`.

## 2026-11-03: Phase 5, keys in full-hand Practice (second session)

Deploy of 03b3516 (preflop only and your seat) verified live: `index-C1Ixl2Oc.js`, which has "Your seat", "Preflop
only: the hand stopped" and "Open this spot in Study".

### Code

- `PracticePage.tsx` `FullHands`: a window keydown listener while the Full hands tab is shown (an `active` prop: the
  table stays mounted, hidden, while you drill, and its keys stop). 1–9 take your options (each button shows its
  number); once the hand is over, Enter or Space deal the next hand (unless a button or link has focus: those keys
  are its own) and K keeps it in Analyze (again after an error). Held keys, modifier keys and keys typed in a field
  are ignored. "Next hand" takes focus as a hand ends. The intro lists the keys, as the drills' does.

### Tests actually run

| Suite | Result |
|---|---|
| Web (Vitest) | 244/244 in 40 files. New in `PracticePage.test.tsx`: a heads-up hand played by keys (nothing on the Drills tab, from a held key or in a field; 9 with two options does nothing; K keeps; Enter deals the next hand) |
| Typecheck and ESLint | clean |
| Build | passes |

### Checked in the browser (local build)

- Heads-up, Preflop only: the options read "1 raise (3bb)", "2 call", "3 fold"; 2 called, the hand stopped and "Next
  hand" had focus; K kept it ("Open it there"); Enter dealt hand 2 in the big blind. No console errors, no solve ran.

### Precompute builds

Untouched. Memory 65% free; every check ran under `nice`.

## 2026-11-03: Phase 5, saved drills (second session)

Deploy of 1300026 (keys in full-hand Practice) verified live: `index-bDZEcHDK.js`, which has "K keeps it in Analyze".

### Code

- `data/db.ts`: migration 5, a `savedDrills` store (`SavedDrill`: id, name, kind "library" or "leak", `to` (the
  drill's page and search), `about`, note, times; index `byUpdated`). A drill is its page's URL, so a saved drill is
  that link under a name.
- `data/saved.ts`: `putDrill`, `listDrills`, `deleteDrill`, `drillAt` (one record per link: saving again updates it),
  `isDrillLink` (only `/practice?tab=drills…` or `/analyze?drill=…`).
- `data/backup.ts`: `savedDrills` in the backup; a restored drill whose link isn't a drill page's is skipped.
- `features/saved/SaveDrill.tsx`: "☆ Save drill" / "★ Saved drill", a name (the drill's description by default) and
  a note. In `DrillsPanel.tsx` (spot named, decision, texture; next to the drill's form, not inside it) and in
  `LeakDrillPanel.tsx` (`leakDrill.ts` `leakDrillLink`/`leakDrillAbout`: the leak and the hands' filters, nothing
  else of the page).
- `SavedPage.tsx`: a Drills section (kind, description, note, "Open in Practice"/"Open in Analyze", Edit, Delete);
  the backup message counts drills.
- A saved leak drill is dealt from your graded decisions as they are when opened (not a frozen set, as classic's
  40-spot set is), and its progress is the leak's session, as before.

### Tests actually run

| Suite | Result |
|---|---|
| Web (Vitest) | 249/249 in 40 files. New: the v4→v5 upgrade (`db.test.ts`); saved drills listed, found by link, deleted, links checked, round-tripped and a bad link skipped in the backup (`backup.test.ts`); the leak link and its description (`leakDrill.test.ts`); Save drill in the drills panel and in a leak drill (`DrillsPanel.test.tsx`, `AnalyzePage.test.tsx`); the Saved page's drills (`SavedPage.test.tsx`) |
| Typecheck and ESLint | clean |
| Build | passes |

One flaky step found and fixed: the Save drill button is disabled until its lookup answers; the tests wait for it.

### Checked in the browser (local build)

- The preview's database (version 4, with kept hands and a saved spot and range) upgraded to 5 on load.
- `/practice?tab=drills&spot=srp_btn_bb&view=vsbet&suits=mono`: Save drill named "BTN vs BB single-raised pot · BB
  checks, faces a bet · Monotone", saved, "★ Saved drill". Saved lists it as a library drill; "Open in Practice"
  opened the same spot, decision and texture. No console errors; no solve ran.
- Not checked in the browser: saving a leak drill (the preview has no graded leak); covered by `AnalyzePage.test.tsx`.

### Precompute builds

Untouched. Memory 64% free; every check ran under `nice`.

## 2026-11-03: Phase 5, the backup reminder (second session)

Deploy of 419a11d (saved drills) verified live: `index-CIAaXk7U.js`, which has "Save drill", `savedDrills` and "Open
in Practice".

### Code

- `data/backupNudge.ts`: a count in kv (`backupNudge`: saves, last backup, the count when put off), changed in one
  readwrite transaction so saves at once all count. `putSpot`, `putRange`, `putDrill`, `addHands` (new hands only)
  and `putHandNotes` count; a restore doesn't. `nudgeDue`: 10 saves (`NUDGE.first`), or 25 more after "Not now".
- `features/saved/backupFile.ts` `downloadBackup`: the Saved page's download, moved out to be shared; it starts the
  count again.
- `app/BackupNudge.tsx` (in `Shell` under `DbNotice`): "N saves since your last backup (date)… kept in this browser
  only, and a browser can clear a site's data" with "Download a backup", "Not now" and a link to Backup and restore.
  Not on the Saved page, whose backup panel now says "Last backup made here <date>; N saves since" (or "No backup made
  in this browser yet; N saves counted so far").
- This is the ROADMAP's Phase 5 risk "Storage eviction on phones. Prompt for backup after a number of saves."

### Tests actually run

| Suite | Result |
|---|---|
| Web (Vitest) | 253/253 in 42 files. New: `backupNudge.test.ts` (each kind of save counted, new hands only; the thresholds, put off, reset by a backup; saves at once), `BackupNudge.test.tsx` (shown past 10, Not now, back after 25 more, Download a backup ends it; not on Saved); the Saved page's last-backup line |
| Typecheck and ESLint | clean |
| Build | passes |

### Checked in the browser (local build)

- With the count set to 12 in the preview's kv: the line under the header on Study; "Not now" hid it (kv
  `{saves: 12, snoozedAt: 12}`); at 40 it came back. At 375px it wraps, no horizontal scroll. No console errors.
  "Download a backup" was not clicked in the browser (a download); the tests cover it with the anchor stubbed. The
  preview's kv key was deleted afterwards.

### Precompute builds

Untouched. Memory 61% free; every check ran under `nice`.

## 2026-11-03: Phase 5, import from the classic app (second session)

Deploy of 91e26bd (the backup reminder) verified live: `index-BSiXqKWJ.js`, which has "Backup reminder",
`backupNudge` and "counted so far".

### Code

- `features/analyze/classic.ts`:
  - `readClassicHands` opens IndexedDB `gto-store` at the version it has. An open that would create it is aborted,
    as the classic store's own `readOldDb` does, so a browser without classic data gets no new database.
  - It reads `hands` in a readonly transaction and drops tombstones. Where there's no IndexedDB it falls back to
    localStorage `gto-store:hands`.
  - `classicRecords` turns each record into Analyze's hand:
    - A history the classic app imported (`hh`) goes through Lizard's importer unchanged. It becomes the same record
      as that history imported here.
    - A hand entered or played on the classic table (`state`: seats, hero, stacks per seat, cards, each street's
      moves) is converted by `classicHand` to Practice's hand. It is written as a history under the site "Classic
      app", numbered `C<hash of the record id>` (so a second import adds only what's new), and replayed.
    - Your tags and note come along; the classic grades don't.
    - Left out, counted with why:
      - an ante or a straddle;
      - a tournament's prizes or bounties;
      - no hole cards, or a card twice;
      - a move it can't read;
      - a street's moves without its cards;
      - no decision of yours;
      - a hand that doesn't replay on Lizard's table.
- `features/practice/history.ts`: `handHistory(hand, {site, number, at}, setup)`. Practice's writer is shared, with
  each seat's own stack.
- `AnalyzePage.tsx`:
  - The import panel has "Used the classic app in this browser? Import its My hands" (read only, said so).
  - Its result line reads "From the classic app (IndexedDB): N hands read; N imported, N already here; left out:
    why (k)", or "The classic app keeps no hands in this browser."
  - The replayed hand says "A hand from the classic app's My hands".
- Classic settings are not imported yet. Only the speed (`gto-speed`) has a Lizard counterpart; four colours,
  sound, layout, opponents, stakes and Study's own state have none.

### Tests actually run

**Web (Vitest): 258/258 in 43 files.** New:
- `classic.test.ts`, on a fixture `gto-store` built as `store.js` makes it (version 1, five stores, meta and kv):
  - the database is the same after reading, version included;
  - a missing database isn't created;
  - the localStorage fallback is read;
  - a table hand's fields, tags, note and written lines; a heads-up 30bb stack, all in;
  - an imported `hh` equal to the same history imported here;
  - the same ids on a second import;
  - each skip.
- `AnalyzePage.test.tsx`:
  - none kept;
  - then one table hand imported and one left out;
  - the hand replayed with its tag, note and the classic line;
  - a second import adds nothing;
  - the classic hands as they were.

**Typecheck and ESLint:** clean. **Build:** passes.

### Checked in the browser (local build)

- No `gto-store` on localhost: "The classic app keeps no hands in this browser." No database was created.
- A fixture `gto-store` (one table hand, one with an ante):
  - "2 hands read; 1 hand imported; left out: an ante or a straddle (not imported yet) (1)".
  - The hand was listed as "Classic app", SRP, 5.5bb, with its tag and note, and replayed street by street with
    its Study links.
  - The classic database was still version 1 with its two records unchanged.
- No console errors.
- Afterwards: the import was deleted (back to 46 hands), and the fixture database and the save it counted were
  removed.

### Precompute builds

Untouched. Memory 64% free; every check ran under `nice`.

## 2026-11-03: Phase 5, the classic speed; a hand panel crash in Chrome fixed (second session)

Deploy of 7a0dd19 (the classic import) verified live: `index-D21CWTQB.js`, which has "Import its My hands", "The
classic app keeps no hands" and "A hand from the classic app".

### Code

- `features/analyze/classic.ts` `readClassicSpeed`: the classic app's kv record `gto-speed` ("quick", "fast",
  "accurate"; the classic default Fast is not saved), read as the hands are (the database opened at its own version,
  never created; a readonly `get`), or else its localStorage mirror `gto-speed`. Any other value counts as none.
- `SettingsPage.tsx`: under Solve accuracy, "Used the classic app in this browser? Use its speed (read only…)". It
  sets the solve mode and says "Set to Accurate, the classic app's speed.", or "The classic app has no speed saved in
  this browser." The classic app's other settings (four colours, sound, layout, opponents, stakes, Study's own state)
  have no counterpart in Lizard. This closes the classic import in ROADMAP Phase 5.
- **Fix** (`AnalyzePage.tsx` `HandDetail`): the effect that scrolls an opened hand into view returned
  `scrollIntoView(...)`. Chrome's `scrollIntoView` now returns a promise, so React took that promise for the
  effect's cleanup and called it. The page threw "TypeError: l is not a function" whenever the hand panel went away
  or showed another hand: switching hands, closing one, deleting its import. Found in this session's browser check;
  the source map pointed at `commitPassiveUnmountEffectsInsideOfDeletedTree`. The effect now returns nothing. The
  bug dates from 0a175f9, the first Analyze commit.

### Tests actually run

| Suite | Result |
|---|---|
| Web (Vitest) | 261/261 in 44 files. New: `classic.test.ts` (the speed from kv over localStorage, the database the same after; localStorage alone; an unknown value or none is null; no database created), `SettingsPage.test.tsx` (none saved: nothing changed, no database created; the fixture's "accurate" set and checked), `AnalyzePage.test.tsx` (with `scrollIntoView` returning a promise: two hands opened in turn and closed, no error; it fails without the fix) |
| Typecheck and ESLint | clean |
| Build | passes |

### Checked in the browser (local build)

- Settings, no classic data:
  - "The classic app has no speed saved in this browser."
  - Still Fast.
  - No database created.
- Settings, with localStorage `gto-speed` set to "accurate":
  - "Set to Accurate, the classic app's speed."
  - Accurate checked.
  - Afterwards the key was removed and Fast picked again; kv `settings.v1` was back to `mode: "fast"`.
- Analyze: a classic fixture hand imported, opened, then its import deleted.
  - Before the fix: the error above.
  - After the fix: no error. The panel says "That hand isn't kept in this browser", and the count is back to 46.
  - Afterwards the fixture database and the two saves it counted were removed.

### Precompute builds

Untouched. Memory 64–68% free; every check ran under `nice`.

## 2026-11-03: Phase 6, the Solve page: a spot of your own, opened in Study (second session)

Deploy of df99731 (the classic speed and the hand panel fix) verified live: `index-DtjDpA2u.js`, which has "Use its
speed", "has no speed saved" and "the classic app's speed".

### Code

- `features/solve/setup.ts` (new): `SpotSetup`, a spot's settings on top of Study's table (players, one stack, the
  line), each one a key the engine already reads (`solver/gto/advisor.py`, `Advisor._advise`):
  - `stacks` (each seat's own stack, bb), `sizes` (`flop`, `turn`, `river`, `raise`: % of the pot), `rake` (sent as a
    fraction) and `rake_cap` (bb), `ante` (bb a seat), `straddle`, `ranges` (PIO text by seat, entering the flop).
  - `setupProblems` checks it before any request, in words: at most 3 sizes a street (the engine allows 5 in Study;
    each one multiplies the tree a browser solves), 5–500% of the pot, rake 0–25%, a positive cap, ante 0–1bb, a
    straddle only with 3 or more players, seats that exist at this table, stacks 1–1000bb, ranges the parser reads
    (single combos like `AhKh:0.5` too) and not empty.
  - In Study's URL each setting has its own parameter after the line's (`stacks=BTN:40,BB:120`, `sz.flop=33,75`,
    `rake=5`, `cap=3`, `ante=0.1`, `straddle=1`, `rg.BB=…`), so a link with none reads as before.
  - `describeSetup`: the setup in a few words each ("stacks BB 40bb", "flop bets 33%, 75%", "rake 5%, capped at 3bb").
- `features/solve/SolvePage.tsx` (new), at `/solve`, replacing the placeholder that linked to the classic app:
  - Table: players, the table's stack, ante, straddle (off under 3 players).
  - Seats: each seat's stack and range, typed or picked from the ranges saved in Ranges.
  - Bet sizes for the flop, turn and river, and raise sizes; rake and its cap.
  - Problems listed as you type ("Setup problems"); "Open in Study" is off while there are any. It opens the spot at
    the first decision, or at the line it came from ("Edit setup" in Study brings the line along), and "Clear the
    setup".
  - Says what it doesn't do yet: node locks and automatic sizing (with a link to the classic app).
- `studyState.ts`: `StudyHand.setup`; `studyRequest` adds the setup's keys; the URL reads and writes them.
- `StudyPage.tsx`: above the line, "Your setup: … [Edit setup]" or "Standard setup (the engine's sizes, no rake or
  ante, the charts' ranges). [Set up your own]". A setup that fails the checks (a hand-edited link) is never asked:
  "This setup can't be solved: …". Reset keeps the setup.
- The Saved page's spot summary includes the setup; the route list grades Solve "partial".

The preflop part of every spot is still the charts (labelled as such); ranges set here enter on the flop only.

### Tests actually run

| Suite | Result |
|---|---|
| Web (Vitest) | 270/270 in 46 files. New: `setup.test.ts` (each key mapped to the engine's, the URL round trip, every refusal, the description), `SolvePage.test.tsx` (a setup opened in Study with its URL; problems shown and the button off; a saved range picked), `StudyPage.test.tsx` (the request carries the setup's keys; the setup line and its Edit link; Reset keeps the setup; a bad link shows the refusal and asks nothing; a standard spot offers a setup of your own) |
| Typecheck and ESLint | clean |
| Build | passes |

### Checked in the browser (local build, the in-browser solver)

- Heads-up flop, BB 40bb, flop bets 33% and 75%, a typed BB range, 5% rake capped at 3bb:
  - "Live solve · 0.11% pot from equilibrium in the solved game (converged) · 300 iterations"; check 28.8% (EV
    2.20), bet 33% 64.4% (2.61), bet 75% 6.8% (3.20).
  - The engine's note: the range entering the flop is the custom one (423 combos), not the preflop chart's.
- The same spot without rake: 0.12% (converged); check 26.8% (2.43), bet 33% 67.9% (2.96), bet 75% 5.3% (3.57). The
  rake reaches the solve.
- Each solve took under 10 s. "Edit setup" filled the form with the spot's settings.
- A hand-edited link (rake=40, four flop sizes): the refusal, and the engine stayed idle.
- At 375px the seats table overflowed (the range field was too wide); narrowed, it fits.
- No console errors.

### Precompute builds

Untouched. Memory 64–69% free; every check ran under `nice`.

### Next

- Phase 6, still open: node locks (per hand, through `advise`: Study drops `locks`), automatic sizing (likewise
  dropped in Study), measured solve times per mode, and the local server option (it needs a declared patch for an
  origin allowlist and a token first).
- Analyze and Practice could open their Study links with the hand's own stacks, ante and straddle via the setup
  (done next, below).

## 2026-11-03: Phase 6, Study links from a hand carry its ante, straddle and stacks (second session)

Deploy of a4eb223 (the Solve page) verified live: run 41682388529 passed, `/lizard/` serves `index-BwGpUB3u.js`, which
has "Edit setup", "Set up your own", "Spot setup" and "This setup can't be solved".

### Code

- `features/solve/setup.ts` `gameSetup(players, ante, straddle)`: a game's ante and straddle as a setup, or null
  where a setup can't hold them (an ante over 1bb a seat).
- `features/analyze/analyze.ts` `studyHandAt`: a hand's Study link now carries its ante and straddle, and the own
  stacks of the seats still in at that decision (the table stays at the effective stack; folded seats are left out,
  their stacks change nothing). Before, a hand with an ante or a straddle had no Study links at all, and every seat
  played the effective stack. A seat outside a setup's 1–1000bb leaves every seat at the effective stack, as before.
  Only an ante over 1bb a seat still has no link.
- `AnalyzePage.tsx`: the old note "Study can't set up this hand's ante or straddle" is now said only for an ante over
  1bb; a tournament hand says "A tournament hand: Study answers it in chips, with no ICM or bounties." (Most
  tournament hands have antes, so they open in Study for the first time.)
- Reports (`reports.ts`) and Practice's drills (`drills.ts`): a library spot with an ante or a straddle would open
  Study with it as the setup (no library spot has one today).

### Tests actually run

| Suite | Result |
|---|---|
| Web (Vitest) | 271/271 in 46 files. Changed: `analyze.test.ts` (the MTT hand's ante and the seats still in at the preflop and turn decisions; the straddle hand's link and its round trip; a 3-bet pot's deeper BB; equal stacks give no setup; a 1250bb seat falls back to the effective stack; a 1.5bb ante gives no link), `AnalyzePage.test.tsx` (the tournament hand opens in Study with its ante and stacks, and says it's answered in chips), `drills.test.ts`, `reports.test.ts`, `setup.test.ts` (`gameSetup`) |
| Typecheck and ESLint | clean |
| Build | passes |

### Checked in the browser (local build, the in-browser solver)

- The MTT hand's preflop link (9-handed, 80bb, 0.1bb ante, four seats' own stacks): "Your setup: stacks LJ 100bb,
  BTN 136.73bb, SB 41.67bb, BB 83.67bb · ante 0.1bb", pot 4.6bb (the antes counted), "Preflop charts ·
  approximate", the engine's note "the 80bb, 0.1bb ante, 9-handed chart".
- The kept GG straddle hand: its Study links now exist. Preflop: pot 10.5bb, "the 100bb, straddled chart". Flop
  (8c4d2s, BB 124bb against CO 100bb): pot 54.5bb, "Live solve · 0.01% pot from equilibrium in the solved game
  (converged) · 300 iterations".
- A deeper seat doesn't move a flop off the library: srp_btn_bb on Qs8d3c read "Precomputed solution · srp_btn_bb ·
  0.11% … (converged)" both without stacks and with BB at 120bb (the engine picks the library by the effective stack
  of the two players in the pot).
- No console errors from this build.

### Precompute builds

Untouched. Memory 70% free; every check ran under `nice`.

### Next

- Phase 6, still open: node locks and automatic sizing (per hand; Study drops both), solve times measured per mode,
  the local server option (after its patch).
- Practice: carried-over chips, an ante or straddle setting (its table engine has them), sizes of your own.

## 2026-11-03: Phase 7, the Tournaments page: a tournament spot, answered in prize equity in Study (second session)

Deploy of e6c7720 (Study links from a hand) verified live: run 41683851903 passed, `/lizard/` serves
`index-DnIc9QVf.js`.

### Code

- `features/tournaments/tournament.ts` (new): a tournament's setup (`TournamentSetup`: the payouts left, the players at
  other tables and their average stack, KO, PKO or mystery bounties), its checks (`tournamentProblems`: positive
  payouts, at most 200 places, a whole number of other players 0–10000 at 1–1000bb, the bounty format and amounts,
  bounties only for seats at the table, other tables only with payouts or bounties), the engine's keys
  (`tournamentRequest`: `payouts`, `field` as `{players, chips}`, `bounties` with every seat's bounty for KO/PKO, or
  `{format, envelope}` / `{format, pool, left}` for mystery), its URL params (`pay`, `fld`, `bty`, `bty.each`,
  `bty.field`, `bs.<seat>`, `bty.env`, `bty.pool`, `bty.left`), `describeTournament` for "Your setup: …",
  `parsePayouts`, and three generic payout shapes of Lizard's own (winner takes all, 50/30/20, a 9-paid final table).
- `features/solve/setup.ts`: a setup carries `tournament`; a tournament with rake is refused ("a tournament has no
  rake"); `setupRequest(s, players)` adds the tournament keys.
- `features/solve/SolvePage.tsx`: `kind="tournament"` is the Tournaments page (`/tournaments`, replacing the classic
  placeholder; `ClassicFeaturePage.tsx` removed): a Tournament fieldset (payouts and shapes, other tables, bounties),
  a Bounty column per seat for KO/PKO, no Rake fieldset. Fieldsets now shrink (`min-w-0`), so the seats table scrolls
  inside its box at 375px instead of widening the page.
- `solver/provenance.ts` `tournamentModelOf`: every tournament answer's badge names its model: "prize-equity solve
  (ICM)", "prize-equity solve (winner takes all: chips are prizes)", "chip-EV solve with bounties (no payouts given:
  …)", "push/fold equilibrium in prize equity", "a call priced in prize equity", "chip chart with a risk premium"
  (the last two followed by "approximate", as every chart answer), "a tournament, but the fallback plays chips", plus
  "KO/PKO bounties, proportional model" or "mystery bounties at the average envelope".
- `features/study/TournamentPanel.tsx` (new): the answer's prize equity, the bubble factor against each opponent, what
  busting each covered opponent still in the hand is worth, and who covers the player to act (folded seats left out,
  as the engine's own note does); says whether EVs are prize equity or chips.
- `StudyPage.tsx`: the panel, "Edit setup" back to `/tournaments` for a tournament, and the standard setup's text
  links to the Tournaments page.

### Tests actually run

| Suite | Result |
|---|---|
| Web (Vitest) | 281/281 in 48 files. New: `tournament.test.ts` (keys, checks, URL round trip, describe, payouts parsing and shapes), `TournamentPanel.test.tsx` (a short stack that covers nobody, winner takes all, no payouts). Changed: `provenance.test.ts` (each model label), `SolvePage.test.tsx` (the Tournaments form to its Study link; mystery prefill and its check), `StudyPage.test.tsx` (a tournament's request keys and no rake, the badge's model label through `provenanceOf`, the panel, Edit setup), `setup.test.ts` |
| Typecheck and ESLint | clean |
| Build | passes |

### Checked in the browser (local build, the in-browser solver)

- `/tournaments`, Top 3, table 25bb, CO 8bb: Study opens with "Your setup: stacks CO 8bb · payouts 50/30/20. Edit
  setup". UTG preflop: "Preflop charts · chip chart with a risk premium · approximate", prize equity 18.6%, bubble
  factors 1.48 against the 25bb stacks and 1.09 against CO; the engine's note "raises 19% of hands instead of the
  chart's 19% … a 1.6% risk premium".
- The same spot, BTN opens and BB calls, flop Kd7c2h: "Live solve · prize-equity solve (ICM) · 0.04% pot from
  equilibrium in the solved game (converged) · 300 iterations".
- KO bounties (10 each, CO 20), 20bb table, CO 8bb after two folds: "Preflop charts · push/fold equilibrium in prize
  equity, KO bounties, proportional model · approximate"; the panel says CO covers nobody and is covered by BTN, SB,
  BB (UTG and HJ folded), as the engine's note does. Edit setup goes back to `/tournaments` with the bounties.
- 375px: `/tournaments`, `/solve` with 9 seats, and Study with the panel fit the width (the seats table was 49px too
  wide before `min-w-0`).
- No console errors from this build.
- Engine probe beforehand (`.venv/bin/python`, `Advisor.study`, under `nice`): an 8bb CO open with payouts gives the
  push/fold note; at 40bb the chart with a risk premium; mystery bounties a bounties block; a flop with payouts a
  live solve (158 iterations, 0.29%) whose EVs differ from the chip solve's.

### Precompute builds

Untouched (read-only `ps`: `guarded_build.sh` and its Python still running). Memory 65–70% free; every check ran under
`nice`.

### Next

- Phase 7, still open: ICM vs chipEV side by side (ahead of Phase 8), the bubble factor table for every pair, satellite
  tests and a preset, a 15%-paid curve preset, a note when a large field is compressed onto the 12-player model, and
  tournaments in Practice and Analyze (a tournament hand is still answered in chips there).
- Phase 6, still open: node locks and automatic sizing (per hand), solve times measured per mode, the local server
  option (after its patch).

## 2026-11-03: Phase 7, ICM against chip EV in Study, and a large field named on the badge (second session)

Deploy of 96ac847 (the Tournaments page) verified live: run 41687036134 passed, `/lizard/` serves
`index-DlWWwouS.js`, which has "Players at other tables", "Final table, 9 paid", "prize-equity solve (ICM)" and
"Prize equity:".

### Code

- `features/study/ChipCompare.tsx` (new): under a finished tournament answer in Study, "Compare with chip EV" asks the
  same node with the tournament taken out of the setup (`chipHand`: the same stacks, ante, straddle and line; no
  payouts, other tables or bounties) and shows both answers' actions over the whole range side by side (frequency and
  EV, in the EV unit set), each with its own provenance badge. Asked only on request, after the main answer is
  complete (the solver client queues one solve at a time); keyed to the node, so it resets when the node changes; Stop
  aborts it.
- `solver/provenance.ts` `tournamentModelOf`: when the engine models a field over 12 players by stand-ins
  (`icm.field_stacks`, `compress_payouts`), its note says "(54 players modelled by 12)", and the badge now says so
  too ("prize-equity solve (ICM), 54 players modelled by 12").

### Tests actually run

| Suite | Result |
|---|---|
| Web (Vitest) | 282/282 in 48 files. New: `StudyPage.test.tsx` "asks the same tournament spot in chips on request…" (the comparison's request keeps players, stack, stacks and ante and has no payouts, field, bounties or rake; the table's rows; both badges); the stub can answer per request (`answerFor`). Changed: `provenance.test.ts` (the modelled field) |
| Typecheck and ESLint | clean |
| Build | passes |
| Engine probe | 6 seats at 25bb, 48 at other tables averaging 30bb, the 9-paid shape: the note reads "tournament: ICM (54 players modelled by 12), UTG's prize equity 1.7% …" (`.venv/bin/python`, `Advisor.study`, preflop only, under `nice`) |

### Checked in the browser (local build, the in-browser solver)

- Flop Kd7c2h, BTN against BB, 25bb with CO 8bb, payouts 50/30/20: BB checks 100% in both; EV 1.09 in prize equity
  against 1.48 in chips. Badges: "Live solve · prize-equity solve (ICM) · 0.04% … (converged) · 300 iterations" and
  "Live solve · 0.03% … (converged) · 300 iterations".
- Preflop, CO 8bb after two folds: all-in 25.9% in prize equity ("Preflop charts · push/fold equilibrium in prize
  equity · approximate") against 29.2% in chips ("Preflop charts · approximate").
- 375px: Study with the comparison open fits the width. No console errors from this build.

### Precompute builds

Untouched (read-only `ps`). Memory 65–69% free; every check ran under `nice`.

### Next

- Phase 7, still open: the bubble factor table for every pair, satellite tests and a preset, a 15%-paid curve preset,
  a per-hand ICM vs chip diff, tournaments in Practice and Analyze.
- Phase 6, still open: node locks and automatic sizing (per hand), solve times measured per mode, the local server
  option (after its patch).

## 2026-11-03: Phase 7, satellites: engine checks, a payout shape, and null bubble factors said plainly (second session)

Deploy of edf4404 (ICM against chip EV) verified live: run 41687842653 passed, `/lizard/` serves `index-Bset5aqE.js`,
which has "Compare with chip EV" and "players modelled by".

### Code

- `scripts/engine/test_tournament.py` (new; `npm run test:engine`, and a CI step in `deploy.yml`): Lizard's own checks
  of what it reads from the engine's tournament answer, on the engine itself (the prize model through
  `advisor._tournament` and `_tournament_info`; no solve, 0.03s): the note's wording for ICM, winner-takes-all with
  bounties, no payouts with bounties, and a field modelled by stand-ins; one prize and no bounties is no tournament.
  Satellites (the engine has no tests for them): 5 equal seats for 6 players give finite bubble factors (about 8 against
  the covering stacks) and equity shares that add to 1; 6 or 9 equal places for 6 players give 1/6 each and null bubble
  factors; a 60bb stack against three 5bb stacks is all but sure of its seat (19.98% of 20%). `solver/` untouched.
- `features/tournaments/tournament.ts` `satellitePayouts(players)`: equal seats, one fewer than the players (none
  heads-up); `describeTournament` calls equal payouts "a satellite, N equal seats".
- `SolvePage.tsx`: a "Satellite, N seats" shape, and the help text says a satellite's preflop answers are still the chip
  charts with a risk premium (on a 5-seats-for-6 bubble UTG still opens about 17%), approximate as the badge says.
- `TournamentPanel.tsx`: a null bubble factor now reads "(a chip won gains nothing)" (it was "more than any chip won",
  wrong when every player left is already paid and nothing is at stake); all null reads "none: a chip won from anyone
  gains nothing."

### Tests actually run

| Suite | Result |
|---|---|
| Web (Vitest) | 283/283 in 48 files. Changed: `tournament.test.ts` (the satellite shape and its description), `SolvePage.test.tsx` (the shape's button), `TournamentPanel.test.tsx` (the null wording; all null) |
| Engine contract (`scripts/engine`) | 8/8 |
| Typecheck and ESLint | clean |
| Build | passes |

### Checked in the browser (local build, the in-browser solver)

- `/tournaments` 6-max 20bb, "Satellite, 5 seats", Open in Study: "Your setup: payouts 1/1/1/1/1" (before the
  description change), "Preflop charts · chip chart with a risk premium · approximate", bubble factors 5.00 against
  each, prize equity 16.7%.
- 6 equal places for 6 players: "Your setup: a satellite, 6 equal seats", "Bubble factors …: none: a chip won from
  anyone gains nothing."

### Precompute builds

Untouched (read-only `ps`). Memory 65–69% free; everything ran under `nice`.

### Next

- Phase 7, still open: the bubble factor table for every pair, a 15%-paid curve preset, a per-hand ICM vs chip diff, a
  satellite-aware preflop, tournaments in Practice and Analyze.
- Phase 6, still open: node locks and automatic sizing (per hand), solve times measured per mode, the local server
  option (after its patch).

## 2026-11-03: Phase 7, a tournament hand in Analyze opens with prizes on the Tournaments page (second session)

Deploy of 21124f7 (satellites) verified live: run 41688598760 passed, its new "Engine contract tests" step
included (8/8 on CI's Python 3.12 and numpy 2.0.2); `/lizard/` serves `index-Ld4eYMlL.js`, which has "a chip won
gains nothing" and "equal seats".

### Code

- `AnalyzePage.tsx`: each of your decisions in a tournament hand has, beside its Study link, a "with prizes" link to
  the Tournaments page with the same line, stacks and ante (a hand history has no prizes left, so they're typed
  there, with any bounties); the hand's note says so. Its Study links and grades stay in chips.

### Tests actually run

| Suite | Result |
|---|---|
| Web (Vitest) | 283/283 in 48 files. Changed: `AnalyzePage.test.tsx` (the MTT hand's four decisions each link to `/tournaments?` with the Study link's line, stacks and ante; the note) |
| Typecheck and ESLint | clean |
| Build | passes |

### Checked in the browser (local build, the in-browser solver)

- The MTT hand's preflop link, on the Tournaments page: table 80bb, ante 0.1, LJ 100, BTN 136.73, SB 41.67, BB 83.67
  filled in, the line kept. "Final table, 9 paid", Open in Study: "CO to act on the preflop · pot 4.6bb", "Your setup:
  stacks … · ante 0.1bb · payouts 30/20/14/10.5/8/6.5/5/3.5/2.5", "Preflop charts · chip chart with a risk premium ·
  approximate", prize equity 10.9%, bubble factors 1.25 (SB, the short stack) to 1.80 (BTN, the big one). (The hand
  isn't kept in this browser, so the link's URL, as the test pins it, was opened directly.)

### Precompute builds

Untouched (read-only `ps`). Everything ran under `nice`.

### Next

- Phase 7, still open: the bubble factor table for every pair, a 15%-paid curve preset, a per-hand ICM vs chip diff, a
  satellite-aware preflop, tournaments in Practice.
- Phase 6, still open: node locks and automatic sizing (per hand), solve times measured per mode, the local server
  option (after its patch).

## 2026-11-03: Phase 8, the Compare view (second session)

Deploy of 478df5f (Analyze's "with prizes" links) verified live: run 41689103791 passed; `/lizard/` serves
`index-DXkWLJi0.js`, which has "with prizes" and "as a tournament".

### Code

- `web/src/features/compare/compare.ts`: the diff of two Study answers, B − A everywhere: every action either side
  offers (one not offered counts as never taken), the range's totals, per hand class the change in one action's
  frequency (null where the class is in one range only) and in the class's EV, the biggest changes, the noise
  threshold (both answers' distance from equilibrium combined, in bb; none unless both are measured), the warnings
  (different sources; either side approximate; different player or street), and what differs between the two spots
  in words. `compareLink(a, b)` builds `/compare?a=<Study query>&b=<Study query>`.
- `DiffMatrix.tsx`: the 13x13 classes coloured by the change (blue more often, red less), each cell a labelled button.
- `ComparePage.tsx` (`/compare`, not in the nav): both spots checked as Study checks them, then asked one after the
  other (A, then B once A is answered; Stop stops both); each side's description, Open in Study and badge; the
  warning first; the actions table; the range's totals; the grid for any one action, a selected class in words, and
  the biggest differences.
- `features/study/CompareLinks.tsx`, under each Study decision: "Compare this spot:" in chip EV (a tournament), with
  or without rake (postflop only, where the rake is taken; 5% capped at 3bb is a generic preset), and at another
  stack (10–250bb). Shown only on a decision node.
- `provenance.ts`: `sourceLabel` exported for the warning.

### Tests actually run

| Suite | Result |
|---|---|
| Web (Vitest) | 295/295 in 50 files. New: `compare.test.ts` (6: zero against itself, the action union, per-class diffs, noise, the warnings, what differs), `ComparePage.test.tsx` (5: A then B and the whole page; the mixed-source warning; nothing to compare, and nothing asked for a setup out of range; Study's variants and links; the cells' labels). `StudyPage.test.tsx`: the links on a decision only |
| Typecheck and ESLint | clean |
| Build | passes (12 route pages and 404.html, `compare` among them) |

### Checked in the browser (local build, the in-browser solver)

- 6-max 100bb preflop, "at 50 bb compare": both "Preflop charts · approximate", the warning "A and B are approximate
  (Preflop charts): read small differences as noise.", raise 18.7% against 18.8%, no EV columns (a chart has none),
  "No distance from equilibrium is measured on both sides…", biggest change K7s 0.0% → 28.0%.
- Heads-up 100bb, SB raise 2.5, BB call, Ks7d2c, "with 5% rake, capped at 3bb": both live solves (0.11% and 0.12%
  pot from equilibrium), "B adds: rake 5%, capped at 3bb", check 99.7% → 96.5%, BB's range 777.4 → 512.4 combos and
  equity 45.6% → 49.7%, noise under 0.01bb.
- 375px: no horizontal overflow on `/compare` or on Study with the links. No console errors from the new bundle.

### Precompute builds

Untouched (read-only `ps`). Memory 63–66% free; everything ran under `nice`.

### Next

- Phase 8, still open: Compare EV (two actions per class), the charts against the preflop solve preset, the one-size
  view (port `simple.test.js`), a picker for any two nodes.
- Phase 7, still open: the bubble factor table for every pair, a 15%-paid curve preset, a per-hand ICM vs chip diff, a
  satellite-aware preflop, tournaments in Practice.
- Phase 6, still open: node locks and automatic sizing (per hand), solve times measured per mode, the local server
  option (after its patch).

## 2026-11-03: Phase 8, two actions' EV per hand class in Study (second session)

Deploy of 44eb995 (the Compare view) verified live: run 41690931188 passed; `/lizard/` serves `index-CuJr8-w7.js`,
which has "Compare this spot" and the mixed-source warning, and `/lizard/compare` answers 200.

### Code

- `web/src/features/compare/evgap.ts`: per class in the range, one action's EV minus another's, from the grid cells'
  per-action EVs; the classes where each is worth most more; the classes taking both (each 5% or more) and their
  gaps' mean size; offered only where every action has an EV per class (not for a chart, a read at once or a 4-way
  answer).
- `EvGapPanel.tsx`, under a solved node's grid in Study ("Compare two actions' EV", closed by default): two action
  pickers (the two the range takes most first) and Swap, the grid (blue: the first is worth more; red: the second),
  gaps under the answer's distance from equilibrium left uncoloured, the two lists, the equilibrium check, and "≈ …
  its EVs are rough (usually too low)" when either action is `rough_ev`. EVs in the user's unit (bb or % pot).
- `DiffMatrix.tsx`: the grid is now `DeltaMatrix` (any change, its scale and threshold), used by both.

### Tests actually run

| Suite | Result |
|---|---|
| Web (Vitest) | 300/300 in 51 files. New: `evgap.test.tsx` (5: offered only with every action's EV; the gap and its sign; the lists and the equilibrium check; the panel: defaults, the rough-EV caveat, noise, Swap, cell labels, the lists; not offered without EVs) |
| Typecheck and ESLint | clean |
| Build | passes |

### Checked in the browser (local build, the in-browser solver)

- Heads-up 100bb, SB raise 2.5, BB call, Ks7d2c, BB check (a live solve): "EV of bet 33% minus check", strongest
  +0.70bb (KK), check worth most more with 88 (+0.08bb), "89 classes take both at least 5% of the time; their gaps
  average 0.01bb in size", noise under 0.01bb. 375px: no overflow. No console errors from the new bundle.

### Precompute builds

Untouched (read-only `ps`). Memory 63–66% free; everything ran under `nice`.

### Next

- Phase 8, still open: the charts against the preflop solve preset, the one-size view (port `simple.test.js`), a
  picker for any two nodes.
- Phase 7, still open: the bubble factor table for every pair, a 15%-paid curve preset, a per-hand ICM vs chip diff, a
  satellite-aware preflop, tournaments in Practice.
- Phase 6, still open: node locks and automatic sizing (per hand), solve times measured per mode, the local server
  option (after its patch).

## 2026-11-03: Phase 8, the one-size view in Study (second session)

Deploy of 5f4b83c (two actions' EV) verified live: run 41691622673 passed; `/lizard/` serves `index-CYpblUYq.js`,
which has "Compare two actions" and "rough (usually too low)".

### Code

- `web/src/features/compare/oneSize.ts`: a port of the classic `simple.js` run and verdict (not its HTML): one run
  per spot (the Study request less its speed), kept for the page's life; the full menu first, then each size in the
  answer's order; the verdict (the best size, each size's EV given up in % of the pot, ties within the larger of two
  solves' exploitabilities); the time left (upstream's estimates, then the pace of the answers); start, stop (its
  request aborted through the client's signal; what's in hand stays) and a late answer of a stopped loop left alone.
- `OneSizePanel.tsx`, beside "Compare two actions' EV" under a heads-up solved node after the flop where the player
  can bet or raise: "One bet size" (or "One raise size", sizes as multiples of the bet faced, each with what it raises
  to). Asked at Fast, one solve a request; turns and rivers start once opened, a flop waits for "Find the best size";
  progress with Stop and Continue; the verdict; a row per size (bets, the range's EV, what it gives up; ≈ for a size
  whose solve stopped early once clearly behind); the strategy of the size picked (its mix and grid); a tournament's
  notes (EVs in prize equity). Leaving the node stops the run (showing it again carries on).
- `provenance.ts`: `oneSizeProvenance` and a `view` field on a provenance: the badge reads "Live solve · one-size view,
  9 of 9 solves at Fast (the widest's distance shown) · 0.21% pot from equilibrium …".

### Tests actually run

| Suite | Result |
|---|---|
| Web (Vitest) | 310/310 in 52 files. New: `oneSize.test.tsx` (10, from the classic `simple.test.js`: the run's order and once-only asks, ties and no loss before the full menu, the answer's order, stopping and carrying on, a late answer, a failed request, the time left, where Study offers it; the panel on a turn, a flop's opt-in with Stop and Continue, the raise view with a tournament's notes, a size cut early) |
| Typecheck and ESLint | clean |
| Build | passes |

### Checked in the browser (local build, the in-browser solver)

- Heads-up 100bb, SB raise 2.5, BB call, Ks7d2c x x, Th x x, 4c, BB to act: "One bet size" ran 9 river solves in a few
  seconds: "Best single size: 33% (as good within the solves' precision: 50%) · gives up 0.90% of the pot against every
  size mixed"; every size mixed +2.55, 25% to 200% +2.48 to +2.50, the sizes from 75% up stopped early (≈). 375px: no
  overflow. No console errors from the new bundle.

### Precompute builds

Untouched (read-only `ps`). Memory 62–66% free; everything ran under `nice`.

### Next

- Phase 8, still open: the charts against the preflop solve preset, a picker for any two nodes.
- Phase 7, still open: the bubble factor table for every pair, a 15%-paid curve preset, a per-hand ICM vs chip diff, a
  satellite-aware preflop, tournaments in Practice.
- Phase 6, still open: node locks and automatic sizing (per hand), solve times measured per mode, the local server
  option (after its patch).

## 2026-11-03: Phase 0, the preflop Solver source; Phase 8, the charts against the preflop solve (second session)

Deploy of ab3cbb3 (the one-size view) verified live: run 41692773614 passed; `/lizard/` serves `index-DLCA7ca9.js`,
which has the "one-size view" badge text.

### Code

- `web/src/features/study/pfSolve.ts` (classic `study.js` request, pfSolve, pfKeep, pfLoad): the Study request asks
  `preflop_solve` preflop when the hand's source is the solve (`StudyHand.pf`, `pf=solver` in the link, `withPf`);
  `askNode` hands a solve this browser kept back to the worker (`{load, iterations}`) when it answers `pf_unsolved`,
  and drops a kept solve the worker won't take; `runPf` runs a game's solve in 4 s chunks (`{run: 4}`), its status
  into the run, the node shown asked again after each chunk, until done or Stop (after the chunk running, so the
  worker keeps the solve with or without shared memory), then exports it (`{export: true}`) into IndexedDB
  `lizard-pf` (a cache apart from the app's database: no migration, never in a backup; at most 6, keyed by the solver
  build and pf_study's game key). The bar as classic's (the measure's share of the way to the target).
- `PreflopSolve.tsx`: the Charts | Solver toggle (Study's header, preflop only), the offer for a game the engine holds
  no solve of (the game, about how long, "It runs only when you ask", Solve), the progress line (iterations, mbb/hand,
  seconds, Stop, a bar), a game the solve doesn't take (its reason, "Use the charts"), and the note under a node from
  the solve (its game, precomputed or solved earlier in this browser, iterations, mbb/hand, stalled, "Not finished:
  the numbers can still move" with "Continue the solve", and a rough line's regret).
- `StudyPage.tsx`: the run belongs to the page: it goes on while the page shows a preflop node of the same game under
  the Solver source and stops (after its chunk) once it doesn't, or on leaving. Reset and New hand keep the source.
- `provenance.ts`: "Preflop solve (class-level model)" (ROADMAP Phase 0's label), its distance in mbb/hand a seat
  (`mbbPerHand`), "precomputed" or "solved earlier in this browser", and approximate while the solve isn't finished or
  on a line it rarely plays (`rough`).
- Compare: a preflop spot's "Compare this spot" link is the charts against the preflop solve (or the solve against the
  charts); "What differs" names the preflop source; the warning says the two sources are what's compared (and which
  side is approximate); a side that isn't a decision (a game not solved yet, one the solve doesn't take, a deal) says
  why and nothing is compared. Compare hands kept solves back too, but never solves.

### Tests actually run

| Suite | Result |
|---|---|
| Web (Vitest) | 319/319 in 53 files. New: `pfSolve.test.tsx` (9: the request and link; the bar; the badge; a run to done, refreshed after each chunk and kept, then handed back; a bad kept solve dropped; Study's offer, never started by itself, progress, the solve's node, back to the charts; Stop after the chunk, Continue; a game the solve doesn't take; Compare's words for the two sources). `ComparePage.test.tsx`: preflop variants. |
| Typecheck and ESLint | clean |
| Build | passes |

### Checked in the browser (local build, the in-browser solver; heads-up and 3-max only, a few seconds of CPU each)

- 6-max 100bb, Solver: the stored solve at once, "Preflop solve (class-level model) · precomputed · 1.07 mbb/hand from
  equilibrium (a seat's average) · 1500 iterations", UTG raise 14.8% (EV 0.68), the EV view offered. Its "against the
  charts" link: raise 14.8% against 18.7%, ATo 0% → 100%, KJo 0% → 100%, K8s 100% → 30%, with the two-sources warning.
- Heads-up 100bb, Solver: the offer ("About 5 s in your browser"), nothing run until Solve; one chunk to 2,000
  iterations, 0.09 mbb/hand, SB raise 49.6%, limp 48.6%, fold 1.8%. After a reload (a new worker) the node came back
  from IndexedDB: "solved earlier in this browser".
- 3-max 100bb: Stop pressed during the second chunk showed "Stopping after this chunk…" and the unfinished node as
  approximate (1,492 iterations, 0.58 mbb/hand); that chunk then finished the solve (2,000, 0.55).
- 375px: no overflow. No console errors from the new bundle.

### Precompute builds

Untouched (read-only `ps`). Memory 64% free; everything ran under `nice`.

### Next

- Phase 8, still open: a picker for any two nodes.
- Phase 0: the classic's custom preflop raise sizes (`pf_sizes`) aren't offered yet.
- Phase 7, still open: the bubble factor table for every pair, a 15%-paid curve preset, a per-hand ICM vs chip diff, a
  satellite-aware preflop, tournaments in Practice.
- Phase 6, still open: node locks and automatic sizing (per hand), solve times measured per mode, the local server
  option (after its patch).

## 2026-11-03: Phase 8, a picker for any two spots (second session)

Deploy of c264c21 (the preflop Solver source) verified live: run 41695460123 passed; `/lizard/` serves
`index-yr1rwDfE.js`, which has "Preflop solve (class-level model)", the `lizard-pf` cache and "against the preflop
solve".

### Code

- `web/src/features/compare/SpotPicker.tsx`: the Compare page with no spots (and "Change the spots" under a
  comparison) picks each side from the saved spots (`listSpots`), the spot pinned in Study, or a Study link pasted
  (any origin, `?p=…` or `p=…`; anything else is "Not a Study link"), with Swap and Compare (disabled until both
  sides are spots). Each spot is named by its table and line ("HU 100bb (preflop solve): the first decision"); a saved
  spot by its title, with the line only where the title isn't already the line.
- `pin.ts`: one pinned spot (a zustand store kept in `sessionStorage`, so a reload keeps it and a new visit doesn't).
  Study's "Compare this spot" has "Pin as A" (pressed: "Pinned as A · unpin") and, on any other spot, "with the pinned
  spot", which opens the pinned spot as A and this one as B.

### Tests actually run

| Suite | Result |
|---|---|
| Web (Vitest) | 322/322 in 53 files. New in `ComparePage.test.tsx`: the forms of a pasted link; picking A from a saved spot and B from a pasted link (a bad paste refused), Swap and Compare (both sides asked, "What differs"), a saved title that is the line named by its table only; the pin in Study and the link from another spot. |
| Typecheck and ESLint | clean |
| Build | passes |

### Checked in the browser (local build)

- Pinned the heads-up 100bb preflop solve in Study; on the charts' spot "with the pinned spot" opened
  `/compare?a=p=2&s=100&pf=solver&b=p=2&s=100`: "preflop source the preflop solve → the charts", the two-sources
  warning, raise 49.6% against 59.4%, limp 48.6% against 28.9%, fold 1.8% against 11.7%.
- The empty picker at 375px: the pinned spot and a saved spot listed in both selects, no overflow.

### Precompute builds

Untouched (read-only `ps`). Memory 65% free; everything ran under `nice`.

### Next

- Phase 8, still open: a comparison of two size menus.
- Phase 0: the classic's custom preflop raise sizes (`pf_sizes`) aren't offered yet.
- Phase 7, still open: the bubble factor table for every pair, a 15%-paid curve preset, a per-hand ICM vs chip diff, a
  satellite-aware preflop, tournaments in Practice.
- Phase 6, still open: node locks and automatic sizing (per hand), solve times measured per mode, the local server
  option (after its patch).

## 2026-11-03: Phase 7, the bubble factor table for every pair and a 15%-paid curve (second session)

Deploy of 3827588 (the Compare picker) verified live: run 41696476384 passed; `/lizard/` serves `index-D8QfMlVJ.js`,
which has "Pick the spots", `lizard.compare.pin` and "with the pinned spot".

### Code

- `web/src/features/tournaments/icm.ts`: a port of the engine's prize model (`solver/gto/icm.py` equities,
  field_stacks, compress_payouts, Model's base and bubble_factor): Malmuth-Harville over at most 12 players (a bit-mask
  pass over the sets of players placed, each set after its subsets), the other tables' players as stand-ins past 12,
  the payouts spread over them. `bubbleTableOf` builds it from a spot's setup as `advisor.py _tournament` does (each
  seat's stack or the table's, the other tables evenly, the payouts no more than the players left; none without two or
  more prizes). The answer's own `tournament` block still gives the actor's factors; the table adds every pair. Why
  a port: the worker answers only advisor states, which give the actor's row only, and `solver/` stays unpatched.
- `BubbleTable.tsx`: rows the seat risking chips, columns the opponent, each seat's prize equity, shaded by size; a
  toggle to the equity a call of the all-in needs with nothing else in the pot (BF / (1 + BF): the engine's
  `call_need` there; its risk premium is that less 50%). Labelled `ICM_TABLE_LABEL` (`provenance.ts`): "ICM
  (Malmuth-Harville), worked out in this page from the setup with the engine's prize model", plus "N players modelled
  by 12" where so, at the start of the hand and without bounties (they don't enter the ratio).
- The Tournaments page shows it under the seats once the setup has no problem; Study's Tournament panel has it under
  "Every pair" (memoized per hand), the actor's row outlined.
- `tournament.ts` `paidCurve`: "15% paid, N places", for the players left (this table's and the other tables'), place
  k in proportion to k^-0.8 (Lizard's own curve; 100 left: 15 places, 23.7% to 2.7%); offered from 10 players left.
  The page's "Not here yet" line no longer lists the pair table, ICM against chip EV (Study has it) or satellites.

### Tests actually run

| Suite | Result |
|---|---|
| Web (Vitest) | 331/331 in 54 files. New: `icm.test.ts` (7: the engine's numbers run on `gto/icm.py` for uneven stacks, other tables, a 36-player field modelled by 12, a satellite, every player paid, the field grouping and payout spreading, the table from a setup, and `call_need`); `TournamentPanel.test.tsx` (Every pair, the actor's row, the equity to call); `SolvePage.test.tsx` (the table from typed stacks, the 15%-paid button at 100 players left, none for a winner-takes-all); `tournament.test.ts` (`paidCurve`). |
| Typecheck and ESLint | clean |
| Build | passes |

The reference numbers came from `.venv/bin/python` importing `solver/gto/icm.py` (milliseconds of CPU).

### Checked in the browser (local build)

- Tournaments, 6-max 20bb with BTN 35, SB 12, BB 8, paying 50/30/20, 4 players at other tables (25bb): the table
  (UTG 9.5%, UTG against BTN 1.20); the same spot in Study (the chip chart with a risk premium for UTG): the engine's
  answer "HJ 1.17 · CO 1.17 · BTN 1.20 · SB 1.09 · BB 1.06", 9.5%, equal to the table's UTG row under "Every pair".
- 9-handed, a 9-paid final table, 40 players at other tables, at 375px: "49 players modelled by 12"; the table scrolls
  inside its box, the page doesn't overflow.

### Precompute builds

Untouched (read-only `ps`). Memory 65% free; everything ran under `nice`.

### Next

- Phase 7, still open: a per-hand ICM vs chip diff, a satellite-aware preflop, tournaments in Practice.
- Phase 8, still open: a comparison of two size menus.
- Phase 0: the classic's custom preflop raise sizes (`pf_sizes`) aren't offered yet.
- Phase 6, still open: node locks and automatic sizing (per hand), solve times measured per mode, the local server
  option (after its patch).

## 2026-11-03: Phase 7, ICM against chips per hand class (second session)

Deploy of 623d0d6 (the bubble factor table) verified live: run 41697863085 passed; `/lizard/` serves
`index-BpW6obm5.js`, which has "Bubble factors, every pair", "Equity to call" and "15% paid".

### What was already there, and what was missing

A tournament decision's "in chip EV" link (Phase 8's Compare) already diffs every hand class, prize equity against
chips. Checked now in a browser for the first time on a tournament: 6-max 10bb paying 50/30/20, UTG all-in 16.2%
against 16.3%. Two gaps: the chip side's badge said only "Preflop charts" though its all-in is the push/fold
equilibrium in chips (the engine's `_push` runs in both; only the tournament side was named), so the page looked like
an equilibrium against a chart; and Study's own "Compare with chip EV" panel didn't lead to the per-class view.

### Code

- `provenance.ts`: a chip answer whose own all-in comes from the push/fold equilibrium (the engine's note "all-in,
  range from the push/fold equilibrium") is labelled "push/fold equilibrium in chips" (`view`); a jammer's range
  note when facing a jam isn't.
- `ChipCompare.tsx`: "Every hand class, prize equity against chips" links to `/compare` with the tournament as A
  and chips as B.

### Tests actually run

| Suite | Result |
|---|---|
| Web (Vitest) | 331/331 in 54 files (`provenance.test.ts`: the chip push/fold label, and none for a jammer's range note; `StudyPage.test.tsx`: the link's two sides, payouts on A, none on B with the stacks and ante kept). |
| Typecheck and ESLint | clean |
| Build | passes |

### Checked in the browser (local build)

- `/compare` for 6-max 10bb, 50/30/20 against chips: "Preflop charts · push/fold equilibrium in prize equity ·
  approximate" against "Preflop charts · push/fold equilibrium in chips · approximate"; the classes that move most
  are near the edge (A2s 97.5% → 1.8%, Q9s 0% → 85%).
- Study, the same spot: "Compare with chip EV" (all-in 16.2% against 16.3%) and its new link to that comparison.

### Precompute builds

Untouched (read-only `ps`). Memory 65% free; everything ran under `nice`.

### Next

- Phase 7, still open: a satellite-aware preflop, tournaments in Practice.
- Phase 8, still open: a comparison of two size menus.
- Phase 0: the classic's custom preflop raise sizes (`pf_sizes`) aren't offered yet.
- Phase 6, still open: node locks and automatic sizing (per hand), solve times measured per mode, the local server
  option (after its patch).

## 2026-11-03: Phase 0, the preflop solve's raise sizes (second session)

Deploy of 09092ba (ICM against chips per class) verified live: run 41698407285 passed; `/lizard/` serves
`index-yoNx1azH.js`.

### What was missing

The classic's Preflop solve form takes the solve's raise sizes (`pf_sizes`: `open`, `sb_open`, `ip_3bet`,
`blind_3bet`, `four_x`, within `pf_study.SIZE_LIMITS`, defaults from `pf_game.Sizes`); Lizard's Solver source only
asked the default sizes. The roadmap said Phase 0 had nothing open while the matrix listed this as not done.

### Code

- `web/src/features/study/pfSizes.ts` (new): the five sizes with their labels, units, limits and defaults;
  `tidyPfSizes` (rounded to 0.01 as the engine rounds, out-of-range and default sizes dropped), `pfSizeProblems`,
  `encodePfSizes`/`parsePfSizes` (`pfs=open:2.2,four_x:2.5`), `describePfSizes`.
- `studyState.ts`: `StudyHand.pfSizes`, sent as `pf_sizes` with `preflop_solve`; kept only with the Solver source
  (the charts play their own sizes); in the link as `pfs=` with `pf=solver`; New hand and Reset keep them (`samePf`).
- `PreflopSolve.tsx`: `PfSizesForm`, a "Sizes" disclosure in Study's header under the Solver source (blank fields
  show the defaults), the limits checked before Apply.
- `compare.ts`, `ComparePage.tsx`: two preflop solves with different sizes are named as differing in "the solve's
  sizes"; a side's words say its sizes.

### Tests actually run

| Suite | Result |
|---|---|
| Web (Vitest) | 334/334 in 54 files (`pfSolve.test.tsx`: the sizes' tidying, problems, link and request; the Study form's flow; Compare naming the sizes). |
| Typecheck and ESLint | clean |
| Build | passes |

### Checked in the browser (local build)

- Heads-up 100bb, SB open 2.2bb: the offer names the game ("opens 2.5bb (SB 2.2)…", about 5 s); solved on request to
  2,000 iterations at 0.10 mbb/hand: SB raises 45.3%, limps 54.7%, folds 0%. Playing the raise gives the line "SB
  raise 2.2"; BB 3bets 21.7%, calls 75.6%, folds 2.7%.
- The form at 375px: no sideways scroll, summary "Sizes: SB open 2.2bb".

### CI

The first deploy of this (run 41699633685, 99f7a83) failed on an unrelated test, Practice's keys test: "You won"
never showed after the 2 key. A race, not slowness: Practice's key handler was swapped in a `useEffect`, which runs
after paint, so a key pressed as the flop's options showed could still reach the preflop's handler. It's now swapped in
a `useLayoutEffect` (`PracticePage.tsx`), as the page commits.

### Precompute builds

Untouched (read-only `ps`). Memory 59% free; everything ran under `nice`.

### Next

- Phase 7, still open: a satellite-aware preflop, tournaments in Practice.
- Phase 8, still open: a comparison of two size menus.
- Phase 6, still open: node locks and automatic sizing (per hand), solve times measured per mode, the local server
  option (after its patch).

## 2026-11-03: Phase 8, two size menus compared (second session)

Deploy of 609236f (the preflop solve's sizes and the Practice key-handler fix) verified live: run 41700153968 passed;
`/lizard/` serves `index-DA-azbB0.js`, which has "Preflop solve sizes".

### What was missing

The Compare page could already be handed two Study links with different sizes, but their bets don't share names
("bet 33%" against "bet 50%"), so each size was compared against "not offered"; nothing said which menu was worth more,
and nothing in Study led there. The engine's street menu is every bet's on that street, both players'
(`advisor.py` sets `cfg.bet_sizes[street]`; a line's own bets are swapped in by `_swap_nearest`); a multiway solve bets
its own fixed sizes (`MWConfig`), so a menu there would change nothing.

### Code

- `compare.ts`: `ANY_RAISE` ("any bet or raise", all-in too) as an action the per-class diff sums; `sizesOnly` (two
  spots that differ in their sizes and nothing else); `menusOf` (each side's bets offered, the share of the range betting
  or raising, the range's EV, B − A in bb and in % of the pot, the noise band); `menuWords` (within both answers'
  distance from equilibrium combined: neither is worth more; under twice it: close to a tie; unmeasured: said).
- `ComparePage.tsx`: a "Size menus" section for two such spots, and the grid opens on any bet or raise; the action
  picker offers it wherever there's more than one bet or raise.
- `CompareLinks.tsx`: `betMenuOf` (a heads-up decision after the flop where check is an option: the street and its
  menu, from the spot's own sizes or the answer's bets) and "with {street} bets … % compare menus" (`withMenu`: the
  sizes checked as the Solve page checks them, the rest of the setup kept).

### Tests actually run

| Suite | Result |
|---|---|
| Web (Vitest) | 339/339 in 54 files (`compare.test.ts`: `sizesOnly`, any bet or raise per class, `menusOf`, the four verdicts; `ComparePage.test.tsx`: the page's Size menus section and grid, Study's menu link and its problems). |
| Typecheck and ESLint | clean |
| Build | passes |

### Checked in the browser (local build)

- Study, heads-up 100bb Ks7d2c after SB raise 2.5, BB call: the menu field reads "33, 75" from the answer; typing 50
  links to the comparison.
- BB to act: 33/75% against 50%, both live solves (0.11% and 0.09% from equilibrium): BB bets 0.3% against 0.1%.
- SB after BB checks: bets 65.0% against 54.6% of the range; EV 3.10 against 3.09bb, "close to a tie" (first shown as
  "worth 0.01bb more", beyond a 0.01bb band, which read as a win: hence the close-to-a-tie case); TT bets 99.7% →
  16.7%, JJ 76.7% → 2.0%. At 375px no sideways scroll.

### Precompute builds

Untouched (read-only `ps`). Memory 59% free; everything ran under `nice`.

### Next

- Phase 7, still open: a satellite-aware preflop, tournaments in Practice.
- Phase 6, still open: node locks and automatic sizing (per hand), solve times measured per mode, the local server
  option (after its patch).

## 2026-11-03: Phase 6, node locks in Study (second session)

Deploy of a1c3f1c (two size menus) verified live: run 41701187478 passed; `/lizard/` serves `index-iSLwQzQf.js`, which
has "close to a tie".

### What the engine does

`locks` ({seat: {key: number}}, `gto/exploit.py` `LOCK_KEYS`, `parse_locks`) are tendency locks: the opponent's
equilibrium strategy moved by the read, and the advice the best response to it (`advisor.py` `_advise_at`'s exploit
branch: each hand's highest-EV action, ties within the solve's noise keeping the equilibrium mix; `gto_freq` beside
each action; `locked` names the read). Study drops them (`STUDY_DROPS`), but one hand's advice carries the whole range's
best response as its `grid` and `range_action_freq`. Probed natively first (a river, SB AhQd, BB `fold: 15`: 4.2 s; check
100% at equilibrium → bet 100% against the read).

### Code

- `web/src/features/study/locks.ts`: the keys, bounds, presets and words (ported from `exploit.py` and the classic
  page's `LOCK_PRESETS`, `LOCK_INPUTS`), `lockOf` (the fields checked; zero profile values dropped, as `parse_locks`
  does), `describeLock`, `presetOf`, `offersLock` (a heads-up node after the flop with its opponent named),
  `lockRequest` (Study's request out of Study mode, with the hero, the hand and the lock).
- `LockPanel.tsx`: "Against a read (node lock)" under the grid: the read (preset or numbers), the hand (the class
  picked in the grid, its combos in the range), Ask (equilibrium, then the read, one after the other, Stop); the answer's
  badge, the hand's and the range's frequencies against the read and at GTO, the change per class (`DiffMatrix`), the
  engine's notes.
- `provenance.ts`: an answer with `locked` gets `lock` ("best response to BB folds +15 pts to bets, not an equilibrium
  re-solve"), first after the source on the badge.

### Tests actually run

| Suite | Result |
|---|---|
| Web (Vitest) | 343/343 in 55 files (`locks.test.tsx`: the fields' bounds and words, presets, the request, the hands offered, the badge label, the panel asking twice and showing GTO beside the best response). |
| Typecheck and ESLint | clean |
| Build | passes |

### Checked in the browser (local build)

Heads-up 100bb Ks7d2c5h9s, checked to the river, SB to act after BB checks, BB overfolding (+15): AhQd checks 100% at
equilibrium and bets 250% 100% against the read (EV 4.04bb, a check 2.98bb); the range checks 52.3% → 22.7% and bets
250% 0% → 58.5%; the badge "Live solve · best response to BB folds +15 pts to bets, not an equilibrium re-solve · 0.15%
pot from equilibrium in the solved game (converged) · 300 iterations". At 375px no sideways scroll.

### Precompute builds

Untouched (read-only `ps`). Memory 59% free; everything ran under `nice`.

### Next

- Phase 6, still open: automatic sizing (per hand), preflop and multiway locks, solve times measured per mode, the
  local server option (after its patch).
- Phase 7, still open: a satellite-aware preflop, tournaments in Practice.

## 2026-11-03: Phase 6, automatic sizing in Study (second session)

Deploy of ca27e0e (node locks) verified live: run 41702401334 passed; `/lizard/` serves `index-DpKXDdEy.js`, which has
"not an equilibrium re-solve".

### What the engine does

`optimize_sizes` (`advisor.py` `_optimize_sizes`; only where the player can bet, nothing to call, on a street that
began heads-up) solves the street once over `OPT_SIZES` (25, 33, 50, 75, 100, 150, 200% of the pot, plus the request's
sizes for the street), one street deep with one raise, at 35% of the time budget; keeps the sizes either player's first
bet uses with 3% of their range (the 3 most used); and solves the advice with them in the rest of the time. The answer
carries `size_usage` (the hero's mix at their first bet in the first solve), `sizes_kept`, `sizes_custom` and a note. It
skips the flop library. Study drops it (`STUDY_DROPS`), so it is asked per hand like the locks. Probed natively first
(the river below, SB AhQd: 4.4 s; kept 25/33/50%).

### Code

- `web/src/features/study/autoSize.ts`: `offersAutoSize` (where a lock is offered and the player can check),
  `autoSizeRequest` (one hand's advice with `optimize_sizes`), `usageOf`, `keptMenu` (the kept sizes as a setup menu,
  none where the all-in was kept).
- `locks.ts`: `handRequest` (Study's request out of Study mode with the hero and hand), which `lockRequest` now uses.
- `AutoSizePanel.tsx`: "Choose bet sizes (automatic sizing)" under the grid: the hand, Choose sizes (one request, Stop);
  the answer's badge, the kept sizes, the wide menu with the share of the range of the player to act betting each size, the hand's
  and the range's mix at the kept sizes (EVs marked ≈ where rough), a link "compare the kept sizes with this spot's"
  (the two size menus view, `CompareLinks.withMenu`), the engine's notes.
- `provenance.ts`: an answer with `sizes_kept` gets `sizing` ("river bet sizes 25%, 33%, 50% chosen by a first solve
  over a wide menu (one street deep, one raise)") on its badge.

### Tests actually run

| Suite | Result |
|---|---|
| Web (Vitest) | 346/346 in 56 files (`autoSize.test.tsx`: where it's offered, the request, the menu read, the badge label, the panel asking once with the menu, the kept sizes and the Compare link). |
| Typecheck and ESLint | clean |
| Build | passes |

### Checked in the browser (local build)

Heads-up 100bb Ks7d2c5h9s, checked to the river, SB to act after BB checks (Study's menu there 33/75/125/250%):
Choose sizes for Ad6s kept 25/33/50% (SB's range bet them 15.5/18.8/21.9% in the first solve, 75% 8.3%); the badge
"Live solve · river bet sizes 25%, 33%, 50% chosen by a first solve over a wide menu (one street deep, one raise) ·
0.08% pot from equilibrium in the solved game (converged) · 300 iterations". The Compare link: A the spot's menu (the
range's EV 3.20bb), B the kept one (3.35bb): "B's menu is worth 0.15bb more to SB here … beyond the two answers'
distance from equilibrium combined (0.009bb)". At 375px no sideways scroll.

### Precompute builds

Untouched (read-only `ps`). Memory 62% free; everything ran under `nice`.

### Next

- Phase 6, still open: preflop and multiway locks, solve times measured per mode, the local server option (after its
  patch).
- Phase 7, still open: a satellite-aware preflop, tournaments in Practice.

## 2026-11-03: Phase 6, solve times measured per mode (second session)

Deploy of 90a3748 (automatic sizing) verified live: run 41703776366 passed; `/lizard/` serves `index-Ds2b7Yrg.js`,
which has "chosen by a first solve over a wide menu".

### Why measured in the browser, not benchmarked

The ROADMAP asks for the modes "with measured times". Browser solve speed depends on the device, and a benchmark here
would be CPU-heavy while the precompute builds run, so the times are measured where the user solves: every live
answer's engine-measured `seconds` (the whole request, the narrowing of earlier streets included; the runtime's start
and the queue not).

### Code

- `web/src/solver/timings.ts`: `recordTiming` (a live, final answer on the flop, turn or river with `seconds`, once per
  distinct request since the page loaded, since a repeat is answered from the engine's cache; library flops, answers at
  once, charts and rules aren't solves), kept by backend, mode (the one it ran at), street and heads-up or multiway, the
  last 20 each, in localStorage (try/catch: kept for the page's life where unavailable); `timingOf` (median and count),
  `modeTimesText`, `useTimings` (re-renders as times come in), `clearTimings`.
- `client.ts`: `SolverClient.pump` records each answer, except Practice opponents' moves (`play`).
- `ModePicker.tsx`: each mode's title adds "Measured in this browser: turn 3.8 s (1), river 4.1 s (1) …" or "Not
  measured in this browser yet"; `ModeTimes`, a table in Settings ("Measured here": each mode by street, multiway rows
  once measured; "–" where none), with what's counted and Clear.

### Tests actually run

| Suite | Result |
|---|---|
| Web (Vitest) | 349/349 in 57 files (`timings.test.tsx`: what's counted and not, once per request, the last 20, kept across loads; the client recording at the mode run, not moves; the titles and the Settings table, Clear). |
| Typecheck and ESLint | clean |
| Build | passes |

### Checked in the browser (local build)

Heads-up 100bb Ks7d2c5h9s checked to the river (Fast): 4.11 s recorded; the turn node: 3.79 s; the Fast button's title
"Measured in this browser: river 4.1 s (1)"; Settings' table: Fast turn 3.8 s (1), river 4.1 s (1).

### Precompute builds

Untouched (read-only `ps`). Everything ran under `nice`.

### Next

- Phase 6, still open: preflop and multiway locks, the local server option (after its patch).
- Phase 7, still open: a satellite-aware preflop, tournaments in Practice.

## 2026-11-03: Phase 6, preflop locks in Study (second session)

Deploy of 9d17211 (solve times) verified live: run 41704475699 passed; `/lizard/` serves `index-BY2pY751.js`, which has
"Not measured in this browser yet".

### What the engine does

Preflop, `locks` act on the locked seat's chart strategy (`exploit.lock_preflop`; the keys fold, bluff, bet, raise in
their preflop words: folds to raises, bluff-raises, opens, re-raises), and hero's raises and calls are re-drawn by
equity against it (`advisor.py` `_preflop`, `_locked`), with `gto_freq` (the charts' mix) and `locked`. No
`range_action_freq` preflop, but the answer's grid is the range's. Probed natively (6-max, BB Ah5h facing a CO open, CO
`{fold: 15, raise: -30}`: 0.01 s). After the flop the engine applies locks heads-up only (`advisor.py:4796`), so
multiway locks stay out.

### Code

- `locks.ts`: `LOCK_FIELDS_PREFLOP`, `describeLock(l, preflop)` (the preflop words), `lockOf(typed, preflop)` (the
  preflop keys only), `offersLock` (any preflop node now, with its actor), `lockSeats` (preflop: the seats still in
  but the actor).
- `LockPanel.tsx`: preflop, a Seat select (the last raiser first), the preflop fields and preset names, "charts" in
  place of GTO, text saying the read is laid on the hand-written charts (even where Study shows the preflop solve);
  `rangeFreqOf` (the range's share off the grid, each class by its combos, where the answer has none); `holesOf` lists a
  class's hands where a preflop node has no combo rows.
- `provenance.ts`: a preflop lock in the preflop words; the source stays "Preflop charts", approximate.
- `autoSize.ts`: automatic sizing stays after the flop.

### Tests actually run

| Suite | Result |
|---|---|
| Web (Vitest) | 351/351 in 57 files (`locks.test.tsx`: the preflop keys and words, the seats still in, the class's hands, the range off the grid, the badge, the panel asking on the charts then the read). |
| Typecheck and ESLint | clean |
| Build | passes |

### Checked in the browser (local build)

6-max 100bb, BB facing a CO open (UTG, HJ, BTN, SB fold): Read on CO, "Folds to raises ±" 15 and "Re-raises ±%" −30;
the badge "Preflop charts · best response to CO folds +15 pts to raises, re-raises -30%, not an equilibrium re-solve ·
approximate"; the range raise 8.0% → 8.5%, call 37.0% → 37.2%, fold 55.0% → 54.3% (the charts' column matches Study's
node), the engine's notes below.

### Precompute builds

Untouched (read-only `ps`). Everything ran under `nice`.

### Next

- Phase 6, still open: multiway locks after the flop (an engine change), the local server option (after its patch).
- Phase 7, still open: a satellite-aware preflop, tournaments in Practice.

## 2026-11-03: Phase 1, the rule-based "why" text (second session)

Deploy of 3132c04 (preflop locks) verified live: run 41705241447 passed; `/lizard/` serves `index-Dp_xILD6.js`, which
has "pts to raises".

The ROADMAP's Phase 1 list was stale: "Open in Study" from a full-hand decision was already there ("Open this spot in
Study", `practice.ts` `studyOf`); it now says so.

### Code

- `web/src/grading/grade.ts`: `whyText(grade, names, freqs, who)`, the classic trainer's why (`practice.js:431-444`):
  Best: "always plays this here", "picks this most often here: 60% of the time", or, best by EV but played less, "plays
  this 40% of the time, and its EV is as high as any action's here"; Correct: "mixes this in 30% of the time; its best
  by EV is check (55% of the time)"; else "plays this only 4% of the time" or "never plays this", with the best.
  `whoOf(source)` names the answer: "The solver", "The chart" (the preflop charts, never called a solver), "The preflop
  solve", "The rule-based model", "The equity fallback".
- `PracticePage.tsx` (`DecisionView`) and `DrillsPanel.tsx` (the answer card): the sentence under the verdict.

### Tests actually run

| Suite | Result |
|---|---|
| Web (Vitest) | 352/352 in 57 files (`grade.test.ts`: every branch and the chart's name; `PracticePage.test.tsx`: the chart's and the solver's sentence; `DrillsPanel.test.tsx`: the solver's). |
| Typecheck and ESLint | clean |
| Build | passes |

### Checked in the browser (local build)

Practice, a new session: a preflop raise, "Preflop charts · approximate", "The chart always plays this here."; on to a
flop check under "Live solve · 0.02% pot from equilibrium … (converged)", "The solver always plays this here."

### Precompute builds

Untouched (read-only `ps`). Everything ran under `nice`.

### Next

- Phase 1, still open: the drill modes (pot types), multitabling, carried chips, sizes of your own, antes and
  straddles, the 20-hand engine check, the sessions history page.
- Phase 6, still open: multiway locks after the flop (an engine change), the local server option (after its patch).
- Phase 7, still open: a satellite-aware preflop, tournaments in Practice.

## 2026-11-03: Phase 1, the sessions History page (second session)

Deploy of aff5639 (the "why" text) verified live: run 41705774624 passed; `/lizard/` serves `index-D5jmhTkU.js`, which
has "picks this most often here".

The Phase 1 deliverable "The history page lists sessions by date with totals by pot type" is done: a new History page
(`/history`, in the primary nav).

### Code

- `web/src/data/db.ts`: `allSessions()`, every kept session newest first (the `byStarted` index). No migration.
- `web/src/features/history/history.ts`:
  - `rowOf(session)` reads each kind's record into a row, defensively (any field may be missing): what was practised;
    decisions, Best or Correct and EV lost a decision (by EV only); hands and net for full hands (no net preflop only);
    accuracy and EV lost a combo for range builds; what graded it; and where it opens again (a drill: "Drill it again",
    `/practice?tab=drills&spot=…&view=…`; a leak drill: `/analyze?drill=…`; a range build: the node in Study).
  - "Graded against": full hands, the count of decisions by the answer's source ("Live solve 2, Preflop charts
    (approximate) 1"), or "Not kept" for sessions played before this; drills, the flop library; leak drills,
    Analyze's answers (the charts, approximate, preflop; the flop library after); range builds, the record's source.
  - `kindTotals` (lifetime, by kind), `potTotals` (full hands by pot type, and the earlier sessions without a split,
    counted apart), `byDay` (local days, newest first).
  - `handPot(preflop, sim)`: a Practice hand's pot as its preflop went while you were in it, named as Analyze names pot
    types, plus "Unopened" (nobody raised or called). `addHandToPot`, `addSource`.
- `PracticePage.tsx`: each session now keeps `byPot` (each finished hand's graded decisions and net under its pot type)
  and `sources` (graded decisions by source) in its record's meta; "All sessions, and totals by pot type" links to
  History from the past sessions. `DrillsPanel.tsx`: "Every drill session" links there too. Plurals fixed in
  Practice's past list ("1 hand · 1 decision").
- `HistoryPage.tsx`, `routes.ts`, `App.tsx`: the page (a kind filter kept in the URL, `?kind=`), the route, 13 route
  pages built.

### Tests actually run

| Suite | Result |
|---|---|
| Web (Vitest) | 356/356 in 58 files (`history.test.tsx`: pot naming and tallies, each kind's row, totals by kind and pot type, the page from IndexedDB with the day groups, links and the kind filter; `PracticePage.test.tsx`: a played hand kept under "SRP" with its sources). |
| Typecheck and ESLint | clean |
| Build | passes |

### Checked in the browser (local build)

History with the sessions kept by earlier checks (full hands, a drill, a leak drill, two range builds): totals by
kind, rows by day, the earlier sessions said to have no pot-type split. Then Practice, 6-max preflop only from the
button: a 3-bet and a fold first in; History filed them under "3bet pot" and "Unopened", graded against "Preflop
charts (approximate) 2". At 375px the page has no horizontal scroll (the two tables scroll in their boxes).

### Precompute builds

Untouched (read-only `ps`). Everything ran under `nice`. Memory 57% free.

### Next

- Phase 1, still open: the drill modes (pot types in full hands), multitabling, carried chips, sizes of your own,
  antes and straddles, the 20-hand engine check.
- Phase 6, still open: multiway locks after the flop (an engine change), the local server option (after its patch).
- Phase 7, still open: a satellite-aware preflop, tournaments in Practice.

## 2026-11-03: Phase 1, the drill modes in full hands (second session)

Deploy of fdc8dca (History) verified live: run 41707682769 passed; `/lizard/` serves `index-Ba46ClDr.js`, which has
"Full hands by pot type", and `/lizard/history` answers 200.

Practice's "Play" now takes the classic trainer's drill modes (`practice.js:169-196`): Single-raised pots, 3-bet pots,
Blind vs blind, beside Full hands and Preflop only.

### Code

- `web/src/features/practice/practice.ts`:
  - `PotDrill`, `POT_DRILLS` (label, "a 3-bet pot", the tip), `isPotDrill`, `DRILL_TRIES` (400, the classic's);
    `HandOptions.pot`, `PracticeHand.pot` and `tries`.
  - `phaseOf`: in a drill your preflop turn is `{kind: "auto"}`, played by Advisor.play for your seat as the
    opponents' moves are (the charts), recorded as a move, never a decision: nothing preflop is graded in a drill.
  - `offDrill(hand)`, the classic `offDrill`: you folded, an all-in, more raises than the pot has, someone outside the
    blinds in a blind-vs-blind pot, the hand over, or the flop reached by other than two players or with another
    number of raises. `redeal(hand, seed, opts)`: the same hand number (your seat stays), another deal, `tries` + 1.
    `seeking(hand)`: still dealing the drill's preflop.
  - `seatFor`: blind vs blind puts you in a blind (the one chosen, else moving from the small blind, or at random).
- `PracticePage.tsx`: `commit` deals an off-course hand again before anything is counted (after 400 deals it says
  so, with "Try again"); the drill's preflop moves go by with no pause; "Dealing a 3-bet pot: the preflop is played
  for you (deal N)…" while it deals; the session record keeps `pot`. The "Not here yet" note no longer lists them.
- `features/history/history.ts`: a drill session's row says its pot ("2 players · 100bb · 3-bet pots").

### Tests actually run

| Suite | Result |
|---|---|
| Web (Vitest) | 358/358 in 58 files (`practice.test.ts`: the auto phase, on and off course for each pot, the blinds' seats, the redeal; `PracticePage.test.tsx`: a heads-up single-raised drill whose first deal is a limp, dealt again, then raised and called, played from the flop, one decision graded and the session kept under "SRP"). |
| Typecheck and ESLint | clean |
| Build | passes |

### Checked in the browser (local build, the real in-browser engine)

6-max, 3-bet pots: your BTN open and your call of the small blind's 3-bet played for you, the big blind folding; on
5c5s3c facing a bet, your call graded Best under "Precomputed solution · 3bp_sb_btn · 0.14% pot from equilibrium …
(converged)"; the turn answered. Blind vs blind: "Dealing a blind-vs-blind pot…", then the small blind's raise to 3
and the call, and your flop options.

### Precompute builds

Untouched (read-only `ps`). Everything ran under `nice`. Memory 61% free.

### Next

- Phase 1, still open: multitabling, carried chips, sizes of your own, antes and straddles, the 20-hand engine check.
- Phase 6, still open: multiway locks after the flop (an engine change), the local server option (after its patch).
- Phase 7, still open: a satellite-aware preflop, tournaments in Practice.

## 2026-11-03: Phase 1, an ante and a straddle in Practice (second session)

Deploy of 676553f (the drill modes) verified live: run 41708661006 passed; `/lizard/` serves `index-DhjhcDE9.js`.

A Practice session now takes an ante and a straddle, which the table engine (`poker/table.ts` `TableSetup`) and the
hand-history parser already had.

### Code

- `web/src/features/practice/practice.ts`: `HandOptions.ante` and `straddle`, kept on each `PracticeHand` (the
  straddle only at 3 or more players); `setupOf(hand)` gives the table its `ante` and `straddle`, and the engine's
  `play` request and the Study link (`studyOf`: `ante=0.25&straddle=1`) carry the same game.
- `features/practice/history.ts`: a kept hand's history posts every seat's ante after the seat lines and the
  first seat's `posts straddle 2` after the big blind, so Analyze reads back the same game.
- `PracticePage.tsx`: the setup's Ante (0–1bb, the Solve page's `LIMITS.ante`) and Straddle (disabled under 3
  players); the header says "· ante 0.2 · straddle"; the session record keeps both. The page says preflop is then
  answered from the engine's chart for that game, still the charts and approximate. An engine probe (the classic
  Advisor with a 0.2 ante, then a straddle) showed the preflop answer's note as "the 100bb, 0.2bb ante chart (the
  100bb chart moved by solves of this game)", source `charts`, so the provenance badge stays "Preflop charts ·
  approximate".
- `features/history/history.ts`: a session's row names its ante and straddle.

### Tests actually run

| Suite | Result |
|---|---|
| Web (Vitest) | 361/361 in 58 files (`practice.test.ts`: the posts, pot and first to act, the request and the Study line; `history.test.ts`: the posts written and read back as the same game; `PracticePage.test.tsx`: 3-max with a 0.1 ante and the straddle, every request carrying both, the session kept with them). |
| Typecheck and ESLint | clean |
| Build | passes |

### Checked in the browser (local build, the real in-browser engine)

6-max preflop only, from CO, ante 0.2 and the straddle: "Hand 1 · 6-max · 100bb · ante 0.2 · straddle", UTG at 97.8
after posting 2, HJ first to act, pot 4.7bb; the fold graded Best under "Preflop charts · approximate"; "Open this
spot in Study" to `p=6&s=100&pre=HJ%3Af&ante=0.2&straddle=1`; History's row "6 players · 100bb · ante 0.2 · straddle
· preflop only · seat CO".

### Precompute builds

Untouched (read-only `ps`). Everything ran under `nice`.

### Next

- Phase 1, still open: multitabling, carried chips, sizes of your own, the 20-hand engine check.
- Phase 6, still open: multiway locks after the flop (an engine change), the local server option (after its patch).
- Phase 7, still open: a satellite-aware preflop, tournaments in Practice.

## 2026-11-03: Phase 1, chips carried from hand to hand in Practice (second session)

Deploy of 8035291 (ante and straddle) verified live: run 41709905220 passed; `/lizard/` serves `index-Dp9Sk-86.js`,
which has "posts straddle 2".

Practice's "Carry chips" is the classic Table mode's ring game (`practice.js:99-132`).

### Code

- `web/src/features/practice/practice.ts`:
  - `HandOptions.carry`, and `carries(opts)`: only full hands with your seat moving (each player keeps a seat).
  - `PracticeHand.stacks` (each seat's chips as the hand starts) and `rebuys`; `setupOf` gives the table each seat's
    own chips, `stateFor` sends `stacks` (the seats off the starting stack) and `studyOf` puts them in the Study
    link's setup (`stacks=SB:99,BB:101`).
  - `chipsAfter(hand)`: each seat's chips as the hand ends. After your fold with others still in, they settle as if
    the rest checked it down on the board dealt (the classic's `finish`: each wins at most what it put in from each).
  - `nextTable(hand)`: your seat moves one place, so each player's chips move with it (the small blind's are the next
    button's); a seat under `REBUY` (a quarter) of the starting stack rebuys to it. `following(hand, seed, opts,
    reset)`: the session's next hand (with `reset`, every seat back at the start).
- `PracticePage.tsx`: the setup's "Carry chips" (disabled for preflop only, a drill's pot or a seat that doesn't
  move); under the seats, "Chips carried: your stack 100bb → 97.5bb", who rebought, and "Reset stacks" (between
  hands); the session record keeps `carry`; the "Not here yet" note now lists sizes of your own, running a hand out
  after your fold, and multi-tabling.
- `features/history/history.ts`: the row says "· chips carried".
- Also fixed: Practice's verdict headline said "the solver's best was …" whatever answered the spot, the preflop
  charts included (against CLAUDE.md's rule); it now names the answer's source as the why line does ("the chart's
  best was fold"; `grade.ts` `whoOf`).

### Tests actually run

| Suite | Result |
|---|---|
| Web (Vitest) | 365/365 in 58 files (`practice.test.ts`: when chips carry; a heads-up hand carried to the next, its request and Study link; a fold settled as a check-down; the rebuy; 60 random hands at each of 2, 3, 6 and 9 players, every chip kept and yours following you; `history.test.ts`: each seat's own chips written and read back; `PracticePage.test.tsx`: a carried heads-up session, the next hand's requests with `stacks`, the headline naming the chart). |
| Typecheck and ESLint | clean |
| Build | passes |

### Checked in the browser (local build, the real in-browser engine)

3-max with chips carried: your button fold settled the blinds' check-down (big blind 100.5, small blind 99.5); next
hand the old small blind's 99.5 was the button's and the old big blind's 100.5 the small blind's. You in the big
blind called an open; the A♠7♠6♠ flop, at 99.5 against 100, was graded under "Live solve · 0.10% pot from equilibrium
in the solved game (converged)" (the 100bb library doesn't hold it); a fold to a bet took your stack to 97.5, and the
third hand dealt each player's chips to its new seat. The Study link carried `stacks=SB%3A97.5%2CBB%3A102.5`.
History: "3 players · 100bb · chips carried … net −3bb". At 6-max: "the chart's best was fold"; Reset stacks dealt
hand 2 at 100 each. 375px: no horizontal scroll.

### Precompute builds

Untouched (read-only `ps`). Everything ran under `nice`. Memory 61% free.

### Next

- Phase 1, still open: multitabling, sizes of your own, the 20-hand engine check.
- Phase 6, still open: multiway locks after the flop (an engine change), the local server option (after its patch).
- Phase 7, still open: a satellite-aware preflop, tournaments in Practice.

## 2026-11-03: Phase 1, your own bet sizes in Practice (second session)

Deploy of 8dfc13d (chips carried) verified live: run 41712011063 passed; `/lizard/` serves `index-BS51yRHb.js`, which
has "Carry chips".

Practice's setup takes "Your own bet sizes", as the classic page sends its sizes setting with each practice request
(`index.html` `payload`: `S.sizes`, from the flop on).

### Code

- `web/src/features/practice/practice.ts`: `HandOptions.sizes` and `PracticeHand.sizes` (the Solve page's
  `{flop|turn|river|raise: [% of pot]}`); `stateFor` sends them once the flop is out (so preflop's answer and its
  cache are the same), `studyOf` puts them in the Study link's setup (`sz.flop=50`).
- `PracticePage.tsx`: a "Your own bet sizes" section in the setup (four fields, checked with the Solve page's
  `setupProblems`: up to 3 a street, 5–500% of the pot; a problem disables New session; unused preflop only); the
  table header says "your sizes: flop bets 50%"; the session record keeps `sizes`. The note says the flop library
  answers only where its tree has the same sizes, else the flop is solved live: `flop_library.py` `solution`
  compares `tree_key(cfg)["sizes"]` with the entry's and returns nothing on a difference.
- `features/solve/setup.ts`: `numsOf` (the size fields' parser) moved here from `SolvePage.tsx`, shared.
- `features/history/history.ts`: the row says "· your own sizes".

### Tests actually run

| Suite | Result |
|---|---|
| Web (Vitest) | 367/367 in 58 files (`practice.test.ts`: kept with the hand, none preflop, sent on the flop, the Study line; `PracticePage.test.tsx`: a size over 500% refused, then a heads-up session whose preflop requests have no sizes and whose flop requests do, the header, the Study link, the session kept with them). |
| Typecheck and ESLint | clean |
| Build | passes |

### Checked in the browser (local build, the real in-browser engine)

Heads-up, flop bets 50%: "Hand 1 · heads-up · 100bb · your sizes: flop bets 50%"; after a 3-bet called, the big
blind bet 10 into 20 on T♠4♠3♠; your fold was graded Blunder (8.76bb, 29.2% of the pot) under "Live solve · 0.04%
pot from equilibrium in the solved game (converged) · 300 iterations", and the Study link carried `sz.flop=50`.

### Precompute builds

Untouched (read-only `ps`). Everything ran under `nice`. Memory 59% free.

### Next

- Phase 1, still open: multitabling, the 20-hand engine check.
- Phase 6, still open: multiway locks after the flop (an engine change), the local server option (after its patch).
- Phase 7, still open: a satellite-aware preflop, tournaments in Practice.

## 2026-11-03: Phase 1, a rake in Practice (second session)

Deploy of fb7ad21 (your own sizes) verified live: run 41712801612 passed; `/lizard/` serves `index-Cb7rVhKg.js`,
which has "Your own bet sizes".

Practice's setup takes a rake and its cap, as the classic page sends its Rake setting with each practice request.

### Code

- `web/src/features/practice/practice.ts`: `HandOptions.rake` (% of the pot) and `rakeCap` (bb), kept on the hand
  as the table engine's `Rake`; `finish` and `chipsAfter` settle with it (`table.ts` `settle`: no flop no drop, the
  cap); `HandResult.rake` is what it took; `stateFor` sends `rake` (a fraction) and `rake_cap`; `studyOf` puts them in
  the Study link (`rake=5&cap=3`).
- `features/practice/history.ts`: the summary's "Total pot X | Rake Y" (it was always "Rake 0").
- `PracticePage.tsx`: Rake (0–25%, the Solve page's `LIMITS.rakePct`) and its cap in the setup row; the header says
  "rake 5% (cap 3bb)"; the session record keeps both. `features/history/history.ts`: "· rake 5%".

### Tests actually run

| Suite | Result |
|---|---|
| Web (Vitest) | 369/369 in 58 files (`practice.test.ts`: no flop no drop, 5% of 6bb capped at 0.2, the chips after, the request and Study line; `history.test.ts`: the summary; `PracticePage.test.tsx`: a 30% rake refused, every request with `rake` 0.05 and `rake_cap` 3, the session kept with them). |
| Typecheck and ESLint | clean |
| Build | passes |

### Checked in the browser (local build, the real in-browser engine)

Heads-up, rake 5% capped at 3bb: "Hand 1 · heads-up · 100bb · rake 5% (cap 3bb)"; your raise took the blinds whole
("You won 1bb"); a later flop decision was graded under "Live solve · 0.09% pot from equilibrium … (converged)".

### Precompute builds

Untouched (read-only `ps`). Everything ran under `nice`. Memory 60% free.

### Next

- Phase 1, still open: multitabling, run-it-out after your fold, the 20-hand engine check.
- Phase 6, still open: multiway locks after the flop (an engine change), the local server option (after its patch).
- Phase 7, still open: a satellite-aware preflop, tournaments in Practice.

## 2026-11-03: Phase 1, run it out after your fold (second session)

Deploy of ee2b734 (the rake) verified live: run 41713409282 passed; `/lizard/` serves `index-Blh5iBIG.js`, which has
"Rake cap".

After your fold, Practice offers the classic trainer's run-out (`practice.js` `runOut`, `endRun`).

### Code

- `web/src/features/practice/practice.ts`:
  - `PracticeHand.run`: "played" (the others play on) or "shown" (everyone's cards).
  - `runKind`: what's on offer after your fold. It is "played" where two or more are still in, else "shown". It
    offers nothing in a preflop-only hand, or once asked.
  - `phaseOf`: deals and opponents' moves go on through a run-out until the hand ends.
  - `stateFor(h, seat)`: the request from that seat's own view, as the classic sends `hero: p` for a run-out.
  - `runEnd`: the run-out settled as it went (pays, winners, rake, the showdown line).
  - `chipsAfter`: a finished run-out settles as played, not as a check-down.
  - `boardShown`, `shownCards`: the whole board and every hand once shown.
  - Your `result`, the score and the grades stay as they were at your fold.
- `PracticePage.tsx`:
  - The "Run it out" and "Show hands" buttons.
  - The hand loop's `spotKey` includes `run`. Without it, the loop never moved after the button.
  - The status line says "· running it out…", then "· run out: …".
  - A seat's won chips come from the run-out.
  - A folded seat shows its cards once they are shown.
  - The "Not here yet" note had gone stale since the sizes commit. It now names only multi-tabling.
- `features/practice/history.ts`: a finished run-out writes its showdown (the seats still in), who collected what and
  the total pot. The summary says "You folded: the others played the rest of the hand by their strategies."
- A hand kept at your fold by "Keep every hand" stays as it was kept, because `addHands` skips ids already kept.

### Tests actually run

| Suite | Result |
|---|---|
| Web (Vitest) | 373/373 in 58 files. `practice.test.ts`: a run-out to a showdown and one ended by a fold, the chips, each seat's own request, "Show hands", none before the fold or preflop-only. `history.test.ts`: a run-out round-trips through the importer with its showdown, pot and summary. `PracticePage.test.tsx`: fold, then Run it out; four opponent requests, each with `hero` = its seat; "You folded · run out: SB took the pot"; every seat's cards shown. |
| Typecheck and ESLint | clean |
| Build | passes |

### Checked in the browser (local build, the real in-browser engine)

- **3-max, button fold, Run it out.** The small blind raised to 3 and the big blind called. Both checked the flop.
  The big blind bet 4.5 on the turn and the small blind folded. The result read "You folded · run out: BB took the
  pot", with "won 6" and both hands shown.
- **Heads-up, Show hands.** It showed the big blind's two cards and all five board cards, and the button went away.
- **Stress run.** Six hands of fold, Run it out or Show hands, then Next hand mid-run, plus a tab switch and
  client-side navigation through every page. The current bundle logged no console error.
- **Older console errors.** The console still held two "l is not a function" errors from earlier local bundles,
  thrown from a passive-effect cleanup on unmount. Every `useEffect` in the source returns a function or nothing.
  I could not reproduce them with this build.
- **Phone width.** The result row fits at 375px with no horizontal overflow.

### Precompute builds

Untouched; checked only with read-only `ps`. Everything ran under `nice`. Memory stayed 55–58% free.

### Next

- Phase 1, still open:
  - multitabling
  - the 20-hand engine check
  - three classic trainer pieces: Review mistakes, the range grid at your last decision, and asking ahead for your
    likely lines
- Phase 6, still open: multiway locks after the flop (an engine change), the local server option (after its patch).
- Phase 7, still open: a satellite-aware preflop, tournaments in Practice.

## 2026-11-03: Phase 1, Review mistakes in Practice (second session)

Deploy of ef85136 (run it out) verified live: run 41715465487 passed; `/lizard/` serves `index-CkiCpVXa.js`, which
has "Run it out".

Practice gets the classic trainer's "Review mistakes" (`practice.js:847-866`).

### Code

- `web/src/features/practice/review.ts` (new):
  - `reviewed` keeps a decision with its spot: the hand's number, your seat and cards, the board out, and the
    street's action before you ("UTG raises to 2.5, CO calls", "folded to you", "first to act").
  - `withReviewed` keeps the last 60 graded decisions.
  - `mistakes` picks the 6 that cost the most. It counts a decision that wasn't the best and either gave up EV or
    was graded below Correct. It sorts by EV given up, then by the rarest in the mix, then by the newest. These are
    the classic's rules.
- `practice.ts`: `sayMove`, the move in words. It moved out of the page's hand log so both use it.
- `PracticePage.tsx`:
  - The session keeps `review`, so a new session starts its own list.
  - "Review mistakes (n)" sits under the hand log.
  - Each row shows the hand and street, your cards, your move, the verdict, the EV lost (or how often the chart
    plays it) and the answer's source, with the full provenance on hover.
  - A row opens the spot and the decision's verdict (`DecisionView`, which now takes a title).

### Tests actually run

| Suite | Result |
|---|---|
| Web (Vitest) | 377/377 in 59 files. `review.test.ts`: the spot's line, the 60 kept, the order and the cap of 6. `PracticePage.test.tsx`: a flop check in the mix that gave up 0.2bb listed as "Correct · 0.20bb lost · Live solve", opening "· BB checks" and its verdict; a new session clears the list. |
| Typecheck and ESLint | clean |
| Build | passes |

### Checked in the browser (local build, the real in-browser engine)

- **Review list.** Fifteen random heads-up decisions gave "Review mistakes (6)". The costliest was a turn fold of
  trips facing a raise: "Blunder · 37.89bb lost · Live solve".
- **Opened row.** It showed "BTN/SB · 5♥10♣8♣10♠ · BB checks, You bet 3.5, BB raises to 16.5" and the verdict under
  "Live solve · 0.16% pot from equilibrium … (converged)".
- **Console and phone width.** No console error. No overflow at 375px.

### Precompute builds

Untouched; checked only with read-only `ps`. Everything ran under `nice`. Memory 62% free.

### Next

- Phase 1, still open:
  - multitabling
  - the 20-hand engine check
  - the range grid at your last decision
  - asking ahead for your likely lines
  - the Recent decisions list
- Phase 6, still open: multiway locks after the flop (an engine change), the local server option (after its patch).
- Phase 7, still open: a satellite-aware preflop, tournaments in Practice.

## 2026-11-03: Phase 1, your range at your last decision (second session)

Deploy of 6486d0e (Review mistakes) verified live: run 41716340882 passed; `/lizard/` serves `index-DqcdfRxn.js`,
which has "Your biggest mistakes".

Practice gets the classic trainer's "Your range" (`practice.js:385`, `:976`). It shows how the answer at your last
decision plays your whole range.

### Code

- `web/src/features/practice/practice.ts`:
  - `rangeAt` takes the answer's `grid` at your spot, with your hand's class and a label ("Your range · flop · BTN
    vs BB", "UTG vs 5 players").
  - It returns none without a grid, or from the betting rules or an equity estimate. The classic leaves out its
    heuristic answers too.
- `PracticePage.tsx`:
  - The last-decision panel adds a collapsed "Your range · …". It sits under the same answer's badge.
  - It draws the grid with Study's `RangeMatrix`, with a legend.
  - Your hand is picked. Any hand picked shows its mix in words, with its share of combos when it isn't whole.
  - Opening it carries over from decision to decision.
  - `DecisionView` takes children.

### Tests actually run

| Suite | Result |
|---|---|
| Web (Vitest) | 379/379 in 59 files. `practice.test.ts`: the label preflop and on the flop, "vs 5 players", none for rules, equity or no grid. `PracticePage.test.tsx`: the stub's chart answer with a grid; the panel closed until asked; 169 cells; your class's mix; 72o's mix and "50.0% of its combos"; none on a flop answer without a grid. |
| Typecheck and ESLint | clean |
| Build | passes |

### Checked in the browser (local build, the real in-browser engine)

- **Every street has a grid.** Heads-up, there was a grid on every street. Preflop was under "Preflop charts ·
  approximate". The flop, turn and river were under "Live solve · 0.13–0.14% pot from equilibrium … (converged)".
- **River.** The river read "62o (your hand): call 100.0% · 0.3% of its combos in the range".
- **Kept open.** The grid stayed open into the next hand's preflop: "A2s (your hand): raise 100.0%".
- **Console and phone width.** No console error. No overflow at 375px.

### Precompute builds

Untouched; checked only with read-only `ps`. Everything ran under `nice`. Memory 57% free.

### Next

- Phase 1, still open:
  - multitabling
  - the 20-hand engine check
  - asking ahead for your likely lines
  - the Recent decisions list
- Phase 6, still open: multiway locks after the flop (an engine change), the local server option (after its patch).
- Phase 7, still open: a satellite-aware preflop, tournaments in Practice.

## 2026-11-03: Phase 1, Recent decisions in Practice (second session)

The classic trainer's "Recent decisions" (`practice.js:867-873`) is now in Practice.

### Code

- `review.ts`: `recent` returns the last 8 kept decisions, newest first.
- `PracticePage.tsx`:
  - The panel is now "Your decisions". While the mistakes list is closed it shows "Recent decisions". Opened, it
    shows "Your biggest mistakes". Both use the same rows.
  - A row with nothing given up says "no EV lost", not "0.00bb lost".

### Tests actually run

| Suite | Result |
|---|---|
| Web (Vitest) | 380/380 in 59 files. `review.test.ts`: the last 8, newest first. `PracticePage.test.tsx`: the flop row "Correct · 0.20bb lost · Live solve" above the preflop row "Best · played 70.0% · Preflop charts". |
| Typecheck and ESLint | clean |
| Build | passes |

### Checked in the browser (local build, the real in-browser engine)

- **6-max.** Ten random decisions gave eight rows, newest first. Preflop rows read under "≈ Preflop charts". A
  heads-up flop, turn and river read under "Live solve".
- **Heads-up.** A hand called down with 8♠5♥ listed the river, turn and flop as Blunders (42.85, 6.09 and 2.10bb
  lost) and the preflop calls as Mistakes.
- **Console.** No console error.

### Precompute builds

Untouched; checked only with read-only `ps`. Everything ran under `nice`.

### Next

- Phase 1, still open:
  - multitabling
  - the 20-hand engine check
  - asking ahead for your likely lines (prefetching solves; weigh its CPU against the benefit)
- Phase 6, still open: multiway locks after the flop (an engine change), the local server option (after its patch).
- Phase 7, still open: a satellite-aware preflop, tournaments in Practice.

## Phase 2, an EV-lost filter in Analyze (2026-11-03)

Recent decisions (243f92d) deployed: run 41717522562 succeeded; the live bundle `index-DnbzyP2k.js` has "Recent
decisions".

### What changed

- **The filter.** The hands table takes an "EV lost" filter: 0.1, 0.5, 1, 2, 5 or 10bb or more (`analyze.ts`
  `LOST_STEPS`). A hand's EV lost is the sum of what its graded decisions gave up (`lostByHand`, from `evLossBb`).
  - Only grades by EV have it: the flop library's. The preflop charts grade by frequency, so a hand graded only
    preflop never passes. The select's title says so.
  - It sits in the URL as `lost` with the other filters. It applies to the report, the leak drill and the stats.
  - A leak drill's link and title carry it ("EV lost ≥ 2bb", `leakDrill.ts`).

### Tests actually run

| Suite | Result |
|---|---|
| Web (Vitest) | 380/380. `stats.test.ts`: `lostByHand` sums losses and skips none or zero; `filterHands` with `lost`. `leakDrill.test.ts`: the about text. `AnalyzePage.test.tsx`: of 4 graded hands, the one with a 0.12bb flop mistake at 0.1bb, none at 0.5bb. |
| Typecheck and ESLint | clean |
| Build | passes |

### Checked in the browser (local build)

- 46 kept hands, 3 EV-graded decisions, each 0bb lost: none at every step; Clear filters brought back all 46.
- No positive case in the local data (no flop decision with a loss); the tests cover it.

### Precompute builds

Untouched; checked only with read-only `ps`. Everything ran under `nice`.

### Next

- Phase 2, still open: turns and rivers, a history across sessions, realized results, a dropped folder.
- Phase 1, still open: multitabling, the 20-hand engine check, asking ahead.

## Phase 4, painting a group of hands in the range builder (2026-11-03)

The EV-lost filter (67c9e28) deployed: run 41718340113 succeeded; the live bundle `index-Cym_LNup.js` has "bb or
more".

### What changed

- **Groups.** Study's builder ("✎ Build") paints or locks a group of hands at once, as one undo step. A select
  under the brushes picks the group; the button says how many hands it paints ("Paint 3 hands") and its title lists
  them.
  - **Shapes**, at any node, preflop too (`build.ts` `SHAPES`): pairs, suited, offsuit, broadways (both cards T+, no
    pairs), ace-x, suited connectors (AKs to 32s).
  - **Categories**, where the answer has its combos (the made-hand and draw categories of Study's filter): a paint
    can't split a class, so a class goes whole when at least half its combos in the range (by reach) are in the
    category (`filters.ts` `classesIn`).
  - Locked hands are left out of a paint. With the lock tool the button locks the group, or unlocks it when all of it
    is locked.

### Tests actually run

| Suite | Result |
|---|---|
| Web (Vitest) | 383/383 in 59 files. `filters.test.ts`: `classesIn` by reach, half in, none for "No draw". `build.test.ts`: the shapes' hands. `BuildMode.test.tsx`: the select's groups, top pair painted and undone in one step, flush draws locked and unlocked, preflop with shapes only. |
| Typecheck and ESLint | clean |
| Build | passes |

### Checked in the browser (local build, the library's srp_btn_bb)

- **Kd7c2h, BTN after a check.** Set: 22 77 KK. Two pair: K2s K7s K7o. Top pair, top kicker: AKs AKo. Middle pair: 15
  hands, A7s and A7o among them.
- **Painting.** Set, two pair, overpair and top pair, top kicker painted bet 75%: 7.1% of the range. Undo and redo
  took one group each.
- **Locking.** Middle pair locked (15 hands). Then "Paint 0 hands" was disabled and Fill all skipped them. Scored
  45.6% under the precomputed badge.
- **Preflop (UTG, charts).** Shapes alone; suited connectors painted raise. 375px fits with no horizontal scroll.
- **Console.** Its only errors came from bundles older than the build under test.

### Precompute builds

Untouched; checked only with read-only `ps`. Everything ran under `nice`.

### Next

- Phase 4, still open: single-combo syntax, text import into the builder.
- Phase 2, still open: turns and rivers, a history across sessions, realized results, a dropped folder.

## Phase 4, single combos and the solver's range syntax (2026-11-03)

### What changed

- **The parser.** `rangeText.ts` reads range text as the solver does (`solver/gto/ranges.py`). That covers:
  - commas or spaces between hands, and spaces around a weight's `:`;
  - any case, and either rank order (`KAs`);
  - gap runs (`T9s-65s`) beside the kicker runs, and `random` / `any` / `100%`;
  - a hand named twice keeping its larger weight.
- **Single combos.** The editor and the builder hold whole classes, so a combo is kept as its share of the class:
  `AhKh` is AKs at 0.25, beside the class's own weight. `parseRange` returns the combos it read that way.
  - The Ranges page says so under the text.
  - The Solve page sends the text itself, so a solve keeps its combos. Its check no longer special-cases combos.

### Tests actually run

| Suite | Result |
|---|---|
| Web (Vitest) | 386/386. `rangeText.test.ts`: the solver's syntax, runs, rejects, combos as shares. `SavedPage.test.tsx`: Apply text with `qq+ AhKh KdAd, xyz` (20 combos, the note, "Not understood: xyz"). `setup.test.ts` and `SolvePage.test.tsx` unchanged and passing. |
| Typecheck and ESLint | clean |
| Build | passes |

### Checked in the browser (local build)

- Ranges: `jj+ T9s-65s AhKh,AsKs 7c7d:0.5 kq` gave `AA,AKs:0.5,KK,KQs,KQo,QQ,JJ,T9s,98s,87s,77:0.083,76s,65s`.
  That is 62.5 combos, with the single-combos note.

### Next

- Phase 4: text import into the builder.

## Phase 4, range text in the builder (2026-11-03)

### What changed

- **Paint from text.** Study's builder has "As range text" under the groups: hands typed in the solver's syntax take
  the current brush, each at its weight ("AKs:0.5": half of AKs plays it; no weight: all of it), as one undo step.
  - Locked hands and hands out of the range are left as they are. The status line counts them, any single combos
    (painted as their class's share) and anything not understood.
  - The Lock tool can't paint from text; "Paint these" is disabled while it is picked.
- **Back to text.** "Your bet 33% hands" fills the box with the hands that play the brush's action at their shares
  (`build.ts` `actionShares`, `paintWeights`).

### Tests actually run

| Suite | Result |
|---|---|
| Web (Vitest) | 388/388. `build.test.ts`: `paintWeights` (locked and out-of-range skipped), `actionShares`. `BuildMode.test.tsx`: text painted and undone in one step, the status line, a locked hand kept, a combo as a quarter of 72s, an action's hands as text. |
| Typecheck and ESLint | clean |
| Build | passes |

### Checked in the browser (local build, srp_btn_bb at Kd7c2h)

- `KK, 77, 22, AK, KQ:0.5, A5s:0.5 AhQh 72o` with bet 33%: "Painted 9 hands bet 33%; 1 not in this range; single
  combos as their share of the class." AQs read 25% bet 33%.
- "Your bet 33% hands" gave `AKs,AQs:0.25,A5s:0.5,AKo,KK,KQs:0.5,KQo:0.5,77,22`.
- **Console.** Its only errors came from bundles older than the build under test.

### Precompute builds

Untouched; checked only with read-only `ps`. Everything ran under `nice`.

### Next

- Phase 4: painting single combos (the builder grades classes).
- Phase 2, still open: turns and rivers, a history across sessions, realized results, a dropped folder.
- Phase 3, still open: turn and river runout reports, a chart view, IP facing a lead, 3-way spots.

## Phase 3, a chart view of the flop reports (2026-11-03)

Range text in the builder (ba4111d) deployed: run 41720341757 succeeded; the live bundle `index-sadh4ukL.js` has
"Paint these". The range syntax (cfa2a81): run 41719772383, `index-eggW3gJ2.js`.

### What changed

- **Table or Chart.** Reports has a Table / Chart switch, in the URL as `show=chart` (`ReportChart.tsx`). The chart
  draws the rows the table shows: same spot, decision, filters and order.
  - **The flops.** Every flop shown is one column of its action mix, first action at the bottom, in the table's
    order. Sorted by an action, it shows how that action spreads over the flops. Columns aren't weighted; the caption
    says so (the averages are).
  - **Each action is one stepped shape** across the columns (`stepArea`). Drawing 1,755 columns under a pixel wide
    as rectangles left seams.
  - **Hover and click.** Hovering a column shows its flop, mix and both EVs. A click opens that flop in Study at the
    decision.
  - **Groups.** With a grouping, each texture group is a column of its weighted average, with a tooltip. A click
    shows only that group's flops, as the table's group button does.
  - **Legend.** The action legend is always shown. The table stays as the view with every number.
- **Palette check (dataviz validator).** The app's action colours on the dark surface:
  - check `#2bb39a` and bet1 `#f2c14e` sit outside the categorical lightness band;
  - bet3 `#e8613c` and bet4 `#d23c4b` are close (normal-vision ΔE 9.2) when a spot has four bet sizes.
  - The shades are a deliberate small-to-large ramp, used app-wide, so they're unchanged. The chart leans on its
    legend, tooltips and the table. Worth a design decision if four-size spots become common.

### Tests actually run

| Suite | Result |
|---|---|
| Web (Vitest) | 391/391. `ReportsPage.test.tsx`: the switch in the URL, the legend, the strip's summary, each of the 7 fixture flops hovered in check order with its mix, a click to Study; groups by pairing, hover, a click filtering to Unpaired; back to the table; `stepArea`'s shapes. |
| Typecheck and ESLint | clean |
| Build | passes |

### Checked in the browser (local build, srp_btn_bb, 1,755 flops)

- **All three decisions.** BB first by high card, sorted by check; then by suits, sorted by bet 33%. BB vs bet by
  high card: raising grows from 7.6% on A-high flops to 16.7% on 9-high or lower.
- **Hover.** The first column sorted by bet 33% showed 6♣5♣3♦: check 87.3%, bet 33% 10.7%, bet 75% 2.0%.
- **375px.** No horizontal scroll. The group labels wrap ("9 high / or lower") instead of being cut.
- **Console.** Its only errors came from bundles older than the build under test.

### Precompute builds

Untouched; checked only with read-only `ps`. Everything ran under `nice`.

### Next

- Phase 3, still open: turn and river runout reports (live solves), in position facing a lead, 3-way spots.
- Phase 2, still open: turns and rivers, a history across sessions, realized results, a dropped folder.
- Phase 1, still open: multitabling, the 20-hand engine check, asking ahead.


## Phase 3, in position facing a first bet in the flop reports (2026-11-03)

The chart view (4f3ce4f) deployed: run 41720991320 succeeded, and the live bundle `index-Bzi7pSiC.js` has the chart.

### What changed

- **A fourth decision in Reports.** The new view is in position facing out of position's first bet: a lead, or a
  c-bet where out of position raised preflop. It is labelled "BTN vs bet" (`view=ipvsbet`, `reports.ts`). It works
  like "BB vs bet": each flop's most common size, then fold, call and raise (raises of every size together). Study
  opens at the bet ("BB bet 4.13").
- **What the library stores.** The response to a bet is stored only where the bet is made at least 5% of the time.
  Checked over srp_btn_bb, srp_utg_btn and 3bp_bb_btn: the smallest stored frequency is 0.05, the largest unstored
  0.05. So:
  - **Bet frequency on each row.** A row in either facing view gives its bet and how often it's made ("vs 75%",
    "made 6%"), in the table, the chart's tooltip and the CSV (a new "bet frequency" column).
  - **Partial averages.** An average or group whose strategy comes from only some of its flops says what share:
    "strategy from 8% of them". Its EVs and equities still cover every flop. The chart's group tooltip says the same.
  - **The page note** explains the 5% rule.
  - **Unavailable decisions.** A decision no stored flop has can't be picked (`viewsOf`). The fixture's srp_btn_bb
    stores no lead response.
- **How much each spot stores.** Every live spot stores some of these responses:
  - BB's leads are stored on 119 of srp_btn_bb's 1,755 flops (7.6% of the weight).
  - c-bets in 3-bet pots where out of position raised are stored on almost every flop (3bp_bb_btn 1,754 of 1,755).
- **A tap opens Study.** Clicking a column of the chart now reads the column under the click. Before, it used the
  hovered column, so a tap on a touch screen, which has no move before it, did nothing.

### Tests actually run

| Suite | Result |
|---|---|
| Web (Vitest) | 392/392. `reports.test.ts`: the view's columns, rows, the bet and its frequency; `facingText`; `viewsOf`; the average's stored weight; Study at the bet; the CSV's new column. Every fixture spot renders each decision it stores (3bp_bb_btn all four). `ReportsPage.test.tsx`: the 3-bet pot's c-bet view with its Study link; "BTN vs bet" disabled on srp_btn_bb; the 5% note; a tap on a chart column with no hover. |
| Typecheck and ESLint | clean |
| Build | passes |

### Checked in the browser (local build)

- **srp_utg_btn.** UTG's c-bets were stored on 400 of the 552 flops. The average said "strategy from 72% of them".
- **srp_btn_bb, grouped by high card and sorted by fold.**
  - The strategy comes from 1% of A-high flops and 26% of 9-high or lower.
  - The chart's tooltip showed Tc8d6c: "vs 75%, made 6%", fold 37.9%, call 50.2%, raise 11.9%.
  - A click opened Study at "BB bet 4.13". Study's own answer is a live solve (BB's line is rare, so it uses
    rule-based ranges) and is labelled as one.
- **375px.** The four decision buttons wrap inside the row, with no horizontal scroll.

### Precompute builds

Untouched; checked only with read-only `ps`. Everything ran under `nice`. Free memory 60%.

### Next

- Phase 3, still open: turn and river runout reports (live solves), 3-way spots.
- Practice's drills could add the same decision (`drills.ts` has the first three).
- Phase 2, still open: turns and rivers, a history across sessions, realized results, a dropped folder.
- Phase 1, still open: multitabling, the 20-hand engine check, asking ahead.

## Practice, the same decision in the drills (2026-11-03)

The Reports decision (3b9b482) deployed: run 41722573254 succeeded, and the live bundle `index-pMh27LzY.js` has it.

### What changed

- **A fourth drill.** Drills deal in position facing out of position's first bet, labelled "BTN faces BB's bet"
  (`view=ipvsbet`, `drills.ts`). Each stored size is drawn by how often it's made.
- **The situation.** It reads "BB bets 33% (1.82bb) · pot 7.32bb". Before, any path with a bet in it was read as
  "BB checks, BTN bets".
- **Study.** The drill opens Study at the bet.
- **History.** It names the drill "…, in position facing a bet".
- **Where it's stored.** The library's entries store the node with in position to act (checked in the fixture's
  3bp_bb_btn entries: paths `bet 33%` and `bet 75%`, player 1).

### Tests actually run

| Suite | Result |
|---|---|
| Web (Vitest) | 393/393, and a History check of the new wording. `drills.test.ts`: the draws split by bet frequency (4% and 6%: 40 and 60 of the flop's 100); which fixture spots store it; dealing from in position's range on 3bp_bb_btn; the situation and the Study line. `DrillsPanel.test.tsx`: the 3-bet pot's c-bet drill: fold and call, the bet said, Study at it. The snapshot library has draws for every spot at all four decisions. |
| Typecheck and ESLint | clean |
| Build | passes |

### Checked in the browser (local build)

- **srp_btn_bb.** "119 store this decision", matching the report. One hand was dealt and answered:
  - The hand was A-K against BB's 33% bet on 9-8-8.
  - Calling was graded Best, with no EV given up, under the library's provenance.
  - The answer offered "Open in Study" at `flop=BB:b1.82`.

### Precompute builds

Untouched; checked only with read-only `ps`.

### Next

- Phase 3, still open: turn and river runout reports (live solves), 3-way spots.
- Phase 2, still open: turns and rivers, a history across sessions, realized results, a dropped folder.
- Phase 1, still open: multitabling, the 20-hand engine check, asking ahead.

## Phase 3, turn and river runout reports in Study (2026-11-03)

The drills' fourth decision (a87cbb2) deployed: run 41723091560 succeeded, and the live bundle `index-DWSELjo8.js`
has it.

### What changed

- **Where it shows.** Under Study's deal box, once the flop's or turn's betting closed with chips still to bet:
  heads-up, and 3-way where three saw the flop (`offersReport`). Not after an all-in, not 4-way or more.
- **What it asks first.** "Turn report" (or "River report") asks the engine with `runouts: "held"`: the report from
  what's in hand, at once. On a library flop that's the stored turns, labelled "Stored turn from the flop library"
  (approximate, strategies only). If nothing is held, it says so and offers "Solve the flop (Fast, ~2 s)": classic's
  measured seconds (`RO_SECONDS`, threads counted; the local server uses its budgets). A timer and a Stop button run
  while it solves. Where the stored turns hold other flop lines, a select walks to one and its report opens by itself.
- **The table.** Every card off the board: what it does to the board, the street's first decision there (or in
  position's after a check), both EVs and equities. Sortable on every column; grouped by what the card does, rank or
  suit (a group's click filters to it); filtered to one class. A card's row deals it. The note says what the report
  is read off (classic's wording).
- **Files.** `web/src/features/study/runouts.ts` (the model, classic `runouts.js`), `RunoutPanel.tsx`, and the
  deal branch in `StudyPage.tsx`.

### Tests actually run

| Suite | Result |
|---|---|
| Web (Vitest) | 402/402. `runouts.test.ts` (6): classic's card classes, rows, filters, sorting, groups and averages, stored-turn EVs, the notes, 3-way, the seconds and when it's offered. `StudyPage.test.tsx` (3 new): asking, then solving on request, the 49-card table, the other player's decision, a filter, dealing a card; walking to a stored line and its report opening by itself; no report after an all-in or 4-way. |
| Typecheck and ESLint | clean |
| Build | passes |

### Checked in the browser (local build)

On srp_btn_bb, Kd7c2h:

- **Stored turns.** After check-check the report came back at once from the library (29% of the flop solve).
- **A live solve.** A line the library doesn't hold (BB leads 1.82, BTN calls) was solved live in about 2 s. It was
  labelled Live solve, 0.07%, converged, and the two EVs add to the 9.14bb pot.
- **Groups and dealing.** Grouping by what the card does gave 7.5%, 73.9% and 18.6% of turns. Dealing the Ks from
  its row moved Study to the turn.
- **Walking to a stored line.** Picking "check, bet 2, call" walked there and its report opened by itself.
- **A river report.** Off a live turn solve: 48 cards, and the EVs add to the 5.50bb pot.
- **375px.** No horizontal page scroll; the table scrolls in its box.

Not checked in a browser: a 3-way report.

### Precompute builds

Untouched; checked only with read-only `ps`. Each browser solve was one Fast solve of a few seconds.

### Next

- Phase 3, still open: 3-way spots in Reports.
- Phase 2, still open: turns and rivers, a history across sessions, realized results, a dropped folder.
- Phase 1, still open: multitabling, the 20-hand engine check, asking ahead.

## Phase 3, 3-way spots in Reports (2026-11-03)

The runout reports (82076dc) deployed: run 41724971687 succeeded, and the live bundle `index-bKnhjige.js` has them.

### What changed

- **Where the numbers come from.** The 3-way library has no `report.json`. Each stored flop's entry header holds the
  range's mix at the three stored decisions, though: first to act, the second after a check, the third after two.
  Reports now reads those headers (`decodeHead`, the body left undecoded) and puts them side by side
  (`web/src/library/mwReport.ts`).
- **Loading.** The 185 files are read eight at a time, with a progress bar ("62 of 185 read…"). That's about 1.3 MB,
  kept for the session and in the HTTP cache. Leaving the spot stops the reads.
- **Weights.** The 3-way flops are the solver's `representative_flops(184)` plus `EXTRA_FLOPS` (K♣7♦2♥), checked in
  Python for all four spots. As `flop_library.report_weights` does for a sample, each sample flop counts 22100/184.
  The extra flop is listed but weighs nothing; the note under the table says so.
- **The page.** The spot picker groups heads-up and 3-way spots. A 3-way spot's decisions are "SB first", "BB vs
  check" and "BTN vs two checks" (`view=third`). There are no EV, equity or EQR columns (the entries hold none), in
  the table, the chart's tooltips or the CSV. A row's Study link plays both checks first. The coverage list names the
  3-way spots.
- **Fixtures.** `make_web_fixtures.py` also copies six of mw_btn_sb_bb's flops and a trimmed `mw_index.json`. The
  heads-up fixtures came out byte-identical.

### Tests actually run

| Suite | Result |
|---|---|
| Web (Vitest) | 405/405. `reports.test.ts`: the fixture's 3-way report (seats, nodes, 5c4d2h's three stored mixes, weights, Study after two checks, the CSV's columns, the provenance label); every 3-way spot of the snapshot builds a report of 184 sample flops plus the extra one, covering every flop, each decision summing to 1. `ReportsPage.test.tsx`: the 3-way page (decisions, columns, a row, the Study link, the note, the picker's groups, the coverage). |
| Typecheck and ESLint | clean |
| Build | passes |

### Checked in the browser (local build)

- **mw_btn_sb_bb.** All 185 flops read, in about 15 s at four at a time from the preview server (~0.4 s a file);
  eight at a time took about 5 s on mw_co_btn_bb.
- **Decisions.** At "BTN vs two checks" the average is 56.3% check, 37.5% bet 33%, 6.2% bet 75%.
- **The extra flop.** K♣7♦2♥'s row (59.1% check, 40.9% bet 33%) opens Study after SB and BB check, where Study
  shows the same numbers from the 3-way library.
- **Grouping.** mw_co_btn_bb, CO after a check, by suits: rainbow 39.7%, two-tone 54.9%, monotone 5.4% of the
  weight, near the true 39.8 / 55.1 / 5.2.
- **The chart.** Tooltips show the mix with no EV line.
- **375px.** No horizontal page scroll.

### Precompute builds

Untouched; checked only with read-only `ps`. No solves.

### Next

- Phase 3: done as listed. Not in it yet: range and nut advantage columns.
- Phase 2, still open: turns and rivers, a history across sessions, realized results, a dropped folder.
- Phase 1, still open: multitabling, the 20-hand engine check, asking ahead.

## Phase 2, your results in Analyze (2026-11-03)

The 3-way Reports (2298871) deployed: run 41726447823 succeeded, and the live bundle `index-CumowVQ9.js` has them
("vs two checks").

### What changed

- **Winnings read** (`web/src/hh/results.ts`). `collected(text, name)` sums a player's winnings lines in every site
  format the importer reads: "collected $x from pot" (PokerStars, GGPoker, Winamax, WPN/ACR; each pot and each board
  of a run-it-twice), 888's "collected [ $x ]", partypoker's "wins $x" and its tournaments' "balance …, collected x",
  Ignition's "Hand result $x", iPoker's `win="€x"`. It's null where no line in the history says who won anything.
  The text goes through the parser's `norm` (now exported), so 888's thousands dots and Ignition's lines read as the
  parser reads them.
- **Stakes as posted.** `paidOf(hand, text)` takes each seat's stake from the history, not the replay: antes and the
  dead half of a dead blind, then each street's total (a live blind its first) less what nobody matched. The replay
  plays a half-big-blind small blind and averages antes; `paidOf` agrees with it on every fixture except the Zoom
  hand's $0.02 small blind (0.4bb, which `paidOf` gets right).
- **A hand's result.** `resultOf(hand, text, pos?)` is collected ÷ bb − paid. A seat that folded collected nothing even
  with no winnings line (Practice's histories stop at your fold). Null with a reason for a hand with no winnings line
  where you didn't fold, and for GG's EV Cashout.
- **The tally** (`web/src/features/analyze/winnings.ts`). Over the hands the filters show, a chunk at a time with a
  cache like the stats: cash games, tournaments and Practice's tables (and the classic app's) apart. Each group has won
  in bb, cash in each currency, bb/100 with a 95% interval from the hands' spread, won at showdown and without, by seat,
  and the running totals in the order played (the history's clock, then the hand number).
- **The panel** (`WinningsPanel.tsx`, above "Your stats"). Four tiles, a note when there are under 10,000 hands, a
  running-total chart and a by-seat table. The chart has three lines (in all, at showdown, without), using the
  dataviz palette's first three slots, validated as a set on the dark surface. It has a legend with each line's end
  value, a zero line, a crosshair tooltip per hand, and a click opens that hand. Over 1,200 hands the lines are drawn
  every k hands; the tooltip still reads every hand.

### Tests actually run

| Suite | Result |
|---|---|
| Web (Vitest) | 415/415. `hh/results.test.ts`: the hero's result in all 23 fixtures; every seat adds up to minus the rake in the 17 whose pots add up (the hand-written GG fixtures' pots don't); `paidOf` against the replay; a big-blind ante (+12.8 / −3.1bb, still zero-sum); a dead blind; a fold with no winnings line; each site's line. `winnings.test.ts`: the tally over every fixture (14 cash, 7 tournament, 2 left out with why; −$45.07 and −€400; the order played); the Practice group; chunks and abort. `practice/history.test.ts`: every Practice hand's result read back from its history equals Practice's own. `AnalyzePage.test.tsx`: the panel on four kept hands, the tooltip and a click opening the hand. |
| Typecheck and ESLint | clean |
| Build | passes |

### Checked in the browser (local build)

- **66 kept hands** (the text fixtures pasted, plus earlier synthetic and Practice hands). Cash games 40 hands: −41.6bb,
  −$86.57 · −€200.00, −104.0 bb/100 (95% range −1136.2 to +928.2), at showdown −0.5bb, without −41.1bb. Tournaments
  7 hands. Practice 3 hands. 15 left out (no winnings line), 1 EV Cashout.
- **The chart.** The tooltip on hand 33 of 40: "BB 7s6s · won, all folded", "This hand +13.30bb", and the three totals.
- **375px.** No horizontal page scroll.

### Precompute builds

Untouched; checked only with read-only `ps`. No solves.

### Next

- Phase 2, still open: turns and rivers, a history across sessions, an all-in EV line, a dropped folder.
- Phase 3: done as listed. Not in it yet: range and nut advantage columns.
- Phase 1, still open: multitabling, the 20-hand engine check, asking ahead.

## Phase 2, the all-in EV line in Analyze's results (2026-11-03)

The results panel (2795111) deployed: run 41729184108 succeeded, and the live bundle `index-CHqmFJrW.js` has it
("Without showdown").

### What changed

- **The all-in** (`web/src/hh/allin.ts`, `allInOf`). A hand qualifies when two players are left, the betting closed
  before the river with one of them all-in, and both hands are in the history. `shownOf` reads "Dealt to N [..]",
  "N: shows [..]" and "Seat 1: N showed [..]" off the parser's normalized lines; GGPoker's and Ignition's every-hand
  "Dealt to" lines count. The EV is your equity times the pot every seat collected, less your stake (`paidOf`).
  Three or more in (side pots), a hand not shown, an all-in on the river or a cut-short board have none.
- **Equity** (`equityVs`). Exact with two cards or fewer to come (990 flop run-outs, 44 turn ones). Preflop uses
  20,000 boards from a generator seeded by the two hands, so the same hand gives the same number every time; it
  takes about 50 ms. A tie counts half.
- **The tally.** Each group adds the all-in EV total, its count, its running line and each hand's all-in. Reading
  now lets the page go every 40 ms as well as every 200 hands, since a preflop all-in takes 50 ms.
- **The panel.** An "All-in EV" tile ("6 all-ins at their equity"), a fourth line, dashed, in the dataviz palette's
  fourth slot (the four validated adjacent on the dark surface; the dash covers the orange–yellow pair), and the
  tooltip's "All-in preflop: 17.6% (sampled) against AdAh, EV −64.78bb". The note above says how it's counted.

### Tests actually run

| Suite | Result |
|---|---|
| Web (Vitest) | 421/421. `hh/allin.test.ts`: no all-in where none, or where the other hand is hidden (iPoker's "X X", party's tournament balances); the flop all-in's 295 of 990 run-outs and its EV; the dead turn all-in at −100; preflop KK v AA and JJ v AK within 0.55% of the exact equities (18.054%, 57.254%, enumerated once over 1,712,304 boards), the same each time; each site's shown hands; ties. `winnings.test.ts`: six cash all-ins and two tournament ones, the totals. `AnalyzePage.test.tsx`: the tile, the line in the chart's label, the dead turn all-in in the tooltip. |
| Typecheck and ESLint | clean |
| Build | passes |

### Checked in the browser (local build)

- **Cash, 40 hands.** All-in EV −452.4bb against −41.6bb won. The difference is −410.8bb, which the fixtures'
  repeats account for: twice KK over AA (+100.5 won, EV −64.78) and twice AsKs against a set on the flop.
  Tournaments: +33.8bb against −24.2bb.
- **The chart.** The dashed line splits from "In all" at the first all-in. Hand 36's tooltip shows the preflop 17.6%
  (sampled) against AdAh.

### Precompute builds

Untouched; checked only with read-only `ps`. No solves.

### Next

- Phase 2, still open: turns and rivers, a history across sessions, a dropped folder.
- Phase 3: done as listed. Not in it yet: range and nut advantage columns.
- Phase 1, still open: multitabling, the 20-hand engine check, asking ahead.

## Phase 2, a dropped folder in Analyze's import (2026-11-03)

The all-in EV line (fcd763f) deployed: run 41730156458 succeeded, and the live bundle `index-Bq-eKi9T.js` has it
("All-in EV", "at their equity"; it's in the main chunk, which the deploy watch's sub-chunk grep missed).

### What changed

- **A dropped folder** (`web/src/features/analyze/dropped.ts`). A drop's entries are taken while the drop event
  lasts (`entriesOf`, through `webkitGetAsEntry`). With a folder among them, every file is read through, subfolders
  and all, a reader's batches looped until an empty one (`droppedFiles`). Each file keeps its path under the folder
  dropped, in order of the paths (numbers as numbers: t2 before t10). A drop of files only is read as before.
- **The import's name** (`analyze.ts`, `filesName`). The innermost folder all the files share, so a dropped or picked
  folder with subfolders is "hh (2 files)", not "2 files".
- **A long list of files folds away.** Past 8 files the per-file counts sit under "Each file (N)", like the
  unreadable hands.
- **The box** says "drop files or a folder here". A folder that can't be read says so.

### Tests actually run

| Suite | Result |
|---|---|
| Web (Vitest) | 427/427. `dropped.test.ts`: a folder read through over stand-in entries handed over two at a time, paths kept, sorted by path with numbers as numbers; a drop of files kept as it is; `entriesOf`. `analyze.test.ts`: the common folder's name. `AnalyzePage.test.tsx`: a dropped folder with a subfolder and a .png ("hh (2 files): 2 hands read…", the subfolder's file listed); nine files folded under "Each file (9)", closed |
| Typecheck and ESLint | clean |
| Build | passes |

### Checked in the browser (local build)

- **A drop of one file** through a real `DataTransfer`: read as before ("drop-test.txt: 1 hand read").
- **A folder** of the browser's own directory entries (Chrome's sandboxed file system, `webkitRequestFileSystem`):
  101 hand files, a .png and `sub/deeper/deep.txt`. Chrome's reader handed over 100 entries in its first batch;
  all 102 hands were read, the .png skipped, the import named "dropfolder (102 files)", the files listed in path
  order under a closed "Each file (102)". The test imports were deleted after (66 hands kept, as before).
- **Not checked:** a folder dragged from Finder. No automation can drive an OS drag into the page; the entries a
  real drag hands over are the same kind of objects as the ones checked.

### Precompute builds

Untouched; checked only with read-only `ps`. No solves.

### Next

- Phase 2, still open: turns and rivers, a history across sessions.
- Phase 3: done as listed. Not in it yet: range and nut advantage columns.
- Phase 1, still open: multitabling, the 20-hand engine check, asking ahead.

## Phase 2, turns and rivers graded in Analyze (2026-11-03)

### What changed

- **Two new scopes** (`grading.ts`). "Every street, Quick triage" sends the classic `"triage": true`: what's in hand
  first (the charts, the library, its stored turns, nearby solutions), else a Quick solve, each read with the Advisor's
  own confidence. "Every street, at Fast" solves what the charts and the library don't answer. The betting rules and
  equity guesses are never graded against, at any scope. A read at once has no EVs, so it's graded by frequency.
- **A check at Fast** (`triage.ts`, the classic `flagged`, `deepen`). A low-confidence read, one off the mix, one losing
  2% of the pot or more, or one that couldn't be graded can be checked at Fast, the biggest pots' hands first, each
  hand in the order played. The answer at Fast takes the read's place and keeps it to compare; the report counts how
  the two agreed, on Lizard's one scale. A read Fast can't grade stands, saying why, and isn't asked again.
- **A clock** (`estimate`, `secondsLeft`, `fmtDur`): the classic estimate before a run, each street's measured pace
  once it has two answers. The solver's boot isn't counted (only a ready solver is timed).
- **The report** says what the grades stand on: nine bases, most solid first (`report.ts` `BASES`, `basisOf`), with the
  low-confidence reads and their EV counted apart. Spots keep their street, the frequency table has its 13 rows, leaks
  say how many of their decisions stand on a low read, and reads with no EV have their own off-the-read list. CSV and
  JSON carry the basis, the confidence, the read's grade, `rough_ev`, `grade_capped` and `off_solution`.
- **A rough solve can't condemn a line** (the classic `gradeClass`). A solve 10% of the pot or more from equilibrium, or
  one cut short, stops at Inaccuracy. The EV it measured is kept, and the note and export say so.
- **Provenance** (`provenance.ts`, `client.ts`). A triage answer keeps its confidence and says it; a Quick solve reads
  "Live solve (Quick)"; a read of the street's own solve reads "Answer at once", not "Live solve". Triage's solves are
  measured under Quick, and its reads aren't timed, so the mode buttons' measured times stay true.
- **The HTTP backend** (`http-transport.ts`) hands on an advice `{error}` as the worker does, so a queue keeps going past
  a spot the solver can't answer, instead of stopping at it on every retry. A practice opponent's move still rejects.

### Reviewed

Two adversarial reviewers (the port against the classic and the Advisor; the UI and its data) and a verifier on each
finding: 23 findings, 18 distinct, 16 confirmed and fixed, 2 refuted (a preflop rules fallback can't happen; the charts'
"high" confidence is the Advisor's word for "Fast answers the same", as classic exports it).

### Tests actually run

| Suite | Result |
|---|---|
| Web (Vitest) | 455/455, through `slot.sh`. `grading.test.ts`: every scope's request, turns and rivers, the rough cap, a pot on an ungraded decision, `offText`, `deepened`, a run of reads. `triage.test.ts` (new): `flagged`, the order of a check, `toAsk`, the clock. `report.test.ts`: bases, agreement, spot leaks' low count, exports. `provenance.test.ts`, `timings.test.tsx`, `http-transport.test.ts`: the fixes above. `AnalyzePage.test.tsx`: triage end to end on a stub, 17 decisions, the flagged reads checked at Fast |
| Typecheck and ESLint | clean (`npm run check`) |
| Build | passes |

### Checked in the browser (dev server, real worker, isolated, 10 cores)

- **22 hands of all eight site families:** 74 decisions at Quick triage in 15 s, the solver's first boot included
  (estimate 25 s): 72 graded, 2 of a 4-way flop left to the rules, with their pots. By source: preflop charts 26, flop
  library 6, stored turn 3, reads at once 11, Quick solves 26.
- **Check 27 at Fast** in 10 s: the 2 rules reads solved at Fast (converged) with the read kept beside them; of the 25
  with a read to compare, 17 graded alike, 4 worse at Fast, 4 better. Afterwards "No read is flagged".
- **Measured times:** triage's went under `worker:quick:*`, none under `worker:fast:*` until the check at Fast.
- **The hand panel** says what each grade stands on, no longer "against the flop library" for a move a solve answered.
- **Phone width:** no horizontal overflow at 375px in dark mode, checked before the review's fixes (those changed wording only there).
- **Not checked:** the HTTP backend's `{error}` path against a real local server (unit test only), and a capped grade
  live (none of these 74 decisions came from a rough solve; unit test only).
- **Live, ef26959** (the bundle matching a local build; `/`, `/gto-solver/` and the routes 200): one hand on `www.michael-han.com/lizard/analyze` graded at Quick triage in 2 s (charts, library flop, stored turn, a Quick solve), its flagged read checked at Fast.
- The test imports and grades were deleted after (0 hands, 0 decisions, here and live), and the dev server stopped.

### Precompute builds

Untouched; checked only with read-only `ps`. The web suite went through `slot.sh`; no solves outside the browser.

### Next

- Phase 2, still open: a history across sessions.
- Phase 1, still open: multitabling, the 20-hand engine check, asking ahead.

## Phase 2, a history across sessions in Analyze (2026-11-04)

The last open item of Phase 2's Analyze list (`ROADMAP.md`). The design was two independent drafts, one from a player's
view and one from the risks, merged by a third.

### What changed

- **Sessions (`sessions.ts`).** A session is a sitting, read from the hands kept: one kind of game at one site (one
  tournament for a tournament), ended by a break over 30 minutes (8 hours in a tournament), by the site's own clock.
  Undated hands make one session a group, last. Nothing is stored, so deleting an import removes its sessions.
- **"Your sessions" (`SessionsPanel.tsx`).** A row per session, newest first, 50 until asked: when, site, hands, what
  was won in bb (from the histories, nothing graded; none for a tournament, whose chips aren't money), how many are
  graded and the share in the mix. Picking one sets a `sess` filter, in the URL, last in `HAND_FILTERS`, which narrows
  the hands, the Report, results, stats, a leak drill and what Grade grades. A `sess` link whose hands changed says so.
- **The line (`trend.ts`).** One kind of game and one basis at a time, charts and solves never on one line: the share
  in the mix by blocks of at least 100 decisions (`max(100, N/20)`), each with a 95% range, three blocks for a line,
  clear folds and undated hands left out. A read later checked at Fast counts as the read it was, with its own mix now
  kept (`deepened`; no DB version bump, as a read checked before this has no mix and leaves the frequencies, counted).
- **The latest third against before,** cut by size alone at a sitting's start. The share as a whole needs 100 a side;
  rows of frequencies and spots need 30. Better or Worse past 2.58 standard errors. A frequency's spread is your action
  against each hand's own answer (`sq`, in `freqs`, left out of the JSON). A frequency at least 5 points off on each
  side, clearly on the other side of the answer now, reads "Now over the answer" or "Now under the answer": where you
  stand, not who moved. A row that's a leak in the latest third says "Leak now". The line and comparison hide under
  `sess`, EV lost, tag or search, as those pick the decisions they compare.
- **Fixed on the way:** iPoker hands took the file's start, not their game's, so a file's hands shared one time
  (`playedOf`; a hand already kept keeps its date, as a hand already kept is left as it is, so delete and import again).
  Grade's estimate is tied to the hands it counted. A drill's score, total and empty line say what's in view and what's
  the whole leak's. History's count says "when last drilled" with that day, and its "Graded against" no longer names the
  flop library for a drill answered by solves. Results' `signed` is shared, so what rounds to nothing has no sign, and -0.05bb keeps
  its own.

Two departures from the design, both from checking it: `agreedFold` reads `d.freq`, as a read keeps its freq; the gap's
variance went through four forms under review, ending on the one above.

### Reviewed

Four rounds, at most two agents at a time, each round reviewing the one before's fixes. In rounds 1 to 3 a second agent
tried each finding against the code; round 4 was one reader, who ran what they reported.

| Round | Over | Findings | Confirmed | Refuted |
|---|---|---|---|---|
| 1 | The whole change | 20 | 19 (17 distinct), plus the iPoker root cause one of them led to | 1 |
| 2 | The 17 fixes of round 1 | 7 new | 6 (all 17 fixes held) | 1 |
| 3 | The 6 fixes of round 2 | 3, of which 2 are one fault | 3 (6 of 7 checks held) | 0 |
| 4 | The rule round 3 tightened | 3 | 3, not tried by a second agent; 2 of them fixed by one new rule, below | 0 |

The ones that changed a number: a check at Fast put its own mix under the read's basis (round 1); the first spread
called chance a change at a side of 0% or 100% (round 1), then left out the spread of the answer itself, calling up to
14% of rows on a pure-by-hand answer in simulation, 7 to 8% on real library mixes for a flat overbettor (round 2). The
crossing label went through three rules. "Past the answer" said you had moved, and fired on a player following an answer
that moved, at another table size, on up to 76% of rows (round 3). Tightened, it still fired on over 99% of rows for a
player taking the answer's top action as the deal moved (round 4), since a row's totals can't tell your move from the
deal's: the fix on offer was a stratified test, so the label now says only what the row's numbers show, and needs each
side 5 points off, which also ends a row of Past over gaps under a point. That player still reads "Now over the answer",
true, with both answers in the row.

The fixes of rounds 2 to 4 were each undone in turn to show a test catches it: 15 breaks, all caught, two only after a
test was added for them.

### Measured

100,000 hands, 300,000 decisions, 1,429 sittings, in Vitest under `slot.sh`, on a machine with other work running:
`sessionsOf` 15 ms, `filterHands` 1 ms with no filter and 2 ms with `sess`, `answersOf` 86 ms, counts by basis 30 ms,
`tallies` 31 ms, `trendOf` 111 ms, against `report` 688 ms for scale. RSS 534 MB. Page-level timing wasn't measured at
this size.

### Tests actually run

| Suite | Result |
|---|---|
| Web (Vitest) | 525/525 in 68 files, through `slot.sh` (`npm run check`). New: `sessions.test.ts`, `trend.test.ts` (the share, blocks, the cut, a check at Fast moving nothing, seeded no-change rates at a fixed and a by-hand answer, the other side of the answer) and `SessionsPanel.test.tsx` (the page: rows, the `sess` filter and what it narrows, a link with no session, the chart by keyboard and click, drills under a session, focus). Extended: `analyze.test.ts` (iPoker's game time), `grading.test.ts` (a read keeps its mix), `winnings.test.ts` (`signed`), `history.test.tsx` (a leak row's day and answers). |
| Typecheck and ESLint | clean (`npm run check`) |
| Build | passes |

### Checked in the browser (dev server, real worker, isolated)

- **486 generated hands** (480 cash over 12 nights, 6 tournament): preflop graded live, a line of 4 blocks over 419
  counted, "90% over your latest 135, 50% over the 284 before. Better.", with rows RFI and Open (RFI) in the table of
  changes. A tooltip per block; at 375px no overflow, and the tooltip stayed inside the plot at the left, middle and
  right. A click read the block under it. A real touch wasn't driven.
- **Picking a session:** the Report ("Over the 40 hands the filters show, of 486 kept"), the hands table and Grade all
  narrowed; Quick triage of that sitting graded 96 more; 39 reads checked at Fast (18 alike, 5 worse, 16 better) moved
  no row. "All sessions" hands the focus to the heading, picking the last of 12 rows left it in view, and a tournament
  row reads "6 hands, won —, 6 of 24 graded".
- **A drill under a session:** "0 of 40 drilled here; 1 of this leak in all", "Start this leak over", and "None of this
  leak's graded decisions is in these hands." for a tournament holding none.
- **Not checked live:** the "Now over the answer" and "Now under the answer" rows (seeded, in unit tests and on the page
  in jsdom), and History's day. The app has one theme, dark, so no light check.
- **Live, ae8fbd5** (deploy run 41779496242; the bundle `index-Dd6zPNsr.js` matching a local build; `/lizard/` and its
  routes, `/` and `/gto-solver/` 200): two hands three days apart pasted on `www.michael-han.com/lizard/analyze` gave
  two rows, each "1 hand, won +10.5bb, 0 of 4 graded"; picking one narrowed the results and stats to that hand, with
  `sess` in the URL; the only console error was the Cloudflare beacon the page's CSP blocks, already open.
- The test imports, grades, a drill's session and the measured times were removed after, here and live: 0 hands, 0
  decisions, and the dev server is stopped. The 3 sessions already in the live browser's store were left.

### Precompute builds

Untouched; checked only with read-only `ps`. The suites went through `slot.sh`, and nothing here ran `quiet.sh`. The
first build's process was seen stopped (state T) through this work, with other sessions' `quiet.sh` jobs running in the
gtosolver checkout, and its worker changed PID while it ran; neither is from this session.

### Next

- Phase 1: multitabling, the 20-hand engine check and asking ahead are done, in the section after this one.
- Phase 2: what stays PARTIAL is in `FEATURE_MATRIX.md`: fixed thresholds, charts preflop, and grades not tied to the
  chart or library version they stood on.

## Phase 1, multitabling, asking ahead and the engine check (2026-11-04)

Up to four tables on one `Room`, asking ahead for your likely lines, and Play 20 hands on the Engine page. What each
does and its grade are in `FEATURE_MATRIX.md`; this section keeps what was measured and what the last review changed.

### Measured: the four runs that set the default

Play 20 hands on the Engine page, on the real worker, build `9b907bd6/3a94eea354`: 6-max 100bb, Any hand, Quick, 3 s to
think a decision, each run from a reload. An Apple M4 Mac with 10 cores, cross-origin isolated (a stop is cheap), under
load from the precompute builds. All four passed: 20 hands, no request errors, no worker ended.

The wait is from a postflop spot reaching you to its answer being in hand, so the pace and an opponent's own move aren't
in it. "Under 0.01" is a median the report rounds to 0.00 s.

| Tables | Asking ahead | Deals | Verdicts | Run (s) | Spots | Wait, median (s) | Wait, p90 (s) | Requests | Request, median (s) | Postflop request, median (s) | Meter |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | off | `1xjfbiv` | 42 | 202.61 | 20 | 0.02 | 0.46 | 179 | 0.01 | 0.02 | none |
| 1 | on | `1xjfbiv` | 49 | 228.10 | 27 | under 0.01 | 0.02 | 205 | 0.01 | 0.02 | 56 of 65 used, 5.06 s saved, 8.33 s spent |
| 4 | off | `ebh3r9` | 58 | 176.15 | 33 | 0.03 | 1.14 | 202 | 0.01 | 0.03 | none |
| 4 | on | `ebh3r9` | 42 | 158.91 | 19 | 0.01 | 0.48 | 183 | 0.01 | 0.02 | 22 of 29 used, 0.00 s saved, 1.61 s spent |

**The default.** `ASK_AHEAD` is true, in Practice until you say and in the Engine page's box: at one table and at four the
median wait fell, and a request took no longer, on or off.

What these runs can't say:

- **Quick only, one Mac, under load.** Accurate and phones are unmeasured, so nothing here says what asking ahead costs a
  phone or what it does at Accurate, where a short request is rare.
- **The p90s aren't a like-for-like fall.** Each run plays its own lines on the same deals, with 19 to 33 spots in each,
  so the 90th percentile moved on one or two spots and can't be pinned on asking ahead alone.
- **The meter in these runs isn't today's.** It counted preflop look-aheads, which are chart reads, so asked and used here
  can be largely those; the report didn't split them by street. It now counts postflop only, so a later run's figures
  won't compare with these.
- **Saved reads about 0 s at four tables by what it counts.** Saved time counts only where you had no other table to play,
  and the line now says so.
- **A stuck worker wasn't met.** No run ended a worker, so the back-off below has only run on a stubbed solver.

A fifth run, on a page with no isolation (four tables, no time to think, asking ahead ticked, a stop ends the worker),
passed in 40.21 s with nothing asked ahead, as it should: median wait 0.10 s, p90 1.90 s over 30 spots.

### What the review changed

- **Asking ahead backs off.** After a stop that ended a worker nothing is asked ahead for the rest of the page's life,
  whatever the box says, the page saying so, and each table's solved streets count as gone with that worker.
- **A slow kept read loses nothing.** Past a second the page starts fresh and says so, and no tables are written until the
  read has answered: the session comes back if you haven't moved, and if you have it's known, and can be replaced.
- **A hung flop index no longer stops the tables.** Its read is bounded at 30 s, past which they play Any hand and say why.
- **The local server's stop is sent again** every 250 ms until the request settles, as a stop that arrives before its
  /advise is cleared by it. One sent just as a request ends can stop the next, which is then asked again.
- **A hand that ended just before a reload** can still be kept with K.
- **Words.** The wait is called what it is. The page no longer says "GTO opponents", or "Solving your spot" where a chart
  or the betting rules will answer. A past session says "best or correct". The tooltip says a rare look-ahead can run on,
  and a table whose sources couldn't be read says "Not kept", not "No decision graded".
- **Reading and keys.** The dock tells a screen reader only your turn and a failure; the check's status line is one element,
  told each hand and at the end; Copied is said each time; a phone's dock hint stays on one line; a failure takes the
  place of a tile's foot, so the tile can't grow; Spots and Seat keep focus on an arrow's step; Play and Stop ignore a
  double-click's second press; Enter on a summary opens it at one table.
- **Focus and setup.** Only a press on this page takes you to the dock, a changed setup's New session included, and the
  setup keeps what you've typed as tables go above one, in the one form.

### Left as documented limits

A look-ahead past 4 s with nothing real waiting runs on until you move (`scheduler.ts` `plan`). The meter reads about a
quarter low at the page's 450 ms pace. A new worker is told only the last flop. One table at Accurate fetches the flop
index, about 730 KB. A Stopped report is drawn in the failed colours. Not looked at further: hands from before b6503da not
marked with what they were played for, the chart draw refused on Retry, and tests sensitive to timing.

### Tests actually run

The full check through `slot.sh` (typecheck, lint, tests, build) on the final code: 1506 of 1506 tests in 80 files, in about
29 s, with the machine's load average at 11 to 15 on 10 cores. Each fix's own test was seen failing with the fix taken out
by hand.

Two things turned up on the way there:

- **Timing under load.** Of six runs of the suite, one failed 4 tests at a load average near 19: three waits for a screen
  ran out at the 1 s default, and one long test took 7 s against the 5 s limit. The other five had none of these. A screen
  now gets 5 s and a test 20 s (`vite.config.ts`, `src/test/setup.ts`), which only a failing test waits out.
- **A test process ended from outside.** Twice `handsCheck.test.ts` lost its process to a SIGTERM with no test failing, once
  during the fixes and once in a full check on `59b06ed`. It isn't memory: the highest peak in those six runs, with each
  process logged, was 374 MB. It isn't vitest stopping its own worker, which takes its exit listener off first and so can't
  report this error. The six runs didn't meet it, but the slowed runs under "CI and the clock" did, in seven more runs, on other
  files too and on one run with nothing slowed, so it isn't that file's doing. What sends the signal is unknown. It hasn't
  shown in CI. If it comes back the check fails with no test failed, and a rerun is the answer until the sender is known.

### CI and the clock

The deploy of `125a09e`, which only changed notes, failed on `handsCheck.test.ts`, and nothing went live: the site stayed on
`192a07c`. A test on the real clock assumed you'd move inside a 20 ms stubbed look-ahead, and CI's runner took 176 s for a
suite that takes 30 s here. It had passed on the runs before.

A sweep then slowed the tests down rather than only reading them, with timers and clocks scaled so the CPU ran up to 30 times
slower against time, a delay before every task, and random stalls. The copy of that test reproduced CI's error from about 12
times slower. One more race was real: "names only the hands that didn't end" flipped in 51 of 3,000 runs at about 10 times
slower. Two others held up at that speed, a double-click on Play and an arrow's step on Spots, in 0 of 1,910 and 0 of 620
runs, though both could flip far beyond it.

All six now run on a held clock, and two asserts that came straight after a press wait
for what they check. No code the site runs changed. The four files passed 10 of 11 slowed runs, 234 of 234 tests each, at 14,
20 and 30 times slower and with 20 ms before every task. The eleventh lost a process to the signal below.

### The two reviews after the first

The first review made 29 claims and 26 held up. A second review read the fixes themselves: all 13 of its findings held up,
each low or medium, and 12 are fixed in `59b06ed`. The one left is that an old report keeps its old meter words. A third
read of `59b06ed`, for anything that would hurt a player, found nothing at high or medium and passed Phase 1 to ship.

### Checked on the real worker, on `59b06ed`

Play 20 hands from a reload, on the same build and seed as the four runs above. An Apple M4 Mac, under load from the
precompute builds. Both passed: 20 hands, no request errors, every verdict labelled, no worker ended.

| Page | Tables | Think | Asking ahead | Deals | Verdicts | Run (s) | Spots | Wait, median (s) | Wait, p90 (s) | Requests | Postflop request, median (s) | Meter |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| isolated | 4 | 3 s | on | `ebh3r9` | 47 | 142.96 | 24 | under 0.01 | 0.22 | 194 | 0.02 | 36 of 45 postflop look-aheads used, 1.84 s saved, 9.15 s spent |
| no isolation | 4 | none | off, and can't be on | `ebh3r9` | 56 | 38.27 | 32 | 0.14 | 2.20 | 199 | 0.06 | none |

What answered: on the isolated page, the preflop charts 23, live solves 21, the library 3; with no isolation 24, 30 and 2.
This is the first run with the meter counting postflop only: 9.15 s of solver time against 1.84 s saved, where saved counts
only with no other table waiting. It's one run, and the default rests on the four above and their waits, not on this.
The estimates ran high again, 0.2 s against 0.02 to 0.03 s taken after the flop and 0.05 s against 0.01 s preflop, which
only makes a spot look slower than it is, so nothing in `ACCURACY.md` changes.

By hand on the dev server, with a real worker, on `59b06ed`:

- **The setup.** A stack typed at three tables stayed through going down to one and up to four. The Game box closes as the
  form moves, and what's typed is still in it.
- **New session.** With a changed stack, all four tables dealt at 90bb, focus went to the dock and the page scrolled to
  it. Arriving at Practice by a link moved neither. Instant flops is greyed at 90bb and Spots reads Any hand.
- **Spots.** A letter picks by type-ahead, keeps focus and hands it back after 1.5 s. Escape hands it back. A change with
  no key before it hands it back at once, though that one was sent by script. On this Mac an arrow on a closed select
  changed nothing, most likely because it opens the system's list, which these tools can't see or drive, so a real pick
  from that list wasn't watched.
- **Keys and the dock.** F folded and graded at the table in front, labelled Preflop charts (approximate); S moved to the
  next waiting table; the status line read `Table 3: your turn, preflop, pot 1.5bb`.
- **A phone's width.** At 375 px nothing scrolls sideways, the session came back on a reload, and a tab moved the dock to
  that table: `Table 2: your turn, preflop, pot 4bb`.
- **No isolation.** The Ask ahead box is off and disabled. New session pressed during a live solve had all four tables
  back about 2 s later with no error on the page. The console's only errors were Vite's WebSocket, which the test proxy
  doesn't carry.

Not done live: a table failing, a stuck worker, a real phone, a screen reader, Accurate.

### The live check of `192a07c`

Deploy run 41965120160 passed. `/lizard/` and its practice, analyze, engine, solve, study and saved pages all answered 200
with `assets/index-DQIx4Er1.js`, the bundle of the local build, at the same 826,241 bytes. `/`, `/gto-solver/`,
`/gto-solver-classic/`, `/gto-solver-classic/practice/` and the library's `index.json` answered 200. In the browser the page
was cross-origin isolated under the service worker, Solve carried the corrected sentence, and it had no link to the classic
app.

Play 20 hands on the live site, from a reload, on the same build and seed, four tables, 3 s to think, asking ahead on:
passed, 20 hands, deals `ebh3r9`, 51 verdicts, 155.14 s, no request errors, every verdict labelled, no worker ended. Median
wait under 0.01 s, p90 0.47 s over 27 spots. 202 requests, median 0.01 s, postflop 0.03 s. What answered: the preflop charts
24, live solves 24, the library 3. The meter read 44 of 56 postflop look-aheads used, 0.04 s saved, 15.94 s of solver time.

That meter is worth a second look. At four tables, by what it counts, asking ahead spent about 16 s of solver time in a
2 m 35 s run and saved almost nothing, because saved counts only with no other table waiting. The default rests on the wait
and on how often a look-ahead is used, and these two later runs didn't compare it off. Whether it should stay on at four
tables, and on phones, needs a like-for-like measure.

### The classic app in these docs

Nothing in Lizard links to the classic app now. The Solve page said node locks and automatic sizing weren't here yet and
sent people to it, wrong since Study gained both, so it now names Study's two panels and `CLASSIC_URL` is gone. The docs
now say the classic app is frozen at snapshot `9b907bd6` at `/gto-solver-classic/`, which the gto-solver project keeps
while it reduces `/gto-solver/`. That cut is that project's and hadn't landed when last checked.

### Precompute builds

Untouched by this work: read only with `ps`. The suites went through `slot.sh`, a slot was held while the browser ran the solver, and
nothing here ran `quiet.sh`. The gto-solver session says the limped build stopped on 2026-11-03 at 11:55. I haven't
checked that: `ps` shows one `guarded_build.sh` still running (PID 45594, up 1 d 12 h), and the docs say something true
either way. On 2026-11-04 at 23:08 that build showed as stopped, with a `quiet.sh` running from `gtosolver/.work` under another
Claude session, not this one. It was running again by the next check, and nothing here touched it.

### Next

- Phase 1: measure Accurate and a phone on Play 20 hands, meet a real stuck worker, and measure what asking ahead buys at
  four tables with the postflop meter, on and off.
- Phase 2: what stays PARTIAL is in `FEATURE_MATRIX.md`.

## Re-pinning `solver/` to gto-solver `1a14605e` (2026-11-05)

The owner approved this after the gto-solver session asked for it. `solver/` went from `9b907bd6` to `1a14605e`, five
commits, and no further: upstream's main is past it, but later commits rewrite `scripts/deploy.sh` and change the tests
CI gates run. The solver build now reads `1a14605e/e13c4733fd`, on the Engine page and in every report.

### What moved

- Before anything changed, `solver/` was proved equal to the `9b907bd6` tree, apart from the three exclusions, the two
  declared guards and `UPSTREAM.json`. After the change the same comparison against `1a14605e` finds the same things and
  nothing else, 6 changed lines in each deploy script being the guard. Upstream's own `deploy.sh` change came through
  under it.
- 46 files outside the library changed, +2172 -828: `gto/advisor.py`, `breakdown.py`, `flop_approx.py`, `server.py`,
  the classic app's pages and `explain.js`, the proxy, the legal pages and tests. This isn't the routes-only change the
  other session described, so each engine file was read.
- `solver/gto/static/flop_library/`, gitignored here, stays at 18 spots. `scripts/library/assemble.py` builds from it,
  and the heads-up spots come from the builds in `.work/`, so taking upstream's 1,106 new files would add a second copy
  of `srp_sb_bb_2max` to that merge.
- The `9b907bd6` strings left in the web tests are fixtures for the build label. They don't name the running build.

### What it changes for Lizard

- **`near_exact` (`gto/flop_approx.py`), a real fix.** The index holds a spot's `game` as a dict, and the old code read
  it as a format tag. On Lizard's live index that raises `AttributeError` for a pot of a heads-up spot's pot and stack
  (6 bb with 97 behind, 2 bb with 99 behind) at 6- and 8-max alike. The advisor catches it (`a library that can't be
  read is no library`), so nothing failed visibly: the pot just couldn't borrow.
  - Same link on both builds, 8-max, SB opens to 3 and BB calls, `KhJd5c`. Live on the old engine: `Live solve · 0.10%
    pot from equilibrium in the solved game (converged) · 300 iterations`. Dev on the new engine: `Precomputed solution
    · srp_sb_bb · another table's spot read as this one`, 0.12%, ranges 0.4% apart at most.
  - The old answer wasn't wrong and was labelled as what it was. It was a solve Lizard didn't need to run. At Practice's
    Quick budgets a read is worth more than this comparison shows, but that wasn't measured.
  - `scripts/engine/test_library_game.py` pins it, and CI runs it. It passes on `1a14605e` and fails on `9b907bd6` with
    8 `AttributeError`s.
- **`state.equity` (`gto/advisor.py`, `gto/breakdown.py`), new and unused.** Your equity once the betting is closed. Every
  changed line in `advisor.py` is guarded by `_showdown`, which needs `equity` in the request, and Lizard never sends it,
  so its requests are answered as before.
- `gto/server.py` serves `explain.js`, and `gto/static/worker.js` changes by a comment. `scripts/build_bundle.py` and
  `sw.js` aren't in the range. The worker's hash still moves, so a returning browser downloads the bundle once.
- The preflop charts aren't in the range, so `docs/ARCHITECTURE.md`'s chart fingerprints stand.

### Tests actually run

- The solver's Python suite on a scratch copy of upstream's tree with its full 19-spot library: 43 modules, 686 tests, OK
  with 5 expected failures, 883 s, through the slot. Upstream's own count was 678 before this range.
- Node, `solver/tests/js`: 443 of 443 (411 before this range). CI's quick pair, `test_bundle` and `test_routes`: OK.
- `scripts/library`: 8 OK. `scripts/engine`: 9 OK, the new test among them.
- `npm run check`: 80 files, 1506 of 1506, 25.80 s, with lint, types and the build.
- The first full Python run was ended by SIGTERM after 741 s, with no test having failed by then: exit 143, not the
  10-minute limit I'd set, which it had already passed. That's the outside SIGTERM of Phase 1, now on a Python process
  in another folder, so it isn't vitest's or that test file's doing. The second run went module by module with a handler
  that logs the sender's pid, and nothing was sent to it, so the sender is still unknown. The handler is a small C
  library in the session's scratchpad, not in the repo, and is worth loading again if this comes back.

### Checked on the real worker

Dev, isolated, build `1a14605e/e13c4733fd`, seed 20260001, 4 tables, 3 s to think, asking ahead on, Quick, with a slot
held and the Python suite running beside it: passed, 20 of 20 hands on the same deal as before (fingerprint `ebh3r9`),
62 verdicts in 188.53 s, 0 errors, 0 unlabelled, 0 restarts. Median wait under 0.01 s, p90 0.58 s (n 38). 224 requests,
postflop median 0.02 s. Charts 24, Live 35, Precomputed 3. Asking ahead: 57 of 69 used, 0.00 s saved, 11.31 s spent.
This isn't a like-for-like against the 47 and 51 verdicts of Phase 1, since how many verdicts a run gets depends on how
the tables interleave.

### Not done

- Lizard has none of the classic app's new review work: record a hand and review it once it's finished, your equity on
  a reviewed hand, Explain with AI on a reviewed decision. The engine half of the equity is now here.
- Upstream's commits after `1a14605e` aren't taken.

## A boot that goes quiet (2026-11-05)

The new browser tests met what Phase 1 never could, a truly stuck worker, once in about 30 first-load-then-reload runs:
Study stayed on "Engine starting" for its full 45 s, with its downloads finished 2 s after the reload and nothing more
said. 14 more of the same run on purpose didn't show it, so the cause isn't known. What was missing either way is that
nothing would ever have ended it: the transport only watched a worker after a stop.

- `worker-transport.ts` now watches a boot. A worker that says nothing for `BOOT_STALL_MS`, 2 minutes, is ended and
  started again once, the waiting request sent to the new one. A second stall is a failed boot, with a message saying
  so, and the next request tries a fresh worker. Each thing the worker says re-arms the wait, so a slow boot that's
  moving is left alone.
- 2 minutes is for the first step, 25 MB of downloads with no progress reported, on a slow link. A version this browser
  has booted before has nothing to download, so that wait is `BOOT_STALL_KNOWN_MS`, 30 s, read from `localStorage`.
- A request stopped during the stall isn't sent on.
- Tested: 6 new unit tests with a fake worker, and one in Chromium where the first worker is a stub that never speaks:
  it was started again and the page answered, 44 s all told.
- Not tested: a phone on a slow link, so whether 2 minutes is enough for a first visit there isn't known. A wrong guess
  costs one restart, with a further 2 minutes.

## Browser tests, and Practice on a phone (2026-11-05)

Section 5 of the plan asks for screenshots at 1440, 1024 and 390 px and for browser tests of the main flows, and until
now those checks had only been made by hand. This is the earliest unmet criterion left, so it came next.

- `web/e2e/`, on Playwright 1.56.1, against the built site: every route at the three widths with no sideways scroll and
  no logged error, every primary nav link, and on the real worker a Study spot with an action, its link reloaded and Back,
  a Practice decision graded, a hand history imported, and the boot stall above. 60 tests, 58 run: 2 are the stall test
  skipped at the other widths. CI runs them before a deploy, with one retry and the results kept on a failure.
- The first full run passed at every width, because the empty pages have nothing to break. The screenshots showed what
  a pass couldn't:
  - **Practice on a phone.** The table started about 1,000 px down, under the page's description, the score and every
    setting. The description is now behind "How this table works", the setup behind "Game · 6-max · 100bb", closed on a
    phone and open from 768 px up, and on a phone the score and the asking-ahead line go below the table. A test now
    fails if your move doesn't start on the first screen, at any of the three widths.
  - **The nav on a phone.** It scrolls sideways with nothing to say so. It now fades at its right edge below 1024 px.
- Still by hand: anything needing the library, since the preview server has none. Nothing compares screenshots between
  runs, so a change in how a page looks fails no test.
- The re-pin's live check, on `e0f2ed0`: the same 8-max link that showed a live solve on the old engine reads
  `Precomputed solution · srp_sb_bb · another table's spot read as this one`, 0.12%. The manifest says `e13c4733fd` on
  `1a14605e`, and `/`, `/gto-solver/` and `/gto-solver-classic/` answer 200.

The first run with this gate failed before any test ran: GitHub's `ubuntu-latest` is now 26.04 and Playwright 1.56.1 stopped at `Playwright does not support chromium on ubuntu26.04-x64`. Nothing reached the site from that run. The build job is pinned to `ubuntu-24.04`; moving Playwright itself would have meant a new browser build under tests that had just been baselined. 26.04 comes back when Playwright is next raised.

Live check of e469990, the first build deployed behind the browser gate, on https://www.michael-han.com/lizard/: build `1a14605e/e13c4733fd`, seed 20260001, 4 tables, 3 s to think, ask ahead on, Quick. Play 20 hands passed at 52 verdicts in 163.09 s with 0 errors, 0 unlabelled, 0 restarts, in the worker, cross-origin isolated. Waits were median under 0.01 s and p90 0.49 s (n 28). Of the verdicts, 24 came from the preflop charts, 26 from live solves and 2 from the library. Asking ahead was used 41 of 50 times and spent 7.55 s to save 0.04 s, so the question of whether it stays on at four tables still stands.

## Walking a line in Study (2026-11-05)

Study's line is now a breadcrumb: each action, each street's cards and each run of preflop folds is a button to that node, with the start of the hand as the first. Forward sits beside Back. What lies ahead after stepping back stays on the line, dashed, until a different action makes a new one. Left or Backspace, right, 1-9 for an action and b for the builder work on the page, except while typing, and 1-9 are the builder's brushes while it's on (Backspace and b are classic's keys). A node facing a bet says the price and the pot odds.

- What's ahead lives in the page, not the URL, so a shared link and a reload start with nothing ahead.
- Reset keeps what's ahead, the same as clicking the first step. Clearing it from the button would race the URL's update, and dashed steps do no harm.
- The answer's pot was checked against the engine before using it: it holds the bet faced, 4.0 with 1.5 to call for BB against a 2.5 open, 3.5 with 1.5 to call on a river facing a 1.5 bet, so odds are to_call / (pot + to_call).
- With per-seat stacks that isn't always so. A 30bb BB facing a 100bb open read pot 101.5bb and 29 to call, which would say 22% for a price of about 48%, while a heads-up river capped the bet and read 31. The page can't tell these apart from the answer, so pot odds stay off wherever someone left in has more chips than the player to act, and only the price shows.

1522 unit tests pass in 80 files. The new browser test passed at desktop and phone.

## Study's breakdown (2026-11-05)

Below a postflop node, "Breakdown and equity" lists each range by made hands and draws with the share, the mix, the equity and the EV of every category, and charts each range's equity distribution with its average, EV and share at 80% equity or better, naming who holds the range and the nut advantage. It's the engine's own `breakdown` answer (`gto/breakdown.py`, classic's view), asked only when opened, under its own provenance. On a heads-up river already solved it took 0.09 s in Python. A category picked can show just those hands in the grid. It stays open from node to node. An action picked shows what it's made of by category, from the mix already in the answer. Equity and EV drop out of that view, as the answer has them for a whole category and the hands taking one action needn't share them.

- Looking at the screenshot caught what no test did: the panel shared a React `key` with the Compare links beside it, and a production build drops the warning and doubled the row. The browser test now counts that row.
- A line colour was checked with the dataviz validator against the page's surface: the accent and suit tokens failed its lightness band, so the three series have colours of their own.
- The same river's numbers moved a little between runs (BB 307.6 and 327.3 combos, 55.6% and 55.5% equity), since the turn solve that narrows the ranges stops on a time budget. The panel shows that run's answer under that run's provenance.
- Checked on the live site at fbe271f (bundle `index-OU1lFUBp.js`, the local build's; manifest `e13c4733fd`; routes 200), with a slot held. A library flop (`srp_btn_bb`, Ks7d2c) answered in 0.5 s and stayed "Precomputed solution", so opening the panel doesn't force a solve there. A 3-way flop answered in 2.31 s with three lines and equities adding to 99.9%. A 4-way flop answered in 0.5 s with categories and EV, no equities, and the panel says it has none. A 3-way read said "Neither range", now "No range".
- The grid's view, whether the breakdown is open, and made hands or draws are now Settings, so they last across nodes and visits.

## The owner's decisions, and asking ahead measured (2026-11-05)

### Decisions

Asked one at a time, each with what was found:

- **Repo:** stays private. That closes the audit's R10 for the repo.
- **Engine source:** accepted as public. `/lizard/solver/solver.zip` (695 KB of readable Python) has to reach the browser,
  and the classic site serves the same bundle, so a private repo doesn't hide it.
- **Library publishing:** a launchd job every 6 hours, now installed (`docs/DEPLOYMENT.md` §4).
- **Domain:** the owner will turn on Cloudflare's "Always Use HTTPS". The stuck Pages certificate stays as it is.
- **Asking ahead at four tables:** measure, and change the default only if the numbers justify it.

### The library job

The first two tries each failed on a macOS limit on `~/Desktop`, and §4 lists them. The third ran under launchd from
start to finish: exit 0, library commit `a11b7127`, 43,141 files, and "live: ... match the published ones". `srp_sb_bb_2max`
went from 378 to 1,694 of 1,755 flops, and `lp_sb_bb_2max` from 168 to 208 of 552. Both counts were read back from the live
`lizard-library.json`.

### Asking ahead, four tables, on and off

Play 20 hands on the live site, build `1a14605e/e13c4733fd`, deals `ebh3r9`, 3 s to think, Quick, cross-origin isolated, each
run in a new headless Chromium through a slot, on an Apple M4 Mac under load from the builds. All that finished passed, with
no request errors, no unlabelled verdicts and no worker ended.

| Run | Asking ahead | Verdicts | Run | Spots | Wait, median (s) | Wait, p90 (s) | Requests | Postflop request, median (s) | Meter |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | off | 54 | 2 m 45 s | 31 | 0.01 | 0.72 | 200 | 0.01 | none |
| 2 | on | 62 | 4 m 28 s, of which 81 s frozen | 39 | under 0.01 | 0.43 | 224 | 0.02 | 64 of 71 used, about 0 s saved, 7 s spent |
| 3 | off | 52 | 2 m 38 s | 30 | 0.02 | 0.51 | 191 | 0.02 | none |
| 4 | on | no report | frozen | | | | | | |
| 5 | on | no report | frozen | | | | | | |

**The default stays on.** Off, the p90 was 0.51 and 0.72 s. On, it was 0.43 s here, and 0.22, 0.47 and 0.48 s in the three
earlier runs at four tables, on the same deals. A request took no longer either way. That's about a quarter of a second off
the slowest tenth of spots, for 7 to 16 s of idle solver time in a run of about 2 m 40 s, and 90% of what's asked gets used.
It's a small gain, and nothing here says to turn it off. The p90 moves on one or two spots a run, so two runs off can't
pin it finer than that. The "0 s saved" isn't evidence either way: above one table there's nearly always another table to
play, and the meter counts a wait only when there isn't.

**Why runs 2, 4 and 5 froze: not Lizard.** The Mac's own memory guard (`~/.mem-guard`, the owner's, installed 2026-11-04)
sends SIGSTOP to the biggest busy job when memory is tight, and resumes it when there's room. It treats headless Chromium
as a job, though it leaves real browsers alone. It paused the page's renderer at 1.08 GB for 81 s in run 2, at 1.09 GB for
good in run 4, and at 1.12 GB for good in run 5, which is why run 4 hit its 8-minute limit with nothing on the page. Its
log, `actions.jsonl`, shows each one. Runs 4 and 5 were stopped by hand.

What that means for later work:

- A page that has played 20 hands holds about 1.1 GB, over `CLAUDE.md`'s 1 GB, so a headless browser run can be frozen
  whenever the Mac is short of memory. A check that hangs with no CPU should look in that log first.
- Three frozen runs out of five were all "on" and the two "off" runs weren't, but the guard picks the biggest job at the
  moment memory turns tight, so this doesn't show that asking ahead uses more memory. It wasn't measured.
- It may explain the one stalled boot left unexplained on 2026-11-05 (`A boot that goes quiet`). That's a guess: I didn't
  look at that hour's log.

Not measured: Accurate, phones, and two tables, which the check doesn't offer.

## Study: the split, Fold to, value and bluff, blockers (2026-11-05)

Built by two subagents at a time on separate files, reviewed here, then checked on the real worker. `FEATURE_MATRIX.md` has
what each does: the Solution browser, Node navigation and Equity & EQR rows.

- **`ResizableWorkspace`:** the plan's component, on Study's two columns. The Actions row and the breakdown aren't in it, so
  the plan's fuller layout isn't delivered.
- **Fold to:** one request, for the seat chosen.
- **Value and bluff:** by a fair share of the pot against the whole range, as the answer holds no continuing range.
- **Blockers:** from the next node's answer, once a hand is picked.

The real worker found what the mocks couldn't. The subagent's facing-an-all-in path compared this node's count of the
opponent with the combos that took the action, and on a 3bb river jam those were 89.6 and 11.7. I ran the engine directly
and got 90.5 and 10.5 at Quick, so it isn't a slip of the page: `_walk` widens the range behind a line the solve rarely
plays, by design, so that an answer isn't given against a sliver of a range. The check refused, which was right, but its
message read as a fault, so it now gives the reason. No number was ever shown from the wrong range.

A screenshot showed "0.0 of 0.0, 34%" in the blocked table, so a category under 0.05 combos taken out is now left out.


Tests: 1647 unit tests in 87 files, typecheck and lint clean, 70 browser tests passed and 2 skipped at three widths, including
two new ones on the real worker.

The live check of `8a74b6d`: run 42013956553 succeeded, the live bundle `index-wZfaLEx8.js` equals the local one, and the
routes, the manifest, the homepage, `/gto-solver/` and `/gto-solver-classic/` answered 200. On the live Kd7c2h, "Precomputed
solution · srp_sb_bb_2max · 0.14%", a 33% bet split into 54.3% value (0.9 combos) and 45.7% bluff (0.8 combos), and A6s taking
out 68.0 of SB's 692.5 combos (9.8%) on average.

## Review, turn drills and filters (2026-11-05)

Built by two subagents on separate files, reviewed here. `FEATURE_MATRIX.md` has what each does: the Study plans, Drills,
Postflop trainer and Session stats rows.

- **Review queue:** mistakes from Practice kept across sessions and retried on a 1, 3, 7, 21 day schedule. A local count of
  days, in the browser, with no account.
- **Turn drills and the hand filter:** from the flop library's turn files. They hold no EV, so a turn is graded by frequency
  under its own source, and nothing pretends otherwise.
- **History:** decisions by street, what graded them, and a trend once there are enough decisions to read one.

A real browser found what the tests couldn't: a retried stored turn said "Graded by how often the chart plays it", with an
EV column of dashes, because Review shows a decision through Practice's `DecisionView`, which had only the charts in mind.
That's a provenance slip, so it's fixed with a test. The queue's count also blamed the preflop charts for a turn, and said "the
mode above" with no mode showing; both now read as they should.

Tests: 1903 unit tests in 100 files, typecheck and lint clean, 73 browser tests passed and 2 skipped at three widths, `/review`
among the routes. Library-backed work can't be reached by the browser tests, so turn drills were checked by hand as above.

The live check of `bf53101`: run 42019231556 succeeded, the live bundle `index-BRGYz4Dl.js` equals the local one, and
`/lizard/review`, the other routes, the manifest, the homepage, `/gto-solver/` and `/gto-solver-classic/` answered 200. A live
turn drill on K♣6♦5♣ A♦, 9♠7♠ as BB: a 75% bet the mix plays 35% graded Correct, under "Stored turn from the flop library".

## What graded a grade, and range advantage in reports (2026-11-05)

A subagent built both, reviewed here. `FEATURE_MATRIX.md` has what each does: the Leak finding, Reports and Aggregate reports
rows.

- **Version stamps:** a change in the charts or the library could read as a change in the player's play. A new grade now keeps
  what graded it, and a comparison across versions says so beside its numbers. The library has no version of its own, and its
  lists move whenever a flop is added, so a spot's stamp hashes its ranges and tree. An old grade stays unknown.
- **No IndexedDB migration:** the stamp is an optional field with no index, so `DB_VERSION` stays 6.
- **Range advantage:** from the stored equities. Nut advantage is left out because the library holds no equity by hand; the
  page says so rather than estimating it.

Checked on the real engine with the preview: `precomputed.board` matches the index's flop names, so Study on K-7-2 got
`library:srp_btn_bb:db7399ab:Kc7d2h:c08adb5815`, and all of srp_btn_bb read 54.5% against 45.5%, "BTN +9.0".

Tests: 1966 unit tests outside the PLO work (`FEATURE_MATRIX.md` rows above), lint clean, 73 browser tests passed and 2 skipped.

## The PLO4 foundation, and import limits (2026-11-05)

Built by a subagent, reviewed here. Phase 7's first step, and no more than that: rules, hand counts, pot-limit betting and
equity. PLO4 stays NOT IMPLEMENTED as a solving feature, and `FEATURE_MATRIX.md` says what stands under it.

- **`poker/table.ts` takes pot limit:** there's no second betting engine. The change is optional, and a differential on 60,000
  no-limit hands against the old code matched every state, legal set, record and settlement.
- **Independent reference:** the Python shares no code with the TypeScript, and checks itself on all 2,598,960 five-card hands
  before it's used. Breaking the rules on purpose made the tests fail. A public 27.75% in a third-party guide reads 27.694% exact
  here; the page doesn't say how that figure was made, and the gap is about one standard error of a sized simulation.
- **In a browser:** the subagent could run neither a build nor a browser, so the worker was unproven. I built it: the worker
  loads as its own file, gives exact counts and Monte Carlo, and Cancel shows while it runs.
- **One finding left as it is:** no-limit judges each short all-in on its own, as the classic page does, so short all-ins that
  add up to a full raise don't reopen betting, as TDA Rule 49-A would have them. Pot limit does this correctly. Changing it would
  move NLHE behaviour, so it's left for the owner.

A file over 256 MB, or files adding up to that, is now refused by size before any of it is read, for hand histories and backups.
A package audit found nothing in production dependencies, and a moderate `minimatch` advisory in the lint tools only. Nothing in
`web/src` writes raw HTML.

Tests: 2061 unit tests in 110 files, typecheck and lint clean, 76 browser tests passed and 2 skipped at three widths, 20 engine
reference tests.

The live check of `6db34ef`: run 42023429109 succeeded, the routes, the manifest, the homepage, `/gto-solver/` and
`/gto-solver-classic/` answered 200, and live `/equity` gave 61.481% to 38.519% on its own worker, with the worker's name absent
from the first bundle. `d472cb7`'s run was superseded by that push, so `d472cb7` was checked live inside it.

## Hint, Reveal, Retry and Copy for AI (2026-11-05)

Built by a subagent, reviewed here and played through on the real app. `FEATURE_MATRIX.md` has what each does: the Coaching /
feedback row. The rule worth stating is Reveal's: a decision made after seeing the answer has no grade at all, kept with a
flag, so it can't turn up as a graded decision in the score, History, Review or Analyze.

## The independent audit (2026-11-05)

A read-only reviewer looked at security, privacy, poker rules and numerics with no steer from the authors. No high-severity
defects. The rules held: `table.ts` matched an independent reference on 120,000 fuzzed hands, and `categories.ts` matched the
engine on 300,000. The real defects were in how bad imported data is handled; those fixes are in the next section.

- **Source maps:** published builds had maps with the whole app's source, though the repo is private by the owner's decision.
  They're off now. Maps of earlier builds stay out once a new deploy replaces them.
- **The deploy workflow:** a manual run on another branch could publish; only `main` does now. Actions are pinned by commit, and
  `npm ci` skips install scripts (only `fsevents`, Mac only, had any).
- **Pyodide from a CDN:** the worker loaded it from jsDelivr, pinned by version but with no hash check, in the origin that holds
  the hands. It's now served from `/lizard/solver/pyodide/`: six files, each checked against a pinned SHA-256 at build, and the
  build fails if the published worker names another host. `solver/` is unchanged; the edits are declared in `UPSTREAM.json`.
  In the preview the worker read `pyodide/`, Study answered on it, and the wasm came as `application/wasm`. A first visit now
  takes about 25.7 MB from this site, which jsDelivr used to carry. A worker has no CSP of its own yet, so a compromised
  same-origin file still isn't held back from the network.

## The audit's fixes (2026-11-05)

Built by a subagent, each with a regression test, reviewed here.

- **A backup can't blank a page:** `data/shapes.ts` checks every field a page reads, in every store, and a bad record is skipped and
  counted. A page that throws now shows `ErrorBoundary.tsx`: a reload, a home link, and a backup that reads the database directly, so
  it works when `/saved` is the page that threw. Records an old bad restore already stored aren't filtered on read: the way out
  is that backup, clearing site data and restoring.
- **Hand histories can't freeze the tab:** lines and headers are capped before matching, and the walks are linear. Inputs that took
  10 to 30 s now take under 10 ms. Old and new parsers matched on all 23 real files and 200,000 damaged ones; the longest real line
  was 169 characters against a cap of 512.
- **A lost save says so:** a database that won't open is a "failed" state, and saves return whether they stored anything. `BuildMode`,
  `LeakDrillPanel` and Practice's writers rely on the page-wide notice.
- **Player names:** `constructor` and the like no longer corrupt a hand.
- **A missing pot:** ungraded, where it read as an Inaccuracy.
- **A big blind all-in for under half a big blind:** the small blind isn't asked to call what it covers. A differential on 80,000
  hands changed only stacks under half a big blind, and every finished hand settled the same. A big blind of exactly 0.5 and a short
  straddle still ask, as the fix was held to the smallest change.

The audit had two details wrong, both caught in the fixing: the stakes regex needs a whole hand to reach it, and `hands.ts:85` is a
delete, with the silent write a few lines below. Nothing here was seen failing in a real browser's private window.

Tests: 2208 unit tests in 118 files, typecheck and lint clean, 82 browser tests passed and 2 skipped at three widths, including
two new ones: a page and its workers ask no host but this one, and a poisoned record on `/saved` still leaves a working backup. A
browser run caught Copy for AI sitting ahead of Study's actions, so it's now below them, and off in a tournament, whose EVs aren't
in bb.

Live check of `af72d22`, run 42034320997 green: `index-DHQGEcrO.js` is the bundle in `web/dist`; `/`, `/study`, `/practice`, `/review`,
`/equity`, `/engine`, `/reports` and the three neighbours answer 200; the page's `.map` is 404; `/lizard/solver/worker.js` is byte-identical
to the build and names no jsDelivr; all six Pyodide files fetched from Pages hash to their pins, with the `.wasm` served as `application/wasm`;
and on the live site `crossOriginIsolated` is true and the pill reads "Engine ready · 8t", so the engine started from those files. The live
page also loads Cloudflare's analytics beacon, which the edge injects and the preview doesn't have, so "no third-party request" holds for the
app and its workers, not for the domain. DEPLOYMENT now says so.

## Practice's short-stack and tournament sessions, the accessibility audit's fixes, pages split, and the QA list as tests

**Practice** gains two kinds of session, both on the one Room:
- **Push/fold** at 10-12bb. The engine's first-in answer there is a jam-or-fold equilibrium by hand class with one caller assumed, and a call of a jam is priced against that range, with no EVs in either. So it has its own source, "Push/fold model (not a solve)", always approximate and graded by frequency. The band ends at 12bb because the engine's does; 12.5bb is the chart again.
- **Tournament**, in prize equity (ICM) or chip EV, with prizes, each seat's stack and other tables. Preflop is the engine's push/fold in prize equity at 12bb or less and a labelled chip chart with a risk premium deeper. A heads-up flop is a real prize-equity solve, whose EVs read "bb of prize equity", as they're on a different base from chips won (2.5 against 7.07 on one spot). A rules answer's chip EVs are dropped from an ICM session so its totals stay in one unit. These sessions stay apart in History and Review.

A tournament session is one table frozen in time: nobody is knocked out, blinds don't rise, chips don't move on, and there are no bounties.

**Accessibility:** the audit's High and Medium findings and most of its Low ones are fixed. What it found is in `docs/FEATURE_MATRIX.md` under Accessibility. Its contrast figure for `danger` was too kind: that text also fails at 4.33:1 on surface-3, so it went up with the rest. Fixing Saved's delete also found that React reused the Delete button as "Delete spot" with focus on it, so a second Enter would have deleted the row. Fields get a new `control` edge colour rather than a heavier border token, which would have made every panel divider heavy. A chart's answer in Practice no longer shows an EV column of dashes.

**Pages split:** every page but Home and Not Found is its own chunk. The first script goes from 944 KB to 301 KB (about 97 KB gzipped) and Study is 158 KB after it. A tab left open across a deploy asks for chunks that are gone, so it reloads once (`app/freshChunk.ts`); a second failure goes to the error page.

**The QA list** in the plan is now `web/e2e/qa.e2e.ts`, one test a scenario at desktop width, on the real worker:

| Scenario | Test | Notes |
|---|---|---|
| 1 Routes and deep links | `routes.e2e.ts` | Every route, three widths |
| 2 6-max to the river | 2 | From the New hand form, one street at a time |
| 3 Class and combos | 3 | The board's card takes a combo out |
| 4 Heads-up and 3-way solve | 4 | From the Solve page, and a 3-way link |
| 5 Rake, straddle, ante, stacks, side pots | 5 | Side pots aren't in this one: they're in `table.test.ts` and `results`, as no fixture has one |
| 6 Final-table ICM | 6 | Payouts and stacks reach Study's answer |
| 7 A bad decision's cost | 7, 7b, 7c | Plus push/fold and tournament sessions |
| 8 Range saved and loaded | 8 | A drill's save is in unit tests only |
| 9 Stars and GG, malformed | 9 | |
| 10 Biggest mistake into Study | 10 | A 72o open, off the chart |
| 11 Texture-filtered report | 11 | Reads the live library, so not in CI |
| 12 Save, back up, restore | 12 | |
| 13 PLO4 | 13 | Equity only, as that's what exists |
| 14 Keyboard, stops, errors, widths | 14, 14b, 14c, `content.e2e.ts` | Large files are in unit tests |

Four first-run failures were all the tests' own: a class not in that range, a click on a button that doesn't exist because a restore starts on choosing the file, and the like. None was a product defect.

Tests: 2336 unit tests in 127 files, typecheck and lint clean, 99 browser tests passed and 32 skipped (the QA list at the other two widths), with 14b and 14c run on their own against the same build. Not checked: a real screen reader, a real phone, and how a 3-way flop answers in an ICM session at Fast or Accurate.

The deploy of `6525525` was stopped by the job's own 20-minute limit: the QA list added about 10 minutes on GitHub's runner, where the tests in the run had all passed so far. Nothing reached production from it. The limit is now 35 minutes, and a deploy takes about 25.

Live check of `450d77c` (run 42045874492, 2026-11-05): `index-Chej54AG.js` at 300,773 bytes, the name a local build of that source gave, with `document.title` "Practice · Lizard", Push/fold and Tournament in Practice's Play list, 30 script chunks loaded, cross-origin isolated and "Engine ready · 8t". `/`, `/gto-solver/`, `/gto-solver-classic/`, `/lizard/analyze/` and `/lizard/solver/manifest.json` all answered 200.

### Exploit practice, scenarios and the analytics section (Phases 5 and 6)

Exploit drills against four hand-set profiles, in the pot drills only, each answer a live best response to a node lock, badged as such, with sessions and mistakes kept apart. The opponents at the table still play the charts and equilibrium, so no net is counted. Saved custom scenarios start again from the Saved page. Analyze gains one Filters section over every report, decisions broken down by seat, street, pot type, bet size faced and chosen, effective stack and four flop textures, ranges on every rate, and a leak rule that needs 30 decisions and an interval clear of its line, so leaks appear later than the classic thresholds did.

Two browser tests, 7d and 10b, cover these on the real worker. The agents that wrote this ran no browser, and the full browser run found one real regression: a row for Save scenario pushed "Your move" off a tablet's first screen. Save scenario now sits beside New session, inside that form (so it's a `role="form"` group and Enter saves rather than starting a session, which 7d checks), and the Exploit note is one short line until a pot drill is chosen.

The practice page's EV for a move the range almost never takes is now marked ≈ (`rough_ev`), and `postbuild.mjs` fails a build whose first script passes 350 KB.

Tests: 2438 unit tests in 133 files, typecheck and lint clean, 101 browser tests passed and 40 skipped (the QA list at the other two widths).

Live check of `930c999` (run 42049933786, 2026-11-05): `index-CrWjNgbS.js` at 296,480 bytes, the size a local build gave, with `document.title` "Analyze · Lizard" and cross-origin isolated. `/`, `/gto-solver/`, `/gto-solver-classic/`, `/lizard/analyze/` and `/lizard/saved/` answered 200.

### Single combos, EQR by combo, saved reports and the rest of the accessibility audit (Phases 3, 5, 6)

The range builder paints single combos with mixed weights and grades them exactly, and the class panel has EQR by combo. Analyze's filters can be saved as a report and opened from the Saved page: it keeps the filters and no numbers (database version 8). The accessibility audit's remaining items are in, with the exceptions in the matrix's row.

Three things a reader should know. Action fills now carry patterns, as seven colours can't stand 3:1 apart on this surface; I looked at them at desktop and phone width and kept them on by default, against the data-visualisation guidance that texture is opt-in, because the brief says colour mustn't be the only cue. A saved range score's `acc` can now be by combo or by class, marked `graded`. "Engine ready · 8 threads" and "per decision" replace the old wording.

Browser test 14d paints a combo on a real river solve and checks it's graded by combo; 10b now saves a report and opens it from Saved. Neither ran on a phone or a tablet.

Tests: 2496 unit tests in 140 files, typecheck and lint clean, 102 browser tests passed and 42 skipped (the QA list at the other two widths).

Live check of `9596e2a` (run 42054537505, 2026-11-05): `index-B_GjjvYX.js` at 297,002 bytes, the size a local build gave, with the Study title, cross-origin isolated and "Engine ready · 8 threads" on the live page. `/`, `/gto-solver/`, `/gto-solver-classic/`, `/lizard/saved/` and the solver manifest answered 200.

### A plan page, and what an independent review of the last two commits found (Phases 5, 6)

`/plan` turns what's kept here into an ordered list of next steps: reviews due, leaks by EV given up, rows too few to read, one Practice drill. Each step is a link that starts it, and the page states the rule that orders them. It is a rule, not a coach. Browser test 10c goes from the empty page through grading to a started Practice session and checks phone width. The fixtures grade clean, so the test writes misses into IndexedDB to reach the drill step; a player's real misses weren't watched.

An independent review of `930c999` and `9596e2a` found six defects and one minor one, all fixed here:

- Positive Maniac numbers were worded as a change in frequency when the engine moves a share of the other action across. The postflop words now say that.
- A fold number is capped by what the range has to move and applies to a first bet only. The assumed-profile words now say so.
- The leak rule's words and code disagreed on where the interval has to sit. Now one rule, `leakIsRead`, with cases at each edge.
- A hand kept from an exploit session reached Analyze as an ordinary Practice hand: its chips were in the winnings Practice said weren't counted, and equilibrium grades of deliberate exploits could read as leaks. It now stays listed, says so, and is left out of results, stats, sittings, grading and the report (`exploitHands.test.tsx`).
- "Flop vs c-bet" rows counted your own later decisions. New grades carry `ownBet`; grades kept from before can't tell, so old rows stay as they were.
- History showed a score graded by combo as a class score. It now says "by combo".
- "AKs:" read as full weight; it's now unknown.

One change of behaviour: Analyze's leaks are now read from the same hands as the Plan's, so tournament grades stay in the report's tables and out of its leaks, and the page says how many. Someone who imports only tournaments gets no leaks from Analyze. Before, those leaks mixed chips with big blinds and had no ICM.

Tests: 2567 unit tests in 144 files, typecheck and lint clean, 106 browser tests passed and 44 skipped (the QA list at the other two widths).

Live check of `491a1fc` (run 42059979619, 2026-11-05): `index-BUV4tVJ6.js` at 297,656 bytes, title "Plan · Lizard", cross-origin isolated, Plan in the nav, and `/`, `/gto-solver/`, `/gto-solver-classic/`, `/lizard/plan/` and the manifest answered 200. The first attempt's deploy step got a 500 from GitHub when creating the Pages deployment, though the deployment had landed. Rerunning that job alone passed, with the same artifact.

### Misses from Analyze in Review, equity-bucket filters, and the system-mode checks (Phases 3, 5, 6)

A pick below Correct in a leak drill now goes to the review queue by itself, and a graded decision goes there when you press Add to review on it in the hand. An import can grade hundreds below Correct, so nothing else is automatic. Tournament and exploit hands stay out. A retry is dealt from the record and graded against the same kept answer, with nothing solved, and an entry can be deleted. No store change was needed. Browser test 10d goes from a graded decision to a retry to a delete, with the miss written into IndexedDB, as the fixtures grade clean.

A leak drill turned out to deal turns and rivers already: the matrix line saying it stopped at the flop was out of date. What was wrong: a rough solve could say Blunder in a drill (it now stops at Inaccuracy, as elsewhere), a drill answer didn't show the kept confidence or version, and decisions with no mix were skipped without a word.

Study filters by equity bucket: 0 to 25, 25 to 50, 50 to 75 and 75 to 100%, against the opponent's whole range, recounting the grid and totals.

Plan now puts its steps above the rule, since the rule took a whole phone screen. A wide table's right edge now fades while there's more to scroll to. In a real Chromium: forced colours keep the fills and draw cell edges and the selected cell, reduced motion stops transitions and keeps that cue, one Tab crosses the grid, and Copy for AI reaches the real clipboard (`web/e2e/modes.e2e.ts`). The report chart draws 1,694 flops on the live library. Firefox has no scroll timelines, so it gets no cue.

Tests: 2628 unit tests in 147 files, typecheck and lint clean, 111 browser tests passed and 54 skipped (the QA list and system-mode checks at the other two widths).

Live check of `8d902b6` (run 42064203315, 2026-11-05): `index-DGSeHMgE.js` at 298,193 bytes, the name a local build gave, with `/`, `/gto-solver/`, `/gto-solver-classic/`, `/lizard/review/` and the manifest at 200.

### A numerical benchmark against an independent reference, the favicon, and a web manifest (Phases 4, 7)

`scripts/benchmarks/` holds a reference solver written separately from the engine: its own evaluator, tree walker and best response, an exact sequence-form LP through scipy, and a DCFR for raked, flop and 3-way spots. On all 16 small spots, on trees checked identical node by node, the engine's exact mode agrees with it: at the highest iteration count, every game value is within 0.01% of the pot, and exploitability is under 0.003%. Two of 44 runs failed the 0.05% tolerance, both at 300 iterations, short of converged rather than in disagreement. No engine bug turned up. Details and commands are in `docs/ACCURACY.md` section 14.

Three limits matter. The largest spot is 125 by 141 hands, and the app's real solves use buckets, so this says nothing about abstraction error. The tree rules were restated from the engine, so identical trees show agreement, not that the rules match a poker room. The same agent wrote the reference after reading the engine, and only the LP differs from it in method.

It measured one known approximation: in prize equity the engine pays a split as the mean of a win and a loss, as its comment says. On a bubble river built to chop, that leaves the solve 0.25% of the pot exploitable in the true payoffs, with values off by up to 0.67% of the pot. That's a deliberate worst case. `solver/` stays unchanged.

One 3-way river (low stack-to-pot ratio) doesn't settle: both sides are hard to exploit, but they may be near different equilibria, so passing doesn't show they match.

Separately, the favicon was a 404 on every page but home, because its path was relative. It now uses the base path, as does a new web manifest. Adding Lizard to a real phone's home screen hasn't been tried.

Live check of `7b93623` (run 42068251122, 2026-11-05): `/lizard/lizard.svg` and `/lizard/manifest.webmanifest` return 200, Study on the live site links both from `/lizard/`, cross-origin isolated, Engine ready · 8 threads, 169 cells, with `/`, `/gto-solver/`, `/gto-solver-classic/` and the manifest at 200. The index stayed `index-DGSeHMgE.js` at 298,193 bytes, as this commit changed no app code.

### An exact heads-up PLO4 river solve, and undo keys in a combo box (Phases 3, 7)

`/plo` solves one heads-up PLO4 river from two typed ranges at listed sizes, by discounted CFR in TypeScript on the whole game: every combo, exact blockers, pot-limit maximums from the table engine, and exploitability from exact best responses. It runs in its own worker and route chunk, so none of it is in the first download. Nothing is sampled or bucketed. A spot over 25 million combos times terminal nodes, or about 512 MB, is refused in words. Nothing before the river is solved, the ranges are the reader's own, there's no rake, and sizes outside the list aren't in the tree: the page and the badge say so. PLO stays out of Study, Practice and Analyze.

Against a separate NumPy solve on 6 small spots, the trees and matchups are the same and values agree within 0.00002bb (`docs/ACCURACY.md` §15). Large spots aren't cross-checked and phone speed isn't measured.

I renamed the badge from "Exact heads-up PLO4 river solve" to "Heads-up PLO4 river solve of every combo": a solve stopped short isn't exact, even with "approximate" further along the same badge.

In the range builder, Ctrl+Z and redo now work from inside a combo's box when nothing is typed in it. With a draft they stay the box's own.

Tests: 2718 unit tests in 153 files (2 skipped), typecheck and lint clean, 28 Python reference tests, 118 browser tests passed and 62 skipped. In the full run 10d timed out at its 3-minute grading wait with the machine at a load of about 24; it passed alone in 7.6 s on the same build, so that's what this count uses.

Live check of `4e09587` (run 42076407621, 2026-11-05): `index-CO35XZDj.js` at 299,665 bytes, the name and size a local build gave, title "PLO river · Lizard", cross-origin isolated, and the default river solved on the live site in 2.1 s, 172 iterations at 0.074% of the pot, the same numbers as the local build. `/`, `/gto-solver/`, `/gto-solver-classic/` and the solver manifest return 200.

### The review queue's counting and a true node lock's engine (Phases 4, 5, 6)

An independent review of the Plan and the review queue found nine defects and a hostile-input hole, all now fixed, each with a test that fails without it (56 mutations, all caught).

- **Counting.** A leak's drill read as done with decisions still to deal. Once a Practice miss and an Analyze miss merged, the Plan lost the Practice misses or counted one twice. Entries now say which decisions they hold, and that's what's counted.
- **One spot, one entry.** Practice and Analyze wrote the same spot two ways: a carried stack, rake, custom sizes and a `to` past the cents. A spot is now found by what it is, so a press on a spot already kept says so and a re-miss merges. Ids don't change, so there's no migration. An imported history doesn't carry rake, so it stays apart from a raked Practice miss on the same line.
- **Words.** Rough EVs keep their ≈ in Review, a capped grade says so on its row, Study names an equity or category filter over the actions and leaves it off the opponent's grid, a leak drill's total no longer counts tournament hands it won't deal, Add to review says why it can't rather than blaming a private window, and two sentences that weren't true are rewritten.
- **Provenance.** A label kept with a grade is used only if it opens with its source's own words, and never for charts, so a crafted backup can't call a chart solved.

Left as it was: duplicate pairs already in a queue stay two records, Practice hands kept before this have no setup so their raked spots key apart, and Analyze still grades a raked Practice hand unraked (its link now carries the rake).

`engine/nodelock.py` is a true node lock, built outside `solver/`: it holds a player's mix at chosen decisions, for the whole range, classes or single combos, and re-solves everything else, the answer an equilibrium of the restricted game. On 31 cases over 6 rivers and 2 turns it matches a restricted LP (`scripts/benchmarks/refsolver/locks.py`, `nodelock_bench.py`) to 4.4e-5% of the pot at the top iteration count, with exploitability under 0.003%, and the mix reads back exactly. 5 of the cases have no power on value, as the lock didn't move it, and 1 of 7 deliberately wrong solves isn't caught by value (a leak on a single runout of 48; a unit test catches it directly). It isn't reachable from the app yet.

Tests: 2792 unit tests in 155 files (2 skipped), typecheck and lint clean, 118 browser tests passed and 62 skipped, on a snapshot taken before the commit. `scripts/engine` and `scripts/benchmarks` pass. A correction: `58989c8` also picked up early node-lock wiring the snapshot didn't have, as I staged by a list of changed paths while that work was going on. CI failed it at the typecheck, so it never deployed and the site stayed on `4e09587`. The next commit takes those files back to the snapshot's, so what's on `main` is what the gates ran on.

### 2026-11-05: a true node lock in Study (Phase 6)

`1e2fe73` verified live: run 42082983018 green, `index-s0uRGMLk.js` 300,231 bytes matches the snapshot's build, `/lizard/review/`, `/lizard/plo/`, the manifest, `/`, `/gto-solver/` and `/gto-solver-classic/` all 200.

Study now has "Hold this node at a mix (true node lock)". It holds the seat to act at a typed mix, for the whole range, hand classes or one combo, re-solves that street and below with both players adjusting, and shows the result beside the unlocked answer: each seat's value, the change per action, the decisions around the lock, exploitability and lock cost. Its badge says "Node-locked equilibrium of the restricted game, not the unlocked equilibrium". The older panel is now "Against a read (best response)", as it never re-solved anything. Preflop, multiway, tournament and rule-fallback nodes say why not before any solve. `engine/` now ships in `solver.zip`, by `scripts/pyodide/bundle_engine.py`.

First run on the wasm core, in a browser: `solver.core` true, 300 iterations, each mix held as asked. `Kd7c2h` BB 50/50: value -1.8131bb (native -1.8129), exploitability 0.0874% (0.0963%). `Kd7c2h` BTN's AKs and KQs held: -1.2611bb (-1.2611), 0.0769% (0.0766%). `Kd7c2h5s` BB held: 0.0547bb (0.0547), 0.1765% (0.1788%). An Accurate turn lock ran 1,000 iterations to 0.027%, and a run cancelled at 800 of 1,000 said "Stopped." and left the engine able to solve. The browser process grew about 300 MB over that turn's two solves.

Not measured: an Accurate flop lock. The baseline stays in memory beside the locked solve, so that's an estimated 1.2 GB, and free memory was under 40% when I'd have run it, so the panel says it's an estimate instead. Benchmark note: besides the 5 cases with no power, 4 more moved value by less than the tolerance, so 22 of the 31 have real power (ACCURACY section 16).

Tests: 2822 unit tests in 157 files (2 skipped), typecheck and lint clean, 121 browser tests passed and 68 skipped, `scripts/engine` 104 tests OK. `docs/FEATURE_MATRIX.md` also had a pass over stale notes: the tally is recounted (63 rows, Lizard 8 / 47 / 5 / 3, engine 12 / 40 / 4 / 7), and how the grades were reached is restated.

Live check of `e6ac43e`: run 42087738239 green, `index-w4figzSS.js` 301,360 bytes matches the local build, engine bundle 712,774 bytes with version `8b6a5072b4`, `/`, `/gto-solver/` and `/gto-solver-classic/` 200, Engine ready · 8 threads. On the live site a lock ran on a live heads-up flop and on a stored flop, `srp_btn_bb` Ks7d2c: the node's answer stayed "Precomputed solution", and the lock came back beside a live solve of that flop, with the note saying stored flops can't be re-solved.

### 2026-11-05: answers kept with spots, recovery from a database that won't open, river and turn-bet drills (Phases 2, 3, 5, 6)

**Saved answers.** A saved spot now keeps its finished answer. Reopening it shows that answer at once, without starting the engine, marked with its date and build. An answer from another build says so, and Re-solve is one press. What produced the answer is worked out from the answer again, never taken from the record, so a hand-edited record can't call a chart solved. A backup carries answers, and a restored one says it came from a file. Answers over 512 KB are refused in words and the line is saved without one. Schema v9 adds `savedAnswers`, tested on v8 data.

**Recovery.** When the browser won't open the database, a panel says why, tries again, downloads what can still be read, and starts fresh behind a confirm whose default keeps everything, then offers a restore. In a real browser I tested the real refusal, a database at a later version, through download, delete and restore. A truly corrupted store wasn't tested.

**Saved page.** Sort (remembered), one search, tags on every kind, and export of one item.

**Drills.** River first to act or after a check, and two turn decisions facing a bet, dealt from stored turn files and graded by a live solve's EVs at Fast or above. Whatever isn't a measured live solve is refused in words and scores nothing: rules, equity, charts, a rough or cut-short solve, a line leaning on the betting rules. Native, 48 deals at Fast budgets: at most 0.14% of the pot, mean 4 s, longest 17 s. Answered: rivers 20 of 21, out of position facing a bet 7 of 10, in position facing a bet only 6 of 17, as the live tree's other sizes make the stored 75% rare. A river facing a bet isn't dealt, as no file stores who calls a turn bet. Checked in a real browser on the wasm core: a river at 0.12%, 300 iterations, a turn spot refused with nothing scored. Wasm time wasn't measured properly.

**4-bet pots** are a new Practice pot type: chart preflop, played for you, live decisions after it. Native at Quick budgets on about a dozen lines: at most 0.01%, one cold 4-bet leaning on rules, which Practice doesn't flag beyond its usual cap.

**Smaller.** Study can change the card on the street on screen and keep the line. Analyze now grades a raked Practice hand with its rake and cap, which corrects the "still grades a raked Practice hand unraked" noted above; imported hands stay unraked. Browser tests were added for the Phase 5 and 6 acceptance chains and for a side pot from an all-in of separate stacks.


Tests: 2988 unit tests in 163 files (2 skipped), typecheck and lint clean, 131 browser tests passed and 88 skipped, `scripts/engine` OK. New browser tests: `web/e2e/saved.e2e.ts` (4), `web/e2e/chains.e2e.ts` (2), `qa.e2e.ts` 2b, 5b, 7e, and 11b (reads the live library, so not in CI).

Live check of `1fde274`: run 42095655679 green, `index-Cu0960xe.js` 310,507 bytes matches the local build, engine version `8b6a5072b4`, `/`, `/gto-solver/`, `/gto-solver-classic/`, `/lizard/saved/` and `/lizard/practice/` 200, cross-origin isolated, the database at version 9, and a heads-up river drill answered on the live library.

### 2026-11-05: rates by seat and pot, hand filters on pot drills, drills at your own game (Phases 3 and 5)

**Rates.** History has "Rates by seat and pot type": a table graded by EV and a separate one by frequency for each, never averaged, under what graded them. The pot is named as it stood when you decided, so an open is Unopened and facing an open is SRP, which is why it differs from the by-hand pot table, and the page says so. Decisions kept before this stay in every total and are counted apart, with no seat made up. Seat rows merge table sizes, and stored library drills write no seat or pot. A crafted cell counts nowhere; a wholly self-consistent forged session can't be told from a real one.

**Hand filter on pot drills.** New session offers a Hands select with a pot drill, one table only. Made hands and draws are read on the flop dealt, hand classes on your two cards, and grading is unchanged, which the form says once. A category whose deals would run out more than 1 time in 4 at the hardest seat isn't offered in that pot (3-bet pots 23 of 25, 4-bet pots 21 of 25). Node: 295 board filters × 25 hands, longest search that found its hand 15 ms, with nothing to find 0.35 s, then it stops in words. History's session line now names the board and hand filters. Copy for AI names the hand filter, not the board filter.

**Your own game.** The Plan's generated drills and thin rows take the table and stack of your last Practice session, not its ante, rake or straddle, and say so; with no session they stay 6-max 100bb and say that. A library drill is offered only at your game, otherwise the drill stays a session of hands. The note above about needing a new Practice field was wrong: session records already hold both.

On the real worker, a 4-bet pot asked for quads found one in 4.9 s, in a real browser (one run; a run that finds none would take longer, and stops in words). Tests: 3112 unit tests in 163 files (2 skipped), typecheck and lint clean, 133 browser tests passed (the full run had 132 with one failing on my test's selector, fixed and that test run alone).

Live check of `3540ec3`: run 42101529951 green, `index-BVz3Ww-i.js` 310,525 bytes is the local build's name, `/lizard/history/`, `/lizard/plan/`, `/`, `/gto-solver/` and `/gto-solver-classic/` 200, and the Hands filter on the live page offers Any plus 21 categories for 4-bet pots.

### 2026-11-05: preflop graded by the stored solve, and a turn report over a sample of flops (Phases 3 and 7)

**Preflop solve grades.** New session has "Grade preflop by the preflop solve", off by default, for the two stored games only: 6-max 100bb, unraked or at 5% capped at 3bb. It changes no move, only the grade. A decision is graded by EV only where the solve's node is that very spot, the same pot and options at the same sizes, your class still in range, settled before you choose so a pick can't select the grader. Everywhere else it keeps the chart's frequency grade under the chart's label and says why. A size is never mapped onto another. Native, 30,000 hands of the charts: 70.1% of decisions answered, first in 100%, facing an open 46.7%, facing a 3-bet 3.7%, facing a 4-bet 8.3%, the SB 23.3%, the BB 12.0%, mostly as the blinds' chart 3-bets to 10bb and the solve's to 12bb. So it's weakest where a preflop mistake costs most. Playing the charts exactly is called below Correct 8.9% of the time, the two disagreeing, and the page says so. In a real browser: the stored file fetched once, both kinds of grade seen under their own names, History's preflop row split in two. History's street totals now give any street graded both ways one row per basis, and session rows show both shares. Lifetime totals by kind and pot still span both bases in their share, and a session's EV lost adds preflop-solve bb to postflop bb: left as they are, documented.

**Turn report.** Reports reads an even seeded sample of 40 stored flops of a texture, nothing until asked, with buttons to read more, and shows the stored turn's first decisions by turn card class with flops, combos and a margin. Over 100 seeds, 11 spots and 10 textures against reading every flop, the stated margin held 96.7% of the time, and against the solver's `store_parts` the mean difference was 0.16 points, worst 1.73. 11 of 20 heads-up spots store turns, and a texture's stored flops aren't random, which the panel states. In a real browser on the live library: 40 flops in 2.5 s, ±3.4 points on `3bp_bb_btn` rainbow, no sideways scroll on desktop. Phone timing wasn't measured.

Tests: 3201 unit tests in 167 files (2 skipped), typecheck and lint clean, 135 browser tests passed and 96 skipped, `scripts/engine` OK. On the last full run 132 passed and steps 11, 11b and 11c failed with `getaddrinfo ENOTFOUND www.michael-han.com`, a DNS drop on this machine in the only three tests that read the live library; run again alone on the same tree, all three passed. New browser tests: 7e, 7f, 7g, 11c and the third test in `web/e2e/chains.e2e.ts`. Two faults the gates caught before this commit: a race in the turn report's own test that failed about one run in five, and the preflop option's note pushing Your move below a tablet's first screen.

Live check of `0c12c9a`: run 42122309901 green, the page serves `index-DKyYjZuv.js` (301,706 bytes), `/lizard/`, `/lizard/reports/`, `/lizard/practice/`, `/lizard/solver/manifest.json`, `/`, `/gto-solver/` and `/gto-solver-classic/` all 200. In a real browser on the live page, the Game form offers "Grade preflop by the preflop solve", naming the class-level model and with its note hidden until ticked, and the turn report on `3bp_bb_btn` read 40 of 1,203 flops and showed its provenance as approximate. A graded preflop hand was not played on the live page; that path is covered by browser test 7g.

### 2026-11-05: an independent review of this session's new code (Phase 7)

Two read-only reviewers, one on poker rules and numbers, one on security, privacy, data safety and access, were given the code and not my conclusions. They worked from reading, and I checked each finding against the code before acting on it. Nothing critical; five major, twelve minor; all seventeen were real and all are fixed.

**Grading.**
- A live solve 10% of the pot or more from equilibrium could still be graded. `liveRefusal` read the band, and past ten times its target a heads-up answer's band is "approximate" however far off it is, so "rough" never arrived. It now reads the number. The test passed only because its fixture had a shape the browser never produces.
- Retrying a live drill's mistake skipped everything the drill guards: at default settings it ran at Quick, which narrows an earlier street by the rules and still reads as a live solve, with no refusal, no cap and no mention of the rules. It now asks at Fast or above and refuses or caps as the drill does. Mistakes kept before this have no mark and still retry the old way.
- A tree bet rounded half up where the solver rounds half to even, so a stored line at an odd pot of 3 mod 4 showed the wrong bet and pot: 26.5bb for the tree's 26bb at a 35bb pot.
- "Quads or better" never matched a straight flush on an unpaired board. On a river, a hand that only plays the board counted as made; the reviewer's suggested test would also have refused a higher straight, so it compares hand values and a hand that beats the board still counts.
- History's "Best or Correct" by kind and pot mixes EV and frequency grades and now says so on the page; the seat and pot tables are what keep them apart. The Plan said the table was yours when a seat had moved it to a larger one.

**Data.**
- A backup the page made could be refused by its own restore, past the 256 MB import limit; restore now reads up to 1 GB, and a backup too big for a browser to write says so.
- A slow salvage threw away all it had read and said nothing could be read. It now keeps what it read, names the stores it didn't finish, and lets go of the database, which a hung read would otherwise have held against Start fresh. My first version of this fix didn't, and its own test caught that.
- Start fresh could be pressed during that read. A restore the browser stopped partway said nothing of what came in; it now says, and says running it again is safe. Edit forms opened on stale text, and Save could write that over a restored record. A crafted saved answer's tournament block could crash Study; it now reads as unreadable. Backup's words now name saved reports.

**Access.** Session Retry dropped the keyboard to the top of the page at each step and never announced its grade. It now moves focus into the retry, on to Close with the grade in a live region, and back to the opener. The recovery panel and the turn report's Read and Another sample buttons, and Re-solve, keep focus too, and a restore in the recovery panel shows that it's running.

**Not fixed, because nothing was found:** nothing from a file or URL reaches `innerHTML`, links from backups stay same-origin, no prototype pollution, restore can't overwrite settings, migration 9 is additive, and nothing leaves the device but a solver URL the user sets. Turn report margins, pot and action order, preflop solve reads, History's cell keys and denominators, and card removal were checked and held.

Tests after these fixes: 3212 unit tests in 167 files (2 skipped), typecheck and lint clean, 135 browser tests passed and 96 skipped, `scripts/engine` OK, on a clean run with no retries. The fixes to grading and to data handling have tests of their own, with these exceptions, checked by reading only: the words when a backup is too big to write, the words of a restore stopped partway (the stop itself is tested), Start fresh being unavailable during the read, the restore-running state, and the new words on the History and Review pages. For focus, tests cover Session Retry, Keep it and the turn report's Read and Another sample; the focus move after Started fresh and after Re-solve is untested. None of the keyboard work has been tried with a real screen reader. The first gate caught one of mine: taking the river's hand values from the PLO evaluator pulled PLO code into the first bundle, so it uses the core evaluator.

Live check of `6b9da49`: run 42126969081 green, `index-HNclQ6ts.js` 303,245 bytes is the local build's name and size, `/lizard/`, `/lizard/saved/`, `/lizard/review/`, `/lizard/practice/`, `/lizard/solver/manifest.json`, `/`, `/gto-solver/` and `/gto-solver-classic/` all 200. In a real browser on the live page, the Backup panel names saved reports. No refused live solve or kept live-drill retry was exercised on the live page; those paths are covered by unit tests.

With this, the plan's Phase 7 list stands as follows. All 14 QA steps have browser tests, and steps 11, 11b and 11c read the live library and skip in CI. The independent audits have run and nothing critical is open. What's left needs a decision or a server (multiplayer, account sync, AI explanations through a proxy, cloud compute) or more library (coverage grows as the builds finish), or was cut with reasons above (streaming imports, 3+ way all-in EV, Hint and Reveal above one table).

The library publish of 2026-11-05 about 23:17 failed on its push and left its commit unsent, and my report that it would retry by itself was wrong: every later run saw nothing new to commit and stopped there, so the live site stayed at 1,734 heads-up flops. `scripts/library/publish.sh` now sends a commit left behind by a failed push. Rerun on 2026-11-06: `srp_sb_bb_2max` 1,755 and `lp_sb_bb_2max` 208 on the live index, checked by fetching it, with the local clone no longer ahead of its remote. That run took 2,634 s rather than about 500, as the machine guard held it paused for about 44 minutes.

### 2026-11-06: the owner's decisions, built (Phases 3, 5, 6 and 7, and Phase 11's code)

The owner answered every open decision. All of it that needs no account of theirs is in this commit, except the nut advantage library step, which waits for the builds as they chose.

- **CI:** a push of docs alone no longer runs the pipeline.
- **Totals:** History's rows give a figure a way of grading, and so do Practice's score and table rail once a session has been graded more than one way. Analyze's summary, Winnings and the Plan keep the preflop solve's EV lost apart from a spot's. `ACCURACY.md` §18.2 lists where that holds and where it doesn't.
- **Patterns:** on by default, with an off switch in Settings.
- **Restores remember deletions:** database v10 adds `tombstones`, written in the delete's own transaction and carried in a backup. A restore leaves out what was deleted after that copy changed, and says so. A file's tombstone only blocks: it never deletes what's here. An item exported on its own can't be brought back after it's deleted, as the file carries no way to say so.
- **Preflop solve's raise sizes:** a second box, off by default. Over 30,000 hands playing the charts, 96.2% of decisions are answered by the solve, and 3.9% of hands hold one it can't grade, against 30.8% without it. It costs flop-library hits, and the form says so.
- **Analyze's preflop grade:** by the same stored solve where the game is one it covers, by the charts elsewhere, and each decision says which.
- **`/practice?play=`:** asks first with a hand under way, with Keep this session as the default.
- **Account sync:** the Worker and the client are built and not deployed. The panel is left out of the build until the repo variable `LIZARD_SYNC` is set, so the site makes no request to it. `scripts/sync_check.mjs` runs the Worker's real code on SQLite with mail stood in for, in two real browsers: sign-in from a link on a new device through the service worker's first-visit reload, a wrong passphrase refused, a spot reaching the second device sealed, a deletion coming back, stay-unlocked keys kept unextractable, and the account deleted. All passed. It found one bug the unit tests hadn't: a link pasted into a tab already on Settings changes only the fragment, so nothing read it. Real D1 and real Resend are untested, and need the owner's accounts (`DEPLOYMENT.md` section 6).

Two things to know. Practice hands from a session that didn't tick the box get the solve in Analyze where it can, as the owner chose, so a decision there can show a different basis from the one at the table; it's labelled. Hands from a site are read as the no-rake game, as a history gives no rake percentage or cap.

Tests before this commit: 3318 unit tests in 171 files (2 skipped), typecheck and lint clean, `scripts/engine` OK, the Worker's 24 tests and the two-browser sync check. The browser run gave 136 passed and 2 failed, 12 and 7h: 12 still expected a backup to bring back what was deleted after it, and 7h's pattern didn't match the button's words, so neither was the app. Both were corrected, and pass run alone. 7h and 7i have now run in a real browser.

Live check of `0e4be85`: run 42195777801 green, `index-DPpLcghx.js` 303,047 bytes is the local build's name and size, `/lizard/`, `/lizard/settings/`, `/lizard/practice/`, `/lizard/saved/`, `/lizard/analyze/`, `/lizard/solver/manifest.json`, `/`, `/gto-solver/` and `/gto-solver-classic/` answer 200, and `/lizard/api/health` answers 404, as it should with no service there. In a browser on the live site: database version 10, the patterns switch present and on, no Account sync panel, no request to `/lizard/api`, and Practice's "Grade preflop by the preflop solve" with its second box appearing only on ticking.

### 2026-11-06: nut advantage, ready for when the builds finish (Phase 3)

The owner chose to run the nut advantage library step after the builds finish, and the limped SB-vs-BB spot is still building (208 of 552 stored flops at the last publish). So the step and its reader are built, and the step hasn't run over the library.

- `scripts/library/nuts.py` works each flop's nut share from `ranges.json` with the solver's `range_equities` and Study's definition. It refuses while `hu-solver` runs or a spot is short of its target, saves every 50 flops and never does a flop twice.
- `publish.sh` calls it on each run, so the launchd job starts it by itself once the builds are done. `assemble.py` publishes `<spot>/nuts.json` for the ranges and flops the index lists, and names it in the index.
- Reports shows a sortable Nut adv column once a spot has the file, phone-hidden behind the existing button, with its definition, how many flops have it and the CSV marked as calculated, not solved. Without the file nothing changes and nothing is requested.

The time and error differ from what I reported earlier. The 54 minutes was over about 25,000 flops at 0.13 s; the library is now about 28,000, and a flop took about 0.23 s under load, so one to two hours. The error wasn't measured before: on 20 flops against every runout a share is off by about half a point on average and 4.1 at most (`docs/ACCURACY.md` section 19), and the page says a small lead may be no lead.

Tests before this commit: 3325 unit tests (2 skipped), typecheck and lint clean, `scripts/library` 16 tests. The browser run gave 138 passed and one failed, the new step 11d, which had a mistake of its own: it asked for the live index with the page's conditional request and got an empty 304, and named a flop the library doesn't store. Fixed, 11d passes alone on the built site, desktop and 375px, with the file stood in. The real file has never been read by the page, since none exists yet.

Live check of `e58d362`: run 42202219060 green, `index-Czn0lyv6.js` 303,047 bytes is the local build's name and size, `/lizard/`, `/lizard/reports/`, `/lizard/settings/`, `/lizard/solver/manifest.json`, `/`, `/gto-solver/` and `/gto-solver-classic/` answer 200, and `/lizard/api/health` answers 404, as it should. In a browser on the live site, `srp_btn_bb` on Reports reads as before: Range adv BTN +9.0 over all flops, no Nut adv column, no request for `nuts.json`, none to `/lizard/api`. The console's only errors are the Cloudflare beacon the CSP blocks, which goes when the owner turns it off.

With this, everything the owner decided that needs neither their keys nor the finished builds is done. Two things are left: the nut shares, which the launchd job runs by itself once the builds finish, and account sync going live, which needs the owner's Cloudflare and Resend setup (`docs/DEPLOYMENT.md` section 6).

Live check of `fbec044`: run 42293060327 green with `LIZARD_SYNC=on`, `index-CZspHo9b.js` 295,563 bytes, the Account sync panel in Settings, `/lizard/api/health` 200 and `/`, `/gto-solver/`, `/gto-solver-classic/` 200. The owner signed in by a real mailed link on real D1: one user, one session and one record in the rows afterwards. That was one browser, so a second browser, a deletion crossing over and reading the rows for ciphertext alone had not been done.

### 2026-11-07: Sign in with Google in place of the magic link, and the last of the unlike grades kept apart (Phase 7)

The owner tried the magic link live and changed their mind: "why so complicated jsut do sign in with google instead". So it's Google, and the mail path is gone: the Resend call, `login_tokens`, the token in the address and the form.

- **The flow** is a plain link and two redirects run by the Worker (OpenID Connect's code flow with PKCE). No Google script runs on the site, because the site's `script-src 'self'` and its isolation headers, which the engine's threads need, would have had to weaken for one.
- **It asks only for `openid`**, so the service never receives an email or a name, which is less than the magic link needed. It keeps a keyed hash of the number Google gives the account. What it costs: Google knows you signed in to Lizard.
- **Not in the way before it works:** `GET health` answers 503 until `GOOGLE_CLIENT_SECRET` is set, and the panel shows only once it answers, so the deployed site needs no second deploy when the secret goes in.
- **Grades, from the owner's "split them":** Analyze's report tables give a row graded more than one way a figure a way under it, with no share or EV lost for the row as a whole. The Plan orders by EV lost to a solve of the spot, then by EV lost to the preflop solve, then by frequency, and never adds the two. A leak drill's score line splits, and keeps its picks a way for History. The EV-lost filter stands a hand at the larger kind rather than the sum. The JSON summary keeps the two EVs in separate fields.
- **`?scenario=`** now waits for the kept session and asks first, as `?play=` does.

A note on process. The subagent checking unverified features in a browser died when the Mac restarted overnight, and I went on waiting for its notice, so nothing ran for about sixteen hours. Its test file `web/e2e/checks.e2e.ts` is kept and was finished after that commit (see the next entry).

Tests before this commit: 3346 unit tests in 171 files (2 skipped), typecheck and lint clean, `scripts/engine` OK, the Worker's 28 tests, and the two-browser sync check with Google stood in for, 12 of 12. The browser run gave 138 passed and 1 failed, step 7d, whose new line assumed a dialog that shows only when a hand was kept in time. It now takes either, and passed alone. Google itself hasn't been reached: that needs the owner's client.

Live check of `daad850`: run 42379285348 green, `index-Dm744-HT.js` 295,518 bytes, `/lizard/` and six more pages, `/lizard/solver/manifest.json`, `/`, `/gto-solver/` and `/gto-solver-classic/` 200. Worker version 43350160 is on its route, the database has `account_hash` and no `login_tokens`, its one old row kept. `health` answers 503, so Settings shows no sync panel, as meant until the Google client exists. The console shows that 503 and the Cloudflare beacon the page's own policy blocks, which goes when the owner turns the beacon off. The Worker's secrets weren't changed: writing them was refused to me, so `docs/DEPLOYMENT.md` §6 has the owner run those commands.

### 2026-11-07: the features that had no look in a browser (Phases 2 to 6)

`web/e2e/checks.e2e.ts` is 13 tests on the built site and the real worker, for matrix rows that said "not yet checked in a browser". It runs in the local gate and is skipped in CI, as several read the live library or wait on the worker and none should hold up a deploy. Two real faults came out of it:

- **Practice at tablet size:** with the Game form open, the first hand started below the fold at 1024×768, and the last option ended at 934px. New session now brings the table up, at one table, as several tables already did.
- **History:** Totals by kind and by street could scroll sideways at 375px, but no key could reach them. They're stops for the keys now, like the rate tables.

The other faults were in the tests. Timings through the real worker, with builds and other sessions on the machine: 40 flops of the turn report read in 2.0 s, a 3-way turn report 5.0 s, 3-bet pots on monotone flops at worst 2.7 s to deal, a 4-bet pot 6.7 s, and on a straight filter 8.5 s. Running out of the 3,000 deals wasn't reached, so that stays untimed.

Tests before this commit: 3346 unit tests in 171 files (2 skipped), typecheck and lint clean, `scripts/engine` OK, and all 152 browser tests passed.

Live check of `2cbd957`: run 42381640713 green, `index-DaHiDh6A.js` 295,555 bytes, `/lizard/` and three more pages, `/lizard/solver/manifest.json`, `/`, `/gto-solver/` and `/gto-solver-classic/` 200, `health` still 503 until the Google client exists. The scroll on New session couldn't be seen in the browser pane, which was hidden, so nothing that animates runs there. The tablet test now asserts it straight after the press, with no other click to cause it, and passes.

### 2026-11-07: sync with no passphrase, the turn report's chart and CSV, and one split in Study (Phases 3, 6, 7)

**Sync.** The owner chose to drop the passphrase, so signing in with Google is now all there is to it. No client-side encryption is left: `web/src/sync/crypto.ts` is gone, a record goes as JSON, and `PUT keys`, the salt and check value, Lock, Unlock and Stay unlocked went with it. The server can read what's synced, so the words moved with the risk:

- `ABOUT_SYNC`, above the Sign in button, says signing in starts it, that nothing is encrypted end to end, that the site's owner can read it and Cloudflare could, player names in imported hands included, and that staying signed out with Download backup avoids it.
- Home and Settings said your data stays on this device. They now say that only until you sign in, and Settings speaks for settings alone.
- The account panel says D1's restore points can hold a deleted copy for up to 30 days.

The salt had a second job: a browser used it to tell that the copy on the server wasn't the one it had been keeping up with. `GET me` now gives the account's row id for that, or an account deleted and come back would never be sent what the browser holds. A record's size is counted in bytes on the Worker and as sent on the client, as a hand's quotes are escaped in the request. Two-browser check (`scripts/sync_check.mjs`, Google and D1 stood in for): 11 of 11. The Worker has 29 tests. It still hasn't run against Google.

**Turn report.** A chart of the table's rows (`TurnChart.tsx`) and "Download turn CSV", each carrying what the numbers are and how many flops they stand on. A stopped or unfinished read says so on every row and in the file's name. The action palette, used app-wide, fails the dataviz validator in dark mode (normal-vision separation 9.2 on `#d23c4b` / `#e8613c` against a floor of 15, All-in's contrast 2.21 against the surface): the patterns, gaps, legend and table offset it, and it wasn't changed here.

**Study.** Build mode's grid now shares Study's split (`StudySplit.tsx`), and Enter resets the separator. Fixing that found a fault: `1` or `b` on the focused separator left the grid in Study, and `2` changed the brush in Build. The separator now counts as a control that keeps single keys. One first End at 1440px stopped at 68% rather than 74%, in one run of five, unexplained and unfixed; a second press reaches it.

Tests before this commit: 3355 unit tests in 170 files (2 skipped), typecheck and lint clean, `scripts/engine` OK, the Worker's 29, and 151 browser tests passed with 130 skipped. One failed: `/study` on desktop timed out at 60 s, because the machine guard paused the Playwright runner from 10:25 to 10:51 (memory tight, the runner at 2.5 GB, over the 1 GB this project keeps to). That test then passed 5 of 5 alone. The rest of the suite wasn't rerun.

### 2026-11-07: Study's panes hold the Actions and the breakdown, and combos can be locked (Phases 3, 5)

**Study.** From `lg` the Actions row, the combos and the Breakdown all sit in the right pane, so the separator resizes them. The plan names three regions and this is two panes: Actions took the top of the right pane, as the plan keeps the left for the matrix alone. The panels lay out by the pane's width now, not the window's. A screenshot found what an overflow check can't: at 320px the combo table's EV and Eq columns ran together, read as "3.0498.5%1.55". That's fixed, and the browser step asserts a gap. With the Breakdown open, the column under the matrix is empty.

**Range builder.** A combo painted apart can be locked. Class locks turned out not to be undo steps, though this file's matrix row said a group's lock was: both kinds now live in the paint, so each is one step, and undoing Reset brings them back. A lock moves no score.

**Compare.** A library river offering four sizes opened Compare's menu field in the error state, on the spot's own menu, because the limit on typed menus was checked first.

Left open, not investigated: the same heads-up river link gave BB 415 combos in one run and about 308 in others, and one run's note said the narrowing solve stopped at 49 iterations.

### 2026-11-08: Analyze reads PokerNow's hands download (owner's request)

**Import.** PokerNow's .json download is rewritten hand by hand as a PokerStars-like history (`web/src/hh/pokernow.ts`), so Analyze's replay, grading, stats, results and sessions read it unchanged; the site is "PokerNow", first in the parser's site list. The event codes come from the owner's 122-hand tournament download, as no schema is published: chips put in less any bet returned add up to the pots won in all 121 finished hands. Other codes, bomb pots, double boards and unfinished hands are refused, each saying why, and a refused hand is listed with its number. Names are rewritten so the parser can't take one for its own lines ("Dealt to", "Seat", "Winamax Poker", "Cashout"). A multi-table tournament repeats hand numbers (21 of the 122), so each hand's number carries a hash of its PokerNow id. Not confirmed: whether `cents` means the amounts are hundredths (taken so; bb results don't depend on it), and the codes for antes, straddles and run-it-twice beyond the second board being dropped.

Tests: `pokernow.test.ts` (6) and the `hh` and Analyze suites, 372 passed with 1 skipped; typecheck and lint clean. The full unit suite and browser suite weren't run. In the dev app, the real download picked through "Choose files…" gave 122 read, 115 kept, 6 with no decision and 1 unfinished, and hand 104's replay matches its raw events. The download was served from `web/public` for that check and then deleted; it isn't in the repo. The precompute builds were left alone.


### 2026-11-08: rows close to done are finished or graded WORKING (owner's request; Phases 1, 3, 7)

The owner asked for the PARTIAL rows to be fixed, and for a row to count as WORKING when its core works and only edges are left. An audit of every PARTIAL row against the code sorted them. 22 rows needed only a regrade: their gaps were edge cases, polish or environments not tried, and each note now says "WORKING by the owner's rule of 2026-11-08" with what is left. Stale claims were corrected on the way (a 4-way answer and Study's 3-way runout report are checked in browser tests; EV lost is kept apart by way of grading; saved drills keep street and hand filter; one drill can be exported; saved answers are browser-tested).

**Fixed, then graded:**

- **Payout structures.** A payout table pasted from a site or a sheet is read place by place into Solve's Payouts and Practice's Prizes left (`pastedPayouts`): ordinals, ranges, currency signs, thousands commas, percents; a place left out is a gap the check names. Typed lists take `$` and commas too.
- **Mobile.** PNG icons at 192 and 512, a maskable 512 and an `apple-touch-icon`, rendered from `lizard.svg`; the manifest test fetches each and checks its size.
- **Range comparison.** Study's "Side by side" puts the player to act's range and an opponent's next to each other, each named, totalled and badged with its source; `vs` in the link; 3-way picks the opponent; stacked below `lg`.
- **Drills.** Live drills ran in a browser on the live site: a river first to act answered in 6–11 s (7.8 s for the first, with the engine starting), turn facing a bet answered and graded. A live drill lists its earlier sessions, as a stored one does (`PastDrills.tsx`).
- **Postflop trainer** and **Automatic sizing** graded WORKING with their limits named (no 3-way drills, river facing a bet not dealt; sizes for the node on screen, heads-up, where the player can bet).

Lizard's grades: 36 WORKING, 19 PARTIAL, 5 APPROXIMATE, 3 NOT IMPLEMENTED (was 8 / 47 / 5 / 3). What stays PARTIAL rests on the preflop charts (the Analysis rows, EV-loss scoring, the formats, chipEV, ICM and the tournament rows), on the engine (multiway past 3-way, a lock that re-solves the tree), on authored content (Study plans), or on the opponents (Exploit practice: the table still plays equilibrium).

### 2026-11-08: a hand history's short stack opens in Study as it was (Phase 1)

**Analyze → Study.** A tournament seat with less than 1bb (a small blind posted all-in) failed the setup's 1bb floor, so every seat's stack was dropped and Study refused the line ("an earlier street's betting is not finished"). A seat's stack now needs only to be above 0 (to 1000bb), typed or from a hand; the hand's line closes as it was played.

Tests: `analyze.test.ts` (the 3bb all-in blind), `setup.test.ts`; full unit suite 3,400 passed with 2 skipped, typecheck and lint clean. Not checked in a browser.

### 2026-11-09: why one Study link gave different ranges, and the badge now says so (Phase 3)

**Cause.** The Range builder note of 2026-11-07 (the same heads-up river link gave BB 415 combos once, about 308 other times, one run's note saying a narrowing solve stopped at 49 iterations) is the engine working as designed. An earlier street's narrowing solve runs on a wall-clock budget (Fast: 3 s in the browser), and a solve still unsettled when it ends is followed only partly (`PRIOR_TRUST`), the rest of each range from the betting rules, which err wide. On a busy machine the solve gets fewer iterations, so the ranges differ. Native, SB to act on a checked-down Ks7d2c5h9s river: SB 247 combos with a 0.5 s narrowing budget (flop at 55 iterations, followed 40%), 118-126 at 1-12 s.

**Fixed in Lizard.** Study's answers carry only the engine's notes on this, and the badge said "Live solve" over ranges that were partly rules. `rangesOffOf` reads the three notes (an unsettled narrowing solve, a Quick street narrowed by rules, multiway streets narrowed by rules), and the answer is approximate with the reason in its label. Checked in a browser: a 3-way river now says the turn and river ranges are the rules'; the heads-up river settled in that run and stayed "Live solve".

Not changed: the engine's budgets (`solver/` stays upstream's), so the ranges still vary with the device; making narrowing stop at a fixed iteration count would be an upstream change. Tests: `provenance.test.ts` (3 new), full unit suite 3,403 passed with 2 skipped, typecheck and lint clean.

### 2026-11-09: VPIP, PFR, the check-raise and the river barrel against the answer (Phase 6)

**Analyze.** The frequency table compared your play with the answer's on 17 rows, but not VPIP, PFR, the check-raise or the river barrel, because a decision is graded alone and didn't keep what you had done earlier in the hand. It does now (`earlierAt`: your first preflop decision; on the flop, whether your first move was a check; on the river, whether you bet the flop and the turn). VPIP and PFR are at your first preflop decision, where the answer's mix is for the same choice. Grades kept before this get the facts from their hands' histories when Analyze opens and are saved (`fillEarlier`), so nothing has to be graded again. In the browser: 4 sample hands at Quick triage filled all four rows; with the facts stripped from the kept grades, a reload filled all 14 back.

**Study.** Four panels under a node (one size, the read lock, the true node lock, automatic sizing) and two others shared one React key, which React warns about and which can mix up their state when the spot changes. Each has its own now. The heads-up river also showed the unsettled-narrowing badge in a real run this time: "the turn's narrowing solve stopped 2.5% of the pot from equilibrium after 59 iterations… · approximate".

**Matrix.** The Decision grading row said Practice's preflop-solve grading wasn't checked in a browser; `qa.e2e.ts` and `checks.e2e.ts` do check it.

Tests: `grading.test.ts` (2 new), `report.test.ts` (1 new), the shapes test; full unit suite 3,405 passed with 2 skipped and one Practice test timing out at load 26, which passed twice alone; typecheck and lint clean. The browser suite wasn't run.

### 2026-11-10: squeezes from the blinds, stats by seat, ranges on the size tables (Phase 6)

**Analyze.** The last three gaps on the Frequency comparison row:

- **Squeezes from the blinds.** A blind's decision reads "BB defence" or "SB vs open" whether or not someone called the open, so the squeeze row left the blinds out. A decision now keeps how many called the one raise before it (`earlierAt` `callers`), and older grades get it from their histories when Analyze opens, as yesterday's facts do. The row is "Squeeze (any seat)"; links and saved drills under its old name still open it.
- **Stats by seat.** Your stats have a By seat table: VPIP, PFR, 3-bet, fold to 3-bet, c-bet, fold to c-bet and went to showdown, each over its chances at that seat with its 95% range. It follows the filters, as the rest of the panel does.
- **Size tables.** Each bet- and raise-size share has its 95% range under it, "few" under 30, each bet counted on its own.

**Checked in a browser** (dev server, the 4 sample hands): older decisions got `callers` from their histories, VPIP, PFR, flop check-raise and river barrel show with the answer's share, and the By seat table and the size ranges render. At 375px the Stats tables are each a stop for the keys that the arrows scroll (they weren't before), and the seat column stays put. The samples hold no squeeze, so that row is checked by the unit tests only.

**Browser suite.** 48 of 49 passed on desktop before the Stats keyboard change; the 49th passes on its own now. The History session-stats test still expected the next Tab after the seat tables to land on the pot tables. Since 2026-11-08 the note on decisions left out is a disclosure, its own stop in between, and the test now steps through it.

The row is graded WORKING by the owner's rule of 2026-11-08 (37 of 63). What's left there: preflop the answer is the charts' or the class-level preflop solve's, and the size tables aren't compared with a solve.

### 2026-11-10: Exploit practice's opponent plays the profile (Phase 1)

**Practice.** Exploit practice graded you against the best response to an assumed profile while the opponent played the equilibrium, so a hand's chips said nothing of the read and no net was counted. `Advisor.play` reads the opponent's move off the solve's average strategy (`_actor_move`), and the engine's best response turns that strategy into the profile's with `TendencyLock` at each of their nodes. The new `engine/exploit_play.py` runs `Advisor.play` with `_actor_move` wrapped while the request runs: the mix is the node's strategy with the read on it, over the whole range (the read moves hands by strength), then the hand's column, drawn by play's own seed. Nothing in `solver/` changes; the worker gets one more build-time edit (`worker-edits.mjs`) sending a move with a read in its state there.

- **Measured in the same solve** (BB facing BTN's flop c-bet on Kd7s2c, BB's whole range): equilibrium folds 46.7%, calls 38.1%, raises 15.2%; Calling station 26.7 / 65.7 / 7.6; Nit 61.7 / 27.7 / 10.6; Overfolds 61.7 / 23.1 / 15.2. A single hand moves by strength: Th9h's 97% fold becomes a call as a station. `scripts/engine/test_exploit_play.py` (6 tests) checks those shifts, that each move's mix is the locked one, the fallbacks, and that the class is put back even on an error.
- **Fallbacks say so.** Their hand off their range for the line, or a line of yours the solve rarely takes: the equilibrium's move, with why. Preflop is the charts. A local server has no `engine/`, so it's sent no read (its `Advisor.play` would only reshape the ranges) and its moves are the equilibrium's.
- **The chips.** Each hand says how many of their moves after the flop were the profile's. "Net against the profile" counts only the hands where all were, and says how many were left out; the session record keeps it (`meta.read`).

**Checked in a browser** on the real worker (dev server): a Calling station hand, flop c-bet called, turn checked through, river bet: "All 4 of their moves after the flop were the profile's", Net against the profile +11.5bb over 1 hand, each opponent move under a second once the solve was cached. `qa.e2e.ts` 7d now plays an exploit hand to its end and checks the line.

History's row for an exploit session shows the same net against the profile, with the hands left out; one kept before today says it has none (checked in the browser: "net +11.5bb against the profile over 1 hand").

The row is WORKING by the owner's rule of 2026-11-08 (38 of 63). Left: the profiles are hand-set numbers, and a read isn't played preflop or multiway.


**CI.** The deploys of e53e1b6, e460e2c and c2fd656 didn't publish: a browser test (`modes.e2e.ts`, reduced motion) measured the Hands table on its first frame, before its rows laid out, and failed twice; then a unit test (`DrillsPanel.test.tsx`) waited the default 1 s for a grade on a slow runner. Both now wait for the condition itself (15 s and 10 s). Both pass here, the browser test 3 of 3.

### 2026-11-10: the home page's badges follow the feature matrix

Every area card on the home page read "Partial" except Library, with 38 of 63 rows WORKING, because each page's badge was a fixed `status` in `web/src/app/routes.ts`, set when the page was first built and never tied to `docs/FEATURE_MATRIX.md`. Now each page lists the matrix rows it delivers and its badge is worked out from their Lizard grades: "Working" when all are, else "N of M working" (one row: "Partial"), with the rows not yet working and their grades in its tooltip and label. `routes.test.tsx` reads the matrix and fails when a row is renamed, when a grade in `routes.ts` differs from the matrix's, or when a page has no rows. So a grade change has to be made in both places, and the badges can't drift again.

Checked in a browser (dev server): Study 10 of 11 (Preflop approximate), Practice 8 of 10, Analyze 5 of 8, Solve 7 of 10, Tournaments 2 of 7; Reports, Ranges, History and Saved "Working"; Plan and Review "Partial" (Study plans). Library, Engine and Settings carry no matrix row and stay "Working".

### 2026-11-10: stages of an MTT, set up at once (Phase 7)

**Tournaments and Practice.** The MTT / final table row asked for stage and final-table presets, and Lizard had payout shapes only. `STAGE_PRESETS` in `web/src/features/tournaments/tournament.ts` holds six stages, Lizard's own generic shapes and not any site's:

- Early: 1,000 left, 150 paid, 60bb.
- Bubble: 116 left, 115 paid, 6–48bb.
- Final-table bubble: two tables of 5, 9 paid.
- Final table: 9 left, 6–62bb.
- Three left.
- Heads-up.

Each one sets the table's size, every seat's chips (the table's stack is the biggest, the others their own), a 1bb big-blind ante as each seat's share, the prizes left and the other tables, from the first decision. They're on the Tournaments page as a row of buttons, with the stage said in a live line ("…the stage's numbers are Lizard's own, not any site's"), and in Practice's tournament session as a Stage list. A prize list over 12 places is now named by its first three, how many and the last ("payouts 11.8/6.8/4.9 … 115 places, the last 0.3"), not all 115.

**Checked in a browser** (dev server, real worker):
- Final table opened in Study under "Preflop charts · chip chart with a risk premium · approximate".
- Bubble opened under "116 players modelled by 12", with UTG's bubble factor against each of the seven others (1.06 to 1.36).
- A Practice session at Final table dealt hand 1 with each seat's own stack, a 0.11bb ante and the nine prizes.

Tests: `tournament.test.ts` (every stage passes the setup and tournament checks, its players left and places paid), `SolvePage.test.tsx` (the Final table stage to a Study link with each seat's stack; the bubble's 108 others and 115 places; Clear), `games.test.tsx` (a Practice session from the Final-table bubble).

The row is WORKING by the owner's rule of 2026-11-08 (39 of 63); the home page's Tournaments card now reads 3 of 7. Left: no tournament library, and Practice's tournament session is one table frozen in time.

### 2026-11-10: lessons on the Plan page (Phase 9)

**Plan.** The Study plans row asked for structured lessons with drills, and Lizard had a rule-made plan and a review queue only. The Plan page now has 12 lessons of Lizard's own (`web/src/features/plan/lessons.ts`, `LessonsPanel.tsx`) in four units:

- single-raised pots in position;
- defending the big blind;
- seats and ranges;
- 3-bet pots.

Each lesson is one decision of a flop-library spot that both libraries hold, and has three parts:

- **A report to read.** Reports opens grouped by a texture. The group being compared is left unfiltered, so a lesson on monotone flops reads every suit's row.
- **A question to answer from the report,** and another to ask yourself while drilling.
- **A drill of that decision** at the lesson's flops.

The lessons only ask. Every number is the library's, under its badge.

**Progress.** A lesson is done at 20 decisions drilled at its spot, decision and flops with no hand filter, over any sessions. For that, a drill session now keeps its graded decisions by what it dealt from: `meta.byDeal`, keyed by `dealtFrom` in `texture.ts` as the texture filter's key plus the hand asked for. It's checked on restore, in `shapes.ts`. Drills kept before today don't count, and the panel says so. The first lesson not done is opened and named.

**Checked in a browser** (dev server):
- Lesson 3's report opened grouped by suits, with its provenance line.
- Its drill dealt Q♥J♥3♥, and a check was graded Best under "Precomputed solution · srp_btn_bb …".
- The Plan page then read "1 of 20 · 100% Best or Correct" for that lesson and 0 for lesson 1.
- `qa.e2e.ts` 10–10d pass on the build.

The row is WORKING by the owner's rule of 2026-11-08 (40 of 63); Plan and Review on the home page now read Working. Left: flop decisions only (no preflop, turn or river lesson), fixed text, and no cap on the review queue.

### 2026-11-10: Analyze grades at Accurate where asked (Phase 3)

**Analyze.** The Decision grading row listed "no Accurate pass". The scope list now has "Every street, at Accurate" (`grading.ts` `GradeScope`, `GradingPanel.tsx` `modeOf`):

- It asks as Fast's scope does: no library-only flop and no triage.
- Its solves run at Accurate.
- Its clock starts from Accurate's budgets and follows the measured pace once two answers of a street are timed.

It grades only what no run has graded, as Fast does, and the page says so.

**Checked in a browser** (real worker): a heads-up 3-bet pot imported fresh had its four postflop decisions graded by live solves at 1000 iterations, converged, in a few seconds. Tests: `AnalyzePage.test.tsx` (every ask at Accurate, none library-only or triage, then the grades forgotten) and `grading.test.ts`. A long session at Accurate is unmeasured. The row stays PARTIAL: preflop outside the stored solve's game is graded by the charts, spots left to the rules aren't graded, and tournament hands are graded in chips.

### 2026-11-10: Practice's tournaments played out (Phase 7)

**Practice.** The MTT row said Practice's tournament session was "one table frozen in time". A tournament session now has "Play it out" (the Carry chips box, renamed for a tournament; full hands with your seat moving only). With it, `following` deals each hand from `moveOn` (`tournamentPlay.ts`):

- Chips carry, and the button moves on as a ring game's do (a test holds it to `nextTable`).
- A player with no chips is out. Two out in one hand are placed by the chips they started it with. One out once every player left is paid gets the lowest prize left, and the prizes lose that place.
- A seat that's out is taken by a player from the other tables at their average stack while any are left. Otherwise the table gets shorter, down to heads-up.
- Every 10 hands the blinds rise 1.25×: every stack, and the other tables' average, is that many fewer big blinds, and the other tables lose 10% of their players, whose chips stay among them.
- When you're out, or have every chip, the next hand starts the setup over. What happened is said: the place, the prize, or out of the money with how many were paid.

The hand carries the game as it stands (`HandTournament.played`, `news`, validated on restore in `keep.ts`). So the requests price the prizes left and the other tables as they are now. The table shows the level, players left and paid, your chips before and after, what happened since the last hand, and Start over. The rules are said on the page as Lizard's own simplification: no table balancing or merging, and a fixed pace at the other tables. History's row for such a session says "played out".

**Checked in a browser** (dev server): Three left, played out, folded through 11 hands to "The blinds go up (level 2)", with every stack 1.25× fewer big blinds. Tests: `tournamentPlay.test.ts` (10), `games.test.tsx` (the box, disabled with Stop at the flop). Full unit suite: 3434 passed, 2 skipped. The MTT row stays WORKING; its "frozen in time" line is replaced. The two heads-up precompute builds were left alone.

### 2026-11-10: Node locks on several nodes of a street (Phase 9)

**Study.** The Node locking row was PARTIAL for "only the node on screen", though `engine/nodelock.py` takes a list of locks and its LP benchmark already locks both players and every node of one. Now:

- An answer has "Keep this lock". A kept lock is sent with every lock asked afterwards on the same street and board (`keptLocks.ts`, in memory for the tab) until it's dropped from the list above Run.
- `engine/study_lock.py` lays a kept lock (`also`) only on the very solve it was made on. Each answer carries `root_key`, a digest of the board, both ranges, pot, stack, bets, who acts, raises and the tree. A kept lock from another solve, or at the node being locked, is refused in words, and a line the tree doesn't have is invalid.
- The answer says "Held with it: …", and the badge's lock lists every lock held.

**Tests:**
- `scripts/engine/test_study_lock.py`: 28 passed (3 new in `KeptLocks`).
- `NodeLockPanel.test.tsx`: 20 passed.
- `web/e2e/nodelock.e2e.ts`: 4 passed, on the build.

The new browser test, on the wasm core: BB's flop check is held at 100% and kept; SB's node after the check is held at a bet; BB's first decision plays 100% check in that locked solve.

The row is WORKING by the owner's rule of 2026-11-08. That makes 41 of 63, and Custom solving now reads 8 / 1 / 1 / 0. Left: earlier streets don't react to a lock (each street is its own solve), a turn class or combo lock is APPROXIMATE, an Accurate flop lock's memory is estimated, and it's heads-up and cash only.

ROADMAP's summary line still read the 2026-11-05 counts (8 WORKING) and now reads 41 / 14 / 5 / 3. The two heads-up precompute builds were left alone.

### 2026-11-10: Multiway graded by what was checked

The Multiway row said only "3-way solved, 4-way reduced, 5+ on betting rules". `qa.e2e.ts` 4 now holds a 3-way pot of your own to what the badge says, on the real worker: BTN opens, SB and BB call, Qh8c3d. The badge reads "Live solve · 0.08% pot mean best-response gain in the solved game (converged) · 400 iterations". The note under it reads "3-way pot solved by 3-player CFR (400 iterations) …", with every seat's best-response gain. Before, the test asked only for the word "solve".

The 3-player solver's exactness is already benchmarked against a reference on 3-way rivers (ACCURACY section 14). So the row is WORKING by the owner's rule of 2026-11-08: 42 of 63, and Custom solving reads 9 / 0 / 1 / 0. Left: 4-way pots are the engine's reduced game, 5+ players are its betting rules, the 3-way solve's later streets play by bucket, and 3-way spots aren't drilled.

Tests: `qa.e2e.ts` 4 passed on the build.

### 2026-11-10: KO and PKO bounties in Practice's tournaments

Practice's tournament session had no bounties ("they stay on the Tournaments page"). Its form now has Bounties (None, KO, PKO), each seat's bounty and the other tables' average (`TournamentFields.tsx`). Every answer sends each seat's bounty as the engine's `bounties`, as the Tournaments page does, so the badge names the bounty model. Played out (`tournamentPlay.ts` `moveOn`), a player out pays their bounty to whoever won the most chips in that hand: KO all of it as money, PKO half as money and half onto the taker's own bounty. A bounty follows its player round the table, a player from another table brings the other tables' average, and the end of a tournament says what you collected (a winner's own bounty included). The played-out panel shows your bounty and the bounties collected, and its note names the simplifications. Mystery bounties stay on the Tournaments page, with no envelope draw in a session.

Checked in a browser on the dev server: a 3-max PKO session at 10bb, 10 a seat, answered under "push/fold equilibrium in prize equity, PKO bounties, proportional model · approximate". Played out, it read "You take BTN's bounty, 10: 5 paid, 5 onto yours." and "You won the tournament: first place, 50, and your own bounty, 20. You collected 30 in bounties."

KO / PKO stays PARTIAL, since preflop away from push/fold is a discount on the chart's risk premium. Counts unchanged at 42 / 13 / 5 / 3.

Tests: `tournamentPlay.test.ts` 14 passed (4 new); all of `src/features/practice` 1226+ passed; tsc and eslint clean. The two heads-up precompute builds were left alone.

### 2026-11-10: PLO4 turn solve

The PLO page solved one river and nothing before it. A four-card board now solves the turn and every river card after it in one discounted-CFR run (`web/src/engine/plo/turn/`). The turn's tree uses the same pot-limit rules (`buildTree`). Where the turn's betting closes with chips behind, each river card is its own exact river game of the existing solver. Its combos map back to the turn's, and each river counts 1/40 at the turn: a matchup that can be dealt sees 40 river cards. All-in on the turn, every river card is a showdown.

The river code gained four pieces, none of which changes it:
- `compileSides`, factored out of `compileGame`;
- `begin`, `pass` and `valueAt` on `RiverSolver`;
- a way to share scratch vectors and terminal sums;
- turn requests in `run.ts`, with their own limit of 12 million combo-terminals an iteration.

The page shows river sizes when the board has four cards. Its badge says "a turn and its N river cards", and exploitability is an exact best response through the turn and every river. Only the turn's decisions are shown.

Checks (`turn/solver.test.ts`, 6 tests):
- Checked through, the turn's value equals the 48 rivers solved one by one, within their exploitabilities.
- The river matchups sum to 40 times the turn's.
- A called all-in is worth each matchup's exact equity from `equity.ts`, to 9 places.
- A spot with bets, a raise and an all-in closes to 0.05%.
- A request job runs and stops at its target.

Measured in Node: AAxx,KKxx,QQxx against JT98,JT97,T987 on Js9s4d2h, at one size a street, came to 11.9M units, 1.0 to 1.2 s an iteration and 165 MB. AAxx against JT98 reached 0.29% in 50 iterations, 15 s. In the browser on the dev server, that spot reached 0.35% in 45 iterations, 5.3 s, 56 MB. `web/e2e/plo.e2e.ts` gained a turn test; all 4 passed on the build.

The PLO4 row stays PARTIAL. Not done: the flop, river strategies after a turn shown card by card, a reference of the turn's own, and PLO in Study, Practice or Analyze. ACCURACY section 15 and ROADMAP Phase 10 are updated. The two heads-up precompute builds were left alone.

### 2026-11-10: the river after a PLO turn, card by card

The turn solve's rivers were solved but not shown. Under a turn's decisions, "The river after the turn" now takes any line where the turn's betting closes with chips behind and any river card, and shows that river's own strategies from the same solve: decisions, ranges, actions and combos, each hand's reach as the turn's line lets it. The worker keeps a finished turn's job and answers a `river` message from it. On the page, without a worker, the client keeps the job. A new solve drops it, and if it's gone the page says so.

Pieces:
- `RiverSolver.report` takes the reaches the river starts with;
- `TurnSolver.reachAt` and `riverReport`;
- `RiverJob.riverView`;
- the result carries the closing lines and the river cards.

Tests:
- The page test opens the river after check-check on the K♦; its two EVs add to the river's pot of 10.
- `plo.e2e.ts` opens it after a turn bet and call on the A♥, on the worker, with the EVs adding to 50.
- All PLO unit tests and the 4 PLO e2e tests passed. The two heads-up precompute builds were left alone.

### 2026-11-10: table balancing in Practice's tournaments

Before this, a tournament played out in Practice kept your table full while anyone was left at the other tables. That runs too full: with 11 left at six-handed tables, a real tournament plays 6 and 5. Now, after every hand, the tables are balanced. `tournamentPlay.ts` `balancedSize` picks the fewest tables that seat everyone left, each within one player of the others, and changes your table as little as it can.
- When your table is short, players come from the other tables at their average stack, filling a busted seat first.
- When it's long, the player due the big blind next moves away with their chips, never you (your moving would only change who you face). Their chips join the other tables' average.
- With one table's worth left, everyone sits at yours: "The last tables merge: a final table of N."
- A table seats what the first hand dealt (`HandTournament.seats`, validated on restore in `keep.ts`).

The other tables are still a count and an average stack, which the page's note and the Play it out tip now say.

Tests (`tournamentPlay.test.ts`, 17 in all):
- five-handed with 11 left, and a player in when 10 are left;
- the player due the big blind moved, and the next one when that's you;
- the last tables merging into a final table;
- the earlier replacement tests moved to spots where the tables need a player.

Checked in a browser: a 6-max session with 2 players at the other tables (8 left) moved UTG's and HJ's players away after the first hand, and the table went 4-handed with every stack where the chips left it.

Also, ROADMAP Phase 4 no longer lists single combos as open: they were painted and locked from 2026-11-05. What's open there now is category paint by combo.

### 2026-11-10: mystery bounties in Practice's tournaments

Practice's tournament form now has "Mystery" under Bounties. It takes the envelopes one by one, in the prizes' units, with a count after an x: "500, 100x4, 25x20" (`TournamentFields.tsx` `parseEnvelopes` and `envelopesText`; at most 10,000).
- Every answer is asked with the pool and the count of the envelopes left (`practice.ts` `prizesOf`). With none left, no bounty is sent.
- Played out (`tournamentPlay.ts`), each knockout at this table draws an envelope at random from those left, and whoever won the most chips in the hand draws it: "You draw a mystery envelope for CO: 100." Knockouts at the other tables each draw one too, unseen. The draw comes from its own stream of the next hand's seed.
- The table shows the envelopes left, their average and what you've drawn. The page's note says the draws start from the first hand, where many real events start them later.
- A kept session's envelopes are validated on restore (`keep.ts`).

Tests (`tournamentPlay.test.ts`, 20 in all):
- a draw for your knockout, and one for the player who knocked you out;
- the other tables' draws, and nothing drawn and nothing sent once the envelopes are gone;
- the envelopes parsed, written back on the form, and sent as pool 130 with 4 left.

Checked in a browser: a 6-max session with 25 envelopes showed "mystery envelopes left 25 (average 56)". Its preflop answer was badged "Preflop charts · chip chart with a risk premium, mystery bounties at the average envelope · approximate".

The Mystery bounty row stays APPROXIMATE: a knockout is valued at the average envelope left, not as a spread.

### 2026-11-10: a category painted by combo in the range builder

A made-hand or draw category painted whole classes: those with at least half their combos in it. Now a "By combo" box beside the category paints only the combos whose own row is in it, each apart from its class, as one undo step (`study/filters.ts` `combosIn`, `ranges/build.ts` `paintCombos`). The box shows only where the answer has combos. The button counts combos ("Paint 86 combos"), and its title lists them. A lock still goes by hand, since a combo on its class's mix has nothing of its own to hold. Once combos are painted apart, the score goes combo by combo, as it already did for single combos.

Tests:
- `filters.test.ts`: a category's combos, apart from their class's other combos, and none with no reach.
- `BuildMode.test.tsx`: a flush draw by class (AKs whole) and by combo (AhKh alone), undo, the lock by hand, and no box for a shape.

Checked in a browser on QA 14d's river solve (Ks7d2c5h9d): Two pair went from 18 hands by class to 86 combos by combo. Painted at bet 75%, the grid marked them "N combos painted apart", and the score read "Graded combo by combo over 313.0 live combos".

This also closes Phase 4's last open item in ROADMAP. The Range-builder row stays WORKING; only a screen reader and touch device check of it are left.

### 2026-11-10: sit & go and spin formats

The Tournaments page had stages of an MTT and no formats, which the MTT row noted. A "Formats" group now sits beside the stages, and the same presets are in Practice's tournament form under "Sit & go and spin" (`tournament.ts` `FORMAT_PRESETS`). They're Lizard's own generic shapes, not any site's:
- a 9-player sit & go, 75bb, paying 50/30/20;
- its bubble: 4 left, 9–24bb, a 1bb big-blind ante;
- a 6-player sit & go paying 65/35;
- a 6-player double or nothing paying 3 the same;
- a 3-player spin, winner takes all, at 25bb. One prize makes chips the prizes, so Practice sets it to chip EV.

A preset can now carry its own ante (`StagePreset.ante`, `presetAnte`, `anteWords`). A format's start has none, and the page says so.

Tests:
- `tournament.test.ts`: every format passes the checks, with its ante.
- `SolvePage.test.tsx`: the buttons set the table, the ante and the prizes.
- `games.test.tsx`: Practice's form, a spin in chip EV.

Checked in a browser: the sit & go bubble opened in Study answered in prize equity ("CO 31.4% of what's left to pay", bubble factors up to 1.69).

The MTT row stays PARTIAL, for the preflop chart with a risk premium.

### 2026-11-10: an independent reference for the PLO turn

The PLO turn solve was checked only through the river solver, its own decomposition and the equity calculator; ACCURACY §15 said it had "no reference of its own". `scripts/engine/plo_turn_reference.py` is a NumPy CFR+ that shares no code with `web/src/engine/plo/turn/`. It asks every pair of hands, and every river card, whether they can be dealt, and solves the 48 river cards side by side as one axis of dense tensors. It writes `web/src/engine/plo/vectors/turn.json` (288 KB, 34 s under `slot.sh`). It has three spots:
- one bet a street, 3x2: value in [-5.000071, -4.999879];
- a raise all-in on the turn, 3x2: [-4.866766, -4.866567];
- weighted ranges with two sizes, 6x5: [-2.342322, -2.342089].

Each was solved to 0.001% of the pot.

Tests:
- `scripts/engine/test_plo_turn_reference.py`, 5 passing. Checked down, the value is the exact equity over the 40 rivers. Best responses bracket any strategy. Swapping the seats negates the value, and a solve closes the bracket.
- `web/src/engine/plo/turn/reference.test.ts`, 12 passing. The trees and river trees match path for path, and the hands and matchups match. The reference's strategy, put into the TypeScript on the turn and every river card, gives the same best responses and value to 5 places. The TypeScript's own solve lands inside the reference's bracket.

The PLO4 row stays PARTIAL: no flop or preflop, and no PLO in Study, Practice or Analyze.

### 2026-11-10: Mystery bounty regraded PARTIAL

The row was APPROXIMATE because a knockout is valued at the average envelope left, with no spread. That isn't an approximation of the EV. The average is the exact expectation of a random draw, and prize equity is linear in money (ICM is risk-neutral, as every EV in Lizard is), so a spread would change no EV and no strategy. What remains is the same as KO / PKO: the proportional bounty model, and preflop away from push/fold as a discount on the chart's risk premium. So the row is PARTIAL like theirs.

Changes: the matrix row and counts (Lizard: 42 / 14 / 4 / 3), `routes.ts` `GRADES`, and ROADMAP Phase 7, where the spread is no longer listed as open.

Tests: `src/app` and `src/features/home`, 23 passing (the routes test reads the grades from the matrix).

### 2026-11-10: a condensed range view for PLO

Four-card hands have no 13x13 grid, so the PLO page's decisions had only the combo table. "Hand classes at this decision" (`web/src/features/plo/classes.ts` `byClass`, `classOf`) puts the decision's reaching combos in classes by their best hand on the board, two cards from the hand and three from the board. On a turn, a flush draw is shown beside the made hand: two of a suit in the hand, with two of that suit on the board. Each class shows its combos, its share of the range, its mix and its EV, weighted by combo, and the caption says that's not by matchups. It's under every decision of a river or turn solve, and under the river after the turn.

Tests:
- `classes.test.ts`, 4 passing: four of a suit in the hand with one on the board is no flush; the draw shows on a turn only; the weighting and the missing EV.
- `PloRiverPage.test.tsx`: the polarised river's straight bets 100% and its air 50%; the river after the turn has its classes.

Checked in a browser on the dev server:
- the default river: OOP's straights bet 19%;
- AAxx against JT98 on Js9s4d2h at 75%: sets with a flush draw bet 61%, bare one pair 27%;
- the river after the turn;
- no sideways scroll at 375px.

The PLO4 row stays PARTIAL.

### 2026-11-10: the range builder on a touch phone and to a screen reader

Phase 4's last item. `web/e2e/builder.e2e.ts` runs on the phone project only (390px, touch; `playwright.config.ts`: desktop ignores it). Study's build mode at 6-max 100bb on the built page:
- a tap paints AA;
- a finger dragged along a row, sent as CDP touch events, paints all four hands it crosses, and the page doesn't scroll (the grid is `touch-action: none` with pointer capture);
- a tap on "Check my range" scores the range.

The second test is a screen-reader check by accessible names, not a run with VoiceOver or TalkBack:
- the grid and all 169 hands are named, each starting with the hand;
- one tab stop, and the arrows move;
- Space paints, and the status line says the hand as it's painted now;
- the brushes carry `aria-pressed`.

Both pass (`slot.sh npx playwright test e2e/builder.e2e.ts --project=phone`). The Range-builder row was WORKING already; its note now says this.

### 2026-11-10: the PLO flop, with every turn and river after it (Phase 10)

A three-card board on the PLO page now solves the flop, and where its betting closes with chips behind, each of the turn cards as its own turn solve, every river after each, in one DCFR run (`web/src/engine/plo/flop/`). The river solve inside a turn and the turn solve inside a flop are one street solver (`web/src/engine/plo/turn/street.ts`), refactored out of the turn's with every turn and river test, the NumPy turn reference's included, passing unchanged. All-in on the flop, each turn card is a showdown over its rivers. Each street has its own sizes ("Every turn after it", "Every river after it"). Under the flop's decisions, "The turn after the flop" shows any closing line's turn on any card, asked of the job still in the worker, and "The river after the turn" sits inside it. The badge says "a flop and its N turn cards, every river after each" with the sizes of all three streets.

The limit is 18 million units an iteration, counting every turn's and river's, set from `flop/measure.test.ts` (off by default): 51 to 57 ns a unit in Node, so AAKK against JT98 on Js9s4d at 75% a street (16.2 million) took 0.83 s an iteration and reached 0.10% in 145 iterations. Only narrow ranges fit.

Tests:
- `flop/solver.test.ts`, 7 passing: turn matchups sum to 41 times the flop's; checked down and all-in, exact equity from `equity.ts`, to 9 places; checked through, the 49 turns solved one by one; bets every street to 0.1% with the turn's and river's EVs adding to their pots; refusals; a flop as a job, with its turn and river views.
- `run.test.ts`: a three-card board needs the turn's and river's sizes.
- `PloRiverPage.test.tsx`, 14 passing: a flop, a turn on the king after a bet and call, and the river after it, EVs adding to 30.

Checked in a browser on the dev server: AAKK against JT98 on Js9s4d at 75% a street, 172 iterations in 48.6 s to 0.083%, 233 MB; the turn on the 2h after a flop bet and call (EVs 5.02 and 19.98, pot 25), and the river 7c after a turn bet and call, where every JT98 has a straight (IP 62.50 of 62.5); no sideways scroll at 375px. The route's label is now "PLO flop, turn and river".

No independent reference for the flop: the NumPy turn reference is dense and at its limit on the turn. The flop rests on the decomposition into turns, which are held to that reference, and on exact equity (ACCURACY section 15). The PLO4 row stays PARTIAL: no preflop, narrow ranges only on a flop, and no PLO in Study, Practice or Analyze.

### 2026-11-10: practice on a PLO solve (Phase 10)

"Practice this solve" sits under every PLO solution (`web/src/features/plo/drill.ts`, `PloRiverPage.tsx` `Drill`). A hand is dealt as the solve plays: a decision of the street solved first is drawn by how often its line comes up (its reach), then a combo of the player to act by how often it gets there (its weight at the node). The spot says the seat, hand, board, line, pot at the decision, the call and what's behind. The action taken is graded on Lizard's one scale (`grading/grade.ts`: EV lost in % of the pot at the decision; Correct when the hand plays the action 10% or more; capped at an Inaccuracy on a solve short of converged). Then the hand's mix and EVs are shown, with a running tally for that solve, kept on the page only.

The grading uses each action's EV with the best play after it against the other range's average, a new field (`bestEv`) beside the existing EV played on at the average. The first browser try showed why: below an action a strategy never takes, DCFR's average is the early iterations' near-uniform play, so a one-pair hand's never-taken pot bet on the default river read 53bb lost. With best play after it, the same bet reads 10.4bb lost. The river solver's and the street solver's report walks (`river/solver.ts`, `turn/street.ts`) compute both in one walk; at a closing with streets to come, the best-play value is the next streets' best response (`valueAt(…, true)`), so a turn or flop report costs about one extra pass.

Tests:
- `drill.test.ts`, 5 passing: a decision by reach and a combo by weight; nothing dealt that can't be graded; the pot, the call and the mix; grading and its cap; the tally.
- `PloRiverPage.test.tsx`: a hand dealt at the root, Check graded Best as the air mixes at equal EV, the buttons locked after, the tally.
- `river/solver.test.ts`: on every node, combo and action, the best-play EV is never under the average's and equals it where nothing is left to decide. `turn/solver.test.ts`: the same inequality through every river.

Checked in a browser on the dev server, on the default river: 10 hands dealt and graded. A raise to 80 with KK, facing a bet from a range of straights, gives up 79.9bb with best play after it; an IP straight's bet mixes at equal EV. No sideways scroll at 375px.

The PLO4 row stays PARTIAL.

### 2026-11-10: a PLO hand you played, as the spots to solve (Phase 10)

"Start from a hand you played" on the PLO page (`web/src/features/plo/fromHistory.ts`, `PloRiverPage.tsx` `FromHistory`) takes a pasted four-card pot-limit Omaha hand history. It lists each street two players saw with chips behind, with that street's board, the pot as it started and what each had behind, and puts the one chosen in the form. A note says which seats those are, which one you were and with what hand, and that the ranges are still yours to type: a history shows one hand, not a range.

The hand-history parser has an Omaha mode for it (`hh/parse.ts`, `parseHandHistory(text, { omaha: true })`). It reads four hole cards and marks the hand `game: "plo4"`, and refuses Hold'em, hi-lo, five- and six-card Omaha and Courchevel in words. `replay` plays a PLO hand at pot limit. Without the option nothing changes: Analyze's import still refuses Omaha, and every golden file and import test passes unchanged. A street three players saw is named and left out (the solver is heads-up), and so is one that came with a player all-in.

Tests:
- `fromHistory.test.ts`, 3 passing: a PokerStars hand's flop, turn and river (pots 5.5, 9.1 and 21.3, BB against BTN); a three-way flop left out, with the small blind's call counted in the turn's pot of 11.1; a turn all-in leaving no river; the refusals; Analyze's parser still refusing the hand.
- `PloRiverPage.test.tsx`: the hand read, the turn put in the form, the ranges left as typed, the note, and a Hold'em hand refused.
- `src/hh` and `src/features/analyze`: 382 passing.

Checked in a browser on the dev server: the same hand pasted, the river put in the form and solved (11,310 by 448 combos, 0.074% in 0.4 s). Its turn with the default ranges and sizes was refused over the limit, in words.

The PLO4 row stays PARTIAL.

### 2026-11-10: the preflop solve stored for 2 to 6 players at 20 to 200bb, and Instant grades stamped with the library

The owner asked why so many rows are PARTIAL. Most of their notes say the same thing: preflop is the charts. So the stored
preflop solve now covers far more of what Practice and Analyze play. Before, Practice's "Grade preflop by the preflop solve" and
Analyze's preflop grading covered only upstream's two stored games, 6-max 100bb with no rake or 5% capped at 3bb.

- **The grid.** 108 more games are stored: 2 to 6 players at 20, 25, 30, 40, 50, 60, 80, 100, 125, 150 and 200bb, unraked
  and 5% capped at 3bb (`engine/pf_stored.py`, `engine/pf/*.bin`, built by `scripts/pf/build_stored.py`). It's the same
  model and 1,500 iterations as upstream's two, each 0.05 to 1.34 mbb/hand a seat from equilibrium in its own game. The
  build took 49 minutes through `slot.sh`, and the files total 1.1 MB.
- **solver/ is untouched.** The worker imports `engine.pf_stored` at start (a build-time edit, declared in
  `solver/UPSTREAM.json`), and the asset build copies the files beside upstream's. The bundle's version now hashes the stored
  files too.
- **The gate.** `pfBlocked` takes any stored game and names the nearest stored depth when refusing. Analyze's message no
  longer says 100bb. The page's list is `web/src/solver/pfStored.ts`.
- **Coverage, measured on seven grid games** (ACCURACY section 18.3). With the solve's sizes, deep 6-max is answered
  about 96% of the time, as at 100bb. At 25 to 60bb, the chart's jams against the tree's 12bb raise leave much of
  facing-an-open and facing-a-3-bet on the charts. That's stated, not hidden.
- **Instant stamps.** A read at once off the library (the engine's `near`, `unraked`, `off_tree`) keeps the build and the
  whole library's stamp together (`build:<v>+library:*:<id>`), so a library change under the same build shows in Leak
  finding and Reports. Reads of a stopped solve or the street before keep the build alone. The `library:*` stamp now reads
  "library as a whole".
- **Also fixed this session.** A drill's number keys now read the hand on screen through a ref set as it commits, so a
  key pressed right after the next deal showed is no longer lost. That was the DrillsPanel test CI failed on.

Tests:
- `scripts/engine/test_pf_stored.py`, 4 passing: the grid installed beside upstream; every file unpacks to its own game's
  tree and is under 1.5 mbb; the Advisor answers grid games stored and done; a game off the grid is `pf_unsolved`.
- `pfStored.test.ts`, 4 passing.
- `pfGrade.test.ts`, `SetupForm.test.tsx` and `grading.test.ts` moved their unstored examples to 7 players or 90bb.
- `version.test.ts` and `client.test.ts` cover the compound stamp.
- The full unit suite passed.

Checked in a browser on the dev server: a 4-max 40bb Practice table graded two preflop decisions by the solve. The
badge's 1.03 mbb/hand is `4max_40bb.bin`'s. `qa.e2e.ts` 7j does the same in the gate.

No grade in the matrix changed. The solve is still a class-level model and still opt-in, so the rows' notes say what's
now covered, and the PARTIALs stay. The two heads-up precompute builds were left alone.

### 2026-11-10: Practice grades preflop by the preflop solve by default (owner's decision)

Asked whether the preflop solve should be preflop's default grade wherever a game is stored, the owner said yes.

- **Where it's on.** The session the page deals on load (6-max 100bb, `session.ts` `FIRST_OPTS`, passed by the page as the
  Room's `first`), the New session form wherever its game is stored, and a setup link, which carries no grade of its own
  (`practice.ts` `pfByDefault`). Games with no stored solve, pot drills, tournaments, carried chips and own sizes are
  graded by the charts as before, and the form still says why.
- **Taken off stays off.** Unticking the box starts the session with `pfSolve: false`, so the session and the form keep
  it off. A saved scenario keeps what it was saved with, so one saved before today, without the option, is still graded by
  the charts. The raise-sizes box stays off by default.
- **The first screen.** Ticked on load, the form's note and the sizes box first pushed "Your move" 103px below a 768px
  tablet screen (CI's content check). The note now opens once you change a box, while the box still carries it as its
  description, and the sizes box sits on the same line. Your move is on the first screen at all three widths again.
- **Nothing about the grade changed.** It's the same class-level model and rule, and the same 30% of 6-max 100bb decisions
  it can't answer keep the chart's grade and say why. Analyze is unchanged.

Tests: `SetupForm.test.tsx` checks the default and unticking; `setupLink.test.ts` checks links in stored and unstored games;
`PracticeRoom.test.tsx` checks the page's first hand asks the solve once beside the charts. The chart-graded page tests now
untick the box. The browser steps 7g, 7h and the tablet check expect it ticked. No grade in the matrix changed: the rows'
notes say it's the default now, and the model is still a class-level one.

### 2026-11-10: the format rows reviewed: 2–9 handed, Cash, Short stack and Deep stack are WORKING

Reviewed at the owner's request, with preflop counted as an edge, as MTT / final table and Multiway already are.

- **Checked first, in the gate.** `web/e2e/qa.e2e.ts` 7k plays one full-hand table per format on the real worker:
  - cash at 5% capped at 3bb, 6 players at 100bb;
  - 9 players at 100bb;
  - 3 players at 25bb;
  - 6 players at 15bb;
  - heads-up at 200bb;
  - 6 players at 250bb.

  Each plays until a preflop decision and a decision after the flop are graded. Every graded decision must name a known source on its badge. Preflop is graded by the stored solve of that very game where one is stored (and only that file is read), and by the charts, named so, where none is. All six passed in 56 s.
- **Moved to WORKING** by the owner's rule of 2026-11-08: 2–9 handed NLHE, Cash, Short stack, Deep stack. Each deals, plays and grades every street end to end with tests, each number under its source. Each row now says what's left:
  - 7 to 9 players and 13 to 19bb have no stored preflop solve;
  - above 200bb, preflop is the charts re-priced by rules;
  - other rakes have no stored preflop solve;
  - there are no stakes presets;
  - flops of 5 or more players go to betting rules;
  - the postflop tree allows at most 2 raises a street.

  The charts' quality stays graded in the Preflop rows (APPROXIMATE).
- **Left PARTIAL:** MTT, whose preflop is a chip chart with a risk premium, where ICM matters most; and PLO4. Counts: Formats 4 / 2 / 0 / 0, Lizard total 46 / 10 / 4 / 3.

### 2026-11-10: Practice decluttered: the table, your options and your last decision on the first screen

The owner found the page bloated. Nothing about play or grading changed. What moved:

- Mode, Ask ahead and Tables share one row.
- The Game box is closed by default, as one line.
- The score is one line of figures. What it was graded against is on a fold under it, with its notes and the ask-ahead meter inside.
- "How this table works" moved below the table.
- A decision's long note on how it was graded is under "How this was graded".
- On a phone, three seats fit a row.

At 1280×800 the table now starts at 301px rather than 533px, and your options at 486px rather than 718px, so Last decision is on the first screen. On a phone your options are at 584px of 812, rather than 718px.

Browser tests open the Game box before filling it (`e2e/fixtures.ts` `openGame`).

## 2026-11-10: Study decluttered

Owner: "improve one page at a time" (after Practice). Study's grid and actions now start on the first screen:
the subtitle is gone (the badge on each answer says where it came from); "Fold to" and the setup line share one line;
"Compare this spot" moved below the grid with the other tools; the preflop solve's long paragraph folds under "About
this preflop solve" (its Not finished / rough warnings stay out); an answer's notes fold under "Notes on this answer
(n)"; the category select is narrower so the range toolbar fits one line more often. At 1280×800 the grid starts
about 90px higher preflop and 190px higher on a flop. UI only: tsc, eslint, `vitest run src/features/study
src/features/compare` 458 passed; checked in the browser at 1280×800 and 375×812 (no sideways scroll). Builds left alone.

## 2026-11-10: Analyze decluttered

Owner: "Yes, Analyze" (the next page after Practice and Study). A graded decision in the report's lists (Your misses,
the most EV lost, off the chart, a leak's decisions) is one line: verdict, the spot, the EV it lost or the answer's
frequency, the answer's best, the hand. Under it, what graded it in short (≈ where approximate, "checked at Fast",
"flagged") is the line of a fold that holds the whole note as before (`DecisionTables.tsx` `decisionBrief`,
`sourceBrief`; `decisionNote` unchanged, still the hand view's title). The grading panel's long note on the chosen way
of grading moved into "What grades your decisions"; the estimate stays. With the nine sample hands graded, the misses
went from about three screens to half of one at 1280×800. UI only: tsc, eslint, `vitest run src/features/analyze
src/features/history src/features/review` 482 passed; checked in the browser. Builds left alone.

## 2026-11-10: Solve decluttered

Owner: "Yes, Solve". "Open in Study" was under the six-row seat table. Seats is now a fold whose line says what's set
("each the table's stack and the charts' range", or how many seats you set); it starts open on Tournaments (the
stacks are the spot there), where a seat's been set (a link back from Study), and wherever a seat's field has a
problem. Bet sizes and Rake share a row on a wide screen, the sizes' note shorter (the game-tree warning is its
title). At 1280×800 Open in Study is now at about 570px rather than below the fold. Browser step 5 opens Seats before
filling two stacks. UI only: tsc, eslint, `vitest run src/features/solve src/features/tournaments` 28 passed;
checked in the browser (no sideways scroll). Builds left alone.

## 2026-11-11: Review decluttered

The first page under More, after the four main ones. The intro is one line, not three. "How the queue works" was an
open box above everything; it's now a fold inside the Due now box, together with the queue's note on order and what
answers a retry (`ReviewPage.tsx` `QueueRule`; with nothing kept it sits under the empty note). A kept mistake is two
lines: date, spot, your action, verdict and EV lost with its due date, Retry, Open in Study and Delete on the right;
under it the game and line, and "Graded against" plus the source in short (≈ where approximate, the charts and rules
say they aren't a solve, "capped at Inaccuracy", the last retry's verdict: `gradedBrief`) as the line of a fold that
holds the full badge, version and last retry as before. The tally's parenthetical on what keeps no EV is its title.
With three kept mistakes at 1280×800 all three are on the first screen (the first started at about 520px, now 200px).
UI only: tsc, eslint, `vitest run src/features/review src/features/plan src/features/history src/features/analyze`
553 passed; checked in the browser at 1280×800 and 375×812 (no sideways scroll). Builds left alone.

## 2026-11-11: Plan decluttered

The second page under More. A part with nothing in it ("Leaks: No leak passes the read rule…", "Too few to read: Nothing
is waiting…") is one line with its note beside its name, not a heading and a paragraph. A step is its name with its
link (and Save drill, Import more hands) on the right, its first line under it, its progress, and the rest (what it's
counted from, what graded it, the drill's settings) under "Counted from, and what graded it" (`PlanPage.tsx` `Row`,
the `About` fold). Lessons opens on one line saying what a lesson is; the long paragraph is under "About the lessons",
and the lessons sit two to a row on a wide screen. At 1280×800 the page went from 1876px to 1532px with three reviews
due and a drill, and Lessons now starts on the first screen. UI only: tsc, eslint, `vitest run src/features/plan
src/features/review src/app src/features/home` passed; checked in the browser at 1280×800 and 375×812 (no sideways
scroll). Builds left alone.

## 2026-11-11: History decluttered

The third page under More; it was already mostly folded. Lifetime and Full hands by pot type share a row on a wide
screen, and By seat and By pot type do at 1536px and up (at 1280 the pot table's cells would wrap). A session is two
lines: what was played, then its figures with "Graded against: …" on the end. Over time's note on how a line is drawn
is under "How the line is drawn"; each line's decision count, sources and versions stay out. At 1280×800 the page went
from 1430px to 1248px with three sessions kept. UI only: tsc, eslint, `vitest run src/features/history` 75 passed;
checked in the browser at 1280×800 and 375×812 (no sideways scroll). Builds left alone.

## 2026-11-11: Saved decluttered

The fourth page under More. A kind with nothing saved is one line: its name, "0 saved" and where to save one, not a
heading over a boxed paragraph. The intro is one line. Backup and restore opens on one line ("Everything kept in this
browser, in one file, except settings. A restore merges, and what you deleted stays deleted.") with the buttons; what's
in the file and how a restore merges are under "What's in it, and how a restore merges". With nothing saved the page
fits 1280×800 (1006px before). Saved rows are unchanged. UI only: tsc, eslint, `vitest run src/features/saved src/app`
78 passed; checked in the browser at 1280×800 and 375×812 (no sideways scroll). Builds left alone.

## 2026-11-11: PLO decluttered, and the rest of More looked at

PLO flop, turn and river: the intro is one line that keeps what it leaves out ("heads-up, nothing earlier solved, no
rake"); the full paragraph is under "What it covers". The range syntax, how sizes are read and the solve's limits are
folds ("How to write a range", "How sizes are read", "Limits") rather than paragraphs between the fields, so Solve is
on the first screen at 1280×800 (743px; the page was 930px). UI only: tsc, eslint, `vitest run src/features/plo` 24
passed; checked in the browser. Reports, Ranges, Tournaments (Solve's form, already decluttered), PLO equity and
Library were looked at in the browser and left alone: each already opens on its controls or its data.

## 2026-11-11 — Explanation text cut app-wide; styled dropdowns

- Owner: "as little info as possible, just key bits." Intro paragraphs, "How this works" / "About…" / "How this was
  graded" / "How decisions are graded" folds, method and limit notes, column legends and long tooltips cut on every page
  (about 155 files, −1,555/+925 lines). Kept: headings, numbers, controls, provenance badges and short "charts, not a
  solve" markers, empty states, errors and warnings (now a few words each). Unit and e2e checks updated to the new text.
- Dropdowns: `components/SelectMenu.tsx`, mounted once at the root, opens a styled list for every `<select>` on a
  mouse press or an opening key (arrows, type-ahead, Escape; the select keeps its value, name and change events, so
  forms and tests are unchanged). A touch keeps the phone's own picker. The closed select draws its own chevron.
- Other default-looking controls in `styles/index.css`: checkboxes, radios and sliders in the accent colour; no spin
  arrows on number fields; the file picker's button and the date field's calendar mark match the theme; folds use a
  turning chevron in place of the system triangle.

## 2026-11-11: the More pages looked over

Owner: "Yes, More pages". Each was looked at in the browser at 1280×800. Review, Plan, History, Saved, Reports,
Ranges, PLO equity and Library already lead with their content and keep their explanations folded, so they're
unchanged; Tournaments shares Solve's change. PLO's form was long: its two ranges now sit side by side and the
solver's target and time budget share the Solve button's row (their limits are the fields' titles), so the button is
at about 580px rather than at the fold. UI only: tsc, eslint, `vitest run src/features/plo` 24 passed; checked in the
browser (no sideways scroll). Builds left alone.

## 2026-11-11: Postflop depth (branch claude/postflop-depth-185a1a)

From the parent session's brief: closer to GTO Wizard AI's postflop depth, in three steps, each behind its own label.

- **Abstraction error measured** (`scripts/benchmarks/abstraction.py`, ACCURACY section 21). Each flop model's flop
  was held combo by combo in the exact game, with the rest re-solved, on 3 narrow spots. Fast gave up 1.9% of the pot
  on average (up to 4.9%), Accurate 1.9% (5.4%) and the library model 0.6% (2.1%). Their own badges read 0.005–0.5%,
  and the control gave up 0.001%. Most of the cost is the river played by strength without its card. A heads-up flop
  answer from Fast, Accurate or the library now says so in its provenance (`web/src/solver/abstraction.ts`).
- **Bigger trees** (`engine/tree_depth.py`, a build-time edit declared in `solver/UPSTREAM.json`; ACCURACY section 22).
  Up to 5 sizes and a raise cap of 1–4 a street on the Solve page, heads-up. A Tree size setting offers Phone 12M,
  Standard 24M or Large 32M cells (64M natively). Peak memory is 47 MB plus 33 bytes a turn cell, natively. A turn
  with 5 sizes and 2 or more raises passes every browser cap and is cut to fit.
- **Earlier streets react to a later lock** (`engine/nodelock.py` `lift`, `runout_token`, `street_moves`;
  `study_lock.py` `reach_back`; ACCURACY section 16). A turn or river lock can be held from the street before, which
  re-solves around it. The answer is labelled approximate and covers the whole range only.
- Tests: Python `test_tree_depth.py`, `test_study_lock.py` and `test_nodelock.py`, 110 passed (through slot.sh), and
  `pyodide.test.mjs` (21). Web: the whole suite (188 files, 3,521 tests), plus tsc and eslint. The controls were
  checked in the browser on a local build, without a solve.
- Not done: the browser's own memory peak, real-range abstraction spots, and multiway trees. Not pushed or deployed.
  The gtosolver builds were left alone: everything heavy went through slot.sh.

## 2026-11-11: Lizard's preflop solver (calibrated class-level model, own stacks, 2 to 9 players)

Task from the parent session: close the preflop gap with a solver that is measurably closer to published solves and
covers more games, for the most accuracy per CPU hour, without touching `solver/`.

**What changed.**
- `engine/pf_engine.py`: pf_game's tree and game, generalized.
  - Each seat has its own stack: raises are capped at the deepest stack able to call, a short stack calls all-in for
    less, pots are split into layers, and each heads-up flop is valued at its effective depth.
  - 7 to 9 players play on a smaller tree (at most two see a flop, no cold 4bets).
  - The payoff is pluggable (`ChipPayoff`; a nonlinear payoff gets exact side pots), for ICM later.
- `engine/pf_model.py`: upstream's library flop model plus ten corrections per pot type (share shifts, edge scales,
  river-fix weights). It is calibrated by `scripts/pf/calibrate.py` (perturbation Jacobian, ridge Gauss-Newton, a 2-fold
  held-out check by spot) to the 26 certain published 6-max 100bb spots. The result is `engine/pf_calib.py` (generated).
- `engine/pf_solve.py`: Study's protocol on that game (pf_unsolved / pf_progress / pf_export / a node). Every answer
  carries `pf_model`, and from 7 players `pf_limits`. Its stored grid is the same 110 games as before, rebuilt as
  `engine/pf/lz1_*.bin` by `scripts/pf/build_stored.py --engine`.
- Worker: a build-time edit (`scripts/pyodide/worker-edits.mjs`, declared in `solver/UPSTREAM.json`) sends every
  preflop solve request with no board and no tournament to `engine.pf_solve.answer`. That covers Study's Solver source
  and Practice's and Analyze's grade. Tournaments still go to the Advisor.
- Page: `web/src/solver/pfStored.ts` keys are now `lz1_…`. In `provenance.ts`, the label is still "Preflop solve
  (class-level model)", followed by the model's words and, from 7 players, the tree's limits.
- Docs: ACCURACY section 6 and the new section 18.4; FEATURE_MATRIX's Preflop, Preflop trainer and Preflop solves
  rows.

**Measured [M]** (pf_equilibrium.report against `solver/tests/preflop_refs.py`, 26 certain spots at 5% capped at 4bb,
700 iterations):

| | Mean error | Spots out | Facts off |
|---|---:|---:|---:|
| Upstream's model | 2.85 | 16 | 11 / 15 |
| Calibrated | 2.37 | 14 | 10 / 15 |
| Calibrated, held out | 2.51 | 13 | — |

Upstream's shipped file scores 2.99 at its own rake (5% capped at 3bb). The charts score 0.96 and stay the default.
The calibration cost about 18 solves of about 2 minutes each, on one core through the shared slot.

**Not adopted.** `ext` (a smooth fit for classes outside a library spot's range) left the mean error at 2.85.

**Stored grid.** The 110 games were rebuilt in 63 minutes on one core through the slot. 1.2 MB.

The shipped 6-max 100bb file at its rake (5% capped at 3bb) scores 2.49, against upstream's 2.99. Unraked, it is worse:
7.79 against 7.06 (the references are raked; the unraked game is still measured only against them).

Six games (40bb at 4 to 6 players, 5-max 50bb, 6-max 150 and 200bb) were over 1.5 mbb at 1,500 iterations. They were
re-solved at 3,000. Four came under it; 4-max and 5-max 40bb level off at 1.60 and 1.65 (unquantized too). `engine/pf_solve.STORED_ITERS_OF` says so, and each
header holds its real figure.

**Checked in a browser** (local dev server), Study's Solver source:
- 3 players at BTN 40 / SB 18 / BB 60bb: solved in about 5 s, 0.22 mbb.
- 9 players at 100bb: about 80 s, 1.10 mbb, UTG opens 9.0%, the label naming the tree's limits.

Practice's and Analyze's grades send the same request; they were not clicked through again.

**Tests.**
- `scripts/engine/test_pf_engine.py` through the slot: 17 pass (the stored grid included).
- `web` vitest `src/solver`: 102 pass.
- `node --test scripts/pyodide/pyodide.test.mjs`: 21 pass.

**Left.**
- `engine/pf_stored.py` and the old `engine/pf/*.bin` are no longer asked for by chip games. Remove them once the ICM
  branch settles.
- The unraked games aren't measured against unraked references (none in the repo).
- A tournament's preflop is left to the ICM branch.

## 2026-11-11: a tournament's preflop solved in prize equity (Study)

Before this, a tournament's preflop away from push/fold was the chip chart with a risk premium, and Study's preflop
solver refused tournaments. Now, with Study's Solver source, a spot with payouts or bounties is solved as a class-level
preflop game in which every outcome is paid in prize equity.

- `engine/pf_icm.py`: the game. It's pf_game's tree and CFR with each seat's own stack and ante, a jam beside the open
  at 25bb or less, side pots, and terminals paid by `icm.Model.value_batch` (Malmuth-Harville, field stand-ins,
  proportional bounties). Folded seats are paid their prize equity as the hand plays out. At most three players reach
  a showdown (two from 7-handed), and a raise is refused once three others are all-in for less. It handles 2-9
  players, satellites (flat payouts) and KO/PKO/mystery bounties.
- `engine/pf_icm_study.py`: Study's protocol (pf_unsolved / pf_progress / node / pf_export / load) for it, with a game
  key that includes the stacks and prizes, three solves held, and the tournament block and notes on every node. The
  worker imports it through a build-time edit chained on the pf_stored one (`scripts/pyodide/worker-edits.mjs`,
  declared in `solver/UPSTREAM.json`, tested in `pyodide.test.mjs`). It wraps `Advisor._study_pf` for tournaments only.
- Provenance: `tournamentModelOf` names it ("every outcome paid in prize equity (ICM, Malmuth-Harville), folded seats
  included"; winner-take-all "in chips"; no payouts with bounties "chips plus the bounties won") after the badge's
  "Preflop solve (class-level model)". EVs are in bb of prize equity. Study's solve panel names the model from the
  answer.
- Checked (ACCURACY section 20): it equals the cash solve in chips; winner-take-all equals chips; heads-up push/fold
  and the advisor's 3- and 4-handed push/fold in prize equity agree in the same game. On a bubble, jams and calls
  tighten against chips, and a satellite tightens them more. KO bounties widen a covering call. Convergence levels off
  at the 3-way valuation's floor, the same kind as the cash solve's. Found and fixed on the way: unequal stacks made
  4-way showdowns (an all-in call for less wasn't counted, and a raise over three all-ins let in a fourth).
- Checked in a browser (dev build): the sit & go bubble preset opened in Study with Solver solved in the worker to
  2,000 iterations at 1.83 mbb/hand, badged as above, with prize equity and bubble factors beside it.
- Tests: `scripts/engine/test_pf_icm.py` (13 tests, about 15 s), `provenance.test.ts` (a new case),
  `pyodide.test.mjs` 21/21, `vitest run src/solver src/features/study` 523 passed, tsc and eslint clean.
- Not done: Practice and Analyze still grade a tournament's preflop by push/fold or the chart, since they grade only
  stored solves and none is stored for a tournament (`pfBlocked`). A precomputed set for the stage presets would
  close that. The 8-9 player stages are over the browser's size cap and solve only on the local server.
  `estimate_seconds` runs low on these trees.
- Where this meets the preflop-solver work: the shared `pf_game` / `pf_study` interfaces (`ICMGame.__init__` copies
  `Game.__init__`; `pf_icm_study.Solve` subclasses `pf_study.Solve`), and the worker's import line, which this edit
  chains on. `engine/pf_stored.py` and `scripts/pf/build_stored.py` are untouched.

## 2026-11-11: stored prize-equity preflop solves, and Practice graded by them

- Six stage and format presets are solved once in prize equity and stored: Final-table bubble, Three left, Heads-up,
  Sit & go bubble, Sit & go 6 players and Double or nothing (`engine/pf_icm_stored.py` lists them; files in
  `engine/pf_icm/` with the manifest `stages.json`; built by `scripts/pf_icm/build_stored.py`, through the shared slot).
  They are 0.015-1.28 mbb/hand a seat from equilibrium and 0.4-51 KB each. `scripts/build-solver-assets.mjs` copies them
  into the site's `pf/` folder, and Study answers them from the file at once. The 8- and 9-player presets are left out,
  as they are over the browser's size cap and take 2-5 GB to build.
- Practice grades a tournament session's preflop by them where the session is one of these presets as it sets the
  table, not played out, with no bounties (`pfBlocked`, `web/src/features/practice/pfIcmStored.ts`). Any other
  tournament gets a reason that names the stored presets. A chip-EV tournament at equal stacks is the cash game the
  stored grid answers.
- With the charts' opponents and buttons, 4.8% of decisions lined up with the solve's tree (`scripts/pf_icm/coverage.py
  --charts`). The charts open 2.5bb where the tree opened 2bb, and have no jam beside the open. So three changes:
  - The ICM tree now opens 2.5bb, the cash solve's and the charts' size, and its key hashes the sizes.
  - In these sessions (`PracticeHand.pfOptions`, sent as `pf_play`), each opponent's preflop move is drawn from the
    stored node (`pf_icm_study.play`, which wraps `Advisor.play` for stored keys only), and your buttons are the
    node's options.
  - A jam no one left can call counts the same on both sides (the node's `uncalled_bb`, taken off the table's pot in
    `chipsOff`), and an opponent's raise keeps the tree's size to the cent.
  Now 100% of decisions are graded by the solve when you play the solve's or the chart's mix, and 93-97% a preset
  when you pick any option evenly (the rest are classes the solve has folded). The setup and the opponents line say so.
- Re-measured with 2.5bb opens (`scripts/pf_icm/convergence.py`, ACCURACY 20.3): the sit & go bubble levels off at 1.28
  mbb (was 1.83), and the 6-max tables reach 1.5 and 0.61 at 600 iterations (were 2.1 and 2.5).
- Checked in a browser (dev build) over 18 hands of a sit & go bubble session: 17 preflop decisions were graded by the
  solve, badged "Preflop solve (class-level model) · precomputed · every outcome paid in prize equity …", with EVs in bb
  of prize equity. One was a class the solve had folded: it fell back to the push/fold model, with the reason given.
- Tests: `scripts/engine/test_pf_icm_stored.py` 6/6 and `test_pf_icm.py` 13/13; `pfIcmStored.test.ts` (new, 8 tests);
  vitest practice, solver, analyze and study 2,054 passed; `pyodide.test.mjs` 21/21; tsc and eslint clean. A
  pfGrade test that expected every tournament refused now expects the unequal chip-EV one and a non-preset ICM one
  refused.

## 2026-11-13: custom flop reports (Reports, from Solve or Study)

- **The flop sets.** The solver's representative sets are ported card for card (`flopSets.ts`, checked against
  `representative_flops` at 9, 25, 49, 95 and 184). The setup shows each flop's weight (1/n of all flops), how often
  it's dealt, and each texture's share of the set against its share of all flops.
- **Where it starts.** Solve's new "Report over flops" button and Study's link open the setup. A Solve spot whose line
  doesn't reach a flop gets a pot picker: opener, caller, single-raised or 3bet, walked on the preflop answers.
  Multiway and tournament spots are refused, with the reason given.
- **The run** (`customRun.ts`):
  - Flops are solved one after another in the worker at Fast or Accurate. The page's thread only sends requests and
    stores small answers.
  - The report is written to IndexedDB after every flop. Pause drops the flop in hand and keeps the rest; resume goes
    on from there, after a reload too.
  - One report solves at a time. Moving between pages doesn't stop it.
  - A flop the betting rules answered is left out and counted. The solver failing stops the run and keeps what's done.
- **Memory.** A new worker edit lets a request ask the worker to keep less of its solves (`cache_mb`; 64 MB minimum,
  never above its 700 MB budget). A report asks for 256 MB, so it can't push out a Study session's solves or fill the
  heap. Records are capped at 184 flops.
- **Kept here.**
  - IndexedDB migration 11 adds the store `flopReports`.
  - It is in backup and restore, with tombstones for deletes.
  - The Saved page lists each report with how far it got: open, edit (name, tags, note), export, delete.
- **Drawn as the library's reports:** strategy, EV, equity, EQR, range advantage, texture filters, sort, groups,
  chart and CSV.
- **Provenance.**
  - It says the report was solved live at its tier over N sampled flops of the representative set.
  - It gives each solve's distance from equilibrium, the iterations, and the flop model's abstraction error (ACCURACY
    21).
  - A Fast report adds its measured gap to the library: "EVs were 0.35% pot off a flop on average and in position's
    bet size split 16 points".
- **Accuracy (ACCURACY section 24, `scripts/benchmarks/custom_report.py`, through the shared slot).** BTN vs BB 100bb
  was reported live at Fast with the library off, over the representative 25 and 95, against the library's report of
  all 1,755 flops.
  - EVs agree within 0.35% of the pot a flop, equity within 0.2 points, BB's check within 0.9 points.
  - Sampling 25 flops moves no average by more than about 1 point.
  - In position's share of bets at 75% after the check is 15-17 points lower at Fast than in the library. That comes
    from the flop model, not the sample.
- **Checked in a browser** (dev build, 2026-11-13):
  - 6-max 60bb CO vs BB from Solve: 9 flops at Fast in about 10 s, each at 300 iterations and 0.06-0.12% pot from
    equilibrium.
  - A 25-flop run paused at 8, was listed on Saved, then was reopened and resumed to 25.
  - The report was kept across a reload.
  - A 40bb BTN vs BB run had no main-thread task over 50 ms.
  - One wording fix came from the check: "300 iterations a flop", not "300–300".
- **FEATURE_MATRIX:** Custom aggregated reports PARTIAL → WORKING, for heads-up cash flop spots. What's left is in its
  Notes. The summary counts were already stale and are left for the merge (the shared note says so).
- **Tests:**
  - tsc and eslint clean.
  - vitest over reports, data, saved and SolvePage: 478 passed, 2 skipped, in 26 files. New files: `flopSets.test.ts`
    10, `customReport.test.ts` 13, `customRun.test.ts` 3, `CustomReportPanel.test.tsx` 2, `flopReports.test.ts`, and
    `db.test.ts`'s v10 to v11 migration.
  - `pyodide.test.mjs` 23/23.
