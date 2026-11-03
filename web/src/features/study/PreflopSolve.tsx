// Study's preflop Solver source on the page (pfSolve.ts; classic study.js pfHtml, pfProgHtml, pfPanelHtml and
// solverHtml): the Charts | Solver toggle, the offer to solve a game the engine holds no solve of (never started by
// itself: it runs only on the Solve button, with Stop), the progress line while it runs, and what a node from the solve
// is: the solve's own equilibrium of its class-level model, not the charts the advice plays.
import type { AdvisorResponse } from "@/solver/protocol";
import { PF_STALL_BACK, pfFraction, pfMinutes, pfStalled, pfStatusOf, type PfRun } from "./pfSolve";

export type PfSource = "charts" | "solver";

export function PreflopSource({ value, onChange }: { value: PfSource; onChange: (v: PfSource) => void }) {
  const opts: [PfSource, string, string][] = [
    ["charts", "Charts", "The hand-written charts the advice plays: a mix with no EVs"],
    ["solver", "Solver", "A solve of this game's preflop (a class-level model): every hand's mix and EVs, run only when you ask"],
  ];
  return (
    <div role="radiogroup" aria-label="Preflop source" className="inline-flex rounded-md border border-border bg-surface-2 p-0.5 text-sm">
      {opts.map(([id, label, hint]) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={value === id}
          title={hint}
          onClick={() => onChange(id)}
          className={`rounded px-2.5 py-1 ${value === id ? "bg-surface-3 text-text" : "text-muted hover:text-text"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

const num = (x: number) => (Math.abs(x) >= 10 ? x.toFixed(1) : x.toFixed(2));

/** A solve running (or stopped by an error): its iterations, distance and time, Stop, and a bar. */
export function PfProgress({ run, onStop }: { run: PfRun; onStop: () => void }) {
  if (run.err)
    return (
      <div role="alert" className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
        The preflop solve stopped: {run.err}
      </div>
    );
  const frac = pfFraction(run);
  return (
    <div role="status" aria-label="Preflop solve" className="space-y-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent" />
        <span>
          Solving this game's preflop: <b>{run.it}</b> iterations
          {run.mbb != null ? `, ${num(run.mbb)} mbb/hand from equilibrium` : ""} · {Math.round(run.secs)} s
        </span>
        <span className="flex-1" />
        {run.stop ? (
          <span className="text-muted">Stopping after this chunk…</span>
        ) : (
          <button type="button" onClick={onStop} title="Stop here: the answers so far stay" className="rounded border border-border px-2 py-0.5 hover:bg-surface-2">
            Stop
          </button>
        )}
      </div>
      <div role="progressbar" aria-label="Preflop solve progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(frac * 100)} className="h-1.5 overflow-hidden rounded bg-surface-3">
        <div className="h-full bg-accent transition-[width]" style={{ width: `${(frac * 100).toFixed(1)}%` }} />
      </div>
    </div>
  );
}

/** A game the engine holds no solve of (the offer to solve it: about how long, what it gives), or one it doesn't take. */
export function PfPanel({ res, running, onSolve, onCharts }: { res: AdvisorResponse; running: boolean; onSolve: () => void; onCharts: () => void }) {
  if (res.study === "pf_none")
    return (
      <div className="space-y-2 rounded-lg border border-border bg-surface p-3 text-sm">
        <p>The preflop solve doesn't take this game: {String(res.reason ?? "")}.</p>
        <button type="button" onClick={onCharts} className="rounded border border-border px-2 py-0.5 hover:bg-surface-2">
          Use the charts
        </button>
      </div>
    );
  const est = typeof res.estimate_s === "number" ? res.estimate_s : 60;
  return (
    <section aria-label="Solve this game's preflop" className="space-y-2 rounded-lg border border-border bg-surface p-3 text-sm">
      <p>
        <b>Solve this game's preflop</b>: {String(res.game ?? "")}.
      </p>
      <p className="text-muted">
        Every hand's mix and EVs at every preflop decision, at the equilibrium of a class-level model (flops valued by the flop library's realization; no ICM). About{" "}
        {pfMinutes(est)} in your browser, on one core; the strategy shows as it converges, and you can stop any time. It runs only when you ask.
      </p>
      {!running && (
        <button type="button" onClick={onSolve} className="rounded bg-accent px-3 py-1 font-medium text-bg">
          Solve
        </button>
      )}
    </section>
  );
}

/** What a node from the preflop solve is (classic solverHtml), and Continue for one that isn't finished. */
export function PfNote({ res, running, onContinue }: { res: AdvisorResponse; running: boolean; onContinue: () => void }) {
  const p = pfStatusOf(res);
  if (!p) return null;
  return (
    <div aria-label="About the preflop solve" className="space-y-1 text-xs text-muted">
      <p>
        Preflop solve of this game ({p.label}): {p.cached ? "solved earlier in this browser, " : p.stored ? "precomputed, " : ""}
        {p.iterations} iterations{p.mbb != null ? `, ${num(p.mbb)} mbb/hand from equilibrium (a seat's average)` : ""}
        {pfStalled(p)
          ? `; it stopped there, getting no nearer in ${PF_STALL_BACK} iterations (the model's three-way pots keep some games above the ${num(p.target_mbb ?? 0)} mbb target, though their numbers settle)`
          : ""}
        . The solve's own equilibrium of a class-level model (its flops valued by the flop library's realization), not the charts: the advice plays the charts, which
        fit published solves better.
      </p>
      {!p.done && (
        <p className="text-warn">
          Not finished: the numbers can still move.{" "}
          {!running && (
            <button type="button" onClick={onContinue} className="rounded border border-border px-2 py-0.5 text-text hover:bg-surface-2">
              Continue the solve
            </button>
          )}
        </p>
      )}
      {res.rough ? (
        <p className="text-warn">
          A line the solve rarely or never plays: the mix here is barely solved (the range gives up {typeof res.regret_bb === "number" ? res.regret_bb.toFixed(3) : "?"}bb a hand
          to its best actions here), so take its EVs as rough.
        </p>
      ) : null}
    </div>
  );
}
