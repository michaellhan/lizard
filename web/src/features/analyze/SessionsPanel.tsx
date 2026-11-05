// Your sessions (sessions.ts) and how your decisions moved across them (trend.ts): one kind of game and one basis at a
// time, a line of the share in the mix, your latest third against the two thirds before, then the sessions, newest
// first. A session picked is a filter like the hands table's (`sess`): the report, the drill, the results and the
// stats follow it, and grading takes its hands alone. Everything is read from the hands and grades kept.
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { bringIntoView } from "@/components/scroll";
import type { DecisionRecord, HandRecord } from "@/data/db";
import { VERSION_UNKNOWN, versionNote } from "@/grading/version";
import { filterHands, filterKey } from "./analyze";
import { BASES } from "./report";
import { clockOf, handKind, inSess, parseSess, sessionsOf, sessWords, type HandKind, type Sitting } from "./sessions";
import { answersOf, counted, MIN_BLOCKS, MIN_SHARE, MIN_SIDE, MIN_ROW, moreForLine, BLOCK, tallies, trendOf, type Block, type LatestThird, type Shift, type Tally, type Trend } from "./trend";
import { readWins, signed, type HandWin } from "./winnings";

const KINDS: { kind: HandKind; label: string }[] = [
  { kind: "cash", label: "Cash games" },
  { kind: "tour", label: "Tournaments" },
  { kind: "practice", label: "Practice" },
];
/** filters that pick hands by how they went or by one sitting: over them a trend means nothing */
const NARROW = ["sess", "lost", "tag", "q"] as const;
/** the sessions listed before "Show all" */
const LIST = 50;
/** categorical slot 1, as Your results' total (validated on the dark surface, the only theme: dataviz validate_palette) */
const LINE = "#3987e5";

const pct = (x: number) => `${Math.round(x * 100)}%`;
const plural = (n: number, one: string) => `${n.toLocaleString()} ${one}${n === 1 ? "" : "s"}`;
const dayOf = (t: number) => clockOf(t).slice(0, 10);
const span = (from: number, to: number) => (dayOf(from) === dayOf(to) ? dayOf(from) : `${dayOf(from)} to ${dayOf(to)}`);
function durOf(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 1) return "";
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")}`;
}

