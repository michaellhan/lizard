// The longer explanation of a panel (what its numbers stand on, what's left out and why), folded under one line so the
// panel opens on what it does. Folded, not removed: every number keeps its provenance a click away (provenance.ts).
import type { ReactNode } from "react";

export function About({ children, label = "How this works" }: { children: ReactNode; label?: string }) {
  return (
    <details className="group text-xs text-muted">
      <summary className="w-fit cursor-pointer select-none rounded hover:text-text focus-visible:outline-2 focus-visible:outline-accent">{label}</summary>
      <div className="mt-1 max-w-prose space-y-1 leading-relaxed">{children}</div>
    </details>
  );
}
