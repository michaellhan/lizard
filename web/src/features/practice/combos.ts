// Practice's combo-counting quiz (the Combos tab, ComboQuiz.tsx): your hand, a flop and the opponent's range, and a
// question on how many of the range's combos make one hand category. Every number here is an exact count, worked out in
// this page: each combo of the range is checked against the flop and your two cards. No solver, chart or estimate is
// involved. The ranges are inputs: sample ranges typed for this quiz (not from a chart or a solve), your saved ranges, or
// one you type.
//
// A combo of the range is in one of three states: live (it can be dealt), taken out by your hand (it shares a card with
// your hand and none with the flop), or dead on the flop (it shares a card with the flop, whatever your hand). A live
// combo's category is its made hand on the flop. A combo that can't be dealt is placed by its ranks alone, as a player
// counting it would, so it's never a flush or a straight flush.
import { ALL_CLASSES, classOf, expandClass, SUITS } from "@/engine/nlhe/cards";
import { rank7 } from "@/poker/evaluate";
import { parseRange } from "@/features/ranges/rangeText";

export const CATEGORIES = [
  { id: "sf", label: "Straight flush" },
  { id: "quads", label: "Quads" },
  { id: "fh", label: "Full house" },
  { id: "flush", label: "Flush" },
  { id: "straight", label: "Straight" },
  { id: "trips", label: "Trips or set" },
  { id: "twopair", label: "Two pair" },
  { id: "overpair", label: "Overpair" },
  { id: "toppair", label: "Top pair" },
  { id: "otherpair", label: "Other pair with the flop" },
  { id: "pocket", label: "Other pocket pair" },
  { id: "nopair", label: "No pair" },
] as const;

export type CategoryId = (typeof CATEGORIES)[number]["id"];
export const categoryLabel = (id: CategoryId): string => CATEGORIES.find((c) => c.id === id)!.label;

export type ComboState = "live" | "hand" | "board";
/** What a question asks about: the combos they can have, or the ones your cards take out. */
export type Bucket = "live" | "hand";

const VALUES = "23456789TJQKA";
const valueOf = (card: string) => VALUES.indexOf(card[0]!) + 2;

function straightHigh(vals: readonly number[]): number {
  const s = new Set(vals);
  if (s.has(14)) s.add(1);
  for (let h = 14; h >= 5; h--) if ([0, 1, 2, 3, 4].every((k) => s.has(h - k))) return h;
  return 0;
}

/** A hand's category from ranks alone (hole cards' values, the flop's): what a player calls it, by the hole cards'
 * part. A pocket pair on a paired flop is an overpair or another pocket pair, not two pair; a hole card that pairs the
 * flop on a paired flop is top pair or another pair. */
export function byRanks(hole: readonly number[], flop: readonly number[]): CategoryId {
  const all = [...hole, ...flop];
  const count = new Map<number, number>();
  for (const v of all) count.set(v, (count.get(v) ?? 0) + 1);
  const ns = [...count.values()].sort((a, b) => b - a);
  if (ns[0] === 4) return "quads";
  if (ns[0] === 3 && (ns[1] ?? 0) >= 2) return "fh";
  if (straightHigh(all)) return "straight";
  if (ns[0] === 3) return "trips";
  const top = Math.max(...flop);
  if (hole[0] === hole[1]) return hole[0]! > top ? "overpair" : "pocket";
  const hits = hole.filter((v) => flop.includes(v));
  if (hits.length === 2) return "twopair";
  if (hits.length === 1) return hits[0] === top ? "toppair" : "otherpair";
  return "nopair";
}

/** A combo's category on the flop. Its cards must not clash with the flop's (a combo that can't be dealt: `byRanks`). */
export function categoryOf(hole: readonly [string, string], flop: readonly string[]): CategoryId {
  const v = rank7([...hole, ...flop])[0];
  if (v === 8) return "sf";
  const r = byRanks(hole.map(valueOf), flop.map(valueOf));
  if (r === "quads" || r === "fh") return r;
  return v === 5 ? "flush" : r;
}

export interface QuizRange {
  /** "sample:<id>", "saved:<id>" or "typed" */
  key: string;
  name: string;
  text: string;
  /** where it came from, in words, shown under it */
  source: string;
}

/** Sample ranges for the quiz: typed for practice, not from a chart or a solve. */
export const SAMPLE_RANGES: readonly QuizRange[] = [
  { key: "sample:strong", name: "Strong range", text: "AA-99,AKs-A8s,A6s-A5s,KQs-K9s,QJs-Q9s,JTs-J9s,T9s,AKo-AJo,KQo" },
  { key: "sample:tight", name: "Tight range", text: "77+,ATs+,KTs+,QTs+,JTs,T9s,AJo+,KQo" },
  { key: "sample:wide", name: "Wide range", text: "22+,A2s+,K5s+,Q8s+,J8s+,T8s+,97s+,86s+,75s+,65s,54s,A8o+,KTo+,QTo+,JTo" },
  { key: "sample:calls", name: "Calling range", text: "22-JJ,A2s-AQs,K9s+,Q9s+,J9s+,T8s+,97s+,86s+,75s+,65s,54s,AJo-AQo,KJo+,QJo" },
  { key: "sample:polar", name: "Value and bluffs", text: "TT+,AQs+,A5s-A4s,KQs,AKo,76s,65s" },
].map((r) => ({ ...r, source: "A sample range typed for this quiz, not from a chart or a solve." }));

