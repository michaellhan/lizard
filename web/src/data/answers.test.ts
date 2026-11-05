// A saved answer: what Study shows again, under what's worked out from it. Nothing a record says about itself can call the
// charts solved.
import { describe, expect, it } from "vitest";
import { fromSearch, toSearch } from "@/features/study/studyState";
import { describe as words, provenanceOf } from "@/solver/provenance";
import type { AdvisorResponse } from "@/solver/protocol";
import type { Provenance, SolveResult } from "@/solver/types";
import { CHART_ANSWER, LIBRARY_ANSWER, LIVE_ANSWER } from "@/test/answers";
import { MAX_ANSWER_BYTES, answerToKeep, answerWords, readAnswer, seenWords, versionStand, type KeptAnswer } from "./answers";
import type { SavedAnswer } from "./db";

const PRE = "UTG:f,HJ:f,CO:f,BTN:r2.5,SB:f,BB:c";
const norm = (q: string) => toSearch(fromSearch(q)!);
const CHART_LINE = norm("p=6&s=100");
const FLOP_LINE = norm(`p=6&s=100&pre=${PRE}&b=Ac7s3d`);
const TURN_LINE = norm(`p=6&s=100&pre=${PRE}&b=Ac7s3d9h&flop=BB:x,BTN:x`);
const SOLVER_LINE = norm("p=6&s=100&pf=solver");

const CTX = { mode: "fast", transport: "worker", solverVersion: "aaa/111", partial: false, now: 5 } as const;
const result = (data: AdvisorResponse, extra: Partial<Provenance> = {}): SolveResult => ({ data, provenance: { ...provenanceOf(data, CTX), ...extra } });
/** a record as a file could write it: any answer, any provenance */
const record = (data: unknown, line: string, extra: Partial<SavedAnswer> = {}): SavedAnswer => ({
  id: "s",
  line,
  json: JSON.stringify(data),
  provenance: provenanceOf(CHART_ANSWER, CTX),
  savedAt: 1_750_000_000_000,
  ...extra,
});
const kept = (data: AdvisorResponse, line: string, extra: Partial<Provenance> = {}): KeptAnswer => {
  const k = answerToKeep("s", line, result(data, extra));
  if (!("answer" in k)) throw new Error(k.refused);
  return readAnswer(k.answer)!;
};

describe("an answer kept with a spot", () => {
  it("reads back as the answer it was, under its own source, for each kind of answer", () => {
    for (const [data, line, source] of [
      [CHART_ANSWER, CHART_LINE, "charts"],
      [LIBRARY_ANSWER, FLOP_LINE, "library"],
      [LIVE_ANSWER, TURN_LINE, "live"],
    ] as const) {
      const k = kept(data, line);
      expect(k.result.data).toEqual(data);
      expect(k.result.provenance.source).toBe(source);
      expect(k.bytes).toBe(JSON.stringify(data).length);
    }
  });

  it("keeps the numbers and version of its provenance, says it's saved wherever the line is said, and keeps the library's stamp", () => {
    const k = kept(LIBRARY_ANSWER, FLOP_LINE, { libraryVersion: "library:srp_btn_bb:abc" });
    const fresh = provenanceOf(LIBRARY_ANSWER, CTX);
    expect(k.result.provenance).toMatchObject({ exploitabilityPct: fresh.exploitabilityPct, iterations: fresh.iterations, solverVersion: "aaa/111", libraryVersion: "library:srp_btn_bb:abc", partial: false, approximate: false });
    expect(words(k.result.provenance)).toMatch(/^Precomputed solution · srp_btn_bb · saved answer of \d{4}-\d{2}-\d{2}, solver build aaa\/111 · /);
    expect(k.label).toBe(words({ ...fresh, libraryVersion: "library:srp_btn_bb:abc" }));
  });

  it("isn't kept while a solve is still going, or for a node with nothing to show", () => {
    expect(answerToKeep("s", TURN_LINE, result(LIVE_ANSWER, { partial: true }))).toEqual({ refused: "the solve hasn't finished" });
    expect(answerToKeep("s", CHART_LINE, result({ study: "over" }))).toEqual({ refused: "this page couldn't show it again as it stands" });
  });

  it("is refused in words past the limit, and read back at it", () => {
    const pad = (n: number) => ({ ...CHART_ANSWER, notes: ["x".repeat(n)] });
    const room = MAX_ANSWER_BYTES - JSON.stringify(pad(0)).length;
    expect("answer" in answerToKeep("s", CHART_LINE, result(pad(room)))).toBe(true);
    expect(answerToKeep("s", CHART_LINE, result(pad(room + 1)))).toEqual({ refused: "it's 513 KB, over the 512 KB a saved answer can be" });
    // (bytes, not characters: this is under the limit as a string)
    const wide = answerToKeep("s", CHART_LINE, result({ ...CHART_ANSWER, notes: ["é".repeat(room)] }));
    expect(wide).toEqual({ refused: expect.stringContaining("over the 512 KB") });
  });

  it("leaves room for the widest real answer: a full river's 1,081 combos at the page's most actions", () => {
    const row = (i: number) => [`2c3d`, 0.999, [0.27, 0.73, 0, 0, 0, 0], [9.33, 9.33, 9.05, 8.79, 9.12, 9.12], 0.998 - i / 1e4, 12, 5];
    const combos = Object.fromEntries(Array.from({ length: 169 }, (_, i) => [`k${i}`, Array.from({ length: 7 }, (_, j) => row(j))]));
    const cells = Object.fromEntries(Array.from({ length: 169 }, (_, i) => [`k${i}`, { w: 1, f: [0.27, 0.73, 0, 0, 0, 0], ev: [9.33, 9.33, 9.05, 8.79, 9.12, 9.12], evm: 9.33, eq: 0.998 }]));
    expect(JSON.stringify({ ...LIVE_ANSWER, combos, grid: { actions: ["a", "b", "c", "d", "e", "f"], cells }, opponent_grid: { actions: ["in range"], cells: {} } }).length).toBeLessThan(MAX_ANSWER_BYTES);
  });
});

