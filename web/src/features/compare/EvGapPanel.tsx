// Study's "Compare two actions' EV": per hand class, one action's EV minus another's (evgap.ts), as a grid and the
// classes where each is worth most more, with the equilibrium check (a class taking both should be near zero) and the
// rough-EV caveat. Opened under a solved node's grid; shown only where the answer has every action's EV per class.
import { useState } from "react";
import { evIn, evUnitLabel, pct, type EvUnit } from "@/components/actions";
import type { AdvisorResponse } from "@/solver/protocol";
import type { Provenance } from "@/solver/types";
import { DeltaMatrix, type DeltaCell } from "./DiffMatrix";
import { evGaps, hasActionEvs, mixing, widest, type EvGap } from "./evgap";

export function EvGapPanel({ res, provenance, evUnit }: { res: AdvisorResponse; provenance: Provenance; evUnit: EvUnit }) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<[string | null, string | null]>([null, null]);
  const [selected, setSelected] = useState<string | null>(null);
  if (!hasActionEvs(res)) return null;
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="rounded border border-border px-2 py-0.5 text-sm text-muted hover:bg-surface-2">
        Compare two actions' EV
      </button>
    );

  const names = res.grid!.actions;
  // (by default the two the range takes most)
  const byFreq = [...(res.actions ?? [])].sort((a, b) => (b.freq ?? 0) - (a.freq ?? 0)).map((a) => a.action).filter((a) => names.includes(a));
  const x = picked[0] && names.includes(picked[0]) ? picked[0] : (byFreq[0] ?? names[0]!);
  const y = picked[1] && names.includes(picked[1]) && picked[1] !== x ? picked[1] : (byFreq.find((a) => a !== x) ?? names.find((a) => a !== x)!);
  const gaps = evGaps(res, x, y);
  const by = new Map(gaps.map((g) => [g.cls, g]));
  const pot = res.pot_bb;
  const u = (v: number) => `${v > 0 ? "+" : ""}${evIn(v, evUnit, pot)}${evUnitLabel(evUnit, pot)}`;
  const plain = (v: number | null) => (v === null ? "–" : `${evIn(v, evUnit, pot)}${evUnitLabel(evUnit, pot)}`);
  // the answer's distance from equilibrium, bb: a gap under it is noise
  const noise = provenance.exploitabilityPct !== undefined && pot ? (provenance.exploitabilityPct / 100) * pot : null;
  const max = Math.max(0, ...gaps.map((g) => Math.abs(g.d ?? 0)));
  const rough = [x, y].filter((a) => res.actions?.find((s) => s.action === a)?.rough_ev);
  const mix = mixing(gaps);
  const label = (cls: string, g: EvGap | undefined) =>
    !g
      ? `${cls}: not in the range`
      : g.d === null
        ? `${cls}: no EV`
        : `${cls}: ${x} − ${y} = ${u(g.d)} (${x} ${plain(g.ex)}, ${y} ${plain(g.ey)}; takes them ${pct(g.fx, 0)} and ${pct(g.fy, 0)})`;
  const cellOf = (cls: string): DeltaCell => {
    const g = by.get(cls);
    return { d: g?.d ?? null, label: label(cls, g), present: Boolean(g) };
  };
  const list = (sign: 1 | -1) => {
    const top = widest(gaps, sign);
    return top.length ? (
      <ol className="space-y-0.5 font-mono text-xs">
        {top.map((g) => (
          <li key={g.cls}>
            {g.cls} {u(Math.abs(g.d!))} (takes it {pct(sign > 0 ? g.fx : g.fy, 0)})
          </li>
        ))}
      </ol>
    ) : (
      <p className="text-xs text-muted">None.</p>
    );
  };
  const select = (i: 0 | 1, value: string) => setPicked((p) => (i === 0 ? [value, p[1]] : [p[0], value]));

  return (
    <section aria-label="Two actions' EV" className="w-full space-y-3 rounded-lg border border-border bg-surface p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span>EV of</span>
        <select aria-label="First action" value={x} onChange={(e) => select(0, e.target.value)} className="rounded border border-border bg-surface-2 px-2 py-0.5">
          {names.map((a) => (
            <option key={a}>{a}</option>
          ))}
        </select>
        <span>minus</span>
        <select aria-label="Second action" value={y} onChange={(e) => select(1, e.target.value)} className="rounded border border-border bg-surface-2 px-2 py-0.5">
          {names
            .filter((a) => a !== x)
            .map((a) => (
              <option key={a}>{a}</option>
            ))}
        </select>
        <span>per hand class</span>
        <button type="button" onClick={() => setPicked([y, x])} className="rounded border border-border px-2 py-0.5 text-muted hover:bg-surface-2">
          Swap
        </button>
        <span className="flex-1" />
        <button type="button" onClick={() => setOpen(false)} className="rounded px-2 py-0.5 text-muted hover:bg-surface-2">
          Close
        </button>
      </div>
      {rough.length > 0 && (
        <p className="rounded border border-warn/40 bg-warn/10 px-2 py-1 text-xs">
          ≈ {rough.join(" and ")} {rough.length > 1 ? "are" : "is"} taken by almost none of the range here, so {rough.length > 1 ? "their" : "its"} EVs
          are rough (usually too low), and so are these gaps.
        </p>
      )}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div className="space-y-2">
          <DeltaMatrix name={`EV of ${x} minus ${y}`} cellOf={cellOf} full={max} min={noise ?? 0.005} selected={selected} onSelect={setSelected} />
          <p className="text-xs text-muted">
            Blue: {x} is worth more; red: {y} is; the stronger, the bigger (strongest {u(max)}).
            {noise !== null ? ` Gaps under ${plain(noise)} (the answer's distance from equilibrium) aren't coloured: noise.` : ""}
          </p>
          {selected && <p className="text-sm">{label(selected, by.get(selected))}</p>}
        </div>
        <div className="space-y-3 text-sm">
          <div aria-label={`Where ${x} is worth most more`}>
            <h3 className="font-medium">Where {x} is worth most more</h3>
            {list(1)}
          </div>
          <div aria-label={`Where ${y} is worth most more`}>
            <h3 className="font-medium">Where {y} is worth most more</h3>
            {list(-1)}
          </div>
          <p className="text-xs text-muted">
            {mix.n
              ? `${mix.n} ${mix.n > 1 ? "classes take" : "class takes"} both at least 5% of the time; ${mix.n > 1 ? "their gaps average" : "its gap is"} ${plain(mix.meanAbs!)} in size. At equilibrium a class mixes only actions worth the same, so this should be near zero.`
              : "No class takes both at least 5% of the time."}
          </p>
        </div>
      </div>
    </section>
  );
}
