# 07c — Feature status: tournaments, game formats, other

How far the upstream solver supports tournaments, game formats and the "other" features, graded for the Lizard parity matrix.

- **Snapshot graded:** `solver/` at michaellhan/gto-solver `main` @ `9b907bd6` (2026-11-03), taken from `solver/UPSTREAM.json`.
- **Paths:** all are relative to `/Users/mhan/Desktop/projects/lizard`.
- **GTO Wizard reference:** `docs/research/02-gtowizard-inventory.md` §3.1.7 and §3.7–3.11.

## 0. Method and grading rules

- **Grades.** I used four:
  - **WORKING:** the feature is implemented end to end, can be reached from the UI or the JSON API, and has tests.
  - **PARTIAL:** code exists but is limited.
  - **APPROXIMATE:** the feature works through heuristics or approximations rather than a solve.
  - **NOT IMPLEMENTED:** the feature is absent.

  Where one feature has a solved part and a heuristic part, the row says which grade applies to which part.
- **Verified (V):** I read the implementing code and found tests that exercise it, by test name.
- **I did not run any tests.** The shared-machine resource rules forbid it. "Has tests" means the tests exist and target the code path. It does not mean they pass at this commit.
- **Inferred (I):** a deduction from code or docs that no test or measurement confirms.
- **Quoted numbers:** measured numbers come from the upstream README with line numbers. I did not re-measure them.
- **Search method:** I grepped for every claim. Each "NOT IMPLEMENTED" grade rests on a grep with no hits in `solver/gto`, `solver/gto/static`, `solver/tests` and `solver/README.md`.

## 1. Summary

| Area | Feature | Upstream grade |
|---|---|---|
| Tournaments | Chip EV | WORKING. MTT-style preflop (antes, short depths) is APPROXIMATE. |
| | ICM preflop | APPROXIMATE. Push/fold is solved in prize equity; every other preflop spot is a chip chart plus a risk premium. |
| | ICM postflop | WORKING heads-up, 3-way and 4-way, with a bystander approximation for 3- and 4-way. Five or more players use the betting rules in chips. |
| | MTT stages and final tables | PARTIAL: payouts and field are entered by hand, and there are no presets or final-table library. |
| | Satellites | NOT IMPLEMENTED as a feature. Flat payouts can be typed in (I), untested. |
| | KO / PKO bounties | WORKING (proportional model) for push/fold and postflop solves. Other preflop spots are APPROXIMATE. |
| | Mystery bounties | APPROXIMATE: valued at the average envelope. |
| | Payout structures | PARTIAL: any list can be typed, but there are no presets or import. |
| | Bubble factors / risk premium | WORKING in the engine and API. PARTIAL in the UI: one number in a note. |
| | Push/fold charts | PARTIAL: an equilibrium per spot, but no chart browser. |
| Formats | 2–9 handed NLHE | PARTIAL. Preflop is chart-based; postflop is solved up to 4-way; 5+ players use heuristics. |
| | Cash games | WORKING. Preflop charts are hand-tuned. |
| | Tournaments (format) | PARTIAL (see the tournament rows). |
| | Short stacks (≤40bb) | PARTIAL: chart adjustments from 20/40bb solves, and push/fold only under 20bb. Postflop is solved live. |
| | Deep stacks (≥150bb) | APPROXIMATE preflop. Postflop is solved live, with at most 2 raises per street. |
| | Antes and straddles | PARTIAL: a per-player ante; one 2bb straddle, solved 6-handed only. |
| | PLO4 | NOT IMPLEMENTED. |
| Other | Saved solutions | PARTIAL: automatic caches, saved hands and links, but no named saved solves. |
| | Custom study plans | NOT IMPLEMENTED. |
| | Preferences and progress tracking | WORKING, local to the browser only. |
| | Multiplayer practice / arena | NOT IMPLEMENTED. Bots only: 2–9 handed, 1–4 tables. |
| | Mobile support | PARTIAL: responsive and touch work; no PWA manifest and no offline page. |
| | AI explanations | WORKING, in Practice only. |
| | Solution comparisons | PARTIAL. |
| | Accounts and data sync | NOT IMPLEMENTED. Manual backup/restore with merge works, on a schema built for later sync. |
| | Sharing / export | WORKING: links, text, JSON, CSV and backup. |

## 2. Tournaments

