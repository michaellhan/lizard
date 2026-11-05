// The history across sessions: what the share counts, a check at Fast moving nothing, blocks and the cut, and the
// comparison, chosen by size alone and no likelier to say Better than Worse when nothing changed.
import { describe, expect, it } from "vitest";
import type { DecisionRecord, HandRecord } from "@/data/db";
import { BASES, freqs, isOk, leaks, report } from "./report";
import { deepened } from "./grading";
import { sessionsOf, type Sitting } from "./sessions";
import { agreedFold, answersOf, BAR, blocks, counted, firstAnswer, gapZ, latestCut, latestThird, moreForLine, shareZ, shifts, tallies, trendOf, type Answer } from "./trend";

const T0 = Date.UTC(2026, 0, 1, 12);
const DAY = 86_400_000;
const [CHARTS, LIBRARY, , FAST, , , QUICK] = BASES as [string, string, string, string, string, string, string];
let id = 0;
const hand = (playedAt: number, over: Partial<HandRecord> = {}): HandRecord =>
  ({ id: `h${++id}`, number: String(1000 + id), site: "PokerStars", played: "", playedAt, hero: "BTN", players: 6, hole: "AhKd", board: "", bb: "$1", potType: "SRP", pot: 5, end: "showdown", decisions: 1, text: "", importId: "i", importName: "i", importedAt: 0, ...over }) as HandRecord;
const dec = (h: HandRecord, over: Partial<DecisionRecord> = {}): DecisionRecord =>
  ({ id: `${h.id}|flop|0`, handId: h.id, street: "flop", pos: "BTN", action: "check", verdict: "Best", evLossBb: 0, source: "library", label: "the flop library", situation: "SRP · IP · checked to", mix: [["check", 0.6, 1], ["bet 33%", 0.4, 1]], freq: 0.6, gradedAt: 1, ...over }) as DecisionRecord;
const kept = (hs: readonly HandRecord[]) => new Set(hs.map((h) => h.id));
const answers = (ds: readonly DecisionRecord[], hs: readonly HandRecord[], sits: Sitting[] = sessionsOf([...hs])) => answersOf(ds, sits, kept(hs));
/** `n` hands a day apart each, each its own sitting, from `start` */
const days = (n: number, start = 0) => Array.from({ length: n }, (_, k) => hand(T0 + (start + k) * DAY));
const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

describe("firstAnswer", () => {
  const read: DecisionRecord["read"] = { verdict: "Mistake", source: "solve", label: "a Quick solve", confidence: "low", triageSource: "quick", evLossBb: 2, freq: 0.1 };
  const checked = (h: HandRecord) => dec(h, { verdict: "Best", source: "solve", label: "a Fast solve", approximate: true, read, confidence: undefined });

  it("takes the read a check replaced, under the read's own basis", () => {
    const h = hand(T0);
    const d = firstAnswer(checked(h));
    expect(d).toMatchObject({ verdict: "Mistake", source: "solve", confidence: "low", evLossBb: 2, freq: 0.1, approximate: false });
    const [a] = answers([checked(h)], [h]);
    expect(a!.basis).toBe(BASES[7]);
  });

  it("lets a check at Fast move nothing: not the line, the rows or the count", () => {
    const hs = days(330);
    const cbet = { situation: "SRP · IP · checked to", role: "PFR" as const, facing: false, multi: false };
    const raw = hs.map((h, k) => dec(h, { ...cbet, action: k % 2 ? "check" : "bet 33%", verdict: k % 3 ? "Best" : "Mistake", source: "solve", label: "a Quick solve", confidence: "medium", evLossBb: k % 3 ? 0 : 1, mix: [["check", 0.5, 1], ["bet 33%", 0.5, 1]] }));
    const after = raw.map((d) => deepened(d, { ...d, verdict: "Best", confidence: undefined, label: "a Fast solve", evLossBb: 0, freq: 0.9, mix: [["check", 0.1, 1], ["bet 33%", 0.9, 1]] }));
    const [a, b] = [trendOf(answers(raw, hs), QUICK), trendOf(answers(after, hs), QUICK)];
    expect(b.points).toEqual(a.points);
    expect(b.latest).toEqual(a.latest);
    expect(b.rows).toEqual(a.rows);
    expect(a.rows!.rows.some((r) => r.kind === "freq" && r.key === "Flop c-bet")).toBe(true);
    expect(b.n).toBe(330);
    expect(trendOf(answers(after, hs), FAST).n).toBe(0);
  });

  it("leaves a read the check couldn't grade where it stood, and one no read graded out", () => {
    const h = hand(T0);
    const unread = dec(h, { read: { ...read!, verdict: "Not graded" } });
    expect(answers([unread], [h])).toEqual([]);
    expect(firstAnswer(dec(h)).verdict).toBe("Best");
  });

  it("never shows a check's mix under a read's basis: a read kept without its own leaves the frequencies, counted", () => {
    const hs = days(120);
    const cbet = { role: "PFR" as const, facing: false, multi: false, action: "bet 33%" };
    const ds = hs.map((h) => dec(h, { ...cbet, source: "solve", label: "a Fast solve", mix: [["check", 0.1, 1], ["bet 33%", 0.9, 1]], read: { verdict: "Best", source: "solve", label: "a Quick solve", confidence: "medium", triageSource: "quick", evLossBb: 0, freq: 0.5 } }));
    const t = trendOf(answers(ds, hs), QUICK);
    expect(t.rows!.noMix).toBe(120);
    expect(t.rows!.rows.some((r) => r.kind === "freq")).toBe(false);
    expect(t.rows!.rows.some((r) => r.kind === "spot")).toBe(true);
  });

  it("keeps a fold's count as the read saw it: the check's own mix can't drop it", () => {
    const h = hand(T0);
    const d = dec(h, { action: "fold", freq: 0.99, mix: [["fold", 0.99, 0], ["call", 0.01, -1]], read: { ...read!, freq: 0.6 } });
    expect(agreedFold(d)).toBe(true);
    expect(agreedFold(firstAnswer(d))).toBe(false);
  });
});

