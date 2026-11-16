// A control's last pick, kept in this browser so leaving the page and coming back finds it as it was: Analyze's grading
// scope and session kind, the custom report's flop count, the runout table's sort, Study's hand filter, Saved's search.
// (Each reader checks what it reads: a pick that's no longer offered falls back to the control's default.)
import { useCallback, useState } from "react";

export const KEPT_PREFIX = "lizard.kept.v1.";

export function readKept(name: string): string | null {
  try {
    return localStorage.getItem(KEPT_PREFIX + name);
  } catch {
    return null;
  }
}

export function writeKept(name: string, value: string | null): void {
  try {
    if (value == null) localStorage.removeItem(KEPT_PREFIX + name);
    else localStorage.setItem(KEPT_PREFIX + name, value);
  } catch {
    // (private windows and blocked storage: the pick lasts as long as the page)
  }
}

/** A string pick kept under `name`: `ok` says whether a kept value is still one the control offers. */
export function useKept<T extends string>(name: string, ok: (s: string) => s is T): [T | null, (v: T | null) => void];
export function useKept(name: string): [string | null, (v: string | null) => void];
export function useKept(name: string, ok: (s: string) => boolean = () => true): [string | null, (v: string | null) => void] {
  const [value, setValue] = useState<string | null>(() => {
    const s = readKept(name);
    return s != null && ok(s) ? s : null;
  });
  const set = useCallback(
    (v: string | null) => {
      setValue(v);
      writeKept(name, v);
    },
    [name],
  );
  return [value, set];
}
