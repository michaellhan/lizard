// Analyze's pure core: hand-history files read into hands to keep (ported from the classic analyzer,
// solver/gto/static/session.js: handId, prepare, hhFiles, filesName, decisions, preflopRaises, preflopSituation,
// POT_TYPE), each hand's summary for the hands table, and the Study line at one of your decisions.
import type { DecisionRecord, HandRecord } from "@/data/db";
import { HandHistoryError, splitHands } from "@/hh/parse";
import { finalSim, importHand, type ReplayedHand } from "@/hh/replay";
import { simulate, type Move, type Street } from "@/poker/table";
import { gameSetup, setupProblems, tidySetup, type SpotSetup } from "@/features/solve/setup";
import { toSearch, type StudyHand } from "@/features/study/studyState";
import { inSess } from "./sessions";

export const STREETS: readonly Street[] = ["preflop", "flop", "turn", "river"];
const NEED: Record<Street, number> = { preflop: 0, flop: 3, turn: 4, river: 5 };
const r2 = (x: number) => Math.round(x * 100) / 100;

/** The site's hand number ("PokerStars Hand #2498…", "Poker Hand #HD20…", "HandId: #1887…", "#Game No : 1234",
 * iPoker's gamecode), or "" where the history has none. */
export function handNumber(text: string): string {
  const x = String(text).match(/gamecode="([^"]+)"/);
  if (x) return x[1]!;
  const head = String(text).split("\n").slice(0, 3).join(" ");
  return head.match(/(?:Hand|Game)\s*(?:No|Id)?\s*[:#]*\s*#?\s*([A-Z]*\d[\w-]*)/i)?.[1] ?? "";
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
/** When the hand was played, as the history writes it (the site's own clock and time zone): "2024-05-01 20:00",
 * and that time read as UTC for sorting; null where the header has no date. */
export function playedOf(text: string): { played: string; at: number } | null {
  // (iPoker's own <game> has its time: splitHands keeps the file's <general> before it, with the file's start)
  const game = text.search(/<game\b/i);
  const start = /<startdate>([^<]*)</;
  const head = game >= 0 ? (text.slice(game).match(start)?.[1] ?? text.match(start)?.[1] ?? "") : String(text).split("\n").slice(0, 4).join(" ");
  let y: number, mo: number, d: number, h: number, mi: number, s: number;
  let m = head.match(/(\d{4})[/-](\d\d?)[/-](\d\d?)[ T]+(\d\d?):(\d\d)(?::(\d\d))?/);
  if (m) [y, mo, d, h, mi, s] = [+m[1]!, +m[2]!, +m[3]!, +m[4]!, +m[5]!, +(m[6] ?? 0)];
  else if ((m = head.match(/\b(\d\d) (\d\d) (\d{4}) (\d\d?):(\d\d)(?::(\d\d))?/))) [d, mo, y, h, mi, s] = [+m[1]!, +m[2]!, +m[3]!, +m[4]!, +m[5]!, +(m[6] ?? 0)];
  else if ((m = head.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.? (\d\d?),? (\d\d?):(\d\d)(?::(\d\d))?(?: [A-Z]{2,5})? (\d{4})/i)))
    [mo, d, h, mi, s, y] = [MONTHS.indexOf(m[1]!.toLowerCase()) + 1, +m[2]!, +m[3]!, +m[4]!, +(m[5] ?? 0), +m[6]!];
  else return null;
  if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && h < 24 && mi < 60)) return null;
  const p = (x: number) => String(x).padStart(2, "0");
  return { played: `${y}-${p(mo)}-${p(d)} ${p(h)}:${p(mi)}`, at: Date.UTC(y, mo - 1, d, h, mi, s) };
}

export type SkipKind = "nonHoldem" | "noHero" | "noDecisions" | "duplicate" | "failed";
export const SKIP_TEXT: Record<SkipKind, string> = {
  nonHoldem: "not Hold'em",
  noHero: "without your cards",
  noDecisions: "with no decision of yours (a walk, or folded to you in the big blind)",
  duplicate: "already in this import",
  failed: "unreadable",
};
const skipKind = (msg: string): SkipKind =>
  /Only Hold'em/i.test(msg) ? "nonHoldem" : /hole cards aren't|has hole cards but no/i.test(msg) ? "noHero" : "failed";

