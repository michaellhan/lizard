// The plan's rule: the order, what's kept out, the empty states and what alone marks a step done.
import { describe, expect, it } from "vitest";
import { PRACTICE_SITE } from "@/data/hands";
import type { DecisionRecord, MistakeRecord, SessionRecord } from "@/data/db";
import { drillSessionId } from "@/features/analyze/leakDrill";
import { MIN_READ } from "@/features/analyze/report";
import { sessionImport } from "@/features/analyze/sessions";
import { readSetupLink } from "@/features/practice/setupLink";
import { midnight } from "@/features/review/schedule";
import type { LibrarySpotIndex } from "@/library/catalog";
import { SEATS } from "@/poker/seats";
import { CHART, chartMistake, mistake } from "@/test/mistake";
import { buildPlan, DRILL_TARGET, librarySpotFor, PLAN_RULE, PLAN_SCOPE, withLibrary, type PlanHand, type PlanInput } from "./plan";

const NOW = new Date(2026, 10, 5, 12).getTime();
const DAY = 86_400_000;

let k = 0;
const d = (o: Partial<DecisionRecord>): DecisionRecord => ({
  id: `h|${k++}`,
  handId: "h1",
  street: "preflop",
  pos: "BTN",
  action: "raise to 2.5",
  verdict: "Best",
  evLossBb: null,
  lossPct: null,
  source: "charts",
  label: "Preflop charts · approximate",
  gradedAt: 0,
  ...o,
});
// an open against the charts, graded out of the mix, and a c-bet against the library, losing `ev`
const open = (o: Partial<DecisionRecord> = {}) => d({ situation: "RFI", mix: [["fold", 1, null]], matched: "raise", freq: 0, best: "fold", bestFreq: 1, verdict: "Mistake", ...o });
const flop = (situation: string, ev: number, o: Partial<DecisionRecord> = {}) =>
  d({ street: "flop", action: "bet 1.8", situation, role: "PFR", facing: false, multi: false, ip: true, mix: [["check", 0.6, 3.1], ["bet 33%", 0.4, 3.1 - ev]], verdict: "Mistake", evLossBb: ev, lossPct: 10, pot: 5.5, source: "library", label: "Precomputed solution · srp_btn_bb", ...o });
const times = (n: number, f: () => DecisionRecord) => Array.from({ length: n }, f);

const HAND: PlanHand = { id: "h1", site: "PokerStars", tournament: undefined, importId: "i1" };
const input = (x: Partial<PlanInput> = {}): PlanInput => ({ now: NOW, mistakes: [], hands: [HAND], decisions: [], sessions: [], ...x });
const session = (x: Partial<SessionRecord>): SessionRecord => ({ id: "s", kind: "practice", startedAt: NOW - 1000, endedAt: NOW, decisions: 0, evLossBb: 0, meta: {}, ...x });
const dueToday = (x: Partial<MistakeRecord> = {}) => mistake({ due: NOW - 1000, ...x });

