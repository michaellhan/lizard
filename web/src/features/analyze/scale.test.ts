/// <reference types="node" />
// Analyze at 50,000 hands: what runs when a filter moves, over a generated set of 50,000 hands and 150,000 decisions,
// and the one pass that reads the histories, which runs once and in chunks. The limits are loose, for a loaded machine:
// they catch a pass gone quadratic, not a slow day. LIZARD_SCALE_LOG names a file to write the timings to, and
// LIZARD_SCALE_READ the number of histories to read in the last test (5,000 otherwise).
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { DecisionRecord, HandRecord } from "@/data/db";
import { importHand } from "@/hh/replay";
import { filterHands, lostByHand, recordOf } from "./analyze";
import { BREAKDOWNS, breakdown } from "./breakdown";
import { buildPlan } from "@/features/plan/plan";
import { lostByKind, report } from "./report";
import { answersOf, tallies, trendOf } from "./trend";
import { sessionsOf } from "./sessions";
import { handStats, readStats, tallyStats, type HandStats } from "./stats";
import { handWin, tallyWinnings, extent } from "./winnings";

const N = 50_000;
const LIMIT_MS = 6000;
const HH = (f: string) => readFileSync(join(process.cwd(), "..", "solver", "tests", "data", "hh", f), "utf8");
const FILES = ["stars_6max_srp.txt", "stars_3bet_pot.txt", "stars_9max_mtt_ante.txt", "gg_limped_multiway.txt", "stars_heads_up.txt", "stars_zoom_names.txt"];
const IMP = { id: "i", name: "i", at: 1 };
const BASE = FILES.map((f) => recordOf(HH(f), importHand(HH(f)), IMP));
const STATS = BASE.map((h) => handStats(importHand(h.text), h.playedFor, h.text)!);
const WINS = BASE.map((h) => handWin(h.text));

const T0 = Date.UTC(2024, 0, 1);
const SITES = ["PokerStars", "GGPoker"];
const STAKES = ["$1", "$2", "$5"];
const hands: HandRecord[] = Array.from({ length: N }, (_, i) => {
  const b = BASE[i % BASE.length]!;
  const at = T0 + i * 40_000;
  return { ...b, id: `h${i}`, number: String(i), site: SITES[i % 2]!, bb: STAKES[i % 3]!, playedAt: at, played: new Date(at).toISOString().slice(0, 16).replace("T", " ") };
});
const byId = new Map(hands.map((h) => [h.id, h]));
const SIT = ["RFI", "vs open", "BB defence", "vs 3bet"];
const VERDICTS = ["Best", "Best", "Correct", "Inaccuracy", "Mistake", "Blunder", "Not graded"];
const STREETS = ["preflop", "flop", "turn"];
const decisions: DecisionRecord[] = Array.from({ length: N * 3 }, (_, i) => {
  const h = hands[Math.floor(i / 3)]!;
  const street = STREETS[i % 3]!;
  const stats = STATS[Math.floor(i / 3) % STATS.length]!;
  const move = stats.moves.find((m) => m.street === street) ?? stats.moves[0];
  const verdict = VERDICTS[i % VERDICTS.length]!;
  return {
    id: `${h.id}|${street}|${move?.i ?? 0}`,
    handId: h.id,
    street,
    i: move?.i ?? 0,
    pos: h.hero,
    action: i % 2 ? "bet 3" : "fold",
    verdict,
    evLossBb: street === "preflop" ? null : (i % 7) / 10,
    lossPct: street === "preflop" ? null : i % 7,
    pot: 10,
    source: street === "preflop" ? "charts" : "library",
    label: "x",
    gradedAt: 0,
    situation: street === "preflop" ? SIT[i % SIT.length] : "SRP · IP · checked to",
    role: "PFR",
    facing: i % 2 === 0,
    multi: false,
    ip: i % 5 !== 0,
    mix: [["fold", 0.3, 0], ["call", 0.3, 0], ["bet 75%", 0.4, 0.1]],
    ...(verdict === "Not graded" ? { why: "x" } : {}),
  };
});
const facts = new Map<string, HandStats | null>(hands.map((h, i) => [h.id, STATS[i % STATS.length]!]));

