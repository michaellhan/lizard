// Study's profile re-solve (engine/profile_solve.py; profile.ts): a player held to an assumed profile at every decision
// of theirs, the other re-solved against it, the node's answer beside its equilibrium answer, the street's values side
// by side and how far the re-solve converged. Not the read above it (LockPanel), a best response at one node with the
// opponent standing still, nor the node lock (NodeLockPanel), one node held and both re-solved: here the profiled
// player is held everywhere and only their opponent adjusts, so the answer is that opponent's best response to the
// profile across the tree. Labelled an exploit re-solve, never an equilibrium.
import { useEffect, useRef, useState } from "react";
import { ProvenanceBadge } from "@/components/ProvenanceBadge";
import { pct } from "@/components/actions";
import { NodeLockError, type SolverClient } from "@/solver/client";
import type { AdvisorResponse, ProfileSolveAnswer, ProfileSolveProgress } from "@/solver/protocol";
import { SolverError, type SolveMode, type SolveResult } from "@/solver/types";
import { LOCK_PRESETS } from "./locks";
import {
  convergenceWords,
  describeProfile,
  movedClasses,
  PROFILE_FIELDS,
  profileOf,
  profilePreset,
  profileRefusal,
  toProfileFields,
  valueRows,
  type StudyProfile,
} from "./profile";
import { studyRequest, type StudyHand } from "./studyState";

type Run =
  | { kind: "idle" }
  | { kind: "running"; progress: ProfileSolveProgress | null }
  | { kind: "error"; message: string }
  | { kind: "done"; result: SolveResult<ProfileSolveAnswer> };

export interface ProfilePanelProps {
  hand: StudyHand;
  res: AdvisorResponse;
  mode: SolveMode;
  getSolver: () => Promise<SolverClient>;
  /** the profile in the link (`prof`), if any: the form starts from it */
  kept: StudyProfile | null;
  /** the profile run, to keep in the link (and so with a saved spot) */
  onKeep: (p: StudyProfile) => void;
}

const TITLE = "Exploit a profile (held across the tree, re-solved)";

export function ProfilePanel(props: ProfilePanelProps) {
  const { hand, res } = props;
  if (res.study !== "node") return null;
  const refusal = profileRefusal(res, Boolean(hand.setup?.tournament));
  return (
    <details className="w-full panel p-3 text-sm" open={props.kept ? true : undefined}>
      <summary className="cursor-pointer font-medium">{TITLE}</summary>
      {refusal ? <p className="mt-2 text-xs text-muted">{refusal}</p> : <ProfileForm {...props} />}
    </details>
  );
}

const signed = (x: number) => {
  const t = (x * 100).toFixed(1);
  return Number(t) === 0 ? "0.0" : `${x > 0 ? "+" : ""}${t}`;
};
const ev = (x: number | null | undefined) => (typeof x === "number" ? x.toFixed(2) : "–");

