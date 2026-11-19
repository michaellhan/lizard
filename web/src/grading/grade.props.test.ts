// Invariants of the one grading rule (gradeAnswer) and the words printed beside it (whyText, lossWords), over seeded
// random and edge-case answers of every kind a surface grades against: each `it` is one thing a player would notice
// broken. (Adapted from the grading audit of 2026-11-18: docs/ACCURACY.md section 27.)
import { describe, expect, it } from "vitest";
import {
  actionNoise,
  answerNoise,
  capReason,
  CLEAR_PCT,
  FREQ_TIE,
  gradeAnswer,
  INACCURACY_PCT,
  lossWords,
  MISTAKE_PCT,
  MIX,
  RARE,
  scored,
  TOL,
  whyText,
  type AnswerBasis,
  type DecisionSpot,
  type Grade,
} from "./grade";

type Case = { spot: Pick<DecisionSpot, "freqs" | "evs" | "pot">; basis: AnswerBasis };

function* cases(n = 12000, seed = 1): Generator<Case> {
  let s = seed;
  const r = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)]!;
  for (let i = 0; i < n; i++) {
    const k = 1 + Math.floor(r() * 4);
    let w = Array.from({ length: k }, () => (r() < 0.35 ? 0 : -Math.log(r() + 1e-12)));
    const t = w.reduce((a, b) => a + b, 0) || 1;
    w = w.map((x) => x / t);
    if (!w.some((x) => x > 0)) w[0] = 1;
    // (the engine's 0.001, the library's 1%, a stored turn's 5%, the charts' halves)
    const q = pick([1000, 100, 20, 2]);
    const freqs = w.map((x) => Math.round(x * q) / q);
    const pot = pick([1.5, 4, 5.5, 13, 20, 34, 100]);
    const base = (r() - 0.3) * pot;
    const evs = r() < 0.2 ? null : freqs.map(() => Math.round((base - (r() < 0.5 ? r() * 0.03 : r() * 0.2 * pot)) * 100) / 100);
    const source = evs ? pick(["live", "library", "preflop-solve", "plo-river", undefined]) : pick(["charts", "library-turn"]);
    const basis: AnswerBasis = { ...(source ? { source } : {}) };
    if (source === "live" || source === "library" || source === "plo-river") {
      const expl = pick([undefined, 0.2, 1, 4, 12]);
      if (expl !== undefined) {
        basis.exploitabilityPct = expl;
        basis.band = expl < 3 ? "converged" : expl < 10 ? "fair" : "rough";
      }
    }
    if (source === "library" && r() < 0.5) basis.flopPot = pot * pick([1, 0.6]);
    if (r() < 0.05) basis.leans = true;
    if (evs && r() < 0.1) {
      basis.rough = freqs.map((f) => f < 0.01 && r() < 0.5);
      if (r() < 0.5) basis.iterations = pick([60, 150, 300, 800, 2000]);
    }
    // (the charts' play beside the preflop solve's: grade.ts CHART_PARTS)
    if (source === "preflop-solve" && r() < 0.5) {
      basis.chart = freqs.map(() => (r() < 0.1 ? null : pick([0, 0.005, 0.0949, 0.0951, 0.1, 0.3, 0.6, 0.97, 1])));
      if (r() < 0.3) basis.chartSource = pick(["charts", "push-fold"]);
      if (r() < 0.2) basis.players = pick([2, 6]);
    }
    yield { spot: { freqs, evs, pot }, basis };
  }
}

const NAMES = ["a0", "a1", "a2", "a3"];
/** The first few answers where `f` names a broken invariant. */
const broken = (f: (c: Case, g: Grade, why: string, a: number) => string | null) => {
  const bad: string[] = [];
  for (const c of cases())
    for (let a = 0; a < c.spot.freqs.length; a++) {
      const g = gradeAnswer(c.spot, a, c.basis);
      const why = whyText(g, NAMES, c.spot.freqs);
      const said = f(c, g, why, a);
      if (said && bad.length < 3) bad.push(`${said}: ${JSON.stringify(c)} a=${a} -> ${g.verdict} "${why}"`);
    }
  return bad;
};
const tie = (c: Case) => Math.max(TOL, answerNoise(c.basis, c.spot.pot));
/** What the verdict allows action `a`: the answer's noise, and a rough EV's measured error on top (actionNoise). */
const allow = (c: Case, a: number) => {
  const { noise, extra } = actionNoise(c.basis, c.spot.pot, a);
  return noise + extra;
};
const pct1 = (x: number) => Math.round(x * 10) / 10;
const shown = (f: number) => Math.round(f * 1000) / 10;

