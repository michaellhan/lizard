// Live drills: the decisions no file stores, dealt with real cards and answered by a live heads-up solve. Facing a bet on
// the turn, and first to act or after a check on the river. What's dealt comes from a stored turn file (turns.ts): its
// flop lines, its played cards and its frequencies say how often a spot comes up and which hands get there. The answer
// comes from the engine, down the path Practice's own decisions take: `mixOf`, `gradeMix` on the solve's EVs, and the
// provenance the client worked out.
//
// A bet faced is the stored turn's own (the tree's 75%), drawn by how often the file says it's made, and a river comes
// only after the turn checked through, as no file stores who calls a turn bet. A line the opponent takes under
// RARE_LINE isn't dealt: the engine would have to widen their range from the betting rules.
//
// A solve at Quick narrows an earlier street by the betting rules and still reads as a live solve with a small
// exploitability, so these run at Fast at least (`liveMode`), and `liveRefusal` turns away whatever isn't a measured live
// solve of this spot with an EV for every action. A refused spot is said in words and dealt again, with no grade and no
// score. A live drill's session is kept as a Practice session, as History reads every "drill" session as the stored
// library's; its mistakes retry through the solver, as a hand's do.
import type { MistakeRecord, SessionRecord } from "@/data/db";
import { offText } from "@/features/analyze/grading";
import { addCell, addSource, linePot, type GradeCell } from "@/features/history/history";
import { gradeOf } from "@/features/review/mistakes";
import { dueAfter } from "@/features/review/schedule";
import { gameSetup } from "@/features/solve/setup";
import { parseLine, toSearch, type StudyHand } from "@/features/study/studyState";
import { addScore, capGrade, emptyScore, type Grade, type Score } from "@/grading/grade";
import { versionOf } from "@/grading/version";
import { cardInt, cardStr, COMBOS, flopCards, type Entry, type LibraryRanges } from "@/library/entry";
import type { LibraryReport } from "@/library/files";
import type { TurnFile, TurnLine, TurnNode } from "@/library/turns";
import type { AdvisorAction, AdvisorState } from "@/solver/protocol";
import { sourceLabel } from "@/solver/provenance";
import type { Provenance, ResultSource, SolveMode, SolveResult } from "@/solver/types";
import { flopWords, lineReach, pick, relabel, shuffle } from "./drills";
import { handTest } from "./handFilter";
import { gradable, gradeMix, mixOf, optionLabel, optionsOf, type Decision } from "./practice";

export type LiveStreet = "turn" | "river";
/** Facing a bet on the turn: `checkfaces` out of position after checking, `ipfaces` in position facing the first bet.
 * On the river, `oop` first to act, `ip` after a check. New names, so an older link's `vsbet` stays the stored turn. */
export type LiveView = "checkfaces" | "ipfaces" | "oop" | "ip";
export const LIVE_TURN_VIEWS: readonly LiveView[] = ["checkfaces", "ipfaces"];
export const RIVER_VIEWS: readonly LiveView[] = ["oop", "ip"];
export const isLiveTurnView = (v: string | null): v is LiveView => LIVE_TURN_VIEWS.includes(v as LiveView);
export const isRiverView = (v: string | null): v is LiveView => RIVER_VIEWS.includes(v as LiveView);

export function liveViewLabel(street: LiveStreet, view: LiveView, seats: readonly string[]): string {
  const [o, p] = seats;
  if (street === "river") return view === "ip" ? `${p} after ${o} checks the river` : `${o} first to act on the river`;
  return view === "ipfaces" ? `${p} faces ${o}'s turn bet` : `${o} checks the turn, faces a bet`;
}

const heroOf = (view: LiveView): 0 | 1 => (view === "ip" || view === "ipfaces" ? 1 : 0);

/** The engine's RARE_LINE: an opponent's line under this share has its range taken from the betting rules. */
export const RARE_LINE = 0.1;

/** A tree bet's chips: the fraction of the pot, to the half big blind (solver.py), never under 1bb. "bet 33%" of 5.5bb
 * is 2bb on the table, which the stored line's pot is built from. */
export const treeBet = (frac: number, pot: number) => Math.max(Math.round(frac * pot * 2) / 2, 1);
const betOf = (name: string, pot: number) => treeBet(parseFloat(name.slice(4)) / 100, pot);