describe("the versions behind a comparison", () => {
  const A = "build:aaa/111";
  const B = "build:bbb/222";

  it("keeps a read's version as the read's, and shows a read from before versions as unknown, never the check's", () => {
    const h = hand(T0);
    const read: DecisionRecord["read"] = { verdict: "Mistake", source: "solve", label: "a Quick solve", evLossBb: 2, version: A };
    expect(firstAnswer(dec(h, { version: B, read })).version).toBe(A);
    expect(firstAnswer(dec(h, { version: B, read: { ...read, version: undefined } })).version).toBeUndefined();
    expect(firstAnswer(dec(h, { version: B })).version).toBe(B);
    expect(firstAnswer(dec(h)).version).toBeUndefined();
    // a check at Fast keeps the read's own
    const fast = dec(h, { version: B });
    expect(deepened({ ...dec(h, { version: A }) }, fast).read?.version).toBe(A);
  });

  it("says on the latest third what each side stood on", () => {
    const side = (n: number, sit: number, version?: string) => Array.from({ length: n }, () => ({ d: dec(hand(T0), { ...(version ? { version } : {}) }), sit })) as unknown as Answer[];
    const span = latestThird([...side(100, 0, A), ...side(100, 1, B)], 1).versions;
    expect(span).toMatchObject({ changed: [{ what: "solver build", before: ["aaa/111"], later: ["bbb/222"] }], unknown: [0, 0], n: [100, 100] });
    expect(latestThird([...side(100, 0), ...side(100, 1, B)], 1).versions).toMatchObject({ changed: [], unknown: [100, 0] });
    expect(latestThird([...side(100, 0, A), ...side(100, 1, A)], 1).versions.changed).toEqual([]);
  });

  it("says it row by row, of that row's decisions alone", () => {
    const rfi = (version: string) => dec(hand(T0), { version, source: "charts", street: "preflop", situation: "RFI", action: "raise to 2.5", verdict: "Best", evLossBb: null, mix: [["fold", 0.5, null], ["raise", 0.5, null]], freq: 0.5 });
    const flop = (version: string) => dec(hand(T0), { version });
    const of = (n: number, f: () => DecisionRecord) => Array.from({ length: n }, f);
    const { rows } = shifts([...of(60, () => rfi(A)), ...of(60, () => flop("library:s:1"))], [...of(60, () => rfi(B)), ...of(60, () => flop("library:s:1"))]);
    expect(rows.length).toBeGreaterThan(1);
    for (const r of rows) {
      const charts = r.kind !== "spot";
      expect(r.versions.changed.map((c) => c.what)).toEqual(charts ? ["solver build"] : []);
    }
  });

  it("keeps a row across versions, with its change: the numbers aren't hidden", () => {
    const rfi = (version: string, you: boolean) => dec(hand(T0), { version, source: "charts", street: "preflop", situation: "RFI", action: you ? "raise to 2.5" : "fold", verdict: "Best", evLossBb: null, mix: [["fold", 0.5, null], ["raise", 0.5, null]], freq: 0.5 });
    const of = (n: number, f: (k: number) => DecisionRecord) => Array.from({ length: n }, (_, k) => f(k));
    const row = shifts(of(200, (k) => rfi(A, k % 10 !== 0)), of(200, (k) => rfi(B, k % 2 === 0))).rows.find((r) => r.kind === "freq")!;
    expect(row.change).toBe("Better");
    expect(row.versions.changed).toHaveLength(1);
  });
});

