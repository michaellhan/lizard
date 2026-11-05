import { useId, useState } from "react";
import type { Provenance } from "@/solver/types";
import { describe } from "@/solver/provenance";

const TONE: Record<Provenance["source"], string> = {
  library: "border-accent/40 text-accent",
  "library-turn": "border-accent/40 text-accent",
  instant: "border-border text-muted",
  live: "border-act-check/50 text-act-check",
  charts: "border-act-bet1/50 text-act-bet1",
  "preflop-solve": "border-act-bet1/50 text-act-bet1",
  "push-fold": "border-act-bet1/50 text-act-bet1",
  "best-response": "border-warn/60 text-warn",
  "node-lock": "border-warn/60 text-warn",
  "plo-river": "border-act-check/50 text-act-check",
  rules: "border-warn/60 text-warn",
  equity: "border-warn/60 text-warn",
  unknown: "border-border text-muted",
};

/** What the badge's own words leave out: how long it took, why it fell back, and which versions and backend. */
function detailLines(p: Provenance): string[] {
  return [
    p.seconds !== undefined ? `${p.seconds.toFixed(2)} s` : "",
    p.fallbackReason ? `fallback: ${p.fallbackReason}` : "",
    p.libraryVersion ? `library version ${p.libraryVersion}` : "",
    p.source === "plo-river"
      ? p.solverVersion
      : p.transport === "file"
      ? `read in the page from the library file, no solver · ${p.solverVersion}`
      : p.transport === "kept"
        ? "kept with the grade in Analyze, which doesn't say which backend or build answered"
        : `mode ${p.mode} · ${p.transport} · solver ${p.solverVersion}`,
  ].filter(Boolean);
}

const LOOK = "inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-xs";

function Words({ p }: { p: Provenance }) {
  return (
    <>
      {p.approximate && <span aria-hidden>≈</span>}
      {describe(p)}
    </>
  );
}

/**
 * What produced the numbers on screen, and how close to equilibrium they are. Always shown with a result. It opens to its
 * detail by click, tap or keyboard. `quiet`: a plain label and no tab stop, for a badge in a long list or one in the way of
 * a page's keyboard; a ProvenanceDetail in the same panel then holds its detail.
 */
export function ProvenanceBadge({ p, quiet = false }: { p: Provenance; quiet?: boolean }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const title = [describe(p), ...detailLines(p)].join("\n");
  if (quiet) {
    return (
      <span className={`${LOOK} ${TONE[p.source]}`} title={title}>
        <Words p={p} />
      </span>
    );
  }
  // (spans all through: a badge sits inside a sentence in places)
  return (
    <span className="inline-flex max-w-full flex-col items-start gap-1 align-middle">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        title={title}
        onClick={() => setOpen(!open)}
        className={`provenance-toggle ${LOOK} text-left ${TONE[p.source]}`}
      >
        <Words p={p} />
      </button>
      {open && (
        <span id={id} className="block w-72 max-w-full rounded border border-border bg-surface-2 px-2 py-1 text-xs text-muted">
          {detailLines(p).map((l) => (
            <span key={l} className="block">
              {l}
            </span>
          ))}
        </span>
      )}
    </span>
  );
}

/** One disclosure for a panel's quiet badges: each different answer's detail, once. */
export function ProvenanceDetail({ ps, label = "How this was produced" }: { ps: readonly Provenance[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const rows = new Map(ps.map((p) => [[describe(p), ...detailLines(p)].join(" · "), p]));
  if (!rows.size) return null;
  return (
    <div className="text-xs text-muted">
      <button type="button" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(!open)} className="provenance-toggle inline-flex items-center gap-1.5 rounded px-1 py-0.5 hover:text-text">
        {label}
      </button>
      {open && (
        <div id={id} className="mt-1 space-y-1">
          {[...rows].map(([key, p]) => (
            <p key={key}>
              <span className="text-text">{describe(p)}</span>
              {detailLines(p).map((l) => (
                <span key={l} className="block">
                  {l}
                </span>
              ))}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
