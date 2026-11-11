// Study's one-size view (oneSize.ts; the classic Simple view): under a heads-up solved node after the flop where the
// player to act can bet or raise, "One bet size" (or "One raise size") solves the street from there once per size and
// once with every size mixed, at Fast, one request a solve: progress with Stop and Continue, the verdict (the best
// single size and what it gives up), a row per size, and the strategy of the size picked. Turns and rivers start once
// opened; a flop (slower) waits to be asked. Leaving the node stops the run; what's in hand stays for the page's life.
import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import { ProvenanceBadge } from "@/components/ProvenanceBadge";
import { RangeMatrix } from "@/components/RangeMatrix";
import { actionFills, pct } from "@/components/actions";
import { studyRequest, type StudyHand } from "@/features/study/studyState";
import { oneSizeProvenance } from "@/solver/provenance";
import type { AdvisorResponse } from "@/solver/protocol";
import type { SolverClient } from "@/solver/client";
import { betShare, doneOf, etaOf, kindOf, runOf, sizeName, start, stop, summarize, totalOf, watch, type Ask, type OneSizeRow, type Run } from "./oneSize";

const evs = (x: number) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x).toFixed(2)}`;
const mixText = (r: OneSizeRow) =>
  r.actions
    .map((n, i) => ((r.freq[i] ?? 0) >= 0.005 ? `${n} ${pct(r.freq[i], 0)}` : ""))
    .filter(Boolean)
    .join(" · ");
// a row's swatch: the colour of its bet (or raise) among the row's own actions
const swatch = (r: OneSizeRow) => {
  const colors = actionFills(r.actions);
  const i = r.actions.findIndex((n) => !["check", "call", "fold"].includes(n));
  return i < 0 ? undefined : colors[i];
};

export function OneSizePanel({ hand, res, getSolver }: { hand: StudyHand; res: AdvisorResponse; getSolver: () => Promise<SolverClient> }) {
  const state = useMemo(() => studyRequest(hand), [hand]);
  const run = useMemo(() => runOf(state, res.street, kindOf(res.actions)), [state, res]);
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const [, bump] = useReducer((x: number) => x + 1, 0);
  const ask: Ask = useCallback(async (st, signal) => (await getSolver()).solve({ state: st, mode: "fast", signal }), [getSolver]);
  const go = useCallback(() => void start(run, state, ask, bump), [run, state, ask]);

  useEffect(() => {
    if (!open) return;
    const unwatch = watch(run, bump);
    // turns and rivers start (or carry on) by themselves; a flop once asked for, and nothing the Stop button stopped
    if ((run.status === "idle" && run.street !== "flop") || (run.status === "stopped" && !run.userStopped)) void start(run, state, ask, bump);
    return () => {
      unwatch();
      stop(run);
    };
  }, [open, run, state, ask]);

  const raise = run.kind === "raise", one = raise ? "raise size" : "size";
  if (!open)
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={`The best single ${one}, and what each gives up`}
        className="rounded border border-border px-2 py-0.5 text-sm text-muted hover:bg-surface-2"
      >
        One {raise ? "raise" : "bet"} size
      </button>
    );

  const m = run.meta ?? {}, sum = summarize(run), full = run.full;
  const best = sum.rows.find((r) => r.size === sum.best);
  const all = Boolean(run.candidates?.every((c) => run.rows[c]));
  const raiseTo = (s: string) => {
    const x = raise && s !== "all-in" ? m.raises?.[s] : undefined;
    return x ? <span className="text-muted"> to {x.to}</span> : null;
  };
  const shown = sel && (sel === "full" ? full : run.rows[sel]) ? sel : (sum.best ?? (full ? "full" : null));
  const r = shown === "full" ? full : shown ? run.rows[shown] : null;
  const rows = [...(full ? [full] : []), ...sum.rows];
  const prov = rows.length ? oneSizeProvenance(rows, run.prov, { total: totalOf(run), done: run.status === "done", targetPct: m.target_pct, seconds: run.secs.length ? run.secs.reduce((a, b) => a + b, 0) : undefined }) : null;
  return (
    <section aria-label={`One ${raise ? "raise" : "bet"} size`} className="w-full space-y-3 panel p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <strong>One {raise ? "raise" : "bet"} size</strong>
        <span className="text-muted">
          · {m.actor ? `${m.actor}'s ${m.street} decision` : `the ${run.street ?? ""} decision`}
          {m.pot_bb != null ? ` · pot ${m.pot_bb}bb, ${m.stack_bb}bb behind` : ""} · solved at Fast
        </span>
        <span className="flex-1" />
        {prov && <ProvenanceBadge p={prov} />}
        <button type="button" onClick={() => setOpen(false)} className="rounded px-2 py-0.5 text-muted hover:bg-surface-2">
          Close
        </button>
      </div>
      <Progress run={run} onGo={go} onStop={() => stop(run, true)} />
      {best && full && (
        <p>
          {all ? `Best single ${one}` : "Best so far"}: <b>{sizeName(best.size)}</b>
          {raiseTo(best.size)}
          {sum.tied.length > 0 && <span className="text-muted"> (tied: {sum.tied.map(sizeName).join(", ")})</span>} · gives up{" "}
          <b>{Math.max(0, best.loss_pct ?? 0).toFixed(2)}%</b> of the pot against every {one} mixed
        </p>
      )}
      {(full || sum.rows.length > 0) && (
        <div className="scroll-x">
          <table className="w-full max-w-md text-left text-xs">
            <thead className="text-muted">
              <tr>
                <th className="py-1 pr-2 font-normal">{raise ? "Raise" : "Size"}</th>
                <th className="py-1 pr-2 text-right font-normal">{raise ? "Raises" : "Bets"}</th>
                <th className="py-1 pr-2 text-right font-normal" title="The range's EV from here, bb">
                  EV
                </th>
                <th className="py-1 text-right font-normal" title={`EV lost against every ${one} mixed, % of the pot`}>
                  Gives up
                </th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {full && (
                <tr className={`border-t border-border text-muted ${shown === "full" ? "bg-surface-2" : ""}`}>
                  <td className="py-1 pr-2 font-sans">
                    <button type="button" aria-pressed={shown === "full"} onClick={() => setSel("full")} className="hover:underline">
                      Every size, mixed
                    </button>
                  </td>
                  <td className="py-1 pr-2 text-right">{pct(betShare(full), 0)}</td>
                  <td className="py-1 pr-2 text-right">{evs(full.ev_bb)}</td>
                  <td className="py-1 text-right">–</td>
                </tr>
              )}
              {sum.rows.map((row) => (
                <tr key={row.size} className={`border-t border-border ${shown === row.size ? "bg-surface-2" : ""}`}>
                  <td className="py-1 pr-2 font-sans">
                    <button type="button" aria-pressed={shown === row.size} onClick={() => setSel(row.size)} className={`inline-flex items-center gap-1.5 hover:underline ${row.size === sum.best || sum.tied.includes(row.size) ? "font-semibold" : ""}`}>
                      <i className="inline-block h-2 w-2 rounded-sm" style={{ background: swatch(row) }} />
                      {sizeName(row.size)}
                    </button>
                    {raiseTo(row.size)}
                    {row.size === sum.best && <span className="ml-1 rounded border border-accent px-1 text-[10px] text-accent">best</span>}
                  </td>
                  <td className="py-1 pr-2 text-right">{pct(betShare(row), 0)}</td>
                  <td className="py-1 pr-2 text-right">{evs(row.ev_bb)}</td>
                  <td className="py-1 text-right">
                    {row.loss_pct === null ? (
                      "–"
                    ) : row.cut ? (
                      <span title={`Stopped early: within ${row.exploitability_pct}% of the pot`}>≈{Math.max(0, row.loss_pct).toFixed(1)}%</span>
                    ) : (
                      `${row.loss_pct < 0 ? "0.00" : row.loss_pct.toFixed(2)}%`
                    )}
                  </td>
                </tr>
              ))}
              {(run.candidates ?? [])
                .filter((c) => !run.rows[c])
                .map((c) => (
                  <tr key={c} className="border-t border-border text-faint">
                    <td className="py-1 pr-2 font-sans">{sizeName(c)}</td>
                    <td colSpan={3} className="py-1 text-right">
                      {run.cur === c ? "solving…" : "waiting"}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
      {r && (
        <div className="space-y-2">
          <p className="text-xs">
            <b>{sizeName(r.size)}</b>: {mixText(r)}
          </p>
          <div className="max-w-md">
            <RangeMatrix cells={r.grid.cells} actions={r.grid.actions} colors={actionFills(r.grid.actions)} view="mix" caption={`${m.actor ?? ""} range, ${sizeName(r.size).toLowerCase()}`} />
          </div>
        </div>
      )}
      {(raise || m.target_pct != null || sum.rows.some((x) => x.cut) || m.tournament?.length) && (
        <p className="text-xs text-muted">
          {raise ? "Sizes: multiples of the bet faced. " : ""}
          {m.target_pct != null ? `Within ${m.target_pct}% of the pot: a tie. ` : ""}
          {sum.rows.some((x) => x.cut) ? "≈: stopped early, clearly behind. " : ""}
          {m.tournament?.length ? `EVs in chips of prize equity (ICM). ${m.tournament.join(" ")}` : ""}
        </p>
      )}
    </section>
  );
}

function Progress({ run, onGo, onStop }: { run: Run; onGo: () => void; onStop: () => void }) {
  const n = totalOf(run), d = doneOf(run), eta = Math.round(etaOf(run, run.prov?.transport === "http" ? "server" : "wasm"));
  const btn = "rounded border border-border px-2 py-0.5 hover:bg-surface-2";
  if (run.status === "idle" && run.street === "flop")
    return (
      <div className="flex flex-wrap items-center gap-2 text-muted">
        <span>
          {n} flop solves (each size alone, then all mixed), about {eta} s.
        </span>
        <button type="button" onClick={onGo} className={`${btn} text-text`}>
          Find the best size
        </button>
      </div>
    );
  if (run.status === "error")
    return (
      <div role="alert" className="flex flex-wrap items-center gap-2 text-danger">
        <span>{run.error}</span>
        {d < n && (
          <button type="button" onClick={onGo} className={btn}>
            Try again
          </button>
        )}
      </div>
    );
  if (run.status === "done") return null;
  const bar = (
    <div role="progressbar" aria-label="Solves done" aria-valuemin={0} aria-valuemax={n} aria-valuenow={d} className="h-1 w-full max-w-md overflow-hidden rounded bg-surface-3">
      <div className="h-full bg-accent" style={{ width: `${((d / n) * 100).toFixed(1)}%` }} />
    </div>
  );
  if (run.status === "running")
    return (
      <div className="space-y-1">
        <div role="status" className="flex flex-wrap items-center gap-2 text-muted">
          <span>
            Solving {run.cur ? sizeName(run.cur).toLowerCase() : "…"} · {d} of {n} done{d ? ` · about ${eta} s left` : ""}
          </span>
          <button type="button" onClick={onStop} className={btn}>
            Stop
          </button>
        </div>
        {bar}
      </div>
    );
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2 text-muted">
        <span>{d ? `Stopped: ${d} of ${n} solved, about ${eta} s left.` : `${n} solves, about ${eta} s.`}</span>
        <button type="button" onClick={onGo} className={`${btn} text-text`}>
          {d ? "Continue" : "Solve"}
        </button>
      </div>
      {bar}
    </div>
  );
}
