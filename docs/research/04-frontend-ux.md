# 04 — Frontend and UX research: legacy UI audit and the Lizard frontend design

Status: research only. No application code was written, and nothing was run beyond small read-only `sed`/`grep`/`wc`
commands and two small Python scripts for colour arithmetic.
Scope: Part A audits the legacy static UI in `solver/gto/static/*`, `solver/gto/routes.py` and `solver/gto/server.py`
(snapshot of `michaellhan/gto-solver` main @ 9b907bd6). Part B designs the Lizard frontend (React + TS + Vite,
served at `/lizard/`).

Evidence labels:

- **[V]** verified by reading the cited file or line in this workspace.
- **[M]** a measured number: either measured here (byte counts, contrast maths) or quoted from a cited measurement.
- **[I]** inferred: reasoning, platform behaviour I did not test here, or a design decision.
- **[X]** cross-referenced from a sibling report in `docs/research/` (`05-deployment.md` ran live HTTP checks).

All paths are relative to `/Users/mhan/Desktop/projects/lizard`. `index.html` means
`solver/gto/static/index.html`, and so on for the other static files.

---

## Executive summary

1. **The legacy UI is one 240,037-byte `index.html`** (2,882 lines, with an inline script at lines 832–2880) plus 16
   JS files that together come to about 888 KB uncompressed [M]. Views are overlays. Each has its own lazily loaded
   script, cache-busted by content-hash `?v=` constants (`index.html:1004-1016`) that `scripts/deploy.sh:92-159`
   stamps in. The lack of rewrites on GitHub Pages is handled with one copied `index.html` per route plus a
   `<base href>` (`gto/routes.py`). Spot routes have silently stopped being generated in production [X].
2. **The worker protocol is small and stable enough to wrap, not rewrite.** There are 8 page→worker message shapes
   and 6 worker→page shapes. Cancellation uses a shared 8-byte `Int32Array` stop flag (`STOP[0]` stops every request
   up to an id, `STOP[1]` stops one id). There is a ping watchdog (`STUCK_S = 15`), and a terminate-and-restart
   fallback when the page is not isolated. There is **no per-request timeout** and **no real progress events**: the
   progress bar is a client-side estimate built from budgets (`index.html:1875-1887`). A typed `SolverClient` can wrap
   this protocol exactly (§B3).
3. **Lizard shares an origin with the legacy app.** Using the legacy names unchanged causes real collisions:
   - `worker.js:26` deletes every Cache API entry whose path ends in `/solver.zip` in the cache `"gto-solver"`, so
     two apps using that cache name would evict each other's bundle on every visit.
   - `store.js` ingests any `gto-*` localStorage key into legacy backups.
   - `sessionStorage["gto-isolate"]` would block Lizard's isolation reload in a tab that came from `/gto-solver/`.
   - The `gto-store` IndexedDB and BroadcastChannel names, and the localStorage quota, are all shared.

   **Lizard must namespace everything** (`lizard:*`, `lizard-solver-v1`, the `lizard` database). See §A2.4.
4. **Accessibility is the weakest area.** The 13×13 matrix is 169 `div`s with no role, tab stop or keyboard path
   (`index.html:2056-2067`). The history chips are clickable `span`s (`index.html:1814-1817`). The faint text token
   reaches 3.17:1 contrast [M]. Under simulated deuteranopia, legacy fold vs all-in is only **ΔE76 = 2.8** apart [M].
   The proposed Lizard palette's worst case is 12.5.
5. **The pure logic can be reused; the UI must be rewritten.**
   - Pure or nearly pure: `hh.js` (0 DOM references), `store.js` (an injectable factory), and the `api` objects of
     reports, drills, runouts, session, hands, simple, study and breakdown.
   - Entangled with the DOM and page globals: `practice.js`, `multitable.js` and the inline page script. The page
     script also re-implements the betting rules in JS (the `SEATS` table is duplicated with `gto/preflop.py:17`).
   - The Node harness `tests/js/page.js`, with 379 tests in 31 files [V], is the oracle for golden-testing any port.
6. **Recommendations:**
   - Routing: TanStack Router with typed search params, under `basepath /lizard`. Deep links come from per-route
     shells generated at build time plus a project-site `404.html` fallback [X].
   - State: Zustand stores split by domain.
   - Storage: a `lizard` IndexedDB with a versioned record envelope (reusing the legacy `{id, v, created, updated,
     dev, data}` shape) and ordered migrations.
   - UI primitives: Radix Primitives plus a custom roving-tabindex grid. Charts: in-house SVG plus `d3-scale`.
     Lists: TanStack Virtual.
   - Solver: one `SolverClient` singleton outside React, with pluggable transports (`pyodide-worker`, `http-local`,
     `http-jobs` later).
   - Rules: a `GameEngine` registry so PLO4 adds a module without touching NLHE.
   - Isolation: a COOP/COEP service worker scoped to `/lizard/`.
   - Visual identity: an original dark visual language whose action ramp was tested for contrast and CVD (§B6).

---

# Part A — Legacy UI audit

## A1. Views, routes and lazy loading

### A1.1 View inventory [V]

The solver page itself is the root view. `ROUTES` (`index.html:1027`) lists 13 overlay views, and `SPOT_ROUTES`
(`index.html:1028`) marks two of them as taking a spot id:

| Route key | Label (`ROUTES`) | Script loaded on first use | Version const (`index.html`) |
|---|---|---|---|
| *(root)* | GTO Solver (the hand entry and advice page) | inline script (832–2880) + `store.js` (831) | n/a |
| `practice` | Practice | `practice.js` (same `?v=` as the worker) | `WORKER_VERSION` :1004 |
| `drills` (+`/<spot>/`) | Drills | `drills.js` (after `reports.js`) | `DR_VERSION` :1007 |
| `reports` (+`/<spot>/`) | Flop reports | `reports.js` | `RP_VERSION` :1006 |
| `session` | Analyze session | `session.js` (after `hh.js`) | `SS_VERSION` :1009 |
| `study` | Study | `study.js` | `SY_VERSION` :1010 |
| `preflop` | Preflop solve | `study.js` (its preflop_solve) | `SY_VERSION` |
| `import` | Import hand | `hh.js` | `HH_VERSION` :1005 |
| `hands` | My hands | `hands.js` | `HN_VERSION` :1016 |
| `start` / `about` / `glossary` / `changelog` / `fairplay` | Help pages | `help.js` | `HP_VERSION` :1015 |
| *(sub-feature)* | Breakdown / Equity views | `breakdown.js` | `BD_VERSION` :1008 |
| *(sub-feature)* | Write up a hand | `writeup.js` | `WU_VERSION` :1011 |
| *(sub-feature)* | Turn/river reports | `runouts.js` | `RO_VERSION` :1012 |
| *(sub-feature)* | One-size "Simple" view | `simple.js` | `SP_VERSION` :1013 |
| *(sub-feature)* | 2–4 table practice | `multitable.js` | `MT_VERSION` :1014 |

File sizes [M]:

| File | Size |
|---|---|
| index.html | 240,037 B |
| study.js | 111,698 B |
| practice.js | 88,453 B |
| session.js | 87,168 B |
| multitable.js | 63,973 B |
| hands.js | 36,799 B |
| drills.js | 34,307 B |
| store.js | 32,619 B |
| worker.js | 31,056 B |
| help.js | 30,690 B |
| writeup.js | 29,997 B |
| reports.js | 23,642 B |
| hh.js | 22,098 B |
| simple.js | 21,427 B |
| runouts.js | 16,347 B |
| breakdown.js | 15,945 B |
| sw.js | 1,333 B |
| **Total** | **≈888 KB** |

### A1.2 Routing mechanics [V]

- `ROUTE_RE` (`index.html:1029`) parses `<root>/<view>/<spot>/`. `parseRoute` turns dashes in spot ids back into
  underscores (`:1030-1034`).
- The root page **pins `<base href=ROOT>` at run time** (`:1039`), so a `pushState` to `/study/` cannot move relative
  URLs. The view copies carry their own static `<base href="../">`.
- `syncRoute` (`:1044-1050`) pushes or replaces history and sets `document.title` to `[spot label, view label,
  title].join(" · ")`.
- `applyRoute` (`:2840`) and `startRoute` (`:2853`) open the view that the URL names when the page loads.
- `gto/routes.py` reads the two `const ROUTES` / `const SPOT_ROUTES` source lines with a regex. It writes a copy of
  the stamped page for each route and spot slug, inserting `<base href>` with one `../` per level. `deploy.sh:163`
  calls it (`python -m gto.routes <site>`), and `gto/server.py` serves the same pages locally.
- Expected page count: 1 root + 13 views + 18 spots × 2 (reports, drills) = 50 copies of a 240 KB page, ≈12 MB per
  deploy [I].
- **Regression** [X: `05-deployment.md` §2.3]: `routes.write()` takes the spot slugs from
  `<site>/flop_library/index.json`. The library moved to its own site, so production generates **no** spot copies,
  and `https://www.michael-han.com/gto-solver/reports/srp-btn-bb/` returns 404. Lesson: generating route shells from
  data is fragile, so Lizard needs a `404.html` SPA fallback as a safety net (§B1.3).
- Share links use a hash: `#h=` + `btoa(unescape(encodeURIComponent(JSON.stringify(S))))` (`index.html:1307-1308`,
  `:2211`). `linkState` reads the link and clears it (`:2256-2263`), and `hashchange` reloads the spot (`:2267`). The
  format is uncompressed and unversioned.

### A1.3 Lazy loading and cache busting [V]

- `loadJs` (`index.html:2633`) injects `<script src="x.js?v=<VERSION>">` on first use. Views run in dependency
  order: `reports.js` before `drills.js`, and `hh.js` before `session.js`.
- `deploy.sh:92-159` replaces each `*_VERSION` with the first 10 hex digits of a `shasum`:
  - `WORKER_VERSION` hashes `worker.js` + `practice.js` + `solver.zip` together (`deploy.sh:95`).
  - Each other version hashes its own file.
- The comments disagree about the HTTP cache. `startWorker` says the query string "busts the 4h GitHub Pages cache"
  (`index.html:1119`). `worker.js:9` says Pages "would revalidate it after 10 minutes". Live headers show
  `cache-control: max-age=600` [X: `05-deployment.md:62`], so 10 minutes is correct.
- `worker.js:15-18` keeps entries in the Cache API only when the version is a deployed 10-hex hash. A dev build
  (`"dev"`/`"14"`) always fetches fresh copies.

## A2. Global UI state, settings and persistence

### A2.1 Page state [V]

