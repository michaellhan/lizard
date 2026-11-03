# 02 — GTO Wizard feature inventory and competitive analysis

Research date: 2026-11-03. Scope: public pages only (gtowizard.com, help.gtowizard.com, blog.gtowizard.com, App Store listing, and press/review coverage). I did not log in, open paid areas, scrape solution data, or download assets. All descriptions are paraphrased. Lizard engineers should treat them as behavioral specs to build independently, not as text or designs to copy.

**How to read this report**

- Each fact carries a reference tag such as [H-study]. The tags resolve to full URLs in §9.
- Tag prefixes show source quality. **H-** is GTO Wizard's own help center or product pages, **B-** is the official blog and patch notes, **P-/PF-/PL-/PS-** are press and review coverage (secondhand), and **C-** is a competitor's site.
- **Verified** means read on the cited page this session. **Inferred** means my reading of several sources together or a gap filler, and is labeled as such.
- References to the Lizard/upstream solver are relative to `/Users/mhan/Desktop/projects/lizard`. Ones marked "(code)" were checked with grep this session. Ones marked "(plan)" come from `IMPLEMENTATION_PLAN.md` §1 and were **not** re-verified.

**Staleness warning.** GTO Wizard's help center lags its patch notes by up to two years. The Custom Solving FAQ still says custom solving is two-player, postflop, chip-EV only, with SPR ≤ 100 [H-csfaq]. The trainer-against-custom page labels its limits "as of September 2024" [H-traincs]. Since then the blog has shipped:

- 3-way postflop solving [B-3way]
- 9-player multiway preflop solving [B-mwpf]
- preflop ICM solving [B-pficm]
- 1,000bb depth and SPR up to 500 [B-oct26]

Where the help center and the blog disagree, this report treats the **blog/patch notes as current** and flags the conflict.

---

## 1. Executive summary

- **Product shape (Nov 2026).** GTO Wizard is a cloud, account-based web app with four pillars [H-home]:
  - **Study:** a presolved library plus Aggregated Reports.
  - **Practice:** a trainer, custom drills, a range builder and a daily quiz.
  - **Analyze:** a hand-history analyzer and "GTO Reports" leak finder.
  - **GTO Wizard AI:** a neural-network custom solver that solves in seconds.

  Around these sit PokerArena (free heads-up ranked play, web and iOS), Table Wizard (a Windows multi-tabling client), Play Mode (private browser games), coaching, Study Plans and content, and a B2B Game Integrity line [H-home] [H-gi].
- **Scale claims.**
  - "Millions of spots" [H-home].
  - The postflop library became over 50x larger with Single Size Solutions on 2026-03-31 [B-ss].
  - The ICM preflop library covers 70,000+ situations [B-ss], and ICM final-table sims grew from 553 to 53,000+ [B-3way].
  - Aggregate flop reports cover all 1,755 strategically distinct flops [H-agg].
- **Accuracy claims (published).**
  - Beat Slumbot by 19.4 bb/100 over 150k hands [H-acc].
  - Flop Nash distance 0.21% pot vs PioSolver [H-acc]. The 2023 launch post said 0.12% [B-ai], so the figures conflict.
  - 3-way turn average EV loss 0.24% pot [B-3way], retrained to 0.2009% in Oct 2026 [B-oct26].
  - PLO rivers solve to 0.1% pot exploitability [B-ploup].
- **Monetization.** Tiers are Free, Starter, Premium, Elite and Ultra, and **each format (Cash or Tournament) is a separate subscription** [PS-price]. Prices per month (monthly / annual billing) [P-price] [PS-price]:

  | Tier | Monthly | Annual |
  |---|---|---|
  | Starter | $49 | $39 |
  | Premium | $99 | $79 |
  | Elite | $169 | $139 |
  | Ultra | $359 | $289 |
  | Ultra early bird | $279 | $229 |

  - Custom HU solving and nodelocking are Elite. Multiway solving and custom ICM preflop are Ultra [B-ss] [B-pficm].
  - Custom aggregate reports cost **Power Credits** [B-car].
  - PLO is a separate product with separate plans [H-plo].
- **Structural limits** that Lizard can exploit:
  - Sign-in is required, via Google or Facebook only [H-acct].
  - One active device at a time [H-acct].
  - No offline mode and no native study app (it is a PWA) [H-install].
  - Hand histories are uploaded to their servers [H-upload].
  - Paywalls on every advanced feature, plus credit metering.
  - Multiway postflop is capped at 3 players [B-mwpf].
  - The Analyzer skips multiway postflop hands [H-analyze].
  - Street-by-street solving means nodelocked flop exploits assume perfect play on later streets [H-nl].
  - No LLM or natural-language explanations. "Plain-language solver output" is only a roadmap item [H-road] [P-llm].
- **Lizard's best differentiation:**
  - account-free and local-first, with hands never leaving the device
  - in-browser solving with exportable, transparent trees and honest provenance and accuracy labels
  - no per-format paywall or credits
  - grounded AI explanations (upstream already has a Claude proxy: `solver/cloudflare/explain-proxy/`, code)
  - explicit bubble-factor and risk-premium displays, which GTO Wizard's public docs never mention (§3.8)
- **Recommended P0:**
  - Study browser parity: strategy/EV/EQ/EQR views, Compare EV, filters, the Ranges and Breakdown tabs, and node navigation.
  - Trainer parity: Full hand/Street/Spot modes, grading taxonomy, RNG, timebank, up to 4 tables and session stats.
  - Heads-up custom postflop solve with a GTO Wizard-equivalent bet-tree editor.
  - Hand-history import, an EV-loss-sorted hands table, a replayer, and jumps to Study and Practice.

  The full list is in §8.

---

## 2. Navigation map (verified)

| Top-level | Sub-areas | Source |
|---|---|---|
| Study | Solution browser (Strategy / Ranges / Breakdown / Reports tabs), solution selector (presolved, custom solutions, custom reports), GTO Wizard AI builder (postflop and preflop tree builder) | [H-study] [H-build] [B-car] |
| Practice | Trainer (up to 4 tables), Drills (GTO Wizard Drills + My Drills), Range Builder, Sessions, Stats, Practiced hands | [H-trainer] [H-drills] [H-perf] [H-rb] |
| Analyze | Upload (single hand / files / folder), Uploads, Hands table, GTO Reports, saved reports | [H-upload] [H-hha] [B-analyzer] |
| Play | PokerArena (ranked and casual HU, Play With Friends), Play Mode private games | [B-arena] [B-play] |
| Learn | Blog (free), Study Plans, Coaching, YouTube, Daily Dose of GTO quiz, eBook | [H-home] [P-s5] |
| Other | Table Wizard (Windows), PLO section, Game Integrity, Careers | [H-home] [H-tw] [H-plo] [H-gi] |

---

## 3. Hierarchical feature inventory

Format: **feature** — the user-visible behavior and UI as documented — [source]. Notes for Lizard follow in italics.

### 3.1 Study: solution browser

#### 3.1.1 Layout and tabs
- **Four top tabs:** Strategy, Ranges, Breakdown and Reports. Keys 1–4 switch between them [H-study].
- **Strategy tab panels** [H-study]:
  - **Strategy matrix:** a 13×13 grid colored by action mix. Fully black cells are hands not in range, usually because they took another line. Action colors are user-customizable.
  - **Infobox:** the acting player, pot before and after the last action, pot odds to call, and the board. Clicking a position navigates.
  - **Actions table:** range-average frequency per action. Spacebar toggles between % and bb. The S key or a dropdown groups similar sizes or graphs frequencies.
  - **Hand matrix:** per-combo action/size detail for the hovered class. It shares space with the Filters tab, which is visible when the cursor is off the matrix [B-filter22].
  - **Summary table:** per hand, strategy, range weight, EV (bb), EQ (%), EQR, and *value removal* and *trash removal* scores on a 0–10 scale. Sortable, and narrowed by matrix selection.
  - **Blockers tab:** how hero's cards shift villain's action frequencies, and the reverse. Sort by card to find bluff or slowplay candidates.
- **Range view modes** (a dropdown on the matrix): *range height*, *full height*, *normalized*, and *horizontal* (each combo drawn separately) [H-study] [H-rb].
- **Theme:** preset or custom color themes from settings [H-study].

*Lizard:* upstream already renders a 13×13 grid by strategy, EV, equity or EQR (`solver/gto/static/study.js:3`, `:281`, code) and computes EQR as EV / (EQ × pot) (`solver/gto/static/study.js:234`, code). This matches GTO Wizard's stated definition: EV-based pot share compared with raw equity [H-study].