describe("what the share counts", () => {
  it("leaves out a fold the answer takes, keeps an overfold and a played hand it folds", () => {
    const hs = days(4);
    const trash = { mix: [["fold", 1, null], ["raise", 0, null]] as DecisionRecord["mix"], source: "charts", street: "preflop", situation: "RFI" };
    const ds = [
      dec(hs[0]!, { ...trash, action: "fold", freq: 1 }),
      dec(hs[1]!, { ...trash, action: "fold", freq: 0.5, verdict: "Correct", mix: [["fold", 0.5, null], ["raise", 0.5, null]] }),
      dec(hs[2]!, { ...trash, action: "raise to 2.5", freq: 0, verdict: "Mistake" }),
      dec(hs[3]!, { ...trash, action: "fold", freq: 0.96 }),
    ];
    expect(counted(answers(ds, hs), CHARTS).map((a) => a.h.id)).toEqual([hs[1]!.id, hs[2]!.id, hs[3]!.id]);
  });

  it("keeps a basis's line to its own decisions: a preflop-only session moves no other", () => {
    const hs = days(330);
    const extra = days(100, 400);
    const ds = hs.map((h, k) => dec(h, { verdict: k % 2 ? "Best" : "Mistake" }));
    const pre = extra.map((h) => dec(h, { source: "charts", street: "preflop", situation: "RFI", verdict: "Blunder" }));
    const a = trendOf(answers(ds, hs), LIBRARY);
    const b = trendOf(answers([...ds, ...pre], [...hs, ...extra]), LIBRARY);
    expect(b.points).toEqual(a.points);
    expect(b.latest).toEqual(a.latest);
  });

  it("leaves undated hands out of the trend, and in their row", () => {
    const hs = [...days(2), hand(0)];
    const all = answers(hs.map((h) => dec(h)), hs);
    expect(all).toHaveLength(3);
    expect(counted(all, LIBRARY)).toHaveLength(2);
    const sits = sessionsOf(hs);
    expect(tallies(hs.map((h) => dec(h)), sits, kept(hs), all, LIBRARY).map((t) => t.n)).toEqual([1, 1, 1]);
  });

  it("counts only what the filters kept", () => {
    const hs = days(3);
    const sits = sessionsOf(hs);
    const k = new Set([hs[0]!.id]);
    expect(answersOf(hs.map((h) => dec(h)), sits, k)).toHaveLength(1);
    expect(tallies(hs.map((h) => dec(h)), sits, k, answersOf(hs.map((h) => dec(h)), sits, k), LIBRARY).map((t) => t.graded)).toEqual([1, 0, 0]);
  });

  it("gives nothing, not a zero, where nothing is graded", () => {
    const hs = days(3);
    const t = trendOf(answers([], hs), LIBRARY);
    expect(t).toMatchObject({ n: 0, points: [], latest: null, rows: null });
    expect(tallies([], sessionsOf(hs), kept(hs), [], null).every((x) => x.graded === 0 && x.n === 0)).toBe(true);
  });
});

