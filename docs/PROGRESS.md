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
