// The route table. scripts/postbuild.mjs reads the paths below (by pattern) to write an index.html copy per route,
// so deep links load on GitHub Pages (which has no rewrites); 404.html covers the rest.

export type RouteStatus = "working" | "partial" | "classic" | "planned";

export interface RouteDef {
  path: string;
  label: string;
  /** shown in the primary nav */
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
  Multiway: "PARTIAL",
  "Custom ranges": "WORKING",
  "Stacks & bet sizes": "WORKING",
  "Node locking": "PARTIAL",
  Rake: "WORKING",
  "Automatic sizing": "WORKING",
  "Convergence display": "WORKING",
  ICM: "PARTIAL",
  "MTT / final table": "WORKING",
  Satellites: "APPROXIMATE",
  "KO / PKO": "PARTIAL",
  "Mystery bounty": "APPROXIMATE",
  "Payout structures": "WORKING",
  "Bubble factors": "WORKING",
  PLO4: "PARTIAL",
  "Saved solutions": "WORKING",
  "Study plans": "PARTIAL",
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
  { path: "reports", label: "Reports", nav: true, status: "partial", summary: "A library spot's flop strategy across its stored flops, by texture, with EV, equity and EQR.", rows: ["Aggregate reports"] },
  { path: "ranges", label: "Ranges", nav: true, status: "partial", summary: "Range matrix viewer and builder.", rows: ["Range matrices", "Custom ranges"] },
  { path: "tournaments", label: "Tournaments", nav: true, status: "partial", summary: "A tournament spot, or a stage from the bubble to heads-up: the prizes left, each seat's stack, other tables and bounties, answered in prize equity in Study.", rows: ["ICM", "MTT / final table", "Satellites", "KO / PKO", "Mystery bounty", "Payout structures", "Bubble factors"] },
  { path: "compare", label: "Compare", nav: false, status: "partial", summary: "Two spots side by side (a tournament in chip EV, with and without rake, two stacks): the actions, the range and each hand class's change, each side with its own source.", rows: ["Solution comparisons"] },
  { path: "equity", label: "PLO equity", nav: false, status: "partial", summary: "PLO4 hand and range equity, exact or Monte Carlo, each number labelled as such: a calculator, not a solver.", rows: ["PLO4"] },
  { path: "plo", label: "PLO river", nav: false, status: "partial", summary: "One heads-up PLO4 river solved exactly at the sizes you list, from ranges you type. No earlier street is solved, and there's no rake.", rows: ["PLO4"] },
  { path: "library", label: "Library", nav: true, status: "working", summary: "Which spots are precomputed, and how much of each is built." },
  { path: "history", label: "History", nav: true, status: "partial", summary: "Every session kept in this browser by day (full hands, drills, leak drills, range builds), lifetime totals, full hands by pot type, decisions by street, and the trend across sessions.", rows: ["Session stats", "Preferences / progress"] },
  { path: "plan", label: "Plan", nav: true, status: "partial", summary: "What to do next, in order, from what you've kept: reviews due, leaks that can be read, spots with too few hands to read, and a Practice drill, by a plain rule stated on the page.", rows: ["Study plans"] },
  { path: "review", label: "Review", nav: true, status: "partial", summary: "Your mistakes kept across sessions, what's due to retry on a spaced schedule, each graded again under the current answer's provenance.", rows: ["Study plans"] },
  { path: "saved", label: "Saved", nav: true, status: "partial", summary: "Spots saved from Study and ranges saved from Ranges, with backup and restore.", rows: ["Saved solutions", "Saved hands"] },
  { path: "engine", label: "Engine", nav: false, status: "working", summary: "Solver runtime status, threads, versions and diagnostics." },
  { path: "settings", label: "Settings", nav: false, status: "working", summary: "Solver mode, backend, library source and display." },
];

export const ROUTE_PATHS = ROUTES.map((r) => r.path).filter(Boolean);

/** The tab's title at a pathname (basename already off): the route's label and the app's name, the app's alone at home. */
export function routeTitle(pathname: string): string {
  const path = pathname.split("/").filter(Boolean)[0] ?? "";
  if (!path) return "Lizard";
  return `${ROUTES.find((r) => r.path === path)?.label ?? "Not found"} · Lizard`;
}
