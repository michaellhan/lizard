import { describe, expect, it } from "vitest";
import { bandOf, describe as describeProvenance, evUnit, ploRiverProvenance, PRIZE_UNIT, provenanceOf, sourceOf, tournamentModelOf } from "./provenance";
import type { AdvisorResponse } from "./protocol";

const ctx = { mode: "fast" as const, transport: "worker" as const, solverVersion: "9b907bd6/abc", partial: false, now: 1 };

describe("a line kept with a grade", () => {
  const base = { approximate: false, mode: "quick", solverVersion: "", partial: false, receivedAt: 0 } as const;
  it("stands as written, a build-stamped decision's too, which is kept as the worker's", () => {
    const keptLabel = "Live solve (Quick) · 0.80% pot from equilibrium in the solved game (converged) · 300 iterations";
    expect(describeProvenance({ ...base, source: "live", transport: "kept", keptLabel })).toBe(keptLabel);
    expect(describeProvenance({ ...base, source: "live", transport: "worker", keptLabel })).toBe(keptLabel);
  });
  it("can't call the charts or a rule fallback anything else", () => {
    expect(describeProvenance({ ...base, source: "charts", approximate: true, transport: "kept", keptLabel: "Solved" })).toBe("Preflop charts · approximate");
    expect(describeProvenance({ ...base, source: "charts", approximate: true, transport: "worker", keptLabel: "Preflop charts, solved exactly" })).toBe("Preflop charts · approximate");
    expect(describeProvenance({ ...base, source: "rules", approximate: true, transport: "kept", keptLabel: "Solved" })).toMatch(/^Heuristic rules \(not a solve\)/);
    expect(describeProvenance({ ...base, source: "best-response", transport: "kept", keptLabel: "Solved" })).toMatch(/not a solve/);
  });
});

