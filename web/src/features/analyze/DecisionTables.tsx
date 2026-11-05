// The report's tables and lists of graded decisions: a table of groups, each row with its count, its share in the mix
// with a 95% interval and the decisions behind it; the decisions themselves, each a link to its hand.
import { useId, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { VerdictTag } from "@/components/VerdictTag";
import type { DecisionRecord, HandRecord } from "@/data/db";
import type { Verdict } from "@/grading/grade";
import type { BreakRow } from "./breakdown";
import { worstFirst } from "./breakdown";
import { withParams } from "./leakDrill";
import { isGraded, MIN_READ, type Group } from "./report";
import { wilson } from "./stats";
import { flagged } from "./triage";

const pct = (x: number | null | undefined) => (x == null ? "—" : `${Math.round(x * 100)}%`);
const bbs = (x: number | null | undefined) => (x == null ? "—" : `${Math.round(x * 100) / 100}bb`);

/** A rate's 95% interval, and "few" under the sample a rate can be read from. */
export function RangeCell({ k, n }: { k: number; n: number }) {
  if (!n) return <>—</>;
  const [lo, hi] = wilson(k, n);
  return (
    <>
      {pct(lo)}–{pct(hi)}
      {n < MIN_READ && <span className="ml-1 text-xs text-muted">few</span>}
    </>
  );
}

// (the words a row's "stands on" cell has room for: each still says what the number is)
const SHORT: Record<string, string> = {
  "Preflop charts (by frequency, not a solve)": "Charts, by frequency",
  "Push/fold model (by frequency, not a solve)": "Push/fold model",
};
const standsOn = (r: BreakRow) => r.bases.map((b) => `${SHORT[b.basis] ?? b.basis} ${b.n.toLocaleString()}`).join(" · ");

type Row = Group & Partial<Pick<BreakRow, "bases">>;

export function GroupTable({
  title,
  first,
  rows,
  ds,
  keyOf,
  byId,
  ev,
  noUngraded,
}: {
  title: string;
  first: string;
  rows: readonly Row[];
  /** the decisions behind the rows, and each one's row */
  ds: readonly DecisionRecord[];
  keyOf: (d: DecisionRecord) => string | null | undefined;
  byId: ReadonlyMap<string, HandRecord>;
  ev?: boolean;
  noUngraded?: boolean;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const on = rows.find((r) => r.key === open);
  const behind = useMemo(() => (on ? worstFirst(ds.filter((d) => keyOf(d) === on.key)) : []), [on, ds, keyOf]);
  const list = useId();
  const stands = rows.some((r) => r.bases);
  return (
    <div className="space-y-1">
      <h3 className="font-semibold">{title}</h3>
      <div className="relative overflow-x-auto">
        <table aria-label={title} className="min-w-full text-left">
          <thead className="text-xs text-muted">
            <tr>
              <th scope="col" className="pr-3 font-normal">{first}</th>
              <th scope="col" className="pr-3 text-right font-normal">Graded</th>
              <th scope="col" className="pr-3 text-right font-normal">In the mix</th>
              <th scope="col" className="whitespace-nowrap pr-3 font-normal">95% range</th>
              <th scope="col" className="pr-3 text-right font-normal">Mistakes</th>
              {ev && <th scope="col" className="pr-3 text-right font-normal">By EV</th>}
              {ev && <th scope="col" className="pr-3 text-right font-normal">EV lost a decision</th>}
              {!noUngraded && <th scope="col" className="pr-3 text-right font-normal">Not graded</th>}
              {stands && <th scope="col" className="pr-3 font-normal">Stands on</th>}
              <th scope="col" className="font-normal">
                <span className="sr-only">Decisions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} aria-label={r.key} className="border-t border-border align-top">
                <th scope="row" className="pr-3 font-normal">{r.key}</th>
                <td className="pr-3 text-right tabular-nums">{r.graded.toLocaleString()}</td>
                <td className="pr-3 text-right tabular-nums">{pct(r.graded ? r.ok / r.graded : null)}</td>
                <td className="whitespace-nowrap pr-3 tabular-nums">
                  <RangeCell k={r.ok} n={r.graded} />
                </td>
                <td className="pr-3 text-right tabular-nums">{(r.by.Mistake + r.by.Blunder).toLocaleString()}</td>
                {ev && <td className="pr-3 text-right tabular-nums">{r.ev.toLocaleString()}</td>}
                {ev && <td className="pr-3 text-right tabular-nums">{r.ev ? `${bbs(r.avg)} (${r.avgPct}%)` : "—"}</td>}
                {!noUngraded && <td className="pr-3 text-right tabular-nums">{(r.n - r.graded).toLocaleString()}</td>}
                {stands && <td className="min-w-40 pr-3 text-xs text-muted">{standsOn(r as BreakRow)}</td>}
                <td className="text-right">
                  <button
                    type="button"
                    aria-expanded={open === r.key}
                    aria-controls={open === r.key ? list : undefined}
                    aria-label={`Decisions: ${r.key}`}
                    onClick={() => setOpen(open === r.key ? null : r.key)}
                    className="rounded border border-border px-2 py-0.5 text-xs hover:bg-surface-2"
                  >
                    Decisions
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {on && (
        <div id={list}>
          <DecisionList title={on.key} ds={behind} byId={byId} />
        </div>
      )}
    </div>
  );
}

const LIST_MAX = 50;

export function DecisionList({ title, ds, byId }: { title: string; ds: readonly DecisionRecord[]; byId: ReadonlyMap<string, HandRecord> }) {
  const [params] = useSearchParams();
  return (
    <div className="space-y-1">
      <h3 className="font-semibold">{title}</h3>
      <ul aria-label={title} className="space-y-1">
        {ds.slice(0, LIST_MAX).map((d) => {
          const h = byId.get(d.handId);
          return (
            <li key={d.id} className="flex flex-wrap items-center gap-x-2">
              {isGraded(d) && <VerdictTag v={d.verdict as Verdict} />}
              <span>
                {d.pos} {h?.hole ?? ""} {d.street}: {d.action}
                {d.situation ? ` (${d.situation})` : ""}
              </span>
              <span className="text-muted" title={d.label}>
                {decisionNote(d)}
              </span>
              <Link to={withParams(params, { hand: d.handId })} className="text-xs underline">
                Hand {h?.number || ""}
              </Link>
            </li>
          );
        })}
      </ul>
      {ds.length > LIST_MAX && <p className="text-xs text-muted">The first {LIST_MAX} of {ds.length.toLocaleString()}.</p>}
    </div>
  );
}

/** A graded decision in brief: what the answer does with your hand, and what it stands on. */
export function decisionNote(d: DecisionRecord): string {
  if (!isGraded(d)) return `not graded: ${d.why ?? ""}`;
  const parts = [`the answer ${d.matched ?? d.action} ${pct(d.freq)}${d.best && d.best !== d.matched ? `, most often ${d.best} ${pct(d.bestFreq)}` : ""}`];
  if (d.evLossBb != null) parts.push(d.evLossBb > 0 ? `${d.roughEv ? "≈" : ""}${bbs(d.evLossBb)} lost (${d.lossPct}% of the pot)` : "no EV lost");
  if (d.roughEv) parts.push("a move the range almost never takes, so its EV is rough");
  if (d.capped) parts.push("a rough solve can't condemn a line, so this stops at Inaccuracy");
  if (d.note) parts.push(d.note);
  if (d.off) parts.push(d.off);
  parts.push(d.source === "charts" ? "preflop charts, by frequency (not a solve)" : d.label);
  if (d.read) parts.push(`checked at Fast: the read said ${d.read.verdict}${d.read.label ? `, from ${d.read.label}` : ""}`);
  if (d.notChecked !== undefined) parts.push(`Fast couldn't grade it (${d.notChecked})`);
  if (flagged(d)) parts.push("flagged: worth checking at Fast");
  return parts.join(" · ");
}
