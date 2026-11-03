// Solve times measured in this browser (ROADMAP Phase 6, "Mode … with measured times"): each live answer's time as the
// engine measured it (the response's "seconds": the whole request, the narrowing of earlier streets included; the
// runtime's start and the queue not), kept by backend, mode, street and heads-up or multiway, the last KEEP of each, in
// localStorage (this viewer's only; nothing is lost if it's unavailable). A request already answered since the page
// loaded isn't counted again (the engine's cache answers it sooner), nor are library flops, answers at once, charts or
// rules (no solve), nor Practice opponents' moves. Shown as the median beside each mode, labelled as measured here.
import { useSyncExternalStore } from "react";
import type { AdvisorResponse } from "./protocol";
import type { Provenance, SolveMode, TransportKind } from "./types";

const KEY = "lizard.solveTimes.v1";
export const KEEP = 20;
export const STREETS = ["flop", "turn", "river"] as const;
export type TimedStreet = (typeof STREETS)[number];
type Store = Record<string, number[]>;

let mem: Store | null = null;
const seen = new Set<string>();
const listeners = new Set<() => void>();

function load(): Store {
  if (mem) return mem;
  try {
    const raw = localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    mem = parsed && typeof parsed === "object" ? (parsed as Store) : {};
  } catch {
    mem = {};
  }
  return mem;
}

function save(next: Store) {
  mem = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // (kept for this page's life)
  }
  for (const l of listeners) l();
}

export const timingKey = (transport: TransportKind, mode: SolveMode, street: TimedStreet, multiway: boolean) => `${transport}:${mode}:${street}:${multiway ? "mw" : "hu"}`;

/** Counts a final answer's time where it was a live solve, once per distinct request (`request`: the request as sent). */
export function recordTiming(request: string, transport: TransportKind, mode: SolveMode, data: AdvisorResponse, p: Provenance): void {
  const street = data.street;
  const secs = data.seconds;
  if (p.source !== "live" || p.partial || data.cancelled || data.error) return;
  if (street !== "flop" && street !== "turn" && street !== "river") return;
  if (typeof secs !== "number" || !(secs > 0)) return;
  if (seen.has(request)) return;
  if (seen.size > 2000) seen.clear();
  seen.add(request);
  const k = timingKey(transport, mode, street, Boolean(data.multiway));
  const s = load();
  save({ ...s, [k]: [...(s[k] ?? []), secs].slice(-KEEP) });
}

const median = (xs: number[]) => {
  const ys = [...xs].sort((a, b) => a - b);
  const m = ys.length >> 1;
  return ys.length % 2 ? ys[m]! : (ys[m - 1]! + ys[m]!) / 2;
};

export interface Timing {
  median: number;
  n: number;
}

/** The median of the times kept for a backend, mode, street and table; null where none is. */
export function timingOf(store: Store, transport: TransportKind, mode: SolveMode, street: TimedStreet, multiway: boolean): Timing | null {
  const xs = (store[timingKey(transport, mode, street, multiway)] ?? []).filter((x) => typeof x === "number" && Number.isFinite(x));
  return xs.length ? { median: median(xs), n: xs.length } : null;
}

export const secondsText = (s: number) => (s < 10 ? `${s.toFixed(1)} s` : s < 90 ? `${Math.round(s)} s` : `${(s / 60).toFixed(1)} min`);

/** "flop 7.9 s, river 2.1 s": a mode's medians heads-up (and multiway), or null where nothing is measured. */
export function modeTimesText(store: Store, transport: TransportKind, mode: SolveMode): string | null {
  const parts: string[] = [];
  for (const mw of [false, true])
    for (const st of STREETS) {
      const t = timingOf(store, transport, mode, st, mw);
      if (t) parts.push(`${mw ? "multiway " : ""}${st} ${secondsText(t.median)} (${t.n})`);
    }
  return parts.length ? parts.join(", ") : null;
}

export function clearTimings(): void {
  seen.clear();
  save({});
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** The times kept, re-rendering as new ones come in. */
export const useTimings = (): Store => useSyncExternalStore(subscribe, load, load);

/** (tests) forget what's in memory and the requests seen */
export function resetTimingsForTest(): void {
  mem = null;
  seen.clear();
}
