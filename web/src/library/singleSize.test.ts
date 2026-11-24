import { afterEach, describe, expect, it, vi } from "vitest";
import { parseLine } from "@/features/study/studyState";
import { clearSingleSizeCache, coveredFlops, gameSpots, gameWords, LATER_PCT, loadSingleSize, MW_LATER_PCT, parseSsIndex, sameGame, sizeWords, ssHandGame, ssMatch, ssRequest, type SsIndex } from "./singleSize";
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
const GAMES: SsIndex = {
  ...IDX,
  spots: [
    ...IDX.spots,
    {
      id: "ss_srp_btn_bb_ante",
      label:
        "BTN vs BB single-raised pot, 1bb big-blind ante (0.17bb a seat), single size",
      line: SRP,
      seats: ["BB", "BTN"],
      pot: 6.52,
      stack: 97.33,
      flops: { "5c4d2h": "6666666666", Ac7d2h: "7777777777" },
      sizes: { "5c4d2h": 33, Ac7d2h: 50 },
      game: { players: 6, stack: 100, ante: 0.17, straddle: false },
      pf: {
        key: "lz4_6max_100bb_a0.17_ch",
        sha1: "7fd4d92bdcb4",
        model: "calibrated class-level model",
        words: "1bb big-blind ante (0.17bb a seat)",
      },
    },
    {
      id: "ss_srp_btn_utg_straddle",
      label: "BTN vs UTG single-raised pot, 2bb straddle from UTG, single size",
      line: "HJ:f,CO:f,BTN:r5,SB:f,BB:f,UTG:c",
      seats: ["UTG", "BTN"],
      pot: 11.5,
      stack: 95,
      flops: { "5c4d2h": "8888888888" },
      sizes: { "5c4d2h": 200 },
      game: { players: 6, stack: 100, ante: 0, straddle: true },
      pf: { key: "lz4_6max_100bb_s_ch", words: "2bb straddle from UTG" },
    },
  ],
};

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

describe("the ante and straddle games' spots", () => {
  it("are read from a setup holding only an ante or a straddle", () => {
    expect(ssHandGame(undefined)).toEqual({ ante: 0, straddle: false });
    expect(ssHandGame({ ante: 0.17 })).toEqual({ ante: 0.17, straddle: false });
    expect(ssHandGame({ straddle: true, ante: undefined })).toEqual({
      ante: 0,
      straddle: true,
    });
    expect(ssHandGame({ ante: 0.17, rake: { pct: 5, cap: 3 } })).toBeNull();
    expect(sameGame(undefined, { ante: 0, straddle: false })).toBe(true);
    expect(
      sameGame(GAMES.spots[2]!.game, { ante: 0.17, straddle: false }),
    ).toBe(true);
    expect(sameGame(GAMES.spots[2]!.game, { ante: 0.2, straddle: false })).toBe(
      false,
    );
  });

  it("match a hand of their game only, and the 100bb spots only a hand without an ante or straddle", () => {
    const anted = { ...hand(SRP, "5c4d2h"), setup: { ante: 0.17 } };
    expect(ssMatch(GAMES, anted)).toMatchObject({ pct: 33, flop: "5c4d2h" });
    expect(ssMatch(GAMES, anted)?.spot.id).toBe("ss_srp_btn_bb_ante");
    expect(ssMatch(GAMES, hand(SRP, "Ac7d2h"))?.spot.id).toBe("ss_srp_btn_bb");
    expect(ssMatch(GAMES, { ...anted, setup: { ante: 0.1 } })).toBeNull();
    expect(
      ssMatch(GAMES, { ...anted, setup: { ante: 0.17, straddle: true } }),
    ).toBeNull();
    expect(ssMatch(IDX, anted)).toBeNull();
    const straddled = {
      ...hand("HJ:f,CO:f,BTN:r5,SB:f,BB:f,UTG:c", "4d5c2h"),
      setup: { straddle: true },
    };
    expect(ssMatch(GAMES, straddled)).toMatchObject({
      pct: 200,
      flop: "5c4d2h",
    });
    expect(ssRequest(ssMatch(GAMES, straddled))).toEqual({
      single_size: true,
      sizes: { flop: [200], turn: [LATER_PCT], river: [LATER_PCT] },
    });
  });

  it("cover their own flops, and leave the 100bb spots' as they were", () => {
    expect(coveredFlops(GAMES)).toEqual(["Ac7d2h", "KcQc8d"]);
    expect(coveredFlops(GAMES, { ante: 0.17, straddle: false })).toEqual([
      "5c4d2h",
      "Ac7d2h",
    ]);
    expect(coveredFlops(GAMES, { ante: 0, straddle: true })).toEqual([
      "5c4d2h",
    ]);
    expect(coveredFlops(GAMES, { ante: 0.5, straddle: false })).toEqual([]);
    expect(gameWords({ ante: 0.17, straddle: false }, GAMES.spots[2]!.pf)).toBe(
      "1bb big-blind ante (0.17bb a seat)",
    );
    expect(gameWords({ ante: 0.1, straddle: false })).toBe("0.1bb ante a seat");
  });

  it("go into the catalogue under their games, with their own flops", () => {
    const c = summarizeSingleSize(GAMES, {
      singleSize: { target: 552, games: { target: 1755 } },
    })!;
    expect(c.flops).toEqual(["Ac7d2h", "KcQc8d"]);
    expect(c.games).toEqual([
      {
        ante: 0.17,
        straddle: false,
        words: "1bb big-blind ante (0.17bb a seat)",
        flops: ["5c4d2h", "Ac7d2h"],
        target: 1755,
      },
      {
        ante: 0,
        straddle: true,
        words: "2bb straddle from UTG",
        flops: ["5c4d2h"],
        target: 1755,
      },
    ]);
    expect(c.spots[2]).toMatchObject({
      id: "ss_srp_btn_bb_ante",
      game: { ante: 0.17, straddle: false },
      gameWords: "1bb big-blind ante (0.17bb a seat)",
      target: 1755,
    });
    expect(c.spots[0]).not.toHaveProperty("game");
    const only = summarizeSingleSize({
      ...GAMES,
      flops: [],
      spots: GAMES.spots.slice(2),
    })!;
    expect(only.flops).toEqual([]);
    expect(only.games).toHaveLength(2);
  });
});