describe("the verdict and the best", () => {
  it("a Best never names another action best", () => {
    expect(broken((_c, g, _w, a) => (g.verdict === "Best" && g.best !== a ? "Best names another" : null))).toEqual([]);
  });

  it("the best is within the answer's noise of the top EV", () => {
    expect(broken((c, g) => (c.spot.evs && Math.max(...c.spot.evs) - c.spot.evs[g.best]! > tie(c) + 1e-9 ? "best past the noise" : null))).toEqual([]);
  });

  it("another action named best is never one the answer doesn't play where one it plays is within the noise of the top", () => {
    // (your own pick at the top EV, to TOL, is your best however rarely it's played)
    expect(
      broken((c, g, _w, a) => {
        const evs = c.spot.evs;
        if (!evs || g.best === a || c.spot.freqs[g.best]! > 0) return null;
        const top = Math.max(...evs);
        return evs.some((e, i) => top - e <= tie(c) && c.spot.freqs[i]! > 0.0005) ? "best never played" : null;
      }),
    ).toEqual([]);
  });

  it("without EVs, actions tied on frequency are all Best (a 50/50 chart hand)", () => {
    expect(broken((c, g, _w, a) => (!g.byEv && g.verdict !== "Best" && Math.max(...c.spot.freqs) - c.spot.freqs[a]! <= FREQ_TIE ? "tie graded below Best" : null))).toEqual([]);
  });

  it("a loss within the answer's noise (with a rough EV's error on top) is never graded below Correct", () => {
    expect(broken((c, g, _w, a) => (g.byEv && !g.ok && g.loss <= allow(c, a) ? "below Correct within the noise" : null))).toEqual([]);
  });

  it("a gap clearly past the noise on an action the hand doesn't play is never Best or Correct", () => {
    expect(
      broken((c, g, _w, a) => {
        if (!g.byEv || g.best === a || shown(c.spot.freqs[a]!) >= MIX * 100) return null;
        const past = g.loss - allow(c, a);
        return g.ok && past >= 0.01 && pct1((past / c.spot.pot) * 100) >= 0.1 ? "a clear miss graded OK" : null;
      }),
    ).toEqual([]);
  });

  it("the verdict below Correct is the size of the loss past the noise, at the precision shown", () => {
    expect(
      broken((_c, g) => {
        if (!g.byEv || g.ok) return null;
        const p = pct1(g.pastPct ?? 0);
        if (p <= 0 && !g.capped) return "a miss with nothing past the noise";
        const want = p < INACCURACY_PCT ? "Inaccuracy" : p < MISTAKE_PCT ? "Mistake" : "Blunder";
        return g.verdict === want || (g.capped && g.verdict === "Inaccuracy") ? null : `${g.verdict} for ${p}% past the noise`;
      }),
    ).toEqual([]);
  });

  it("where the answer's error can't be measured the verdict stops at Inaccuracy, says why, and keeps the loss as measured, short of a clear blunder", () => {
    expect(
      broken((c, g, _w, a) => {
        if (!capReason(c.basis, a, g.byEv)) return null;
        if (g.verdict === "Blunder" && pct1(g.pastPct ?? 0) >= CLEAR_PCT) return g.clearWhy ? null : "a clear blunder without its reason";
        if (g.verdict === "Mistake" || g.verdict === "Blunder") return "condemned on an unmeasured answer";
        return g.capped && !g.capWhy ? "capped without a reason" : null;
      }),
    ).toEqual([]);
  });

  it("the charts' play beside the preflop solve's only softens a verdict, and only where they play the move MIX or more", () => {
    const rank = (v: string) => ["Best", "Correct", "Inaccuracy", "Mistake", "Blunder"].indexOf(v);
    expect(
      broken((c, g, _w, a) => {
        if (!c.basis.chart) return null;
        const alone = { ...c.basis };
        delete alone.chart;
        delete alone.chartSource;
        const h = gradeAnswer(c.spot, a, alone);
        if (rank(g.verdict) > rank(h.verdict)) return `${g.verdict} beside the charts, ${h.verdict} without them`;
        if (g.loss !== h.loss || g.past !== h.past || g.noise !== h.noise) return "the charts moved the EV lost";
        const x = c.basis.chart[a];
        const plays = typeof x === "number" && Math.round(x * 1000) / 1000 >= MIX;
        if (!plays && JSON.stringify(g) !== JSON.stringify(h)) return "a move the charts play under MIX graded differently";
        return null;
      }),
    ).toEqual([]);
  });

  it("a clear blunder, CLEAR_PCT of the pot or more past the noise, is a Blunder whatever answered", () => {
    expect(broken((c, g, _w, a) => (g.byEv && g.verdict !== "Blunder" && pct1(((g.loss - allow(c, a)) / c.spot.pot) * 100) >= CLEAR_PCT ? `${g.verdict} for a clear blunder` : null))).toEqual([]);
  });
});