describe("provenance", () => {
  it("names what answered", () => {
    expect(sourceOf({ precomputed: { spot: "srp_btn_bb" }, street: "flop" })).toBe("library");
    expect(sourceOf({ street: "preflop" })).toBe("charts");
    expect(sourceOf({ street: "turn", solver: { iterations: 300 } })).toBe("live");
    expect(sourceOf({ fallback: "rules", street: "river" })).toBe("rules");
    expect(sourceOf({ fallback: "chart" })).toBe("charts");
    expect(sourceOf({ study: "pf_progress" })).toBe("preflop-solve");
    expect(sourceOf({})).toBe("unknown");
  });

  it("labels stored turns, answers at once and 5+-way heuristics as what they are (advisor.py's shapes)", () => {
    const storedTurn: AdvisorResponse = {
      street: "turn",
      approximate: { source: "store", label: "the flop library's stored turn", iterations: 300 },
      solver: { iterations: 300, exploitability_pct: 0.12, by: "the flop library" },
    };
    const p = provenanceOf(storedTurn, ctx);
    expect(p).toMatchObject({ source: "library-turn", approximate: true });
    expect(p.exploitabilityPct).toBeUndefined(); // the flop entry's number, not the turn's
    expect(sourceOf({ study: "runouts", source: "store", solver: { iterations: 300, by: "the flop library" } })).toBe("library-turn");

    // Advisor._study_near: a flop the library does not store, read off the most similar stored flops
    const nearLabel = "the precomputed solves of the most similar flops (Kd7c2h), by card substitution";
    const near: AdvisorResponse = {
      study: "node",
      street: "flop",
      approximate: { source: "near", label: nearLabel, iterations: null },
      solver: { iterations: null, exploitability_pct: null, by: "the flop library" },
    };
    const instant = provenanceOf(near, ctx);
    expect(instant).toMatchObject({ source: "instant", approximate: true, approximateLabel: nearLabel });
    expect(describeProvenance(instant)).toBe(`Answer at once · ${nearLabel} · approximate`);

    // Advisor._study_prev: the turn read off the flop's live solve, whose numbers are the flop's, not this answer's
    const prev = provenanceOf(
      {
        study: "node",
        street: "turn",
        approximate: { source: "prev", label: "the flop solve's view of the turn (by card class)", iterations: 412 },
        solver: { iterations: 412, by: "the flop's solve", exploitability_pct: 0.31 },
      },
      { ...ctx, partial: true },
    );
    expect(prev).toMatchObject({ source: "instant", approximate: true });
    expect(prev.exploitabilityPct).toBeUndefined();
    expect(prev.iterations).toBeUndefined();

    // Advisor._study_look: this street's own solve so far, stopped at a look (its numbers are in the label)
    const look = provenanceOf(
      {
        study: "node",
        street: "turn",
        approximate: { source: "solve", label: "this street's solve so far (200 iterations, 0.36% of the pot from equilibrium)", iterations: 200 },
        solver: { iterations: null, exploitability_pct: null },
      },
      { ...ctx, partial: true },
    );
    expect(describeProvenance(look)).toBe("Live solve · this street's solve so far (200 iterations, 0.36% of the pot from equilibrium) · in progress");

    // Advisor._study_mw_prev's own branch: a read of an earlier decision's 3-way solve on this street, not this node's
    const mwOwn = provenanceOf(
      {
        study: "node",
        street: "flop",
        multiway: true,
        approximate: { source: "solve", label: "this street's 3-way solve from SB's decision (300 iterations, 0.25% of the pot from equilibrium), on the line since", iterations: null },
        solver: { iterations: null, exploitability_pct: null, by: "the flop's earlier solve" },
      },
      { ...ctx, partial: true },
    );
    expect(mwOwn).toMatchObject({ source: "instant", approximate: true });

    // a 3-way answer at once (Advisor._mw_instant) is not the 5+-way heuristic
    expect(sourceOf({ street: "flop", multiway: true, approximate: { source: "near", label: "3-way library" } })).toBe("instant");
    expect(provenanceOf({ street: "flop", multiway: true, players: 5 }, ctx)).toMatchObject({ source: "rules", approximate: true });
    expect(sourceOf({ street: "flop", multiway: true, solved: true, solver: { iterations: 200 } })).toBe("live");
  });

  it("marks borrowed library spots and preflop charts approximate, and shows a stored turn's label", () => {
    const borrowed = provenanceOf(
      {
        street: "flop",
        precomputed: { spot: "srp_btn_bb", borrowed: { dist: [0.02], text: "this table's ranges differ from that spot's by 2.0% of their weight at most" } },
        solver: { iterations: 1000, exploitability_pct: 0.12 },
      },
      ctx,
    );
    expect(borrowed).toMatchObject({ source: "library", approximate: true, librarySpot: "srp_btn_bb" });
    expect(borrowed.exploitabilityPct).toBeUndefined(); // that spot's, on its own ranges
    expect(describeProvenance(borrowed)).toBe(
      "Precomputed solution · srp_btn_bb · another table's spot read as this one (this table's ranges differ from that spot's by 2.0% of their weight at most) · approximate",
    );
    expect(provenanceOf({ street: "preflop", grid: { actions: [], cells: {} } }, ctx)).toMatchObject({ source: "charts", approximate: true });
    const turn = provenanceOf({ street: "turn", approximate: { source: "store", label: "the nearest spot that stores its turns (srp_co_bb)" } }, ctx);
    expect(describeProvenance(turn)).toBe("Stored turn from the flop library · the nearest spot that stores its turns (srp_co_bb) · approximate");
  });

  it("marks heuristic fallbacks and partial answers approximate, and keeps the convergence numbers", () => {
    expect(provenanceOf({ fallback: "rules", fallback_reason: "timeout" }, ctx)).toMatchObject({
      source: "rules",
      approximate: true,
      fallbackReason: "timeout",
    });
    const live = provenanceOf({ street: "turn", solver: { iterations: 400, exploitability_pct: 0.31, solve_seconds: 2.5 } }, ctx);
    expect(live).toMatchObject({ source: "live", approximate: false, iterations: 400, exploitabilityPct: 0.31, seconds: 2.5 });
    expect(provenanceOf({ street: "turn", solver: { iterations: 40 } }, { ...ctx, partial: true }).approximate).toBe(true);
  });

  it("bands a measured figure as the classic app does: converged under 3%, fair under 10%, else rough", () => {
    expect([2.99, 3.0, 9.99, 10.0].map((x) => bandOf(x))).toEqual(["converged", "fair", "fair", "rough"]);
    expect(bandOf(0.1, true)).toBe("approximate");
    const cut = provenanceOf({ street: "turn", solver: { iterations: 12, exploitability_pct: 4 } }, ctx);
    expect(cut.band).toBe("fair");
    expect(describeProvenance(cut)).toBe("Live solve · 4.00% pot from equilibrium in the solved game (fair) · 12 iterations");
    const short = provenanceOf({ street: "turn", solver: { iterations: 90, exploitability_pct: 0.5, approximate: true, target_pct: 0.3 } }, ctx);
    expect(describeProvenance(short)).toBe(
      "Live solve · 0.50% pot from equilibrium in the solved game (approximate, target 0.3%) · 90 iterations · approximate",
    );
    // no measured figure, no band (a stored turn, an answer at once, the charts)
    expect(provenanceOf({ street: "preflop" }, ctx).band).toBeUndefined();
  });

  it("describes itself in words", () => {
    const p = provenanceOf({ precomputed: { spot: "srp_btn_bb" }, solver: { exploitability_pct: 0.2 } }, ctx);
    expect(describeProvenance(p)).toBe("Precomputed solution · srp_btn_bb · 0.20% pot from equilibrium in the solved game (converged)");
    const mw = provenanceOf({ street: "flop", multiway: true, solved: true, solver: { iterations: 300, exploitability_pct: 0.25 } }, ctx);
    expect(describeProvenance(mw)).toBe("Live solve · 0.25% pot mean best-response gain in the solved game (converged) · 300 iterations");
  });

  // (the engine's answers, as advisor.py _tournament_info and _push write them)
  const ICM = { equity_share: 0.0719, bubble_factors: { BB: 1.2 }, note: "tournament: ICM, CO's prize equity 7.2% of what's left to pay; bubble factor up to 1.20" };
  it("says which model a tournament answer is in, and never puts chips for prize equity", () => {
    const solve = provenanceOf({ street: "flop", tournament: ICM, notes: [ICM.note], solver: { iterations: 158, exploitability_pct: 0.29 } }, ctx);
    expect(describeProvenance(solve)).toBe("Live solve · prize-equity solve (ICM) · 0.29% pot from equilibrium in the solved game (converged) · 158 iterations");
    const jam = provenanceOf({ street: "preflop", tournament: ICM, notes: [ICM.note, "a raise here commits too much of a 8bb stack: all-in, range from the push/fold equilibrium against 3 players in prize equity (ICM: both the jams and the calls)"] }, ctx);
    expect(jam.tournament).toBe("push/fold equilibrium in prize equity");
    const call = provenanceOf({ street: "preflop", tournament: ICM, notes: [ICM.note, "BTN's 10bb jam range: push/fold equilibrium against 2", "tournament: calling needs 48.1% equity in prize equity against 41.0% in chips (a risk premium of +7.1%)"] }, ctx);
    expect(call.tournament).toBe("a call priced in prize equity");
    const chart = provenanceOf({ street: "preflop", tournament: ICM, notes: [ICM.note, "preflop: the 40bb chart (the 100bb chart moved by solves of this game)"] }, ctx);
    expect(describeProvenance(chart)).toBe("Preflop charts · chip chart with a risk premium · approximate");
    expect(provenanceOf({ street: "river", fallback: "rules", tournament: ICM, notes: [] }, ctx).tournament).toBe("a tournament, but the fallback plays chips");
    const mystery = { ...ICM, bounties: { format: "mystery" } };
    expect(provenanceOf({ street: "turn", tournament: mystery, solver: { iterations: 300 } }, ctx).tournament).toBe("prize-equity solve (ICM), mystery bounties at the average envelope");
    // a large field modelled by stand-ins (advisor.py _tournament_info's note)
    const big = { ...ICM, note: "tournament: ICM (54 players modelled by 12), CO's prize equity 1.9% of what's left to pay; bubble factor up to 1.31" };
    expect(provenanceOf({ street: "flop", tournament: big, solver: { iterations: 300 } }, ctx).tournament).toBe("prize-equity solve (ICM), 54 players modelled by 12");
    const pko = { ...ICM, note: "tournament: no payouts given, so chip EV: …", bounties: { format: "pko" } };
    expect(provenanceOf({ street: "turn", tournament: pko, solver: { iterations: 300 } }, ctx).tournament).toBe(
      "chip-EV solve with bounties (no payouts given: the prizes taken as the bounties in play), PKO bounties, proportional model",
    );
    const wta = { ...ICM, note: "tournament: winner-take-all (prize equity is chips), BB's equity 40.0% of the prize pool left", bounties: { format: "ko" } };
    expect(provenanceOf({ street: "flop", tournament: wta, solver: { iterations: 300 } }, ctx).tournament).toBe("prize-equity solve (winner takes all: chips are prizes), KO bounties, proportional model");
    // a cash answer has none; a chip answer's own all-in from the push/fold equilibrium says so
    expect(provenanceOf({ street: "flop", solver: { iterations: 300 } }, ctx).tournament).toBeUndefined();
    const chipJam = provenanceOf({ street: "preflop", notes: ["a raise here commits too much of a 10bb stack: all-in, range from the push/fold equilibrium against 5 players"] }, ctx);
    expect(describeProvenance(chipJam)).toBe("Push/fold model (not a solve) · jam-or-fold equilibrium in chips, by hand class, one caller assumed · approximate");
    expect(provenanceOf({ street: "preflop", notes: ["BTN's 10bb jam range: push/fold equilibrium against 2"] }, ctx).view).toBeUndefined();
  });

  it("a Quick triage's answers say so, with how far to trust them", () => {
    const quick = provenanceOf({ solver: { iterations: 300, exploitability_pct: 0.8 }, triage: { source: "quick", confidence: "medium", label: "a Quick solve" } }, ctx);
    expect([quick.source, quick.mode, quick.confidence]).toEqual(["live", "quick", "medium"]);
    expect(describeProvenance(quick)).toBe("Live solve (Quick) · 0.80% pot from equilibrium in the solved game (converged) · 300 iterations · medium confidence");
    // the street's own solve read for a later decision: an answer at once, nothing solved for it, and not timed
    const own = provenanceOf({ street: "turn", approximate: { source: "solve", label: "this street's solve from your earlier decision" }, triage: { source: "approx", confidence: "low", label: "x" } }, ctx);
    expect([own.source, own.mode]).toEqual(["instant", ctx.mode]);
    expect(describeProvenance(own)).toMatch(/^Answer at once/);
    // one cut to fit Quick is still a solve
    const cut = provenanceOf({ street: "turn", approximate: { source: "solve", label: "cut" }, solver: { iterations: 40, exploitability_pct: 14 }, triage: { source: "quick", confidence: "low", label: "x" } }, ctx);
    expect([cut.source, cut.mode]).toEqual(["live", "quick"]);
    // a library answer to a triage is the library's, whatever the mode
    const lib = provenanceOf({ precomputed: { spot: "srp_btn_bb" }, triage: { source: "library", confidence: "high", label: "x" } }, ctx);
    expect([lib.source, lib.mode, lib.confidence]).toEqual(["library", "fast", "high"]);
    // and no triage, nothing said
    expect(provenanceOf({ solver: { iterations: 300 } }, ctx).confidence).toBeUndefined();
    expect(describeProvenance({ ...quick, mode: "fast", confidence: undefined })).toMatch(/^Live solve · /);
  });
});