/** Your decisions in a replayed hand: the street and the action's index there. */
export function heroDecisions(r: Pick<ReplayedHand, "lines" | "hand">): { street: Street; i: number }[] {
  const out: { street: Street; i: number }[] = [];
  for (const street of STREETS) r.lines[street].forEach((a, i) => a.pos === r.hand.hero && out.push({ street, i }));
  return out;
}

/** Preflop: who raised, in order (an all-in after an all-in is taken as a call), and the calls before the first raise. */
export function preflopRaises(acts: readonly Move[]): { raises: string[]; limps: number; callers: number } {
  const raises: string[] = [];
  let limps = 0;
  let callers = 0;
  let shove = false;
  for (const a of acts) {
    const agg = a.action === "raise" || a.action === "bet" || (a.action === "all-in" && !shove);
    if (a.action === "all-in") shove = true;
    if (agg) {
      raises.push(a.pos);
      callers = 0;
    } else if (a.action === "call" || a.action === "all-in") {
      if (raises.length) callers++;
      else limps++;
    }
  }
  return { raises, limps, callers };
}

/** A preflop decision's situation, from the actions before it. */
export function preflopSituation(before: readonly Move[], hero: string): string {
  const { raises, limps, callers } = preflopRaises(before);
  const n = raises.length;
  if (!n) return limps ? (hero === "BB" ? "BB vs limp" : "vs limp") : "RFI";
  if (n === 1)
    return before.some((a) => a.pos === hero) ? "limp vs raise" : hero === "BB" ? "BB defence" : hero === "SB" ? "SB vs open" : callers ? "vs open + call" : "vs open";
  if (n === 2) return raises[0] === hero ? "vs 3bet" : "cold vs 3bet";
  return "vs 4bet+";
}

/** The hands table's filters, in the page's URL: your seat, pot type, site, stakes (the big blind as the history
 * writes it), the days played (YYYY-MM-DD, by the site's clock) from and to, one of your tags, a search, and the EV
 * your graded decisions gave up in the hand (at least so many bb). */
export const HAND_FILTERS = ["pos", "pot", "site", "bb", "from", "to", "tag", "q", "lost", "sess"] as const;

/** The EV-lost filter's steps, bb. */
export const LOST_STEPS = ["0.1", "0.5", "1", "2", "5", "10"] as const;

/** The EV your graded decisions gave up in each hand, bb (graded by EV only: the preflop charts' grades have none). */
export function lostByHand(decisions: readonly DecisionRecord[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const d of decisions) if (d.evLossBb != null && d.evLossBb > 0) m.set(d.handId, (m.get(d.handId) ?? 0) + d.evLossBb);
  return m;
}

/** Whether a hand matches a search: every word in its number, site, seat, cards, board, pot type, how it ended,
 * when, stakes, tournament, your tags or note, ignoring case. */
export function handMatches(h: HandRecord, query: string): boolean {
  const hay = [h.number, h.site, h.hero, h.hole, h.board, h.potType, h.end, h.played, h.bb, h.tournament ?? "", ...(h.tags ?? []), h.note ?? ""].join(" ").toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
}

/** The hands the filters keep; `lost`: the EV given up in each hand (lostByHand), for the EV-lost filter. */
export function filterHands(hands: readonly HandRecord[], p: URLSearchParams, lost: ReadonlyMap<string, number> = new Map()): HandRecord[] {
  const [pos, pot, site, bb, from, to, tag, q, minLost, sess] = HAND_FILTERS.map((k) => p.get(k));
  const day = (h: HandRecord) => h.played.slice(0, 10);
  const sitting = sess ? inSess(sess) : null;
  return hands.filter(
    (h) =>
      (!pos || h.hero === pos) &&
      (!pot || h.potType === pot) &&
      (!site || h.site === site) &&
      (!bb || h.bb === bb) &&
      (!from || (!!h.played && day(h) >= from)) &&
      (!to || (!!h.played && day(h) <= to)) &&
      (!tag || !!h.tags?.includes(tag)) &&
      (!q || handMatches(h, q)) &&
      (!minLost || (lost.get(h.id) ?? 0) >= Number(minLost) - 1e-9) &&
      (!sitting || sitting(h)),
  );
}