describe("what a crafted record can't do", () => {
  const SOLVED = { source: "live", approximate: false, exploitabilityPct: 0.1, band: "converged", iterations: 500, keptLabel: "Live solve · 0.10% pot from equilibrium", view: "solved" } as const;

  it("a real solve moved to a line of another street isn't that line's answer, whichever way it's moved", () => {
    expect(readAnswer(record(LIVE_ANSWER, TURN_LINE))).not.toBeNull();
    expect(readAnswer(record(LIVE_ANSWER, FLOP_LINE))).toBeNull();
    expect(readAnswer(record(LIBRARY_ANSWER, FLOP_LINE))).not.toBeNull();
    expect(readAnswer(record(LIBRARY_ANSWER, TURN_LINE))).toBeNull();
  });

  it("a preflop solve's mark on a postflop answer isn't taken: it's a solve only where one can be", () => {
    expect(readAnswer(record({ ...LIVE_ANSWER, pf_solve: {} }, TURN_LINE))).toBeNull();
  });

  it("a provenance edited to a solve over a chart is said as the chart", () => {
    const p = readAnswer(record(CHART_ANSWER, CHART_LINE, { provenance: { ...provenanceOf(CHART_ANSWER, CTX), ...SOLVED } }))!.result.provenance;
    expect(p).toMatchObject({ source: "charts", approximate: true });
    expect(p.exploitabilityPct).toBeUndefined();
    expect(p.keptLabel).toBeUndefined();
    expect(words(p)).toMatch(/^Preflop charts · saved answer of .* · approximate$/);
  });

  it.each([
    ["a solver's figures", { solver: { iterations: 500, exploitability_pct: 0.1 } }],
    ["a live-looking block of words", { approximate: { source: "solve", label: "fully solved" } }],
    ["a lock's words", { locked: { BB: {} } }],
    ["sizes picked by a solve", { sizes_kept: ["33%"] }],
    ["a triage's confidence", { triage: { confidence: "high" } }],
    ["a fallback marked solved", { fallback: "chart", solver: { exploitability_pct: 0.1 } }],
    ["a library entry", { precomputed: { spot: "srp_btn_bb" } }],
    ["a stored turn", { source: "store" }],
    ["a node lock", { node_lock: { words: "x", abstraction: "y", scope: "z" } }],
    ["a preflop solve the line didn't ask for", { pf_solve: { done: true, mbb: 0.1 } }],
  ])("a chart's answer carrying %s is refused on a chart's line", (_, extra) => {
    expect(readAnswer(record({ ...CHART_ANSWER, ...extra }, CHART_LINE))).toBeNull();
  });

  it("a preflop solve stands only on a line that asked for it", () => {
    const pf = { ...CHART_ANSWER, pf_solve: { done: true, mbb: 0.5 } };
    expect(readAnswer(record(pf, SOLVER_LINE))?.result.provenance.source).toBe("preflop-solve");
    expect(readAnswer(record(pf, CHART_LINE))).toBeNull();
  });

  it("an answer claiming another street than its line's is refused", () => {
    expect(readAnswer(record({ ...LIVE_ANSWER }, CHART_LINE))).toBeNull();
    expect(readAnswer(record({ ...CHART_ANSWER, street: "flop" }, CHART_LINE))).toBeNull();
    expect(readAnswer(record(LIVE_ANSWER, TURN_LINE))).not.toBeNull();
  });

  it("nothing unlabelled, and nothing past the limit, whatever it says of itself", () => {
    expect(readAnswer(record({ ...LIVE_ANSWER, solver: undefined }, TURN_LINE))).toBeNull();
    expect(readAnswer({ ...record(CHART_ANSWER, CHART_LINE), json: " ".repeat(MAX_ANSWER_BYTES + 1) })).toBeNull();
    expect(readAnswer({ ...record(CHART_ANSWER, CHART_LINE), json: JSON.stringify({ ...CHART_ANSWER, notes: ["é".repeat(MAX_ANSWER_BYTES / 2)] }) })).toBeNull();
  });

  it.each([
    ["no json", { json: undefined }],
    ["json that isn't", { json: "{" }],
    ["json that's a list", { json: "[]" }],
    ["a line that isn't one", { line: "nothing" }],
    ["a lone surrogate in the line", { line: `${CHART_LINE}\ud800` }],
    ["no id", { id: "" }],
    ["a time no Date holds", { savedAt: 9e15 }],
    ["a mode that isn't", { provenance: { ...provenanceOf(CHART_ANSWER, CTX), mode: "exact" } }],
    ["a backend that isn't", { provenance: { ...provenanceOf(CHART_ANSWER, CTX), transport: "kept" } }],
    ["no provenance", { provenance: undefined }],
    ["a `restored` that isn't", { restored: false }],
  ])("%s is refused and nothing throws", (_, x) => {
    expect(readAnswer({ ...record(CHART_ANSWER, CHART_LINE), ...x })).toBeNull();
  });

  it.each([
    ["an action that isn't one", { actions: [{ action: {} }] }],
    ["a mix that doesn't fit the actions", { grid: { actions: ["a", "b"], cells: { AA: { w: 1, f: [1] } } } }],
    ["an object in a cell", { grid: { actions: ["a"], cells: { AA: { w: 1, f: [1], eq: {} } } } }],
    ["a combo that isn't two cards", { combos: { AA: [["AzAy", 1, [1], [1], 0.5, 0, 0]] } }],
    ["a note that isn't text", { notes: [{}] }],
    ["an actor that isn't text", { actor: 1 }],
    ["an error", { error: "no" }],
    ["an opponent with no grid", { opponents: [{ seat: "BB" }] }],
  ])("%s is refused: the page would draw it", (_, x) => {
    expect(readAnswer(record({ ...CHART_ANSWER, ...x }, CHART_LINE))).toBeNull();
  });

  it("says a spot's `seen` through the same check: the charts as the charts, and a solve on a line none can answer not at all", () => {
    expect(seenWords({ source: "charts", label: "Live solve · 0.10% pot" }, CHART_LINE)).toBe("Preflop charts · approximate");
    expect(seenWords({ source: "live", label: "Live solve · 0.10% pot" }, CHART_LINE)).toBeNull();
    expect(seenWords({ source: "library", label: "Precomputed solution · srp_btn_bb" }, FLOP_LINE)).toBe("Precomputed solution · srp_btn_bb");
    expect(seenWords({ source: "live", label: "solved exactly" }, FLOP_LINE)).toBe("Live solve");
    expect(seenWords({ source: "nonsense", label: "x" }, FLOP_LINE)).toBeNull();
    expect(seenWords(undefined, FLOP_LINE)).toBeNull();
  });
});