/** A stored flop line as the moves it was: null where it holds one the table can't write. */
export function flopMoves(rep: Pick<LibraryReport, "seats" | "pot">, path: readonly string[]): AdvisorAction[] | null {
  const out: AdvisorAction[] = [];
  for (const [i, x] of path.entries()) {
    const pos = rep.seats[i % 2]!;
    if (x === "check" || x === "call") out.push({ pos, action: x });
    else if (/^bet [\d.]+%/.test(x)) out.push({ pos, action: "bet", to: betOf(x, rep.pot) });
    else if (/^raise to [\d.]+/.test(x)) out.push({ pos, action: "raise", to: parseFloat(x.slice(9)) });
    else return null;
  }
  return out;
}

/** the share of a class's hands, by reach, that takes an action; null where none reach it or it's not an action here */
function share(node: TurnNode, k: number, name: string, reach: ReadonlyMap<number, number>): number | null {
  const cls = node.classes[k];
  const a = node.names.indexOf(name);
  if (!cls || a < 0) return null;
  let all = 0;
  let took = 0;
  cls.combos.forEach((ci, j) => {
    const r = reach.get(ci) ?? 0;
    all += r;
    took += r * cls.strat[a]![j]!;
  });
  return all > 0 ? took / all : null;
}

/** a class's combos with what reaches past `name` (no name: what reaches the node) */
function past(node: TurnNode, k: number, name: string | null, reach: ReadonlyMap<number, number>): [number, number][] {
  const cls = node.classes[k];
  const a = name === null ? -1 : node.names.indexOf(name);
  if (!cls || (name !== null && a < 0)) return [];
  return cls.combos.map((ci, j) => [ci, (reach.get(ci) ?? 0) * (a < 0 ? 1 : cls.strat[a]![j]!)]);
}

interface LiveSpot {
  line: TurnLine;
  /** the turn class */
  k: number;
  /** its draw's weight: the hand pairs on the line, the cards the class stands for, how often the turn goes this way */
  w: number;
  /** your combos and what reaches the decision */
  hands: [number, number][];
  /** the bet faced on the turn, as stored */
  bet: string | null;
}

/** Every (flop line, turn card, bet) a file can deal a view's decision on. A line skips where a decision on it isn't
 * stored (lineReach), where the opponent's way here is rare, or where the bet would be an all-in. */
function liveSpots(rep: LibraryReport, e: Entry, t: TurnFile, street: LiveStreet, view: LiveView, ranges: LibraryRanges): LiveSpot[] {
  const out: LiveSpot[] = [];
  for (const line of t.lines) {
    if (!flopMoves(rep, line.path)) continue;
    const first = line.nodes.find((n) => n.at.length === 0 && n.player === 0);
    const second = line.nodes.find((n) => n.at.join() === "check" && n.player === 1);
    const oop = lineReach(e, line.path, 0, ranges);
    const ip = lineReach(e, line.path, 1, ranges);
    if (!first || !second || !oop || !ip) continue;
    const behind = rep.stack - (line.pot - rep.pot) / 2;
    const bets = (n: TurnNode) => n.names.filter((x) => /^bet /.test(x) && betOf(x, line.pot) < behind);
    t.played.forEach((_, k) => {
      const of = line.share * t.sizes[k]!;
      const checks = share(first, k, "check", oop);
      if (street === "river") {
        const back = share(second, k, "check", ip);
        if (checks === null || back === null) return;
        const theirs = view === "ip" ? checks : back;
        if (theirs < RARE_LINE) return;
        const hands = view === "ip" ? past(second, k, "check", ip) : past(first, k, "check", oop);
        out.push({ line, k, w: of * checks * back, hands, bet: null });
      } else if (view === "ipfaces") {
        for (const bet of bets(first)) {
          const made = share(first, k, bet, oop);
          if (made !== null && made >= RARE_LINE) out.push({ line, k, w: of * made, hands: past(second, k, null, ip), bet });
        }
      } else if (checks !== null) {
        for (const bet of bets(second)) {
          const made = share(second, k, bet, ip);
          if (made !== null && made >= RARE_LINE) out.push({ line, k, w: of * checks * made, hands: past(first, k, "check", oop), bet });
        }
      }
    });
  }
  return out;
}

