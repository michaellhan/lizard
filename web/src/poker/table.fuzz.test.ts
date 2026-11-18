// table.ts against an independent reference in cents (ref.fixture.ts), in lockstep over seeded random hands: 2-9 players,
// short and odd stacks, antes, the straddle, the rake, random legal moves (typed amounts, opponents' clamped ones, all-ins).
// Each step: who acts, the price of a call, the all-in, whether a raise is allowed and the smallest; each move recorded
// as the reference allows; at the end, the chips in, the payouts by side pot and the rake, and every chip accounted for.
import { describe, expect, it } from "vitest";
import { cmp, rank7 } from "./evaluate";
import { refPays, RefTable } from "./ref.fixture";
import { seatsOf } from "./seats";
import { deal, legal, NEED, noLines, recordOf, seeded, settle, simulate, withMove, type Lines, type TableSetup } from "./table";

const HANDS = 2000;
const C = (x: number) => Math.round(x * 100);

describe("the table against the cents reference", () => {
  it(`agrees over ${HANDS} seeded hands`, () => {
    const rnd = seeded(20261118);
    const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)]!;
    const stackOf = (): number => {
      const x = rnd();
      if (x < 0.1) return pick([0.05, 0.1, 0.25, 0.3, 0.4, 0.5, 0.6, 0.7, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.8, 2, 2.2, 2.5, 3]);
      if (x < 0.35) return Math.round((2 + rnd() * 23) * 100) / 100;
      if (x < 0.5) return Math.round((2 + rnd() * 30) * 2) / 2;
      return Math.round((25 + rnd() * 275) * 100) / 100;
    };
    const bugs: string[] = [];
    const bug = (what: string) => bugs.length < 10 && bugs.push(what);
    let showdowns = 0;
    let shortAllIns = 0;
    let typedMins = 0;
    for (let n = 0; n < HANDS && bugs.length < 10; n++) {
      const players = 2 + Math.floor(rnd() * 8);
      const seats = seatsOf(players);
      const base = stackOf();
      const equal = rnd() < 0.3;
      const stacks = Object.fromEntries(seats.map((p) => [p, equal ? base : stackOf()]));
      const ante = rnd() < 0.3 ? pick([0.1, 0.12, 0.15, 0.2, 0.25, 0.5, 1]) : 0;
      const straddle = players >= 3 && rnd() < 0.15;
      const t: TableSetup = { players, stacks, ...(ante ? { ante } : {}), ...(straddle ? { straddle: true } : {}) };
      const ref = new RefTable(t);
      const d = deal(players, rnd);
      let l: Lines = noLines();
      let shown = 0;
      const tag = () => `hand ${n} ${JSON.stringify(t)} ${JSON.stringify(l)}`;
      let broke = false;
      for (let steps = 0; steps < 400; steps++) {
        const s = simulate(t, l, shown);
        if (s.handOver !== ref.over) {
          bug(`hand over: table ${s.handOver}, reference ${ref.over}: ${tag()}`);
          broke = true;
          break;
        }
        if (s.handOver) break;
        if (s.waiting) {
          if (!ref.waitingCard) {
            bug(`the table waits for a card, the reference has ${ref.toAct()} to act: ${tag()}`);
            broke = true;
            break;
          }
          shown = NEED[s.waiting];
          ref.deal();
          continue;
        }
        const lg = legal(t, s);
        const rl = ref.legal();
        if (!lg || !rl || lg.toAct !== rl.toAct) {
          bug(`to act: table ${lg?.toAct}, reference ${rl?.toAct}: ${tag()}`);
          broke = true;
          break;
        }
        if (C(lg.toCall) !== rl.toCall) bug(`to call: table ${lg.toCall}, reference ${rl.toCall / 100}: ${tag()}`);
        if (C(lg.allInTo) !== rl.allInTo) bug(`all-in: table ${lg.allInTo}, reference ${rl.allInTo / 100}: ${tag()}`);
        if (lg.canRaise !== rl.canRaise) bug(`may raise: table ${lg.canRaise}, reference ${rl.canRaise}: ${tag()}`);
        if (lg.canRaise && C(lg.minTo) !== rl.minTo) bug(`smallest raise: table ${lg.minTo}, reference ${rl.minTo / 100}: ${tag()}`);
        const x = rnd();
        const a =
          x < 0.14 ? { action: "fold" }
          : x < 0.5 ? { action: lg.toCall > 0 ? "call" : "check" }
          : x < 0.62 ? { action: "raise", to: lg.minTo }
          : x < 0.8 ? { action: "raise", to: lg.minTo + rnd() * Math.max(0, lg.allInTo - lg.minTo) }
          : x < 0.88 ? { action: "raise", to: Math.round((lg.minTo + rnd() * (lg.allInTo - lg.minTo)) * 100) / 100, clamp: true }
          : { action: "all-in" };
        let m = recordOf(t, s, a);
        if (typeof m === "string") {
          // (the smallest raise, typed as it is, is never refused where a raise is allowed)
          if (a.action === "raise" && a.to === lg.minTo && lg.canRaise && lg.minTo > s.cur!.curBet + 1e-9) bug(`smallest raise refused (${m}): ${tag()}`);
          m = recordOf(t, s, { action: lg.toCall > 0 ? "call" : "check" });
          if (typeof m === "string") {
            bug(`call or check refused (${m}): ${tag()}`);
            broke = true;
            break;
          }
        }
        // (the smallest raise, typed as it is, is recorded at that size, not the half big blind above it or all-in)
        const typedMin = a.action === "raise" && a.to === lg.minTo && lg.canRaise && lg.minTo > s.cur!.curBet + 1e-9 && lg.minTo < lg.allInTo - 1e-9;
        if (typedMin && !((m.action === "raise" || m.action === "bet") && C(m.to!) === C(lg.minTo))) {
          bug(`smallest raise ${lg.minTo} recorded as ${JSON.stringify(m)}: ${tag()}`);
        }
        if (typedMin) typedMins++;
        if ((m.action === "bet" || m.action === "raise") && m.to !== undefined) {
          if (!rl.canRaise) bug(`a raise where none is allowed ${JSON.stringify(m)}: ${tag()}`);
          if (C(m.to) < rl.minTo && C(m.to) < rl.allInTo) bug(`a raise under the smallest ${JSON.stringify(m)}: ${tag()}`);
          if (C(m.to) > rl.allInTo) bug(`a raise over the stack ${JSON.stringify(m)}: ${tag()}`);
        }
        if (m.action === "all-in" && rl.allInTo > rl.toCall + ref.bet[m.pos]! && rl.allInTo - ref.curBet < ref.lastFull && rl.allInTo > ref.curBet) shortAllIns++;
        l = withMove(l, s.current!, m);
        try {
          ref.act(m.pos, m.action, m.to !== undefined ? C(m.to) : undefined);
        } catch (e) {
          bug(`the reference refuses ${JSON.stringify(m)} (${(e as Error).message}): ${tag()}`);
          broke = true;
          break;
        }
      }
      if (broke) continue;
      const s = simulate(t, l, shown);
      if (!s.handOver) {
        bug(`the hand didn't end: ${tag()}`);
        continue;
      }
      for (const p of seats) if (C(s.invested[p]!) !== ref.total[p]) bug(`${p} in: table ${s.invested[p]}, reference ${ref.total[p]! / 100}: ${tag()}`);
      const board = d.board.slice(0, shown);
      const live = [...s.active];
      if (live.length > 1) showdowns++;
      const rake = rnd() < 0.3 ? { pct: pick([2.5, 4.75, 5, 10]), ...(rnd() < 0.5 ? { cap: pick([0.5, 1, 3, 5]) } : {}) } : undefined;
      const st = settle(t, s.invested, live, s.allin, board, (p) => d.hands[p]!, rake);
      const inC = seats.reduce((x, p) => x + C(s.invested[p]!), 0);
      const outC = Object.values(st.pays).reduce((x, y) => x + C(y), 0) + C(st.rake);
      if (inC !== outC) bug(`chips: ${inC} in, ${outC} out: ${tag()}`);
      const better = (a: string, b: string) => cmp(rank7([...d.hands[a]!, ...board]), rank7([...d.hands[b]!, ...board]));
      const rp = refPays(players, ref.total, live, better, rake?.pct ?? 0, rake?.cap ? C(rake.cap) : Infinity, board.length >= 3);
      for (const p of seats) if (C(st.pays[p] ?? 0) !== (rp.pays[p] ?? 0)) bug(`${p} wins: table ${st.pays[p] ?? 0}, reference ${(rp.pays[p] ?? 0) / 100}: ${tag()}`);
      if (C(st.rake) !== rp.rake) bug(`rake: table ${st.rake}, reference ${rp.rake / 100}: ${tag()}`);
    }
    expect(bugs).toEqual([]);
    // (the hands reach what's being checked: showdowns with side pots, short all-ins)
    expect(showdowns).toBeGreaterThan(HANDS / 2);
    expect(shortAllIns).toBeGreaterThan(50);
    expect(typedMins).toBeGreaterThan(500);
  });
});
