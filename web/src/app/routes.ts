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
  { path: "practice", label: "Practice", nav: true, status: "classic", summary: "Play hands against GTO opponents and drill single spots, graded against the solution." },
  { path: "analyze", label: "Analyze", nav: true, status: "classic", summary: "Import hand histories, grade decisions and find leaks." },
  { path: "solve", label: "Solve", nav: true, status: "classic", summary: "Custom solves: ranges, stacks, sizes, rake, nodelocks." },
  { path: "reports", label: "Reports", nav: true, status: "classic", summary: "Aggregate flop reports across boards." },
  { path: "ranges", label: "Ranges", nav: true, status: "partial", summary: "Range matrix viewer and builder." },
  { path: "tournaments", label: "Tournaments", nav: true, status: "classic", summary: "ICM, bounties and push/fold." },
  { path: "library", label: "Library", nav: true, status: "working", summary: "Which spots are precomputed, and how much of each is built." },
  { path: "engine", label: "Engine", nav: false, status: "working", summary: "Solver runtime status, threads, versions and diagnostics." },
  { path: "settings", label: "Settings", nav: false, status: "working", summary: "Solver mode, backend, library source and display." },
];

export const ROUTE_PATHS = ROUTES.map((r) => r.path).filter(Boolean);
