// "Import from the classic app": the hands the classic app's My hands keeps in this browser (solver/gto/static/store.js,
// hands.js), read on request and never written. Lizard (/lizard/) and the classic app (/gto-solver/) share the origin,
// so the classic IndexedDB "gto-store" is readable here (or, where the classic app had no IndexedDB, localStorage
// "gto-store:hands"): opened at the version it has and read in a readonly transaction; an open that would create it
// (no classic data in this browser) is aborted, as the classic store's own readOldDb does.
// Each hand comes in as Analyze keeps an imported one. A hand history the classic app imported (its `hh`) goes
// through Lizard's importer as it was, so it is the same record as that history imported here. A hand entered or
// played on the classic table is written as a history first (Practice's writer, practice/history.ts) under the site
// "Classic app", numbered from its record id (a second import adds only what's new). Your tags and notes come along;
// the classic grades don't (Analyze grades the hands again). Not imported, counted with why: no hole cards, no
// decision of yours, an ante or a straddle, a tournament's prizes or bounties, a street's moves without its cards, and
// a hand that doesn't replay on Lizard's table.
// Of the classic settings, only its speed (kv "gto-speed") has a Lizard counterpart, Settings' solve mode: read the
// same way, on request (readClassicSpeed).
import type { HandRecord } from "@/data/db";
import { CLASSIC_SITE } from "@/data/hands";
import { handHistory } from "@/features/practice/history";
import type { PracticeHand } from "@/features/practice/practice";
import { splitHands } from "@/hh/parse";
import { importHand } from "@/hh/replay";
import { seatsOf } from "@/poker/seats";
import { noLines, NEED, STREETS, type Move, type TableSetup } from "@/poker/table";
import { recordOf } from "./analyze";

export const CLASSIC_DB = "gto-store";
export { CLASSIC_SITE };
/** the import every classic hand is kept under (Analyze's Imports list shows it once) */
export const CLASSIC_IMPORT = { id: "classic-app", name: "Classic app, My hands" } as const;

/** A My hands record as the classic store keeps it: { id, v, created, updated, dev, data } (or a tombstone). */
export interface ClassicRecord {
  id: string;
  created?: number;
  updated?: number;
  deleted?: boolean;
  data?: unknown;
}

const obj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

/** An existing database opened as it is, or null where there's none (the open that would create it is aborted). */
function openExisting(f: IDBFactory, name: string): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    let q: IDBOpenDBRequest;
    try {
      q = f.open(name);
    } catch {
      resolve(null);
      return;
    }
    let created = false;
    q.onupgradeneeded = () => {
      created = true;
      try {
        q.transaction?.abort();
      } catch {
        // (already aborting)
      }
    };
    q.onerror = (e) => {
      e.preventDefault();
      resolve(null);
    };
    q.onsuccess = () => {
      if (created) {
        q.result.close();
        resolve(null);
      } else resolve(q.result);
    };
  });
}

function readAll(d: IDBDatabase, store: string): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, "readonly");
    const q = t.objectStore(store).getAll();
    t.oncomplete = () => resolve((q.result as unknown[]) ?? []);
    t.onerror = t.onabort = () => reject(t.error ?? new Error("the classic database couldn't be read"));
  });
}

const safe = <T>(f: () => T): T | null => {
  try {
    return f();
  } catch {
    return null;
  }
};

/** The classic app's hands in this browser (tombstones left out), and where they were; null where it keeps none. */
export async function readClassicHands(
  factory: IDBFactory | null = safe(() => globalThis.indexedDB ?? null),
  storage: Pick<Storage, "getItem"> | null = safe(() => globalThis.localStorage ?? null),
  name: string = CLASSIC_DB,
): Promise<{ from: "IndexedDB" | "localStorage"; recs: ClassicRecord[] } | null> {
  const live = (xs: unknown[]) => xs.filter((r): r is ClassicRecord => obj(r) && typeof r.id === "string" && !r.deleted && obj(r.data));
  const d = factory ? await openExisting(factory, name) : null;
  if (d) {
    try {
      if (d.objectStoreNames.contains("hands")) return { from: "IndexedDB", recs: live(await readAll(d, "hands")) };
    } finally {
      d.close();
    }
  }
  const raw = safe(() => storage?.getItem(`${name}:hands`) ?? null);
  const m = raw ? safe(() => JSON.parse(raw) as unknown) : null;
  return obj(m) ? { from: "localStorage", recs: live(Object.values(m)) } : null;
}

const CARD = /^[AKQJT98765432][shdc]$/;
const ACTIONS: readonly Move["action"][] = ["fold", "check", "call", "bet", "raise", "all-in"];

/** A short decimal hash (FNV-1a), for a hand number made from a record id. */
function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return String(h);
}

