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

Both repos are private, and Pages sites from private repos are public on this account. The private repo keeps the
solver's sources, scripts and research private; the site itself exposes only the built app and the solver bundle,
which the classic site already serves.

## 1. The app

### How a deploy works

1. Push to `main` (or run the workflow by hand: `gh workflow run deploy -R michaellhan/lizard`).
2. `check-and-build` (ubuntu, Node 24, Python 3.12 with `numpy==2.0.2 treys==0.1.8`):
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

Pull requests run the checks and the build but do not deploy.

The bundle is deterministic. The CI build and a local build of the same commit produce the same manifest version,
`3a94eea354` for the first deploy.

### Verify a deploy

GitHub Actions turning green is not the check. Fetch the site:

```bash
for p in "" study/ engine/ library/ solver/manifest.json solver/worker.js sw.js no/such/page; do curl -s -o /dev/null -w "%{http_code} /lizard/$p\n" "https://www.michael-han.com/lizard/$p"; done
```

Expect 200 for everything except `no/such/page`, which is 404 but still serves the app (it renders Not Found).

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

Automating this (a launchd job every 6 hours while the builds run) is a persistent change to this Mac, so it is
left for the user to approve. A template is in §4.

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
   `main.tsx`. A domain-wide fix would be Cloudflare's "Always Use HTTPS".

## 4. Optional: scheduled library publishing (not installed)

Install only with the owner's approval. Save as `~/Library/LaunchAgents/com.michaelhan.lizard-library.plist`, then
`launchctl load` it:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.michaelhan.lizard-library</string>
  <key>ProgramArguments</key><array>
    <string>/Users/mhan/Desktop/projects/gtosolver/.work/bin/slot.sh</string>
    <string>/Users/mhan/Desktop/projects/lizard/scripts/library/publish.sh</string>
  </array>
  <key>WorkingDirectory</key><string>/Users/mhan/Desktop/projects/lizard</string>
  <key>StartInterval</key><integer>21600</integer>
  <key>LowPriorityIO</key><true/>
  <key>Nice</key><integer>10</integer>
  <key>StandardOutPath</key><string>/Users/mhan/Desktop/projects/lizard/library-build/publish.log</string>
  <key>StandardErrorPath</key><string>/Users/mhan/Desktop/projects/lizard/library-build/publish.log</string>
</dict></plist>
```

## 5. Local preview

```bash
npm run build && npm run preview
```

Serves `web/dist` at http://localhost:4173/lizard/ with the COOP/COEP headers. The library paths are proxied to the
live site.
