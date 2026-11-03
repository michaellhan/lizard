// Study: the solution browser. Walk a hand node by node with no cards of your own; at each decision the engine
// answers for every hand of the player to act (Advisor.study): the 13x13 mix, EVs, equity, the range's totals.
// Preflop the charts answer at once; library flops answer at once; other flops (heads-up / 3-way), turns and
// rivers are solved live in the browser (or the local Python server), with progress and cancel.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { RangeMatrix } from "@/components/RangeMatrix";
import { ProvenanceBadge } from "@/components/ProvenanceBadge";
import { actionColors, bb, pct } from "@/components/actions";
import { useSolver } from "@/solver/useSolver";
import { SolverError, type SolveResult } from "@/solver/types";
import type { AdvisorResponse } from "@/solver/protocol";
import { useSettings } from "@/state/settings";
import {
  back,
  cardsNeeded,
  deal,
  describeLine,
  freshHand,
  fromSearch,
  play,
  randomCards,
  readCards,
  studyRequest,
  toSearch,
  type StudyHand,
} from "./studyState";
import { ComboPanel } from "./ComboPanel";
import { ModePicker } from "./ModePicker";

type Phase =
  | { kind: "loading"; partial?: SolveResult }
  | { kind: "done"; result: SolveResult }
  | { kind: "error"; message: string };

const PRESETS: { label: string; players: number; stack: number }[] = [
  { label: "6-max 100bb", players: 6, stack: 100 },
  { label: "Heads-up 100bb", players: 2, stack: 100 },
  { label: "9-max 100bb", players: 9, stack: 100 },
  { label: "6-max 40bb", players: 6, stack: 40 },
];