function timed<T>(name: string, f: () => T): T {
  const t = performance.now();
  const out = f();
  const ms = performance.now() - t;
  if (process.env.LIZARD_SCALE_LOG) appendFileSync(process.env.LIZARD_SCALE_LOG, `${name}: ${ms.toFixed(1)} ms\n`);
  expect(ms, name).toBeLessThan(LIMIT_MS);
  return out;
}

describe("Analyze at 50,000 hands", () => {
  it("filters by date, site and stakes together, and finds the sample", { timeout: 60_000 }, () => {
    const q = new URLSearchParams({ site: "PokerStars", bb: "$1", from: "2024-01-05", to: "2024-01-20", q: "stars" });
    const lost = timed("lostByHand", () => lostByHand(decisions));
    const some = timed("filterHands with five filters", () => filterHands(hands, q, lost));
    expect(some.length).toBeGreaterThan(0);
    expect(some.length).toBeLessThan(N);
    expect(some.every((h) => h.site === "PokerStars" && h.bb === "$1")).toBe(true);
  });

  it("reports, leaks and all", { timeout: 60_000 }, () => {
    const rp = timed("report over 150,000 decisions", () => report(decisions));
    expect(rp.all.n).toBe(N * 3);
    expect(rp.freqs.length).toBeGreaterThan(0);
    timed("solver EV lost by kind", () => lostByKind(decisions, byId));
  });

  it("builds the plan, once, as the Plan page does", { timeout: 60_000 }, () => {
    const plan = timed("the plan over 150,000 decisions", () => buildPlan({ now: T0, mistakes: [], hands, decisions, sessions: [] }));
    expect(plan.first).toBeNull();
    expect(plan.drill).not.toBeNull();
  });

  it("breaks the decisions down every way", { timeout: 60_000 }, () => {
    const ctx = { hands: byId, facts };
    for (const { by } of BREAKDOWNS) {
      const b = timed(`breakdown by ${by}`, () => breakdown(decisions, by, ctx));
      expect(b.rows.reduce((n, r) => n + r.n, 0) + b.left.reduce((n, l) => n + l.n, 0), by).toBe(b.graded);
    }
  });

  it("tallies the stats and the results from what's already read, and draws a chart's bounds", { timeout: 60_000 }, () => {
    const t = timed("tallyStats", () => tallyStats(hands.map((h) => ({ id: h.id, s: facts.get(h.id)! }))));
    expect(t.hands).toBe(N);
    const w = timed("tallyWinnings", () => tallyWinnings(hands.map((h, i) => ({ h, w: WINS[i % WINS.length]! }))));
    const g = w.cash!;
    expect(g.total).toHaveLength(N - hands.filter((h) => h.tournament !== undefined).length);
    timed("the chart's bounds", () => extent([g.total, g.atSd, g.noSd, g.evRun]));
  });

  it("lists the sittings and the trend", { timeout: 60_000 }, () => {
    const sits = timed("sessionsOf", () => sessionsOf(hands));
    expect(sits.length).toBeGreaterThan(0);
    const kept = new Set(hands.map((h) => h.id));
    const answers = timed("answersOf", () => answersOf(decisions, sits, kept));
    timed("trendOf", () => trendOf(answers, answers[0]!.basis));
    timed("tallies", () => tallies(decisions, sits, kept, answers, answers[0]!.basis));
  });

  it("reads a history once: a second pass finds them all kept", { timeout: 180_000 }, async () => {
    const n = Number(process.env.LIZARD_SCALE_READ ?? 5000);
    const list = hands.slice(0, n);
    const t = performance.now();
    const steps: number[] = [];
    expect(await readStats(list, { onProgress: (x) => steps.push(x) })).toHaveLength(n);
    const first = performance.now() - t;
    const u = performance.now();
    const again: number[] = [];
    expect(await readStats(list, { onProgress: (x) => again.push(x) })).toHaveLength(n);
    const second = performance.now() - u;
    if (process.env.LIZARD_SCALE_LOG) appendFileSync(process.env.LIZARD_SCALE_LOG, `readStats of ${n}: first ${first.toFixed(0)} ms, second ${second.toFixed(1)} ms\n`);
    // it gives way every 200 hands, so the page keeps moving
    expect(steps.length).toBe(Math.floor(n / 200));
    expect(again).toEqual([]);
    expect(second).toBeLessThan(first / 5);
    expect(first / n).toBeLessThan(3);
  });
});
