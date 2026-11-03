// The Reports page's chart view: a spot's strategy across flops at a glance, from the same rows as the table. Each
// flop shown is one column of its action mix, in the table's order (sorted by an action, it reads as how that action
// spreads over the flops); grouped, each texture group is one column of its weighted average. Hover a column for its
// numbers; click a flop to open it in Study, a group to show only its flops. The table view holds every number.
import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { PlayingCard } from "@/components/PlayingCard";
import { actionColors, bb, pct } from "@/components/actions";
import type { TextureKey } from "@/features/practice/drills";
import { flopCards } from "@/library/entry";
import type { LibraryReport } from "@/library/files";
import { facingText, groups, studyLink, type Average, type ReportRow, type ReportView } from "./reports";

const label = (n: string) => n[0]!.toUpperCase() + n.slice(1);

export function ReportChart({
  rep,
  view,
  cols,
  shown,
  group,
  order,
  set,
}: {
  rep: LibraryReport;
  view: ReportView;
  cols: string[];
  shown: readonly ReportRow[];
  group: TextureKey | null;
  /** the table's order, in words ("by Check, highest first") */
  order: string;
  set: (kv: Record<string, string | null>) => void;
}) {
  const colors = actionColors(cols);
  const stored = shown.filter((r) => r.freqs);
  const gs = group ? groups(shown, group).filter((g) => g.freqs) : [];
  const tot = shown.reduce((a, r) => a + r.w, 0);
  return (
    <section aria-label="Chart" className="space-y-3 rounded-lg border border-border bg-surface p-3">
      <ul aria-label="Actions" className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        {cols.map((c, i) => (
          <li key={c} className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: colors[i] }} />
            {label(c)}
          </li>
        ))}
      </ul>
      {gs.length > 0 && (
        <GroupColumns
          groups={gs}
          tot={tot}
          cols={cols}
          colors={colors}
          seats={rep.seats}
          onPick={(g) => set({ [group!]: g, group: null })}
        />
      )}
      {stored.length > 0 ? (
        <FlopStrip rep={rep} view={view} rows={stored} cols={cols} colors={colors} order={order} />
      ) : (
        <p className="text-sm text-muted">No flop shown stores this decision.</p>
      )}
      {stored.length < shown.length && (
        <p className="text-xs text-muted">
          {shown.length - stored.length} of the {shown.length} flops shown don&rsquo;t store this decision and are left out.
        </p>
      )}
    </section>
  );
}

/** an action mix in words, with the EVs */
function Mix({ freqs, ev, cols, colors, seats }: { freqs: readonly number[]; ev: readonly number[]; cols: string[]; colors: string[]; seats: readonly string[] }) {
  return (
    <>
      <ul className="mt-1 space-y-0.5">
        {cols.map((c, i) => (
          <li key={c} className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-sm" style={{ background: colors[i] }} />
            {label(c)} <span className="ml-auto pl-3 tabular-nums">{pct(freqs[i])}</span>
          </li>
        ))}
      </ul>
      <p className="mt-1 text-muted">
        EV {seats[0]} {bb(ev[0])} · {seats[1]} {bb(ev[1])}
      </p>
    </>
  );
}

function Tip({ at, children }: { at: number; children: ReactNode }) {
  // (kept inside the plot: anchored by its left edge on the left half, its right edge on the right half)
  const left = at < 0.5;
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute top-1 z-20 w-max max-w-[14rem] rounded-md border border-border bg-surface-2 px-2 py-1.5 text-xs text-text shadow-lg"
      style={left ? { left: `calc(${at * 100}% + 8px)` } : { right: `calc(${(1 - at) * 100}% + 8px)` }}
    >
      {children}
    </div>
  );
}

const Y_TICKS = [1, 0.5, 0] as const;

function Axis() {
  return (
    <div aria-hidden className="relative w-8 shrink-0 text-right text-[10px] text-muted">
      {Y_TICKS.map((y) => (
        <span key={y} className="absolute right-1 -translate-y-1/2" style={{ top: `${(1 - y) * 100}%` }}>
          {y * 100}%
        </span>
      ))}
    </div>
  );
}

function Grid() {
  return (
    <>
      {Y_TICKS.map((y) => (
        <div key={y} aria-hidden className="pointer-events-none absolute inset-x-0 border-t border-border" style={{ top: `${(1 - y) * 100}%` }} />
      ))}
    </>
  );
}

