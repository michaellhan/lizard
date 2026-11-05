// Compare (ROADMAP Phase 8): two Study spots, A and B (each a Study link's query: `/compare?a=…&b=…`), asked one
// after the other and shown side by side: how B differs, each side's badge, a warning first when the sources differ
// or either is approximate, the actions' frequencies and EVs, the range's totals, and per hand class the change in one
// action's frequency (the grid) with the biggest changes listed. Opened from Study's "Compare this spot" links.
// Preflop either side can be the charts or the preflop solve (Study's pf=solver); a game the solve doesn't hold yet is
// said, not solved here (Study solves it on request), and one this browser solved before is handed back. Any two spots
// can be picked on the page (SpotPicker: saved spots, the spot pinned in Study, or a pasted Study link). Two spots
// that differ only in their sizes are two size menus (Study's "with … bets"): what each offers here, how much of the
// range bets or raises with it, and what it's worth to the player to act; the grid shows any bet or raise.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { ProvenanceBadge } from "@/components/ProvenanceBadge";
import { useFocusHold } from "@/components/useFocusHold";
import { pct } from "@/components/actions";
import { describeSetup, setupProblems } from "@/features/solve/setup";
import { answerWords, MAX_STACK, MIN_STACK } from "@/features/study/StudyPage";
import { askNode, pfMinutes } from "@/features/study/pfSolve";
import { describePfSizes } from "@/features/study/pfSizes";
import { describeLine, fromSearch, studyRequest, toSearch, type StudyHand } from "@/features/study/studyState";
import type { AdvisorActionStat, AdvisorResponse } from "@/solver/protocol";
import { SolverError, type SolveResult } from "@/solver/types";
import { useSolver } from "@/solver/useSolver";
import { useSettings } from "@/state/settings";
import { ANY_RAISE, biggest, diffActions, diffClasses, isRaise, menusOf, menuWords, noiseBb, nodeWarning, pfSourceOf, sizesOnly, sourceWarning, totalsOf, whatDiffers, type Menus } from "./compare";
import { bbDelta, DiffMatrix, diffLabel, points } from "./DiffMatrix";
import { SpotPicker } from "./SpotPicker";

type Answer = { kind: "done"; result: SolveResult } | { kind: "error"; message: string };
type Side = Answer | { kind: "loading" } | { kind: "waiting" };

const spotWords = (h: StudyHand) =>
  [
    `${h.players === 2 ? "heads-up" : `${h.players}-max`} ${h.stack}bb`,
    describeLine(h).join(" ") || "the first decision",
    ...describeSetup(h.setup),
    ...(h.pf === "solver" && !h.board ? [`preflop from the solve${h.pfSizes ? ` (${describePfSizes(h.pfSizes)})` : ""}`] : []),
  ].join(" · ");

/** Why a side's answer can't be compared (it isn't a decision with a strategy), or null where it can. */
export function notComparable(r: SolveResult["data"]): string | null {
  if (r.study === "node" && r.grid) return null;
  if (r.study === "pf_unsolved")
    return `This game's preflop isn't solved yet (about ${pfMinutes(typeof r.estimate_s === "number" ? r.estimate_s : 60)} in your browser): open it in Study, solve it there, then come back.`;
  if (r.study === "pf_none") return `The preflop solve doesn't take this game: ${String(r.reason ?? "")}.`;
  if (typeof r.error === "string") return r.error;
  if (r.study === "deal") return "Not a decision: the next card is due.";
  if (r.study === "over") return "Not a decision: the hand is over.";
  return "No decision to compare here.";
}