export interface RangeCombo {
  combo: string;
  cls: string;
  w: number;
}

/** Every combo of the range with its weight (above 0), or null where the text doesn't read as a range. A combo named on
 * its own beside its class takes the larger weight, as rangeText's parser and the solver's do. */
export function rangeCombos(text: string): RangeCombo[] | null {
  const { unknown, classWeights, comboWeights } = parseRange(text);
  if (unknown.length) return null;
  const out: RangeCombo[] = [];
  for (const cls of ALL_CLASSES) {
    for (const combo of expandClass(cls)) {
      const w = Math.max(classWeights[cls] ?? 0, comboWeights[combo] ?? 0);
      if (w > 0) out.push({ combo, cls, w });
    }
  }
  return out;
}

export interface CountedCombo extends RangeCombo {
  state: ComboState;
  cat: CategoryId;
}

const cardsOf = (combo: string): [string, string] => [combo.slice(0, 2), combo.slice(2, 4)];

/** Each combo of the range in its state and category, against this flop and your hand. */
export function countCombos(range: readonly RangeCombo[], hero: readonly [string, string], flop: readonly string[]): CountedCombo[] {
  return range.map((r) => {
    const cards = cardsOf(r.combo);
    const onFlop = cards.some((c) => flop.includes(c));
    const state: ComboState = onFlop ? "board" : cards.some((c) => hero.includes(c)) ? "hand" : "live";
    const cat = onFlop ? byRanks(cards.map(valueOf), flop.map(valueOf)) : categoryOf(cards, flop);
    return { ...r, state, cat };
  });
}

/** Two decimals at most: weights can make a count fractional, and a sum of them shouldn't carry float noise. */
const round = (x: number) => Math.round(x * 100) / 100;

export type Tally = Record<ComboState, Record<CategoryId, number>>;

export function tally(counted: readonly CountedCombo[]): Tally {
  const zero = () => Object.fromEntries(CATEGORIES.map((c) => [c.id, 0])) as Record<CategoryId, number>;
  const t: Tally = { live: zero(), hand: zero(), board: zero() };
  for (const c of counted) t[c.state][c.cat] += c.w;
  for (const s of ["live", "hand", "board"] as const) for (const c of CATEGORIES) t[s][c.id] = round(t[s][c.id]);
  return t;
}

/** A count as shown: whole where it is, else to two decimals at most. */
export const fmtCount = (n: number): string => String(round(n));

/** The classes behind one cell of the tally, most combos first: what the answer is made of. */
export function classesOf(counted: readonly CountedCombo[], state: ComboState, cat: CategoryId): { cls: string; n: number; combos: string[] }[] {
  const by = new Map<string, { n: number; combos: string[] }>();
  for (const c of counted) {
    if (c.state !== state || c.cat !== cat) continue;
    const e = by.get(c.cls) ?? { n: 0, combos: [] };
    e.n += c.w;
    e.combos.push(c.combo);
    by.set(c.cls, e);
  }
  return [...by.entries()].map(([cls, e]) => ({ cls, n: round(e.n), combos: e.combos })).sort((a, b) => b.n - a.n || ALL_CLASSES.indexOf(a.cls) - ALL_CLASSES.indexOf(b.cls));
}

export interface Question {
  hero: [string, string];
  flop: [string, string, string];
  range: QuizRange;
  /** combos in the range, and of the 1,326 */
  rangeSize: number;
  bucket: Bucket;
  cat: CategoryId;
  answer: number;
  /** four choices, low to high, the answer among them */
  options: number[];
  counted: CountedCombo[];
  tally: Tally;
}

const DECK = [..."AKQJT98765432"].flatMap((r) => SUITS.map((s) => r + s));

function draw(deck: string[], rand: () => number): string {
  const i = Math.floor(rand() * deck.length);
  return deck.splice(i, 1)[0]!;
}

/** The four choices: the answer, a count a common slip gives (forgetting your blockers, or the flop's), and near misses. */
export function optionsFor(answer: number, slips: readonly number[], rand: () => number): number[] {
  const out = new Set<number>([round(answer)]);
  for (const s of slips) {
    if (out.size >= 2) break;
    const x = round(s);
    if (x >= 0 && !out.has(x)) out.add(x);
  }
  const steps = [-3, -2, -1, 1, 2, 3].sort(() => rand() - 0.5);
  for (const k of [...steps, 4, 5, 6, 7]) {
    if (out.size >= 4) break;
    const x = round(answer + k);
    if (x >= 0) out.add(x);
  }
  return [...out].sort((a, b) => a - b);
}