describe("the words beside it", () => {
  it("a grade below Correct never says the hand plays it MIX% or more", () => {
    expect(broken((_c, g, why) => { const m = /only ([\d.]+)%/.exec(why); return m && !g.ok && Number(m[1]) >= MIX * 100 ? "says MIX or more" : null; })).toEqual([]);
  });

  it("a frequency Mistake never says the hand plays it RARE% or more", () => {
    expect(broken((_c, g, why) => { const m = /only ([\d.]+)%/.exec(why); return m && !g.byEv && g.verdict === "Mistake" && Number(m[1]) >= RARE * 100 ? "says RARE or more" : null; })).toEqual([]);
  });

  it("'never' and 'always' only where the table's one-decimal share shows 0.0% and 100.0%", () => {
    expect(
      broken((c, _g, why, a) =>
        /never plays/.test(why) && shown(c.spot.freqs[a]!) > 0 ? "never, table shows more" : /always plays/.test(why) && shown(c.spot.freqs[a]!) < 100 ? "always, table shows less" : null,
      ),
    ).toEqual([]);
  });

  it("every share the why prints is the table's, at one decimal", () => {
    expect(broken((c, _g, why) => { const xs = [...why.matchAll(/([\d.]+)% of the time/g)].map((m) => Number(m[1])); return xs.every((x) => c.spot.freqs.some((f) => shown(f) === x)) ? null : "a share not in the table"; })).toEqual([]);
  });

  it("a Best or Correct counts nothing, and says why the loss it shows isn't counted", () => {
    expect(
      broken((c, g) => {
        if (!g.ok) return null;
        if (scored(g).loss !== 0) return "an OK grade counted";
        const w = lossWords(g, c.spot.pot) ?? "";
        return g.byEv && g.loss > 0 && !/not counted/.test(w) ? "OK loss not labelled" : null;
      }),
    ).toEqual([]);
  });

  it("a miss counts only what's past the noise", () => {
    expect(broken((c, g, _w, a) => (g.byEv && !g.ok && Math.abs(scored(g).loss - Math.max(0, g.loss - allow(c, a))) > 1e-9 ? "counted more than the excess" : null))).toEqual([]);
  });

  it("a loss said against an action is that action's EV less yours, to the cent", () => {
    expect(
      broken((c, _g, why, a) => {
        const m = /gives up only ([\d.]+)bb against the top EV, (a\d)/.exec(why);
        if (!m || !c.spot.evs) return null;
        const vs = Number(m[2]!.slice(1));
        return (c.spot.evs[vs]! - c.spot.evs[a]!).toFixed(2) === m[1] && Math.max(...c.spot.evs) - c.spot.evs[vs]! <= 1e-9 ? null : `says ${m[1]}bb against ${m[2]}`;
      }),
    ).toEqual([]);
  });

  it("'within' the noise only where the loss shown is no larger than the noise shown, 'just past' where it is", () => {
    expect(
      broken((c, g, why) => {
        const w = `${why} ${lossWords(g, c.spot.pot) ?? ""}`;
        const m = /(within|just past) [^(]*\(([\d.]+)bb\)/.exec(w);
        if (!m) return null;
        const over = Number(g.loss.toFixed(2)) > Number(m[2]);
        return m[1] === "within" && over ? "within, but the loss shown is larger" : m[1] === "just past" && !over ? "just past, but the loss shown isn't larger" : null;
      }),
    ).toEqual([]);
  });

  it("'graded on' says the excess the verdict is on", () => {
    expect(broken((_c, g, why) => { const m = /Graded on the ([\d.]+)bb past/.exec(why); return m && m[1] !== (g.past ?? NaN).toFixed(2) ? `graded on ${m[1]}, past ${g.past}` : null; })).toEqual([]);
  });
});

describe("odd answers", () => {
  it("neither throw nor name a missing action", () => {
    const odd: [Case["spot"], number, AnswerBasis][] = [
      [{ freqs: [], evs: [], pot: 10 }, 0, {}],
      [{ freqs: [0.5, 0.5], evs: [NaN, 1], pot: 10 }, 0, { source: "live" }],
      [{ freqs: [0, 0], evs: null, pot: 10 }, 0, { source: "charts" }],
      [{ freqs: [NaN, 1], evs: null, pot: 10 }, 1, {}],
      [{ freqs: [0.2, 0.8], evs: [1, 2], pot: NaN }, 0, { source: "live", exploitabilityPct: NaN }],
      [{ freqs: [0.2, 0.8], evs: [1, 2], pot: 0 }, 0, { source: "library", flopPot: 0 }],
      [{ freqs: [0, 0, 0], evs: [0, 0, 0], pot: 5 }, 2, { source: "live" }],
      [{ freqs: [1], evs: [Infinity], pot: 5 }, 0, {}],
    ];
    for (const [spot, a, basis] of odd) {
      const g = gradeAnswer(spot, a, basis);
      expect(spot.freqs.length === 0 || (g.best >= 0 && g.best < spot.freqs.length)).toBe(true);
      expect(Number.isFinite(g.loss) && Number.isFinite(g.lossPct)).toBe(true);
      expect(() => whyText(g, NAMES, spot.freqs)).not.toThrow();
    }
  });
});
