// Study's node lock (ROADMAP Phase 6; locks.ts): under a heads-up solved node after the flop, or a preflop node (on the
// charts: a seat still in picked), "Against a read" sets how the opponent plays (a preset, or the engine's numbers) and
// asks one hand's advice twice, one after the other: at equilibrium (preflop, the charts' mix), then against the read. The answer shows the hand's best response with the equilibrium's frequency beside
// each action, the range's best response against the range's equilibrium (both from the advice, so on the same ranges),
// and per hand class the change in one action (Compare's DiffMatrix). Labelled the best response to the read, never an
// equilibrium re-solve. Study's own answer above stays the equilibrium.
import { useMemo, useRef, useState } from "react";
import { ProvenanceBadge } from "@/components/ProvenanceBadge";
import { pct } from "@/components/actions";
import { ANY_RAISE, diffClasses, isRaise } from "@/features/compare/compare";
import { classCombos, expandClass } from "@/engine/nlhe/cards";
import { seatsOf } from "@/poker/seats";
import { DiffMatrix, diffLabel, points } from "@/features/compare/DiffMatrix";
import type { AdvisorResponse, ComboRow } from "@/solver/protocol";
import type { SolverClient } from "@/solver/client";
import { SolverError, type SolveMode, type SolveResult } from "@/solver/types";
import { describeLock, LOCK_FIELDS, LOCK_FIELDS_PREFLOP, LOCK_PRESETS, lockOf, lockRequest, lockSeats, presetOf, type Lock, type LockKey } from "./locks";
import { studyRequest, type StudyHand } from "./studyState";

type Run = { kind: "idle" } | { kind: "running"; step: 1 | 2 } | { kind: "error"; message: string } | { kind: "done"; gto: SolveResult; br: SolveResult; lock: Lock; hole: string };

/** The hands of a class in the range (the answer's combo rows, heaviest first; preflop, with no rows, every hand of a
 * class in the range: no board blocks one), or of the heaviest class where none is picked. */
export function holesOf(res: AdvisorResponse, cls: string | null): string[] {
  const handsOf = (c: string): string[] => {
    const rows = ((res.combos?.[c] ?? []) as ComboRow[]).filter((r) => r[1] > 0).sort((a, b) => b[1] - a[1]);
    if (rows.length) return rows.map((r) => r[0]);
    return res.street === "preflop" && (res.grid?.cells[c]?.w ?? 0) > 0 ? expandClass(c) : [];
  };
  if (cls && handsOf(cls).length) return handsOf(cls);
  const top = Object.entries(res.grid?.cells ?? {})
    .filter(([c]) => handsOf(c).length)
    .sort((a, b) => b[1].w - a[1].w)[0];
  return top ? handsOf(top[0]) : [];
}

const toFields = (l: Lock): Partial<Record<LockKey, string>> => Object.fromEntries(Object.entries(l).map(([k, v]) => [k, String(v)]));

/** The range's share of each action: the answer's own (after the flop), else read off its grid (preflop), each class
 * weighted by its combos in the range. */
export function rangeFreqOf(r: AdvisorResponse): Record<string, number> {
  if (r.range_action_freq && typeof r.range_action_freq === "object") return r.range_action_freq as Record<string, number>;
  const g = r.grid;
  if (!g) return {};
  let tot = 0;
  const sums = g.actions.map(() => 0);
  for (const [cls, c] of Object.entries(g.cells)) {
    const w = c.w * classCombos(cls);
    tot += w;
    g.actions.forEach((_, i) => (sums[i]! += w * (c.f[i] ?? 0)));
  }
  return tot > 0 ? Object.fromEntries(g.actions.map((a, i) => [a, sums[i]! / tot])) : {};
}