| Feature | GTO Wizard equivalent | Upstream grade | Evidence (code; tests) | Limits / gaps | Notes for Lizard port (effort) |
|---|---|---|---|---|---|
| **Chip EV** | A presolved chipEV MTT library (symmetric and asymmetric stacks, up to 200bb), plus custom chipEV solves. | **WORKING** (V). Every solve plays chips unless there are ≥2 payouts or bounties. | **Code:**<br>• `solver/gto/advisor.py:448-481` (`_tournament` returns `None`, so chips).<br>• Tournaments are never raked: `advisor.py:3709-3712`.<br>• Per-seat stacks: `advisor.py:3741`, `_state_stacks`.<br>• Antes: `pf.Table(..., ante, straddle, ...)` at `advisor.py:3714`.<br>**Tests:** `tests/test_icm.py` `TestSolver.test_winner_take_all_is_chips`, `TestAdvisor.test_no_tournament_without_two_prizes`; `tests/js/stakes.test.js` "a tournament has no rake, whatever the Rake setting". | • MTT-specific chipEV preflop is the 100bb cash charts, adjusted using solves at 20/40/60bb with a 0.125bb ante (`solver/gto/pf_formats.py:43-47`). That is APPROXIMATE.<br>• The library is 6-max at 100bb only, with no ante (`gto/static/flop_library/index.json`: 18 spots, all `stack` 90–97.5). So every MTT flop is solved live.<br>• There is no big-blind-ante structure (the ante is per player). | Wrap `Advisor.advise`/`study` behind the typed adapter as-is (**S**). Label MTT preflop "tuned approximate chart". An MTT chipEV library would need new builds; avoid running them while the HU builds are going (**L**). |
| **ICM preflop** | Preflop ICM custom solves (up to 9 players, 250bb, fields up to 4,096, about 1 s per spot), plus a 70k+ ICM preflop library. | **APPROXIMATE** (V). | **Solved part, push/fold:**<br>• Fictitious play in prize equity: `solver/gto/pf_classes.py:65-125` (`push_fold(..., icm=...)`, `_fictitious_play_seq`). Each caller has its own range and payoffs.<br>• Fed by `advisor.py:1733-1760` (`_icm_push_vals`, `_icm_need`).<br>**Heuristic part, everything else:**<br>• A chip chart plus a risk premium: `advisor.py:1762-1775` (`_icm_premium`).<br>• `ICM_COMMIT = 1.0` at `advisor.py:226`.<br>• Calls and 3bets: `advisor.py:4269-4362`. Opens: `advisor.py:4414-4475` (`_icm_open`).<br>**The preflop solver refuses tournaments:** `solver/gto/pf_study.py:187-188`, "a tournament's preflop isn't solved here (the solve plays chips)".<br>**Tests:**<br>• `test_icm.py` `TestPushFold.test_sequential_callers_alike_match_the_symmetric_play`, `test_icm_payoffs`.<br>• `TestAdvisor.test_bubble_call_of_a_jam`, `test_bubble_tightens_defence_and_3bets`.<br>• `tests/test_study.py::test_tournament`.<br>• `tests/js/icm.test.js` (7). | • `ICM_COMMIT` is "judgment fit to the published shape" (README:4599-4600).<br>• No future-game model; at most 12 players modelled (README:4597-4598).<br>• README:1156-1162, 4 left paying 50/30/20, stacks CO 40 / BTN 25 / SB 8 / BB 25:<br>&nbsp;&nbsp;– BB continues 60.5% vs a BTN min-raise (93% in chips).<br>&nbsp;&nbsp;– BTN 3bets a CO open 7.0% (12.2% in chips).<br>&nbsp;&nbsp;– BTN opens 43.6% (45% in chips).<br>• That is the shape of published ICM results, but it was not checked against an ICM preflop solve. | Wrap now with the provenance label "ICM risk-premium adjustment" (non-jam spots) or "ICM push/fold equilibrium" (jam spots) (**S**). A real preflop ICM solve means giving `pf_game`'s terminals `icm.Model.value` payoffs, so the game stops being zero-sum. `pf_game` is chips-only today (`pf_study.py:187`) (**L**). |
| **ICM postflop** | HU postflop ICM for any format (2024-07); 3-way postflop ICM with bounties (2026-08). | **WORKING** for HU, 3-way and 4-way (V). **APPROXIMATE** for 5+ players (betting rules, in chips). | **Heads-up:**<br>• `solver/gto/icm.py:434-485` (`HUPayoffs`: every terminal pays the change in prize equity, in chip equivalents).<br>• `solver/gto/solver.py:158-160` (`Config.icm`), `:1085-1088`.<br>• `advisor.py:8136` (`_icm_cfg`).<br>**3- and 4-way:**<br>• `icm.py:487-585` (`MWPayoffs`: averaged over the orders of the live hands).<br>• `solver/gto/multiway_solver.py:99-103`; `advisor.py:5356-5363`, `:6932-6935`.<br>• The compiled core reads the same weights (`solver/core/mwcore.c:31`).<br>**Tests:**<br>• `test_icm.py` `test_bubble_changes_the_bets`, `test_heads_up_postflop_solves_in_prizes`, `test_practice_opponent_after_the_flop`.<br>• `tests/test_multiway_solver.py::TestTournament`: `test_weights`, `test_winner_take_all_solves_are_chips`, `test_core_agrees_with_numpy_in_prizes`, `test_prizes_against_the_exact_game`, `test_a_tournament_3way_flop_is_solved_in_prizes`.<br>• `test_bounty.py::test_three_way_terminals_pay_each_bust_to_who_takes_its_last_chips`. | • **Measured** (README:1180-1187, `scripts/bench_mw_icm.py`):<br>&nbsp;&nbsp;– Bubble, 3-way river: the chip solve's strategies give up 3.3–5.5% of the pot in prizes; the prize solve's give up 0.002–0.015%.<br>&nbsp;&nbsp;– Short-stack case: 0.004–0.33%.<br>&nbsp;&nbsp;– Final table, 6 left: 0.009–0.025%.<br>• The flop libraries are skipped in tournaments (`advisor.py:4823-4827`, `:6587`, `:6604`), so every tournament flop is a live solve, which is slow in the browser.<br>• 3- and 4-way solves treat "who wins when a player loses" as even (the bystander approximation).<br>• 5+ players stay in chips (`advisor.py:4808-4809`). | Wrap (**S**). Lizard should add an ICM-aware solve cache and presolve keyed on (stacks, payouts, field, bounties) (**M**). Label 3/4-way "ICM prize-equity solve (bystander approx.)" and 5+ "heuristic, chips". |
| **MTT stages and final tables** | 53k+ final-table sims (3–9 max, 10–70bb), an Events library, payout presets, tournament-ID/JSON import that fills in players left and average stack. | **PARTIAL** (V). | **UI:**<br>• Payouts and field: `solver/gto/static/index.html:714-720`. Field = players left at other tables plus their average stack.<br>• JS state at `index.html:873-921`; sent at `index.html:1838`.<br>**Engine:**<br>• `advisor.py:448-481` (field as a stack list or `{"players", "chips"}`).<br>• Stand-ins for a big field: `icm.py:166-195` (`field_stacks`, `compress_payouts`), `MAX_PLAYERS = 12` at `icm.py:25`.<br>**Tests:** `test_icm.py` `test_big_field_keeps_each_players_share` (27 left, 12 paid: the button's share stays 1/27 exactly), `test_field` ("39 players modelled by 12"). | • No stage taxonomy or presets (bubble, ITM, final table). No final-table library.<br>• From the UI the field is n players at one average stack (`index.html:919-920`, capped at 10,000).<br>• Malmuth-Harville only, with no future-game model or deal-making.<br>• At most 12 players are modelled exactly. | Add stage/final-table presets in Lizard's UI that generate `payouts`/`field` (**S**). Add a tournament-JSON import (**M**). A final-table presolve library is **L**, and must wait for build capacity. |
| **Satellites** | Custom HU postflop ICM covers satellites (2024-07). | **NOT IMPLEMENTED** as a feature (V by grep: no "satellite" hits in `gto/`, `tests/` or README). Flat payouts are accepted by the generic model (I). | `icm.Model` sorts and uses any positive payouts (`icm.py:247-262`); `parse_payouts` is at `icm.py:587`. "1 1 1 0.5" is a valid ticket-plus-cash structure (I). | • No ticket semantics, no "seats paid" UI and no tests.<br>• If at least as many places are paid as players are left, equity is constant and the bubble factor becomes ∞, which is reported as `null` (`advisor.py:493-495`, `icm.py:431`) (I).<br>• Malmuth-Harville with flat prizes is the usual satellite model, but nobody has validated it here. | Add a satellite preset (N seats, cash for the next place) and tests with flat payouts. Label it "Malmuth-Harville, flat payouts" (**S**). |
| **KO / PKO bounties** | Custom ICM with KO/PKO/TKO, a Bounty Power display (bounty dollars converted to bb), and PKO/KO bounties read from hand histories (2026-10). | **WORKING** (V), with the proportional model, for push/fold and HU/3-way/4-way postflop solves. **APPROXIMATE** for other preflop spots: a discount on the risk premium, and opens widen by at most 1.5x. | **Engine:**<br>• `icm.py:197-230` (`Bounties`), `:274-320` (`_bounty_setup`, `busts`: the winner must cover the busted player).<br>• `icm.py:337-360` (`value`: `k × [ΔICM + (end(P−C) − start·P)/T + cash]`).<br>• `advisor.py:391-446` (`_bounties` parser), `:512-552` (`_bounty_info`).<br>**UI:** `index.html:723-740`, `:878-917`.<br>**Tests:**<br>• `tests/test_bounty.py`, 14 tests: `test_ko_winner_take_all_is_chips_plus_the_bounty`, `test_pko_is_half_at_once_and_the_added_half_at_the_winners_chip_share`, `test_covering_rule`, `test_zero_bounties_change_nothing` (×2), `test_river_call_widens_against_a_covered_bounty`, `test_push_fold_call_widens_against_a_short_stack_with_a_bounty`, `test_shoves_widen_when_covering_a_bounty`, `test_three_way_river`, `test_heads_up_postflop_carries_the_bounties`, `test_parsing`, and more.<br>• `tests/js/bounty.test.js` (8). | • **Worked numbers** (README:1239-1247): with KO 10 on every head, the BB's call of a SB jam needs 38.0%, against 47.5% in chips; with KO 30 on the SB, 30.4%.<br>• The proportional model only. README:1268-1280 lists what it misses: no TrueBounty or simulations, so it overvalues a big stack's share of bounties and ignores where a bounty sits.<br>• No TKO.<br>• The library, instant answers and presolves leave bounties out.<br>• Hand-history import does not read bounties. | Wrap (**S**). Label it "proportional bounty model". The covering rule and side-pot attribution are already tested; reuse them as-is. |
| **Mystery bounties** | Mystery-bounty solving that estimates the initial bounty pool and the average bounty (2026-10). | **APPROXIMATE** (V). | `icm.py:201-230`: an envelope is "worth the average envelope left", from `envelope`, or `pool`/`left`. The default pool is envelope × (players left − 1). UI: `index.html:733-735`. Tests: `test_bounty.py::test_mystery_is_the_average_envelope`; `bounty.test.js` "mystery bounties: the average envelope, or the pool and the players left". | • No envelope distribution or variance (README:1273, "no risk preference about the draw").<br>• No pool estimate from the tournament structure. | Wrap (**S**). Add a pool estimator from buy-in, field and the share going to bounties (**M**). |
| **Different payout structures** | A preset library (PokerStars, WPN, Winamax, 888) filterable by format, buy-in, field and prize pool; import by tournament ID or JSON. | **PARTIAL** (V). | • Any list: `parsePayouts` (`index.html:875`, up to 200 places), `icm.parse_payouts` (`icm.py:587`).<br>• Compressed onto the 12-player model: `icm.py:179-195`.<br>• Tournament hands imported from a history: the id, name, buy-in and level come from `solver/gto/static/hh.js:99-110`. The payouts are typed once per tournament (`solver/gto/static/session.js:152`, `:802-832`).<br>**Tests:** `tests/js/icm.test.js` (7); `tests/js/session.test.js` "tournaments: each one's hands kept together, its payouts entered once and every hand of it asked in prize equity"; `tests/js/hh.test.js` "tournaments: the header's id, name, buy-in and level". | • No presets and no %-of-pool generator.<br>• No import of payouts. | Add payout-structure generators and presets in TypeScript (**S**). Add import (**M**). |
| **Bubble factors / risk premium** | Not found in any public GTO Wizard source (inventory §3.8), so this is a differentiator. | **WORKING** in the engine and API (V). **PARTIAL** in the UI. | **Engine:**<br>• `icm.py:423-431` (`bubble_factor`), `:393-411` (`premium`), `:378-392` (`call_need`).<br>• The answer's `tournament.bubble_factors` comes from `advisor.py:484-510`.<br>• Notes: "bubble factor up to X" (`advisor.py:504-505`); "calling needs X% in prize equity against Y% in chips (a risk premium of +Z% / a bounty discount)" (`advisor.py:4650-4653`).<br>**Tests:** `test_icm.py` `test_bubble_factor` (above 1.2 on a bubble; 1.0 winner-take-all), `test_call_need`, `test_bubble_call_of_a_jam` (`bubble_factors["BTN"] > 1.5`). | The UI never renders the per-opponent matrix: no `gto/static/*.js` file reads `bubble_factors`, so only the maximum appears in the notes. | A quick differentiator: render the bubble-factor matrix and each spot's risk premium from the existing JSON (**S**). |
| **Push/fold charts** | Nash push/fold inside the preflop chipEV and ICM solutions. | **PARTIAL** (V): an equilibrium solved for each spot, with no chart browser. | • `pf_classes.py:65-151`: fictitious play over 169 classes, 400 iterations, card removal through `PAIR_COMPAT`.<br>• Triggered at or below 12bb when raising first in (`PUSH_FOLD_STACK`, `advisor.py:228`). Also for any raise that would commit the stack below roughly 80bb (`advisor.py:4072-4081`; `_push` at `:4133-4185`). Under 20bb the advice is push/fold (README:4570-4571; `MIN_DEPTH`, `pf_formats.py:47`).<br>• Study's grid shows it.<br>**Tests:** `test_study.py::test_preflop_whole_range` (`stack=10`, grid actions `["all-in","fold"]`); `test_gto.py::test_push_fold_with_rake`; `test_icm.py::TestPushFold`. | • In chips, callers are "treated alike and independently; only one of them is assumed to call" (`pf_classes.py:69-72`).<br>• Jam or fold only; no limp or min-raise below 20bb.<br>• No table by depth or seat, and no export. | Build a Lizard "Push/Fold" view that sweeps `push_fold` over 1–20bb per seat, chips or ICM, cached. Measure its cost first; 400 iterations over 169 classes is small (I) (**S-M**). |

## 3. Game formats

| Feature | GTO Wizard equivalent | Upstream grade | Evidence (code; tests) | Limits / gaps | Notes for Lizard port (effort) |
|---|---|---|---|---|---|
| **2–9 handed NLHE** | Cash HU to 9-max; custom preflop for 2–9 players; 3-way postflop custom solving. | **PARTIAL** (V). | **Engine and UI, 2–9 players:**<br>• `advisor.py:3705` ("players must be 2..9"); seats in `solver/gto/preflop.py:25`; `hh.js:8-11`.<br>• Preflop charts for 7–9 handed come from adjustment tables; 9-handed reuses 8-handed (`pf_formats.py:24-25`).<br>**Postflop:**<br>• HU: `solver/gto/solver.py`. 3-way and 4-way: `multiway_solver.py`.<br>• N-player rivers up to 6 players (README:1522).<br>• 5+ on the flop or turn use the betting rules (README:4641-4646).<br>**Preflop solver:** 2–6 players in the browser, 7 natively (README:557-559).<br>**Tests:** `test_gto.py:676-679` (9-handed UTG1 vs UTG); `tests/test_coverage.py` (8- and 9-player states); `tests/test_multiway_solver.py`; `tests/test_stacks.py` (13); `tests/test_pf_formats.py::test_table_size_moves_the_6max_chart`. | • Preflop charts are hand-written, matched to 26 published spots with an average error of 0.96 points (README:4547-4551).<br>• Library: 18 HU spots, all 6-max lines, and 4 three-way spots (`mw_index.json`, 185 flops each). No 4-way library.<br>• **Coverage fuzz** (README:4684), 6,628 decisions: charts answered 63%, live solves 24%, betting rules 12%, the library 1.4%.<br>• **HU library (read-only observation, `/Users/mhan/Desktop/projects/gtosolver/.work`):** 2-max builds are running and not in the snapshot.<br>&nbsp;&nbsp;– `srp_sb_bb_2max` (97bb, 474 flops): at 293/474 when read.<br>&nbsp;&nbsp;– `lp_sb_bb_2max` (424 flops): at 30/424. | Wrap. Each answer carries its source (chart, solve, rules, library); map those to Lizard's provenance labels (**S**). Ingest the HU library once the builds finish (**M**). |
| **Cash games** | A cash library (rake up to NL500, straddle and ante, 2–9 max, depth variants). | **WORKING** (V). Preflop charts are a tuned approximation. | • Default mode. Rake is "no flop, no drop".<br>• Stakes in dollars (README:57-68).<br>• Library of 6-max 100bb lines (`index.json`).<br>• A raked table answers instantly from the unraked entry and is labelled approximate (README:1107-1128).<br>**Tests:** `tests/test_rake_read.py`, `tests/js/rake.test.js` (8), `tests/js/stakes.test.js` (10), `tests/preflop_refs.py`. | • The library has one tree: flop 33/75%, turn and river 75%, raise 50%, at most 2 raises (`index.json` `tree.sizes`). It is solved unraked.<br>• Preflop is not a solver's output. | Wrap (**S**). Rake and depth variants of the library are build work (**L**). |
| **Tournaments (format)** | Separate Tournament plan: chipEV MTT, ICM final tables, Spin & Go, HU SnG. | **PARTIAL** (V). | See §2. Tournament mode reaches the advice, Study (`test_study.py::test_tournament`), Practice (`test_icm.py::test_practice_opponent_after_the_flop`), the one-size view (`simple.test.js` "a tournament: the panel says the EVs are prize equity…") and the analyzer (`session.test.js`). | • No Spin & Go or HU SnG presets.<br>• No tournament library.<br>• Every flop is solved live. | See §2. |
| **Short stacks (≤40bb)** | MTT and cash short-stack formats (for example Winamax Short Track 5–20bb), full trees at 10–20bb. | **PARTIAL** (V): preflop is APPROXIMATE; postflop is WORKING (live solve at any SPR). | • Chart adjustments at 20/40/60bb, interpolated (`pf_formats.py:43-47`; HU at 20/40/100bb).<br>• Push/fold under 20bb; commitment rules `COMMIT`/`JAM_SPR` at `advisor.py:221-231`.<br>• Postflop live solves; the UI stack minimum is 5bb (`index.html:693`); the fuzz covers 5–300bb (`scripts/coverage_fuzz.py:5-6`).<br>**Tests:** `test_pf_formats.py` (12, including `test_shipped_moves`, `test_moves_keep_the_dominance_order`); `test_gto.py:553` (short-stack shoves); `test_stacks.py`. | • Below 20bb, preflop is jam or fold only.<br>• "The depth scale is measured on three spots and 12 flops" (README:4575-4576).<br>• No short-stack library. Off-library heads-up pots answer instantly from the nearest spot, labelled approximate (`tests/test_instant_near.py`; `flop_approx.near_spot`). | Wrap and label (**S**). Real short-stack preflop trees through `pf_game` with limp and min-raise options are **M-L**. |
| **Deep stacks (≥150bb)** | MTT up to 200bb presolved; deep-straddle cash at 1000–1600bb; custom solving to 1000bb. | **APPROXIMATE** preflop (V). Postflop is a live solve with a capped tree. | • Deeper than 100bb plays 100bb's chart adjustments plus implied-odds rules. The 150 and 200bb solves were not adopted (`pf_formats.py:16-21`; README:4571-4572).<br>• `pf_study` solves 10–250bb in chips for Study's "Solver" source only (`pf_study.py:197-198`). The advice keeps the charts.<br>• The postflop tree allows at most 2 raises per street (`solver.py:82`). | • At deep stack-to-pot ratios, a 2-raise tree truncates re-raise wars (I).<br>• No deep library. | Wrap (**S**). Serving `pf_study` deep solves as labelled "numerical preflop solve (chips)" answers is **M**. Deeper postflop trees are **M**. |
| **Antes and straddles** | A Straddle + Ante cash format; MTT antes; site variants. | **PARTIAL** (V). | • UI: a per-player ante and a straddle checkbox ("The first seat posts a 2bb straddle and acts last preflop", `index.html:696-697`).<br>• Ante adjustments solved at 0.125bb for 20/40/100bb, 6-max, scaled by dead money (`pf_formats.py:22-23`, `:45-46`).<br>• Straddle solved 6-handed at 100bb only (README:4573-4574).<br>• A big-blind ante in an imported history is converted (`hh.js:233`).<br>**Tests:** `test_pf_formats.py`; `test_coverage.py` (ante + straddle states); `tests/js/engine.test.js`, `stakes.test.js`. | • The ante is not solved heads-up.<br>• No big-blind-ante structure (I), no double or button straddle (README:4596).<br>• Library and instant flops need the standard game: no ante or straddle (`gto/static/multitable.js:108`, `:585`). | Wrap (**S**). A big-blind-ante structure in the rules engine is **S-M**. Ante and straddle libraries are **L**. |
| **PLO4** | PLO4 cash and MTT (2026-05), a separate plan. | **NOT IMPLEMENTED** (V). | • Two-card hands everywhere: `solver/gto/cards.py:45` (1326 combos), `advisor.py:3733` ("need two hole cards").<br>• The evaluator is tuned for 2 hole cards (`solver/gto/evaluator.py:1-8`).<br>• Hand-history import rejects Omaha: `hh.js:118-119` throws "Only Hold'em hands can be imported."<br>• No pot-limit betting. | Everything is missing. | A separate solver track, as the plan says in §10 (**L**). |

## 4. Other

| Feature | GTO Wizard equivalent | Upstream grade | Evidence (code; tests) | Limits / gaps | Notes for Lizard port (effort) |
|---|---|---|---|---|---|
| **Saved solutions** | Saved custom solves (openable in Practice), saved spots (M key), saved drills ("My Drills"), saved reports and filters. | **PARTIAL** (V). | • Finished preflop solves are kept automatically in IndexedDB `gto-pf`, the 6 latest (`PF_KEEP`), keyed by worker version (`solver/gto/static/study.js:246-270`).<br>• My hands keeps each hand with its grades (`solver/gto/static/hands.js`; `store.js` `hands` store).<br>• `#h=` links reopen a spot, which is then solved again (`index.html:1307`, `:2211`, `:2256`).<br>• An in-memory LRU solve cache (`tests/test_cache.py`, 6 tests). The Cache API holds library files and bytecode (`gto/static/worker.js:8-17`).<br>**Tests:** `tests/js/hands.test.js` (13), `tests/js/store.test.js` (14), `tests/test_cache.py`. | • No user-named saved solves.<br>• Postflop solve trees are never persisted or exported. The `store.js:16-18` header calls these caches "of what can be solved or fetched again". | Build a Lizard solution store in IndexedDB, keyed by a canonical input hash plus solver version; serialize with `flop_library` pack format 2 (**M**). |
| **Custom study plans** | Study Plans (30 lessons plus drills each); Daily Dose quiz. | **NOT IMPLEMENTED** (V by grep: no plan, curriculum or lesson code in `gto/static`). | Nearest:<br>• The analyzer's "Drill this leak" builds a drill set of up to 40 spots (`gto/static/drills.js:7-10`; README:277).<br>• Spot drills with texture filters (`drills.js`).<br>**Test:** `session.test.js` "a session's leaks with their decisions, and a leak's drill set". | No plans, scheduling or lesson content. | New feature: a plan is an ordered list of drill sets plus progress (**M**). Lesson content is extra. |
| **User preferences and progress tracking** | Trainer stats (lifetime, filterable by format and date), sessions, saved trainer configurations. | **WORKING**, local only (V). | • Preferences live in `store.js` keys (`solver/gto/static/store.js:26-30`): speed, opponents, sound, layout, four-colour deck, Study preferences, practice settings.<br>• Practice score and Review mistakes: `practice.js:12`, `:405-411`.<br>• Drills keep a score with streak, best and last 100, and a per-drill history (`drills.js:170-178`, `:211`, `:297-298`).<br>• Multi-table session score (README:845-856).<br>• Analyzer history across sessions: bb/100 over time and leaks ranked over sessions (`session.js:14`; README:281-288).<br>**Tests:** `store.test.js` (14); `drills.test.js` (13); `practice.test.js` (32); `session.test.js` history tests ("history: a session's summary…", "history: sums over sessions…", "history: leaks past their thresholds…", "history storage…"). | • No lifetime stats dashboard; no filtering by date or format.<br>• Data stays on one device unless backed up. | Port the store schema (versioned records with tombstones) to Lizard's IndexedDB layer (**S**). Build a stats dashboard (**M**). |
| **Multiplayer practice / heads-up arena** | Play Mode (private games by share link) and PokerArena (ranked HU, seasons, leaderboards, iOS). | **NOT IMPLEMENTED** (V). | • No WebSocket or WebRTC in `gto/static`.<br>• `solver/gto/server.py:1-12` is stateless: `/advise`, `/play`, `/cancel`.<br>• What exists is play against bots: Practice opponents play GTO via `Advisor.play` (`practice.js:1-3`), 2–9 handed, at 1–4 tables (`multitable.js`).<br>**Tests:** `practice.test.js` (32), `multitable.test.js` (13). | Human-versus-human play needs a server, matchmaking and anti-collusion. | The plan's §10 says to build this only with a genuine server (**L**). Reuse `Advisor.play` for scoring arena hands. |
| **Mobile support (responsive, touch)** | A PWA (add to home screen), no native study app; PokerArena on iOS. | **PARTIAL** (V): responsive layout and touch work; no install or offline. | • Viewport meta: `index.html:5`. 15 `@media` blocks, including `(max-width:560px)`, `(max-width:900px)` and `(hover:none) and (pointer:coarse)` (`index.html:233-625`).<br>• Lifts the action dock above the on-screen keyboard through `visualViewport` (`index.html:2806-2809`).<br>• A one-line dock verdict on phones (README:792-795); phone tabs in multi-table (README:856).<br>**Tests:** `tests/js/layout.test.js` (3: "the action dock is lifted above the on-screen keyboard", the iOS `execCommand` fallback); `multitable.test.js:366` ("…on a phone one table and a strip of tabs"). | • No web app manifest.<br>• `sw.js` only adds COOP/COEP headers (`sw.js:1-6`); the page is not cached for offline use.<br>• No phone timings in the README; Pyodide solving on phones is unmeasured (I). | Lizard's React layout should keep these behaviours. Add a manifest, offline shell and phone performance budgets (**M**). |
| **AI explanation tools** | None; "plain-language output" is on GTO Wizard's roadmap. | **WORKING**, in Practice and multi-table verdicts only (V). | **Client:**<br>• "Copy for AI" prompt builder and "Explain with AI": `practice.js:478-486` (`EXPLAIN_PROXY`, `AI_MODEL = "claude-sonnet-5-5"`), `:501`, `:641-660`.<br>• Multi-table wiring: `multitable.js:740` (`data-ai`).<br>**Proxy:**<br>• `solver/cloudflare/explain-proxy/src/proxy.js:1-14`: fixed model and system prompt, `MAX_TOKENS 700`, `MAX_PROMPT 8000`.<br>• `wrangler.toml:9-12`: origin allowlist, 20 a day per IP, 1000 a day in total.<br>**Tests:** `tests/js/explain.test.js` (13); `cloudflare/explain-proxy/test/index.test.js` (8: origins, preflight, POST shape, coach-prompt equality, streaming, rate limits, upstream error scrubbing). | • Not available in Study, the analyzer or My hands. Answers are at most about 70 words.<br>• Origin is host-level: `www.michael-han.com` is allowed, so a Lizard page at `/lizard/` would share the upstream daily quota (I).<br>• The proxy's API key is a Worker secret, not in the repo. A user's own key stays in localStorage only, never in a backup (`store.js:19-20`). | Deploy Lizard's own worker, or give it a separate quota; reuse the prompt builder and the coach prompt (**S**). Extend it to Study, Analyzer and hands (**M**). |
| **Solution comparisons** | Compare EV (two actions), Compare Nodes after a nodelock, comparison across positions, depth or rake, and ICM vs chipEV for the same spot. | **PARTIAL** (V). | • Exploit and lock answers carry `gto_freq` beside `freq`: `advisor.py:4008-4009`, `:5108`. The "GTO %" source is shown at `index.html:1951-2008`, `:2201-2202`.<br>• The one-size view gives each size's EV given up against the full menu (`simple.js:1-11`; `tests/test_one_size.py`; `simple.test.js` (11)).<br>• Calls against all-ins note ICM against chips (`advisor.py:4650-4653`).<br>• Study preflop has a Charts \| Solver toggle (README:535-552).<br>• The range builder scores your range against the solver's (`study.js:500`). | • No Compare EV metric.<br>• No side-by-side of two solutions.<br>• No diff by depth, rake or ICM. | Build a Lizard compare view that runs two adapter calls and diffs `grid` and `actions` (**M**). |
| **Account and data synchronization** | Google/Facebook sign-in, server-side sync, one active device. | **NOT IMPLEMENTED** for accounts and sync (V). A sync-ready local schema and manual merge exist. | • `store.js:1-21`: records `{id, v, created, updated, dev, data}` with tombstones, "ready to be synced to an account later".<br>• `DEVICE_ONLY` keys (`store.js:37`); cross-tab `BroadcastChannel` (`store.js:130`).<br>• Backup at `store.js:292`; restore merge, where the newer record wins and nothing is deleted, at `store.js:305`.<br>**Tests:** `store.test.js` "restore: into a new browser everything comes back; here the newer stays and nothing is deleted", "a change is told to listeners (and to the other tabs)". | No server, no identity, no automatic sync. | Reuse the record schema as-is (**S**). Optional sync backend (**L**). Local-first with no account is a stated Lizard differentiator. |
| **Sharing / export of hands or solutions** | Study deep links, hand image download, range copy in PIO/GTO+ format, drill export/import, Play Mode invite links. | **WORKING** (V) for hands and sessions. Solution export is NOT IMPLEMENTED. | • `#h=` links carry the whole state as base64 JSON in the URL hash, so it never reaches a server (`index.html:1307`, `:2211`, `:2256`).<br>• "Copy hand" text: `index.html:2185`.<br>• Per-view and per-spot URLs (`/drills/<spot>/`, `/reports/<spot>/`): `solver/gto/routes.py`.<br>• My hands export and import JSON, and full backup (`hands.js:161`, `:309-321`; `store.js:450`).<br>• Analyzer CSV and JSON export (`session.js:479-483`, `:900-924`).<br>**Tests:** `tests/js/share.test.js` (16), `routes.test.js` (13), `hands.test.js` (13), `session.test.js` "exports: a CSV row per decision asked, and JSON with the summary". | • No range-text export (PIO strings) of solved or built ranges.<br>• No image export, no Study links per node, no solution-file export. | Port link encoding; Lizard needs versioned links (**S**). Add PIO range export and node links (**S**). |

## 5. Verified engine interface (tournament JSON)

Verified in `advisor.py:391-552` and README:944-958, 1191-1200.

**Request:**
```json
{
  "payouts": [50, 30, 20],
  "field": {"players": 30, "chips": 900},
  "bounties": {"format": "pko", "seats": {"BTN": 10, "SB": 10}, "field": 10}
}
```
- `payouts` can also be a string: `"50 30 20"`.
- `field` can also be a list of the other tables' stacks, in chips.
- `bounties.format` is `"ko"` or `"pko"`. `seats` can also be one number for every seat, or a list in seat order.
- Mystery bounties take `{"format": "mystery", "envelope": 30}`, or `{"format": "mystery", "pool": 150, "left": 5}`.

**Response:**
```json
"tournament": {
  "equity_share": 0.2512,
  "bubble_factors": {"BTN": 1.62, "BB": null},
  "note": "tournament: ICM, your prize equity 25.1% …",
  "bounties": {
    "format": "pko", "model": "proportional", "bb_per_unit": 1.5, "pool": 60,
    "bounties": {"BTN": 10},
    "you_bust": {"SB": {"bb": 5.0, "value": 3.33, "cash": 5, "in_hand": true}},
    "bust_you": {"BB": 4.1},
    "note": "bounties: PKO …"
  }
}
```
- The numbers here are illustrative; the shape is from the code.
- A bubble factor is `null` when it is not finite.
- Prize equity applies only with at least 2 payouts or with bounties.
- With bounties and no payouts, the prizes are taken as equal to the bounty pool, chips otherwise (`advisor.py:476-480`).
- Bounties with nothing at stake give answers identical to having none (tested).

## 6. Sub-features GTO Wizard has that upstream lacks

**Tournaments**
- A preflop ICM solve (up to 9 players, 250bb). Upstream uses a risk premium on chip charts, apart from push/fold.
- An ICM preflop library (70k+) and final-table sims (53k+). An Events library (WSOP 2022 Main Event final table).
- A payout preset library (four rooms). Tournament-ID and JSON import that fills in payouts, stacks, players left and average stack.
- Reading KO/PKO bounties from hand histories. Flagging final-table deals.
- TKO bounties. Mystery-bounty pool estimation.
- Spin & Go (3-max) and HU SnG formats.
- Fields up to 4,096 modelled. Upstream models at most 12 players, with stand-ins for the rest.
- An ICM-vs-chipEV comparison view. A Bounty Power display: upstream has `bb_per_unit` in the API, but the UI shows only a note.

**Formats**
- PLO4: cash, MTT, a condensed range UI, the trainer and custom HU solving.
- 1,000bb custom depth with SPR up to 500. Deep-straddle cash at 1000–1600bb.
- Site formats: Winamax Short Track, ACR No Rathole, GG 7-max.
- Presolved libraries across rakes, depths and straddle-plus-ante. Upstream has one 6-max 100bb unraked tree, plus HU builds in progress.

**Other**
- Study Plans and lessons. The Daily Dose quiz.
- Saved trainer configurations (tags, duplicate, reorder), My Drills, saved custom solves usable in Practice, saved spots (M key), saved report filters, saved analyzer reports.
- Lifetime trainer stats filterable by format and date, with session stats that reset while all-time stats are kept.
- Compare EV, Compare Nodes, and comparison across positions, depth and rake.
- Range copy in PIO/GTO+ format, hand image download, drill export/import over the clipboard, Study deep links with URL parameters.
- Play Mode private games, PokerArena (ranked HU, seasons, leaderboards, quests), a native iOS app (Arena).
- Accounts with server sync; PWA installation.

## 7. Recommendations for Lizard

1. **Wrap the tournament engine, don't rewrite it.** `icm.py` is 591 lines and self-contained. It is integrated through `advisor.py`, has 35 Python tests (15 in `test_icm.py`, 14 in `test_bounty.py`, 6 in `test_multiway_solver.py::TestTournament`) and 15 JS tests (`icm.test.js` 7, `bounty.test.js` 8). Map each answer to an honest provenance label:
   - **"ICM prize-equity solve"** for HU, 3-way and 4-way postflop and for push/fold. For 3- and 4-way add "bystander approximation".
   - **"ICM risk-premium adjustment of a chip chart"** for every other preflop spot.
   - **"heuristic, chips"** for postflop pots of 5+ players.
   - Bounty answers also carry **"proportional bounty model"**.
2. **Quick wins (S):**
   - A bubble-factor matrix and risk-premium panel, from data that already exists in the answer.
   - Payout generators and presets, plus stage templates (bubble, ITM, final table).
   - A satellite preset, with new flat-payout tests.
   - A Push/Fold chart view sweeping `pf_classes.push_fold` over stack depths.
   - PIO range-text export.
3. **Medium (M):**
   - A cache and presolve for ICM solves keyed on the tournament inputs.
   - Serving `pf_study`'s chip preflop solves (10–250bb, 2–6 players) as labelled solver answers for deep and short games.
   - A solution compare view.
   - A study-plan feature built on drill sets.
   - Ingesting the HU library once the running builds finish.
4. **Large (L):**
   - A genuine preflop ICM solve: give `pf_game` `icm.Model` payoffs.
   - Final-table and MTT libraries, after the running builds release CPU.
   - PLO4.
   - An arena.
   - A sync backend.
5. **Do not claim parity** in these areas:
   - Satellites (untested).
   - Mystery bounties (average envelope only).
   - Preflop ICM (heuristic).
   - Deep-stack preflop (charts plus rules).
   - 5+-way postflop (rules).
   - PLO.
6. **Explain with AI:**
   - Give Lizard its own proxy deployment, or at least a separate quota: the upstream origin allowlist is host-level and already includes `www.michael-han.com`.
   - Keep the "key never in backups" rule (`store.js:19-20`).

## 8. Verified vs inferred

- **Verified by reading code and finding the named tests:**
  - Every WORKING, PARTIAL and APPROXIMATE grade above.
  - The JSON shapes in §5.
  - The NOT IMPLEMENTED grades for PLO4, study plans, arena, accounts and sync, and satellites, each by grep with no hits.
- **Inferred, not tested or measured:**
  - That flat payouts behave correctly for satellites.
  - That the 2-raise cap limits deep-stack play.
  - That Pyodide performance on phones is unknown.
  - That the explain proxy would admit a Lizard page on the same host.
  - That push/fold sweeps would be cheap.
- **Not run:** no test suite was run, because of the shared-machine rules. "Has tests" does not establish a pass at `9b907bd6`.
- **Library build progress:** read from the build logs under `/Users/mhan/Desktop/projects/gtosolver/.work/flop-core/` (read-only), not from the snapshot.