export interface LiveProblem {
  spot: string;
  /** the canonical flop, as stored */
  flop: string;
  street: LiveStreet;
  view: LiveView;
  path: string[];
  player: 0 | 1;
  hero: string;
  /** the board and your hand as shown, one suit relabelling of the stored ones; what's asked of the solver */
  board: string[];
  hand: string[];
  combo: readonly [number, number];
  perm: readonly number[];
  /** the moves of the flop, the turn and the river, chips to the half big blind as the tree bets them */
  moves: { flop: AdvisorAction[]; turn: AdvisorAction[]; river: AdvisorAction[] };
  /** the pot with any bet faced, and that bet, bb */
  pot: number;
  bet: number;
  /** the stored turn card, and the river dealt, on the stored flop */
  cards: string[];
  /** the action to the decision, in words */
  words: string;
  state: AdvisorState;
}

const fmt = (x: number) => String(Math.round(x * 100) / 100);

/** the spot in words: "On the flop BB and BTN check. BB checks the turn, BTN bets 75% (4bb) · pot 9.5bb" */
function wordsOf(rep: Pick<LibraryReport, "seats">, s: Pick<LiveProblem, "street" | "view" | "path" | "pot" | "bet">, bet: string | null): string {
  const [o, p] = rep.seats;
  const end = `· pot ${fmt(s.pot)}bb`;
  const flop = `On the flop ${flopWords(rep, s.path)}.`;
  if (s.street === "river") return `${flop} The turn checks through. ${s.view === "ip" ? `${o} checks the river` : `${o} to act first on the river`} ${end}`;
  const size = `${bet!.slice(4)} (${fmt(s.bet)}bb)`;
  return `${flop} ${s.view === "ipfaces" ? `${o} bets ${size} on the turn` : `${o} checks the turn, ${p} bets ${size}`} ${end}`;
}

/** One live problem on a flop's stored turn: a line and turn card drawn by how often they come, on a river a card off the
 * deck, then a hand of the filter `hand` if there's one. Null if neither holds such a hand at this decision. */
export function liveProblem(rep: LibraryReport, e: Entry, t: TurnFile, street: LiveStreet, view: LiveView, ranges: LibraryRanges, rng: () => number, hand: string | null = null): LiveProblem | null {
  const flop = flopCards(t.head.board).map(cardInt);
  const spots = liveSpots(rep, e, t, street, view, ranges);
  const ws = spots.map((s) => s.w);
  for (;;) {
    const i = pick(ws, rng);
    if (i < 0) return null;
    const s = spots[i]!;
    const turn = t.played[s.k]!;
    const used = [...flop, turn];
    const deck = street === "river" ? Array.from({ length: 52 }, (_, c) => c).filter((c) => !used.includes(c)) : [];
    const river = deck.length ? deck[Math.floor(rng() * deck.length)]! : null;
    const board = river === null ? used : [...used, river];
    const test = hand ? handTest(hand, board) : null;
    const w = s.hands.map(([ci, x]) => {
      const [a, b] = COMBOS[ci]!;
      return x > 0 && a !== river && b !== river && (!test || test(a, b)) ? x : 0;
    });
    const j = pick(w, rng);
    if (j < 0) {
      ws[i] = 0;
      continue;
    }
    const perm = shuffle(rng);
    const combo = COMBOS[s.hands[j]![0]]!;
    const [a, b] = combo;
    const player = heroOf(view);
    const [o, p] = rep.seats;
    const bet = s.bet ? betOf(s.bet, s.line.pot) : 0;
    const moves = {
      flop: flopMoves(rep, s.line.path)!,
      turn:
        street === "river"
          ? [{ pos: o, action: "check" }, { pos: p, action: "check" }]
          : view === "ipfaces"
            ? [{ pos: o, action: "bet", to: bet }]
            : [{ pos: o, action: "check" }, { pos: p, action: "bet", to: bet }],
      river: street === "river" && view === "ip" ? [{ pos: o, action: "check" }] : [],
    };
    const shown = board.map((c) => relabel(cardStr(c), perm));
    const held = [cardStr(b), cardStr(a)].map((c) => relabel(c, perm));
    const pot = s.line.pot + bet;
    const at = { street, view, path: s.line.path, pot, bet };
    const hero = rep.seats[player]!;
    return {
      spot: rep.id,
      flop: t.head.board,
      ...at,
      player,
      hero,
      board: shown,
      hand: held,
      combo,
      perm,
      moves,
      cards: (river === null ? [turn] : [turn, river]).map(cardStr),
      words: wordsOf(rep, at, s.bet),
      state: {
        players: rep.game?.players ?? 6,
        hero,
        hole: held.join(""),
        board: shown.join(""),
        stack: rep.game?.stack ?? 100,
        preflop: parseLine(rep.line),
        ...moves,
        ...(rep.game?.ante ? { ante: rep.game.ante } : {}),
        ...(rep.game?.straddle ? { straddle: true } : {}),
      },
    };
  }
}

