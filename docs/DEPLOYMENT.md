# Deploying Lizard

Lizard is two GitHub Pages project sites under the account's custom domain, behind Cloudflare:

| URL | Repo | Published by | Pages source |
|---|---|---|---|
| https://www.michael-han.com/lizard/ | [michaellhan/lizard](https://github.com/michaellhan/lizard) (private) | `.github/workflows/deploy.yml` on every push to `main` | GitHub Actions |
| https://www.michael-han.com/lizard-library/ | [michaellhan/lizard-library](https://github.com/michaellhan/lizard-library) (private) | `scripts/library/publish.sh`, run on this Mac | `main` branch, root |

Neither repo has a CNAME file. GitHub serves a project site without a CNAME under the user site's custom domain
(`www.michael-han.com`, set in `michaellhan/michaellhan.github.io`). So no DNS, Cloudflare or user-site change was
made, and none is needed. **Never add a CNAME file to either repo**: that would claim the whole domain for it.

Other paths on the domain belong to other repos and are not touched by any Lizard script: `/` (the homepage),
`/gto-solver/` (the classic app), `/gto-solver-classic/` (a frozen full copy of it) and `/gto-solver-library/` (its library).

Both repos are private, by the owner's decision of 2026-11-05, and Pages sites from private repos are public on this
account. The private repo keeps the tests, build scripts, research and history private. It doesn't keep the engine
private: `/lizard/solver/solver.zip` (695 KB) holds the readable Python, as it must to run in a visitor's browser, and the
classic site serves the same bundle. The owner accepted that on 2026-11-05.

## 1. The app

### How a deploy works

1. Push to `main` (or run the workflow by hand: `gh workflow run deploy -R michaellhan/lizard`).
2. `check-and-build` (Ubuntu 24.04, pinned because Playwright 1.56.1 has no Chromium for 26.04; Node 24, Python 3.12 with `numpy==2.0.2 treys==0.1.8`):
   - typecheck, lint, Vitest;
   - the library assembler's tests;
   - the solver's quick tests (`tests.test_bundle`, `tests.test_routes`, `routes.test.js`, `solver_state.test.js`);
   - `npm run build`:
     - `scripts/build-solver-assets.mjs` builds `web/public/solver/` from `solver/`: `worker.js` with the cache
       renamed, `solver.zip` from `solver/scripts/build_bundle.py`, `pf/*.bin`, and `manifest.json` whose version
       is `sha1(worker.js + solver.zip)[:10]`;
     - `vite build` with base `/lizard/` and the CSP meta tag;
     - `scripts/postbuild.mjs` writes `<route>/index.html` for every route, plus `404.html` and `.nojekyll`.
3. `deploy` uploads `web/dist` with `actions/deploy-pages`. Pages serves it about a minute later.

Pull requests run the checks and the build but do not deploy, and only `refs/heads/main` can reach the upload or the deploy.
Every action is pinned by commit, and `npm ci` runs with `--ignore-scripts`.

Source maps are off (`web/vite.config.ts`). The repository is private, so the build doesn't publish the app's source. Deploys
before `af72d22` did publish maps, and those were public while they were live.

### Pyodide is served from this site

