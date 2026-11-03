# Lizard — Master Implementation Plan

> **Instructions for Claude Code (Claude Desktop, Local mode):** This is the authoritative implementation plan for the Lizard project. Read it in its entirety, inspect the actual repository and runtime environment, and execute phases sequentially. **Do not stop after writing a plan. Implement, test, document, commit, and push real functionality.** Continue autonomously through the next feasible phase. Ask the user only for essential credentials, permission to perform a consequential action, or an actual blocker. Respect tool permission gates and do not bypass them.

## 0. Mission, guardrails, and definition of success

Create **Lizard**, an original, polished poker study, solver, training, and analysis platform at **https://michael-han.com/lizard/**, using my existing **https://michael-han.com/gto-solver/** implementation as the numerical and game-rules foundation. Benchmark functionality and UX against the publicly documented capabilities of GTO Wizard, aiming for broad parity. **Do not copy proprietary code, assets, design files, paid solution data, or protected content; don't bypass paywalls.** Original Lizard branding. Feature parity is aspirational; never falsely claim exact GTO Wizard parity or mathematical accuracy without implementation and validation.

The source repository must be a **separate GitHub repository named `lizard`**, on the authenticated GitHub account (expected `michaellhan/lizard`; verify `gh auth status` and `gh api user` first). The new local project directory must be named `lizard`. **Do not move, delete, or overwrite the existing gto-solver project.** Commit and push in small, tested milestones. Preserve all other routes on michael-han.com.

**Critical overnight execution note:** Claude Desktop's local session may pause on permissions, context limits, tool failures, or sleep; it cannot guarantee completion of all phases unattended. Work continuously while the session is active, make progress persistent, and leave clear resume instructions. A phase is complete only if code exists, tests pass, features work, documentation is updated, and it has been committed/pushed where possible.

**Ethical scope:** Review completed hands, simulation, and study. No live poker client reading, real-time active-table assistance, screen capture hooks, or automated play on third-party poker sites.

**Priority order:** Correctness and noninterference with running jobs > working deployed NLHE Study/Practice > solver accuracy and coverage > analysis/reporting > advanced tournaments > PLO and optional extras > cosmetic polish. Ship incremental working versions rather than waiting for theoretical full parity.

## 1. Existing solver: read, audit, and reuse

The existing GTO Solver is a Python + NumPy solver with vanilla JavaScript UI, Pyodide-in-Web-Worker local execution and optional faster local Python HTTP backend. It already supports:

- No-Limit Hold'em for 2–9 players; blinds, antes, straddle, distinct stacks, side pots, short all-ins, incomplete raises that do not reopen action, uncalled bet returns, and complete hand navigation.
- Keyboard/card interaction, rewinding, shareable spots, text exports, desktop/mobile interfaces.
- Preflop hand-authored 100bb mixed strategy charts for opens, vs opens/3-bets/4-bets, cold calls, squeezes, limps; adjustments for limpers, stacks, rake, antes and straddles; short-stack push/fold equilibria. Charts are approximate and are not fully solved preflop equilibria.
- Postflop discounted CFR (DCFR) on bet-size trees, vectorized 7-card evaluation, fast sorted-range showdown on rivers, earlier street range propagation conditioned on actions, heads-up and 3-way CFR, partly heuristic 4+-way handling.
- Quick/Fast/Accurate solve tiers, convergence/exploitability indications where measurable, one-click re-solve; benchmarks against an open-source postflop solver on identical trees.
- Precomputed 6-max 100bb single-raised pot flops (BTN/CO vs BB on all flops; HJ/UTG/SB vs BB on 552 representative flops) plus several 3-bet pots; common 3-way library. Presolved 6-max flops have approximately 0.15%-pot equilibrium tolerances on supported trees. Confirm actual manifests and data, not assumptions.
- Per-hand mixed strategies, EV by action, whole-range frequencies, 13x13 matrix, made hand/draw breakdowns, equity distributions, nut advantage, pot odds, and street-closed equity; per-decision EV-loss reviews.
- Custom street bet sizing, PIO-format custom ranges, size optimization, nodelocking (calling station/nit/maniac/overfolder/custom), exploit/player-pool mode, capped rake/no flop no drop, ICM using Malmuth-Harville and some risk-premium-based approximations.
- Practice vs opponents with actual private hole cards, ring games, random seats, raised/3-bet/BvB flop drills, solving ahead, post-decision coaching, long-run scoring, correctly settled showdowns and side pots, synthesized sounds.
- Claude-based AI explanations via rate-limited Cloudflare Worker or user key, copy-for-AI prompt.
- Imports from PokerStars, GGPoker, 888, partypoker, Winamax, WPN/ACR, Ignition/Bovada, iPoker; automatic hand/session grading, EV loss, bb/100-style statistics, reports, 20 largest mistakes, exports and session history.
- Flop reports, range drill/trainer, Study tree navigation, EV/equity/EQR.
- CLI and local JSON HTTP API, approximately 330 Python unit tests and 240 Node tests (verify counts/current status).