#### 3.1.2 Metrics (Strategy dropdown) [H-study]
- Strategy (frequencies)
- Strategy+EV and Strategy+EQ: the strategy colors with EV or EQ overlaid
- EV alone and EQ alone
- EQR
- Range weight
- "All" (every metric at once)
- **Compare EV:** pick two actions, for example call vs fold, and color each hand by which has the higher EV. Near-equal hands show white.
- **Best Action:** each hand's EV loss (regret) for taking a given action against the fixed opponent strategy.

#### 3.1.3 Filters [H-study] [B-filter22] [B-ploup]
- **Hand category filters** in the Filters tab show each class's share and filter both the matrix and the actions table. A toggle switches bars between range-length and full-length scaling.
- **Draw tiers:** flush-draw and backdoor-flush-draw filters, each split into nut, broadway, mid and low. Added 2022 [B-filter22].
- **Suit filters:** include or exclude suit patterns, set separately for the higher and lower card.
- **Action (bet) filters:** click an action, or several, to show only the hands that take it. These combine with category filters, for example overbet line plus best hands.
- **Clear filters:** the P key, or per-chip "x".
- **PLO** adds Include/Exclude category mode and hides actions at 0.1% frequency or less by default [B-ploup].
- *Gap:* the full category taxonomy is not published. Lizard must define its own, which upstream partly has (made-hand and draw breakdowns, plan §1, unverified).

#### 3.1.4 Ranges tab [H-ranges]
- **Layout:** OOP on the left, IP on the right, side by side, with a full-screen option. Each range has a summary bar showing combos, equity, EV and EQR.
- **Filter share:** white percentages show the share of each range that passes the filters. Combo counts update with filters, but equity and EV stay unfiltered.
- **Copy:** exports a range in PioSolver/GTO+ text. The active player's dropdown can copy only one action's sub-range.
- **Equity distribution graph:** one point per combo. x is the combo's percentile within its own range, sorted by equity. y is its equity vs the opponent's range. Filters highlight dots. Drag to zoom; full screen is available.
- **Equity buckets:** Simple or Advanced granularity. Selecting a bucket filters both ranges, for example 80%+ equity to show nut advantage.
- **Hand and draw comparison:** choose classes and see their presence in both ranges. Display style is Centered or Stretched.

#### 3.1.5 Breakdown tab [H-breakdown]
- **Per-category metrics:**
  - **Range%:** the category's share of total combos.
  - **Performed%:** how often the category takes the selected action(s).
  - **Represented%:** the category's share of the selected action(s).
- **Action selection:** multi-select, for example two overbet sizes together. S groups sizes.
- **Charts:** a "Category Summary" Manhattan plot shows each combo in a category, sorted by equity and colored by strategy. An "All Combos Summary" Manhattan plot covers the whole range. The example shows BB folding a dominated pair near 55% equity while calling a lower-equity draw for implied odds.
- **Toggle:** Strategy columns vs "All" (EQ and EV). Every column is sortable.

#### 3.1.6 Node navigation and solution selection
- **Spot selector bar:** pick any later action, and players in between auto-fold. The J key opens a shortcut popup (positions, then preflop action type, then flop). After the board, you can optionally pick hole cards [H-study].
- **Solution selector** (top-left): presolved formats, custom solutions, and custom reports. A ⓘ shows the tree summary [H-build] [B-car].
- **Deep links:** Study URLs carry game type, depth and rake as query parameters [H-study].
- **Saved spots:** the M key [H-build].
- **ICM FT selector:** min/max bb stack filters per seat and asymmetry categories (Near / Far / Big / Short) [B-3way].
- **Keyboard shortcuts:** 1–4 tabs, J spot shortcut, S group sizes, P clear filters, Space bb/%, W chart/table (reports), F focus (range builder) [H-study] [H-agg] [H-rb].

#### 3.1.7 Presolved library: formats, depths and sizes
- **Format consolidation (2026-03-31).** Five formats were merged into two [B-ss]:
  - **Cash** = former Cash + Straddle & Ante.
  - **Tournament** = MTT + Spin & Go + HU SnG.
- **Solution "types":**
  - **General / Simple / Simplified** (the Starter tier names them) [B-ss].
  - **Single Size Solutions:** one highest-EV size per node, chosen by Dynamic Sizing. They give every preflop spot a full postflop tree. They are not yet in the Analyzer or Aggregated Reports [B-ss].
- **Cash coverage examples:**
  - rake up to NL500, including GG, capped and live rake; up to 100bb on the Cash tier [B-ss]
  - 8-max single straddle at 1000–1600BB with NL25/100/400 rake and R4–R7 opens; Winamax Short Track 5-max 5–20BB; ACR 7-Day No Rathole 6-max 10–30BB [B-2025]
  - 6-max Straddle+Ante at 50/75/100BB [B-filter22]
- **Tournament coverage examples:**
  - chipEV MTT, symmetric and asymmetric stacks, up to 200bb [B-ss]
  - symmetric Spin & Go, and HU SnG [B-ss]
  - ICM final tables (§3.8)
  - an Events library; the WSOP 2022 ME FT is free [B-ss]
- **Free tier:** 100 preflop solutions per day (symmetric stacks, chipEV or microstakes rake, 2.5x open) and 1 Single Size postflop spot per day [B-ss].
- *Gap:* no public page lists exact depth grids per format. Secondhand reviews say cash runs from 2-max to 9-max (search snippets only, unverified).

### 3.2 Study: Aggregated Reports [H-agg] [B-car] [B-ss] [PS-price]
- **Streets:**
  - **Flop reports:** all 1,755 flops, from the node where the report opens.
  - **Turn reports:** every turn card on a given flop, from any turn node.
  - River reports are not mentioned. "Aggregate reports for any street" is on the roadmap [H-road].
- **Subsets:** a reduced representative flop set. Every average is **weighted by flop probability**.
- **Metrics:** strategy, EV, EQ and EQR. Selecting both positions shows a double bar chart.
- **Views** (W key):
  - **Chart:** a bar per flop or group, a page-wide visualizer, a Manhattan-style scroller, and a stats panel for the selected flop or group.
  - **Table:** exact numbers, sortable by grouped action, EV, EQ or EQR. A **"filtered" row** compares the filtered subset with all flops and shows the % of flops matching.
- **Grouping and filters:**
  - Group flops by high card, suits, pairing, or connectedness. Connectedness has three levels: disconnected, OESD possible, connected.
  - Filters combine, and saved filters appear under "my filters".
- **Action grouping:** All sizes, Grouped (small / medium / large / overbet), Simple (all bets merged), and Graph. S toggles.
- **Conditional highlighting:** None, Background, or Text. Above average is green and below average is red.
- **Turn-report extras:** a "default" view color-codes all turn cards, and filtering by hole cards shows the exact hand's strategy.
- **Jump-offs:** from a report into the solution browser or Practice.
- **Custom Aggregated Reports** (2025-06-02, Elite):
  - Settable inputs: ranges, fixed or dynamic sizes, depth, rake, ICM, payouts and bounties.
  - All 1,755 flops solve in minutes.
  - Cost = max(175, 10·√nodes) Power Credits. Examples: SB-v-BB 3BP 185, CO-v-BB SRP 222, 200bb limped with 10 raises 638.
  - Credits expire one year after the Elite subscription ends.
  - Ultra includes 1,500 credits per month [B-mwpf] [PS-price].
- **Gating:** flop and turn reports are Premium [PS-price].

*Lizard:* upstream already has texture-grouped flop reports weighted across the 22,100 flops (`solver/gto/static/reports.js:1-5`, code). It has turn reports via runouts (same header, code) and 18 presolved spots in `solver/gto/static/flop_library/index.json` (format 2, code). For parity it still needs Chart/Table views, the filtered-vs-all row, action grouping and conditional highlighting.

### 3.3 Practice: Trainer [H-trainer] [H-perf] [H-ideas] [H-drills] [B-filter22]
- **Setup tabs:**
  - **Game:** format, solution and depth; starting street and preflop line, where "From Start" means full hands; hero and villain positions; an option to alternate roles.
  - **Board:** specific boards, textures, or representative flop subsets (paired, monotone, connected, flush-draw and so on), plus high/mid/low card and suit-texture filters.
  - **Hands:** specific hands, suited or offsuit, removing trivial hands, premium only. An **"Only Close Decisions"** option deals hands where two or more actions have similar EV.
  - **Preflop line filters:** for example vs 3-bet or 4-bet, and size sequences [H-ideas].
