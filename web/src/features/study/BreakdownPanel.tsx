// Study's breakdown of a postflop node (classic breakdown.js, gto/breakdown.py): each range by made hands and draws,
// with the share, mix, equity and EV of every category, and each range's equity distribution, averages and share at
// the nut threshold. Asked only when opened, on the node's own state, with its own provenance. A category picked can
// show just those hands in the grid.
import { useEffect, useMemo, useState } from "react";
import { ProvenanceBadge } from "@/components/ProvenanceBadge";
import { actionColors, evIn, evUnitLabel, pct, type EvUnit } from "@/components/actions";
import type { Breakdown, BreakdownRow, BreakdownSide } from "@/solver/protocol";
import type { SolverClient } from "@/solver/client";
import { SolverError, type Provenance, type SolveMode } from "@/solver/types";
import { useSettings } from "@/state/settings";
import { curveAt, curvesOf, nutAdvantage, rangeAdvantage, runoutText, sidesOf, takingAction } from "./breakdown";
import { studyRequest, type StudyHand } from "./studyState";

type Run = { kind: "asking" } | { kind: "none"; message: string } | { kind: "done"; bd: Breakdown; provenance: Provenance };

// the sides' lines, in this order (checked with the dataviz validator against the surface, in a fixed order by seat
// listed: the player to act first)
const SERIES = ["#3fa52b", "#4a90e2", "#bd8212"];

