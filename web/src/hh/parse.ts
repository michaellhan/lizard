// Hand-history parsing, ported from the classic importer (solver/gto/static/hh.js, parseHandHistory and splitHands):
// a hand history from PokerStars, GGPoker/Natural8, 888poker, partypoker, Winamax, WPN/ACR, Ignition/Bovada or
// iPoker (XML) becomes the hand: its seats in the page's names, each seat's stack, the cards and every action as the
// seat's street total, in big blinds. The other sites' text is rewritten into PokerStars-like lines first (norm),
// which one parser reads. Pure: the golden tests (hh/parse.test.ts) hold it to the classic parser's output.
import { SEATS } from "@/poker/seats";

export type HhStreet = "preflop" | "flop" | "turn" | "river";
export type HhAct = "fold" | "check" | "call" | "bet" | "raise";

/** One action: `to` is the seat's total on the street, bb (none for a fold or check). */
export interface HhAction {
  street: HhStreet;
  pos: string;
  act: HhAct;
  to?: number;
  allIn?: true;
}

export interface HhSeat {
  seat: number;
  name: string;
  pos: string;
  /** chips at the start of the hand, bb */
  stack: number;
}

export interface HhTournament {
  /** the site's number (Winamax's from the table's name), else the name */
  id: string | null;
  name?: string;
  buyin?: string;
  level?: number;
}

export interface ParsedHand {
  site: string;
  /** the big blind in the history's money */
  bb: number;
  players: number;
  /** the hero's seat, in the page's names */
  hero: string;
  heroName: string;
  /** the hero's stack, bb */
  stack: number;
  /** every seat's stack as played (after an uneven ante, see parseHandHistory), bb */
  stacks: Record<string, number>;
  /** the hero's stack against the deepest opponent who didn't fold */
  effective: number;
  /** each seat's ante, bb (the antes' average) */
  ante: number;
  /** a 2bb straddle from the first seat */
  straddle: boolean;
  hole: string[];
  /** the board, up to five cards; empty when the history's cards don't add up */
  board: string[];
  seats: HhSeat[];
  actions: HhAction[];
  warnings: string[];
  tournament?: HhTournament;
}

/** What the importer refuses, with the message to show. */
export class HandHistoryError extends Error {
  override name = "HandHistoryError";
}

// Everything here reads text that can be anything: a paste, or a kept hand restored from a backup, read again on the
// page's main thread whenever Analyze opens. So nothing may take more than time in proportion to the text: lines are
// cut to MAX_LINE and the part before the seats to MAX_HEADER, every repeat a regex could backtrack over is bounded,
// and the XML is walked with indexOf. Real histories sit far inside all of these (hh/parse.test.ts).
/** the longest line read: the rest of a longer one is left out */
export const MAX_LINE = 512;
/** how much of the lines before the seats is read for the stakes and the tournament */
const MAX_HEADER = 4096;
/** the longest <general> repeated before each of a file's iPoker hands (a real one is a few lines) */
const MAX_GENERAL = 16384;
/** seats listed before the history is refused (a table has ten at most) */
const MAX_SEATS = 32;
/** actions in one hand before it's refused: a replay asks the table once for each, over all the actions before it */
const MAX_ACTIONS = 500;

const AMT = String.raw`[^\d\s]{0,16}([\d,]{0,24}\.?\d{1,20})`; // "$1,234.50", "€0.5", "1500"
const cut = (l: string) => l.slice(0, MAX_LINE);
const num = (s: string | number) => parseFloat(String(s).replace(/,/g, ""));
const r2 = (x: number) => Math.round(x * 100) / 100;
/** every amount in "raises [$1.50 USD] to $2" */
const amts = (s: string) => (String(s).match(/\d[\d,]*(?:\.\d+)?|\.\d+/g) ?? []).map(num);
const card = (c: string): string | null => {
  const m = String(c).match(/^(10|[2-9TJQKA])([shdc])$/i);
  return m ? (m[1] === "10" ? "T" : m[1]!.toUpperCase()) + m[2]!.toLowerCase() : null;
};
/** "[Ah Qd]", "[ Ah, Qd ]" */
const cardsIn = (l: string) =>
  (l.match(/\[[^\]]{0,64}\]/g) ?? []).flatMap((b) => b.slice(1, -1).split(/[\s,]+/).filter(Boolean)).map(card);
