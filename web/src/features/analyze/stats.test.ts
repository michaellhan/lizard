/// <reference types="node" />
// Your stats as played (stats.ts) on the classic fixtures (solver/tests/data/hh): each stat's chance and whether it
// was taken, read move by move on the table engine; the tally, by seat and by bet size; the 95% interval; the
// count a chunk at a time; and the hands table's filters (analyze.ts filterHands).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { DecisionRecord, HandRecord } from "@/data/db";
import { importHand } from "@/hh/replay";
import { filterHands, filterKey, lostByHand } from "./analyze";
import { handStats, raiseBucket, readStats, RAISE_SIZES, sizeBucket, statsOf, STATS, tallyStats, wilson } from "./stats";

const HH = (f: string) => readFileSync(join(process.cwd(), "..", "solver", "tests", "data", "hh", f), "utf8");
const of = (f: string) => handStats(importHand(HH(f)))!;
const r1 = (x: number) => Math.round(x * 10) / 10;

// No classic fixture has you facing a bet on the river (solver/ takes no new ones), so these are stars_6max_srp from the
// big blind's seat, which faces the $14.50 river bet into a $21.30 pot, as it stands and with its answer changed. You've
// put in $10.40 before the river, so a call puts in $24.90 of a $50.30 pot.
const asBB = HH("stars_6max_srp.txt").replace("Dealt to HeroName [Ah Qd]", "Dealt to OldTAG [Jc Jd]");
const river = (answer: string, end: string) => asBB.slice(0, asBB.indexOf("OldTAG: folds\nUncalled")) + `${answer}\n${end}\n*** SUMMARY ***\nTotal pot $50.30 | Rake $0.40\nBoard [Qs 8d 3c 7h 2s]\n`;
const showdown = (who: string) => `*** SHOW DOWN ***\nHeroName: shows [Ah Qd] (a pair of Queens)\nOldTAG: shows [Jc Jd] (a pair of Jacks)\n${who} collected $49.90 from pot`;
const stats = (text: string) => handStats(importHand(text), undefined, text)!;