- **Game mode:** Full Hand (preflop to river or a fold), Street (one street), or Spot (one decision repeated).
- **Difficulty:**
  - Standard: the exact size is required.
  - Grouped: the size class (small / medium / large / overbet) is enough.
  - Simple: only bet/raise vs check/call vs fold.

  In Grouped and Simple, the highest-frequency action within the group is the one graded.
- **Input mode:** Action (pick one) or **Frequency** (enter a % for each action, for mixed spots).
- **Speed and flow:**
  - Game speed: Normal, Fast or Turbo.
  - Auto new hand: off, a delay, and so on.
  - Pause after: every action, or only after mistakes. Learning mode auto-opens the info panel.
  - "Hard mode" hides ranges and equity [H-ideas].
- **Timebank:** 7, 15 or 25 seconds. When time runs out, the hand auto-folds or auto-checks.
- **Multitabling:** up to **4 tables**, each with its own controls and info panel.
- **RNG:** a 1–100 roll, set before the session to High or Low. High maps the most aggressive action to high rolls. When RNG is on, the "best" action is the one the roll selects. When it is off, best is the highest-frequency action. The dice icon turns yellow when active.
- **Info panel:** range and strategy views for both players, with collapsible sections and a pop-out window for a second screen [B-filter22]. The History panel replays any hand.
- **Scoring and grading:**
  - **GTOW Score:** each move scores −100% to +100%, with a running total bottom-right.
  - **Best Move:** the top-frequency action, or the RNG-selected one.
  - **Correct:** an action in the mix, earning points in proportion to its frequency.
  - **Inaccuracy:** GTO frequency below **3.5%** with no significant EV loss.
  - **Wrong:** an action at 0% frequency.
  - **Blunder:** an action at 0% frequency that also loses significant EV. Points lost scale with the % of pot lost.
  - *Gap:* the blunder EV cutoff and the exact score formula are not published.
  - PLO labels moves as Correct, Inaccuracy, Mistake or Blunder [B-plo].
- **Stats and metrics:**
  - total EV loss (bb), average EV loss per hand, EV loss as % of pot, and average EV loss per mistake
  - **Average frequency difference:** the most-common action's frequency minus the chosen action's frequency, averaged. Example: R20/C50/F30 and hero raises gives 30%.
  - PLO adds bb/100 EV loss by position and street [B-ploup].
- **Pages:**
  - Sessions: expandable, with a "Show hands" list.
  - Stats: lifetime, filterable by format and date, with a by-pot-type panel. Session stats can be reset while all-time stats are kept [B-filter22].
  - Practiced hands: an analyzer-like table sortable by EV loss, date or frequency difference, with a sidebar and replay.
- **Drills:**
  - Saved trainer configurations: NEW, Duplicate, Edit, rename/description, color tags (filter by all or any tags), sort (name, format, hands, GTOW Score%), drag reorder, and Play/Stats.
  - **Export/Import** via the clipboard for sharing.
  - The built-in "GTO Wizard Drills" library sits alongside "My Drills".
- **Custom-solution training** [H-traincs] [B-analyzer] [B-ploup]:
  - Open a saved custom solve in Practice, or pick it in trainer settings under Custom.
  - 3-way postflop spots are drillable since Sep 2025.
  - Player profiles are trainable.
- **Free tier:** 10 trainer hands per day [H-trainer] [B-ss].
- **Other learning tools:** Daily Dose of GTO quiz [H-home]. Study Plans of 30 lessons plus drills each, for example "Mastering Basics of GTO" and "MTT Fundamentals" [P-s5].

*Lizard:* upstream already has multi-table practice at 2–4 tables (`solver/gto/static/multitable.js:1-5`, code) and flop-library drills (`solver/gto/static/drills.js:1-5`, code). Its verdicts are Best move, Good, Inaccuracy and Mistake (`solver/gto/static/practice.js:417-424`, code), one level coarser than GTO Wizard's five.

### 3.4 Practice: Range Builder [H-rb]
- **Purpose:** paint a whole range's strategy for a spot instead of playing hand by hand. The result is graded against GTO.
- **Setup:** solution selector, spot selector, board (filter, pick, or random), and difficulty. Easy offers fewer sizes.
- **Painting:**
  - paintbrush tool
  - per-action frequency set by slider, arrows, presets or typing
  - **pin** a class to paint individual suits in a sub-matrix
  - **category painting**, for example all flush draws, which overwrites everything not locked
  - **lock** combos
  - suit filter
  - range views, with horizontal recommended
- **Tools:**
  - opponent range side by side
  - a "correct frequencies" lightbulb that compares your totals with GTO totals
  - a hat icon that opens the solution browser
  - focus mode (F)
  - undo/redo (Ctrl+X/Ctrl+Y as documented), clear all, and Confirm to submit
- **Grading:**
  - Each combo's frequencies are compared with GTO's, giving an overall **0–100%** grade.
  - Results can be viewed by hands, draws or equity buckets, each graded separately, with best and worst categories.
  - Hovering a category highlights it, and selecting one shows your strategy next to GTO's.
  - Changing the size grouping (S) re-grades.
- **Export:** a copy dropdown exports any action's strategy as PioSOLVER/GTO+ text.
- *Gap:* the exact grading formula is not published.

*Lizard:* upstream has a range builder scored as one minus the share of misplaced weight (`solver/gto/static/study.js:420-440`, code).

### 3.5 Analyze: hand-history analyzer [H-analyze] [H-upload] [H-hha] [B-analyzer] [P-hha24] [P-gtor]
- **Upload:** the Upload button in the top-right. Paste a **single hand**, or add **files or a folder** by drag-and-drop or the buttons. Statuses run In Queue → Processing → Analyzed, and you can leave the page while it works.
- **Sites (15):** 888, Chico, CoinPoker, GG Poker, Ignition, iPoker, PartyPoker, PokerBros, PokerMaster, PokerStars, PPPoker, Unibet, WePoker, Winamax, WPN/ACR. Others may work via tracker export [H-upload].
- **Engine mapping:**
  - The closest rake and stack are picked.
  - Preflop through turn are compared with presolved solutions, using the closest sizes. A mismatch shows the hero's real size in parentheses.
  - **The river is solved at the exact stacks and sizes.**
  - Multiway postflop is skipped. Off-tree actions get partial analysis [H-analyze] [H-hha].
- **Hand statuses:** Analyzed, "Non-existing GTO spot" (multiway, odd depth, bad format, or a never-played line), and Error. Duplicates are flagged [H-hha] [H-upload].
- **Hands table (Analyzer 2.0, Dec 2024, redesigned Sep 2025):**
  - Sortable columns: date, EV loss, BB W/L, pot and others. Link parameters also expose position, pot type, blinds, format, rake, site, hero hand, board, notes, per-street action correctness, average GTO score, average frequency difference, total EV loss (bb and % pot) and win/loss [B-analyzer].
  - Adjustable density, pinnable columns and customizable columns [P-hha24].
  - Filters: spots, boards, hole cards, dates and EV loss. An **action-sequence filter**. Search with synonyms, for example "RFI" matches Did RFI, Faced RFI and Raise vs RFI.
  - Starring, bulk tag and notes, bulk delete, and saved, editable reports.
  - Breakdowns by preflop action, position and street [P-hha24].
- **Hand toolbar:** previous/next, replay, large/compact mode (large shows the optimal play per street), a jump to the Solution browser, and a picture download for sharing. **One click opens Study or a Practice drill** of the same spot [B-analyzer].
- **Color coding:** red is a blunder, yellow an inaccuracy, green correct. EV loss also shows as bb/100, for example 7.65bb = 765 bb/100 [H-hha].
- **Replayer:** correct frequencies and EVs at each decision, street jumps, arrow keys and hotkeys.
- **GTO Reports** (Mar 2025, upgraded Sep 2025):
  - Compares preflop VPIP, PFR, RFI, limp, squeeze and 3/4/5-bet frequencies with GTO at 100 and 200bb, rake-adjusted, with color-coded deviations. Cash only at launch [P-gtor].
  - **Preflop Mistakes:** pick a stat and see the top 10 hands by EV loss. **Flop General View** compares flop frequencies with GTO. Sample-size tooltips flag unreliable stats [B-analyzer].
- **Quotas** (reset monthly). Sources conflict on the free tier:

  | Tier | Analyzed hands per month | Source |
  |---|---|---|
  | Free | 5 | [H-sub] |
  | Free | 10 | [PS-price] |
  | Starter | 100 (doubled in Mar 2026) | [B-ss] |
  | Premium | 100,000 | [PS-price] |

