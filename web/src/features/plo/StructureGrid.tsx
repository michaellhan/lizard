// The condensed PLO range view: a range, or a decision of a solve, laid over the hand-structure grid (engine/plo/structure.ts),
// rows of pair and connected structure against columns of suits. Each cell says its share of the range and, at a decision,
// its mix as a bar; picking a cell lists its combos with their own mix and EV. Every number is the range's or the solve's.
import { useMemo, useState } from "react";
import { actionFills } from "@/components/actions";
import { cardName } from "@/engine/plo/cards";
import { handAt } from "@/engine/plo/combos";
import { cellLabel, STRUCTURE_ROWS, structureCells, SUIT_COLUMNS, SUIT_SHORT, type StructureCell } from "@/engine/plo/structure";

const PAGE = 50;
const pct = (x: number | null, d = 1) => (x === null || Number.isNaN(x) ? "–" : `${(x * 100).toFixed(d)}%`);
const chips = (x: number | null) => (x === null || Number.isNaN(x) ? "–" : x.toFixed(2));
const handText = (i: number) => handAt(i).map(cardName).join("");

export interface GridAction {
  label: string;
  kind: string;
  allIn?: boolean;
}

/** The palette's name for an action of a PLO tree (`fold`, `check`, `bet …`, `all-in`), for actionFills. */
const paletteName = (a: GridAction) => (a.allIn ? "all-in" : `${a.kind} ${a.label}`);

export interface StructureGridProps {
  /** the table's name, for a screen reader and the tests */
  label: string;
  /** whose range, in words */
  whose: string;
  hands: Int32Array;
  weight: Float32Array;
  /** each combo's start weight, to say how much of it reaches here */
  start?: Float32Array;
  actions?: readonly GridAction[];
  strategy?: Float32Array;
  ev?: Float32Array;
}

export function StructureGrid({ label, whose, hands, weight, start, actions, strategy, ev }: StructureGridProps) {
  const cells = useMemo(
    () => structureCells(hands, weight, actions && strategy ? { actions: actions.length, strategy, ...(ev ? { ev } : {}) } : undefined),
    [hands, weight, actions, strategy, ev],
  );
  const [picked, setPicked] = useState<string | null>(null);
  const at = new Map(cells.map((c) => [`${c.row}:${c.col}`, c]));
  const rows = STRUCTURE_ROWS.map((_, r) => r).filter((r) => SUIT_COLUMNS.some((_, c) => at.has(`${r}:${c}`)));
  const fills = actions ? actionFills(actions.map(paletteName)) : [];
  const chosen = picked ? (at.get(picked) ?? null) : null;
  if (!cells.length) return null;
  return (
    <div className="min-w-0 space-y-2">
      <div className="scroll-x">
        <table aria-label={label} className="w-full border-separate border-spacing-0.5 text-xs">
          <thead className="text-muted">
            <tr>
              <th className="py-1 pr-2 text-left font-normal">{whose}</th>
              {SUIT_COLUMNS.map((name, c) => (
                <th key={name} className="py-1 font-normal" title={name}>
                  <abbr title={name} className="no-underline">
                    {SUIT_SHORT[c]}
                  </abbr>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r}>
                <th scope="row" className="whitespace-nowrap py-1 pr-2 text-left font-normal">
                  {STRUCTURE_ROWS[r]}
                </th>
                {SUIT_COLUMNS.map((_, c) => {
                  const cell = at.get(`${r}:${c}`);
                  if (!cell) return <td key={c} className="text-center text-muted" aria-label={`${cellLabel(r, c)}: none`}>·</td>;
                  const key = `${r}:${c}`;
                  const words = `${cellLabel(r, c)}: ${pct(cell.share)} of the range${actions ? `, ${actions.map((a, k) => `${a.label} ${pct(cell.frequency[k]!, 0)}`).join(", ")}` : ""}`;
                  return (
                    <td key={c} className="p-0">
                      <button
                        type="button"
                        aria-label={words}
                        aria-pressed={picked === key}
                        title={words}
                        onClick={() => setPicked(picked === key ? null : key)}
                        className={`block w-full min-w-12 rounded border px-1 py-0.5 text-center ${picked === key ? "border-accent" : "border-border"} hover:bg-surface-2`}
                      >
                        <span className="block font-mono">{pct(cell.share)}</span>
                        {actions && (
                          <span className="mt-0.5 flex h-1.5 overflow-hidden rounded-sm" aria-hidden>
                            {cell.frequency.map((f, k) => (
                              <span key={k} style={{ width: `${f * 100}%`, background: fills[k] }} />
                            ))}
                          </span>
                        )}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          <caption className="caption-bottom pt-1 text-left text-xs text-muted">
            Hands by shape: pairs and how the ranks connect (an ace counts low too), against the suits (ds double-suited, ss single-suited, r rainbow, 3s and 4s three or four of a suit). Each cell&apos;s share of the
            range{actions ? " and its mix, by combo weight" : ""}. Pick a cell for its combos.
          </caption>
        </table>
      </div>
      {chosen && <CellCombos key={picked} cell={chosen} hands={hands} weight={weight} start={start} actions={actions} strategy={strategy} ev={ev} />}
    </div>
  );
}

function CellCombos({ cell, hands, weight, start, actions, strategy, ev }: { cell: StructureCell } & Omit<StructureGridProps, "label" | "whose">) {
  const [shown, setShown] = useState(PAGE);
  const n = hands.length;
  const order = useMemo(() => [...cell.members].sort((a, b) => weight[b]! - weight[a]! || a - b), [cell, weight]);
  return (
    <div className="min-w-0 space-y-1">
      <p className="text-xs">
        <span className="font-semibold">{cellLabel(cell.row, cell.col)}</span>: {cell.members.length.toLocaleString("en-US")} combos, {pct(cell.share)} of the range
        {cell.ev !== null ? `, EV ${chips(cell.ev)}bb` : ""}. Showing {Math.min(shown, order.length).toLocaleString("en-US")}, most weight first.
      </p>
      <div className="scroll-x">
        <table aria-label={`Combos in ${cellLabel(cell.row, cell.col)}`} className="w-full text-xs">
          <thead className="text-left text-muted">
            <tr>
              <th className="py-1 pr-2 font-normal">Hand</th>
              {start && <th className="py-1 pr-2 font-normal">Reach</th>}
              {actions?.map((a) => (
                <th key={a.label} className="py-1 pr-2 font-normal">
                  {a.label}
                </th>
              ))}
              {ev && <th className="py-1 font-normal">EV, bb</th>}
            </tr>
          </thead>
          <tbody>
            {order.slice(0, shown).map((i) => (
              <tr key={i} className="border-t border-border">
                <td className="whitespace-nowrap py-1 pr-2 font-mono">{handText(hands[i]!)}</td>
                {start && <td className="py-1 pr-2">{pct(weight[i]! / start[i]!, 0)}</td>}
                {actions?.map((a, k) => (
                  <td key={a.label} className="py-1 pr-2">
                    {pct(strategy![k * n + i]!, 0)}
                  </td>
                ))}
                {ev && <td className="py-1">{chips(ev[i]!)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {order.length > shown && (
        <button type="button" className="rounded border border-border px-3 py-1 text-sm hover:bg-surface-2" onClick={() => setShown((s) => s + PAGE)}>
          Show {Math.min(PAGE, order.length - shown)} more
        </button>
      )}
    </div>
  );
}
