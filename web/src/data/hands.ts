// Analyze's hands and graded decisions, kept in this browser's IndexedDB (db.ts): added once each (a hand already
// kept is left as it is), listed newest first, and removed an import at a time with their decisions.
import { db, type DecisionRecord, type HandRecord } from "./db";

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
  return { added, existing: hands.length - added };
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
}

/** The imports the kept hands came in with, the latest first. */
export function importsOf(hands: readonly HandRecord[]): ImportSummary[] {
  const m = new Map<string, ImportSummary>();
  for (const h of hands) {
    const s = m.get(h.importId) ?? { id: h.importId, name: h.importName, at: h.importedAt, hands: 0, chars: 0 };
    s.hands++;
    s.chars += h.text.length;
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
