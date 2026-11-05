// What a hand of the range blocks in the opponent's: combos taken out, by category, and how that moves their reply.
// The opponent's combos aren't in this node's answer (blockers.ts says why), so the next one is asked for, once a hand
// is picked, and its numbers sit under its own provenance.
import { useEffect, useMemo, useState } from "react";
import { ProvenanceBadge } from "@/components/ProvenanceBadge";
import { pct } from "@/components/actions";
import { ALL_CLASSES } from "@/engine/nlhe/cards";
import type { SolverClient } from "@/solver/client";
import type { AdvisorResponse, Breakdown } from "@/solver/protocol";
import { SolverError, type Provenance, type SolveMode } from "@/solver/types";
import { blockerPlan, opponentRange, picksOf, removal, type Blocked, type OppRange } from "./blockers";
import { back, play, studyRequest, type StudyHand } from "./studyState";

type Run = { key: string } & ({ kind: "done"; range: OppRange; provenance: Provenance } | { kind: "none"; why: string });

const signed = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(1)}`;
const SELECT = "min-w-0 rounded border border-border bg-surface-2 px-1 py-0.5";

export function BlockersPanel({
  res,
  bd,
  provenance,
  hand,
  mode,
  getSolver,
}: {
  res: AdvisorResponse;
  bd: Breakdown;
  provenance: Provenance;
  hand: StudyHand;
  mode: SolveMode;
  getSolver: () => Promise<SolverClient>;
}) {
  const plan = useMemo(() => blockerPlan(res, bd, hand, provenance.source), [res, bd, hand, provenance.source]);
  const [cls, setCls] = useState("");
  const [combo, setCombo] = useState("");
  const [chosen, setChosen] = useState<number | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const action = plan.kind === "reply" ? (plan.actions.find((a) => a.i === chosen) ?? plan.actions[0]!) : null;
  const key = plan.kind === "reply" ? `a${action?.i ?? 0}` : "last";
  const picked = cls !== "";

  useEffect(() => {
    if (!picked || plan.kind === "none") return;
    const ac = new AbortController();
    const at = plan.kind === "reply" ? play(hand, res, res.actions![action!.i]!) : back(hand);
    void (async () => {
      try {
        if (!at) throw new Error("This node has no earlier action to read the range from.");
        const client = await getSolver();
        const r = await client.solve({ state: { ...studyRequest(at), breakdown: true }, mode, signal: ac.signal });
        if (ac.signal.aborted) return;
        const range = opponentRange(r.data, {
          who: plan.who,
          combos: res.opponent_combos,
          source: r.provenance.source,
          line: 1 / (1 + bd.villains.length),
          ...(plan.kind === "last" ? { last: plan.last } : {}),
        });
        setRun("why" in range ? { key, kind: "none", why: range.why } : { key, kind: "done", range, provenance: r.provenance });
      } catch (e) {
        if (ac.signal.aborted) return;
        setRun({ key, kind: "none", why: e instanceof SolverError && e.kind === "cancelled" ? "Stopped." : e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => ac.abort();
    // (by the action alone: another hand reads the same range)
  }, [picked, key, plan, action, res, bd, hand, mode, getSolver]);

  if (plan.kind === "none")
    return (
      <section aria-label="Blockers" className="min-w-0 text-xs text-muted lg:col-span-2">
        {plan.why}
      </section>
    );

  const classes = ALL_CLASSES.filter((c) => res.combos?.[c]?.length);
  const rows = res.combos?.[cls] ?? [];
  const shownRun = run?.key === key ? run : null;
  return (
    <section aria-label="Blockers" className="min-w-0 space-y-2 border-t border-border pt-3 lg:col-span-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <h3 className="text-sm font-medium">Blockers</h3>
        <label className="flex items-center gap-1 text-muted">
          Hand
          <select
            aria-label="Hand"
            className={SELECT}
            value={cls}
            onChange={(e) => {
              setCls(e.target.value);
              setCombo("");
            }}
          >
            <option value="">Pick one…</option>
            {classes.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        {picked && (
          <label className="flex items-center gap-1 text-muted">
            Combo
            <select aria-label="Combo" className={SELECT} value={combo} onChange={(e) => setCombo(e.target.value)}>
              <option value="">Every combo</option>
              {rows.map((r) => (
                <option key={r[0]}>{r[0]}</option>
              ))}
            </select>
          </label>
        )}
        {plan.kind === "reply" && plan.actions.length > 1 && (
          <label className="flex items-center gap-1 text-muted">
            Against
            <select aria-label="Against" className={SELECT} value={action?.i ?? 0} onChange={(e) => setChosen(Number(e.target.value))}>
              {plan.actions.map((a) => (
                <option key={a.i} value={a.i}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <span className="flex-1" />
        {shownRun?.kind === "done" && <ProvenanceBadge p={shownRun.provenance} />}
      </div>
      {!picked && <p className="text-xs text-muted">Pick a hand from this range to see what it takes out of {plan.who}'s. This asks for the next node, once.</p>}
      {picked && !shownRun && (
        <p role="status" className="text-xs text-muted">
          Reading {plan.who}'s hands…
        </p>
      )}
      {picked && shownRun?.kind === "none" && <p className="text-xs text-muted">{shownRun.why}</p>}
      {picked && shownRun?.kind === "done" && <Blocks range={shownRun.range} name={combo || cls} actionName={action?.name ?? null} whose={plan.kind} combos={picksOf(rows, combo)} />}
    </section>
  );
}

function Blocks({ range, name, actionName, whose, combos }: { range: OppRange; name: string; actionName: string | null; whose: "reply" | "last"; combos: ReturnType<typeof picksOf> }) {
  const r = removal(range, combos);
  const who = range.who;
  const whole = combos.length > 1 ? " on average" : "";
  const fair = pct(range.line, range.line === 0.5 ? 0 : 1);
  return (
    <div className="space-y-2 text-xs">
      <p>
        <strong>{name}</strong> takes out <strong className="tabular-nums">{r.removed.toFixed(1)}</strong> of {who}'s {r.combos.toFixed(1)} combos ({pct(r.removed / (r.combos || 1))}){whole}.
      </p>
      {r.reply && (
        <p className="tabular-nums">
          Against {actionName}, {who} continues {pct(r.reply.before)} of the time, {pct(r.reply.after)} with {name} out ({signed(r.reply.after - r.reply.before)} points), and folds {pct(r.reply.foldBefore)}, then {pct(r.reply.foldAfter)}. Of the combos it takes out, {r.reply.removedContinue.toFixed(1)} would continue and {r.reply.removedFold.toFixed(1)} would fold.
        </p>
      )}
      {r.value && (
        <p className="tabular-nums">
          Value it blocks: {r.value.removed.toFixed(1)} of the {r.value.of.toFixed(1)} combos of {who}'s with over {fair} equity against {whose === "reply" ? "the hands that take this action" : "this range"}.
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <BlockedTable title="Made hands it blocks" rows={r.made} />
        {r.draws.length > 0 && <BlockedTable title="Draws it blocks" rows={r.draws} />}
      </div>
      <p className="text-muted">
        Every {who} combo sharing a card with {name} comes out, at its own weight in the next node's answer{whole && ", across the combos of the class by how much of each your range holds"}. The hands left keep their mix: the solve doesn't change its strategy for one hand of yours.
        {whose === "last" ? ` With no bet or raise to make here, this is ${who}'s range as they just played, and there's no reply to read.` : ""}
      </p>
    </div>
  );
}

function BlockedTable({ title, rows }: { title: string; rows: readonly Blocked[] }) {
  return (
    <table className="w-full table-fixed tabular-nums">
      <caption className="text-left font-medium">{title}</caption>
      <thead className="text-muted">
        <tr>
          <th scope="col" className="w-1/2 py-0.5 text-left font-normal">Category</th>
          <th scope="col" className="py-0.5 text-right font-normal">Out</th>
          <th scope="col" className="py-0.5 text-right font-normal">Of</th>
          <th scope="col" className="py-0.5 text-right font-normal">%</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((b) => (
          <tr key={b.id}>
            <th scope="row" className="truncate py-0.5 text-left font-normal" title={b.label}>
              {b.label}
            </th>
            <td className="py-0.5 text-right">{b.removed.toFixed(1)}</td>
            <td className="py-0.5 text-right">{b.of.toFixed(1)}</td>
            <td className="py-0.5 text-right">{pct(b.of ? b.removed / b.of : null, 0)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
