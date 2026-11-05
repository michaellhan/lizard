// The graded decisions broken down (breakdown.ts), one way at a time: each row with its count and interval, what it
// stands on and the decisions behind it, and what's left out with why.
import { useCallback, useEffect, useMemo, useState } from "react";
import type { DecisionRecord, HandRecord } from "@/data/db";
import { GroupTable } from "./DecisionTables";
import { BREAKDOWNS, breakdown, cellOf, type BreakBy, type BreakContext } from "./breakdown";
import { isGraded } from "./report";
import { readStats, type HandStats } from "./stats";

const nDecisions = (n: number) => `${n.toLocaleString()} ${n === 1 ? "decision" : "decisions"}`;

export function Breakdowns({ ds, hands, byId }: { ds: readonly DecisionRecord[]; hands: readonly HandRecord[]; byId: ReadonlyMap<string, HandRecord> }) {
  const [by, setBy] = useState<BreakBy>("pos");
  const how = BREAKDOWNS.find((b) => b.by === by)!;
  const history = !!how.history;
  const [read, setRead] = useState<{ of: readonly HandRecord[]; facts: Map<string, HandStats | null> } | null>(null);
  const [done, setDone] = useState<{ of: readonly HandRecord[]; n: number } | null>(null);
  // (only the ways that need the history wait for it; each hand is read once, with the stats as played)
  useEffect(() => {
    if (!history) return;
    const ac = new AbortController();
    void readStats(hands, { signal: ac.signal, onProgress: (n) => setDone({ of: hands, n }) }).then((list) => list && setRead({ of: hands, facts: new Map(list.map((x) => [x.id, x.s])) }));
    return () => ac.abort();
  }, [hands, history]);
  const facts = read?.of === hands ? read.facts : null;
  const ctx = useMemo((): BreakContext => ({ hands: byId, facts }), [byId, facts]);
  const waiting = history && !facts;
  const b = useMemo(() => (waiting ? null : breakdown(ds, by, ctx)), [waiting, ds, by, ctx]);
  const keyOf = useCallback(
    (d: DecisionRecord) => {
      if (!isGraded(d)) return null;
      const c = cellOf(d, by, ctx);
      return "key" in c ? c.key : null;
    },
    [by, ctx],
  );
  return (
    <div role="group" aria-label="Breakdowns" className="space-y-1">
      <label className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">Graded decisions by</span>
        <select aria-label="Break decisions down by" value={by} onChange={(e) => setBy(e.target.value as BreakBy)} className="rounded border border-border bg-surface-2 px-1 py-0.5">
          {BREAKDOWNS.map((x) => (
            <option key={x.by} value={x.by}>
              {x.label}
            </option>
          ))}
        </select>
      </label>
      {how.note && <p className="text-xs text-muted">{how.note}</p>}
      {waiting && (
        <p role="status" aria-label="Reading the histories" className="text-muted">
          Reading the histories… {done?.of === hands ? `${done.n.toLocaleString()} of ${hands.length.toLocaleString()} hands` : ""}
        </p>
      )}
      {b && b.rows.length > 0 && <GroupTable key={by} title={how.label} first={how.first} rows={b.rows} ds={ds} keyOf={keyOf} byId={byId} ev noUngraded />}
      {b && !b.rows.length && <p className="text-muted">None of these {nDecisions(b.graded)} can be broken down this way.</p>}
      {b && b.left.length > 0 && (
        <p role="group" aria-label="Left out of this breakdown" className="text-xs text-muted">
          Left out, of {nDecisions(b.graded)} graded: {b.left.map((l) => `${l.n.toLocaleString()} because ${l.why}`).join("; ")}.
        </p>
      )}
    </div>
  );
}