- `let S = cleanState(load()) || fresh()` (`index.html:1246`). `fresh(n)` returns
  `{players, hero, stack: 100, cards: [7×null], actions: {preflop, flop, turn, river}, ...stakesPref()}` (`:1259`).
- The hand is saved under the localStorage/kv key `"handreview"`, or `"gto-practice-state"` while practising
  (`stateKey`, `:1263-1265`). Each `save()` writes the whole JSON.
- The rest of the state is module-level globals: `selSlot`, `showDeck`, `editSetup`, `pendingRank`, `lastKey`,
  `resultKey`, `solving`, `solveGen`, `lastResult`, and `cache = new Map()` (payload JSON → result, never evicted,
  `:1247-1258`).
- Settings are globals persisted through `pageStore.setRaw`. Examples: `SPEED` (`"gto-speed"`, default `"fast"`,
  `:989`), `OPP` (`"gto-opponents"`, `:992`), `"fourcolor"`, and `"gto-layout"` (column widths, `:2761`).

### A2.2 `store.js` schema [V]

- IndexedDB `"gto-store"`, `DB_VERSION = 1`, `SCHEMA = 1` (`store.js:24`).
- Object stores `kv`, `hands`, `sessions`, `blobs`, plus `meta`, all `{keyPath: "id"}` and created in
  `onupgradeneeded` (`:62-66`). There are **no secondary indexes**: lists are read whole and filtered in memory.
- Record envelope (`record()`, `:148-152`):

  ```json
  { "id": "…", "v": 1, "created": 1730000000000, "updated": 1730000000000, "dev": "<device uuid>", "data": { } }
  ```

  A tombstone is `{ "id", "v", "created", "updated", "dev", "deleted": true }`, kept so a future sync can tell a
  deletion from a record it never saw.
- `kv` records: `id` = the localStorage key and `data = {raw: "<string>"}`. Every kv write is **mirrored to
  localStorage** so the page can read it synchronously at boot. `reconcile` (`:188`) takes in any key that
  `KNOWN` (28 names, `:27-30`) lists **or that starts with `gto-`**.
- `LOCAL_ONLY` keys are never turned into records or backed up: `gto-anthropic-key`, `gto-explain-own`,
  `gto-session-run` (`:32`). `gto-anthropic-key` is where Practice's "Explain with AI" key is stored; its value was
  not read. `DEVICE_ONLY`: `gto-layout`, `gto-hands-table`.
- `hands` data: `{tags: [], note: "", source: "table"|"import"|…, state: <page S>, sig: hash(canon(state without
  grades)), reviewed}` (`:345-380`). Save is idempotent through `sig`, and through `extendsHand`, which lets a hand
  that continues an earlier saved one replace it.
- Cross-tab sync: `BroadcastChannel("gto-store")` (`:130`) invalidates the per-store cache. Writes are queued and
  flushed in one transaction after 30 ms.
- `migrate` (`:214`) is a one-time, flag-guarded data import from the old `gto-session` IndexedDB and its
  localStorage fallbacks. It is not a schema-migration framework: `DB_VERSION` has never moved past 1.
- Fallback chain: IndexedDB → localStorage (`"gto-store:<store>"`) → memory (`init`, `:232`).
- Backup/restore (`:292`, `:305`) writes the file name prefixes `gto-solver-backup` / `gto-solver-hands`.
- Exports: `module.exports = api` under Node, else `globalThis.GTOStoreLib` / `globalThis.GTOStore = createStore()`
  (`:470-471`).

### A2.3 Other stores on the origin [V]

- IndexedDB `"gto-pf"`: Study's solved preflop games (`study.js:246-271`).
- IndexedDB `"gto-session"`: legacy, migrated read-only.
- Cache API `"gto-solver"`: `solver.zip?v=…` and `solver-pyc.zip?v=…` (`worker.js:16-38`).
- sessionStorage `"gto-isolate"` (`index.html:1070`).

### A2.4 Same-origin collision hazards for Lizard (important) [V for the mechanism, I for the impact]

Lizard at `https://www.michael-han.com/lizard/` has **the same origin** as `/gto-solver/`. Browser storage is
per-origin, not per-path.

| Shared resource | Legacy behaviour | Hazard if Lizard reuses it | Rule for Lizard |
|---|---|---|---|
| Cache API `"gto-solver"` | `toCache` deletes every key whose pathname ends with `/solver.zip` before it writes (`worker.js:22-29`) | `/gto-solver/solver.zip?v=A` and `/lizard/…/solver.zip?v=B` evict each other on every visit, re-downloading ≈290 KB and recompiling bytecode | Cache name `lizard-solver-v1`. Delete by full URL prefix (`/lizard/`), never by basename |
| localStorage `gto-*` keys | `reconcile` imports any `gto-` key into the legacy store and its backups (`store.js:26` comment, `:188`) | Lizard data leaks into legacy backups and syncs | Prefix every key `lizard:`. Keep localStorage to tiny boot hints |
| sessionStorage `"gto-isolate"` | Set once per tab before the SW reload (`index.html:1070`) | A tab that visited `/gto-solver/` first skips Lizard's isolation reload, so Lizard runs unthreaded | `lizard:isolate` (also proposed in `05-deployment.md:310`) |
| IndexedDB `gto-store` / `gto-pf` / `gto-session`, BroadcastChannel `gto-store` | — | Schema clashes: a Lizard upgrade would bump a database the legacy code opens at v1, and its `open()` would then fail with VersionError [I] | A `lizard` database and a `lizard` channel. Import from legacy only through an explicit, read-only migration |
| localStorage quota (≈5 MB per origin [I]) | Legacy mirrors every kv value into localStorage | Big Lizard values would compete with legacy for quota | Nothing large goes in localStorage |
| `gto-anthropic-key` in localStorage | Stored in plain text, same origin | Any script running under `/lizard/` can read it [I] | Lizard never reads it. Keep a strict CSP and avoid third-party scripts |
| Service worker | Legacy `sw.js` scope = `/gto-solver/` (registered relative to the base) | Scopes don't overlap | Lizard's SW is scoped to `/lizard/` |

## A3. Worker protocol (exact specification)

### A3.1 Backend selection: local server or browser worker [V]

1. Over `https:` the worker starts immediately (`index.html:1078`). The static site never runs the local server,
   because `gto/server.py` serves only http.
2. `modeReady` (`:1079-1083`) does `fetch("health.json", {cache: "no-store"})`:
   - If it returns `{"ok": true}`, `MODE = "server"`, and any worker already started is terminated (the proxied case).
   - Otherwise `MODE = "wasm"` and `startWorker()` runs. The static site ships a `health.json` with `{"ok": false}`,
     so the probe never logs a 404.
3. **Server mode** (`callAdvise`, `:1150`) sends `fetch(play ? "play" : "advise", {method: "POST", headers:
   {"Content-Type": "application/json"}, body: JSON.stringify(play ? {state, ...play} : state)}).then(r => r.json())`.
   There are no partial answers, no prefetch and no presolve. Cancelling is `POST cancel` (`:1235`).
4. `gto/server.py` (160 lines):
   - Defaults: `127.0.0.1:8765` (`:135`).
   - Endpoints:

     | Method and path | Behaviour |
     |---|---|
     | `POST /advise` | Body is the game state. Returns the recommendation |
     | `POST /play` | Body is `{state, seat, hole, seed?}` |
     | `POST /cancel` | Sets a global `threading.Event` (`:31`) |
     | `GET /health` and `/health.json` | Health check |
     | `GET /flop_library/*.json\|.bin` | Library files (`:54-56`) |
     | `GET` (other) | Pages and scripts |

   - **One `threading.Lock`** (`:30`) serialises all solves.
   - CORS: `Access-Control-Allow-Origin: *` (`:38`, with OPTIONS at `:42-47`). Any web page can therefore drive a
     running local server and cancel its solves [I].
   - Errors are returned as 400, 404 or 500.

### A3.2 Worker creation and boot [V]

```js
worker = new Worker("worker.js?v=" + WORKER_VERSION + "&lib=" + encodeURIComponent(LIB_BASE));   // index.html:1119
STOP = crossOriginIsolated && typeof SharedArrayBuffer === "function" ? new Int32Array(new SharedArrayBuffer(8)) : null;
if (STOP) worker.postMessage({ stop: STOP.buffer });
```

- URL params, read in `worker.js:11-12`:
  - `v` is the bundle version. The default is `"dev"`, and only a 10-hex value enables the Cache API.
  - `lib` is the library base URL, relative to the worker. The default is `"flop_library/"`.
- Runtime: **Pyodide 0.26.4 from jsDelivr**, `https://cdn.jsdelivr.net/pyodide/v0.26.4/full/` (`worker.js:2`),
  loaded with `importScripts` (`:44`).
  - `numpy-1.26.4-cp312-cp312-pyodide_2024_0_wasm32.whl` is prefetched in parallel (`:43`); it is the largest
    download, at 12 MB.
  - Status text says "Python and numpy, about 25 MB, cached after the first visit" (`:160`).
- Solver code: `solver.zip?v=<v>` holds every `gto/*.py` plus treys, about 290 KB [M: README §Worker startup]. The
  first visit also writes `solver-pyc.zip?v=<v>`, the compiled bytecode, which is never requested from the network.
  Both are kept in the Cache API `"gto-solver"` (`worker.js:13-38`).
- Compiled cores:
  - `core.wasm` is the heads-up CFR core and `mwcore.wasm` the multiway core. When the page is cross-origin isolated
    and `HELPERS > 0`, their `-mt.wasm` threaded variants are used instead (`worker.js:142-153`).
  - `HELPERS = min(7, hardwareConcurrency − 1)` (`:107`). Each helper is a Blob-URL worker that receives
    `{mod, memory, i, pre}`, where `pre` is `"core_"` or `"mw_"` (`:108-118`, `:129`).
  - Threads share `WebAssembly.Memory({initial: 256, maximum: 32768, shared: true})`, i.e. 16 MiB initial and
    2 GiB maximum (`:124`).
  - A helper that traps sets `core_dead`. The core then reloads, and the solve falls back to numpy if it fails again.
- Cross-origin isolation (`index.html:1067-1077`, `sw.js`):
  1. If the page is not isolated, has no SW controller, and `sessionStorage["gto-isolate"]` is not set: set the flag,
     register `sw.js`, wait for `navigator.serviceWorker.ready` (with a 4 s timeout), then `location.reload()`.
  2. On timeout or failure it runs unthreaded.
  3. `sw.js` (20 lines) re-wraps only `mode === "navigate"` and `destination === "worker"` same-origin responses. It
     adds `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`, and passes
     status-0 responses through. It uses `skipWaiting` + `clients.claim`.
