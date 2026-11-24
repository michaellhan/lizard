// Your flop play by board against the answer's (boards.ts): one flop frequency at a time, by the texture group picked,
// each class with its count, your share and its 95% range ("few" under 30), the answer's mean for the same hands, what
// the answers stand on, the flops behind it and the decisions behind any row. Optionally one pot type, in or out of
// position. Worked out only while it's open.
import { Fragment, useId, useMemo, useState } from "react";
import { PlayingCard } from "@/components/PlayingCard";
import type { DecisionRecord, HandRecord } from "@/data/db";
import { TEXTURE_GROUPS, type TextureKey } from "@/features/practice/texture";
import { POT_TYPES } from "./analyze";
import { BOARD_FREQS, boardDecisions, boardTest, boardView, type BoardCell, type Seat } from "./boards";
import { worstFirst } from "./breakdown";
import { basesText, DecisionList, RangeCell } from "./DecisionTables";

const pct = (x: number) => `${Math.round(x * 100)}%`;
const SELECT = "rounded border border-border bg-surface-2 px-1 py-0.5";
const nDecisions = (n: number) => `${n.toLocaleString()} ${n === 1 ? "decision" : "decisions"}`;
const cardsOf = (f: string) => [f.slice(0, 2), f.slice(2, 4), f.slice(4, 6)];