export function SessionsPanel({
  hands,
  decisions,
  params,
  lost,
  set,
}: {
  /** every hand kept: a sitting doesn't depend on the filters */
  hands: HandRecord[];
  decisions: DecisionRecord[];
  params: URLSearchParams;
  lost: ReadonlyMap<string, number>;
  set: (o: Record<string, string | null>) => void;
}) {
  // (grading adds decisions hand by hand: the page keeps answering while this catches up)
  const ds = useDeferredValue(decisions);
  const sess = params.get("sess");
  const sits = useMemo(() => sessionsOf(hands), [hands]);
  const byLost = params.get("lost") ? lost : undefined;
  // (what the rows count: the filters but the session itself)
  const restKey = filterKey(params, "sess");
  const rest = useMemo(() => filterHands(hands, new URLSearchParams(restKey), byLost), [hands, restKey, byLost]);
  const kept = useMemo(() => new Set(rest.map((h) => h.id)), [rest]);
  const picked = useMemo(() => (sess ? sits.find((s) => s.key === sess) : undefined), [sits, sess]);

  const [kindPick, setKind] = useState<HandKind | null>(null);
  const [basisPick, setBasis] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const list = useRef<HTMLUListElement>(null);
  // (the button goes as the list grows: the first row it brought takes the focus)
  useEffect(() => {
    if (all) list.current?.children[LIST]?.querySelector("button")?.focus();
  }, [all]);
  const kinds = useMemo(() => {
    const n = new Map<HandKind, number>();
    for (const h of rest) n.set(handKind(h), (n.get(handKind(h)) ?? 0) + 1);
    return KINDS.filter((k) => n.has(k.kind)).sort((a, b) => n.get(b.kind)! - n.get(a.kind)!);
  }, [rest]);
  const kind = picked?.kind ?? (kindPick && kinds.some((k) => k.kind === kindPick) ? kindPick : kinds[0]?.kind ?? null);
  const ofKind = useMemo(() => sits.filter((s) => s.kind === kind), [sits, kind]);
  const answers = useMemo(() => answersOf(ds, ofKind, kept), [ds, ofKind, kept]);
  // (a basis is listed once anything stands on it; its n is what its line counts)
  const bases = useMemo(() => BASES.filter((b) => answers.some((a) => a.basis === b)).map((b) => ({ basis: b, n: counted(answers, b).length })), [answers]);
  const basis =
    (basisPick && bases.some((b) => b.basis === basisPick) ? basisPick : (bases.find((b) => b.n >= MIN_BLOCKS * BLOCK) ?? [...bases].sort((a, b) => b.n - a.n)[0])?.basis) ?? null;
  const narrow = NARROW.filter((k) => params.get(k));
  const trend = useMemo(() => (basis && !narrow.length ? trendOf(answers, basis) : null), [answers, basis, narrow.length]);
  const counts = useMemo(() => tallies(ds, ofKind, kept, answers, basis), [ds, ofKind, kept, answers, basis]);

  // the rows, newest first, with the hands the filters keep: the session picked alone, whatever those are
  const rows = useMemo(
    () =>
      ofKind
        .map((s, k) => ({ s, k, hands: s.hands.filter((h) => kept.has(h.id)) }))
        .filter((r) => (sess ? r.s === picked : r.hands.length))
        .sort((a, b) => (a.s.first ? 0 : 1) - (b.s.first ? 0 : 1) || b.s.first - a.s.first || b.k - a.k),
    [ofKind, kept, sess, picked],
  );
  const listed = useMemo(() => (all ? rows : rows.slice(0, LIST)), [rows, all]);
  // Won, read for the rows listed alone (it reads each hand's text; the page's own results share what's read)
  const toRead = useMemo(() => (kind === "tour" ? [] : listed.flatMap((r) => r.hands)), [listed, kind]);
  const [wins, setWins] = useState<{ of: HandRecord[]; by: Map<string, HandWin> } | null>(null);
  useEffect(() => {
    const ac = new AbortController();
    void readWins(toRead, { signal: ac.signal }).then((list) => list && setWins({ of: toRead, by: new Map(list.map((x) => [x.h.id, x.w])) }));
    return () => ac.abort();
  }, [toRead]);

  // (the button pressed goes with the session: the heading holds the place)
  const head = useRef<HTMLHeadingElement>(null);
  const clear = () => {
    head.current?.focus();
    set({ sess: null });
  };
  return (
    <section aria-label="Your sessions" className="space-y-3 text-sm">
      <div>
        <h2 ref={head} tabIndex={-1} className="text-lg font-semibold">
          Your sessions
        </h2>
        <p className="text-muted">
          A session is a sitting by the site&rsquo;s own clock: one kind of game at one site, ended by a break over 30 minutes (8 hours in a tournament). Sessions are
          read from the hands kept, so these numbers move as hands and grades change, and deleting an import removes its sessions. You choose what to grade, so
          the sessions graded may not be typical. Pick one for its hands, report and results; grading then takes its hands alone.
        </p>
      </div>
      {sess && !picked && <Missing sess={sess} hands={hands} onClear={clear} />}
      {(kinds.length > 1 || bases.length > 0) && (
        <div className="flex flex-wrap items-center gap-3">
          {!sess && kinds.length > 1 && (
            <label className="flex items-center gap-1">
              <span>Games</span>
              <select value={kind ?? ""} onChange={(e) => setKind(e.target.value as HandKind)} className="rounded border border-border bg-bg px-1 py-0.5">
                {kinds.map((k) => (
                  <option key={k.kind} value={k.kind}>
                    {k.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {bases.length > 0 && basis && (
            <label className="flex min-w-0 items-center gap-1">
              <span className="whitespace-nowrap">Graded on</span>
              <select value={basis} onChange={(e) => setBasis(e.target.value)} className="min-w-0 max-w-full rounded border border-border bg-bg px-1 py-0.5">
                {bases.map((b) => (
                  <option key={b.basis} value={b.basis}>
                    {b.basis} · {b.n.toLocaleString()}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}
      {!sess && rest.length < hands.length && (
        <p className="text-muted">
          Over the {plural(rest.length, "hand")} the filters show, of {hands.length.toLocaleString()} kept.
        </p>
      )}
      {!sess && narrow.length > 0 && <p className="text-xs text-muted">The line and the comparison are left out while the EV lost, tag or search filters pick hands by how they went.</p>}
      {trend && basis && <TrendView trend={trend} basis={basis} sits={ofKind} />}
      {!sess && !answers.length && rows.length > 0 && <p className="text-muted">Nothing is graded here yet: grade some decisions above for a line.</p>}
      {listed.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs text-muted">
            {basis ? `In the mix: Best or Correct, on ${basis}, clear folds left out.` : "In the mix: none graded here yet."} Won is what the histories say, in big blinds, nothing
            graded: a tournament&rsquo;s chips aren&rsquo;t money, and a hand left out doesn&rsquo;t say what it won (Your results says why).
          </p>
          <ul ref={list} aria-label="Sessions" className="space-y-1">
            {listed.map((r) => (
              <SessionRow key={r.s.key} s={r.s} hands={r.hands} tally={counts[r.k]} wins={wins?.of === toRead ? wins.by : null} on={r.s === picked} onPick={() => set({ sess: r.s.key })} onClear={clear} />
            ))}
          </ul>
          {!all && rows.length > LIST && (
            <button type="button" onClick={() => setAll(true)} className="rounded border border-border px-2 py-0.5 text-xs hover:bg-surface-2">
              Show all {rows.length.toLocaleString()} sessions
            </button>
          )}
        </div>
      )}
    </section>
  );
}

/** A `sess` link with no session behind it: the hands now in its range, or none. */
function Missing({ sess, hands, onClear }: { sess: string; hands: HandRecord[]; onClear: () => void }) {
  const n = useMemo(() => hands.filter(inSess(sess)).length, [hands, sess]);
  return (
    <p role="status" aria-label="Session not found" className="flex flex-wrap items-center gap-2 text-muted">
      <span>{!parseSess(sess) ? "That session can't be read." : n ? `Changed: ${plural(n, "hand")} kept in that time, ${sessWords(sess)}.` : `Not kept here: ${sessWords(sess)}.`}</span>
      <button type="button" onClick={onClear} className="rounded border border-border px-2 py-0.5 text-xs hover:bg-surface-2">
        All sessions
      </button>
    </p>
  );
}

function SessionRow({
  s,
  hands,
  tally,
  wins,
  on,
  onPick,
  onClear,
}: {
  s: Sitting;
  hands: HandRecord[];
  tally: Tally | undefined;
  /** each hand's result, once read */
  wins: Map<string, HandWin> | null;
  on: boolean;
  onPick: () => void;
  onClear: () => void;
}) {
  const decisions = hands.reduce((t, h) => t + h.decisions, 0);
  const results = wins && hands.map((h) => wins.get(h.id));
  const net = results?.reduce((t, w) => t + (w?.net ?? 0), 0) ?? 0;
  const left = results?.filter((w) => w?.net == null).length ?? 0;
  const dur = s.first ? durOf(s.last - s.first) : "";
  const n = tally?.n ?? 0;
  const box = useRef<HTMLLIElement>(null);
  // (the list folds to the session picked: brought into view)
  useEffect(() => {
    if (on) bringIntoView(box.current);
  }, [on]);
  return (
    <li ref={box} aria-current={on || undefined} className={`flex scroll-mt-16 flex-wrap items-center gap-x-3 gap-y-0.5 rounded border px-2 py-1 ${on ? "border-accent bg-surface-2" : "border-border bg-surface"}`}>
      <button type="button" onClick={onPick} aria-label={`Session ${sessWords(s.key)}`} className="font-medium hover:underline">
        {s.hands[0]!.played || "Undated"}
      </button>
      <span className="text-muted">
        {s.site}
        {s.tournament ? ` · ${s.tournament}` : ""}
        {dur ? ` · ${dur}` : ""}
      </span>
      <span className="tabular-nums">{hands.length < s.hands.length ? `${hands.length.toLocaleString()} of ${plural(s.hands.length, "hand")}` : plural(hands.length, "hand")}</span>
      <span className="tabular-nums">
        won {s.kind === "tour" ? "—" : !results ? "(adding up…)" : left === hands.length ? "—" : `${signed(net)}bb`}
        {left > 0 && left < hands.length && <span className="text-muted"> ({left.toLocaleString()} left out)</span>}
      </span>
      <span className="tabular-nums text-muted">
        {(tally?.graded ?? 0).toLocaleString()} of {decisions.toLocaleString()} graded
      </span>
      <span className="tabular-nums">{!n ? "—" : n < MIN_SHARE ? `${tally!.ok} of ${n} in the mix` : `${pct(tally!.ok / n)} in the mix (${n.toLocaleString()})`}</span>
      {on && (
        <button type="button" onClick={onClear} className="ml-auto rounded border border-border px-2 py-0.5 text-xs hover:bg-surface-2">
          All sessions
        </button>
      )}
    </li>
  );
}

function TrendView({ trend, basis, sits }: { trend: Trend; basis: string; sits: readonly Sitting[] }) {
  const { n, points, latest, rows } = trend;
  return (
    <div className="space-y-2">
      {points.length >= MIN_BLOCKS ? (
        <TrendChart basis={basis} points={points} />
      ) : (
        <p className="text-muted">
          {basis}: {moreForLine(n).toLocaleString()} more {moreForLine(n) === 1 ? "decision" : "decisions"} for a line (clear folds and undated hands left out).
        </p>
      )}
      {latest && <Verdict latest={latest} basis={basis} since={sits[latest.at]?.first ?? 0} />}
      {rows && <Rows shifts={rows.rows} tooFew={rows.tooFew} noMix={rows.noMix} />}
    </div>
  );
}

function Verdict({ latest: l, basis, since }: { latest: LatestThird; basis: string; since: number }) {
  return (
    <p role="group" aria-label="Latest sessions against before">
      {basis}: {pct(l.ok2 / l.n2)} in the mix over your latest {plural(l.n2, "decision")} (since {dayOf(since)}), {pct(l.ok1 / l.n1)} over the {l.n1.toLocaleString()} before.{" "}
      {l.enough ? (
        <strong className="font-medium">{l.change ?? "No clear change"}.</strong>
      ) : (
        <span className="text-muted">
          Under {MIN_SIDE} on a side is too few to call the share as a whole; a row below needs {MIN_ROW}.
        </span>
      )}{" "}
      {versionNote(l.versions) && <span role="group" aria-label="Versions compared">{versionNote(l.versions)} </span>}
      <span className="text-muted">The share moves with the spots dealt as well as with how they were played; the rows below compare a spot with itself, though another table size or depth still moves its answer.</span>
    </p>
  );
}

const side = (r: Shift, k: 0 | 1) => {
  const n = r.n[k].toLocaleString();
  if (r.kind === "freq") return `you ${pct(r.you[k])}, the answer ${pct(r.gto[k])} (${n})`;
  const avg = r.kind === "spot" ? r.avg[k] : null;
  return `${pct(r.share[k])} in the mix (${n})${avg != null ? `, ${avg.toFixed(2)}bb lost per decision` : ""}`;
};

function Rows({ shifts, tooFew, noMix }: { shifts: Shift[]; tooFew: number; noMix: number }) {
  const called = shifts.filter((r) => r.change);
  const rest = shifts.filter((r) => !r.change);
  const table = (rows: Shift[], label: string) => (
    <div className="overflow-x-auto">
      <table aria-label={label} className="text-left">
        <thead className="text-xs text-muted">
          <tr>
            <th className="py-0.5 pr-4 font-normal">Spot</th>
            <th className="py-0.5 pr-4 font-normal">Before</th>
            <th className="py-0.5 pr-4 font-normal">Latest</th>
            <th className="py-0.5 pr-4 font-normal">Change</th>
            <th className="py-0.5 pr-4 font-normal">Versions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.kind}:${r.key}`}>
              <td className="py-0.5 pr-4">{r.key}</td>
              <td className="py-0.5 pr-4 tabular-nums">{side(r, 0)}</td>
              <td className="py-0.5 pr-4 tabular-nums">{side(r, 1)}</td>
              <td className="whitespace-nowrap py-0.5 pr-4">
                {r.change ?? "No clear change"}
                {r.leak ? " · Leak now" : ""}
              </td>
              <td className="min-w-48 py-0.5 pr-4 text-xs">{versionNote(r.versions) ?? <span className="text-muted">Same</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
  if (!shifts.length && !tooFew) return null;
  return (
    <div className="space-y-1">
      {called.length > 0 && table(called, "Changes against before")}
      {rest.length > 0 && (
        <details>
          <summary className="cursor-pointer text-muted">
            {called.length ? "The rest" : "No row changed clearly"} ({rest.length.toLocaleString()})
          </summary>
          {table(rest, "No clear change against before")}
        </details>
      )}
      <p className="text-xs text-muted">
        Rows are chosen by their size alone, and include clear folds as the Report does.
        {tooFew > 0 ? ` ${tooFew.toLocaleString()} more ${tooFew === 1 ? "has" : "have"} under ${MIN_ROW} decisions on a side.` : ""}
        {shifts.length > 0 ? " About one row in a hundred shows a change by chance." : ""}
        {noMix > 0 ? ` ${plural(noMix, "read")} checked before a read's own mix was kept ${noMix === 1 ? "is" : "are"} left out of the frequencies.` : ""}
        {shifts.length > 0 ? " Where a row spans versions, part of its change can be the answer's: the preflop charts come with the solver build, and a library version is its spot's ranges and bet tree." : ""}
        {shifts.some((r) => r.versions.unknown[0] + r.versions.unknown[1] > 0) ? ` ${VERSION_UNKNOWN}` : ""}
      </p>
    </div>
  );
}

const AXIS = [0, 25, 50, 75, 100];

/** The share by blocks of decisions: a line with its 95% band on a fixed 0 to 100% axis. `about`: what the line counts,
 * where it isn't this page's. */
export function TrendChart({ basis, points, about }: { basis: string; points: Block[]; about?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const n = points.length;
  const xAt = (i: number) => ((i + 0.5) / n) * 100;
  const yAt = (v: number) => (1 - v) * 100;
  const at = (e: { currentTarget: HTMLDivElement; clientX: number }) => {
    const r = e.currentTarget.getBoundingClientRect();
    return r.width > 0 ? Math.min(n - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * n))) : null;
  };
  const up = points.map((p, i) => `${xAt(i)} ${yAt(p.range[1])}`);
  const down = points.map((p, i) => `${xAt(i)} ${yAt(p.range[0])}`).reverse();
  const p = hover != null ? points[hover] : undefined;
  const x = hover != null ? xAt(hover) : 0;
  const last = points.at(-1)!;
  return (
    <figure className="space-y-1">
      <figcaption>
        <span className="font-medium">{basis}</span>
        <span className="text-xs text-muted">
          {" "}
          · {about ?? `share of decisions in the mix, by blocks of about ${points[0]!.n.toLocaleString()} in the order played, clear folds left out; the band is its 95% range.`}
        </span>
      </figcaption>
      <div className="flex h-44">
        <div aria-hidden className="relative w-10 shrink-0 text-right text-[10px] text-muted">
          {AXIS.map((v) => (
            <span key={v} className="absolute right-1 -translate-y-1/2 tabular-nums" style={{ top: `${100 - v}%` }}>
              {v}%
            </span>
          ))}
        </div>
        <div
          role="slider"
          tabIndex={0}
          aria-label={`${basis}: in the mix by blocks, from ${pct(points[0]!.share)} to ${pct(last.share)} over ${n} blocks. The arrow keys read the line, and its numbers follow.`}
          aria-valuemin={1}
          aria-valuemax={n}
          aria-valuenow={(hover ?? n - 1) + 1}
          aria-valuetext={`Block ${(hover ?? n - 1) + 1} of ${n}: ${pct((p ?? last).share)} in the mix (${pct((p ?? last).range[0])} to ${pct((p ?? last).range[1])}), ${plural((p ?? last).n, "decision")}, ${span((p ?? last).from, (p ?? last).to)}`}
          className="relative flex-1 outline-offset-2"
          onPointerMove={(e) => setHover(at(e))}
          onPointerLeave={() => setHover(null)}
          onFocus={() => setHover((h) => h ?? n - 1)}
          onBlur={() => setHover(null)}
          // (a tap comes with no move before it, and leaves as it lifts: the block is read on its click)
          onClick={(e) => setHover(at(e))}
          onKeyDown={(e) => {
            if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
            e.preventDefault();
            setHover((h) => Math.min(n - 1, Math.max(0, (h ?? n - 1) + (e.key === "ArrowLeft" ? -1 : 1))));
          }}
        >
          {AXIS.map((v) => (
            <div key={v} aria-hidden className="pointer-events-none absolute inset-x-0 border-t border-border" style={{ top: `${100 - v}%` }} />
          ))}
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden>
            <path d={`M${[...up, ...down].join("L")}Z`} fill={LINE} fillOpacity={0.15} stroke="none" />
            <path d={`M${points.map((b, i) => `${xAt(i)} ${yAt(b.share)}`).join("L")}`} fill="none" stroke={LINE} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          </svg>
          {points.map((b, i) => (
            <span
              key={i}
              aria-hidden
              className="pointer-events-none absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-bg"
              style={{ left: `${xAt(i)}%`, top: `${yAt(b.share)}%`, background: LINE }}
            />
          ))}
          {p && (
            <>
              <div aria-hidden className="pointer-events-none absolute inset-y-0 z-10 w-px bg-muted" style={{ left: `${x}%` }} />
              <div
                role="tooltip"
                className={`pointer-events-none absolute z-20 w-max ${p.share > 0.5 ? "bottom-1" : "top-1"} max-w-[min(16rem,100%)] rounded-md border border-border bg-surface-2 px-2 py-1.5 text-xs text-text shadow-lg`}
                style={x < 50 ? { left: `clamp(0px, calc(${x}% + 8px), calc(100% - min(16rem, 100%)))` } : { right: `clamp(0px, calc(${100 - x}% + 8px), calc(100% - min(16rem, 100%)))` }}
              >
                <p className="tabular-nums">
                  {pct(p.share)} in the mix <span className="text-muted">({pct(p.range[0])} to {pct(p.range[1])})</span>
                </p>
                <p className="text-muted">
                  {plural(p.n, "decision")}, {span(p.from, p.to)}
                </p>
              </div>
            </>
          )}
        </div>
      </div>
      <div aria-hidden className="ml-10 flex justify-between text-[10px] text-muted">
        <span>{dayOf(points[0]!.from)}</span>
        <span>{dayOf(last.to)}</span>
      </div>
      <details className="text-xs">
        <summary className="cursor-pointer text-muted">The line&rsquo;s numbers</summary>
        <div className="overflow-x-auto">
          <table aria-label="The line by blocks" className="text-left">
            <thead className="text-muted">
              <tr>
                <th className="py-0.5 pr-4 font-normal">Played</th>
                <th className="py-0.5 pr-4 font-normal">Decisions</th>
                <th className="py-0.5 pr-4 font-normal">In the mix</th>
                <th className="py-0.5 pr-4 font-normal">95% range</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {points.map((b, i) => (
                <tr key={i}>
                  <td className="whitespace-nowrap py-0.5 pr-4">{span(b.from, b.to)}</td>
                  <td className="py-0.5 pr-4">{b.n.toLocaleString()}</td>
                  <td className="py-0.5 pr-4">{pct(b.share)}</td>
                  <td className="whitespace-nowrap py-0.5 pr-4">
                    {pct(b.range[0])} to {pct(b.range[1])}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