- Boot timings [M: README "Worker startup" table, medians on a quiet 10-core machine]:

  | Run | Runtime | numpy | Code | First answer |
  |---|---|---|---|---|
  | Node | 0.73 s | 0.13 s | 0.47 s (first visit) / 0.40 s (bytecode cached) | 1.32 / 1.38 s (preflop / library flop) |
  | Chrome, first visit | — | — | — | 1.35 s (1.27–1.79) |
  | Before the bundle work | — | — | — | 3.68 s (Node), 2.93 s (Chrome) |

### A3.3 Messages: page → worker [V: `worker.js:376-433`, `index.html:1117-1244`]

| Shape | When | Effect |
|---|---|---|
| `{stop: SharedArrayBuffer(8)}` | Right after creation, isolated pages only | Worker keeps `STOP = new Int32Array(buf)` |
| `{ping: n}` | After a stop, by `watchStop` | Worker replies `{pong: n}` (it is only queued if the worker is blocked) |
| `{cancel: id}` | Runtime still loading | `cancelled.add(id)`. When the request comes up it answers `{cancelled: true}` |
| `{prefetch: state}` | Flop known (`prefetchLibrary`, `:1136-1145`); state with `board` cut to 6 chars and the street actions emptied | Dry-runs `Advisor.prefetch`, then `libAhead` on every path it recorded. No reply |
| `{id, state}` | A plain advise | Final `{id, result}` |
| `{id, state, early: true}` | Advice with partials (not Practice) | `early(state)` → `{id, partial}` at most once, then up to 4 `progress` looks, each `{id, partial}` or an early `{id, result}`, then `answer` |
| `{id, state, play: {seat, hole}}` | Practice opponent move (`Advisor.play`) | `{id, result}`. No partials |
| `{id, state, presolve: "<seat>"}` | Speculative presolve while the opponent acts (`presolveFor`, `:1208-1221`) | `{id, result: {presolved, iterations}}`, `{skipped: true}` or `{cancelled: true}`. The answer is never shown |

`state` is the payload that `payload()` builds (`index.html:1826-1840`). That is the advisor's game-state format
(`gto/advisor.py:1-17`) plus client fields:

```json
{ "players": 6, "hero": "BTN", "hole": "AhKd", "board": "Ks7d2c", "stack": 100,
  "stacks": {"BTN": 40}, "ante": 0.1, "straddle": true, "rake": 0.05, "rake_cap": 3,
  "payouts": [50, 30, 20], "field": {"players": 120, "chips": 1800000}, "bounties": {},
  "preflop": [{"pos": "CO", "action": "raise", "to": 2.5}, {"pos": "BTN", "action": "call"}],
  "flop": [{"pos": "BB", "action": "check"}, {"pos": "CO", "action": "bet", "amount": 2.0}],
  "turn": [], "river": [],
  "budget": 8, "prior_budget": 3, "speed": "fast", "quick": true,
  "opponents": "pool", "sizes": {"flop": [33, 75], "raise": [60]}, "ranges": {"BB": "22+,A2s+,KTo+"},
  "optimize_sizes": true, "locks": {} }
```

All fields after `river` are optional. Budgets come from `BUDGETS` (`index.html:974`), as `[budget, prior_budget]`
in seconds:

| Mode | Quick | Fast | Accurate |
|---|---|---|---|
| `server` | [1.5, 0.3] | [2.5, 2.5] | [30, 12] |
| `wasm` | [1.5, 0.3] | [8, 3] | [60, 12] |

Postflop Quick, and Practice at Fast, use `QUICK_BUDGETS` (`:978`): flop and turn [1.5, 0.3], river [0.8, 0.3].

### A3.4 Messages: worker → page [V]

| Shape | Source line | Page handling (`startWorker` onmessage, `index.html:1123-1130`) |
|---|---|---|
| `{status: "Loading the solver runtime (1 of 3: …)…"}`, then `"Loading numpy (2 of 3)…"`, then `"Starting the solver (3 of 3)…"` | `worker.js:160,163,166` | `workerStatus = m.status` and the status line shows it |
| `{status: "Solving…", setup: {<stage>: secs, …, total}}` | `:357` | Ready; the solve clock starts (`setStatus`) |
| `{pong: n}` | `:386` | `pongs = max(pongs, n)` |
| `{id, partial: <advice-shaped result>}` | `:417,423` | `partials[id](partial)` → `renderEarly` |
| `{id, result: <advice result> \| {cancelled: true}}` | `:408,413,422,426` | `pending[id](result)`, then the request's bookkeeping is deleted |
| `{id, error: "<last 3 lines of the Python traceback>"}` | `:428` | `pending[id]({error})` |
| `worker.onerror` | — | Every pending request resolves `{error: "solver worker failed: …"}` (`:1131`) |

The advice result's top-level keys for a heads-up postflop answer (`gto/advisor.py:5147-5170`):

```json
{ "street": "flop", "hero": "BTN", "villain": "BB", "position": "IP", "players": 2, "hand": "AKo", "board": "Ks7d2c",
  "pot_bb": 5.5, "to_call_bb": 0, "stack_bb": 97.5,
  "actions": [{"action": "check", "freq": 0.41, "ev_bb": 3.12, "amount_bb": null},
              {"action": "bet 33%", "freq": 0.59, "ev_bb": 3.20, "amount_bb": 1.82, "rough_ev": true}],
  "recommended": "bet 33%", "sampled": "…",
  "grid": {"actions": ["check", "bet 33%", "bet 75%"], "cells": {"AKo": {"w": 1.0, "f": [0.41, 0.59, 0.0]}}},
  "range_action_freq": {"check": 0.52}, "hero_range_combos": 412.3, "villain_range_combos": 655.1,
  "villain_range": "…", "villain_grid": {"actions": ["in range"], "cells": {}},
  "solver": {"iterations": 217, "solve_seconds": 8.1, "nodes": 0, "active_combos": 0, "tree_actions": [],
             "exploitability_pct": 0.22, "cells": 0},
  "widened": false, "off_solution": [], "precomputed": {}, "locked": {}, "notes": [], "seconds": 8.12 }
```

The values in this example are illustrative. The keys are exact. `off_solution`, `precomputed`, `locked` and
`breakdown` appear only when they apply. `solver.approximate` and `solver.target_pct` are added by `_flag_short`
(advisor.py, used by `convergence()` at `index.html:1932-1935`). Preflop, multiway and Study results have other
shapes (e.g. `solved`, `multiway`, `equity_vs_field`, `size_usage` in `index.html:2205-2207`). **There is no schema
or version field on any result.** Lizard should add a `schema` field at the adapter boundary (§B3).

### A3.5 Cancellation, superseding and timeouts [V]

- **Stop flag.** `stopRequests(id?)` (`index.html:1166-1172`) works as follows:
  - With no id: `Atomics.store(STOP, 0, reqId)`, which stops every request up to the newest.
  - With an id: `Atomics.store(STOP, 1, id)`.
  - Either way, matching pending promises resolve `{cancelled: true}` at once. The worker's `stopNow()` and
    `Advisor.should_stop` check `STOP[0] >= CUR || STOP[1] === CUR` between iteration chunks, so a solve stops
    within ~0.1 s (`worker.js:376-384`) and the worker keeps its cached solves.
- **Watchdog.** After a stop, `watchStop` (`:1177-1190`) sends `{ping}`. If no `pong` arrives within
  **`STUCK_S = 15` s**, it terminates the worker, starts a new one, and resends every request still pending from
  `sent`.
- **Non-isolated pages** have no shared flag. `cancelSolve` (`:1232-1244`) then terminates the worker if the runtime
  is up, which costs a runtime reload from cache (≈1.5 s per the comment at `worker.js:381`) plus re-solving the
  earlier streets. If the runtime is still loading, it posts `{cancel: id}` for each pending request.
- **Superseding** (`analyze`, `:1850-1903`):
  - `lastKey` is the JSON of the payload. An identical key returns early.
  - `solveGen` is bumped by `cancelSolve`, and a stale result is dropped (`if (gen !== solveGen) return`).
  - `cache` (an unbounded Map) answers repeats.
  - `keyFor(key, slowerSpeed)` reuses an Accurate answer for Fast/Quick requests, or a Fast answer for Quick.
  - Presolves (`PRE`) are stopped by any real request (`stopPresolve` in `callAdvise`), by `visibilitychange` to
    hidden, and by `pagehide`.
- **No request timeout.** Nothing bounds how long a request takes apart from the solver's own budget. The watchdog
  only runs after a stop.
- **Progress** is an estimate: `est = budget + prior_budget × (index of the current street − 1)`, ticking every
  100 ms and capped at 97% (`:1875-1887`). The worker sends no progress percentages. The only signals are
  `partial` answers and the stage text. Measured bars and wall times [M: README "Browser timings"]:

  | Request | Bar | Wall time, iterations, exploitability |
  |---|---|---|
  | Fast K72r flop | 8 s | 8.1 s, 217 iterations, 0.22% of the pot |
  | Accurate K72r flop | 60 s | 60.2 s, 870 iterations, 0.03% |
  | Library flop | — | 0.02 s |

  The wasm heap peaks at 490–566 MB per answer, and kept solves are capped at 700 MB (`Advisor.cache_mb`).

## A4. Library fetching and reports

- `LIB_BASE = "flop_library/"` (`index.html:1020`). `deploy.sh:85` rewrites it to `"../gto-solver-library/"`, and
  the worker receives it as `&lib=`. Lizard reading the 6-max library same-origin at `/gto-solver-library/` needs no
  CORS [X].
- **Index** `index.json` [M, local copy]:
  - Top-level keys `{format: 2, tree, spots}`, where `tree = {sizes: {flop_bet: [0.33, 0.75], flop_raise: [0.5],
    bet_turn: [0.75], bet_river: [0.75], raise_turn: [0.75], raise_river: [0.75], max_raises: 2, allin_spr: 2.5,
    depth: 2, rake: null}, model: {river_play: true, turn_classes: true, flop_leaf_rivers: 4, version: 1}}`.
  - `spots` is a list of 18 entries. Example: `{id: "srp_btn_bb", label: "BTN vs BB single-raised pot", line:
    "UTG:f,HJ:f,CO:f,BTN:r2.5,SB:f,BB:c", seats: ["BB", "BTN"], fp: [<16-hex>, <16-hex>], pot: 5.5, stack: 97.5,
    tree, flops: {"2h2d2c": "d749b47d1b", …}, turns: true, report: "6d522c1bda"}`.
  - 13 spots have 1,755 flops each (all strategically distinct flops) and 5 have 552.
  - Size: 732,218 B raw and ≈292,952 B gzipped. `worker.js:49` claims 117 KB gzipped, which is stale.
