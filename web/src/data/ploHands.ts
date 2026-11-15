// PLO hands imported into Analyze, kept apart from Hold'em's (none of Hold'em's stats, grades or sessions read them), in
// the settings store (`kv`) under one key: no new database store, so no migration. A street graded on a solve in Study
// keeps its grade here, with what graded it. Not in a backup, like the rest of `kv`; the page says so.
import { kvGet, kvSet } from "./db";
import type { Verdict } from "@/grading/grade";

const KEY = "ploHands";
/** at most this many kept, the newest */
export const MAX_PLO_HANDS = 5000;

/** Your decisions on one street, graded on a solve you ran in Study. */
export interface PloStreetGrade {
  /** each of your decisions graded, in order */
  verdicts: Verdict[];
  /** EV given up over them, bb */
  loss: number;
  /** what graded it: the solve's exploitability, % of the pot, and its band */
  exploitabilityPct: number;
  band?: string;
  /** the ranges it was solved from, as typed */
  ranges: [string, string];
  at: number;
}

export interface PloHandRecord {
  /** site, hand number and cards: a hand imported twice is kept once */
  id: string;
  site: string;
  number: string;
  played: string;
  playedAt: number;
  hero: string;
  players: number;
  hole: string;
  board: string;
  text: string;
  importName: string;
  importedAt: number;
  /** by street, once graded */
  grades?: Partial<Record<"flop" | "turn" | "river", PloStreetGrade>>;
}

export async function listPloHands(): Promise<PloHandRecord[]> {
  return (await kvGet<PloHandRecord[]>(KEY)) ?? [];
}

/** Adds hands, one kept per id (an earlier one's grades stay): how many were new. */
export async function addPloHands(list: readonly PloHandRecord[]): Promise<{ added: number; existing: number }> {
  const kept = await listPloHands();
  const ids = new Set(kept.map((h) => h.id));
  const fresh = list.filter((h) => !ids.has(h.id) && ids.add(h.id));
  const all = [...kept, ...fresh].sort((a, b) => b.playedAt - a.playedAt || b.importedAt - a.importedAt).slice(0, MAX_PLO_HANDS);
  await kvSet(KEY, all);
  return { added: fresh.length, existing: list.length - fresh.length };
}

/** A street's grade kept with its hand (stamped now): whether the hand is kept here. */
export async function putPloGrade(id: string, street: "flop" | "turn" | "river", grade: Omit<PloStreetGrade, "at">, at = Date.now()): Promise<boolean> {
  const kept = await listPloHands();
  const h = kept.find((x) => x.id === id);
  if (!h) return false;
  h.grades = { ...h.grades, [street]: { ...grade, at } };
  await kvSet(KEY, kept);
  return true;
}

export async function deletePloHands(): Promise<void> {
  await kvSet(KEY, []);
}