describe("a PLO4 river", () => {
  const river = { iterations: 140, seconds: 2.5, exploitabilityPct: 0.08, targetPct: 0.1, sizes: { bets: [50, 100], raises: [100], raiseCap: 2, allIn: true }, now: 1 };

  it("says an exact solve of this river alone, at which sizes, how far it got, and that nothing earlier is solved", () => {
    const p = ploRiverProvenance({ ...river, stop: "target" });
    expect(p).toMatchObject({ source: "plo-river", approximate: false, band: "converged", iterations: 140, targetPct: 0.1 });
    const words = describeProvenance(p);
    expect(words).toContain("Heads-up PLO4 river solve of every combo");
    expect(words).toContain("earlier streets aren't solved");
    expect(words).toContain("bets 50%, 100% of the pot, raises 100%, up to 2 raises, all-in where the limit allows, no rake");
    expect(words).toContain("0.08% pot from equilibrium in the solved game");
    expect(words).toContain("140 iterations");
  });

  it("is approximate if it stopped short, whatever the figure", () => {
    const p = ploRiverProvenance({ ...river, stop: "time" });
    expect(p).toMatchObject({ approximate: true, band: "approximate" });
    expect(describeProvenance(p)).toContain("short of its target: the time budget ran out");
    expect(describeProvenance(ploRiverProvenance({ ...river, stop: "cancelled" }))).toContain("short of its target: cancelled");
  });

  it("says no raises rather than an empty list", () => {
    expect(describeProvenance(ploRiverProvenance({ ...river, stop: "target", sizes: { bets: [100], raises: [], raiseCap: 0, allIn: false } }))).toContain("bets 100% of the pot, raises none, up to 0 raises, no rake");
  });
});

