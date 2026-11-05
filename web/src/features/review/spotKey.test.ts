// One spot, one record: Practice writes a spot's Study line from the table and Analyze from the hand's history, and the
// two differ on carried chips, rake, sizes and a `to` past the cents. Played out here through both, so a key that drifts
// from either fails, and the queue's own store is what's asked.
import { beforeEach, describe, expect, it } from "vitest";
import { db, type DecisionRecord, type HandRecord, type MistakeRecord } from "@/data/db";
import { addMistake, keepMistake, listMistakes } from "@/data/mistakes";
import { studyLinkAt } from "@/features/analyze/analyze";
import { practiceHistory, practiceRecord } from "@/features/practice/history";
import { dealNext, finish, newHand, phaseOf, simOf, studyOf, withVillain, type Decision, type DealOptions, type PracticeHand } from "@/features/practice/practice";
import { importHand } from "@/hh/replay";
import type { Move, Street } from "@/poker/table";
import { mistake, LIVE } from "@/test/mistake";
import { addedMistake, leakMistake } from "./fromAnalyze";
import { handMistake, missedAgain, spotKey } from "./mistakes";

const AT = new Date(2026, 10, 3, 10, 0, 0);
const SESSION = { id: "s1", startedAt: 1000 };
const NOW = new Date(2026, 10, 5, 12).getTime();
const mv = (pos: string, action: Move["action"], to?: number): Move => ({ pos, action, ...(to !== undefined ? { to } : {}) });

const LINE: Move[] = [mv("UTG", "fold"), mv("HJ", "fold"), mv("CO", "fold"), mv("BTN", "raise", 2.5), mv("SB", "fold"), mv("BB", "call"), mv("BB", "check"), mv("BTN", "bet", 1.65), mv("BB", "call"), mv("BB", "check"), mv("BTN", "check"), mv("BB", "check"), mv("BTN", "check")];

/** The hand played out, with your decisions as Practice wrote each one and where the history has it. */
function play(h: PracticeHand, ms: Move[]) {
  const spots: { street: Street; i: number; study: string; at: PracticeHand }[] = [];
  const deal = () => {
    for (let p = phaseOf(h); p.kind === "deal"; p = phaseOf(h)) h = dealNext(h, p.street);
  };
  for (const m of ms) {
    deal();
    const sim = simOf(h);
    if (m.pos === h.hero) spots.push({ street: sim.current!, i: h.lines[sim.current!].length, study: studyOf(h), at: h });
    h = withVillain(h, m);
  }
  deal();
  h = { ...h, result: finish(h) };
  return { h, spots, r: importHand(practiceHistory(h, SESSION.startedAt, AT)), rec: practiceRecord(h, SESSION, AT) };
}

const MIX: Decision["mix"] = [{ action: "check", freq: 0.1, ev: 4 }, { action: "bet 33%", freq: 0.9, ev: 4.4, amount: 2 }];
const practiceMiss = (spot: { study: string; at: PracticeHand; street: Street }) =>
  handMistake("s1", spot.at, { street: spot.street, chose: "check", move: mv(spot.at.hero, "check"), grade: { a: 0, best: 1, verdict: "Mistake", ok: false, mixed: false, loss: 0.4, lossPct: 7, byEv: true }, mix: MIX, pot: 5.5, provenance: LIVE, study: spot.study }, NOW)!;
const decision = (spot: { street: Street; i: number }, handId: string, pos: string, x: Partial<DecisionRecord> = {}): DecisionRecord => ({
  id: `${handId}|${spot.street}|${spot.i}`,
  handId,
  street: spot.street,
  i: spot.i,
  pos,
  action: "check",
  matched: "check",
  verdict: "Mistake",
  evLossBb: 0.4,
  lossPct: 7,
  byEv: true,
  pot: 5.5,
  mix: [["check", 0.1, 4], ["bet 33%", 0.9, 4.4]],
  source: "library",
  label: "Precomputed solution · srp_btn_bb",
  gradedAt: 1,
  ...x,
});
/** The same spot read from the hand as Analyze does: both keys, and that the ids differ where that's the point. */
function both(o: DealOptions, ms = LINE, stacks?: Record<string, number>) {
  const start = newHand(6, 100, 1, 7, { seat: "BTN", ...o });
  const { spots, r, rec } = play(stacks ? { ...start, stacks } : start, ms);
  return spots.map((s) => {
    const link = studyLinkAt(r, s.street, s.i, rec.setup)!.replace(/^\/study\?/, "");
    return { spot: s, link, rec, r, practice: practiceMiss(s), analyze: addedMistake(decision(s, rec.id, rec.hero), rec, r, NOW)! };
  });
}