Known limits: charts are not full preflop equilibrium solves; coarsely abstracted bet sizing; flop trees simplify later streets; 4+-way postflop uses some heuristics; preflop ICM partly applies risk-premium adjustment to chip EV charts. **Never promote these to exact solves without evidence.**

### 1.1 Critical: currently running precomputed heads-up builds

**Never stop, pause manually, restart, kill, renice, delete, modify the in-progress file outputs, rewrite scripts in use, or duplicate these jobs.** They run on the same Mac that will be used for Lizard development. Investigate safely, using read-only commands and low-impact inspection. If uncertainty remains about process/output ownership, leave it alone.

Two concurrent **heads-up SB-vs-BB** library builds:

1. **Single-raised pot** (SB raises / BB calls): a standard **552 representative flops** at approximately **0.1% of pot** from equilibrium, with stored **turn files** for instant subsequent turn lookups. At approximately **5:20 AM, November 3, 2026**, 261 of the then-474 remaining flops were complete. It automatically proceeds to **1,203 additional flops** for full flop coverage after finishing the first batch. The 552+1,203 totals **1,755 strategically distinct flop classes**; verify exact canonical mapping in the code. Original estimate at that time: about 10.5 hours for 552 batch, then 2–3 more days for remainder. These are point-in-time estimates, not current progress claims.
2. **Limped pot** (SB limps / BB checks): **552 representative flops**; lower-priority concurrent process, programmed to pause itself when **free memory is below 40%**. Approximately 435 remained at the same time; no reliable ETA.

Mandatory controls:
- Treat both as **externally owned, in-progress production work**. Do not contend for RAM/CPU; cap subagents and local parallel test/build jobs. Start at most **2 development subagents simultaneously**, and only if resources permit. Avoid running expensive solver benchmarks/large Playwright batches until there is safe headroom.
- Do not interfere with the automated transition to the 1,203-flop batch.
- Support **partial incremental library manifests**: detect completed and valid entries, never read partially written outputs as completed, and fall back to live solving when appropriate.
- Preserve/checkpoint all intermediate outputs; **never rebuild existing successful nodes**. Don't commit multi-GB artifacts directly to Git. Choose an appropriate versioned distribution/caching mechanism.
- Coordinate solution files through read-only indexing or snapshots/copies of validated completed files, without renaming/moving originals. Ensure no race with a writer.
- Development should be able to progress without touching running solve processes.

## 2. Execution process, agent coordination, and persistent state

At the start of each session:
1. Read this file, `CLAUDE.md` if present, `docs/PROGRESS.md`, `docs/ROADMAP.md`, `docs/FEATURE_MATRIX.md`, and the latest Git commits. Check working tree before edits.
2. Inspect source, tests, actual environment, hosting, currently running builds, and available resources safely. Never infer success from old documentation.
3. Select the earliest incomplete phase, make a practical task list, and execute. Delegate independently scoped code audits, numerical tests, UI review and hosting research to subagents. Avoid simultaneous writes to same files. Limit local agents while precompute is running.
4. Before significant rewrites, add regression tests and keep the original solver accessible. Make measured, incremental changes.
5. At the end of every milestone: run targeted tests and build/type checks, verify real UI flows, update progress/feature matrix, commit/push safe code, then continue to the next task if possible.