/** A classic table hand (hands.js `state`) as Practice's hand, ready to write; or why it can't be. */
export function classicHand(st: unknown): { hand: PracticeHand; setup: TableSetup } | { skip: string } {
  if (!obj(st)) return { skip: "not a hand" };
  const players = Number(st.players);
  const seats = Number.isInteger(players) && players >= 2 && players <= 9 ? seatsOf(players) : null;
  if (!seats) return { skip: "not a hand" };
  if (Number(st.ante) > 0 || st.straddle) return { skip: "an ante or a straddle (not imported yet)" };
  if (st.payouts || st.bounty) return { skip: "a tournament's prizes or bounties (not imported yet)" };
  const hero = typeof st.hero === "string" && seats.includes(st.hero) ? st.hero : null;
  const cards = Array.isArray(st.cards) ? st.cards : [];
  const ok = (c: unknown): c is string => typeof c === "string" && CARD.test(c);
  const hole = [cards[0], cards[1]];
  if (!hero || !ok(hole[0]) || !ok(hole[1])) return { skip: "no hole cards" };
  // the board as far as it was dealt in order (a flop of three, then the turn, then the river)
  const board: string[] = [];
  for (const [from, n] of [[2, 3], [5, 1], [6, 1]] as const) {
    const part = cards.slice(from, from + n);
    if (part.length < n || !part.every(ok)) break;
    board.push(...part);
  }
  if (new Set([...hole, ...board]).size !== board.length + 2) return { skip: "a card twice" };
  const stack = Number(st.stack) > 0 ? Number(st.stack) : 100;
  const own = obj(st.stacks) ? st.stacks : {};
  const stacks = Object.fromEntries(seats.map((p) => [p, Number(own[p]) > 0 ? Number(own[p]) : stack]));
  const acts = obj(st.actions) ? st.actions : {};
  const lines = noLines();
  for (const s of STREETS) {
    const xs = Array.isArray(acts[s]) ? acts[s] : [];
    for (const a of xs) {
      if (!obj(a) || typeof a.pos !== "string" || !seats.includes(a.pos) || !ACTIONS.includes(a.action as Move["action"])) return { skip: "a move it can't read" };
      const action = a.action as Move["action"];
      const to = Number(a.to);
      if ((action === "bet" || action === "raise") && !(to > 0)) return { skip: "a move it can't read" };
      lines[s].push({ pos: a.pos, action, ...(action === "bet" || action === "raise" ? { to } : {}) });
    }
    if (xs.length && board.length < NEED[s]) return { skip: "a street's moves without its cards" };
  }
  if (!STREETS.some((s) => lines[s].some((m) => m.pos === hero))) return { skip: "no decision of yours" };
  const hand: PracticeHand = {
    seed: 0,
    n: 0,
    players,
    stack: stacks[hero]!,
    hero,
    hands: { [hero]: [hole[0], hole[1]] },
    board,
    shown: board.length,
    lines,
    decisions: [],
    result: null,
  };
  return { hand, setup: { players, stacks } };
}

export interface ClassicImport {
  hands: HandRecord[];
  /** why each hand left out was, and how many */
  skipped: Record<string, number>;
}

/** The classic records as Analyze's hands (each once), with your tags and notes. `at`: when they're imported. */
export function classicRecords(recs: readonly ClassicRecord[], at: number): ClassicImport {
  const imp = { ...CLASSIC_IMPORT, at };
  const hands = new Map<string, HandRecord>();
  const skipped: Record<string, number> = {};
  const skip = (why: string) => (skipped[why] = (skipped[why] ?? 0) + 1);
  for (const rec of recs) {
    const d = obj(rec.data) ? rec.data : {};
    let r: HandRecord;
    try {
      if (typeof d.hh === "string" && d.hh.trim()) {
        // a history the classic app imported: read here as it was
        const text = splitHands(d.hh)[0] ?? d.hh;
        r = recordOf(text, importHand(text), imp);
        if (!r.decisions) {
          skip("no decision of yours");
          continue;
        }
      } else {
        const c = classicHand(d.state);
        if ("skip" in c) {
          skip(c.skip);
          continue;
        }
        const text = handHistory(c.hand, { site: CLASSIC_SITE, number: `C${fnv(rec.id)}`, at: new Date(Number(rec.created) || at) }, c.setup);
        const rp = importHand(text);
        if (rp.warnings.length || rp.stopped) {
          skip("doesn't replay on Lizard's table");
          continue;
        }
        const x = recordOf(text, rp, imp);
        r = { ...x, id: `${CLASSIC_SITE}|${x.number}|${x.hole}`, site: CLASSIC_SITE, bb: "1bb" };
      }
    } catch {
      skip("doesn't replay on Lizard's table");
      continue;
    }
    const tags = Array.isArray(d.tags) ? [...new Set(d.tags.filter((t): t is string => typeof t === "string" && !!t.trim()).map((t) => t.trim()))] : [];
    const note = typeof d.note === "string" ? d.note.trim() : "";
    if (hands.has(r.id)) {
      skip("the same hand twice");
      continue;
    }
    hands.set(r.id, { ...r, ...(tags.length ? { tags } : {}), ...(note ? { note } : {}) });
  }
  return { hands: [...hands.values()], skipped };
}
