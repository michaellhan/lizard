// The turn or river report under Study's deal box (classic study.js runouts / reportHtml, runouts.js's table): asked
// first from what's in hand (a library flop's stored turns, or the solve this page already made), at once; else a
// button that solves the street that closed for it, with the seconds classic measured. Every card off the board, what
// it does to the board, the decision's mix there (the street's first, or in position's after a check), both EVs and
// equities; sorted, grouped and filtered; a card's row deals it. Labelled with its own provenance.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { PlayingCard } from "@/components/PlayingCard";
import { ProvenanceBadge } from "@/components/ProvenanceBadge";
import { actionColors, bb, pct } from "@/components/actions";
import { solverThreads } from "@/solver/client";
import { useSolver } from "@/solver/useSolver";
import { SolverError, type Provenance } from "@/solver/types";
import { useSettings } from "@/state/settings";
import {
  average,
  CLASSES,
  estimate,
  filterRows,
  groups,
  GROUPS,
  lineLabel,
  mwSeconds,
  noteText,
  partOf,
  rows,
  SHORT,
  sortRows,
  type FlopLine,
  type RunoutAverage,
  type RunoutFilter,
  type RunoutGroup,
  type RunoutReport,
  type RunoutSkipped,
  type RunoutWho,
} from "./runouts";
import { deal, studyRequest, toSearch, type StudyHand } from "./studyState";

type State =
  | { kind: "idle" }
  | { kind: "asking" }
  | { kind: "skipped"; sk: RunoutSkipped }
  | { kind: "solving"; t0: number; est: number; upTo: boolean }
  | { kind: "done"; ro: RunoutReport; p: Provenance }
  | { kind: "error"; message: string };

// (a stored flop line picked: Study walks to it and that node's report opens at once; kept until that ask comes back,
// so React's double mount in development asks again)
let openOn: string | null = null;
const openAt = (key: string | null) => {
  openOn = key;
};
const opensAt = (key: string) => openOn === key;

const label = (n: string) => n[0]!.toUpperCase() + n.slice(1);