function GroupColumns({
  groups: gs,
  tot,
  cols,
  colors,
  seats,
  onPick,
}: {
  groups: (Average & { g: string; label: string })[];
  tot: number;
  cols: string[];
  colors: string[];
  seats: readonly string[];
  onPick: (g: string) => void;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const h = hover != null ? gs[hover] : undefined;
  return (
    <figure className="space-y-1">
      <figcaption className="text-xs text-muted">Each group&rsquo;s average, its flops weighted by how often they come up. Click one to show only its flops.</figcaption>
      <div className="flex h-36">
        <Axis />
        <div className="relative flex flex-1 items-stretch" onPointerLeave={() => setHover(null)}>
          <Grid />
          {gs.map((g, k) => (
            <button
              key={g.g}
              type="button"
              aria-label={`${g.label}: ${cols.map((c, i) => `${c} ${pct(g.freqs![i])}`).join(", ")}`}
              onClick={() => onPick(g.g)}
              onPointerEnter={() => setHover(k)}
              onFocus={() => setHover(k)}
              onBlur={() => setHover(null)}
              className="relative z-10 flex flex-1 justify-center focus-visible:outline-2 focus-visible:outline-accent"
            >
              <span className={`flex h-full w-full max-w-6 flex-col-reverse gap-[2px] overflow-hidden rounded-t-[4px] ${hover === k ? "opacity-100" : hover != null ? "opacity-60" : ""}`}>
                {g.freqs!.map((x, i) => (x > 0.001 ? <span key={i} className="block" style={{ flex: `${x} 1 0`, background: colors[i] }} /> : null))}
              </span>
            </button>
          ))}
          {h && hover != null && (
            <Tip at={(hover + 0.5) / gs.length}>
              <b>{h.label}</b>{" "}
              <span className="text-muted">
                · {pct(tot ? h.w / tot : 0)} of the flops shown{h.wf < h.w * 0.9999 ? `, the strategy from the ${pct(h.wf / h.w, 0)} that store it` : ""}
              </span>
              <Mix freqs={h.freqs!} ev={h.ev} cols={cols} colors={colors} seats={seats} />
            </Tip>
          )}
        </div>
      </div>
      <div className="flex">
        <span className="w-8 shrink-0" />
        {gs.map((g) => (
          <span key={g.g} className="min-w-0 flex-1 px-0.5 text-center text-[11px] leading-tight break-words text-muted">
            {g.label}
          </span>
        ))}
      </div>
    </figure>
  );
}

/** action `i`'s band across the flops, a step a flop (the first action along the bottom): one shape, so there are no
 * seams between columns thinner than a pixel */
export function stepArea(rows: readonly Pick<ReportRow, "freqs">[], i: number): string {
  const lo = rows.map((r) => r.freqs!.slice(0, i).reduce((a, b) => a + b, 0));
  const hi = rows.map((r, k) => lo[k]! + (r.freqs![i] ?? 0));
  const y = (v: number) => +(100 - v * 100).toFixed(3);
  let d = `M0 ${y(hi[0]!)}`;
  for (let k = 0; k < rows.length; k++) d += `H${k + 1}${k + 1 < rows.length ? `V${y(hi[k + 1]!)}` : ""}`;
  d += `V${y(lo[rows.length - 1]!)}`;
  for (let k = rows.length - 1; k >= 0; k--) d += `H${k}${k > 0 ? `V${y(lo[k - 1]!)}` : ""}`;
  return `${d}Z`;
}

function FlopStrip({
  rep,
  view,
  rows,
  cols,
  colors,
  order,
}: {
  rep: LibraryReport;
  view: ReportView;
  rows: readonly ReportRow[];
  cols: string[];
  colors: string[];
  order: string;
}) {
  const navigate = useNavigate();
  const [hover, setHover] = useState<number | null>(null);
  const n = rows.length;
  // (the column under the pointer; a click reads its own, as a tap on a touch screen comes with no move before it)
  const at = (e: { currentTarget: HTMLDivElement; clientX: number }) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (!(r.width > 0)) return null;
    return Math.min(n - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * n)));
  };
  const h = hover != null ? rows[hover] : undefined;
  const linkAt = (k: number | null) => (k != null && rows[k] ? studyLink(rep, rows[k].f, view) : null);
  const link = linkAt(hover);
  // the share of the flops shown where each action is played at all (the strip's summary for a screen reader)
  const some = cols.map((_, i) => rows.filter((r) => (r.freqs![i] ?? 0) >= 0.005).length / n);
  return (
    <figure className="space-y-1">
      <figcaption className="text-xs text-muted">
        Every flop shown, one column each, {order}. Columns aren&rsquo;t weighted: the averages are. Hover a flop for its numbers, click it to open it in
        Study.
      </figcaption>
      <div className="flex h-40">
        <Axis />
        <div
          role="img"
          aria-label={`${n} flops, ${order}: ${cols.map((c, i) => `${c} played on ${pct(some[i], 0)} of them`).join(", ")}`}
          className={`relative flex-1 ${link ? "cursor-pointer" : ""}`}
          onPointerMove={(e) => setHover(at(e))}
          onPointerLeave={() => setHover(null)}
          onClick={(e) => {
            const to = linkAt(at(e));
            if (to) void navigate(to);
          }}
        >
          <Grid />
          <svg viewBox={`0 0 ${n} 100`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden>
            {cols.map((c, i) => (
              <path key={c} d={stepArea(rows, i)} fill={colors[i]} />
            ))}
          </svg>
          {h && hover != null && (
            <>
              <div aria-hidden className="pointer-events-none absolute inset-y-0 z-10 outline-2 outline-text" style={{ left: `${(hover / n) * 100}%`, width: `max(2px, ${100 / n}%)` }} />
              <Tip at={(hover + 0.5) / n}>
                <span className="inline-flex gap-0.5">
                  {flopCards(h.f).map((c) => (
                    <PlayingCard key={c} card={c} size="sm" />
                  ))}
                </span>
                {h.bet && <span className="ml-1 text-muted">{facingText(h)}</span>}
                <Mix freqs={h.freqs!} ev={h.ev} cols={cols} colors={colors} seats={rep.seats} />
              </Tip>
            </>
          )}
        </div>
      </div>
    </figure>
  );
}
