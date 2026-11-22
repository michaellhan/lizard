// The leak finder measured by seeded simulation through the real code (report.ts readLeaks, grade.ts grade): a made-up
// 6-max database of preflop decisions (RFI from each seat, BB defence, SB vs open, vs 3bet, the charts' kind of mix: most
// hands pure, some mixed) and flop c-bets graded by EV, played (a) by someone who draws every action from the answer's own
// mix, and (b) by someone with one real leak. (a) gives the false-alarm rate, the share of reports with any leak at all;
// (b) how many hands it takes to find the leak. The suite runs a small version; `LEAK_SIM=1` runs the measurement whose
// numbers docs/ACCURACY.md section 33 quotes.
import { describe, expect, it } from "vitest";
import type { DecisionRecord } from "@/data/db";
import { grade } from "@/grading/grade";
import { readLeaks } from "./report";

const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const SEATS = ["UTG", "HJ", "CO", "BTN", "SB", "BB"];
type Leak = { situation: string; cls: "fold" | "aggr"; by: number } | null;

/** A chart-like mix over `acts`: 70% of hands pure (one action), 30% mixed between two. */
function mixOf(r: () => number, acts: readonly string[], lean: readonly number[]): number[] {
  const pick = () => {
    let u = r();
    for (let i = 0; i < acts.length; i++) if ((u -= lean[i]!) <= 0) return i;
    return acts.length - 1;
  };
  const f = acts.map(() => 0);
  const a = pick();
  if (r() < 0.7) f[a] = 1;
  else {
    let b = pick();
    if (b === a) b = (a + 1) % acts.length;
    const w = 0.15 + 0.7 * r();
    f[a] = w;
    f[b] = 1 - w;
  }
  return f;
}

/** Your action at a mix: drawn from it, or with a leak toward a kind of action by `by` (that much of the rest moved to it). */
function play(r: () => number, acts: readonly string[], f: readonly number[], leak: Leak, situation: string): number {
  let p = [...f];
  if (leak && leak.situation === situation) {
    const i = acts.findIndex((a) => (leak.cls === "fold" ? a === "fold" : /^(raise|bet)/.test(a)));
    if (i >= 0) p = p.map((x, j) => (j === i ? x + leak.by * (1 - x) : x * (1 - leak.by)));
  }
  let u = r();
  for (let i = 0; i < p.length; i++) if ((u -= p[i]!) <= 0) return i;
  return p.length - 1;
}

let id = 0;
function decision(h: string, pos: string, situation: string, acts: readonly string[], f: number[], a: number, extra: Partial<DecisionRecord> = {}, evs: number[] | null = null): DecisionRecord {
  const g = grade({ freqs: f, evs, pot: evs ? 5.5 : 1.5 }, a);
  return {
    id: `${h}|${id++}`,
    handId: h,
    street: "preflop",
    pos,
    action: acts[a]!,
    verdict: g.verdict,
    evLossBb: g.byEv ? g.loss : null,
    lossPct: g.byEv ? g.lossPct : null,
    ...(g.byEv ? { past: g.past ?? 0 } : {}),
    source: evs ? "library" : "charts",
    label: evs ? "the flop library" : "Preflop charts",
    gradedAt: 0,
    situation,
    mix: acts.map((x, i) => [x, f[i]!, evs ? evs[i]! : null]),
    matched: acts[a]!,
    freq: f[a]!,
    ...extra,
  } as DecisionRecord;
}

