// ICM against chip EV (ROADMAP Phase 7, ahead of Phase 8's compare view): a tournament node asked again with no
// tournament (the same stacks, ante and line; no prizes, other tables or bounties), on request, and the two answers'
// actions side by side over the whole range, each with its own badge. The engine gives prize-equity EVs as chips worth
// as much, so the two EVs are in the same unit.
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { ProvenanceBadge } from "@/components/ProvenanceBadge";
import { evIn, evUnitLabel, pct, type EvUnit } from "@/components/actions";
import { compareLink } from "@/features/compare/compare";
import { tidySetup } from "@/features/solve/setup";
import type { SolverClient } from "@/solver/client";
import type { AdvisorResponse } from "@/solver/protocol";
import { SolverError, type SolveMode, type SolveResult } from "@/solver/types";
import { studyRequest, type StudyHand } from "./studyState";

type State = { kind: "idle" } | { kind: "loading" } | { kind: "done"; result: SolveResult } | { kind: "error"; message: string };

/** The hand in chips: its setup without the tournament. */
export const chipHand = (h: StudyHand): StudyHand => {
  const out: StudyHand = { ...h };
  delete out.setup;
  const setup = tidySetup({ ...h.setup, tournament: undefined });
  return setup ? { ...out, setup } : out;
};

export function ChipCompare({
  hand,
  mode,
  getSolver,
  prize,
  evUnit,
}: {
  hand: StudyHand;
  mode: SolveMode;
  getSolver: () => Promise<SolverClient>;
  /** the tournament answer, complete */
  prize: SolveResult;
  evUnit: EvUnit;
}) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  const ask = async () => {
    const ac = new AbortController();
    abort.current = ac;
    setState({ kind: "loading" });
    try {
      const client = await getSolver();
      const result = await client.solve({ state: studyRequest(chipHand(hand)), mode, signal: ac.signal });
      if (!ac.signal.aborted) setState({ kind: "done", result });
    } catch (e) {
      if (ac.signal.aborted) return;
      setState({ kind: "error", message: e instanceof SolverError && e.kind === "cancelled" ? "Stopped." : e instanceof Error ? e.message : String(e) });
    }
  };

  if (state.kind === "idle")
    return (
      <p className="text-xs text-muted">
        <button type="button" onClick={() => void ask()} className="rounded border border-border px-2 py-0.5 text-text hover:bg-surface-2">
          Compare with chip EV
        </button>{" "}
        The same spot in chips: the same stacks, ante and line, with no prizes, other tables or bounties.
      </p>
    );
  if (state.kind === "loading")
    return (
      <p role="status" className="text-xs text-muted">
        Finding the answer in chip EV…{" "}
        <button type="button" onClick={() => abort.current?.abort()} className="underline hover:text-text">
          Stop
        </button>
      </p>
    );
  if (state.kind === "error")
    return (
      <p role="alert" className="text-xs text-danger">
        Chip EV: {state.message}
      </p>
    );

  const p: AdvisorResponse = prize.data;
  const c: AdvisorResponse = state.result.data;
  const names = [...new Set([...(p.actions ?? []).map((a) => a.action), ...(c.actions ?? []).map((a) => a.action)])];
  const of = (r: AdvisorResponse, n: string) => r.actions?.find((a) => a.action === n);
  const unit = evUnitLabel(evUnit, p.pot_bb);
  const cell = (r: AdvisorResponse, n: string) => {
    const a = of(r, n);
    if (!a) return "–";
    return `${pct(a.freq)}${typeof a.ev_bb === "number" ? ` · EV ${a.rough_ev ? "≈" : ""}${evIn(a.ev_bb, evUnit, r.pot_bb)}` : ""}`;
  };
  return (
    <section aria-label="Chip EV comparison" className="space-y-2 rounded-md border border-border bg-surface px-3 py-2 text-xs">
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead className="text-muted">
            <tr>
              <th className="py-1 pr-3 font-normal">{p.actor ?? "Action"}, whole range</th>
              <th className="py-1 pr-3 font-normal">Prize equity</th>
              <th className="py-1 font-normal">Chip EV</th>
            </tr>
          </thead>
          <tbody className="font-mono">
            {names.map((n) => (
              <tr key={n} className="border-t border-border">
                <td className="py-1 pr-3 font-sans font-medium">{n}</td>
                <td className="py-1 pr-3">{cell(p, n)}</td>
                <td className="py-1">{cell(c, n)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-muted">EVs in {unit}; prize equity's as chips worth as much. Each answer's source:</p>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted">Prize equity</span> <ProvenanceBadge p={prize.provenance} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted">Chip EV</span> <ProvenanceBadge p={state.result.provenance} />
      </div>
      <p>
        <Link to={compareLink(hand, chipHand(hand))} className="underline hover:text-text">
          Every hand class, prize equity against chips
        </Link>{" "}
        <span className="text-muted">(Compare: each class's change in frequency and EV)</span>
      </p>
    </section>
  );
}
