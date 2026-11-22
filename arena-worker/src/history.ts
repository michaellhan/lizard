// A finished hand written as a hand history from one seat, in Lizard's format: Practice's layout
// (web/src/features/practice/history.ts handHistory), PokerStars' lines under Lizard's own header, which Analyze's importer
// reads as a site it doesn't name. Only what that seat saw is written: its own cards, the board as far as it was dealt,
// the other seat's cards only where they were shown. The table's id (its share link) is never written, so a history
// passed on can't open the table: the hand's number is the table's start time and the hand's place in it.
import { NEED, noLines, simulate, STREETS, toCallOf, withMove, type Move, type Sim, type Street, type TableSetup } from "../../web/src/poker/table";
import { ARENA_SITE } from "../../web/src/features/arena/protocol";
import { posOf, setupOf, type Hand, type Pos, type SeatNo } from "./game";

export { ARENA_SITE };

const EPS = 1e-9;
const amt = (x: number) => String(Math.round(x * 100) / 100);
const two = (x: number) => String(x).padStart(2, "0");
/** UTC: the server's clock, the same for both seats */
const stamp = (ms: number) => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}/${two(d.getUTCMonth() + 1)}/${two(d.getUTCDate())} ${two(d.getUTCHours())}:${two(d.getUTCMinutes())}:${two(d.getUTCSeconds())}`;
};

export const handNumber = (tableStart: number, n: number) => `A${tableStart}-${n}`;

function moveText(m: Move, sim: Sim, street: Street, t: TableSetup): string {
  const info = sim.streets[street]!;
  const mine = info.bets[m.pos] ?? 0;
  const cap = (t.stacks[m.pos] ?? 0) - (sim.invested[m.pos] ?? 0);
  const all = (to: number) => (to >= cap - EPS ? " and is all-in" : "");
  if (m.action === "fold") return "folds";
  if (m.action === "check") return "checks";
  const to = m.action === "all-in" ? cap : m.action === "call" ? mine + toCallOf(t, sim, m.pos) : m.to!;
  if (m.action === "call" || to <= info.curBet + EPS) return `calls ${amt(to - mine)}${all(to)}`;
  if (info.curBet <= EPS) return `bets ${amt(to)}${all(to)}`;
  return `raises ${amt(to - info.curBet)} to ${amt(to)}${all(to)}`;
}

/** The finished hand from `seat`'s side. `names`: each seat's display name (two different ones). */
export function handHistory(h: Hand, seat: SeatNo, names: readonly [string, string], tableStart: number): string {
  const t = setupOf(h);
  const name = (p: Pos) => names[h.seatOf[p]];
  const me = posOf(h, seat);
  const out = [
    `${ARENA_SITE} Hand #${handNumber(tableStart, h.n)}: Hold'em No Limit (0.5/1) - ${stamp(h.startedAt)}`,
    `Table '${ARENA_SITE}' 2-max Seat #1 is the button`,
    `Seat 1: ${name("SB")} (${amt(h.stack)} in chips)`,
    `Seat 2: ${name("BB")} (${amt(h.stack)} in chips)`,
    `${name("SB")}: posts small blind 0.5`,
    `${name("BB")}: posts big blind 1`,
    "*** HOLE CARDS ***",
    ...(["SB", "BB"] as const).map((p) => (p === me ? `Dealt to ${name(p)} [${h.hole[p].join(" ")}]` : `Dealt to ${name(p)}`)),
  ];
  const board = h.board.slice(0, h.shown);
  let lines = noLines();
  for (const s of STREETS) {
    if (h.shown < NEED[s]) break;
    if (s === "flop") out.push(`*** FLOP *** [${board.slice(0, 3).join(" ")}]`);
    if (s === "turn") out.push(`*** TURN *** [${board.slice(0, 3).join(" ")}] [${board[3]}]`);
    if (s === "river") out.push(`*** RIVER *** [${board.slice(0, 4).join(" ")}] [${board[4]}]`);
    for (const m of h.lines[s]) {
      out.push(`${name(m.pos as Pos)}: ${moveText(m, simulate(t, lines, NEED[s]), s, t)}`);
      lines = withMove(lines, s, m);
    }
    const back = simulate(t, lines, h.shown).streets[s]?.returned;
    for (const [p, x] of Object.entries(back ?? {})) out.push(`Uncalled bet (${amt(x)}) returned to ${name(p as Pos)}`);
  }
  const r = h.result;
  if (r) {
    if (h.reveal) out.push("*** SHOW DOWN ***", ...(["SB", "BB"] as const).map((p) => `${name(p)}: shows [${h.hole[p].join(" ")}]`));
    for (const p of ["SB", "BB"] as const) if (r.pays[p] > EPS) out.push(`${name(p)} collected ${amt(r.pays[p])} from pot`);
  }
  out.push("*** SUMMARY ***");
  if (r) out.push(`Total pot ${amt(r.pays.SB + r.pays.BB)} | Rake 0`);
  if (board.length) out.push(`Board [${board.join(" ")}]`);
  if (r?.timedOut !== undefined) out.push(`${names[r.timedOut]} ran out of time.`);
  out.push("Play money: a private practice game between two people.");
  return out.join("\n") + "\n";
}
