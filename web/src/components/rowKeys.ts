// The keyboard of a row of choices that are one tab stop, as role=radiogroup and role=tablist promise: the arrows move
// through the row and round it, and pick what they land on (Home and End too). Put `rowKeys` on the row's element, and
// tabIndex 0 on the choice picked and -1 on the rest.
import type { KeyboardEvent } from "react";

/** Where a key takes choice i of n: null for a key of no use here. A tablist runs across, so it leaves Up and Down alone. */
export function rowMove(i: number, n: number, key: string, across = false): number | null {
  if (i < 0 || n < 1) return null;
  if (key === "ArrowRight" || (!across && key === "ArrowDown")) return (i + 1) % n;
  if (key === "ArrowLeft" || (!across && key === "ArrowUp")) return (i - 1 + n) % n;
  if (key === "Home") return 0;
  if (key === "End") return n - 1;
  return null;
}

/** (default prevented, so Study's own arrow keys never walk the line from here) */
export function rowKeys(role: "radio" | "tab", pick: (i: number) => void) {
  return (e: KeyboardEvent<HTMLElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const choices = [...e.currentTarget.querySelectorAll<HTMLElement>(`[role="${role}"]`)];
    const to = rowMove(choices.indexOf(e.target as HTMLElement), choices.length, e.key, role === "tab");
    if (to === null) return;
    e.preventDefault();
    choices[to]?.focus();
    pick(to);
  };
}
