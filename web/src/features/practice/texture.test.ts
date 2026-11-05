// @vitest-environment node
// The flops of a texture filter, counted against what the deck says, and what a kept filter may hold.
import { describe, expect, it } from "vitest";
import { flopsLike, isTextureFilter, texture } from "./texture";

describe("flopsLike", () => {
  it("counts the deck's flops", () => {
    expect(flopsLike({})).toHaveLength(22100);
    expect(flopsLike({ suits: "mono" })).toHaveLength(1144);
    expect(flopsLike({ pair: "trips" })).toHaveLength(52);
    expect(flopsLike({ pair: "paired" })).toHaveLength(3744);
    expect(flopsLike({ pair: "trips", hi: "A" })).toHaveLength(4);
  });

  it("every flop has the texture asked, and a filter no flop can meet has none", () => {
    expect(flopsLike({ suits: "mono", conn: "conn" }).every((f) => texture(f).suits === "mono" && texture(f).conn === "conn")).toBe(true);
    expect(flopsLike({ pair: "trips", suits: "twotone" })).toEqual([]);
    expect(flopsLike({ suits: "mono", pair: "paired" })).toEqual([]);
  });
});

describe("isTextureFilter", () => {
  it("takes known groups and values only", () => {
    expect(isTextureFilter({})).toBe(true);
    expect(isTextureFilter({ suits: "mono", hi: "9-" })).toBe(true);
    expect(isTextureFilter({ suits: "mauve" })).toBe(false);
    expect(isTextureFilter({ colour: "mono" })).toBe(false);
    expect(isTextureFilter(null)).toBe(false);
    expect(isTextureFilter(["mono"])).toBe(false);
  });
});
