// A leak drilled: the decisions behind it dealt again one by one, each as it stood in your hand (your cards, the
// board, the actions before it), answered from the mix kept with its grade, so nothing is asked of the solver (the
// classic analyzer's drillSet: "the spot as it stood, the answer's mix and EVs, misses first"). A pick is graded on
// the one scale (grading/grade.ts) as the decision was: by EV where the mix has EVs, else by frequency.
import type { DecisionRecord, HandRecord, SessionRecord } from "@/data/db";
import { grade, type Grade, type Score } from "@/grading/grade";
import type { ReplayedHand } from "@/hh/replay";
import { seatLabel } from "@/poker/seats";
import type { Street } from "@/poker/table";
import { HAND_FILTERS, STREETS } from "./analyze";
import { isGraded, isOk, leakTest, type Leak } from "./report";
import { sessWords } from "./sessions";

const NEED: Record<Street, number> = { preflop: 0, flop: 3, turn: 4, river: 5 };
const fmt = (x: number) => String(Math.round(x * 100) / 100);

export type LeakRef = Pick<Leak, "kind" | "key">;
export const leakParam = (l: LeakRef) => `${l.kind}:${l.key}`;
export function parseLeakParam(s: string | null): LeakRef | null {
  const m = s ? /^(freq|pf|spot):(.+)$/.exec(s) : null;
  return m ? { kind: m[1] as Leak["kind"], key: m[2]! } : null;
}
export const drillSessionId = (l: LeakRef) => `leak-drill|${leakParam(l)}`;

const FILTER_WORDS: Record<(typeof HAND_FILTERS)[number], string> = {
  pos: "your seat",
  pot: "pot",
  site: "site",
  bb: "stakes",
  from: "from",
  to: "to",
  tag: "tag",
  q: "search",
  lost: "EV lost ≥",
  sess: "session",
};
/** The leak's drill as a link to keep (data/saved.ts): the leak and the hands' filters, nothing else of the page. */
export function leakDrillLink(l: LeakRef, params: URLSearchParams): string {
  const q = new URLSearchParams({ drill: leakParam(l) });
  for (const k of HAND_FILTERS) if (params.get(k)) q.set(k, params.get(k)!);
  return `/analyze?${q}`;
}
/** What the link drills, in words: "Leak: … · your seat BTN, stakes 0.5/1". */
export function leakDrillAbout(l: LeakRef, params: URLSearchParams): string {
  const fs = HAND_FILTERS.filter((k) => params.get(k)).map((k) => `${FILTER_WORDS[k]} ${k === "sess" ? sessWords(params.get(k)!) : params.get(k)}${k === "lost" ? "bb" : ""}`);
  return `Leak: ${l.key}${fs.length ? ` · ${fs.join(", ")}` : ""}`;
}

/** The page's URL search with some params set (the filters and the rest kept), for a link. */
export function withParams(params: URLSearchParams, o: Record<string, string>): string {
  const q = new URLSearchParams(params);
  for (const [k, v] of Object.entries(o)) q.set(k, v);
  return `?${q}`;
}

export interface DrillItem {
  d: DecisionRecord;
  hand: HandRecord;
}

/** The leak's decisions to drill: graded ones whose mix is kept and can be graded again, in hands still kept; your misses
 * first (the most EV lost, then the rarest in the answer), then the rest in the order played. */
export function drillItems(ds: readonly DecisionRecord[], leak: LeakRef, hands: ReadonlyMap<string, HandRecord>): DrillItem[] {
  const test = leakTest(leak);
  const out = ds.filter((d) => isGraded(d) && d.mix?.length && canGradePick(d) && hands.has(d.handId) && test(d)).map((d) => ({ d, hand: hands.get(d.handId)! }));
  const miss = (x: DrillItem) => (isOk(x.d) ? 1 : 0);
  return out.sort(
    (a, b) =>
      miss(a) - miss(b) ||
      (b.d.evLossBb ?? 0) - (a.d.evLossBb ?? 0) ||
      (a.d.freq ?? 0) - (b.d.freq ?? 0) ||
      b.hand.playedAt - a.hand.playedAt ||
      a.d.id.localeCompare(b.d.id),
  );
}

/** The actions before a decision, street by street, as the hand view says them ("UTG folds", "You raise to 2.5"),
 * with the board up to its street. */
export function lineBefore(r: ReplayedHand, street: Street, i: number): { board: string[]; streets: { street: Street; says: string[] }[] } {
  const h = r.hand;
  const k = STREETS.indexOf(street);
  const SAY: Record<string, [string, string]> = {
    fold: ["folds", "fold"],
    check: ["checks", "check"],
    call: ["calls", "call"],
    bet: ["bets", "bet"],
    raise: ["raises to", "raise to"],
    "all-in": ["goes all-in", "go all-in"],
  };
  const streets: { street: Street; says: string[] }[] = [];
  for (const s of STREETS.slice(0, k + 1)) {
    const moves = s === street ? r.lines[s].slice(0, i) : r.lines[s];
    streets.push({
      street: s,
      says: moves.map((m) => {
        const you = m.pos === h.hero;
        return `${you ? "You" : seatLabel(m.pos, h.players)} ${SAY[m.action]?.[you ? 1 : 0] ?? m.action}${m.to !== undefined ? ` ${fmt(m.to)}` : ""}`;
      }),
    });
  }
  return { board: h.board.slice(0, NEED[street]), streets };
}

const evsOf = (d: DecisionRecord) => {
  const mix = d.mix ?? [];
  return mix.every((x) => x[2] !== null) ? mix.map((x) => x[2]!) : null;
};

/** A mix with EVs needs its pot: EV lost is graded as a share of it (a decision kept with none can't be drilled). */
const canGradePick = (d: DecisionRecord) => !evsOf(d) || (d.pot ?? 0) > 0;

/** A pick among the kept mix's actions, graded as the decision was: by EV where the mix has EVs for every action, else
 * by frequency (the charts, a read at once). Null where its EVs have no pot to be measured against. */
export function gradePick(d: DecisionRecord, a: number): Grade | null {
  if (!canGradePick(d)) return null;
  return grade({ freqs: (d.mix ?? []).map((x) => x[1]), evs: evsOf(d), pot: d.pot ?? 0 }, a);
}

/** The drill's progress, kept as an "analysis" session so it resumes: the decisions answered and the score. */
export interface DrillProgress {
  startedAt: number;
  done: string[];
  score: Score;
}

export function toSession(l: LeakRef, p: DrillProgress, total: number, now = Date.now()): SessionRecord {
  return {
    id: drillSessionId(l),
    kind: "analysis",
    startedAt: p.startedAt,
    endedAt: now,
    decisions: p.score.n,
    evLossBb: p.score.loss,
    meta: { drill: "leak", leak: leakParam(l), label: l.key, total, done: p.done, score: p.score },
  };
}

export function fromSession(s: SessionRecord | undefined): DrillProgress | null {
  const m = s?.meta as { drill?: string; done?: unknown; score?: Score } | undefined;
  if (!s || m?.drill !== "leak" || !Array.isArray(m.done) || !m.score) return null;
  return { startedAt: s.startedAt, done: m.done.filter((x): x is string => typeof x === "string"), score: m.score };
}