export function ComparePage() {
  const [params, setParams] = useSearchParams();
  const pick = (x: string, y: string) => setParams({ a: x, b: y });
  const a = useMemo(() => fromSearch(params.get("a") ?? ""), [params]);
  const b = useMemo(() => fromSearch(params.get("b") ?? ""), [params]);
  const picked = useSettings((s) => s.mode);
  const mode = picked === "quick" ? "fast" : picked;
  const getSolver = useSolver();
  const problems = useMemo(() => {
    const of = (name: string, h: StudyHand) => [
      ...(h.stack >= MIN_STACK && h.stack <= MAX_STACK ? [] : [`the table's stack must be ${MIN_STACK}–${MAX_STACK}bb`]),
      ...setupProblems(h.players, h.setup),
    ].map((p) => `${name}: ${p}`);
    return [...(a ? of("A", a) : []), ...(b ? of("B", b) : [])];
  }, [a, b]);
  const key = `${params.get("a")}|${params.get("b")}|${mode}`;
  // each side's answer, tagged with the request it answers; B is asked once A is answered
  const [answers, setAnswers] = useState<{ key: string; a?: Answer; b?: Answer }>({ key: "" });
  const abortRef = useRef<AbortController | null>(null);
  // Try again: asked afresh, past a side already answered (kept here for it)
  const [attempt, setAttempt] = useState(0);
  const kept = useRef<{ key: string; a: Answer } | null>(null);
  // the keyboard stays here as Stop and Try again come and go
  const box = useFocusHold<HTMLDivElement>();

  useEffect(() => {
    if (!a || !b || problems.length) return;
    const ac = new AbortController();
    abortRef.current = ac;
    let alive = true;
    const set = (which: "a" | "b", x: Answer) => alive && setAnswers((s) => ({ ...(s.key === key ? s : { key }), [which]: x }));
    void (async () => {
      // one after the other (the backends run one solve at a time), A first
      for (const [which, h] of [["a", a], ["b", b]] as const) {
        if (which === "a" && kept.current?.key === key) continue;
        try {
          const client = await getSolver();
          const result = await askNode((state) => client.solve({ state, mode, signal: ac.signal }), studyRequest(h), client.solverVersion);
          set(which, { kind: "done", result });
        } catch (e) {
          set(which, { kind: "error", message: e instanceof SolverError && e.kind === "cancelled" ? "Stopped." : e instanceof Error ? e.message : String(e) });
        }
        if (ac.signal.aborted) {
          if (which === "a") set("b", { kind: "error", message: "Stopped." });
          return;
        }
      }
    })();
    return () => {
      alive = false;
      ac.abort();
    };
    // the key covers both spots and the mode
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt, getSolver]);

  if (!a || !b)
    return (
      <div className="max-w-3xl space-y-3">
        <h1 className="text-2xl font-semibold">Compare</h1>
        <p className="text-sm text-muted">
          Pick two spots, or open a comparison from a spot in{" "}
          <Link to="/study" className="underline hover:text-text">
            Study
          </Link>{" "}
          (Compare this spot: in chip EV, without rake, at another stack, against the preflop solve, or with a spot you pinned).
        </p>
        <SpotPicker a={params.get("a")} b={params.get("b")} onPick={pick} />
      </div>
    );

  const mine = answers.key === key ? answers : { key };
  const sa: Side = problems.length ? { kind: "waiting" } : (mine.a ?? { kind: "loading" });
  const sb: Side = problems.length || !mine.a ? { kind: "waiting" } : (mine.b ?? { kind: "loading" });
  const retry = () => {
    const done = mine.a?.kind === "done" ? mine.a : undefined;
    kept.current = done ? { key, a: done } : null;
    setAnswers(done ? { key, a: done } : { key });
    setAttempt((n) => n + 1);
  };
  const failed = sa.kind === "error" || sb.kind === "error";
  // said once, in the one region that's always here
  const said = problems.length
    ? ""
    : sa.kind === "error"
      ? `A: ${sa.message}`
      : sa.kind === "done"
        ? sb.kind === "error"
          ? `B: ${sb.message}`
          : sb.kind === "done"
            ? `A: ${answerWords(sa.result.data, sa.result.provenance)} B: ${answerWords(sb.result.data, sb.result.provenance)}`
            : "A answered. Finding B's answer."
        : "Finding A's answer.";
  const differs = whatDiffers(a, b);
  // the charts against the preflop solve: the sources are what's compared
  const bySource = pfSourceOf(a) !== null && pfSourceOf(b) !== null && pfSourceOf(a) !== pfSourceOf(b);
  const why = (["A", "B"] as const).flatMap((n, i) => {
    const s = i ? sb : sa;
    const w = s.kind === "done" ? notComparable(s.result.data) : null;
    return w ? [`${n}: ${w}`] : [];
  });
  return (
    <div className="max-w-5xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Compare</h1>
        <p className="text-sm text-muted">Two spots answered one after the other and shown side by side, B against A. Each answer keeps its own source.</p>
      </div>
      <p role="status" className="sr-only">
        {said}
      </p>
      <details className="text-sm">
        <summary className="cursor-pointer text-muted hover:text-text">Change the spots</summary>
        <div className="mt-2">
          <SpotPicker key={key} a={params.get("a")} b={params.get("b")} onPick={pick} />
        </div>
      </details>
      <dl aria-label="Spots" className="grid gap-1 text-sm sm:grid-cols-[auto_1fr]">
        {(
          [
            ["A", a, sa],
            ["B", b, sb],
          ] as const
        ).map(([name, h, s]) => (
          <div key={name} className="contents">
            <dt className="font-medium">{name}</dt>
            <dd className="min-w-0 space-y-1">
              <div>
                {spotWords(h)}.{" "}
                <Link to={`/study?${toSearch(h)}`} className="text-xs underline hover:text-text">
                  Open in Study
                </Link>
              </div>
              <div className="text-xs">
                {s.kind === "done" ? (
                  notComparable(s.result.data) ? (
                    <span className="text-warn">{notComparable(s.result.data)}</span>
                  ) : (
                    <ProvenanceBadge p={s.result.provenance} />
                  )
                ) : s.kind === "loading" ? (
                  <span className="text-muted">Finding the answer…</span>
                ) : s.kind === "error" ? (
                  <span className={s.message === "Stopped." ? "text-muted" : "text-danger"}>{s.message}</span>
                ) : (
                  <span className="text-muted">{problems.length ? "Not asked." : "Asked once A is answered."}</span>
                )}
              </div>
            </dd>
          </div>
        ))}
      </dl>
      <p role="group" aria-label="What differs" className="text-sm">
        <span className="font-medium">What differs:</span> {differs.length ? differs.join("; ") : "nothing (the same spot twice)"}.
      </p>
      {problems.length > 0 && (
        <div role="alert" className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          These setups can't be solved: {problems.join("; ")}.
        </div>
      )}
      <div {...box} role="group" aria-label="Comparison" className="space-y-4">
        {(sa.kind === "loading" || sb.kind === "loading") && (
          <button type="button" onClick={() => abortRef.current?.abort()} className="rounded border border-border px-2 py-0.5 text-sm hover:bg-surface-2">
            Stop
          </button>
        )}
        {failed && (
          <button type="button" data-focus-first onClick={retry} className="rounded border border-border px-2 py-0.5 text-sm hover:bg-surface-2">
            Try again
          </button>
        )}
        {why.length > 0 && <p className="text-sm text-muted">Nothing compared: {why.length > 1 ? "neither side is" : `${why[0]!.slice(0, 1)} isn't`} a decision with an answer (above).</p>}
        {sa.kind === "done" && sb.kind === "done" && !why.length && <Diff ra={sa.result} rb={sb.result} bySource={bySource} menus={sizesOnly(a, b)} />}
      </div>
    </div>
  );
}

