/// <reference types="node" />
// Analyze's core on the classic fixtures (solver/tests/data/hh) and synthetic sessions (solver/tests/js/hh_synth.js):
// the classic session.test.js cases for splitting, hand numbers, prepare's skips and preflop situations, plus the
// dates, summaries and Study lines Lizard adds.
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseHandHistory, splitHands } from "@/hh/parse";
import { importHand } from "@/hh/replay";
import type { Move } from "@/poker/table";
import { fromSearch } from "@/features/study/studyState";
import { filesName, handNumber, heroDecisions, hhFiles, playedOf, preflopSituation, prepare, recordOf, studyHandAt, studyLinkAt } from "./analyze";

const SOLVER = join(process.cwd(), "..", "solver");
const HH_DIR = join(SOLVER, "tests", "data", "hh");
const FILES = readdirSync(HH_DIR).sort();
const TXT = FILES.filter((f) => f.endsWith(".txt"));
const HH = (f: string) => readFileSync(join(HH_DIR, f), "utf8");
const { synthSession } = createRequire(join(process.cwd(), "package.json"))(join(SOLVER, "tests", "js", "hh_synth.js")) as {
  synthSession: (n: number, seed: number) => string;
};
const IMP = { id: "imp1", name: "test.txt", at: 1000 };
const twoIpoker = () => {
  const x = HH("ipoker_3bet_pot.xml");
  const g = x.match(/<game\b[\s\S]*?<\/game>/)![0];
  return x.replace(g, g + "\n" + g.replace(/gamecode="\d+"/, 'gamecode="999"'));
};
const OMAHA = HH("stars_6max_srp.txt")
  .replace("Hold'em No Limit", "Omaha Pot Limit")
  .replace("PokerStars Hand #249012345678", "PokerStars Hand #249012345600")
  .replace("[Ah Qd]", "[Ah Qd Kc 2s]");
const OBSERVED = HH("stars_6max_srp.txt").replace("PokerStars Hand #249012345678", "PokerStars Hand #249012345601").replace(/^Dealt to .*\n/m, "");
const noPause = async () => {};