- **Feed-ins:** Table Wizard auto-upload [B-analyzer] [H-tw], PokerArena "Mark the Spot" [AS-arena], and analyzer hands opening preflop-ICM custom solves in one click [B-oct26].

*Lizard:* upstream parses PokerStars, GGPoker/Natural8, 888, partypoker, Winamax, WPN/ACR, Ignition/Bovada and iPoker XML (`solver/gto/static/hh.js:1-24`, code). That is 8 of GTO Wizard's 15. The missing ones are mostly app/club sites (PokerBros, PPPoker, PokerMaster, WePoker), plus Chico, CoinPoker and Unibet.

### 3.6 GTO Wizard AI: custom solving
- **Engine:** solves in seconds, street by street, with neural networks. It came from the Ruse AI team. Launched 2023-07-19 with SPR ≤ 125 [B-ai]. PLO uses a mix of traditional solving and predictive networks [B-patch].
- **Builder flow (postflop)** [H-build]:
  1. Solution selector → Custom Solutions → New.
  2. Set the format and starting street. River-only solves are made by zeroing flop and turn bets with Dynamic sizing.
  3. Optional **PREFILL** imports ranges, stack and pot from a presolved spot.
  4. Stack and pot in 0.1bb steps. The help page says SPR ≤ 100 and stack/pot ≤ 999. The Oct 2026 patch raised depth to 1,000bb and SPR to 500 [B-oct26].
  5. **Range editor:** paint, From/To width slider, Weight box or mouse wheel, UPI/PIO text import and export, save and load, and a swap IP/OOP ⇄ button.
  6. Pick the board.
  7. Bet sizes: **Automatic** (keep the highest-EV sizes), **Dynamic** (keep N sizes, optionally from a candidate list), or **Fixed** (exact sizes, no simplification).
  8. Size units: **% pot**, **geometric (e)** which adapts to depth, or **x previous bet**.
  9. **Inheritance:** IP inherits OOP, and turn/river inherit flop, unless toggled off. Flop/Turn/River tabs.
  10. **Advanced:** Always add all-in; Force all-in threshold (% of effective stack, 100% disables); Add all-in threshold (% of pot, 0 disables); Bet-size merging threshold (typically 5–20%, 0 disables).
  11. **Tree Edit:** a pencil on any node to add or remove sizes, change units, or drop check/fold. Works after solving too.
  12. **Summary** tab.
  13. Save parameters, ranges and solutions with colored tags (match any or all).
- **Preflop Tree Builder** (2026) [H-build] [B-mwpf] [P-price]:
  - **Solution card:** players (2–9), stacks (exact chips, asymmetric allowed), blinds, antes (per-player / total / BB ante), straddles (single / double / Mississippi from any seat), equity model (ChipEV or ICM), rake, and player profiles.
  - **Sizes:** Presets (SPR-adjusted) or Fixed, with per-position opens, limp and cold-call options, SB complete, one limper, and separate 2-bet, 3-bet, 4-bet and 5-bet+ rules.
  - **Engine modes:** Fast (shorter lookahead, more re-solves) and Classic (street by street, better for nodelocks and profiles). The mode is chosen automatically and can be overridden.
  - **Sharing:** saved-parameter import/export, or copying the editing URL.
  - **Limits:** at most 3 players may reach the flop [PL-pficm]. Postflop multiway is limited to 3 players, with 9-player postflop and a public research API planned [B-mwpf].
- **3-way postflop** (2025-08-12) [B-3way] [B-oct26]:
  - Supports custom ranges and sizes, nodelocking, practice, mixed stacks, **side pots**, rake and **bunching effect**.
  - Complexity limits force tree simplification.
  - Since Oct 2026 the AI auto-picks 3-way sizes under cEV and ICM.
- **Dynamic Sizing:**
  - Iteratively prunes the least valuable size, using frequency, EV and removal-regret signals in an ML model, then re-solves.
  - River EV loss is about 0.05% pot vs the best single size, and about 0.30% vs an 8-size tree [B-dyn].
  - Dynamic Sizing 2.0 shipped 2025-06 [B-car].
- **Nodelocking** (Elite) [H-nl] [B-3way] [B-analyzer]:
  - A lock icon on a node opens three tabs:
    - **Set Strategy:** paint actions onto combos. Isomorphic combos follow.
    - **Set Frequency:** sliders or typed values, with *Overwrite Unlocked* or *Overwrite All*. The lowest-EV-loss hands move first. Individual actions can be locked.
    - **Lock / Unlock:** Lock All, Unlock All, or per hand/category.
  - Click Nodelock to apply. Locked hands stay fixed and unlocked hands re-optimize.
  - **Compare Nodes:** current vs previous strategy side by side, with an EV metric to measure exploitability, broken down by equity bucket, category or draws.
  - **Nodelocking 2.0:**
    - lock previous nodes
    - an initial-strategy toggle
    - multi-step undo, redo and reset
    - a combo-locking toggle
    - Hand Frequency / Hand Classes painting
    - a combos table sortable by EQ or EV
    - **Global Frequency** locking via a temporary virtual bounty, 3–6x less exploitable on 100 river spots
  - Sep 2025 added target frequency for a filtered slice, with hover presets at 0/25/50/75/100%.
  - **Limitation:** street-by-street solving means the solver cannot anticipate mistakes on later streets, even locked ones [H-nl].
- **Player Profiles** (Nov 2025) [P-prof] [B-mwpf] [B-ploup]:
  - A persistent opponent type applied across the whole tree. It is implemented as virtual incentives, in % of pot, on check, bet/raise, fold and call. Example: "Fish" gets +4% to call and −6% to check.
  - The incentives are excluded from reported EV. The current street is exploited, and later streets are treated as perfect play.
  - Presets include GTO, Fish, calling station, maniac, loose opener and Glass Cannon. Custom profiles came later (PLO confirms them [B-ploup]).
  - Roadmap: per-street and per-node incentives.
- **Accuracy:** see §1. A dynamic-sizing river capture of 99.95% of EV [H-acc].
- **Gating:**
  - Elite: HU custom solving, nodelocking and profiles.
  - Ultra: multiway preflop (9), custom 3-way postflop, and custom ICM preflop and multiway.
  - Free: one free flop, Q♠T♠7♥, with every feature, plus custom preflop at ≤ 10bb [H-csfaq] [B-3way] [B-pficm] [B-ss].
- **Coming next:** solve a spot from a screenshot [B-oct26].

*Lizard:* upstream has nodelock presets such as station, nit, maniac and overfolder as fold/bluff/bet/raise percentage shifts (`solver/gto/exploit.py:420-424`, code). This is conceptually close to GTO Wizard's incentive profiles. Plan §1 (unverified) lists size optimization, custom ranges and heads-up and 3-way CFR.

### 3.7 Game formats [B-ss] [B-mwpf] [H-plo] [B-plo] [B-ploup] [B-2025]
- **NLHE:**
  - Cash: HU through 9-handed. Custom preflop covers 2–9 players. Includes straddle/ante variants, short-stack site formats, and deep straddle spots to 1600BB.
  - MTT: up to 200bb presolved, 250bb in custom preflop ICM, 1,000bb in custom solving after Oct 2026.
  - Spin & Go (3-max, symmetric) and HU SnG.
- **PLO4** (launched 2026-05-12, separate plan):
  - Cash: 6/7/8-max and HU, 10–200bb, cEV or PLO50–PLO500 rake, classic/ante/straddle, plus site formats (GG 7-max, CoinPoker ante, ClubWPT Gold 8-max straddle and ante).
  - MTT: 6-max chipEV and ICM FT, 5–100bb, with antes.
  - Range UI: a 13×13 condensed preflop matrix over about 270k combos, plus categories and macros.
  - Other: Compare across positions, depth or rake; Breakdown by equity; EV/EQ distribution charts; PPT export of preflop ranges.
  - Trainer: Full Hand/Street/Spot, 4 tables, saved drills, change-action, and bb/100 stats.
  - Custom HU solving preflop to river, postflop ICM (KO/PKO/TKO), nodelock and profiles.
- **PLO5/PLO6:** in research, no ETA. PLO aggregate reports and mobile are "in the works" [B-plo] [B-ploup].