- **Entries:** `<spot>/<flop>.bin` (1.5–6 KB, magic `GTOFL3`, `flop_library.py:39`) and `<flop>.turn.bin`
  (≈10–25 KB, `TURN_MAGIC`, `:666`). `srp_btn_bb/` holds 3,512 files and 45 MB [M].
  - The worker keeps a `LIB` map capped at 64 entries, evicting one fetched non-index entry when full
    (`worker.js:55-60`). Prefetched files are awaited (`whenAhead`).
  - Anything missing is fetched by **synchronous XHR inside the worker**, which took 0.13–0.67 s per entry through
    the CDN (`worker.js:49-52`).
  - `mw_index.json` covers the 4 `mw_*` multiway spots (`gto/mw_library.py:33`).
- **Reports:** `<spot>/report.json` (437,599 B for `srp_btn_bb`) has `{format: 1, id, label, line, seats, pot,
  stack, nodes: {"": ["check", "bet 33%", "bet 75%"], …6 nodes}, flops: [{f: "2h2d2c", n: {<node>: [freq…]}, h:
  {<node>: "<example hand>"}, ev: [oop, ip], eq: [oop, ip], hash, w: 4.0}, … 1755]}`. `reports.js` fetches it
  (`:8`, `:199`, `:219`, `:302`) and renders sortable texture tables. `runouts.js` does the same for turn and river
  reports, and `drills.js` decodes the `.bin` nodes (`decode`, `nodeAt`).
- **Library status** must come from the published index's `spots[].flops` count. Build outputs are not a source.
  The HU builds that are still running are partial: `srp_sb_bb_2max` at 292/474 and `lp_sb_bb_2max` at 28/424, per
  the last lines of `/Users/mhan/Desktop/projects/gtosolver/.work/flop-core/hu_2max.log` and `hu_lp.log`, read-only
  [M]. A status page must say "partial: N of M flops" and must never imply full coverage.

## A5. Rendering

### A5.1 Range matrix [V: `index.html:2038-2127`, CSS `:454-472`]

- Markup: `.grid` is a `grid-template-columns: repeat(13, 1fr)` with a `gap: 2px`, capped at `max-width: 440px`.
  Each of the 169 cells is a `div.cell[data-h=<class>]` that holds a `.stack` flex row, with one `div` per action
  whose width is `f[a] × 100%` and whose background is `COLORS(name)`. Labels are white with a black `text-shadow`.
- Range weight is shown as **cell opacity**: `0.25 + 0.75 × min(1, w)`, or `0.08` when `w = 0`.
- The hero's hand is shown by an accent outline, `scale(1.18)` and a "YOU" badge.
- Whole-range aggregates: combos are weighted 6/4/12 for pairs/suited/offsuit. The aggregate `rangebar` and the
  per-action totals are computed in the UI (`:2040-2053`).
- Interaction: `wireGrid` gives a hover or tap readout in `.readout`, with text that switches on
  `hover`/`pointer: coarse` media queries (`hoveronly`/`touchonly`).
- Rendering is by `innerHTML` string concatenation. The DOM cost is about 169 × (2 + actions) nodes per render,
  ≈845 for 3 actions [I].

### A5.2 Frequency bars, action colours, EV [V]

- Tokens (`index.html:10-23`): `--fold #4a7bd0`, `--passive #3fae6a` (check and call), `--allin #8b5cc9`, and
  bet/raise sizes from light to dark `--agg0 #f4a261`, `--agg1 #e0603a`, `--agg2 #b3302a`, `--agg3 #7a1a3a`.
  `"in range"` uses `--accent #f2b544`.
- `setColors` (`:1907-1911`) sorts the aggressive actions by numeric size and assigns shades by how many there are:

  | Aggressive actions | Shades used |
  |---|---|
  | 1 | `[1]` |
  | 2 | `[0, 2]` |
  | 3 | `[0, 1, 2]` |
  | 4 or more | `[0, 1, 2, 3]`, with any extras taking the last shade |

- **Check and call share one colour**, and two sizes beyond the fourth also collide.
- The action table shows EVs with `.num.pos`/`.neg`. A "≈" marks `rough_ev` (`:452`). Grades come from
  `gradeClass` (`:1543`), which is driven by **frequency**: `f ≥ 0.15` is ok, `≥ 0.03` is meh, anything else is bad.
  EV loss is displayed but does not drive the grade. The plan asks for EV-based grading (`IMPLEMENTATION_PLAN.md`
  §8).
- The four-colour deck toggle (`"fourcolor"`, `:2500`) applies to cards only.

### A5.3 Combo breakdown, table, hand-history replayer [V]

- `breakdown.js` (`api = {request, show, breakdownHtml, equityHtml, cache, state}`, `:189`) asks for a breakdown
  re-run on a cached solve and renders HTML strings.
- Table: `renderTable` (`index.html:1672`) and `renderAction` (`:1707`).
- Timeline: `renderTimeline` (`:1808-1823`) renders the action chips as `span`s with `onclick` (rewind on hero
  actions) and an Undo button with a `<kbd>U</kbd>` hint.
- `hh.js` parses hand histories, `session.js` grades them, and `multitable.js` runs 2–4 tables at once.
- Keyboard shortcuts are handled by one global `keydown` listener (`:2553`).

### A5.4 Mobile [V]

- 14 `@media` blocks: `index.html:233, 234, 368, 396, 412, 418, 517, 531, 555, 566, 567, 595, 606, 611, 625`.
  - Desktop gets a two-column grid with a `--left: 500px` column (`:531`).
  - At ≤900 px and ≤559 px the layout is one column (`:555`).
  - `hover: none` and `pointer: coarse` get touch affordances (`:595`, `:611`).
- `--kb` is set from `visualViewport` to keep controls above the on-screen keyboard. `--felt-h:
  clamp(190px, 32vh, 270px)` sizes the table.

### A5.5 Accessibility gaps [V for counts and markup, M for contrast]

- ARIA usage is thin:

  | File | `aria-*` attrs | `role=` | `tabindex` |
  |---|---|---|---|
  | index.html | 25 | 7 | 3 |
  | study.js | 11 | 2 | 2 |
  | writeup.js | 13 | 1 | 1 |
  | session.js | 10 | 3 | 0 |
  | hh.js | 0 | 0 | 0 |
  | simple.js | 0 | 0 | 2 |

- **Matrix:** no `role="grid"`, no cell roles, no `tabindex`, no arrow-key navigation, and the readout has no
  `aria-live`. Information is carried by colour and opacity only. `cursor: crosshair` hints that the cells are for
  pointer use only.
- **Timeline chips** are `span`s with `onclick`, so they cannot be reached by keyboard (`:1814-1817`).
- **Contrast against `--bg #0d0f12`** [M, WCAG 2.x]:

  | Token | Contrast | Note |
  |---|---|---|
  | text `#e7e9ec` | 15.78 | |
  | muted `#8a919c` | 6.04 | |
  | **faint `#5c636e`** | **3.17** | Fails 4.5:1 for body text; 2.73 on `--panel2` |
  | `--agg3 #7a1a3a` | 1.86 | Fails 3:1 for non-text graphics |
  | `--agg2 #b3302a` | 3.08 | Borderline |

  White cell labels on `--agg0` reach only 2.06; the text-shadow helps but is not compliant.
- **Colour-vision deficiency** [M: Machado 2009 matrices at severity 1.0, CIE76 ΔE; script at
  `/private/tmp/claude-501/-Users-mhan-Desktop-projects-lizard/2b1d9842-3cae-4ee2-a7bb-3a038f7fbada/scratchpad/legacy_pal.py`]:

  | Vision | Closest pair | ΔE76 |
  |---|---|---|
  | Normal | agg1–agg2 | 19.3 |
  | Deuteranopia | **fold–all-in** | **2.8** (nearly indistinguishable) |
  | Protanopia | fold–all-in | 8.9 |
  | Tritanopia | agg1–agg2 | 15.4 |

  Fold vs all-in is the most consequential confusion a strategy chart can make.

## A6. Reusability of the legacy modules

| Module | Export pattern [V] | DOM refs (`document.`/`innerHTML`/`querySelector`) [M] | Verdict |
|---|---|---|---|
| `hh.js` | `module.exports = api` else `Object.assign(globalThis, api)`. `api = {parseHandHistory, importHand, splitHands, HH_SEATS}` (`:279-280`) | 0 | **Pure.** Port to TS as-is and golden-test it with `tests/js/hh.test.js` and `hh_synth.js` |
| `store.js` | UMD-style, `createStore(env)` factory (`:470-471`) | — (injectable `env`) | Reuse the **envelope, tombstone, `canon`/`hash`/`sig` and backup** ideas. Rewrite on a typed IDB wrapper |
| `reports.js` | `globalThis.FlopReports`. `api = {texture, rows, columns, nodeOf, filter, sort, average, groups, html, …}` (`:311`) | 11 | Split: the data functions are pure, the `html` builders are dropped |
| `runouts.js` | `globalThis.Runouts`. `{cardClass, CLASSES, GROUPS, rows, filter, sort, …, html, controlsHtml}` | 2 | Mostly pure |
| `drills.js` | `globalThis.Drills`. `{decode, parse, nodeAt, candidates, pick, handWeights, problem, potAt, grade, addScore, …}` (`:462`) | 12 | `decode`/`nodeAt` (the `.bin` reader) and grading are pure and worth porting |
| `session.js` | `globalThis.Session`. `{handId, decisions, prepare, buildItems, classify, mixOf, …}` (`:1081`) | 11 | Decision extraction and classification are pure. Its UI is rewritten |
| `hands.js` | `globalThis.MyHands`. `{summary, searchText, matches, filterRecs, tagCounts, parseImport, backupText, …Html}` (`:465`) | 20 | Search and filter logic are pure |
| `simple.js` | `globalThis.Simple`. `{runs, baseKey, merge, summarize, etaOf, start, stop, …Html}` (`:286`) | 7 | The scheduling ideas carry over, not the code |
| `study.js` | `globalThis.Study`. `{fresh, parseLine, fromSpot, fromPayload, request, play, deal, …}` (`:1349`) | 44 | Request builders (`:44-71`) are reusable. Heavy on the DOM |
| `breakdown.js` | `globalThis.Breakdown` (`:189`) | 8 | Request shape only |
| `help.js` | `globalThis.Help`. `{PAGES, TERMS, CHANGES, …Html}` | 13 | Content source, to be re-authored |
| `writeup.js` | `globalThis.WriteUp` | 9 | Logic is entangled |
| `practice.js` | `window.Practice = {get on(), …}` (`:1056`) | 29 | **Entangled** with page globals (`S`, `payload`, `callAdvise`). Rewrite. Keep the look-ahead scheduling idea (`:215-330`) |
| `multitable.js` | `window.MultiTable` (`:846`) | 16 | Entangled. Rewrite |
| inline page script | Globals | Pervasive | **Rules duplicated in JS**: `SEATS` (`index.html:836`) duplicates `gto/preflop.py:17`, and `simulate`/`act` re-implement betting (~`:1370-1475`) |
| `worker.js` | Classic worker | n/a | **Reuse nearly as-is** behind the Lizard transport. Rename the cache and add `schema` and `progress` fields (§B3) |

