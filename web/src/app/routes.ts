// The route table. scripts/postbuild.mjs reads the paths below (by pattern) to write an index.html copy per route,
// so deep links load on GitHub Pages (which has no rewrites); 404.html covers the rest.

export type RouteStatus = "working" | "partial" | "classic" | "planned";

export interface RouteDef {
  path: string;
  label: string;
  /** shown in the primary nav (the four main pages) */
  nav: boolean;
  /** shown under the nav's More menu and in the home page's list of other tools */
  more?: boolean;
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
  Satellites: "APPROXIMATE",
  "KO / PKO": "PARTIAL",
  "Mystery bounty": "PARTIAL",
  "Payout structures": "WORKING",
  "Bubble factors": "WORKING",
  PLO4: "PARTIAL",
  "Saved solutions": "WORKING",
  "Study plans": "WORKING",
  "Preferences / progress": "WORKING",
  "Solution comparisons": "WORKING",
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
  { path: "practice", label: "Practice", nav: true, status: "partial", summary: "Play hands against GTO opponents or drill one flop decision, each decision graded against the solution.", rows: ["Preflop trainer", "Postflop trainer", "Full-hand play", "Drills", "Custom drills", "Exploit practice", "Multitabling", "EV-loss scoring", "Session stats", "Coaching / feedback"] },
  { path: "analyze", label: "Analyze", nav: true, status: "partial", summary: "Import your hand histories, keep them in this browser, replay each hand and open your decisions in Study.", rows: ["Hand-history import", "Bulk upload", "Decision grading", "Leak finding", "Frequency comparison vs GTO", "Results", "Reports", "Saved hands"] },
  { path: "solve", label: "Solve", nav: true, status: "partial", summary: "A spot of your own: each seat's stack, bet sizes, rake, ante or straddle, and ranges, opened in Study.", rows: ["Preflop solves", "Postflop solves", "Heads-up", "Multiway", "Custom ranges", "Stacks & bet sizes", "Node locking", "Rake", "Automatic sizing", "Convergence display"] },
  { path: "reports", label: "Reports", nav: false, more: true, status: "partial", summary: "A library spot's flop strategy across its stored flops, by texture, with EV, equity and EQR.", rows: ["Aggregate reports"] },
  { path: "ranges", label: "Ranges", nav: false, more: true, status: "partial", summary: "Range matrix viewer and builder.", rows: ["Range matrices", "Custom ranges"] },
  { path: "tournaments", label: "Tournaments", nav: false, more: true, status: "partial", summary: "A tournament spot, or a stage from the bubble to heads-up: the prizes left, each seat's stack, other tables and bounties, answered in prize equity in Study.", rows: ["ICM", "MTT / final table", "Satellites", "KO / PKO", "Mystery bounty", "Payout structures", "Bubble factors"] },
  { path: "compare", label: "Compare", nav: false, status: "partial", summary: "Two spots side by side (a tournament in chip EV, with and without rake, two stacks): the actions, the range and each hand class's change, each side with its own source.", rows: ["Solution comparisons"] },
  { path: "equity", label: "PLO equity", nav: false, status: "partial", summary: "PLO4 hand and range equity, exact or Monte Carlo, each number labelled as such: a calculator, not a solver.", rows: ["PLO4"] },
  { path: "plo", label: "PLO flop, turn and river", nav: false, more: true, status: "partial", summary: "One heads-up PLO4 river, a turn and every river after it, or a flop and every turn and river after it, solved exactly at the sizes you list, from ranges you type. Preflop isn't solved, and there's no rake.", rows: ["PLO4"] },
  { path: "library", label: "Library", nav: false, more: true, status: "working", summary: "Which spots are precomputed, and how much of each is built." },
  { path: "history", label: "History", nav: false, more: true, status: "partial", summary: "Every session kept in this browser by day (full hands, drills, leak drills, range builds), lifetime totals, full hands by pot type, decisions by street, and the trend across sessions.", rows: ["Session stats", "Preferences / progress"] },
  { path: "plan", label: "Plan", nav: false, more: true, status: "partial", summary: "What to do next, in order, from what you've kept (reviews due, leaks, a Practice drill, by a plain rule stated on the page), and 12 lessons, each a report to read and a drill.", rows: ["Study plans"] },
  { path: "review", label: "Review", nav: false, more: true, status: "partial", summary: "Your mistakes kept across sessions, what's due to retry on a spaced schedule, each graded again under the current answer's provenance.", rows: ["Study plans"] },
  { path: "saved", label: "Saved", nav: false, more: true, status: "partial", summary: "Spots saved from Study and ranges saved from Ranges, with backup and restore.", rows: ["Saved solutions", "Saved hands"] },
  { path: "engine", label: "Engine", nav: false, status: "working", summary: "Solver runtime status, threads, versions and diagnostics." },
  { path: "settings", label: "Settings", nav: false, status: "working", summary: "Solver mode, backend, library source and display." },
];

/** The More menu and the home page's other tools, in this order: your own progress first, then the other tools. */
export const MORE: { path: string; label: string; blurb: string }[] = [
  { path: "review", label: "Review", blurb: "Retry the mistakes you've kept, on a spaced schedule." },
  { path: "plan", label: "Plan", blurb: "What to work on next, and 12 short lessons." },
  { path: "history", label: "History", blurb: "Every session you've played, and your trend." },
  { path: "saved", label: "Saved", blurb: "Spots and ranges you've saved; backup and restore." },
  { path: "reports", label: "Reports", blurb: "A spot's flop strategy across every stored flop." },
  { path: "ranges", label: "Ranges", blurb: "View and build ranges." },
  { path: "tournaments", label: "Tournaments", blurb: "Tournament spots in prize equity (ICM, bounties)." },
  { path: "plo", label: "PLO", blurb: "Heads-up Omaha flop, turn and river solves." },
  { path: "equity", label: "PLO equity", blurb: "Omaha hand and range equity." },
  { path: "library", label: "Library", blurb: "Which spots are precomputed." },
];

export const ROUTE_PATHS = ROUTES.map((r) => r.path).filter(Boolean);

/** The tab's title at a pathname (basename already off): the route's label and the app's name, the app's alone at home. */
export function routeTitle(pathname: string): string {
  const path = pathname.split("/").filter(Boolean)[0] ?? "";
  if (!path) return "Lizard";
  return `${ROUTES.find((r) => r.path === path)?.label ?? "Not found"} · Lizard`;
}
