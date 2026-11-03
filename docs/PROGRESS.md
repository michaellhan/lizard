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
4. To publish newly finished heads-up flops: `/Users/mhan/Desktop/projects/gtosolver/.work/bin/slot.sh scripts/library/publish.sh`
   (see `docs/DEPLOYMENT.md` §2).

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