The worker loads Pyodide 0.26.4 and NumPy from `/lizard/solver/pyodide/`, six files listed with their sizes and hashes in
`scripts/pyodide/files.json`. `scripts/pyodide/stage.mjs` downloads them from jsDelivr at build time, refuses any hash that differs,
and leaves them in the build only (they're gitignored). `scripts/postbuild.mjs` fails the build if the built worker names a
third-party host. The build edits the worker's Pyodide address, which `solver/UPSTREAM.json` declares under `build_time_edits`.

The cost is bandwidth: a first visit fetches about 25.7 MB from Pages, where it used to come from jsDelivr, and `web/dist` is
27.7 MB. The largest file is the 11.96 MB NumPy wheel, under Pages' file limit. To change the version, edit `files.json` with the
new hashes and re-run the tests in `scripts/pyodide/`.

Cloudflare injects its own analytics beacon (`static.cloudflareinsights.com`) into pages at the edge, a domain-wide setting of the
owner's that this repository doesn't control. It's there on the live site and absent from the local preview, so the browser test
"asks no host but this one" can't see it. Everything the app and its workers request themselves comes from this site.

The bundle is deterministic. The CI build and a local build of the same commit produce the same manifest version,
`3a94eea354` for the first deploy.

### Verify a deploy

GitHub Actions turning green is not the check. Fetch the site:

```bash
for p in "" study/ engine/ library/ solver/manifest.json solver/worker.js solver/pyodide/pyodide.asm.wasm sw.js no/such/page; do curl -s -o /dev/null -w "%{http_code} /lizard/$p\n" "https://www.michael-han.com/lizard/$p"; done
```

Expect 200 for everything except `no/such/page`, which is 404 but still serves the app (it renders Not Found).
The `.wasm` must come back as `application/wasm`, and the `.map` of the page's `assets/index-*.js` must be 404.

Pages serves HTML with `Cache-Control: max-age=600`, so a browser that visited before the deploy can run the previous
bundle for up to 10 minutes. The service worker caches nothing. To check a deploy at once, add any query string
(`/lizard/library/?fresh=<commit>`), and compare the page's `assets/index-*.js` with `web/dist/assets/` from a local
build of the same commit.
`/lizard/study` without the slash is a 301 to `/lizard/study/`; that is Pages' folder redirect, and the router
matches both.

```bash
for u in https://www.michael-han.com/ https://www.michael-han.com/gto-solver/ https://www.michael-han.com/gto-solver-classic/ https://www.michael-han.com/gto-solver-library/index.json; do curl -s -o /dev/null -w "%{http_code} $u\n" "$u"; done
```

These are the neighbours; all should be 200.

Then in a browser:
1. Open `https://www.michael-han.com/lizard/study/?p=6&s=100&pre=UTG%3Af%2CHJ%3Af%2CCO%3Af%2CBTN%3Ar2.5%2CSB%3Af%2CBB%3Ac&b=Ks7d2c`.
   The first visit reloads once while the service worker installs.
2. Check that `self.crossOriginIsolated` is `true`, the header pill reads "Engine ready · 8t" (or your core count),
   and the answer is badged "Precomputed solution · srp_btn_bb".
3. On `/lizard/engine/`, Run self-test should report "UTG's opening range answered".

The first deploy (commit `758e003`, 2026-11-03) passed all of this.

### Roll back

Revert on `main` and push. The workflow redeploys the previous state:

```bash
git revert <bad-commit> && git push
```

To redeploy an older commit without changing `main`, re-run that commit's workflow run, which rebuilds it:
`gh run rerun <run-id> -R michaellhan/lizard`.

## 2. The library

### What is published

One merged format-2 library, because the solver worker reads a single base URL:

- the 6-max library from `solver/gto/static/flop_library/` (gitignored here; a verified copy of
  `/gto-solver-library/`): 18 spots and 4 three-way spots;
- the heads-up spots from the offline builds in `/Users/mhan/Desktop/projects/gtosolver/.work/hu-lib` and
  `.work/hu-lp-lib`, as far as they have got. Whether or not a build is running, its output is only ever read.

`lizard-library.json` at the site root records what each publish contained: per-spot flop counts, file count, and any
flops left out by validation. Each spot also has a `target`, the flop count it is being built to, which the app's
Library page reads for its progress bars. It comes from the solver's `SPOT_FLOPS` (`solver/gto/flop_library.py`),
overridden by `BUILD_PLANS` in `assemble.py`. That override is where the heads-up SRP's extension to all 1,755 flops
is recorded. A spot with no plan gets `null`, and the page then shows only its count.

### Publish

```bash
scripts/library/publish.sh
```

It assembles `library-build/stage`, syncs it into the persistent clone `library-build/lizard-library`, commits only
what changed, pushes, and waits until the live `index.json` matches. `DRY_RUN=1` stops before the push. While the
builds run, launch it through the CPU slot helper:

```bash
/Users/mhan/Desktop/projects/gtosolver/.work/bin/slot.sh scripts/library/publish.sh
```

launchd now does this every 6 hours (§4), so by hand it's only for flops wanted sooner.

Cost: about 20 s of CPU to assemble (niced). The first push sent about 255 MB; later pushes send only new heads-up
files and the index (a few MB). Pages rebuilds the library site in a few minutes.

Guarantees, enforced by `assemble.py`:

- sources are opened read-only, and the output may not be inside `gtosolver/`;
- only indexed entries are copied, and each is validated after copying (sha1 for entries, the entry hash for turn
  files, the report hash);
- no spot ever has fewer flops than in the previous release;
- a source on a different tree or format is skipped;
- the stage stays under 50 MB per file, 900 MB in total and 60,000 files.

The tests are in `scripts/library/test_assemble.py`.

### When new heads-up flops appear

Run `publish.sh` again. The app needs no redeploy:

- the worker fetches `index.json` when it boots (GitHub Pages lets browsers cache it for up to 10 minutes);
- the Library page reads it with `no-cache`;
- a flop that is not published yet is solved live in the meantime.

A launchd job does this every 6 hours (§4).

### Roll back the library

The clone keeps history:

```bash
git -C library-build/lizard-library revert --no-edit HEAD && git -C library-build/lizard-library push
```

Never run `solver/scripts/deploy_library.sh`: it publishes to `michaellhan/gto-solver-library`, which belongs to the
classic app. It is guarded to refuse from this snapshot.

## 3. Known hosting issues (pre-existing, domain-wide, not changed by Lizard)

1. **The GitHub Pages certificate for `www.michael-han.com` expired on 2026-11-02**, and its ACME authorization is
   stuck (`gh api repos/michaellhan/michaellhan.github.io/pages` reports state `bad_authz`). The site still works over
   https because Cloudflare terminates TLS. If Cloudflare's SSL mode were set to "Full (strict)", every path on the
   domain would fail. Fixing it means re-requesting the certificate on the user site's Pages settings, possibly with
   Cloudflare's proxy briefly off; that is the owner's call.
2. **`http://www.michael-han.com/` is not redirected to https** (it serves 200). Lizard redirects itself in
   `main.tsx`. The fix is Cloudflare's "Always Use HTTPS" (SSL/TLS, Edge Certificates), which the owner chose on
   2026-11-05 and which only they can switch on. Check it with
   `curl -sI http://www.michael-han.com/lizard/ | head -3`, which should then answer 301 to https. The certificate in 1
   stays as it is for now, by the same decision.

## 4. Scheduled library publishing (installed 2026-11-05)

The owner approved this on 2026-11-05. launchd runs `publish.sh` on this Mac every 6 hours, through `slot.sh`, so it waits
for a CPU slot and for any heavy work of this repo's that holds one. A run with nothing new ends at "nothing changed since
the last publish"; a run that pushes holds its slot, idle, until the live index matches, at most 10 minutes. launchd
catches up once after the Mac has slept, and never starts a second run while one is going.

- The job: `scripts/library/com.michaelhan.lizard-library.plist`, installed as
  `~/Library/LaunchAgents/com.michaelhan.lizard-library.plist`.
- The log: `~/Library/Logs/lizard-library.log`.
- Run it now: `launchctl kickstart gui/$(id -u)/com.michaelhan.lizard-library`.
- See how the last run ended: `launchctl print gui/$(id -u)/com.michaelhan.lizard-library | grep "last exit"`.

Reinstall it after changing the file:

```bash
launchctl bootout gui/$(id -u)/com.michaelhan.lizard-library
cp scripts/library/com.michaelhan.lizard-library.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.michaelhan.lizard-library.plist
```

Remove it, when the builds are finished and published:

```bash
launchctl bootout gui/$(id -u)/com.michaelhan.lizard-library
rm ~/Library/LaunchAgents/com.michaelhan.lizard-library.plist
```

What the first runs found about this Mac, each as an error in the job's log or exit code:

| Setting | Why |
| --- | --- |
| launchd starts `/bin/bash`, which starts `zsh slot.sh` | Started directly, zsh can't read `~/Desktop` under launchd: "can't open input file". |
| `/usr/bin` before `/opt/homebrew/bin` on `PATH` | Homebrew's git fails under launchd: "Unable to read current working directory: Operation not permitted". Apple's git works, and has the keychain helper itself. |
| The log is in `~/Library/Logs` | `app.hclubs.refresh`, which logs under `~/Desktop`, exits 78 without starting. Lizard's was never tried there. |

## 5. Local preview

```bash
npm run build && npm run preview
```

Serves `web/dist` at http://localhost:4173/lizard/ with the COOP/COEP headers. The library paths are proxied to the
live site.
