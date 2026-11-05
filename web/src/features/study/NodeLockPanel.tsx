// A true node lock on the node Study shows (ROADMAP Phase 6; engine/study_lock.py): the node's actions with a mix to
// hold, whom it holds, and the street and below re-solved around it, the result beside the unlocked answer. Not the
// read above it (LockPanel): that's a best response with the opponent standing still; here both players adjust, the
// locked player's other decisions too, and the answer is an equilibrium of the restricted game, labelled so.
import { useEffect, useMemo, useRef, useState } from "react";
import { ProvenanceBadge } from "@/components/ProvenanceBadge";
import { pct } from "@/components/actions";
import { NodeLockError, type SolverClient } from "@/solver/client";
import type { AdvisorResponse, NodeLockChange, NodeLockAnswer, NodeLockProgress } from "@/solver/protocol";
import { SolverError, type SolveMode, type SolveResult } from "@/solver/types";
import { holesOf } from "./LockPanel";
import { actionRows, combosNamed, costWords, exploitWords, handsOf, memoryNote, mixOf, nodeActions, nodeLockRefusal, scopeNote, startingMix, unlockedProvenance, valueRows, type LockScope } from "./nodeLock";
import { studyRequest, type StudyHand } from "./studyState";

type Run =
  | { kind: "idle" }
  | { kind: "running"; progress: NodeLockProgress | null }
  | { kind: "error"; message: string }
  | { kind: "done"; result: SolveResult<NodeLockAnswer> };

// (a figure that rounds to nothing has no sign: "-0.00" reads as a change)
const signed = (x: number, digits = 2) => {
  const t = x.toFixed(digits);
  return Number(t) === 0 ? Number(0).toFixed(digits) : `${x > 0 ? "+" : ""}${t}`;
};
const points = (x: number | null) => (x === null ? "–" : signed(x * 100, 1));

export interface NodeLockPanelProps {
  hand: StudyHand;
  res: AdvisorResponse;
  /** the class picked in the grid: where the hand scopes start */
  cls: string | null;
  mode: SolveMode;
  getSolver: () => Promise<SolverClient>;
}

export function NodeLockPanel({ hand, res, cls, mode, getSolver }: NodeLockPanelProps) {
  const refusal = nodeLockRefusal(res, Boolean(hand.setup?.tournament));
  const title = "Hold this node at a mix (true node lock)";
  if (res.study !== "node") return null;
  if (refusal) {
    return (
      <details className="w-full rounded-lg border border-border bg-surface p-3 text-sm">
        <summary className="cursor-pointer font-medium">{title}</summary>
        <p className="mt-2 text-xs text-muted">{refusal}</p>
      </details>
    );
  }
  return (
    <details className="w-full rounded-lg border border-border bg-surface p-3 text-sm">
      <summary className="cursor-pointer font-medium">{title}</summary>
      <LockForm hand={hand} res={res} cls={cls} mode={mode} getSolver={getSolver} />
    </details>
  );
}