function ProfileForm({ hand, res, mode, getSolver, kept, onKeep }: ProfilePanelProps) {
  const actor = res.actor!;
  const opponent = res.opponent as string;
  const seats = [opponent, actor];
  const [seat, setSeat] = useState(kept && seats.includes(kept.seat) ? kept.seat : opponent);
  const [typed, setTyped] = useState(() => toProfileFields(kept?.adj ?? LOCK_PRESETS.station![1]));
  const [hand_, setHandScope] = useState(kept?.streets === "hand");
  const { profile, problems } = profileOf(typed);
  const preset = profile ? profilePreset(profile) : null;
  const earlier = res.street === "turn" || res.street === "river";
  const [run, setRun] = useState<Run>({ kind: "idle" });
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  const ask = async () => {
    if (!profile || problems.length) return;
    abort.current?.abort();
    const ac = new AbortController();
    abort.current = ac;
    const streets = earlier && hand_ ? "hand" : "street";
    onKeep({ seat, adj: profile, streets });
    setRun({ kind: "running", progress: null });
    try {
      const client = await getSolver();
      const result = await client.profileSolve(studyRequest(hand), { seat, adj: profile, streets }, { mode, signal: ac.signal, onProgress: (progress) => setRun({ kind: "running", progress }) });
      setRun({ kind: "done", result });
    } catch (e) {
      setRun({ kind: "error", message: e instanceof SolverError && e.kind === "cancelled" ? "Stopped." : e instanceof NodeLockError || e instanceof Error ? e.message : String(e) });
    }
  };

  const field = "w-16 rounded border border-border bg-surface px-1.5 py-0.5 text-text";
  const running = run.kind === "running";
  return (
    <div className="mt-2 space-y-3">
      <p className="text-xs text-muted">
        The profiled player plays the equilibrium with the profile laid on it at every decision of theirs; the other player is re-solved against that, so their answer is the best response to the profile across the tree. The numbers are your assumptions, not population data.
      </p>
      <form
        aria-label="The profile"
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          void ask();
        }}
      >
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1">
            Profile on
            <select aria-label="Profiled seat" value={seat} onChange={(e) => setSeat(e.target.value)} className="rounded border border-border bg-surface px-1.5 py-0.5">
              {seats.map((p) => (
                <option key={p} value={p}>
                  {p}
                  {p === actor ? " (acting here)" : ""}
                </option>
              ))}
            </select>
          </label>
          <select
            aria-label="Profile preset"
            value={preset ?? ""}
            onChange={(e) => e.target.value && setTyped(toProfileFields(LOCK_PRESETS[e.target.value]![1]))}
            className="rounded border border-border bg-surface px-1.5 py-0.5"
          >
            <option value="">Your numbers</option>
            {Object.entries(LOCK_PRESETS).map(([k, [name]]) => (
              <option key={k} value={k}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-x-3 gap-y-1 sm:grid-cols-2">
          {PROFILE_FIELDS.map(([k, label, help]) => (
            <label key={k} className="flex items-center gap-2" title={help}>
              <span className="w-32 shrink-0">{label}</span>
              <input aria-label={label} inputMode="decimal" placeholder="0" value={typed[k] ?? ""} onChange={(e) => setTyped({ ...typed, [k]: e.target.value })} className={field} />
            </label>
          ))}
        </div>
        {earlier && (
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={hand_} onChange={(e) => setHandScope(e.target.checked)} />
            Hold it on the earlier streets too, so the ranges reaching the {res.street} are the profile's
          </label>
        )}
        {problems.length > 0 && (
          <p role="alert" className="text-xs text-danger">
            {problems.join("; ")}.
          </p>
        )}
        {profile && <p className="text-xs text-muted">{`${seat} ${describeProfile(profile)}.`}</p>}
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" disabled={!profile || problems.length > 0 || running} className="rounded border border-border px-2 py-0.5 hover:bg-surface-2 disabled:opacity-50">
            Re-solve
          </button>
          {running && (
            <>
              <span role="status" className="text-xs text-muted">
                {run.progress
                  ? `Re-solving the ${run.progress.street}: ${run.progress.iterations} of up to ${run.progress.of} iterations${run.progress.exploitability_pct !== null ? `, ${run.progress.exploitability_pct.toFixed(2)}% of the pot` : ""}…`
                  : "Solving the equilibrium, then the re-solve…"}
              </span>
              <button type="button" onClick={() => abort.current?.abort()} className="rounded border border-border px-2 py-0.5 hover:bg-surface-2">
                Stop
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
      {run.kind === "done" && <ProfileResult result={run.result} />}
    </div>
  );
}

export function ProfileResult({ result }: { result: SolveResult<ProfileSolveAnswer> }) {
  const r = result.data;
  const b = r.profile_solve;
  const moved = movedClasses(b);
  return (
    <section aria-label="Profile re-solve" className="space-y-3">
      <ProvenanceBadge p={result.provenance} />
      <p className="text-xs">{r.label}.</p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <caption className="text-left text-muted">
            {r.actor}'s range here{b.actor_profiled ? ` (the profiled player: their play with the profile laid on)` : ` (the exploit: re-solved against ${b.seat}'s profile)`}
          </caption>
          <thead>
            <tr className="text-left">
              <th className="pr-2">Action</th>
              <th className="pr-2">Equilibrium</th>
              <th className="pr-2">EV</th>
              <th className="pr-2">{b.actor_profiled ? "Profile" : "Exploit"}</th>
              <th className="pr-2">EV</th>
            </tr>
          </thead>
          <tbody>
            {b.actions.map((a, i) => (
              <tr key={a}>
                <td className="pr-2">{a}</td>
                <td className="pr-2 tabular-nums">{pct(b.eq.mix[i] ?? 0)}</td>
                <td className="pr-2 tabular-nums">{ev(b.eq.ev[i])}</td>
                <td className="pr-2 tabular-nums">{pct(b.exploit.mix[i] ?? 0)}</td>
                <td className="pr-2 tabular-nums">{ev(b.exploit.ev[i])}</td>
              </tr>
            ))}
            <tr className="text-muted">
              <td className="pr-2">Range</td>
              <td className="pr-2">{b.eq.combos} combos</td>
              <td className="pr-2 tabular-nums">{ev(b.eq.range_ev)}</td>
              <td className="pr-2">{b.exploit.combos} combos</td>
              <td className="pr-2 tabular-nums">{ev(b.exploit.range_ev)}</td>
            </tr>
          </tbody>
        </table>
        <p className="text-xs text-muted">EVs in bb, relative to folding now.</p>
      </div>
      <div>
        <p className="text-xs font-medium">The {r.street}'s values, equilibrium and exploit side by side (bb per pair of hands dealt at its root, one tree and one pair of ranges)</p>
        <dl className="grid grid-cols-[auto_auto] gap-x-3 text-xs">
          {valueRows(b).map((row) => (
            <div key={row.label} className="contents">
              <dt>{row.label}</dt>
              <dd className="tabular-nums">
                {row.value}
                {row.note && <span className="text-muted"> ({row.note})</span>}
              </dd>
            </div>
          ))}
        </dl>
      </div>
      <p className="text-xs">{convergenceWords(b)}</p>
      <p className="text-xs text-muted">
        Held at {b.pinned.nodes} decisions of {b.seat}'s ({b.pinned.cells} cells)
        {b.streets.length > 1 ? `; ${b.streets.map((s) => `${s.street}: ${s.nodes} decisions, ${s.iterations} iterations, ${Math.max(s.gain_pct, 0).toFixed(4)}% of the pot`).join("; ")}` : ""}.
      </p>
      {moved.length > 0 && (
        <table className="text-xs">
          <caption className="text-left text-muted">Hand classes that moved most (points per action, exploit minus equilibrium)</caption>
          <tbody>
            {moved.map((m) => (
              <tr key={m.cls}>
                <td className="pr-2 font-mono">{m.cls}</td>
                <td className="pr-2">{b.actions.map((a, i) => `${a} ${signed((m.ex[i] ?? 0) - (m.eq[i] ?? 0))}`).join(" · ")}</td>
                <td className="tabular-nums text-muted">
                  EV {ev(m.evEq)} → {ev(m.evEx)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="text-xs text-muted">{b.rule}</p>
      <p className="text-xs text-muted">{b.scope}</p>
      {(r.notes ?? []).length > 0 && (
        <ul className="list-disc pl-4 text-xs text-muted">
          {(r.notes ?? []).map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
