// Engine diagnostics: what the solver runtime is, how it booted, and an end-to-end self-test.
import { useState } from "react";
import { useRuntime } from "@/solver/runtime";
import { useSolver } from "@/solver/useSolver";
import { ProvenanceBadge } from "@/components/ProvenanceBadge";
import type { SolveResult } from "@/solver/types";
import { WorkerTransport } from "@/solver/worker-transport";

export function EnginePage() {
  const status = useRuntime((s) => s.status);
  const manifest = useRuntime((s) => s.manifest);
  const getSolver = useSolver();
  const [test, setTest] = useState<{ ok: boolean; text: string; result?: SolveResult; ms?: number } | null>(null);

  const start = async () => {
    const c = await getSolver();
    if (c.transport instanceof WorkerTransport) c.transport.boot();
  };

  const selfTest = async () => {
    setTest({ ok: true, text: "Running…" });
    const t0 = performance.now();
    try {
      const c = await getSolver();
      // the 6-max UTG open decision: answered from the preflop charts
      const result = await c.solve({ state: { players: 6, stack: 100, board: "", preflop: [], flop: [], turn: [], river: [], study: true }, mode: "fast" });
      const ms = performance.now() - t0;
      const ok = result.data.study === "node" && result.data.actor === "UTG" && Boolean(result.data.grid);
      setTest({ ok, text: ok ? `UTG's opening range answered (${result.data.range_combos} combos)` : "Unexpected answer", result, ms });
    } catch (e) {
      setTest({ ok: false, text: e instanceof Error ? e.message : String(e) });
    }
  };

  const s = status.setup;
  return (
    <div className="max-w-3xl space-y-5">
      <h1 className="text-2xl font-semibold">Engine</h1>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1.5 rounded-lg border border-border bg-surface p-4 text-sm">
        <dt className="text-muted">Backend</dt>
        <dd>{status.transport === "worker" ? "In-browser (Python via Pyodide in a Web Worker)" : "Local Python server"}</dd>
        <dt className="text-muted">State</dt>
        <dd>
          {status.phase}
          {status.message && status.phase !== "ready" && status.phase !== "busy" ? ` — ${status.message}` : ""}
          {status.error ? <span className="text-danger"> — {status.error}</span> : null}
        </dd>
        <dt className="text-muted">Cross-origin isolated</dt>
        <dd>{typeof self !== "undefined" && self.crossOriginIsolated ? "yes (threads available)" : "no (single-threaded; stopping a solve restarts the engine)"}</dd>
        {s && (
          <>
            <dt className="text-muted">Compiled core</dt>
            <dd>
              {s.core ? `yes, ${s.threads} thread${s.threads === 1 ? "" : "s"}` : "no (numpy fallback)"} · multiway core {s.mwcore ? `yes, ${s.mwthreads}` : "no"}
            </dd>
            <dt className="text-muted">Boot (s)</dt>
            <dd className="font-mono">
              runtime {s.runtime} · numpy {s.numpy} · imports {s.imports} · advisors {s.advisors} · total {s.total}
              {s.bundle_cached ? " · bundle cached" : ""}
            </dd>
          </>
        )}
        <dt className="text-muted">Solver build</dt>
        <dd className="font-mono">
          {manifest ? (
            <>
              {manifest.version} · upstream {manifest.upstream.repo}@{manifest.upstream.commit.slice(0, 8)} · built {manifest.builtAt.slice(0, 10)}
            </>
          ) : (
            "manifest not loaded"
          )}
        </dd>
      </dl>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => void start()} className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface-2">
          Start engine
        </button>
        <button type="button" onClick={() => void selfTest()} className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-bg">
          Run self-test
        </button>
      </div>
      {test && (
        <div role="status" className={`rounded-lg border p-3 text-sm ${test.ok ? "border-accent/40" : "border-danger/40 text-danger"}`}>
          {test.text}
          {test.ms !== undefined && <span className="text-muted"> · {(test.ms / 1000).toFixed(2)} s round trip</span>}
          {test.result && (
            <div className="mt-2">
              <ProvenanceBadge p={test.result.provenance} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