export const POT_TYPES = ["SRP", "3bet pot", "4bet+ pot", "Limped"] as const;
export const potType = (raises: number) => (raises <= 0 ? "Limped" : raises === 1 ? "SRP" : raises === 2 ? "3bet pot" : "4bet+ pot");

/** How the hand ended for you. */
export function endOf(r: ReplayedHand): string {
  if (r.stopped) return `stopped at ${r.stopped.street}`;
  const sim = finalSim(r);
  const folded = STREETS.find((s) => r.lines[s].some((a) => a.pos === r.hand.hero && a.action === "fold"));
  if (folded) return `folded ${folded}`;
  if (sim.active.size <= 1) return "won, all folded";
  return sim.handOver ? "showdown" : "to showdown";
}

/** The hand's record to keep: its summary for the hands table, and the history itself (re-read when opened). */
export function recordOf(text: string, r: ReplayedHand, imp: { id: string; name: string; at: number }): HandRecord {
  const h = r.hand;
  const number = handNumber(text);
  const when = playedOf(text);
  const pre = simulate(r.setup, { ...r.lines, flop: [], turn: [], river: [] }, 0);
  const sym = text.slice(0, 400).match(/[$€£]/)?.[0] ?? "";
  return {
    // (the classic analyzer's duplicate key; a history with no number is keyed by its text)
    id: `${h.site}|${number || `text:${hash(text)}`}|${h.hole.join("")}`,
    site: h.site,
    number,
    played: when?.played ?? "",
    playedAt: when?.at ?? 0,
    hero: h.hero,
    players: h.players,
    hole: h.hole.join(""),
    board: h.board.join(""),
    bb: h.tournament ? `${h.bb} chips` : `${sym}${h.bb}`,
    potType: potType(pre.streets.preflop?.nRaises ?? 0),
    pot: r2(finalSim(r).pot),
    end: endOf(r),
    decisions: heroDecisions(r).length,
    ...(h.tournament ? { tournament: h.tournament.name ?? h.tournament.id ?? "" } : {}),
    text,
    importId: imp.id,
    importName: imp.name,
    importedAt: imp.at,
  };
}

/** FNV-1a, for a history with no hand number */
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
}

export interface Prepared {
  hands: HandRecord[];
  skipped: Record<SkipKind, number>;
  /** the unreadable hands: their place in their file and why */
  errors: { n: number; number: string; msg: string; file?: string }[];
  total: number;
  /** per file, when there are several */
  files?: { name: string; total: number; hands: number }[];
}

/** The hands of one file or several, read in order (a hand in two of them, the same site, number and cards, is
 * counted once): non-Hold'em hands, hands without your cards, duplicates, hands where you made no decision and
 * unreadable ones are counted and skipped. Yields every `chunk` hands so a big file doesn't freeze the page. */