describe("reading files", () => {
  it("splits a file of every site's hands into hands that parse as they do alone", () => {
    const all = "Exported by a tracker\r\n\r\n" + TXT.map((f) => HH(f).replace(/\n/g, "\r\n")).join("\r\n\r\n\r\n");
    const parts = splitHands(all);
    expect(parts).toHaveLength(TXT.length);
    parts.forEach((t, k) => expect(parseHandHistory(t), TXT[k]).toEqual(parseHandHistory(HH(TXT[k]!))));
    expect(splitHands(HH("888_6max_srp.txt") + HH("888_9max_mtt_ante.txt"))).toHaveLength(2);
    expect(splitHands(HH("party_6max_allin.txt") + "\n" + HH("party_mtt_bounty_allin.txt"))).toHaveLength(2);
    const xp = splitHands(twoIpoker());
    expect(xp).toHaveLength(2);
    expect(parseHandHistory(xp[0]!)).toEqual(parseHandHistory(HH("ipoker_3bet_pot.xml")));
  });

  it("reads each site's hand number and date", () => {
    const ids = Object.fromEntries(FILES.map((f) => [f, handNumber(splitHands(HH(f))[0]!)]));
    expect([ids["stars_6max_srp.txt"], ids["gg_allin_preflop.txt"], ids["888_6max_srp.txt"], ids["ipoker_3bet_pot.xml"]]).toEqual([
      "249012345678", "HD2051234567", "1234567890", "3858162574",
    ]);
    expect(Object.values(ids).every(Boolean)).toBe(true);
    const when = Object.fromEntries(FILES.map((f) => [f, playedOf(HH(f))?.played]));
    expect(when).toMatchObject({
      "stars_6max_srp.txt": "2024-03-02 21:14",
      "888_6max_srp.txt": "2024-03-02 21:14",
      "ignition_6max_srp.txt": "2024-03-02 21:14",
      "party_6max_allin.txt": "2024-08-03 23:11",
      "party_mtt_bounty_allin.txt": "2024-10-02 12:00",
      "ipoker_3bet_pot.xml": "2024-04-18 22:05",
    });
    expect(Object.values(when).every(Boolean)).toBe(true);
    expect(playedOf(HH("stars_6max_srp.txt"))!.at).toBe(Date.UTC(2024, 2, 2, 21, 14, 7));
    expect(playedOf("no date here")).toBeNull();
    // (iPoker: the game's own time, not the file's start kept before it)
    expect(playedOf("<session><general><startdate>2024-04-18 22:05:31</startdate></general><game gamecode='1'><general><startdate>2024-04-18 23:45:10</startdate></general></game></session>")!.played).toBe("2024-04-18 23:45");
    expect(playedOf("<session><general><startdate>2024-04-18 22:05:31</startdate></general><game gamecode='1'></game></session>")!.played).toBe("2024-04-18 22:05");
  });

  it("prepare: a file across sites, synthetic hands and ones to skip, counted by why", async () => {
    const synth = synthSession(60, 3);
    const text = [...TXT.map(HH), synth, OMAHA, OBSERVED, HH("stars_6max_srp.txt") /* again */].join("\n\n");
    const prog: [number, number][] = [];
    const prep = await prepare([{ name: "s.txt", text }], IMP, (k, n) => prog.push([k, n]), 25, noPause);
    const want = TXT.length + 60 + 3;
    expect(prep.total).toBe(want);
    expect(prep.skipped).toEqual({ nonHoldem: 1, noHero: 1, noDecisions: prep.skipped.noDecisions, duplicate: 1, failed: 0 });
    // a walk to hero's big blind is the only hand without a decision of hero's
    const walks = splitHands(synth).filter((t) => /HeroName: posts big blind/.test(t) && !/HeroName: (folds|calls|raises|checks|bets)/.test(t)).length;
    expect(prep.skipped.noDecisions).toBe(walks);
    expect(prep.hands).toHaveLength(want - 3 - walks);
    expect(prog.map((x) => x[1]).every((n) => n === want)).toBe(true);
    expect(prog.at(-1)).toEqual([want, want]);
    const h = prep.hands.find((x) => x.number === "249012345678")!;
    expect([h.id, h.site, h.hero, h.hole, h.board, h.bb, h.potType, h.pot, h.end, h.decisions, h.played]).toEqual([
      "PokerStars|249012345678|AhQd", "PokerStars", "BTN", "AhQd", "Qs8d3c7h2s", "$1", "SRP", 21.3, "won, all folded", 4, "2024-03-02 21:14",
    ]);
    expect([h.importId, h.importName, h.importedAt, h.text]).toEqual(["imp1", "test.txt", 1000, splitHands(HH("stars_6max_srp.txt"))[0]]);
    // an unreadable hand is listed with its message
    const bad = await prepare([{ name: "b.txt", text: HH("stars_6max_srp.txt").replace(/^Seat \d.*\n/gm, "") }], IMP, undefined, 100, noPause);
    expect(bad.skipped.failed).toBe(1);
    expect(bad.errors[0]!.msg).toMatch(/No players found/);
    // several files: each counted, a hand in two of them once
    const two = await prepare([{ name: "a.txt", text: HH("stars_6max_srp.txt") }, { name: "b.txt", text: HH("stars_6max_srp.txt") + "\n\n" + HH("stars_3bet_pot.txt") }], IMP, undefined, 100, noPause);
    expect(two.files).toEqual([{ name: "a.txt", total: 1, hands: 1 }, { name: "b.txt", total: 2, hands: 1 }]);
    expect(two.skipped.duplicate).toBe(1);
  });

  it("summarizes tournaments, chips and other sites", () => {
    const t = recordOf(HH("stars_9max_mtt_ante.txt"), importHand(HH("stars_9max_mtt_ante.txt")), IMP);
    expect([t.bb, t.tournament, t.players, t.hero]).toEqual(["300 chips", "3712345678", 9, "CO"]);
    const w = recordOf(HH("winamax_3bet_pot.txt"), importHand(HH("winamax_3bet_pot.txt")), IMP);
    expect([w.site, w.bb, w.potType]).toEqual(["Winamax", "€2", "3bet pot"]);
    const lim = recordOf(HH("gg_limped_multiway.txt"), importHand(HH("gg_limped_multiway.txt")), IMP);
    expect([lim.potType, lim.end]).toEqual(["Limped", "won, all folded"]);
    const sd = recordOf(HH("stars_3bet_pot.txt"), importHand(HH("stars_3bet_pot.txt")), IMP);
    expect(sd.end).toBe("showdown");
  });

  it("picks the hand-history files, and names an import by its files", () => {
    const f = (name: string, type = "", webkitRelativePath = "") => ({ name, type, webkitRelativePath });
    expect(hhFiles([f("a.txt"), f("b.png", "image/png"), f("c", "text/plain"), f("d.XML"), f("e.hh"), f("f.log")]).map((x) => x.name)).toEqual(["a.txt", "c", "d.XML", "e.hh", "f.log"]);
    expect(filesName([f("a.txt")])).toBe("a.txt");
    expect(filesName([f("a.txt", "", "Stars/2024/a.txt"), f("b.txt", "", "Stars/2024/b.txt")])).toBe("2024 (2 files)");
    expect(filesName([f("a.txt"), f("b.txt")])).toBe("2 files");
    // a folder with subfolders: the folder they all come from
    expect(filesName([f("a.txt", "", "Stars/2024/a.txt"), f("b.txt", "", "Stars/2025/06/b.txt"), f("c.txt", "", "Stars/c.txt")])).toBe("Stars (3 files)");
    expect(filesName([f("a.txt", "", "Stars/a.txt"), f("b.txt", "", "GG/b.txt")])).toBe("2 files");
    expect(filesName([])).toBe("");
  });
});

