// Study: the solution browser. Walk a hand node by node with no cards of your own; at each decision the engine
// answers for every hand of the player to act (Advisor.study): the 13x13 mix, EVs, equity, the range's totals.
// Preflop the charts answer at once; library flops answer at once; other flops (heads-up / 3-way), turns and
// rivers are solved live in the browser (or the local Python server), with progress and cancel.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { cellValue, RangeMatrix } from "@/components/RangeMatrix";
import { ProvenanceBadge } from "@/components/ProvenanceBadge";
import { actionColors, evIn, evUnitLabel, kindOf, pct, type EvUnit } from "@/components/actions";
import { useSolver } from "@/solver/useSolver";
import { SolverError, type SolveResult } from "@/solver/types";
import type { AdvisorResponse, OpponentRange } from "@/solver/protocol";
import { useSettings } from "@/state/settings";
import { describeSetup, setupProblems } from "@/features/solve/setup";
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
  STREETS,
  studyRequest,
  toSearch,
  type StudyHand,
} from "./studyState";
import { BuildMode, type BuildSaved } from "./BuildMode";
import { ChipCompare } from "./ChipCompare";
import { CompareLinks } from "./CompareLinks";
import { ComboPanel } from "./ComboPanel";
import { SaveSpot } from "./SaveSpot";
import { TournamentPanel, type TournamentInfo } from "./TournamentPanel";
import { ModePicker } from "./ModePicker";
import { catsOf, filterRes } from "./filters";
import { actionLine, VIEW_LABELS, viewsOf, type GridView } from "./views";

type Phase =
  | { kind: "loading"; partial?: SolveResult }
  | { kind: "done"; result: SolveResult }
  | { kind: "error"; message: string };

/** Study's table sizes and stack depths (the Advisor's preflop model covers 2-9 players, 10-250bb). */
export const PLAYERS = [2, 3, 4, 5, 6, 7, 8, 9] as const;
export const MIN_STACK = 10;
export const MAX_STACK = 250;

