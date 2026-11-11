// Engine diagnostics: what the solver runtime is, how it booted, an end-to-end self-test, and the check that plays a run
// of hands on this solver. The check's three settings are this page's, read off Settings and never written back, so a run
// here changes nothing of Practice's.
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { ASK_AHEAD } from "@/features/practice/ahead";
import { loadManifest, solverVersionOf, useRuntime } from "@/solver/runtime";
import { useSolver } from "@/solver/useSolver";
import { ProvenanceBadge } from "@/components/ProvenanceBadge";
import { useSettings } from "@/state/settings";
import type { SolveResult } from "@/solver/types";
import { sharesStop, WorkerTransport } from "@/solver/worker-transport";
import { aheadLine, lastReport, progressLine, reportLine, runHandsCheck, setupLine, warmLine, whenLine, type HandsCheckProgress, type HandsCheckReport } from "./handsCheck";

const CHECK_HANDS = 20;
/** always these deals, so runs at the same number of tables play the same hands (a seat is drawn only above one table) */
const CHECK_SEED = 20_260_001;
const THINK_MS = 3000;
/** ms a press is ignored as Play and Stop change places: they're one button to React, so a double-click would press both */
const SWAP_MS = 350;

const secs = (x: number | null) => (x === null ? "none" : `${x.toFixed(2)} s`);

