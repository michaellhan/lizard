import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { KEPT_PREFIX, readKept, useKept } from "./kept";

describe("a control's kept pick", () => {
  it("is kept in the browser, read back, and let go when it's no longer offered", () => {
    const ok = (s: string): s is "a" | "b" => s === "a" || s === "b";
    const { result, unmount } = renderHook(() => useKept("t", ok));
    expect(result.current[0]).toBeNull();
    act(() => result.current[1]("b"));
    expect(result.current[0]).toBe("b");
    expect(readKept("t")).toBe("b");
    unmount();
    expect(renderHook(() => useKept("t", ok)).result.current[0]).toBe("b");
    localStorage.setItem(`${KEPT_PREFIX}t`, "gone");
    expect(renderHook(() => useKept("t", ok)).result.current[0]).toBeNull();
    const last = renderHook(() => useKept("t", ok));
    act(() => last.result.current[1](null));
    expect(readKept("t")).toBeNull();
  });
});
