// Study's preflop Solver source on the page (pfSolve.ts; classic study.js pfHtml, pfProgHtml, pfPanelHtml and
// solverHtml): the Charts | Solver toggle, the offer to solve a game the engine holds no solve of (never started by
// itself: it runs only on the Solve button, with Stop), the progress line while it runs, and what a node from the solve
// is: the solve's own equilibrium of its class-level model, not the charts the advice plays.
import { useState } from "react";
import { rowKeys } from "@/components/rowKeys";
import type { AdvisorResponse } from "@/solver/protocol";
import { pfFraction, pfMinutes, pfStalled, pfStatusOf, type PfRun } from "./pfSolve";
import { describePfSizes, PF_SIZE, PF_SIZE_KEYS, pfSizeProblems, type PfSizeKey, type PfSizes } from "./pfSizes";

export type PfSource = "charts" | "solver";

export function PreflopSource({ value, onChange }: { value: PfSource; onChange: (v: PfSource) => void }) {
  const opts: [PfSource, string, string][] = [
    ["charts", "Charts", "Hand-written charts, no EVs"],
    ["solver", "Solver", "Class-level preflop solve, with EVs"],
  ];
  return (
    <div role="radiogroup" aria-label="Preflop source" onKeyDown={rowKeys("radio", (i) => onChange(opts[i]![0]))} className="inline-flex rounded-md border border-border bg-surface-2 p-0.5 text-sm">
      {opts.map(([id, label, hint]) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={value === id}
          tabIndex={value === id ? 0 : -1}
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

/** The solve's raise sizes (classic study.js's game form): blank is the default; Apply makes it another game, which
 * the precomputed solves don't hold. */
export function PfSizesForm({ value, onApply }: { value: PfSizes | undefined; onApply: (s: PfSizes | undefined) => void }) {
  const [typed, setTyped] = useState<Record<PfSizeKey, string>>(
    () => Object.fromEntries(PF_SIZE_KEYS.map((k) => [k, value?.[k] !== undefined ? String(value[k]) : ""])) as Record<PfSizeKey, string>,
  );
  const sizes: PfSizes = Object.fromEntries(PF_SIZE_KEYS.filter((k) => typed[k].trim()).map((k) => [k, Number(typed[k])]));
  const problems = pfSizeProblems(sizes);
  const custom = describePfSizes(value);
  return (
    <details className="text-sm open:basis-full">
      <summary className="cursor-pointer rounded-md border border-border bg-surface-2 px-2.5 py-1 text-muted hover:text-text">Sizes{custom ? `: ${custom}` : ""}</summary>
      <form
        aria-label="Preflop solve sizes"
        className="mt-2 space-y-2 panel p-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!problems.length) onApply(sizes);
        }}
      >
        <div className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
          {PF_SIZE_KEYS.map((k) => {
            const { label, unit, lo, hi, def, hint } = PF_SIZE[k];
            return (
              <label key={k} className="flex items-center gap-2" title={hint}>
                <span className="w-20 shrink-0">{label}</span>
                <input
                  aria-label={label}
                  type="number"
                  inputMode="decimal"
                  step={0.1}
                  min={lo}
                  max={hi}
                  placeholder={String(def)}
                  value={typed[k]}
                  onChange={(e) => setTyped((t) => ({ ...t, [k]: e.target.value }))}
                  className="w-20 rounded-md border border-border bg-surface-2 px-2 py-1 font-mono"
                />
                <span className="text-xs text-muted">
                  {unit} ({lo}–{hi})
                </span>
              </label>
            );
          })}
        </div>
        {problems.length > 0 && (
          <ul role="alert" className="list-disc pl-5 text-xs text-danger">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" disabled={problems.length > 0} className="rounded bg-accent px-3 py-1 font-medium text-bg disabled:opacity-40">
            Apply
          </button>
          <button type="button" onClick={() => onApply(undefined)} className="rounded border border-border px-2 py-0.5 hover:bg-surface-2">
            Defaults
          </button>
        </div>
        <p className="text-xs text-muted">Non-default sizes solve in your browser.</p>
      </form>
    </details>
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
    <div role="status" aria-label="Preflop solve" className="space-y-1.5 panel px-3 py-2 text-sm">
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
          <button type="button" onClick={onStop} title="Answers so far stay" className="rounded border border-border px-2 py-0.5 hover:bg-surface-2">
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
      <div className="space-y-2 panel p-3 text-sm">
        <p>The preflop solve doesn't take this game: {String(res.reason ?? "")}.</p>
        <button type="button" onClick={onCharts} className="rounded border border-border px-2 py-0.5 hover:bg-surface-2">
          Use the charts
        </button>
      </div>
    );
  const est = typeof res.estimate_s === "number" ? res.estimate_s : 60;
  return (
    <section aria-label="Solve this game's preflop" className="space-y-2 panel p-3 text-sm">
      <p>
        <b>Solve this game's preflop</b>: {String(res.game ?? "")}.
      </p>
      <p className="text-muted">Class-level model, about {pfMinutes(est)} in your browser.</p>
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
    <div role="group" aria-label="About the preflop solve" className="space-y-1 text-xs text-muted">
      {pfStalled(p) && <p>Stopped above its {num(p.target_mbb ?? 0)} mbb target.</p>}
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
          Rarely played line: EVs rough (range gives up {typeof res.regret_bb === "number" ? res.regret_bb.toFixed(3) : "?"}bb a hand here).
        </p>
      ) : null}
    </div>
  );
}
