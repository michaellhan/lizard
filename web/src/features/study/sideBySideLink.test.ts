import { describe, expect, it } from "vitest";
import { keepVs, pickOpp } from "./sideBySideLink";

const opps = [{ seat: "CO" }, { seat: "BTN" }];

describe("pickOpp", () => {
  it("is the seat the link names where it's in the answer, else the first opponent", () => {
    expect(pickOpp(opps, "BTN")).toBe(1);
    expect(pickOpp(opps, "1")).toBe(0);
    expect(pickOpp(opps, "SB")).toBe(0);
  });
  it("is none with no opponent's range, or side by side off", () => {
    expect(pickOpp([], "1")).toBeNull();
    expect(pickOpp(opps, null)).toBeNull();
    expect(pickOpp(opps, "")).toBeNull();
  });
});

describe("keepVs", () => {
  it("keeps the comparison on a new line's link, and leaves a link without it as it was", () => {
    expect(keepVs("p=2&s=100", "BTN")).toBe("p=2&s=100&vs=BTN");
    expect(keepVs("p=2&s=100", null)).toBe("p=2&s=100");
    expect(keepVs("p=2&s=100&vs=1", "CO")).toBe("p=2&s=100&vs=CO");
  });
});
