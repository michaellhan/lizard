// A published library's files, as drills read them (classic drills.js `get`/`entry`/`pickSpot`): the heads-up
// index, a spot's report.json and ranges.json, and its flop entries. Each file is asked for with the version the
// index gives it, so a republished file is fetched again and an unchanged one comes from the HTTP cache.
import type { LibraryIndex, LibrarySpotIndex } from "./catalog";
import { decodeEntry, decodeHead, type Entry, type EntryHead, type LibraryRanges } from "./entry";
import { reportFromHeads } from "./mwReport";
import { decodeTurns, type TurnFile } from "./turns";

/** <spot>/report.json (scripts/build_flop_library.py): the spot's flop strategy on each stored flop */
export interface ReportFlop {
  f: string;
  /** how many of the 22100 flops this one stands for */
  w: number;
  /** node path ("" the root, "check", "check|bet 33%") -> the range's frequencies, in `nodes[path]` order */
  n: Record<string, number[]>;
  /** each player's EV in bb at the start of the flop, [out of position, in position] (reports) */
  ev?: [number, number];
  /** each range's equity against the other's */
  eq?: [number, number];
  /** each range's share at NUT_EQUITY or more: not in report.json, but joined on from nuts.json (reportWithNuts) */
  nuts?: [number, number];
}

/** a range's nut share is its weight at this much equity or more against the other range, as Study's breakdown reads it */
export const NUT_EQUITY = 0.8;

/** <spot>/nuts.json (scripts/library/nuts.py): each flop's nut shares, worked from the stored ranges with no solve */
export interface LibraryNuts {
  format: number;
  nut_eq: number;
  fp: string[];
  flops: Record<string, [number, number]>;
}

const isShare = (x: unknown) => typeof x === "number" && x >= 0 && x <= 1;

/** The report with its nut shares joined on. Shares for other ranges or another definition aren't used, and a flop
 * with no good pair has none: it shows as a dash, never as 0. */
export function withNuts(report: LibraryReport, nuts: LibraryNuts, fp: readonly string[] | undefined): LibraryReport {
  if (nuts.format !== 1 || nuts.nut_eq !== NUT_EQUITY || String(nuts.fp) !== String(fp ?? [])) return report;
  return {
    ...report,
    flops: report.flops.map((fl) => {
      const n = nuts.flops?.[fl.f];
      return Array.isArray(n) && n.length === 2 && n.every(isShare) ? { ...fl, nuts: n } : fl;
    }),
  };
}

export interface LibraryReport {
  format: number;
  id: string;
  label: string;
  /** preflop line, e.g. "UTG:f,HJ:f,CO:f,BTN:r2.5,SB:f,BB:c" */
  line: string;
  /** [out of position, in position]; a 3-way spot's three in acting order */
  seats: [string, string, ...string[]];
  pot: number;
  stack: number;
  nodes: Record<string, string[]>;
  flops: ReportFlop[];
  game?: { players: number; stack: number; ante: number; straddle: boolean };
}

export class LibraryFiles {
  private entries = new Map<string, Promise<Entry>>();
  private turnFiles = new Map<string, Promise<TurnFile>>();
  private spots = new Map<string, Promise<{ report: LibraryReport; ranges: LibraryRanges }>>();
  private mw = new Map<string, LibraryReport>();

  constructor(
    readonly base: string,
    private readonly fetchImpl: typeof fetch = (...a) => fetch(...a),
  ) {}

  private async get(path: string, init?: RequestInit): Promise<Response> {
    const r = await this.fetchImpl(this.base + path, init);
    if (!r.ok) throw new Error(`couldn't load ${path.split("?")[0]} (${r.status})`);
    return r;
  }

  /** index.json (the two-player spots; 3-way spots are in mw_index.json and aren't drilled) */
  async index(): Promise<LibraryIndex> {
    return (await (await this.get("index.json", { cache: "no-cache" })).json()) as LibraryIndex;
  }

  /** mw_index.json: the 3-way spots (null where the library has none) */
  async mwIndex(): Promise<LibraryIndex | null> {
    const r = await this.fetchImpl(this.base + "mw_index.json", { cache: "no-cache" });
    return r.ok ? ((await r.json()) as LibraryIndex) : null;
  }

