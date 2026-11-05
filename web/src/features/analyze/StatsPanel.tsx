// Your stats as played (stats.ts) over the hands the filters show: each frequency over its own chances with a 95%
// interval, the hands behind it, and your bet and raise sizes. Counted from the histories; nothing is graded.
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import type { HandRecord } from "@/data/db";
import { seatLabel } from "@/poker/seats";
import { STREETS } from "./analyze";
import { withParams } from "./leakDrill";
import { MIN_READ } from "./report";
import { RAISE_SIZES, SIZES, STATS, statsOf, wilson, type Count, type Stats } from "./stats";

const pct = (x: number) => `${Math.round(x * 100)}%`;
const nHands = (n: number) => `${n.toLocaleString()} ${n === 1 ? "hand" : "hands"}`;
/** hands listed under a stat, each way */
const LIST = 40;

export function StatsPanel({ hands, of }: { hands: HandRecord[]; of: number }) {
  const [res, setRes] = useState<{ of: HandRecord[]; stats: Stats } | null>(null);
  const [done, setDone] = useState<{ of: HandRecord[]; n: number } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    const ac = new AbortController();
    void statsOf(hands, { signal: ac.signal, onProgress: (n) => setDone({ of: hands, n }) }).then((stats) => stats && setRes({ of: hands, stats }));
    return () => ac.abort();
  }, [hands]);
  const byId = useMemo(() => new Map(hands.map((h) => [h.id, h])), [hands]);
  // (the last count stays up while the filters' hands are counted)
  const st = res?.stats;
  const counting = res?.of !== hands;
  const rows: { id: string; label: string; chance?: string; took?: string; c: Count; sub?: boolean }[] = st
    ? STATS.flatMap((x) => [
        { id: x.key, label: x.label, chance: x.chance, took: x.took, c: st.by[x.key] },
        ...(x.key === "rfi" ? st.rfi.map((r) => ({ id: `rfi:${r.pos}`, label: `RFI · ${r.pos}`, c: r.c, sub: true })) : []),
      ])
    : [];
  const sel = rows.find((r) => r.id === open);
  return (
    <section aria-label="Your stats" className="space-y-3 text-sm">
      <div>
        <h2 className="text-lg font-semibold">Your stats</h2>
        <p className="text-muted">
          Counted from {hands.length < of ? `the ${nHands(hands.length)} the filters show` : `your ${nHands(hands.length)}`}, as you played
          them: nothing here is graded or solved. Each rate is over its own chances, the hands where you could take it; the range is a 95% interval,
          wide when there are few (&ldquo;few&rdquo; marks under {MIN_READ} chances).
          {st && st.left > 0 && ` ${st.left.toLocaleString()} ${st.left === 1 ? "hand is" : "hands are"} left out: the replay stopped short of the history.`}
        </p>
      </div>
      {counting && (
        <p role="status" aria-label="Counting" className="text-muted">
          Counting… {done?.of === hands ? `${done.n.toLocaleString()} of ${hands.length.toLocaleString()} hands` : ""}
        </p>
      )}
      {st && (
        <>
          <div className="relative overflow-x-auto rounded-lg border border-border">
            <table aria-label="Frequencies as played" className="w-full text-left">
              <thead className="bg-surface-2 text-xs text-muted">
                <tr>
                  <th className="px-2 py-1 font-normal">Stat</th>
                  <th className="px-2 py-1 text-right font-normal">You</th>
                  <th className="px-2 py-1 text-right font-normal">Chances</th>
                  <th className="px-2 py-1 font-normal">95% range</th>
                  <th className="px-2 py-1">
                    <span className="sr-only">Hands</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const [lo, hi] = wilson(r.c.k, r.c.n);
                  return (
                    <tr key={r.id} aria-label={r.label} className="border-t border-border align-top">
                      <td className={`min-w-[11rem] px-2 py-1 ${r.sub ? "pl-6 text-muted" : ""}`}>
                        {r.label}
                        {r.chance && (
                          <span className="block text-xs text-muted">
                            {r.chance}: {r.took}
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums">{r.c.n ? pct(r.c.k / r.c.n) : "–"}</td>
                      <td className="px-2 py-1 text-right tabular-nums">
                        {r.c.n ? `${r.c.k.toLocaleString()} / ${r.c.n.toLocaleString()}` : "none"}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1 tabular-nums">
                        {r.c.n ? `${pct(lo)}–${pct(hi)}` : "–"}
                        {r.c.n > 0 && r.c.n < MIN_READ && <span className="ml-1 text-xs text-muted">few</span>}
                      </td>
                      <td className="px-2 py-1 text-right">
                        {r.c.n > 0 && (
                          <button
                            type="button"
                            aria-expanded={open === r.id}
                            onClick={() => setOpen(open === r.id ? null : r.id)}
                            className="rounded border border-border px-2 py-0.5 text-xs hover:bg-surface-2"
                          >
                            Hands
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {sel && <StatHands label={sel.label} took={sel.took} c={sel.c} byId={byId} />}
          <p className="text-xs text-muted">
            The history can&rsquo;t say whether a hand was only beating bluffs, so bluff-catching is read as every call of a river bet, and River call won as how those hands came out.
          </p>
          <BetSizes sizes={st.sizes} />
          <RaiseSizes raises={st.raises} />
        </>
      )}
    </section>
  );
}

function StatHands({ label, took, c, byId }: { label: string; took?: string; c: Count; byId: Map<string, HandRecord> }) {
  const [params] = useSearchParams();
  const list = (ids: string[], says: string) =>
    ids.length > 0 && (
      <div>
        <p className="text-muted">
          {says} ({ids.length.toLocaleString()}):
        </p>
        <ul className="flex flex-wrap gap-x-3 gap-y-0.5">
          {ids.slice(0, LIST).map((id) => {
            const h = byId.get(id);
            return (
              h && (
                <li key={id}>
                  <Link to={withParams(params, { hand: id })} className="underline">
                    {h.played || h.number || "hand"} · {seatLabel(h.hero, h.players)} {h.hole}
                  </Link>
                </li>
              )
            );
          })}
          {ids.length > LIST && <li className="text-muted">and {(ids.length - LIST).toLocaleString()} more</li>}
        </ul>
      </div>
    );
  return (
    <div role="region" aria-label={`Hands: ${label}`} className="space-y-1 rounded-lg border border-border bg-surface p-3">
      <p className="font-medium">{label}</p>
      {list(c.yes, took ? `Took it (${took})` : "Took it")}
      {list(c.no, "Didn't")}
    </div>
  );
}

function BetSizes({ sizes }: { sizes: Stats["sizes"] }) {
  const streets = ["flop", "turn", "river"] as const;
  const tot = Object.fromEntries(streets.map((s) => [s, sizes[s].reduce((a, b) => a + b, 0)])) as Record<(typeof streets)[number], number>;
  if (!streets.some((s) => tot[s])) return null;
  return (
    <div className="space-y-1">
      <h3 className="font-medium">Your bets after the flop, by size</h3>
      <p className="text-xs text-muted">Bets only (not raises), in % of the pot before the bet; an all-in counts at its size.</p>
      <div className="relative overflow-x-auto">
        <table aria-label="Bet sizes" className="text-left">
          <thead className="text-xs text-muted">
            <tr>
              <th className="pr-4 font-normal">Size</th>
              {streets.map((s) => (
                <th key={s} className="pr-4 text-right font-normal capitalize">
                  {s} ({tot[s]})
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {SIZES.map((b, k) => (
              <tr key={b.label} aria-label={b.label} className="border-t border-border">
                <td className="pr-4">{b.label}</td>
                {streets.map((s) => (
                  <td key={s} className="pr-4 text-right tabular-nums">
                    {tot[s] ? (
                      <>
                        {sizes[s][k]} <span className="text-xs text-muted">{pct(sizes[s][k]! / tot[s])}</span>
                      </>
                    ) : (
                      "–"
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RaiseSizes({ raises }: { raises: Stats["raises"] }) {
  const tot = Object.fromEntries(STREETS.map((s) => [s, raises[s].reduce((a, b) => a + b, 0)]));
  if (!STREETS.some((s) => tot[s])) return null;
  return (
    <div className="space-y-1">
      <h3 className="font-medium">Your raises, by size</h3>
      <p className="text-xs text-muted">In multiples of the bet raised, the big blind&rsquo;s for an open; an all-in counts at its size.</p>
      <div className="relative overflow-x-auto">
        <table aria-label="Raise sizes" className="text-left">
          <thead className="text-xs text-muted">
            <tr>
              <th scope="col" className="pr-4 font-normal">Size</th>
              {STREETS.map((s) => (
                <th key={s} scope="col" className="pr-4 text-right font-normal capitalize">
                  {s} ({tot[s]!.toLocaleString()})
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {RAISE_SIZES.map((b, k) => (
              <tr key={b.label} aria-label={b.label} className="border-t border-border">
                <th scope="row" className="pr-4 font-normal">{b.label}</th>
                {STREETS.map((s) => (
                  <td key={s} className="pr-4 text-right tabular-nums">
                    {tot[s] ? (
                      <>
                        {raises[s][k]!.toLocaleString()} <span className="text-xs text-muted">{pct(raises[s][k]! / tot[s]!)}</span>
                      </>
                    ) : (
                      "–"
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