/** menus: the two spots differ only in their sizes */
function Diff({ ra, rb, bySource, menus }: { ra: SolveResult; rb: SolveResult; bySource: boolean; menus: boolean }) {
  const A: AdvisorResponse = ra.data, B: AdvisorResponse = rb.data;
  const actions = useMemo(() => diffActions(A, B), [A, B]);
  // (every bet or raise as one, where the two menus' bets don't share names or there's more than one)
  const anyRaise = menus || actions.filter((d) => isRaise(d.action)).length > 1;
  const options = [...actions.map((d) => d.action), ...(anyRaise ? [ANY_RAISE] : [])];
  const [chosen, setChosen] = useState<string | null>(null);
  const action = chosen && options.includes(chosen) ? chosen : menus ? ANY_RAISE : (options[0] ?? "");
  const m = useMemo(() => (menus ? menusOf(A, B, ra.provenance, rb.provenance) : null), [menus, A, B, ra.provenance, rb.provenance]);
  const classes = useMemo(() => diffClasses(A, B, action), [A, B, action]);
  const top = useMemo(() => biggest(classes), [classes]);
  const [selected, setSelected] = useState<string | null>(null);
  const noise = noiseBb(ra.provenance, rb.provenance, A.pot_bb);
  const warn = [sourceWarning(ra.provenance, rb.provenance, bySource), nodeWarning(A, B)].filter(Boolean);
  const t = totalsOf(A, B);
  const quiet = (d: number | null) => d !== null && noise !== null && Math.abs(d) < noise;
  const stat = (x: AdvisorActionStat | undefined) => (x ? `${pct(x.freq)}${typeof x.ev_bb === "number" ? ` · EV ${x.ev_bb.toFixed(2)}bb` : ""}` : "not offered");
  // the range's combos, EV and equity, where the side has them (a chart has no EV or equity)
  const range = (i: 0 | 1) =>
    [t.combos[i] !== null && `${t.combos[i]!.toFixed(1)} combos`, t.ev[i] !== null && `EV ${t.ev[i]!.toFixed(2)}bb`, t.eq[i] !== null && `equity ${pct(t.eq[i])}`].filter(Boolean).join(" · ") || "–";
  const sel = selected ? classes.find((c) => c.cls === selected) : undefined;
  return (
    <div className="space-y-4">
      {warn.length > 0 && (
        <div role="group" aria-label="Warning" className="space-y-1 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm">
          {warn.map((w) => (
            <p key={w}>{w}</p>
          ))}
        </div>
      )}
      {m && <MenuSummary m={m} actor={A.actor ?? "the player to act"} pot={A.pot_bb} />}
      <section aria-label="Actions" className="scroll-x">
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-muted">
            <tr>
              <th className="py-1 pr-3 font-normal">{A.actor ?? "Action"}, whole range</th>
              <th className="py-1 pr-3 font-normal">A</th>
              <th className="py-1 pr-3 font-normal">B</th>
              <th className="py-1 font-normal">B − A</th>
            </tr>
          </thead>
          <tbody className="font-mono text-xs">
            {actions.map((d) => (
              <tr key={d.action} className="border-t border-border">
                <td className="py-1 pr-3 font-sans font-medium">{d.action}</td>
                <td className="py-1 pr-3">{stat(d.a)}</td>
                <td className="py-1 pr-3">{stat(d.b)}</td>
                <td className="py-1">
                  {points(d.dFreq)} points
                  {d.dEv !== null && <span className={quiet(d.dEv) ? "text-muted" : ""}> · EV {bbDelta(d.dEv)}{quiet(d.dEv) && " (noise)"}</span>}
                </td>
              </tr>
            ))}
            <tr className="border-t border-border text-muted">
              <td className="py-1 pr-3 font-sans">The range</td>
              <td className="py-1 pr-3">{range(0)}</td>
              <td className="py-1 pr-3">{range(1)}</td>
              <td className="py-1">
                {t.ev[0] !== null && t.ev[1] !== null ? `EV ${bbDelta(t.ev[1] - t.ev[0])}` : ""}
                {t.eq[0] !== null && t.eq[1] !== null ? ` · equity ${points(t.eq[1] - t.eq[0])} points` : ""}
              </td>
            </tr>
          </tbody>
        </table>
        <p className="mt-1 text-xs text-muted">
          {noise !== null
            ? `EV changes under ${noise.toFixed(2)}bb (the two answers' distance from equilibrium combined) are marked (noise).`
            : "No distance from equilibrium is measured on both sides, so no EV change can be called noise or not."}
        </p>
      </section>
      {A.grid && B.grid && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <section aria-label="Change per hand class" className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <span>Change in</span>
              <select aria-label="Action" value={action} onChange={(e) => setChosen(e.target.value)} className="rounded border border-border bg-surface px-2 py-1">
                {options.map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            </label>
            <DiffMatrix diffs={classes} action={action} selected={selected} onSelect={setSelected} />
            <p className="text-xs text-muted">Blue: B takes it more often; red: less often; the stronger, the bigger. Darker grey: a class in one range only.</p>
            <p role="status" className="text-sm">
              {sel ? diffLabel(sel, sel.cls, action) : ""}
            </p>
          </section>
          <section aria-label="Biggest differences" className="space-y-1 text-sm">
            <h2 className="font-medium">Biggest differences in {action}</h2>
            {top.length ? (
              <ol className="space-y-0.5 font-mono text-xs">
                {top.map((d) => (
                  <li key={d.cls}>
                    {d.cls}: {pct(d.fa)} → {pct(d.fb)} ({points(d.dFreq!)} points)
                    {d.dEv !== null && <span className={quiet(d.dEv) ? "text-muted" : ""}>, EV {bbDelta(d.dEv)}{quiet(d.dEv) && " (noise)"}</span>}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-xs text-muted">No hand class in both ranges changes it by half a point or more.</p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

/** Two size menus at one decision: each one's bets, how much of the range bets or raises, and what it's worth. */
function MenuSummary({ m, actor, pot }: { m: Menus; actor: string; pot: number | undefined }) {
  const side = (name: string, x: Menus["a"]) => (
    <li>
      <span className="font-medium">{name}:</span> {x.sizes.length ? x.sizes.join(", ") : "no bet or raise"} · {actor} bets or raises {pct(x.raise)} of the range
      {x.ev !== null ? ` · the range's EV ${x.ev.toFixed(2)}bb` : ""}
    </li>
  );
  return (
    <section aria-label="Size menus" className="space-y-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-sm">
      <h2 className="font-medium">Two size menus, {actor} to act</h2>
      <ul className="space-y-0.5">
        {side("A", m.a)}
        {side("B", m.b)}
      </ul>
      <p>{menuWords(m, actor, pot)}</p>
      <p className="text-xs text-muted">
        A street's menu is every bet's on that street, both players', so each EV is what the game with that menu is worth to {actor} here, from the answers above (each
        with its own badge). Study's one-size view keeps the rest of the tree and changes one decision's sizes.
      </p>
    </section>
  );
}
