import { describe, expect, it } from "vitest";
import { CHART, LIVE, STORED } from "@/test/mistake";
import { countVersions, keptCounts, spotVersion, stampParts, storedMoved, versionNote, versionOf, versionSpan, versionSummary, versionWords } from "./version";

const A = "build:1a14605e/aaaaaaaaaa";
const B = "build:2b25716f/bbbbbbbbbb";
const SPOT = "library:srp_btn_bb:11112222";
const SPOT2 = "library:srp_btn_bb:33334444";
const span = (a: (string | undefined)[], b?: (string | undefined)[]) => versionSpan(countVersions(a), b && countVersions(b));

describe("a grade's version", () => {
  it("is the build for what the solver bundle answered, and the library's own for a stored answer", () => {
    expect(versionOf(LIVE)).toBe("build:1.0");
    expect(versionOf(CHART)).toBe("build:1.0");
    expect(versionOf({ ...STORED, libraryVersion: SPOT })).toBe(SPOT);
    expect(versionOf({ ...STORED, source: "library-turn", libraryVersion: "library:*:ab" })).toBe("library:*:ab");
  });

  it("is unknown where it can't be told: no answer kept, a stored answer with no library version, a local server, a development build", () => {
    expect(versionOf(null)).toBeUndefined();
    expect(versionOf(STORED)).toBeUndefined();
    expect(versionOf({ ...LIVE, transport: "http" })).toBeUndefined();
    expect(versionOf({ ...LIVE, solverVersion: "dev" })).toBeUndefined();
    expect(versionOf({ ...LIVE, solverVersion: "" })).toBeUndefined();
  });

  it("reads in words, and none or a foreign one as unknown", () => {
    expect(versionWords(A)).toBe("solver build 1a14605e/aaaaaaaaaa");
    expect(versionWords(SPOT)).toBe("library srp_btn_bb 11112222");
    expect(versionWords(`${SPOT}:Ac4d3h:d749b47d1b`)).toBe("library srp_btn_bb 11112222");
    expect(versionWords("library:*:abcd")).toBe("library as a whole abcd");
    expect(versionWords(undefined)).toBe("unknown");
    expect(versionWords("something else")).toBe("unknown");
  });

  it("drops its flop's entry for a session's counts", () => {
    expect(spotVersion(`${SPOT}:Ac4d3h:d749b47d1b`)).toBe(SPOT);
    expect(spotVersion(A)).toBe(A);
    expect(spotVersion(`${A}+${SPOT}:Ac4d3h:d749b47d1b`)).toBe(`${A}+${SPOT}`);
  });

  it("is the build and the library for a read at once off the library, as either moving moves the answer", () => {
    const instant = { ...LIVE, source: "instant" as const };
    expect(versionOf(instant)).toBe("build:1.0");
    expect(versionOf({ ...instant, libraryVersion: "library:*:ab" })).toBe("build:1.0+library:*:ab");
    expect(versionOf({ ...instant, libraryVersion: "library:*:ab", solverVersion: "dev" })).toBeUndefined();
    expect(versionWords(`${A}+library:*:abcd`)).toBe("solver build 1a14605e/aaaaaaaaaa and library as a whole abcd");
    expect(versionWords(`${A}+nonsense`)).toBe("unknown");
    expect(stampParts(`${A}+library:*:abcd`)).toEqual({ build: "1a14605e/aaaaaaaaaa", library: "library:*:abcd" });
    expect(stampParts(SPOT)).toEqual({ library: SPOT });
    expect(stampParts(undefined)).toEqual({});
    // (the library moving under the same build is a change, and so is the build under the same library)
    expect(span([`${A}+library:*:aa`], [`${A}+library:*:bb`]).changed.map((c) => c.what)).toEqual(["library as a whole"]);
    expect(span([`${A}+library:*:aa`], [`${B}+library:*:aa`]).changed.map((c) => c.what)).toEqual(["solver build"]);
  });
});

