// The 13x13 grids' keyboard: one tab stop, moved with the arrows (Home and End along the row, Ctrl+Home and Ctrl+End to the
// first and last cells), as role=grid promises. Cells go in reading order inside the element that takes `gridProps`.
import { useState, type FocusEvent, type KeyboardEvent } from "react";
import { classLabel, RANKS } from "@/engine/nlhe/cards";

const SIZE = RANKS.length;
const CELL = '[role="gridcell"]';

/** Where a key takes the cell at index i (row * 13 + column): null for a key of no use here. An edge holds. */
export function gridMove(i: number, key: string, ctrl: boolean): number | null {
  const row = Math.floor(i / SIZE);
  const col = i % SIZE;
  switch (key) {
    case "ArrowLeft":
      return row * SIZE + Math.max(0, col - 1);
    case "ArrowRight":
      return row * SIZE + Math.min(SIZE - 1, col + 1);
    case "ArrowUp":
      return Math.max(0, row - 1) * SIZE + col;
    case "ArrowDown":
      return Math.min(SIZE - 1, row + 1) * SIZE + col;
    case "Home":
      return ctrl ? 0 : row * SIZE;
    case "End":
      return ctrl ? SIZE * SIZE - 1 : row * SIZE + SIZE - 1;
    default:
      return null;
  }
}

/** The tab stop of one grid: the cell last on, else the selected one, else the first. `stop` is that cell's class. */
export function useRovingGrid(selected?: string | null) {
  const [at, setAt] = useState<string | null>(null);
  const cellsOf = (box: HTMLElement) => [...box.querySelectorAll<HTMLElement>(CELL)];
  const gridProps = {
    onFocus: (e: FocusEvent<HTMLElement>) => {
      const i = cellsOf(e.currentTarget).indexOf(e.target as HTMLElement);
      if (i >= 0) setAt(classLabel(Math.floor(i / SIZE), i % SIZE));
    },
    // (default prevented at an edge too, so Study's own arrow keys never walk the line from here)
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      if (e.altKey || e.shiftKey) return;
      const cells = cellsOf(e.currentTarget);
      const to = gridMove(cells.indexOf(e.target as HTMLElement), e.key, e.ctrlKey || e.metaKey);
      if (to === null) return;
      e.preventDefault();
      cells[to]?.focus();
    },
  };
  return { stop: at ?? selected ?? classLabel(0, 0), gridProps };
}