describe("the version it's from", () => {
  const at = (solverVersion: string, transport: Provenance["transport"] = "worker") => kept(CHART_ANSWER, CHART_LINE, { solverVersion, transport });

  it("is current only where it's this page's build", () => {
    expect(versionStand(at("aaa/111").record, "aaa/111")).toBe("current");
    expect(versionStand(at("aaa/111").record, "bbb/222")).toBe("another");
  });

  it("is unknown, not current, where either side can't be told", () => {
    expect(versionStand(at("aaa/111").record, null)).toBe("unknown");
    expect(versionStand(at("aaa/111").record, "dev")).toBe("unknown");
    expect(versionStand(at("dev").record, "dev")).toBe("unknown");
    // (a local server's build isn't the one the page names)
    expect(versionStand(at("aaa/111", "http").record, "aaa/111")).toBe("unknown");
  });

  it("is said, with another version's said not to be current", () => {
    const k = at("aaa/111");
    expect(answerWords(k, "aaa/111")).toMatch(/^Saved answer of \d{4}-\d{2}-\d{2}, not solved again\. Solver build aaa\/111, the one this page runs\.$/);
    expect(answerWords(k, "bbb/222")).toContain("From another engine version, not the current one: solver build aaa/111, where this page runs bbb/222.");
    expect(answerWords(k, null)).toContain("whether this page runs the same one can't be told");
    expect(answerWords(at("dev"), "aaa/111")).toContain("isn't known, so it can't be called current");
    expect(answerWords(kept(LIBRARY_ANSWER, FLOP_LINE, { libraryVersion: "library:srp_btn_bb:abc" }), "aaa/111")).toContain("Read from library srp_btn_bb abc.");
  });

  it("says when it came in from a file", () => {
    const k = readAnswer({ ...record(CHART_ANSWER, CHART_LINE), restored: true })!;
    expect(answerWords(k, null)).toContain("It came in from a backup file.");
    expect(words(k.result.provenance)).toContain("restored from a backup file");
  });
});
