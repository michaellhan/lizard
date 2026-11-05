// Saved spots (Study lines), saved ranges (the Ranges editor's) and saved drills (Practice's and Analyze's), kept in
// this browser's IndexedDB (db.ts).
import { noteSaved } from "./backupNudge";
import { db, type SavedAnswer, type SavedDrill, type SavedRange, type SavedSpot } from "./db";

export const NOT_SAVED = "Not saved: this browser isn't keeping Lizard's data right now.";

/** A save that can't be believed until it says so: false where it stored nothing or threw (the error is logged). */
export async function stored(put: () => Promise<boolean>): Promise<boolean> {
  try {
    return await put();
  } catch (e) {
    console.error("A save failed:", e);
    return false;
  }
}

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

/** Whether it was stored: false where the browser's database can't be used (db.ts), which says why on the page. With an
 * answer, the two go in together, and it takes the place of any kept before. */
export async function putSpot(s: SavedSpot, answer?: SavedAnswer): Promise<boolean> {
  const d = await db();
  if (!d) return false;
  if (answer) {
    const tx = d.transaction(["savedSpots", "savedAnswers"], "readwrite");
    await Promise.all([tx.objectStore("savedAnswers").put(answer), tx.objectStore("savedSpots").put(s), tx.done]);
  } else await d.put("savedSpots", s);
  await noteSaved();
  return true;
}

/** Every saved spot, the latest changed first. */
export async function listSpots(): Promise<SavedSpot[]> {
  const d = await db();
  return d ? newestFirst(await d.getAll("savedSpots")) : [];
}

/** The spot and the answer kept with it. */
export async function deleteSpot(id: string): Promise<void> {
  const d = await db();
  if (!d) return;
  const tx = d.transaction(["savedSpots", "savedAnswers"], "readwrite");
  await Promise.all([tx.objectStore("savedSpots").delete(id), tx.objectStore("savedAnswers").delete(id), tx.done]);
}

/** The spot saved at this Study line, if any (a line is saved once: saving it again updates it). */
export async function spotAt(line: string): Promise<SavedSpot | undefined> {
  return (await listSpots()).find((s) => s.line === line);
}

/** Whether it was stored, as putSpot. The Ranges editor saves a range over one of its name knowing nothing of tags, so a
 * record that doesn't say keeps the tags it had. */
export async function putRange(r: SavedRange): Promise<boolean> {
  const d = await db();
  if (!d) return false;
  const had = r.tags === undefined ? (await d.get("savedRanges", r.id))?.tags : undefined;
  await d.put("savedRanges", had ? { ...r, tags: had } : r);
  await noteSaved();
  return true;
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

/** Whether it was stored, as putSpot. */
export async function putDrill(s: SavedDrill): Promise<boolean> {
  const d = await db();
  if (!d) return false;
  await d.put("savedDrills", s);
  await noteSaved();
  return true;
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

/** The orders a Saved list can be read in. */
export const SAVED_SORTS = [
  { id: "changed", label: "Latest changed" },
  { id: "newest", label: "Newest saved" },
  { id: "oldest", label: "Oldest saved" },
  { id: "name", label: "Name, A to Z" },
] as const;
export type SavedSort = (typeof SAVED_SORTS)[number]["id"];
export const isSavedSort = (x: unknown): x is SavedSort => SAVED_SORTS.some((s) => s.id === x);

/** A list in that order, a new array; ties in the order given. `nameOf`: what a kind is called. */
export function sortSaved<T extends { createdAt: number; updatedAt: number }>(xs: readonly T[], by: SavedSort, nameOf: (x: T) => string): T[] {
  const order: Record<SavedSort, (a: T, b: T) => number> = {
    changed: (a, b) => b.updatedAt - a.updatedAt,
    newest: (a, b) => b.createdAt - a.createdAt,
    oldest: (a, b) => a.createdAt - b.createdAt,
    name: (a, b) => nameOf(a).localeCompare(nameOf(b), undefined, { sensitivity: "base", numeric: true }),
  };
  return [...xs].sort(order[by]);
}

/** Tags typed as one line: split on commas, trimmed, empty and repeated ones dropped. */
export function readTags(text: string): string[] {
  return [...new Set(text.split(",").map((t) => t.trim()).filter(Boolean))];
}

/** Whether a spot matches a search: every word in its title, tags, note or line (as shown), ignoring case. */
export const spotMatches = (s: SavedSpot, query: string, lineText = ""): boolean => textMatches([s.title, s.tags.join(" "), s.note, lineText], query);

/** Whether a search matches these texts: every word in one of them, ignoring case. */
export function textMatches(texts: readonly string[], query: string): boolean {
  const hay = texts.join(" ").toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
}
