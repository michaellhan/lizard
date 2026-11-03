// Study's "Pin as A" (ROADMAP Phase 8: a picker for any two nodes): one spot kept for the visit, as its Study query, so
// any other spot can be compared with it. Kept in sessionStorage where that works (a reload keeps it, a new tab or
// visit doesn't); a convenience, never needed: the Compare page's picker takes any two spots too.
import { create } from "zustand";

const KEY = "lizard.compare.pin";

function read(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export const usePin = create<{ pin: string | null; setPin: (search: string | null) => void }>((set) => ({
  pin: read(),
  setPin: (search) => {
    try {
      if (search) sessionStorage.setItem(KEY, search);
      else sessionStorage.removeItem(KEY);
    } catch {
      // (kept in memory only)
    }
    set({ pin: search });
  },
}));

/** A Study query from what was typed or pasted: a Study link (any origin), "?p=…" or "p=…"; null where it isn't one. */
export function studyQueryOf(text: string): string | null {
  const t = text.trim();
  if (!t) return null;
  const i = t.indexOf("?");
  const q = (i >= 0 ? t.slice(i + 1) : t).split("#")[0]!;
  return new URLSearchParams(q).has("p") ? q : null;
}