/** The opponents' ranges: heads-up the one (opponent_grid), 3-way each of the two (opponents), as study.js oppsOf. */
export function oppsOf(res: AdvisorResponse | undefined): OpponentRange[] {
  if (!res) return [];
  if (res.opponents?.length) return res.opponents;
  return res.opponent && res.opponent_grid
    ? [{ seat: res.opponent, grid: res.opponent_grid, combos: res.opponent_combos, eq: res.opponent_eq }]
    : [];
}

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
  const [chosenView, setView] = useState<GridView>("mix");
  // whose range the grid shows: 0 the player to act, i the i-th opponent
  const [who, setWho] = useState(0);
  // a hand category ("m:<id>" / "d:<id>"), kept from node to node while the node has it
  const [filterKey, setFilterKey] = useState<string | null>(null);
  // one action picked in the legend: the others are drawn empty, and the EV view shades by its EV
  const [focus, setFocus] = useState<string | null>(null);
  // the range builder (kept on from node to node), and what's painted at each node visited
  const [building, setBuilding] = useState(false);
  const [paints] = useState(() => new Map<string, BuildSaved>());
  const evUnit = useSettings((s) => s.evUnit);
  const abortRef = useRef<AbortController | null>(null);

  const requestKey = `${toSearch(hand)}|${mode}`;
  // a setup the engine can't be asked (a link typed or edited by hand): said, and nothing asked
  const problems = useMemo(() => setupProblems(hand.players, hand.setup), [hand]);
  const phase: Phase = problems.length
    ? { kind: "error", message: `This setup can't be solved: ${problems.join("; ")}.` }
    : answer.key === requestKey
      ? answer.phase
      : { kind: "loading" };
  useEffect(() => {
    if (problems.length) return;
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
  const raw: AdvisorResponse | undefined = shown?.data;
  const cats = useMemo(() => catsOf(raw), [raw]);
  const res = useMemo(() => (raw ? filterRes(raw, filterKey) : undefined), [raw, filterKey]);
  const names = useMemo(() => res?.grid?.actions ?? [], [res]);
  const colors = useMemo(() => actionColors(names), [names]);
  const opps = useMemo(() => oppsOf(raw), [raw]);
  const opp = who > 0 ? (opps[who - 1] ?? null) : null;
  const grid = opp ? opp.grid : res?.grid;
  const views = res ? viewsOf(res) : (["mix"] as GridView[]);
  const view = views.includes(chosenView) ? chosenView : "mix";
  const focusIdx = focus !== null && names.includes(focus) ? names.indexOf(focus) : null;
  const hidden = useMemo(
    () => (focusIdx === null ? undefined : new Set(names.map((_, i) => i).filter((i) => i !== focusIdx))),
    [focusIdx, names],
  );
  const evRange = useMemo<[number, number]>(() => {
    const v = view === "eqr" ? "eqr" : "ev";
    const vals = Object.values(res?.grid?.cells ?? {})
      .map((c) => cellValue(c, v, focusIdx, res?.pot_bb))
      .filter((x): x is number => typeof x === "number");
    return vals.length ? [Math.min(...vals), Math.max(...vals)] : [0, 1];
  }, [res, view, focusIdx]);
  const filtered = res?.filter;
  // the builder paints the whole range (no filter) of a complete answer: a partial one would show its mix early
  const buildable = raw?.study === "node" && (raw.grid?.actions.length ?? 0) > 1;
  const buildRes = phase.kind === "done" && buildable ? (raw as AdvisorResponse & { grid: NonNullable<AdvisorResponse["grid"]> }) : null;
  const buildButton = buildable && (
    <button
      type="button"
      aria-pressed={building}
      onClick={() => {
        setBuilding((b) => !b);
        setWho(0);
        setSelected(null);
      }}
      title="Paint the strategy yourself, then score it against this answer"
      className={`rounded border px-2 py-0.5 ${building ? "border-accent bg-surface-3" : "border-border text-muted hover:bg-surface-2"}`}
    >
      {building ? "✎ Building" : "✎ Build"}
    </button>
  );

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
          <NewHandForm key={`${hand.players}/${hand.stack}`} players={hand.players} stack={hand.stack} onStart={(p, st) => setHand(freshHand(p, st))} />
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
        <button type="button" onClick={() => setHand({ ...freshHand(hand.players, hand.stack), setup: hand.setup })} className="rounded px-2 py-0.5 text-muted hover:bg-surface-2">
          Reset
        </button>
        <SaveSpot key={requestKey} hand={hand} provenance={phase.kind === "done" ? phase.result.provenance : undefined} />
      </nav>
      <p aria-label="Setup" className="-mt-2 text-xs text-muted">
        {hand.setup ? (
          <>
            Your setup: {describeSetup(hand.setup).join(" · ") || "none"}.{" "}
            <Link to={`/${hand.setup.tournament ? "tournaments" : "solve"}?${toSearch(hand)}`} className="underline hover:text-text">
              Edit setup
            </Link>
          </>
        ) : (
          <>
            Standard setup (a cash game at the engine's sizes, no rake or ante, the charts' ranges).{" "}
            <Link to={`/solve?${toSearch(hand)}`} className="underline hover:text-text">
              Set up your own
            </Link>{" "}
            or{" "}
            <Link to={`/tournaments?${toSearch(hand)}`} className="underline hover:text-text">
              a tournament
            </Link>
          </>
        )}
      </p>

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

      {res && <NodeView hand={hand} res={res} shown={shown!} setHand={setHand} evUnit={evUnit} building={building} />}
      {hand.setup?.tournament && phase.kind === "done" && raw?.tournament ? (
        <ChipCompare key={requestKey} hand={hand} mode={mode} getSolver={getSolver} prize={phase.result} evUnit={evUnit} />
      ) : null}
      {phase.kind === "done" && raw?.study === "node" && <CompareLinks key={requestKey} hand={hand} min={MIN_STACK} max={MAX_STACK} />}

      {building && buildable && (
        <div className="flex items-center gap-2 text-sm">
          {buildButton}
          <span className="text-muted">Range builder: paint {raw?.actor}'s strategy, then check it against this answer.</span>
        </div>
      )}
      {building && buildable && !buildRes && <p className="rounded-lg border border-border bg-surface p-3 text-sm text-muted">The builder opens once the answer is complete.</p>}
      {building && buildRes && (
        <BuildMode
          key={requestKey}
          res={buildRes}
          provenance={shown!.provenance}
          colors={actionColors(buildRes.grid.actions)}
          lineKey={toSearch(hand)}
          lineLabel={describeLine(hand).join(" ")}
          stored={paints.get(requestKey)}
          onStore={(v) => void paints.set(requestKey, v)}
          onExit={() => setBuilding(false)}
        />
      )}
      {!(building && buildable) && res?.study === "node" && grid && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <section aria-label="Range" className="space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {opps.length > 0 ? (
                <div role="group" aria-label="Whose range" className="flex flex-wrap gap-1">
                  {[res.actor, ...opps.map((o) => o.seat)].map((seat, i) => (
                    <button
                      key={`${seat}-${i}`}
                      type="button"
                      aria-pressed={who === i}
                      onClick={() => setWho(i)}
                      className={`rounded border border-border px-2 py-0.5 ${who === i ? "bg-surface-3 font-semibold" : "text-muted hover:bg-surface-2"}`}
                    >
                      {seat}
                    </button>
                  ))}
                </div>
              ) : (
                <strong>{res.actor}</strong>
              )}
              <span className="text-muted">
                {opp
                  ? `${opp.combos?.toFixed(1) ?? "–"} combos${opp.eq != null ? ` · equity ${pct(opp.eq)}` : ""}`
                  : `${filtered ? `${filtered.label}: ` : ""}${res.range_combos?.toFixed(1)}${filtered?.of != null ? ` of ${filtered.of.toFixed(1)}` : ""} combos${
                      res.range_eq != null ? ` · equity ${pct(res.range_eq)}` : ""
                    }`}
              </span>
              <span className="flex-1" />
              {!opp && cats.length > 0 && (
                <select
                  aria-label="Show only the hands of one category"
                  title="Show only the hands of one category: the grid, the range's frequencies and the combos over them"
                  className="rounded border border-border bg-surface-2 px-2 py-0.5"
                  value={filtered?.key ?? ""}
                  onChange={(e) => setFilterKey(e.target.value || null)}
                >
                  <option value="">All hands</option>
                  {(["m", "d"] as const).map((part) => {
                    const cs = cats.filter((c) => c.part === part);
                    return cs.length ? (
                      <optgroup key={part} label={part === "m" ? "Made hands" : "Draws"}>
                        {cs.map((c) => (
                          <option key={c.key} value={c.key}>
                            {c.label} · {pct(c.combos / (raw?.range_combos || 1))}
                          </option>
                        ))}
                      </optgroup>
                    ) : null;
                  })}
                </select>
              )}
              {!opp &&
                views.length > 1 &&
                views.map((v) => (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={view === v}
                    onClick={() => setView(v)}
                    title={v === "eqr" ? "Equity realization: EV / (equity × pot)" : undefined}
                    className={`rounded px-2 py-0.5 ${view === v ? "bg-surface-3" : "text-muted hover:bg-surface-2"}`}
                  >
                    {VIEW_LABELS[v]}
                  </button>
                ))}
              {buildButton}
            </div>
            {!opp && (view === "mix" || view === "ev") && names.length > 1 && (
              <div role="group" aria-label="Show one action" className="flex flex-wrap items-center gap-1 text-xs">
                {names.map((nm, i) => (
                  <button
                    key={nm}
                    type="button"
                    aria-pressed={focusIdx === i}
                    onClick={() => setFocus(focusIdx === i ? null : nm)}
                    title={focusIdx === i ? "Show every action" : `Show only ${nm}${view === "ev" ? " and shade by its EV" : ""}`}
                    className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 ${
                      focusIdx === i ? "border-accent" : focusIdx === null ? "border-border" : "border-border opacity-50"
                    }`}
                  >
                    <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: colors[i] }} />
                    {nm}
                  </button>
                ))}
                {focusIdx !== null && (
                  <button type="button" onClick={() => setFocus(null)} className="rounded px-1.5 py-0.5 text-muted hover:bg-surface-2">
                    All actions
                  </button>
                )}
              </div>
            )}
            <RangeMatrix
              cells={grid.cells}
              actions={opp ? [] : names}
              colors={colors}
              selected={selected}
              onSelect={setSelected}
              view={opp ? "weight" : view}
              evRange={evRange}
              evAction={view === "ev" ? focusIdx : null}
              potBb={res.pot_bb}
              hidden={view === "mix" ? hidden : undefined}
              caption={`${opp ? opp.seat : res.actor} range${filtered ? ` (${filtered.label})` : ""}`}
            />
          </section>
          <aside className="space-y-3">
            {selected && grid.cells[selected] ? (
              <ComboPanel cls={selected} res={res} colors={colors} opponent={opp ?? false} evUnit={evUnit} />
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

function NodeView({
  hand,
  res,
  shown,
  setHand,
  evUnit,
  building = false,
}: {
  hand: StudyHand;
  res: AdvisorResponse;
  shown: SolveResult;
  setHand: (h: StudyHand) => void;
  evUnit: EvUnit;
  /** the range builder is open: the actions without their frequencies and EVs (they'd give the answer away) */
  building?: boolean;
}) {
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
            {!building && (
              <div className="mt-1 font-mono text-xs text-muted">
                {actionLine(a, (x) => `${evIn(x, evUnit, res.pot_bb)}${evUnit === "pot" ? evUnitLabel(evUnit, res.pot_bb) : ""}`)}
              </div>
            )}
          </button>
        ))}
      </div>
      {res.tournament && typeof res.tournament === "object" ? <TournamentPanel t={res.tournament as TournamentInfo} actor={res.actor} out={STREETS.flatMap((st) => hand[st]).filter((a) => kindOf(a.action) === "fold").map((a) => a.pos)} /> : null}
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


function NewHandForm({ players, stack, onStart }: { players: number; stack: number; onStart: (players: number, stack: number) => void }) {
  const [p, setP] = useState(players);
  const [st, setSt] = useState(String(stack));
  const n = Number(st);
  const ok = Number.isFinite(n) && n >= MIN_STACK && n <= MAX_STACK;
  return (
    <form
      aria-label="New hand"
      className="flex items-center gap-1.5 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        if (ok) onStart(p, Math.round(n * 10) / 10);
      }}
    >
      <select aria-label="Players" className="rounded-md border border-border bg-surface-2 px-2 py-1.5" value={p} onChange={(e) => setP(Number(e.target.value))}>
        {PLAYERS.map((k) => (
          <option key={k} value={k}>
            {k === 2 ? "Heads-up" : `${k}-max`}
          </option>
        ))}
      </select>
      <label className="flex items-center gap-1">
        <input
          aria-label="Stack in big blinds"
          type="number"
          inputMode="decimal"
          min={MIN_STACK}
          max={MAX_STACK}
          step="any"
          value={st}
          onChange={(e) => setSt(e.target.value)}
          aria-invalid={!ok}
          title={`Effective stack, ${MIN_STACK}–${MAX_STACK}bb`}
          className="w-16 rounded-md border border-border bg-surface-2 px-2 py-1.5 font-mono"
        />
        <span className="text-muted">bb</span>
      </label>
      <button type="submit" disabled={!ok} className="rounded-md border border-border px-2 py-1.5 hover:bg-surface-2 disabled:opacity-40">
        New hand
      </button>
    </form>
  );
}