**Test harness** (`solver/tests/js/page.js`, 279 lines) [V]:

- It extracts the page's single inline script (`pageScript`) and runs it in a `vm` against a fake DOM (`El`), a
  `FakeWorker` and a fake `fetch`. Options include `hash`, `path`, `search`, `scripts`, `protocol`, `storage`,
  `server`, `isolated`, `store` and `layout`.
- It exports `{loadPage, state, acts, pageScript, HTML_PATH}`.
- `worker.test.js` stubs Pyodide in a `vm`. The suite has 379 tests in 31 files.
- Examples from `engine.test.js`: "seats and acting order for 2-9 players…", "a call for less than the bet puts the
  caller all-in", and "bet sizes are shaded light to dark by size".
- **Use:** generate golden fixtures for Lizard's TS engine and parsers offline, by running these modules under
  Node, and commit them as JSON. The plan's rule ("No duplicate rules implementation in UI", §3) is then met by a
  single TS engine that is validated against the Python and legacy fixtures (§B4).

---

# Part B — Lizard frontend design

## B1. Route map and deep links under `/lizard/`

### B1.1 Routes

| Path (all under `/lizard/`) | View | Typed search params (validated) | Data and chunks |
|---|---|---|---|
| `/` | Overview: recent hands, training stats, library status card | — | Shell only |
| `/study/` | Study: browse a solution tree | `spot` (library id), `b` (board, e.g. `Ks7d2c`), `line` (node path, e.g. `x-b33-c`), `h` (selected class/combo), `view` (`strategy\|ev\|equity\|eqr\|compare`), `src` (`library\|solve`) | `study` chunk. Library index + entry |
| `/study/preflop/` | Preflop charts and preflop solve | `players`, `stack`, `line`, `h` | `study` chunk |
| `/practice/` | Practice hub (modes, presets) | `preset`, `mode` (`full\|spot\|street\|drill`) | `practice` chunk |
| `/practice/play/` | Live table | `preset`, `seed`, `tables` (1–4) | `practice` + solver |
| `/practice/drills/` | Spot drills | `spot`, `node`, `filter` | Library entries |
| `/analyze/` | Sessions list and dashboard | `from`, `to`, `site`, `stakes` | `analyze` chunk + IDB |
| `/analyze/import/` | HH import | — | `hh` parser chunk |
| `/analyze/hands/` | Filterable hands (virtualized) | `q`, `tags`, `pos`, `street`, `sort`, `sel` | IDB |
| `/analyze/hand/` | One hand replay + review | `id` (local record id) or `#s=` (shared state) | IDB / hash |
| `/solve/` | Custom solver form + progress + results | `#s=` (encoded spot; see B1.4) | `solve` chunk |
| `/reports/` | Aggregate flop reports index | `spot` | `reports` chunk |
| `/reports/flop/` | One spot's 1,755-flop report table/charts | `spot`, `sort`, `filter`, `node` | `report.json` (≈438 KB) |
| `/reports/runouts/` | Turn/river reports | `spot`, `b`, `node` | `.turn.bin` |
| `/ranges/` | Range builder/editor + presets | `id` (preset), `#r=` (encoded range) | `ranges` chunk |
| `/tournaments/` | ICM / payouts / bounty calculators and MTT spot setup | `payouts`, `stacks` | `tourney` chunk |
| `/library/` | Saved spots/hands/drills/ranges + **library status** (published coverage, partial builds) | `tab`, `q`, `tags` | Index JSON |
| `/settings/` | Display, colors, deck, solver accuracy defaults, storage, backup/restore, legacy import | `tab` | — |
| `/help/…` | Getting started, accuracy and provenance, glossary, changelog | — | Static |

Design rules:

1. **Paths name views and search params name state.** The only dynamic path segments are a small set of library
   spot ids, and those also exist as `?spot=`. Every URL then resolves to a shell that exists at build time, and the
   search params carry the variable part [I].
2. Search params are validated with a schema (valibot or zod). Invalid values fall back to defaults with a visible
   notice; the page must never white-screen.
3. Every view carries a "Copy link" action. Hand states and custom spots too large for a query string go in the
   **fragment** (`#s=`), because fragments are never sent to the server.
4. Legacy redirects: a small map at `/lizard/legacy` sends old names (`practice`, `study`, `reports/<spot>`,
   `#h=` links) to Lizard routes. `#h=` payloads use the legacy state format and can be decoded by a compatibility
   decoder (`index.html:1307-1308`).

### B1.2 Router choice [I]

- **TanStack Router** (code-based route tree, not file-based, to keep the build simple). It has typed, validated
  search params, `basepath: '/lizard'`, route-level `loader`s and lazy route components.
- React Router v7 in data mode is an acceptable alternative. It needs hand-written search-param parsing.
- Either way, Vite runs with `base: '/lizard/'`. Assets are then absolute (`/lizard/assets/…`), so there is no need
  for the legacy `<base href>` trick, and pushes to nested paths cannot break relative URLs. That trick is exactly
  what `index.html:1036-1039` had to work around.

### B1.3 Deep links without server rewrites [X + I]

The recommended hosting is a project site in its own repo (`05-deployment.md` §0.1). A project site serves **its
own `404.html`** [X]. Deep links then use two layers:

1. **Build-time shells.** A Vite build step writes `dist/<route>/index.html` for every static route in the table
   above, each a copy of the SPA shell. Each copy:
   - sets the correct `<title>` and canonical link, which helps when links are shared;
   - returns 200, so refreshes and crawlers see a real page;
   - needs no `<base>` because asset URLs are absolute.

   Directory URLs without a trailing slash get a 301 to the slash form from Pages [X: `05-deployment.md:220`], so
   canonical links always end in `/`.
2. **`404.html` fallback.** It holds the same shell plus a tiny inline script. If the path is under `/lizard/` and
   not `/lizard/assets/`, it rewrites `history.replaceState` to the requested path and boots the app, which resolves
   the route. The response status stays 404, which is fine for a SPA [I]. This layer catches anything the shells
   miss, such as the data-dependent legacy spot routes that regressed in production.

Hash routing (`/lizard/#/study`) is rejected because it conflicts with the fragment-encoded share state.

### B1.4 Share-link format [I]

- Format: `#s=1.<base64url(deflate-raw(JSON))>`, where the leading `1.` is the format version and compression uses
  `CompressionStream`. A JSON fallback is used where `CompressionStream` is missing.
- The decoder takes any known version and migrates it forward, the same way IDB records are migrated (B2.4).
- The legacy share format is uncompressed base64 JSON (`index.html:1307`). A 6-handed hand with three streets of
  action is a few hundred bytes. Deflate keeps typical hands well under 2 KB, which every platform's URL length
  limit allows [I].

## B2. Component architecture, folder layout and state

### B2.1 Folder layout (proposed)

```
web/
  index.html                 # shell (title per route injected by the route-shell build step)
  public/
    sw.js                    # COOP/COEP isolation SW, scope /lizard/
    404.html                 # generated from the shell + fallback snippet
    solver/                  # worker.js (Lizard copy), solver.zip, *.wasm (hash-named)
  src/
    app/                     # router, providers, layout shell, error boundaries, route table
    routes/                  # one folder per route: study/, practice/, analyze/, solve/, reports/, ranges/,
                             #   tournaments/, library/, settings/, help/ ; each: Route.tsx, loader.ts, search.ts
    engine/                  # GameEngine registry (B4): core/ (types), nlhe/, plo4/ (later), fixtures/
    solver/                  # SolverClient (B3): client.ts, scheduler.ts, cache.ts, transports/, types.ts, schema/
    library/                 # index/manifest loading, .bin decoders (port of drills.decode / flop_library format)
    hh/                      # hand-history parsers (port of hh.js) + site adapters
    storage/                 # IDB wrapper, migrations/, repositories (hands, sessions, ranges, progress, settings)
    stores/                  # Zustand stores (B2.3)
    components/
      poker/                 # PlayingCard, CardPicker, BoardCards, RangeMatrix, ComboMatrix, ActionFrequencyBar,
                             #   ActionEVTable, ActionHistory, HandTimeline, PokerTable, Seat, ChipStack, PotDisplay,
                             #   StrategyBreakdown, EquityChart, SolutionSelector, SolverSettings, SolverProgress,
                             #   ProvenanceBadge, ConvergenceBadge, TrainingFeedback, TrainingStats
      ui/                    # wrapped primitives: Button, IconButton, Dialog, Popover, Menu, Tabs, Tooltip, Select,
                             #   Slider, ToggleGroup, Switch, Toast, ResizableWorkspace, VirtualList, EmptyState,
                             #   Skeleton, Unavailable (honest "not supported" state)
      charts/                # in-house SVG: BarStack, Histogram, LineSeries, Scatter, axes (d3-scale)
    theme/                   # tokens.css (CSS variables), tailwind preset, action color resolver
    lib/                     # encoding (share links), formatting (bb, %, chips), hashing, logging
  tests/                     # vitest unit + golden fixtures; playwright e2e at 1440/1024/390 px
```

### B2.2 Shared poker components (contracts) [I]

- **`RangeMatrix`**
  - Props: `{ grid: ClassGrid; colors: ActionColorMap; mode: 'strategy'|'ev'|'equity'|'weight'|'compare';
    heightMode: 'weight'|'full'|'normalized'; selected?: HandClass; highlight?: HandClass; onSelect;
    onHover }`.
  - Renders a WAI-ARIA `grid` with 13 rows × 13 `gridcell`s and a roving `tabindex`. Arrow, Home, End, PageUp and
    PageDown move the focus, Enter/Space selects, and Escape clears.
  - Each cell's accessible name reads like "AKs, 4 combos, bet 75% 62%, check 38%".
  - The readout is an `aria-live="polite"` region.
  - Each cell is a single element with a CSS `linear-gradient` background built from the frequencies. That is 169
    elements per render instead of the legacy ≈845 [I].
  - It takes an engine-provided `RangeModel` (B4), so a PLO grid can swap in.