describe("the versions a comparison spans", () => {
  it("says nothing where both sides stand on one known version", () => {
    expect(versionNote(span([A, A], [A]))).toBeNull();
  });

  it("names a build that changed, with each side's", () => {
    const s = span([A, A], [B]);
    expect(s.changed).toEqual([{ what: "solver build", before: ["1a14605e/aaaaaaaaaa"], later: ["2b25716f/bbbbbbbbbb"] }]);
    expect(versionNote(s)).toBe("Graded on different versions: solver build 1a14605e/aaaaaaaaaa before, 2b25716f/bbbbbbbbbb latest.");
  });

  it("finds a change inside one side", () => {
    expect(span([A, B], [B]).changed[0]!.before).toEqual(["1a14605e/aaaaaaaaaa", "2b25716f/bbbbbbbbbb"]);
  });

  it("doesn't call different spots a change: each is read against itself", () => {
    expect(span(["library:srp_btn_bb:1111"], ["library:srp_co_bb:2222"]).changed).toEqual([]);
    expect(span([SPOT], [SPOT2]).changed.map((c) => c.what)).toEqual(["library srp_btn_bb"]);
  });

  it("finds one flop's entry stored again, and a spot's change once", () => {
    const again = span([`${SPOT}:Ac4d3h:aaaa`], [`${SPOT}:Ac4d3h:bbbb`]);
    expect(again.changed).toEqual([{ what: "library srp_btn_bb on Ac4d3h", before: ["aaaa"], later: ["bbbb"] }]);
    // (other flops of one spot have other entries, which says nothing)
    expect(span([`${SPOT}:Ac4d3h:aaaa`], [`${SPOT}:Kd7c2h:bbbb`]).changed).toEqual([]);
    expect(span([`${SPOT}:Ac4d3h:aaaa`], [`${SPOT2}:Ac4d3h:bbbb`]).changed.map((c) => c.what)).toEqual(["library srp_btn_bb"]);
  });

  it("shows no stamp as unknown, never as the version beside it", () => {
    const s = span([undefined, undefined, A], [A]);
    expect(s.changed).toEqual([]);
    expect(versionNote(s)).toBe("Version unknown for 2 of 4 (2 before, 0 latest).");
    expect(versionNote(span([undefined], [undefined]))).toBe("Version unknown (1 before, 1 latest).");
    // (a stamp this page can't read is as good as none)
    expect(versionNote(span(["from a later Lizard"]))).toBe("Version unknown.");
  });

  it("says one change and the unknown together, and sums up several", () => {
    expect(versionNote(span([A, undefined], [B]))).toBe("Graded on different versions: solver build 1a14605e/aaaaaaaaaa before, 2b25716f/bbbbbbbbbb latest. Version unknown for 1 of 3 (1 before, 0 latest).");
    expect(versionNote(span([A, SPOT], [B, SPOT2]))).toBe("Graded on different versions of 2 things: solver build, library srp_btn_bb.");
  });

  it("over one set of grades has no sides", () => {
    expect(versionNote(span([A, B]))).toBe("Graded on different versions: solver build 1a14605e/aaaaaaaaaa and 2b25716f/bbbbbbbbbb.");
    expect(versionNote(span([A, undefined]))).toBe("Version unknown for 1 of 2.");
  });
});

describe("counts a session kept", () => {
  it("leaves the decisions they don't cover unknown, and a session with none all unknown", () => {
    expect(versionNote(versionSpan(keptCounts({ [A]: 2 }, 3)))).toBe("Version unknown for 1 of 3.");
    expect([...keptCounts(undefined, 4)]).toEqual([[null, 4]]);
    expect([...keptCounts({ [A]: 4 }, 4)]).toEqual([[A, 4]]);
  });

  it("counts one it can't read as unknown", () => {
    expect([...keptCounts({ nonsense: 2 }, 2)]).toEqual([[null, 2]]);
  });
});

describe("a stored answer moving", () => {
  it("is its spot or its entry at another version", () => {
    expect(storedMoved(`${SPOT}:Ac4d3h:aaaa`, `${SPOT}:Ac4d3h:aaaa`)).toBe(false);
    expect(storedMoved(`${SPOT}:Ac4d3h:aaaa`, `${SPOT}:Ac4d3h:bbbb`)).toBe(true);
    expect(storedMoved(SPOT, SPOT2)).toBe(true);
  });

  it("can't be said with a side unknown, or from the id for stored turns, which a new spot moves", () => {
    expect(storedMoved(undefined, SPOT)).toBe(false);
    expect(storedMoved(SPOT, undefined)).toBe(false);
    expect(storedMoved("library:*:aaaa", "library:*:bbbb")).toBe(false);
  });
});

describe("a set of grades in a line", () => {
  it("counts each version and the unknown", () => {
    expect(versionSummary(countVersions([A, A, SPOT, undefined]))).toBe("Graded on solver build 1a14605e/aaaaaaaaaa (2), library srp_btn_bb 11112222 (1). Version unknown for 1.");
  });

  it("counts many library versions as one figure, and says when none is known", () => {
    expect(versionSummary(countVersions(["library:a:1", "library:b:2", "library:c:3", "library:d:4"]))).toBe("Graded on 4 library versions (4).");
    expect(versionSummary(countVersions([undefined]))).toBe("Version unknown: none of these grades has one.");
    expect(versionSummary(countVersions([]))).toBeNull();
  });

  it("adds a spot's entries together", () => {
    expect(versionSummary(countVersions([`${SPOT}:Ac4d3h:aa`, `${SPOT}:Kd7c2h:bb`]))).toBe("Graded on library srp_btn_bb 11112222 (2).");
  });
});