### 3.8 Tournaments
- **ChipEV vs ICM:**
  - Presolved chipEV MTT plus an ICM library of 70k+ situations (Tournament Premium) [B-ss].
  - Final-table sims: 560 added in Dec 2024 (200-entry, 3- to 9-max, 15–60bb) [B-2025]. Then 53k+ in Aug 2025: 3-max 15k, 4-max 15k, 5-max 8k, 6-max 10k, 7-max 3k and 8-max 2k, at 10–70bb [B-3way].
- **Custom ICM, by date:**
  - 2024-07-29: HU postflop for any format (freezeout, KO, PKO, TKO, satellites, mystery bounty). Fields up to 4,096; the free ICM calculator handles 2,048. Prefilled popular structures and tournament-ID import [B-icm24].
  - 2026-08: 3-way postflop ICM with bounties [PF-mwicm].
  - 2026-09-15: preflop ICM, up to 9 players, 250bb, fields up to 4,096, about 1 second per spot. Payout presets for several dozen tournaments across 8 rooms. ICM-vs-chipEV comparison of the same spot. Preflop ranges, stacks and payouts carry into 3-way postflop ICM [B-pficm] [PL-pficm].
  - 2026-10-23: hand-history or tournament-JSON import that auto-fills payouts, stacks, players left and average stack. Reads PKO/KO bounties from the hand history. A Preset Library (PokerStars, WPN, Winamax, 888) filterable by format, buy-in, field, prize pool and seats. Final-table deals flagged. Mystery-bounty solving that estimates the initial bounty pool and average bounty [B-oct26].
- **Bounty display:** a "Bounty Power Display" converts bounty dollars into bb [B-icm24].
- **Not found in any public GTO Wizard source read:** a **bubble factor** or **risk premium** display, or a named MTT-stage taxonomy (for example 50% field, near bubble, ITM) [B-pficm] [PL-pficm] [B-icm24]. *Inferred opportunity:* upstream already reasons about bubble factors (`solver/gto/icm.py:9`, code). It implements KO, PKO and mystery bounty models (`solver/gto/icm.py:197-216`, code) and Malmuth-Harville equities (`solver/gto/icm.py:28-53`, code).

### 3.9 Play: Play Mode, PokerArena and Table Wizard
- **Play Mode** (2024-09-19, early access):
  - Browser-only, single table, up to 9 players.
  - Regular, Hyper and Cash presets with adjustable stacks, blind levels, level speed and decision time.
  - **Private games by share link, and guests need no account.** A heads-up queue matches players of similar skill.
  - Free. Post-game analysis was planned [B-play].
  - Dec 2024: hover to see folded cards, all-in equities, chip/bb toggle, F to go all-in [B-2025].
- **PokerArena** (launched 2025-06-30; iOS 1.0 on 2025-06-27):
  - Heads-up ranked and casual. Every hand is scored by GTO Wizard AI, and the rating rewards precision.
  - Monthly seasons. Ranks run Iron, Bronze, Silver, Gold, Diamond, with 3 divisions each.
  - Matchmaking widens the allowed rating gap over time. Blinds rise every 4 hands (Season 2). The rating places less weight on GTO score as certainty grows.
  - Leaderboards, friends, daily quests and streaks, badges, and in-match "Mark the Spot".
  - Post-match insights: best play, biggest misstep, longest hand, lucky draws.
  - Prizes include Elite subscriptions; there are no cash prizes.
  - Free. Deeper breakdowns need Premium or Elite.
  - Sources: [B-arena] [B-3way] [B-analyzer] [AS-arena]. The App Store shows 4.8★ from 220 ratings [AS-arena].
- **Table Wizard** (open beta 2025-07-15):
  - Windows multi-tabling client. macOS and iOS "coming soon".
  - Layouts, hotkeys and controllers, preset bet buttons, border highlights.
  - Overlays for RNG, SPR, pot odds and effective stack. Action-history panel.
  - Auto-upload of hands to the Analyzer. PokerStars and iPoker at launch.
  - Free during beta.
  - GTO Wizard says it gives no real-time strategy advice [P-tw] [H-tw] [B-analyzer].
  - *Lizard: out of scope.* The plan forbids live-table assistance and client integration (`IMPLEMENTATION_PLAN.md` §0, "Ethical scope").

### 3.10 AI coach and explanations
- **No LLM or natural-language explainer was found** in GTO Wizard's docs or patch notes. The roadmap lists "plain-language solver output" and "adaptive solutions" as future work [H-road].
- An April 2026 benchmark pitted frontier LLMs against GTO Wizard AI in HUNL. All LLMs lost, for example GPT-5.3 at about −16 bb/100 and Claude Opus 4.6 at about −20.4. The same report mentions an API for submitting external agents [P-llm].
- *Lizard differentiator:* grounded LLM explanations already exist upstream (`solver/cloudflare/explain-proxy/`, code; plan §1).

### 3.11 Mobile, account, sync and sharing
- **Mobile:** there is no native study app. GTO Wizard is installable as a PWA (Chrome add to home screen, Safari Share → Add to Home Screen) [H-install]. Multiway preflop solving works on phones [B-mwpf]. PokerArena is the only native iOS app [AS-arena].
- **Offline:** not described, and it effectively requires a connection [H-install].
- **Account:**
  - Sign up only with Google or Facebook.
  - **One active device at a time**; logging in elsewhere logs out other sessions.
  - Sharing an account means a permanent ban.
  - Deletion is by request to support [H-acct].
- **Sync:** server-side, by account (inferred from single-account design). PokerArena progress syncs across web and iOS [B-arena].
- **Sharing surfaces:**
  - drill export and import via clipboard [H-drills] [B-filter22]
  - range text copy in PIO/GTO+ format [H-ranges] [H-rb]
  - custom preflop-tree editing URL [H-build]
  - Study deep links with URL params [H-study]
  - hand picture download [H-hha]
  - Play Mode invite links [B-play]

### 3.12 Pricing and gating matrix (Hold'em; per format)

| Capability | Free | Starter | Premium | Elite | Ultra | Source |
|---|---|---|---|---|---|---|
| Preflop presolved | 100 per day (symmetric, cEV or micro rake, 2.5x) | basic library | full (incl. ICM in Tournament) | full | full | [B-ss] [PS-price] |
| Postflop presolved | 1 Single Size spot per day | Single Size, 100bb, no straddle or ante | full HU library, multi-size | + 3-way and ICM Single Size | same | [B-ss] [PS-price] |
| Trainer | 10 hands per day | unlimited | unlimited | unlimited | unlimited | [B-ss] [PS-price] |
| Analyzer | 5 or 10 hands per month (sources conflict) | 100 per month | 100,000 per month | — | — | [H-sub] [PS-price] [B-ss] |
| Aggregated reports | — | — | flop and turn | + custom (Power Credits) | + 1,500 credits per month | [PS-price] [B-car] [B-mwpf] |
| Custom HU solving, nodelock, profiles | free flop Q♠T♠7♥; preflop ≤ 10bb | — | — | yes | yes | [H-csfaq] [B-ss] [B-pficm] |
| Custom multiway (preflop 9, 3-way postflop) | ≤ 10bb preflop | — | — | legacy 3-way only | yes | [B-ss] [B-mwpf] |
| Custom ICM preflop and multiway | ≤ 10bb | — | — | HU postflop ICM | yes (Tournament) | [B-pficm] |
| Coaching | some free sessions | weekly live + 200h recorded | premium coaching | premium coaching | — | [B-ss] [H-sub] |
| Price (monthly / annual) | $0 | $49 / $39 | $99 / $79 | $169 / $139 | $359 / $289 (early bird $279 / $229) | [P-price] [PS-price] |

- **PLO plans:** Premium $139/mo annual (early bird; list $179) and Elite $179 (list $239). The PLO free tier gives 1 postflop spot and 10 trainer hands per day and 1 preflop depth [H-plo].
- **Policies:** 7-day refund policy, and existing rates locked while the plan stays active [H-plo] [B-ss].

---

## 4. Patch-notes timeline (notable launches)

The official tag page (`blog.gtowizard.com/tag/patch-notes/`) shows only six 2026 entries and no older pagination [B-patch]. Earlier dates come from the individual posts or press coverage cited.