describe("decisions", () => {
  const A = (s: string): Move[] =>
    s
      ? s.split(",").map((t) => {
          const [pos = "", a = ""] = t.trim().split(" ");
          const action = ({ f: "fold", c: "call", r: "raise", a: "all-in", x: "check" } as Record<string, Move["action"]>)[a[0] ?? ""]!;
          return { pos, action, ...(a[0] === "r" ? { to: +a.slice(1) } : {}) };
        })
      : [];

  it("names each preflop situation as the classic analyzer does", () => {
    const cases: [string, string, string][] = [
      ["", "UTG", "RFI"], ["UTG f, HJ f", "CO", "RFI"], ["UTG c", "BTN", "vs limp"], ["UTG c, HJ f, CO f, BTN f, SB c", "BB", "BB vs limp"],
      ["UTG r2.5", "HJ", "vs open"], ["UTG r2.5, HJ c", "BTN", "vs open + call"], ["UTG r2.5, HJ f, CO f, BTN f", "SB", "SB vs open"],
      ["UTG r2.5, HJ f, CO f, BTN f, SB f", "BB", "BB defence"], ["UTG r2.5, HJ c, CO f, BTN f, SB f", "BB", "BB defence"],
      ["UTG r2.5, HJ r8, CO f, BTN f, SB f, BB f", "UTG", "vs 3bet"], ["UTG r2.5, HJ r8", "CO", "cold vs 3bet"],
      ["UTG r2.5, HJ r8, CO f, BTN f, SB f, BB f, UTG r20", "HJ", "vs 4bet+"], ["UTG c, HJ r4, CO f, BTN f, SB f, BB f", "UTG", "limp vs raise"],
      ["UTG a", "HJ", "vs open"], ["UTG a, HJ a", "CO", "vs open + call"],
    ];
    for (const [pre, hero, want] of cases) expect(preflopSituation(A(pre), hero), `${pre} / ${hero}`).toBe(want);
  });

  it("lists your decisions, and opens Study at each with the actions before it", () => {
    const r = importHand(HH("stars_6max_srp.txt"));
    expect(heroDecisions(r)).toEqual([{ street: "preflop", i: 3 }, { street: "flop", i: 1 }, { street: "turn", i: 1 }, { street: "river", i: 1 }]);
    const s = studyHandAt(r, "turn", 1)!;
    expect([s.players, s.stack, s.board, s.preflop.length, s.flop.length, s.turn, s.river]).toEqual([6, 100, "Qs8d3c7h", 6, 3, [{ pos: "BB", action: "check" }], []]);
    const link = studyLinkAt(r, "preflop", 3)!;
    expect(link).toBe("/study?p=6&s=100&pre=UTG%3Af%2CHJ%3Af%2CCO%3Af&stacks=SB%3A62.4");
    expect(fromSearch(link.split("?")[1]!)?.preflop).toHaveLength(3);
    // the ante, the straddle and the own stacks of the seats still in come along as Study's setup (the table at the
    // effective stack; the folded seats' stacks change nothing)
    const mtt = importHand(HH("stars_9max_mtt_ante.txt"));
    const ante = studyHandAt(mtt, "preflop", 5)!;
    expect(ante.stack).toBe(80);
    expect(ante.setup).toEqual({ stacks: { LJ: 100, BTN: 136.73, SB: 41.67, BB: 83.67 }, ante: 0.1 });
    expect(studyHandAt(mtt, "turn", 1)!.setup).toEqual({ stacks: { LJ: 100 }, ante: 0.1 });
    const straddle = studyLinkAt(importHand(HH("gg_straddle.txt")), "preflop", 4)!;
    expect(straddle).toBe("/study?p=6&s=100&pre=HJ%3Af%2CCO%3Ar7%2CBTN%3Af%2CSB%3Af&stacks=BB%3A124&straddle=1");
    expect(fromSearch(straddle.split("?")[1]!)?.setup).toEqual({ stacks: { BB: 124 }, straddle: true });
    expect(studyHandAt(importHand(HH("stars_3bet_pot.txt")), "flop", 0)).toMatchObject({ stack: 100, setup: { stacks: { BB: 120 } } });
    // the seats still in all at the effective stack: no setup, the link as before
    expect(studyHandAt(r, "turn", 1)!.setup).toBeUndefined();
  });

  it("carries what a Practice hand's record holds beyond its history, and an imported hand's link has none of it", () => {
    const r = importHand(HH("stars_6max_srp.txt"));
    const kept = { rake: 5, rakeCap: 3, sizes: { flop: [50] } };
    expect(studyHandAt(r, "turn", 1)!.setup).toBeUndefined();
    expect(studyHandAt(r, "turn", 1, kept)!.setup).toEqual(kept);
    expect(studyLinkAt(r, "turn", 1, kept)).toContain("&sz.flop=50&rake=5&cap=3");
    // (it goes with the own stacks of the seats still in)
    expect(studyHandAt(r, "preflop", 3, kept)!.setup).toEqual({ ...kept, stacks: { SB: 62.4 } });
    // one a setup can't hold is left out of the link, the hand's own game kept
    const mtt = importHand(HH("stars_9max_mtt_ante.txt"));
    expect(studyHandAt(mtt, "turn", 1, { rake: 99 })!.setup).toEqual({ stacks: { LJ: 100 }, ante: 0.1 });
  });

  it("opens Study with every seat at the effective stack where one is outside a setup's, and not at all over a 1bb ante", () => {
    // (the villain at 1250bb)
    const deep = importHand(HH("stars_heads_up.txt").replace("($250 in chips)", "($2500 in chips)"));
    expect(deep.setup.stacks.SB).toBe(1250);
    const s = studyHandAt(deep, "preflop", 1);
    expect(s && s.stack).toBe(100);
    expect(s && s.setup).toBeUndefined();
    const big = importHand(HH("stars_9max_mtt_ante.txt"));
    expect(studyHandAt({ ...big, hand: { ...big.hand, ante: 1.5 } }, "preflop", 5)).toBeNull();
  });
});