Subagent roles, as needed: existing-solver auditor, poker rules reviewer, numerical/ICM reviewer, frontend UX implementer, data/library ingestion engineer, test/Playwright engineer, hosting/security auditor. Give each precise outputs and nonoverlapping write scopes.

### Persistent documentation

Create and maintain:
- `docs/EXISTING_SOLVER_AUDIT.md` — module inventory, integration plan, tests, numerical constraints.
- `docs/ARCHITECTURE.md` — components, state, API contracts, solver/runtime, data flows.
- `docs/FEATURE_MATRIX.md` — feature-by-feature working/partial/approximate/not implemented status with evidence.
- `docs/ROADMAP.md` — prioritized backlog, explicit acceptance criteria, dependencies.
- `docs/ACCURACY.md` — exact vs approximated, numerical benchmarks, tree abstractions, uncertainty.
- `docs/DEPLOYMENT.md` — verified hosting configuration, deployment steps, smoke checks, rollback.
- `docs/PROGRESS.md` — append chronological logs: what changed, tests actually run, commit hashes, limitations, next tasks, and whether active precompute jobs were left untouched.
- `README.md` and a concise `CLAUDE.md` pointing to this plan and safe commands.

Do not falsify test logs or claim coverage from the UI alone. A progress log should allow resuming after context resets.

## 3. Technical architecture and UI conventions

Prefer:
- **React + TypeScript + Vite**, precise poker domain model, suitable small state manager (e.g. Zustand), accessible primitives, scoped reusable components, Tailwind or a consistent alternative. Strong typing for solver answers and game states.
- **Python + NumPy solver preserved** behind a well-defined interface. In-browser Pyodide workers for local solving; optional Python API/compute workers for heavier jobs. Never execute costly numeric work on the main browser thread. Retain CLI and JSON APIs when possible.
- **IndexedDB** for user-owned local hands, presets, sessions, notes and training progress, versioned with safe migrations. Lazy-load versioned and compressed presolved libraries. Optional backend for remote compute and sync; accounts should not be required for local features.
- React routing configured for **`/lizard/`**, including asset base URL, Web Workers, Pyodide runtime, deep-link refresh, query/share links, and browser history fallback. Never break `/gto-solver/` or other paths.
- Typed solver adapter with inputs (game type, players, positions, stacks, pot, bet tree, history, board, ranges, rake, tournament payouts, solve precision, node locks) and outputs (strategies, action EV, hand/combo weights, full-range aggregates, accuracy/provenance, convergence, errors, timing). Support progress, cancel, timeout and cache keys.
- **Solution provenance and honest accuracy labels** everywhere: validated presolved; freshly computed numerical solve; tuned approximate preflop chart; ICM risk-premium adjustment; heuristic multiway model; unsupported. Only show exploitability if actually computed and mathematically meaningful. Show actual tree and size abstraction when relevant.
- Independent game rules from poker strategy algorithms. Reuse exact betting state machine. No duplicate rules implementation in UI.

Design direction: a credible specialized poker tool — professional dark default, efficient compact typography, dense but readable ranges/actions data, distinct action colors, excellent desktop workflows and meaningful mobile reflow. Original Lizard identity; don't clone protected visuals. No decorative dead buttons or sample statistics presented as real user data. Build skeleton states and honest unavailable states.

## 4. Phase 1 — Audit, repository, foundation and early deployment