export function LockPanel({ hand, res, cls, mode, getSolver }: { hand: StudyHand; res: AdvisorResponse; cls: string | null; mode: SolveMode; getSolver: () => Promise<SolverClient> }) {
  const actor = res.actor!, preflop = res.street === "preflop";
  // whom the read is on: after the flop the opponent; preflop a seat still in (the last raiser to start with)
  const seats = lockSeats(seatsOf(hand.players), hand.preflop, res);
  const raiser = [...hand.preflop].reverse().find((a) => a.action === "raise" || a.action === "all-in")?.pos;
  const [seatPicked, setSeat] = useState<string | null>(null);
  const opponent = seatPicked && seats.includes(seatPicked) ? seatPicked : raiser && seats.includes(raiser) ? raiser : (seats[0] ?? "");
  const fields = preflop ? LOCK_FIELDS_PREFLOP : LOCK_FIELDS;
  const [typed, setTyped] = useState<Partial<Record<LockKey, string>>>(() => toFields(LOCK_PRESETS.overfolder![1]));
  const { lock, problems } = lockOf(typed, preflop);
  const preset = lock ? presetOf(lock) : null;
  const holes = useMemo(() => holesOf(res, cls), [res, cls]);
  const [picked, setPicked] = useState<string | null>(null);
  const hole = picked && holes.includes(picked) ? picked : (holes[0] ?? null);
  const [run, setRun] = useState<Run>({ kind: "idle" });
  const abort = useRef<AbortController | null>(null);

  const ask = async () => {
    if (!lock || !hole || !opponent) return;
    abort.current?.abort();
    const ac = new AbortController();
    abort.current = ac;
    const study = studyRequest(hand);
    try {
      const client = await getSolver();
      // equilibrium first (its solve is the one the read is laid on, so the second answer comes quicker)
      setRun({ kind: "running", step: 1 });
      const gto = await client.solve({ state: lockRequest(study, actor, hole, opponent, null), mode, signal: ac.signal });
      setRun({ kind: "running", step: 2 });
      const br = await client.solve({ state: lockRequest(study, actor, hole, opponent, lock), mode, signal: ac.signal });
      setRun({ kind: "done", gto, br, lock, hole });
    } catch (e) {
      setRun({ kind: "error", message: e instanceof SolverError && e.kind === "cancelled" ? "Stopped." : e instanceof Error ? e.message : String(e) });
    }
  };

  const field = "w-16 rounded border border-border bg-surface px-1.5 py-0.5 text-text";
  return (
    <details className="w-full rounded-lg border border-border bg-surface p-3 text-sm">
      <summary className="cursor-pointer font-medium">Against a read (best response)</summary>
      <div className="mt-2 space-y-3">
        {preflop && <p className="text-xs text-muted">Laid on the preflop charts, not a solve.</p>}
        <form
          aria-label="The read"
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            void ask();
          }}
        >
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1">
              Read on{" "}
              {seats.length > 1 ? (
                <select aria-label="Seat" value={opponent} onChange={(e) => setSeat(e.target.value)} className="rounded border border-border bg-surface px-1.5 py-0.5">
                  {seats.map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </select>
              ) : (
                opponent
              )}
              <select
                aria-label="Preset"
                value={preset ?? ""}
                onChange={(e) => e.target.value && setTyped(toFields(LOCK_PRESETS[e.target.value]![1]))}
                className="rounded border border-border bg-surface px-1.5 py-0.5"
              >
                <option value="">Your numbers</option>
                {Object.entries(LOCK_PRESETS).map(([k, [name]]) => (
                  <option key={k} value={k}>
                    {preflop ? name.replace("to bets", "to raises") : name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1">
              {actor} holds
              <select aria-label="Hand" value={hole ?? ""} onChange={(e) => setPicked(e.target.value)} className="rounded border border-border bg-surface px-1.5 py-0.5 font-mono">
                {holes.map((h) => (
                  <option key={h}>{h}</option>
                ))}
              </select>
            </label>
            <span className="text-xs text-muted">{cls ? "" : "(select a class in the grid for its hands)"}</span>
          </div>
          <div className="grid gap-x-3 gap-y-1 sm:grid-cols-2">
            {fields.map(([k, label, hint]) => (
              <label key={k} className="flex items-center gap-2" title={hint}>
                <span className="w-32 shrink-0">{label}</span>
                <input
                  aria-label={label}
                  inputMode="numeric"
                  placeholder={k.startsWith("next_") ? "GTO" : "0"}
                  value={typed[k] ?? ""}
                  onChange={(e) => setTyped({ ...typed, [k]: e.target.value })}
                  className={field}
                />
              </label>
            ))}
          </div>
          {problems.length > 0 && (
            <p role="alert" className="text-xs text-danger">
              {problems.join("; ")}.
            </p>
          )}
          <div className="flex items-center gap-2">
            <button type="submit" disabled={!lock || problems.length > 0 || !hole || !opponent || run.kind === "running"} className="rounded border border-border px-2 py-0.5 hover:bg-surface-2 disabled:opacity-50">
              Ask
            </button>
            {run.kind === "running" && (
              <>
                <span role="status" className="text-xs text-muted">
                  {run.step === 1 ? (preflop ? "On the charts…" : "At equilibrium…") : "Against the read…"} ({run.step} of 2)
                </span>
                <button type="button" onClick={() => abort.current?.abort()} className="rounded border border-border px-2 py-0.5 text-xs hover:bg-surface-2">
                  Stop
                </button>
              </>
            )}
            {lock && run.kind !== "running" && (
              <span className="text-xs text-muted">
                {opponent} {describeLock(lock, preflop)}.
              </span>
            )}
          </div>
        </form>
        {run.kind === "error" && (
          <p role="alert" className="text-xs text-danger">
            {run.message}
          </p>
        )}
        {run.kind === "done" && <LockAnswer gto={run.gto} br={run.br} hole={run.hole} actor={actor} preflop={preflop} />}
      </div>
    </details>
  );
}

function LockAnswer({ gto, br, hole, actor, preflop }: { gto: SolveResult; br: SolveResult; hole: string; actor: string; preflop: boolean }) {
  const G: AdvisorResponse = gto.data, B: AdvisorResponse = br.data;
  const error = typeof B.error === "string" ? B.error : typeof G.error === "string" ? G.error : null;
  const names = (B.actions ?? []).map((a) => a.action);
  const anyRaise = names.filter(isRaise).length > 1;
  const options = [...names, ...(anyRaise ? [ANY_RAISE] : [])];
  const [chosen, setChosen] = useState<string | null>(null);
  const action = chosen && options.includes(chosen) ? chosen : anyRaise ? ANY_RAISE : (names.find(isRaise) ?? names[0] ?? "");
  const classes = diffClasses(G, B, action);
  const [sel, setSel] = useState<string | null>(null);
  if (error) return <p role="alert" className="text-xs text-danger">{error}</p>;
  const rg = rangeFreqOf(G), rb = rangeFreqOf(B);
  const base = preflop ? "charts" : "GTO";
  const selD = sel ? classes.find((c) => c.cls === sel) : undefined;
  return (
    <section aria-label="Best response to the read" className="space-y-3">
      <ProvenanceBadge p={br.provenance} />
      <div className="scroll-x">
        <table className="w-full text-left text-xs">
          <thead className="text-muted">
            <tr>
              <th className="py-1 pr-3 font-normal">{actor}</th>
              <th className="py-1 pr-3 font-normal">{hole}: against the read</th>
              <th className="py-1 pr-3 font-normal">
                {hole}: {base}
              </th>
              <th className="py-1 pr-3 font-normal">Range: against the read</th>
              <th className="py-1 font-normal">Range: {base}</th>
            </tr>
          </thead>
          <tbody className="font-mono">
            {(B.actions ?? []).map((a) => (
              <tr key={a.action} className="border-t border-border">
                <td className="py-1 pr-3 font-sans font-medium">{a.action}</td>
                <td className="py-1 pr-3">
                  {pct(a.freq)}
                  {typeof a.ev_bb === "number" ? ` · EV ${a.ev_bb.toFixed(2)}bb` : ""}
                </td>
                <td className="py-1 pr-3">{typeof a.gto_freq === "number" ? pct(a.gto_freq) : "–"}</td>
                <td className="py-1 pr-3">{pct(rb[a.action])}</td>
                <td className="py-1">{pct(rg[a.action])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {preflop ? (
        <p className="text-xs text-muted">Charts: no EVs.</p>
      ) : (
        <p className="text-xs text-muted">EVs against the read.{G.range_action_freq ? "" : " Range mix not returned."}</p>
      )}
      {G.grid && B.grid && (
        <div className="space-y-2">
          <label className="flex items-center gap-2">
            <span>Change per class in</span>
            <select aria-label="Action" value={action} onChange={(e) => setChosen(e.target.value)} className="rounded border border-border bg-surface px-1.5 py-0.5">
              {options.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
            <span className="text-xs text-muted">(blue: more against the read than {preflop ? "the charts" : "at equilibrium"})</span>
          </label>
          <div className="max-w-md">
            <DiffMatrix diffs={classes} action={action} selected={sel} onSelect={setSel} />
          </div>
          <p role="status" className="text-xs">
            {selD ? `${preflop ? "Charts" : "GTO"} → against the read: ${diffLabel(selD, selD.cls, action)}` : ""}
          </p>
          <p className="text-xs text-muted">
            The range: {Object.keys(rb).length ? `${names.map((n) => `${n} ${points((rb[n] ?? 0) - (rg[n] ?? 0))}`).join(" · ")} points against the read.` : "–"}
          </p>
        </div>
      )}
      {(B.notes ?? []).length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted">
          {(B.notes ?? []).map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
