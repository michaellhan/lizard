import { describe, expect, it } from "vitest";
import { loadCatalog, resolveLibrarySource, summarize, type LibraryIndex, type LibraryPlan } from "./catalog";

const INDEX: LibraryIndex = {
  format: 2,
  tree: {},
  spots: [
    { id: "srp_btn_bb", label: "BTN open, BB calls", line: "UTG:f,HJ:f,CO:f,BTN:r2.5,SB:f,BB:c", seats: ["BB", "BTN"], pot: 5.5, stack: 97.5, flops: { Ks7d2c: "0123456789", AhKd5s: "abcdefabcd" }, turns: true },
    { id: "hu100_srp", label: "HU SB open, BB calls", line: "SB:r2.5,BB:c", seats: ["BB", "SB"], pot: 5, stack: 97.5, flops: Object.fromEntries(Array.from({ length: 600 }, (_, i) => [`f${i}`, "x"])), game: { players: 2, stack: 100, ante: 0, straddle: false } },
  ],
};

const MW: LibraryIndex = {
  format: 1,
  tree: {},
  spots: [{ id: "mw_co_btn_bb", label: "CO open, BTN and BB call", line: "UTG:f,HJ:f,CO:r2.5,BTN:c,SB:f,BB:c", seats: ["BB", "CO", "BTN"], pot: 8, stack: 97.5, flops: {} }],
};

const PLAN: LibraryPlan = { spots: { srp_btn_bb: { flops: 2, target: 1755 }, hu100_srp: { flops: 600, target: 1755 } } };

describe("library catalog", () => {
  it("summarizes heads-up and multiway spots with their game and coverage", () => {
    const rows = summarize(INDEX, MW, PLAN);
    expect(rows.map((r) => [r.id, r.kind, r.flops, r.target, r.game, r.inPot])).toEqual([
      ["srp_btn_bb", "srp", 2, 1755, "6-max 100bb", 2],
      ["hu100_srp", "other", 600, 1755, "Heads-up 100bb", 2],
      ["mw_co_btn_bb", "multiway", 0, null, "6-max 100bb", 3],
    ]);
    expect(rows[1]).toMatchObject({ tablePlayers: 2, tableStack: 100 });
  });

  it("does not guess a target when the library does not publish one", () => {
    expect(summarize(INDEX).map((r) => r.target)).toEqual([null, null]);
  });

  it("reads index.json and mw_index.json uncached, and says when a library is not published", async () => {
    const seen: [string, RequestInit | undefined][] = [];
    const fetchOk = (async (url: string, init?: RequestInit) => {
      seen.push([url, init]);
      const body = url.endsWith("mw_index.json") ? MW : url.endsWith("lizard-library.json") ? PLAN : INDEX;
      return new Response(JSON.stringify(body), { status: 200 });
    }) as typeof fetch;
    const cat = await loadCatalog("lizard-library", fetchOk);
    expect(cat.available).toBe(true);
    expect(cat.spots).toHaveLength(3);
    expect(cat.spots[0]?.target).toBe(1755);
    expect(seen.every(([, init]) => init?.cache === "no-cache")).toBe(true);

    const fetch404 = (async () => new Response("", { status: 404 })) as typeof fetch;
    expect(await loadCatalog("lizard-library", fetch404)).toMatchObject({ available: false, spots: [] });
  });

  it("auto-selects Lizard's library once published, else the upstream one", async () => {
    const only = (base: string) => (async (url: string) => new Response("", { status: url.startsWith(base) ? 200 : 404 })) as typeof fetch;
    expect(await resolveLibrarySource(only("/lizard-library/"))).toBe("lizard-library");
    expect(await resolveLibrarySource(only("/gto-solver-library/"))).toBe("gto-solver-library");
  });
});