  /** a 3-way spot's report, built from every stored flop's entry header (mwReport.ts): each file is read, eight at a
   * time, `onProgress` told how many are in; kept once whole */
  async mwReport(sp: LibrarySpotIndex, opts: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {}): Promise<LibraryReport> {
    const kept = this.mw.get(sp.id);
    if (kept) return kept;
    const flops = Object.keys(sp.flops).sort();
    const heads: EntryHead[] = new Array(flops.length);
    let next = 0;
    let done = 0;
    const work = async () => {
      while (next < flops.length) {
        const i = next++;
        const f = flops[i]!;
        const r = await this.get(`${sp.id}/${f}.bin?v=${sp.flops[f] ?? ""}`, { signal: opts.signal });
        heads[i] = await decodeHead(await r.arrayBuffer());
        opts.onProgress?.(++done, flops.length);
      }
    };
    await Promise.all(Array.from({ length: Math.min(8, flops.length) }, work));
    const rep = reportFromHeads(sp, heads);
    this.mw.set(sp.id, rep);
    return rep;
  }

  /** a spot's report and ranges (kept: a spot's drills share them) */
  spot(sp: LibrarySpotIndex): Promise<{ report: LibraryReport; ranges: LibraryRanges }> {
    let s = this.spots.get(sp.id);
    if (!s) {
      s = Promise.all([
        this.get(`${sp.id}/report.json?v=${sp.report ?? ""}`).then((r) => r.json() as Promise<LibraryReport>),
        this.get(`${sp.id}/ranges.json?v=${(sp.fp ?? []).join("")}`).then((r) => r.json() as Promise<LibraryRanges>),
      ]).then(([report, ranges]) => {
        if (sp.fp && String(ranges.fp) !== String(sp.fp)) throw new Error(`${sp.id}'s ranges.json is out of date`);
        return { report, ranges };
      });
      s.catch(() => this.spots.delete(sp.id));
      this.spots.set(sp.id, s);
    }
    return s;
  }

  /** a spot's report with its nut shares where the library has them. They're extra: without the file, or with one
   * that won't load, this is the plain report. */
  async reportWithNuts(sp: LibrarySpotIndex): Promise<LibraryReport> {
    const { report } = await this.spot(sp);
    if (!sp.nuts) return report;
    try {
      return withNuts(report, (await (await this.get(`${sp.id}/nuts.json?v=${sp.nuts}`)).json()) as LibraryNuts, sp.fp);
    } catch {
      return report;
    }
  }

  /** A flop's turn file, decoded; the last 40 are kept. Refused unless it's the one solved with the entry the index
   * lists: its header names that entry's hash, as the engine reads it. `signal` cancels the fetch. */
  turns(sp: LibrarySpotIndex, flop: string, signal?: AbortSignal): Promise<TurnFile> {
    const k = `${sp.id}/${flop}`;
    let t = this.turnFiles.get(k);
    if (!t) {
      const v = sp.flops[flop] ?? "";
      t = this.get(`${k}.turn.bin?v=${v}`, signal ? { signal } : undefined).then(async (r) => {
        const file = await decodeTurns(await r.arrayBuffer());
        if (file.head.board !== flop || !v || !file.head.entry.startsWith(v)) throw new Error(`${k}'s turn file isn't its entry's`);
        return file;
      });
      t.catch(() => this.turnFiles.delete(k));
      if (this.turnFiles.size >= 40) this.turnFiles.delete(this.turnFiles.keys().next().value!);
      this.turnFiles.set(k, t);
    }
    return t;
  }

  /** a flop's entry, decoded; the last 40 are kept. `signal` cancels the fetch. */
  entry(sp: LibrarySpotIndex, flop: string, signal?: AbortSignal): Promise<Entry> {
    const k = `${sp.id}/${flop}`;
    let e = this.entries.get(k);
    if (!e) {
      e = this.get(`${k}.bin?v=${sp.flops[flop] ?? ""}`, signal ? { signal } : undefined).then(async (r) => decodeEntry(await r.arrayBuffer()));
      e.catch(() => this.entries.delete(k));
      if (this.entries.size >= 40) this.entries.delete(this.entries.keys().next().value!);
      this.entries.set(k, e);
    }
    return e;
  }
}
