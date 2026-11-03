// Your results as played (winnings.ts) over the hands the filters show: what you won or lost in big blinds, bb/100
// with its 95% interval, at showdown and without, the running total hand by hand and by your seat. Read from the
// histories' winnings lines; nothing is graded or solved. Practice's hands (and the classic app's) are a group of their
// own: played against the page's opponents, they aren't results against people.
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import type { HandRecord } from "@/data/db";
import { RESULT_WHY } from "@/hh/results";
import { seatLabel } from "@/poker/seats";
import { withParams } from "./leakDrill";
import { winningsOf, type WinGroup, type Winnings } from "./winnings";

const nHands = (n: number) => `${n.toLocaleString()} ${n === 1 ? "hand" : "hands"}`;
const sign = (x: number) => (x > 0.00005 ? "+" : x < -0.00005 ? "−" : "");
const signed = (x: number, d = 1) => `${sign(x)}${Math.abs(x).toFixed(d)}`;
const signedBb = (x: number, d = 1) => `${signed(x, d)}bb`;
const signedMoney = (unit: string, x: number) => `${sign(x)}${unit}${Math.abs(x).toFixed(2)}`;
/** fewer hands than this: bb/100 is said to be mostly luck */
const FEW = 10000;
/** the chart's colors: categorical slots 1-4, validated on the dark surface (dataviz validate_palette); the all-in EV
 * line is dashed besides */
const LINES = [
  { key: "total", label: "In all", color: "#3987e5", dash: false },
  { key: "atSd", label: "At showdown", color: "#d95926", dash: false },
  { key: "noSd", label: "Without showdown", color: "#199e70", dash: false },
  { key: "evRun", label: "All-in EV", color: "#c98500", dash: true },
] as const;
const pctOf = (x: number) => `${(x * 100).toFixed(1)}%`;

export function WinningsPanel({ hands, of }: { hands: HandRecord[]; of: number }) {
  const [res, setRes] = useState<{ of: HandRecord[]; w: Winnings } | null>(null);
  const [done, setDone] = useState<{ of: HandRecord[]; n: number } | null>(null);
  useEffect(() => {
    const ac = new AbortController();
    void winningsOf(hands, { signal: ac.signal, onProgress: (n) => setDone({ of: hands, n }) }).then((w) => w && setRes({ of: hands, w }));
    return () => ac.abort();
  }, [hands]);
  const w = res?.w;
  const counting = res?.of !== hands;
  const byId = new Map(hands.map((h) => [h.id, h]));
  return (
    <section aria-label="Your results" className="space-y-3 text-sm">
      <div>
        <h2 className="text-lg font-semibold">Your results</h2>
        <p className="text-muted">
          What you won or lost in {hands.length < of ? `the ${nHands(hands.length)} the filters show` : `your ${nHands(hands.length)}`}, as the
          histories say: what each pot paid you (after the rake) less what you put in, blinds and antes as posted, in big blinds. Nothing here is
          graded or solved. The all-in EV counts each all-in heads-up with cards to come and both hands shown at your equity&rsquo;s
          share of the pot (exact from the flop on; preflop from 20,000 sampled boards), every other hand as it went. Cash games, tournaments (their chips being no money) and the hands you played in Practice (or the classic app) against its
          opponents are kept apart.
          {w?.left.map((x) => ` ${x.n.toLocaleString()} ${x.n === 1 ? "hand is" : "hands are"} left out: ${RESULT_WHY[x.why]}.`).join("")}
        </p>
      </div>
      {counting && (
        <p role="status" aria-label="Reading results" className="text-muted">
          Reading… {done?.of === hands ? `${done.n.toLocaleString()} of ${hands.length.toLocaleString()} hands` : ""}
        </p>
      )}
      {w && !w.cash && !w.tour && !w.practice && <p className="text-muted">No hand here says what it won.</p>}
      {w?.cash && <Group title="Cash games" g={w.cash} byId={byId} />}
      {w?.tour && <Group title="Tournaments" g={w.tour} byId={byId} />}
      {w?.practice && <Group title="Practice" g={w.practice} byId={byId} />}
    </section>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2">
      <p className="text-xs text-muted">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
      {sub && <p className="text-xs text-muted">{sub}</p>}
    </div>
  );
}