- **`ComboMatrix`**: the 4×4, 4×3 or 6-combo suit breakdown for one class. The same grid semantics.
- **`ActionFrequencyBar`**: one stacked bar plus a legend. Text percentages are always present, so colour is never
  the only signal, and each segment has a 2 px separator.
- **`ActionEVTable`**: a sortable table with `freq`, `EV (bb)`, `ΔEV vs best`, and the `rough` marker. Numbers use
  tabular figures.
- **`PokerTable`**: an SVG or CSS layout for 2–9 seats driven by `engine.seatLayout(n)`, with a portrait layout for
  phones. The action buttons sit in a bottom sheet on mobile.
- **`SolverProgress`**: shows the stage text, elapsed time against the budget, the convergence trend, the latest
  partial, and a Cancel button. The bar is labelled "estimate" whenever it comes from the budget, as in legacy.
- **`ProvenanceBadge`**: renders the `Provenance` union (B3) with honest wording, for example "Presolved library ·
  0.08% exploitable", "Fresh solve · 8.1 s · 0.22%", "Approximate (preflop chart)" or "Heuristic (multiway)". It
  never shows exploitability unless the value was computed.

### B2.3 Zustand stores (one store per domain, not one global store) [I]

| Store | State | Persistence |
|---|---|---|
| `useSettings` | Theme, action colours, four-colour deck, density, default accuracy, units (bb or chips), keyboard map | IDB `settings` via a small `persist` adapter. A versioned `migrate` |
| `useLayout` | Panel sizes and collapsed state per route | IDB `settings` (device-only flag) |
| `useStudy` | Current spot, board, node path, selected class or combo, view mode, filters | URL is the source of truth for spot, board, line and h; the store mirrors it (one-way sync from the router) |
| `usePractice` | Table state (engine `GameState`), score, streak, review queue | IDB `progress` (per session) |
| `useAnalyze` | Filters, selection, import job progress | IDB-backed repositories; the store holds the query only |
| `useSolverJobs` | Job map `{id → {status, progress, partial, result, error}}` from `SolverClient` events | Memory only. Results live in the `SolverClient` cache |
| `useLibrary` | Manifest/index status, coverage, fetch errors | Cache API (`lizard-lib-v1`) + memory |

- Large data, such as hands, sessions and report rows, **does not live in Zustand**. Components query repositories,
  for example `useHands(query)` built on `useSyncExternalStore` or TanStack Query, and the stores hold ids and
  filters only. This keeps re-renders local and lets lists virtualize [I].
- The game engine is the only place betting rules exist. Stores call `engine.apply(state, action)` and never
  compute pots themselves.

### B2.4 IndexedDB: `lizard` database, versioned schema and migrations [I, built on the legacy V patterns]

- Database `lizard`, starting at `DB_VERSION = 1`. Records keep the legacy envelope (A2.2) and add `schema`:
  `{ id, schema, v: 1, created, updated, dev, data, deleted? }`. `v` is the record-format version and `schema` is a
  per-store data version such as `"hand@2"`.

| Store | keyPath | Indexes |
|---|---|---|
| `meta` | `id` | — (device id, `migrated` flags, last backup) |
| `settings` | `id` | — |
| `hands` | `id` | `updated`, `sessionId`, `tags` (multiEntry), `source`, `sig` (unique), `game` (`nlhe`/`plo4`) |
| `sessions` | `id` | `started`, `site` |
| `ranges` | `id` | `updated`, `tags` (multiEntry) |
| `progress` | `id` | `kind` (drill, practice), `updated` |
| `solves` | `key` (canonical request hash) | `lastUsed` (for LRU eviction under a byte budget; stores result JSON + provenance) |
| `outbox` | `seq` (autoIncrement) | — (future sync; tombstones appended here) |

- **Migrations** are an ordered array, `migrations: Array<{ to: number; upgrade(db, tx): void; data?(tx):
  Promise<void> }>`:
  - Structural changes run inside `onupgradeneeded`, one step at a time from `oldVersion + 1`.
  - Data rewrites are idempotent and resumable, tracked in `meta.migrated`, and run after open.
  - Each migration has a fixture-based test (fake-indexeddb under Vitest).
  - On `onversionchange` the old tab closes its connection and shows "Lizard was updated in another tab, reload".
  - `onblocked` is surfaced to the user.
- **Optional legacy import** (Settings → "Import from GTO Solver"): opens `gto-store` **without a version
  argument**, so it can never trigger a legacy upgrade [I]. It reads `hands` and `sessions`, maps them through the
  engine's legacy-state adapter, de-duplicates by `sig`, and never writes to legacy databases.
- `localStorage` holds only `lizard:boot` (theme and density, read synchronously to avoid a flash of the wrong
  theme) and `lizard:isolate` in sessionStorage.
- Backup is a single JSON file `lizard-backup-<date>.json` holding the envelope records, and it excludes secrets
  such as any API keys.

## B3. `SolverClient` (typed, transport-pluggable)

### B3.1 Types

```ts
// src/solver/types.ts — the request/response contract. Every field maps to the legacy payload (A3.3) or result (A3.4).

export type GameId = 'nlhe' | 'plo4';
export type Street = 'preflop' | 'flop' | 'turn' | 'river';
export type SeatId = 'UTG' | 'UTG1' | 'UTG2' | 'LJ' | 'HJ' | 'CO' | 'BTN' | 'SB' | 'BB';   // gto/preflop.py:17-25

export type HistoryAction =
  | { pos: SeatId; action: 'fold' | 'check' | 'call' | 'all-in' }
  | { pos: SeatId; action: 'bet'; amount: number }      // bb
  | { pos: SeatId; action: 'raise'; to: number };       // bb, raise-to

export interface SpotSpec {
  game: GameId;
  players: number;                    // 2..9
  hero: SeatId;
  hole: string;                       // "AhKd" (NLHE), 8 chars for PLO4
  board: string;                      // "" | "Ks7d2c" | +turn | +river
  stack: number;                      // bb
  stacks?: Partial<Record<SeatId, number>>;
  ante?: number; straddle?: boolean;
  rake?: { rate: number; capBb?: number };
  tournament?: { payouts?: number[]; field?: { players: number; chips: number }; bounties?: Record<string, number> };
  history: Record<Street, HistoryAction[]>;
  tree?: { sizes?: Partial<Record<'flop' | 'turn' | 'river' | 'raise', number[]>>; optimizeSizes?: boolean };
  ranges?: Partial<Record<SeatId, string>>;        // range text, e.g. "22+,A2s+,KTo+"
  locks?: Record<string, unknown>;                  // node locks (gto/exploit.py shape), typed later
  opponents?: 'gto' | 'pool';
}

export type Accuracy =
  | { mode: 'instant' }                              // library / cache / approximate only; never starts a solve
  | { mode: 'quick' | 'fast' | 'accurate' }          // legacy presets → BUDGETS/QUICK_BUDGETS per transport
  | { mode: 'custom'; budgetSec: number; priorBudgetSec?: number; targetExploitPct?: number };

export type SolveKind = 'advise' | 'play' | 'presolve' | 'prefetch' | 'study' | 'preflopSolve' | 'breakdown';

export interface SolveRequest {
  kind: SolveKind;
  spot: SpotSpec;
  accuracy: Accuracy;
  play?: { seat: SeatId; hole: string; seed?: number };   // kind 'play'
  presolveSeat?: SeatId;                                   // kind 'presolve'
  wantPartials?: boolean;                                  // legacy `early`
  priority?: 'interactive' | 'background' | 'speculative'; // default interactive
  timeoutMs?: number;                                      // hard client-side deadline (legacy has none)
  signal?: AbortSignal;
  dedupeKey?: string;                                      // default: canonicalKey(kind, spot, accuracy)
}

export type ProvenanceKind =
  | 'library'          // validated presolved entry (index hash matched)
  | 'solve'            // fresh numerical solve this session
  | 'cache'            // a previous solve's result reused (same key or slower speed)
  | 'preflop-chart'    // tuned approximate preflop chart
  | 'icm-adjusted'     // ICM risk-premium adjustment applied
  | 'multiway-heuristic'
  | 'rules'            // betting-rules narrowing, not solved
  | 'unsupported';

export interface Provenance {
  kind: ProvenanceKind;
  transport: 'pyodide-worker' | 'http-local' | 'http-jobs';
  engineVersion: string;              // worker ?v= hash / server build id
  library?: { spot: string; flop: string; hash: string; indexFormat: number; treeModelVersion: number };
  solver?: { iterations: number; seconds: number; exploitabilityPct?: number; targetPct?: number;
             approximate?: boolean; threads: number; core: 'wasm-mt' | 'wasm' | 'numpy' | 'native' };
  offSolution?: Array<{ why: 'rare' | 'filled' | 'rules' | 'unsettled'; pos: SeatId; street: Street; [k: string]: unknown }>;
  tree: { actions: string[]; sizes?: unknown };
  notes: string[];
}

export interface ActionRow { action: string; freq: number; evBb: number | null; amountBb: number | null;
                             gtoFreq?: number; roughEv?: boolean }
export interface ClassGrid { actions: string[]; cells: Record<string, { w: number; f: number[] }> }   // strategy_grid

export interface Advice {
  schema: 'advice@1';
  street: Street; hero: SeatId; villain?: SeatId; position?: 'IP' | 'OOP'; players: number;
  hand: string; board: string; potBb: number; toCallBb: number; stackBb: number;
  actions: ActionRow[]; recommended: string;
  grid?: ClassGrid; villainGrid?: ClassGrid; rangeActionFreq?: Record<string, number>;
  heroRangeCombos?: number; villainRangeCombos?: number;
  breakdown?: unknown;                 // typed when ported
  provenance: Provenance;
  raw: unknown;                        // the untouched legacy result, for debugging and forward compatibility
}

export type SolveEvent =
  | { type: 'queued'; position: number }
  | { type: 'status'; stage: 'runtime' | 'numpy' | 'solver' | 'library' | 'solving'; text: string; setup?: Record<string, number> }
  | { type: 'progress'; elapsedSec: number; estimateSec: number; fraction: number; estimated: true }  // client estimate (legacy)
  | { type: 'progress'; elapsedSec: number; iterations: number; exploitabilityPct?: number; estimated: false } // when the worker reports it
  | { type: 'partial'; advice: Advice }
  | { type: 'result'; advice: Advice }
  | { type: 'error'; error: SolverError };

export type SolverError =
  | { code: 'cancelled'; by: 'user' | 'superseded' | 'navigation' | 'other-tab' }
  | { code: 'timeout'; afterMs: number }
  | { code: 'runtime-load-failed'; detail: string }        // Pyodide/CDN/solver.zip fetch
  | { code: 'worker-crashed'; detail: string; restarted: boolean }
  | { code: 'stuck'; afterMs: number }                     // watchdog (legacy STUCK_S = 15)
  | { code: 'out-of-memory'; heapMb?: number }
  | { code: 'unsupported'; feature: string }               // e.g. PLO4 postflop solve, >3-way solve
  | { code: 'invalid-request'; issues: string[] }          // engine validation before sending
  | { code: 'solver-exception'; message: string }          // legacy {error}: last 3 traceback lines
  | { code: 'transport'; status?: number; detail: string }; // http transports

export interface SolveHandle {
  id: number;
  events: AsyncIterable<SolveEvent>;          // or subscribe(cb)
  result: Promise<Advice>;                     // rejects with SolverError
  cancel(reason?: 'user' | 'superseded' | 'navigation'): void;
}

export interface SolverCapabilities {
  games: GameId[];
  partials: boolean; presolve: boolean; prefetch: boolean;
  cooperativeCancel: boolean;                  // SAB stop flag available (crossOriginIsolated)
  threads: number;                             // HELPERS + 1, 1 when not isolated
  maxPlayersSolved: number;                    // 2 HU, 3-4 via mwcore; heuristic beyond
  accuracyModes: Accuracy['mode'][];
}

export interface SolverClient {
  readonly capabilities: Promise<SolverCapabilities>;
  readonly state: 'idle' | 'loading' | 'ready' | 'failed';
  warm(): Promise<void>;                                   // start runtime download early (route-level)
  solve(req: SolveRequest): SolveHandle;
  prefetch(spot: SpotSpec): void;                          // legacy {prefetch}
  cancelAll(reason?: 'navigation'): void;
  onStatus(cb: (e: Extract<SolveEvent, { type: 'status' }>) => void): () => void;
  dispose(): void;
}

export interface Transport {
  readonly name: Provenance['transport'];
  capabilities(): Promise<SolverCapabilities>;
  start(): Promise<void>;
  send(id: number, req: SolveRequest, emit: (e: SolveEvent) => void): Promise<Advice>;
  cancel(id: number | 'all'): 'cooperative' | 'restart' | 'unsupported';
  dispose(): void;
}
```

