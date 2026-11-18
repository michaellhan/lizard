// Practice's records of a hand against the hand as the table played it, over seeded sessions with short and carried
// stacks, antes, the straddle, the rake and every kind of opponent: the hand history read back by Analyze's importer
// (the same chips in from each seat, the same stacks, a short blind written as the all-in it is), Review's retry story
// (the pot as the street began and a call's price no more than your stack, as the table has them), and Review's line
// before your decision ("first to act" with nobody before you, "folded to you" with only folds).
import { describe, expect, it } from "vitest";
import { retryStory } from "@/features/review/retryStory";
import { importHand } from "@/hh/replay";
import { seatsOf } from "@/poker/seats";
import { legal, noLines, seeded, simulate, toCallOf, type Sim } from "@/poker/table";
import type { AdvisorResponse } from "@/solver/protocol";
import { moveOf } from "./flow";
import { practiceHistory } from "./history";
import type { OppMove } from "./live";
import { dealNext, decide, finish, following, newHand, phaseOf, setupOf, simOf, withVillain, type Decision, type PracticeHand, type SessionOptions } from "./practice";
import { reviewed } from "./review";

const SESSIONS = 250;
const C = (x: number) => Math.round(x * 100);

describe("a hand's records against the table", () => {
  it(`agree over ${SESSIONS} seeded sessions`, () => {
    const rnd = seeded(7);
    const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)]!;
    const bugs: string[] = [];
    const bug = (what: string) => bugs.length < 10 && bugs.push(what);
    let stories = 0;
    const lines = { first: 0, folded: 0, words: 0 };

    // an opponent's answer: fold, call, raise or jam facing a bet, else check, bet or jam
    const opp = (sim: Sim, seat: string): OppMove => {
      const cur = sim.cur!;
      const toCall = cur.curBet - cur.bets[seat]!;
      const r = rnd();
      const raiseTo = sim.current === "preflop" ? (cur.nRaises ? cur.curBet * 3 : 2.5) : Math.round((cur.curBet * 2.5 + sim.pot * 0.5) * 100) / 100;
      const betTo = Math.round(sim.pot * (rnd() < 0.5 ? 0.33 : 0.75) * 100) / 100;
      const actions = (toCall > 0 ? [{ action: "fold" }, { action: "call" }, { action: `raise ${raiseTo}`, amount_bb: raiseTo }] : [{ action: "check" }, { action: "bet 33%", amount_bb: betTo }]) as OppMove["actions"];
      if (toCall > 0) return r < 0.3 ? { action: "fold", actions } : r < 0.85 ? { action: "call", actions } : r < 0.95 ? { action: "raise", to: raiseTo, actions } : { action: "all-in", actions };
      return r < 0.6 ? { action: "check", actions } : r < 0.95 ? { action: "bet", to: betTo, actions } : { action: "all-in", actions };
    };
    // a made-up answer at your spot: fold facing a bet, check or call, a raise, all-in
    const answerAt = (h: PracticeHand, sim: Sim): AdvisorResponse => {
      const lg = legal(setupOf(h), sim)!;
      const acts: Record<string, unknown>[] = [];
      if (lg.toCall > 0) acts.push({ action: "fold", freq: 0.2, ev_bb: 0 });
      acts.push({ action: lg.toCall > 0 ? "call" : "check", freq: 0.5, ev_bb: 0.1 });
      if (lg.canRaise) {
        const a = Math.round(Math.max(lg.minTo, sim.pot * 0.5 + sim.cur!.curBet) * 2) / 2;
        if (a < lg.allInTo) acts.push({ action: `${sim.cur!.curBet > 0 ? "raise" : "bet"} ${a}`, freq: 0.2, amount_bb: a, ev_bb: 0.2 });
        acts.push({ action: "all-in", freq: 0.1, ev_bb: -1 });
      }
      return { actions: acts, pot_bb: Math.round(sim.pot * 100) / 100 } as unknown as AdvisorResponse;
    };

    for (let sn = 0; sn < SESSIONS && bugs.length < 10; sn++) {
      const players = 2 + Math.floor(rnd() * 8);
      const stack = pick([10, 15, 20, 40, 100, 100, 200]);
      const opts: SessionOptions = {
        seat: "moves",
        preflopOnly: false,
        pot: null,
        ante: rnd() < 0.3 ? pick([0.1, 0.12, 0.25, 0.5, 1]) : 0,
        straddle: players >= 3 && rnd() < 0.15,
        carry: rnd() < 0.5,
        sizes: null,
        rake: rnd() < 0.25 ? pick([2.5, 5]) : 0,
        rakeCap: 0,
        opponents: pick(["gto", "live", "loose"] as const),
      };
      let h = newHand(players, stack, 0, 100 + sn * 10, opts);
      for (let hn = 0; hn < 6; hn++) {
        const tag = () => `session ${sn} hand ${hn} ${JSON.stringify(setupOf(h))} hero ${h.hero} ${JSON.stringify(h.lines)}`;
        const decided: { d: Decision; before: PracticeHand; pot: number; toCall: number }[] = [];
        for (let step = 0; step < 300; step++) {
          const sim = simOf(h);
          const ph = phaseOf(h, sim);
          if (ph.kind === "over") {
            if (!h.result) h = { ...h, result: finish(h, sim) };
            break;
          }
          if (ph.kind === "deal") {
            h = dealNext(h, ph.street);
            continue;
          }
          if (ph.kind === "hero") {
            const res = answerAt(h, sim);
            const r = decide(h, res, Math.floor(rnd() * res.actions!.length), null, sim);
            if ("error" in r) throw new Error(`${r.error}: ${tag()}`);
            // the street's pot as it began (preflop, the blinds and antes before anyone acted) and the price of a call
            const blinds = sim.current === "preflop" ? Object.values(simulate(setupOf(h), noLines(), 0).cur?.bets ?? {}).reduce((a, b) => a + b, 0) : 0;
            const pot = Object.values(sim.invested).reduce((a, b) => a + b, 0) + blinds;
            decided.push({ d: r.decision, before: h, pot, toCall: toCallOf(setupOf(h), sim, h.hero) });
            h = r.hand;
            continue;
          }
          const { move } = moveOf(h, opp(sim, ph.seat), sim);
          h = withVillain(h, move, sim);
        }
        const sim = simOf(h);
        const t = setupOf(h);
        // the hand history, read back
        const text = practiceHistory(h, 1700000000000, new Date(2026, 0, 1));
        const rep = importHand(text);
        if (rep.stopped) bug(`the history stops: ${rep.warnings.join(" | ")}: ${tag()}`);
        else {
          const rs = simulate(rep.setup, rep.lines, rep.hand.board.length);
          for (const p of seatsOf(players)) {
            if (C(rs.invested[p]! + (rs.cur?.bets[p] ?? 0)) !== C(sim.invested[p]! + (sim.cur?.bets[p] ?? 0))) bug(`${p}'s chips in differ read back: ${tag()}\n${text}`);
            if (Math.abs((rep.setup.stacks[p] ?? 0) - t.stacks[p]!) > 0.005) bug(`${p}'s stack differs read back: ${tag()}`);
          }
          if ([...rs.active].sort().join() !== [...sim.active].sort().join()) bug(`the players left differ read back: ${tag()}`);
        }
        for (const [p, blind, what] of [["SB", 0.5, "small blind"], ["BB", 1, "big blind"]] as const) {
          const had = Math.round((t.stacks[p]! - Math.min(t.ante ?? 0, t.stacks[p]!)) * 100) / 100;
          if (had > 0 && had < blind) {
            if (!new RegExp(`: posts ${what} ${had} and is all-in$`, "m").test(text)) bug(`${p} with ${had} behind isn't written as all-in on its blind: ${tag()}\n${text}`);
          }
        }
        // each decision: the retry story and Review's line
        for (const { d, before, pot, toCall } of decided) {
          const st = retryStory({ study: d.study, street: d.street, seat: before.hero, players: before.players });
          if (st) {
            stories++;
            if (Math.abs(st.now.pot - pot) > 0.011) bug(`retry pot ${st.now.pot}, the table's ${pot}: ${tag()}`);
            if (Math.abs(st.now.toCall - toCall) > 0.011) bug(`retry price ${st.now.toCall}, the table's ${toCall}: ${tag()}`);
          }
          const on = before.lines[d.street];
          const line = reviewed(before, d, 1).line;
          const want = !on.length ? "first to act" : on.every((m) => m.action === "fold") ? "folded to you" : null;
          if (want === "first to act") lines.first++;
          else if (want) lines.folded++;
          else lines.words++;
          if (want ? line !== want : /^(first to act|folded to you)$/.test(line)) bug(`Review says "${line}", want ${want ?? "the action"}: ${tag()}`);
        }
        h = following(h, 100 + sn * 10 + hn + 1, opts);
      }
    }
    expect(bugs).toEqual([]);
    // (the sessions reach what's checked)
    expect(stories).toBeGreaterThan(1000);
    expect(Math.min(lines.first, lines.folded, lines.words)).toBeGreaterThan(30);
  });

  // (every seat checks or calls to the end; the history written and read back)
  const roundTrip = (start: PracticeHand) => {
    let h = start;
    for (let step = 0; step < 40; step++) {
      const sim = simOf(h);
      const ph = phaseOf(h, sim);
      if (ph.kind === "over") break;
      if (ph.kind === "deal") h = dealNext(h, ph.street);
      else h = withVillain(h, { pos: sim.toAct!, action: sim.cur!.curBet - sim.cur!.bets[sim.toAct!]! > 0 ? "call" : "check" }, sim);
    }
    h = { ...h, result: finish(h) };
    const text = practiceHistory(h, 1700000000000, new Date(2026, 0, 1));
    const rep = importHand(text);
    const rs = simulate(rep.setup, rep.lines, rep.hand.board.length);
    const inC = (sim: Sim) => Object.fromEntries(Object.entries(sim.invested).map(([p, x]) => [p, C(x)]));
    return { text, rep, read: inC(rs), table: inC(simOf(h)) };
  };

  it("writes a blind its seat can't cover as the all-in it is, and reads it back", () => {
    // (after a 0.1bb ante, the small blind has 0.2bb and the big blind 0.5bb: both all-in on their blinds)
    const { text, rep, read, table } = roundTrip({ ...newHand(3, 100, 0, 11, { ante: 0.1 }), stacks: { BTN: 100, SB: 0.3, BB: 0.6 } });
    expect(text).toMatch(/: posts small blind 0\.2 and is all-in$/m);
    expect(text).toMatch(/: posts big blind 0\.5 and is all-in$/m);
    expect(rep.stopped).toBeNull();
    expect(rep.warnings).toEqual([]);
    expect(read).toEqual(table);
  });

  it("writes a short straddle as posted, and reads the hand back as straddled", () => {
    // (a carried 10bb game with a 0.75bb ante: the straddling CO has 2.6bb, 1.85bb after its ante)
    const game = { ante: 0.75, straddle: true, carry: true, seat: "moves" as const };
    const short = roundTrip(newHand(4, 10, 1, 6, game, { stacks: { CO: 2.6, BTN: 10, SB: 10, BB: 10 }, rebuys: [] }));
    expect(short.text).toMatch(/: posts straddle 1\.85 and is all-in$/m);
    expect(short.rep.hand.straddle).toBe(true);
    expect([short.rep.stopped, short.rep.warnings]).toEqual([null, []]);
    expect(short.read).toEqual(short.table);
    // (with no more than its ante, the CO straddles nothing, all-in; the hand is still the straddled one the table played)
    const none = roundTrip(newHand(4, 10, 1, 6, game, { stacks: { CO: 0.75, BTN: 10, SB: 10, BB: 10 }, rebuys: [] }));
    expect(none.text).toMatch(/: posts straddle 0 and is all-in$/m);
    expect(none.rep.hand.straddle).toBe(true);
    expect([none.rep.stopped, none.rep.warnings]).toEqual([null, []]);
    expect(none.read).toEqual(none.table);
  });

  it("reads back a blind posted all-in under an uneven ante", () => {
    // (BTN has less than the 0.1bb ante, so the history's ante averages to 0.0875bb, and SB is all-in on its blind)
    const { rep, read, table } = roundTrip({ ...newHand(4, 100, 0, 3, { ante: 0.1 }), stacks: { CO: 214.48, BTN: 0.05, SB: 0.6, BB: 23.67 } });
    expect(rep.hand.ante).toBe(0.0875);
    expect(rep.stopped).toBeNull();
    // (the pot is the table's; each seat's chips in differ only by its ante's difference from the average, 0.0375bb at most)
    const total = (x: Record<string, number>) => Object.values(x).reduce((a, b) => a + b, 0);
    expect(Math.abs(total(read) - total(table))).toBeLessThanOrEqual(1);
    for (const p of Object.keys(table)) expect(Math.abs(read[p]! - table[p]!), p).toBeLessThanOrEqual(4);
  });
});