function LockForm({ hand, res, cls, mode, getSolver }: NodeLockPanelProps) {
  const actor = res.actor!;
  // (the live tree's where a refusal gave them: a stored flop's sizes that aren't in it)
  const [live, setLive] = useState<string[] | null>(null);
  const actions = live ?? nodeActions(res);
  const [typed, setTyped] = useState<Record<string, string>>(() => startingMix(res));
  const [kind, setKind] = useState<LockScope["kind"]>("range");
  const [classes, setClasses] = useState(cls ?? "");
  const holes = useMemo(() => holesOf(res, cls), [res, cls]);
  const [picked, setPicked] = useState<string | null>(null);
  const combo = picked && holes.includes(picked) ? picked : (holes[0] ?? null);
  const scope: LockScope = kind === "range" ? { kind } : kind === "classes" ? { kind, text: classes } : { kind, combo };
  const { mix, problems: mixProblems } = mixOf(typed, actions);
  const { hands, problems: scopeProblems } = handsOf(scope, res);
  const problems = [...mixProblems, ...scopeProblems];
  const note = scopeNote(res.street, scope);
  const heavy = memoryNote(res.street, mode);
  const named = combosNamed(scope, hand.board);
  const [run, setRun] = useState<Run>({ kind: "idle" });
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  const ask = async () => {
    if (!mix || !hands) return;
    abort.current?.abort();
    const ac = new AbortController();
    abort.current = ac;
    setRun({ kind: "running", progress: null });
    try {
      const client = await getSolver();
      const result = await client.nodeLock(
        studyRequest(hand),
        { mix, hands, expect: { actor, actions } },
        { mode, signal: ac.signal, onProgress: (progress) => setRun({ kind: "running", progress }) },
      );
      setRun({ kind: "done", result });
    } catch (e) {
      if (e instanceof NodeLockError && e.actions) {
        setLive(e.actions);
        setTyped({ [e.actions[0]!]: "100" });
      }
      setRun({ kind: "error", message: e instanceof SolverError && e.kind === "cancelled" ? "Stopped." : e instanceof Error ? e.message : String(e) });
    }
  };

  const field = "w-16 rounded border border-border bg-surface px-1.5 py-0.5 text-text";
  const running = run.kind === "running";
  return (
    <div className="mt-2 space-y-3">
      <p className="text-xs text-muted">
        Holds {actor} here and solves this street and below again, both players adjusting, {actor}'s other decisions included. What comes back is an equilibrium of that restricted game, not the unlocked
        equilibrium, and not a best response: that's the read above. Each hand held plays this mix itself, so a whole-range lock isn't the range's own frequencies played out, whatever the numbers.
      </p>
      <form
        aria-label="The lock"
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          void ask();
        }}
      >
        <div className="grid gap-x-3 gap-y-1 sm:grid-cols-2">
          {actions.map((a) => (
            <label key={a} className="flex items-center gap-2">
              <span className="w-32 shrink-0">{a}</span>
              <input aria-label={`${a} %`} inputMode="decimal" placeholder="0" value={typed[a] ?? ""} onChange={(e) => setTyped({ ...typed, [a]: e.target.value })} className={field} />
              <span className="text-xs text-muted">%</span>
            </label>
          ))}
        </div>
        <fieldset className="flex flex-wrap items-center gap-3">
          <legend className="sr-only">Whom it holds</legend>
          {(
            [
              ["range", "Whole range"],
              ["classes", "Hand classes"],
              ["combo", "One combo"],
            ] as const
          ).map(([k, label]) => (
            <label key={k} className="flex items-center gap-1">
              <input type="radio" name="node-lock-scope" checked={kind === k} onChange={() => setKind(k)} />
              {label}
            </label>
          ))}
          {kind === "classes" && <input aria-label="Hand classes" placeholder="AKs, QQ" value={classes} onChange={(e) => setClasses(e.target.value)} className={`${field} w-40 font-mono`} />}
          {kind === "combo" && (
            <select aria-label="Combo" value={combo ?? ""} onChange={(e) => setPicked(e.target.value)} className="rounded border border-border bg-surface px-1.5 py-0.5 font-mono">
              {holes.map((h) => (
                <option key={h}>{h}</option>
              ))}
            </select>
          )}
          {kind === "combo" && !cls && <span className="text-xs text-muted">(select a class in the grid for its hands)</span>}
          {named !== null && <span className="text-xs text-muted">{named === 1 ? "1 combo" : `${named} combos`} named; the rest of the range stays free</span>}
        </fieldset>
        {note && <p className="text-xs text-muted">{note}</p>}
        {heavy && <p className="text-xs text-muted">{heavy}</p>}
        {problems.length > 0 && (
          <p role="alert" className="text-xs text-danger">
            {problems.join("; ")}.
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" disabled={!mix || !hands || running} className="rounded border border-border px-2 py-0.5 hover:bg-surface-2 disabled:opacity-50">
            Run
          </button>
          {running && (
            <>
              <span role="status" className="text-xs text-muted">
                {run.progress
                  ? `${run.progress.iterations} of up to ${run.progress.of} iterations${run.progress.exploitability_pct !== null ? `, ${run.progress.exploitability_pct.toFixed(2)}% of the pot exploitable` : ""}…`
                  : "Solving the locked game…"}
              </span>
              <button type="button" onClick={() => abort.current?.abort()} className="rounded border border-border px-2 py-0.5 text-xs hover:bg-surface-2">
                Cancel
              </button>
            </>
          )}
        </div>
      </form>
      {run.kind === "error" && (
        <p role="alert" className="text-xs text-danger">
          {run.message}
        </p>
      )}
      {run.kind === "done" && <LockResult result={run.result} stored={Boolean(res.precomputed)} />}
    </div>
  );
}