**Tasks**
1. Find source code for `gto-solver` in local workspace (ask only if genuinely impossible to locate). Inventory Python solver, JS frontend, tests, libraries, scripts, server API, Pyodide integration, local deployment, Git remotes, data formats, existing builds. Read original unit and Node tests; run non-resource-intensive baseline tests and report actual results.
2. Create separate `lizard/` working folder by safely copying/reusing compatible code. Do not disrupt original working tree or active solution output paths. Consider preserving upstream origin/attributions and license obligations.
3. Establish frontend scaffold, solver integration layer, app routing/layout, basic test suites and local dev commands. The first version should actually load existing solver functions and show a solved spot.
4. Research up-to-date official GTO Wizard docs/features and write parity matrix: Study, Practice, custom solves, aggregate reports, Hand Analysis, library, tournaments (ICM, satellites, KO/PKO/mystery bounties), 2–9-handed Hold'em, PLO4, range builder, nodelocking, and optionally multi-table practice. Distinguish publicly documented from proprietary/inaccessible capabilities.
5. Inspect authentication with `gh auth status` and `gh api user`. **Verify owner** instead of blindly assuming spelling. Create public `lizard` repo if safe for publication and authorized by project request; scan source, licenses, secrets, proprietary artifacts before publishing. If account differs or repo exists, verify and handle safely; don't overwrite an unrelated repo. Initialize `main`, proper `.gitignore`, first tested commit and push. Use `gh repo create OWNER/lizard --public --source=. --remote=origin --push` as a template only after safety checks.
6. Inspect how `michael-han.com` currently serves its routes. Choose a minimally disruptive deployment: GitHub Pages project route if compatible with existing custom-domain behavior, or Cloudflare path-based routing. Avoid accidental root-domain takeovers. Deploy an initial working shell when safe, then keep deploying verified increments.

**Acceptance:** `lizard` local project exists; existing solver remains intact; initial real study spot works; repository is correctly created and pushed; baseline tests, feature matrix and architecture documented; active builds untouched; an initial `/lizard/` deployment verified if technically accessible.

## 5. Phase 2 — Commercial-grade frontend and navigation

Implement functional top-level areas: **Study, Practice, Analyze, Custom Solver, Reports, Library, Settings**, plus a small overview/dashboard. Build adaptive layout and consistent navigation. Route all live controls to working state/solver operations; explicitly mark unsupported work instead of dead interfaces.

Core reusable components: `PokerTable`, `PlayingCard`, `CardPicker`, `RangeMatrix`, `ComboMatrix`, `ActionHistory`, `ActionFrequencyBar`, `ActionEVTable`, `EquityChart`, `StrategyBreakdown`, `SolutionSelector`, `SolverSettings`, `SolverProgress`, `HandTimeline`, `HandHistoryList`, `TrainingFeedback`, `TrainingStats`, `FilterPanel`, `ResizableWorkspace`.

**Study layout:** compact top bar for game/stacks/rake/solution type/current node and breadcrumb; interactive 13×13 matrix left; action frequencies/strategy, EV/equity and board context center; combo strategy, breakdown and filters in a resizable right/bottom panel. Back/forward nodes, direct hand selections, share links, keyboard controls, card picker, persistent panel settings.

**Practice layout:** visible seats, button, blinds, antes, stacks, pot, bets, dealer button, cards, community board, all-in/fold states, action buttons and sizes, clear post-decision feedback, next spot and retry. Mobile table that is actually usable.

**Analyze:** import, past sessions, filterable hands, leak reports, selected-hand jump to Study. **Custom Solver:** structured game/range/tree/accuracy settings, tournament payouts and node locks. **Reports:** flop texture and aggregate views, coverage labels. **Library:** saved spots/hands/drills/ranges, tags, search.

Interaction requirements: undo/replay, deep links, meaningful loading/cancellation/errors, accessible controls and focus, typed state, responsive desktop/tablet/mobile; no oversized generic dashboard aesthetic. Visual QA through Playwright screenshots at 1440px, 1024px and 390px. Check every route for correctness, overflow, and mobile function.

**Acceptance:** Major pages render and operate with real data; genuine Study/Practice flow; no broken routing; targeted browser tests pass.

## 6. Phase 3 — Full NLHE Study Mode and presolved library

**Complete navigable tree:** choose game type, seats (2–9), effective/individual stacks, positions, rake, ante/straddle, preflop line, flop/turn/river, action sizes; move node-by-node from preflop to river, with valid next actions and board replacements. Breadcrumbs, back/forward, saved node, compare nodes, deep links, and fallback solve when a spot is not presolved.

