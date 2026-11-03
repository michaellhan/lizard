# Existing solver audit

This audit covers the solver snapshot that LIZARD is built on, in `solver/`. It condenses three research reports
(`docs/research/01-codebase-audit.md`, `03-solver-numerics.md` and `06-testing-security-risk.md`) and checks their
key claims against the code. It is written for engineers who need to know what the solver is, what LIZARD reuses,
and where the risks are. For how accurate the answers are, see `docs/ACCURACY.md`.

All paths are relative to `/Users/mhan/Desktop/projects/lizard/` unless shown otherwise.

**Method.** Everything here is read-only. The sources are file reads, `grep`, `wc`, `du`, `shasum`, and JSON reads
of the library indexes plus a 450-entry sample of library entry headers. I did not import the solver, and I did not
run any test suite, solve, benchmark or build. Two library builds were running on the machine at the time.

**Tags**

| Tag | Meaning |
|---|---|
| **[V]** | Verified in code or data, by the research reports or in this pass. Citations are `file:line`. |
| **[M]** | A measurement recorded upstream (README, a docstring, a code comment or a build log). It is quoted, not reproduced. Report 01 calls these [R]. |
| **[I]** | Inferred, or a judgement. Check it before relying on it. |

---

## 1. Summary

1. **What it is [V].** The snapshot is a No-Limit Hold'em study solver: a Python + NumPy package, `solver/gto/`,
   with 36 modules and about 25,600 lines. The heads-up postflop engine is a range-vs-range Discounted CFR solver
   over a fixed bet tree. Its iterations run in hand-written C cores (`solver/core/gtocore.c`, `mwcore.c`), compiled
   both to native `.so` files and to WebAssembly. In the browser the package runs under Pyodide 0.26.4 in a Web
   Worker. On a desktop an optional local HTTP server (`gto/server.py`) answers the same requests natively.
2. **One integration seam [V].** `Advisor.advise(state) -> dict` (`gto/advisor.py:2981`) takes a JSON game state
   and returns a JSON answer. The worker (`gto/static/worker.js`) and the server (`gto/server.py`) are the only
   hosts. LIZARD wraps this seam and does not change the numerics behind it.
3. **Two kinds of data [V].** The preflop charts in `gto/preflop.py` are written by hand. They are tuned until
   their fold/call/raise shares match published aggregate frequencies from third-party solvers. They are **not**
   output of this solver. The postflop flop library *is* this solver's output: 18 heads-up spots (25,575 flop
   entries plus 12,978 turn files) and 4 three-way spots (740 entries). It totals 39,331 files and 315 MB on disk.
4. **Snapshot provenance [V].** Upstream is `michaellhan/gto-solver` at commit `9b907bd6`, imported 2026-11-03
   (`solver/UPSTREAM.json`). The flop library, `scripts/pfbench/` (AGPL) and `CLAUDE.md` are excluded. The only local
   patch is a guard in the two deploy scripts.
5. **Test baseline.** Python: 678 tests, all passing except 5 expected failures. Node: 411 of 411 at run time
   (379 static `test(` calls; loops generate the rest). The Python suite takes about 12 minutes on the user's Mac
   (704 to 761 s in the ship logs) [M]. Parts of both suites need the library, and some tests depend on machine load.
6. **Licensing [V].** The solver has no LICENSE file anywhere. It bundles treys (MIT) and loads Pyodide (MPL-2.0)
   unmodified from a CDN. The AGPL `postflop-solver` code is not in the snapshot; only benchmark drivers that call
   an excluded binary remain.
7. **Secrets [V].** No real credential was found. The only key-shaped strings are obvious test fakes.
8. **Top risks.** Answers that are charts, rules or approximations could be shown as if they were solves. Other
   risks: upstream churn, library/code version skew, CPU contention with the running builds, the 25 MB first load,
   and fragile cross-origin isolation (section 9).

---

## 2. Snapshot provenance

