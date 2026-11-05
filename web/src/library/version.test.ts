// A stored answer's version: what moves it and what doesn't, against the shapes index.json and mw_index.json have.
import { describe, expect, it } from "vitest";
import { libFile } from "@/test/library";
import type { LibraryIndex, LibrarySpotIndex } from "./catalog";
import { libraryStamps, spotStamp } from "./version";

const spot = (x: Partial<LibrarySpotIndex> = {}): LibrarySpotIndex =>
  ({ id: "srp_btn_bb", label: "BTN vs BB", line: "", seats: ["BB", "BTN"], fp: ["aa", "bb"], pot: 5.5, stack: 97.5, tree: { sizes: [33] }, flops: { Ac4d3h: "d749b47d1b", "2h2d2c": "119b269e5a" }, ...x }) as LibrarySpotIndex;
const index = (spots: LibrarySpotIndex[], tree: unknown = {}): LibraryIndex => ({ format: 2, tree, spots }) as LibraryIndex;
const idOf = (v: string | undefined) => v?.split(":")[2];

describe("a spot's version", () => {
  it("names the spot, and its flop's entry where it's given one that's stored", () => {
    const id = idOf(spotStamp(spot(), null))!;
    expect(id).toMatch(/^[0-9a-f]{8}$/);
    expect(spotStamp(spot(), null)).toBe(`library:srp_btn_bb:${id}`);
    expect(spotStamp(spot(), null, "Ac4d3h")).toBe(`library:srp_btn_bb:${id}:Ac4d3h:d749b47d1b`);
    expect(spotStamp(spot(), null, "9c8c7c")).toBe(`library:srp_btn_bb:${id}`);
  });

  it("stays as a spot gains flops: a stored answer is the same one", () => {
    const more = spot({ flops: { ...spot().flops, "9c8c7c": "abcdef0123" } });
    expect(spotStamp(more, null, "Ac4d3h")).toBe(spotStamp(spot(), null, "Ac4d3h"));
  });

  it("moves with the ranges, which come from the charts, and with the bet tree", () => {
    const was = idOf(spotStamp(spot(), null));
    expect(idOf(spotStamp(spot({ fp: ["aa", "cc"] }), null))).not.toBe(was);
    expect(idOf(spotStamp(spot({ tree: { sizes: [50] } }), null))).not.toBe(was);
  });

  it("takes the index's tree for a spot with none, as a 3-way spot has", () => {
    const mw = spot({ tree: undefined, fp: ["aa", "bb", "cc"] });
    expect(idOf(spotStamp(mw, { a: 1 }))).not.toBe(idOf(spotStamp(mw, { a: 2 })));
  });

  it("has none where a spot doesn't say its ranges", () => {
    expect(spotStamp(spot({ fp: undefined as never }), null)).toBeUndefined();
    expect(spotStamp(spot({ fp: [] }), null)).toBeUndefined();
  });
});

describe("a library's stamps", () => {
  const mw = spot({ id: "mw_btn_sb_bb", tree: undefined, fp: ["aa", "bb", "cc"] });
  const stamp = libraryStamps(index([spot()]), index([mw], { three: true }));

  it("read a heads-up and a 3-way spot, and say nothing of a spot this library doesn't hold", () => {
    expect(stamp("srp_btn_bb", "Ac4d3h")).toBe(spotStamp(spot(), {}, "Ac4d3h"));
    expect(stamp("mw_btn_sb_bb")).toBe(spotStamp(mw, { three: true }));
    expect(stamp("gone")).toBeUndefined();
  });

  it("give an answer that names no spot the whole library's, which only a spot's version or a new spot moves", () => {
    const whole = stamp();
    expect(whole).toMatch(/^library:\*:[0-9a-f]{8}$/);
    const more = spot({ flops: { ...spot().flops, "9c8c7c": "abcdef0123" } });
    expect(libraryStamps(index([more]), index([mw], { three: true }))()).toBe(whole);
    expect(libraryStamps(index([spot({ fp: ["aa", "cc"] })]), index([mw], { three: true }))()).not.toBe(whole);
    expect(libraryStamps(index([spot(), spot({ id: "new" })]), index([mw], { three: true }))()).not.toBe(whole);
  });

  it("work on the fixture's index, whose every spot says its ranges", () => {
    const ix = JSON.parse(new TextDecoder().decode(libFile("index.json"))) as LibraryIndex;
    const s = libraryStamps(ix);
    for (const sp of ix.spots) expect(s(sp.id, Object.keys(sp.flops ?? {})[0])).toMatch(new RegExp(`^library:${sp.id}:[0-9a-f]{8}`));
  });
});