const MW_LINE = "UTG:f,HJ:f,CO:f,BTN:r2.5,SB:c,BB:c";
const MW3: SsIndex = {
  ...IDX,
  spots: [
    ...IDX.spots,
    {
      id: "ss_mw_btn_sb_bb",
      base: "mw_btn_sb_bb",
      label: "BTN open, SB and BB call, 3-way single size",
      line: MW_LINE,
      seats: ["SB", "BB", "BTN"],
      pot: 7.5,
      stack: 97.5,
      players: 3,
      flops: { Ac7d2h: "8888888888", Qs9h4c: "9999999999" },
      sizes: { Ac7d2h: 33, Qs9h4c: 33 },
      conv: { iters: 400, expl: 0.08, max_expl: 0.1, target: 0.1 },
    },
  ],
};

describe("the 3-way set", () => {
  it("matches a 3-way line and asks its flop with 50% turn and river bets", () => {
    const m = ssMatch(MW3, hand(MW_LINE, "7dAc2h"));
    expect(m?.spot.id).toBe("ss_mw_btn_sb_bb");
    expect(m?.flop).toBe("Ac7d2h");
    expect(m?.pct).toBe(33);
    expect(ssRequest(m)).toEqual({ single_size: true, sizes: { flop: [33], turn: [MW_LATER_PCT], river: [MW_LATER_PCT] } });
    expect(MW_LATER_PCT).toBe(50);
    // a heads-up line still asks 75%
    expect(ssRequest(ssMatch(MW3, hand(SRP, "Ac7d2h")))?.sizes?.turn).toEqual([LATER_PCT]);
    // a flop the 3-way spot doesn't hold: asked as without
    expect(ssRequest(ssMatch(MW3, hand(MW_LINE, "KcQc8d")))).toBeNull();
  });

  it("keeps its spots and flops apart from the heads-up ones", () => {
    expect(gameSpots(MW3).map((s) => s.id)).toEqual(["ss_srp_btn_bb", "ss_4bp_utg_sb"]);
    expect(gameSpots(MW3, undefined, 3).map((s) => s.id)).toEqual(["ss_mw_btn_sb_bb"]);
    expect(coveredFlops(MW3)).toEqual(["Ac7d2h", "KcQc8d"]);
    expect(coveredFlops(MW3, undefined, 3)).toEqual(["Ac7d2h", "Qs9h4c"]);
    // (an ante game holds no 3-way rows)
    expect(gameSpots(MW3, { ante: 0.17, straddle: false }, 3)).toEqual([]);
  });

  it("parses its rows and goes into the catalogue with its own flops, size, target and convergence", () => {
    expect(parseSsIndex(JSON.parse(JSON.stringify(MW3)))?.spots.find((s) => s.players === 3)?.conv?.iters).toBe(400);
    const c = summarizeSingleSize(MW3, { singleSize: { target: 552, multiway: { target: 552 } } });
    expect(c?.multiway).toEqual({ flops: ["Ac7d2h", "Qs9h4c"], target: 552, pct: 33 });
    expect(c?.flops).toEqual(["Ac7d2h", "KcQc8d"]);
    const row = c?.spots.find((s) => s.id === "ss_mw_btn_sb_bb");
    expect(row).toMatchObject({ players: 3, target: 552, flops: 2, conv: { iters: 400, expl: 0.08 } });
    expect(summarizeSingleSize(IDX)?.multiway).toBeNull();
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