### B3.2 Behaviour [I, mapped to the legacy V behaviour]

- **One singleton** is created outside React (`src/solver/client.ts`) and exposed through a context. React components
  subscribe through `useSolve(req)` / `useSolverJobs`. React state never holds a `Worker`, so StrictMode
  double-mounting cannot create two runtimes.
- **Scheduler.** The Python solver is single-threaded per request, so only one request runs at a time.
  - Queue priority: `interactive` > `background` (Practice look-ahead, report prefetch) > `speculative` (presolve).
  - A new `interactive` request **supersedes** older interactive requests that have the same `scope`, such as
    `study`, `practice-table-2` or `solve-form`. They get the error `cancelled: 'superseded'`, and a cooperative
    stop is used where one is available. Legacy did the same with `solveGen` and `lastKey`.
  - Speculative work is stopped by any interactive request, by `visibilitychange` to hidden, and by `pagehide`, as in
    legacy.
- **Keys and cache.** `canonicalKey` is a stable hash of the canonical JSON of the spot, accuracy and kind, with
  object keys sorted like the legacy `canon`.
  - Results are kept in an in-memory LRU, sized by entry count and approximate byte size. The IDB `solves` store
    keeps them across sessions with LRU eviction under a byte budget.
  - The "slower speed answers faster" rule (`keyFor`) is kept: an Accurate result satisfies a Fast request, and a
    Fast result satisfies a Quick one.
- **Cancellation.**
  - On an isolated page, the client writes the shared `Int32Array` (`STOP[0]`/`STOP[1]`) exactly as legacy did.
  - Otherwise it uses `restart`: terminate, respawn, and replay the queue.
  - While the runtime is loading it sends `{cancel: id}`.
  - The watchdog is kept: ping after a stop, restart at 15 s.
  - `AbortSignal` is wired to `cancel('user')`.
- **Timeouts** (new). `timeoutMs` defaults to `budget × 1.5 + 30 s`, with a startup allowance on the first call. On
  expiry the client stops the request, raises `timeout`, and keeps the worker if the stop flag answers.
- **Progress** (incremental).
  - Phase 1 keeps the legacy client estimate and emits it with `estimated: true`. The UI must label it.
  - Phase 2 extends `worker.js` additively with `{id, progress: {iterations, exploitabilityPct, elapsed}}` from
    `Advisor.progress` looks. Older workers simply do not send it.
- **Provenance mapping** from the legacy result:

  | Legacy result field | Provenance |
  |---|---|
  | `precomputed` | `library` |
  | `solver.exploitability_pct` | `solve` |
  | `solver.approximate` | Keeps `solve` but sets `approximate: true` |
  | `multiway && !solved` | `multiway-heuristic` |
  | Preflop answers from charts | `preflop-chart` |
  | `off_solution` | Copied through |

  Unknown shapes become `unsupported`, and `raw` keeps the original result.
- **Transports.**
  - `pyodide-worker` is the default. It uses a Lizard copy of `worker.js` with three additive changes:
    1. cache name `lizard-solver-v1`, and eviction by full URL prefix (fixes the A2.4 collision);
    2. a `schema` field on replies;
    3. optional progress messages.

    All existing message shapes stay identical, so the legacy test patterns still apply.
  - `http-local` works against `gto/server.py` (`/advise`, `/play`, `/cancel`). It is only for development, because
    an https page calling `http://127.0.0.1:8765` raises mixed-content and private-network-access questions that
    need browser testing [I], and because of the server's single global lock and cancel (A3.1).
  - `http-jobs` is a future remote compute API: `POST /jobs`, then `GET /jobs/:id/events` as SSE, then
    `DELETE /jobs/:id`. It maps onto the same events.
- **Validation before send.** `engine.validate(spot)` returns `invalid-request` issues before any message is posted,
  for example 3 board cards plus turn actions but no turn card, or a duplicated card.

## B4. `GameEngine` abstraction (NLHE now, PLO4 later)

```ts
// src/engine/core/types.ts
export interface GameEngine<S extends GameState = GameState> {
  id: GameId;                                 // 'nlhe' | 'plo4'
  label: string;
  holeCards: 2 | 4;
  bettingStructure: 'no-limit' | 'pot-limit';
  seatNames(players: number): SeatId[];       // legacy SEATS (index.html:836 == gto/preflop.py:17)
  seatLayout(players: number, orientation: 'landscape' | 'portrait'): Array<{ seat: SeatId; x: number; y: number }>;
  initialState(setup: TableSetup): S;
  legalActions(state: S): LegalAction[];      // includes min/max sizes; pot-limit max for PLO
  apply(state: S, action: HistoryAction): S;  // pure; throws EngineError on illegal
  toAct(state: S): SeatId | null;
  street(state: S): Street;
  pot(state: S): { total: number; committed: Record<SeatId, number>; sidePots: number[] };
  validate(spot: SpotSpec): string[];
  rangeModel: RangeModel;                     // how ranges are shown and edited
  evaluate?(hole: string, board: string): HandRank;   // NLHE: best 5 of 7; PLO4: exactly 2 hole + 3 board
  toSolverSpot(state: S, hero: SeatId, hole: string): SpotSpec;   // the only path into SolverClient
  fromLegacy?(legacy: unknown): S;            // legacy page state S / hand records
  capabilities: { solve: boolean; library: boolean; practice: boolean; reports: boolean };
}

export interface RangeModel {
  kind: 'matrix-13x13' | 'filter-tree';       // NLHE: 169 classes; PLO4: 16,432 suit-isomorphic starting hands
  classes(): string[];                        // NLHE: "AA".."32o"
  combosOf(cls: string): string[];            // NLHE: 6 / 4 / 12
  parse(text: string): Map<string, number>;   // "22+,A2s+,KTo+" -> weights
  format(weights: Map<string, number>): string;
}
```

- Registry: `engines: Record<GameId, () => Promise<GameEngine>>`, lazily imported so the PLO4 code is not in the NLHE
  bundle.
- Persisted records, share links and solve keys all carry `game`. A record without `game` migrates to `'nlhe'`.
- Components take the engine from context and branch on **capabilities, not on the game id**. For example,
  `RangeMatrix` renders only when `rangeModel.kind === 'matrix-13x13'`, and PLO4 gets a `RangeFilterPanel` instead.
  `PokerTable` gets the hole-card count from `holeCards`.
- **Single source of rules.** The NLHE engine is a TS port of the legacy betting state machine, validated against
  committed golden fixtures generated from the Python advisor and the legacy `engine.test.js` cases. It covers seat
  order for 2–9 players, short all-in calls, min-raise rules, straddles, antes, and side pots. The UI never computes
  pots or legal sizes itself (`IMPLEMENTATION_PLAN.md` §3).
- PLO4 adds `plo4/` with pot-limit sizing, a 4-card evaluator (exactly two hole cards plus three board cards), and
  a `filter-tree` range model. `SolverCapabilities.games` reports `'unsupported'` until the solver track ships.
  Nothing in `nlhe/` changes.

## B5. Libraries, budget and performance

### B5.1 Accessible primitives: Radix Primitives vs React Aria [I]

| | Radix Primitives | React Aria (Components) |
|---|---|---|
| Model | Unstyled components (Dialog, Popover, DropdownMenu, Tabs, Tooltip, Slider, ToggleGroup, ScrollArea, …) | Hooks plus unstyled components with very thorough a11y and i18n, including grid, table, date and drag-and-drop |
| Fit with Tailwind | Excellent (data-state attributes). A large ecosystem of copy-in recipes | Good (render props, data attributes) |
| Grid or table semantics | None. The matrix is custom-built | Has `GridList`/`Table` with keyboard navigation, but a 13×13 two-dimensional strategy grid is still custom |
| Size | Per-package. Small for the 6–8 primitives needed | Larger when the full components package is used |

**Choice: Radix Primitives** for overlays, menus, tabs, sliders and toggles, wrapped in `components/ui/`, plus a
custom WAI-ARIA grid for `RangeMatrix`/`ComboMatrix` with roving tabindex. If the data tables in Analyze need
complex keyboard selection, add React Aria's `Table` to that route's chunk only. Exact sizes and versions are not
verified here, because no packages were installed. Pin exact versions during scaffolding.

