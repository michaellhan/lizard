// Preflop blockers on Study's Tools tab (pfBlockers.ts): which hands of this range most change the opponents'
// continuing range, from the class-level preflop solve. The opponents' nodes are asked for once the fold is opened,
// each shown under its own provenance; a hand picked shows what it takes out of each seat. Charts and the push/fold
// model say why there are none.
import { useEffect, useMemo, useState } from "react";
import { ProvenanceBadge } from "@/components/ProvenanceBadge";
import { kindOf, pct } from "@/components/actions";
import { ALL_CLASSES, expandClass } from "@/engine/nlhe/cards";
import type { SolverClient } from "@/solver/client";
import type { AdvisorResponse } from "@/solver/protocol";
import { describe } from "@/solver/provenance";
import { SolverError, type Provenance, type SolveMode } from "@/solver/types";
import { allFold, blockedClasses, pfBlockerPlan, pfEffect, pfRange, pfRanking, type PfRange, type PfRead } from "./pfBlockers";
import { play, studyRequest, type StudyHand } from "./studyState";

type Seat = { range: PfRange; provenance: Provenance };
type Run = { key: string } & ({ kind: "done"; seats: Seat[] } | { kind: "none"; why: string });

const SELECT = "min-w-0 rounded border border-border bg-surface-2 px-1 py-0.5";
const points = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(1)}`;
const readKey = (r: PfRead) => (r.kind === "reply" ? `a${r.i}` : "last");
/** Seats read at most after our raise (a 9-handed table's eight). */
const MAX_SEATS = 8;
/** Hands listed at each end of the ranking. */
const TOP = 8;

export function PfBlockersPanel({ res, provenance, hand, mode, getSolver }: { res: AdvisorResponse; provenance: Provenance; hand: StudyHand; mode: SolveMode; getSolver: () => Promise<SolverClient> }) {
  const plan = useMemo(() => pfBlockerPlan(res, provenance.source, hand.preflop), [res, provenance.source, hand.preflop]);
  const [chosen, setChosen] = useState<string | null>(null);
  const read = plan.kind === "ok" ? (plan.reads.find((r) => readKey(r) === chosen) ?? plan.reads[0]!) : null;
  const key = read ? readKey(read) : "";
  const [run, setRun] = useState<Run | null>(null);
  const [cls, setCls] = useState("");
  const [combo, setCombo] = useState("");

  useEffect(() => {
    if (plan.kind !== "ok" || !read) return;
    const ac = new AbortController();
    void (async () => {
      try {
        const client = await getSolver();
        const ask = async (at: StudyHand) => client.solve({ state: studyRequest(at), mode, signal: ac.signal });
        const seats: Seat[] = [];
        let why: string | null = null;
        if (read.kind === "last") {
          const r = await ask({ ...hand, preflop: hand.preflop.slice(0, read.at) });
          const range = pfRange(r.data, { who: read.who, source: r.provenance.source, take: read.last });
          if ("why" in range) why = range.why;
          else seats.push({ range, provenance: r.provenance });
        } else {
          // each seat after our raise in turn, the ones before it folding, until it's ours again or the hand moves on
          let at = play(hand, res, res.actions![read.i]!);
          for (let n = 0; n < MAX_SEATS; n++) {
            const r = await ask(at);
            if (ac.signal.aborted) return;
            const d = r.data;
            if (d.study !== "node" || d.street !== "preflop" || d.actor === plan.hero || seats.some((s) => s.range.who === d.actor)) break;
            const range = pfRange(d, { who: String(d.actor), source: r.provenance.source });
            if ("why" in range) {
              why = range.why;
              break;
            }
            seats.push({ range, provenance: r.provenance });
            const fold = (d.actions ?? []).find((a) => kindOf(a.action) === "fold");
            if (!fold) break;
            at = play(at, d, fold);
          }
          if (!seats.length && !why) why = "No preflop blockers here: no seat acts after that raise in the solve.";
        }
        if (ac.signal.aborted) return;
        setRun(why ? { key, kind: "none", why } : { key, kind: "done", seats });
      } catch (e) {
        if (ac.signal.aborted) return;
        setRun({ key, kind: "none", why: e instanceof SolverError && e.kind === "cancelled" ? "Stopped." : e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => ac.abort();
    // (by the read alone: the hand picked is worked out here)
  }, [plan, read, key, res, hand, mode, getSolver]);

  const ours = useMemo(() => ALL_CLASSES.filter((c) => (res.grid?.cells[c]?.w ?? 0) > 0), [res.grid]);
  const shown = run?.key === key ? run : null;
  const ranges = useMemo(() => (shown?.kind === "done" ? shown.seats.map((s) => s.range) : []), [shown]);
  const ranking = useMemo(() => (ranges.length ? pfRanking(ranges, ours) : []), [ranges, ours]);

  if (plan.kind === "none")
    return (
      <section aria-label="Preflop blockers" className="text-xs text-muted">
        {plan.why}
      </section>
    );
  const reply = read!.kind === "reply";
  const name = combo || cls;
  return (
    <section aria-label="Preflop blockers" className="min-w-0 space-y-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        {plan.reads.length > 1 && (
          <label className="flex items-center gap-1 text-muted">
            Read
            <select aria-label="Read" className={SELECT} value={key} onChange={(e) => setChosen(e.target.value)}>
              {plan.reads.map((r) => (
                <option key={readKey(r)} value={readKey(r)}>
                  {r.kind === "reply" ? `The reply to your ${r.name}` : `The range of ${r.name}`}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="flex items-center gap-1 text-muted">
          Hand
          <select aria-label="Blocker hand" className={SELECT} value={cls} onChange={(e) => (setCls(e.target.value), setCombo(""))}>
            <option value="">Pick one…</option>
            {ours.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        {cls && (
          <label className="flex items-center gap-1 text-muted">
            Combo
            <select aria-label="Blocker combo" className={SELECT} value={combo} onChange={(e) => setCombo(e.target.value)}>
              <option value="">Every combo</option>
              {expandClass(cls).map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
        )}
      </div>
      <p className="text-muted">
        Class-level model: the preflop solve plays each hand class as one, so each class's combos count as equally likely and the figure before is the model's, which counts no card removal. What a hand takes out is exact for that model, not for a full solve's suits.
      </p>
      {!shown && (
        <p role="status" className="text-muted">
          Reading the {reply ? "seats after your raise" : "raiser's range"}…
        </p>
      )}
      {shown?.kind === "none" && <p className="text-muted">{shown.why}</p>}
      {shown?.kind === "done" && (
        <>
          {/* (the seats whose nodes read alike under one badge: a stored solve's are usually all one) */}
          <ul aria-label="Ranges read" className="space-y-1">
            {byProvenance(shown.seats).map((g) => (
              <li key={g.seats[0]!.range.who} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="tabular-nums">{g.seats.map((s) => `${s.range.who} ${s.range.combos.toFixed(1)} combos`).join(", ")}</span>
                <ProvenanceBadge p={g.p} />
              </li>
            ))}
          </ul>
          <Summary seats={shown.seats} read={read!} />
          <div className="grid gap-3 sm:grid-cols-2">
            <RankTable title={reply ? "Hands that make them fold the most" : "Hands that take out the most"} rows={ranking.slice(0, TOP)} reply={reply} onPick={(c) => (setCls(c), setCombo(""))} />
            <RankTable title={reply ? "Hands that make them fold the least" : "Hands that take out the least"} rows={ranking.slice(-TOP).reverse()} reply={reply} onPick={(c) => (setCls(c), setCombo(""))} />
          </div>
          {name && <Detail ranges={ranges} name={name} reply={reply} />}
        </>
      )}
    </section>
  );
}

/** The seats in groups whose provenance reads alike, in seat order. */
function byProvenance(seats: readonly Seat[]): { p: Provenance; seats: Seat[] }[] {
  const out = new Map<string, { p: Provenance; seats: Seat[] }>();
  for (const s of seats) {
    const k = describe(s.provenance);
    const g = out.get(k) ?? { p: s.provenance, seats: [] };
    g.seats.push(s);
    out.set(k, g);
  }
  return [...out.values()];
}

function Summary({ seats, read }: { seats: readonly Seat[]; read: PfRead }) {
  const before = allFold(seats.map((s) => s.range));
  if (read.kind === "last") return <p>{`The range of ${read.name}: ${seats[0]!.range.combos.toFixed(1)} combos in the solve.`}</p>;
  const who = seats.map((s) => s.range.who).join(", ");
  return (
    <p className="tabular-nums">
      After your {read.name}, {seats.length === 1 ? `${who} acts` : `${seats.length} seats act (${who})`}: {seats.length === 1 ? "they fold" : "all of them fold"} <strong>{pct(before)}</strong> of the time in the solve{seats.length > 1 ? ", each seat's cards taken as apart, as the model has them" : ""}.
    </p>
  );
}

function RankTable({ title, rows, reply, onPick }: { title: string; rows: ReturnType<typeof pfRanking>; reply: boolean; onPick: (cls: string) => void }) {
  return (
    <table className="w-full table-fixed tabular-nums">
      <caption className="text-left font-medium">{title}</caption>
      <thead className="text-muted">
        <tr>
          <th scope="col" className="w-1/3 py-0.5 text-left font-normal">Hand</th>
          <th scope="col" className="py-0.5 text-right font-normal">{reply ? "All fold" : "Taken out"}</th>
          <th scope="col" className="py-0.5 text-right font-normal">{reply ? "Points" : "Combos"}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.cls}>
            <th scope="row" className="py-0.5 text-left font-normal">
              <button type="button" onClick={() => onPick(r.cls)} className="hover:underline" aria-label={`Pick ${r.cls}`}>
                {r.cls}
              </button>
            </th>
            <td className="py-0.5 text-right">{reply ? pct(r.effect.allAfter) : pct(r.move)}</td>
            <td className="py-0.5 text-right">{reply ? points(r.move) : r.effect.seats.reduce((s, x) => s + x.removed, 0).toFixed(1)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Detail({ ranges, name, reply }: { ranges: readonly PfRange[]; name: string; reply: boolean }) {
  const e = pfEffect(ranges, name);
  const whole = name.length === 4 ? "" : " on average over its combos";
  return (
    <div role="group" aria-label={`What ${name} blocks`} className="space-y-2">
      {reply && e.allBefore !== null && (
        <p className="tabular-nums">
          With <strong>{name}</strong>
          {whole}, {ranges.length === 1 ? `${ranges[0]!.who} folds` : "all fold"} <strong>{pct(e.allAfter)}</strong> of the time, against {pct(e.allBefore)} in the solve ({points(e.allAfter! - e.allBefore)} points).
        </p>
      )}
      <table className="w-full tabular-nums">
        <caption className="text-left font-medium">{`What ${name} takes out, by seat`}</caption>
        <thead className="text-muted">
          <tr>
            <th scope="col" className="py-0.5 text-left font-normal">Seat</th>
            <th scope="col" className="py-0.5 text-right font-normal">Out</th>
            <th scope="col" className="py-0.5 text-right font-normal">Of</th>
            {reply && <th scope="col" className="py-0.5 text-right font-normal">Folds</th>}
            {reply && <th scope="col" className="py-0.5 text-right font-normal">With it out</th>}
            <th scope="col" className="py-0.5 pl-2 text-left font-normal">{reply ? "Most taken out of the hands that don't fold" : "Most taken out of"}</th>
          </tr>
        </thead>
        <tbody>
          {e.seats.map((s, i) => (
            <tr key={s.who} className="align-top">
              <th scope="row" className="py-0.5 text-left font-normal">{s.who}</th>
              <td className="py-0.5 text-right">{s.removed.toFixed(1)}</td>
              <td className="py-0.5 text-right">{s.combos.toFixed(1)}</td>
              {reply && <td className="py-0.5 text-right">{pct(s.foldBefore)}</td>}
              {reply && <td className="py-0.5 text-right">{pct(s.foldAfter)}</td>}
              <td className="py-0.5 pl-2 text-left text-muted">
                {blockedClasses(ranges[i]!, name)
                  .map((b) => `${b.cls} ${b.removed.toFixed(1)} of ${b.of.toFixed(1)}`)
                  .join(", ") || "–"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
