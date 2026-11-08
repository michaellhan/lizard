import { evIn, evUnitLabel, pct, type EvUnit } from "@/components/actions";
import { classCombos } from "@/engine/nlhe/cards";
import type { AdvisorResponse, ComboRow, OpponentRange } from "@/solver/protocol";
import { comboEqr, comboEv, eqr } from "./views";

/** One hand class: its combos, mix, EV, equity and EQR. `opponent`: show an opponent's range instead (true: the
 * heads-up opponent; a 3-way answer's opponent by its entry in `opponents`). */
export function ComboPanel({
  cls,
  res,
  colors,
  opponent,
  evUnit = "bb",
}: {
  cls: string;
  res: AdvisorResponse;
  colors: string[];
  opponent: boolean | OpponentRange;
  evUnit?: EvUnit;
}) {
  const grid = opponent === true ? res.opponent_grid : opponent ? opponent.grid : res.grid;
  const ev = (x: number | null | undefined) => evIn(x, evUnit, res.pot_bb);
  const unit = evUnitLabel(evUnit, res.pot_bb);
  const cell = grid?.cells[cls];
  const names = res.grid?.actions ?? [];
  if (!cell) return null;
  const n = classCombos(cls);
  const rows = opponent ? [] : [...((res.combos?.[cls] ?? []) as ComboRow[])];
  const hasEv = rows.length > 0 && rows.every((r) => r[3]);
  rows.sort(hasEv ? (a, b) => (comboEv(b) ?? 0) - (comboEv(a) ?? 0) : (a, b) => b[1] - a[1]);
  const r = eqr(cell.evm, cell.eq, res.pot_bb);
  const eqrs = new Map(rows.map((row) => [row[0], comboEqr(row, res.pot_bb)]));
  const noEqr = [...new Set([...eqrs.values()].flatMap((x) => (x.why ? [x.why] : [])))];

  return (
    <div className="@container space-y-2 rounded-lg border border-border bg-surface p-3 text-sm">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <strong className="text-lg">{cls}</strong>
        <span className="text-muted">
          {(cell.w * n).toFixed(2)} of {n} combos
        </span>
        {cell.evm != null && !opponent && (
          <span>
            EV {ev(cell.evm)}
            {unit}
          </span>
        )}
        {cell.eq != null && <span>Equity {pct(cell.eq)}</span>}
        {r !== undefined && !opponent && <span title="EV / (equity × pot)">EQR {r.toFixed(2)}</span>}
      </div>
      {!opponent && (
        <div className="flex flex-wrap gap-2">
          {names.map((nm, a) =>
            (cell.f[a] ?? 0) >= 0.005 ? (
              <span key={nm} className="inline-flex items-center gap-1 rounded bg-surface-2 px-2 py-0.5">
                <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: colors[a] }} />
                {nm} <b>{pct(cell.f[a])}</b>
                {cell.ev ? <span className="text-muted"> {ev(cell.ev[a])}</span> : null}
              </span>
            ) : null,
          )}
        </div>
      )}
      {rows.length > 0 && (
        <table className="w-full text-left font-mono text-xs">
          <thead className="text-muted">
            <tr>
              <th scope="col" className="py-1 font-normal">Combo</th>
              <th scope="col" className="py-1 font-normal">Mix</th>
              {hasEv && <th scope="col" className="py-1 text-right font-normal">{unit === "bb" ? "EV" : "EV % pot"}</th>}
              {hasEv && <th scope="col" className="py-1 text-right font-normal">Eq</th>}
              <th scope="col" title="EV / (equity × pot), from this combo's own EV and equity" className="py-1 text-right font-normal">EQR</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row[0]} className="border-t border-border/60">
                <td className="py-1">
                  {row[0]}
                  {row[1] < 0.999 && <span className="text-faint"> ({pct(row[1], 0)})</span>}
                </td>
                <td className="py-1">
                  <span className="flex h-2.5 w-28 gap-px overflow-hidden rounded-sm bg-surface-3 lg:@max-sm:w-16" role="img" aria-label={names.map((nm, a) => `${nm} ${pct(row[2][a])}`).join(", ")}>
                    {row[2].map((f, a) => (f > 0.0005 ? <span key={a} style={{ width: `${f * 100}%`, background: colors[a] }} /> : null))}
                  </span>
                </td>
                {hasEv && <td className="py-1 text-right">{ev(comboEv(row))}</td>}
                {hasEv && <td className="py-1 text-right">{row[4] === null ? "–" : pct(row[4])}</td>}
                <td className="py-1 text-right" title={eqrs.get(row[0])?.why}>{eqrs.get(row[0])?.value?.toFixed(2) ?? "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {noEqr.length > 0 && <p className="text-xs text-muted">No EQR (–): {noEqr.join("; ")}.</p>}
      {!opponent && !rows.length && <p className="text-xs text-muted">No EQR by combo (–): this answer has no combos for this hand.</p>}
    </div>
  );
}