| Date | Launch | Source |
|---|---|---|
| 2023-07-19 | *(context)* GTO Wizard AI custom solving launches; SPR ≤ 125 | [B-ai] |
| 2023-08-21 | *(context)* Dynamic Sizing | [B-dyn] |
| 2024-07-29 | Custom ICM solving for HU postflop spots in any tournament format, fields to 4,096, mystery bounties, structure presets | [B-icm24] |
| 2024-09-19 | Play Mode (free browser private games up to 9, guests without accounts) | [B-play] |
| 2024-12-19 | HH Analyzer 2.0 (breakdowns, custom filters and columns, saved reports, faster processing) | [P-hha24] |
| 2024-12-27 | Straddle and short-stack cash solutions; 560 FT ICM spots; Play Mode improvements | [B-2025] |
| 2025-03-30 | GTO Reports (preflop stats vs GTO, cash, 100/200bb) | [P-gtor] |
| 2025-06-02 | Custom Aggregated Reports, Power Credits, Dynamic Sizing 2.0 | [B-car] |
| 2025-06-27 / 06-30 | PokerArena (iOS 1.0; web launch post) | [AS-arena] [B-arena] |
| 2025-07-15 | Table Wizard open beta (Windows; PokerStars, iPoker) | [P-tw] |
| 2025-08-12 | 3-way postflop solving, Nodelocking 2.0, 53k ICM FT sims, PokerArena S2 | [B-3way] |
| 2025-09-24 | Redesigned Analyzer table, flop GTO Reports, slice-frequency nodelock, 3-way practice, Table Wizard auto-upload | [B-analyzer] |
| 2025-11-04 | Player Profiles (opponent-type incentives) | [P-prof] |
| 2025-11-12 | "Custom Profiles Go Live + PokerArena Season 5", per one search-result summary only; **not verified** | (search snippet) |
| 2026-02-03 | Multiway preflop solving (up to 9 players) and the Ultra tier | [B-mwpf] |
| 2026-03-31 | Single Size Solutions (50x postflop library), formats merged to Cash and Tournament, new pricing | [B-ss] [P-price] |
| 2026-04-13 | LLM vs GTO Wizard AI benchmark; agent-submission API | [P-llm] |
| 2026-05-12 | PLO4 launch (study, trainer, Elite custom solving) | [B-plo] |
| 2026-06-24 | Official WSOP 2026 training partner (news) | [B-patch] |
| 2026-07-27 | PLO: custom HU preflop–river, postflop ICM, nodelock and profiles, 4-table trainer, 2–6x faster engine | [B-ploup] |
| 2026-08-21 | 3-way postflop ICM plus bounties | [PF-mwicm] |
| 2026-09-15 | Preflop ICM solving (9 players, 250bb, fields to 4,096, about 1s) | [B-pficm] |
| 2026-10-23 | 1,000bb / SPR 500 custom limits, retrained models, AI 3-way sizing, tournament HH/JSON import, Preset Library, mystery-bounty solving; screenshot import planned | [B-oct26] |

---

## 5. Competitive analysis

### 5.1 GTO Wizard strengths
1. **Coverage and immediacy.** A huge presolved library spans every format, plus custom solves in seconds, including 9-way preflop and ICM [B-ss] [B-mwpf] [B-pficm].
2. **A closed study loop.** Analyzer → Study → Practice drill takes one click each way, and leaks surface in GTO Reports [B-analyzer].
3. **Mature UI vocabulary.** Compare EV, Best Action regret, Range%/Performed%/Represented%, equity buckets, Manhattan plots, and the trainer's size-grouping difficulty levels [H-study] [H-breakdown] [H-trainer].
4. **Published benchmarks.** Slumbot, PioSolver Nash distance, and 3-way turn EV loss [H-acc] [B-3way] [B-oct26].
5. **Exploit tooling.** Nodelocking 2.0 with low-exploitability frequency locks, plus player profiles [B-3way] [P-prof].
6. **Ecosystem.** Content, coaching, Study Plans, PokerArena engagement loops, WSOP partnership, and integrity partnerships with operators [H-home] [H-gi] [P-s5].

### 5.2 Weaknesses and limits (documented)
1. **Cost and gating complexity.** Formats are bought separately, so Premium for both is $198/mo [PS-price]. Custom solving needs Elite and multiway needs Ultra at $289–$359/mo [B-ss]. Custom reports cost metered Power Credits that expire one year after Elite lapses [B-car].
2. **Account lock-in.** Google or Facebook sign-in only, one active device, no offline use, a PWA rather than native study apps, and account deletion only via support [H-acct] [H-install].
3. **Privacy.** Hand histories go to their servers for analysis [H-upload]. The company also runs operator-facing integrity detection [H-gi], which some players may find off-putting. *That last point is inferred.*
4. **Solver-structure caveats.** Street-by-street solving: flop exploits assume perfect later-street play [H-nl]. Multiway postflop is capped at 3 players, and preflop trees let at most 3 players reach the flop [B-mwpf] [PL-pficm]. The Analyzer skips multiway postflop hands and snaps to the nearest size on flop and turn [H-analyze] [H-hha]. Single Size Solutions are not yet in the Analyzer or reports [B-ss].
5. **Opaque internals.** Solves are neural approximations with published averages but no per-spot convergence. Accuracy figures conflict over time (0.12% vs 0.21% flop Nash distance) [B-ai] [H-acc]. Export is limited to text ranges per action; there is no full-tree export (no full-tree export is documented, *inferred*).
6. **Documentation debt.** Help center pages contradict the current product (see the staleness warning at the top).
7. **No natural-language coaching** [H-road] [P-llm]. The roadmap points toward it, so this gap may close.
8. **Missing ICM pedagogy displays.** No public bubble-factor or risk-premium view (§3.8).

### 5.3 Where Lizard can differentiate (account-free, browser-solving)
| Lever | Why it matters vs GTO Wizard | Evidence and feasibility |
|---|---|---|
| **No account, local-first** (IndexedDB; hands never uploaded) | Directly counters the sign-in requirement, single device, and server-side histories [H-acct] [H-upload] | Plan §3 mandates IndexedDB and no-account local features |
| **Free and unmetered** | No format paywall, credits, or 10-hands-per-day caps [B-ss] [B-car] | Static hosting on GitHub Pages; compute runs on the user's CPU |
| **Transparent solves** | Per-spot exploitability where measured, a visible tree and abstraction, a provenance label ("presolved / fresh DCFR / approximate chart / heuristic multiway") | Plan §3 "honest accuracy labels"; upstream DCFR (plan §1, unverified) |
| **Exportable everything** | Full-tree JSON, PIO-format ranges, drills, sessions; shareable deep links with no login | Upstream share links and text exports (plan §1) |
| **True offline PWA** | GTO Wizard needs a connection [H-install] | Upstream already ships `solver/gto/static/sw.js` (code: file present) |
| **Grounded AI explanations** | Not offered by GTO Wizard [H-road] | `solver/cloudflare/explain-proxy/` (code) |
| **ICM teaching views** | Bubble factor and risk premium are absent publicly in GTO Wizard | `solver/gto/icm.py:9,197-216` (code) |
| **No device or ToS restrictions on solver files** | Users own their solves | — |
| **Ethical clarity** | Review-only scope with no live-table tooling (vs Table Wizard) | Plan §0 |

**Honest constraints.**
- In-browser NumPy/Pyodide or WASM DCFR will be slower than GTO Wizard's server-side neural solver, especially for 3-way and preflop.
- Library breadth will be far smaller: today 18 HU spots plus a multiway index in `solver/gto/static/flop_library/` (code), and the HU SB-vs-BB builds are still running.
- Lizard should not claim parity on coverage, multiway preflop equilibrium, or PLO until those are measured.

### 5.4 Other competitors (context only)
- **PioSOLVER** (desktop, Windows):
  - Pro €450: flop, turn and river, 16 cores, scripting, 2 PCs.
  - Edge €800: adds an HU preflop solver and 64 cores.
  - Both are described as heads-up solvers [C-pio].
  - It is the reference benchmark GTO Wizard measures against [H-acc]. It has a steep learning curve [C-dc].
- **GTO+** (desktop): an HU postflop solver with a visual tree builder, small save files, and runout recalculation without re-solving. Price is not on its homepage; a review site says about $75 [C-gtoplus] [C-dc-search].
- **DeepSolver:** a browser and cloud solver that solves street by street. A review site reports $49–69/mo (secondhand, unverified) [C-dc-search].
- **Simple GTO Trainer / Simple Postflop** (Simple Poker): a desktop trainer plus solver. A review site prices Simple Postflop at about $159 (unverified) [C-dc-search].
- **Others seen in search, not evaluated:**
  - GTO LAB (MTT/ICM trainer focus) [C-dc]
  - Jesolver [C-dc]
  - MonkerSolver (multiway and PLO, about $449, unverified)
  - mobile apps: GTO Gecko, Poker Academy, Solver+ / Postflop+ style apps
  - ICMIZER and HRC (ICM tools)

  All of these come from search results only.

