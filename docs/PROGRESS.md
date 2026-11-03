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
