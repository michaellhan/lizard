# 05 — Hosting, GitHub and deployment for Lizard (`/lizard/`)

Research date: 2026-11-03, 06:00–06:17 EST (11:00–11:17 UTC). Method: read-only only (`dig`, `curl -sI`/`curl -s`,
`gh api` GET, `gh repo list`, reading files). Nothing was created, enabled, pushed or changed. No processes were
signalled. Paths are relative to `/Users/mhan/Desktop/projects/lizard` unless absolute.

How claims are marked: **[V]** I checked it myself (command output or code read). **[D]** It comes from vendor docs
fetched today (docs.github.com, developers.cloudflare.com). **[I]** It is my inference and is not verified.

---

## 0. Bottom line

1. **Serve Lizard as a GitHub Pages project site from a new `michaellhan/lizard` repo, deployed by GitHub
   Actions (`deploy-pages`).** GitHub serves a project site that has no CNAME of its own under the user site's custom
   domain, so it would appear at `https://www.michael-han.com/lizard/`. No DNS, Cloudflare or user-site change is
   needed [V: `gto-solver-library` is served this way, `html_url: http://www.michael-han.com/gto-solver-library/`;
   D: "Using a custom domain across multiple repositories"]. The homepage, `/gto-solver/` and `/gto-solver-library/`
   are not touched. Deep links work through the project's own `404.html` plus per-route `index.html` copies.
2. **Do not deploy into `michaellhan.github.io/lizard/`** (option b). That repo is 1.09 GB, which is already over
   GitHub's 1 GB recommendation [V]. Two other workflows push to its `main` about 10 times a day [V], with no push
   retry in `deploy.sh`, so deploys there would race each other. Deep links would also mean editing the shared root
   `404.html`, which already carries a `/hardest/` SPA hack [V].
3. **Heads-up (HU) libraries:** publish only *indexed, hash-validated* entries from `.work/hu-lib` and
   `.work/hu-lp-lib` to a new `michaellhan/lizard-library` repo. Each publish is one orphan commit, force-pushed.
   The repo is served same-origin at `/lizard-library/`. Today the HU data is 15.2 MB in 1,048 files. Final size is
   about 67–73 MB in about 4,600 files [I, from build logs]. **Never push to `michaellhan/gto-solver-library`.**
   Lizard reads `/gto-solver-library/` (6-max, 39,331 files, 252.7 MB) only as a consumer, guarded by version checks.
4. **Make the `lizard` repo private.** Pages from private repos works on this account [V: four private repos serve
   Pages]. A public repo would publish the solver's C core, build and calibration scripts, tests, research docs,
   draft legal and paywall plans, and a key-shaped test fixture. Today the live site exposes only the Python sources
   and the compiled wasm [V].
5. **Same-origin hazards:** Lizard shares the origin `https://www.michael-han.com` with gto-solver, so storage is
   shared. Use a `lizard:` prefix for every localStorage, IndexedDB and Cache name. Never clear caches or storage you
   do not own. Keep a strict CSP. gto-solver stores a user's Anthropic key in localStorage under
   `"gto-anthropic-key"`, so an XSS bug in Lizard would expose it.
6. **Two pre-existing, domain-wide problems to raise with the user. Do not fix them in Lizard work:**
   - The GitHub Pages origin certificate **expired on 2026-11-02**. ACME is in state `bad_authz` [V].
   - `http://www.michael-han.com/` is served with a 200 and is not redirected to HTTPS [V].

   Lizard should redirect `http:` to `https:` itself, because the service worker (SW), `crossOriginIsolated` and
   `crypto.subtle` all need a secure context.

---

## 1. Current hosting

### 1.1 DNS and Cloudflare [V]

| Query | Result |
|---|---|
| `dig +short michael-han.com NS` | `romina.ns.cloudflare.com.`, `ignacio.ns.cloudflare.com.` (zone on Cloudflare) |
| `dig +short www.michael-han.com A` | `104.21.52.48`, `172.67.195.142` (Cloudflare anycast, i.e. proxied "orange cloud") |
| `dig +short michael-han.com A` | the same two Cloudflare IPs |
| `dig +short www.michael-han.com AAAA` | `2606:4700:3033::ac43:c38e`, `2606:4700:3034::6815:3430` |
| `dig +short www.michael-han.com CNAME` | empty (CNAME flattened or proxied by Cloudflare) |

The response headers show three layers. Cloudflare is in front (`server: cloudflare`, `cf-ray`, `cf-cache-status`).
Behind it are GitHub Pages (`x-github-request-id`) and Fastly (`via: 1.1 varnish`, `x-served-by: cache-iad-…`):

```
curl -sI https://www.michael-han.com/        -> HTTP/2 200, cache-control: max-age=600, cf-cache-status: DYNAMIC
curl -sI https://michael-han.com/            -> HTTP/2 301  location: https://www.michael-han.com/   (Cloudflare-generated: no GitHub headers)
curl -sI https://michael-han.com/lizard/     -> HTTP/2 301  location: https://www.michael-han.com/lizard/  (path preserved)
curl -sI http://www.michael-han.com/         -> HTTP/1.1 200 OK   (no http->https redirect at the edge)
curl -sI https://michaellhan.github.io/gto-solver-library/index.json -> 301 location: http://www.michael-han.com/gto-solver-library/index.json
```

The apex redirects to www with a Cloudflare 301 that keeps the path. The canonical URL is therefore
`https://www.michael-han.com/lizard/`. `https://michael-han.com/lizard/` already redirects there, with no change
needed [V].

### 1.2 GitHub Pages configuration [V]

`gh api repos/michaellhan/michaellhan.github.io/pages`:

```json
{"status":"built","cname":"www.michael-han.com","custom_404":true,"html_url":"http://www.michael-han.com/",
 "build_type":"legacy","source":{"branch":"main","path":"/"},"public":true,
 "protected_domain_state":"verified",
 "https_certificate":{"state":"bad_authz","description":"The ACME authorization is in a bad state. We need to start over.",
   "domains":["www.michael-han.com"],"expires_at":"2026-11-02"},
 "https_enforced":false}
```

- The user-site repo `michaellhan/michaellhan.github.io` is **private** (`"private":true,"visibility":"private"`).
  Its `size` is 1,146,936 KB, about **1.09 GB**, against GitHub's 1 GB recommendation. Its default branch is `main`.
  Root `CNAME` = `www.michael-han.com`.
- The published tree holds only 337 blobs, 31.97 MB (`git/trees/main?recursive=1`). By size: `scroll/` 13.61 MB,
  `gto-solver/` 6.65 MB (69 files), `hardest/` 4.62 MB, `reels/` 3.15 MB. Most of the 1.09 GB is history. The
  upstream commit `library-repo.patch` says copies of the library inside this repo took it to 1.08 GB.
- Its only workflow is `.github/workflows/resume.yml`, which rebuilds `resume.pdf`. That workflow refers to the
  secret names `CLOUDFLARE_ZONE_ID` and `CLOUDFLARE_API_TOKEN` for a cache purge. I read only the names, no values.
