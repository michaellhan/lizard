import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { clampSize, ResizableWorkspace, sizeLimits } from "./ResizableWorkspace";

const WIDTH = 1016; // 1000px of room beside the 16px gutter, so a share is its px / 10
const DEFAULT = 1.4 / 2.4;
const opts = { defaultSize: DEFAULT, minStart: 400, minEnd: 300, label: "Resize" };

// jsdom has neither media queries nor layout: `wideNow` says what the window matches, and the box and the separator have
// the boxes below. Changing either in a test goes through `resizeTo` / `goNarrow`.
const page = vi.hoisted(() => ({
  wideNow: true,
  listeners: new Set<() => void>(),
  observers: new Set<(entries: { contentRect: { width: number } }[]) => void>(),
}));

function stubWindow(wide: boolean, width = WIDTH) {
  page.wideNow = wide;
  vi.stubGlobal("matchMedia", (q: string) => ({
    get matches() {
      expect(q).toBe("(min-width: 64rem)");
      return page.wideNow;
    },
    addEventListener: (_: string, f: () => void) => page.listeners.add(f),
    removeEventListener: (_: string, f: () => void) => page.listeners.delete(f),
  }));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      cb: (entries: { contentRect: { width: number } }[]) => void;
      constructor(cb: (entries: { contentRect: { width: number } }[]) => void) {
        this.cb = cb;
      }
      observe() {
        page.observers.add(this.cb);
        this.cb([{ contentRect: { width } }]); // (a real one reports once on observe, a moment later)
      }
      disconnect() {
        page.observers.delete(this.cb);
      }
    },
  );
  // the box at x=100; the separator where the start pane's share puts it
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const box = { left: 100, width, top: 0, right: 100 + width, bottom: 100, height: 100, x: 100, y: 0, toJSON: () => ({}) };
    if (this.getAttribute("role") !== "separator") return box;
    const left = 100 + Number(this.getAttribute("aria-valuenow")) * ((width - 16) / 100);
    return { ...box, left, width: 16, right: left + 16 };
  });
}

function resizeTo(width: number) {
  act(() => page.observers.forEach((f) => f([{ contentRect: { width } }])));
}

function goNarrow() {
  page.wideNow = false;
  act(() => page.listeners.forEach((f) => f()));
}

function Harness({ saved = null as number | null, onResize = (_: number | null) => {} }) {
  const [size, setSize] = useState(saved);
  return (
    <ResizableWorkspace
      {...opts}
      size={size}
      onResize={(s) => {
        setSize(s);
        onResize(s);
      }}
    >
      <p>start</p>
      <p>end</p>
    </ResizableWorkspace>
  );
}

const separator = () => screen.getByRole("separator");
const columns = () => (screen.getByText("start").parentElement!.parentElement as HTMLElement).style.gridTemplateColumns;
/** the start column's share, read from the template it's laid out with */
const laidOut = () => {
  const m = /^minmax\(0(?:px)?, ([\d.]+)fr\) 16px minmax\(0(?:px)?, ([\d.]+)fr\)$/.exec(columns());
  return m ? Number(m[1]) / (Number(m[1]) + Number(m[2])) : null;
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  page.listeners.clear();
  page.observers.clear();
});

describe("clampSize", () => {
  const limits = sizeLimits(WIDTH, 400, 300);

  it("keeps each pane its minimum in px", () => {
    expect(limits.min).toBeCloseTo(0.4);
    expect(limits.max).toBeCloseTo(0.7);
    expect(clampSize(0.55, DEFAULT, limits)).toBe(0.55);
    expect(clampSize(0.1, DEFAULT, limits)).toBeCloseTo(0.4);
    expect(clampSize(0.95, DEFAULT, limits)).toBeCloseTo(0.7);
  });

  it("reads anything that isn't a share as the default, or as the nearest limit", () => {
    for (const junk of [null, undefined, "0.5", NaN, Infinity, -Infinity, {}, [], true]) expect(clampSize(junk, DEFAULT, limits)).toBe(DEFAULT);
    expect(clampSize(-3, DEFAULT, limits)).toBeCloseTo(0.4);
    expect(clampSize(1e9, DEFAULT, limits)).toBeCloseTo(0.7);
  });

  it("falls back to the default when the two minimums can't both fit", () => {
    const tight = sizeLimits(600, 400, 300);
    expect(tight.min).toBeGreaterThan(tight.max);
    expect(clampSize(0.2, DEFAULT, tight)).toBe(DEFAULT);
  });

  it("works from a usable width until the real one is measured", () => {
    expect(sizeLimits(0, 400, 300)).toEqual(sizeLimits(1024, 400, 300));
  });
});

