import { afterEach, describe, expect, it, vi } from "vitest";
import { bringIntoView } from "./scroll";

afterEach(() => vi.unstubAllGlobals());

const asked = (reduce: boolean) => {
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: reduce && q.includes("reduce") }));
  const scrollIntoView = vi.fn();
  bringIntoView({ scrollIntoView } as unknown as Element);
  return scrollIntoView.mock.calls[0]![0] as ScrollIntoViewOptions;
};

describe("bringIntoView", () => {
  it("scrolls smoothly, but not for a reader who asks for less motion", () => {
    expect(asked(false).behavior).toBe("smooth");
    expect(asked(true).behavior).toBe("auto");
  });

  it("does nothing without an element, or where the browser can't tell", () => {
    vi.stubGlobal("matchMedia", undefined);
    expect(() => bringIntoView(null)).not.toThrow();
  });
});