/** `hands` made-up hands' decisions, played with `leak` (none: from the answer's own mix). */
function database(seed: number, hands: number, leak: Leak): DecisionRecord[] {
  const r = rng(seed);
  const out: DecisionRecord[] = [];
  for (let k = 0; k < hands; k++) {
    const h = `s${seed}h${k}`;
    const pos = SEATS[Math.floor(r() * 6)]!;
    const at = (situation: string, acts: string[], lean: number[], extra: Partial<DecisionRecord> = {}) => {
      const f = mixOf(r, acts, lean);
      out.push(decision(h, pos, situation, acts, f, play(r, acts, f, leak, situation), extra));
    };
    const u = r();
    if (pos === "BB") at("BB defence", ["fold", "call", "raise to 10"], [0.45, 0.4, 0.15], { firstIn: true, callers: 0 });
    else if (pos === "SB" && u < 0.5) at("SB vs open", ["fold", "call", "raise to 11"], [0.6, 0.15, 0.25], { firstIn: true, callers: 0 });
    else if (u < 0.75) {
      at("RFI", ["fold", "raise to 2.5"], [0.7, 0.3], { firstIn: true });
      if (r() < 0.12) at("vs 3bet", ["fold", "call", "raise to 22"], [0.5, 0.35, 0.15], { firstIn: false });
    } else at("vs open", ["fold", "call", "raise to 8"], [0.75, 0.12, 0.13], { firstIn: true, callers: 0 });
    // a flop c-bet in about one hand in six, graded by EV: what the mix plays is worth the same, the rest less
    if (r() < 0.16) {
      const acts = ["check", "bet 1.8"];
      const f = mixOf(r, acts, [0.5, 0.5]);
      const evs = f.map((x) => (x > 0 ? 2 : 1.6));
      const a = play(r, acts, f, leak, "c-bet");
      out.push(decision(h, pos, "SRP · IP · checked to", acts, f, a, { street: "flop", role: "PFR", facing: false, multi: false, ip: true, pot: 5.5 }, evs));
    }
  }
  return out;
}

/** Of `n` databases, how many show any leak; with `want`, how many find that one (by key). */
function rate(n: number, hands: number, leak: Leak, want?: (key: string) => boolean, seed0 = 1): { any: number; found: number } {
  let [any, found] = [0, 0];
  for (let s = 0; s < n; s++) {
    const ls = readLeaks(database(seed0 + s, hands, leak)).leaks;
    if (ls.length) any++;
    if (want && ls.some((l) => want(l.key))) found++;
  }
  return { any: any / n, found: found / n };
}

describe("the leak finder, by seeded simulation", () => {
  it("rarely calls a leak where play is the answer's own mix", () => {
    // (40 databases of 1,500 hands; the measurement runs 400 at each size)
    const { any } = rate(40, 1500, null);
    expect(any).toBeLessThanOrEqual(0.1);
  }, 60_000);

  it("finds a BB that folds 20% more of what it should play, in a few thousand hands", () => {
    const leak: Leak = { situation: "BB defence", cls: "fold", by: 0.2 };
    const { found } = rate(20, 3000, leak, (k) => k.startsWith("BB defence"));
    expect(found).toBeGreaterThanOrEqual(0.8);
  }, 60_000);

  it.runIf(process.env.LEAK_SIM === "1")("measures the false-alarm rate and the hands it takes to find a leak", () => {
    const lines: string[] = [];
    for (const hands of [500, 1500, 5000]) {
      const t = rate(400, hands, null, undefined, 1000);
      lines.push(`no leak, ${hands} hands: a false leak in ${(t.any * 100).toFixed(1)}% of 400 databases`);
    }
    const cases: [string, Leak, (k: string) => boolean][] = [
      ["BB folds 20% more", { situation: "BB defence", cls: "fold", by: 0.2 }, (k) => k.startsWith("BB defence")],
      ["BB folds 10% more", { situation: "BB defence", cls: "fold", by: 0.1 }, (k) => k.startsWith("BB defence")],
      ["opens (RFI) 15% more", { situation: "RFI", cls: "aggr", by: 0.15 }, (k) => /^(Open \(RFI\)|RFI|VPIP|PFR)/.test(k)],
      ["c-bets 30% more (EV)", { situation: "c-bet", cls: "aggr", by: 0.3 }, (k) => /c-bet|Flop · SRP/.test(k)],
    ];
    for (const [name, leak, want] of cases)
      for (const hands of [500, 1500, 5000]) {
        const t = rate(100, hands, leak, want, 5000);
        lines.push(`${name}, ${hands} hands: found in ${(t.found * 100).toFixed(0)}% of 100 databases`);
      }
    console.log(lines.join("\n"));
  }, 600_000);
});
