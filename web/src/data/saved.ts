// Saved spots (Study lines), saved ranges (the Ranges editor's) and saved drills (Practice's and Analyze's), kept in
// this browser's IndexedDB (db.ts).
import { noteSaved } from "./backupNudge";
import { db, type SavedDrill, type SavedRange, type SavedSpot } from "./db";

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
  if (!d) return;
  await d.put("savedSpots", s);
  await noteSaved();
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
  if (!d) return;
  await d.put("savedRanges", r);
  await noteSaved();
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

export async function putDrill(s: SavedDrill): Promise<void> {
  const d = await db();
  if (!d) return;
  await d.put("savedDrills", s);
  await noteSaved();
}

/** Every saved drill, the latest changed first. */
export async function listDrills(): Promise<SavedDrill[]> {
  const d = await db();
  return d ? newestFirst(await d.getAll("savedDrills")) : [];
}

export async function deleteDrill(id: string): Promise<void> {
  const d = await db();
  if (d) await d.delete("savedDrills", id);
}

/** The drill saved at this link, if any (a drill is saved once: saving it again updates it). */
export async function drillAt(to: string): Promise<SavedDrill | undefined> {
  return (await listDrills()).find((s) => s.to === to);
}

/** Whether a saved drill's link is one of the drill pages' (a restored backup's is checked before it's opened). */
export const isDrillLink = (kind: SavedDrill["kind"], to: string): boolean =>
  kind === "library" ? /^\/practice\?tab=drills(&|$)/.test(to) : /^\/analyze\?drill=[^&]+/.test(to);

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