**13×13 range matrix:** correct weighted 169 class display; expand to individual legal combos; board blockers, card removal, suit-sensitive strategies, hand category/range filters; views for action mix, frequency, EV, equity, EQR; click/hover combo-level EV and distributions. Never mask suit differences with false averages. Verify denominator and normalization.

**Actions and breakdown:** every legal solver-tree action and size, whole-range frequency, combo strategy, action EV, pot odds, overall range equity, nut advantage, draw and hand-category frequencies, equity distributions, value/bluff composition where defined, action-filtered conditional composition.

**Presolved solution library:** manifest/index by format, positions, preflop line, stack, ante/rake, bet tree, board canonical class, solver version and convergence. Integrate existing 6-max single-raised and 3-bet libraries, common 3-way library, and incremental heads-up SB/BB libraries. Support exact suit isomorphism/canonicalization with correct inverse mapping and collision tests. Distinguish 552 representative flops from completed 1,755 classes; don't claim full coverage until validated. Include turn files for completed heads-up flop nodes and cache actual completed entries only. Download/load libraries lazily and in bounded chunks, with checksum/integrity if feasible; never rely on reading partially written active outputs.

**Aggregate flop reports:** strategy %, EV, equity, EQR, texture: paired/unpaired, monotone/two-tone/rainbow, high card, connectedness, straight/flush dynamics, position, pot type, action; filters, sort, aggregation weights and representative-flop vs full-board counts. Don't extrapolate sample coverage as exact universal results.

**Tests:** canonical suits and inverse mapping, 1,326 NLHE combos and card removals, matrix counts, weighted action frequencies, EV consistency, hand/range normalization, same node via distinct navigation paths, deep-link restoration, library manifest/partial write behavior, cache invalidation.

**Acceptance:** A user can traverse a hand, inspect exact legal combos and full strategy, and use available presolved solutions without waiting; cache misses visibly fall back to a supported method.

## 7. Phase 4 — Solver improvements, accuracy and tournament models

**Use existing Python implementation.** Audit and preserve correct DCFR routines, range propagation, evaluator, side pots, showdown, benchmark methodology and separation of legal actions from strategy. Add tests before modifying internals. Avoid expensive benchmarks while ongoing precompute jobs need resources.

**Rules correctness:** 2–9 seats; all legal open/3-bet/4-bet/5-bet/call/limp/squeeze/shove lines; proper min-raise/incomplete raise rules; blinds/BB ante/straddles; individual stacks and side pots; uncalled returns; rake caps and no-flop-no-drop. Test precise edge cases.

**Preflop:** add genuine numerical preflop solving incrementally for tractable configurations. The hand-authored charts remain useful fallbacks and references but are not equilibrium evidence. Include rake/stack/ante adjustments, mixed sizes, card-removal consistency and supported multiway situations. Label unsolved/abstracted charts.

**Postflop:** enhance DCFR and tree generation, all-ins, multiple bet/raise sizes, per-street sizing, runout handling, warm starts, action-conditioned ranges, nodelocking, memory footprint, serialization, cancellation and time budgets. Preserve river exactness where currently validated. Add automatic sizing by exploring candidate sizes and pruning on measured results, making abstraction transparent. Improve 3-way; 4+-way only when a real validated numerical method is implemented, otherwise keep heuristic label.

**Nodelocking/exploit:** fixed player/hand action probabilities, combo-level custom locks, profile presets (calling station, nit, maniac, overfolder), transparent population assumptions for fold/raise/bet/bluff frequencies; recompute a best response where mathematically valid. Separate equilibrium and exploit EV.

**Tournament:** chip EV; Malmuth-Harville final-table ICM; customizable payouts and stacks; bubbles and satellites; bubble factors/risk premiums; KO, progressive KO and mystery bounties. Distinguish ICM prize-equity solve, risk-premium-adjusted chart and approximate tournament/bounty model. Never falsely claim exact arbitrary-field solutions or deep-stack convergence. Correctly account for bounty ownership, distribution and all-in elimination rules.

**Performance:** browser worker / Pyodide and optional local/server solver. Quick/Fast/Accurate modes with actual measured timings; separate expensive compute pool for server solves if needed, bounded resources and progress/cancellation. Don't assume edge Workers can run unbounded NumPy. Cache by all strategically significant inputs and solver version. Prioritize avoiding current offline precompute contention.