describe("the push/fold model (advisor.py _push and _vs_jam, as the engine says them)", () => {
  const OWN = "a raise here commits too much of a 12bb stack: all-in, range from the push/fold equilibrium against 5 players";
  const JAM = (notes: string[], extra: Partial<AdvisorResponse> = {}): AdvisorResponse => ({
    street: "preflop",
    notes,
    actions: [
      { action: "fold", freq: 0.4 },
      { action: "all-in", freq: 0.6, amount_bb: 12 },
    ],
    ...extra,
  });

  it("is its own source for a jam and for a call of one, approximate, and no chart or solve", () => {
    const first = provenanceOf(JAM(["preflop: chart approximation", OWN]), ctx);
    expect(first).toMatchObject({ source: "push-fold", approximate: true, view: "jam-or-fold equilibrium in chips, by hand class, one caller assumed" });
    expect(describeProvenance(first)).not.toMatch(/solve ·|Live|Preflop charts/);
    const facing = provenanceOf({ street: "preflop", actions: [{ action: "fold", freq: 0 }, { action: "call", freq: 1 }], notes: ["preflop: facing an all-in, call when equity beats the pot odds", "BTN's 12bb jam range: push/fold equilibrium against 2 players left (31% of their hands)", "equity 63.3% vs 44.9% needed"] }, ctx);
    expect(facing).toMatchObject({ source: "push-fold", approximate: true, view: "a call priced by equity against the jam's push/fold range" });
  });

  it("leaves a chart with one all-in from the equilibrium as the chart, saying so", () => {
    const hybrid = JAM([OWN], { actions: [{ action: "fold", freq: 0 }, { action: "call", freq: 0.97 }, { action: "all-in", freq: 0.03 }] });
    expect(provenanceOf(hybrid, ctx)).toMatchObject({ source: "charts", view: "the chart, its all-in from the push/fold equilibrium in chips" });
    expect(sourceOf(JAM(["preflop: chart approximation"]))).toBe("charts");
    // a fallback or a flop that happens to say the words is what it was
    expect(sourceOf(JAM([OWN], { fallback: "rules", street: "river" }))).toBe("rules");
  });

  it("says what a tournament's answer is in, and what its EVs are", () => {
    const ICM = { equity_share: 0.07, bubble_factors: { BB: 1.2 }, note: "tournament: ICM, CO's prize equity 7.0% of what's left to pay; bubble factor up to 1.20" };
    const jam = provenanceOf(JAM([ICM.note, "a raise here commits too much of a 8bb stack: all-in, range from the push/fold equilibrium against 3 players in prize equity (ICM: both the jams and the calls)"], { tournament: ICM }), ctx);
    expect(jam.source).toBe("push-fold");
    expect(jam.tournament).toMatch(/prize equity/);
    const solve = provenanceOf({ street: "flop", tournament: ICM, notes: [ICM.note], solver: { iterations: 100 } }, ctx);
    expect(solve).toMatchObject({ source: "live", evIn: "prize" });
    expect(evUnit(solve)).toBe(PRIZE_UNIT);
    const rules = provenanceOf({ street: "river", fallback: "rules", tournament: ICM, notes: [] }, ctx);
    expect(rules).toMatchObject({ source: "rules", evIn: "chips", tournament: "a tournament, but the fallback plays chips" });
    expect(evUnit(rules)).toBe("bb");
    // and a cash answer is in bb, as it always was
    expect(provenanceOf({ street: "flop", solver: { iterations: 100 } }, ctx).evIn).toBeUndefined();
    expect(evUnit(null)).toBe("bb");
  });

  it("calls a hybrid in a tournament the chip chart it is, with the one action from the model", () => {
    const ICM = { equity_share: 0.07, note: "tournament: ICM, CO's prize equity 7.0%" };
    const r = JAM([ICM.note, "a raise here commits too much of a 30bb stack: all-in, range from the push/fold equilibrium against 1 player in prize equity (ICM: both the jams and the calls)"], { tournament: ICM, actions: [{ action: "fold", freq: 0 }, { action: "call", freq: 0.97 }, { action: "all-in", freq: 0.03 }] });
    expect(provenanceOf(r, ctx)).toMatchObject({ source: "charts", tournament: "chip chart with a risk premium, its all-in from the push/fold equilibrium in prize equity" });
    expect(tournamentModelOf).toBeTypeOf("function");
  });
});

