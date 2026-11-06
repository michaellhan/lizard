# Lizard architecture

Lizard is a static web app. All solving happens on the user's device. Accounts are optional and nothing needs one: an end-to-end encrypted sync service (`worker/`, `docs/SYNC_DESIGN.md`) is built and not yet deployed, and it's the only Lizard backend.
The numerical engine is the GTO Solver snapshot in `solver/`, reused unchanged behind a typed interface.

Status words in this document follow [FEATURE_MATRIX.md](FEATURE_MATRIX.md): what exists today is described as such,
and planned pieces are marked **(planned)**.

## 1. The pieces

```
 www.michael-han.com (GitHub Pages behind Cloudflare; one origin, several repos)
 ├── /lizard/                 this repo: web/dist (React app, sw.js, solver assets)
 │    ├── index.html, <route>/index.html, 404.html   deep links (scripts/postbuild.mjs)
 │    ├── sw.js               adds COOP/COEP (cross-origin isolation) and frame-ancestors to Lizard's pages
 │    └── solver/             worker.js, solver.zip, pf/*.bin, manifest.json (scripts/build-solver-assets.mjs)
 ├── /lizard-library/         michaellhan/lizard-library: 6-max library + heads-up builds (scripts/library/)
 ├── /gto-solver-library/     upstream's 6-max library (read-only for Lizard; fallback source)
 ├── /gto-solver/             the classic app (not this repo; nothing in Lizard links to it)
 └── /gto-solver-classic/     a frozen full copy of the classic app (not this repo)

 Browser
 ┌──────────────── main thread ────────────────┐      ┌──────── Web Worker (solver/worker.js) ────────┐
 │ React routes (web/src/features/*)           │      │ Pyodide 0.26.4 (CPython 3.12, numpy 1.26.4)   │
 │   └ useSolver() → SolverClient              │ post │ solver.zip: the gto/ package + treys          │
 │        queue · modes · AbortSignal ·        │─────▶│ Advisor.advise(state) / study                 │
 │        provenance on every answer           │◀─────│ core.wasm / core-mt.wasm (threaded CFR)       │
 │   └ Transport: WorkerTransport | Http…      │      │ mwcore*.wasm (multiway)                       │
 │ Zustand stores: settings, runtime           │      │ FlopLibrary / MWLibrary: fetch ?lib= base     │
 │ IndexedDB "lizard" (idb, migrations)        │      └───────────────────────────────────────────────┘
 └─────────────────────────────────────────────┘
          │ optional: Settings → Local Python solver
          ▼
   http://127.0.0.1:8765  solver/gto/server.py  (POST /advise, POST /cancel, GET /health)
```

## 2. Repository layout

| Path | Role |
|---|---|
| `web/src/app/` | `routes.ts` (the route table: path, label, status), `App.tsx` (router), `Shell.tsx` (layout, nav) |
| `web/src/features/` | One folder per area: `study`, `practice`, `analyze`, `solve`, `reports`, `compare`, `tournaments`, `library`, `ranges`, `saved`, `history`, `engine`, `settings`, `home` |
| `web/src/solver/` | The solver interface: `protocol.ts` (wire types), `types.ts` (public API), `client.ts`, `worker-transport.ts`, `http-transport.ts`, `provenance.ts`, `runtime.ts`, `useSolver.ts` |
| `web/src/engine/` | Game engines (`GameEngine`): NLHE cards and hand classes; PLO4 registered as unsupported |
| `web/src/library/catalog.ts` | Reads library indexes for coverage; resolves the library source |
| `web/src/data/db.ts` | IndexedDB schema and versioned migrations |
| `web/src/components/` | `RangeMatrix`, `ProvenanceBadge`, `EngineStatusPill`, action colors |
| `solver/` | The snapshot. Changed only by the patches in `solver/UPSTREAM.json` |
| `scripts/` | Asset build, postbuild, library assemble/publish |

## 3. The solver interface

Views never talk to the worker directly. They call `SolverClient.solve(request)` (`web/src/solver/client.ts`).

### 3.1 Request and result

```ts
interface SolveRequest {
  state: AdvisorState;        // the game state as gto/advisor.py reads it (players, stack(s), board, per-street actions,
                              // ranges, sizes, rake, payouts, locks... open-ended, see protocol.ts)
  mode?: "quick" | "fast" | "accurate";
  progressive?: boolean;      // ask for approximate answers while solving
  signal?: AbortSignal;       // cancel (queued or running)
  onPartial?: (r: SolveResult) => void;
}
interface SolveResult { data: AdvisorResponse; provenance: Provenance }
```

