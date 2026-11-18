# Deploying Lizard

Lizard is two GitHub Pages project sites under the account's custom domain, behind Cloudflare:

| URL | Repo | Published by | Pages source |
|---|---|---|---|
| https://www.michael-han.com/lizard/ | [michaellhan/lizard](https://github.com/michaellhan/lizard) (private) | `.github/workflows/deploy.yml` on every push to `main`, except one that touches only `docs/` or a top-level `.md` file (those change nothing served) | GitHub Actions |
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
2. Four jobs start side by side on Ubuntu 24.04 (pinned because Playwright 1.56.1 has no Chromium for 26.04; Node 24,
   Python 3.12 with `numpy==2.0.2 treys==0.1.8`):
   - `build`, about a minute: `npm run build`, which typechecks (`tsc -b`) and then:
     - `scripts/build-solver-assets.mjs` builds `web/public/solver/` from `solver/`: `worker.js` with the cache
       renamed, `solver.zip` from `solver/scripts/build_bundle.py`, `pf/*.bin`, and `manifest.json` whose version
       is `sha1(worker.js + solver.zip)[:10]`;
     - `vite build` with base `/lizard/` and the CSP meta tag;
     - `scripts/postbuild.mjs` writes `<route>/index.html` for every route, plus `404.html` and `.nojekyll`;
   - `unit`: typecheck, lint, Vitest, the Pyodide staging tests and the sync Worker's tests;
   - `python`: the library assembler's, engine contract, benchmark reference and the solver's quick tests;
   - `e2e`, after `build`: the browser tests on the built site, split over four machines.
3. `deploy` uploads `web/dist` with `actions/deploy-pages` as soon as `build` passes, so the site has a push about two
   minutes after it lands. It doesn't wait on `unit`, `python` or `e2e` (owner's choice, 2026-11-15: a small change
   shouldn't wait about 8 minutes on them). They keep running, and a failure turns the run red after the site may already
   be serving the change: fix forward, or roll back as below. Code that doesn't typecheck never deploys, as the build
   stops.

Pull requests run the same checks and the build but do not deploy, and only `refs/heads/main` can reach the upload or the deploy.
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
  `.work/hu-lp-lib`, as far as they have got. Whether or not a build is running, its output is only ever read;
- the 3-way spots' flops beyond their 185 from Lizard's own build in `library-build/sources/mw-every-flop` (below),
  added to the published 3-way spots in `mw_index.json` as they finish. Each 3-way spot also gets `heads.json`, its
  entries' stored mixes in one file, which the Reports page reads instead of one entry per flop.
- new spots from Lizard's breadth build in `library-build/sources/breadth` (`scripts/library/breadth.sh`,
  `build_breadth.py`: 6-max flats, 3bet and 4bet pots the base lacks, and 8-max spots, which also answer 9-max).
  They go in last, in the build's value order, each only while the stage stays 200 files under the file cap, so the
  build can't make a publish fail. Their targets come from the source's `plan.json`.

`lizard-library.json` at the site root records what each publish contained: per-spot flop counts, file count, and any
flops left out by validation. Each spot also has a `target`, the flop count it is being built to, which the app's
Library page reads for its progress bars. It comes from the solver's `SPOT_FLOPS` (`solver/gto/flop_library.py`),
overridden by `BUILD_PLANS` in `assemble.py`. That override is where the heads-up SRP's extension to all 1,755 flops
is recorded. A spot with no plan gets `null`, and the page then shows only its count. The 3-way spots' targets are
`multiwayTargets` (from `MW_BUILD_PLANS` in `assemble.py`: 1,755 each).

### The 3-way build to every flop