- Recent `main` commits arrive about every 1–2 h: `gto-solver: deploy <sha>`, about 9 on 2026-11-03 alone, plus
  `reels: N scheduled`. Each push triggers a legacy "pages build and deployment" run. Observed durations are
  22.7–82.0 s (`pages/builds`).
- **Origin certificate check.** I ran `curl -v --resolve www.michael-han.com:443:185.199.108.153`. The result was
  `SSL certificate problem: certificate has expired`, for `CN=www.michael-han.com` issued by Let's Encrypt YR2, with
  `expire date: Nov  2 14:58:25 2026 GMT`. The site still works through Cloudflare. **So Cloudflare's SSL mode must
  be "Flexible" (HTTP to origin) or "Full" (non-strict). It cannot be "Full (strict)"** [I]. If anyone switches it
  to Full (strict), the whole domain breaks. I did not change anything. Flag it to the user.

`gh api repos/michaellhan/gto-solver-library/pages` [V]:

```json
{"status":"built","cname":null,"custom_404":false,"html_url":"http://www.michael-han.com/gto-solver-library/",
 "build_type":"legacy","source":{"branch":"main","path":"/"},"public":true,"https_enforced":false}
```

The repo is **public**, `size` 242,296 KB. Its single commit `fea9e6c1` (2026-11-03T01:18Z) is "library: gto-solver
4c53c2f9, 39293 entries" with `parents=0`, i.e. an orphan commit.

### 1.3 How project repos appear under `www.michael-han.com/<repo>/` [V/D]

A project repo with Pages enabled and **no CNAME of its own** is served at `<user-site custom domain>/<repo>/`.
`gto-solver-library` shows this: `cname: null`, `html_url: http://www.michael-han.com/gto-solver-library/`, and
`https://www.michael-han.com/gto-solver-library/index.json` returns 200. GitHub's docs give the same rule [D]: a user
site's custom domain "will be used for all project sites owned by the same account", e.g.
`www.octocat.com/octo-project`.

**Project sites keep their own 404 handling** [V]:

| URL | Status | Body |
|---|---|---|
| `/nonexistent-xyz` | 404 | user site's custom 404 (`<title>Not found · Michael Han</title>`, 1,858 B) |
| `/gto-solver/nonexistent-xyz` (folder in user site) | 404 | user site's custom 404 |
| `/gto-solver-library/nonexistent-xyz` (project site, `custom_404:false`) | 404 | **GitHub's generic** `Page not found · GitHub Pages` (9,379 B) |

So a project site does not fall through to the user site's 404. It uses its own `404.html` when one exists
(`custom_404:true`) [D/I], and that is what makes a SPA fallback under `/lizard/` possible. The user site's
`deploy.sh:162` comment ("GitHub Pages only uses the site root's [404]") applies to *folders* inside the user site,
not to project sites.

The user site's root `404.html` already holds an SPA redirect for a folder app [V]:
`location.pathname.match(/^\/hardest\/(?!assets\/)(.+)$/)` then `location.replace('/hardest/?p=…')`. Option (b)
would mean adding Lizard to this shared file.

### 1.4 Account plan and Pages on private repos [V/D]

- `gh auth status`: account `michaellhan`, token scopes `delete_repo, gist, read:org, repo, workflow`.
  `gh api user` returns `plan: null` because the token lacks the `user` scope, so the plan name could not be read
  directly.
- Private repos with Pages **built and public**: `michaellhan.github.io` (legacy), `qviewer-app` (legacy, CNAME
  `qviewer.app`), `hclubs-site` (legacy, `hclubs.app`), `bergmenu` (`build_type: workflow`, custom domain).
  `bergmenu` already uses `actions/upload-pages-artifact@v3` and `actions/deploy-pages@v4` with
  `environment: github-pages`. That is a working precedent on this account for option (a2).
- GitHub Free does not allow Pages from private repos. Pro, Team and Enterprise do. **So the account is on a paid
  plan, almost certainly Pro** [I]. Pro includes $18/month of Actions compute, about 3,000 Linux minutes at
  $0.006/min, and 1 GB of artifact storage. Public repos use standard runners for free [D].

### 1.5 Collision checks for `/lizard/` and `/lizard-library/` [V]