**Numerical benchmark suite:** independent reference solver comparisons on **identical trees and input ranges**, river/turn/flop and selected 3-way spots; report EV differences, strategy deviations, exploitability only where well-defined, wall time, memory, tolerance, hardware/settings; deterministic tests where possible. Validate nodelocks, node subgames, rake/ICM scenario sanity and CEV invariants. Mark failures and uncertainty honestly.

**Acceptance:** custom solver works for supported spots; actual convergence and limitations reported; regression tests remain green; accuracy report is reproducible and precise about scope.

## 8. Phase 5 — Practice modes, range trainer and coaching

Build on the existing actual-card practice engine. Implement:
- Cash ring game with moving button and carrying stacks; random-seat practice; full hands; preflop-only; flop/turn/river single decisions; single-raised/3-bet/4-bet/BvB; short-stack push/fold; tournament chip EV/ICM; exploit-mode drills; saved custom scenarios; board/position/stack/hand-category filters.
- Genuine hidden cards for opponents, sampled from computed strategies on legal actions, correct showdowns and side pots, deterministic seeded test games. Prefetch probable next nodes without monopolizing CPU/RAM; gracefully disable under resource pressure.
- Clear configurable action/size buttons, keyboard shortcuts, next/retry/previous decision, hints and reveal strategy, reliable undo where appropriate, quick feedback. Add multi-table practice only if state isolation, performance and actual functionality are verified.
- Decision grades **Best, Correct, Inaccuracy, Mistake, Blunder** based on documented EV-loss thresholds with noise tolerance. Don't call a low-frequency but high-EV action a costly mistake merely for frequency. Show hero action EV, best EV, delta, actual frequencies, source accuracy and missing coverage.
- Statistics: total decisions, accuracy, EV loss (bb and per opportunity), positional/street/pot-type rates, streaks, biggest leaks, chronological progress. Never confuse solver EV loss with actual profit or directly inferred win rate.
- Full **range builder**: paint 13x13 cells and individual combos with mixed action weights, copy/import PIO syntax, compare submitted range to actual solver distribution, report actionable frequencies/misses, save attempts. Grading must account for fractional actions and blocked combos.
- Study plans/review queue and spaced repetition from demonstrated mistakes; personalized drill generation with saved settings.
- Reuse existing Claude AI explanations through secure rate-limited proxy, grounding prompts in actual state/solver outputs; no exposed API keys, no fabricated mechanistic justifications. Copy-for-AI option.

**Acceptance:** user configures drill -> plays real hand -> receives numerically grounded feedback -> saves result -> reopens weakness in Study -> repeats; actual playthrough and Playwright tests pass.

## 9. Phase 6 — Hand import, session analytics, reports, and saved library

**Imports:** preserve existing site parsers: PokerStars, GG/Natural8, 888, partypoker, Winamax, WPN/ACR, Ignition/Bovada and iPoker. Pasted single hand, file, bulk/multi-session, correct seats/cards/amounts/rake/side pots; reject or flag malformed/unsupported histories rather than guessing. Deduplicate, preserve original history, and stream large files safely.

**Auto review:** reconstruct every hero decision, retrieve computed/presolved/approximate advice with source label, grade chosen action, compute EV loss and store node and exact game-state metadata; replay in Study. Exclude missing/unsolved nodes from confidence-sensitive aggregates or flag coverage.

**Analytics dashboard:** hands, decisions, sessions, profit if available, solver EV loss, normalization, biggest mistakes, position/street/pot-type/size/stack/board breakdowns, date/site/stakes filtering, actual data samples. Clearly separate realized results, all-in adjustments and solver EV loss.

**Frequency comparison:** VPIP/PFR/RFI/3-bet/fold-to-3-bet/squeeze/c-bet/fold-to-c-bet/check-raise/turn and river barrels/bluff-catching and size distribution, with the correct opportunities and sampling denominators. Adjust for position/spot/coverage, show sample counts and uncertainty, avoid overconfident leaks from small samples.