---

## 6. Behavior specs most useful to Lizard engineers

These are the shapes to implement independently. The names below are proposed Lizard names; GTO Wizard's own labels are only referenced.

1. **Strategy cell coloring:** stacked horizontal bars per class, each action's share of the cell width, with height scaled by range weight under "range height". "Full height" ignores weight, "normalized" rescales to the maximum, and "horizontal" draws one bar per combo [H-study] [H-rb].
2. **Metric set per class and combo:** frequency[action], EV (bb), EQ (%), EQR = EV / (EQ × pot), and range weight. Compare-EV(a, b) = EV(a) − EV(b) on a diverging color scale, with white near 0. Regret(a) = max EV − EV(a) [H-study].
3. **Breakdown math** for category c and selected action set A:
   - Range% = combos(c) / combos(all)
   - Performed% = Σ freq(A | c) weighted by combos(c)
   - Represented% = combos(c ∧ A) / combos(A)

   [H-breakdown]
4. **Equity distribution:** x is percentile rank within the player's own range, y is equity vs the opponent's range, one point per combo, plus buckets in Simple and Advanced granularity [H-ranges].
5. **Trainer grading:**
   - Best = argmax frequency (or the RNG-selected action)
   - Correct = frequency > 0
   - Inaccuracy = 0 < frequency < 3.5% with negligible EV loss
   - Wrong = frequency 0 with negligible EV loss
   - Blunder = frequency 0 with significant EV loss

   Lizard must choose and publish the "significant EV" threshold, for example as a % of pot. Also track EV loss in bb, % pot and bb/100, plus the average frequency difference [H-perf].
