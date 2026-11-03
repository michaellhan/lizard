/// <reference types="node" />
// Your stats as played (stats.ts) on the classic fixtures (solver/tests/data/hh): each stat's chance and whether it
// was taken, read move by move on the table engine; the tally, by seat and by bet size; the 95% interval; the
// count a chunk at a time; and the hands table's filters (analyze.ts filterHands).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { HandRecord } from "@/data/db";
import { importHand } from "@/hh/replay";
import { filterHands } from "./analyze";
import { handStats, sizeBucket, statsOf, tallyStats, wilson } from "./stats";

const HH = (f: string) => readFileSync(join(process.cwd(), "..", "solver", "tests", "data", "hh", f), "utf8");
const of = (f: string) => handStats(importHand(HH(f)))!;
const r1 = (x: number) => Math.round(x * 10) / 10;

describe("stats", () => {
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
    // (UTG in the zoom hand checks the flop: three flop bets, each about a third of the pot)
    expect(t.sizes.flop).toEqual([0, 3, 0, 0, 0, 0]);
    expect([sizeBucket(29.9), sizeBucket(30), sizeBucket(110), sizeBucket(400)]).toEqual([0, 1, 5, 5]);
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
  });
});