| Item | Value | Source |
|---|---|---|
| Upstream | `michaellhan/gto-solver`, commit `9b907bd61a95758c48b1141cfadd854ba2c0eeaa` (2026-11-03 04:17 -0500) | `solver/UPSTREAM.json` [V] |
| Fidelity | 254 non-library files byte-identical to upstream; only the two deploy scripts differ | 01 §0 [V] |
| Excluded | `gto/static/flop_library/` (served separately), `scripts/pfbench/` (AGPL Rust harness), `CLAUDE.md` | `UPSTREAM.json` [V] |
| Local patch | `scripts/deploy.sh:5-10` and `scripts/deploy_library.sh:12-17` refuse to publish unless `BUILD_ONLY`, `DRY_RUN` (deploy.sh only) or `LIZARD_ALLOW_UPSTREAM_DEPLOY=1` is set | [V] |

**Loose ends [V].**
- Both guard comments point at `solver/UPSTREAM.md` and `../scripts/deploy.sh`. Neither file exists. The provenance
  file is `UPSTREAM.json`, and the root `scripts/` holds only `build-solver-assets.mjs` and `postbuild.mjs`.
- `DRY_RUN=1` passes the `deploy.sh` guard, and it then runs the full test suite plus the sanity sweep, which is
  heavy CPU. `deploy_library.sh` does not accept `DRY_RUN`, although its comment says it does. That is stricter
  than documented, so it is safe.
- `solver/.gitignore` does not ignore the library. The root `.gitignore` does (`.gitignore:34`). Keep it, or one
  `git add .` stages 315 MB.

---

## 3. What the solver is

```
            React UI (web/)  --  SolverClient (web/src/solver/client.ts)
                 |                                   |
     worker transport (postMessage)           HTTP transport (fetch)
                 |                                   |
   gto/static/worker.js (Pyodide 0.26.4)      gto/server.py (127.0.0.1:8765)
                 |                                   |
                 +--------- gto.advisor.Advisor -----+      one JSON request -> one JSON answer
                              |         |         |
               preflop charts    flop library     live solves
               (preflop.py,      (flop_library.py, (solver.py: DCFR, heads-up;
                pf_*.py)          mw_library.py)    multiway_solver.py: 3-4 way)
                                                    |
                                     C cores: core.wasm / core-mt.wasm / native .so
                                     (fallback: pure NumPy)
```

- **Answer order [V].** Preflop answers come from the charts, or from push/fold equilibria at short stacks. A
  heads-up flop the library stores is answered from the library. Anything else is solved live within a time
  budget. Pots the solvers do not take get heuristic "betting rules". A catch-all, `_fallback`
  (`advisor.py:3020-3040`), answers any spot that raised an error, using the rules, the chart or an equity estimate,
  and marks it `fallback`.
- **Algorithm [V].** The heads-up default is `dcfr-ramp`: DCFR with alpha 1.5; beta 0 up to iteration 100, then 0.5;
  and an averaging exponent gamma = min(8, 3 + t/10) (`gto/solver.py:1376-1399`). Updates alternate between the
  players, and regrets are float32. Ten other schemes are selectable through `Config.cfr`.
- **Engines [V].** `Solver.run` tries the C core first and falls back to NumPy for trees the core does not cover.
  `tests/test_core.py:525` (`TestSameAsNumpy`) checks the core against NumPy to a regret tolerance of 1e-5 to 1e-4.
  `test_core.py:97` requires bit-identical output on any thread count. Both are skipped without a C compiler.
- **Threads [V].** In the browser, `core-mt.wasm` runs `min(7, cores - 1)` helper threads when the page is
  cross-origin isolated (`worker.js:107,143`). With 4 or more threads, Fast switches to a richer turn tree
  (`worker.js:235`). The server defaults to `min(8, cpu)` core threads (`server.py:142`). The CLI uses one thread
  unless `GTO_THREADS` is set. BLAS is pinned to one thread natively (`native.py`).
- **Runtimes [V].** The native venv is Python 3.9.6 with numpy 2.0.2. The browser is Pyodide 0.26.4, which is
  CPython 3.12 with numpy 1.26.4. [I] The two runtimes can differ in the last bits, so CI should cover both.

---

## 4. Module map

Line counts come from `wc -l` [V]. Grouped by responsibility.