beforeEach(async () => {
  await (await db())!.clear("mistakes");
});

describe("a spot's key", () => {
  it.each<[string, DealOptions, Move[], Record<string, number> | undefined]>([
    ["plain", {}, LINE, undefined],
    ["an ante", { ante: 0.1 }, LINE, undefined],
    ["chips carried", {}, LINE, { UTG: 100, HJ: 100, CO: 100, BTN: 120, SB: 100, BB: 80 }],
    ["a rake", { rake: 5, rakeCap: 3 }, LINE, undefined],
    ["your own sizes", { sizes: { flop: [50] } }, LINE, undefined],
    ["a bet past the cents", {}, LINE.map((m) => (m.to === 1.65 ? mv("BTN", "bet", 1.8333333) : m)), undefined],
    ["an ante past the cents", { ante: 0.125 }, LINE, undefined],
    ["chips past the cents", {}, LINE, { UTG: 100, HJ: 100, CO: 100, BTN: 120.333, SB: 100, BB: 79.667 }],
  ])("is one for Practice's line and Analyze's: %s", (_, o, ms, stacks) => {
    const spots = both(o, ms, stacks);
    expect(spots.length).toBeGreaterThan(2);
    for (const s of spots) expect(spotKey(s.analyze)).toBe(spotKey(s.practice));
  });

  it("holds where the two lines differ, so the ids can't say it", () => {
    const carried = both({}, LINE, { UTG: 100, HJ: 100, CO: 100, BTN: 120, SB: 100, BB: 80 })[0]!;
    expect(carried.link).not.toBe(carried.spot.study);
    expect(carried.analyze.id).not.toBe(carried.practice.id);
  });

  it("carries a rake and sizes in Analyze's link for a Practice hand", () => {
    const s = both({ rake: 5, rakeCap: 3, sizes: { flop: [50] } })[1]!;
    expect(s.link).toBe(s.spot.study);
    expect(s.analyze.id).toBe(s.practice.id);
  });

  it("tells seats, chips, the line, the cards and the game apart", () => {
    const m = mistake({ study: "p=6&s=100&pre=UTG:f,HJ:f,CO:f,BTN:r2.5,SB:f,BB:c&b=2c7dTs&flop=BB:x" });
    const on = (x: Partial<MistakeRecord>) => spotKey({ ...m, ...x });
    const study = m.study!;
    expect(on({ study })).toBe(spotKey(m));
    expect(on({ seat: "BB" })).not.toBe(spotKey(m));
    expect(on({ hole: ["Ah", "Qd"] })).not.toBe(spotKey(m));
    expect(on({ hole: ["Kd", "Ah"] })).toBe(spotKey(m));
    expect(on({ study: study.replace("p=6&s=100", "p=6&s=50") })).not.toBe(spotKey(m));
    expect(on({ study: `${study}&stacks=BB:50` })).not.toBe(spotKey(m));
    expect(on({ study: study.replace("r2.5", "r3") })).not.toBe(spotKey(m));
    expect(on({ study: study.replace("2c7dTs", "2c7dTh") })).not.toBe(spotKey(m));
    expect(on({ study: `${study}&rake=5` })).not.toBe(spotKey(m));
    expect(on({ study: `${study}&rake=5&cap=3` })).not.toBe(on({ study: `${study}&rake=5` }));
    expect(on({ study: `${study}&sz.flop=50` })).not.toBe(spotKey(m));
    expect(on({ study: `${study}&ante=0.1` })).not.toBe(spotKey(m));
    expect(on({ study: `${study}&straddle=1` })).not.toBe(spotKey(m));
    // a seat that folded before it changes nothing, one still in does
    expect(on({ study: `${study}&stacks=UTG:40` })).toBe(spotKey(m));
    expect(on({ study: study.replace("p=6&s=100", "p=6&s=80") + "&stacks=UTG:40,HJ:40,CO:40,BTN:80,SB:40,BB:80" })).not.toBe(spotKey(m));
  });

  it.each<[string, Partial<MistakeRecord>]>([
    ["a tournament", { tournament: "icm" }],
    ["a chip EV tournament", { tournament: "chips" }],
    ["an exploit session", { exploit: "station" }],
    ["a library drill", { from: "drill" }],
    ["a line Study can't set up", { study: null }],
    ["a line that can't be read", { study: "x=1" }],
    ["a tournament's prizes in the line", { study: "p=6&s=100&pay=50,30,20" }],
  ])("isn't there for %s, which stays its own record", (_, x) => {
    expect(spotKey(mistake(x))).toBeNull();
  });
});