/** The same spot in Study. */
export function liveStudyHand(rep: LibraryReport, pr: LiveProblem): StudyHand {
  return { players: rep.game?.players ?? 6, stack: rep.game?.stack ?? 100, board: pr.board.join(""), preflop: parseLine(rep.line), ...pr.moves };
}

/** Its Study URL; null for a game Study can't set up. */
export function liveStudyLink(rep: LibraryReport, pr: LiveProblem): string | null {
  const setup = gameSetup(rep.game?.players ?? 6, rep.game?.ante, rep.game?.straddle);
  return setup === null ? null : `/study?${toSearch({ ...liveStudyHand(rep, pr), ...(setup ? { setup } : {}) })}`;
}

/** Quick narrows an earlier street by the betting rules, which is no answer to drill on: Fast is the least asked for. */
export const liveMode = (mode: SolveMode): SolveMode => (mode === "quick" ? "fast" : mode);

/** Why an answer can't grade a drill, in words; null where it can. What's left is a live solve of this spot, its distance
 * from equilibrium measured, with an EV for every action. */
export function liveRefusal(res: SolveResult): string | null {
  const { data: r, provenance: p } = res;
  if (r.error) return `The solver couldn't answer this spot: ${r.error}`;
  if (r.skipped) return `The solver skipped this spot${typeof r.skipped === "string" ? `: ${r.skipped}` : "."}`;
  if (!optionsOf(r).length) return "The solver gave no actions here, so there's nothing to grade.";
  if (p.source !== "live") return `This answer is from ${sourceLabel(p.source)}, not a live solve of this spot, so it isn't graded here.`;
  const off = Array.isArray(r.off_solution) ? r.off_solution : [];
  if (off.some((o) => o.why === "rules" || (o.why === "rare" && !o.resolved)) || (Array.isArray(r.widened) && r.widened.length)) return `This spot leans on the betting rules, so it isn't graded here: ${offText(r) ?? "an opponent's range comes from them"}.`;
  if (p.partial) return "The solve was cut short, so this spot isn't graded.";
  if (mixOf(r).some((a) => a.ev === null) || p.evIn === "chips") return "The solve gave no EV for every action here, so this spot isn't graded.";
  if (typeof p.exploitabilityPct !== "number") return "The solve measured no distance from equilibrium here, so this spot isn't graded.";
  if (p.band === "rough") return `The solve stopped ${p.exploitabilityPct.toFixed(1)}% of the pot from equilibrium, too far to grade on.`;
  if ([r.hero_range_combos, r.villain_range_combos].some((n) => typeof n === "number" && n < 0.1)) return "Almost no hands of one range reach this spot in the solve, so it isn't graded.";
  return null;
}

/** An answer a drill can grade on. `off`: what the ranges leaned on, said beside it; a grade under it is capped. */
export interface LiveAnswer {
  mix: Decision["mix"];
  pot: number;
  toCall: number;
  provenance: Provenance;
  off: string | null;
  capped: boolean;
}

export type LiveRead = { st: "answer"; answer: LiveAnswer } | { st: "refused"; words: string };