export function RunoutPanel({ hand, street, setHand }: { hand: StudyHand; street: "turn" | "river"; setHand: (h: StudyHand) => void }) {
  const getSolver = useSolver();
  const picked = useSettings((s) => s.mode);
  const mode = picked === "quick" ? "fast" : picked;
  const transport = useSettings((s) => s.transport);
  const key = toSearch(hand);
  const [st, setSt] = useState<State>(() => (opensAt(key) ? { kind: "asking" } : { kind: "idle" }));
  const [now, setNow] = useState(0);
  const abort = useRef<AbortController | null>(null);
  const prev = street === "river" ? "turn" : "flop";
  const mw = mwSeconds(hand, mode, transport);

  const run = async (solve: boolean, ac: AbortController) => {
    try {
      const client = await getSolver();
      const r = await client.solve({ state: { ...studyRequest(hand), runouts: solve ? true : "held" }, mode, signal: ac.signal });
      if (abort.current !== ac) return;
      if (ac.signal.aborted) return setSt({ kind: "idle" });
      if (opensAt(key)) openAt(null);
      const d = r.data as unknown as RunoutReport | RunoutSkipped;
      if ("skipped" in d && d.skipped) setSt({ kind: "skipped", sk: d });
      else if (d.study === "runouts" && "first" in d) setSt({ kind: "done", ro: d, p: r.provenance });
      else setSt({ kind: "error", message: String((r.data as { error?: unknown }).error ?? "No report came back.") });
    } catch (e) {
      // (a request asked again since says nothing; one stopped goes back to the button)
      if (abort.current !== ac) return;
      if (ac.signal.aborted || (e instanceof SolverError && e.kind === "cancelled")) setSt({ kind: "idle" });
      else setSt({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  };
  const ask = (solve: boolean) => {
    abort.current?.abort();
    const ac = new AbortController();
    abort.current = ac;
    const t0 = Date.now();
    setNow(t0);
    setSt(solve ? { kind: "solving", t0, est: mw ?? estimate(street, mode, transport, solverThreads()), upTo: mw != null } : { kind: "asking" });
    void run(solve, ac);
  };
  useEffect(() => {
    const t = opensAt(key)
      ? setTimeout(() => {
          const ac = new AbortController();
          abort.current = ac;
          void run(false, ac);
        })
      : undefined;
    return () => {
      clearTimeout(t);
      abort.current?.abort();
    };
    // (once, on the node it's shown at: the parent keys it by the hand)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (st.kind !== "solving") return;
    const t = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(t);
  }, [st.kind]);
  const walk = (ln: FlopLine) => {
    const h = { ...hand, flop: ln.flop.map((a) => ({ ...a })), turn: [], river: [] };
    openAt(toSearch(h));
    setHand(h);
  };
  const lines = (ls: FlopLine[], cur: number | undefined, text: string) => (
    <label className="flex items-center gap-1 text-sm">
      <span className="text-muted">{text}</span>
      <select
        aria-label="Flop line"
        value={cur ?? ""}
        onChange={(e) => e.target.value !== "" && walk(ls[Number(e.target.value)]!)}
        className="max-w-[20rem] rounded border border-border bg-surface-2 px-1.5 py-1"
      >
        {cur == null && <option value="">Pick a flop line…</option>}
        {ls.map((ln, i) => (
          <option key={i} value={i}>
            Flop: {lineLabel(ln)} ({pct(ln.share, 0)})
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <section aria-label={`${label(street)} report`} className="space-y-2 rounded-lg border border-border bg-surface p-3 text-sm">
      {st.kind === "idle" || st.kind === "error" ? (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => ask(false)} className="rounded-md border border-border px-3 py-1 hover:bg-surface-2">
            {label(street)} report
          </button>
          <span className="text-muted">
            The {street}&rsquo;s first decision on every card: {mw != null ? "strategy (3-way)" : "strategy, EV and equity"}.
          </span>
          {st.kind === "error" && (
            <p role="alert" className="w-full text-danger">
              Couldn&rsquo;t get the report: {st.message}
            </p>
          )}
        </div>
      ) : st.kind === "asking" ? (
        <p className="text-muted">Looking for the {street} report…</p>
      ) : st.kind === "solving" ? (
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span>
              Solving the {prev} for the {street} report… <span className="tabular-nums text-muted">{((now - st.t0) / 1000).toFixed(1)}s of {st.upTo ? "up to " : ""}~{Math.round(st.est)}s</span>
            </span>
            <button type="button" onClick={() => abort.current?.abort()} className="rounded-md border border-border px-2 py-0.5 hover:bg-surface-2">
              Stop
            </button>
          </div>
          <div className="h-1.5 overflow-hidden rounded bg-surface-3">
            <div className="h-full bg-accent" style={{ width: `${Math.min(97, ((now - st.t0) / 1000 / st.est) * 100)}%` }} />
          </div>
        </div>
      ) : st.kind === "skipped" ? (
        <div className="space-y-2">
          <p>
            The {street} report reads {street === "river" ? "the turn's solve" : "a solve of the flop"}, which isn&rsquo;t in hand yet
            {st.sk.lines ? " (the flop library's stored turns don't hold this flop line)" : ""}.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => ask(true)} className="rounded-md bg-accent px-3 py-1 font-medium text-bg">
              Solve the {prev} ({mode === "accurate" ? "Accurate" : "Fast"}, {mw != null ? "up to " : ""}~{Math.round(mw ?? estimate(street, mode, transport, solverThreads()))} s)
            </button>
            {st.sk.lines && st.sk.lines.length > 0 && lines(st.sk.lines, undefined, "or a line they hold:")}
          </div>
        </div>
      ) : (
        <Report ro={st.ro} p={st.p} hand={hand} onDeal={(c) => setHand(deal(hand, c))} lines={st.ro.lines && st.ro.lines.length > 1 ? lines(st.ro.lines, st.ro.line, "") : null} />
      )}
    </section>
  );
}

function Report({ ro, p, hand, onDeal, lines }: { ro: RunoutReport; p: Provenance; hand: StudyHand; onDeal: (card: string) => void; lines: ReactNode }) {
  const [who, setWho] = useState<RunoutWho>("first");
  const [sort, setSort] = useState("card");
  const [desc, setDesc] = useState(true);
  const [group, setGroup] = useState<RunoutGroup | "">("");
  const [filter, setFilter] = useState<RunoutFilter>({});
  const w: RunoutWho = who === "after" && ro.after_check ? "after" : "first";
  const part = partOf(ro, w);
  const acts = part.actions;
  const colors = actionColors(acts);
  const all = rows(ro, w, hand.board);
  const rs = sortRows(filterRows(all, filter), sort, desc);
  const sum = average(rs);
  const [o, ip] = ro.seats;
  const prevLine = (ro.street === "river" ? hand.turn : hand.flop).map((a) => `${a.pos} ${a.action}${a.to != null ? ` ${a.to}` : ""}`).join(", ");
  const head = (key: string, text: string, cls = "") => (
    <th scope="col" aria-sort={sort === key ? (desc ? "descending" : "ascending") : "none"} className={`whitespace-nowrap px-2 py-1.5 font-medium ${cls}`}>
      <button
        type="button"
        onClick={() => {
          setDesc(sort === key ? !desc : true);
          setSort(key);
        }}
        className={`hover:text-text ${sort === key ? "text-accent" : ""}`}
      >
        {text}
        {sort === key ? (desc ? " ▾" : " ▴") : ""}
      </button>
    </th>
  );
  const nums = (a: Pick<RunoutAverage, "f" | "ev" | "eq">) => (
    <>
      {acts.map((_, i) => (
        <td key={i} className="px-2 py-1 text-right">
          {pct(a.f?.[i], 0)}
        </td>
      ))}
      {!ro.multiway && (
        <>
          <td className="px-2 py-1 text-right">{bb(a.ev?.[0])}</td>
          <td className="px-2 py-1 text-right">{bb(a.ev?.[1])}</td>
          <td className="hidden px-2 py-1 text-right sm:table-cell">{pct(a.eq?.[0])}</td>
          <td className="hidden px-2 py-1 text-right sm:table-cell">{pct(a.eq?.[1])}</td>
        </>
      )}
    </>
  );
  const bar = (f: number[] | null, fe?: (number | null)[] | null) =>
    !f ? (
      <span className="text-xs text-faint">–</span>
    ) : (
      <span className="flex h-3 w-full min-w-20 overflow-hidden rounded-sm bg-surface-3" role="img" aria-label={acts.map((n, i) => `${n} ${pct(f[i])}`).join(", ")}>
        {f.map((x, i) =>
          x > 0.001 ? (
            <i key={i} className="block h-full" title={`${label(acts[i]!)} ${pct(x)}${fe?.[i] != null ? `, EV ${bb(fe[i])}bb` : ""}`} style={{ width: `${(x * 100).toFixed(2)}%`, background: colors[i] }} />
          ) : null,
        )}
      </span>
    );
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <ProvenanceBadge p={p} />
        <span className="text-muted">
          The {ro.street} report after the {ro.street === "river" ? "turn" : "flop"}&rsquo;s <b className="font-medium text-text">{prevLine || "line"}</b>
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span role="group" aria-label="Whose decision" className="inline-flex overflow-hidden rounded-md border border-border">
          {(
            [
              ["first", ro.first.actor],
              ...(ro.after_check ? [["after", `${ro.after_check.actor} after a check`]] : []),
            ] as [RunoutWho, string][]
          ).map(([k, t]) => (
            <button key={k} type="button" aria-pressed={k === w} onClick={() => setWho(k)} className={`px-2.5 py-1 ${k === w ? "bg-surface-3 text-text" : "text-muted hover:bg-surface-2"}`}>
              {t}
            </button>
          ))}
        </span>
        <select aria-label="Group the cards" value={group} onChange={(e) => setGroup(e.target.value as RunoutGroup | "")} className="rounded border border-border bg-surface-2 px-1.5 py-1">
          <option value="">No groups</option>
          {Object.entries(GROUPS).map(([k, t]) => (
            <option key={k} value={k}>
              By {t.toLowerCase()}
            </option>
          ))}
        </select>
        <select
          aria-label="Only cards that"
          value={filter.cls ?? ""}
          onChange={(e) => setFilter({ ...filter, cls: e.target.value || undefined })}
          className="rounded border border-border bg-surface-2 px-1.5 py-1"
        >
          <option value="">Every card</option>
          {Object.entries(CLASSES).map(([k, t]) => (
            <option key={k} value={k}>
              {t}
            </option>
          ))}
        </select>
        {(filter.rank || filter.suit) && (
          <button type="button" onClick={() => setFilter({ cls: filter.cls })} className="rounded-md border border-border px-2 py-0.5 hover:bg-surface-2">
            Every {filter.rank ? "rank" : "suit"}
          </button>
        )}
        {lines}
      </div>
      <div className="max-h-[56vh] overflow-auto rounded-lg border border-border">
        <table className="w-full border-collapse text-xs tabular-nums">
          <thead className="sticky top-0 z-10 bg-surface text-left text-muted">
            <tr>
              {head("card", ro.street === "river" ? "River" : "Turn", "sticky left-0 bg-surface")}
              <th scope="col" className="px-2 py-1.5 font-medium">
                {part.actor}
                {w === "after" ? " after a check" : ""}
              </th>
              {acts.map((n, i) => head(`a${i}`, label(n), "text-right"))}
              {!ro.multiway && (
                <>
                  {head("ev0", `${o} EV`, "text-right")}
                  {head("ev1", `${ip} EV`, "text-right")}
                  {head("eq0", `${o} eq`, "hidden text-right sm:table-cell")}
                  {head("eq1", `${ip} eq`, "hidden text-right sm:table-cell")}
                </>
              )}
            </tr>
          </thead>
          <tbody>
            <tr aria-label="Average" className="border-t border-border bg-surface-2 font-semibold">
              <td className="sticky left-0 bg-surface-2 px-2 py-1">
                {rs.length === all.length ? `All ${all.length} cards` : `${rs.length} card${rs.length === 1 ? "" : "s"}`}
                <small className="block font-normal text-faint">
                  {pct(sum.p, 0)} of {ro.street}s
                </small>
              </td>
              <td className="w-1/3 px-2 py-1">{bar(sum.f)}</td>
              {nums(sum)}
            </tr>
            {group &&
              groups(rs, group).map((g) => (
                <tr key={g.g} aria-label={g.label} className="border-t border-border bg-surface">
                  <td className="sticky left-0 bg-surface px-2 py-1">
                    <button type="button" title="Only these cards" onClick={() => {
                        setFilter({ ...filter, [group]: g.g });
                        setGroup("");
                      }} className="text-left underline-offset-2 hover:underline">
                      {g.label}
                    </button>
                    <small className="block text-faint">
                      {g.n} card{g.n === 1 ? "" : "s"}, {pct(g.p)}
                    </small>
                  </td>
                  <td className="px-2 py-1">{bar(g.f)}</td>
                  {nums(g)}
                </tr>
              ))}
            {rs.map((r) => (
              <tr key={r.card} aria-label={r.card} className="border-t border-border hover:bg-surface-2">
                <td className="sticky left-0 bg-bg px-2 py-1">
                  <button type="button" aria-label={`Deal ${r.card}`} title={`Deal ${r.card}`} onClick={() => onDeal(r.card)} className="flex items-center gap-1.5">
                    <PlayingCard card={r.card} size="sm" />
                    <small className="text-faint">{SHORT[r.cls]}</small>
                  </button>
                </td>
                <td className="px-2 py-1">{bar(r.f, r.fe)}</td>
                {nums(r)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted">
        {noteText(ro)} Click a card to deal it.
        {ro.tournament ? " A tournament: the solve pays prize equity (ICM), so EVs are chips worth as much prize equity." : ""}
      </p>
    </div>
  );
}