describe("blocks", () => {
  const list = (n: number) => answers(days(n).map((h) => dec(h)), days(0)).concat(days(n).map((h, k) => ({ d: dec(h, { verdict: k % 2 ? "Best" : "Mistake" }), h, basis: LIBRARY, sit: k })));
  const sizes = (n: number) => blocks(list(n)).map((b) => b.n);

  it("makes blocks of 100, then of a twentieth of the decisions, the remainder in the last", () => {
    expect(sizes(99)).toEqual([]);
    expect(sizes(100)).toEqual([100]);
    expect(sizes(250)).toEqual([100, 150]);
    expect(sizes(399)).toEqual([100, 100, 199]);
    expect(sizes(2000)).toEqual(Array(20).fill(100));
    const big = sizes(2023);
    expect(big).toHaveLength(19);
    expect(new Set(big.slice(0, -1))).toEqual(new Set([102]));
    expect(big.at(-1)).toBe(2023 - 18 * 102);
  });

  it("gives each block its share, range and dates", () => {
    const [b] = blocks(list(300));
    expect(b).toMatchObject({ n: 100, ok: 50, share: 0.5 });
    expect(b!.range[0]).toBeLessThan(0.5);
    expect(b!.range[1]).toBeGreaterThan(0.5);
    expect(b!.to).toBeGreaterThan(b!.from);
  });

  it("says how many more make a line", () => {
    expect(moreForLine(0)).toBe(300);
    expect(moreForLine(299)).toBe(1);
    expect(moreForLine(300)).toBe(0);
  });
});

describe("the latest third", () => {
  const sits = (...ns: number[]) => ns.flatMap((n, sit) => Array.from({ length: n }, () => ({ sit })));

  it("cuts at the sitting nearest two thirds of the way, whole", () => {
    expect(latestCut(sits(50, 50, 50))).toBe(2);
    expect(latestCut(sits(10, 10, 10, 10, 10, 10))).toBe(4);
    expect(latestCut(sits(100, 10, 10))).toBe(1);
    expect(latestCut([{ sit: 3 }, { sit: 3 }])).toBeNull();
    expect(latestCut([])).toBeNull();
  });

  it("calls a clear gap, says none under the bar, and nothing under 100 a side", () => {
    const side = (n: number, ok: number, sit: number) => Array.from({ length: n }, (_, k) => ({ d: dec(hand(T0), { verdict: k < ok ? "Best" : "Mistake" }), sit })) as unknown as Answer[];
    expect(latestThird([...side(400, 240, 0), ...side(200, 160, 1)], 1)).toMatchObject({ n1: 400, n2: 200, enough: true, change: "Better" });
    expect(latestThird([...side(400, 320, 0), ...side(200, 120, 1)], 1).change).toBe("Worse");
    expect(latestThird([...side(400, 240, 0), ...side(200, 126, 1)], 1)).toMatchObject({ enough: true, change: null });
    expect(latestThird([...side(400, 240, 0), ...side(99, 90, 1)], 1)).toMatchObject({ enough: false, change: null });
  });

  it("works the two shares' z by hand", () => {
    expect(shareZ(60, 100, 80, 100)).toBeCloseTo(0.2 / Math.sqrt(0.7 * 0.3 * 0.02), 9);
    expect(shareZ(0, 100, 0, 100)).toBeNull();
    expect(shareZ(100, 100, 100, 100)).toBeNull();
  });

  it("is not moved by sittings it doesn't count, nor by which hands went well", () => {
    const hs = days(600);
    const ds = hs.map((h, k) => dec(h, { verdict: k % 5 ? "Best" : "Mistake" }));
    const best = hs.map((h) => dec(h));
    expect(trendOf(answers(ds, hs), LIBRARY).latest?.at).toBe(trendOf(answers(best, hs), LIBRARY).latest?.at);
  });
});