| Area | Modules (LOC) | Responsibility |
|---|---|---|
| Entry and orchestration | `advisor.py` (8,584) | Turns a game state into an answer: picks the source, narrows ranges street by street, builds the response, handles Study, Practice (`play`), triage and fallbacks |
| Heads-up solver | `solver.py` (2,505) | `Config` (tree and abstraction), `TreeBuilder`, `Solver` (DCFR, best response, exploitability), `Solution` |
| Multiway solver | `multiway_solver.py` (2,344) | 3-player (and 2-player) CFR with exact 3-range card removal; reports best-response gains, with no Nash guarantee |
| C core loaders | `core.py` (1,099), `mwcore.py` (535) | Build or load the native `.so` (ctypes) or bind the wasm module (`js.gtoCore`, `js.mwCore`) |
| Precomputed data I/O | `flop_library.py` (1,350), `mw_library.py` (582) | Read, write and look up library entries; `fetch` is injected (directory natively, synchronous XHR in the worker) |
| Approximate reads | `flop_approx.py` (806), `off_tree.py` (208), `runouts.py` (156), `breakdown.py` (286) | Nearest-flop answers, off-menu sizes, turn/river reports, Breakdown/Equity views |
| Preflop | `preflop.py` (1,124), `pf_formats.py` (297), `pf_classes.py` (153), `pf_game.py` (838), `pf_solve.py` (288), `pf_study.py` (598) | Hand-written charts; other formats as deltas; push/fold by fictitious play; an abstract preflop game solved by DCFR; Study's stored preflop solves |
| Generated data | `pf_equity.py`, `pf_format_data.py`, `pf_libvals.py`, `pf_eqr.py`, `pf_realize.py`, `pf_realize_model.py`, `pf_game_data.py`, `flop_approx_model.py` | Tables written by scripts in `solver/scripts/`; regenerate only through those scripts |
| Tournament and exploit | `icm.py` (591), `exploit.py` (689) | Malmuth-Harville ICM, bounty model, prize payoffs for the solvers; pool-opponent (exploit) mode |
| Basics | `cards.py` (66), `ranges.py` (128), `evaluator.py` (146) | Card encoding, range parsing (1326-combo vectors), a vectorised evaluator built on treys |
| Hosts and tools | `server.py` (160), `native.py` (145), `cli.py` (134), `routes.py` (112) | Local HTTP API, native speed profiles, manual-entry CLI, per-route page copies |
| Legacy UI | `static/index.html` (2,882) and 16 scripts (11,168 lines in all), `static/worker.js` (433), `static/sw.js` (20) | Vanilla-JS single page, the Pyodide worker, and a service worker that adds COOP/COEP |

**Import discipline [V].** The worker's first answer imports only `advisor, cards, core, evaluator, flop_library,
pf_classes, preflop, ranges, solver`. The rest loads lazily or during idle warm-up (`advisor.py:1073`
`WARM_IMPORTS`). `tests/test_bundle.py` enforces this. Startup latency depends on it, so keep that test in CI.

---

## 5. Hosts and protocols (summary)

### 5.1 The Advisor contract

- **Request [V].** A JSON object. The core fields are `players` (2-9), `hero`, `hole`, `board`, `stack` or `stacks`,
  `bb`, `ante`, `straddle`, `rake` and `rake_cap`, plus per-street action lists `preflop`, `flop`, `turn` and
  `river`. Each action is `{pos, action, amount?, to?}`. Speed is controlled by `budget` and `prior_budget`
  (seconds, clamped at `advisor.py:3954-3957`), `quick`, and `speed` (`"fast"`/`"accurate"`, which the host reads to
  pick an Advisor). Optional features: `payouts`, `field`, `bounties`, `sizes`, `ranges`, `locks`,
  `opponents: "pool"`, `study`, `triage`, `library_only`, `breakdown`, `one_size`, `runouts`, `preflop_solve`.
  Report 01 §2.3 has the full table.
- **Response [V].** `actions` (each with `freq`, `ev_bb`, `amount_bb`), `recommended`, a 169-cell `grid`, range data,
  and `notes`. Convergence data sits in `solver: {iterations, solve_seconds, exploitability_pct, approximate?,
  target_pct?}` (`advisor.py:5161-5166`). A library answer adds `precomputed: {spot, label, board, iterations,
  exploitability_pct, same_tree, borrowed?}` (`flop_library.py:1045-1048`). Instant (early) answers carry a top-level
  `approximate: {source, label, iterations}` (`advisor.py:7040`). Triage answers carry
  `triage: {source, confidence, label}`. Fallbacks carry `fallback` (`"rules"`, `"chart"` or `"equity"`,
  `advisor.py:3833`) and `fallback_reason` (`advisor.py:3035`).
- **Concurrency [V].** The Advisor is stateful and not thread-safe. Hosts serialize calls. Cancellation goes through
  `Advisor.should_stop`.
- **Fixtures [V].** `tests/data/page_states.json` holds 428 real `{hand, state, page}` records, usable as contract
  fixtures.

### 5.2 Worker protocol (`gto/static/worker.js:385-428`) [V]

```
page -> worker:  {ping:n} | {cancel:id} | {stop:SharedArrayBuffer} | {prefetch:state}
                 | {id, state, play?:{seat,hole,seed?}, early?:bool, presolve?:seat}
