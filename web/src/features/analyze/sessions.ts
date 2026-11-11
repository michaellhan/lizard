// Your sessions, read from the hands kept: a sitting is the hands of one kind at one site (cash games, one tournament,
// the tables here) with no break over 30 minutes (8 hours in a tournament, whose name can come round again the next
// night). Nothing here is stored, so deleting an import removes its sessions and a re-import adds none. `playedAt` is
// the site's own clock read as UTC: dates are written with toISOString, never in the browser's zone. (This file sits
// under analyze.ts: it can import neither that nor report.ts, nor classic.ts.)
import type { HandRecord, SessionRecord } from "@/data/db";
import { CLASSIC_SITE, PRACTICE_SITE } from "@/data/hands";

export type HandKind = "cash" | "tour" | "practice";

/** Cash, a tournament, or a table here (Practice's, the classic app's). A tournament with neither name nor number is
 * still a tournament: `tournament` is "" there. */
export const handKind = (h: Pick<HandRecord, "site" | "tournament">): HandKind =>
  h.site === PRACTICE_SITE || h.site === CLASSIC_SITE ? "practice" : h.tournament !== undefined ? "tour" : "cash";

/** The import a Practice session's kept hands come in under (practice/history.ts practiceRecord). */
export const sessionImport = (id: string) => `practice:${id}`;

/** The imports of the exploit sessions: a kept hand says nothing of its session's read, its import does. */
export const exploitImports = (sessions: readonly Pick<SessionRecord, "id" | "kind">[]): Set<string> => new Set(sessions.filter((s) => s.kind === "exploit").map((s) => sessionImport(s.id)));

/** Neither a tournament's (Practice's or a site's: its chips aren't bb, and it's graded with no ICM) nor from an exploit
 * session (played against an assumed profile): the hands an equilibrium's leak can be read from. */
export const isEquilibriumHand = (h: Pick<HandRecord, "tournament" | "importId">, exploits: ReadonlySet<string>) => h.tournament === undefined && !exploits.has(h.importId);

/** The words for hands an exploit session kept, which stay listed but count nowhere. */
export const exploitsApartNote = (n: number) =>
  `${n.toLocaleString()} ${n === 1 ? "hand" : "hands"} from exploit sessions ${n === 1 ? "is" : "are"} left out of your results, stats and report.`;

/** in the order played: the history's clock, then the site's hand number */
export const byPlayed = (a: HandRecord, b: HandRecord) =>
  a.playedAt - b.playedAt || a.number.length - b.number.length || (a.number < b.number ? -1 : a.number > b.number ? 1 : 0);

/** The longest break inside a sitting, in ms. */
export const BREAK = { sitting: 30 * 60_000, tournament: 8 * 3_600_000 } as const;

export interface Sitting {
  /** its `sess` filter (sessKey) */
  key: string;
  kind: HandKind;
  site: string;
  /** a tournament's name or number ("" with neither); none for the rest */
  tournament?: string;
  /** when its first and last hands were played (0: the hands say no date) */
  first: number;
  last: number;
  /** in the order played */
  hands: HandRecord[];
}

type SessRef = Omit<Sitting, "key" | "hands">;
export const sessKey = (s: SessRef) => `${s.first}~${s.last}~${s.kind}~${s.site}~${s.tournament ?? ""}`;

/** The sittings in these hands, in the order played, those with no date last (a kind and site's undated hands make
 * one). A sitting doesn't depend on the filters: give it every hand kept. */
export function sessionsOf(hands: readonly HandRecord[]): Sitting[] {
  const groups = new Map<string, HandRecord[]>();
  for (const h of hands) {
    const kind = handKind(h);
    const k = `${kind}~${h.site}~${kind === "tour" ? h.tournament : ""}`;
    const g = groups.get(k);
    if (g) g.push(h);
    else groups.set(k, [h]);
  }
  const out: Sitting[] = [];
  for (const g of groups.values()) {
    const { site, tournament } = g[0]!;
    const kind = handKind(g[0]!);
    const gap = kind === "tour" ? BREAK.tournament : BREAK.sitting;
    const sorted = [...g].sort(byPlayed);
    let from = 0;
    for (let i = 1; i <= sorted.length; i++) {
      if (i < sorted.length && sorted[i]!.playedAt - sorted[i - 1]!.playedAt <= gap) continue;
      const part = sorted.slice(from, i);
      const s: SessRef = { kind, site, ...(kind === "tour" ? { tournament: tournament ?? "" } : {}), first: part[0]!.playedAt, last: part.at(-1)!.playedAt };
      out.push({ ...s, key: sessKey(s), hands: part });
      from = i;
    }
  }
  return out.sort((a, b) => (a.first ? 0 : 1) - (b.first ? 0 : 1) || a.first - b.first || a.last - b.last || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/** The furthest a date can go. */
const MAX_DATE = 8.64e15;

/** A `sess` value read back; null where it isn't one sessKey could have written. (The tournament is last, as it can
 * hold anything.) */
export function parseSess(v: string | null): SessRef | null {
  const m = v ? /^(\d+)~(\d+)~(cash|tour|practice)~([^~]+)~([\s\S]*)$/.exec(v) : null;
  if (!m) return null;
  const [first, last] = [Number(m[1]), Number(m[2])];
  const kind = m[3] as HandKind;
  if (first > last || last > MAX_DATE || (!first && last) || (kind !== "tour" && m[5])) return null;
  return { kind, site: m[4]!, ...(kind === "tour" ? { tournament: m[5]! } : {}), first, last };
}

/** The hands a `sess` value keeps: by its kind, site, tournament and range alone, so a link says the same when other
 * hands come and go. One that can't be read keeps none (a broken link never shows every hand). */
export function inSess(v: string): (h: HandRecord) => boolean {
  const s = parseSess(v);
  if (!s) return () => false;
  return (h) => h.playedAt >= s.first && h.playedAt <= s.last && h.site === s.site && handKind(h) === s.kind && (s.kind !== "tour" || (h.tournament ?? "") === s.tournament);
}

/** A time as the hands' own clock says it: "2026-03-04 21:30". */
export const clockOf = (t: number) => new Date(t).toISOString().slice(0, 16).replace("T", " ");

/** A `sess` value in words: "PokerStars cash, 2026-03-04 21:30 to 23:05". */
export function sessWords(v: string): string {
  const s = parseSess(v);
  if (!s) return "that can't be read";
  const what = s.kind === "tour" ? `${s.site} tournament${s.tournament ? ` ${s.tournament}` : ""}` : s.kind === "cash" ? `${s.site} cash` : s.site;
  if (!s.first) return `${what}, undated`;
  const [a, b] = [clockOf(s.first), clockOf(s.last)];
  return `${what}, ${a === b ? a : `${a} to ${a.slice(0, 10) === b.slice(0, 10) ? b.slice(11) : b}`}`;
}
