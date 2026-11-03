# Lizard

Poker GTO study in the browser: browse equilibrium strategies node by node, preflop and postflop, for 2–9 handed
No-Limit Hold'em at any stack depth. The solver runs on your device (Python + NumPy and a compiled CFR core, in a Web
Worker via Pyodide); precomputed flop solutions answer instantly where they exist, and everything else is solved live.
No account, nothing uploaded.

Live at **https://www.michael-han.com/lizard/**.

Lizard is built on the GTO Solver engine (snapshot in [`solver/`](solver/), provenance in
[`solver/UPSTREAM.json`](solver/UPSTREAM.json)). What works today, honestly graded, is in
[`docs/FEATURE_MATRIX.md`](docs/FEATURE_MATRIX.md); what is next is in [`docs/ROADMAP.md`](docs/ROADMAP.md).

## Layout

| Path | What |
|---|---|
| `web/` | The app: React 19 + TypeScript + Vite, Tailwind, Zustand, IndexedDB (`idb`) |
| `web/src/solver/` | Typed solver client: worker and local-HTTP transports, cancellation, provenance |
| `solver/` | The solver snapshot (Python package `gto/`, C cores, tests). Changed only by declared patches |
| `scripts/build-solver-assets.mjs` | Builds `web/public/solver/` (worker, `solver.zip`, preflop files, manifest) from `solver/` |
| `scripts/postbuild.mjs` | Per-route `index.html` copies and `404.html`, so deep links work on GitHub Pages |
| `scripts/library/` | Assembles and publishes the precomputed library (`/lizard-library/`) |
| `docs/` | Audit, architecture, accuracy, deployment, progress; `docs/research/` holds the raw research |

## Develop

Needs Node 24 and a Python virtualenv at `.venv` with `numpy` and `treys` (for the solver bundle and its tests).

```bash
npm install
```

```bash
npm run dev
```

Opens http://localhost:5173/lizard/. The dev server proxies `/gto-solver-library/` and `/lizard-library/` to the live
site so library lookups work locally.

```bash
npm run check
```

Typecheck, lint and the web unit tests. `npm run build` produces `web/dist/`, and `npm run preview` serves it.

```bash
.venv/bin/python -m unittest discover -s scripts/library
```

Library assembler tests. The solver's own suites are `npm run test:solver` (about 12 minutes of CPU; some tests
need the library at `solver/gto/static/flop_library/`) and `npm run test:solver-js`.

### Faster flops: the local solver

Settings → Solver backend → Local Python solver, then run:

```bash
cd solver && PYTHONPATH=. ../.venv/bin/python -m gto.server --port 8765
```

## Deploy

Pushing to `main` runs `.github/workflows/deploy.yml`: checks, build, then GitHub Pages. The library is published
separately with `scripts/library/publish.sh`. Details, verification and rollback: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

Never run `solver/scripts/deploy.sh` or `deploy_library.sh`: they publish the legacy GTO Solver site and are guarded
to refuse from this snapshot.
