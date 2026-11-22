// Your play at each node against the answer's (nodes.ts), as GTO Wizard's reports lay it out: preflop, your frequencies by
// seat, the charts' and the preflop solve's in tables of their own; after the flop, each spot's fold, check or call and bet
// or raise. A cell opens its decisions, your misses worst first. Every table says what answered it.
import { Fragment, useMemo, useState } from "react";
import type { DecisionRecord, HandRecord } from "@/data/db";
import { DecisionList } from "./DecisionTables";
import { cellDecisions, MIN_MARK, pfCellTest, seatGrid, spotCellTest, spotTable, type Cell, type GridRow } from "./nodes";
import { MIN_READ } from "./report";

const pct = (x: number) => `${Math.round(x * 100)}%`;
const MARK = { over: "▲", under: "▼" } as const;
const MARK_WORDS = { over: "over the answer beyond chance", under: "under the answer beyond chance" } as const;

type Open = { id: string; title: string; test: (d: DecisionRecord) => boolean };

function CellButton({ c, what, id, open, onOpen }: { c: Cell | null; what: string; id: string; open: string | null; onOpen: (id: string | null) => void }) {
  if (!c) return <span className="text-muted">—</span>;
  const words = `${what}: you ${pct(c.you)}, the answer ${pct(c.gto)} for the same hands, ${c.n.toLocaleString()} ${c.n === 1 ? "decision" : "decisions"}${c.mark ? `, ${MARK_WORDS[c.mark]}` : ""}${c.n < MIN_READ ? ", few" : ""}`;
  return (
    <button
      type="button"
      aria-label={words}
      title={words}
      aria-expanded={open === id}
      onClick={() => onOpen(open === id ? null : id)}
      className={`whitespace-nowrap rounded px-1 tabular-nums hover:bg-surface-2 ${c.mark ? "font-medium text-warn" : ""} ${open === id ? "bg-surface-2" : ""}`}
    >
      {pct(c.you)}
      <span className="text-muted"> / {pct(c.gto)}</span>
      {c.mark && <span aria-hidden="true"> {MARK[c.mark]}</span>}
      <span className={`ml-1 text-xs ${c.n < MIN_READ ? "text-muted" : "text-faint"}`}>{c.n}</span>
    </button>
  );
}

function SeatGrid({ title, label, solve, grid, open, onOpen }: { title: string; label: string; solve: boolean; grid: ReturnType<typeof seatGrid>; open: string | null; onOpen: (o: Open | null) => void }) {
  const pick = (r: GridRow, seat?: string) => (id: string | null) =>
    onOpen(id ? { id, title: `${r.label}${seat ? ` · ${seat}` : ""} (${label})`, test: pfCellTest(r.label, solve, seat) } : null);
  return (
    <div className="space-y-1">
      <h4 className="font-medium">{title}</h4>
      <div className="relative scroll-x">
        <table aria-label={title} className="min-w-full text-left">
          <thead className="text-xs text-muted">
            <tr>
              <th scope="col" className="pr-3 font-normal">Frequency</th>
              {grid.seats.map((s) => (
                <th key={s} scope="col" className="pr-2 font-normal">
                  {s}
                </th>
              ))}
              <th scope="col" className="pr-2 font-normal">Every seat</th>
            </tr>
          </thead>
          <tbody>
            {grid.rows.map((r) => (
              <tr key={r.label} aria-label={r.label} className="border-t border-border">
                <th scope="row" className="pr-3 font-normal">
                  {r.label}
                </th>
                {grid.seats.map((s) => (
                  <td key={s} className="pr-2">
                    <CellButton c={r.bySeat[s] ?? null} what={`${r.label}, ${s}`} id={`${solve}|${r.label}|${s}`} open={open} onOpen={pick(r, s)} />
                  </td>
                ))}
                <td className="pr-2">
                  <CellButton c={r.all} what={`${r.label}, every seat`} id={`${solve}|${r.label}|`} open={open} onOpen={pick(r)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Your play at each node of these decisions against the answer's. */
export function NodeTables({ ds, byId }: { ds: readonly DecisionRecord[]; byId: ReadonlyMap<string, HandRecord> }) {
  const charts = useMemo(() => seatGrid(ds, false), [ds]);
  const solve = useMemo(() => seatGrid(ds, true), [ds]);
  const spots = useMemo(() => spotTable(ds), [ds]);
  const [open, setOpen] = useState<Open | null>(null);
  const shown = useMemo(() => (open ? cellDecisions(ds, open.test) : []), [ds, open]);
  if (!charts.rows.length && !solve.rows.length && !spots.length) return null;
  const spotPick = (key: string) => (id: string | null) => setOpen(id ? { id, title: key, test: spotCellTest(key) } : null);
  return (
    <div role="group" aria-label="Your play at each node" className="space-y-3">
      <p className="text-xs text-muted">
        Each cell is your share of an action, then the answer&apos;s share of it for the same hands at the same decisions, and how many decisions. {MARK.over} over the
        answer or {MARK.under} under it: beyond chance at 95% for that cell alone, with {MIN_MARK} decisions or more, so about one marked cell in twenty is chance. The
        leaks are held to a stricter bar. A cell opens its decisions, your misses worst first.
      </p>
      {charts.rows.length > 0 && <SeatGrid title="Preflop by seat, against the charts (by frequency, not a solve)" label="charts" solve={false} grid={charts} open={open?.id ?? null} onOpen={setOpen} />}
      {solve.rows.length > 0 && <SeatGrid title="Preflop by seat, against the preflop solve (a class-level model, not a full solve)" label="preflop solve" solve grid={solve} open={open?.id ?? null} onOpen={setOpen} />}
      {spots.length > 0 && (
        <div className="space-y-1">
          <h4 className="font-medium">After the flop, each spot against what answered it</h4>
          <div className="relative scroll-x">
            <table aria-label="After the flop, each spot" className="min-w-full text-left">
              <thead className="text-xs text-muted">
                <tr>
                  <th scope="col" className="pr-3 font-normal">Spot</th>
                  <th scope="col" className="pr-3 text-right font-normal">Decisions</th>
                  <th scope="col" className="pr-2 font-normal">Fold</th>
                  <th scope="col" className="pr-2 font-normal">Check or call</th>
                  <th scope="col" className="pr-2 font-normal">Bet or raise</th>
                  <th scope="col" className="pr-2 text-right font-normal">EV given up per decision</th>
                </tr>
              </thead>
              <tbody>
                {spots.map((r) => (
                  <tr key={r.key} aria-label={r.key} className="border-t border-border">
                    <th scope="row" className="pr-3 font-normal">
                      {r.key}
                    </th>
                    <td className="pr-3 text-right tabular-nums">{r.n.toLocaleString()}</td>
                    {(["fold", "passive", "aggr"] as const).map((cls) => (
                      <Fragment key={cls}>
                        <td className="pr-2">
                          <CellButton c={r[cls]} what={`${r.key}, ${cls === "fold" ? "fold" : cls === "passive" ? "check or call" : "bet or raise"}`} id={`spot|${r.key}|${cls}`} open={open?.id ?? null} onOpen={spotPick(r.key)} />
                        </td>
                      </Fragment>
                    ))}
                    <td className="pr-2 text-right tabular-nums">{r.avg == null ? "—" : `${r.avg}bb (${r.ev.toLocaleString()} by EV)`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {open && shown.length > 0 && <DecisionList title={open.title} ds={shown} byId={byId} />}
    </div>
  );
}
