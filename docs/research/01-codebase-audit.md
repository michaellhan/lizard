# 01 · Codebase audit: the GTO Solver snapshot in `solver/`

**Project:** LIZARD, an original poker GTO study app built on the user's existing GTO Solver.
**Snapshot audited:** `/Users/mhan/Desktop/projects/lizard/solver/`, taken from `michaellhan/gto-solver` `main` @ `9b907bd6` (full sha `9b907bd61a95758c48b1141cfadd854ba2c0eeaa`, committed 2026-11-03 04:17:27 -0500).
**Audit date:** 2026-11-03.
**Method:** read-only. I used file reads, `grep`, `wc`, `du`, Python `ast` (static parsing; nothing in the solver was imported), and `git show` / `git ls-tree` on the upstream object store. I did not run any test suite, solve, benchmark, build, install or Pyodide. I did not change the upstream checkout or the running library builds.

**Legend.** Every claim is tagged with how I know it:
- **[V] Verified.** I read it in code or data, or measured it with a command against the snapshot. Citations look like `file:line`.
- **[R] README.** A measured number the upstream README reports. I quote it with its source, and I did not re-measure it.
- **[I] Inferred.** My judgement or extrapolation. Check it before relying on it.

---

## 0. Executive summary

1. **[V] The snapshot is faithful.** 254 non-library files are byte-identical to upstream `9b907bd6`. Only two files differ: `scripts/deploy.sh` and `scripts/deploy_library.sh`. Each has an added *LIZARD GUARD* block that refuses to publish (`deploy.sh:5-10`, `deploy_library.sh:12-17`).
   - Excluded on purpose: `CLAUDE.md` and `scripts/pfbench/` (AGPL Rust harness: `.gitignore`, `Cargo.lock`, `Cargo.toml`, `src/main.rs`).
   - The library (`gto/static/flop_library/`, 39,331 files) is a local copy. Spot checks of `index.json`, `mw_index.json`, `srp_btn_bb/report.json` and `srp_btn_bb/Kc7d6c.bin` match upstream.
2. **[V] Two loose ends from the guard patch.** Both guard comments point at `solver/UPSTREAM.md` and at `../scripts/deploy.sh`. **Neither file exists.** There is also no root `.gitignore`, and `solver/.gitignore` does **not** ignore `gto/static/flop_library/`. A `git init && git add .` at the Lizard root today would stage 315 MB of library.
3. **[V] Architecture.** One Python package (`gto/`, 25,569 LOC in 36 modules) runs natively (CLI and local HTTP server) and in the browser (Pyodide 0.26.4 in a Web Worker). Two hand-written C CFR cores (`core/gtocore.c` 2,655 LOC and `core/mwcore.c` 1,327 LOC) are each compiled two ways:
   - to a native `.so` loaded with ctypes;
   - to wasm, in single-threaded and SharedArrayBuffer-threaded builds.

   The pure-numpy solver is the fallback. The UI is a vanilla-JS single page (`index.html`, 2,882 lines, plus 16 lazy-loaded scripts, 11,168 lines in all).
4. **[V] The integration seam is small and JSON-shaped.**
   - `Advisor.advise(state) -> dict` (`advisor.py:2981`) takes a plain game-state dict: players, hero, hole, board, stacks and per-street action lists.
   - It returns actions/frequencies/EVs, a 169-cell strategy grid, range data and solver diagnostics.
   - `worker.js` and `server.py` are the only hosts.

   This is the place to WRAP with a typed (TypeScript) contract. Do not rewrite anything behind it.
5. **[V] Tests:** 678 Python tests in 42 modules, 379 Node tests in 31 files, and 8 Cloudflare-proxy tests.
   - Known expected failures: 5 `@expectedFailure` tests in `tests/test_gto.py`.
   - Skips: 32 tests are gated on a C compiler, plus library-presence skips.
   - One unguarded library dependency: `tests/test_instant_mw.py:112,200`.
   - Pass/fail was **not** run, under this task's CPU rule.
6. **Classification (§7).**
   - REUSE AS-IS: all numerical code (solver, multiway solver, C cores, evaluator, preflop/pf_* data, libraries, ICM, exploit).
   - WRAP: Advisor, worker.js, server.py, native.py.
   - PORT to React: index.html and the UI scripts.
   - REPLACE: deploy scripts, branding and legal pages, routes.py.
   - DROP from the product: bench, calibrate and reference scripts.
7. **Top risks.**
   - [V] Fast/Accurate solve configs are duplicated in `native.py` and `worker.js`.
   - [V] Storage names (`gto-store`, `gto-session`, `gto-pf`, the `gto-solver` Cache) and `michael-han.com` URLs are hard-coded in code and tests.
   - [V] The native venv runs numpy 2.0.2 on Python 3.9; the browser runs numpy 1.26.4 on Python 3.12.
   - [I] Upstream keeps moving (a commit landed on the snapshot date), so Lizard needs a provenance file and a scripted, read-only re-sync (§8.4).

---

## 1. Repository map

### 1.1 Top-level sizes ([V] `du -sh`, `wc -l`)

| Path | du | Contents |
|---|---:|---|
| `solver/gto/` | 318M | Python package. `static/` is 316M, of which `static/flop_library/` is **315M** (39,331 files, 252.67 MB apparent) |
| `solver/tests/` | 2.5M | 42 Python test modules, `tests/js/` (31 Node test files plus helpers), `tests/data/` |
| `solver/scripts/` | 892K | 64 files, 14,774 lines |
| `solver/README.md` | 508K | 516,684 B, 4,735 lines. Design log plus measurements. **Grep it; do not read it whole.** |
| `solver/core/` | 484K | `gtocore.c`, `mwcore.c`, `build/` (two cached native `.so` files) |
| `solver/docs/` | 136K | `cfr_research.md` (282 lines), `multiway_research.md` (266), `preflop_research.md` (698), `legal/{privacy,refund,terms,third-party-notices}.md` (all marked DRAFT) |
| `solver/cloudflare/` | 92K | `explain-proxy/`: a Worker that proxies "Explain with AI" to Anthropic (`src/proxy.js` 123 lines, `src/index.js` 4, `test/index.test.js` 194) |
| `solver/examples/` | 8K | `flop.json`, `river.json` (sample Advisor requests) |
| `solver/requirements.txt` | n/a | `numpy>=1.24`, `treys>=0.1.8` |
| `solver/.gitignore` | n/a | `.venv/ __pycache__/ *.pyc .DS_Store .claude/ sanity_report.md reports/ .pf_cache/ node_modules/ .wrangler/ .dev.vars core/build/`. **No `gto/static/flop_library`** |

Lizard root `/Users/mhan/Desktop/projects/lizard/`: only `.venv/` and `solver/` (before this report). It is not a git repo. [V]

### 1.2 Languages and LOC ([V] `wc -l`)

| Area | Files | Lines |
|---|---:|---:|
| Python `gto/*.py` | 36 | 25,569 |
| C `core/*.c` | 2 | 3,982 (`gtocore.c` 2,655 / 114,643 B; `mwcore.c` 1,327 / 53,470 B) |
| Static web `gto/static/*.{html,js}` | 18 | 11,168 |
| Scripts `scripts/*` | 64 | 14,774 |
| Python tests | 42 modules | 678 `def test_` |
| Node tests | 31 `*.test.js` | 379 `test(` |

### 1.3 Environment ([V])

- Lizard `.venv`: Python **3.9.6**, numpy **2.0.2**, treys **0.1.8**.
- Browser: Pyodide **0.26.4** (`worker.js:2`, CPython 3.12) with its bundled numpy **1.26.4**.
- Version skew [I]: the two runtimes run different major numpy versions and different Python minors. Upstream already tests both (`tests/js/core.test.js` and the Pyodide scripts), but a Lizard CI should check both runtimes too.
- Python 3.9 floor: `scripts/bench_turn_store.py:84` uses `str.removesuffix` (3.9+). No 3.10+ syntax was found in the AST pass, since all 36 modules parsed under 3.9.

---

## 2. The `gto/` package

