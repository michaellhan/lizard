/// <reference types="node" />
// The winnings reader on the classic fixtures (solver/tests/data/hh): every site's winnings line, each seat's stake as
// the history has it, and the seats' results adding up to minus the rake.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseHandHistory } from "./parse";
import { finalSim, importHand } from "./replay";
import { collected, paidOf, resultOf } from "./results";

const HH_DIR = join(process.cwd(), "..", "solver", "tests", "data", "hh");
const HH = (f: string) => readFileSync(join(HH_DIR, f), "utf8");
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

// the hero's result in each fixture, bb; null where the history can't say
const HERO: Record<string, number | null> = {
  "888_6max_srp.txt": 10.5,
  "888_9max_mtt_ante.txt": 12.7,
  "acr_9max_mtt_ante.txt": 12.7,
  "acr_run_twice.txt": -0.75,
  "gg_all_cards_shown.txt": null,
  "gg_allin_preflop.txt": 100.5,
  "gg_limped_multiway.txt": 13.3,
  "gg_run_twice_cashout.txt": null,
  "gg_straddle.txt": -43.5,
  "ignition_6max_srp.txt": 10.5,
  "ignition_mtt_allin.txt": -25,
  "ipoker_3bet_pot.xml": -100,
  "party_6max_allin.txt": 100.5,
  "party_mtt_bounty_allin.txt": -25,
  "stars_3bet_pot.txt": -100,
  "stars_6max_srp.txt": 10.5,
  "stars_9max_mtt_ante.txt": 12.7,
  "stars_bounty_allin.txt": -25,
  "stars_heads_up.txt": 14.1,
  "stars_run_twice.txt": -0.75,
  "stars_zoom_names.txt": -15,
  "winamax_3bet_pot.txt": -100,
  "winamax_mtt_ante.txt": 12.7,
};
// the same hands' rake, bb (the GG fixtures' written pots don't add up to their bets, so they're left out of the sum)
const RAKE: Record<string, number> = {
  "888_6max_srp.txt": 0.4, "888_9max_mtt_ante.txt": 0, "acr_9max_mtt_ante.txt": 0, "acr_run_twice.txt": 3, "ignition_6max_srp.txt": 0.4,
  "ignition_mtt_allin.txt": 0, "ipoker_3bet_pot.xml": 1.75, "party_mtt_bounty_allin.txt": 0, "stars_3bet_pot.txt": 1.75,
  "stars_6max_srp.txt": 0.4, "stars_9max_mtt_ante.txt": 0, "stars_bounty_allin.txt": 0, "stars_heads_up.txt": 0.9, "stars_run_twice.txt": 3,
  "stars_zoom_names.txt": 0.8, "winamax_3bet_pot.txt": 1.75, "winamax_mtt_ante.txt": 0,
};

describe("realized results", () => {
  it("reads the hero's result from every fixture", () => {
    const files = readdirSync(HH_DIR).sort();
    expect(files).toEqual(Object.keys(HERO).sort());
    for (const f of files) {
      const text = HH(f);
      const r = resultOf(parseHandHistory(text), text);
      expect(r.net, f).toBe(HERO[f]);
      if (r.net == null) expect(r.why, f).toBe(f.includes("cashout") ? "cashout" : "unread");
    }
  });

  it("adds every seat up to minus the rake", () => {
    for (const [f, rake] of Object.entries(RAKE)) {
      const text = HH(f);
      const h = parseHandHistory(text);
      expect(sum(h.seats.map((s) => resultOf(h, text, s.pos).net!)), f).toBeCloseTo(-rake, 6);
    }
  });

  it("takes the stakes as posted, where the replay plays them otherwise", () => {
    for (const f of Object.keys(RAKE)) {
      const text = HH(f);
      const r = importHand(text);
      const paid = paidOf(r.hand, text);
      const inv = finalSim(r).invested;
      // the page plays a half-big-blind small blind; Zoom's $0.02/$0.05 posts 0.4bb
      for (const s of r.hand.seats) expect(paid[s.pos], `${f} ${s.pos}`).toBeCloseTo(f === "stars_zoom_names.txt" && s.pos === "SB" ? 0.4 : inv[s.pos]!, 6);
    }
    // a big-blind ante: the page takes the average from everyone, the history only from the big blind
    const t = HH("stars_9max_mtt_ante.txt").replace(/^.*posts the ante 30\n/gm, "").replace("BB_defender: posts big blind 300", "BB_defender: posts the ante 270\nBB_defender: posts big blind 300");
    const h = parseHandHistory(t);
    expect(resultOf(h, t).net).toBeCloseTo(12.8, 6);
    expect(resultOf(h, t, "BB").net).toBeCloseTo(-3.1, 6);
    expect(sum(h.seats.map((s) => resultOf(h, t, s.pos).net!))).toBeCloseTo(0, 6);
    // a dead blind posted to come in: its dead half is lost with the hand, its live half is a call
    const d = HH("stars_6max_srp.txt").replace("snowman_9: posts small blind", "kroko77: posts small & big blinds $1.50\nsnowman_9: posts small blind");
    const dh = parseHandHistory(d);
    expect(paidOf(dh, d)[dh.seats.find((s) => s.name === "kroko77")!.pos]).toBeCloseTo(1.5, 6);
  });

  it("knows a fold collected nothing, with or without a winnings line", () => {
    // the straddled pot you folded on the turn, cut off at your fold as Practice writes a hand it didn't play out
    const t = HH("gg_straddle.txt").replace(/^0d0e0f10 collected.*\n/m, "");
    expect(resultOf(parseHandHistory(t), t).net).toBe(-43.5);
    // and a hand that stops where you didn't fold says nothing
    const u = HH("stars_6max_srp.txt").replace(/^HeroName collected.*\n/m, "");
    expect(resultOf(parseHandHistory(u), u)).toEqual({ net: null, why: "unread" });
  });

  it("reads each site's winnings line", () => {
    expect(collected("Hero: The Man collected $1.53 from pot\nHero collected $2 from pot", "Hero")).toBe(2);
    expect(collected("a collected $1 from main pot 1\nb collected $1 from main pot 2\nb collected $0.50 from side pot", "b")).toBe(1.5);
    expect(collected("HeroName collected [ $1,020.90 ]", "HeroName")).toBe(1020.9);
    expect(collected("Hero wins $100.25 USD from the main pot with a flush.\nHero wins $3 USD from the side pot #1", "Hero")).toBe(103.25);
    expect(collected("alpha balance 5086, bet 2500, collected 5086, net +2586\nHero balance 2500, lost 2500", "Hero")).toBe(0);
    expect(collected("Dealer [ME] : Hand result $20.90\nDealer [ME] : Hand result-Side pot $4", "Dealer [ME]")).toBe(24.9);
    expect(collected("Hero: folds\n*** SUMMARY ***", "Hero")).toBeNull();
  });
});
