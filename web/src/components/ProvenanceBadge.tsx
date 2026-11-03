import type { Provenance } from "@/solver/types";
import { describe } from "@/solver/provenance";

const TONE: Record<Provenance["source"], string> = {
  library: "border-accent/40 text-accent",
  "library-turn": "border-accent/40 text-accent",
  instant: "border-border text-muted",
  live: "border-act-check/50 text-act-check",
  charts: "border-act-bet1/50 text-act-bet1",
  "preflop-solve": "border-act-bet1/50 text-act-bet1",
  rules: "border-warn/60 text-warn",
  equity: "border-warn/60 text-warn",
  unknown: "border-border text-muted",
};

/** What produced the numbers on screen, and how close to equilibrium they are. Always shown with a result. */
export function ProvenanceBadge({ p }: { p: Provenance }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-xs ${TONE[p.source]}`}
      title={[
        describe(p),
        p.seconds !== undefined ? `${p.seconds.toFixed(2)} s` : "",
        p.fallbackReason ? `fallback: ${p.fallbackReason}` : "",
        p.transport === "file"
          ? `read in the page from the library file, no solver · ${p.solverVersion}`
          : `mode ${p.mode} · ${p.transport} · solver ${p.solverVersion}`,
      ]
        .filter(Boolean)
        .join("\n")}
    >
      {p.approximate && <span aria-hidden>≈</span>}
      {describe(p)}
    </span>
  );
}