### 2.1 Module inventory

Purpose is the module's own docstring (first line), [V]. LOC is `wc -l`. "Startup" means the module is in the browser worker's first-answer import closure (§2.2).

| Module | LOC | Purpose (docstring) | Key public API | Imported by (gto) | Load | External deps |
|---|---:|---|---|---|---|---|
| `advisor.py` | 8,584 (559 KB) | "Turn a game state into a recommendation." | `Advisor`, `WARM_IMPORTS`, `warm_step`, `strategy_grid`, `STUDY_DROPS` | flop_library, mw_library, pf_game, pf_study (all lazy); native, server (top) | startup | numpy |
| `solver.py` | 2,505 | Heads-up postflop solver: range-vs-range discounted CFR over a fixed bet tree | `Config`, `Ctx`, `TreeBuilder`, `Solver`, `Solution`, `solve`, `warm_start`, `expand`, `tree_cells`, `match_action`, `Cancelled`, `TooSlow`, `TreeTooBig` | advisor, flop_library, flop_approx, native, server (top); core, mw_library, runouts, breakdown (lazy) | startup | numpy |
| `multiway_solver.py` | 2,344 | Three-player (and two-player) postflop solver | `MultiwaySolver` and its solve helpers | advisor, mw_library, mwcore (lazy) | lazy / warm | numpy |
| `flop_library.py` | 1,350 | Precomputed HU flop solutions | `FlopLibrary`, `LibrarySolution`, `default_library`, `DIR`, `SPOTS`, `SPOT_FLOPS`, `encode/decode`, `encode_turns/decode_turns`, `pack`, `spot_ranges`, `flop_report`, `build_report` | advisor (lazy), mw_library, native (top), flop_approx, runouts (lazy) | startup | numpy, zlib |
| `preflop.py` | 1,124 | Chart-based preflop strategy, 6-max 100bb, no limps | `SEATS` and chart lookups | advisor (top); many (lazy) | startup | none |
| `core.py` | 1,099 | Compiled CFR core loader (`gtocore.c`) | `build_native`, `_Native` (ctypes), `_Wasm` (`js.gtoCore`) | solver (lazy), native, server (top) | startup | ctypes, numpy, `js` (Pyodide) |
| `pf_game.py` | 838 | Full preflop game (2-6 players) and its equilibrium over 169 classes | game and equilibrium functions | advisor, pf_study (top) | lazy / warm | numpy |
| `flop_approx.py` | 806 | Approximate answers for flops the library does not store | `correction_z` and approx answer | advisor, mw_library (lazy) | lazy | numpy |
| `pf_equity.py` | 780 | *Generated* (build_preflop_equity): all-in preflop equity table | data | pf_classes (lazy) | warm | none |
| `exploit.py` | 689 | Exploit mode: pool-like opponents, best response | pool model | advisor (lazy) | lazy / warm | numpy |
| `pf_study.py` | 598 | Preflop solves for Study, browsed node by node | study API; reads `pf/*.bin` through `js.siteFetch` (`pf_study.py:271`) | advisor (lazy) | lazy | `js` |
| `icm.py` | 591 | Tournament prize equity (Malmuth-Harville ICM) | ICM functions | advisor (lazy) | warm | numpy |
| `mw_library.py` | 582 | Precomputed 3-way flop solutions | `MWLibrary`, `default_library`, `INDEX`, `STORED` | advisor (lazy), native (top) | advisors setup | numpy |
| `mwcore.py` | 535 | Multiway C core loader (`mwcore.c`) | `_Native` / `_Wasm` (`js.mwCore`) | multiway_solver (lazy) | advisors setup | ctypes, numpy, `js` |
| `pf_format_data.py` | 487 | *Generated* (build_pf_formats): charts for other games | data | pf_formats (lazy) | lazy | none |
| `pf_formats.py` | 297 | Preflop charts for other depths, antes, straddle, 7-9 handed, HU | format lookups | advisor (lazy) | warm | none |
| `pf_solve.py` | 288 | Preflop subgame solver (3-bet pot HU, down to 5-bet jam) | subgame solve | pf_game (lazy) | warm | numpy |
| `breakdown.py` | 286 | Breakdown and Equity views, computed on request | breakdown views | advisor, flop_approx (lazy) | warm | numpy, treys |
| `off_tree.py` | 208 | Answers for bet/raise sizes the stored tree lacks | off-tree mapping | advisor (lazy) | lazy | numpy |
| `pf_libvals.py` | 177 (86 KB) | *Generated* (pf_library_values): per-class flop values from the library | data | pf_game (lazy) | warm | none |
| `server.py` | 160 | Tiny HTTP endpoint (§2.5) | `main` | none | native only | stdlib |
| `runouts.py` | 156 | Turn and river reports for Study | runout report | advisor (lazy) | lazy | numpy |
| `pf_classes.py` | 153 | 169 preflop classes; push/fold ranges | `CLASSES`, push/fold | advisor, pf_game, pf_study, pf_solve, pf_formats | startup | numpy |
| `evaluator.py` | 146 | Vectorised 7-card evaluator | evaluator functions | solver, multiway_solver, exploit (top); others (lazy) | startup | numpy, treys |
| `native.py` | 145 | Native solve settings (§2.6) | `SPEEDS`, `ROOT_SIZES`, `config`, `advisor`, `advisors` | cli, server | native only | stdlib (sets BLAS env vars) |
| `cli.py` | 134 | Manual-entry CLI (§2.7) | `main`, `parse_actions`, `parse_bounties` | flop_library, mw_library (lazy) | native only | stdlib |
| `ranges.py` | 128 | Range text to 1326-weight numpy vector | parsing | advisor | startup | numpy |
| `flop_approx_model.py` | 118 | *Generated* (train_flop_correction) | data | flop_approx (lazy) | lazy | none |
| `routes.py` | 112 | Page URLs, one per view; writes per-route copies | `page_for`, `python -m gto.routes <site>` | server | build only | stdlib |
| `cards.py` | 66 | Cards as ints 0..51 (rank = c//4, suit = c%4) | parse/format | most modules | startup | none |
| `pf_eqr.py` | 50 (34 KB) | *Generated* (pf_equilibrium): preflop equity realization | data | pf_game (lazy) | warm | none |
| `pf_realize.py` | 22 (95 KB) | *Generated* (build_realization) | data | pf_solve (lazy) | warm | none |
| `pf_realize_model.py` | 7 | *Generated* (fit_realization) | data | pf_solve (lazy) | warm | none |
| `pf_game_data.py` | 3 | *Generated* (build_three_way) | data | pf_game (lazy) | lazy | none |
| `__init__.py` | 1 | "Local GTO advisor for a private poker sandbox (fake money, bots only)." | none | none | n/a | none |

External dependencies are only **numpy**, **treys** and **`js`** (the Pyodide FFI). Everything else is stdlib. [V] (AST import scan.)

### 2.2 Import closures: startup vs lazy ([V] static AST analysis)

```
browser first answer: worker.js runPython("import gto.advisor, gto.solver, gto.flop_library")
  closure = {advisor, cards, core, evaluator, flop_library, pf_classes, preflop, ranges, solver}
  + advisors setup                          = + {mw_library, mwcore}
native (cli/server)                         = same + {native}
must NOT load at startup (tests/test_bundle.py LAZY list):
  multiway_solver, pf_game, pf_study, pf_game_data, pf_eqr, pf_solve, pf_realize,
  pf_realize_model, breakdown, exploit, native, cli, server
idle warm-up (advisor.py:1073 WARM_IMPORTS, loaded by warm_step via importlib, advisor.py:1097):
  multiway_solver, pf_formats, pf_equity, pf_game, pf_eqr, pf_realize, pf_libvals,
  pf_solve, breakdown, exploit, icm
```

Top-level vs lazy `gto` imports per module:

| Module | Top-level | Lazy (inside functions) |
|---|---|---|
| advisor | cards, pf_classes, preflop, ranges, solver | breakdown, evaluator, exploit, flop_approx, flop_library, icm, multiway_solver, mw_library, off_tree, pf_formats, pf_game, pf_study, runouts |
| solver | cards, core, evaluator | none |
| core / mwcore | none | solver / multiway_solver; `js` |
| flop_library | cards, solver | advisor, cli, evaluator, preflop |
| mw_library | cards, flop_library | advisor, cli, flop_approx, multiway_solver, preflop, solver |
| multiway_solver | cards, evaluator | mwcore |
| pf_game | pf_classes | advisor, pf_eqr, pf_game_data, pf_libvals, pf_solve |
| pf_study | pf_classes, pf_game | advisor, preflop; `js.siteFetch` |
| native | advisor, core, flop_library, mw_library, solver | none |
| server | advisor, core, native, routes, solver | none |
| cli | native | preflop |

**Implication [I].** Startup latency depends on keeping this lazy discipline. `tests/test_bundle.py` enforces it, so Lizard should keep that test in CI unchanged.

### 2.3 The Advisor contract (`gto/advisor.py`)

**[V] Lifecycle.**
- The module docstring is at `advisor.py:1-17`. `class Advisor` starts at `advisor.py:2859`.
- Constructor: `Advisor(cfg=None, time_budget=4.0, prior_budget=2.0, prior_smoothing=0.15, ...)`. Other tunables include:
  - `cache_mb=CACHE_MB` (1000) and `max_cells=MAX_CELLS` (24,000,000);
  - `hu_settled`, `expl_target`;
  - `library`, `mw_library`;
  - `first_look`, `instant_sources`.

**[V] Public methods.**

| Method | Line | Returns |
|---|---:|---|
| `advise(state)` | 2981 | full answer |
| `instant(state)` | 3042 | library or chart answer only |
| `progress()` | 3079 | `{"partial"}`, `{"result"}` or `None` |
| `triage(state)` | 3110 | source and confidence |
| `presolve(state)` | 3246 | |
| `prefetch(state)` | 3275 | |
| `study(state)` | 3320 | |
| `play(state, seat, hole, seed)` | 6461 | bot move |

The internal path is `_advise` (3700) → `_advise_at` (3931) → `_preflop` / `_postflop` (4679).

**[V] Concurrency.**
- The Advisor is **stateful and not thread-safe.** `_advise_at` mutates `time_budget`, `cfg` and related fields per request and restores them in a `finally`.
- `server.py` serializes calls with a class-level `threading.Lock`.
- Cancellation goes through `adv.should_stop`: a `threading.Event` natively, a SharedArrayBuffer flag in the worker.

**[V] Errors.** The result is `{"error": str}`. `advise` has a catch-all, `_fallback`, which re-answers with betting rules and adds `fallback_reason` and `fallback_where`.

#### Request (all JSON)

| Field | Type / values | Notes |
|---|---|---|
| `players` | int 2-9 | default 6 |
| `hero` | seat name | `preflop.SEATS`: UTG/HJ/CO/BTN/SB/BB at 6-max |
| `hole` | str | `"AhKd"` |
| `board` | str | 0, 3, 4 or 5 cards, `"Kd7s2c"` |
| `stack` | number | effective, in bb units of `bb` |
| `stacks` | {seat: number} | per-seat |
| `bb` | number | default 1. River example uses 0.02 |
| `ante` | number | |
| `straddle` | bool | |
| `rake` | number | 0-0.25 |
| `rake_cap` | number or null | |
| `preflop` / `flop` / `turn` / `river` | list of `{pos, action, amount?, to?}` | `action` ∈ fold, check, call, bet (`amount`), raise (`to`), all-in |
| `budget` | number (s) | clamped 0.5-120 (`advisor.py:3954-3957`) |
| `prior_budget` | number (s) | clamped 0.3-30 |
| `quick` | bool | |
| `speed` | `"fast"` or `"accurate"` | read by worker/server to pick the advisor, not by Advisor |
| `payouts` | list or `"50 30 20"` | tournament |
| `field` | list or `{players, chips}` | tournament |
| `bounties` | `{format, seats or envelope, field, pool, left}` | |
| `tournament` | bool | |
| `sizes` | `{flop:[%], turn, river, raise}` | MAX_SIZES 3 (Study 5) |
| `ranges` | {seat: range text} | override |
| `optimize_sizes` | bool | |
| `locks` | node locks | |
| `opponents` | `"pool"` | exploit mode |
| `jam` | bool | |
| `study` | bool | Study mode. `STUDY_DROPS` (2855) removes hero, hole, opponents, locks, jam, library_only, optimize_sizes |
| `triage` | bool | |
| `library_only` | bool | |
| `breakdown` | bool | |
| `one_size` | `"all"`, `"full"`, `"list"` or a size | Simple view |
| `runouts` | bool or `"held"` | |
| `preflop_solve` | bool, `{run: s}`, `{export: true}` or `{load: blob, iterations}` | |
| `pf_sizes` | `{open, sb_open, ip_3bet, blind_3bet, four_x}` | `pf_study.py:205` |

A real payload the page sends ([V], `tests/js/solver_state.test.js`):

```json
{"players":6,"hero":"BTN","hole":"AhKh","board":"Kd7s2c","stack":100,
 "preflop":[{"pos":"UTG","action":"fold"},{"pos":"HJ","action":"fold"},{"pos":"CO","action":"fold"},
            {"pos":"BTN","action":"raise","to":2.5},{"pos":"SB","action":"fold"},{"pos":"BB","action":"call"}],
 "flop":[{"pos":"BB","action":"check"},{"pos":"BTN","action":"bet","amount":2},
         {"pos":"BB","action":"raise","to":7},{"pos":"BTN","action":"all-in"}],
 "turn":[],"river":[],"budget":8,"prior_budget":3,"speed":"fast"}
```

`examples/flop.json` (hero BTN AhQd on Qs8d3c, 100bb, BTN opens 2.5, BB calls and checks) and `examples/river.json` (hero BB Jh9h on Kh7h2cTd5s, `bb` 0.02) are runnable CLI examples. [V]

#### Response

Heads-up postflop ([V] `advisor.py:5146-5172`):

```
{ street, hero, villain, position: "OOP"|"IP", players, hand, board,
  pot_bb, to_call_bb, stack_bb,
  actions: [{action, freq, ev_bb, amount_bb, rough_ev?, gto_freq?}],
  recommended, sampled,
  grid: {actions: [names], cells: {"AKs": {w, f: [freq per action]}, ...}},   // strategy_grid, advisor.py:8492
  range_action_freq, hero_range_combos, villain_range_combos,
  villain_range (text, <=400 chars), villain_grid,
  breakdown?,
  solver: {iterations, solve_seconds, nodes, active_combos, tree_actions,
           exploitability_pct, cells?, approximate?, target_pct?},
  widened, off_solution?,
  precomputed?: {spot, label, board, iterations, exploitability_pct, same_tree, borrowed?},  // flop_library.py:1045
  locked?, notes, seconds }
```

Other response shapes:
- **Preflop** (`advisor.py:4103`): `{street:"preflop", hero, hand, players, actions, recommended, sampled, pot_bb, to_call_bb, grid, notes, seconds}`.
- **3-way:** adds `multiway: true, solved, opponents, opponent_range_combos`, and `position: "k of 3 to act"`.
- **Triage:** adds `triage: {source: chart|library|approx|quick|rules, confidence: high|medium|low, label}`.
- **Tournament:** adds a `tournament` key.
- **Control:** `{cancelled: true}` and `{skipped}`.
- **Study:** `node`, `deal`, `over`, `runouts`, `pf_unsolved`, `pf_progress`, `pf_export`.
- **`play()`:** `{pos, action, to, name, freq, street, actions}`.

**[I] Recommendation.** Define this contract once as TypeScript types plus a JSON Schema in Lizard (for example `packages/engine-contract`). Generate fixtures from `tests/data/page_states.json` (428 real `{hand, state, page}` records, [V]) and validate both hosts against them. The Python side stays as is.

### 2.4 Browser host: `gto/static/worker.js` (433 lines) [V]

- **Pyodide:** `PYODIDE = "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/"` (`worker.js:2`). The numpy wheel is prefetched.
- **Query parameters:**
  - `VERSION` comes from `?v=` (`worker.js:11`);
  - `LIBRARY` comes from `?lib=`, default `"flop_library/"` (`worker.js:12`, "the page's LIB_BASE").
- **Bundle:** `solver.zip?v=`, cached in the Cache API store `"gto-solver"` (`worker.js:17`).
- **Library fetch:** `self.libFetch` is a **synchronous XHR**. It keeps an LRU of 64 entries, and `libAhead` loads `index.json` and `mw_index.json` up front. `self.siteFetch` serves `pf/*.bin`.
- **Core:** `loadCore` picks `core-mt.wasm` / `mwcore-mt.wasm` when `crossOriginIsolated`, with `HELPERS = min(7, cores-1)` (`worker.js:107`). Otherwise it uses `core.wasm`; otherwise none, which means numpy.
- **Advisors:** builds a `fast` and an `accurate` advisor (configs duplicated from `native.py`, see §2.6). Python-side helpers: `answer`, `early`, `progress`, `presolve`. `warm_step` runs while idle.
- **Messages in:** `ping`, `cancel`, `stop` (SharedArrayBuffer), `prefetch`, `{id, state, play, early, presolve}`.
- **Replies out:** `{id, result | partial | error}`.
- **The page** creates it with `new Worker("worker.js?v=" + WORKER_VERSION + "&lib=" + encodeURIComponent(LIB_BASE))` (`index.html:1119`).

### 2.5 Native host: `gto/server.py` (160 lines) [V]

- **Server:** a `ThreadingHTTPServer`, but solves run one at a time under a class-level `threading.Lock`.
- **Endpoints:**

  | Method | Path | Behavior |
  |---|---|---|
  | POST | `/advise` | body = request above, reply = response |
  | POST | `/play` | `{state, seat, hole, seed?}` |
  | POST | `/cancel` | sets the `threading.Event` behind `adv.should_stop` |
  | GET | `/health*` | `{"ok": true}`. The static `health.json` is `{"ok": false}`, and `index.html:1080` uses that difference to detect server mode |
  | GET | `/flop_library/*.json\|.bin` | realpath traversal check, `Cache-Control: no-store` |
  | GET | route pages | through `routes.page_for`, with 301 redirects that add a trailing slash |
  | GET | a fixed list of `/*.js` | |

  It does not serve `solver.zip`, `pf/` or the wasm files, so server mode always uses the native core.
- **CORS:** `Access-Control-Allow-Origin: *` on every JSON reply, `Allow-Headers: Content-Type`, `Allow-Methods: POST, GET, OPTIONS`. OPTIONS returns 204.
- **Errors:** bad JSON returns 400; an exception returns 500 `{"error": repr}`.
- **Flags:** `--host 127.0.0.1 --port 8765 --budget --prior-budget --depth 2 --open --threads min(8, cpu)`. Advisors come from `native.advisors()`, and `state["speed"]` picks one.
- **[I]** Wildcard CORS is acceptable for a localhost dev API only. If Lizard ever exposes this beyond localhost, restrict origins and add auth.

### 2.6 `gto/native.py` (145 lines) [V]

- **BLAS:** sets `VECLIB_MAXIMUM_THREADS`, `OPENBLAS_NUM_THREADS`, `OMP_NUM_THREADS` and `MKL_NUM_THREADS` to `1` at import.
- **`SPEEDS`:**
  - `fast`: 2.5 s budget / 2.5 s prior; turn sizes 33/75/125, river 33/125.
  - `accurate`: 30 s / 12 s; river 33/75/125.
- **Other constants:** `ROOT_SIZES` (river 33/75/125/250), `FAST_SPR_SIZES`, `THREADED_FAST = 4`, `MW_FAST_BUDGET = 5.0`.
- **API:** `config(speed, depth)`, `advisor(speed, depth, budget, prior_budget, library=True)`, and `advisors()`, which returns two advisors sharing one `_held` cache.
- **Drift risk (verified):** `native.py`'s own docstring says "the browser's are in static/worker.js". The browser values differ: the page sets a fast budget of 8 s and accurate of 60 s. **[I]** Lizard should hold one canonical speed-profile JSON and have both hosts read it, or at least add a test that compares them.

### 2.7 `gto/cli.py` (134 lines) [V]

- **Import order:** it imports `from .native import advisor` first, so BLAS is pinned to one thread before numpy loads.
- **Action tokens** (`parse_actions`): `f`, `x`, `c`, `ai`, `r<to>`, `b<amount>`.
- **Flags:** `--hero --hole --board --preflop --flop --turn --river --stack --ante --straddle --rake --rake-cap --players --stacks --payouts --bounties --speed --budget --prior-budget --depth --json`.

### 2.8 `gto/solver.py` public API (2,505 lines) [V]

```python
solve(board, r_oop, r_ip, pot, stack, bets=(0, 0), to_act=0, n_raises=0, cfg=None,
      time_budget=3.0, max_iters=1000, dead=(), should_stop=None, warm=None, reserve=None,
      horizon=None, max_cells=None, max_per=None, seed=None) -> Solution      # solver.py:2424
```

- **Classes:** `Config` (dataclass, `solver.py:77`), `Ctx`, `TreeBuilder` (1016), `Solver` (1416), `Solution` (2249).
- **Exceptions:** `Cancelled`, `TooSlow`, `TreeTooBig`.
- **Helpers:** `warm_start`, `expand`, `tree_cells`, `match_action` (2474).
- **Conventions:** player 0 is OOP, units are bb, and BLAS is not used under emscripten (`NO_BLAS`).

### 2.9 `gto/flop_library.py` (1,350 lines) [V]

- **Constants:** `FORMAT = 2`, `MODEL_VERSION = 1`, `MAGIC = b"GTOFL3"` (v1 was `GTOFL2`), `Q = 100`, `STORE_LINE = 0.05`, `EV_STEP = 0.01`, `RIVER_DEALT = 64`, `TURN_MAGIC = b"GTOTN1"`.
- **Spot lists:**
  - `SPOTS`: 19 entries. `lp_sb_bb` is `FORMAT_ONLY`.
  - `SPOT_FLOPS`: also covers `srp_sb_bb_2max` and `lp_sb_bb_2max` at 552 flops.
  - `REP_FLOPS`: 184.
- **`FlopLibrary(fetch)`** (`flop_library.py:1051`) takes an injected `fetch(path) -> bytes` (a directory read natively, `self.libFetch` in the browser). Methods:
  - `from_dir`, `index`, `tree`, `entry_tree`, `entry`, `turns`;
  - `spot(fp0, fp1, pot, stack)`;
  - `solution(full0, full1, board, r0, r1, pot, stack, cfg, borrow, need, unraked) -> LibrarySolution`.
- **Module functions:** `default_library()` reads `DIR = gto/static/flop_library`. Also `pack`, `encode`, `decode`, `encode_turns`, `decode_turns`, `spot_ranges`, `flop_report`, `build_report`.
- **Entry format:** `MAGIC + zlib(<u32 header_len><JSON header><binary body>)`.

### 2.10 `gto/mw_library.py` (582 lines) [V]

- **Constants:** `FORMAT = 1`, `INDEX = "mw_index.json"`, `STORED = [(), ("check",), ("check", "check")]`.
- **`MWLibrary`:** `from_dir`, `index`, `spot(fps, pot, stack)`, `borrow`, `stand_in`, `entry`, `solution`, `near`. Plus `default_library()`.

### 2.11 Static UI (`gto/static/`) [V]

`index.html` (2,882 lines, 240 KB) holds the page shell, the engine, the advice panel, routing and version constants. The other scripts load lazily:

| File | Lines | Role (header comment) |
|---|---:|---|
| `study.js` | 1,357 | Study: solution browser, node by node |
| `session.js` | 1,087 | Session analyzer over many hand histories |
| `practice.js` | 1,062 | Practice vs GTO bots, driving the page's engine |
| `multitable.js` | 849 | 2-4 table practice |
| `store.js` | 472 | All local storage in one shape, "ready to be synced to an account later" |
| `hands.js` | 468 | My hands |
| `drills.js` | 465 | Precomputed-spot decision drills |
| `writeup.js` | 449 | Write up a played hand |
| `worker.js` | 433 | Pyodide host (§2.4) |
| `help.js` | 349 | Getting started, About & accuracy, Glossary, Changelog, Fair play |
| `reports.js` | 314 | Flop reports (`<spot>/report.json`) |
| `simple.js` | 288 | One-size "Simple" view |
| `hh.js` | 281 | Hand-history import (Stars, GG/N8, 888, party, Winamax, WPN/ACR, Ignition/Bovada, iPoker) |
| `runouts.js` | 200 | Turn/river reports |
| `breakdown.js` | 191 | Breakdown/Equity tabs |
| `sw.js` | 20 | Service worker that adds COOP/COEP for cross-origin isolation (needed by the `-mt` wasm) |
| `health.json` | 1 | `{"ok": false}` |

Routing (`index.html:1027-1028`): `const ROUTES = {practice, drills, reports, session, study, preflop, import, hands, start, about, glossary, changelog, fa…}` and `const SPOT_ROUTES = ["drills", "reports"]`. `routes.py` parses these and writes one copy of the page per route, each with `<base href="../">`. Version constants: `index.html:1004-1016` (`*_VERSION`, stamped by `deploy.sh`). Library base: `index.html:1020` `const LIB_BASE = "flop_library/";`.

---

## 3. C cores: build and load paths [V]

```
core/gtocore.c (HU CFR iterations)          core/mwcore.c (3-way CFR iterations)
        |                                          |
        |-- native: core.build_native(): cc -O3 -shared -fPIC [-framework Accelerate on darwin]
        |      -> core/build/gtocore-<sha12>.so   (built lazily at first use; cached; gitignored)
        |      -> loaded by core._Native via ctypes  (mwcore._Native likewise)
        |
        `-- wasm: scripts/build_core.py (clang --target=wasm32, Homebrew llvm+lld or $WASM_CC)
               -O3 -msimd128 -nostdlib -DCORE_SOURCE=<sha> -Wl,--no-entry -Wl,--strip-all
               -mt variants: + -matomics -mbulk-memory --import-memory --shared-memory
                               --max-memory=2GB --export=__stack_pointer   (mwcore: + -mbulk-memory always)
               -> gto/static/{core,core-mt,mwcore,mwcore-mt}.wasm
               -> loaded by worker.js loadCore() into js.gtoCore / js.mwCore; wrapped by core._Wasm / mwcore._Wasm
fallback: numpy path in solver.py / multiway_solver.py
  (GTO_CORE=0 / GTO_MWCORE=0 force it; core retries RESTARTS = 3 before falling back)
```

| Artifact | Size (B) | Embedded source sha1 | Matches source? |
|---|---:|---|---|
| `gto/static/core.wasm` | 73,780 | `ebdf06ac71d2d016914e8a6d70c6530ed730e437` | yes (`gtocore.c`) |
| `gto/static/core-mt.wasm` | 96,298 | same | yes |
| `gto/static/mwcore.wasm` | 126,560 | `d50de123beb478e7f735db0646ea47264a10202a` | yes (`mwcore.c`) |
| `gto/static/mwcore-mt.wasm` | 132,971 | same | yes |
| `core/build/gtocore-ebdf06ac71d2.so` | 168,112 | (name = sha prefix) | yes |
| `core/build/mwcore-d50de123beb4.so` | 150,640 | (name = sha prefix) | yes |

Details [V]:
- Headers: `core.py` uses `MAGIC = 0x67746f31` and `ARENA_MAX` 1 GB. `mwcore.py` uses `MAGIC = 0x6d776333` and `MAX_K = 32`.
- Environment variables: `GTO_THREADS` sets the native thread count. `GTO_CORE=0` and `GTO_MWCORE=0` disable the cores.
- The C sources use no libc for wasm and include pthread/mman for native builds.
- Exports: `core_run`, `core_eval`, `core_threads`, `core_table(s)`, `core_helper`, `core_stack`, and others; `mw_run`, `mw_eval`, `mw_threads`, and others.
- `scripts/build_bundle.py` packages a **deterministic** `solver.zip` (timestamps fixed to 2020-01-01): all `gto/*.py`, the four wasm files, `treys/*.py` and `treys/LICENSE`.
- The README reports `solver.zip` at about **290 KB** ([R], startup table around README line 1994).

Measured effect ([R], README "compiled core" table around line 1819+):
- The core gives a turn solve **5.5-6.7x the iterations** of numpy.
- Example: a turn reached from a library flop at Fast runs **42 iterations / 2.19% exploitability** in numpy vs **282 / 0.07%** with the core.

**[I] Lizard build.** The wasm files and `.so` files are reproducible from source, and the sha check makes staleness visible. Lizard should:
- treat the checked-in wasm as build outputs that carry the source sha;
- add a CI check that the embedded sha equals the `sha1` of the C sources;
- rebuild only when a C file changes (it needs clang with wasm32 and lld).

---

## 4. Scripts (64 files, 14,774 lines) [V]

| Category | Scripts | Needed by the Lizard build? |
|---|---|---|
| **Build (required)** | `build_bundle.py` (`solver.zip`), `build_core.py` (wasm), and `python -m gto.routes <site>` (per-route pages, a module rather than a script) | **Yes.** `routes` only until the React router replaces it |
| **LEGACY deploy, never run from Lizard** | `deploy.sh`: `gh repo clone michaellhan/michaellhan.github.io` (`deploy.sh:67`), runs `deploy_library.sh` (`:84`), rewrites `LIB_BASE` to `../gto-solver-library/` with sed (`:85-87`), stamps `*_VERSION`, writes routes, commits and pushes. `deploy_library.sh`: **force-pushes** the library to the PUBLIC repo `michaellhan/gto-solver-library` | **No.** Both are guarded (`deploy.sh:8`, `deploy_library.sh:15`). Note that `DRY_RUN=1` passes the `deploy.sh` guard and runs the **full test suite plus the sanity sweep**, which is heavy CPU |
| Library builds | `build_flop_library.py` (`--out` defaults to `fl.DIR`), `build_mw_library.py` | Only to extend the library, offline, run for hours or days. **Never against the running HU builds' folders** |
| Preflop data builds | `build_pf_formats`, `build_pf_study`, `build_preflop_equity`, `build_realization`, `build_three_way`, `fit_realization`, `train_flop_correction`, `pf_equilibrium`, `pf_library_values`, `pf_depth_values`, `pf_solve_library`, `pf_three_way`, `pf_subgames`, `pf_fidelity`, `pf_compare`, `pf_study_convergence` | No. They regenerate checked-in data modules; keep them as provenance |
| Benchmarks | all 26 `bench_*.py`, plus `bench_browser.mjs`, `bench_session.mjs`, `pyodide_run.mjs`. `bench_postflop_solver.py` needs the excluded `pfbench` | No (research). Keep them for regression measurement |
| Calibrate / compare | `calibrate_multiway`, `calibrate_pf_solve`, `calibrate_pool`, `compare_multiway`, `compare_mw_library`, `score_multiway4` | No |
| Reference | `preflop_reference`, `preflop_format_reference`, `turn_river_reference`, `turn_store_probe` | No (they produce test reference data) |
| Sanity / coverage | `sanity_sweep.py` (used by deploy's quick sweep), `preflop_sweep`, `coverage_fuzz` (writes `.work/coverage`), `flop_library_coverage`, `instant_coverage` | Optional pre-release gates |

Data modules and the scripts that generate them [V]:

| Data module | Generator |
|---|---|
| `pf_equity` | `build_preflop_equity` |
| `pf_eqr` | `pf_equilibrium` |
| `pf_format_data` | `build_pf_formats` |
| `pf_game_data` | `build_three_way` |
| `pf_libvals` | `pf_library_values` |
| `pf_realize` | `build_realization` |
| `pf_realize_model` | `fit_realization` |
| `flop_approx_model` | `train_flop_correction` |
| `static/pf/6max_100bb.bin` (83,491 B), `6max_100bb_r5c3.bin` (88,827 B) | `build_pf_study` |

---

## 5. Data assets and the flop library

### 5.1 Inventory ([V] `find` / `stat` over `gto/static/flop_library/`)

| Kind | Files | Bytes | Avg |
|---|---:|---:|---:|
| HU flop entries `<spot>/<flop>.bin` | 25,575 | 72.65 MB | 2.8 KB |
| HU turn files `<spot>/<flop>.turn.bin` | 12,978 | 167.57 MB | 12.9 KB |
| 3-way entries `mw_*/<flop>.bin` | 740 | 4.53 MB | 6.1 KB |
| `report.json` | 18 | 7.03 MB | 391 KB |
| `ranges.json` | 18 | 0.14 MB | n/a |
| `index.json` | 1 | 732,218 B | n/a |
| `mw_index.json` | 1 | 17,419 B | n/a |
| **Total** | **39,331** | **252.67 MB apparent (315 MB du)** | n/a |

[V] Upstream **tracks** the library in git: 39,331 files, about 241 MB of blobs at `9b907bd6`. [V] `tests/test_flop_library.py:842` asserts that the HU **entry** `.bin` total (turn files excluded) is under 150e6 B. Each entry must be under 200,000 B (`:835`). The current entry total is 72.65 MB.

Per spot [V]:

| Spot | Flop entries | Turn files | du |
|---|---:|---:|---:|
| `srp_btn_bb` | 1,755 | 1,755 | 45M |
| `3bp_bb_btn` | 1,755 | 1,203 | 35M |
| `3bp_bb_co` | 1,755 | 1,698 | 33M |
| `3bp_bb_sb` | 1,755 | 1,755 | 30M |
| `3bp_sb_btn` | 1,755 | 1,203 | 29M |
| `3bp_sb_co` | 1,755 | 1,203 | 26M |
| `3bp_co_hj` | 1,755 | 1,755 | 23M |
| `3bp_btn_co` | 1,755 | 1,203 | 21M |
| `3bp_hj_utg` | 1,755 | 1,203 | 18M |
| `srp_sb_bb` | 1,755 | 0 | 13M |
| `srp_co_bb` / `srp_hj_bb` / `srp_utg_bb` | 1,755 each | 0 | 7.9M / 7.8M / 7.5M |
| `srp_btn_sb`, `srp_co_sb`, `srp_hj_co`, `srp_utg_btn`, `srp_utg_hj` | 552 each | 0 | 2.3-2.8M |
| `mw_btn_sb_bb`, `mw_co_btn_bb`, `mw_hj_ip_bb`, `mw_utg_btn_bb` | 185 each | 0 | 1.4M each |

### 5.2 File formats [V]

**`index.json`:**

```
{ format: 2,
  tree:  { sizes: {flop_bet:[0.33,0.75], flop_raise:[0.5], bet_turn:[0.75], bet_river:[0.75],
                   raise_turn:[0.75], raise_river:[0.75], max_raises:2, allin_spr:2.5, depth:2, rake:null},
           model: {river_play:true, turn_classes:true, flop_leaf_rivers:4, version:1} },
  spots: [ 18 x { id, label, line, seats:[oop, ip], fp:[16-hex, 16-hex], pot, stack,
                  tree (with model.river_dealt: 64), flops:{ "<flop>": "<10-hex hash>" },
                  turns: true | <count>, report: <hash>, old_tree?, old?: [flops] } ] }
```

- Examples: `srp_btn_bb` has pot 5.5 and stack 97.5; `3bp_bb_btn` has pot 20.5 and stack 90.
- Spots with an `old_tree` / `old` list (older entries still served): `srp_co_bb`, `srp_sb_bb`, `srp_hj_bb`, `srp_utg_bb` and the five 552-flop spots.

**`mw_index.json`:**

```
{ format: 1,
  tree: { bet:{flop:[0.33,0.75], turn:0.5, river:0.5}, raise_frac:0.75, max_raises:2, allin_spr:1.5,
          later:"buckets", buckets:16, classes:true, bucket_river_step:1, exact:true, rake:null, version:1 },
  spots: [ 4 x { id, label, line, seats:[3], fp:[3], pot: 8.0 | 7.5, stack: 97.5, flops:{185} } ] }
```

**Other files:**
- `report.json`: `{format:1, id, label, line, seats, pot, stack, nodes:{path:[names]}, flops:[{f, n:{path:[freqs]}, h:{path:hand}, ev:[2], eq:[2], hash, w}]}`.
- `ranges.json`: `{format:1, id, fp, w:[2 x 1326 ints in 1/10000]}`.
- Entry header, sample `srp_btn_bb/Kc7d6c.bin` (4,699 B):

  ```
  {spot, fp, pot:5.5, stack:97.5, seats:["BB","BTN"], board, iters:300, seconds:95.9, expl:0.1089,
   format:2, tree:"83dfa5b8d830", q:100, ev:[0.055, 32, 1.04],
   nodes:[{path, player, names, fold0, freqs, combos}]}
  ```

  It has 4 nodes: `[]`, `[check]`, `[check, bet 75%]` and `[check, bet 75%, raise to 11]`.
- Turn-file header (sample, 18,589 B): `{format:1, board, entry:"80a0c978628d", q:20, reach:0.005, classes:[[card, cards]...], lines:[{path, share, pot, nodes:[{at, player, names}]}]}`.

### 5.3 Heads-up (2-max) builds in progress (read-only observation) [V]

| Build | Spot | Progress | Index | Game |
|---|---|---|---|---|
| hu-lib | `srp_sb_bb_2max` | log 287/474, about 534 min left | 733 files, 11M; index lists 358 flops | `{players:2, stack:100, ante:0, straddle:false}`, pot 6.0, stack 97.0 |
| hu-lp-lib | `lp_sb_bb_2max` | log 23/424, about 780 min left | 305 files, 4.7M; 148 flops indexed | pot 2.0, stack 99.0 |

Both produce `format: 2` indexes with turn files. **[I]** When they finish, merge them into Lizard's library by a copy plus an index merge, without touching the build directories while they run. `SPOT_FLOPS` already lists both spots at 552 flops, but the build logs show 474 and 424 targets. Reconcile this at merge time.

### 5.4 Other data [V]

- `gto/static/pf/*.bin`: Study's stored preflop solves (§4).
- `tests/data/`:
  - `flop_v1_3bp_btn_co_Qc9c2d.bin` (a v1-format entry for compatibility);
  - `hh/` (23 hand histories across 888, ACR, GG, Ignition, iPoker XML, Party, Stars and Winamax; 92K);
  - `page_states.json` (428 records);
  - `pf_realize_{a,b}.py`, `pf_realize_model_{a,b}.py`;
  - `turn_river_refs.json` (13 spots), `turn_river_ref_values.npz`, `turn_river_spots.npz`.
- `tests/preflop_refs.py`: published reference spots.

### 5.5 Coverage and speed numbers to quote ([R], README)

- **Library reach:**
  - 36% of hands go heads-up to the flop, and the library answers 83.6% of their flop decisions (README around line 4195).
  - Of a session's decisions, 83.6% are precomputed: heads-up flops 74.7%, 3-way flops 5.2% (around line 2007).
- **Worker startup:**
  - First answer in 1.32-1.38 s on a first visit and 1.24 s on a repeat visit.
  - A first visit downloads about 25 MB (Pyodide 13.7 MB, numpy 12.0 MB) (around lines 1994-2001).
- **3-way library** (around lines 4393-4416):
  - entries are 3.8-7.6 KB, 4.53 MB for the four spots;
  - they solve to 0.06-0.08% of the pot from equilibrium;
  - the browser answers in 0.49-0.57 s;
  - the four spots cover 63.8% of 3-way flops, about 8.2% of 3-way first decisions.
- **Format-2 recode:** 14.06 MB went to 8.77 MB (around line 4221).
- **Known limit:** the preflop charts are hand-written, with a mean error of 0.96 points over 26 published spots.
- **[V] Stale README figures:** some sections still say "9327 entries" and "48.31 MB". The library now holds 25,575 HU entries. Quote README numbers with their section date, or re-measure them.

---

## 6. Tests

### 6.1 Python: 42 modules, 678 tests [V] (counted with `grep -c "def test_"`; not run)

| Module | Tests | Notes |
|---|---:|---|
| `test_gto` | 169 | **5 `@expectedFailure`** at lines 2797, 2811, 2834, 2909, 2932 (`pairs_in_order`, `stable_across_flop_halves`, `close_to_charts`); 1 runtime `skipTest`; 24 classes |
| `test_multiway_solver` | 61 | 11 gated by `_core_on` (TestCore 10 + 1) |
| `test_instant_near` | 42 | |
| `test_core` | 34 | 32 gated by `skipUnless(ON, "no C compiler")` (TestProgram 12, TestSameAsNumpy 5, TestTables 3, TestThreads 8, TestWindows 4); TestWasm 1 and TestOff 1 always run |
| `test_flop_library` | 24 | 4 "no library built" skips; size asserts at `:835`, `:842` |
| `test_pf_study` | 22 | |
| `test_coverage` | 20 | |
| `test_off_tree`, `test_pf_game` | 18 each | |
| `test_instant_store` | 16 | builds a temporary library |
| `test_icm`, `test_one_size`, `test_study` | 15 each | |
| `test_bounty`, `test_instant`, `test_turn_river` | 13 each | |
| `test_mw_library`, `test_pf_formats`, `test_stacks` | 12 each | |
| `test_breakdown` | 11 | |
| `test_preflop_locks`, `test_settled` | 9 each | |
| `test_instant_mw`, `test_progress` | 8 each | **`test_instant_mw.py:112,200` unguarded**: `ML.default_library()` returns `None` without the library, so tests raise AttributeError instead of skipping |
| `test_bundle`, `test_cfr`, `test_instant_near_turn` | 7 each | `test_bundle` enforces the LAZY list |
| `test_cache`, `test_native`, `test_rake_read`, `test_tree_cap` | 6 each | `test_native` patches iterations (`UNLOADED_TURN_ITERS = 45`) to be load-independent |
| `test_presolve`, `test_rare_resolve`, `test_routes`, `test_study_store` | 5 each | |
| `test_off_solution`, `test_prefetch`, `test_runouts`, `test_study_sizes`, `test_triage` | 4 each | |
| `test_page_states`, `test_rough_ev` | 2 each | |

Library-dependent [V]:
- Guarded with SkipTest when the library is missing: `test_rake_read`, `test_off_tree`, `test_instant_near_turn`, `test_prefetch`, `test_mw_library`.
- Self-contained (temporary libraries): `test_instant_store`, `test_study_store`.
- Other skips cover missing `pf_libvals`, `pf_eqr`, `flop_approx_model` and `pf_format_data` games.
- [I] Many `test_gto` tests build `native.advisor(library=True)`, so their paths and timings change when the library is absent. A clean checkout without the gitignored library will not reproduce upstream's results.

### 6.2 Node: 31 files, 379 tests [V] (`node --test 'tests/js/*.test.js'`, Node 22+, no npm)

- **Largest:** session 31, study 30, practice 28, engine 26, solver_state 19, share 16, hh 14, advanced 14, store 14, drills 13, hands 13, multitable 13, routes 13, presolve 6, and smaller files.
- **Skips:** no skipped tests. Every grep hit for "skip" was string content.
- **Helpers:** `page.js` (vm plus a fake DOM), `idb_shim.js`, `hh_synth.js`.
- **Real wasm:** `core.test.js` and `mwcore.test.js` load the actual wasm modules.
- **Fixtures:** `UPDATE_FIXTURES=1` regenerates `tests/data/page_states.json`.
- **Cloudflare proxy:** `cloudflare/explain-proxy/test/index.test.js` holds 8 separate tests.

**[I] For the React port:** the Node tests drive `index.html` through a fake DOM, so they will not survive a UI rewrite. The parts worth keeping are the **engine, state, hand-history, store and share semantics**. Extract those as pure-logic fixtures (input to expected output) before porting, then re-run them against the new TypeScript modules.

---

## 7. Classification

Governing rule: **do not rewrite working, validated numerical code.**

| Component | Class | Rationale / action |
|---|---|---|
| `solver.py`, `multiway_solver.py` | **REUSE AS-IS** | CFR solvers; the core of the validation |
| `core/gtocore.c`, `core/mwcore.c`, `core.py`, `mwcore.py`, the 4 wasm files | **REUSE AS-IS** | Sha-stamped; native, wasm and numpy fallback all tested |
| `evaluator.py`, `cards.py`, `ranges.py` | **REUSE AS-IS** | |
| `preflop.py`, `pf_classes.py`, `pf_game.py`, `pf_solve.py`, `pf_formats.py`, `pf_study.py` | **REUSE AS-IS** | |
| Generated data modules (`pf_*` data, `flop_approx_model`), `static/pf/*.bin` | **REUSE AS-IS** | Regenerate only through their scripts |
| `icm.py`, `exploit.py`, `flop_approx.py`, `off_tree.py`, `runouts.py`, `breakdown.py` | **REUSE AS-IS** | |
| `flop_library.py`, `mw_library.py` and the library data | **REUSE AS-IS** | Fetch is injected, so hosting can change without code changes |
| `build_bundle.py`, `build_core.py`, `build_flop_library.py`, `build_mw_library.py`, `build_pf_*` | **REUSE AS-IS** | Call them from Lizard's build; do not fork them |
| `advisor.py` (`Advisor`) | **WRAP** | Add a typed TS/JSON-Schema contract (§2.3), validated against `page_states.json`. Keep the Python untouched |
| `static/worker.js` | **WRAP** (then light PORT) | Keep it as the Pyodide host. Expose a typed `EngineClient` (postMessage RPC) to React. Read the speed profiles from shared JSON |
| `server.py` | **WRAP** | Local dev and "desktop power" API with the same contract. Tighten CORS if it is ever exposed |
| `native.py` | **WRAP** | Move SPEEDS to a shared profile file read by both hosts |
| `cli.py` | **REUSE AS-IS** | Developer tool |
| `index.html` and the UI scripts (`study`, `practice`, `session`, `multitable`, `drills`, `reports`, `runouts`, `simple`, `breakdown`, `hands`, `writeup`, `help`) | **PORT (React)** | Re-implement the views; keep behavior through extracted fixtures |
| `store.js`, `hh.js`, the engine logic inside `index.html` | **PORT (logic-first)** | Pure logic, so port it to TS modules with their tests first, then the UI |
| `sw.js` | **PORT / REPLACE** | Keep the COOP/COEP isolation (needed for `-mt` wasm); prefer host-level headers |
| `routes.py` + `<base href="../">` copies | **REPLACE** | React router plus host SPA fallback |
| `deploy.sh`, `deploy_library.sh` | **REPLACE** (never run) | New Lizard deploy and library publish to Lizard-owned hosts |
| `docs/legal/*` (DRAFT), titles, storage names, `michael-han.com` URLs | **REPLACE** | Rebrand (§8.1) |
| `cloudflare/explain-proxy` | **REUSE + reconfigure** | New `ALLOWED_ORIGINS` (`wrangler.toml:9`, `src/proxy.js:26`) and its own KV namespace (do not reuse the id; location around `wrangler.toml:30`) |
| `bench_*`, `calibrate_*`, `compare_*`, `score_multiway4`, reference scripts | **DROP from product** | Keep them in `solver/` as research tooling; not part of the build |
| `scripts/pfbench/` | **DROP** (already excluded, AGPL) | `bench_postflop_solver.py` cannot run; document it |
| `docs/*_research.md`, `README.md` | **REUSE as reference** | Grep only; numbers partly stale |

---

## 8. What must change for Lizard

### 8.1 Paths, base URLs and branding [V locations]

| Item | Where | Change |
|---|---|---|
| Library base | `index.html:1020` `LIB_BASE = "flop_library/"`. The worker reads `?lib=` (`worker.js:12`). Legacy deploy rewrites it to `../gto-solver-library/` (`deploy.sh:85-87`) | Make it a Lizard build-time config (env), pointing at a Lizard-owned library host. The code already supports this through `?lib=` |
| Library dir (native) | `flop_library.DIR = gto/static/flop_library`; `server.py` serves `/flop_library/*` | Keep it for dev. Optionally allow an env override |
| Version stamps | `index.html:1004-1016` `*_VERSION`, stamped by `deploy.sh` | Lizard build: content-hash file names (bundler) plus `solver.zip?v=<hash>` |
| Pyodide CDN | `worker.js:2` (jsDelivr 0.26.4) | Pin the same version. [I] Consider self-hosting for availability and COEP |
| Cross-origin isolation | `sw.js` adds COOP/COEP | Set the headers at the Lizard host; keep the SW as fallback |
| Page title / brand | `<title>GTO Solver`; brand-string counts: `index.html` 7, `preflop.py` 9, `advisor.py` 6, `exploit.py` 4; `gto/__init__.py` docstring | Rebrand UI strings only. Python strings that reach the UI (notes) can be mapped in the adapter rather than edited, to avoid divergence |
| Storage names | IndexedDB `gto-store`, `gto-session`, `gto-pf`; localStorage `gto-*` (`gto-speed`, `gto-anthropic-key`, `gto-explain-own`, `gto-store:<store>`); Cache API `gto-solver` (`store.js:2-21`, `worker.js:17`) | Use a new `lizard-*` namespace. [I] No migration is needed (different origin) |
| Domain references | `README`, `cloudflare/explain-proxy` (`wrangler.toml:9`, `src/proxy.js:26`, `test/index.test.js`), `docs/legal/{privacy,terms}.md`, both deploy scripts, `tests/js/share.test.js:57,145`, `page.js:102`, `hands.test.js:189`, `routes.test.js:198` | Replace them in Lizard's own code and tests. Leave the `solver/` tests untouched (they test the legacy page) |
| "GTO Wizard" mentions | e.g. `breakdown.py` docstring ("GTO Wizard-style"); research citations in README and docs | [I] Keep the research citations. Do not use the name in Lizard UI copy (trademark / positioning) |
| Entry points | Browser: `worker.js` (`import gto.advisor, gto.solver, gto.flop_library`). Native: `python -m gto.server`, `python -m gto.cli` | React app → `EngineClient` → worker.js or server.py. No new Python entry point needed |

### 8.2 Secrets [V]

- No real credentials were found in the snapshot.
- `tests/js/explain.test.js:16` and `tests/js/store.test.js:14` contain obviously fake `sk-ant-…` test keys.
- `cloudflare/explain-proxy/wrangler.toml` (around line 30) holds a KV namespace **id**. It is an identifier, not a secret. Lizard should create its own namespace and not reuse the id.
- The Anthropic key is a wrangler secret and is not in the repo.

### 8.3 Upstream-divergence risk

- **[V]** Upstream is active: the snapshot commit itself landed on 2026-11-03. The upstream working checkout is dirty and shared with other agents. The local `origin/main` ref equals `9b907bd6`, as of its last fetch (I did not fetch).
- **[I] Risks:**
  1. **Silent forks.** Patching numerical code inside `solver/` turns every re-sync into a merge.
  2. **Contract drift.** Upstream may add or rename request/response fields, and Lizard's TS types fall behind.
  3. **Library format drift:** a `FORMAT`, `MODEL_VERSION` or `MAGIC` bump, or tree changes such as `old_tree`.
  4. **Config drift** between `native.py`, `worker.js` and Lizard's profiles.
  5. **Data-module regeneration** changing answers without a code diff.
- **[I] Mitigations:**
  - Keep `solver/` byte-identical to upstream except a declared patch list (today: the two guards).
  - Put all Lizard logic outside `solver/` (adapter, UI, build).
  - Pin the contract with fixture tests (`page_states.json`).
  - Record the library `FORMAT` and `MODEL_VERSION` in the provenance file, and fail the build on a mismatch.

### 8.4 Snapshot and re-sync procedure (proposed) [I]

1. **Create `solver/UPSTREAM.md`** (the guards already cite it):

   ```
   upstream:  github.com/michaellhan/gto-solver
   commit:    9b907bd61a95758c48b1141cfadd854ba2c0eeaa  (2026-11-03 04:17:27 -0500)
   excluded:  CLAUDE.md; scripts/pfbench/** (AGPL)
   local-only (not committed): gto/static/flop_library/ (39,331 files; index.json format 2, mw_index.json format 1)
   local patches:
     - scripts/deploy.sh: LIZARD GUARD (lines 5-10)
     - scripts/deploy_library.sh: LIZARD GUARD (lines 12-17; its comment mentions DRY_RUN but the test at :15 does not check it)
   verify:    file list + sha256 manifest (solver/UPSTREAM.sha256)
   ```

2. **Add root files:**
   - a `.gitignore` with `solver/gto/static/flop_library/`, `solver/core/build/`, `.venv/`, `__pycache__/`;
   - a real `scripts/deploy.sh` for Lizard (the guards point to `../scripts/deploy.sh`);
   - optionally, a check that `solver/` matches the manifest.
3. **Re-sync, always read-only on upstream:**
   - (a) Clone fresh into a scratch dir (`git clone --filter=blob:none`), **never** the user's dirty checkout or the `gto-wt/*` worktrees.
   - (b) Export with `git archive <new-sha>`, excluding `CLAUDE.md` and `scripts/pfbench`.
   - (c) Diff it against `solver/` minus the declared patches.
   - (d) Re-apply the patch list.
   - (e) Diff `advisor.py` request/response keys and the library `FORMAT` / `MODEL_VERSION` / `MAGIC`, and update the TS contract.
   - (f) Run the Python and Node suites at a quiet time (not while library builds run).
   - (g) Update `UPSTREAM.md` and the manifest in one commit.
4. **Library sync:** treat the library as a versioned data release (`index.json` hashes are already per-entry). Publish it to a Lizard-owned host or bucket. Never publish through `deploy_library.sh` (its target is the PUBLIC legacy repo).

### 8.5 Other recommendations [I]

- Guard `tests/test_instant_mw.py` (`setUpClass` at lines 112 and 200) with a SkipTest when `default_library()` is `None`. This is a local patch: declare it, or upstream it.
- Close the `deploy.sh` `DRY_RUN=1` loophole: it passes the guard and launches the full test suite plus the sanity sweep.
- Keep `tests/test_bundle.py` (lazy-import discipline) and the wasm-sha check in Lizard CI.
- Add a CI matrix covering native (Py 3.9 / numpy 2.0.2) and Pyodide (Py 3.12 / numpy 1.26.4).

---

## 9. Verified vs inferred: recap

**Verified in code or data [V]:**
- snapshot fidelity and the two patched files;
- the missing `UPSTREAM.md` and `../scripts/deploy.sh`;
- the `.gitignore` gap;
- all LOC and du sizes, module docstrings and import graphs;
- Advisor methods, lines and request/response keys;
- `server.py`, `cli.py`, `native.py` and `worker.js` behavior;
- C build flags and wasm sha matches;
- library counts and formats, and the HU build progress;
- test counts, expected failures and skip gates;
- branding and storage locations;
- the absence of secrets.

**From the README, not re-measured [R]:** coverage %, startup timings, core speed-up, 3-way library metrics, format-2 savings, preflop chart error.

**Inferred [I]:**
- numpy/Python skew risk and the need for a CI matrix;
- the TS contract approach;
- that the Node UI tests will not survive the port;
- hosting and COEP choices;
- divergence risks and the re-sync procedure;
- the trademark caution;
- that `test_gto` behavior depends on library presence.

**Not done (by constraint):** running any tests, solves, benchmarks, builds or Pyodide. The pass/fail status of the 678 + 379 + 8 tests in this snapshot and environment is therefore **unknown**.
