// The last few sessions of the drill on screen, under it: when, how many decisions, how many right and the EV given up.
// A stored drill's sessions and a live drill's are told apart by what each keeps (see DrillsPanel and LiveDrill).
import { Link } from "react-router";
import { bb, pct } from "@/components/actions";
import type { SessionRecord } from "@/data/db";

export function PastDrills({ past, current, history, historyLabel }: { past: SessionRecord[]; current: string; history: string; historyLabel: string }) {
  const shown = past.filter((p) => p.id !== current);
  if (!shown.length) return null;
  return (
    <section aria-label="Past drills" className="space-y-1 panel p-3 text-sm">
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 className="font-medium">Earlier sessions of this drill</h2>
        <Link to={history} className="text-xs underline">
          {historyLabel}
        </Link>
      </div>
      <ul className="space-y-0.5">
        {shown.map((p) => (
          <li key={p.id} className="text-muted">
            {new Date(p.startedAt).toLocaleString()} · {p.decisions} decisions
            {p.decisions ? ` · ${pct((Number(p.meta.ok) || 0) / p.decisions, 0)} correct` : ""}
            {p.decisions && Number(p.meta.graded) ? ` · ${bb(p.evLossBb / p.decisions)}bb lost per decision` : ""}
          </li>
        ))}
      </ul>
    </section>
  );
}