export function readLive(res: SolveResult, pr: Pick<LiveProblem, "pot" | "bet">): LiveRead {
  const words = liveRefusal(res);
  if (words) return { st: "refused", words };
  const { data: r, provenance } = res;
  const off = offText(r);
  return {
    st: "answer",
    answer: {
      mix: gradable(mixOf(r), provenance),
      pot: typeof r.pot_bb === "number" ? r.pot_bb : pr.pot,
      toCall: typeof r.to_call_bb === "number" ? r.to_call_bb : pr.bet,
      provenance,
      off,
      capped: !!off || provenance.approximate || provenance.band === "approximate",
    },
  };
}

/** The i-th action graded as a hand's decision is, on the same scale; an answer that leaned on anything but its own solve
 * can't condemn a line (capGrade). */
export function gradeLive(a: Pick<LiveAnswer, "mix" | "pot" | "capped">, i: number): Grade {
  const g = gradeMix(a.mix, a.pot, i);
  return a.capped ? capGrade(g, "approximate") : g;
}

/** An action in words: a call by what it costs (an answer's call amount is rounded to the half big blind), a bet by its
 * chips, a pot share never being mistaken for them. */
export function liveActionLabel(a: Pick<LiveAnswer, "toCall">, row: Decision["mix"][number]): string {
  if (row.action === "call") return `call ${fmt(a.toCall)}bb`;
  return /^bet /.test(row.action) && row.amount !== undefined ? `${row.action} (${fmt(row.amount)}bb)` : optionLabel(row.action, row.amount);
}

export interface LiveSession {
  id: string;
  startedAt: number;
  score: Score;
  sources: Partial<Record<ResultSource, number>>;
  cells: Record<string, GradeCell>;
  revealed?: number;
}

export const freshLiveSession = (): LiveSession => ({
  id: `drill-live-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
  startedAt: Date.now(),
  score: emptyScore(),
  sources: {},
  cells: {},
});

export const afterLive = (s: LiveSession, pr: Pick<LiveProblem, "street" | "hero" | "state">, g: Grade, p: Provenance): LiveSession => ({
  ...s,
  score: addScore(s.score, g),
  sources: addSource(s.sources, p.source),
  cells: addCell(s.cells, pr.street, p.source, g, versionOf(p), { seat: pr.hero, pot: linePot(pr.state.preflop ?? []) }),
});

/** The session as History keeps it: a Practice session of no hands, its grades under what answered them. */
export const liveRecord = (s: LiveSession, rep: LibraryReport, seat: string): SessionRecord => ({
  id: s.id,
  kind: "practice",
  startedAt: s.startedAt,
  endedAt: Date.now(),
  decisions: s.score.n,
  evLossBb: s.score.loss,
  meta: {
    hands: 0,
    net: 0,
    ok: s.score.ok,
    graded: s.score.ne,
    lossPct: s.score.lossPct,
    players: rep.game?.players ?? 6,
    stack: rep.game?.stack ?? 100,
    seat,
    ...(s.revealed ? { revealed: s.revealed } : {}),
    byPot: {},
    sources: s.sources,
    cells: s.cells,
  },
});

/** A pick as a kept mistake, null where it's Best or Correct. The spot is the stored line, cards and combo; it's asked
 * again through the solver, as nothing stores it. */
export function liveMistake(sessionId: string, rep: LibraryReport, pr: LiveProblem, a: LiveAnswer, g: Grade, now: number): MistakeRecord | null {
  if (g.ok) return null;
  return {
    id: `drill|live|${pr.spot}|${pr.flop}|${pr.path.join("/")}|${pr.cards.join("")}|${pr.view}|${pr.combo.join(",")}`,
    from: "drill",
    sessionId,
    street: pr.street,
    at: now,
    lastAt: now,
    updatedAt: now,
    times: 1,
    seat: pr.hero,
    players: rep.game?.players ?? 6,
    game: rep.label,
    hole: [pr.hand[0]!, pr.hand[1]!],
    board: pr.board,
    line: pr.words,
    study: liveStudyLink(rep, pr)?.replace(/^\/study\?/, "") ?? null,
    ask: { via: "solver", state: pr.state },
    chose: a.mix[g.a]!.action,
    mix: a.mix,
    pot: a.pot,
    grade: gradeOf(g),
    provenance: a.provenance,
    step: 0,
    due: dueAfter(now, 0),
    tries: [],
  };
}
