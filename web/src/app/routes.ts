// The route table. scripts/postbuild.mjs reads the paths below (by pattern) to write an index.html copy per route,
// so deep links load on GitHub Pages (which has no rewrites); 404.html covers the rest.

export type RouteStatus = "working" | "partial" | "classic" | "planned";

export interface RouteDef {
  path: string;
  label: string;
  /** in the bar (NAV says the order and the bar's own label) */
  nav: boolean;
  /** a page with `rows` takes its status from them (`routeGrade`); this is the status of one with none */
  status: RouteStatus;
  summary: string;
  /** the docs/FEATURE_MATRIX.md rows this page delivers, by name: its badge is theirs (routes.test.ts checks the grades) */
  rows?: string[];
}

export type Grade = "WORKING" | "PARTIAL" | "APPROXIMATE" | "NOT IMPLEMENTED";

/** The Lizard grade of each row a page names, as docs/FEATURE_MATRIX.md has it. routes.test.ts reads the matrix and
 * fails where one differs, so a regrade there has to be made here too. */
export const GRADES: Record<string, Grade> = {
  "Solution browser": "WORKING",
  Preflop: "APPROXIMATE",
  Postflop: "WORKING",
  "Range matrices": "WORKING",
  "Combo view": "WORKING",
  "Frequencies & EV": "WORKING",
  "Equity & EQR": "WORKING",
  "Range comparison": "WORKING",
  Filters: "WORKING",
  "Node navigation": "WORKING",
  "Aggregate reports": "WORKING",
  "Preflop trainer": "APPROXIMATE",
  "Postflop trainer": "WORKING",
  "Full-hand play": "WORKING",
  Drills: "WORKING",
  "Custom drills": "WORKING",
  "Exploit practice": "WORKING",
  "Range-builder trainer": "WORKING",
  "Combo-counting trainer": "WORKING",
  Multitabling: "WORKING",
  "EV-loss scoring": "PARTIAL",
  "Session stats": "WORKING",
  "Coaching / feedback": "WORKING",
  "Hand-history import": "WORKING",
  "Bulk upload": "WORKING",
  "Decision grading": "PARTIAL",
  "Leak finding": "PARTIAL",
  "Frequency comparison vs GTO": "WORKING",
  Results: "WORKING",
  Reports: "PARTIAL",
  "Saved hands": "WORKING",
  "Screenshot import": "PARTIAL",
  "Preflop solves": "APPROXIMATE",
  "Postflop solves": "WORKING",
  "Heads-up": "WORKING",
  Multiway: "WORKING",
  "Custom ranges": "WORKING",
  "Stacks & bet sizes": "WORKING",
  "Node locking": "WORKING",
  Rake: "WORKING",
  "Automatic sizing": "WORKING",
  "Convergence display": "WORKING",
  ICM: "PARTIAL",
  "MTT / final table": "WORKING",
  Satellites: "PARTIAL",
  "KO / PKO": "PARTIAL",
  "Mystery bounty": "PARTIAL",
  "Payout structures": "WORKING",
  "Bubble factors": "WORKING",
  PLO4: "PARTIAL",
  "Saved solutions": "WORKING",
  "Study plans": "WORKING",
  "Preferences / progress": "WORKING",
  "Solution comparisons": "WORKING",
  "Multiplayer / HU arena": "PARTIAL",
};

/** A page's badge: working only where every row it names is WORKING, else how many are, and the others by grade. */
export function routeGrade(r: RouteDef): { status: RouteStatus; working: number; total: number; others: [string, Grade][] } {
  if (!r.rows?.length) return { status: r.status, working: 0, total: 0, others: [] };
  const graded = r.rows.map((n) => [n, GRADES[n] ?? "NOT IMPLEMENTED"] as [string, Grade]);
  const others = graded.filter(([, g]) => g !== "WORKING");
  return { status: others.length ? "partial" : "working", working: graded.length - others.length, total: graded.length, others };
}