describe("ResizableWorkspace", () => {
  it("lays out the default in the same proportion as before, with the separator where the gap was", () => {
    stubWindow(true);
    render(<Harness />);
    expect(laidOut()).toBeCloseTo(DEFAULT, 10);
    // 1.4fr and 1fr of the 1000px beside a 16px gap
    expect(laidOut()! * 1000).toBeCloseTo((1000 * 1.4) / 2.4, 6);
  });

  it("describes itself as a vertical separator with its value and limits", () => {
    stubWindow(true);
    render(<Harness />);
    const s = separator();
    expect(s).toHaveAttribute("aria-orientation", "vertical");
    expect(s).toHaveAttribute("aria-valuenow", "58");
    expect(s).toHaveAttribute("aria-valuemin", "40");
    expect(s).toHaveAttribute("aria-valuemax", "70");
    expect(s).toHaveAttribute("tabindex", "0");
    expect(s).toHaveAccessibleName("Resize");
    expect(s.getAttribute("aria-controls")).toBe(screen.getByText("start").parentElement!.id);
    expect(s.querySelector("span")!.className).toContain("group-focus-visible:bg-accent");
  });

  it("drags, live, saving only where the drag ends, with the separator staying under the pointer", () => {
    stubWindow(true);
    const saved = vi.fn();
    render(<Harness saved={0.5} onResize={saved} />);
    // the separator's left edge is at 100 + 500, picked up 6px in
    fireEvent.pointerDown(separator(), { button: 0, buttons: 1, clientX: 606, pointerId: 1 });
    fireEvent.pointerMove(separator(), { buttons: 1, clientX: 656, pointerId: 1 });
    expect(laidOut()).toBeCloseTo(0.55);
    expect(saved).not.toHaveBeenCalled();
    fireEvent.pointerUp(separator(), { button: 0, clientX: 666, pointerId: 1 });
    expect(saved).toHaveBeenCalledTimes(1);
    expect(saved.mock.calls[0]![0]).toBeCloseTo(0.56);
    expect(laidOut()).toBeCloseTo(0.56);
  });

  it("stops a drag at either limit", () => {
    stubWindow(true);
    const saved = vi.fn();
    render(<Harness saved={0.5} onResize={saved} />);
    fireEvent.pointerDown(separator(), { button: 0, buttons: 1, clientX: 600, pointerId: 1 });
    fireEvent.pointerMove(separator(), { buttons: 1, clientX: 5000, pointerId: 1 });
    expect(laidOut()).toBeCloseTo(0.7);
    fireEvent.pointerMove(separator(), { buttons: 1, clientX: -5000, pointerId: 1 });
    expect(laidOut()).toBeCloseTo(0.4);
    fireEvent.pointerUp(separator(), { button: 0, clientX: -5000, pointerId: 1 });
    expect(saved.mock.calls[0]![0]).toBeCloseTo(0.4);
  });

  it("saves nothing on a press that doesn't move, and ignores other buttons", () => {
    stubWindow(true);
    const saved = vi.fn();
    render(<Harness onResize={saved} />);
    fireEvent.pointerDown(separator(), { button: 0, buttons: 1, clientX: 600, pointerId: 1 });
    fireEvent.pointerUp(separator(), { button: 0, clientX: 600, pointerId: 1 });
    fireEvent.pointerDown(separator(), { button: 2, buttons: 2, clientX: 600, pointerId: 1 });
    fireEvent.pointerMove(separator(), { buttons: 2, clientX: 700, pointerId: 1 });
    fireEvent.pointerUp(separator(), { button: 2, clientX: 700, pointerId: 1 });
    expect(saved).not.toHaveBeenCalled();
    expect(laidOut()).toBeCloseTo(DEFAULT);
  });

  it("drops a cancelled drag, and one whose release was never seen", () => {
    stubWindow(true);
    const saved = vi.fn();
    render(<Harness saved={0.5} onResize={saved} />);
    fireEvent.pointerDown(separator(), { button: 0, buttons: 1, clientX: 600, pointerId: 1 });
    fireEvent.pointerMove(separator(), { buttons: 1, clientX: 650, pointerId: 1 });
    fireEvent.pointerCancel(separator(), { pointerId: 1 });
    expect(laidOut()).toBeCloseTo(0.5);
    fireEvent.pointerDown(separator(), { button: 0, buttons: 1, clientX: 600, pointerId: 1 });
    fireEvent.pointerMove(separator(), { buttons: 1, clientX: 650, pointerId: 1 });
    fireEvent.pointerMove(separator(), { buttons: 0, clientX: 700, pointerId: 1 });
    expect(laidOut()).toBeCloseTo(0.5);
    expect(saved).not.toHaveBeenCalled();
  });

  it("moves on the arrow keys, Home and End going to the limits", () => {
    stubWindow(true);
    const saved = vi.fn();
    render(<Harness saved={0.5} onResize={saved} />);
    const s = separator();
    fireEvent.keyDown(s, { key: "ArrowRight" });
    expect(s).toHaveAttribute("aria-valuenow", "52");
    fireEvent.keyDown(s, { key: "ArrowLeft" });
    fireEvent.keyDown(s, { key: "ArrowLeft" });
    expect(s).toHaveAttribute("aria-valuenow", "48");
    fireEvent.keyDown(s, { key: "Home" });
    expect(s).toHaveAttribute("aria-valuenow", "40");
    expect(saved).toHaveBeenLastCalledWith(expect.closeTo(0.4));
    fireEvent.keyDown(s, { key: "End" });
    expect(s).toHaveAttribute("aria-valuenow", "70");
    saved.mockClear();
    fireEvent.keyDown(s, { key: "ArrowRight" }); // (already at the limit: nothing new to save)
    expect(saved).not.toHaveBeenCalled();
  });

  it("keeps the arrow keys from the page's own shortcuts, unless a modifier is held", () => {
    stubWindow(true);
    render(<Harness saved={0.5} />);
    const seen: boolean[] = [];
    const on = (e: KeyboardEvent) => seen.push(e.defaultPrevented);
    window.addEventListener("keydown", on);
    fireEvent.keyDown(separator(), { key: "ArrowLeft" });
    fireEvent.keyDown(separator(), { key: "ArrowLeft", altKey: true });
    fireEvent.keyDown(separator(), { key: "b" });
    expect(separator()).toHaveAttribute("aria-valuenow", "48");
    fireEvent.keyDown(separator(), { key: "Home" });
    window.removeEventListener("keydown", on);
    expect(seen).toEqual([true, false, false, true]);
  });

  it("resets to the default on a double-click, saving that it isn't set", () => {
    stubWindow(true);
    const saved = vi.fn();
    render(<Harness saved={0.65} onResize={saved} />);
    expect(separator()).toHaveAttribute("aria-valuenow", "65");
    fireEvent.pointerDown(separator(), { button: 0, buttons: 1, clientX: 750, pointerId: 1 });
    fireEvent.pointerUp(separator(), { button: 0, clientX: 750, pointerId: 1 });
    fireEvent.pointerDown(separator(), { button: 0, buttons: 1, clientX: 750, pointerId: 1 });
    fireEvent.pointerUp(separator(), { button: 0, clientX: 750, pointerId: 1 });
    fireEvent.doubleClick(separator());
    expect(saved.mock.calls).toEqual([[null]]);
    expect(laidOut()).toBeCloseTo(DEFAULT);
  });

  it.each([
    ["too small", 0.01, 40],
    ["too large", 0.99, 70],
    ["negative", -1, 40],
    ["not a number", NaN, 58],
    ["a string", "wide" as unknown as number, 58],
  ])("clamps a saved value that's %s on read", (_, saved, shown) => {
    stubWindow(true);
    render(<Harness saved={saved} />);
    expect(separator()).toHaveAttribute("aria-valuenow", String(shown));
    expect(laidOut()).toBeCloseTo(shown / 100, 1);
  });

  it("clamps again in a window smaller than the one it was saved on, without touching what's saved", () => {
    stubWindow(true);
    const saved = vi.fn();
    render(<Harness saved={0.7} onResize={saved} />);
    expect(separator()).toHaveAttribute("aria-valuenow", "70");
    resizeTo(816); // 800px of room: the end pane's 300px is now 37.5%
    expect(separator()).toHaveAttribute("aria-valuenow", "63");
    expect(separator()).toHaveAttribute("aria-valuemin", "50");
    resizeTo(WIDTH);
    expect(separator()).toHaveAttribute("aria-valuenow", "70");
    expect(saved).not.toHaveBeenCalled();
  });

  it("stacks as a plain grid with no separator below the wide width, keeping the panes mounted either side of it", () => {
    stubWindow(false);
    const { container, rerender } = render(<Harness saved={0.65} />);
    expect(screen.queryByRole("separator")).toBeNull();
    const box = container.firstElementChild as HTMLElement;
    expect(box.className).toBe("grid gap-4");
    expect(box.getAttribute("style")).toBeNull();
    expect(box.children).toHaveLength(2);
    const start = screen.getByText("start");
    page.wideNow = true;
    act(() => page.listeners.forEach((f) => f()));
    rerender(<Harness saved={0.65} />);
    expect(separator()).toHaveAttribute("aria-valuenow", "65");
    expect(screen.getByText("start")).toBe(start);
  });

  it("drops a drag when the window goes narrow under it", () => {
    stubWindow(true);
    const saved = vi.fn();
    render(<Harness saved={0.5} onResize={saved} />);
    fireEvent.pointerDown(separator(), { button: 0, buttons: 1, clientX: 600, pointerId: 1 });
    fireEvent.pointerMove(separator(), { buttons: 1, clientX: 650, pointerId: 1 });
    goNarrow();
    expect(screen.queryByRole("separator")).toBeNull();
    page.wideNow = true;
    act(() => page.listeners.forEach((f) => f()));
    expect(laidOut()).toBeCloseTo(0.5);
    expect(saved).not.toHaveBeenCalled();
  });

  it("stacks where the browser has no media queries", () => {
    render(<Harness />);
    expect(screen.queryByRole("separator")).toBeNull();
  });
});