function Group({ title, g, byId }: { title: string; g: WinGroup; byId: Map<string, HandRecord> }) {
  const range = g.range && `95% range ${signed(g.range[0])} to ${signed(g.range[1])}`;
  return (
    <div role="region" aria-label={title} className="space-y-2">
      <h3 className="font-medium">
        {title} <span className="font-normal text-muted">({nHands(g.hands)})</span>
      </h3>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <Tile label="Won" value={signedBb(g.net)} sub={g.money.map((m) => signedMoney(m.unit, m.net)).join(" · ") || undefined} />
        <Tile label="All-in EV" value={signedBb(g.ev)} sub={`${g.allIns.toLocaleString()} ${g.allIns === 1 ? "all-in" : "all-ins"} at their equity`} />
        <Tile label="bb/100" value={signed(g.bb100)} sub={range || undefined} />
        <Tile label="At showdown" value={signedBb(g.sd)} />
        <Tile label="Without showdown" value={signedBb(g.nonSd)} />
      </div>
      {g.hands < FEW && (
        <p className="text-xs text-muted">
          Over {nHands(g.hands)}, bb/100 is mostly the cards: its range is wide until there are tens of thousands of hands.
        </p>
      )}
      {g.hands > 1 && <RunChart g={g} byId={byId} />}
      <ByPos g={g} />
    </div>
  );
}

/** round tick steps (1, 2, 5 × 10^k) for about four lines */
function ticks(lo: number, hi: number): number[] {
  const span = hi - lo || 1;
  const raw = span / 4;
  const p = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * p).find((s) => s >= raw)!;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

/** at most this many points per line: a long session is drawn every k hands (the tooltip reads every hand) */
const MAX_POINTS = 1200;
function linePath(ys: number[], top: number): string {
  const n = ys.length;
  const k = Math.max(1, Math.ceil(n / MAX_POINTS));
  let d = `M0 ${top}`;
  for (let i = k - 1; i < n; i += k) d += `L${i + 1} ${top - ys[i]!}`;
  if ((n - 1) % k !== k - 1) d += `L${n} ${top - ys[n - 1]!}`;
  return d;
}

