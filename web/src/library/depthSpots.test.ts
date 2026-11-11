// A flop-library spot at another stack depth (scripts/library/depths_build.py builds them, assemble.py takes them into
// the library with their `game`), as each page that reads the library finds and labels it: the Library page and its
// Study link, Instant flops, the plan's drill, Practice's drills, Reports, and the answer's provenance.
import { describe, expect, it } from "vitest";
import { librarySpotFor } from "@/features/plan/plan";
import { drillProvenance, studyHandOf, studyLink as drillStudyLink, type DrillProblem } from "@/features/practice/drills";
import { reportProvenance, studyHandAt, studyLink as reportStudyLink } from "@/features/reports/reports";
import { fromSearch } from "@/features/study/studyState";
import { describe as describeProvenance, provenanceOf } from "@/solver/provenance";
import type { AdvisorResponse } from "@/solver/protocol";
import { gameLabel, isDrillable, summarize, type LibraryIndex, type LibrarySpotIndex } from "./catalog";
import type { Entry } from "./entry";
import type { LibraryReport } from "./files";
import { heldSpots, instantSpots } from "./flops";

const LINE = "UTG:f,HJ:f,CO:f,BTN:r2.5,SB:f,BB:c";
const G40 = { players: 6, stack: 40, ante: 0, straddle: false };
// as solver/scripts/build_flop_library.py writes a format spot (id and label carry the game; its pot and stack the
// ones the advisor replays at 40bb: 37.5 behind)
const S40: LibrarySpotIndex = {
  id: "srp_btn_bb_40bb",
  label: "BTN vs BB single-raised pot, 40bb",
  line: LINE,
  seats: ["BB", "BTN"],
  fp: ["79e18d0951203776", "dce1f571b79c823c"],
  pot: 5.5,
  stack: 37.5,
  flops: { Ks7d2c: "0123456789", Qh9c3d: "abcdefabcd" },
  turns: true,
  game: G40,
  report: "aaaaaaaaaa",
};
const S100: LibrarySpotIndex = { ...S40, id: "srp_btn_bb", label: "BTN vs BB single-raised pot", fp: ["a", "b"], stack: 97.5, game: undefined };
const INDEX: LibraryIndex = { format: 2, tree: {}, spots: [S100, S40] };

const REP: LibraryReport = {
  format: 1,
  id: S40.id,
  label: S40.label,
  line: LINE,
  seats: ["BB", "BTN"],
  pot: 5.5,
  stack: 37.5,
  nodes: { "": ["check", "bet 33%", "bet 75%"], check: ["check", "bet 33%", "bet 75%"] },
  flops: [{ f: "Ks7d2c", w: 100, ev: [2.1, 3.4], eq: [0.45, 0.55], n: { "": [0.9, 0.05, 0.05], check: [0.5, 0.2, 0.3] } }],
  game: G40,
};

describe("a library spot at 40bb", () => {
  it("is listed in its game, with a Study link at its depth and its planned flops", () => {
    const rows = summarize(INDEX, null, { spots: { srp_btn_bb_40bb: { flops: 2, target: 184 } } });
    expect(rows[1]).toMatchObject({ id: "srp_btn_bb_40bb", game: "6-max 40bb", tablePlayers: 6, tableStack: 40, flops: 2, target: 184, storedTurns: true });
    expect(rows[0]!.game).toBe("6-max 100bb");
    expect(gameLabel(S40)).toBe("6-max 40bb");
    // (LibraryPage's StudyLink: p, s and pre from the row)
    const q = new URLSearchParams({ p: String(rows[1]!.tablePlayers), s: String(rows[1]!.tableStack), pre: rows[1]!.line });
    expect(fromSearch(q.toString())).toMatchObject({ players: 6, stack: 40 });
  });

  it("is dealt by Instant flops at 40bb only", () => {
    const spots = instantSpots(INDEX);
    expect(heldSpots(spots, { players: 6, stack: 40 }).map((s) => s.id)).toEqual(["srp_btn_bb_40bb"]);
    expect(heldSpots(spots, { players: 6, stack: 100 }).map((s) => s.id)).toEqual(["srp_btn_bb"]);
    expect(heldSpots(spots, { players: 6, stack: 200 })).toEqual([]);
    expect(heldSpots(spots, { players: 6, stack: 40, rake: 0.05 })).toEqual([]); // (no spot is solved raked)
  });

  it("is the plan's drill for a 40bb game, and never stands in for 100bb", () => {
    expect(isDrillable(S40)).toBe(true);
    expect(librarySpotFor(INDEX.spots, "BTN", "flop", { players: 6, stack: 40, yours: true })?.id).toBe("srp_btn_bb_40bb");
    expect(librarySpotFor(INDEX.spots, "BTN", "flop", { players: 6, stack: 100, yours: true })?.id).toBe("srp_btn_bb");
    expect(librarySpotFor([S40], "BTN", "flop", { players: 6, stack: 100, yours: true })).toBeNull();
    expect(librarySpotFor(INDEX.spots, "BTN", "flop")?.id).toBe("srp_btn_bb"); // no game of yours: the default game first
  });

  it("opens Practice's drills and Reports rows in Study at 40bb", () => {
    const pr = { path: ["check", "bet 75%"], board: ["Ks", "7d", "2c"] } as unknown as DrillProblem;
    const h = studyHandOf(REP, pr);
    expect([h.players, h.stack, h.board]).toEqual([6, 40, "Ks7d2c"]);
    expect(fromSearch(drillStudyLink(REP, pr)!.slice("/study?".length))).toMatchObject({ players: 6, stack: 40 });
    expect(studyHandAt(REP, "Ks7d2c", "ip")).toMatchObject({ players: 6, stack: 40, board: "Ks7d2c" });
    expect(fromSearch(reportStudyLink(REP, "Ks7d2c", "oop")!.slice("/study?".length))).toMatchObject({ players: 6, stack: 40 });
  });

  it("is labelled the precomputed solution of that spot, by its id with the depth", () => {
    const entry = { head: { spot: S40.id, expl: 0.14, iters: 300, tree: "t" } } as unknown as Entry;
    expect(describeProvenance(drillProvenance(entry, "accurate"))).toContain("Precomputed solution · srp_btn_bb_40bb");
    expect(describeProvenance(reportProvenance(REP, "accurate"))).toContain("srp_btn_bb_40bb");
    // Study's answer from the worker: precomputed.spot is the entry's spot id (flop_library LibrarySolution.info)
    const r = { street: "flop", precomputed: { spot: S40.id, label: S40.label, exploitability_pct: 0.14 }, solver: { exploitability_pct: 0.14, iterations: 300 } } as unknown as AdvisorResponse;
    const p = provenanceOf(r, { mode: "accurate", transport: "worker", solverVersion: "x", partial: false });
    expect(p).toMatchObject({ source: "library", approximate: false, librarySpot: "srp_btn_bb_40bb" });
  });
});
