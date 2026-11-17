// A 3-way spot's report weights and its heads.json, as the spot grows from its 185 flops to every flop.
import { describe, expect, it } from "vitest";
import type { LibrarySpotIndex } from "./catalog";
import { decodeHead } from "./entry";
import { LibraryFiles } from "./files";
import { flopWeights, reportFromHeads, reportFromHeadsFile, type MwHeads } from "./mwReport";
import { hasSnapshot, libFile, libJson, snapshotFile, snapshotJson } from "@/test/library";
import type { LibraryIndex } from "./catalog";

const RANKS = "23456789TJQKA";
const SUITS = "cdhs";

/** every canonical flop (one name per suit-isomorphism class) and how many of the 22100 it stands for */
function canonicalFlops(): Map<string, number> {
  const perms: number[][] = [];
  for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) for (let c = 0; c < 4; c++) for (let d = 0; d < 4; d++) if (new Set([a, b, c, d]).size === 4) perms.push([a, b, c, d]);
  const name = (cs: number[]) =>
    [...cs]
      .sort((x, y) => y - x)
      .map((c) => RANKS[c >> 2]! + SUITS[c & 3]!)
      .join("");
  const out = new Map<string, number>();
  for (let x = 0; x < 52; x++)
    for (let y = x + 1; y < 52; y++)
      for (let z = y + 1; z < 52; z++) {
        const k = perms.map((p) => name([x, y, z].map((c) => (c & ~3) | p[c & 3]!))).sort()[0]!;
        out.set(k, (out.get(k) ?? 0) + 1);
      }
  return out;
}
const ALL = canonicalFlops();
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe("3-way report weights", () => {
  it("weigh every flop by its own suit count once the spot holds all 1,755", () => {
    expect(ALL.size).toBe(1755);
    const names = [...ALL.keys()];
    const w = flopWeights(names);
    names.forEach((f, i) => expect(w[i], f).toBeCloseTo(ALL.get(f)!, 9));
  });

  it("always stand for all 22100 flops, whatever part of them is stored", () => {
    const names = [...ALL.keys()];
    let seed = 7;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (const n of [1, 3, 40, 185, 552, 1200]) {
      const pick = names.filter(() => rand() < n / names.length);
      if (!pick.length) continue;
      expect(sum(flopWeights(pick)), String(n)).toBeCloseTo(22100, 6);
      expect(flopWeights(pick).every((x) => x > 0)).toBe(true);
    }
    // one rainbow and one monotone flop: each takes its own pattern's weight (24 and 4 for each of the 286 rank sets),
    // and the textures neither is (two-tone, paired, trips) go half to each
    const w = flopWeights(["Kc7d2h", "9c8c3c"]);
    const rest = (22100 - 24 * 286 - 4 * 286) / 2;
    expect(w[0]).toBeCloseTo(24 * 286 + rest, 6);
    expect(w[1]).toBeCloseTo(4 * 286 + rest, 6);
  });

  it("weigh a flop by its stratum's weight shared among the stratum's stored flops", () => {
    // K-high rainbow: C(11,2) = 55 canonical flops of 24 each, shared by the two stored; A-high: 66, the one stored;
    // the rest (the lower highs, and every other texture) shared by all three
    const w = flopWeights(["Kc7d2h", "Kc9d4h", "Ac7d2h"]);
    expect(w[0]).toBeCloseTo(w[1]!, 9);
    expect(w[2]! - w[0]!).toBeCloseTo(66 * 24 - (55 * 24) / 2, 6);
  });

  it("read the fixture's six flops as the whole flop space, each by its texture", async () => {
    const mw = libJson<LibraryIndex>("mw_index.json");
    const sp = mw.spots[0]!;
    const flops = Object.keys(sp.flops).sort();
    const rep = reportFromHeads(sp, await Promise.all(flops.map((f) => decodeHead(libFile(`${sp.id}/${f}.bin`)))));
    expect(sum(rep.flops.map((x) => x.w))).toBeCloseTo(22100, 6);
    expect(rep.flops.every((x) => x.w > 0)).toBe(true);
  });

  it.skipIf(!hasSnapshot)("move the snapshot's 185-flop averages little from its sample's equal weights", async () => {
    for (const sp of snapshotJson<LibraryIndex>("mw_index.json").spots) {
      const flops = Object.keys(sp.flops).sort();
      const rep = reportFromHeads(sp, await Promise.all(flops.map((f) => decodeHead(snapshotFile(`${sp.id}/${f}.bin`)))));
      const equal = rep.flops.map((x) => (x.f === "Kc7d2h" ? 0 : 22100 / 184));
      for (const path of Object.keys(rep.nodes)) {
        const avg = (w: number[]) => rep.nodes[path]!.map((_, a) => sum(rep.flops.map((x, i) => w[i]! * x.n[path]![a]!)) / sum(w));
        const [now, was] = [avg(rep.flops.map((x) => x.w)), avg(equal)];
        now.forEach((x, a) => expect(Math.abs(x - was[a]!), `${sp.id} '${path}' ${rep.nodes[path]![a]}`).toBeLessThan(0.02));
      }
    }
  });
});

