// Areas whose engine works (in the imported solver) but whose Lizard UI is not built yet. They say so plainly and
// link to the upstream app where the feature runs today — nothing here pretends to be a Lizard implementation.
import { CLASSIC_URL } from "@/config";

type Feature = "analyze" | "solve" | "tournaments";

const INFO: Record<Feature, { title: string; engine: string[]; classicPath: string; next: string }> = {
  analyze: {
    title: "Analyze",
    engine: [
      "Hand-history import from major sites (solver/gto/static/hh.js parsers)",
      "Session analysis: each decision graded against the solver, leaks by category",
      "Saved hands (IndexedDB) in the classic UI",
    ],
    classicPath: "session/",
    next: "Bulk upload with a background queue, per-decision EV loss, saved-hand library.",
  },
  solve: {
    title: "Custom solve",
    engine: [
      "Postflop heads-up and 3/4-way solves (DCFR, compiled wasm core), Quick/Fast/Accurate",
      "Custom ranges (PIO format), stacks, bet sizes, rake, nodelocking, exploit profiles",
      "Preflop game solve (pf_game) for standard formats",
    ],
    classicPath: "",
    next: "Tree builder UI, range editor, nodelock panel and convergence chart over the SolverClient.",
  },
  tournaments: {
    title: "Tournaments",
    engine: [
      "ICM (prize equity) in advice and postflop solves, payouts, bounties/PKO",
      "Push/fold charts and short-stack formats (20/40/60bb, antes)",
    ],
    classicPath: "",
    next: "Payout-structure editor, bubble factors, final-table presets.",
  },
};

export function ClassicFeaturePage({ feature }: { feature: Feature }) {
  const f = INFO[feature];
  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="text-2xl font-semibold">{f.title}</h1>
      <div className="rounded-lg border border-border bg-surface p-4">
        <p className="text-sm">
          <strong>Status:</strong> the engine for this area is imported and tested, but Lizard's interface for it is not built yet.
          It runs today in the classic GTO Solver app.
        </p>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-muted">
          {f.engine.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
        <p className="mt-3 text-sm text-muted">
          <strong className="text-text">Next in Lizard:</strong> {f.next}
        </p>
        <a href={`${CLASSIC_URL}${f.classicPath}`} className="mt-4 inline-block rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface-2">
          Open in classic GTO Solver ↗
        </a>
      </div>
    </div>
  );
}
