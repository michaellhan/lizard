// What a hand won or lost you as played (Analyze's realized results): what the history says you collected (each pot,
// each board of a run-it-twice, after rake), less what you put in as the history has it (blinds, antes, straddles
// and dead blinds as posted, each street's total, any bet nobody matched given back), in big blinds. That's the
// history's money, not the replay's: the page plays a half-big-blind small blind and averages an uneven ante. Null,
// with the reason, where the history doesn't say: no winnings line read here (a site format not read, a hand not
// played out) where you didn't fold, or GG's EV Cashout (paid on equity, not on the board).
import { norm, xmlTags, type ParsedHand } from "./parse";

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// an amount as written: "$20.90", "397.50€", "5,086", "[ $20.90 ]", "$100.25 USD"
const AMT = String.raw`[$€£]?\s?\d[\d.,]*`;
// in the parser's reading (a comma is a thousands separator; norm has rewritten 888's thousands dots)
const amount = (s: string) => parseFloat(s.replace(/[^\d.]/g, ""));
// each site's line for a pot won, `N` the player's name: Stars, GG, Winamax and ACR's "N collected $20.90 from pot",
// 888's "N collected [ $20.90 ]", party's "N wins $100.25 USD from the main pot" and its tournaments' "N balance
// 5086, bet 2500, collected 5086, net +2586", Ignition's "Dealer [ME] : Hand result $20.90"
const WON = [
  (n: string) => String.raw`^${n} collected \[?\s*(${AMT})`,
  (n: string) => String.raw`^${n} balance [^,]*, (?:bet [^,]*, )?collected (${AMT})`,
  (n: string) => String.raw`^${n} wins (${AMT})`,
  (n: string) => String.raw`^${n} : Hand result[^$\d]*(${AMT})`,
];

/** What a seat collected in the history's money, or null where no line in it says who won anything (a format not
 * read here). Every pot and board it won is summed. */
export function collected(text: string, name: string): number | null {
  // iPoker's XML: each player's win="€397.50"
  if (/<game\b/i.test(text)) {
    const p = xmlTags(text, ["player"]).map((t) => t.attrs);
    if (!p.length) return null;
    const me = p.find((x) => x.match(/\bname="([^"]*)"/)?.[1] === name);
    const win = me?.match(/\bwin="([^"]*)"/)?.[1];
    return win != null ? amount(win) || 0 : me ? 0 : null;
  }
  const { lines } = norm(text, []);
  const any = WON.map((f) => new RegExp(f(".+?")));
  if (!lines.some((l) => any.some((re) => re.test(l)))) return null;
  const mine = WON.map((f) => new RegExp(f(esc(name))));
  let got = 0;
  for (const l of lines) {
    for (const re of mine) {
      const m = l.match(re);
      if (m) {
        got += amount(m[1]!);
        break;
      }
    }
  }
  return got;
}

export type ResultWhy = "unread" | "cashout";
export const RESULT_WHY: Record<ResultWhy, string> = {
  unread: "no winnings line read",
  cashout: "EV Cashout",
};
export interface HandResult {
  /** won (or lost, below 0) in big blinds; null where it can't be told */
  net: number | null;
  why?: ResultWhy;
}

const POST = /^posts (?:the )?(ante|small & big blinds?|small blind|big blind|(?:a )?straddle)\b(.*)/i;
/** What each seat put in as the history has it, bb: antes and the dead part of a dead blind, then each street's
 * total (a live blind its first), less what nobody matched. */
export function paidOf(h: ParsedHand, text: string): Record<string, number> {
  const pos = Object.fromEntries(h.seats.map((s) => [s.name, s.pos]));
  const names = h.seats.map((s) => s.name).sort((a, b) => b.length - a.length);
  const paid: Record<string, number> = Object.fromEntries(h.seats.map((s) => [s.pos, 0]));
  const pre: Record<string, number> = {};
  for (const l of norm(text, []).lines) {
    const name = names.find((n) => l.startsWith(n + ":") || l.startsWith(n + " "));
    const m = name != null ? l.slice(name.length).replace(/^\s*:?\s*/, "").match(POST) : null;
    const amt = m && Number(m[2]!.match(/\d[\d,]*(?:\.\d+)?|\.\d+/)?.[0]?.replace(/,/g, ""));
    if (!m || !amt) continue;
    const p = pos[name!]!;
    const k = m[1]!.toLowerCase();
    if (k === "ante") paid[p]! += amt / h.bb;
    else {
      const live = k.startsWith("small &") ? h.bb : amt;
      paid[p]! += (amt - live) / h.bb;
      pre[p] = Math.max(pre[p] ?? 0, live / h.bb);
    }
  }
  for (const st of ["preflop", "flop", "turn", "river"] as const) {
    const tot: Record<string, number> = st === "preflop" ? { ...pre } : {};
    for (const a of h.actions) if (a.street === st && a.to != null) tot[a.pos] = a.to;
    for (const [p, t] of Object.entries(tot)) {
      const top = Math.max(0, ...Object.entries(tot).filter(([q]) => q !== p).map(([, x]) => x));
      paid[p]! += Math.min(t, top);
    }
  }
  return paid;
}

/** A seat's result in a hand (the hero's unless `pos` says another). */
export function resultOf(h: ParsedHand, text: string, pos: string = h.hero): HandResult {
  if (/\bCashout\b/i.test(text)) return { net: null, why: "cashout" };
  const name = h.seats.find((s) => s.pos === pos)?.name;
  // (a seat that folded collected nothing, whether or not the history goes on: Practice's stops at your fold)
  const got = name == null ? null : (collected(text, name) ?? (h.actions.some((a) => a.pos === pos && a.act === "fold") ? 0 : null));
  if (got == null) return { net: null, why: "unread" };
  return { net: Math.round((got / h.bb - (paidOf(h, text)[pos] ?? 0)) * 1e4) / 1e4 };
}
