// Saved reports: a set of Analyze's filters kept under a name in this browser (db.ts `savedReports`), listed on the Saved
// page and opened from there. A saved report keeps the filters and no numbers, so opening one counts the hands and grades
// kept by then. What's stored can be old or hand-edited, and a backup can carry anything, so every read goes through
// `readReport`: a damaged record is counted and left out, and nothing here throws.
import { GAME_EQUILIBRIUM, GAME_WORDS, HAND_FILTERS, LOST_STEPS } from "@/features/analyze/analyze";
import { noteSaved } from "./backupNudge";
import { db, deleteRecord, type SavedReport } from "./db";
import { isOptTags, isTime, isWellFormed } from "./shapes";

export type ReportFilters = SavedReport["filters"];

const MAX_FILTER = 200;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The filters set in a URL's query, and nothing else of it. */
export function filtersOf(params: URLSearchParams): ReportFilters {
  return Object.fromEntries(HAND_FILTERS.flatMap((k) => (params.get(k) ? [[k, params.get(k)!]] : [])));
}

/** Where a report opens: Analyze, with its filters in the URL. */
export function reportLink(f: ReportFilters): string {
  const q = new URLSearchParams(HAND_FILTERS.flatMap((k) => (f[k] ? [[k, f[k]]] : []))).toString();
  return q ? `/analyze?${q}` : "/analyze";
}

function validFilters(x: unknown): x is ReportFilters {
  if (typeof x !== "object" || x === null || Array.isArray(x)) return false;
  return Object.entries(x).every(([k, v]) => {
    if (!(HAND_FILTERS as readonly string[]).includes(k) || !isWellFormed(v) || !v || v.length > MAX_FILTER) return false;
    if (k === "from" || k === "to") return DATE.test(v);
    if (k === "game") return v === GAME_EQUILIBRIUM;
    return k !== "lost" || (LOST_STEPS as readonly string[]).includes(v);
  });
}

/** A report as it's stored, else null. */
export function readReport(x: unknown): SavedReport | null {
  if (typeof x !== "object" || x === null) return null;
  const { id, name, note, tags, filters, createdAt, updatedAt } = x as Record<string, unknown>;
  if (!isWellFormed(id) || !id || !isWellFormed(name) || !name.trim() || !validFilters(filters)) return null;
  if (!(note === undefined || isWellFormed(note)) || !isOptTags(tags) || !isTime(createdAt) || !isTime(updatedAt)) return null;
  return { id, name, filters, note: note ?? "", ...(tags ? { tags: tags as string[] } : {}), createdAt, updatedAt };
}

/** Whether it was stored: false where the browser's database can't be used. */
export async function putReport(r: SavedReport): Promise<boolean> {
  const d = await db();
  if (!d) return false;
  await d.put("savedReports", r);
  await noteSaved();
  return true;
}

/** Every report that can be read, the latest changed first, and how many can't. */
export async function listReports(): Promise<{ list: SavedReport[]; damaged: number }> {
  const d = await db();
  const all: unknown[] = d ? await d.getAll("savedReports") : [];
  const list = all.flatMap((x) => readReport(x) ?? []);
  return { list: list.sort((a, b) => b.updatedAt - a.updatedAt), damaged: all.length - list.length };
}

export async function deleteReport(id: string): Promise<void> {
  await deleteRecord("savedReports", id);
}

/** The filters in words. */
export function reportWords(f: ReportFilters): string {
  const parts = [
    f.site,
    f.bb && `stakes ${f.bb}`,
    f.pos,
    f.pot,
    f.tag && `tag ${f.tag}`,
    f.from && `from ${f.from}`,
    f.to && `to ${f.to}`,
    f.lost && `${f.lost}bb or more EV lost`,
    f.q && `search "${f.q}"`,
    f.sess && "one session",
    f.game && GAME_WORDS,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "All hands";
}