| Check | Result |
|---|---|
| `gh api repos/michaellhan/lizard` | 404 Not Found (the token can read the owner's private repos, so the repo does not exist) |
| `gh api repos/michaellhan/lizard-library` | 404 Not Found |
| `gh repo list michaellhan --limit 100` | no `lizard*` repo |
| `gh api repos/michaellhan/michaellhan.github.io/contents/` | no `lizard` or `lizard-library` entry. Root: `.github .gitignore .nojekyll 404.html CNAME berg blackjack case1 case2 case2dashboard case2fleet case2vs case3 ctc26 gto-solver hardest humanizer index.html initials leaderboard paulg poker preflop previews queue qviewer reels resume resume.pdf scroll style.css` |
| `gh api repos/michaellhan/michaellhan.github.io/contents/lizard` | 404 |
| `curl https://www.michael-han.com/lizard-library/` | 404 |

### 1.6 What `/lizard/` returns right now [V]

`https://www.michael-han.com/lizard/` and `/lizard/study/` both return **HTTP 404** with the user site's custom 404
page (`Not found · Michael Han`, 1,858 B, `cf-cache-status: DYNAMIC`). `https://michael-han.com/lizard/` returns 301
to the www URL.

---

## 2. How the legacy gto-solver is built and deployed (verified in code)

### 2.1 `solver/scripts/deploy.sh` (page) [V]

1. **Freshness guard:** `git fetch origin main` and abort unless `origin/main` is an ancestor of HEAD
   (`deploy.sh:16-22`).
2. **Checks:** `python -m unittest` (retried once), `node --test 'tests/js/*.test.js'`, then
   `scripts/sanity_sweep.py --quick`. The README says the sweep takes "about 3 minutes on 10 cores"
   (`solver/README.md` § Deploy to the website, line ~4510). `SKIP_CHECKS=1`, `DRY_RUN=1` and `BUILD_ONLY=<dir>` are
   escape hatches.
3. `gh repo clone michaellhan/michaellhan.github.io --depth 1` (`deploy.sh:67`), then
   `rm -rf "$WORK/site/gto-solver"` (`:68`). Each deploy replaces the whole folder.
4. Copies the page and view scripts and `sw.js`. Builds `solver.zip` with `scripts/build_bundle.py`, which bundles
   every `gto/*.py`, treys and the four `gto/*.wasm` modules (`build_bundle.py:27-32`). Also copies the raw
   `gto/*.py` (`deploy.sh:74`) and `pf/*.bin`.
5. Runs `deploy_library.sh` first, then stamps `const LIB_BASE = "../gto-solver-library/"` into `index.html` with
   `sed` and checks it with `grep` (`deploy.sh:84-87`).
6. **Cache-busting stamps:** `WORKER_VERSION` is `shasum(worker.js + practice.js + solver.zip)` cut to 10 characters
   (`:92`). There are 12 more `*_VERSION` constants (HH, RP, DR, BD, SS, SY, RO, SP, MT, HP, HN, WU) plus
   `store.js?v=`. Each one is `sed`-replaced and then `grep`-verified (`deploy.sh:92-158`). In the source they sit at
   `gto/static/index.html:1004-1016`. Live today: `WORKER_VERSION = "85bbc24273"`, `LIB_BASE = "../gto-solver-library/"`.
7. **Per-route copies:** `python -m gto.routes <site>/gto-solver` (`deploy.sh:163`).
8. `git add -A; git commit -m "gto-solver: deploy <sha>"; git push -q origin main` (`:166-169`). There is no retry
   on a non-fast-forward push.

### 2.2 `solver/scripts/deploy_library.sh` [V]

- Copies `gto/static/flop_library/.` into a fresh directory. Deletes everything that is not `*.json` or `*.bin`
  ("a running build's .tmp files", `:26`). Adds `.nojekyll` (`:27`).
- Runs `git init -b main` and `git add -A`. **Skips the push** when
  `gh api repos/$REPO/commits/main --jq .commit.tree.sha` equals the local `git write-tree` (`:32`).
- Otherwise commits and runs `git push -q -f https://github.com/michaellhan/gto-solver-library.git main` (`:37`).
  The result is one orphan commit per publish, with no history growth. The trade-off is that every publish uploads
  the whole library again.

### 2.3 `solver/gto/routes.py`: per-route `index.html` copies with `<base href>` [V]

- Routes are read from `index.html`'s `const ROUTES = {…}` and `const SPOT_ROUTES = [...]` lines
  (`routes.py:23-33`; `index.html:1027-1028`). There are 13 views: practice, drills, reports, session, study,
  preflop, import, hands, start, about, glossary, changelog, fairplay. Two of them, drills and reports, also take a
  `/<spot>/` level.
- Each route gets a copy of the stamped page with `<base href="../">` (one `../` per level) inserted after
  `<meta charset>` (`routes.py:57-67`). The page's URLs are *relative*. The root page also adds a `<base>` at run time
  so that `pushState` to `/study/` cannot move relative URLs (`index.html:1036-1039`).
- **Regression found:** `write()` takes the spot slugs from `<site>/flop_library/index.json` (`routes.py:100` →
  `spot_slugs`, `:36-44`). The library moved to its own site, so that file no longer exists in the site folder and
  **no `/reports/<spot>/` or `/drills/<spot>/` copies are generated.** I confirmed this live:
  `https://www.michael-han.com/gto-solver/reports/srp-btn-bb/` and `/drills/srp-btn-bb/` → **404**. The deployed
  `gto-solver/` tree has only the 13 view folders. Lesson for Lizard: per-route copies that depend on data are
  fragile, so a `404.html` SPA fallback should be the safety net.
- A directory without its trailing slash redirects: `/gto-solver/hands` → 301 `/gto-solver/hands/` [V].

### 2.4 `solver/gto/static/sw.js`: COOP/COEP service worker [V]

The service worker is 20 lines. It handles only `navigate` and `worker` requests to its own origin. It re-wraps each
response and adds `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`. All
other requests go to the network untouched. It calls `skipWaiting()` and `clients.claim()`. Its scope is the folder it
is served from (`/gto-solver/`).

`index.html:1067-1075` registers `sw.js` on the first visit (once per tab session, flag
`sessionStorage["gto-isolate"]`, 4 s timeout), then reloads the page so it is controlled and cross-origin isolated.
This is needed for `SharedArrayBuffer` and the threaded `core-mt.wasm`. If isolation fails the page runs unthreaded.

Cross-origin dependencies are compatible with `require-corp`. jsDelivr's Pyodide files send
`cross-origin-resource-policy: cross-origin`, `access-control-allow-origin: *` and `cache-control: public,
max-age=31536000` [V, `curl -sI` on `pyodide.js` and `pyodide.asm.wasm` (10,088,051 B)].

### 2.5 Observed caching (`curl -sI`, 2026-11-03 ~11:07–11:18 UTC) [V]

| URL | Status | `cache-control` | `cf-cache-status` | Notes |
|---|---|---|---|---|
| `/` (homepage) | 200 | `max-age=600` | DYNAMIC | `last-modified: Tue, 03 Nov 2026 09:32:47 GMT` |
| `/gto-solver/` | 200 | `max-age=600` | DYNAMIC | HTML is not cached by Cloudflare |
| `/gto-solver/study/` | 200 | `max-age=600` | DYNAMIC | contains `<base href="../">` |
| `/gto-solver/sw.js` | 200 | `max-age=14400` | REVALIDATED | `application/javascript` |
| `/gto-solver/worker.js` | 200 | `max-age=14400` | EXPIRED | |
| `/gto-solver/solver.zip` | 200 | `max-age=14400` | EXPIRED | 692,642 B |
| `/gto-solver` | 301 | `max-age=600` | DYNAMIC | → `/gto-solver/` |
| `/gto-solver/gto/advisor.py` | 200 | | | **558,959 B: the raw Python solver source is public** |
| `/gto-solver-library/index.json` | 200 | `max-age=600` | DYNAMIC | 732,218 B identity, 292,846 B gzip; `etag W/"6ae936cd-b2c3a"` |
| `/gto-solver-library/` | 200 | `max-age=600` | DYNAMIC | serves **index.json** (same ETag, `application/json`) |
| `/gto-solver-library/srp_btn_bb/2h2d2c.bin?v=d749b47d1b` | 200 | `max-age=14400` | MISS, then **HIT** on 2nd request | `application/octet-stream`, `access-control-allow-origin: *` |
| `/gto-solver-library/srp_btn_bb/2h2d2c.turn.bin` | 200 | `max-age=14400` | MISS | |

How I read this [I]:
- GitHub Pages sends `max-age=600` on everything. That value shows through on DYNAMIC (uncached) responses.
- Cloudflare edge-caches only its default static extensions. `js`, `zip` and `bin` are on that list; `html` and
  `json` are not.
- On the responses Cloudflare caches, it raises the browser TTL to 4 h (`max-age=14400`, the zone's "Browser Cache
  TTL"). `index.html:1119` calls this "the 4h GitHub Pages cache".
- Cloudflare's default cache key includes the query string, so `?v=<hash>` busts both the edge and browser caches.
- In practice, HTML and JSON are fresh within 10 minutes. Unhashed JS, zip and bin files can be stale for up to 4 h
  unless their URL carries a version.

### 2.6 Lessons for Lizard

- Vite with an **absolute** `base: '/lizard/'` (already set in `web/vite.config.ts:9`) avoids `<base href>`
  entirely. Any copy of `index.html` at any depth works unchanged.
- Content-hashed filenames (`/lizard/assets/*-[hash].js`) make the 4 h Cloudflare TTL harmless. Any file *outside*
  the Vite pipeline (`sw.js`, solver bundle, wasm, `manifest`) needs a content hash in its name or a `?v=` query.
- Keep the SW pass-through, like upstream: no precache in v1. A caching SW is the classic way to "brick" a static
  app.

---

## 3. Deployment options

### 3.1 Option (a): GitHub Pages project site from `michaellhan/lizard` (**recommended**)

The project site is served at `https://www.michael-han.com/lizard/` automatically, as in §1.3. There are two ways to
publish it:

| | (a1) `gh-pages` branch pushed by a local script (legacy build) | (a2) GitHub Actions `upload-pages-artifact` + `deploy-pages` (**recommended**) |
|---|---|---|
| Where the build runs | The user's Mac (shared with multi-day builds) | GitHub's `ubuntu-latest` runner |
| Checks before deploy | Whatever the script runs locally | typecheck, lint, vitest and build in CI, from a clean checkout |
| History growth | Each deploy adds new hashed bundles to the `gh-pages` history (unless it is an orphan force-push) | None: an artifact, not git |
| Jekyll | Needs `.nojekyll` (Vite/Rollup can emit `_`-prefixed chunk names, which Jekyll drops) | No Jekyll pass |
| Builds/hour limit | Soft limit of 10 builds/hour [D] | "does not apply if you build and publish your site with a custom GitHub Actions workflow" [D] |
| Cost if private repo | None (built-in "pages build and deployment" run; I believe it is not billed, unverified) | Actions minutes: Pro includes ~3,000 Linux min/month; a 4–6 min job allows ~500 deploys/month. Set the artifact to `retention-days: 1` to keep within the 1 GB artifact storage |
| Data on the Mac | Could be copied in | Not reachable from CI, so it must live in its own repo or site (that is what §4 does) |
| Precedent on this account | `gto-solver-library`, the user site | `bergmenu` |

Effect on the rest of the site:
- **Disruption to the homepage, `/gto-solver/` and `/gto-solver-library/`: none.** It is a separate repo, Pages
  site, build pipeline and 404 handler.
- **Reliability:** an atomic artifact deploy with a 10-minute deploy timeout [D]. A failure leaves the previous
  version live.
- **Deep links:** two mechanisms work together.
  - `postbuild.mjs` writes `dist/<route>/index.html` copies for the static top-level routes (Study, Practice,
    Analyze, Solver, Reports, Library, Settings), so those return 200.
  - `dist/404.html` is a copy of `index.html` and catches dynamic deep links such as
    `/lizard/study/srp-btn-bb/Ks7d2c/`. It renders the app with an HTTP 404 status, which is fine for browsers but
    not ideal for crawlers or link unfurlers.
  - React Router `basename="/lizard"`. No `?p=` redirect trick is needed, because the base is absolute.
- **Service worker:** put `sw.js` in `web/public/`, so it is served at `/lizard/sw.js`.
  - Register it with `register(import.meta.env.BASE_URL + "sw.js")`. Its default scope is then `/lizard/` (the
    script's directory). It cannot widen to `/` or `/lizard` without a `Service-Worker-Allowed` header, which Pages
    cannot send. As a result it cannot interfere with `/gto-solver/` (whose SW scope is `/gto-solver/`) or with the
    homepage.
  - Use a separate isolate-once key (`sessionStorage["lizard:isolate"]`).
  - Like upstream, handle `request.destination === "worker"` too, so the solver's nested helper workers are COEP-clean.
  - Requests from `/lizard/` pages to `/gto-solver-library/` and `/lizard-library/` pass through the Lizard SW
    because the page is a controlled client. Leave them untouched.
- **Cache invalidation:**
  - `index.html` and `404.html`: 600 s (Cloudflare DYNAMIC).
  - Hashed assets: immutable.
  - `sw.js`: browsers revalidate it on navigation, and Cloudflare holds it ≤600 s at the edge.
  - Library entries are versioned by `?v=<sha1[:10]>`.
  - No Cloudflare purge is needed.

### 3.2 Option (b): a folder `lizard/` inside `michaellhan.github.io` (like gto-solver) (**not recommended**)

- **Disruption risk: high.**
  - It shares a 1.09 GB repo whose `main` is pushed about 10 times a day by gto-solver's `deploy.sh` and by `reels`.
    `deploy.sh` clones `--depth 1` and pushes with no retry (`deploy.sh:67,169`), so concurrent Lizard pushes would
    make one side fail with a non-fast-forward error.
  - Deep links need a rule in the **shared root `404.html`**, next to the `/hardest/` hack.
  - Every Lizard deploy adds new hashed bundles to a history that is already over the 1 GB recommendation.
  - Deploys also share the user site's 10 builds/hour soft limit.
- The upside is no new repo or Pages site. That is not worth the coupling.

### 3.3 Option (c): Cloudflare (Workers static assets on a route, or Pages behind a Worker)

- **How:** a Worker with `assets = { directory = "web/dist", not_found_handling = "single-page-application" }` on
  routes `www.michael-han.com/lizard/*` and `www.michael-han.com/lizard`.
  - **Do not use `/lizard*`.** That pattern would also capture `/lizard-library/` and any other `/lizard…` path.
  - A Cloudflare Pages project cannot be mounted on a sub-path by itself. It needs a proxy Worker.
- **Pros:**
  - Real response headers: COOP/COEP are sent natively, so no SW reload dance is needed.
  - The SPA fallback returns 200.
  - Instant versioned rollback (`wrangler rollback`).
  - Fine cache control.
  - No exposure to GitHub Pages' usage policy, which says Pages is "not intended for … commercial software as a
    service (SaaS)" [D]. `solver/docs/legal/*.md` are drafts for a planned paid tier.
- **Cons:**
  - It needs a zone-level route change on `michael-han.com`. The plan says not to make domain-wide DNS or
    custom-domain changes blindly, and a route is scoped but is still zone configuration.
  - It needs Cloudflare credentials in CI (`CLOUDFLARE_API_TOKEN`).
  - It is unknown whether the zone and the Workers account (`gto-explain.combatrobotics.workers.dev`) are the same
    account.
  - It is a second platform to operate.
  - Limits: 20,000 static files per Worker version on Free (100,000 paid), 25 MiB per file, and 100,000 Worker
    requests/day on Free [D]. Cloudflare Pages allows 20,000 files on Free [D].
  - The app shell fits these limits easily. The 6-max library (39,331 files) would not fit on Free, so it would stay
    on GitHub Pages or move to R2.
- **Verdict:** keep it as the documented migration path, for when native headers, a 200 SPA fallback or commercial
  use become requirements. Not for v1.

### 3.4 Comparison

| Criterion | (a2) project repo + Actions | (a1) project repo + gh-pages | (b) folder in user site | (c) Cloudflare route |
|---|---|---|---|---|
| Touches homepage, `/gto-solver/` or `/gto-solver-library/` | no | no | shared repo, shared 404 | zone route config only |
| Push races with other workflows | none | none | yes | none |
| Deep links | own `404.html` + route copies | same | edit root `404.html` | native SPA fallback (200) |
| COOP/COEP | SW (as upstream) | SW | SW | native headers |
| Rollback | re-run or revert | force-push the old tree | revert a commit in the shared repo | `wrangler rollback` |
| New credentials | none | none | none | Cloudflare token |
| Fits the existing workflow | yes (`bergmenu`) | yes | yes | partly (explain-proxy) |

---

## 4. Large solver data

### 4.1 6-max library already public at `/gto-solver-library/` [V]

- Served same-origin with `access-control-allow-origin: *`, so there is no CORS or COEP issue. Headers are in §2.5.
- The local copy `solver/gto/static/flop_library/` (gitignored) has **39,331 files and 252,670,741 bytes**:
  `.bin` 77.18 MB, `.turn.bin` 167.57 MB, `.json` 7.92 MB. It reports 315 MB under `du` because of block overhead.
  It holds 18 heads-up spots, 5 three-way spots and both indexes.
- The local `index.json` is 732,218 B. That equals the live ETag size `0xb2c3a`, so the local copy matches the
  published one. The largest file is `index.json`, far below GitHub's 100 MB per-file limit.
- **Index shape** (`format: 2`):

  ```json
  {"format": 2,
   "tree": {"sizes": {"flop_bet":[0.33,0.75],"flop_raise":[0.5],"bet_turn":[0.75],"bet_river":[0.75],
                      "raise_turn":[0.75],"raise_river":[0.75],"max_raises":2,"allin_spr":2.5,"depth":2,"rake":null},
            "model": {"river_play":true,"turn_classes":true,"flop_leaf_rivers":4,"version":1}},
   "spots": [{"id":"srp_btn_bb","label":"BTN vs BB single-raised pot","line":"UTG:f,HJ:f,CO:f,BTN:r2.5,SB:f,BB:c",
              "seats":["BB","BTN"],"fp":["bf187f8767c1fbc7","8e8dab4d6a65fb88"],"pot":5.5,"stack":97.5,
              "tree":{…},"flops":{"2h2d2c":"d749b47d1b", …},"turns":true,"report":"6d522c1bda"}, …]}
  ```

- **Fetch protocol:**
  - The client fetches `<spot>/<flop>.bin?v=<flops[flop]>` and `<spot>/<flop>.turn.bin?v=<same hash>`
    (`gto/flop_library.py:1113,1134`).
  - `flops[flop]` is `sha1(entry bytes)[:10]` (`scripts/build_flop_library.py:249`). `report` is
    `sha1(report.json bytes)[:10]` (`:175`).
  - A turn file names its entry by `sha1(entry)[:12]` in its zlib header (`flop_library.py:691-693, 840-846`;
    `build_flop_library.py:186-193`).
- **Coupling risk:** another workflow owns this site. It force-pushes a fresh library whenever upstream redeploys; the
  last push was 2026-11-03T01:18Z. Lizard's solver snapshot (9b907bd6) decodes `format` 2 / `MODEL_VERSION` 1, and
  `FlopLibrary` ignores entries whose tree or fingerprints differ (`flop_library.py:17-19`). Lizard should check
  `index.format`, the tree key and `model.version` before using an entry, verify `sha1` client-side
  (`crypto.subtle`, which needs https), and fall back to live solving otherwise. If upstream bumps the format, Lizard
  can pin a mirror of the snapshot-compatible library into its own `/lizard-library/`. That adds 252.7 MB and 39k
  files, still under 1 GB.

### 4.2 Heads-up libraries on this Mac (read-only measurements, 2026-11-03 ~06:10–06:15 EST) [V]

| | `.work/hu-lib` (`srp_sb_bb_2max`) | `.work/hu-lp-lib` (`lp_sb_bb_2max`) |
|---|---|---|
| Spot | "SB vs BB single-raised pot, heads-up", line `SB:r3,BB:c`, pot 6.0, stack 97.0 | "SB vs BB limped pot, heads-up", line `SB:c,BB:x`, pot 2.0, stack 99.0 |
| `game` | `{"players":2,"stack":100.0,"ante":0.0,"straddle":false}` | same |
| Files / bytes (live, growing) | 737 files, 10,684,633 B (`.bin` 2.939 MB, `.turn.bin` 7.632 MB, json 0.114 MB) | 311 files, 4,536,120 B (`.bin` 1.782 MB, `.turn.bin` 2.696 MB, json 0.057 MB) |
| Entries on disk vs indexed | 364 `.bin` + 364 `.turn.bin` on disk; **358 in `index.json`** | 150 + 150 on disk; **148 in `index.json`** |
| On disk but not yet indexed | 6 (`QcJc5d, QcJc6d, QcJd2c, QcJd3c, QcTd8d, …`) | 2 (`Ac9d8h, AcTd3h`) |
| Indexed but missing on disk | 0 | 0 |
| `.tmp` or other files at measurement time | 0 | 0 |
| `index.json`, `report.json`, `ranges.json` mtime | 05:55 (the 06:08 entries are newer) | 06:04 |
| Top-level `tree` equal to the 6-max index's `tree` | yes | yes (so the HU spots can be listed beside 6-max spots in one format-2 index) |
| Log | `.work/flop-core/hu_2max.log` | `.work/flop-core/hu_lp.log` |

**Write protocol** [V, code]:
- Entries and turn files are written as `<file>.tmp`, then `os.replace` (`build_flop_library.py:110-127`). The old
  turn file is unlinked first (`:121`).
- The index is rewritten every 20 entries (`--index-every 20`, `:302`). `report.json`, `ranges.json` and then
  `index.json` are each written `.tmp` → `os.replace` (`:172-174, 181-183, 273-277`).
- So readers never see a torn file. What they can see is: `.tmp` files; entries newer than the index; and, briefly
  during an index rewrite, a `report.json` newer than the `report` hash in the index.
- `write_index` also deletes stale turn files from the build directory (`:254-258`). That is one more reason to copy
  only what the index lists.

**Progress and final-size estimates** [V for the log numbers; I for the projections]:
- **SRP, 552-flop phase.**
  - The log reads `[286/474 817 min, ~537 min left] srp_sb_bb_2max QcJc6d …`. The second run started with 474 to do,
    after 78 from the first run, so 364 of 552 are done.
  - The last index line is `index: 1 spots, 358 flops, 2.87 MB of entries, 358 turn files (7.40 MB)`, i.e.
    ~28.7 KB per flop (entry + turn file). The last 50 log lines average `bytes=6889 turns=24972`, ~31.9 KB per flop.
  - **Then the every-flop extension:** `.work/flop-core/hu_2max_all.log` shows a chained run waiting on the 552
    build. `.work/SCHEDULE.md:241` reads: "user approved 'Yes, extend it': heads-up srp_sb_bb_2max on every flop
    (other 1,203 flops after the 552, +~33 CPU-h)".
  - **Final: 1,755 flops × 28.7–31.9 KB ≈ 50–56 MB, about 3,510 bin files**, plus `report.json` at ~0.46 MB.
  - Wall time [I]: ~7.5–9 h to finish the 552, then roughly 2–3 days for the 1,203 at the observed ~21 entries/h on
    one process.
- **Limped pot.**
  - The log reads `[22/424 42 min, ~775 min left] lp_sb_bb_2max AcTd3h …`: 150 of 552 done. The last index line is
    `148 flops, 1.72 MB of entries, 148 turn files (2.60 MB)`, ~29.2 KB per flop.
  - `.work/SCHEDULE.md:254` says it was approved on 552 flops.
  - **Final: 552 × ~29.2 KB ≈ 16.1 MB, 1,104 bin files.**
  - Wall time [I]: the log ETA is ~13 h. The real rate since 2026-11-02 16:45 is ~11 entries/h, because the lane
    yields memory and restarts ten times, so ~36 h is more likely.
- **Total HU ≈ 67–73 MB, about 4,620 files.** That is about 7% of a 1 GB Pages site. Each file is under 60 KB.

### 4.3 Where to put Lizard-owned data

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| **New repo `michaellhan/lizard-library`, Pages from `main` root, served at `/lizard-library/`** | Same origin (no CORS, COEP-clean). Its own cadence and rollback, independent of app deploys. Published from the Mac, where the data is. Same pattern as the proven `deploy_library.sh`. No Actions minutes (legacy build) | One more repo and Pages site | **Recommended** |
| Orphan `data` branch in `lizard`, copied into the Pages artifact by CI | One site; app and data versions are atomic together | Every data refresh needs an app redeploy. The artifact grows by 70–320 MB. Uses Actions minutes and artifact storage if the repo is private. Data and app rollback are tangled | No |
| Data inside a locally built Pages artifact | | Incompatible with CI builds (a2) | No |
| Cloudflare R2 behind a Worker on `/lizard-data/*` | No 1 GB cap, free egress, incremental uploads | New infrastructure and credentials, zone route change. A different origin (a custom R2 domain) would need CORS + CORP for COEP | Future, only if data exceeds ~1 GB |
| Push into `michaellhan/gto-solver-library` | | **Forbidden** (owned by another workflow) | Never |

Repo visibility for `lizard-library`: the Pages output is public whatever the repo visibility. A public repo only
makes a bulk `git clone` easier, and the index lists every file URL anyway. Private is still slightly better and
costs nothing extra (the legacy build uses no workflow minutes [I]).

### 4.4 Safe incremental sync design (read-only source, validated, atomic publish)

**Invariants**
- Source directories (`/Users/mhan/Desktop/projects/gtosolver/.work/hu-lib`, `.../hu-lp-lib`) are opened read-only.
  The script never writes, moves, deletes, `chmod`s or `rsync --delete`s there. It refuses to run if any destination
  path resolves inside `/Users/mhan/Desktop/projects/gtosolver`.
- Only **indexed** entries are copied. Anything not listed is ignored: `.tmp` files, entries newer than the index,
  turn files not listed.
- Every copied file is validated against the index or its own header, **after** copying, on the copy.
- A publish is all-or-nothing: one orphan commit, force-pushed. Pages swaps the whole site at once.
- Never publish fewer flops per spot than the previous publish unless `--allow-shrink` is given.

**Algorithm** (stdlib Python, no solver import; CPU is a few seconds and RAM < 100 MB):

```text
for src in [hu-lib, hu-lp-lib]:
    raw = read(src/index.json); idx = json.loads(raw)            # atomic file (os.replace)
    assert idx.format == 2 and idx.tree == LIZARD_EXPECTED_TREE   # snapshot's flop_library.tree_key
    for spot in idx.spots:
        stage/<spot.id>/ <- copy of src/<spot.id>/report.json, ranges.json
        if sha1(report.json)[:10] != spot.report: retry later (index rewrite in progress) -> keep the previous
           published report + previous flop set for this spot
        for flop, h in spot.flops:
            b = copy src/<spot.id>/<flop>.bin -> stage; if sha1(b)[:10] != h: drop flop (log), continue
            if spot.turns is True or flop in spot.turns:
                t = copy <flop>.turn.bin; require t[:6]==b"GTOTN1" and
                    json(zlib(t[6:])[4:4+len])["entry"] == sha1(b)[:12], else mark the flop's turn missing
        rewrite spot.flops/turns to exactly what validated (turns: True if all, else list)
merged = {"format":2, "tree":…, "spots":[hu spots…]}      # one Lizard index; ids don't collide with 6-max ids
checks: JSON round-trips; every listed file exists; counts >= last release; total < 900 MB; max file < 50 MB;
        file count < 50k; no names other than *.json/*.bin/.nojekyll
write stage/index.json last; touch .nojekyll; record manifest.json {source mtimes, counts, sha of index, ts}
release dir: library-build/releases/<UTC ts>/  (gitignored; keep the last 5 for rollback)
publish: cd release; git init -b main; git add -A
         if gh api repos/michaellhan/lizard-library/commits/main --jq .commit.tree.sha == git write-tree: exit
         git commit -m "lizard-library: srp_sb_bb_2max N, lp_sb_bb_2max M"; git push -f origin main
verify:  poll https://www.michael-han.com/lizard-library/index.json until its size or ETag matches,
         then fetch 10 random entries with ?v=<hash> and check sha1
```

**Cadence:** run it by hand, or from launchd/cron every 6 h while the builds run. That stays far below the
10 builds/hour soft limit and moves about 70 MB per publish.

**Client rules:** load `/gto-solver-library/index.json` and `/lizard-library/index.json` into a composite library,
where each spot keeps its own base URL. Prefer upstream's copy if it ever ships the same spot id. Check sha1 against
the index and drop mismatches. Treat a missing flop as "solve live".

### 4.5 GitHub limits that matter [D unless noted]

| Limit | Value | Lizard exposure |
|---|---|---|
| Published Pages site | ≤ 1 GB | App shell ~10–30 MB [I]; `lizard-library` 70 MB, or ~320 MB with a 6-max mirror |
| Source repo | 1 GB recommended | user site already 1.09 GB [V], another reason against (b) |
| Pages deployment timeout | 10 min | fine |
| Pages bandwidth | soft 100 GB/month | per site [I]; a flop view is ~1.5–8 KB + 10–30 KB, so 100 GB is ~3–5 M views |
| Builds per hour | soft 10 (not for custom Actions workflows) | library cadence ≤ 4/day |
| Pages artifact (Actions) | tar < 10 GB, no symlinks or hard links | fine |
| File size | git rejects > 100 MB, warns > 50 MB | largest library file is 732 KB [V] |
| Push | 2 GB per push | fine |
| Actions (private, Pro) | $18 ≈ 3,000 Linux min/month; artifact storage 1 GB | set `retention-days: 1` |
| Usage policy | Pages "is not intended for … SaaS" or commercial transactions | revisit before any paid tier, and move to Cloudflare if one ships |

---

## 5. Public vs private repository for `michaellhan/lizard`

**What is already public today, through the live site** [V]:
- `/gto-solver/gto/*.py`: every Python module of the solver, e.g. `advisor.py` is 558,959 B and returns 200.
- `solver.zip`: Python, treys and the compiled `core*.wasm` / `mwcore*.wasm`.
- Every page script, un-minified.
- The entire 6-max library, through a public repo.

**What a public `lizard` repo would add:**
- The C core source `solver/core/gtocore.c` and `mwcore.c` (484 KB). The site ships only its wasm.
- `solver/scripts/` (896 KB): library builders, calibration and fitting tools, sanity sweeps.
- `solver/tests/` (2.5 MB), including the published-reference tables.
- `solver/README.md` (516,684 B of methodology and measured accuracy).
- `solver/docs/*research.md`.
- **`solver/docs/legal/*.md`**: DRAFT privacy, terms, refund and third-party notices that describe a planned paid
  tier (Merchant of Record, subscriptions).
- `solver/cloudflare/explain-proxy/wrangler.toml`: allowed origins, rate limits and a KV namespace id. These are
  infrastructure identifiers, not secrets.
- `IMPLEMENTATION_PLAN.md`, which frames the project as GTO Wizard parity.
- The full history of all of the above.

**Third-party provenance** (`grep -c` / `grep -o | wc -l`) [V]:

| Term | README.md | `solver/gto` (files/occurrences) | scripts | tests | docs |
|---|---|---|---|---|---|
| `GTO Wizard` | 21 | 8/25 | 4 | 42 | 28 |
| `gtowizard` (URLs) | 1 | 2/2 | 0 | 5 | 14 |
| `gtopreflop` | 9 | 2/27 | 0 | 26 | 11 |
| `Upswing` | 1 | 1/8 | 0 | 4 | 2 |
| `PokerCoaching` / `pokercoaching` | 0 | 0 | 0 | 1 | 1 / 1 |
| `Poker Academy` | 3 | 2/13 | 0 | 11 | 8 |
| `GTO Gecko` | 2 | 1/3 | 0 | 4 | 2 |

What the mentions are:
- They are **citations of published aggregate frequencies, used as calibration targets**. For example,
  `gto/preflop.py:93-94, 124, 130-133, 252-271, 355-386` give gtopreflop.com, Poker Academy and GTO Wizard blog
  figures with URLs. `tests/preflop_refs.py:1-20` reads "Published 6-max 100bb cash preflop solver frequencies…".
  `gto/exploit.py:19-20, 50, 108-139` cites Upswing LeakBuster pool statistics. `tests/test_gto.py:1620-1648` gives
  c-bet ranges citing BeyondGTO, Upswing, and "PeakGTO via PokerCoaching".
- The README states "Preflop charts are written by hand, not solver output … matched to published solves"
  (`solver/README.md:4547`).
- `gto/breakdown.py:1` describes the views as "GTO Wizard-style".
- I found **no** imported third-party range files or solution dumps. That is an inference from these greps, not a
  full audit. The legal risk looks low, because these are facts with attribution [I, not legal advice]. But a public
  repo naming a competitor throughout invites scrutiny that a private one does not.

**Secrets scan** (patterns `sk-ant-api…`, `ghp_`, `github_pat_`, `AKIA`, private keys, `xox[bp]`; values not
copied) [V]:
- `solver/tests/js/explain.test.js:16`: an obviously fake placeholder.
- `solver/tests/js/store.test.js:14`: a key-shaped test fixture (`const KEY = "sk-ant-api03-…"`). It looks like a
  fixture, but **confirm it is not a real key**. Either way, in a public repo, GitHub secret scanning and push
  protection would likely flag it.
- No `.dev.vars` or `.env` files are present. `.gitignore` already excludes `.env*`, `.dev.vars`, `*.pem` and
  `*.key`.
- Also note: `web/vite.config.ts:19` has `sourcemap: true`, so production `.map` files expose the original
  TypeScript even from a private repo. Use `sourcemap: "hidden"` (upload maps elsewhere) or do not deploy `*.map`.

**Recommendation: create `michaellhan/lizard` as PRIVATE.**
- The user calls the solver valuable IP, and upstream `gto-solver` is private.
- Pages from private repos works on this account.
- The cost is Actions minutes (within Pro's included $18) and a 1-day artifact retention.
- `IMPLEMENTATION_PLAN.md:99` says "Create public `lizard` repo if safe for publication". On this evidence it is not
  clearly safe, so the conservative default is private, and the decision should go to the user.
- If a public face is wanted later, split the repo: a public repo with the app shell only, and the engine as a private
  submodule or a build artifact.

---

## 6. Runbook

All commands below are **future actions**. Each step that creates a repo, enables Pages, pushes, or changes a setting
needs the user's explicit approval at the time it is run. None was run during this research.

### 6.1 One-time setup

```bash
# 0. Preconditions (read-only)
gh auth status                                  # account michaellhan, scopes include repo, workflow
gh api repos/michaellhan/lizard  >/dev/null 2>&1 && echo "EXISTS: stop" || echo "free"
gh api repos/michaellhan/michaellhan.github.io/contents/lizard >/dev/null 2>&1 && echo "COLLISION: stop" || echo "free"
curl -s -o /dev/null -w '%{http_code}\n' https://www.michael-han.com/lizard/   # expect 404 before first deploy
# record baselines for the no-regression checks
curl -s https://www.michael-han.com/gto-solver/ | grep -o 'const WORKER_VERSION = "[^"]*"' > /tmp/claude-baseline-gto.txt
curl -sI https://www.michael-han.com/gto-solver-library/index.json | grep -i etag >> /tmp/claude-baseline-gto.txt
gh api repos/michaellhan/michaellhan.github.io/commits/main --jq .sha >> /tmp/claude-baseline-gto.txt

# 1. Repo (PRIVATE), after the secret/IP scan in section 5
cd /Users/mhan/Desktop/projects/lizard
git init -b main && git add -A && git status --short | grep -E 'flop_library|\.env|node_modules' && echo "STOP: ignored data staged"
git commit -m "Lizard: initial import"
gh repo create michaellhan/lizard --private --source=. --remote=origin --push

# 2. Pages from GitHub Actions (no CNAME: inherits www.michael-han.com/lizard/)
gh api -X POST repos/michaellhan/lizard/pages -f build_type=workflow
gh api repos/michaellhan/lizard/pages --jq '{html_url, build_type, cname}'
#   expect html_url "http://www.michael-han.com/lizard/", cname null.  Never add a CNAME file to this repo.
```

### 6.2 `.github/workflows/deploy.yml` (in `michaellhan/lizard`)

```yaml
name: Deploy Lizard
on:
  push: { branches: [main] }
  workflow_dispatch:
permissions: { contents: read, pages: write, id-token: write }
concurrency: { group: pages, cancel-in-progress: false }
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - uses: actions/setup-python@v5        # if scripts/build-solver-assets.mjs runs solver/scripts/build_bundle.py
        with: { python-version: "3.12" }
      - run: npm ci
      - run: npm run typecheck && npm run lint && npm test
      - run: npm run build
        env: { LIZARD_BASE: /lizard/ }
      - run: test -f web/dist/index.html && test -f web/dist/404.html && test -f web/dist/sw.js
      - uses: actions/upload-pages-artifact@v4
        with: { path: web/dist, retention-days: 1 }
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment: { name: github-pages, url: "${{ steps.d.outputs.page_url }}" }
    steps:
      - id: d
        uses: actions/deploy-pages@v4
```

**`scripts/postbuild.mjs` requirements** (`package.json` already calls it):
- Copy `dist/index.html` to `dist/404.html`.
- Copy it to `dist/<route>/index.html` for each static top-level route.
- Fail the build if any `dist/**/*.html` references `/assets/` without the `/lizard/` prefix.
- Fail if any non-hashed file other than `sw.js`, `404.html`, `index.html`, `manifest.webmanifest` and `robots.txt`
  has no `?v=` or hash.
- Never depend on `solver/gto/static/flop_library/` (gitignored, so absent in CI).

**App rules:**
- `<link rel="canonical" href="https://www.michael-han.com/lizard/…">`.
- Inline redirect: `if (location.protocol === "http:" && !/^(localhost|127\.0\.0\.1)$/.test(location.hostname))
  location.replace("https:" + location.href.slice(5))`.
- Every storage key is prefixed `lizard:`. Cache names are `lizard-*`. IndexedDB names are `lizard-*`.

### 6.3 Library publish (from the Mac)

```bash
# one-time (approval required)
gh repo create michaellhan/lizard-library --private --description "Lizard heads-up flop library (served at /lizard-library/)"
# first publish creates main; then enable Pages on it:
scripts/library/publish-hu.sh              # implements section 4.4: stage -> validate -> release dir -> orphan force-push
gh api -X POST repos/michaellhan/lizard-library/pages -f 'source[branch]=main' -f 'source[path]=/'
# routine (any time; low CPU; never touches .work beyond reading)
nice -n 19 scripts/library/publish-hu.sh   # no-op when the tree SHA is unchanged
```

### 6.4 Verification checklist (after every deploy)

```bash
B=https://www.michael-han.com
# unaffected
curl -s -o /dev/null -w 'home %{http_code}\n' $B/                                        # 200
curl -s $B/ | grep -q '<title>' && echo home-ok
curl -s $B/gto-solver/ | grep -o 'const WORKER_VERSION = "[^"]*"'                        # equals baseline (unless upstream deployed)
curl -s -o /dev/null -w 'gto study %{http_code}\n' $B/gto-solver/study/                  # 200
curl -sI $B/gto-solver-library/index.json | grep -iE '^HTTP|etag'                         # 200, etag = baseline unless upstream published
gh api repos/michaellhan/michaellhan.github.io/commits/main --jq '.sha,.commit.message'   # no Lizard commit there, ever
curl -s $B/nonexistent-xyz | grep -o '<title>[^<]*'                                       # still "Not found · Michael Han"
# Lizard
curl -s -o /dev/null -w 'lizard %{http_code}\n' $B/lizard/                               # 200
curl -s -o /dev/null -w 'study %{http_code}\n'  $B/lizard/study/                          # 200 (route copy)
curl -s -o /dev/null -w 'deep %{http_code}\n'   $B/lizard/study/srp-btn-bb/Ks7d2c/        # 404 status but app HTML:
curl -s $B/lizard/study/srp-btn-bb/Ks7d2c/ | grep -q 'id="root"' && echo deep-link-app-ok
curl -sI https://michael-han.com/lizard/ | grep -i location                              # https://www.michael-han.com/lizard/
curl -sI $B/lizard | grep -iE '^HTTP|location'                                           # 301 -> /lizard/
for a in $(curl -s $B/lizard/ | grep -oE '/lizard/assets/[^"]+\.(js|css)' | sort -u); do
  curl -s -o /dev/null -w "%{http_code} %{content_type} $a\n" "$B$a"; done                # all 200, JS/CSS types
curl -sI $B/lizard/sw.js | grep -iE '^HTTP|content-type'                                  # 200 application/javascript
curl -s -o /dev/null -w 'lib %{http_code}\n' $B/lizard-library/index.json                 # 200 (once published)
```

Browser checks (Playwright or by hand, in a fresh profile):
- After the first-load reload, `navigator.serviceWorker.controller.scriptURL === "https://www.michael-han.com/lizard/sw.js"`.
- `(await navigator.serviceWorker.getRegistration()).scope === "https://www.michael-han.com/lizard/"`.
- `crossOriginIsolated === true` and `typeof SharedArrayBuffer === "function"`.
- No console errors. A Study spot loads entries from `/gto-solver-library/` and an HU spot from `/lizard-library/`,
  with the sha1 checks passing.
- Refreshing a deep link restores the same view.
- Then open `/gto-solver/` in the same profile. Its own SW is still in charge and its stored hands and settings are
  intact, which shows Lizard did not touch `gto-*` keys or the `gto-solver` cache.

### 6.5 Rollback

1. **App, bad release.**
   - `git revert <sha> && git push` re-runs the deploy from `main`.
   - Faster: `gh run list -w deploy.yml`, then `gh run rerun <last-good-run-id>`, which rebuilds that run's commit.
     The `github-pages` environment usually allows only the default branch, so prefer revert or re-run over
     dispatching a tag.
   - Expect ≤ 10 min for browsers to see the new HTML (600 s cache). Hashed assets need nothing.
2. **SW problem:** deploy a `sw.js` whose `activate` calls `self.registration.unregister()` and does nothing else.
   Because the SW is pass-through, this only loses isolation, which means unthreaded solving.
3. **Kill switch** (approval required): `gh api -X DELETE repos/michaellhan/lizard/pages`. `/lizard/` reverts to the
   user site's 404, and nothing else changes.
4. **Library:** `scripts/library/publish-hu.sh --release library-build/releases/<previous ts>` force-pushes the
   previous validated tree. The client also tolerates a missing library, because it falls back to live solving.
5. **Never** roll back by touching `michaellhan.github.io`, `gto-solver-library`, Cloudflare zone settings or DNS.

---

## 7. Decisions for the user, and open items

1. Private vs public for `michaellhan/lizard`: recommended private (§5). `IMPLEMENTATION_PLAN.md:99` assumed public.
2. Permission to create `michaellhan/lizard` and `michaellhan/lizard-library` and enable Pages on both. These are
   setting and repo changes.
3. Pre-existing domain issues, outside Lizard's scope: the expired Pages origin certificate (`bad_authz`, expired
   2026-11-02) and the missing http→https redirect at Cloudflare. The user should confirm the Cloudflare SSL mode and
   decide whether to enable "Always Use HTTPS". The latter is a domain-wide change.
4. Whether to mirror the 6-max library into `/lizard-library/` now, to decouple from upstream force-pushes, or only
   if the format diverges.
5. A homepage link to `/lizard/` would mean editing the user site's `index.html`. That is optional and separate.
6. Upstream bug, for the upstream owner (do not fix from Lizard): `/gto-solver/reports/<spot>/` and
   `/gto-solver/drills/<spot>/` 404, because `gto/routes.py:100` looks for `flop_library/index.json` in the site
   folder, and that file moved out with the library split.