/** A new question on this range, or null where it has no combo that can be dealt. Half your hands come from the range
 * itself, which holds the blockers worth counting; a flop of three of a rank is never dealt (every hand is trips). */
export function makeQuestion(range: QuizRange, rand: () => number = Math.random): Question | null {
  const combos = rangeCombos(range.text);
  if (!combos?.length) return null;
  const rangeSize = round(combos.reduce((s, c) => s + c.w, 0));
  for (let tries = 0; tries < 50; tries++) {
    const deck = [...DECK];
    const flop = [draw(deck, rand), draw(deck, rand), draw(deck, rand)] as [string, string, string];
    if (flop.every((c) => c[0] === flop[0][0])) continue;
    const fromRange = rand() < 0.5 ? combos.filter((c) => cardsOf(c.combo).every((x) => deck.includes(x))) : [];
    const pick = fromRange.length ? fromRange[Math.floor(rand() * fromRange.length)]!.combo : null;
    const hero: [string, string] = pick ? cardsOf(pick) : [draw(deck, rand), draw(deck, rand)];
    const counted = countCombos(combos, hero, flop);
    const t = tally(counted);
    let bucket: Bucket = rand() < 0.35 ? "hand" : "live";
    const nonzero = (b: Bucket) => CATEGORIES.filter((c) => t[b][c.id] > 0).map((c) => c.id);
    if (!nonzero(bucket).length) bucket = "live";
    const cats = nonzero(bucket);
    if (!cats.length) continue;
    const cat = cats[Math.floor(rand() * cats.length)]!;
    const answer = t[bucket][cat];
    const slips = bucket === "live" ? [answer + t.hand[cat], answer + t.hand[cat] + t.board[cat]] : [answer + t.board[cat], t.live[cat]];
    return { hero, flop, range, rangeSize, bucket, cat, answer, options: optionsFor(answer, slips, rand), counted, tally: t };
  }
  return null;
}

/** "AhKd" as hand class words for a line of text ("AKo"). */
export const classWords = (hero: readonly [string, string]) => classOf(hero.join(""));

// ---- the quiz's record, kept in this browser (kv "comboQuiz.v1")

export type Outcome = "correct" | "assisted" | "wrong";
export type Marks = { correct: number; assisted: number; wrong: number };

export interface QuizStats {
  v: 1;
  total: Marks;
  /** right answers in a row without the counts open (an answer with them open leaves it as it is) */
  streak: number;
  best: number;
  /** questions answered by day ("2026-11-13"), the last 30 days */
  days: Record<string, number>;
  /** by bucket and category ("live:toppair") */
  byCat: Record<string, Marks>;
  /** the last 20 answers, oldest first */
  recent: Outcome[];
}

export const STATS_KEY = "comboQuiz.v1";
const noMarks = (): Marks => ({ correct: 0, assisted: 0, wrong: 0 });
export const emptyStats = (): QuizStats => ({ v: 1, total: noMarks(), streak: 0, best: 0, days: {}, byCat: {}, recent: [] });

/** A kept record, or an empty one where what's kept isn't one. */
export function readStats(x: unknown): QuizStats {
  const s = x as QuizStats | undefined;
  return s && s.v === 1 && s.total && s.byCat && s.days && Array.isArray(s.recent) ? s : emptyStats();
}

export const dayOf = (t: Date): string => `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;

export function record(s: QuizStats, bucket: Bucket, cat: CategoryId, outcome: Outcome, today: string): QuizStats {
  const key = `${bucket}:${cat}`;
  const byCat = { ...s.byCat, [key]: { ...(s.byCat[key] ?? noMarks()), [outcome]: (s.byCat[key]?.[outcome] ?? 0) + 1 } };
  const streak = outcome === "correct" ? s.streak + 1 : outcome === "wrong" ? 0 : s.streak;
  const days = Object.fromEntries(
    Object.entries({ ...s.days, [today]: (s.days[today] ?? 0) + 1 })
      .sort(([a], [b]) => (a < b ? 1 : -1))
      .slice(0, 30),
  );
  return {
    v: 1,
    total: { ...s.total, [outcome]: s.total[outcome] + 1 },
    streak,
    best: Math.max(s.best, streak),
    days,
    byCat,
    recent: [...s.recent, outcome].slice(-20),
  };
}

export const answered = (m: Marks) => m.correct + m.assisted + m.wrong;
/** right without the counts open, of all answered */
export const successRate = (m: Marks) => (answered(m) ? m.correct / answered(m) : 0);

/** Categories by success, with three answers at least: the hardest first. */
export function ranked(s: QuizStats): { key: string; bucket: Bucket; cat: CategoryId; m: Marks; rate: number }[] {
  return Object.entries(s.byCat)
    .filter(([, m]) => answered(m) >= 3)
    .map(([key, m]) => {
      const [bucket, cat] = key.split(":") as [Bucket, CategoryId];
      return { key, bucket, cat, m, rate: successRate(m) };
    })
    .sort((a, b) => a.rate - b.rate || answered(b.m) - answered(a.m));
}