export async function prepare(
  files: readonly { name: string; text: string }[],
  imp: { id: string; name: string; at: number },
  progress?: (done: number, total: number) => void,
  chunk = 100,
  pause: () => Promise<void> = () => new Promise((r) => setTimeout(r, 0)),
): Promise<Prepared> {
  const multi = files.length > 1;
  const parts: [number, number, string][] = [];
  files.forEach((f, fi) => splitHands(f.text).forEach((t, k) => parts.push([fi, k, t])));
  const per = files.map((f) => ({ name: f.name, total: 0, hands: 0 }));
  const skipped: Record<SkipKind, number> = { nonHoldem: 0, noHero: 0, noDecisions: 0, duplicate: 0, failed: 0 };
  const errors: Prepared["errors"] = [];
  const hands: HandRecord[] = [];
  const seen = new Set<string>();
  for (let j = 0; j < parts.length; j++) {
    if (j && j % chunk === 0) {
      progress?.(j, parts.length);
      await pause();
    }
    const [fi, k, t] = parts[j]!;
    const f = per[fi]!;
    f.total++;
    let r: ReplayedHand;
    try {
      r = importHand(t);
    } catch (e) {
      // (a HandHistoryError says why; anything else is the importer's own failure, kept as unreadable)
      const msg = e instanceof HandHistoryError ? e.message : `the importer failed: ${String(e)}`;
      const kind = skipKind(msg);
      skipped[kind]++;
      if (kind === "failed") errors.push({ n: k + 1, number: handNumber(t), msg, ...(multi ? { file: f.name } : {}) });
      continue;
    }
    const rec = recordOf(t, r, imp);
    if (seen.has(rec.id)) {
      skipped.duplicate++;
      continue;
    }
    seen.add(rec.id);
    if (!rec.decisions) {
      skipped.noDecisions++;
      continue;
    }
    f.hands++;
    hands.push(rec);
  }
  progress?.(parts.length, parts.length);
  return { hands, skipped, errors, total: parts.length, ...(multi ? { files: per } : {}) };
}

/** The hand-history files among those picked or dropped (a folder's: its .txt, .xml, .log and .hh files). */
export const HH_FILE = /\.(txt|xml|log|hh)$/i;
export const hhFiles = <F extends { name: string; type?: string }>(list: Iterable<F>): F[] =>
  [...list].filter((f) => HH_FILE.test(f.name || "") || /^text\//.test(f.type || ""));

/** An import's name from its files: the one file's, else the folder they all come from (the innermost, subfolders
 * and all) or "N files". */
export function filesName(files: readonly { name: string; webkitRelativePath?: string }[]): string {
  if (!files.length) return "";
  if (files.length === 1) return files[0]!.name || "";
  const dirs = files.map((f) => String(f.webkitRelativePath || "").split("/").slice(0, -1));
  let common = dirs[0]!;
  for (const d of dirs) {
    let k = 0;
    while (k < common.length && common[k] === d[k]) k++;
    common = common.slice(0, k);
  }
  const d = common.at(-1);
  return d ? `${d} (${files.length} files)` : `${files.length} files`;
}

/** The Study line at one of your decisions (the actions before it, the board up to its street), with the hand's
 * ante, straddle and each seat's own stack as Study's setup (the Solve page's); null where Study can't set the game
 * up (an ante over 1bb a seat). The table's stack is the effective one; the seats still in with another stack are
 * listed (a folded seat's changes nothing), and where one is outside a setup's 1–1000bb every seat plays the
 * effective stack. */
export function studyHandAt(r: ReplayedHand, street: Street, i: number): StudyHand | null {
  const h = r.hand;
  const game = gameSetup(h.players, h.ante, h.straddle);
  if (game === null) return null;
  const conv = (ms: readonly Move[]) => ms.map((m) => ({ pos: m.pos, action: m.action, ...(m.to !== undefined ? { to: m.to } : {}) }));
  const k = STREETS.indexOf(street);
  const at = (s: Street) => (STREETS.indexOf(s) < k ? conv(r.lines[s]) : s === street ? conv(r.lines[s].slice(0, i)) : []);
  const folded = new Set(STREETS.flatMap((s) => at(s).filter((m) => m.action === "fold").map((m) => m.pos)));
  const stack = r2(h.effective);
  const own = Object.entries(r.setup.stacks).filter(([p, v]) => !folded.has(p) && Math.abs(v - stack) > 1e-9);
  const withStacks: SpotSetup | undefined = own.length ? { ...game, stacks: Object.fromEntries(own) } : game;
  const setup = tidySetup(setupProblems(h.players, withStacks).length ? game : withStacks);
  return {
    players: h.players,
    stack,
    board: h.board.slice(0, NEED[street]).join(""),
    preflop: at("preflop"),
    flop: at("flop"),
    turn: at("turn"),
    river: at("river"),
    ...(setup ? { setup } : {}),
  };
}

export const studyLinkAt = (r: ReplayedHand, street: Street, i: number): string | null => {
  const s = studyHandAt(r, street, i);
  return s ? `/study?${toSearch(s)}` : null;
};
