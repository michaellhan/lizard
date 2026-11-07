// Two panes side by side with a separator between them to drag, or to move with the arrow keys, Home and End; Enter or
// a double-click puts it back (Enter as the ARIA window splitter's own key, and one Study's page keys leave alone).
// Below Tailwind's `lg` the panes stack, as a plain `grid gap-4` with no separator, so a page's narrow layout stays what
// it was.
import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

/** The width the panes sit side by side from: Tailwind's `lg`, in rem as Tailwind writes it. */
const WIDE_QUERY = "(min-width: 64rem)";
/** In px, what the width is read as until it's measured. */
const WIDE_PX = 1024;
/** In px, the separator's column: the 1rem of the `gap-4` it stands in for, so the panes keep the widths they'd have beside a gap. */
const GUTTER = 16;
/** What one press of an arrow key moves, as a share of the width. */
const STEP = 0.02;

export interface SizeLimits {
  min: number;
  max: number;
}

/** The start pane's smallest and largest share of the room beside the gutter, for a container `width` px wide, each pane
 * keeping its own minimum in px. Where the two minimums can't both fit, `min` comes out over `max` (see `clampSize`). */
export function sizeLimits(width: number, minStart: number, minEnd: number): SizeLimits {
  const room = (width > 0 ? width : WIDE_PX) - GUTTER;
  return { min: minStart / room, max: 1 - minEnd / room };
}

/** A share to lay out with, from anything: a saved value can be stale, or not a number at all, and the window can be
 * smaller than the one it was saved on. Anything that isn't a finite number is the default, and with no room for both
 * minimums so is everything. */
export function clampSize(size: unknown, defaultSize: number, { min, max }: SizeLimits): number {
  if (min > max) return defaultSize;
  const s = typeof size === "number" && Number.isFinite(size) ? size : defaultSize;
  return Math.min(max, Math.max(min, s));
}

function subscribeWide(onChange: () => void) {
  if (typeof matchMedia !== "function") return () => {};
  const q = matchMedia(WIDE_QUERY);
  q.addEventListener("change", onChange);
  return () => q.removeEventListener("change", onChange);
}

const isWide = () => typeof matchMedia === "function" && matchMedia(WIDE_QUERY).matches;

export function ResizableWorkspace({
  children: [start, end],
  size,
  onResize,
  defaultSize,
  minStart,
  minEnd,
  label,
}: {
  children: [ReactNode, ReactNode];
  /** the start pane's share of the width, 0 to 1 (null: not moved, read as `defaultSize`); clamped here on every read */
  size: number | null;
  /** when a drag ends or a key moves it; null on the Enter or double-click that resets it */
  onResize: (size: number | null) => void;
  defaultSize: number;
  /** in px, the narrowest each pane can go */
  minStart: number;
  minEnd: number;
  /** what the separator says it resizes */
  label: string;
}) {
  const wide = useSyncExternalStore(subscribeWide, isWide);
  const boxRef = useRef<HTMLDivElement>(null);
  const startId = useId();
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const box = boxRef.current;
    if (!wide || !box || typeof ResizeObserver !== "function") return;
    const seen = new ResizeObserver(([entry]) => entry && setWidth(entry.contentRect.width));
    seen.observe(box);
    return () => seen.disconnect();
  }, [wide]);

  // a drag shows live and is only saved where it ends; `offset` is where in the separator it was picked up, so that
  // picking it up doesn't move it, and a press that never moves saves nothing, which leaves a double-click to reset
  const grab = useRef<{ offset: number; moved: boolean } | null>(null);
  const [dragged, setDragged] = useState<number | null>(null);
  if (!wide && dragged !== null) setDragged(null); // (the window went narrow mid-drag: the separator is gone with it)

  const limits = sizeLimits(width, minStart, minEnd);
  const shown = clampSize(dragged ?? size, defaultSize, limits);

  const sizeAt = (clientX: number, offset: number) => {
    const box = boxRef.current!.getBoundingClientRect();
    return clampSize((clientX - offset - box.left) / (box.width - GUTTER), defaultSize, sizeLimits(box.width, minStart, minEnd));
  };
  const letGo = () => {
    grab.current = null;
    setDragged(null);
  };
  const reset = () => {
    letGo();
    onResize(null);
  };
  const moveTo = (next: number) => {
    const s = clampSize(next, defaultSize, limits);
    if (s !== shown) onResize(s);
  };
  const keys: Record<string, number> = { ArrowLeft: shown - STEP, ArrowRight: shown + STEP, Home: limits.min, End: limits.max };

  return (
    <div
      ref={boxRef}
      className="grid gap-4"
      // (out of 100, not 1: fr values that sum to a hair under 1 would leave that share of the width empty)
      style={wide ? { columnGap: 0, gridTemplateColumns: `minmax(0, ${shown * 100}fr) ${GUTTER}px minmax(0, ${(1 - shown) * 100}fr)` } : undefined}
    >
      <div id={startId} className="min-w-0">
        {start}
      </div>
      {wide && (
        <div
          role="separator"
          tabIndex={0}
          aria-orientation="vertical"
          aria-label={label}
          aria-controls={startId}
          aria-valuenow={Math.round(shown * 100)}
          aria-valuemin={Math.round(Math.min(limits.min, shown) * 100)}
          aria-valuemax={Math.round(Math.max(limits.max, shown) * 100)}
          title="Drag or use the arrow keys to resize, Home and End for the limits. Press Enter or double-click to reset."
          className="group relative cursor-col-resize touch-none select-none"
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.currentTarget.setPointerCapture?.(e.pointerId);
            grab.current = { offset: e.clientX - e.currentTarget.getBoundingClientRect().left, moved: false };
          }}
          onPointerMove={(e) => {
            const g = grab.current;
            if (!g) return;
            if (!(e.buttons & 1)) return letGo(); // (the release was never seen: nothing to save)
            g.moved = true;
            setDragged(sizeAt(e.clientX, g.offset));
          }}
          onPointerUp={(e) => {
            const g = grab.current;
            if (g?.moved) onResize(sizeAt(e.clientX, g.offset));
            letGo();
          }}
          onPointerCancel={letGo}
          onDoubleClick={reset}
          onKeyDown={(e) => {
            const next = keys[e.key];
            if ((next === undefined && e.key !== "Enter") || e.ctrlKey || e.metaKey || e.altKey) return;
            // (handled here, or the page's own arrow keys would walk the line as well: Study skips what's defaultPrevented)
            e.preventDefault();
            if (next === undefined) reset();
            else moveTo(next);
          }}
        >
          <span
            aria-hidden
            className={`pointer-events-none absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 rounded group-hover:bg-border group-focus-visible:bg-accent ${dragged !== null ? "bg-accent" : ""}`}
          />
        </div>
      )}
      <div className="min-w-0">{end}</div>
    </div>
  );
}
