// The route table. scripts/postbuild.mjs reads the paths below (by pattern) to write an index.html copy per route,
// so deep links load on GitHub Pages (which has no rewrites); 404.html covers the rest.

export type RouteStatus = "working" | "partial" | "classic" | "planned";

export interface RouteDef {
  path: string;
  label: string;
  /** shown in the primary nav */
  nav: boolean;
  status: RouteStatus;
  summary: string;
}

export const ROUTES: RouteDef[] = [
  { path: "", label: "Home", nav: false, status: "working", summary: "Overview" },
  { path: "study", label: "Study", nav: true, status: "partial", summary: "Browse solutions node by node: preflop charts, precomputed flops, live turns and rivers." },
  { path: "practice", label: "Practice", nav: true, status: "partial", summary: "Play hands against GTO opponents or drill one flop decision, each decision graded against the solution." },
  { path: "analyze", label: "Analyze", nav: true, status: "partial", summary: "Import your hand histories, keep them in this browser, replay each hand and open your decisions in Study." },
  { path: "solve", label: "Solve", nav: true, status: "partial", summary: "A spot of your own: each seat's stack, bet sizes, rake, ante or straddle, and ranges, opened in Study." },
  { path: "reports", label: "Reports", nav: true, status: "partial", summary: "A library spot's flop strategy across its stored flops, by texture, with EV, equity and EQR." },
  { path: "ranges", label: "Ranges", nav: true, status: "partial", summary: "Range matrix viewer and builder." },
  { path: "tournaments", label: "Tournaments", nav: true, status: "partial", summary: "A tournament spot: the prizes left, each seat's stack, other tables and bounties, answered in prize equity in Study." },
  { path: "compare", label: "Compare", nav: false, status: "partial", summary: "Two spots side by side (a tournament in chip EV, with and without rake, two stacks): the actions, the range and each hand class's change, each side with its own source." },
  { path: "library", label: "Library", nav: true, status: "working", summary: "Which spots are precomputed, and how much of each is built." },
  { path: "history", label: "History", nav: true, status: "partial", summary: "Every session kept in this browser by day (full hands, drills, leak drills, range builds), lifetime totals, and full hands by pot type." },
  { path: "saved", label: "Saved", nav: true, status: "partial", summary: "Spots saved from Study and ranges saved from Ranges, with backup and restore." },
  { path: "engine", label: "Engine", nav: false, status: "working", summary: "Solver runtime status, threads, versions and diagnostics." },
  { path: "settings", label: "Settings", nav: false, status: "working", summary: "Solver mode, backend, library source and display." },
];

export const ROUTE_PATHS = ROUTES.map((r) => r.path).filter(Boolean);
