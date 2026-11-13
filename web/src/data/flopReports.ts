// Custom flop reports kept in this browser (db.ts `flopReports`): a spot of your own solved over a representative set of
// flops (features/reports/customReport.ts), written after every flop so a report can be paused, left and taken up again.
// Listed on the Saved page and carried by a backup. What's stored can be old or hand-edited, and a backup can carry
// anything, so every read goes through `readFlopReport`: a damaged record is counted and left out, and nothing throws.
import { noteSaved } from "./backupNudge";
import { db, deleteRecord, type FlopReportFlop, type FlopReportRecord } from "./db";
import { isOptTags, isTime, isWellFormed } from "./shapes";

/** the most flops a report holds: the largest set offered (flopSets.ts), and so the most it keeps (about 1 KB a flop) */
export const MAX_REPORT_FLOPS = 184;
/** the most actions at a node and nodes a flop: well past what a report reads (four nodes, a few sizes each) */
const MAX_ACTIONS = 16;
const MAX_NODES = 8;
const MAX_TEXT = 2000;

const FLOP_RE = /^(?:[2-9TJQKA][cdhs]){3}$/;
const MODES = ["quick", "fast", "accurate"];
const SOURCES = ["library", "library-turn", "instant", "live"];
const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const isText = (x: unknown, max = MAX_TEXT): x is string => isWellFormed(x) && x.length <= max;
const isPair = (x: unknown): x is [number, number] => Array.isArray(x) && x.length === 2 && x.every(isNum);
const isFreq = (x: unknown) => isNum(x) && x >= 0 && x <= 1.0001;

function validFlop(x: unknown): x is FlopReportFlop {
  if (!isObj(x)) return false;
  const { f, w, nodes, ev, eq, bets, source, approximate, exploitabilityPct, iterations, seconds } = x;
  if (!isText(f) || !FLOP_RE.test(f) || !isNum(w) || w <= 0 || !isObj(nodes) || !isObj(bets)) return false;
  const ns = Object.entries(nodes);
  if (!ns.length || ns.length > MAX_NODES || !("" in nodes)) return false;
  for (const [k, nd] of ns) {
    if (!isText(k, 100) || !isObj(nd) || !Array.isArray(nd.names) || !Array.isArray(nd.freqs)) return false;
    if (nd.names.length > MAX_ACTIONS || nd.names.length !== nd.freqs.length || !nd.names.every((n) => isText(n, 60)) || !nd.freqs.every(isFreq)) return false;
  }
  if (Object.keys(bets).length > MAX_NODES || !Object.entries(bets).every(([k, v]) => isText(k, 100) && isNum(v) && v > 0)) return false;
  if (!(ev === undefined || isPair(ev)) || !(eq === undefined || (isPair(eq) && eq.every(isFreq)))) return false;
  if (!isText(source) || !SOURCES.includes(source) || typeof approximate !== "boolean") return false;
  return [exploitabilityPct, iterations, seconds].every((v) => v === undefined || (isNum(v) && v >= 0));
}

/** A report as it's stored, else null. */
export function readFlopReport(x: unknown): FlopReportRecord | null {
  if (!isObj(x)) return null;
  const { id, name, spot, from, mode, size, flops, done, left, seats, pot, status, note, tags, createdAt, updatedAt } = x;
  if (!isText(id, 200) || !id || !isText(name, 200) || !name.trim() || !isText(spot) || !spot) return null;
  if (from !== "study" && from !== "solve") return null;
  if (!isText(mode) || !MODES.includes(mode) || !isNum(size) || !Number.isInteger(size) || size < 1 || size > MAX_REPORT_FLOPS) return null;
  if (!Array.isArray(flops) || !flops.length || flops.length > MAX_REPORT_FLOPS || !flops.every((f) => isText(f) && FLOP_RE.test(f)) || new Set(flops).size !== flops.length) return null;
  if (!Array.isArray(done) || done.length > flops.length || !done.every(validFlop)) return null;
  if (!Array.isArray(left) || left.length > flops.length || !left.every((l) => isObj(l) && isText(l.f) && FLOP_RE.test(l.f) && isText(l.why))) return null;
  // (a flop answered or left out once, and one of the set's)
  const seen = [...done.map((d) => d.f), ...(left as { f: string }[]).map((l) => l.f)];
  if (new Set(seen).size !== seen.length || !seen.every((f) => flops.includes(f))) return null;
  if (!(seats === null || (Array.isArray(seats) && seats.length === 2 && seats.every((s) => isText(s, 10) && s)))) return null;
  if (!isNum(pot) || pot < 0 || (status !== "paused" && status !== "done")) return null;
  if (!(note === undefined || isText(note)) || !isOptTags(tags) || !isTime(createdAt) || !isTime(updatedAt)) return null;
  return {
    id,
    name,
    spot,
    from,
    mode: mode as FlopReportRecord["mode"],
    size,
    flops: flops as string[],
    done: done as FlopReportFlop[],
    left: left as FlopReportRecord["left"],
    seats: seats as FlopReportRecord["seats"],
    pot,
    status,
    note: note ?? "",
    ...(tags ? { tags: tags as string[] } : {}),
    createdAt,
    updatedAt,
  };
}

/** Whether it was stored: false where the browser's database can't be used. `nudge`: count it toward the backup
 * reminder (a report's first save and a finished one; not each flop). */
export async function putFlopReport(r: FlopReportRecord, nudge = false): Promise<boolean> {
  const d = await db();
  if (!d) return false;
  await d.put("flopReports", r);
  if (nudge) await noteSaved();
  return true;
}

export async function getFlopReport(id: string): Promise<FlopReportRecord | null> {
  const d = await db();
  return d ? readFlopReport(await d.get("flopReports", id)) : null;
}

/** Every report that can be read, the latest changed first, and how many can't. */
export async function listFlopReports(): Promise<{ list: FlopReportRecord[]; damaged: number }> {
  const d = await db();
  const all: unknown[] = d ? await d.getAll("flopReports") : [];
  const list = all.flatMap((x) => readFlopReport(x) ?? []);
  return { list: list.sort((a, b) => b.updatedAt - a.updatedAt), damaged: all.length - list.length };
}

export async function deleteFlopReport(id: string): Promise<void> {
  await deleteRecord("flopReports", id);
}