describe("one spot in the queue", () => {
  const carried = () => both({}, LINE, { UTG: 100, HJ: 100, CO: 100, BTN: 120, SB: 100, BB: 80 })[1]!;

  it("says Add to review's spot is kept already, and the queue holds one", async () => {
    const s = carried();
    await keepMistake(s.practice, missedAgain, spotKey);
    expect(await addMistake(s.analyze, spotKey)).toBe("there");
    expect((await listMistakes()).list).toMatchObject([{ id: s.practice.id, times: 1 }]);
  });

  it("merges a leak drill's miss into Practice's record, whose id stays, and the other way", async () => {
    const s = carried();
    const pick = { a: 0, best: 1, verdict: "Mistake", ok: false, mixed: false, loss: 0.4, lossPct: 7, byEv: true } as const;
    const leak = leakMistake(decision(s.spot, s.rec.id, s.rec.hero), s.rec, s.r, pick, "drill", NOW + 5)!;
    expect(leak.id).not.toBe(s.practice.id);
    await keepMistake(s.practice, missedAgain, spotKey);
    await keepMistake(leak, missedAgain, spotKey);
    expect((await listMistakes()).list).toMatchObject([{ id: s.practice.id, times: 2, ask: { via: "solver" }, decisions: { [decision(s.spot, s.rec.id, s.rec.hero).id]: 1 } }]);
    await (await db())!.clear("mistakes");
    await keepMistake(leak, missedAgain, spotKey);
    await keepMistake(s.practice, missedAgain, spotKey);
    expect((await listMistakes()).list).toMatchObject([{ id: leak.id, times: 2, ask: { via: "solver" } }]);
  });

  it("merges a record kept before there was a key, under its own id", async () => {
    const s = carried();
    await (await db())!.put("mistakes", s.analyze);
    await keepMistake(s.practice, missedAgain, spotKey);
    expect((await listMistakes()).list).toMatchObject([{ id: s.analyze.id, times: 2 }]);
  });

  it("keeps an imported hand apart from a raked Practice miss on the same line and cards", async () => {
    const raked = both({ rake: 5, rakeCap: 3 })[1]!;
    const imported: HandRecord = { ...raked.rec, id: "PokerStars|1", site: "PokerStars" };
    delete imported.setup;
    const plain = addedMistake(decision(raked.spot, imported.id, imported.hero), imported, raked.r, NOW)!;
    expect(spotKey(plain)).not.toBe(spotKey(raked.practice));
    await keepMistake(raked.practice, missedAgain, spotKey);
    expect(await addMistake(plain, spotKey)).toBe("added");
    expect((await listMistakes()).list).toHaveLength(2);
  });

  it("keeps a tournament's and an exploit session's apart from the cash entry on that line", async () => {
    const s = both({})[1]!;
    await keepMistake({ ...s.practice, id: "t", tournament: "chips" }, missedAgain, spotKey);
    await keepMistake({ ...s.practice, id: "e", exploit: "station" }, missedAgain, spotKey);
    expect(await addMistake(s.analyze, spotKey)).toBe("added");
    expect((await listMistakes()).list).toHaveLength(3);
  });
});