`applyMode(state, mode, transport)` (`client.ts:40`; a Study request's Quick becomes Fast in `effectiveMode`, `client.ts:33`) always sends `speed` (Quick sends "fast"), `budget` and
`prior_budget`: the seconds for this street, and for each earlier street solved to narrow the ranges. Without them
the browser worker's Advisor runs every mode at its default 4 s + 2 s (`advisor.py:2860`); the local server falls
back to its own `SPEEDS` (`native.py:85-92, 121-123`), the same numbers as below. The budgets are the legacy page's (`index.html:974-978`),
in `MODE_BUDGETS`:

- browser worker: Fast 8 + 3 s, Accurate 60 + 12 s;
- local server: Fast 2.5 + 2.5 s, Accurate 30 + 12 s;
- postflop Quick, either backend: also `quick: true`, with flop and turn 1.5 + 0.3 s, river 0.8 + 0.3 s.

A Study request (`study: true`) never carries `quick`: Quick runs it at Fast, as classic Study does, and the Study page
offers only Fast and Accurate. The client runs one request at a time, because each backend solves one at a time, and keeps the rest in a
FIFO queue. Aborting a queued request removes it at once. Aborting the running one goes to the transport.

### 3.2 Provenance

Every result and every partial result carries a `Provenance` (`provenance.ts`), derived from the response itself:

| `source` | When | Approximate? |
|---|---|---|
| `library` | `precomputed` present: a flop answered from the offline library | no, and its exploitability is shown; a borrowed spot (`precomputed.borrowed`, another table size's entry) is approximate, with its description and no exploitability |
| `library-turn` | a turn read from the flop library's stored turn strategies (`approximate.source` or `source` is "store") | always; the flop entry's numbers are not shown |
| `instant` | an answer at once read from another solution (`approximate.source` near, prev, unraked or offtree, or "solve" with `solver.by`: a 3-way read of an earlier decision's solve) | always; shows the Advisor's label, not the other solve's numbers |
| `live` | the solver ran iterations for this request, or a look at this street's own solve (`approximate.source` "solve", no `solver.by`) | if partial, a look, or `solver.approximate` (set on advice answers far over target; Study answers never carry it, `advisor.py:2982-2983, 3000`) |
| `charts` | a preflop node answered from the preflop charts | always; the badge says "Preflop charts", never "solved" |
| `preflop-solve` | a preflop equilibrium the solver computed (`pf_solve`) | as reported |
| `rules`, `equity` | fallbacks when a solve fails or is unsupported, and 5+-way flop or turn answers (`multiway` without `solved` or `solver`: a Monte Carlo heuristic) | always |
| `unknown` | none of the above | shown as "Unlabelled" |

The order of these checks matters; `docs/ACCURACY.md` §11 lists it.

It also carries the exploitability (% of pot) and target when computed, iterations, seconds, the library spot, the
fallback reason, the mode, the transport, the solver version (`<upstream commit>/<bundle hash>`) and the time it was
received. `ProvenanceBadge` renders it next to every answer.

### 3.3 Transports

`SolverTransport` (`types.ts`) has `request`, `prefetch`, `onStatus`, `status` and `dispose`. There are two:

**`WorkerTransport`** loads `solver/worker.js?v=<bundle hash>&lib=<library base>`. That is the upstream worker,
whose only change is a renamed cache (§5). Protocol (`protocol.ts`, verified against `solver/gto/static/worker.js`):

- page → worker: `{id, state, early}`, `{cancel: id}`, `{stop: SharedArrayBuffer}`, `{prefetch: state}`, `{ping}`;
- worker → page: `{status, setup}` (boot progress, then "Solving…" with timings and thread counts), `{id, partial}`,
  `{id, result}` (`result.cancelled` when stopped), `{id, error}`, `{pong}`.

Cancellation depends on isolation. When the page is cross-origin isolated, the transport writes the id into a shared
`Int32Array` that the solve polls between chunks of iterations. It stops within about 0.1 s and keeps its caches.
Without isolation, the transport terminates the worker and boots a new one on the next request (runtime from cache,
about 1.5 s). `stopCost()` says which of the two a stop means: `cheap` on an isolated worker and over HTTP, `kills`
otherwise.

A solve can be stuck where it can't read the shared flag, with every request waiting behind it. So after a stop on an
isolated page the transport pings the worker, unless it is still booting. With no pong in 15 s and the request still
unsettled, it terminates the worker and rejects the request as `stuck`, and the next request boots a new one (the
legacy guard, `index.html:1173-1189`).

A boot failure marks the status `failed` and rejects the request. The next request retries with a fresh worker.

What a worker has fetched ahead for a flop goes with it, so the transport keeps the flop last told and tells each new
worker, ahead of its first request.

**`HttpTransport`** posts the same `AdvisorState` to the user's own `gto.server` (`POST /advise`; `POST /cancel` to
stop; `GET /health` to probe). Long Python solves never run on a hosted service: there is no Lizard server, and
Cloudflare Workers are not used for solving.

### 3.4 Status

`RuntimeStatus` (`idle | booting | ready | busy | failed`, plus the message, boot timings, thread counts and
isolation) is published by the transport through the Zustand `useRuntime` store. `EngineStatusPill` (header) and the
Engine page (`/engine`) show it.

The store's `ensure` holds the one client for the settings. Settings can change while a call waits on the library's
HEAD, so only the last call begun may set the client: an older one builds nothing and answers with the last one's
client. A client is disposed only as another replaces it.

### 3.5 Errors

`SolverError.kind` is one of `cancelled`, `boot-failed`, `unreachable`, `solver-error`, `stuck` or `bad-request`.
Views show the message and keep the last good answer. A cancelled request shows "Stopped." A `stuck` rejection only
follows a stop: views show its message, and Practice's `Room` counts it in `restarts` and asks again whatever is still
wanted.

## 4. Game engines

`GameEngine` (`web/src/engine/types.ts`) describes a game to the UI: hole-card count, 2–9 seat layouts (the exact
seat names of `solver/gto/preflop.py`), the hand-class grid (13×13 for NLHE; `null` for PLO), card parsing, and
whether the solver supports it. NLHE is complete for the UI's needs. PLO4 is registered with `solverSupported:
false`, so the UI can say "not supported" instead of offering dead controls. The rules of the game (legal actions,
sizes, pot) are never re-implemented in the UI: every node's actions come from the Advisor's answer.

## 5. State and data

| What | Where | Notes |
|---|---|---|
| The hand being studied | URL query (`p`, `s`, `pre`, `b`, `flop`, `turn`, `river`) | every node is a shareable deep link (`studyState.ts`) |
| Settings | Zustand `useSettings`, persisted to IndexedDB `kv["settings.v1"]` | mode, backend, local URL, library source (default `auto`), EV unit |
| Runtime | Zustand `useRuntime` | the client, status, solver manifest, the library actually in use |
| Saved spots, sessions | IndexedDB stores `savedSpots`, `sessions` | schema in place (migrations 1–2); the UI that fills them is (planned) |

IndexedDB migrations (`data/db.ts`) are append-only. `MIGRATIONS[v]` upgrades version v−1 to v, and `db.test.ts`
opens version 1 with data and upgrades it.

Names are namespaced because Lizard shares its origin with the classic app and the homepage. The database is
`lizard`, the worker cache is `lizard:solver`, the reload flag is `sessionStorage["lizard.sw-reloaded"]`, and the
service worker's scope is `/lizard/`. Lizard never clears storage it does not own.

## 6. The precomputed library

The worker reads one library base (`?lib=`), so Lizard publishes one merged library at `/lizard-library/`:

- **6-max**: the snapshot's library (18 heads-up-to-the-flop spots, 552 or 1,755 flops each, turn files for 9 of them;
  4 three-way spots on 185 flops), a byte-identical copy of the published `/gto-solver-library/`.
- **Heads-up** `srp_sb_bb_2max` and `lp_sb_bb_2max`: copied from the offline builds in
  `gtosolver/.work`, as far as each has got. Only entries their index lists are copied, and each is validated on the copy.

`scripts/library/assemble.py` builds the stage. It treats the sources as read-only, checks every `.bin` against its
sha1 in the index and every turn file against the entry hash in its header, and checks `report.json` against the
index. It merges spots by id and by lookup key (range fingerprints, pot, stack), never publishes fewer flops than the
previous release, and checks the stage against GitHub Pages limits. `publish.sh` commits the stage to a persistent
clone and pushes only what changed.

At runtime, the worker looks entries up by range fingerprints, pot and stack, then by canonical flop and tree. The
heads-up fingerprints were checked against this snapshot's charts on 2026-11-03 and match: the snapshot computes
`be1e8f5e7b61b5b6`/`8e09a13ab78f9ab8` for `SB:r3,BB:c` (pot 6, stack 97) and `0df0279146642404`/`95616fa9f2a1d875` for
`SB:c,BB:x` (pot 2, stack 99), the values in the builds' indexes. A flop that is not in the library is
solved live; nothing in the UI depends on coverage. The settings default `auto` picks `/lizard-library/` when its
`index.json` answers, else `/gto-solver-library/` (`resolveLibrarySource`). The Library page reads three files with
`cache: no-cache`: both indexes, and `lizard-library.json` for each spot's planned flop count (`spots[id].target`,
null when a spot has no plan; then only the count is shown). New heads-up flops appear after each publish without an
app redeploy.

## 7. Routing, base path and deployment

- Vite `base` is `/lizard/` (override: `LIZARD_BASE`). The router's basename, the service worker's URL and scope, and
  the solver asset URLs all derive from `import.meta.env.BASE_URL`.
- GitHub Pages has no rewrites. `scripts/postbuild.mjs` writes `<route>/index.html` for every route in `routes.ts`, so
  a deep link answers 200, plus `404.html` (the same app, which renders Not Found) for anything else. It refuses a
  route that would shadow an asset folder (`assets`, `solver`).
- Pages answers `/lizard/study` with a 301 to `/lizard/study/`. The router matches both.
- CI (`.github/workflows/deploy.yml`) runs typecheck, lint, the unit tests, the assembler tests and the quick solver
  tests, then builds and deploys with `actions/deploy-pages`. See [DEPLOYMENT.md](DEPLOYMENT.md).

## 8. Security

- No secrets anywhere in the bundle or the repo. The classic app's AI-explanation proxy is not used by Lizard.
  If AI explanations come back, it will be through a server-side proxy that builds the prompt from validated fields
  **(planned)**.
- React rendering only; no `dangerouslySetInnerHTML`.
- Account sync seals records in the browser with keys from a passphrase the server never sees (`docs/SYNC_DESIGN.md`). The
  service's own keys are Worker secrets, in neither the bundle nor the repo. A request from any other origin is refused, and every write
  must carry a header a cross-site form can't set.
- The built pages carry a `<meta>` Content-Security-Policy: `default-src 'self'`; scripts from self only; workers
  from self and `blob:`; connections to self and the local solver. `sw.js` adds `frame-ancestors 'self'` and
  `nosniff` to navigations once installed.
- `main.tsx` moves plain-http visits to https before anything else runs. The host does not redirect, and the service
  worker, isolation and threads need a secure context.

## 9. Testing

| Suite | Command | What |
|---|---|---|
| Web unit (Vitest, jsdom) | `npm test` | study state and URL encoding, cards and classes, range text, provenance, client queue and abort, worker transport (fake worker: boot, partials, both cancel paths, a stop nobody answers, boot failure), IndexedDB migrations (fake-indexeddb), library catalog, RangeMatrix accessibility |
| Assembler | `.venv/bin/python -m unittest discover -s scripts/library` | validation, shrink protection, refusing foreign or protected output, sources untouched |
| Solver (upstream) | `npm run test:solver`, `npm run test:solver-js` | 686 Python and 443 Node tests at `1a14605e`; about 15 minutes of CPU, and some need the library |
| Browser (Playwright) | `npm run test:e2e`, after `npm run build`, through the slot here | every route at 1440, 1024 and 390 px (no sideways scroll, no error logged, screenshots in `web/e2e-results/shots` to look at), every nav link, and on the real worker a Study spot, its action and link, a graded Practice decision, an import, and a worker that goes quiet in boot. No library behind the preview server, so library answers are still checked by hand, as are the Engine self-test and CSP |

CI runs the first two suites, the browser suite, and the solver tests that need neither the library nor minutes of CPU
(`test_bundle`, `test_routes`, `routes.test.js`, `solver_state.test.js`).

## 10. Decisions

| Decision | Why |
|---|---|
| Reuse the upstream worker with declared build-time edits (`scripts/pyodide/worker-edits.mjs`: the cache name and where Pyodide is read from) | It is the tested host of the Advisor. Pyodide itself is served from `/lizard/solver/pyodide/`, each of its six files checked against a pinned SHA-256 at build (`scripts/pyodide/files.json`), so the browser makes no third-party request in the origin that holds the hands |
| One merged library repo, not a composite client | The worker takes one base. Merging offline keeps the worker unchanged and lets each publish be validated as a whole |
| Private `lizard` repo, public Pages site | The solver has no license, and the snapshot includes C sources, calibration scripts and draft legal documents. The owner confirmed it on 2026-11-05. The site itself only exposes what the classic site already does, which includes the engine's readable Python in `solver.zip`, as the in-browser solver needs it; the owner accepted that the same day |
| Static hosting for the site | Solving runs on the device. A server would add cost, secrets and accounts without making solves more accurate |
| Sync as a separate Worker, off unless built in | The owner chose optional accounts for sync alone (2026-11-06). The site stays static and whole without it, and the server can read nothing |
| Port classic features into React one by one, link to the classic app meanwhile | An honest placeholder beats a dead button. The engine features exist; only their UI needs porting. The last such link, on the Solve page, went in Phase 1, once Study had locks and automatic sizing |