export function BreakdownPanel({
  hand,
  mode,
  open,
  onOpen,
  evUnit,
  getSolver,
  onFilter,
}: {
  hand: StudyHand;
  mode: SolveMode;
  /** kept by the page, so the panel stays open from node to node */
  open: boolean;
  onOpen: (open: boolean) => void;
  evUnit: EvUnit;
  getSolver: () => Promise<SolverClient>;
  /** show one category's hands in the grid, by its filter key ("m:<id>" or "d:<id>") */
  onFilter: (key: string) => void;
}) {
  const [run, setRun] = useState<Run>({ kind: "asking" });
  useEffect(() => {
    if (!open) return;
    const ac = new AbortController();
    void (async () => {
      try {
        const client = await getSolver();
        const r = await client.solve({ state: { ...studyRequest(hand), breakdown: true }, mode, signal: ac.signal });
        const bd = r.data.breakdown;
        if (ac.signal.aborted) return;
        setRun(bd ? { kind: "done", bd, provenance: r.provenance } : { kind: "none", message: "No breakdown here: this spot was answered by the betting rules, with no solve to break down." });
      } catch (e) {
        if (ac.signal.aborted) return;
        setRun({ kind: "none", message: e instanceof SolverError && e.kind === "cancelled" ? "Stopped." : e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => ac.abort();
  }, [open, hand, mode, getSolver]);

  return (
    <details open={open} onToggle={(e) => onOpen(e.currentTarget.open)} className="w-full rounded-lg border border-border bg-surface p-3 text-sm">
      <summary className="cursor-pointer font-medium">Breakdown and equity</summary>
      {open && (
        <div className="mt-2">
          {run.kind === "asking" && (
            <p role="status" className="text-muted">
              Breaking down the ranges…
            </p>
          )}
          {run.kind === "none" && <p className="text-muted">{run.message}</p>}
          {run.kind === "done" && <Shown bd={run.bd} provenance={run.provenance} evUnit={evUnit} onFilter={onFilter} />}
        </div>
      )}
    </details>
  );
}

function Shown({ bd, provenance, evUnit, onFilter }: { bd: Breakdown; provenance: Provenance; evUnit: EvUnit; onFilter: (key: string) => void }) {
  const curves = curvesOf(bd);
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
      <Categories bd={bd} provenance={provenance} evUnit={evUnit} onFilter={onFilter} />
      {curves.length > 1 ? (
        <Equity bd={bd} sides={curves} />
      ) : (
        <p className="text-xs text-muted">No equity distribution here: this answer has no equities for the ranges.</p>
      )}
    </div>
  );
}

function Categories({ bd, provenance, evUnit, onFilter }: { bd: Breakdown; provenance: Provenance; evUnit: EvUnit; onFilter: (key: string) => void }) {
  const sides = sidesOf(bd);
  const [who, setWho] = useState(0);
  const part = useSettings((s) => s.breakdownPart);
  const saveSettings = useSettings((s) => s.set);
  const [sel, setSel] = useState<string | null>(null);
  // one action picked: what it's made of, by category
  const [act, setAct] = useState<number | null>(null);
  const side = sides[Math.min(who, sides.length - 1)]!;
  const hero = side === bd.hero;
  const shownPart = part === "draws" && bd.hero.draws.length ? "draws" : "made";
  const whole = side[shownPart];
  const taking = hero ? act : null;
  const rows = taking === null ? whole : takingAction(whole, taking);
  const tot = rows.reduce((t, r) => t + r.c, 0) || 1;
  const max = Math.max(...rows.map((r) => r.c), 1e-9);
  const colors = useMemo(() => actionColors(bd.actions), [bd.actions]);
  const hasEq = rows.some((r) => r.eq != null);
  const hasEv = hero && rows.some((r) => r.ev != null);
  const picked = rows.find((r) => r.id === sel);
  const pick = (next: number | null) => {
    setAct(next);
    setSel(null);
  };
  const unit = evUnitLabel(evUnit, bd.pot);
  return (
    <section aria-label="Hand categories" className="min-w-0 space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <div role="group" aria-label="Whose range" className="flex gap-1">
          {sides.map((s, i) => (
            <button key={s.who} type="button" aria-pressed={s === side} onClick={() => (setWho(i), setSel(null))} className={`rounded border border-border px-2 py-0.5 ${s === side ? "bg-surface-3 font-semibold" : "text-muted hover:bg-surface-2"}`}>
              {s.who}
            </button>
          ))}
        </div>
        {bd.hero.draws.length > 0 && (
          <div role="group" aria-label="Categories" className="flex gap-1">
            {(["made", "draws"] as const).map((p) => (
              <button key={p} type="button" aria-pressed={p === shownPart} onClick={() => (saveSettings({ breakdownPart: p }), setSel(null))} className={`rounded px-2 py-0.5 ${p === shownPart ? "bg-surface-3" : "text-muted hover:bg-surface-2"}`}>
                {p === "made" ? "Made hands" : "Draws"}
              </button>
            ))}
          </div>
        )}
        <span className="flex-1" />
        <ProvenanceBadge p={provenance} />
      </div>
      {hero ? (
        <div role="group" aria-label="What an action is made of" className="flex flex-wrap gap-1 text-xs">
          {bd.actions.map((n, i) => (
            <button
              key={n}
              type="button"
              aria-pressed={taking === i}
              title={`The hands that ${n}, by category`}
              onClick={() => pick(taking === i ? null : i)}
              className={`flex items-center gap-1.5 rounded px-1.5 py-0.5 ${taking === i ? "bg-surface-3" : "text-muted hover:bg-surface-2"}`}
            >
              <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: colors[i] }} />
              {n}
            </button>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted">
          {side.who} isn't the one to act, so this is the range's make-up{hasEq ? " and equity" : ""}.
        </p>
      )}
      <table className="w-full table-fixed text-xs tabular-nums">
        <thead className="text-muted">
          <tr>
            <th scope="col" className="w-[36%] py-0.5 text-left font-normal">Category</th>
            <th scope="col" className="py-0.5 text-left font-normal">{taking === null ? "Share of range" : `Share of ${bd.actions[taking]}`}</th>
            <th scope="col" className="w-11 py-0.5 text-right font-normal">%</th>
            {hasEq && <th scope="col" className="w-10 py-0.5 text-right font-normal">Eq</th>}
            {hasEv && <th scope="col" className="w-12 py-0.5 text-right font-normal">EV</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className={r.id === sel ? "bg-surface-3" : "hover:bg-surface-2"}>
              <th scope="row" className="truncate py-0.5 text-left font-normal">
                <button type="button" aria-pressed={r.id === sel} title={r.label} onClick={() => setSel(r.id === sel ? null : r.id)} className="w-full truncate text-left hover:underline">
                  {r.label}
                </button>
              </th>
              <td className="px-1 py-0.5">
                <Bar r={r} hero={hero} width={r.c / max} colors={colors} only={taking === null ? undefined : colors[taking]} />
              </td>
              <td className="py-0.5 text-right">{pct(r.c / tot)}</td>
              {hasEq && <td className="py-0.5 text-right">{pct(r.eq, 0)}</td>}
              {hasEv && <td className="py-0.5 text-right">{evIn(r.ev, evUnit, bd.pot)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
      {picked && (
        <div className="space-y-1 text-xs">
          <p>
            <strong>{picked.label}</strong> · {picked.c.toFixed(1)} combos ({pct(picked.c / tot)})
            {picked.eq != null ? ` · equity ${pct(picked.eq)}` : ""}
            {hero && picked.ev != null ? ` · EV ${evIn(picked.ev, evUnit, bd.pot)}${unit}` : ""}
            {hero && picked.f ? ` · ${bd.actions.map((n, i) => `${n} ${pct(picked.f?.[i], 0)}`).join(", ")}` : ""}
          </p>
          {hero && picked.id !== "none" && (
            <button type="button" onClick={() => onFilter(`${shownPart === "made" ? "m" : "d"}:${picked.id}`)} className="rounded border border-border px-2 py-0.5 hover:bg-surface-2">
              Show these hands in the grid
            </button>
          )}
        </div>
      )}
      <p className="text-xs text-muted">
        {shownPart === "made"
          ? "Made hands by what the hole cards add: a pair on the board is everyone's. Top pair's kicker is top, good (the next two) or weak."
          : "Draws by what the hole cards add. Each hand counts once, in its best draw."}
        {hasEv ? ` EV in ${unit}.` : ""}
        {taking !== null ? " Equity and EV aren't shown for one action: the table has them for a whole category, and the hands taking one action needn't share them." : ""}
      </p>
    </section>
  );
}

function Bar({ r, hero, width, colors, only }: { r: BreakdownRow; hero: boolean; width: number; colors: readonly string[]; only?: string | undefined }) {
  return (
    <div aria-hidden className="flex h-3 min-w-0.5 overflow-hidden rounded-sm" style={{ width: `${(width * 100).toFixed(1)}%` }}>
      {only ? (
        <i className="block h-full w-full" style={{ background: only }} />
      ) : hero && r.f ? (
        r.f.map((f, i) => f > 0 && <i key={i} className="block h-full" style={{ width: `${(f * 100).toFixed(1)}%`, background: colors[i] }} />)
      ) : (
        <i className="block h-full w-full bg-muted" />
      )}
    </div>
  );
}

const AXIS = [100, 75, 50, 25, 0];
const STEPS = 50;

/** Each range's hands sorted from most equity to least, against its share of the range (the equity distribution). */
function Equity({ bd, sides }: { bd: Breakdown; sides: readonly BreakdownSide[] }) {
  const [at, setAt] = useState<number | null>(null);
  const place = (e: { currentTarget: HTMLDivElement; clientX: number }) => {
    const r = e.currentTarget.getBoundingClientRect();
    return r.width > 0 ? Math.round(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * STEPS) : null;
  };
  const f = at === null ? null : at / STEPS;
  const nuts = (1 - bd.nut_eq) * 100;
  const notes = [rangeAdvantage(sides), nutAdvantage(sides, bd.nut_eq)].filter(Boolean).join(" ");
  return (
    <section aria-label="Equity distribution" className="min-w-0 space-y-2">
      <ul className="grid grid-cols-2 gap-2 text-xs">
        {sides.map((s) => (
          <li key={s.who} className="min-w-0 rounded border border-border border-l-4 bg-surface-2 px-2 py-1" style={{ borderLeftColor: SERIES[sidesOf(bd).indexOf(s)] }}>
            <p className="truncate font-medium">
              {s.who} <span className="font-normal text-muted">{s.combos} combos</span>
            </p>
            <dl className="mt-0.5 flex flex-wrap gap-x-3 tabular-nums">
              <Stat label="Equity" value={pct(s.eq)} />
              <Stat label="EV" value={s.ev != null ? `${evIn(s.ev, "bb", bd.pot)}bb` : "–"} />
              <Stat label={`At ${pct(bd.nut_eq, 0)}+`} value={pct(s.nuts)} title={`Share of the range with ${pct(bd.nut_eq, 0)} equity or more`} />
            </dl>
          </li>
        ))}
      </ul>
      <div className="flex h-44">
        <div aria-hidden className="relative w-9 shrink-0 text-right text-[10px] text-muted">
          {AXIS.map((v) => (
            <span key={v} className="absolute right-1 -translate-y-1/2 tabular-nums" style={{ top: `${100 - v}%` }}>
              {v}%
            </span>
          ))}
        </div>
        <div
          role="img"
          tabIndex={0}
          aria-label={`Equity distribution: ${sides.map((s) => `${s.who} ${pct(s.eq)} on average`).join(", ")}. The arrow keys read the lines.`}
          className="relative flex-1 touch-pan-y outline-offset-2"
          onPointerMove={(e) => setAt(place(e))}
          onPointerLeave={() => setAt(null)}
          onFocus={() => setAt((h) => h ?? STEPS / 2)}
          onBlur={() => setAt(null)}
          onClick={(e) => setAt(place(e))}
          onKeyDown={(e) => {
            if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
            e.preventDefault();
            setAt((h) => Math.min(STEPS, Math.max(0, (h ?? STEPS / 2) + (e.key === "ArrowLeft" ? -1 : 1))));
          }}
        >
          {AXIS.map((v) => (
            <div key={v} aria-hidden className="pointer-events-none absolute inset-x-0 border-t border-border" style={{ top: `${100 - v}%` }} />
          ))}
          <div aria-hidden className="pointer-events-none absolute inset-x-0 border-t border-dashed border-muted" style={{ top: `${nuts}%` }} />
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden>
            {sides.map((s) => (
              <polyline
                key={s.who}
                fill="none"
                stroke={SERIES[sidesOf(bd).indexOf(s)]}
                strokeWidth={2}
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
                points={(s.curve ?? []).map((e, i, c) => `${(i / (c.length - 1)) * 100},${(1 - e) * 100}`).join(" ")}
              />
            ))}
          </svg>
          {f !== null && <div aria-hidden className="pointer-events-none absolute inset-y-0 w-px bg-muted" style={{ left: `${f * 100}%` }} />}
        </div>
      </div>
      <div aria-hidden className="ml-9 flex justify-between text-[10px] text-muted">
        <span>Strongest</span>
        <span>Share of the range</span>
        <span>Weakest</span>
      </div>
      <p className="min-h-4 text-xs tabular-nums" aria-live="polite">
        {f !== null && (
          <>
            Top {pct(f, 0)} of each range: {sides.map((s) => `${s.who} ${pct(curveAt(s, f), 0)}`).join(", ")}
          </>
        )}
      </p>
      {notes && <p className="text-xs">{notes}</p>}
      <p className="text-xs text-muted">
        Each line is a range's hands sorted from most to least equity against the other {sides.length > 2 ? "ranges" : "range"} ({runoutText(bd)}); the dashed line marks {pct(bd.nut_eq, 0)}. Equity isn't what a hand wins: EV also counts how it plays.
      </p>
    </section>
  );
}

function Stat({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div title={title}>
      <dt className="text-[10px] text-muted">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