function CheckReport({ r }: { r: HandsCheckReport }) {
  // (read here: a kept report is on the page before any solver has been asked for)
  const [build, setBuild] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean | null>(null);
  useEffect(() => {
    void loadManifest().then((m) => {
      if (m) setBuild(solverVersionOf(m));
    });
  }, []);
  const copy = async () => {
    // (emptied first, so a second Copied is said too)
    setCopied(null);
    try {
      await navigator.clipboard.writeText(JSON.stringify(r, null, 2));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  const ahead = aheadLine(r);
  const warm = warmLine(r);
  const sources = Object.entries(r.bySource).sort((a, b) => b[1] - a[1]);
  return (
    <section aria-label="Last report" className={`space-y-3 rounded-lg border p-3 text-sm ${r.passed ? "border-accent/40" : "border-danger/40"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className={`font-medium ${r.passed ? "" : "text-danger"}`}>{r.stopped ? "Stopped" : r.passed ? "Passed" : "Failed"}</h2>
        <div className="flex items-center gap-2">
          <span role="status" className="text-xs text-muted">
            {copied === null ? "" : copied ? "Copied" : "Couldn't copy"}
          </span>
          <button type="button" onClick={() => void copy()} className="rounded-md border border-border px-2 py-1 text-xs hover:bg-surface-2">
            Copy report
          </button>
        </div>
      </div>
      <p>
        {reportLine(r)}
        {r.stopped ? ` · stopped at ${r.hands} of ${r.of}` : ""}
      </p>
      <p className="text-muted">{setupLine(r)}</p>
      <p className="text-muted">{whenLine(r, build)}</p>
      {warm && <p className="text-warn">{warm}</p>}
      <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1">
        <dt className="text-muted">Transport</dt>
        <dd>
          {r.transport === null ? "none reached" : r.transport === "worker" ? "In-browser (Python via Pyodide in a Web Worker)" : "Local Python server"}
          {r.isolated ? " · cross-origin isolated" : " · not isolated"}
        </dd>
        <dt className="text-muted">Deals</dt>
        <dd className="font-mono">{r.fingerprint}</dd>
        <dt className="text-muted">Answer after your turn arrives, postflop</dt>
        <dd>
          median {secs(r.waits.medianS)} · p90 {secs(r.waits.p90S)} · {r.waits.n} spots
        </dd>
        <dt className="text-muted">Seconds per request</dt>
        <dd>
          median {secs(r.requests.medianS)} · postflop {secs(r.requests.postflopMedianS)}
        </dd>
        <dt className="text-muted">Requests reaching the solver</dt>
        <dd>
          {r.requests.reached}, {r.requests.stopped} of them stopped
        </dd>
        {ahead && (
          <>
            <dt className="text-muted">Asked ahead</dt>
            <dd>{ahead}</dd>
          </>
        )}
      </dl>
      <div>
        <h3 className="text-muted">Verdicts by what answered</h3>
        <ul>
          {sources.map(([label, n]) => (
            <li key={label}>
              {label}: {n}
            </li>
          ))}
        </ul>
      </div>
      {r.gap.length > 0 && (
        <div>
          <h3 className="text-muted">Estimate against time taken, medians</h3>
          <ul>
            {r.gap.map((g) => (
              <li key={g.street}>
                {g.street}: estimated {secs(g.estS)}, took {secs(g.s)} ({g.n})
              </li>
            ))}
          </ul>
        </div>
      )}
      {r.failures.length > 0 && (
        <div>
          <h3 className="text-danger">What failed</h3>
          <ul className="space-y-1">
            {r.failures.map((f, i) => (
              <li key={i}>
                {f.text}
                {f.study !== undefined && (
                  <>
                    {" "}
                    <Link to={`/study?${f.study}`} className="inline-block text-accent hover:underline">
                      Open in Study
                    </Link>
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-xs text-muted">Times from this browser, this run.</p>
    </section>
  );
}

function HandsCheck() {
  const getSolver = useSolver();
  const saved = useSettings((s) => s.askAhead);
  const [tables, setTables] = useState(4);
  const [thinkMs, setThinkMs] = useState(0);
  // (null: nothing chosen here, so as Settings read)
  const [ahead, setAhead] = useState<boolean | null>(null);
  const [running, setRunning] = useState(false);
  const [line, setLine] = useState("");
  const [said, setSaid] = useState("");
  const [report, setReport] = useState<HandsCheckReport | null>(null);
  const stopper = useRef<AbortController | null>(null);
  const swapped = useRef(-Infinity);
  // (as in Practice: where a stop would end the solver nothing's asked ahead, so the box can't say it will be. It's
  // worked out here as this page asks for no solver until you press something)
  const kills = useSettings((s) => s.transport) !== "http" && !sharesStop();
  const askAhead = !kills && (ahead ?? saved ?? ASK_AHEAD);

  useEffect(() => {
    let live = true;
    void lastReport().then((r) => {
      // (nor over a run that's begun: it cleared the page for its own)
      if (live && r && !stopper.current) setReport((now) => now ?? r);
    });
    return () => {
      live = false;
      // (leaving ends a run)
      stopper.current?.abort();
    };
  }, []);

  const play = async () => {
    const ac = new AbortController();
    stopper.current = ac;
    swapped.current = performance.now();
    setReport(null);
    setRunning(true);
    const first = progressLine({ hands: 0, of: CHECK_HANDS, verdicts: 0, errors: 0 });
    setLine(first);
    setSaid(first);
    // (the page moves with each verdict, and what's read out with each hand, or every verdict would be)
    let hand = 0;
    const onProgress = (p: HandsCheckProgress) => {
      setLine(progressLine(p));
      if (p.hands === hand) return;
      hand = p.hands;
      setSaid(progressLine(p));
    };
    const r = await runHandsCheck(getSolver, { seed: CHECK_SEED, hands: CHECK_HANDS, tables, askAhead, thinkMs, signal: ac.signal, onProgress });
    stopper.current = null;
    swapped.current = performance.now();
    setRunning(false);
    setSaid(`${r.stopped ? "Stopped" : r.passed ? "Passed" : "Failed"}: ${reportLine(r)}`);
    setReport(r);
  };
  const settled = () => performance.now() - swapped.current >= SWAP_MS;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
        {running ? (
          <button type="button" onClick={() => settled() && stopper.current?.abort()} className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface-2">
            Stop
          </button>
        ) : (
          <button type="button" onClick={() => settled() && void play()} className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface-2">
            Play {CHECK_HANDS} hands
          </button>
        )}
        <label className="flex items-center gap-1">
          <span className="text-muted">Tables</span>
          <select value={tables} disabled={running} onChange={(e) => setTables(Number(e.target.value))} className="rounded border border-border bg-surface-2 px-1.5 py-1">
            <option value={1}>1</option>
            <option value={4}>4</option>
          </select>
        </label>
        <label className="flex items-center gap-1">
          <span className="text-muted">Time to think</span>
          <select value={thinkMs} disabled={running} onChange={(e) => setThinkMs(Number(e.target.value))} className="rounded border border-border bg-surface-2 px-1.5 py-1">
            <option value={0}>None</option>
            <option value={THINK_MS}>{THINK_MS / 1000} s</option>
          </select>
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={askAhead} disabled={running || kills} onChange={(e) => setAhead(e.target.checked)} />
          <span className="text-muted">Ask ahead</span>
        </label>
        {kills && <span className="text-xs text-muted">Off: this browser can&rsquo;t stop a solve.</span>}
      </div>
      <p className="text-sm text-muted">A few minutes of CPU; nothing saved. Reload first for a cold run.</p>
      {running && (
        <p aria-hidden className="text-sm">
          {line}
        </p>
      )}
      {/* (always here, so a reader is told each hand and the end, which the report then shows) */}
      <p role="status" className="sr-only">
        {said}
      </p>
      {report && <CheckReport r={report} />}
    </div>
  );
}

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
        {status.transport === "worker" && (
          <>
            <dt className="text-muted">Runtime</dt>
            <dd>
              <a href="https://github.com/pyodide/pyodide" className="underline" target="_blank" rel="noreferrer">
                Pyodide 0.26.4
              </a>{" "}
              (MPL-2.0, CPython under the PSF licence) with{" "}
              <a href="https://github.com/numpy/numpy" className="underline" target="_blank" rel="noreferrer">
                NumPy 1.26.4
              </a>{" "}
              (BSD), served unchanged from this site, each file checked by hash when the site is built.
            </dd>
          </>
        )}
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
      <HandsCheck />
    </div>
  );
}