export function BoardsPanel({ ds, byId }: { ds: readonly DecisionRecord[]; byId: ReadonlyMap<string, HandRecord> }) {
  const [pot, setPot] = useState<string | null>(null);
  const [seat, setSeat] = useState<Seat | null>(null);
  // Counted under the pot type and position chosen, so each option's count is the table it opens.
  const counts = useMemo(
    () => new Map(BOARD_FREQS.map((f) => [f.label, boardDecisions(ds, byId, f.label, { pot, seat }).kept.length])),
    [ds, byId, pot, seat],
  );
  const first = BOARD_FREQS.find((f) => counts.get(f.label))?.label ?? BOARD_FREQS[0]!.label;
  const [freq, setFreq] = useState<string | null>(null);
  const shown = freq ?? first;
  const [by, setBy] = useState<TextureKey>("hi");
  const v = useMemo(() => boardView(ds, byId, shown, { pot, seat }), [ds, byId, shown, pot, seat]);
  const [openClass, setOpenClass] = useState<string | null>(null);
  const [drill, setDrill] = useState<{ key: string; title: string } | null>(null);
  const list = useId();
  const kept = useMemo(() => boardDecisions(ds, byId, shown, { pot, seat }).kept.map((x) => x.d), [ds, byId, shown, pot, seat]);
  const behind = useMemo(() => (drill ? worstFirst(kept.filter(boardTest(byId, drill.key))) : []), [drill, kept, byId]);
  const group = v.groups.find((g) => g.key === by);
  const reset = () => (setOpenClass(null), setDrill(null));

  const drillButton = (c: BoardCell, title: string) => (
    <button
      type="button"
      aria-expanded={drill?.key === c.key}
      aria-controls={drill?.key === c.key ? list : undefined}
      aria-label={`Decisions: ${title}`}
      onClick={() => setDrill(drill?.key === c.key ? null : { key: c.key, title })}
      className="rounded border border-border px-2 py-0.5 text-xs hover:bg-surface-2"
    >
      Decisions
    </button>
  );
  const figures = (c: BoardCell) => (
    <>
      <td className="pr-3 text-right tabular-nums">{c.n.toLocaleString()}</td>
      <td className="pr-3 text-right tabular-nums">{pct(c.you)}</td>
      <td className="whitespace-nowrap pr-3 tabular-nums">
        <RangeCell k={c.k} n={c.n} />
      </td>
      <td className="pr-3 text-right tabular-nums">{pct(c.gto)}</td>
      <td className="pr-3 text-right tabular-nums">{signed(c.you - c.gto)}</td>
    </>
  );

  return (
    <div role="group" aria-label="Flop play by board" className="space-y-2">
      <p className="text-xs text-muted">
        Your flop frequencies by the flop's texture, against the answer's: the answer's figure is the mean of its own mix for the hand you held at each of the same decisions, as in the frequency table. Each row's answers come from what graded it (Stands on); flops alike but for their suits are one row, shown in spades first.
      </p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <label className="flex items-center gap-1">
          <span className="text-muted">Decision</span>
          <select aria-label="Flop decision" value={shown} onChange={(e) => (setFreq(e.target.value), reset())} className={SELECT}>
            {BOARD_FREQS.map((f) => (
              <option key={f.label} value={f.label}>
                {f.label} ({(counts.get(f.label) ?? 0).toLocaleString()})
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1">
          <span className="text-muted">Board by</span>
          <select aria-label="Board by" value={by} onChange={(e) => (setBy(e.target.value as TextureKey), reset())} className={SELECT}>
            {TEXTURE_GROUPS.map((g) => (
              <option key={g.key} value={g.key}>
                {g.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1">
          <span className="text-muted">Pot type</span>
          <select aria-label="Board pot type" value={pot ?? ""} onChange={(e) => (setPot(e.target.value || null), reset())} className={SELECT}>
            <option value="">Any</option>
            {POT_TYPES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1">
          <span className="text-muted">Position</span>
          <select aria-label="Board position" value={seat ?? ""} onChange={(e) => (setSeat((e.target.value || null) as Seat | null), reset())} className={SELECT}>
            <option value="">Any</option>
            <option value="ip">In position</option>
            <option value="oop">Out of position</option>
          </select>
        </label>
      </div>
      {!v.all ? (
        <p className="text-muted">No graded {shown.toLowerCase()} decision with a flop{pot || seat ? " fits these choices" : " yet"}.</p>
      ) : (
        <div className="relative scroll-x">
          <table aria-label={`${shown} by board`} className="min-w-full text-left">
            <thead className="text-xs text-muted">
              <tr>
                <th scope="col" className="pr-3 font-normal">{group?.label ?? "Board"}</th>
                <th scope="col" className="pr-3 text-right font-normal">Decisions</th>
                <th scope="col" className="pr-3 text-right font-normal">You</th>
                <th scope="col" className="whitespace-nowrap pr-3 font-normal">95% range</th>
                <th scope="col" className="pr-3 text-right font-normal">The answer</th>
                <th scope="col" className="pr-3 text-right font-normal" title="Your share less the answer's, in points">
                  Gap
                </th>
                <th scope="col" className="pr-3 font-normal">Stands on</th>
                <th scope="col" className="font-normal">
                  <span className="sr-only">Flops and decisions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr aria-label="Every flop" className="border-t border-border align-top font-medium">
                <th scope="row" className="pr-3 font-medium">Every flop</th>
                {figures(v.all)}
                <td className="min-w-40 pr-3 text-xs font-normal text-muted">{basesText(v.all.bases)}</td>
                <td className="text-right">{drillButton(v.all, `${shown}, every flop`)}</td>
              </tr>
              {group?.classes.map((c) => (
                <Fragment key={c.key}>
                  <tr aria-label={c.label} className="border-t border-border align-top">
                    <th scope="row" className="pr-3 font-normal">{c.label}</th>
                    {figures(c)}
                    <td className="min-w-40 pr-3 text-xs text-muted">{basesText(c.bases)}</td>
                    <td className="whitespace-nowrap text-right">
                      <button
                        type="button"
                        aria-expanded={openClass === c.key}
                        aria-label={`Flops: ${c.label}`}
                        onClick={() => setOpenClass(openClass === c.key ? null : c.key)}
                        className="mr-1 rounded border border-border px-2 py-0.5 text-xs hover:bg-surface-2"
                      >
                        Flops ({c.flops.length.toLocaleString()})
                      </button>
                      {drillButton(c, `${shown}, ${c.label}`)}
                    </td>
                  </tr>
                  {openClass === c.key &&
                    c.flops.map((f) => (
                      <tr key={f.key} aria-label={`${c.label}: ${f.label}`} className="align-top text-xs">
                        <th scope="row" className="pl-3 pr-3 font-normal">
                          <span className="inline-flex gap-0.5" title={f.label}>
                            {cardsOf(f.label).map((x) => (
                              <PlayingCard key={x} card={x} size="xs" />
                            ))}
                          </span>
                        </th>
                        {figures(f)}
                        <td className="pr-3 text-muted">{basesText(f.bases)}</td>
                        <td className="text-right">{drillButton(f, `${shown}, ${f.label}`)}</td>
                      </tr>
                    ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {v.left.length > 0 && (
        <p role="group" aria-label="Left out of the board view" className="text-xs text-muted">
          Left out: {v.left.map((l) => `${nDecisions(l.n)} because ${l.why}`).join("; ")}.
        </p>
      )}
      {drill && behind.length > 0 && (
        <div id={list}>
          <DecisionList title={drill.title} ds={behind} byId={byId} />
        </div>
      )}
    </div>
  );
}

const signed = (x: number) => {
  const p = Math.round(x * 100);
  return p === 0 ? "0" : `${p > 0 ? "+" : "−"}${Math.abs(p)}`;
};