const SPOT: LibrarySpotIndex = {
  id: "mw_btn_sb_bb",
  label: "BTN open, SB and BB call",
  line: "UTG:f,HJ:f,CO:f,BTN:r2.5,SB:c,BB:c",
  seats: ["SB", "BB", "BTN"],
  pot: 7.5,
  stack: 97.5,
  flops: { Kc7d2h: "aaaaaaaaaa", "9c8c3c": "bbbbbbbbbb" },
  heads: "cccccccccc",
};
const NAMES = ["check", "bet 33%", "bet 75%"];
const HEADS: MwHeads = {
  format: 1,
  nodes: { "": NAMES, check: NAMES, "check|check": NAMES },
  flops: {
    Kc7d2h: { "": [0.8, 0.2, 0], check: [0.9, 0.1, 0], "check|check": [0.5, 0.5, 0] },
    "9c8c3c": { "": [0.7, 0.3, 0], check: [0.6, 0.4, 0], "check|check": [0.4, 0.6, 0] },
  },
};

describe("a 3-way spot's heads.json", () => {
  it("makes the report when it holds the spot's flops, and is passed over when it doesn't", () => {
    const rep = reportFromHeadsFile(SPOT, HEADS)!;
    expect(rep.flops.map((x) => x.f)).toEqual(["9c8c3c", "Kc7d2h"]);
    expect(rep.flops[1]!.n.check).toEqual([0.9, 0.1, 0]);
    expect(rep.nodes).toEqual(HEADS.nodes);
    expect([rep.seats, rep.pot, rep.line]).toEqual([SPOT.seats, 7.5, SPOT.line]);
    expect(reportFromHeadsFile({ ...SPOT, flops: { ...SPOT.flops, AcKdQh: "dddddddddd" } }, HEADS)).toBeNull();
    expect(reportFromHeadsFile(SPOT, { ...HEADS, format: 2 })).toBeNull();
  });

  it("is the one file the page reads for the report; without it (or if it fails) the entries are read", async () => {
    const urls: string[] = [];
    const entries = new Map(Object.keys(SPOT.flops).map((f) => [f, libFile(`mw_btn_sb_bb/${f === "Kc7d2h" ? f : "4c3c2c"}.bin`)]));
    const fetchImpl = (async (u: string) => {
      urls.push(u);
      const path = u.slice("lib/".length).split("?")[0]!;
      if (path.endsWith("heads.json")) return new Response(JSON.stringify(HEADS));
      const f = path.split("/")[1]!.replace(".bin", "");
      return new Response(new Uint8Array(entries.get(f)!));
    }) as typeof fetch;
    const rep = await new LibraryFiles("lib/", fetchImpl).mwReport(SPOT);
    expect(urls).toEqual(["lib/mw_btn_sb_bb/heads.json?v=cccccccccc"]);
    expect(rep.flops).toHaveLength(2);

    urls.length = 0;
    const noHeads = { ...SPOT, heads: undefined };
    await new LibraryFiles("lib/", fetchImpl).mwReport(noHeads);
    expect(urls.sort()).toEqual(["lib/mw_btn_sb_bb/9c8c3c.bin?v=bbbbbbbbbb", "lib/mw_btn_sb_bb/Kc7d2h.bin?v=aaaaaaaaaa"]);

    urls.length = 0;
    const stale = { ...SPOT, flops: { ...SPOT.flops } };
    const bad = (async (u: string) => (u.includes("heads.json") ? new Response("nope", { status: 404 }) : fetchImpl(u))) as typeof fetch;
    const rep2 = await new LibraryFiles("lib/", bad).mwReport(stale);
    expect(rep2.flops).toHaveLength(2);
    expect(urls.filter((u) => u.endsWith(".bin?v=aaaaaaaaaa") || u.endsWith(".bin?v=bbbbbbbbbb"))).toHaveLength(2);
  });
});