describe("ranges an earlier street narrowed by the betting rules", () => {
  // advisor.py's notes, as a heads-up river's Study answer gave them (2026-11-09)
  const live = { street: "river", study: "node", solver: { iterations: 1000, exploitability_pct: 0.02, solve_seconds: 0.35 } } as AdvisorResponse;
  it("marks a live solve approximate when an earlier street's narrowing solve hadn't settled, and says by how much", () => {
    const r = { ...live, notes: ["flop: the solve that narrows ranges is 3.2% of the pot from equilibrium (55 iterations), so ranges follow it 40% and simple betting rules the rest"] };
    const p = provenanceOf(r, ctx);
    expect(p).toMatchObject({ source: "live", approximate: true });
    expect(describeProvenance(p)).toContain("the flop's narrowing solve stopped 3.2% of the pot from equilibrium after 55 iterations on its time budget, so the ranges follow it 40% and the betting rules the rest, and can differ from run to run");
    expect(describeProvenance(p)).toMatch(/· approximate$/);
  });
  it("says a street the rules narrowed alone, heads-up (Quick) or multiway", () => {
    const quick = provenanceOf({ ...live, notes: ["turn: ranges narrowed by simple betting rules (a quick answer: the street isn't solved)"] }, ctx);
    expect(quick.approximate).toBe(true);
    expect(quick.approximateLabel).toBe("ranges through the turn from the betting rules, not a solve");
    const mw = provenanceOf({ ...live, multiway: true, notes: ["flop, turn: multiway, ranges narrowed by simple betting rules rather than a solve"] }, ctx);
    expect(mw.approximateLabel).toBe("ranges through the flop, turn from the betting rules, not a solve");
  });
  it("leaves an answer whose earlier streets settled as it was", () => {
    const p = provenanceOf({ ...live, notes: ["turn: board pairs"] }, ctx);
    expect(p.approximate).toBe(false);
    expect(p.approximateLabel).toBeUndefined();
  });
});
