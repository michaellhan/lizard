// Analyze's hands and graded decisions, kept in this browser's IndexedDB (db.ts): added once each (a hand already
// kept is left as it is), listed newest first, and removed an import at a time with their decisions.
import { noteSaved } from "./backupNudge";
import { db, type DecisionRecord, type HandRecord } from "./db";

/** The site a hand played in Practice is kept under (features/practice/history.ts). */
export const PRACTICE_SITE = "Lizard Practice";
/** The site a hand from the classic app's My hands is kept under (features/analyze/classic.ts). */
export const CLASSIC_SITE = "Classic app";

/** Keep the hands not kept yet: how many were new, and how many were already here (from an earlier import); null
 * where this browser keeps nothing. */
export async function addHands(hands: readonly HandRecord[]): Promise<{ added: number; existing: number } | null> {
  const d = await db();
  if (!d) return null;
  const tx = d.transaction("hands", "readwrite");
  let added = 0;
  for (const h of hands) {
    if (await tx.store.getKey(h.id)) continue;
    await tx.store.add(h);
    added++;
  }
  await tx.done;
  await noteSaved(added);
  return { added, existing: hands.length - added };
}

/** Your tags and note on a kept hand (empty ones removed): the hand as now kept, or undefined where it isn't. */
export async function putHandNotes(id: string, tags: readonly string[], note: string, now = Date.now()): Promise<HandRecord | undefined> {
  const d = await db();
  if (!d) return undefined;
  const tx = d.transaction("hands", "readwrite");
  const h = await tx.store.get(id);
  if (!h) return undefined;
  const out: HandRecord = { ...h, updatedAt: now };
  delete out.tags;
  delete out.note;
  if (tags.length) out.tags = [...tags];
  if (note.trim()) out.note = note.trim();
  await tx.store.put(out);
  await tx.done;
  await noteSaved();
  return out;
}

/** Every kept hand, the latest played first (then the latest imported). */
export async function listHands(): Promise<HandRecord[]> {
  const d = await db();
  const all = d ? await d.getAll("hands") : [];
  return all.sort((a, b) => b.playedAt - a.playedAt || b.importedAt - a.importedAt || a.id.localeCompare(b.id));
}

export async function getHand(id: string): Promise<HandRecord | undefined> {
  const d = await db();
  return d ? d.get("hands", id) : undefined;
}

export interface ImportSummary {
  id: string;
  name: string;
  at: number;
  hands: number;
  /** the histories' text, characters */
  chars: number;
  /** hands with your tags or a note */
  annotated: number;
}

/** The imports the kept hands came in with, the latest first. */
export function importsOf(hands: readonly HandRecord[]): ImportSummary[] {
  const m = new Map<string, ImportSummary>();
  for (const h of hands) {
    const s = m.get(h.importId) ?? { id: h.importId, name: h.importName, at: h.importedAt, hands: 0, chars: 0, annotated: 0 };
    s.hands++;
    s.chars += h.text.length;
    if (h.tags?.length || h.note) s.annotated++;
    m.set(h.importId, s);
  }
  return [...m.values()].sort((a, b) => b.at - a.at);
}

/** Remove an import's hands and their graded decisions: how many hands went. */
export async function deleteImport(importId: string): Promise<number> {
  const d = await db();
  if (!d) return 0;
  const tx = d.transaction(["hands", "decisions"], "readwrite");
  const ids = await tx.objectStore("hands").index("byImport").getAllKeys(importId);
  for (const id of ids) {
    await tx.objectStore("hands").delete(id);
    for (const k of await tx.objectStore("decisions").index("byHand").getAllKeys(id)) await tx.objectStore("decisions").delete(k);
  }
  await tx.done;
  return ids.length;
}

export async function putDecisions(ds: readonly DecisionRecord[]): Promise<void> {
  const d = await db();
  if (!d) return;
  const tx = d.transaction("decisions", "readwrite");
  for (const x of ds) await tx.store.put(x);
  await tx.done;
}

export async function decisionsOf(handId: string): Promise<DecisionRecord[]> {
  const d = await db();
  return d ? d.getAllFromIndex("decisions", "byHand", handId) : [];
}

/** Every decision graded in this browser. */
export async function listDecisions(): Promise<DecisionRecord[]> {
  const d = await db();
  return d ? d.getAll("decisions") : [];
}

/** Forget every grade (the hands stay): they are graded again from the start. */
export async function clearDecisions(): Promise<void> {
  const d = await db();
  if (d) await d.clear("decisions");
}