describe("stats", () => {
  it("counts nothing of a preflop played for you, and what you did from the flop", () => {
    const hand = importHand(HH("stars_6max_srp.txt"));
    const own = handStats(hand)!;
    const drawn = handStats(hand, "preflop")!;
    const { vpip, pfr, rfi, ...rest } = own.at;
    expect([vpip, pfr, rfi]).toEqual([true, true, true]);
    expect(drawn.at).toEqual(rest);
    expect(drawn).not.toHaveProperty("rfiPos");
    expect(drawn.bets).toEqual(own.bets);
    // a raise you didn't choose is one all the same: the c-bet after it is yours
    expect(drawn.at.cbet).toBe(true);
  });

  it("reads each stat's chance and what you did in a hand", () => {
    // BTN opens, c-bets 1.8 into 5.5, barrels turn and river; the big blind folds the river
    const srp = of("stars_6max_srp.txt");
    expect(srp.at).toEqual({ vpip: true, pfr: true, rfi: true, cbet: true, turnbarrel: true, riverbarrel: true, wtsd: false });
    expect(srp.rfiPos).toBe("BTN");
    expect(srp.bets.map((b) => [b.street, r1(b.pct)])).toEqual([["flop", 32.7], ["turn", 67], ["river", 68.1]]);
    // the big blind checks a limped pot (not voluntary), then check-raises the flop and bets the turn
    expect(of("gg_limped_multiway.txt").at).toEqual({ vpip: false, pfr: false, xr: true, wtsd: false });
    // the small blind cold 4-bets: no 3-bet chance (it faced two raises), then calls the jam
    expect(of("gg_allin_preflop.txt").at).toEqual({ vpip: true, pfr: true, fourbet: true, wtsd: true });
    // UTG opens, calls the 3-bet (not a fold, not a 4-bet), calls the c-bet after checking, folds the turn
    expect(of("stars_zoom_names.txt").at).toEqual({ vpip: true, pfr: true, rfi: true, fold3bet: false, fourbet: false, foldcbet: false, xr: false, wtsd: false });
    // CO calls an open, then the opener's c-bet, bets the turn when checked to and checks the river down
    const mtt = of("stars_9max_mtt_ante.txt");
    expect(mtt.at).toEqual({ vpip: true, pfr: false, threebet: false, foldcbet: false, wtsd: true });
    expect(mtt.bets.map((b) => [b.street, r1(b.pct)])).toEqual([["turn", 41.7]]);
    // the big blind 3-bets a straddled pot: its c-bet is sized against the straddle's pot
    const st = of("gg_straddle.txt");
    expect(st.at).toMatchObject({ threebet: true, cbet: true, turnbarrel: false });
    expect(r1(st.bets[0]!.pct)).toBe(32.1);
    // a call of an all-in is a call, not a raise
    expect(of("ignition_mtt_allin.txt").at).toEqual({ vpip: true, pfr: false, threebet: false, wtsd: true });
  });

  it("tallies the hands: rates over their chances, RFI by seat in seat order, bet sizes, hands left out", () => {
    const list = ["stars_6max_srp.txt", "stars_zoom_names.txt", "gg_all_cards_shown.txt", "stars_3bet_pot.txt"].map((f) => ({ id: f, s: of(f) }));
    const t = tallyStats([...list, { id: "broken", s: null }]);
    expect([t.hands, t.left]).toEqual([4, 1]);
    expect([t.by.vpip.k, t.by.vpip.n, t.by.rfi.k, t.by.rfi.n, t.by.cbet.k, t.by.cbet.n]).toEqual([4, 4, 3, 3, 3, 3]);
    expect(t.rfi.map((r) => [r.pos, r.c.n])).toEqual([["UTG", 1], ["BTN", 1], ["SB", 1]]);
    expect(t.by.threebet.yes).toEqual(["stars_3bet_pot.txt"]);
    // every stat by your seat, in seat order, each seat's over its own chances
    expect(t.seats.map((s) => s.pos)).toEqual(t.seats.map((s) => s.pos).sort((a, b) => ["UTG", "UTG1", "UTG2", "LJ", "HJ", "CO", "BTN", "SB", "BB"].indexOf(a) - ["UTG", "UTG1", "UTG2", "LJ", "HJ", "CO", "BTN", "SB", "BB"].indexOf(b)));
    expect(t.seats.reduce((n, s) => n + s.hands, 0)).toBe(4);
    expect(t.seats.reduce((n, s) => n + s.by.vpip.n, 0)).toBe(t.by.vpip.n);
    expect(t.seats.find((s) => s.pos === "UTG")?.by.rfi).toMatchObject({ n: 1 });
    // (UTG in the zoom hand checks the flop: three flop bets, each about a third of the pot)
    expect(t.sizes.flop).toEqual([0, 3, 0, 0, 0, 0]);
    expect([sizeBucket(29.9), sizeBucket(30), sizeBucket(110), sizeBucket(400)]).toEqual([0, 1, 5, 5]);
  });

  it("counts a river call over the first bet you faced there, and a win only where the history says what you won", () => {
    // a fold: the chance is taken up by nothing, and there's no call to have won
    const fold = stats(asBB);
    expect(fold.at.rivercall).toBe(false);
    expect(fold.at).not.toHaveProperty("rivercallwon");
    // a call that loses $24.90, and the same call that collects $49.90
    const lost = stats(river("OldTAG: calls $14.50", showdown("HeroName")));
    expect([lost.at.rivercall, lost.at.rivercallwon]).toEqual([true, false]);
    const won = stats(river("OldTAG: calls $14.50", showdown("OldTAG")));
    expect([won.at.rivercall, won.at.rivercallwon]).toEqual([true, true]);
    // a check-raise is a chance not taken as a call
    const raised = stats(river("OldTAG: raises $20 to $34.50", "HeroName: folds\nUncalled bet ($20) returned to OldTAG\nOldTAG collected $49.90 from pot"));
    expect(raised.at.rivercall).toBe(false);
    expect(raised.at).not.toHaveProperty("rivercallwon");
    // you bet the river yourself, or it checked through: no chance at all
    expect(of("stars_6max_srp.txt").at).not.toHaveProperty("rivercall");
    expect(of("stars_9max_mtt_ante.txt").at).not.toHaveProperty("rivercall");
    // the hand's text is what says the money: without it the call counts, a win doesn't
    const blind = handStats(importHand(river("OldTAG: calls $14.50", showdown("OldTAG"))))!;
    expect(blind.at.rivercall).toBe(true);
    expect(blind.at).not.toHaveProperty("rivercallwon");
    // the tally's denominators: 3 chances, 2 calls, and 1 of the calls ahead
    const t = tallyStats([{ id: "f", s: fold }, { id: "l", s: lost }, { id: "w", s: won }]);
    expect([t.by.rivercall.k, t.by.rivercall.n, t.by.rivercallwon.k, t.by.rivercallwon.n]).toEqual([2, 3, 1, 2]);
    expect(t.by.rivercall.yes).toEqual(["l", "w"]);
    expect(STATS.find((x) => x.key === "rivercall")).toMatchObject({ chance: "when you faced the first bet on the river", took: "you called" });
  });

  it("reads each of your moves' sizes from the history, worked by hand from the fixtures", () => {
    const moves = (f: string) => of(f).moves;
    const fact = (f: string, street: string, i: number) => moves(f).find((m) => m.street === street && m.i === i)!;
    // you open to 2.5 at $1: 2.5×, then a flop bet of $1.80 into $5.50
    expect(fact("stars_6max_srp.txt", "preflop", 3)).toMatchObject({ raiseX: 2.5 });
    expect(fact("stars_6max_srp.txt", "preflop", 3).faced).toBeUndefined();
    expect(r1(fact("stars_6max_srp.txt", "flop", 1).betPct!)).toBe(32.7);
    // $5 raised to $22 at $2: you faced 2.5bb and raised 4.4×; the $44 raise after your $14 into $45 is 44/59, and the
    // $134 turn all-in is 134/133
    const pot3 = moves("stars_3bet_pot.txt");
    expect(pot3[0]).toMatchObject({ street: "preflop", faced: 2.5, raiseX: 4.4 });
    expect(r1(fact("stars_3bet_pot.txt", "flop", 2).faced!)).toBe(74.6);
    expect(r1(fact("stars_3bet_pot.txt", "turn", 2).faced!)).toBe(100.8);
    // $0.20 into $0.40 faced, raised to $1.05: 5.25×
    expect(fact("gg_limped_multiway.txt", "flop", 5)).toMatchObject({ faced: 50, raiseX: 5.25 });
    // a check has neither
    const check = fact("stars_9max_mtt_ante.txt", "river", 1);
    expect([check.faced, check.betPct, check.raiseX]).toEqual([undefined, undefined, undefined]);
    // your stack at the start against the deepest opponent still in
    expect([of("stars_6max_srp.txt").eff, of("stars_9max_mtt_ante.txt").eff, of("ignition_mtt_allin.txt").eff]).toEqual([100, 80, 25]);
  });

  it("tallies the raises by street and leaves out a preflop you didn't choose", () => {
    expect(RAISE_SIZES.map((_, i) => i)).toEqual([0, 1, 2, 3, 4]);
    expect([raiseBucket(2.49), raiseBucket(2.5), raiseBucket(3), raiseBucket(4), raiseBucket(6), raiseBucket(40)]).toEqual([0, 1, 2, 3, 4, 4]);
    const srp = importHand(HH("stars_6max_srp.txt"));
    expect(handStats(srp)!.raises.map((b) => [b.street, b.x])).toEqual([["preflop", 2.5]]);
    expect(handStats(srp, "preflop")!.raises).toEqual([]);
    const t = tallyStats(["stars_6max_srp.txt", "stars_3bet_pot.txt", "gg_limped_multiway.txt", "gg_allin_preflop.txt"].map((f) => ({ id: f, s: of(f) })));
    // 2.5× and 2.4×, 4.4×, and the flop's 5.25×
    expect(t.raises.preflop).toEqual([1, 1, 0, 1, 0]);
    expect(t.raises.flop).toEqual([0, 0, 0, 1, 0]);
  });

  it("gives each hand's stats once, for the breakdowns and the stats to share a pass", async () => {
    const hands = [{ id: "rs1", text: HH("stars_6max_srp.txt") }, { id: "rs2", text: "not a hand" }] as HandRecord[];
    const list = await readStats(hands);
    expect(list!.map((x) => [x.id, x.s === null])).toEqual([["rs1", false], ["rs2", true]]);
    const again = await readStats(hands);
    expect(again![0]!.s).toBe(list![0]!.s);
  });

  it("gives a 95% interval that is wide on a small sample", () => {
    expect(wilson(0, 0)).toEqual([0, 1]);
    expect(wilson(5, 10).map((x) => Math.round(x * 1000) / 1000)).toEqual([0.237, 0.763]);
    expect(wilson(50, 100).map((x) => Math.round(x * 1000) / 1000)).toEqual([0.404, 0.596]);
    expect(wilson(0, 20)[0]).toBe(0);
    expect(wilson(20, 20)[1]).toBeCloseTo(1, 12);
  });

  it("counts a chunk at a time, says how far it got, and stops on the signal", async () => {
    const hand = (id: string, f: string) => ({ id, text: HH(f) }) as HandRecord;
    const hands = [hand("c1", "stars_6max_srp.txt"), hand("c2", "stars_3bet_pot.txt"), hand("c3", "gg_straddle.txt"), { id: "c4", text: "not a hand" } as HandRecord];
    const seen: number[] = [];
    const s = await statsOf(hands, { chunk: 2, onProgress: (n) => seen.push(n) });
    expect(seen).toEqual([2, 4]);
    expect([s!.hands, s!.left, s!.by.cbet.n]).toEqual([3, 1, 3]);
    // counted once: asked again, nothing is read
    const again: number[] = [];
    await statsOf(hands, { chunk: 1, onProgress: (n) => again.push(n) });
    expect(again).toEqual([]);
    const ac = new AbortController();
    ac.abort();
    expect(await statsOf([hand("c5", "stars_heads_up.txt")], { chunk: 1, signal: ac.signal })).toBeNull();
  });

  it("filters the hands by seat, pot, site, stakes, the days played, your tags and a search", () => {
    const h = (id: string, o: Partial<HandRecord>) => ({ id, hero: "BTN", potType: "SRP", site: "PokerStars", bb: "$1", played: "2024-03-02 21:14", ...o }) as HandRecord;
    const hands = [h("a", {}), h("b", { hero: "BB", bb: "300 chips", played: "2024-05-01 08:00" }), h("c", { played: "" }), h("d", { site: "GGPoker", potType: "3bet pot" })];
    const ids = (q: string) => filterHands(hands, new URLSearchParams(q)).map((x) => x.id);
    expect(ids("")).toEqual(["a", "b", "c", "d"]);
    expect(ids("pos=BB")).toEqual(["b"]);
    expect(ids("bb=%241")).toEqual(["a", "c", "d"]);
    expect(ids("from=2024-03-02&to=2024-03-02")).toEqual(["a", "d"]);
    expect(ids("from=2024-04-01")).toEqual(["b"]);
    expect(ids("site=GGPoker&pot=3bet+pot")).toEqual(["d"]);
    // your tags, and a search over every word: cards, number, tags, notes
    hands[1]!.tags = ["bluff", "review"];
    hands[2]!.note = "Villain snap-called";
    hands[3]!.hole = "KsKh";
    expect(ids("tag=review")).toEqual(["b"]);
    expect(ids("tag=revi")).toEqual([]);
    expect(ids("q=REVIEW")).toEqual(["b"]);
    expect(ids("q=snap")).toEqual(["c"]);
    expect(ids("q=KsKh+ggpoker")).toEqual(["d"]);
    expect(ids("q=KsKh+stars")).toEqual([]);
    // the EV your graded decisions gave up in the hand: summed, at least so many bb (frequency grades have none)
    const d = (handId: string, evLossBb: number | null) => ({ handId, evLossBb }) as DecisionRecord;
    const lost = lostByHand([d("a", 0.4), d("a", 0.7), d("b", 0.5), d("c", null), d("d", 0), d("d", 2)]);
    expect([...lost]).toEqual([
      ["a", 1.1],
      ["b", 0.5],
      ["d", 2],
    ]);
    // the preflop solve's EV is of another model: a hand stands at the larger kind, never the two added
    const pf = (handId: string, evLossBb: number) => ({ handId, evLossBb, source: "preflop-solve" }) as DecisionRecord;
    expect([...lostByHand([d("a", 1), pf("a", 0.4), pf("a", 0.3), pf("b", 2), d("b", 0.5), pf("c", 3)])]).toEqual([
      ["a", 1],
      ["b", 2],
      ["c", 3],
    ]);
    const byLost = (q: string) => filterHands(hands, new URLSearchParams(q), lost).map((x) => x.id);
    expect(byLost("lost=0.5")).toEqual(["a", "b", "d"]);
    expect(byLost("lost=1")).toEqual(["a", "d"]);
    expect(byLost("lost=2&pos=BTN")).toEqual(["d"]);
    expect(byLost("lost=5")).toEqual([]);
  });

  it("applies date range, site and stakes together, and a filter's key ignores what isn't a filter", () => {
    const h = (id: string, o: Partial<HandRecord>) => ({ id, hero: "BTN", potType: "SRP", site: "PokerStars", bb: "$1", played: "2024-03-02 21:14", ...o }) as HandRecord;
    const hands = [h("a", {}), h("b", { site: "GGPoker" }), h("c", { bb: "$2" }), h("d", { played: "2024-04-02 09:00" }), h("e", { played: "" })];
    const ids = (q: string) => filterHands(hands, new URLSearchParams(q)).map((x) => x.id);
    expect(ids("site=PokerStars&bb=%241&from=2024-03-01&to=2024-03-31")).toEqual(["a"]);
    // an undated hand can't be placed in a range, so a range leaves it out
    expect(ids("site=PokerStars&bb=%241")).toEqual(["a", "d", "e"]);
    expect(ids("site=GGPoker&bb=%242")).toEqual([]);
    expect(ids("from=2024-05-01&to=2024-04-01")).toEqual([]);
    const key = (q: string, without?: "sess") => filterKey(new URLSearchParams(q), without);
    expect(key("site=A&hand=h1&tab=stats&drill=pf%3ARFI")).toBe("site=A");
    expect(key("bb=%241&site=A")).toBe(key("site=A&bb=%241&hand=h9"));
    expect(key("")).toBe("");
    expect(key("site=A&sess=x", "sess")).toBe("site=A");
  });
});