export function StudyPage() {
  const [params, setParams] = useSearchParams();
  const hand = useMemo<StudyHand>(() => fromSearch(params.toString()) ?? freshHand(6, 100), [params]);
  const setHand = useCallback((h: StudyHand) => setParams(toSearch(h)), [setParams]);
  // classic Study offers Fast and Accurate only (study.js); the Quick setting (for Practice) runs Study at Fast
  const picked = useSettings((s) => s.mode);
  const mode = picked === "quick" ? "fast" : picked;
  const getSolver = useSolver();
  // the answer is tagged with the request it answers; a new request shows "loading" until its own answer arrives
  const [answer, setAnswer] = useState<{ key: string; phase: Phase }>({ key: "", phase: { kind: "loading" } });
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<"mix" | "ev" | "eq">("mix");
  const [showOpponent, setShowOpponent] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const requestKey = `${toSearch(hand)}|${mode}`;
  const phase: Phase = answer.key === requestKey ? answer.phase : { kind: "loading" };
  useEffect(() => {
    const ac = new AbortController();
    abortRef.current = ac;
    let alive = true;
    const setPhase = (p: Phase) => setAnswer({ key: requestKey, phase: p });
    void (async () => {
      try {
        const client = await getSolver();
        const result = await client.solve({
          state: studyRequest(hand),
          mode,
          progressive: true,
          signal: ac.signal,
          onPartial: (p) => alive && setPhase({ kind: "loading", partial: p }),
        });
        if (alive) setPhase({ kind: "done", result });
      } catch (e) {
        if (!alive) return;
        if (e instanceof SolverError && e.kind === "cancelled") setPhase({ kind: "error", message: "Stopped." });
        else setPhase({ kind: "error", message: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => {
      alive = false;
      ac.abort();
    };
    // the request key covers hand and mode
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey, getSolver]);

  const shown: SolveResult | undefined = phase.kind === "done" ? phase.result : phase.kind === "loading" ? phase.partial : undefined;
  const res: AdvisorResponse | undefined = shown?.data;
  const names = useMemo(() => res?.grid?.actions ?? [], [res]);
  const colors = useMemo(() => actionColors(names), [names]);
  const grid = showOpponent ? res?.opponent_grid : res?.grid;
  const evRange = useMemo<[number, number]>(() => {
    const vals = Object.values(res?.grid?.cells ?? {})
      .map((c) => c.evm)
      .filter((v): v is number => typeof v === "number");
    return vals.length ? [Math.min(...vals), Math.max(...vals)] : [0, 1];
  }, [res]);

  const onBack = () => {
    const b = back(hand);
    if (b) setHand(b);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Study</h1>
          <p className="text-sm text-muted">Every hand of the player to act. The badge says where each answer comes from: a solve, the library, or the preflop charts. Click an action to play it.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ModePicker modes={["fast", "accurate"]} />
          <select
            aria-label="Start a new hand"
            className="rounded-md border border-border bg-surface-2 px-2 py-1.5 text-sm"
            value=""
            onChange={(e) => {
              const p = PRESETS[Number(e.target.value)];
              if (p) setHand(freshHand(p.players, p.stack));
            }}
          >
            <option value="" disabled>
              New hand…
            </option>
            {PRESETS.map((p, i) => (
              <option key={p.label} value={i}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <nav aria-label="Line" className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-surface p-2 text-sm">
        <span className="rounded bg-surface-3 px-2 py-0.5 text-muted">
          {hand.players === 2 ? "HU" : `${hand.players}-max`} {hand.stack}bb
        </span>
        {describeLine(hand).map((t, i) => (
          <span key={i} className="rounded bg-surface-2 px-2 py-0.5 font-mono">
            {t}
          </span>
        ))}
        <span className="flex-1" />
        <button type="button" onClick={onBack} disabled={!back(hand)} className="rounded px-2 py-0.5 text-muted hover:bg-surface-2 disabled:opacity-40">
          ← Back
        </button>
        <button type="button" onClick={() => setHand(freshHand(hand.players, hand.stack))} className="rounded px-2 py-0.5 text-muted hover:bg-surface-2">
          Reset
        </button>
      </nav>

      {phase.kind === "loading" && (
        <div className="flex items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2 text-sm" role="status">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent" />
          <span>{phase.partial ? "Refining…" : "Answering…"}</span>
          <span className="text-muted">The first answer starts the engine (Python in your browser, cached after the first visit).</span>
          <span className="flex-1" />
          <button type="button" className="rounded border border-border px-2 py-0.5 hover:bg-surface-2" onClick={() => abortRef.current?.abort()}>
            Stop
          </button>
        </div>
      )}
      {phase.kind === "error" && (
        <div role="alert" className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {phase.message}
        </div>
      )}

      {res && <NodeView hand={hand} res={res} shown={shown!} setHand={setHand} />}

      {res?.study === "node" && grid && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <section aria-label="Range" className="space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <strong>{showOpponent ? res.opponent : res.actor}</strong>
              <span className="text-muted">
                {showOpponent ? `${res.opponent_combos?.toFixed(1)} combos` : `${res.range_combos?.toFixed(1)} combos`}
                {res.range_eq !== undefined && !showOpponent ? ` · equity ${pct(res.range_eq)}` : ""}
              </span>
              <span className="flex-1" />
              {res.opponent_grid && (
                <button type="button" className="rounded border border-border px-2 py-0.5" onClick={() => setShowOpponent((v) => !v)}>
                  {showOpponent ? `Show ${res.actor}` : `Show ${res.opponent}`}
                </button>
              )}
              {!showOpponent &&
                (["mix", "ev", "eq"] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={view === v}
                    onClick={() => setView(v)}
                    className={`rounded px-2 py-0.5 ${view === v ? "bg-surface-3" : "text-muted hover:bg-surface-2"}`}
                  >
                    {v === "mix" ? "Strategy" : v === "ev" ? "EV" : "Equity"}
                  </button>
                ))}
            </div>
            <RangeMatrix
              cells={grid.cells}
              actions={showOpponent ? [] : names}
              colors={colors}
              selected={selected}
              onSelect={setSelected}
              view={showOpponent ? "weight" : view}
              evRange={evRange}
              caption={`${showOpponent ? res.opponent : res.actor} range`}
            />
          </section>
          <aside className="space-y-3">
            {selected && grid.cells[selected] ? (
              <ComboPanel cls={selected} res={res} colors={colors} opponent={showOpponent} />
            ) : (
              <p className="rounded-lg border border-border bg-surface p-3 text-sm text-muted">
                Select a hand class to see its combos, mix, EV and equity.
              </p>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}

function NodeView({ hand, res, shown, setHand }: { hand: StudyHand; res: AdvisorResponse; shown: SolveResult; setHand: (h: StudyHand) => void }) {
  const [typed, setTyped] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const names = res.grid?.actions ?? [];
  const colors = actionColors(names);

  if (res.study === "deal") {
    const n = cardsNeeded(res.street);
    const submit = (cards: string) => {
      setErr(null);
      setTyped("");
      setHand(deal(hand, cards));
    };
    return (
      <form
        className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface p-3"
        onSubmit={(e) => {
          e.preventDefault();
          const r = readCards(hand, typed, n);
          if ("error" in r) setErr(r.error);
          else submit(r.cards);
        }}
      >
        <label className="text-sm">
          Deal the {res.street} ({n} card{n > 1 ? "s" : ""}):{" "}
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={n === 1 ? "5s" : "Kd7c2h"}
            className="ml-1 w-28 rounded border border-border bg-surface-2 px-2 py-1 font-mono"
            aria-invalid={Boolean(err)}
          />
        </label>
        <button type="submit" className="rounded bg-accent px-3 py-1 text-sm font-medium text-bg">
          Deal
        </button>
        <button type="button" className="rounded border border-border px-3 py-1 text-sm" onClick={() => submit(randomCards(hand, n))}>
          Random
        </button>
        {err && <span className="text-sm text-danger">{err}</span>}
      </form>
    );
  }
  if (res.study === "over") {
    return <p className="rounded-lg border border-border bg-surface p-3 text-sm">The hand is over. Step back to study another branch.</p>;
  }
  if (res.study !== "node") {
    return (
      <div className="rounded-lg border border-warn/40 bg-warn/10 p-3 text-sm text-warn">
        {typeof res.error === "string" ? res.error : `No study answer for this node (${String(res.study ?? res.skipped ?? "unknown")}).`}
      </div>
    );
  }
  return (
    <section aria-label="Actions" className="space-y-2 rounded-lg border border-border bg-surface p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <strong className="text-base">{res.actor}</strong>
        <span className="text-muted">
          to act on the {res.street}
          {res.position ? ` (${res.position})` : ""}
          {res.pot_bb !== undefined ? ` · pot ${res.pot_bb}bb` : ""}
        </span>
        <span className="flex-1" />
        <ProvenanceBadge p={shown.provenance} />
      </div>
      <div className="flex flex-wrap gap-2">
        {(res.actions ?? []).map((a, i) => (
          <button
            key={a.action}
            type="button"
            onClick={() => setHand(play(hand, res, a))}
            className="group min-w-28 rounded-md border border-border bg-surface-2 px-3 py-2 text-left hover:border-accent"
          >
            <div className="flex items-center gap-2">
              <span className="inline-block h-3 w-3 rounded-sm" style={{ background: colors[names.indexOf(a.action)] ?? colors[i] }} />
              <span className="font-medium">{a.action}</span>
            </div>
            <div className="mt-1 font-mono text-xs text-muted">
              {pct(a.freq)} · {a.combos?.toFixed(1) ?? "–"} combos
              {typeof a.ev === "number" ? ` · EV ${a.rough_ev ? "≈" : ""}${bb(a.ev)}` : ""}
            </div>
          </button>
        ))}
      </div>
      {(res.notes ?? []).length > 0 && (
        <ul className="list-disc pl-5 text-xs text-muted">
          {res.notes!.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