6. **Difficulty size-grouping:** small / medium / large / overbet buckets. GTO Wizard does not publish the cut points; Lizard should define and document them, for example ≤ 40% / ≤ 80% / ≤ 110% / > 110% pot (*a proposal, not GTO Wizard's*). Grade against the highest-frequency member of the group [H-trainer] [H-agg].
7. **Aggregate report weighting:** weight each canonical flop by its combinatorial multiplicity, so the 1,755 classes sum to 22,100. The filtered row reports the weighted average and the % of flops (by weight) matching [H-agg]. Upstream already does this (`solver/gto/static/reports.js:3`, code).
8. **Bet-tree editor semantics:**
   - units: % pot, geometric "e", ×previous
   - inheritance: IP ← OOP and turn/river ← flop
   - thresholds: force all-in above X% of the effective stack, add all-in when below Y% of pot, merge sizes within Z%
   - per-node override
   - Automatic, Dynamic(N) and Fixed modes

   [H-build]
9. **Nodelock frequency fill:** to reach a target action frequency, move the hands with the lowest EV loss first. Support "overwrite unlocked" vs "overwrite all", and expose a compare view with an EV delta [H-nl].
10. **Range text I/O:** PIO/GTO+ format with weights, per-action sub-range copy [H-ranges] [H-rb] [H-build].

---

## 7. Gaps in public information (do not guess; design independently)

- Exact presolved depth, rake and size grids per format.
- The full hand-category taxonomy.
- The GTOW Score formula and the blunder EV cutoff.
- Power Credit bundle prices.
- Whether a bubble-factor or risk-premium UI exists behind the login.
- The MTT stage list.
- Whether "Custom Profiles Go Live" (2025-11-12) is accurate.
- The full hotkey sheet: the range-builder hotkeys appear only as an image [H-rb].

---

## 8. Suggested prioritized parity list for Lizard

The status column is what upstream appears to have. "(code)" means grep-verified this session, and "(plan)" means it is claimed in `IMPLEMENTATION_PLAN.md` §1 and not verified.

### P0: credible core loop (Study → Practice → Analyze), heads-up NLHE first
| # | Feature (GTO Wizard reference) | Upstream status | Work for parity |
|---|---|---|---|
| P0-1 | Study Strategy tab: matrix, actions table, hand detail, summary table with EV/EQ/EQR/weight; metric dropdown incl. Strategy+EV, Compare EV, Best-Action regret [H-study] | Grid by strategy/EV/equity/EQR (code, `study.js:281`) | Add Compare EV, regret view, range-height modes, sortable summary table, bb/% toggle |
| P0-2 | Filters: hand class, draw tiers, suits (high/low card), action multi-select, clear [H-study] [B-filter22] | Made-hand and draw breakdowns (plan) | Unified filter chips that apply to matrix, actions and summary |
| P0-3 | Ranges tab: side-by-side, equity distribution graph, equity buckets, hand and draw comparison, PIO copy [H-ranges] | Equity distributions, nut advantage (plan) | Percentile-vs-equity plot, bucket filter, per-action copy |
| P0-4 | Breakdown tab: Range% / Performed% / Represented%, Manhattan plots [H-breakdown] | `breakdown.js` exists (code: file present) | Implement the three metrics and the plots |
| P0-5 | Node navigation: spot bar, auto-fold, J-style quick picker, breadcrumbs, deep links, saved spots [H-study] | Tree navigation and share links (plan) | Quick picker, saved spots in IndexedDB |
| P0-6 | Presolved library browser with honest coverage labels [B-ss] | 18 HU spots plus MW index (code) | Selector by format/depth/line; "not presolved → solve now" fallback |
| P0-7 | Trainer: Full Hand / Street / Spot; Standard/Grouped/Simple difficulty; Action vs Frequency input; RNG High/Low; timebank 7/15/25s; pause-after; up to 4 tables; info panel [H-trainer] | Practice engine, 2–4 tables, drills (code) | Difficulty grouping, frequency input, RNG, timebank, Only-close-decisions filter |
| P0-8 | Grading: Best / Correct / Inaccuracy / Wrong / Blunder plus EV loss (bb, % pot, bb/100), average frequency difference, score [H-perf] | 4-level verdict (code, `practice.js:417-424`) | Split "Mistake" into Wrong and Blunder with a published EV threshold; add metrics |
| P0-9 | Sessions, Stats and Practiced-hands pages with replay [H-perf] | Session history, long-run scoring (plan) | Per-format/date filters; by-pot-type panel |
| P0-10 | HU custom postflop solve: range editor (paint, weight, PIO I/O, swap), stack/pot, board, bet tree (units, inheritance, thresholds, Fixed/Automatic modes, per-node edit), save with tags [H-build] | Custom sizing, PIO ranges, size optimization (plan) | GTO Wizard-equivalent tree editor UX; solve progress and cancel; accuracy label |
| P0-11 | HH import: paste, files, folder; statuses; dedupe [H-upload] [H-hha] | 8 sites (code, `hh.js:1-24`) | Folder/bulk import in a worker; status pipeline; duplicate flag |
| P0-12 | Hands table sorted by EV loss, filters (spot/board/hole cards/date/EV loss), star, replayer, open in Study or Practice [H-hha] [B-analyzer] | Grading, EV loss, 20 largest mistakes (plan) | Table with pinnable columns, action-sequence filter, one-click jumps |

### P1: depth features that make it a full alternative
| # | Feature | Upstream status | Notes |
|---|---|---|---|
| P1-1 | Aggregate flop reports: chart and table views, texture grouping, filtered-vs-all row, action grouping, conditional highlighting [H-agg] | Texture-grouped weighted reports (code) | UI parity plus saved filters |
| P1-2 | Turn reports (all turns on a flop, hole-card filter) [H-agg] | `runouts.js` (code: file present) | Default color-coded turn grid |
| P1-3 | Range Builder: paint, pin, lock, category paint, 0–100% grade by hands/draws/buckets, size-grouping re-grade, PIO export [H-rb] | Range builder with accuracy score (code, `study.js:420-440`) | Category grading and lock/pin UX |
| P1-4 | Drills library: save, duplicate, tags, sort, export/import code, built-in drill pack [H-drills] | Drills (code) | Local storage plus share-by-URL or code |
| P1-5 | Nodelocking: Set Strategy / Set Frequency (lowest-EV-loss first) / Lock-Unlock, compare nodes with EV delta, multi-step undo [H-nl] [B-3way] | Nodelock presets (code, `exploit.py:420-424`) | Combo-level locks plus a frequency-fill algorithm |
| P1-6 | Player profiles as incentive vectors on check/bet/fold/call, excluded from EV [P-prof] | Station/nit/maniac/overfolder presets (code) | Custom profile editor; train vs profile |
| P1-7 | GTO-Reports-style frequency comparison (VPIP/PFR/RFI/3b/4b/squeeze; flop c-bet and so on) with sample-size warnings and top-10 mistakes per stat [P-gtor] [B-analyzer] | bb/100 stats, reports (plan) | Proper opportunity denominators (plan §9) |
| P1-8 | Tournament ICM: payouts, KO/PKO/mystery, ICM vs chipEV side-by-side, Bounty-Power-style bb conversion, **plus bubble factor and risk premium displays (differentiator)** [B-pficm] [B-icm24] | Malmuth-Harville, bounty models, bubble factor (code, `icm.py`) | Label clearly as model or approximation |
| P1-9 | 3-way postflop custom solve with side pots [B-3way] | HU and 3-way CFR (plan) | Honest convergence reporting |
| P1-10 | Dynamic/Automatic sizing (prune to N highest-EV sizes) [H-build] [B-dyn] | Size optimization (plan) | Expose pruning log for transparency |
| P1-11 | Study Plans and spaced-repetition review queue from mistakes [P-s5] | — | Local-only progress |
| P1-12 | Grounded AI explanation per node and decision (differentiator) [H-road] | Claude proxy (code) | Ground in solver numbers; rate limit |

### P2: optional and advanced (only with validated implementations)
| # | Feature | Notes |
|---|---|---|
| P2-1 | Multiway preflop solving (up to 9) with tree builder (antes, straddles incl. Mississippi, limps, per-position opens) [B-mwpf] [H-build] | Heavy in-browser; label approximate unless numerically solved (plan §7) |
| P2-2 | Custom aggregate reports (solve all flops locally, resumable, no credits) [B-car] | Long-running; needs cancel/resume and CPU caps |
| P2-3 | Tournament presets and HH/tournament JSON import that auto-fills payouts [B-oct26] | Payout data must be user-entered or public |
| P2-4 | Final-table ICM presolved sets [B-3way] | Only if built offline without contending with HU builds |
| P2-5 | PLO4 (rules, evaluator, ranges via categories/macros, HU solving) [B-plo] [B-ploup] | Separate track (plan §10) |
| P2-6 | Play Mode-style private games by share link, guest join [B-play] | Needs a realtime server; optional |
| P2-7 | HU arena with ratings and GTO-scored hands [B-arena] | Needs a server and anti-abuse; lowest priority |
| P2-8 | Screenshot to spot import [B-oct26] | Review-only screenshots, not live tables |
| — | **Excluded:** Table Wizard-style live client and overlays [H-tw]; Game Integrity services [H-gi] | Plan §0 ethical scope; out of mission |

---

## 9. Sources

Official GTO Wizard (H = help or product page, B = blog or patch notes):

[H-home]: https://gtowizard.com/
[H-study]: https://help.gtowizard.com/study-mode/
[H-ranges]: https://help.gtowizard.com/ranges-tab/
[H-breakdown]: https://help.gtowizard.com/breakdown-tab/
[H-agg]: https://help.gtowizard.com/aggregate-reports-guide/
[H-practice]: https://help.gtowizard.com/practice-mode-overview/
[H-trainer]: https://help.gtowizard.com/how-to-use-the-trainer/
[H-drills]: https://help.gtowizard.com/manage-training-drills/
[H-perf]: https://help.gtowizard.com/measure-performance/
[H-ideas]: https://help.gtowizard.com/training-ideas/
[H-rb]: https://help.gtowizard.com/how-to-use-the-range-builder/
[H-analyze]: https://help.gtowizard.com/analyze-mode-guide/
[H-upload]: https://help.gtowizard.com/how-to-upload-your-hand-histories/
[H-hha]: https://help.gtowizard.com/how-to-use-the-hand-history-analyzer/
[H-cs]: https://help.gtowizard.com/custom-solving-overview/
[H-csfaq]: https://help.gtowizard.com/custom-solving-faq/
[H-build]: https://help.gtowizard.com/how-to-build-custom-solutions/
[H-traincs]: https://help.gtowizard.com/how-to-train-against-custom-solutions/
[H-nl]: https://help.gtowizard.com/how-to-use-nodelocking/
[H-acc]: https://help.gtowizard.com/accuracy-and-benchmarks/
[H-road]: https://help.gtowizard.com/gto-wizard-ai-roadmap/
[H-acct]: https://help.gtowizard.com/account/
[H-sub]: https://help.gtowizard.com/subscription/
[H-install]: https://help.gtowizard.com/how-to-install-gto-wizard/
[H-plo]: https://gtowizard.com/plo/
[H-tw]: https://gtowizard.com/table-wizard
[H-gi]: https://gtowizard.com/game-integrity
[B-patch]: https://blog.gtowizard.com/tag/patch-notes/
[B-ai]: https://blog.gtowizard.com/introducing-gto-wizard-ai/
[B-dyn]: https://blog.gtowizard.com/dynamic-sizing-a-gto-breakthrough/
[B-icm24]: https://blog.gtowizard.com/revolutionizing-mtts-the-ultimate-icm-solver-upgrade/
[B-play]: https://blog.gtowizard.com/introducing-gto-wizard-play-mode/
[B-2025]: https://blog.gtowizard.com/kick-off-2025-with-new-cash-and-icm-solutions/
[B-car]: https://blog.gtowizard.com/introducing_custom_aggregated_reports/
[B-arena]: https://blog.gtowizard.com/enter_the_poker_arena_a_new_era_of_competitive_poker_has_begun/
[B-3way]: https://blog.gtowizard.com/now_live_3_way_solving_nodelocking_2_0_and_50k_icm_ft_sims/
[B-analyzer]: https://blog.gtowizard.com/redesigned_analyzer_and_upgraded_gto_reports/
[B-mwpf]: https://blog.gtowizard.com/introducing-multiway-preflop-solving/
[B-ss]: https://blog.gtowizard.com/single-size-solutions-are-live-new-pricing-50x-more-solutions/
[B-plo]: https://blog.gtowizard.com/plo-just-changed-forever/
[B-ploup]: https://blog.gtowizard.com/plo-upgrades-custom-hu-solving-postflop-icm-nodelocking-more/
[B-pficm]: https://blog.gtowizard.com/preflop-icm-solving/
[B-oct26]: https://blog.gtowizard.com/custom-solutions-upgrade-and-easier-preflop-icm-setup/
[B-filter22]: https://blog.gtowizard.com/new-solutions-filter-trainer-improvements/

Press, reviews and app listings (secondhand):

[P-hha24]: https://www.pokernews.com/news/promotions/2024/12/gto-wizard-unveils-upgraded-hand-history-analyzer-47632.htm
[P-gtor]: https://www.pokernews.com/news/2025/03/gto-wizard-game-changing-feature-48276.htm
[P-tw]: https://www.pokernews.com/news/promotions/2025/07/gto-wizard-table-management-beta-launch-table-wizard-49192.htm
[P-prof]: https://www.pokernews.com/strategy/gto-wizard-player-profiles-49903.htm
[P-price]: https://www.pokernews.com/news/2026/03/gto-wizard-subscription-plans-new-features-pricing-50908.htm
[P-llm]: https://www.pokernews.com/news/2026/04/gto-wizard-ai-outperforms-gpt-5-and-grok-4-in-new-benchmark-51020.htm
[P-s5]: https://www.pokernews.com/news/promotions/2025/11/pokerarena-season-5-goes-live-gto-wizard-49977.htm
[PF-mwicm]: https://pokerfuse.com/latest-news/2026/8/gtowizard-launches-multiway-icm-postflop-solving/
[PL-pficm]: https://www.pokerlistings.com/news/gto-wizard-introduces-preflop-icm-solving
[PS-price]: https://www.pokerskill.com/blog/gto-wizard-pricing/
[AS-arena]: https://apps.apple.com/us/app/pokerarena-play-learn-poker/id6742486598

Competitors:

[C-pio]: https://piosolver.com/products
[C-gtoplus]: https://www.gtoplus.com/
[C-dc]: https://www.deucescracked.com/blog/best-poker-solvers-2026-gto-wizard
[C-dc-search]: https://www.deucescracked.com/blog/poker-solver-comparison-data

**Source notes.**
- The [P-s5] URL slug names PokerArena Season 5 (Nov 2025), but when fetched the page showed Sept 2026 content (study plans, preflop ICM).
- [C-dc-search] prices come from search-result summaries, not a full fetch.
- The pokerskill pricing article [PS-price] is dated 2026-10-02.
- The PokerNews pricing article [P-price] is dated 2026-03-31 and was updated 2026-06-19.
