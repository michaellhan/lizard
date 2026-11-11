// Study's automatic sizing (ROADMAP Phase 6; autoSize.ts): under a heads-up solved node after the flop where the player
// to act can bet, "Choose bet sizes" asks one hand's advice with the engine's optimize_sizes. The answer: the first
// solve's wide menu with how much of the range bets each size there and which sizes were kept, the hand's advice and the
// range's mix at the kept sizes, and a link to the Compare page with this spot's menu as A and the kept one as B (the
// range's EV on each, measured there). Study's own answer above keeps this spot's menu.
import { useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { ProvenanceBadge } from "@/components/ProvenanceBadge";
import { pct } from "@/components/actions";
import { compareLink } from "@/features/compare/compare";
import type { SizeStreet } from "@/features/solve/setup";
import type { AdvisorResponse } from "@/solver/protocol";
import type { SolverClient } from "@/solver/client";
import { SolverError, type SolveMode, type SolveResult } from "@/solver/types";
import { autoSizeRequest, keptMenu, usageOf } from "./autoSize";
import { betMenuOf, withMenu } from "./CompareLinks";
import { holesOf } from "./LockPanel";
import { studyRequest, type StudyHand } from "./studyState";

type Run = { kind: "idle" } | { kind: "running" } | { kind: "error"; message: string } | { kind: "done"; result: SolveResult; hole: string };

export function AutoSizePanel({ hand, res, cls, mode, getSolver }: { hand: StudyHand; res: AdvisorResponse; cls: string | null; mode: SolveMode; getSolver: () => Promise<SolverClient> }) {
  const actor = res.actor!;
  const holes = useMemo(() => holesOf(res, cls), [res, cls]);
  const [picked, setPicked] = useState<string | null>(null);
  const hole = picked && holes.includes(picked) ? picked : (holes[0] ?? null);
  const [run, setRun] = useState<Run>({ kind: "idle" });
  const abort = useRef<AbortController | null>(null);
  const bets = betMenuOf(hand, res);

  const ask = async () => {
    if (!hole) return;
    abort.current?.abort();
    const ac = new AbortController();
    abort.current = ac;
    try {
      const client = await getSolver();
      setRun({ kind: "running" });
      const result = await client.solve({ state: autoSizeRequest(studyRequest(hand), actor, hole), mode, signal: ac.signal });
      setRun({ kind: "done", result, hole });
    } catch (e) {
      setRun({ kind: "error", message: e instanceof SolverError && e.kind === "cancelled" ? "Stopped." : e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <details className="w-full rounded-lg border border-border bg-surface p-3 text-sm">
      <summary className="cursor-pointer font-medium">Choose bet sizes (automatic sizing)</summary>
      <div className="mt-2 space-y-3">
        <form
          aria-label="Automatic sizing"
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void ask();
          }}
        >
          <label className="flex items-center gap-1">
            {actor} holds
            <select aria-label="Hand" value={hole ?? ""} onChange={(e) => setPicked(e.target.value)} className="rounded border border-border bg-surface px-1.5 py-0.5 font-mono">
              {holes.map((h) => (
                <option key={h}>{h}</option>
              ))}
            </select>
          </label>
          <button type="submit" disabled={!hole || run.kind === "running"} className="rounded border border-border px-2 py-0.5 hover:bg-surface-2 disabled:opacity-50">
            Choose sizes
          </button>
          {run.kind === "running" && (
            <>
              <span role="status" className="text-xs text-muted">
                Solving over the wide menu, then the kept sizes…
              </span>
              <button type="button" onClick={() => abort.current?.abort()} className="rounded border border-border px-2 py-0.5 text-xs hover:bg-surface-2">
                Stop
              </button>
            </>
          )}
          <span className="text-xs text-muted">{cls ? "" : "(select a class)"}</span>
        </form>
        {run.kind === "error" && (
          <p role="alert" className="text-xs text-danger">
            {run.message}
          </p>
        )}
        {run.kind === "done" && <AutoSizeAnswer result={run.result} hole={run.hole} actor={actor} hand={hand} bets={bets} />}
      </div>
    </details>
  );
}

function AutoSizeAnswer({ result, hole, actor, hand, bets }: { result: SolveResult; hole: string; actor: string; hand: StudyHand; bets: { street: SizeStreet; now: number[] } | null }) {
  const R: AdvisorResponse = result.data;
  if (typeof R.error === "string") return <p role="alert" className="text-xs text-danger">{R.error}</p>;
  const u = usageOf(R);
  const range = (R.range_action_freq ?? {}) as Record<string, number>;
  const menu = u ? keptMenu(u.kept) : null;
  const vs = bets && menu ? withMenu(hand, bets.street, bets.now, menu.join(", ")) : null;
  return (
    <section aria-label="Sizes chosen" className="space-y-3">
      <ProvenanceBadge p={result.provenance} />
      {u ? (
        <>
          <p>
            Kept: <span className="font-medium">{u.kept.join(", ")}</span>
            {u.custom.length > 0 && <span className="text-muted"> (your {R.street} sizes {u.custom.join(", ")} were in the menu)</span>}
          </p>
          <div className="scroll-x">
            <table className="w-full text-left text-xs" aria-label="The wide menu">
              <thead className="text-muted">
                <tr>
                  <th className="py-1 pr-3 font-normal">First solve's menu</th>
                  <th className="py-1 pr-3 font-normal">{actor}'s range there</th>
                  <th className="py-1 font-normal">Kept</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {u.check !== null && (
                  <tr className="border-t border-border">
                    <td className="py-1 pr-3 font-sans">check</td>
                    <td className="py-1 pr-3">{pct(u.check)}</td>
                    <td className="py-1">–</td>
                  </tr>
                )}
                {u.rows.map((r) => (
                  <tr key={r.size} className={`border-t border-border ${r.kept ? "font-medium" : "text-muted"}`}>
                    <td className="py-1 pr-3 font-sans">{r.size}</td>
                    <td className="py-1 pr-3">{pct(r.use)}</td>
                    <td className="py-1 font-sans">{r.kept ? "kept" : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted">First solve: one street deep, distance from equilibrium not measured.</p>
        </>
      ) : (
        <p className="text-xs">The engine kept this spot's menu: {(R.notes ?? []).find((n) => n.includes("optimized only")) ?? "it chose no sizes here"}.</p>
      )}
      <div className="scroll-x">
        <table className="w-full text-left text-xs" aria-label="At the kept sizes">
          <thead className="text-muted">
            <tr>
              <th className="py-1 pr-3 font-normal">{u ? "At the kept sizes" : actor}</th>
              <th className="py-1 pr-3 font-normal">{hole}</th>
              <th className="py-1 font-normal">Range</th>
            </tr>
          </thead>
          <tbody className="font-mono">
            {(R.actions ?? []).map((a) => (
              <tr key={a.action} className="border-t border-border">
                <td className="py-1 pr-3 font-sans font-medium">{a.action}</td>
                <td className="py-1 pr-3">
                  {pct(a.freq)}
                  {typeof a.ev_bb === "number" ? ` · EV ${a.rough_ev ? "≈" : ""}${a.ev_bb.toFixed(2)}bb` : ""}
                </td>
                <td className="py-1">{pct(range[a.action])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {u && (
        <p className="text-xs text-muted">
          {vs?.b ? (
            <>
              The range's EV with each menu:{" "}
              <Link to={compareLink(hand, vs.b)} className="underline hover:text-text" title="A: this menu, B: kept sizes">
                compare the kept sizes with this spot's
              </Link>
              .
            </>
          ) : vs?.problem === "the same menu as this spot's" ? (
            "The kept sizes are this spot's menu."
          ) : menu ? (
            `No comparison: ${vs?.problem ?? "this spot's menu isn't known"}.`
          ) : (
            "No comparison: the all-in was kept, and a menu is typed in % of the pot."
          )}
        </p>
      )}
      {(R.notes ?? []).length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted">
          {(R.notes ?? []).map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