worker -> page:  {status, setup?} | {pong:n} | {id, partial} | {id, result} | {id, error}
```

- An `early` request may post up to 4 `partial` answers before its `result`: one instant answer, then the solve
  so far at each look.
- A cancelled id answers `{result: {cancelled: true}}`.
- `prefetch` never answers.
- `error` is the last 3 lines of a Python traceback. Render it as text.
- The worker loads Pyodide from `cdn.jsdelivr.net/pyodide/v0.26.4/full/` (`worker.js:2`), the library through
  `?lib=`, and `solver.zip` through the Cache API. LIZARD copies `worker.js` unchanged except for the cache name
  (`scripts/build-solver-assets.mjs:35-42`).

### 5.3 HTTP server (`gto/server.py`) [V]

- `POST /advise`, `POST /play` and `POST /cancel`; `GET /health` and the library files.
- It binds `127.0.0.1:8765` by default. Solves run one at a time under a class lock.
- Every JSON reply sends `Access-Control-Allow-Origin: *` (`server.py:38,44`). While the server runs, any web page
  the user opens can POST to it. That is acceptable only on localhost; anything wider needs an origin allowlist, a
  token and a body-size cap.
- Speed profiles come from `native.SPEEDS`: Fast 2.5 s + 2.5 s, Accurate 30 s + 12 s (`native.py:85-92`). The
  browser's profiles are separate strings in `worker.js:237-245`, and the browser's budgets are set by the legacy
  page (`index.html:974`). **These definitions are duplicated and have drifted on purpose** (a slower runtime gets
  longer budgets). LIZARD needs one canonical profile, or a test that compares them.

---

## 6. Data assets

### 6.1 Preflop charts: hand-written, not solved

- `gto/preflop.py:3` says the charts are "hand-written approximations of solver outputs" [V]. They are range
  strings tuned until their aggregate fold/call/raise shares match published numbers. Most sources are
  gtopreflop.com, the GTO Wizard blog, Poker Academy, pokalab and thinkgto (`tests/preflop_refs.py:1-20`; README
  "Known limits"). The paywalled GTO Wizard data was explicitly not used (06 §4.1) [V].
- The README says the charts "are written by hand, not solver output" (`README.md:4547`) and records a mean error
  of 0.96 points over 26 published reference spots [M]. `tests/test_gto.py:3098` (`TestPublishedPreflopReferences`)
  enforces a mean under 2 points and each spot's own tolerance [V].
- Other formats (20-100bb, antes, 7-9 handed, straddle, heads-up) are the 100bb charts shifted by deltas from
  solves of an abstract preflop game (`pf_formats.py`) [V]. That game (`pf_game.py`) is this solver's own
  equilibrium. It sits 2.4-3.0 points from the published spots and was not used to replace the charts [M].
- Five `@expectedFailure` tests (`tests/test_gto.py:2797, 2811, 2834, 2909, 2932`) record where the
  equity-realization models disagree with the charts [V].
- **Consequence:** LIZARD labels preflop as charts and never calls them solved.

### 6.2 Flop library (precomputed heads-up and 3-way flops)

| Kind | Files | Size | Source |
|---|---:|---:|---|
| Heads-up flop entries `<spot>/<flop>.bin` (`GTOFL3`) | 25,575 | 72.65 MB | [V] |
| Heads-up turn files `<spot>/<flop>.turn.bin` (`GTOTN1`) | 12,978 | 167.57 MB | [V] |
| 3-way entries `mw_*/<flop>.bin` | 740 | 4.53 MB | [V] |
| `report.json` / `ranges.json` per spot, `index.json` (732 KB), `mw_index.json` | 38 | about 7.9 MB | [V] |
| **Total** | **39,331** | **252.7 MB apparent, 315 MB on disk** | [V] (`find`, `du`) |

- **Spots [V]** (`index.json`, format 2). There are 18 heads-up 6-max 100bb spots: `srp_btn_bb`, four other
  single-raised pots against the BB (`srp_co_bb`, `srp_hj_bb`, `srp_utg_bb`, `srp_sb_bb`) and eight 3-bet pots, each
  with all 1,755 canonical flops; plus five flatted-open spots with 552 flops each. There are 4 three-way spots
  (`mw_index.json`, format 1) with 185 flops each.
- **Two tree models [V].** Nine spots (`srp_btn_bb` and the eight 3-bet pots) were solved with the river dealt: 64
  strength buckets on each river card. Each of the other nine spots has every flop in its `old` list, meaning
  solved on the older "blind river" tree, and none of them has turn files. The README line saying the library was
  solved with the river on the turn's boards (`README.md:4733`) is true only for those nine.
- **Entry format [V].** `b"GTOFL3"` + zlib(`<u32 header length>` + JSON header + body). The header holds spot, fp,
  pot, stack, board, `iters`, `seconds`, `expl` (% of the pot) and the tree hash. The body holds strategies in 1%
  steps and EVs as int16 plus a log-coded gap. A node is stored when the other player reaches it with at least 5% of
  their range (`flop_library.py:42`). Turn files store the first turn decision and in-position-after-check, per turn
  class, in 5% steps (`flop_library.py:666-671`).
- **Lookup key [V].** The key is a fingerprint of both ranges (`range_fp`, sha1 of the 1/10000 weights), plus pot,
  stack, canonical flop, the sizes key and `MODEL_VERSION`. **Changing any chart weight by 0.0001 silently
  invalidates every entry for that spot.** A miss falls through to slower or approximate sources; there is no error.
- **Build settings [V].** `scripts/build_flop_library.py:296-299`: at least 200 and at most 1,000 iterations, checked
  every 100, stopping under 0.15% of the pot. My 450-entry header sample found stored exploitability of
  0.058-0.150% (mean 0.109%) at 200-500 iterations.
- **In progress [V, 03 §8.8].** Two heads-up (2-max) spots, `srp_sb_bb_2max` and `lp_sb_bb_2max`, were being built
  in the upstream `.work/` folder. They use the same format and tree model. Lizard merges them by copying only the
  listed entries. It reads their folders only through `scripts/library/assemble.py`, read-only, and validates every
  copied file (`CLAUDE.md`). Their range fingerprints match this snapshot's charts: the lead checked both spots on
  2026-11-03 by computing them with the snapshot (values in `docs/ARCHITECTURE.md` §6).

### 6.3 Other assets [V]

- `gto/static/pf/6max_100bb.bin` (83,491 B) and `6max_100bb_r5c3.bin` (88,827 B): Study's stored preflop solves.
- Four wasm files in `gto/` (not `gto/static/` as report 01 §3 says): `core.wasm` 73,780 B, `core-mt.wasm` 96,298 B,
  `mwcore.wasm` 126,560 B, `mwcore-mt.wasm` 132,971 B. Each embeds the sha1 of its C source, and both shas match
  `shasum core/gtocore.c core/mwcore.c` (`ebdf06ac...`, `d50de123...`). Cached native builds are in `core/build/`.
- `tests/data/`: `page_states.json`, turn/river reference solves (`turn_river_refs.json`, `.npz`), a format-1 entry
  fixture, and 23 synthetic hand histories.
- No image or font assets exist anywhere in `solver/` (06 §4.1).

---

## 7. Tests

### 7.1 Baseline

| Suite | Count | Result | Duration |
|---|---|---|---|
| Python `unittest`, `solver/tests/` (42 modules) | 678 `def test_` [V] | OK, 5 expected failures | about 12 min (704-761 s in three ship logs, 2026-11-03) [M] |
| Node `node --test 'tests/js/*.test.js'` (31 files, Node 22+) | 379 static calls; 411 at run time [V] | 411/411 | not recorded |
| Cloudflare proxy, `cloudflare/explain-proxy/test/` | 8 | not recorded | small |

The written evidence for the pass/fail counts is the upstream commit message at `9b907bd6`: "Python 678 OK (5
expected failures), node 411 OK" (06 §1.1). This audit did not re-run either suite. Root `package.json` defines
`npm run test:solver` and `npm run test:solver-js`.

### 7.2 Things that make the suites fragile

- **Library dependence [V].** Many tests skip cleanly without the library. Five tests or test groups need it and
  have no guard: `tests/test_runouts.py:132` (opens `index.json`), `tests/test_instant_mw.py:112,200`
  (`default_library()` returns `None`), `tests/js/reports.test.js:170`, `tests/js/drills.test.js:193-203` and
  `tests/js/multitable.test.js:424,490`. `test_flop_library.py:806` also requires the library to match the current
  charts and tree. **CI needs a pinned copy of the exact library**, not whatever upstream publishes today.
- **Load sensitivity [V].** There are 12 wall-clock assertions in 7 modules (for example `test_runouts.py:150,191`
  assert `seconds < 1.0`). `test_progress.py` needs a 0.5 s flop solve to reach 300 iterations, and upstream's
  notes say it fails at load average 9 or more. 106 test lines use budgets of 1 s or less. Upstream's deploy retries
  the whole Python suite once (`deploy.sh:37-45`).
- **Compiler gating [V].** 32 tests in `test_core.py`, plus classes in `test_multiway_solver.py` and
  `test_turn_river.py`, skip without a C compiler. On Linux the core is built without Accelerate (`gto/core.py:86`),
  so Linux CI exercises a slightly different path from the Mac.
- **The legacy UI tests will not survive a port [I].** The Node tests drive `index.html` through a fake DOM
  (`tests/js/page.js`). Extract their engine, state, hand-history and store semantics as pure fixtures before
  porting.

---

## 8. Licenses and secrets

### 8.1 Licenses

| Component | Use | License | Status |
|---|---|---|---|
| The solver (`solver/`) | All of it | **None declared** | No LICENSE, COPYING or NOTICE file anywhere [V]. The notices draft says "All rights reserved". Without a license a public repo is visible but not reusable. The owner must decide. |
| treys 0.1.8 | Bundled into `solver.zip` | MIT | `scripts/build_bundle.py:33-37` ships its LICENSE [V] |
| numpy | Runtime | BSD-3-Clause | Native 2.0.2; Pyodide's 1.26.4 [V] |
| Pyodide 0.26.4 | Loaded unmodified from jsDelivr | MPL-2.0 (CPython: PSF) | Notice plus source link; the same applies if self-hosted unmodified [V/I] |
| b-inary `postflop-solver` | **Not vendored** | AGPL-3.0 | `scripts/pfbench/` is excluded. `scripts/bench_postflop_solver.py:48` calls the binary and exits if it is missing. Never ship or vendor it. [V] |
| Third-party preflop data | Hand-tuned ranges matched to published aggregates | n/a | Keep the citations, do not reproduce third-party chart grids, and keep competitor names out of the UI [I, not legal advice] |

### 8.2 Secrets scan [V]

- Patterns searched (06 §3.1, re-run in this pass for the key formats): `sk-ant-`, `gh[pousr]_`, `github_pat_`,
  `AKIA…`, `-----BEGIN`, `xox?-`, `AIza…`, and files named `.env*`, `.dev.vars*`, `*.pem`, `*.key`.
- The only hits are fake test keys: `tests/js/store.test.js:14` and `tests/js/explain.test.js:16`, plus the
  placeholder in `cloudflare/explain-proxy/test/index.test.js:11`.
- `cloudflare/explain-proxy/wrangler.toml` holds a KV namespace id and a rate-limiter namespace. These are
  identifiers, not secrets. LIZARD must create its own namespace rather than reuse that id.
- The proxy's Anthropic key is a Wrangler secret, not in the repo. The legacy page keeps a user's own key in
  `localStorage` (`store.js:19-20`), readable by any script on the shared origin.

---

## 9. What LIZARD reuses, wraps and replaces

Governing rule: **do not rewrite working, validated numerical code.** Keep `solver/` byte-identical to upstream
except for the declared patch list.

| Class | Components | Why / action |
|---|---|---|
| **Reuse unchanged** | `solver.py`, `multiway_solver.py`, `core.py`, `mwcore.py`, `core/*.c`, the 4 wasm files; `evaluator.py`, `cards.py`, `ranges.py`; `preflop.py` and all `pf_*` modules and generated data; `icm.py`, `exploit.py`, `flop_approx.py`, `off_tree.py`, `runouts.py`, `breakdown.py`; `flop_library.py`, `mw_library.py` and the library data; `cli.py`; the build scripts (`build_bundle.py`, `build_core.py`, `build_flop_library.py`, `build_mw_library.py`) | Engine equivalence, tree keys and byte-level library compatibility all depend on these together. Combo order is part of every stored file. Any chart edit invalidates library fingerprints. |
| **Wrap** | `Advisor` (typed TS + JSON Schema contract, validated against `page_states.json`); `static/worker.js` (used as-is behind `web/src/solver/worker-transport.ts`, one build-time cache-name edit); `server.py` (local "desktop" transport, `web/src/solver/http-transport.ts`); `native.py` speed profiles | The seam is small and JSON-shaped. Normalize provenance in one adapter (`web/src/solver/provenance.ts`) rather than in Python. |
| **Port** | `index.html` and the UI scripts (to React); `store.js`, `hh.js` and the engine logic (logic first, with tests) | Re-implement the views; keep behavior through extracted fixtures. |
| **Replace** | `deploy.sh`, `deploy_library.sh` (never run from LIZARD); `routes.py` and per-route page copies; `sw.js` (adapted in `web/public/sw.js`); branding, legal drafts, storage names (`gto-*`), `michael-han.com` URLs | Legacy hosting and branding. Use a `lizard-*` namespace for every storage name. |
| **Keep as research, out of the product** | `bench_*`, `calibrate_*`, `compare_*`, reference scripts, `docs/*_research.md`, `README.md` | Useful for regression measurement; README numbers are partly stale (for example "9327 entries" and "53 KB"). |

---

## 10. Top risks

| ID | Risk | Evidence | Mitigation |
|---|---|---|---|
| R1 | **Misleading accuracy**: charts, rules and approximate reads shown beside real solves | Hand-written charts; 5 expected failures; Quick turns about 6-7% of the pot from equilibrium in the browser (`index.html:638`) [M]; sources include `near`, `prev`, `unraked`, `offtree`, `rules` [V] | A provenance badge on every number (`web/src/components/ProvenanceBadge.tsx`); "solved" wording only for library or live solves with a stated exploitability; the rules in `docs/ACCURACY.md` |
| R2 | **Provenance mapping gaps in LIZARD** (fixed 2026-11-03) | `sourceOf` labelled stored-turn reads as "live" and 5+-way heuristic answers as "unknown", and ignored top-level `approximate` [V] | Fixed: new sources `library-turn` and `instant`, and 5+-way maps to rules. Tests are in `provenance.test.ts`. Details and the open rows are in `docs/ACCURACY.md` section 11 |
| R3 | **Mode budgets not sent by LIZARD** (fixed 2026-11-03) | `applyMode` set only `quick`/`speed`, and nothing in `web/src` sent `budget`. The worker's Advisors are built without budgets (`worker.js:240-245`), so they defaulted to 4 s + 2 s (`advisor.py:2860`) [V] | Fixed: `applyMode` sends the legacy page's budgets (`index.html:974-978`) for each mode and backend. Tested in `client.test.ts` |
| R4 | Upstream churn | 135 upstream commits in 7 days; `advisor.py` and `index.html` change most [V, 06 R2] | Vendored snapshot, declared patches, scripted read-only re-sync, contract fixtures that carry the upstream sha |
| R5 | Library/code version skew | Entries whose fingerprint, tree or `MODEL_VERSION` no longer match are silently ignored [V] | Serve a pinned library with a manifest hash; a contract test of index format and tree against the code |
| R6 | CPU/RAM contention on the shared Mac | Load about 7, swap 9.2 of 10.2 GB, builds at 100% CPU (06 R1) [V] | No full suites locally while builds run; `nice -n 19`, `GTO_THREADS=1`, one module at a time |
| R7 | Cross-origin isolation is fragile | Threads need COOP/COEP; GitHub Pages cannot send headers, hence the service-worker workaround [V] | Header rules at the host, or the SW; show the thread count; degrade to one thread, then NumPy (`worker.js:98-152`) |
| R8 | First load and memory | About 25 MB of Pyodide plus numpy on a first visit; heap peaks of 490-1,065 MB against a 2 GB shared-memory maximum (README) [M] | Lazy-load the engine; self-host Pyodide; a smaller mobile profile |
| R9 | Local server open to any web page | Wildcard CORS on `127.0.0.1:8765` (`server.py:38,44`) [V] | Origin allowlist, a startup token, a body-size cap |
| R10 | No license | Section 8.1 [V] | Owner decision before any public repo |
| R11 | Accidental publish over the legacy site | `deploy_library.sh` force-pushes a public repo [V] | Guards in place; keep them across syncs; CI tokens without write access |

---

## 11. Corrections to the research reports

The code differs from the research reports in these places. All are [V] in this pass.

| Report claim | What the code says |
|---|---|
| 01 §3: wasm files live in `gto/static/` | They are in `gto/` (`gto/core.wasm` etc.). 03 has the right path. |
| 01 §0, §1.1: no root `.gitignore`, so the library would be staged | A root `.gitignore` now exists and ignores `solver/gto/static/flop_library/` (`.gitignore:34`). 06 §3.1 noted it was added during the session. |
| 01 §0: 379 Node tests | 379 static `test(` calls; 411 tests at run time (06 §1.2). |
| 03 §1.5: "Native solving is single-threaded per solve" | True for the CLI. The server defaults to `--threads min(8, cpu)` (`server.py:142`), which also switches Fast to the threaded tree (`native.py:133`). |
| 03 §1.3: `HU_SETTLED_FROM = 300` | A per-street dict, 300 for each street (`advisor.py:115`); the browser lowers the turn to 200 on one thread (`worker.js:261`). |
| 03 §10c: `TestRiverTheory`, `TestRiverClasses` in `test_gto.py` | Both are in `tests/test_turn_river.py:35,106`. `TestRiverStrength` is in `test_gto.py:1937`. |
| 06 §0, R4: "Without isolation 80 vs 211 iterations, 1.2% vs 0.28%" | The README (`README.md:1846-1849`) pairs 80 / 1.2% (1 thread) with 191 / 0.32% (8 threads), both beside a running build. 211 / 0.28% was with the build paused. All are Accurate turns with a 15 s budget. |
| README: library entries take "300-800 iterations" | The build minimum is 200 (`build_flop_library.py:296`), and sampled 3-bet-pot entries stop at 200. |
| `deploy.sh`/`deploy_library.sh` guard comments cite `solver/UPSTREAM.md` and `../scripts/deploy.sh` | Neither exists. The provenance file is `UPSTREAM.json`. The comments were corrected before the first commit. |
| `ModePicker.tsx:5-7` hints: Quick about 2 s, Fast about 8 s, Accurate about 60 s | LIZARD did not send those budgets (R3), so in the browser all three ran at the Advisor's 4 s default. Fixed on 2026-11-03; the hints now state the budgets actually sent. |

---

## 12. Not verified

- Pass/fail of the suites in this checkout. This audit did not run them. The baseline is upstream's recorded
  result, as reported to this audit.
- Per-entry exploitability for all 25,575 entries. Only 450 were sampled.
- Whether Pyodide needs `'unsafe-eval'` under a strict CSP (06 §5.2) [I].