export const ROUTES: RouteDef[] = [
  { path: "", label: "Home", nav: false, status: "working", summary: "Overview" },
  { path: "study", label: "Study", nav: true, status: "partial", summary: "Browse solutions node by node: preflop charts, precomputed flops, live turns and rivers.", rows: ["Solution browser", "Preflop", "Postflop", "Range matrices", "Combo view", "Frequencies & EV", "Equity & EQR", "Range comparison", "Filters", "Node navigation", "Range-builder trainer"] },
  { path: "practice", label: "Practice", nav: true, status: "partial", summary: "Play hands against GTO opponents or drill one flop decision, each decision graded against the solution; or count combos on a flop, by exact count.", rows: ["Preflop trainer", "Postflop trainer", "Full-hand play", "Drills", "Custom drills", "Exploit practice", "Multitabling", "EV-loss scoring", "Session stats", "Coaching / feedback", "Combo-counting trainer"] },
  { path: "analyze", label: "Analyze", nav: true, status: "partial", summary: "Import your hand histories, keep them in this browser, replay each hand and open your decisions in Study.", rows: ["Hand-history import", "Bulk upload", "Decision grading", "Leak finding", "Frequency comparison vs GTO", "Results", "Reports", "Saved hands", "Screenshot import"] },
  { path: "solve", label: "Solve", nav: true, status: "partial", summary: "A spot of your own: each seat's stack, bet sizes, rake, ante or straddle, and ranges, opened in Study.", rows: ["Preflop solves", "Postflop solves", "Heads-up", "Multiway", "Custom ranges", "Stacks & bet sizes", "Node locking", "Rake", "Automatic sizing", "Convergence display"] },
  { path: "reports", label: "Reports", nav: true, status: "partial", summary: "A library spot's flop strategy across its stored flops, by texture, with EV, equity and EQR.", rows: ["Aggregate reports"] },
  { path: "ranges", label: "Ranges", nav: true, status: "partial", summary: "Range matrix viewer and builder.", rows: ["Range matrices", "Custom ranges"] },
  { path: "tournaments", label: "Solve a tournament spot", nav: false, status: "partial", summary: "A tournament spot, or a stage from the bubble to heads-up: the prizes left, each seat's stack, other tables and bounties, answered in prize equity in Study.", rows: ["ICM", "MTT / final table", "Satellites", "KO / PKO", "Mystery bounty", "Payout structures", "Bubble factors"] },
  { path: "compare", label: "Compare", nav: false, status: "partial", summary: "Two spots side by side (a tournament in chip EV, with and without rake, two stacks): the actions, the range and each hand class's change, each side with its own source.", rows: ["Solution comparisons"] },
  { path: "equity", label: "PLO equity", nav: false, status: "partial", summary: "PLO4 hand and range equity, exact or Monte Carlo, each number labelled as such: a calculator, not a solver.", rows: ["PLO4"] },
  { path: "plo", label: "PLO flop, turn and river", nav: true, status: "partial", summary: "One heads-up PLO4 river, a turn and every river after it, or a flop and every turn and river after it, solved at the sizes you list, from ranges you type: exactly, or a wider flop or turn on a labelled sample of the next cards. Rake if you set it. Preflop isn't solved.", rows: ["PLO4"] },
  { path: "arena", label: "Play a friend", nav: false, status: "partial", summary: "A private heads-up table by link, for play money.", rows: ["Multiplayer / HU arena"] },
  { path: "library", label: "Library", nav: false, status: "working", summary: "Which spots are precomputed, and how much of each is built." },
  { path: "history", label: "History", nav: false, status: "partial", summary: "Every session kept in this browser by day (full hands, drills, leak drills, range builds), lifetime totals, full hands by pot type, decisions by street, and the trend across sessions.", rows: ["Session stats", "Preferences / progress"] },
  { path: "plan", label: "Review", nav: false, status: "partial", summary: "The old address of the plan, now on Progress: it goes there.", rows: ["Study plans"] },
  { path: "progress", label: "Review", nav: true, status: "partial", summary: "What to work on: your mistakes kept across sessions, due to retry on a spaced schedule and graded again under the current answer's provenance; leaks and a Practice drill from what you've kept, by a plain rule; and 12 lessons, each a report to read and a drill.", rows: ["Study plans"] },
  { path: "review", label: "Review", nav: false, status: "partial", summary: "The old address of Review, now Progress: it goes there.", rows: ["Study plans"] },
  { path: "saved", label: "Saved", nav: false, status: "partial", summary: "Spots saved from Study and ranges saved from Ranges, with backup and restore.", rows: ["Saved solutions", "Saved hands"] },
  { path: "engine", label: "Engine", nav: false, status: "working", summary: "Solver runtime status, threads, versions and diagnostics." },
  { path: "settings", label: "Settings", nav: false, status: "working", summary: "Solver mode, backend, library source and display." },
];

/** Pages that belong together, each kept at its own address and joined by a row of tabs over the page (Shell's
 * SectionTabs). The first tab is where the bar's entry for the section opens. */
export interface Section {
  /** names the tab row for a screen reader ("Progress pages") */
  label: string;
  tabs: { path: string; label: string }[];
}
export const SECTIONS: Section[] = [
  {
    label: "Progress",
    tabs: [
      { path: "progress", label: "Review" },
      { path: "history", label: "History" },
      { path: "saved", label: "Saved" },
    ],
  },
  {
    label: "PLO",
    tabs: [
      { path: "plo", label: "Solve" },
      { path: "equity", label: "Equity" },
    ],
  },
  {
    label: "Settings",
    tabs: [
      { path: "settings", label: "Settings" },
      { path: "engine", label: "Engine" },
      { path: "library", label: "Library" },
    ],
  },
];

/** The section a page is in, or none. */
export const sectionOf = (path: string): Section | undefined => SECTIONS.find((s) => s.tabs.some((t) => t.path === path));

/** The bar, in this order: the four you play and study in, then your own progress, then the other tools. An entry is
 * marked while you're on any page of its section (Progress on History and Saved too). (Tournaments is Solve's
 * Tournament switch; /review and /plan go to Progress.) */
export const NAV: { path: string; label: string; blurb: string }[] = [
  { path: "study", label: "Study", blurb: "Browse solutions node by node." },
  { path: "practice", label: "Practice", blurb: "Play hands and drills, each decision graded." },
  { path: "analyze", label: "Analyze", blurb: "Import your hand histories and grade your decisions." },
  { path: "solve", label: "Solve", blurb: "A cash or tournament spot of your own, opened in Study." },
  { path: "progress", label: "Progress", blurb: "Mistakes to retry and lessons, every session you've played, and what you've saved." },
  { path: "reports", label: "Reports", blurb: "A spot's flop strategy across every stored flop." },
  { path: "ranges", label: "Ranges", blurb: "View and build ranges." },
  { path: "plo", label: "PLO", blurb: "Heads-up Omaha flop, turn and river solves, and Omaha equity." },
];

/** The pages a bar entry stands for: its section's, or itself alone. */
export const pathsOf = (path: string): string[] => sectionOf(path)?.tabs.map((t) => t.path) ?? [path];

export const ROUTE_PATHS = ROUTES.map((r) => r.path).filter(Boolean);

/** The tab's title at a pathname (basename already off): the route's label and the app's name, the app's alone at home. */
export function routeTitle(pathname: string): string {
  const path = pathname.split("/").filter(Boolean)[0] ?? "";
  if (!path) return "Lizard";
  return `${ROUTES.find((r) => r.path === path)?.label ?? "Not found"} · Lizard`;
}