describe("the plan's order", () => {
  it("runs reviews, leaks, too few to read, then the drill, and names the first as next", () => {
    const plan = buildPlan(input({ mistakes: [dueToday()], decisions: [...times(40, () => flop("SRP · IP · checked to", 1)), ...times(12, () => flop("3bet pot · OOP · facing a bet", 1.5, { facing: true, ip: false }))] }));
    expect(plan.reviews?.due).toBe(1);
    expect(plan.leaks.length).toBeGreaterThan(0);
    expect(plan.thin.length).toBeGreaterThan(0);
    expect(plan.drill).not.toBeNull();
    expect(plan.next).toBe(plan.reviews);
    expect(plan.first).toBeNull();
  });

  it("puts the most EV given up first, even over a higher score or rate", () => {
    const spots = buildPlan(input({ decisions: [...times(30, () => flop("3bet pot · IP · checked to", 2)), ...times(110, () => flop("SRP · IP · checked to", 0.6))] })).leaks.filter((l) => l.leak.kind === "spot");
    expect(spots.map((l) => l.lost)).toEqual([66, 60]);
    expect(spots[0]!.what).toMatch(/SRP/);
  });

  it("ranks a frequency leak with no EV after every leak that has one, and says why", () => {
    const plan = buildPlan(input({ decisions: [...times(40, () => open()), ...times(30, () => flop("SRP · IP · checked to", 0.6))] }));
    const last = plan.leaks.at(-1)!;
    expect(plan.leaks[0]!.lost).toBeGreaterThan(0);
    expect(last.lost).toBeNull();
    expect(last.says.join(" ")).toMatch(/No EV to weigh/);
  });

  it("gives the same plan in any order of what's kept", () => {
    const ds = [...times(40, () => open()), ...times(30, () => flop("SRP · IP · checked to", 1)), ...times(30, () => flop("3bet pot · IP · checked to", 1)), ...times(15, () => flop("Limped · IP · checked to", 1))];
    const a = buildPlan(input({ decisions: ds, mistakes: [dueToday({ id: "a" }), dueToday({ id: "b", street: "turn" })] }));
    const b = buildPlan(input({ decisions: [...ds].reverse(), mistakes: [dueToday({ id: "b", street: "turn" }), dueToday({ id: "a" })] }));
    expect(b.leaks.map((l) => l.id)).toEqual(a.leaks.map((l) => l.id));
    expect(b.thin.map((l) => l.id)).toEqual(a.thin.map((l) => l.id));
    expect(b.drill?.to).toBe(a.drill?.to);
  });

  it("states the rule, and that it's no coach", () => {
    expect(PLAN_RULE).toHaveLength(4);
    expect(PLAN_SCOPE).toMatch(/rule, not a coach/);
    expect(PLAN_SCOPE).toMatch(/can't say why/);
  });
});

describe("reviews", () => {
  it("links to the first due, and counts by EV and by frequency, against what graded each", () => {
    const r = buildPlan(input({ mistakes: [dueToday({ id: "a" }), chartMistake({ id: "b", due: NOW - 1000 })] })).reviews!;
    expect(r.title).toBe("Retry 2 due reviews");
    expect(r.to).toBe("/review?retry=next");
    expect(r.says.join(" ")).toMatch(/2 mistakes due/);
    expect(r.says.join(" ")).toMatch(/1 first graded by EV, 1 by frequency/);
    expect(r.says.join(" ")).toMatch(/Preflop charts/i);
  });

  it("leaves out what isn't due, and says when the next comes", () => {
    const plan = buildPlan(input({ mistakes: [mistake({ due: NOW + 3 * DAY })] }));
    expect(plan.reviews).toBeNull();
    expect(plan.notes.reviews).toMatch(/Nothing is due today.*in 3 days/);
  });

  it("counts a tournament or exploit review in the queue, and says so", () => {
    const r = buildPlan(input({ mistakes: [dueToday({ id: "a", tournament: "x" as never }), dueToday({ id: "b", exploit: "y" as never })] })).reviews!;
    expect(r.due).toBe(2);
    expect(r.says.join(" ")).toMatch(/1 from tournament sessions and 1 from exploit sessions/);
  });

  it("is done only when none is due and one moved on today: never by a press, nor by a retry that moved nothing", () => {
    const moved = { at: NOW - 1000, ok: true, moved: true } as MistakeRecord["tries"][number];
    expect(buildPlan(input({ mistakes: [dueToday()] })).reviews!.done).toBe(false);
    expect(buildPlan(input({ mistakes: [dueToday({ id: "a" }), mistake({ id: "b", due: NOW + DAY, tries: [moved] })] })).reviews!.done).toBe(false);
    const done = buildPlan(input({ mistakes: [mistake({ due: NOW + 3 * DAY, tries: [moved] })] })).reviews!;
    expect(done.done).toBe(true);
    expect(done.progress).toMatch(/1 review moved on today, 1 at Best or Correct/);
    expect(buildPlan(input({ mistakes: [mistake({ due: NOW + 3 * DAY, tries: [{ ...moved, moved: false }] })] })).reviews).toBeNull();
    expect(buildPlan(input({ mistakes: [mistake({ due: NOW + 3 * DAY, tries: [{ ...moved, at: midnight(NOW) - 1 }] })] })).reviews).toBeNull();
  });
});

describe("reviews, with entries from Analyze", () => {
  it("orders and counts them as any entry: the longest overdue first, finished ones and those not due out", () => {
    const ask = { via: "kept", hand: "h1", decision: "d" } as const;
    const plan = buildPlan(
      input({
        mistakes: [
          dueToday({ id: "new", from: "leak", ask, due: NOW - 1000 }),
          dueToday({ id: "old", from: "analyze", ask, due: NOW - 3 * DAY }),
          dueToday({ id: "practice", due: NOW - 2 * DAY }),
          dueToday({ id: "later", from: "analyze", ask, due: NOW + DAY }),
          dueToday({ id: "done", from: "leak", ask, due: null }),
        ],
      }),
    );
    expect(plan.reviews?.due).toBe(3);
  });
});

describe("leaks", () => {
  it("opens the leak's drill over the hands it was read from", () => {
    const leak = buildPlan(input({ decisions: times(40, () => flop("SRP · IP · checked to", 1)) })).leaks.find((l) => l.leak.kind === "spot")!;
    const u = new URL(leak.to, "http://x");
    expect(u.pathname).toBe("/analyze");
    expect(u.searchParams.get("game")).toBe("equilibrium");
    expect(u.searchParams.get("drill")).toBe(`spot:${leak.what}`);
    expect(leak.title).toBe(`Drill this leak: ${leak.what}`);
  });

  it("says a preflop leak is against the charts by frequency, not a solve", () => {
    const leak = buildPlan(input({ decisions: times(40, () => open()) })).leaks.find((l) => l.leak.kind === "pf")!;
    const words = leak.says.join(" ");
    expect(words).toMatch(/0% in the mix \(95% range 0% to \d+%\) against the preflop charts, by frequency, not a solve, over 40 decisions/);
    expect(words).toMatch(/No EV to weigh/);
    expect(leak.lost).toBeNull();
  });

  it("says what EV it gave up and over what, and what's graded with no EV counts none", () => {
    const leak = buildPlan(input({ decisions: times(40, () => flop("SRP · IP · checked to", 1)) })).leaks.find((l) => l.leak.kind === "spot")!;
    expect(leak.says.join(" ")).toMatch(/40\.00bb of solver EV given up over 40 decisions graded by EV/);
    expect(leak.says.join(" ")).toMatch(/Graded against: Library, 40|Graded against: .*40/);
  });

  it("is done when every decision its drill can deal has been answered, and a new one undoes it", () => {
    const ds = times(40, () => flop("SRP · IP · checked to", 1));
    const key = buildPlan(input({ decisions: ds })).leaks.find((l) => l.leak.kind === "spot")!;
    const answered = (ids: readonly string[]) =>
      session({ id: drillSessionId(key.leak), kind: "analysis", meta: { drill: "leak", done: ids, score: {} } });
    const half = buildPlan(input({ decisions: ds, sessions: [answered(ds.slice(0, 20).map((x) => x.id))] })).leaks.find((l) => l.id === key.id)!;
    expect(half.done).toBe(false);
    expect(half.progress).toBe("20 of 40 decisions answered in its drill.");
    const all = buildPlan(input({ decisions: ds, sessions: [answered(ds.map((x) => x.id))] })).leaks.find((l) => l.id === key.id)!;
    expect(all.done).toBe(true);
    const more = [...ds, flop("SRP · IP · checked to", 1)];
    expect(buildPlan(input({ decisions: more, sessions: [answered(ds.map((x) => x.id))] })).leaks.find((l) => l.id === key.id)!.done).toBe(false);
  });

  it("isn't done with nothing to deal, says it can't be, and isn't the next step", () => {
    const plan = buildPlan(input({ decisions: times(40, () => flop("SRP · IP · checked to", 1, { mix: undefined })) }));
    const leak = plan.leaks.find((l) => l.leak.kind === "spot")!;
    expect(leak.done).toBe(false);
    expect(leak.progress).toMatch(/nothing to deal/);
    expect(plan.next?.kind).toBe("drill");
  });
});

describe("what's kept out of the leaks", () => {
  const tour: PlanHand = { ...HAND, id: "t", tournament: "Practice" };
  const exploit: PlanHand = { ...HAND, id: "x", site: PRACTICE_SITE, importId: sessionImport("e1") };
  const hands = [tour, exploit];
  const leaky = (handId: string) => times(40, () => flop("SRP · IP · checked to", 1, { handId }));

  it("leaves tournament hands out, and says how many", () => {
    const plan = buildPlan(input({ hands: [tour], decisions: leaky("t") }));
    expect(plan.leaks).toEqual([]);
    expect(plan.thin).toEqual([]);
    expect(plan.drill).toBeNull();
    expect(plan.apart).toMatch(/40 graded decisions in tournament hands/);
  });

  it("leaves exploit sessions out by their session, and says how many", () => {
    const plan = buildPlan(input({ hands: [exploit], decisions: leaky("x"), sessions: [session({ id: "e1", kind: "exploit" })] }));
    expect(plan.leaks).toEqual([]);
    expect(plan.drill).toBeNull();
    expect(plan.apart).toMatch(/40 graded decisions in hands from exploit sessions/);
  });

  it("gives the first step, not an empty plan, when that's all there is", () => {
    const plan = buildPlan(input({ hands, decisions: [...leaky("t"), ...leaky("x")], sessions: [session({ id: "e1", kind: "exploit" })] }));
    expect(plan.first?.text).toMatch(/tournament hand or an exploit session/);
  });

  it("leaves a tournament or exploit mistake out of the misses, though the queue keeps it", () => {
    const plan = buildPlan(input({ mistakes: [mistake({ tournament: "x" as never, due: NOW + DAY }), mistake({ id: "b", exploit: "y" as never, due: NOW + DAY })] }));
    expect(plan.drill).toBeNull();
  });

  it("leaves out decisions of hands no longer kept", () => {
    expect(buildPlan(input({ decisions: times(40, () => flop("SRP · IP · checked to", 1, { handId: "gone" })) })).leaks).toEqual([]);
  });
});

describe("too few to read", () => {
  const thin = (n: number, sit = "SRP · IP · checked to") => times(n, () => flop(sit, 1));

  it("says it's no leak and shows no rate, the most decisions first", () => {
    const plan = buildPlan(input({ decisions: [...thin(12, "SRP · IP · checked to"), ...thin(25, "3bet pot · IP · checked to")] }));
    const spots = plan.thin.filter((t) => t.leak.kind === "spot");
    expect(spots.map((t) => t.n)).toEqual([25, 12]);
    expect(spots[0]!.says[0]).toBe(`Too few to read, and not a leak: 25 graded decisions, ${MIN_READ - 25} short of the ${MIN_READ} it takes.`);
    expect(spots[0]!.says.join(" ")).not.toMatch(/bb lost|% in the mix|You \d/);
    expect(spots[0]!.title).toBe(`Collect hands: ${spots[0]!.what}`);
    expect(spots[0]!.also.to).toBe("/analyze");
    expect(spots[0]!.done).toBe(false);
  });

  it("isn't a leak drill: its link starts hands in the pot it needs, and they're stated to count once graded", () => {
    const row = buildPlan(input({ decisions: thin(12) })).thin.find((t) => t.leak.kind === "spot")!;
    const q = new URL(row.to, "http://x").searchParams;
    expect(new URL(row.to, "http://x").pathname).toBe("/practice");
    expect(readSetupLink(q)).not.toBeNull();
    expect(row.says.join(" ")).toMatch(/counts here once it's kept and graded in Analyze/);
  });

  it("plays preflop for a preflop row", () => {
    const row = buildPlan(input({ decisions: times(12, () => open()) })).thin.find((t) => t.leak.kind === "pf")!;
    expect(new URL(row.to, "http://x").searchParams.get("play")).toBe("preflop");
  });
});

describe("the drill", () => {
  const misses = (street: string, pos: string, n: number, o: Partial<DecisionRecord> = {}) => times(n, () => flop("SRP · IP · checked to", 0.1, { street, pos, ...o }));

  it("picks the street with the most misses, then the seat with the most on it, as a saved-settings link", () => {
    const plan = buildPlan(input({ decisions: [...misses("turn", "BB", 5), ...misses("preflop", "CO", 6), ...misses("preflop", "BTN", 7), ...misses("flop", "SB", 12)] }));
    expect(plan.drill).toMatchObject({ street: "preflop", seat: "BTN", misses: 7 });
    const s = readSetupLink(new URL(plan.drill!.to, "http://x").searchParams)!;
    expect(s).toMatchObject({ players: 6, stack: 100, opts: { seat: "BTN", preflopOnly: true, pot: null } });
    expect(plan.drill!.says[0]).toMatch(/13 of the 30 misses counted, 7 of them from BTN/);
    expect(plan.drill!.says.join(" ")).toMatch(/preflop charts, by frequency, not a solve/);
  });

  it("settles a tie by the street's order, then the seat's", () => {
    const plan = buildPlan(input({ decisions: [...misses("turn", "BB", 4), ...misses("flop", "BTN", 2), ...misses("flop", "CO", 2)] }));
    expect(plan.drill).toMatchObject({ street: "flop", seat: "CO" });
  });

  it("counts a Practice mistake as often as it was missed, and a graded Practice hand not twice", () => {
    const hand: PlanHand = { ...HAND, id: "p", site: PRACTICE_SITE, importId: sessionImport("s1") };
    const plan = buildPlan(input({ hands: [HAND, hand], decisions: [...misses("flop", "BB", 3), ...misses("turn", "BTN", 9, { handId: "p" })], mistakes: [mistake({ street: "turn", seat: "BTN", times: 4, due: NOW + DAY })] }));
    expect(plan.drill).toMatchObject({ street: "turn", seat: "BTN", misses: 4 });
    expect(plan.drill!.says[1]).toMatch(/0 in hands graded in Analyze, 4 kept in the review queue/);
  });

  describe("with entries from Analyze", () => {
    const kept = (decision: string, x: Partial<MistakeRecord> = {}) => mistake({ id: decision, from: "analyze", street: "flop", seat: "BTN", ask: { via: "kept", hand: "h1", decision }, due: NOW + DAY, ...x });

    it("doesn't count an entry again where its own graded miss is counted, and counts what else the queue holds", () => {
      const ds = misses("flop", "BTN", 3);
      const plan = buildPlan(input({ decisions: ds, mistakes: [kept(ds[0]!.id, { times: 2 }), kept(ds[1]!.id, { from: "leak" })] }));
      expect(plan.drill).toMatchObject({ street: "flop", seat: "BTN", misses: 3 });
      expect(plan.drill!.says[1]).toMatch(/3 in hands graded in Analyze, 0 kept in the review queue/);
    });

    it("counts one whose grade is gone or wasn't a miss, as it's the only count of it", () => {
      const gone = buildPlan(input({ mistakes: [kept("h9|flop|0", { times: 2 })] }));
      expect(gone.drill).toMatchObject({ street: "flop", seat: "BTN", misses: 2 });
      const ok = d({ id: "ok", street: "flop", verdict: "Best" });
      const picked = buildPlan(input({ decisions: [ok], mistakes: [kept("ok", { from: "leak" })] }));
      expect(picked.drill).toMatchObject({ misses: 1 });
    });

    it("says that it doesn't count one twice", () => {
      expect(PLAN_RULE.join(" ")).toMatch(/isn't counted again where its own decision already is/);
    });
  });

  it("doesn't count what was played in the mix, or what nothing graded", () => {
    const plan = buildPlan(input({ decisions: [...misses("flop", "BTN", 5, { verdict: "Best" }), ...misses("flop", "CO", 5, { verdict: "Not graded" })] }));
    expect(plan.drill).toBeNull();
  });

  it("skips what a store made up for a street or seat", () => {
    const plan = buildPlan(input({ decisions: [...misses("<b>", "BTN", 9), ...misses("flop", "__proto__", 9), ...misses("flop", "BB", 1)] }));
    expect(plan.drill).toMatchObject({ street: "flop", seat: "BB", misses: 1 });
  });

  it("makes a setup that can start, from every seat at every street", () => {
    for (const seat of new Set(Object.values(SEATS).flat())) {
      for (const street of ["preflop", "flop", "turn", "river"]) {
        const plan = buildPlan(input({ decisions: misses(street, seat, 1) }));
        expect(plan.drill?.seat).toBe(seat);
        expect(readSetupLink(new URL(plan.drill!.to, "http://x").searchParams)).not.toBeNull();
      }
    }
  });

  it("is done at the target, by sessions started today of that drill alone", () => {
    const ds = misses("preflop", "BTN", 3);
    const practice = (decisions: number, x: Partial<SessionRecord> = {}, meta = {}) => session({ decisions, meta: { seat: "BTN", preflopOnly: true, ...meta }, ...x });
    const run = (...sessions: SessionRecord[]) => buildPlan(input({ decisions: ds, sessions })).drill!;
    expect(run().done).toBe(false);
    expect(run().progress).toBe(`0 of ${DRILL_TARGET} decisions in this drill in sessions started today.`);
    expect(run(practice(DRILL_TARGET - 1)).done).toBe(false);
    expect(run(practice(DRILL_TARGET)).done).toBe(true);
    expect(run(practice(12, { id: "a" }), practice(8, { id: "b" })).done).toBe(true);
    expect(run(practice(30, { startedAt: midnight(NOW) - 1 })).done).toBe(false);
    expect(run(practice(30, {}, { seat: "CO" })).done).toBe(false);
    expect(run(practice(30, {}, { preflopOnly: undefined })).done).toBe(false);
    expect(run(practice(30, { kind: "exploit" })).done).toBe(false);
  });

  describe("from the library", () => {
    const spot = (x: Partial<LibrarySpotIndex>): LibrarySpotIndex => ({ id: "srp_btn_bb", label: "BTN vs BB", seats: ["BB", "BTN"], flops: { "2c7dTs": "x" }, report: "r", turns: ["2c7dTs"], ...x }) as unknown as LibrarySpotIndex;

    it("moves a flop drill to the spot that stores the seat, in its seat's view, and counts its own sessions", () => {
      const ds = misses("flop", "BTN", 3);
      const plan = withLibrary(buildPlan(input({ decisions: ds, sessions: [session({ kind: "drill", decisions: DRILL_TARGET, meta: { spot: "srp_btn_bb", view: "ip" } })] })), [spot({})]);
      expect(plan.drill!.to).toBe("/practice?tab=drills&spot=srp_btn_bb&view=ip");
      expect(plan.drill!.done).toBe(true);
      expect(plan.drill!.says.join(" ")).toMatch(/flop library/);
    });

    it("carries the turn on a turn drill, and the seat first in the spot is out of position", () => {
      const plan = withLibrary(buildPlan(input({ decisions: misses("turn", "BB", 3) })), [spot({ game: { kind: "x" } as never, id: "odd" }), spot({})]);
      expect(plan.drill!.to).toBe("/practice?tab=drills&spot=srp_btn_bb&view=oop&street=turn");
    });

    it("stays a session of hands where the library has no spot for the seat, or the street", () => {
      const flopPlan = buildPlan(input({ decisions: misses("flop", "CO", 3) }));
      expect(withLibrary(flopPlan, [spot({})])).toBe(flopPlan);
      const river = buildPlan(input({ decisions: misses("river", "BTN", 3) }));
      expect(withLibrary(river, [spot({})])).toBe(river);
      expect(librarySpotFor([spot({})], "BTN", "preflop")).toBeNull();
      expect(librarySpotFor([spot({ turns: undefined })], "BTN", "turn")).toBeNull();
      expect(librarySpotFor([spot({ report: undefined })], "BTN", "flop")).toBeNull();
    });
  });
});

describe("with nothing to go on", () => {
  it("says what to do first with nothing kept", () => {
    const plan = buildPlan(input({ hands: [] }));
    expect(plan.next).toBeNull();
    expect(plan.first?.text).toMatch(/Nothing is kept in this browser/);
    expect(plan.first?.links.map((l) => l.to)).toEqual(["/practice", "/analyze"]);
  });

  it("doesn't call a browser empty that keeps only mistakes it leaves out", () => {
    const plan = buildPlan(input({ hands: [], mistakes: [mistake({ tournament: "x" as never, due: NOW + DAY })] }));
    expect(plan.first?.text).toMatch(/kept here \(1 mistake\) is from tournament or exploit sessions/);
  });

  it("sends kept hands to be graded", () => {
    const plan = buildPlan(input({ decisions: [d({ verdict: "Not graded", why: "x" })] }));
    expect(plan.first?.text).toMatch(/1 hand kept and none graded/);
    expect(plan.first?.links[0]?.to).toBe("/analyze");
  });

  it("says when there's nothing to do over graded decisions", () => {
    const plan = buildPlan(input({ decisions: times(3, () => flop("SRP · IP · checked to", 0, { verdict: "Best" })) }));
    expect(plan.first?.text).toMatch(/3 graded decisions leave no step/);
  });

  it("has no first step once there's one, and says why each empty part is empty", () => {
    const plan = buildPlan(input({ hands: [], mistakes: [dueToday()] }));
    expect(plan.first).toBeNull();
    expect(plan.notes.leaks).toMatch(/No hands imported/);
    expect(plan.drill?.street).toBe("flop");
  });

  it("carries the queue's damaged count", () => {
    expect(buildPlan(input({ damaged: 2 })).damaged).toBe(2);
  });

  it("marks next past what's done", () => {
    const moved = { at: NOW - 1000, ok: true, moved: true } as MistakeRecord["tries"][number];
    const plan = buildPlan(input({ mistakes: [mistake({ due: NOW + 3 * DAY, tries: [moved], provenance: CHART })] }));
    expect(plan.reviews?.done).toBe(true);
    expect(plan.next?.kind).toBe("drill");
  });
});