**Leak explorer and reports:** clickable supporting hands, targeted practice-drill generation. Aggregate solved flop/turn/runout reports over actually available data, with texture filters, strategy/EV/equity/EQR/range and nut advantage where supported. Progress/cancel for large aggregation.

**Saved user data:** IndexedDB entries for hand/spot/solution/range/drill/report, tags/notes/search/sort/import/export, schema migrations and corruption recovery. Optional privacy-conscious sync only if secure implementation exists. Exports CSV/JSON with provenance, no false precision.

**Acceptance:** import session -> review every supported decision -> inspect measurable leaks -> Study jump -> create drill -> save and resume. Test parser fixtures, import errors, duplicated histories, frequency denominators, storage migrations, exports.

## 10. Phase 7 — PLO4, optional features, full QA and deployment

**PLO4 is a separate serious solver track, not a simple Hold'em mode toggle.** Implement correct four-hole-card rules requiring exactly two hole and three board cards, pot-limit maximum raise mechanics, side pots, hand evaluation, equity, range representation and card combinatorics. Validate with independent test vectors before strategic solving. Explore legally reusable open-source PLO methods, tractable abstractions and memory-efficient ranges. Work toward heads-up custom solutions, study, trainer, nodelocking, tourney settings, PLO history imports; label unsupported or approximate until numerically benchmarked. Don't endanger stable NLHE deliverables for speculative PLO completeness.

**Optional extras, after core features:** parallel training tables, personalized study plans, configurable desktop/tablet workspaces, saved custom reports, multiplayer/head-to-head training arena (only if a genuine tested implementation and suitable server exists), expanded presolved positions and stack/rake coverage, optional cloud compute/synchronization.

**Full feature audit:** update every line of parity matrix to WORKING / PARTIAL / APPROXIMATE / NOT IMPLEMENTED and link evidence. Compare with current official product documentation; research only public/legal interfaces. Do not imply coverage of huge libraries, deep-stack arbitrary preflop solves or full PLO if not actually built.

**Performance:** bundle size, code splitting, Pyodide/NumPy startup, worker communication and cleanup, library chunking/caching, large imports, solver resource caps and cancellation, grid rendering, mobile responsivity; do not preload PLO or every binary solution asset.

**Security/privacy:** package audit, strict validation of imported histories/JSON, XSS and unsafe HTML, Worker API authentication/rate limits/CORS, safe error handling, secrets, local-first hands/privacy; never expose user keys or send private histories externally without consent. Verify licenses for reused source and solution data.

**End-to-end QA via Playwright:**
1. Load `/lizard/` and all major routes/deep links, refresh them.
2. Construct 6-max NLHE hand and traverse to river.
3. Select matrix class and exact combo, verify blockers and strategies.
4. Run heads-up postflop custom solve and, if supported, 3-way solve.
5. Configure rake, straddle, BB ante, separate stacks, side pots.
6. Configure final-table ICM and inspect explicit model/accuracy.
7. Practice and deliberately make a suboptimal decision; verify EV-loss feedback.
8. Build/save/load range and drill.
9. Import PokerStars and GGPoker histories, reject malformed inputs.
10. Analyze multi-hand session, navigate largest mistake into Study.
11. Build a texture-filtered flop report with honest coverage.
12. Save/restore custom solution, export/import data.
13. Run PLO evaluator/betting/equity/play scenario only if correctly implemented.
14. Check responsive 1440/1024/390px UI, keyboard controls, cancellations, worker errors, large files and accessibility.

**Independent audit:** delegate poker rules and numerical review, frontend UX/accessibility review, security/privacy review, hosting and CI review. Address critical defects before promoting deployment. Log executed test results, don't fabricate a passing status.

### Deployment and CI acceptance