### B5.2 Charts and virtualization [I]

- **In-house SVG** for every strategy visual: frequency bars, matrix legends, report histograms, EV and equity
  distributions. It uses `d3-scale` and `d3-shape` only, and draws axes by hand. That keeps styling and colour tokens
  consistent.
- If time-series analytics (session results over time) need zooming, add **uPlot**, a canvas library, to `analyze/`
  only. Avoid heavy declarative chart libraries.
- **TanStack Virtual** for the 1,755-row report tables and for hand lists that can run to tens of thousands of rows
  after a large import.
- **DOM vs canvas:**
  - The 13×13 matrix stays in the DOM, at 169 elements (B2.2), because it needs focus and accessible names.
  - Canvas is used for dense scatter plots, such as every flop by EV against equity, or every combo in a "Manhattan"
    plot, and for PLO4's large combo views. Each canvas has an accessible table fallback.

### B5.3 Bundle budget (targets, enforced in CI with a size check) [I]

| Chunk | Budget (gzip) |
|---|---|
| Shell: React, router, Zustand, theme, layout, Overview | ≤ 150 KB JS, ≤ 25 KB CSS |
| Study route | ≤ 90 KB |
| Practice route | ≤ 90 KB |
| Analyze route, without uPlot | ≤ 110 KB |
| Each other route | ≤ 60 KB |
| HH parsers (lazily loaded with the import) | ≤ 40 KB |
| Engine NLHE | ≤ 25 KB |

- Fonts are self-hosted WOFF2 variable files (≤ 60 KB each), or the system stack.
- Pyodide, numpy, `solver.zip` and the wasm cores load **only inside the worker**. The worker's own status text puts
  that at about 25 MB on the first visit, counting numpy's 12 MB [V: `worker.js:43,160`].
  - `SolverClient.warm()` starts it when the user opens Study, Practice or Solve, or when they hover the nav to one
    of them. It never starts on the Overview.

### B5.4 Worker isolation, COOP/COEP and the main thread [I unless marked]

- **Nothing numeric runs on the main thread.** That includes the `.bin` decoding (`drills.decode`). Decoding a large
  report or entry batch goes in a small separate "data worker" so the solver worker stays free for solves.
- `report.json` parsing (≈438 KB) on the main thread takes tens of milliseconds and is acceptable. Gzip is handled
  by the browser.
- **Service worker** `/lizard/sw.js`, registered with `scope: '/lizard/'`:
  - It is the same pattern as legacy `sw.js` [V]: add COOP `same-origin` and COEP `require-corp` to `navigate` and
    `worker` responses.
  - Its isolate-once flag is `sessionStorage['lizard:isolate']`, with the 4 s timeout and a single reload.
  - It must not cache-intercept anything else at first. Avoid a second caching layer until the data story is stable.
  - Under COEP `require-corp`, every cross-origin subresource needs CORS or CORP. Legacy loads Pyodide from jsDelivr
    this way in production, which shows the CDN headers work [V by deployment]. Any new third-party asset, such as
    fonts or analytics, must be checked.
  - Recommendation: no third-party runtime assets except the pinned Pyodide. Self-hosting Pyodide's needed files
    under `/lizard/pyodide/` is the fallback if the CDN causes trouble.
- Same-origin library data at `/gto-solver-library/` and `/lizard-library/` is COEP-clean [X].
- **Memory:** the heap peaks at 490–566 MB per answer, and kept solves are capped at 700 MB [M: README].
  - Only one solver worker exists per tab. A second Lizard tab gets a "solver busy in another tab" notice through a
    BroadcastChannel `lizard` lease, not a second 0.5–1 GB runtime [I].
  - Multi-table practice shares the one worker through the scheduler, as legacy `multitable.js` does.

## B6. Lizard visual language

### B6.1 Principles [I]

- Dark by default, dense but readable, with tabular numerals everywhere numbers align.
- Every colour-coded fact also has a text or shape channel: percentages in bars, letter tags (`F`/`X`/`C`/`B33`/
  `B75`/`R`/`AI`) in legends and on hover, and an optional hatch pattern for all-in.
- An original identity: Lizard green as the brand accent, a slate-blue fold, teal passive actions, an aggression
  ramp from amber to crimson to plum, and a violet all-in.
- Do not reuse any competitor's logos, mascots, names, iconography, screenshots, layouts copied wholesale, or exact
  colour themes. The sibling inventory notes that GTO Wizard's action colours are user-customizable [X:
  `02-gtowizard-inventory.md:103,110`]. Lizard can offer the same capability without copying a specific preset.
- Before launch, run a side-by-side visual check against current competitor screenshots to confirm there is no
  accidental trade-dress similarity. It was not done here, because there was no web access in this task.

### B6.2 Tokens (proposed) with computed contrast and CVD separation [M: computed by
`/private/tmp/claude-501/-Users-mhan-Desktop-projects-lizard/2b1d9842-3cae-4ee2-a7bb-3a038f7fbada/scratchpad/palette.py`]

Surfaces:

| Token | Value |
|---|---|
| `--lz-bg` | `#0B0F0E` |
| `--lz-surface-1` | `#121816` |
| `--lz-surface-2` | `#18211D` |

Text, with contrast on the background and on `surface-2`:

| Token | Value | On bg | On surface-2 |
|---|---|---|---|
| `--lz-text` | `#E6EDE9` | 16.21 | 13.86 |
| `--lz-muted` | `#9AA9A1` | 7.86 | 6.72 |
| `--lz-faint` | `#6F7E76` | 4.52 | 3.86 (large text and metadata only) |
| `--lz-brand` | `#B4E05A` | 12.63 | — |

Action colours. "Label ink" is the text colour that reads best on top of the action colour, with its contrast. "Vs
bg" is the action colour against the background.

| Token | Value | Label ink | Vs bg |
|---|---|---|---|
| `--lz-act-fold` | `#5E6E8F` | white 5.12 | 3.77 |
| `--lz-act-check` | `#2FB0A2` | dark 7.21 | 7.21 |
| `--lz-act-call` | `#23907F` | dark 4.93 | 4.93 |
| `--lz-act-bet-1` (smallest) | `#F2C14E` | dark 11.49 | 11.49 |
| `--lz-act-bet-2` | `#EE8A3A` | dark 7.65 | 7.65 |
| `--lz-act-bet-3` | `#D9502E` | dark 4.72 | 4.72 |
| `--lz-act-bet-4` | `#A8283F` | white 6.91 | **2.79** (needs a 1 px light separator on bg) |
| `--lz-act-bet-5` (largest) | `#7A1E52` | white 9.84 | **1.96** (same) |
| `--lz-act-allin` | `#7B4BE0` | white 5.35 | 3.60 |

- Check and call get **distinct** colours, unlike legacy's shared `--passive`. They never co-occur at one decision,
  but they do share a legend in aggregate reports.
- Minimum ΔE76 between actions that can appear at the same decision (actions faced and not faced, simulated with
  Machado 2009):

  | Vision | Minimum ΔE76 | Closest pair |
  |---|---|---|
  | Normal | 26.4 | bet-2/bet-3 |
  | Deuteranopia | **12.5** | bet-1/bet-2 |
  | Protanopia | 19.3 | bet-1/bet-2 |
  | Tritanopia | 16.8 (not facing a bet) / 18.6 (facing a bet) | — |

  The legacy palette's deuteranopia worst case was **2.8**, for fold vs all-in (A5.5).
- Size-to-shade assignment is deterministic. Sizes are sorted ascending and mapped onto `bet-1..bet-5`, spread
  across the ramp: 2 sizes take 1 and 4, 3 sizes take 1, 3 and 5. Users can override the colours in Settings, and
  overrides pass through a contrast check with a warning.
- Status colours (`--lz-good`, `--lz-warn`, `--lz-bad`) are separate from the action colours so grades never look
  like actions. Grade marks always carry a glyph and a word ("Best", "Inaccuracy", "Mistake") as well as colour.
- Cards: a two-colour deck by default and an optional four-colour deck. Suits always show their symbol, so suit is
  never conveyed by colour alone. The card face uses a high-contrast light background.
- Typography: a system UI stack by default, with an optional self-hosted OFL variable font. Body text is 13–14 px on
  desktop with tabular numerals, and the type scale moves in 2 px steps.
- Density settings: "Comfortable" or "Compact".
- Motion: 120–160 ms, disabled under `prefers-reduced-motion`.
- A light theme is a later toggle. All tokens are CSS variables, Tailwind is configured against them (no hard-coded
  hex values in components), and the theme lives on `:root[data-theme]`.

---

## Risks and open questions

1. **Single-threaded Python per tab.** The SAB stop flag needs cross-origin isolation. Without it, every cancel
   costs about a 1.5 s runtime reload plus re-solving the earlier streets (A3.5). Safari and private modes need
   testing [I].
2. **The library `.bin` format is a private binary** (`GTOFL3` magic, `flop_library.py:39`). A TS decoder must be
   golden-tested against the legacy `drills.decode` before Lizard relies on it for drills and reports.
3. **The heads-up libraries are partial** while they build (292/474 and 28/424 flops at the time of reading). The
   UI must show coverage from the published index, not from the builds.
4. **No result schema** exists in legacy answers. The adapter must preserve `raw` and tolerate unknown keys. A
   contract test (worker fixture → `Advice`) should run in CI.
5. **The legacy API key sits in same-origin localStorage.** Lizard must not read it, and should ship a strict CSP
   (`script-src 'self' https://cdn.jsdelivr.net` plus `'wasm-unsafe-eval'`) [I].
6. **Local server CORS `*` and its global cancel** make `http-local` a dev-only transport until the server gets an
   origin allowlist and per-request cancel tokens.

## Verification checklist for implementation (not run here)

- [ ] Playwright: every route in B1.1 opens directly (cold) and on refresh, at 1440/1024/390 px, with no horizontal
      overflow and with keyboard-only navigation of `RangeMatrix`.
- [ ] Storage isolation: a test origin with legacy `gto-*` data present. Lizard must leave legacy keys, databases and
      Cache entries untouched (diff before and after).
- [ ] Isolation: `crossOriginIsolated === true` on `/lizard/study/` after one reload, and the threaded core is used
      (`capabilities.threads > 1`).
- [ ] Contract: legacy worker fixtures → `Advice` with correct `Provenance` for library, solve, approximate, multiway
      and preflop results.
- [ ] axe-core: zero serious or critical violations on all routes. Contrast tokens are tested as in B6.2.
