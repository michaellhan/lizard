// The turn report on Reports: a sample of a spot's flops of the chosen texture, read from the library with no solve, as
// a table by what the turn card does to the board (turnReport.ts). It reads nothing until asked, says how many flops it
// read of how many and how it picked them, can be stopped, and can read further; what it read is kept for the page, so
// choosing another line or decision, or coming back to a texture, reads nothing again.
import { useEffect, useMemo, useRef, useState } from "react";
import { PhoneColumns } from "@/components/PhoneColumns";
import { ProvenanceBadge } from "@/components/ProvenanceBadge";
import { pct } from "@/components/actions";
import { flopWords, TEXTURE_GROUPS, type TextureFilter } from "@/features/practice/drills";
import { CLASSES } from "@/features/study/runouts";
import { storedTurnFlops, type LibrarySpotIndex } from "@/library/catalog";
import type { LibraryFiles, LibraryReport } from "@/library/files";
import { useSettings } from "@/state/settings";
import { MixBar } from "./MixBar";
import {
  eligibleFlops,
  FLOP_KB,
  lineChoices,
  MIN_FLOPS_FOR_MARGIN,
  readFlops,
  readingOrder,
  sampleText,
  textureCover,
  TURN_SAMPLE,
  TURN_WHO,
  turnProvenance,
  turnTable,
  whoShort,
  whoText,
  type FlopTurns,
  type TurnRow,
  type TurnWho,
} from "./turnReport";

const label = (n: string) => n[0]!.toUpperCase() + n.slice(1);
const SHOWN_FAILURES = 3;

/** what the page has read, across spots and textures: a flop's file versions in the key */
export type KeptTurns = Map<string, FlopTurns>;

function textureWords(filter: TextureFilter): string {
  const said = TEXTURE_GROUPS.flatMap((g) => (filter[g.key] ? [g.values[filter[g.key]!]!] : []));
  return said.length ? said.join(", ").toLowerCase() : "any texture";
}

const marginText = (r: TurnRow) => (r.margin == null ? "too few" : r.margin === 0 ? "none" : `±${(r.margin * 100).toFixed(1)}`);