`scripts/library/build_mw_every_flop.py` solves the four 3-way spots on the 1,570 flops each that the published 185
lack (6,280 entries), with the solver snapshot's own `build_mw_library.solve_entry` and settings (same ranges, tree and
stopping rule: at least 200 iterations, then until under 0.1% of the pot, at most 800), nothing in `solver/` changed.
It goes flop by flop over all four spots, the rest of `representative_flops(552)` first, then the other flops. It
runs detached through `heavy -x` (2 worker processes, about 0.5 GB each) and writes into the main checkout's ignored
`library-build/sources/mw-every-flop`, with a copy of the driver in its `bin/`:

```bash
scripts/library/mw_every_flop.sh status   # running or not, progress.json (done, left, mean s/entry, ETA), the log
scripts/library/mw_every_flop.sh stop     # finished entries stay
scripts/library/mw_every_flop.sh start    # resumes: every finished, current entry is kept
```

Measured 2026-11-11 at normal priority: 15 s and 0.52 GB for a 300-iteration entry (BTN open, SB and BB call, 4♣3♦2♥),
55–80 ms an iteration, so about 20–30 s an entry at the stored 300–600 iterations: about 45 CPU hours in all, about a
day with 2 workers on the performance cores. Under `heavy` it gets the efficiency cores at background priority beside
another heavy job, so expect a few days once it holds a slot; `progress.json` has the measured rate.

### Rebuilding the 3-way spots after a chart change

A 3-way spot is found by the fingerprints of the ranges its preflop line gives entering the flop, so when the charts
move under it the spot is never found again. b10afc8 (2026-11-17) moved the big blind's range in all four. Until a
spot is rebuilt, `engine/mw_near.py` serves its stored entries as built, labelled approximate with how far each range
moved (`precomputed.borrowed.built`), while today's ranges are within `NEAR_DIST` of the built ones
(`engine/mw_built.py` holds those). CI's `scripts/library/test_published_fps.py` fails on any further move.

The rebuild solves every flop of each moved spot on today's ranges: 4 x 1,755 = 7,020 entries, into the main
checkout's ignored `library-build/sources/mw-rebuild`, with the same settings as the build above:

```bash
cd /Users/mhan/Desktop/projects/lizard            # the main checkout
git status --short solver/                         # must be empty: the build solves on $MAIN/solver's charts
MW_REBUILD=1 scripts/library/mw_every_flop.sh start    # status and stop the same way; start resumes
```

The log's first lines give each spot's new fingerprints. They must equal its `now` in
`scripts/library/published_fps.json`; if they don't, the charts moved again since the fixture was written.

Cost: the build above averaged 19.5 s an entry (its `progress.json`, 2026-11-16), and a worker uses about 0.52 GB. One
rebuild entry (`--limit 1`, through slot.sh, 2026-11-18) took 16 s and 0.52 GB: CO open, BTN and BB call, 4c3d2h,
300 iterations, 0.086% of the pot. That makes 7,020 entries about 38 CPU hours. The last build did 5,374 entries in
29 hours on 2 heavy jobs, so expect about 38 hours of wall time, more beside another heavy job.

Publish: `assemble.py` reads `mw-rebuild` after `mw-every-flop`. It swaps a rebuilt spot in whole (`replace_mw`: the
new fingerprints, pot and every flop) only once the rebuild holds every flop the published spot does. Until then it
logs how many flops are still to go and keeps the published spot. Then run `scripts/library/publish.sh` as below.
Once it is live:

1. Run `.venv/bin/python scripts/library/published_fps.py` (no spot is stale now, so no `--reason`) and commit the
   fixture.
2. Delete the rebuilt spots from `SPOTS` in `engine/mw_built.py`. `test_published_fps.py` fails until both are done.
3. Note it in `docs/FEATURE_MATRIX.md` and `docs/ACCURACY.md` section 28.

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
- a 3-way build's flops join only a published 3-way spot of the same ranges, pot and stack, and the base's entry
  wins a flop both hold;
