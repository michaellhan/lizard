// The bubble factor of every pair (ROADMAP Phase 7: a table, not a single note line): row, the seat that risks chips;
// column, the opponent, all in for the shorter stack; each seat's share of the prizes left. Worked out in the page from
// the setup with the engine's model (icm.ts), so an answer's own bubble factors are its row. Or the equity a call of
// that all-in needs with nothing else in the pot: icm.py's call_need there is BF / (1 + BF), its risk premium that less
// the chips' 50%.
import { useState } from "react";
import { rowKeys } from "@/components/rowKeys";
import { ICM_TABLE_LABEL } from "@/solver/provenance";
import type { BubbleTable as Table } from "./icm";

type Show = "bf" | "call";

/** The equity a call of an all-in for the shorter stack needs with nothing else in the pot (chips: 0.5). */
export const callNeed = (bf: number) => bf / (1 + bf);

/** darker the more a chip lost costs */
const shade = (v: number | null) => (v === null || v >= 2 ? "bg-warn/40" : v >= 1.5 ? "bg-warn/25" : v >= 1.2 ? "bg-warn/15" : v >= 1.05 ? "bg-warn/5" : "");

export function BubbleTable({ table, actor }: { table: Table; actor?: string }) {
  const { seats } = table;
  const [show, setShow] = useState<Show>("bf");
  const opts: [Show, string][] = [
    ["bf", "Bubble factor"],
    ["call", "Equity to call"],
  ];
  return (
    <div className="space-y-1.5 text-xs">
      <div role="radiogroup" aria-label="Show" onKeyDown={rowKeys("radio", (i) => setShow(opts[i]![0]))} className="inline-flex rounded-md border border-border bg-surface-2 p-0.5">
        {opts.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={show === id}
            tabIndex={show === id ? 0 : -1}
            onClick={() => setShow(id)}
            className={`rounded px-2 py-0.5 ${show === id ? "bg-surface-3 text-text" : "text-muted hover:text-text"}`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="scroll-x">
        <table aria-label="Bubble factors, every pair" className="border-collapse">
          <thead>
            <tr>
              <th scope="col" className="px-1.5 py-0.5 text-left font-sans font-normal text-muted">
                risks ↓ against →
              </th>
              {seats.map((v) => (
                <th key={v} scope="col" className="px-1.5 py-0.5 text-right font-medium">
                  {v}
                </th>
              ))}
              <th scope="col" className="px-1.5 py-0.5 text-right font-sans font-normal text-muted">
                prize equity
              </th>
            </tr>
          </thead>
          <tbody>
            {seats.map((h) => (
              <tr key={h} className={h === actor ? "outline outline-1 -outline-offset-1 outline-accent" : ""}>
                <th scope="row" className="px-1.5 py-0.5 text-left font-medium">
                  {h}
                </th>
                {seats.map((v) => {
                  if (v === h)
                    return (
                      <td key={v} className="px-1.5 py-0.5 text-right text-faint">
                        —
                      </td>
                    );
                  const x = table.bf[h]?.[v] ?? null;
                  return (
                    <td
                      key={v}
                      className={`px-1.5 py-0.5 text-right ${shade(x)}`}
                      title={
                        x === null
                          ? `a chip ${h} wins from ${v} gains nothing`
                          : `${h} vs ${v}: bubble factor ${x.toFixed(2)}, a call needs ${(callNeed(x) * 100).toFixed(1)}% (chips: 50%)`
                      }
                    >
                      {x === null ? "no gain" : show === "bf" ? x.toFixed(2) : `${(callNeed(x) * 100).toFixed(1)}%`}
                    </td>
                  );
                })}
                <td className="px-1.5 py-0.5 text-right">{((table.share[h] ?? 0) * 100).toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-muted">
        Row all in against column{show === "bf" ? " (1: chips)" : ", nothing else in the pot (chips: 50%)"}. {ICM_TABLE_LABEL}
        {table.approx ? `, ${table.players} players modelled by ${table.modelled}` : ""}; start of hand, no bounties.
      </p>
    </div>
  );
}
