import { afterEach, describe, expect, it, vi } from "vitest";
import { parseLine } from "@/features/study/studyState";
import { clearSingleSizeCache, coveredFlops, LATER_PCT, loadSingleSize, parseSsIndex, sizeWords, ssMatch, ssRequest, type SsIndex } from "./singleSize";
import { summarizeSingleSize } from "./catalog";

const SRP = "UTG:f,HJ:f,CO:f,BTN:r2.5,SB:f,BB:c";
const FOUR = "UTG:f,HJ:f,CO:f,BTN:r2.5,SB:f,BB:r10,BTN:r23,BB:c";
const IDX: SsIndex = {
  format: 2,
  ss_format: 1,
  flops: ["Ac7d2h", "KcQc8d"],
  spots: [
    {
      id: "ss_srp_btn_bb",
      base: "srp_btn_bb",
      label: "BTN vs BB single-raised pot, single size",
      line: SRP,
      seats: ["BB", "BTN"],
      pot: 5.5,
      stack: 97.5,
      flops: { Ac7d2h: "1111111111", KcQc8d: "2222222222", "5c4d2h": "3333333333" },
      sizes: { Ac7d2h: 25, KcQc8d: 33, "5c4d2h": 75 },
      old: ["Ac7d2h", "KcQc8d", "5c4d2h"],
    },
    {
      id: "ss_4bp_utg_sb",
      label: "UTG 4bet vs SB, single size",
      line: "UTG:r2,HJ:f,CO:f,BTN:f,SB:r9,BB:f,UTG:r23,SB:c",
      seats: ["SB", "UTG"],
      pot: 46.5,
      stack: 77,
      flops: { Ac7d2h: "4444444444", KcQc8d: "5555555555" },
      sizes: { Ac7d2h: 166.6, KcQc8d: 166.6 },
      aliases: [{ label: "HJ 4bet vs SB, single size", line: "UTG:f,HJ:r2,CO:f,BTN:f,SB:r9,BB:f,HJ:r23,SB:c" }],
      turns: true,
    },
  ],
};
const hand = (line: string, board = "") => ({ players: 6, stack: 100, board, preflop: parseLine(line) });

afterEach(() => {
  clearSingleSizeCache();
  vi.restoreAllMocks();
});

describe("the single-size index", () => {
  it("is read only in its own format", () => {
    expect(parseSsIndex(IDX)?.spots).toHaveLength(2);
    expect(parseSsIndex({ ...IDX, ss_format: 2 })).toBeNull();
    expect(parseSsIndex({ format: 2, tree: {}, spots: [] })).toBeNull(); // (the several-size index.json)
    expect(parseSsIndex(null)).toBeNull();
    expect(parseSsIndex({ ...IDX, spots: [{ id: "x" }, ...IDX.spots] })?.spots).toHaveLength(2);
  });

  it("covers the flops every spot holds, in the build's order", () => {
    expect(coveredFlops(IDX)).toEqual(["Ac7d2h", "KcQc8d"]);
    const noList = { ...IDX, flops: undefined };
    expect(coveredFlops(noList).sort()).toEqual(["Ac7d2h", "KcQc8d"]);
  });
});

describe("a hand's single-size spot", () => {
  it("is found by its preflop line, the flop named as the library names it, with that flop's size", () => {
    const m = ssMatch(IDX, hand(SRP, "7d2hAc"));
    expect(m).toMatchObject({ label: "BTN vs BB single-raised pot, single size", flop: "Ac7d2h", pct: 25 });
    expect(m?.spot.id).toBe("ss_srp_btn_bb");
    expect(ssMatch(IDX, hand(SRP, "Ah7s2d"))?.flop).toBe("Ac7d2h"); // (an isomorphic flop)
    expect(ssMatch(IDX, hand(SRP, "Ac7d2h5s"))?.pct).toBe(25); // (a turn: the flop's size)
    expect(ssMatch(IDX, hand(SRP))).toMatchObject({ flop: null, pct: null });
  });

  it("reads an alias line's spot under the alias's label", () => {
    const m = ssMatch(IDX, hand("UTG:f,HJ:r2,CO:f,BTN:f,SB:r9,BB:f,HJ:r23,SB:c", "KcQc8d"));
    expect(m).toMatchObject({ label: "HJ 4bet vs SB, single size", pct: 166.6 });
    expect(m?.spot.id).toBe("ss_4bp_utg_sb");
  });

  it("is none for a flop it doesn't hold, a line it doesn't hold, another game or a setup of the hand's own", () => {
    expect(ssMatch(IDX, hand(SRP, "Qs9h4c"))).toMatchObject({ flop: "Qc9d4h", pct: null });
    expect(ssMatch(IDX, hand(FOUR, "Ac7d2h"))).toBeNull();
    expect(ssMatch(IDX, { ...hand(SRP, "Ac7d2h"), stack: 40 })).toBeNull();
    expect(ssMatch(IDX, { ...hand(SRP, "Ac7d2h"), players: 2 })).toBeNull();
    expect(ssMatch(IDX, { ...hand(SRP, "Ac7d2h"), setup: { rake: { pct: 5, cap: 3 } } })).toBeNull();
    expect(ssMatch(null, hand(SRP, "Ac7d2h"))).toBeNull();
  });

  it("asks with the flop's own size and the model's later-street size, or not at all", () => {
    expect(ssRequest(ssMatch(IDX, hand(SRP, "Ac7d2h")))).toEqual({ single_size: true, sizes: { flop: [25], turn: [LATER_PCT], river: [LATER_PCT] } });
    expect(ssRequest(ssMatch(IDX, hand(SRP, "Qs9h4c")))).toBeNull();
    expect(ssRequest(null)).toBeNull();
  });

  it("says an all-in size as one", () => {
    expect(sizeWords(25)).toBe("25%");
    expect(sizeWords(166.6, IDX.spots[1])).toBe("all-in (166.6%)");
    expect(sizeWords(75, IDX.spots[0])).toBe("75%");
  });
});

describe("loading", () => {
  it("reads ss_index.json uncached, once a page load, and is null where there is none", async () => {
    const seen: [string, RequestInit | undefined][] = [];
    const ok = vi.fn(async (url: string, init?: RequestInit) => {
      seen.push([url, init]);
      return new Response(JSON.stringify(IDX), { status: 200 });
    }) as unknown as typeof fetch;
    expect((await loadSingleSize("/lib/", ok))?.spots).toHaveLength(2);
    await loadSingleSize("/lib/", ok);
    expect(seen).toEqual([["/lib/ss_index.json", { cache: "no-cache" }]]);
    expect(await loadSingleSize("/none/", (async () => new Response("", { status: 404 })) as typeof fetch)).toBeNull();
    expect(await loadSingleSize("/down/", (async () => Promise.reject(new TypeError("offline"))) as typeof fetch)).toBeNull();
  });

  it("goes into the catalogue as its own source, with the flops covered and its target", () => {
    const c = summarizeSingleSize(IDX, { singleSize: { target: 552 } });
    expect(c?.flops).toEqual(["Ac7d2h", "KcQc8d"]);
    expect(c?.target).toBe(552);
    expect(c?.spots.map((s) => [s.id, s.flops])).toEqual([
      ["ss_srp_btn_bb", 3],
      ["ss_4bp_utg_sb", 2],
    ]);
    expect(summarizeSingleSize(null)).toBeNull();
    expect(summarizeSingleSize({ ...IDX, spots: [] })).toBeNull();
  });
});