function Mixes({ c }: { c: NodeLockChange }) {
  return (
    <table className="text-xs">
      <thead>
        <tr className="text-left text-muted">
          <th className="pr-3 font-normal">Action</th>
          <th className="pr-3 font-normal">Unlocked</th>
          <th className="pr-3 font-normal">Locked</th>
          <th className="font-normal">Points</th>
        </tr>
      </thead>
      <tbody>
        {actionRows(c).map((r) => (
          <tr key={r.action}>
            <td className="pr-3">{r.action}</td>
            <td className="pr-3">{pct(r.unlocked)}</td>
            <td className="pr-3">{pct(r.locked)}</td>
            <td>{points(r.change)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function reachedWords(c: NodeLockChange): string {
  if (c.locked === null) return "No longer reached with the lock on.";
  if (c.unlocked === null) return "Not reached in the unlocked solve.";
  return `Reached ${pct(c.reach.unlocked)} of the time unlocked, ${pct(c.reach.locked)} locked.`;
}

function LockResult({ result, stored }: { result: SolveResult<NodeLockAnswer>; stored: boolean }) {
  const n = result.data.node_lock;
  const held = n.changes.find((c) => c.at === "locked");
  const others = n.changes.filter((c) => c.at !== "locked");
  return (
    <section aria-label="Node-locked result" className="space-y-2">
      <ProvenanceBadge p={result.provenance} />
      <p className="text-xs">
        {n.words}
        {n.hands !== "all" ? `: ${pct(n.share_held)} of the range at this node.` : "."}
      </p>
      <div className="text-xs text-muted">
        Unlocked column: <ProvenanceBadge p={unlockedProvenance(result.provenance, n)} quiet />
      </div>
      {stored && <p className="text-xs text-muted">The flop on screen is the library's stored answer: stored flops can't be re-solved, so the unlocked column here is a live solve of this flop and can differ from it.</p>}
      <table className="text-xs">
        <caption className="text-left text-muted">Value, bb a hand from the start of this solve, half the {n.root_pot.toFixed(1)} bb pot there counting as each player's own</caption>
        <thead>
          <tr className="text-left text-muted">
            <th className="pr-3 font-normal">Seat</th>
            <th className="pr-3 font-normal">Unlocked</th>
            <th className="pr-3 font-normal">Locked</th>
            <th className="font-normal">Change</th>
          </tr>
        </thead>
        <tbody>
          {valueRows(n).map((r) => (
            <tr key={r.seat}>
              <td className="pr-3">{r.seat}</td>
              <td className="pr-3">{signed(r.unlocked)}</td>
              <td className="pr-3">{signed(r.locked)}</td>
              <td>{signed(r.change)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {held && (
        <div>
          <p className="text-xs text-muted">{n.seat} at this node, over the range</p>
          <Mixes c={held} />
        </div>
      )}
      <p className="text-xs">
        <span className="text-muted">Exploitability: </span>
        {exploitWords(n)}
      </p>
      <p className="text-xs">
        <span className="text-muted">Lock cost: </span>
        {costWords(n)}
      </p>
      {others.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted">The decisions around it</summary>
          <div className="mt-1 space-y-2">
            {others.map((c) => (
              <div key={c.line.join(">")}>
                <p className="text-muted">
                  {c.seat} {c.line.length ? `after ${c.line.join(", ")}` : "first"} ({c.at === "before" ? "before the lock" : "after the lock"}). {reachedWords(c)}
                </p>
                <Mixes c={c} />
              </div>
            ))}
          </div>
        </details>
      )}
      <p className="text-xs text-muted">{n.scope}</p>
      <p className="text-xs text-muted">{n.abstraction}</p>
      {n.ignored > 0 && (
        <p className="text-xs text-muted">
          Not in the range, so not held: {n.ignored_hands.join(", ")}
          {n.ignored > n.ignored_hands.length ? " and others" : ""}.
        </p>
      )}
      {(result.data.notes ?? []).map((t) => (
        <p key={t} className="text-xs text-muted">
          {t}
        </p>
      ))}
    </section>
  );
}