export function TurnReportPanel({
  files,
  spot,
  rep,
  filter,
  params,
  set,
  kept,
  sample = TURN_SAMPLE,
  againRef,
}: {
  files: LibraryFiles;
  spot: LibrarySpotIndex;
  rep: LibraryReport;
  filter: TextureFilter;
  params: URLSearchParams;
  set: (kv: Record<string, string | null>) => void;
  kept: KeptTurns;
  sample?: number;
  /** set by Another sample, whose press replaces this whole panel: the new one's first control takes the keyboard */
  againRef?: { current: boolean };
}) {
  const mode = useSettings((s) => s.mode);
  const seedAsked = Number(params.get("tseed"));
  const seed = Number.isInteger(seedAsked) && seedAsked > 0 ? seedAsked : 1;
  const who: TurnWho = params.get("twho") === "after" ? "after" : "first";
  const stored = useMemo(() => storedTurnFlops(spot), [spot]);
  const eligible = useMemo(() => eligibleFlops(rep, stored, filter), [rep, stored, filter]);
  const order = useMemo(() => readingOrder(eligible, seed), [eligible, seed]);
  const cover = useMemo(() => textureCover(rep, eligible, filter), [rep, eligible, filter]);

  const [asked, setAsked] = useState(0);
  const [running, setRunning] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [failed, setFailed] = useState<Map<string, string>>(new Map());
  const [fatal, setFatal] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const stop = useRef<AbortController | null>(null);
  useEffect(() => () => stop.current?.abort(), []);
  // The Stop button goes when reading ends, and would take the keyboard's place on the page with it.
  const panel = useRef<HTMLElement>(null);
  const controls = useRef<HTMLDivElement>(null);
  const placeFocus = useRef(false);
  useEffect(() => {
    if (!placeFocus.current) return;
    placeFocus.current = false;
    (controls.current?.querySelector("button") ?? panel.current?.querySelector<HTMLElement>("[tabindex='0']"))?.focus();
  }, [running]);
  useEffect(() => {
    if (!againRef?.current) return;
    againRef.current = false;
    controls.current?.querySelector("button")?.focus();
  }, [againRef]);

  const key = (f: string) => `${files.base}${spot.id}/${f}?${spot.flops[f] ?? ""}`;
  const read = useMemo(() => order.slice(0, asked).flatMap((x) => kept.get(key(x.f)) ?? []), [order, asked, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = async (n: number) => {
    const ac = new AbortController();
    stop.current = ac;
    // (the button pressed goes as reading starts, for Stop)
    placeFocus.current = !!controls.current?.contains(document.activeElement);
    const target = Math.min(n, order.length);
    const todo = order.slice(0, target).filter((x) => !kept.has(key(x.f)));
    setAsked(target);
    setStopped(false);
    setFatal(null);
    setFailed(new Map());
    setRunning(true);
    try {
      await readFlops(files, spot, todo, {
        signal: ac.signal,
        onFlop: (r) => {
          kept.set(key(r.f), r);
          setTick((t) => t + 1);
        },
        onFail: (f, why) => setFailed((m) => new Map(m).set(f, why)),
      });
    } catch (e) {
      if (!ac.signal.aborted) setFatal(e instanceof Error ? e.message : String(e));
    }
    if (stop.current === ac) {
      placeFocus.current = !!controls.current?.contains(document.activeElement);
      setRunning(false);
      setStopped(ac.signal.aborted);
      // (stopped before a flop came back: there's no sample begun, so what's offered is the start again)
      if (ac.signal.aborted && !order.slice(0, target).some((x) => kept.has(key(x.f)))) setAsked(0);
    }
  };

  if (!stored.length) {
    return (
      <section aria-label="Turn report" className="rounded-lg border border-border bg-surface p-3 text-sm">
        <h2 className="font-medium">Turn report</h2>
        <p className="mt-1 text-muted">{spot.label} stores no turn files, so there&rsquo;s no turn report for it. Spots with stored turns have one here.</p>
      </section>
    );
  }

  const unasked = order.length - asked;
  const partial = running || (stopped && read.length < asked);
  const lines = lineChoices(read);
  const line = lines.find((l) => l.key === params.get("tline")) ?? lines[0];
  const table = line ? turnTable(read, line.path, who, eligible.length) : null;
  const top = table?.rows[0] ?? null;
  const state = { read: read.length, of: eligible.length, seed, failed: failed.size, partial, stopped: stopped && partial };
  const provenance = read.length ? turnProvenance(spot.id, state, mode, spot.report) : null;
  const seats = rep.seats;
  const next = Math.min(sample, unasked);
  const firstBytes = (Math.min(sample, eligible.length) * FLOP_KB) / 1000;
  const fail = [...failed];

  return (
    <section ref={panel} aria-label="Turn report" className="space-y-2 rounded-lg border border-border bg-surface p-3 text-sm">
      <h2 className="font-medium">Turn report</h2>
      {!eligible.length ? (
        <p className="text-muted">No flop of this texture ({textureWords(filter)}) has stored turns in {spot.label}.</p>
      ) : (
        <p className="text-muted">
          How the stored turn&rsquo;s first decisions change with the turn card, over flops of {textureWords(filter)}: {eligible.length} of {cover.flops} such flops have stored turns
          {eligible.length < cover.flops ? `, standing for ${pct(cover.share, 0)} of them by how often they come up, and the report is over those alone` : ""}.
          {!asked && ` Reading ${Math.min(sample, eligible.length)} of them takes two files a flop, up to about ${firstBytes.toFixed(1)} MB.`}
        </p>
      )}

      {eligible.length > 0 && (
        <div ref={controls} className="flex flex-wrap items-center gap-2">
          {running ? (
            <button type="button" onClick={() => stop.current?.abort()} className="rounded-md border border-border px-3 py-1 hover:bg-surface-2">
              Stop
            </button>
          ) : !asked ? (
            <button type="button" onClick={() => void go(sample)} className="rounded-md border border-border px-3 py-1 hover:bg-surface-2">
              Read {Math.min(sample, eligible.length)} flops
            </button>
          ) : (
            <>
              {(stopped || failed.size > 0 || fatal) && asked > read.length && (
                <button type="button" onClick={() => void go(asked)} className="rounded-md border border-border px-3 py-1 hover:bg-surface-2">
                  Read the {asked - read.length} left
                </button>
              )}
              {next > 0 && (
                <button type="button" onClick={() => void go(asked + next)} className="rounded-md border border-border px-3 py-1 hover:bg-surface-2">
                  Read {next} more
                </button>
              )}
            </>
          )}
          {!running && asked > 0 && eligible.length > read.length && (
            <button type="button" onClick={() => {
              if (againRef) againRef.current = true;
              set({ tseed: String(seed + 1) });
            }} className="rounded-md border border-border px-3 py-1 hover:bg-surface-2">
              Another sample
            </button>
          )}
        </div>
      )}

      {running && (
        <div className="max-w-md space-y-1 text-muted">
          <p>
            Read {read.length} of {asked} flops…
          </p>
          <div className="h-1.5 overflow-hidden rounded bg-surface-3" role="progressbar" aria-label="Flops read" aria-valuemin={0} aria-valuemax={asked} aria-valuenow={read.length}>
            <div className="h-full bg-accent" style={{ width: `${(read.length / (asked || 1)) * 100}%` }} />
          </div>
        </div>
      )}
      <p role="status" className="sr-only">
        {running ? "Reading the turn report." : read.length ? `Turn report: ${read.length} flops read.` : ""}
      </p>
      {stopped && !asked && <p className="text-muted">Stopped before a flop came back, so there&rsquo;s nothing to show yet.</p>}
      {fatal && (
        <p role="alert" className="text-danger">
          Couldn&rsquo;t read this spot&rsquo;s ranges, which the report needs: {fatal}
        </p>
      )}
      {fail.length > 0 && (
        <p role="alert" className="text-danger">
          {fail.length} of {asked} flops couldn&rsquo;t be read and are left out: {fail.slice(0, SHOWN_FAILURES).map(([f, why]) => `${f} (${why})`).join("; ")}
          {fail.length > SHOWN_FAILURES ? `, and ${fail.length - SHOWN_FAILURES} more` : ""}.
        </p>
      )}

      {provenance && line && table && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <ProvenanceBadge p={provenance} />
          </div>
          <p>{sampleText(state, top?.margin ?? null)}</p>
          <form aria-label="Turn report's decision" className="flex flex-wrap items-center gap-2" onSubmit={(e) => e.preventDefault()}>
            <label className="flex max-w-full items-center gap-1">
              <span className="text-muted">Flop line</span>
              <select aria-label="Flop line" value={line.key} onChange={(e) => set({ tline: e.target.value })} className="min-w-0 max-w-[15rem] rounded border border-border bg-surface-2 px-1.5 py-1 sm:max-w-md">
                {lines.map((l) => (
                  <option key={l.key} value={l.key}>
                    {flopWords(rep, l.path)} ({pct(l.share, 0)} of hand pairs)
                  </option>
                ))}
              </select>
            </label>
            <span role="group" aria-label="Turn decision" className="segmented inline-flex max-w-full overflow-hidden rounded-md border border-border">
              {TURN_WHO.map((w) => (
                <button key={w} type="button" title={whoText(w, seats)} aria-pressed={w === who} onClick={() => set({ twho: w === "first" ? null : w })} className={`px-2.5 py-1 ${w === who ? "bg-surface-3 text-text" : "text-muted hover:bg-surface-2"}`}>
                  {whoShort(w, seats)}
                </button>
              ))}
            </span>
          </form>
          <p className="text-muted">
            This line is stored on {line.flops} of the {read.length} flops read.{" "}
            {line.unread > 0 && `On ${line.unread} more it's stored but left out: a decision on the way to it is too rare for the flop's file to hold, so its hands can't be weighed. `}
            {table.rows.length === 0 && "No hands reach this decision on it."}
          </p>
          {table.rows.length > 0 && (
            <PhoneColumns hidden={["Strategy", "Flops", "Combos"]}>
              <div className="overflow-auto rounded-lg border border-border" tabIndex={0} role="region" aria-label="Turn report table">
                <table className="w-full border-collapse text-xs tabular-nums">
                  <caption className="sr-only">
                    {whoText(who, seats)} after {flopWords(rep, line.path)}, by what the turn card does to the board
                  </caption>
                  <thead className="bg-surface text-left text-muted">
                    <tr>
                      <th scope="col" className="px-2 py-1.5 font-medium">
                        Turn card
                      </th>
                      <th scope="col" className="phone-col px-2 py-1.5 font-medium">
                        Strategy
                      </th>
                      {table.cols.map((c) => (
                        <th key={c} scope="col" className="whitespace-nowrap px-1.5 py-1.5 text-right font-medium sm:px-2">
                          {label(c)}
                        </th>
                      ))}
                      <th scope="col" className="px-1.5 py-1.5 text-right font-medium sm:px-2" title="Half the 95% interval from reading a sample, in points of frequency, on the action it's widest">
                        Margin
                      </th>
                      <th scope="col" className="phone-col px-2 py-1.5 text-right font-medium" title="Flops read where this class of card comes up on this line">
                        Flops
                      </th>
                      <th scope="col" className="phone-col px-2 py-1.5 text-right font-medium" title="The acting range at the decision, in combos, averaged as the mix is">
                        Combos
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {table.rows.map((r) => (
                      <tr key={r.cls} aria-label={r.label} className={`border-t border-border ${r.cls === "all" ? "bg-surface-2 font-semibold" : ""}`}>
                        <th scope="row" className="px-2 py-1 text-left font-normal">
                          {r.label}
                          <small className="block text-faint">{pct(r.turns, 0)} of turns</small>
                          {/* (at phone width the two columns go, and what stands behind a row stays with it) */}
                          <small className="block text-faint sm:hidden">
                            {r.flops} {r.flops === 1 ? "flop" : "flops"}, {r.combos.toFixed(0)} combos
                          </small>
                        </th>
                        <td className="phone-col w-1/3 px-2 py-1">
                          <MixBar freqs={r.mix} cols={table.cols} />
                        </td>
                        {table.cols.map((c, i) => (
                          <td key={c} className="px-1.5 py-1 text-right sm:px-2">
                            {pct(r.mix[i])}
                          </td>
                        ))}
                        <td className="whitespace-nowrap px-1.5 py-1 text-right sm:px-2">{marginText(r)}</td>
                        <td className="phone-col px-2 py-1 text-right">{r.flops}</td>
                        <td className="phone-col px-2 py-1 text-right">{r.combos.toFixed(1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </PhoneColumns>
          )}
          <p className="text-xs text-muted">
            Precomputed solutions, the library&rsquo;s: each flop&rsquo;s stored turn is its flop solve&rsquo;s own, with one bet size, mixes in 5% steps and a turn class&rsquo;s cards alike. A turn you deal in Study is solved on its own, with more sizes. Each mix is the range at the decision, each combo by how much of it reaches there on this line. Averages count each flop by how many of the 22,100 it stands for, the hand pairs that take the line and the cards in the class
            {who === "after" ? `, and how often ${seats[0]} checks there` : ""}. A line is stored where at least 1% of hand pairs take it, so an average is over the flops that store it.
            {" "}Turn cards are classed by the first of these that holds: {CLASSES.flush.toLowerCase()} (a third card of a suit on the board, or more); {CLASSES.straight.toLowerCase()} (a straight&rsquo;s five ranks hold the card and two board ranks or more); {CLASSES.pair.toLowerCase()}; an overcard (above every board card); a brick (below every board card); an undercard (between them).
            {" "}Margin is half a 95% interval, in points of frequency, for reading a sample of the flops rather than all of them, on the action where it&rsquo;s widest. It says nothing of the solves&rsquo; own error, and a row behind fewer than {MIN_FLOPS_FOR_MARGIN} flops doesn&rsquo;t get one. Combos is the acting range&rsquo;s size there.
          </p>
        </>
      )}
    </section>
  );
}