1. Determine and respect the actual existing `michael-han.com` hosting. Preserve homepage, `/gto-solver/`, and all other projects.
2. Keep canonical `https://michael-han.com/lizard/`; ensure `www` follows the site's current policy. If using GitHub Pages or Cloudflare, configure the precise subpath, asset base, Workers/Pyodide asset URLs, deep-link routing and share links.
3. CI should install/test/typecheck/build and deploy to the verified target. Don't blindly modify domain-wide DNS/custom-domain settings or other unrelated repos.
4. Check actual production fetch/browser rendering; do not declare deployment done solely because GitHub Actions was green. Roll back broken production releases safely.
5. Repo `lizard` pushed with sane commit history and README. Never commit private keys, credentials, binary caches or huge in-progress solver products.
6. Final response must include verified site URL, verified repo URL, actual implemented features, actual tests and benchmark numbers, unsupported approximations, operational blockers, next tasks and commit hashes.

## 11. Delivery milestones and stop/resume conditions

Work through **Phase 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7**, but allow partial safe deployment after each phase and keep an operable NLHE site throughout. Prioritize a working core over a half-finished full-parity facade. No phase can be marked completed solely due to documentation. If a phase is computationally infeasible on the machine, implement the most valuable validated subset and record a specific blocker, then move to other independent development.

If context compaction/restart occurs, the next Claude session should read this plan, progress log and recent commits, then continue from the earliest incomplete acceptance criterion. If blocked by permission or unavailable hosting credentials, leave a clean working tree or committed work, note exact actions needed, and keep other independently possible work moving. **Never interfere with the two running SB-vs-BB precompute jobs.**

## 12. Immediate instructions when this plan is first received

**If Prompt 1 is already running:** do not undo its work. Let it finish. Read its resulting repository and progress documents, reconcile this plan with what it actually built, then proceed to the earliest incomplete phase. Do not reinitialize Git, reimport blindly, or restart audits that are already valid.

**Then:** Execute the next achievable task now. Use subagents selectively; make real changes, test, update docs, commit, push, and continue sequentially. Ask for user input only if necessary to avoid destructive actions, account/permission conflicts, or genuinely unavailable credentials. Do not claim that all seven phases can be completed overnight if the available compute, time, or runtime constraints do not support that.




## CRITICAL: Mac Resource Safety and Crash Prevention

My Mac has an Apple M4 chip and 16 GB RAM. It is already running two CPU- and memory-intensive poker solver precomputation jobs that MUST NOT be interrupted.

**System stability takes priority over development speed.**

### Resource limits
- Monitor CPU, GPU, memory pressure, swap usage, and temperature where accessible.
- Keep at least 40% of physical RAM available whenever feasible, respecting the existing solver's memory safeguard.
- Avoid running multiple CPU-intensive operations simultaneously.
- Limit Claude Code to 1–2 active subagents during precomputation.
- Do not run parallel solver benchmarks, large test suites, or builds while precomputation is consuming significant resources.
- Limit test-worker concurrency and compiler/build parallelism.
- Avoid unnecessary GPU workloads.
- Prefer sequential, incremental tests over full test suites during heavy computation.

### Automatic throttling
- Before launching expensive tasks, inspect system resource usage.
- If memory pressure is high, swap is growing rapidly, or the machine becomes unresponsive, defer nonessential development computations.
- Use low process priority (`nice`) for new CPU-intensive development tasks when appropriate.
- Set reasonable memory limits and timeouts for new processes.
- Never increase the priority of development tasks above the existing solver jobs.
- Do not automatically restart failed heavy computations in an infinite loop.

### Protect existing solver processes
- Never kill, pause, restart, renice, or otherwise modify the two existing precomputation processes.
- Never change their resource-management logic.
- Never delete or overwrite their checkpoints or output files.
- Avoid launching competing Python solver processes.
- Do not assume that available CPU capacity implies sufficient free memory.

### Reliability
- Commit and push frequently so code changes survive a crash.
- Maintain resumable progress in docs/PROGRESS.md.
- Make long-running development jobs checkpointable where practical.
- Prefer stable, smaller implementation batches over large parallel operations.
- Never disable macOS thermal protection or other system safeguards.
- If safe execution is not possible, skip or defer the expensive task and continue with lightweight coding or documentation.

**Priority order:**
1. Keep macOS stable.
2. Preserve existing solver precomputation.
3. Protect completed work.
4. Continue Lizard development.
5. Optimize development speed.

Never sacrifice the first three priorities to finish the project faster.