function RunChart({ g, byId }: { g: WinGroup; byId: Map<string, HandRecord> }) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [hover, setHover] = useState<number | null>(null);
  const n = g.hands;
  const all = [0, ...g.total, ...g.atSd, ...g.noSd, ...g.evRun];
  const t = ticks(Math.min(...all), Math.max(...all));
  const lo = Math.min(t[0]!, ...all);
  const hi = Math.max(t.at(-1)!, ...all);
  const span = hi - lo || 1;
  const yAt = (v: number) => ((hi - v) / span) * 100;
  // (the hand under the pointer; a click reads its own, as a tap on a touch screen comes with no move before it)
  const at = (e: { currentTarget: HTMLDivElement; clientX: number }) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (!(r.width > 0)) return null;
    return Math.min(n - 1, Math.max(0, Math.round(((e.clientX - r.left) / r.width) * n) - 1));
  };
  const series = { total: g.total, atSd: g.atSd, noSd: g.noSd, evRun: g.evRun };
  const h = hover != null ? byId.get(g.ids[hover]!) : undefined;
  const own = hover != null ? g.total[hover]! - (hover > 0 ? g.total[hover - 1]! : 0) : 0;
  const allIn = hover != null ? g.allIn[g.ids[hover]!] : undefined;
  const x = hover != null ? (hover + 1) / n : 0;
  return (
    <figure className="space-y-1">
      <figcaption className="text-xs text-muted">
        The running total, hand by hand in the order played (by the history&rsquo;s clock), in big blinds. Hover a hand for its numbers, click it to
        open it.
      </figcaption>
      <ul aria-label="Lines" className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {LINES.map((l) => (
          <li key={l.key} className="inline-flex items-center gap-1.5">
            <Swatch color={l.color} dash={l.dash} />
            {l.label} <span className="tabular-nums text-muted">{signedBb(series[l.key].at(-1)!)}</span>
          </li>
        ))}
      </ul>
      <div className="flex h-48">
        <div aria-hidden className="relative w-12 shrink-0 text-right text-[10px] text-muted">
          {t.map((v) => (
            <span key={v} className="absolute right-1 -translate-y-1/2 tabular-nums" style={{ top: `${yAt(v)}%` }}>
              {v > 0 ? "+" : v < 0 ? "−" : ""}
              {Math.abs(v).toLocaleString()}
            </span>
          ))}
        </div>
        <div
          role="img"
          aria-label={`Running total over ${nHands(n)}: ${LINES.map((l) => `${l.label} ${signedBb(series[l.key].at(-1)!)}`).join(", ")}`}
          className={`relative flex-1 ${h ? "cursor-pointer" : ""}`}
          onPointerMove={(e) => setHover(at(e))}
          onPointerLeave={() => setHover(null)}
          onClick={(e) => {
            const k = at(e);
            if (k != null) void navigate(withParams(params, { hand: g.ids[k]! }));
          }}
        >
          {t.map((v) => (
            <div
              key={v}
              aria-hidden
              className={`pointer-events-none absolute inset-x-0 border-t ${v === 0 ? "border-muted" : "border-border"}`}
              style={{ top: `${yAt(v)}%` }}
            />
          ))}
          <svg viewBox={`0 0 ${n} ${span}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden>
            {[...LINES].reverse().map((l) => (
              <path
                key={l.key}
                d={linePath(series[l.key], hi)}
                fill="none"
                stroke={l.color}
                strokeWidth={2}
                strokeDasharray={l.dash ? "5 4" : undefined}
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </svg>
          {hover != null && h && (
            <>
              <div aria-hidden className="pointer-events-none absolute inset-y-0 z-10 w-px bg-muted" style={{ left: `${x * 100}%` }} />
              {LINES.map((l) => (
                <span
                  key={l.key}
                  aria-hidden
                  className="pointer-events-none absolute z-10 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-bg"
                  style={{ left: `${x * 100}%`, top: `${yAt(series[l.key][hover]!)}%`, background: l.color }}
                />
              ))}
              <div
                role="tooltip"
                className="pointer-events-none absolute top-1 z-20 w-max max-w-[16rem] rounded-md border border-border bg-surface-2 px-2 py-1.5 text-xs text-text shadow-lg"
                style={x < 0.5 ? { left: `calc(${x * 100}% + 8px)` } : { right: `calc(${(1 - x) * 100}% + 8px)` }}
              >
                <p>
                  Hand {(hover + 1).toLocaleString()} of {n.toLocaleString()}
                  {h.played && <span className="text-muted"> · {h.played}</span>}
                </p>
                <p className="text-muted">
                  {seatLabel(h.hero, h.players)} {h.hole} · {h.end}
                </p>
                <p>
                  This hand {signedBb(own, 2)}
                </p>
                {allIn && (
                  <p className="text-muted">
                    All-in {allIn.street === "preflop" ? "preflop" : `on the ${allIn.street}`}: {pctOf(allIn.equity)}
                    {allIn.exact ? "" : " (sampled)"} against {allIn.cards.join("")}, EV {signedBb(allIn.ev, 2)}
                  </p>
                )}
                {LINES.map((l) => (
                  <p key={l.key} className="flex items-center gap-1.5">
                    <Swatch color={l.color} dash={l.dash} />
                    {l.label} <span className="ml-auto pl-2 tabular-nums">{signedBb(series[l.key][hover]!)}</span>
                  </p>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </figure>
  );
}

function Swatch({ color, dash }: { color: string; dash: boolean }) {
  return (
    <svg aria-hidden width="16" height="4" className="shrink-0">
      <line x1="1" y1="2" x2="15" y2="2" stroke={color} strokeWidth="2" strokeLinecap="round" strokeDasharray={dash ? "4 3" : undefined} />
    </svg>
  );
}

function ByPos({ g }: { g: WinGroup }) {
  return (
    <div className="relative overflow-x-auto">
      <table aria-label="Results by your seat" className="text-left">
        <thead className="text-xs text-muted">
          <tr>
            <th className="pr-4 font-normal">Your seat</th>
            <th className="pr-4 text-right font-normal">Hands</th>
            <th className="pr-4 text-right font-normal">Won</th>
            <th className="pr-4 text-right font-normal">bb/100</th>
          </tr>
        </thead>
        <tbody>
          {g.byPos.map((p) => (
            <tr key={p.pos} aria-label={p.pos} className="border-t border-border">
              <td className="pr-4">{p.pos}</td>
              <td className="pr-4 text-right tabular-nums">{p.hands.toLocaleString()}</td>
              <td className="pr-4 text-right tabular-nums">{signedBb(p.net)}</td>
              <td className="pr-4 text-right tabular-nums">{signed((p.net / p.hands) * 100)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