describe("shifts", () => {
  const rfi = (h: HandRecord, you: boolean, ok = true) =>
    dec(h, { source: "charts", street: "preflop", situation: "RFI", action: you ? "raise to 2.5" : "fold", verdict: ok ? "Best" : "Mistake", evLossBb: null, mix: [["fold", 0.5, null], ["raise", 0.5, null]], freq: 0.5 });
  const spot = (h: HandRecord, ok: boolean, loss: number) => dec(h, { verdict: ok ? "Best" : "Mistake", evLossBb: loss });
  const many = (n: number, f: (h: HandRecord, k: number) => DecisionRecord) => Array.from({ length: n }, (_, k) => f(hand(T0), k));

  it("reads each side as the Report does", () => {
    const [a, b] = [many(60, (h, k) => rfi(h, k % 3 === 0)), many(40, (h, k) => rfi(h, k % 2 === 0))];
    const { rows } = shifts(a, b);
    const f = rows.find((r) => r.kind === "freq" && r.key === "Open (RFI)")!;
    const [ra, rb] = [freqs(a)[0]!, freqs(b)[0]!];
    expect(f).toMatchObject({ n: [ra.n, rb.n], you: [ra.you, rb.you], gto: [ra.gto, rb.gto] });
    const g = rows.find((r) => r.kind === "pf" && r.key === "RFI")!;
    expect(g.kind === "pf" && g.share).toEqual([report(a).byPf[0]!.ok / 60, report(b).byPf[0]!.ok / 40]);
  });

  it("sets a row with a falling n aside as too few, counted", () => {
    const { rows, tooFew } = shifts(many(60, (h) => rfi(h, true)), many(29, (h) => rfi(h, true)));
    expect(rows).toEqual([]);
    expect(tooFew).toBe(2);
    expect(shifts(many(60, (h) => rfi(h, true)), []).tooFew).toBe(2);
  });

  it("gives no verdict with no spread", () => {
    const { rows } = shifts(many(60, (h) => spot(h, true, 0)), many(60, (h) => spot(h, true, 0)));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ z: null, change: null });
    const open = (y: boolean) => many(50, (h) => rfi(h, y));
    expect(gapZ(freqs(open(true))[0]!, freqs(open(true))[0]!)).toBeNull();
  });

  it("calls a frequency that came nearer the answer Better, and one that went off it Worse", () => {
    const off = many(200, (h, k) => rfi(h, k % 10 !== 0));
    const near = many(200, (h, k) => rfi(h, k % 2 === 0));
    const row = (a: DecisionRecord[], b: DecisionRecord[]) => shifts(a, b).rows.find((r) => r.kind === "freq")!;
    expect(row(off, near).change).toBe("Better");
    expect(row(near, off).change).toBe("Worse");
  });

  it("spreads a frequency's change over your action, not its gap: a small gap isn't a sure one", () => {
    // (played 60% then 50% against 50%, over 100 hands each: 1.42 standard errors, not the 3.2 a gap's own spread says)
    const you = (n: number, k: number) => many(n, (h, i) => rfi(h, i < k));
    const z = gapZ(freqs(you(100, 60))[0]!, freqs(you(100, 50))[0]!)!;
    expect(z).toBeCloseTo(0.1 / Math.sqrt(0.55 * 0.45 * 0.02), 6);
    expect(z).toBeLessThan(BAR);
  });

  it("doesn't call a side at 0% a change on its want of spread alone", () => {
    // (6 of 60 then 0 of 30, against an answer of 0%: Fisher's p is .17)
    const rare = (h: HandRecord, you: boolean) => dec(h, { source: "charts", street: "preflop", situation: "RFI", action: you ? "raise to 2.5" : "fold", evLossBb: null, mix: [["fold", 1, null], ["raise", 0, null]], freq: you ? 0 : 1 });
    const z = gapZ(freqs(many(60, (h, k) => rare(h, k < 6)))[0]!, freqs(many(30, (h) => rare(h, false)))[0]!)!;
    expect(z).toBeCloseTo(1.79, 2);
    expect(z).toBeLessThan(BAR);
  });

  it("orders changes first, the widest first, and marks a row that's a leak now", () => {
    const worse = shifts(many(60, (h) => spot(h, true, 0)), many(60, (h, k) => spot(h, k % 2 === 0, 2)));
    expect(worse.rows[0]).toMatchObject({ kind: "spot", change: "Worse", leak: true, avg: [0, 2] });
    expect(leaks(many(60, (h, k) => spot(h, k % 2 === 0, 2)))[0]).toMatchObject({ kind: "spot" });
    const mixed = shifts(
      [...many(60, (h) => dec(h, { situation: "A" })), ...many(60, (h, k) => dec(h, { situation: "B", verdict: k % 2 ? "Best" : "Mistake" }))],
      [...many(60, (h) => dec(h, { situation: "A" })), ...many(60, (h) => dec(h, { situation: "B" }))],
    );
    expect(mixed.rows.map((r) => r.change)).toEqual(["Better", null]);
  });

  it("is no likelier to say Better than Worse, and rarely either, when nothing changed", () => {
    const r = rng(7);
    let [better, worse, over, rows] = [0, 0, 0, 0];
    for (let run = 0; run < 300; run++) {
      const side = (n: number) => many(n, (h) => rfi(h, r() < 0.55, r() < 0.8));
      const out = shifts(side(120), side(60)).rows;
      for (const x of out) {
        rows++;
        if (x.change === "Better") better++;
        if (x.change === "Worse") worse++;
        if (x.change?.startsWith("Now")) over++;
      }
    }
    expect(rows).toBe(600);
    expect(better + worse + over).toBeLessThan(rows * 0.03);
    expect(Math.abs(better - worse)).toBeLessThanOrEqual(Math.max(5, (better + worse) * 0.8));
  });

  it("spreads a frequency over your action against each hand's own answer: hands dealt moving the answer aren't a change", () => {
    const r = rng(41);
    // (the answer pure by hand, half and half, and you at 85% of every hand: 14% of rows called on your action's spread alone)
    const open = (h: HandRecord, you: boolean, gto: number) => dec(h, { source: "charts", street: "preflop", situation: "RFI", action: you ? "raise to 2.5" : "fold", evLossBb: null, mix: [["fold", 1 - gto, null], ["raise", gto, null]], freq: 0.5 });
    const side = (n: number) => many(n, (h) => open(h, r() < 0.85, r() < 0.5 ? 1 : 0));
    let called = 0;
    const RUNS = 600;
    for (let run = 0; run < RUNS; run++) {
      const z = gapZ(freqs(side(120))[0]!, freqs(side(60))[0]!);
      if (z != null && Math.abs(z) >= BAR) called++;
    }
    expect(called / RUNS).toBeLessThan(0.025);
    // a chart of 25% opens, every one of them made: 120 of 300 opened, then 48 of 160, which your action's spread can't call
    const chart = (n: number, opens: number, more: number) => many(n, (h, k) => open(h, k < opens + more, k < opens ? 1 : 0));
    const row = shifts(chart(300, 75, 45), chart(160, 40, 8)).rows.find((x) => x.kind === "freq")!;
    expect(row).toMatchObject({ you: [0.4, 0.3], gto: [0.25, 0.25], change: "Better" });
    expect(row.z).toBeGreaterThan(BAR);
    // nothing of yours varied: only the hands dealt moved the gap
    const always = (n: number, opens: number) => many(n, (h, k) => open(h, true, k < opens ? 1 : 0));
    expect(gapZ(freqs(always(100, 20))[0]!, freqs(always(100, 80))[0]!)).toBeNull();
  });

  it("says a frequency is now on the other side of the answer, not that nothing changed, ranked by the swing", () => {
    const side = (n: number, k: number) => many(n, (h, i) => rfi(h, i < k));
    const freq = (a: DecisionRecord[], b: DecisionRecord[]) => shifts(a, b).rows.find((x) => x.kind === "freq")!;
    const row = freq(side(300, 60), side(150, 120));
    expect(row).toMatchObject({ you: [0.2, 0.8], gto: [0.5, 0.5], change: "Now over the answer" });
    expect(row.z!).toBeCloseTo(shareZ(60, 300, 120, 150)!, 6);
    expect(row.z!).toBeGreaterThan(12);
    expect(freq(side(300, 240), side(150, 30)).change).toBe("Now under the answer");
    // a crossing too small to tell, and a move on one side of the answer, stay as they were
    expect(freq(side(30, 13), side(30, 17))).toMatchObject({ you: [13 / 30, 17 / 30], change: null });
    expect(freq(side(300, 60), side(150, 60)).change).toBe("Better");
  });

  describe("the other side of the answer, when the answer moves too", () => {
    /** `n` decisions, the chart opening the first `opens`, of which you open `kept`, and `more` of the rest */
    const chart = (n: number, opens: number, kept: number, more: number) =>
      many(n, (h, k) => {
        const on = k < opens;
        const you = on ? k < kept : k - opens < more;
        return dec(h, { source: "charts", street: "preflop", situation: "RFI", action: you ? "raise to 2.5" : "fold", evLossBb: null, mix: [["fold", on ? 0 : 1, null], ["raise", on ? 1 : 0, null]], freq: 0.5 });
      });
    const row = (a: DecisionRecord[], b: DecisionRecord[]) => shifts(a, b).rows.find((x) => x.kind === "freq")!;

    it("says where you stand, whoever moved, the row showing both answers", () => {
      expect(row(chart(300, 90, 45, 0), chart(150, 45, 45, 23))).toMatchObject({ you: [0.15, 68 / 150], gto: [0.3, 0.3], change: "Now over the answer" });
      // (a player a little over an answer that moved, a little under the next)
      expect(row(chart(1000, 250, 250, 80), chart(500, 375, 350, 0))).toMatchObject({ you: [0.33, 0.7], gto: [0.25, 0.75], change: "Now under the answer" });
      // (an answer that crossed a player who held still)
      expect(row(chart(300, 120, 90, 60), chart(150, 90, 45, 30))).toMatchObject({ you: [0.5, 0.5], gto: [0.4, 0.6], change: "Now under the answer" });
    });

    it("says nothing of a side under five points off, however clear the swing: a chart followed closely, the answer moving", () => {
      expect(row(chart(300, 90, 90, 1), chart(150, 90, 89, 0)).change).toBeNull();
      expect(row(chart(300, 75, 75, 3), chart(150, 120, 117, 0)).change).toBeNull();
      expect(row(chart(1000, 250, 249, 0), chart(500, 398, 398, 4)).change).toBeNull();
    });

    it("isn't said of one policy met with another deal where it stays near the answer", () => {
      const r = rng(59);
      const policy = (n: number, m: number) => many(n, (h) => {
        const on = r() < m;
        return dec(h, { source: "charts", street: "preflop", situation: "RFI", action: r() < (on ? 0.9 : 0.05) ? "raise to 2.5" : "fold", evLossBb: null, mix: [["fold", on ? 0 : 1, null], ["raise", on ? 1 : 0, null]], freq: 0.5 });
      });
      for (const [m1, m2, n1, n2] of [[0.28, 0.45, 300, 150], [0.28, 0.79, 120, 60], [0.25, 0.75, 300, 150]] as const) {
        let now = 0;
        for (let run = 0; run < 150; run++) if (row(policy(n1, m1), policy(n2, m2)).change?.startsWith("Now")) now++;
        // (what's left is a side that really was five points off by chance, as the row shows)
        expect(now).toBeLessThanOrEqual(8);
      }
    });
  });

  it("keeps a rare action's rows honest too: an answer away from you, unequal sides, Better no likelier than Worse", () => {
    const r = rng(23);
    for (const [you, gto] of [[0.1, 0], [0.9, 1], [0.1, 0.01], [0.3, 0.6]] as const) {
      let [better, worse] = [0, 0];
      const RUNS = 4000;
      for (let run = 0; run < RUNS; run++) {
        const row = (n: number) => {
          let k = 0;
          for (let i = 0; i < n; i++) if (r() < you) k++;
          return { label: "x", cls: "aggr" as const, n, you: k / n, gto, sq: (k / n) * (1 - 2 * gto) + gto * gto };
        };
        const z = gapZ(row(60), row(30));
        if (z != null && z >= BAR) better++;
        if (z != null && z <= -BAR) worse++;
      }
      expect(better / RUNS).toBeLessThan(0.012);
      expect(worse / RUNS).toBeLessThan(0.012);
    }
  });
});

describe("the trend as a whole", () => {
  it("splits the compared rows at the verdict's cut, clear folds kept in", () => {
    const hs = days(300);
    const ds = hs.map((h) => dec(h, { action: "fold", freq: 0.5 }));
    ds[0] = dec(hs[0]!, { action: "fold", freq: 1, mix: [["fold", 1, 0]] });
    const t = trendOf(answers(ds, hs), LIBRARY);
    expect(t.n).toBe(299);
    expect(t.latest!.n1 + t.latest!.n2).toBe(299);
    const row = t.rows!.rows.find((r) => r.kind === "spot")!;
    expect(row.n[0] + row.n[1]).toBe(300);
    expect(isOk(ds[0]!)).toBe(true);
  });

  it("sees a real change and calls it, from the shares alone", () => {
    const hs = days(900);
    const r = rng(11);
    const ds = hs.map((h, k) => dec(h, { verdict: r() < (k < 600 ? 0.6 : 0.8) ? "Best" : "Mistake" }));
    const t = trendOf(answers(ds, hs), LIBRARY);
    expect(t.latest).toMatchObject({ change: "Better", enough: true });
    expect(t.points.length).toBeGreaterThanOrEqual(3);
  });
});