- the stage stays under 50 MB per file, 900 MB in total and 90,000 files (raised from 60,000 on 2026-11-17: GitHub Pages limits a site to 1 GB, not a file count, and deployed 49,298 files in 80 s).

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
2. **Done (checked 2026-11-15): `http://` redirects to https.** Cloudflare's "Always Use HTTPS" is on:
   `curl -sI http://www.michael-han.com/lizard/` answers 301 with `Location: https://www.michael-han.com/lizard/`, and
   the site root does the same. Lizard's own redirect in `main.tsx` stays as a fallback. The certificate in 1 stays as
   it is, by the owner's decision of 2026-11-05.

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

Each run also takes the next step on the nut shares (`scripts/library/nuts.py`). It prints "nuts: not yet" while a heads-up
build runs or a spot is short of its target, as the owner chose. After that one run computes every flop's share, in one slot on
one core, for about one to two hours, saving as it goes to `library-build/nuts/`, and the same run publishes them. A flop new
to the stage gets its share on the run after. Don't remove the job until the log shows that done.

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

## 6. Account sync (service up, sign-in waiting on the Google client)

Done: the database, its schema, the Worker on its route, and the panel in the site (`LIZARD_SYNC=on`, a repo variable). The
design and what it costs in privacy are in `docs/SYNC_DESIGN.md`. The service is a Cloudflare Worker with a D1 database at
`www.michael-han.com/lizard/api/*`, which goes in front of Pages for that path only.

Wrangler is logged in on this Mac by `npx wrangler@4 login` (`workers_scripts`, `workers_routes`, `d1` write). No token is
needed, as nothing in CI deploys the Worker, so a change to `worker/` is deployed by hand from `worker/`, alongside the site
change that goes with it:

```bash
npx wrangler@4 deploy
```

Moving from magic link to Google, on the live database, once (the old sign-in's table and column go; an account made by email
can no longer be reached, as what found it was a hash of the address):

```bash
npx wrangler@4 d1 execute lizard-sync --remote --command "ALTER TABLE users RENAME COLUMN email_hash TO account_hash; DROP TABLE login_tokens;"
```

```bash
openssl rand -base64 32 | npx wrangler@4 secret put ACCOUNT_HMAC_KEY
```

```bash
npx wrangler@4 secret delete EMAIL_HMAC_KEY
```

```bash
npx wrangler@4 secret delete RESEND_API_KEY
```

What needs the owner's Google account:

1. [Google Cloud console](https://console.cloud.google.com/): a new project, say `Lizard`.
2. Google Auth Platform, Get started: app name `Lizard`, a support address, Audience **External**, a contact address.
3. Audience: **Publish app**. Without this only listed test users can sign in. It asks only for `openid`, which needs no review
   by Google; a logo would need one, so leave that out.
4. Clients, Create client: type **Web application**, with this exact Authorized redirect URI:

   `https://www.michael-han.com/lizard/api/auth/google/callback`

5. The client ID goes in `worker/wrangler.toml` as `GOOGLE_CLIENT_ID`. It isn't a secret. The client secret is, and goes in only
   at this hidden prompt, from `worker/`:

```bash
npx wrangler@4 secret put GOOGLE_CLIENT_SECRET
```

6. Check it for real: sign in with Google, see it sync with nothing to type, sign in in a second browser, delete something in
   one and see it go in the other, delete the account, and read the D1 rows to see that nothing of it is left.
7. The live `users` table still has the unused `salt` and `check_value` columns of the encrypted version, holding the old test
   account's values. `worker/schema.sql` no longer has them and nothing reads them. Once that account is deleted they're empty,
   and these drop them:

```bash
npx wrangler@4 d1 execute lizard-sync --remote --command "ALTER TABLE users DROP COLUMN salt; ALTER TABLE users DROP COLUMN check_value;"
```

To take it down, set `LIZARD_SYNC` off and redeploy, then remove the route (`npx wrangler@4 delete` from `worker/` removes the Worker and its route, and leaves the database). Local data is untouched by either.
