// Saved spots (Study lines) and saved ranges (the Ranges editor's), kept in this browser's IndexedDB (db.ts).
import { db, type SavedRange, type SavedSpot } from "./db";

/** A new record id (a random UUID where the browser has one). */
export function newId(): string {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  } catch {
    // (an insecure context: fall through)
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const newestFirst = <T extends { updatedAt: number }>(xs: T[]) => xs.sort((a, b) => b.updatedAt - a.updatedAt);

export async function putSpot(s: SavedSpot): Promise<void> {
  const d = await db();
  if (d) await d.put("savedSpots", s);
}

/** Every saved spot, the latest changed first. */
export async function listSpots(): Promise<SavedSpot[]> {
  const d = await db();
  return d ? newestFirst(await d.getAll("savedSpots")) : [];
}

export async function deleteSpot(id: string): Promise<void> {
  const d = await db();
  if (d) await d.delete("savedSpots", id);
}

/** The spot saved at this Study line, if any (a line is saved once: saving it again updates it). */
export async function spotAt(line: string): Promise<SavedSpot | undefined> {
  return (await listSpots()).find((s) => s.line === line);
}

export async function putRange(r: SavedRange): Promise<void> {
  const d = await db();
  if (d) await d.put("savedRanges", r);
}

export async function listRanges(): Promise<SavedRange[]> {
  const d = await db();
  return d ? newestFirst(await d.getAll("savedRanges")) : [];
}

export async function getRange(id: string): Promise<SavedRange | undefined> {
  const d = await db();
  return d ? d.get("savedRanges", id) : undefined;
}

export async function deleteRange(id: string): Promise<void> {
  const d = await db();
  if (d) await d.delete("savedRanges", id);
}

/** Tags typed as one line: split on commas, trimmed, empty and repeated ones dropped. */
export function readTags(text: string): string[] {
  return [...new Set(text.split(",").map((t) => t.trim()).filter(Boolean))];
}

/** Whether a spot matches a search: every word in its title, tags, note or line (as shown), ignoring case. */
export function spotMatches(s: SavedSpot, query: string, lineText = ""): boolean {
  const hay = [s.title, s.tags.join(" "), s.note, lineText].join(" ").toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
}