type HeaderStreet = HhStreet | "skip" | "done";
const STREET = (t: string): HeaderStreet | null =>
  /HOLE|PRE-?FLOP|DOWN CARDS/.test(t) ? "preflop"
  : /SECOND|2ND|\b2$/.test(t) ? "skip"
  : /FLOP/.test(t) ? "flop"
  : /TURN/.test(t) ? "turn"
  : /RIVER/.test(t) ? "river"
  : /SHOW ?DOWN|SUMMARY|RUN IT/.test(t) ? "done"
  : null;
/** A street's header line: what stands between its opening stars and the next two. */
const header = (l: string) => {
  const open = l.search(/[^*]/);
  if (open < 2) return null;
  const close = l.indexOf("**", open);
  return close < 0 ? null : STREET(l.slice(open, close).trim().toUpperCase());
};
const START =
  /^(PokerStars\b.*Hand #|Poker Hand #|Winamax Poker\b|(Game )?Hand #\d|(Ignition|Bovada|Bodog)\b.*Hand #|#Game No\b|\*{5}.*Hand History for Game|Game #\d+ starts)/i;
const SITES: [string, RegExp][] = [
  ["PokerStars", /PokerStars/i],
  ["GGPoker", /^Poker Hand #/m],
  ["Winamax", /^Winamax/m],
  ["888poker", /888|Pacific/i],
  ["partypoker", /Hand History for Game|^Game #\d+ starts/im],
  ["Ignition/Bovada", /^(Ignition|Bovada|Bodog)\b/m],
  ["WPN/ACR", /^(Game )?Hand #\d/m],
];
/** the sites the importer reads, for the import box */
export const HH_SITES = [...SITES.map(([s]) => s), "iPoker"];

interface Normed {
  lines: string[];
  site: string;
  /** iPoker's nickname: the hero among several "Dealt to" lines */
  hint: string;
}

/** Each `<tag …>…</tag>` in `x`, the tags given, in order. A tag with no closing one left isn't looked for again. */
function xmlBlocks(x: string, tags: readonly string[]): string[] {
  const out: string[] = [];
  const open = new RegExp(`<(${tags.join("|")})\\b`, "g");
  const unclosed = new Set<string>();
  for (let m = open.exec(x); m; m = open.exec(x)) {
    if (unclosed.has(m[1]!)) continue;
    const close = `</${m[1]}>`;
    const end = x.indexOf(close, m.index);
    if (end < 0) {
      unclosed.add(m[1]!);
      continue;
    }
    out.push(x.slice(m.index, end + close.length));
    open.lastIndex = end + close.length;
  }
  return out;
}

/** Each opening `<tag …>` in `x`, the tags given, in order: its name, its attributes, and where it ends. */
export function xmlTags(x: string, tags: readonly string[]): { tag: string; attrs: string; end: number }[] {
  const out: { tag: string; attrs: string; end: number }[] = [];
  const open = new RegExp(`<(${tags.join("|")})\\b`, "g");
  for (let m = open.exec(x); m; m = open.exec(x)) {
    const end = x.indexOf(">", m.index);
    if (end < 0) break;
    out.push({ tag: m[1]!, attrs: x.slice(m.index + m[0].length, end), end: end + 1 });
    open.lastIndex = end + 1;
  }
  return out;
}

// iPoker's XML (Bet365, William Hill, Unibet's old client…): the first <game>, as text. Cards are suit first ("HA",
// "C10"); action types: 0 fold, 1/2 blinds, 3 call, 4 check, 5 bet, 6 raise by, 7 all-in (chips added), 15 ante, 23 raise to.
function ipoker(x: string, warnings: string[]): Normed {
  const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
  const ent = (s: string) => s.replace(/&(amp|lt|gt|quot|apos);/g, (_, k: string) => ENT[k]!);
  const at = (s: string, k: string) => ent(s.match(new RegExp(String.raw`\b${k}="([^"]*)"`))?.[1] ?? "");
  const tag = (s: string, k: string) => ent(s.match(new RegExp(`<${k}>([^<]*)</${k}>`))?.[1] ?? "");
  const money = (s: string) => {
    s = s.replace(/[^\d.,]/g, "");
    return /,\d\d?$/.test(s) ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  };
  const cards = (s: string) => s.trim().split(/\s+/).map((c) => c.slice(1) + c[0]);
  const games = xmlBlocks(x, ["game"]);
  const hint = tag(x, "nickname");
  const bb = tag(x, "bigblind");
  const g = games.find((g) => g.includes(`name="${hint}"`)) ?? games[0] ?? x; // the first hand you were dealt into
  if (games.length > 1) warnings.push(`${games.length} hands pasted: imported the first.`);
  const tc = tag(x, "tournamentcode");
  const tn = tag(x, "tournamentname");
  const out = [
    `iPoker Hand #${at(g, "gamecode")}: ${tag(x, "gametype")}${bb ? ` (${money(tag(x, "smallblind"))}/${money(bb)})` : ""}${tc ? ` Tournament #${tc}${tn ? ` "${tn.replace(/"/g, "'")}"` : ""}` : ""}`,
  ];
  for (const { attrs: p } of xmlTags(g, ["player"])) {
    out.push(`Seat ${at(p, "seat")}: ${at(p, "name")} (${money(at(p, "chips"))})`);
    if (at(p, "dealer") === "1") out.push(`Seat #${at(p, "seat")} is the button`);
  }
  const board: string[] = [];
  const HEAD: Record<string, string> = { 1: "HOLE CARDS", 2: "FLOP", 3: "TURN", 4: "RIVER" };
  const ACT: Record<string, string> = {
    0: "folds", 1: "posts small blind ", 2: "posts big blind ", 3: "calls ", 4: "checks", 5: "bets ", 6: "raises ",
    7: "is all-in ", 15: "posts ante ", 23: "raises to ",
  };
  for (const round of xmlBlocks(g, ["round"])) {
    const [open, no] = round.match(/^<round\s+no="(\d+)"[^>]*>/) ?? [];
    if (!open) continue;
    const body = round.slice(open.length, -"</round>".length);
    // a <cards> holds its text up to the next tag, which closes it; one that doesn't is no card
    const items = xmlTags(body, ["cards", "action"]).flatMap(({ tag, attrs, end }): { a?: string; cs?: string; act?: string }[] => {
      if (tag === "action") return [{ act: attrs }];
      const stop = body.indexOf("<", end);
      return stop >= 0 && body.startsWith("</cards>", stop) ? [{ a: attrs, cs: body.slice(end, stop) }] : [];
    });
    // (a board is five cards, or ten when it's run twice)
    for (const { a, cs } of items) if (a && !at(a, "player") && board.length < 10) board.push(...cards(cs!).slice(0, 10));
    if (HEAD[no!]) out.push(`*** ${HEAD[no!]} *** ${+no! > 1 ? `[${board.join(" ")}]` : ""}`);
    for (const { a, cs, act } of items) {
      const t = act !== undefined ? ACT[at(act, "type")] : undefined;
      if (a && at(a, "player")) out.push(`Dealt to ${at(a, "player")}${/^[\sX]*$/i.test(cs!) ? "" : ` [${cards(cs!).join(" ")}]`}`);
      else if (t) out.push(`${at(act!, "player")}: ${t}${/ $/.test(t) ? money(at(act!, "sum")) : ""}`);
    }
  }
  return { lines: out.map(cut), site: "iPoker", hint };
}

// A history's lines (trimmed, no blank ones) as one array per hand: a hand starts at a site's first header line
// (a header within 3 lines of another is the same hand's: 888's "#Game No" then its "***** … Hand History"),
// anything before the first one stays with it
function handLines(text: string): string[][] {
  const lines = String(text || "")
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => cut(l.trim()))
    .filter(Boolean);
  const starts = lines
    .map((l, i) => (START.test(l) ? i : -1))
    .filter((i, k, a) => i >= 0 && !a.slice(Math.max(0, k - 3), k).some((j) => j >= 0));
  if (starts.length < 2) return [lines];
  return starts.map((s, k) => lines.slice(k ? s : 0, starts[k + 1]));
}

/** A file of many hands as one text per hand, each as parseHandHistory takes it: iPoker's XML a <session> per
 * <game> with the <general> before it (the stakes, your nickname), the other sites' text cut at each hand's header. */
export function splitHands(text: string): string[] {
  text = String(text || "");
  if (/<game\b/i.test(text)) {
    const out: string[] = [];
    let gen = "";
    for (const m of xmlBlocks(text, ["general", "game"]))
      if (m.startsWith("<general")) gen = m.length > MAX_GENERAL ? "" : m;
      else out.push(`<session>${gen}${m}</session>`);
    return out;
  }
  return handLines(text)
    .map((ls) => ls.join("\n"))
    .filter(Boolean);
}

// the other sites' lines as PokerStars-like ones, and the hand's site
export function norm(text: string, warnings: string[]): Normed {
  if (/<game\b/i.test(text)) return ipoker(String(text), warnings);
  const hands = handLines(text);
  let lines = hands[0]!;
  if (hands.length > 1) {
    lines = lines.slice(lines.findIndex((l) => START.test(l)));
    warnings.push(`${hands.length} hands pasted: imported the first.`);
  }
  const pre = lines.slice(0, 3).join("\n");
  const site = (SITES.find(([, re]) => re.test(pre)) ?? ["generic"])[0];
  const all = lines.join(" ");
  // dots for thousands (888's "1.183.764 $"), when no amount has cents
  if (/\d\.\d{3}(?!\d)/.test(all) && !/\d\.\d\d?(?!\d)/.test(all)) lines = lines.map((l) => l.replace(/(\d)\.(?=\d{3}(?!\d))/g, "$1"));
  // Ignition/Bovada name players by position ("UTG+1 [ME] : Raises $2 to $2"); its seat numbers aren't the table's order, the listing is
  let k = 0;
  if (site === "Ignition/Bovada")
    lines = lines.map((l) =>
      /^Seat \d+:/i.test(l)
        ? l.replace(/^Seat \d+/i, () => `Seat ${++k}`)
        : l
            .replace(/^(.+?)\s{1,8}:\s{1,8}Card dealt to a spot (\[.*\])/i, "Dealt to $1 $2")
            .replace(/^(.+?)\s{1,8}:\s{1,8}(Small Blind|Big Blind|Ante chip)\b/i, (_, n: string, b: string) => `${n}: posts ${/ante/i.test(b) ? "ante" : b.toLowerCase()}`)
            .replace(/All-in\(raise[^)]{0,64}\)\s*(.*)$/i, "raises $1 and is all-in"),
    );
  return { lines, site, hint: "" };
}

// a tournament's hand (the lines before the seats): its id (the site's number; Winamax's from the table's name), name,
// buy-in and level, or null for a cash game
const ROMAN: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
const roman = (s: string) =>
  [...s.toUpperCase()].reduceRight(
    (o, c) => {
      const v = ROMAN[c] ?? 0;
      return { n: o.n + (v < o.top ? -v : v), top: Math.max(o.top, v) };
    },
    { n: 0, top: 0 },
  ).n;
const beforeSeats = (lines: string[], sep: string) =>
  lines
    .slice(0, Math.max(1, lines.findIndex((l) => /^Seat \d+:/i.test(l))))
    .join(sep)
    .slice(0, MAX_HEADER);
function tourney(lines: string[]): HhTournament | null {
  const pre = beforeSeats(lines, "\n");
  if (!/Tournament|Tourney|\bMTT\b|\bSNG\b|Sit ?(&|n|'n'|and) ?Go|Spin ?(&|and) ?Go/i.test(pre)) return null;
  const name = pre.match(/Tournament\s*(?:#[\w-]+\s*)?"([^"]+)"/i)?.[1];
  const id = (pre.match(/Tournament\s*(?:#|ID\s*:?)\s*([\w-]*\d[\w-]*)/i) ?? pre.match(/^Table:?\s*'[^'(]*\((\d+)\)/im))?.[1] || name || null;
  const buyin = pre.match(/(?:[$€£]\s?)?\d{1,12}(?:\.\d{1,12})?\s?[€£]?(?:\s?\+\s?(?:[$€£]\s?)?\d{1,12}(?:\.\d{1,12})?\s?[€£]?){1,2}/)?.[0];
  const lv = pre.match(/\bLevel\s{0,8}:?\s{0,8}([IVXLCDM]+|\d+)(?![\w.])/i)?.[1];
  return {
    id,
    ...(name ? { name } : {}),
    ...(buyin ? { buyin: buyin.replace(/\s+/g, "") } : {}),
    ...(lv ? { level: /^\d+$/.test(lv) ? +lv : roman(lv) } : {}),
  };
}

type PostKind = "ante" | "dead" | "sb" | "bb" | "straddle";
interface Post {
  name: string;
  kind: PostKind;
  amt: number;
}
/** an action as written: what it adds (`amt`), or a raise's total (`to`) */
interface Act {
  street: HhStreet;
  name: string;
  act: HhAct;
  amt?: number;
  to?: number;
  allIn?: boolean;
}

/** One hand history (the first, when several are pasted) as the hand, or a HandHistoryError saying why not. */
export function parseHandHistory(text: string): ParsedHand {
  const warnings: string[] = [];
  const { lines, site, hint } = norm(text, warnings);
  const head = lines.find((l) => /Hold'?em|Omaha|Hand #/i.test(l)) ?? lines[0] ?? "";
  // a mixed game names this hand's game in brackets: "Mixed NLH/PLO (Hold'em No Limit, $0.10/$0.25)"
  const game = head.match(/\bMixed\b[^(]*\(([^)]*)\)/i)?.[1] ?? head;
  if (/Omaha|PLO|Stud|Razz|Badugi|Courchevel|6\+|Short ?Deck/i.test(game) || (/\bDraw\b/i.test(game) && !/Hold'?em/i.test(game)))
    throw new HandHistoryError("Only Hold'em hands can be imported.");
  if (/\bLimit\b/i.test(game) && !/No ?Limit/i.test(game)) warnings.push("Not a no-limit hand: it's solved as no-limit.");

  const seats: { seat: number; name: string; chips: number }[] = [];
  const seated = new Set<number>();
  // the stack is the last "(…)" opening with an amount, so a name with brackets ("x (2)") keeps them
  const SEAT = new RegExp(String.raw`^Seat (\d+): (.+) \(\s*${AMT}(?: in chips)?[^)]{0,64}\)`, "i");
  for (const l of lines) {
    if (header(l)) break; // seat lines in the summary say who won, not their stacks
    const m = l.match(SEAT);
    if (m && !seated.has(+m[1]!)) {
      seated.add(+m[1]!);
      seats.push({ seat: +m[1]!, name: m[2]!.trim(), chips: num(m[3]!) });
      if (seats.length > MAX_SEATS) throw new HandHistoryError(`${seats.length} players in this hand: the page plays 2 to 9.`);
    }
  }
  if (seats.length < 2)
    throw new HandHistoryError(
      'No players found. Paste a whole hand history, from its first line ("PokerStars Hand #…", "Poker Hand #…"…) down; it needs the "Seat 1: name ($100)" lines.',
    );
  const names = seats.map((s) => s.name).sort((a, b) => b.length - a.length);
  const who = (l: string) => names.find((n) => l.startsWith(n + ":") || l.startsWith(n + " "));

  let street: HeaderStreet | null = null;
  let hero: string | null = null;
  let hole: string[] | null = null;
  let board: (string | null)[] = [];
  const posts: Post[] = [];
  const acts: Act[] = [];
  const dealt = new Set<string>();
  for (const l of lines) {
    let m: RegExpMatchArray | null;
    if (/^\*{2,}/.test(l)) {
      // run it twice: the first board is played out, the second ignored. 888 and party show only the new card.
      street = header(l) || (street ? "done" : null);
      const k = ({ flop: 3, turn: 4, river: 5 } as Partial<Record<string, number>>)[street ?? ""];
      const cs = cardsIn(l);
      if (k) board = cs.length >= k ? cs : [...board.slice(0, k - cs.length), ...cs];
      continue;
    }
    if ((m = l.match(/^Dealt to (.+?)(?:\s{0,8}(\[[^\]]{0,64}\]))?$/i))) {
      const n = m[1]!;
      dealt.add(n);
      const cs = m[2] ? cardsIn(m[2]) : [];
      if (cs.length > 2) throw new HandHistoryError("Only Hold'em hands can be imported.");
      // GGPoker's own exports can show every player's cards, its hero is "Hero"; Ignition's is "… [ME]"
      const me = (x: string | null) => x === hint || x === "Hero" || /\[ME\]$/.test(x ?? "");
      if (cs.length === 2 && cs.every(Boolean) && (!hole || (me(n) && !me(hero)))) {
        hero = n;
        hole = cs as string[];
      }
      continue;
    }
    if (!board.length && (m = l.match(/^Board:?\s*(\[.*\])/i))) {
      board = cardsIn(m[1]!);
      continue;
    }
    const name = who(l);
    if (!name || street === "done" || street === "skip") continue;
    // amounts are what the action adds ("calls 2", 888/party/iPoker's "raises [$2]"), except a raise "to"
    const rest = l.slice(name.length).replace(/^\s*:?\s*/, "");
    const allIn = /all[- ]in/i.test(rest);
    const a = amts(rest);
    if ((m = rest.match(/^posts (?:the )?(ante|small & big blinds?|small blind|big blind|(?:a )?straddle)\b(.*)/i))) {
      const k = m[1]!.toLowerCase();
      const amt = amts(m[2]!)[0];
      if (amt != null)
        posts.push({
          name,
          kind: k === "ante" ? "ante" : k.startsWith("small &") ? "dead" : k === "small blind" ? "sb" : k === "big blind" ? "bb" : "straddle",
          amt,
        });
    } else if (!street) continue;
    else if (/^folds/i.test(rest)) acts.push({ street, name, act: "fold" });
    else if (/^checks/i.test(rest)) acts.push({ street, name, act: "check" });
    else if (!a.length) continue;
    else if (/^calls?\b/i.test(rest)) acts.push({ street, name, act: "call", amt: a[0]!, allIn });
    else if (/^(bets|(goes |is )?all[- ]in)\b/i.test(rest)) acts.push({ street, name, act: "bet", amt: a[0]!, allIn });
    else if (/^raises\b/i.test(rest)) acts.push({ street, name, act: "raise", ...(/\bto\b/i.test(rest) ? { to: a.at(-1)! } : { amt: a[0]! }), allIn });
  }
  if (acts.length > MAX_ACTIONS) throw new HandHistoryError(`${acts.length} actions in this hand: too many to be a hand history.`);
  if (!hole || hero == null)
    throw new HandHistoryError(
      'Your hole cards aren\'t in this history (no "Dealt to you [Ah Kd]" line). Import a hand you played, as your poker client saved it.',
    );
  const heroName: string = hero;
  if (!seats.some((s) => s.name === heroName))
    throw new HandHistoryError(`"${heroName}" has hole cards but no "Seat N: ${heroName} (…)" line: paste the whole hand history.`);
  if (!board.every(Boolean) || new Set([...hole, ...board]).size < 2 + board.length) board = [];

  // who was dealt in: anyone who posted, acted or (GG) has a "Dealt to" line; sitting-out seats did none of these
  const inHand = new Set([...posts.map((p) => p.name), ...acts.map((a) => a.name), ...dealt, heroName]);
  const order = seats.filter((s) => inHand.has(s.name)).sort((a, b) => a.seat - b.seat);
  const n = order.length;
  if (n < 2 || n > 9) throw new HandHistoryError(`${n} players in this hand: the page plays 2 to 9.`);
  const bb = (() => {
    // the stakes before the seats ("($0.50/$1)", "$0.50/$1 Blinds", Winamax's "(ante/sb/bb)"), else the big blind posted
    const pre = beforeSeats(lines, " ")
      .replace(/\d{4}[/-]\d\d?[/-]\d\d?|\d\d?\/\d\d?\/\d{2,4}|players\s*:\s*\d+\/\d+/gi, ""); // not dates, party's "players : 6/6"
    const m = pre.match(new RegExp(String.raw`${AMT}[^\d/]{0,6}\/\s*${AMT}(?:[^\d/]{0,6}\/\s*${AMT})?`));
    const p = posts.find((x) => x.kind === "bb");
    return m && num(m[3] || m[2]!) > 0 ? num(m[3] || m[2]!) : p ? p.amt : 0;
  })();
  if (!(bb > 0)) throw new HandHistoryError('Couldn\'t find the big blind (neither the stakes, "($0.50/$1)", nor a "posts big blind" line).');
  const sbPost = posts.find((p) => p.kind === "sb");
  if (sbPost && Math.abs(sbPost.amt / bb - 0.5) > 0.01)
    warnings.push(`The small blind is ${r2(sbPost.amt / bb)}bb: the page plays a half-big-blind small blind.`);

  // seats: clockwise from the button, the big blind is the first player after it who posted one (a new player
  // can post a big blind elsewhere); the page's names run from the first seat after the big blind round to it
  const bm = lines.join("\n").match(/Seat #?(\d+) is the button/i);
  const bbPost = new Set(posts.filter((p) => p.kind === "bb").map((p) => p.name));
  const toBB = n === 2 ? 1 : 2;
  const at = (i: number) => order[i]!;
  let bi: number;
  let bbi: number;
  if (bm) {
    const b = +bm[1]!;
    bi = order.findIndex((s) => s.seat >= b);
    if (bi < 0) bi = 0;
    if (at(bi).seat !== b) bi = (bi + n - 1) % n; // the button seat is empty or sat out: the last one before it
    bbi = (bi + toBB) % n;
    for (let k = 1; k <= n; k++)
      if (bbPost.has(at((bi + k) % n).name)) {
        bbi = (bi + k) % n;
        break;
      }
  } else {
    // no button line (a partial paste): the big blind's poster, else the seat after the small blind's
    const sb = order.findIndex((s) => posts.some((p) => p.kind === "sb" && p.name === s.name));
    bbi = order.findIndex((s) => bbPost.has(s.name));
    if (bbi < 0) bbi = sb >= 0 ? (sb + 1) % n : toBB % n;
    bi = (bbi - toBB + n) % n;
  }
  const names9 = SEATS[n]!;
  // (keyed by players' names, which can be anything: "constructor", "__proto__")
  const byName = <T,>(): Record<string, T> => Object.create(null) as Record<string, T>;
  const pos = byName<string>();
  for (let k = 0; k < n; k++) pos[at((bbi + 1 + k) % n).name] = names9[k]!;
  if (n > 2 && pos[at(bi).name] !== "BTN") warnings.push("The button isn't next to the blinds (a dead button?): positions are counted from the big blind.");

  // amounts as each player's total on the street ("to"), in big blinds; all-in also when the chips run out
  const left: Record<string, number> = Object.fromEntries(order.map((s) => [s.name, s.chips]));
  const anteOf = byName<number>();
  let put = byName<number>();
  let antes = 0;
  let straddle = false;
  for (const p of posts) {
    if (!pos[p.name]) continue;
    if (p.kind === "ante") {
      antes += p.amt;
      left[p.name]! -= p.amt;
      anteOf[p.name] = (anteOf[p.name] ?? 0) + p.amt;
      continue;
    }
    const live = p.kind === "dead" ? bb : p.amt;
    left[p.name]! -= p.amt;
    put[p.name] = Math.max(put[p.name] ?? 0, live);
    if (p.kind === "straddle") {
      if (n >= 3 && pos[p.name] === names9[0] && Math.abs(p.amt / bb - 2) < 0.01) straddle = true;
      else warnings.push(`${pos[p.name]}'s straddle isn't a 2bb straddle from the first seat, the only kind the page plays: it's left out.`);
    } else if (p.kind === "dead" || (p.kind === "bb" && pos[p.name] !== "BB")) warnings.push(`${pos[p.name]} posted a blind out of turn: the page leaves it out.`);
  }
  let cur: HhStreet | null = null;
  const actions: HhAction[] = [];
  for (const a of acts) {
    const p = pos[a.name];
    if (!p) continue;
    if (a.street !== cur) {
      if (cur) put = byName();
      cur = a.street;
    }
    const before = put[a.name] ?? 0;
    const to = a.act === "raise" && a.to != null ? a.to : a.act === "fold" || a.act === "check" ? before : before + (a.amt ?? NaN);
    // an all-in "bet" into a bet (party's "is all-In [$46]", Ignition's "All-in $39") raises or calls
    const top = Math.max(0, ...Object.values(put));
    const act: HhAct = a.act === "bet" && top > 0 ? (to > top ? "raise" : "call") : a.act;
    left[a.name]! -= to - before;
    put[a.name] = to;
    actions.push({
      street: a.street,
      pos: p,
      act,
      ...(a.act === "fold" || a.act === "check" ? {} : { to: r2(to / bb) }),
      ...(a.allIn || (left[a.name]! <= 1e-9 && to > before) ? { allIn: true as const } : {}),
    });
  }
  // every seat plays its own stack. The page takes the same ante from everyone (the average), so a seat's stack
  // is set for what it has behind after the antes to be the history's (a big-blind ante paid by one player).
  const ante = Math.round((antes / n / bb) * 1e4) / 1e4;
  const stacks: Record<string, number> = Object.fromEntries(order.map((s) => [pos[s.name]!, r2((s.chips - (anteOf[s.name] ?? 0)) / bb + ante)]));
  // (effective: yours against the deepest opponent who didn't fold, for the summary)
  const heroPos = pos[heroName]!;
  const opp = order.filter((s) => s.name !== heroName);
  const folded = new Set(acts.filter((a) => a.act === "fold").map((a) => a.name));
  const deep = [opp.filter((s) => !folded.has(s.name)), opp].find((x) => x.length) ?? [];
  const effective = Math.min(stacks[heroPos]!, Math.max(...deep.map((s) => stacks[pos[s.name]!]!)));
  const tour = tourney(lines);
  return {
    site,
    bb,
    players: n,
    hero: heroPos,
    heroName,
    stack: stacks[heroPos]!,
    stacks,
    effective,
    ante,
    straddle,
    hole,
    board: (board as string[]).slice(0, 5),
    seats: order.map((s) => ({ seat: s.seat, name: s.name, pos: pos[s.name]!, stack: r2(s.chips / bb) })),
    actions,
    warnings,
    ...(tour ? { tournament: tour } : {}),
  };
}
