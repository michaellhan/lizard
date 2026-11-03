# 06: Testing, security and technical-risk assessment

**Scope.** This report covers the imported solver snapshot at `solver/` (upstream `michaellhan/gto-solver` main @ `9b907bd6`, 2026-11-03, per `solver/UPSTREAM.json`) and the Lizard scaffold present on 2026-11-03 (`package.json`, `web/`, `.gitignore`, `.npmrc`). Paths are relative to `/Users/mhan/Desktop/projects/lizard`.

**Method.** Everything here was read-only: grep/wc/cat, small `python3 -c` snippets that read JSON (none imported the solver), and read-only `git log`/`ls-files` on the upstream checkout. **No test suite, solve, build or install was run.** The baseline test run is happening separately.

**Legend.** **[V]** means I checked it in code, files or logs, with a citation. **[I]** means I inferred it or am relying on outside knowledge; verify those before acting on them.

> Note: the workspace changed while this report was being written. Another agent added the root `.gitignore`, `.npmrc`, `package.json`, `web/` and the deploy guards in `solver/scripts/deploy*.sh` around 06:09–06:16. The findings below describe the state as re-checked at the end.

---

## 0. Executive summary

1. **Test baseline [V].** 678 Python test methods in 42 modules (the static count matches upstream's "Python 678 OK (5 expected failures)" commit message at `9b907bd6`). There are 379 static `test(` call sites in 31 Node files; at run time this becomes 411 tests, because `hh.test.js:71` and `share.test.js:52` generate tests in loops. On the user's Mac the Python suite takes **705–761 s** (`.work/*/ship*.log`, 11-03).
2. **The library is a hard dependency of parts of both suites [V].** Some Python tests skip without it, but `test_runouts.TestReports.test_stored_turns` (`tests/test_runouts.py:132`) and `test_instant_mw` (`:112`, `:200`) do not. In Node, `reports.test.js:170`, `drills.test.js:193-203` and `multitable.test.js:424,490` read `gto/static/flop_library` unconditionally. **CI therefore needs a pinned copy of the library** (about 253 MB, already compressed), or a split between a no-library tier and a full tier.
3. **Load-sensitive tests are real [V].** There are 12 wall-clock assertions in 7 Python modules and 106 test lines with sub-second or 1 s budgets. `test_progress` fails at load average 9 and above (per `AGENT_RULES.md`). `TestStudyPrev` is now iteration-based in the snapshot (`test_instant.py:193-200`), but `TestReports` still asserts `seconds < 1.0` (`test_runouts.py:150,191`). Slow 2-vCPU CI runners will flake unless failed tests are retried once, which is the same policy `scripts/deploy.sh:37-45` uses.
4. **Secrets [V].** No real credential was found in `solver/`. The only key-shaped strings are obvious test fakes: `tests/js/store.test.js:14`, `tests/js/explain.test.js:16`, and the placeholder in `cloudflare/explain-proxy/test/index.test.js:11`. The proxy keeps `ANTHROPIC_API_KEY` as a Wrangler secret. `wrangler.toml` holds only identifiers: the KV namespace id and the rate-limiter namespace.
5. **Explain proxy [V].** The origin allowlist, the 5-per-minute per-IP limit, 20 per IP per day and 1000 per day globally are all implemented. Two weaknesses: the `Origin` header is client-forgeable, and the client chooses the entire prompt (up to 8000 characters), so this is effectively a capped free Claude relay. Worst-case cost is roughly **$13/day** at the global cap [I, computed from Sonnet 5.5 at $2/$10 per MTok]. Lizard at `www.michael-han.com/lizard/` already passes the allowlist and would **share the 1000/day pool** with `/gto-solver/`.
6. **Licensing [V].** treys is MIT (`.venv/.../treys-0.1.8.dist-info/METADATA`) and its LICENSE is shipped by `scripts/build_bundle.py:35-37`. numpy is BSD-3. Pyodide 0.26.4 is MPL-2.0 and loaded from jsDelivr (`gto/static/worker.js:2`). **The solver has no LICENSE file**, and `docs/legal/third-party-notices.md` (a draft) says "All rights reserved". `postflop-solver` (AGPL) code is not present; only the benchmark drivers that shell out to the excluded `scripts/pfbench` binary remain. There are no image or font assets at all.
7. **Preflop data provenance [V].** The charts are *hand-written* and calibrated to published aggregate frequencies, mostly from gtopreflop.com, the GTO Wizard blog, Poker Academy, pokalab and thinkgto (`gto/preflop.py`, `tests/preflop_refs.py`, `README.md:4547`). They are not solver output. In "Known limits" the README says they "are written by hand, not solver output". Lizard must never present them as "solved", and should drop "like GTO Wizard's …" phrasing (21 mentions in the README, plus 3 comments in shipped JS) from anything public.
8. **XSS [V].** Legacy rendering is innerHTML-heavy: 99 `innerHTML` sinks plus 2 `insertAdjacentHTML`. Escaping is disciplined in the modules (232 `esc(` calls), and share links are whitelisted by `cleanState` (`index.html:1277`). Three residual gaps exist:
   - The `esc` helpers do not escape `'` (all except `hands.js:14`).
   - `index.html` has no escape helper at all and renders `res.error`, which is Python exception text, through innerHTML (`index.html:1992`, fed by `worker.js:428` and `server.py:125`).
   - The page shares an origin with every other `www.michael-han.com` path.

   React rendering with no `dangerouslySetInnerHTML` closes the first two for Lizard.
9. **CSP is feasible [I].** A `<meta>` CSP can serve as the baseline. The existing COI service worker (`web/public/sw.js`) already rewrites headers for navigations and worker scripts, so it can also inject a real `Content-Security-Policy` header (including `frame-ancestors`). Required allowances: `'wasm-unsafe-eval'`, `cdn.jsdelivr.net` (unless Pyodide is self-hosted) and `worker-src blob:` (the helper workers come from a Blob URL, `worker.js:126`).
10. **Top technical risks.**
    - CPU/RAM contention on the shared Mac. At 06:12: load 7.2, **swap 9.23 GB of 10.24 GB used**, three Python processes at about 100% CPU each.
    - Upstream churn: **135 commits in 7 days**, with `README.md`, `gto/advisor.py` and `gto/static/index.html` the hottest files.
    - A 25 MB Pyodide/numpy first load.
    - Fragile cross-origin isolation (the SW hack). Without it the solver runs single-threaded: 80 vs 211 iterations, 1.2% vs 0.28% exploitability (README:1846-1849).
    - iOS memory: heap peaks of 490–1065 MB against a 2 GB shared-memory maximum.
    - Partial heads-up coverage: no 2-max spots in the shipped library yet.
    - Misleading accuracy, because charts, rules and approximations sit beside real solves.

---

## 1. Test inventory

### 1.1 Python (`solver/tests/*.py`, `unittest`, stdlib only plus numpy and treys)

Count method: `grep -c 'def test_'` per module. **[V]** The total is 678 across 42 modules (`__init__.py` and the data module `preflop_refs.py` have 0).

| Module | Tests | Module | Tests | Module | Tests |
|---|---:|---|---:|---|---:|
| test_gto | 169 | test_instant | 13 | test_native | 6 |
| test_multiway_solver | 61 | test_bounty | 13 | test_cache | 6 |
| test_instant_near | 42 | test_stacks | 12 | test_study_store | 5 |
| test_core | 34 | test_pf_formats | 12 | test_routes | 5 |
| test_flop_library | 24 | test_mw_library | 12 | test_rare_resolve | 5 |
| test_pf_study | 22 | test_breakdown | 11 | test_presolve | 5 |
| test_coverage | 20 | test_settled | 9 | test_triage | 4 |
| test_pf_game | 18 | test_preflop_locks | 9 | test_study_sizes | 4 |
| test_off_tree | 18 | test_progress | 8 | test_runouts | 4 |
| test_instant_store | 16 | test_instant_mw | 8 | test_prefetch | 4 |
| test_study | 15 | test_instant_near_turn | 7 | test_off_solution | 4 |
| test_one_size | 15 | test_cfr | 7 | test_rough_ev | 2 |
| test_icm | 15 | test_bundle | 7 | test_page_states | 2 |
| test_turn_river | 13 | test_tree_cap | 6 | | |

**Baseline [V].** The upstream commit message at `9b907bd6` reads: "Python 678 OK (5 expected failures), node 411 OK."

**Measured duration [V].** From read-only `.work` ship logs on 11-03 (user's Mac, during ship holds):

| Log | Result |
|---|---|
| `rareline/ship.log` | Ran 678 tests in 704.332 s |
| `myhands/ship4.log` | Ran 678 tests in 711.421 s |
| `livekit/ship2.log` | Ran 678 tests in 760.902 s |

An older log, `.work/bp3_unittest.log`, shows "Ran 339 tests in 2139.832s … failures=4" (a partial run on a loaded machine), which illustrates how much load matters.

**Other properties [V]:**

- **Network-free.** `test_routes.py:71` starts `ThreadingHTTPServer(("127.0.0.1", 0))` on an ephemeral local port. No external HTTP calls.
- **Subprocess children.** `test_core.py:268-317` and `test_bundle.py:29` re-run Python in child processes, so one module can use more than one process.
- **Fixtures.** `tests/data/` (736 KB) holds:
  - `page_states.json` (428 `{hand, state, page}` records written by the Node suite)
  - `turn_river_refs.json` (13 spots) and `turn_river_ref_values.npz`
  - `flop_v1_3bp_btn_co_Qc9c2d.bin`
  - 23 hand-history files in `tests/data/hh/`. These look synthetic (fabricated hand numbers such as `#249012345678`, made-up names) [I].

### 1.2 Node (`solver/tests/js/*.test.js`, `node:test`, no npm packages, Node 22+ per README:30)

Count method: static `test(` call sites. **[V]** The total is 379 across 31 files; the 411 at run time comes from loop-generated tests (`hh.test.js:71` per HH fixture, `share.test.js:52` per spot).

| File | Calls | File | Calls | File | Calls |
|---|---:|---|---:|---|---:|
| session | 31 | multitable | 13 | breakdown | 8 |
| study | 30 | hands | 13 | bounty | 8 |
| practice | 28 | drills | 13 | writeup | 7 |
| engine | 26 | stacks | 11 | icm | 7 |
| solver_state | 19 | simple | 11 | presolve | 6 |
| share | 16 | reports | 10 | core | 5 |
| store | 14 | help | 10 | worker | 4 |
| hh | 14 | explain | 10 | mwcore | 3 |
| advanced | 14 | table | 8 | layout | 3 |
| routes | 13 | stakes | 8 | | |
| | | runouts | 8 | | |
| | | rake | 8 | | |

`solver/cloudflare/explain-proxy/test/index.test.js` adds 8 more proxy tests. They use only Node builtins, need no `npm install`, and are not part of `tests/js`.

**Harnesses [V]:**

- **`tests/js/page.js` (279 lines).** Loads the single inline `<script>` of `gto/static/index.html` into a `vm` context with a fake DOM: the `El` and `ClassList` classes, and `innerHTML` stored as an unparsed string (`page.js:43-73`).
  - `loadPage(opts)` takes `hash`, `path` (default `/gto-solver/`), `search`, `scripts`, `protocol`, `storage`, `server` and `isolated` (`page.js:75-79`). `GTO_PAGE=<file>` tests another copy of the page (`page.js:18`).
  - It sets `--no-sparkplug` to work around a Node 24.14 V8 GC segfault seen in about 1 in 70 parallel runs (`page.js:9-15`).
  - **Implication:** the legacy tests are welded to the legacy single-file page. Lizard's React UI needs its own tests (§2.2).
- **`tests/js/idb_shim.js` (163 lines).** An in-memory IndexedDB covering versions and `onupgradeneeded`, abort rollback, keyPath and out-of-line keys, and `failOpen` (`idb_shim.js:1-5`). `store.test.js` and `hands.test.js` use it.
- **`tests/js/hh_synth.js` (93 lines).** Generates synthetic PokerStars sessions.

### 1.3 Expected failures [V] (all in `tests/test_gto.py`, each with a "Known failure" comment)

| Line | Class | Test | Reason given in the source |
|---|---|---|---|
| 2797 | TestRealizationTable | test_pairs_in_order | Raw table noisy per class (CO vs BTN: 99 continues 1.76bb, 88 2.31) |
| 2811 | TestRealizationTable | test_stable_across_flop_halves | BTN vs SB call share 0.55 vs 0.45 between flop halves |
| 2834 | TestRealizationTable | test_close_to_charts | UTG vs CO calls 14% (chart 26%), BTN vs SB 50% (chart 36%) |
| 2909 | TestRealizationModel | test_stable_across_flop_halves | 3bettor's call share vs 4bet moves 10–11 points between halves |
| 2932 | TestOpenerVs3bet | test_close_to_charts | OOP openers call 2–2.5x the charts (CO vs BTN 47% vs 18%) |

These document that the *experimental* preflop subgame disagrees with the hand-written charts. This matters for the "misleading accuracy" risk (§6, R10).

### 1.4 Skip conditions [V]

| Condition | Where | Effect |
|---|---|---|
| No C compiler (native core) | `test_core.py:95,524,697,809,910` (`@skipUnless(ON, …)`); `test_multiway_solver.py:422,1195`; `test_turn_river.py:263` | Native-core classes skip. On Linux the core is built with `cc -O3 -shared -fPIC` (`gto/core.py:85-87`). Only macOS links Accelerate (`gto/core.py:86`), so **Linux CI exercises a different code path from the Mac (no BLAS)** [I: numerics may differ in the last bits]. |
| Library absent (guarded) | `test_flop_library.py:813,859,869,892`; `test_instant_near.py:54`; `test_off_tree.py:229`; `test_rake_read.py:35`; `test_mw_library.py:46,273`; `test_instant_near_turn.py:107`; `test_prefetch.py:45` | Skips |
| Optional generated modules | `test_instant_near.py:248,278,321` (`gto/flop_approx_model.py`); `test_pf_game.py:142,301,329` (`pf_libvals.py`, `pf_eqr.py`); `test_pf_formats.py:231` | Skips (all present in the snapshot) |
| Data-dependent | `test_gto.py:3437` ("no mixed hand found") | Skips |

### 1.5 Tests that need `gto/static/flop_library` and have **no** skip guard [V]

| Test | Line | Failure mode without the library |
|---|---|---|
| `test_runouts.TestReports.test_stored_turns` | `tests/test_runouts.py:132` | `open(LIB/index.json)` raises FileNotFoundError, reported as an ERROR |
| `test_instant_mw` (two classes) | `tests/test_instant_mw.py:112,200` | `default_library()` returns None and later attribute access errors [I] |
| `reports.test.js` "the shipped reports load…" | `tests/js/reports.test.js:170-171` | readFileSync throws |
| `drills.test.js` (served library) | `tests/js/drills.test.js:193-203` | readFileSync throws |
| `multitable.test.js` (two tests) | `tests/js/multitable.test.js:424,490` | readFileSync throws |

`test_routes` degrades gracefully, because `routes.spot_slugs` returns `[]` (`gto/routes.py:38-42`).

The library check at `test_flop_library.py:809` ("built for the current charts and tree") means **the library must match the code version**. Pulling whatever `gto-solver-library` currently publishes would break CI whenever upstream rebuilds.

### 1.6 Tests that read `scripts/deploy.sh` [V]

| Test | Assertions |
|---|---|
| `tests/test_bundle.py:80-89` | the `build_bundle.py … solver.zip` line and `WV="$(…)"` |
| `tests/js/routes.test.js:212-237` | `-m gto.routes "$WORK/site/gto-solver"`, the version stamps before it, `const LIB_BASE = "../gto-solver-library/"`, `git add -A` |
| `tests/js/solver_state.test.js:234` | the `gto/static/health.json"` copy |

`tests/test_routes.py:2` mentions deploy.sh only in its docstring.

The Lizard guard added at the top of `solver/scripts/deploy.sh:5-10` and `deploy_library.sh:12-17` leaves every asserted string intact. I re-grepped each one and all are present. Keep future edits to these files at the top only. (The guard comments point at `solver/UPSTREAM.md`, but the file is `UPSTREAM.json`.)

`routes.test.js:215` runs Python as `$PYTHON`, else `solver/.venv/bin/python`, else `python3`. In Lizard the venv lives at `../.venv`, so the test silently uses the system `python3`. That works only because `gto/routes.py` imports nothing beyond the stdlib (`:13-17`). Set `PYTHON=../.venv/bin/python`.

### 1.7 Time-budgeted and load-sensitive tests

- **Rules file [V].** `/Users/mhan/Desktop/projects/gtosolver/.work/AGENT_RULES.md`, "Two flaky tests (11-02 19:50)" and "A gap between holds":
  - `test_instant.TestStudyPrev.test_none_where_it_doesnt_apply` and `test_runouts.TestReports.test_turn_solve_rivers` "fail on main whenever the machine is busy: their solves stop after 1 s". The fix 1d8e2d3b landed as 7e1561d3.
  - `test_progress` "is still load-sensitive (its 0.5 s flop solve must reach 300 iterations): it fails at load 9+, passes at ~5 … don't loosen it."
- **Snapshot state [V]:**
  - `test_instant.py:193-200` now solves with `budget=60` and asserts iterations `== [400]`, so it no longer depends on time.
  - `test_runouts.py:150,191` still `assertLess(r["seconds"], 1.0)`.
  - `test_progress.py:27` uses `native.advisor("fast", budget=30, prior_budget=0.5)` and asserts `iterations == 300` (`:44,65,78,151`).
- **Wall-clock assertions [V].** 12 lines in 7 modules:
  - `test_flop_library.py:634` (< 0.9 s) and `:687` (< 2.0 s)
  - `test_native.py:129`
  - `test_gto.py:370` and `:1263`
  - `test_multiway_solver.py:383` and `:793`
  - `test_mw_library.py:210` (< 0.5 s)
  - `test_runouts.py:150` and `:191`
  - `test_settled.py:50` and `:108`
- **Short budgets [V].** 106 test lines pass a `budget` of 1.0 or less.
- **Upstream mitigation [V].** `scripts/deploy.sh:37-45` retries the whole Python suite once on failure ("time-budgeted tests can fail on a loaded machine").

---

## 2. Lizard test strategy

### 2.1 Keep the upstream suites green (run from `solver/`)

The root `package.json` already defines `test:solver` (`cd solver && PYTHONPATH=. ../.venv/bin/python -m unittest`) and `test:solver-js` (`cd solver && node --test 'tests/js/*.test.js'`). Adjust them as follows:

| Need | Command or change | Why |
|---|---|---|
| Python suite | `cd solver && PYTHONPATH=. GTO_THREADS=1 nice -n 19 ../.venv/bin/python -m unittest -q` | `GTO_THREADS` defaults to 1 natively (README:26), but set it explicitly. Use `nice` on the shared Mac. |
| One module | `cd solver && PYTHONPATH=. ../.venv/bin/python -m unittest tests.test_routes -v` | Targeted runs while the builds are going |
| Node suite | `cd solver && PYTHON=../.venv/bin/python node --test --test-concurrency=2 'tests/js/*.test.js'` | `node --test` defaults to `availableParallelism()-1` processes, which is 9 on this Mac [I, Node docs]. `PYTHON` covers `routes.test.js:215`. |
| Proxy tests | `cd solver/cloudflare/explain-proxy && node --test test/*.test.js` | 8 tests, no install needed |
| Node version | Change `engines` in the root `package.json` from `>=20` to `>=22` and pin CI to 24.x (local is v24.14.0) | The README requires Node 22+. `node --test` with a glob pattern needs Node 21+ [I]. |
| Expected baseline | "Python 678 OK (5 expected failures), node 411 OK" | From upstream `9b907bd6` |
| Fixture regen | `UPDATE_FIXTURES=1 node --test …` rewrites `tests/data/page_states.json` (README:36-37) | Only after a deliberate engine change |
| Never | `DRY_RUN=1 solver/scripts/deploy.sh` locally | It runs the full suites *and* the sanity sweep, "about 3 minutes on 10 cores" (README:4518) |

Policy: **do not edit upstream tests in place.** Divergence turns every sync into merge conflicts. Put Lizard-specific selection, retries and sharding in a wrapper under `scripts/test/`.

### 2.2 React/TS app: Vitest + Testing Library

The `web/` toolchain is already pinned [V, `web/package.json`]: vitest 5.0.5, @testing-library/react 16.3.3, @testing-library/jest-dom 7.0.1, jsdom 30.1.2, fake-indexeddb 6.2.6.

Recommended layers:

1. **Pure units (node environment).**
   - Cards and range parsing (`web/src/engine/nlhe/cards.ts`).
   - Provenance mapping (`web/src/solver/provenance.ts`).
   - Route parsing, share-link encode/decode (round-trip on the legacy `#h=` format: `encodeState` and `decodeState` at `index.html:1306-1307`).
2. **Component tests (jsdom + Testing Library).**
   - RangeMatrix, ProvenanceBadge and EngineStatusPill.
   - Assert accessible roles and names, and keyboard navigation.
   - Assert that **every strategy view renders a provenance badge** (see R10).
3. **XSS regression tests.** Render hostile strings everywhere user or imported text appears and assert they come out as text, not elements:
   - hand-history player names, site names, notes and tags
   - backup-file ids
   - `res.error` text
   - payloads such as `"<img src=x onerror=alert(1)>"` and `'"><svg/onload=…>'`
   - Add an ESLint rule (`react/no-danger`, or `no-restricted-syntax` banning `innerHTML` and `dangerouslySetInnerHTML`).
4. **Security unit tests.** The Anthropic key must never be written to IndexedDB, exports or backups. This mirrors `store.js:19-20,32` and the fake key in `store.test.js:14`.

### 2.3 Contract tests: TypeScript `SolverClient` against the worker protocol

The wire protocol [V, `gto/static/worker.js:385-428`; mirrored in `web/src/solver/protocol.ts`]:

```
page -> worker: {ping:n} | {cancel:id} | {stop:SharedArrayBuffer} | {prefetch:AdvisorState}
              | {id, state:AdvisorState, play?:{seat,hole,seed?}|null, early?:bool, presolve?:seat}
worker -> page: {status:string, setup?} | {pong:n} | {id, partial:AdvisorResponse}
              | {id, result:AdvisorResponse} | {id, error:string /* last 3 traceback lines */}
```

Invariants to pin, all taken from the worker source:

- At most 4 `partial`s before `result` for an `early` request (`worker.js:418-424`).
- A cancelled id answers `{result:{cancelled:true}}` (`:408`).
- `error` is a string made of the traceback's last 3 lines (`:428`). The UI must render it as text.
- `prefetch` never answers (`:389-398`).
- Answer provenance arrives as `source ∈ {solve, store, prev, near, unraked, offtree, chart}` (from the `gto/advisor.py` emitters). Triage answers carry `triage.source ∈ {chart, library, approx, quick, rules}` and `confidence ∈ {high, medium, low}` (`advisor.py:3117-3131`).

**Golden fixtures.** Store them in `web/src/solver/__fixtures__/*.json`, one file per scenario:

```json
{ "name": "library-flop-srp_btn_bb-Kc7d2h",
  "upstream": "9b907bd6", "library": "<index.json sha256>",
  "request":  { "id": 1, "state": { "players": 6, "hero": "BB", "hole": "QhJh", "board": "Kc7d2h", "...": "..." }, "early": true },
  "messages": [ { "id": 1, "partial": { "...": "..." } }, { "id": 1, "result": { "source": "store", "...": "..." } } ] }
```

- **Generate them from deterministic answers only:** chart answers, library or store answers, and iteration-capped solves. Time-budgeted solves vary by machine.
- Generate them with a small Python script run under `nice` on a quiet machine, or in CI. It should call `answer()`/`early()` the way `worker.js` does.
- Each fixture records the upstream SHA and library hash, so a snapshot sync shows up as an explicit fixture diff.

**Tests to write:**

- **(a) Schema.** Parse every fixture message through runtime validators for `WorkerOutbound`. Typing the protocol in TS alone is not enough; validate at the boundary.
- **(b) Client behaviour.** Drive `SolverClient` with a fake `Worker` that replays the fixture's messages:
  - ordering
  - cancellation races (cancel after a partial)
  - a worker crash (`onerror`)
  - the `status` progress strings
  - the ping timeout
  - re-sending pending requests after a worker restart (the legacy page does this at `index.html:1188`)
- **(c) Real-worker smoke (nightly).** Load the real `worker.js` with Pyodide in Node or Playwright and replay 3 fixtures end to end. This needs the 25 MB download, so keep it out of PR CI.
- **(d) HTTP transport parity.** The same fixtures against `gto/server.py` (`POST /advise`, `/play`, `/cancel`; `server.py:100-125`) in the nightly Python job.

### 2.4 IndexedDB schema migration tests

Lizard uses one DB, `"lizard"`, with a `MIGRATIONS` map, `DB_VERSION = max(keys)` and `openLizardDB(version, name)` [V, `web/src/data/db.ts:6,38-53`]. Use fake-indexeddb, or reuse the upstream `idb_shim.js` (no dependencies). Test the following:

1. The `MIGRATIONS` keys are contiguous from 1 to N.
2. Upgrade paths. For each v from 1 to N-1: open at v, seed the fixture records for v (checked into `__fixtures__/db/v{n}.json`), open at N, then assert data and indexes.
3. A failed or aborted upgrade leaves the old DB intact. The shim supports aborted upgrades (`idb_shim.js:1-3`).
4. Downgrade (`VersionError`) and `onblocked` (another tab holding an old connection) are handled.
5. Open failure (private mode) falls back cleanly. `fakeIndexedDB({ failOpen: true })` covers this, and upstream behaves the same way (`store.js:21`).
6. Quota-exceeded writes surface an error rather than losing data silently.
7. If Lizard imports the legacy `gto-store` DB (same origin, `store.js:24`), test the importer against a v1 dump including tombstones (`store.js:3-4`).
8. Export and import round-trip the data, and exports never contain the API key.

### 2.5 Numerical parity for anything ported to TypeScript

Use `solver/tests/data/page_states.json` as the cross-language oracle. It holds 428 records shaped like:

```
{hand, state:{players,hero,hole,board,stack,preflop[],flop[],turn[],river[]},
 page:{street,to_act,pot,cur_bet,active[],allin[]}}
```

Any TS port of the hand engine (acting order, pots, side pots, validation) must reproduce every record exactly. Equity or range math ported to TS should be checked against Python on a fixed seed, with a documented tolerance (for example 1e-9 absolute for exact enumeration, and a stated confidence interval for Monte Carlo).

### 2.6 Playwright smoke of the deployed `/lizard/` (optional, scheduled)

Run Chromium only per deploy, and add WebKit weekly as a Safari approximation. Checks:

- Deep links return 200 and render.
- The SW installs, and `crossOriginIsolated === true` after the first reload.
- No reload loop when service workers are disabled. The legacy page guards this at `index.html:1068-1072`.
- Worker status reaches ready within 60 s, and a preflop chart answer renders with a "chart" badge.
- A library flop answer is fetched from the library base (`web/src/config.ts:15-21`).
- A `#h=` share link round-trips.
- No console errors and no `securitypolicyviolation` events.

It needs no secrets. Cache `~/.cache/ms-playwright` keyed by the Playwright version.

### 2.7 CI on GitHub Actions

| Job | Trigger | Needs library | Contents | Est. minutes [I] |
|---|---|---|---|---|
| `web` | every push/PR touching `web/**`, `package*.json` | no | `npm ci --ignore-scripts`, typecheck, lint, vitest, build, **dist secret scan**, bundle-size budget | 3–5 |
| `solver-js` | push/PR touching `solver/**` | split | Node 24.x: `tests/js` excluding `reports`, `drills`, `multitable` on PRs; all of them in nightly. Plus the proxy tests. | 1–3 |
| `solver-py-fast` | push/PR touching `solver/**` | no | Python 3.9 (as the upstream venv, `pyvenv.cfg` 3.9.6) with `numpy==2.0.2`, `treys==0.1.8`. Library-free modules only, through a wrapper that excludes the §1.5 IDs. | 8–15 |
| `solver-py-full` | nightly, plus manual `workflow_dispatch` before each upstream sync | yes | All 678 tests sharded by module (4 shards), retry failed IDs once, upload a timing report | 4 × 8–12 |
| `contract` | push/PR | no | §2.3 (a)/(b) with checked-in fixtures | ≤1 |
| `e2e` | after deploy, plus daily cron | n/a | §2.6 | 3–5 |

- **Library in CI.** Do not clone `michaellhan/gto-solver-library` live. It is force-pushed with no history (`scripts/deploy_library.sh:30-37`) and tracks upstream's *current* code, which can fail `test_flop_library.py:809`.
  - Publish a pinned tarball of the exact library that matches the snapshot, either as a GitHub Release asset or as Lizard's own `/lizard-library/`.
  - Measured size: 39,331 files, **252.7 MB** apparent (315 MB on disk); a zlib ratio of 1.00 on a 600-file sample means it is already compressed.
  - Restore it with `actions/cache`, keyed on the sha256 of the library manifest. That is well under the 10 GB per-repo cache limit [I], and the nightly job keeps the cache warm against the 7-day eviction [I].
- **Caching.**
  - `actions/setup-node` with `cache: npm` and `actions/setup-python` with `cache: pip`.
  - The native core is content-addressed (`core/build/gtocore-<sha1[:12]>.so`, `gto/core.py:81`), so cache `solver/core/build` keyed by `hashFiles('solver/core/*.c')`.
  - The Playwright browser cache.
- **Minutes (private repo) [I].**
  - GitHub's plan quotas as I know them: Free 2,000 and Pro 3,000 Linux minutes per month; Windows ×2, macOS ×10. Verify on the billing page.
  - Pages from a private repo requires a paid plan, so the account is probably Pro.
  - With path filters, `concurrency: cancel-in-progress`, and the full Python suite only nightly: about 30 pushes a week at roughly 6 min, plus 30 nightlies at roughly 40 min (4 shards), comes to about 1,700–2,000 minutes a month.
  - Running the full suite on every push would exceed 3,000.
  - Private-repo standard runners are 2 vCPU [I]. Expect the time-budgeted tests (§1.7) to flake, so retry failed test IDs once and track the flake rate. Do not loosen the tests, per AGENT_RULES.
- **Workflow hygiene.**
  - Pin third-party actions by commit SHA and set `permissions: contents: read` by default.
  - The deploy job runs only on `main`, in a protected environment, with a repo-scoped deploy key or a fine-grained PAT limited to `michaellhan.github.io` contents.
  - PRs from forks never see secrets.
  - Run gitleaks on the repo with an allowlist for the three fake-key test files, and a grep of `web/dist` for `sk-ant-|AKIA|gh[pousr]_|github_pat_|-----BEGIN`.

---

## 3. Secret scan and explain-proxy review

### 3.1 Scan of `solver/` (excluding the binary library) [V]

Patterns used:

```
sk-ant-…, sk-[A-Za-z0-9]{20,}, gh[pousr]_…, github_pat_, AKIA[0-9A-Z]{16}, -----BEGIN,
xox[baprs]-, AIza…, ANTHROPIC_API_KEY=<value>, secret, password, token, bearer, api_key, private_key
```

I also searched for files named `.dev.vars*`, `.env*`, `*.pem`, `*.key`, `id_rsa*`, `.npmrc` and `.netrc`.

| Location | What | Verdict |
|---|---|---|
| `tests/js/store.test.js:14` | `sk-ant-api03-…` literal | **Fake test fixture** (contains "secretSECRETsecret"), used to prove the key never enters backups |
| `tests/js/explain.test.js:16` | `sk-ant-api03-obviously-fake-…` | Fake test fixture |
| `cloudflare/explain-proxy/test/index.test.js:11` | `"test-secret-not-a-real-key"` | Fake test fixture |
| `cloudflare/explain-proxy/wrangler.toml` | KV namespace `id`, rate-limit `namespace_id` | Identifiers, not secrets |
| `cloudflare/explain-proxy/README.md:14-15`, `README.md:894` | Instructions (`wrangler secret put`, `.dev.vars`) | No values |
| `gto/static/practice.js:485` | Proxy URL `https://gto-explain.<account-subdomain>.workers.dev/explain` | Public by design. It reveals the Cloudflare workers.dev account subdomain, which is informational only. |
| `.dev.vars`, `.env*`, keys, `.npmrc` with a token | none present | — |
| `scripts/deploy*.sh` | No embedded credentials. They push via `gh repo clone` and the ambient `https://github.com/$REPO.git` auth (`deploy.sh:67,169`, `deploy_library.sh:37`). | OK |

The root `.gitignore` (added during this session) covers `.env*`, `.dev.vars`, `*.pem`, `*.key`, `secrets/`, `.venv/`, `node_modules/` and `solver/gto/static/flop_library/` [V]. `solver/.gitignore` alone did **not** exclude the library or the root `.venv`, so the root file is what prevents a 315 MB commit; keep it.

The root `.npmrc` contains only `save-exact`, `fund` and `audit`, with no token [V].

### 3.2 `solver/cloudflare/explain-proxy` [V unless marked]

| Control | Implementation | Assessment |
|---|---|---|
| Key storage | `env.ANTHROPIC_API_KEY`, a Wrangler secret (`README.md:14`, `wrangler.toml:2`); missing key returns 502 (`proxy.js:87`) | Good. The key never reaches the client, and upstream errors are sanitized (`proxy.js:62-68,115-119`; tested at `index.test.js:169-175`). |
| What the client controls | Only `{prompt}`, a string of at most 8000 characters (`proxy.js:84-86`) | **Weakness.** The prompt is free text, so anyone can use the proxy as a capped general Claude endpoint under the owner's key. Model, system prompt and `max_tokens: 700` are fixed server-side (`proxy.js:9,12,15-24,109-111`). |
| Origin allowlist | Exact origins plus `scheme://host:*` (`proxy.js:29-40`); defaults to `www.michael-han.com`, `michael-han.com`, `http://localhost:*`, `http://127.0.0.1:*` (`wrangler.toml:8`) | Browser-only protection: non-browser clients forge `Origin`. Allowing `localhost:*` lets any local page on any port call it. |
| Burst limit | `RATE_LIMITER` binding, 5 per 60 s per hashed IP (`wrangler.toml:15-21`, `proxy.js:91-94`) | OK. Keyed on the full `CF-Connecting-IP`, so an IPv6 client can rotate within its /64 [I]. |
| Daily limits | KV `COUNTS`: `ip:<day>:<sha256(ip)[:12]>` ≤ 20, `all:<day>` ≤ 1000, TTL 2 days (`proxy.js:95-105`) | OK. The IP is hashed, which is good for privacy. KV is not atomic, so bursts overshoot slightly (acknowledged at `proxy.js:101`). |
| Model and parameters | `claude-sonnet-5-5`, `stream: true`, `thinking: {type:"between_tools"}`, `output_config: {effort:"low"}`, `anthropic-version: 2023-06-01` (`proxy.js:9,109-111`) | Valid per the claude-api skill's current model table (Sonnet 5.5 accepts `between_tools`, with no other fields, at effort ≤ high). No refusal fallback, so a `stop_reason: "refusal"` stream ends with a short answer [I, minor]. |
| Response | Raw SSE stream passed through with CORS (`proxy.js:120-121`) | OK |
| Frontend | `practice.js:697` POSTs `{prompt: prompt(e).slice(0, 8000)}`. The own-key path sends `x-api-key` plus `anthropic-dangerous-direct-browser-access: true` straight to api.anthropic.com (`practice.js:698-699`), with the key in **localStorage** `gto-anthropic-key` (`store.js:19-20,32-33`). | Bring-your-own-key in localStorage can be read by any script on the origin, and the origin is shared with the whole personal site (§5.4). |
| Data leaving the device | The prompt contains the hand: cards, actions, the solver mix and the verdict (`practice.js:604-635`) | Disclosed in the draft `docs/legal/privacy.md` §A3. Lizard's privacy copy must say the same; "nothing is uploaded" (README:7-8) is untrue once the user clicks Explain. |

**Cost bound [I].** Per request: about 2.0–2.7k input tokens (8000 characters at roughly 3–4 characters per token, plus about 250 system tokens) and at most 700 output tokens. At Sonnet 5.5's $2/$10 per MTok that is about $0.013. At `DAILY_GLOBAL=1000` the worst case is about **$13/day, ≈$400/month**, plus the KV overshoot.

**Recommendations:**

1. Build the prompt server-side from structured fields (`{game, hand, action[], decision, mix[], verdict}`, each validated and length-capped), so the proxy cannot be used as a general relay.
2. Give Lizard its own `DAILY_GLOBAL` sub-quota (a separate worker, or a `site` key in the counters) so it does not starve `/gto-solver/`.
3. Key the rate limit on IPv6 /64.
4. Drop `localhost:*` from the production allowlist, or keep it only in a dev worker.
5. Offer "remember key" as an opt-in. The default should be sessionStorage, or memory only.

---

## 4. License audit

| Component | How it is used | License | Evidence | Obligations and notes |
|---|---|---|---|---|
| treys 0.1.8 | Bundled into `solver.zip` (Python files) | MIT | `.venv/lib/python3.9/site-packages/treys-0.1.8.dist-info/METADATA` ("License: MIT", Will Drevo, Mark Saindon, Imran Hendley) | Keep the copyright notice. `scripts/build_bundle.py:33-37` adds `treys/LICENSE` to the bundle [V]. Lizard's `scripts/build-solver-assets.mjs` must keep doing that. |
| numpy (2.0.2 native; 1.26.4 in Pyodide) | Runtime | BSD-3-Clause | `numpy-2.0.2.dist-info/METADATA`; `worker.js:43` fetches `numpy-1.26.4-cp312…whl` from jsDelivr | Attribution in the notices |
| Pyodide 0.26.4 (CPython inside) | Loaded unmodified from `cdn.jsdelivr.net/pyodide/v0.26.4/full/` (`worker.js:2,44`) | MPL-2.0 (plus PSF for CPython) | `docs/legal/third-party-notices.md` | Unmodified, so the notice plus a source link is enough. If Lizard **self-hosts** it, the same applies (it is still unmodified); keep the LICENSE files. |
| Solver C core, wasm | Own code, built with clang `-nostdlib` (per the notices draft) | — | `gto/core.wasm`, `core-mt.wasm`, `mwcore*.wasm` (76–132 KB) | No libc bundled |
| postflop-solver (b-inary) | **Not vendored.** `scripts/pfbench` (the Rust harness) is excluded (`UPSTREAM.json`). | AGPL-3.0 | Remaining references: `scripts/bench_postflop_solver.py:48` runs the `PFBENCH` binary as a subprocess and exits if it is missing (`:437`); `bench_flop_abstraction.py:146`; `bench_rare_reply.py:10`; text in `gto/static/help.js:66,83,188` (with a link) and `tests/js/help.test.js:60`; algorithm-parameter comments in `gto/solver.py:1386,1404,2067` (the "dcfr-reset4" scheme reimplemented in numpy) | Running a separately built AGPL binary as a benchmark does not create a derivative. Citing it is nominative. Reimplementing published algorithm parameters is not copying code [I]. **Never ship or vendor pfbench**, and keep the benchmark scripts out of the web bundle. |
| wrangler 4.151.3 (locked) | Dev tool for the proxy | MIT OR Apache-2.0 [I] | `cloudflare/explain-proxy/package-lock.json` (lockfile v3, 92 packages) | Not shipped |
| Lizard web dependencies | 9 runtime packages, exact-pinned | MIT for React, Radix, zustand, idb and react-router [I] | `web/package.json`; root lockfile has 341 packages; the only install script is `fsevents` | Generate a third-party notices file at build time (for example with `license-checker --production`) |
| **The solver itself** | — | **None declared** | No LICENSE, COPYING or NOTICE file anywhere in `solver/`; `README.md` has 0 mentions of "licen[cs]e"; the notices draft says "Copyright (c) 2026 [Michael Han]. All rights reserved [or the licence chosen…]" | A **public** Lizard repo without a LICENSE is "all rights reserved" by default: visible but not reusable. Decide explicitly (owner/legal). |

### 4.1 Third-party preflop data provenance [V]

Lines mentioning each source, by file (`grep -c`):

| Source | README.md | gto/preflop.py | tests/preflop_refs.py | docs/preflop_research.md |
|---|---:|---:|---:|---:|
| "GTO Wizard" | 21 | 9 | 5 | 23 |
| gtopreflop | 9 | 23 | 17 | 11 |
| "published" | 27 | 12 | 3 | 30 |

Other sources named: Poker Academy, pokalab, thinkgto/GTO Ranges+, GTO Gecko, BeyondGTO, Upswing (README 1 mention, research doc 2), and PioSolver/Monker (research doc only). There are 0 mentions of "Run It Once", "PokerCoaching" outside one research-doc line, or "GTOWizard". `gto/pf_format_data.py` and `gto/pf_game_data.py` are generated by the project's own scripts (their headers name `scripts/build_pf_formats.py` and `build_three_way.py`).

What the data is:

- `gto/preflop.py` holds **hand-written** range strings, tuned until aggregate fold/call/raise shares match published numbers.
  - `tests/preflop_refs.py:1-20`: "Published 6-max 100bb cash preflop solver frequencies … Sources (accessed 2026-10)".
  - 26 reference spots plus hand-level facts.
  - `README.md:4547-4553`: an average error of 0.96 points, and "Preflop charts are written by hand, not solver output".
- Some hand-level facts come from a single source, for example `RAKED_HANDS` from gtopreflop.com only (`README.md:4581-4584`).
- Source URLs are cited in code: 4 distinct blog.gtowizard.com URLs and 8 distinct gtopreflop.com URLs across `README.md`, `gto/preflop.py` and `tests/preflop_refs.py`.
- Paywalled GTO Wizard aggregates were explicitly **not** used ("behind an account", `README.md:4726`, `:1622`).

Implications [I, not legal advice]:

1. Aggregate frequencies are facts, and hand-tuned ranges matched to them are original expression. That is low risk, but these are still **derived from third-party solver outputs**. Keep the citations, never reproduce third-party chart grids, and do not imply endorsement.
2. **Accuracy labelling.** The charts are not solved. Five expected failures show the experimental solve disagreeing with them (§1.3). Lizard must label preflop as "Charts (hand-built, matched to published solves)", not "GTO".
3. **Branding.** The README describes features as "like GTO Wizard's analyzer / trainer / filters / range builder" (`README.md:130,152,226,387,654,676`). Shipped JS has comments `breakdown.js:71`, `drills.js:154` and `study.js:367` that mention GTO Wizard; these are not visible in the UI. `index.html` and `help.js` have 0 user-visible "GTO Wizard" strings.
   - Keep competitor names out of Lizard's UI, metadata and marketing.
   - "Lizard" rhymes with "Wizard", and positioning it as "an alternative to GTO Wizard" invites a confusion argument. Have the name checked before any public launch [I].
4. **Assets.** `find` for png/jpg/svg/gif/ico/webp/woff/ttf/otf under `solver/` returns **none**. The legacy UI has no `<svg>` and no favicon link. There is nothing proprietary to remove. Lizard's own `web/public/lizard.svg` is new.

---

## 5. Web security for Lizard

### 5.1 XSS in legacy innerHTML rendering [V]

| File | innerHTML | insertAdjacentHTML | `esc(` calls |
|---|---:|---:|---:|
| index.html | 49 | 1 | 0 (no helper) |
| study.js | 17 | 1 | 58 |
| breakdown.js, hands.js | 5 each | 0 | 13, 34 |
| drills.js, reports.js, simple.js | 4 each | 0 | 12, 10, 17 |
| help.js, practice.js | 3 each | 0 | 5, 3 |
| multitable.js, session.js | 2 each | 0 | 8, 46 |
| writeup.js | 1 | 0 | 11 |
| hh.js, store.js, sw.js, worker.js, runouts.js | 0 | 0 | (runouts 15) |

Across all files: no `eval` or `new Function`, and no inline `on*=` attributes in `index.html`.

- **The escapers.** Eleven modules define `esc` to escape `& < > "`. Only `hands.js:14` also escapes `'`. No single-quoted interpolated attributes were found (`grep "='\${"` returns 0), so this is latent rather than exploitable today.
- **Share links (`#h=`).** These are the main untrusted input. `linkState` (`index.html:2256-2262`) calls `cleanState` (`:1277-1305`), which whitelists:
  - cards, against `/^[AKQJT98765432][shdc]$/`
  - seats, from `SEATS[n]`
  - action names
  - numeric `to`, stakes, rake, payouts and bounties
  - `ADV_KEYS` dropped
  
  It does spread `...st`, so unknown top-level keys survive. None were found rendered (state fields used are listed by `grep 'S\.'`), but this is fragile.
- **Imported hand histories and backups.** These flow through `esc` (for example `session.js:740-742`, and `hands.js:104` `id = esc(rec.id)`, `:107`, `:121`).
- **Residual sinks:**
  - `index.html:1992`: `<div class="err">${res.error}</div>`, where `res.error` is the Python traceback tail (`worker.js:428`) or `repr(e)` (`server.py:125`). If an exception message ever echoes input, this becomes a reflected XSS.
  - `index.html:1318` `toast(msg)` and `:2114` `note.innerHTML = msg`. The callers build their strings from validated state; `hands.js:189` escapes its part.
  - `practice.js:511-512` renders AI output as `esc()` first, then minimal markdown, which is safe.
- **Lizard.** Render with React (text by default) and lint-ban `dangerouslySetInnerHTML` and `innerHTML`. Treat `error` strings, HH names and notes, AI text and imported JSON as untrusted. If Markdown rendering is ever needed, use a renderer with HTML disabled. For any HH or backup reader, parse and validate against a schema (zod or similar) before the data reaches the store.

### 5.2 CSP feasibility on GitHub Pages

GitHub Pages cannot set headers. There are three ways to deliver a policy:

1. **`<meta http-equiv="Content-Security-Policy">`** in `web/index.html`. It works on the first visit. It cannot express `frame-ancestors`, `report-uri`/`report-to` or `sandbox` [I]. It does **not** govern dedicated workers, which take the policy from their own script response [I].
2. **Service worker header injection.** `web/public/sw.js` (an adaptation of `gto/static/sw.js`) already rebuilds the `Response` for `navigate` and `worker` destinations to add COOP and COEP. Add `Content-Security-Policy` (with `frame-ancestors 'none'`) and `X-Content-Type-Options: nosniff` there. This applies from the second load onward, so keep the meta tag as well.
3. **Cloudflare Response Header Transform Rules** for `/lizard/*` [I: believed to be available on the Free plan]. These set real COOP, COEP and CSP headers at the edge on the first load, which would also **remove the first-visit SW reload hack**. It is a zone-level change, so it needs the user's approval (the plan's §10 says not to blindly change domain-wide settings).

Starting policy for Lizard (verify Pyodide's needs; it may also require `'unsafe-eval'` in the worker [I]):

```
default-src 'self'; script-src 'self' 'wasm-unsafe-eval' https://cdn.jsdelivr.net;
worker-src 'self' blob:; connect-src 'self' https://cdn.jsdelivr.net https://gto-explain.<sub>.workers.dev https://api.anthropic.com http://127.0.0.1:8765;
img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'; object-src 'none';
base-uri 'self'; form-action 'none'; frame-ancestors 'none' (header only)
```

Notes on the directives:

- `blob:` is needed because the threaded core's helpers are Blob-URL workers (`worker.js:126-128`).
- Drop `cdn.jsdelivr.net` if Pyodide is self-hosted.
- Drop `127.0.0.1` if "local engine" mode is not offered in production.

The legacy page cannot easily take a strict CSP: it has one inline `<script>` (`index.html:832`), 31 inline `style=` attributes, and many more in JS templates.

### 5.3 Service worker risks

- **Scope.** Serve it at `/lizard/sw.js` so its scope is `/lizard/`. Never at the root, where it would intercept the homepage and `/gto-solver/` (which has its own SW, `gto/static/sw.js:5-6`).
- **COEP `require-corp`.** Every cross-origin subresource then needs CORP or CORS: third-party images, fonts and embeds fail silently. Safari does not support `credentialless` [I].
- **Reload loop and unavailable SW.** Firefox private mode disables service workers [I]. Keep the legacy guards (`index.html:1068-1072`: `isSecureContext`, a controller check and a timeout) and degrade to single-threaded mode. Show the thread count in the engine status. Without isolation: 80 vs 211 iterations, 1.2% vs 0.28% of the pot (README:1846-1849).
- **Activation.** `skipWaiting()` plus `clients.claim()` (`web/public/sw.js:6-7`) means a new SW takes over open tabs immediately. That is harmless while it does not cache. If offline caching is added later, use versioned caches and an update prompt, to avoid stale-shell and API-skew bugs.
- **Kill switch.** Keep a tested no-op `sw.js` ready to deploy, and do not cache `sw.js` itself (GitHub Pages sends `max-age=600` [I]).

### 5.4 IndexedDB and local data privacy

- **Local only [V].** No accounts, and no analytics (grep for gtag, analytics, plausible, sendBeacon, sentry and posthog returns 0). Data leaves the device only through Explain with AI (§3.2) and an optional local server.
- **Same-origin exposure [I, high impact].** `/lizard/` shares the `https://www.michael-han.com` origin with `/gto-solver/` and every other page in the personal-site repo. Any XSS on any of them can read Lizard's IndexedDB and localStorage, including a remembered Anthropic key. Names collide too: the legacy app uses `gto-store`, `gto-pf`, `gto-session` and `gto-*` localStorage keys (`store.js:24-30`). Lizard uses `"lizard"` (`web/src/data/db.ts:6`), which is good, but it should prefix *all* keys, including localStorage and Cache API names. The strongest fix is a dedicated origin, for example `lizard.michael-han.com` from its own Pages repo or Cloudflare Pages.
- **Eviction [I].** Without `navigator.storage.persist()` (not called anywhere in the legacy code), browsers may evict data. Safari's 7-day script-storage policy can delete "My hands" for an infrequent user. Request persistence, show storage status, and nudge users to export.
- **Bring-your-own-key.** Store the key in memory or sessionStorage by default, and never in IndexedDB or exports. The legacy app already enforces the latter (`store.js:19-20`).

### 5.5 No secrets in frontend bundles

- Vite inlines every `import.meta.env.VITE_*` into the bundle. Only non-secret configuration may use that prefix; today the only one is `VITE_LIZARD_LIBRARY_BASE` (`web/src/config.ts:19`).
- CI must grep `web/dist/**` for key patterns (§2.7) and fail on a match.
- The Anthropic key lives only in the Cloudflare secret or the user's browser.

### 5.6 Supply chain

- **Upstream [V].** The page has **zero npm dependencies** ("Node 22+, no npm packages", README:30). The proxy has one dev dependency (`wrangler ^4.140.0`, locked at 4.151.3).
- **Pyodide from jsDelivr [V].** Loaded through `importScripts`, which cannot use SRI (`worker.js:2,44`). A CDN compromise means code execution in the solver worker [I]. Mitigations:
  - Self-host the pinned Pyodide core plus the numpy wheel under `/lizard/`, about 25 MB (README:2005-2006). This also removes a third-party outage dependency and COEP friction.
  - Or fetch it and check a SHA-256 before evaluating.
- **Lizard [V].**
  - `.npmrc` has `save-exact=true`, and all 25 direct dependencies are exact.
  - The lockfile is v3 with 341 packages; the only install script is `fsevents`.
  - Recommended: `npm ci --ignore-scripts` in CI; Renovate or Dependabot with grouping and a release-age delay (for example 14 days); `npm audit signatures`; actions pinned by SHA.
  - Keep runtime dependencies minimal. There are 9 today.
- **Local engine server [V].** `gto/server.py` binds `127.0.0.1` by default (`:134`) but sends `Access-Control-Allow-Origin: *` (`:38,44-46`). While it runs, **any website** can POST `/advise` and burn the user's CPU. The body is read whole based on `Content-Length` (`:107`). For Lizard's "local engine" mode, add an allowlisted origin and a per-session token printed at startup, and cap the body size. Chrome's local-network-access prompts may also apply [I].

---

## 6. Technical risk register

Likelihood and impact use H/M/L. Owners are roles; assign people at kickoff.

| ID | Risk | L | I | Evidence | Mitigation | Owner |
|---|---|---|---|---|---|---|
| R1 | CPU/RAM contention with the running heads-up library builds, or a Mac crash | H | H | At 06:12: `vm.loadavg` 7.22/7.24/6.91; **swap used 9,231.81 MB of 10,240 MB**; `memory_pressure` 50% free; three Python processes at about 100% CPU (RSS 695–889 MB, one up 13:47 h). AGENT_RULES: "the user's Mac has rebooted under load before". The Python suite takes 705–761 s even during ship holds. | No full suites locally; CI runs them (§2.7). Locally: `nice -n 19`, `GTO_THREADS=1`, `--test-concurrency=2`, one module at a time. Check `memory_pressure` and swap first. Never `quiet.sh`, never `DRY_RUN` deploy. No Pyodide or Playwright runs locally while builds are going. | Lizard lead, and every agent |
| R2 | Upstream divergence (agents push to gto-solver main daily) | H | M | `origin/main` (as last fetched): **10 commits in 1 day, 135 in 7, 301 in 14, 439 in 30**; peak 41 on 10-30. Most-touched in 14 days: README.md 208, gto/advisor.py 113, gto/static/index.html 83, worker.js 38, practice.js 34. | Treat `solver/` as vendored and unmodified except the documented guards (`UPSTREAM.json` `local_patches`). Lizard code lives outside `solver/`. Sync on a cadence (for example weekly) from a clean detached worktree at a chosen SHA: rsync excluding the library and pfbench, re-apply the guards, run nightly CI, diff the contract fixtures (§2.3). Keep a sync log. | Solver-integration owner |
| R3 | Pyodide cold start and download size | H | M | First visit about **25 MB** (Pyodide 13.7 + numpy 12.0, README:2005-2006). Worker first answer 1.24–1.38 s quiet; 4.2 s on a loaded machine; the deployed page took 10.9–12.3 s before the bundle work (README:1982-2004). At 5 Mbps, 25 MB is about 40 s [I]. | Lazy-load the engine only on routes that need it. Answer charts and library flops in TS where feasible, without Pyodide. Self-host with long cache lifetimes. Staged progress UI (worker status strings, `worker.js:160-166`). Prefetch on idle. | Web lead |
| R4 | SharedArrayBuffer/COEP requirements | M | M | Threads need cross-origin isolation (`worker.js:143`). GitHub Pages cannot send headers, hence the SW hack (`web/public/sw.js`). Without isolation: 1 thread, 80 vs 211 iterations, 1.2% vs 0.28% of the pot (README:1846-1849). | Cloudflare header rules (needs approval) or the SW. Degrade gracefully; the fallback to the single-threaded core and then numpy is verified at `worker.js:142-152`. Show the thread count. E2E check of `crossOriginIsolated`. | Infra/CI owner |
| R5 | Library size versus GitHub Pages and repo limits | M | M | 39,331 files, 252.7 MB apparent (315 MB on disk), largest file 732 KB (`index.json`). Copying it into the site repo once took that repo's history to **1.08 GB** (README:4515). GitHub Pages soft limits: 1 GB site, 100 GB/month bandwidth [I]. | Never commit the library to the app or site repo (root `.gitignore` [V]). Publish it as a history-less separate repo, as upstream does, or to R2 or Cloudflare Pages. Pin a manifest hash. The Lizard app reads its own `/lizard-library/` (`config.ts:15-21`). | Data/library owner |
| R6 | Library/code version skew (Lizard reading `/gto-solver-library/`, which upstream rebuilds) | M | M | Entries whose "spot, tree or `MODEL_VERSION` no longer matches the code" are ignored (README:4336-4337), which silently falls back to slower live solves. The upstream library repo is force-pushed with no history (`deploy_library.sh:30-37`). | Lizard serves its own pinned library. A contract test asserts the index's tree and format against the code. Show "library miss" telemetry locally in the UI. | Data/library owner |
| R7 | Partial heads-up library coverage | H | M | The shipped library has 18 six-max spots (13 × 1,755 flops + 5 × 552) and 4 three-way spots × 185, and **no 2-max spots**. Builds at 06:10: `srp_sb_bb_2max` has 365 flop + 365 turn files (11 MB) with the log at 287/474 and about 534 min left; `lp_sb_bb_2max` has 151 + 151 (4.7 MB) with the log at 23/424 and about 780 min left. No heads-up 3bet pots are in progress. | Coverage map in the UI. Heads-up spots answered by live solve, labelled as such. Ingest finished builds by copying after they complete; never read partial outputs while they are being written. Do not market heads-up as "precomputed" until the index is complete. | Product and data owner |
| R8 | Safari/iOS memory limits for wasm threads | M | H | Heap peaks: 490 MB (Accurate turn), 566 MB (4-way turn), and 1,065 MB over 12 answers with a 700 MB solve cache (README:1968-1980). Shared memory `maximum: 32768` pages = 2 GB (`worker.js:124`). Up to 7 helper workers (`worker.js:107`). iOS tab limits are lower [I]. | Mobile profile: `cache_mb` around 200–300 and 2 helpers at most. Try a smaller memory maximum and fall back to one thread. Handle worker death by restarting and re-sending (legacy behaviour at `index.html:1188,1239`). Test on real devices and WebKit in Playwright. | Web lead |
| R9 | Numerical regressions when porting (TS engine, Pyodide or numpy versions, Linux versus macOS) | M | H | Native numpy is 2.0.2 while Pyodide's is 1.26.4. Accelerate is linked only on macOS (`gto/core.py:86`). The suite asserts exact iteration counts (`test_progress.py:44`) and values. | Golden parity tests (§2.5, 428 `page_states` records). Contract fixtures carry the upstream SHA. Pin numpy and treys in CI. Run nightly Python on Linux to reveal platform drift [I]. | Solver-integration owner |
| R10 | Misleading accuracy (placeholder or approximate data presented as solved) | H | H | Hand-written preflop charts (README:4547). Five expected failures documenting chart mismatches (§1.3). "Quick" turns are "about 6-7% of the pot from equilibrium in the browser"; 4-way flops "get the betting rules" (`index.html:638`). Answer sources include `near`, `prev`, `unraked`, `offtree`, `chart` and `rules`, and triage confidence can be `low` (`advisor.py:3117-3131`). | A mandatory provenance badge on every strategy and EV view (`ProvenanceBadge.tsx` exists). Use "GTO" wording only for library or solve sources with stated exploitability. An Accuracy page with measured numbers. UI tests assert the badges. | Product lead |
| R11 | Accidental publish over the live upstream site or library from the snapshot | M | H | `deploy_library.sh` force-pushes the public library repo (`:37`); `deploy.sh` pushes the site repo (`:169`). **Mitigated [V]:** guards at `deploy.sh:5-10` and `deploy_library.sh:12-17` require `LIZARD_ALLOW_UPSTREAM_DEPLOY=1`. | Keep the guards across syncs (record them in `local_patches`). CI tokens get no write access to `gto-solver-library`. | Infra/CI owner |
| R12 | Shared-origin storage and XSS blast radius | M | H | §5.4 | Prefix every storage name with `lizard-`. Bring-your-own-key not persisted by default. Long term, a dedicated origin. | Web lead |
| R13 | Explain-proxy quota sharing and abuse | M | L/M | §3.2: about $13/day worst case; the 1000/day pool is shared with `/gto-solver/`. | Structured prompts, a Lizard sub-quota, IPv6 /64 keying | Infra owner |
| R14 | Flaky time-budgeted tests in CI | H | L | §1.7: 12 wall-clock assertions, 106 short budgets, `test_progress` fails at load 9 and above. | Retry failed test IDs once, shard, track the flake rate. Do not loosen upstream tests. | Infra/CI owner |
| R15 | No project license and competitor-referencing copy | M | M | §4 | Choose a license or keep the repo private. Scrub competitor names from public copy. Clear the name before launch. | Owner/legal (user) |
| R16 | Mobile performance (main-thread and UI) | M | M | Desktop figures (8 s Fast spot, 1 min Accurate, `index.html:638`) come from a 10-core M4. The legacy page ships a 240 KB `index.html` with one inline script. | Bundle budgets in CI. Keep the solver in the worker. Virtualise large tables (sessions, reports). Lighthouse or Playwright tracing on a throttled profile. | Web lead |

---

## 7. Prioritized recommendations

**P0 (before the first push or deploy):**

- Keep the root `.gitignore` [V present].
- Run a secret scan on the repo and on `web/dist` in CI.
- Keep the deploy guards.
- Namespace all storage.
- Lint-ban `innerHTML`.
- Add a provenance badge to every number.
- Fix `engines` to `>=22`.
- Set `PYTHON=../.venv/bin/python` for the Node suite.

**P1 (first CI iteration):**

- The `web`, `contract`, `solver-js` (no-library tier) and `solver-py-fast` jobs.
- A pinned library tarball and cache for the nightly full run.
- Retry-once for budgeted tests.
- The meta CSP plus SW-injected headers.
- Self-hosted Pyodide.
- Structured-prompt proxy endpoint and a Lizard sub-quota.

**P2:**

- Playwright smoke with a WebKit lane.
- Cloudflare header rules (with approval).
- A dedicated origin.
- An iOS memory profile.
- License decision and naming review.

---

## Appendix: read-only commands behind the numbers

- **Test counts.** `grep -c 'def test_' tests/*.py` and `grep -cE '(^|[^a-zA-Z_.])test\(' tests/js/*.test.js`.
- **Expected failures, skips, time asserts.** `grep -n` for `expectedFailure`, `skipUnless`, `SkipTest` and `assertLess(...time...)`.
- **Durations.** `grep 'Ran .* tests in'` over `/Users/mhan/Desktop/projects/gtosolver/.work/*/ship*.log`.
- **Upstream churn.** `git -C /Users/mhan/Desktop/projects/gtosolver rev-list --count --since=… origin/main` and `git log --name-only` (read-only).
- **Library stats.** `find`/`du`, and `python3 -c` over `index.json`/`mw_index.json` plus a zlib sample.
- **Heads-up progress.** `ls`/`tail` of `.work/hu-lib`, `.work/hu-lp-lib` and `.work/flop-core/hu_*.log`.
- **Machine load.** `memory_pressure`, `sysctl vm.swapusage vm.loadavg`, `ps -r` (no signals sent).
- **Licenses.** `METADATA` in `.venv/lib/python3.9/site-packages/{treys-0.1.8,numpy-2.0.2}.dist-info`.
