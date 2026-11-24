// Library coverage, read live from the published index: as the heads-up builds complete more flops and the library
// is republished, this page (and the engine) pick them up without a redeploy.
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { LIBRARY_SOURCES, type LibrarySourceId } from "@/config";
import { loadCatalog, type LibraryCatalog, type SingleSizeCoverage, type SpotCoverage } from "@/library/catalog";
import { parseLine } from "@/features/study/studyState";

const KIND: Record<SpotCoverage["kind"], string> = {
  srp: "Single-raised",
  "3bp": "3-bet pot",
  limped: "Limped",
  multiway: "3-way",
  other: "Other",
};

/** `unreadable`: the index didn't come back at all, which doesn't say whether it's published. */
type ShownCatalog = LibraryCatalog & { unreadable?: boolean };

export function LibraryPage() {
  const [cats, setCats] = useState<Partial<Record<LibrarySourceId, ShownCatalog>>>({});
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    for (const s of LIBRARY_SOURCES) {
      void loadCatalog(s.id)
        .catch(
          (e: unknown): ShownCatalog => ({
            source: s.id,
            base: s.base,
            available: false,
            spots: [],
            fetchedAt: Date.now(),
            error: String(e),
            unreadable: true,
          }),
        )
        .then((c) => alive && setCats((m) => ({ ...m, [s.id]: c })));
    }
    return () => {
      alive = false;
    };
  }, [tick]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Precomputed library</h1>
          <p className="max-w-2xl text-sm text-muted">Anything not listed is solved live.</p>
        </div>
        <button type="button" onClick={() => setTick((t) => t + 1)} className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface-2">
          Refresh
        </button>
      </div>
      {LIBRARY_SOURCES.map((s) => (
        <SourceSection key={s.id} label={s.label} base={s.base} cat={cats[s.id]} />
      ))}
    </div>
  );
}

function SourceSection({ label, base, cat }: { label: string; base: string; cat: ShownCatalog | undefined }) {
  const groups = useMemo(() => {
    const m = new Map<string, SpotCoverage[]>();
    for (const s of cat?.spots ?? []) m.set(s.game, [...(m.get(s.game) ?? []), s]);
    return [...m.entries()];
  }, [cat]);
  return (
    <section className="space-y-2" aria-label={label}>
      <h2 className="text-lg font-semibold">
        {label} <span className="font-mono text-xs font-normal text-faint">{base}</span>
      </h2>
      {!cat && <p className="text-sm text-muted">Loading…</p>}
      {cat && !cat.available && (
        <p className="text-sm text-muted">{cat.unreadable ? "Couldn't read this library's index. Check your connection, then Refresh." : "Not published yet."}</p>
      )}
      {groups.map(([game, spots]) => (
        <div key={game} className="scroll-x rounded-lg border border-border">
          <table className="w-full min-w-[560px] text-sm">
            <caption className="bg-surface-2 px-3 py-1.5 text-left font-medium">{game}</caption>
            <thead className="text-xs text-muted">
              <tr>
                <th className="px-3 py-1.5 text-left font-normal">Spot</th>
                <th className="px-3 py-1.5 text-left font-normal">Type</th>
                <th className="px-3 py-1.5 text-left font-normal">Flops</th>
                <th className="px-3 py-1.5 text-left font-normal">Stored turns</th>
                <th className="px-3 py-1.5 font-normal">
                  <span className="sr-only">Open in Study</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {spots.map((s) => (
                <tr key={s.id} className="border-t border-border/60">
                  <td className="px-3 py-1.5">
                    <div>{s.label}</div>
                    <div className="font-mono text-xs text-faint">{s.id}</div>
                  </td>
                  <td className="px-3 py-1.5">{KIND[s.kind]}</td>
                  <td className="px-3 py-1.5">
                    {s.target ? (
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-24 overflow-hidden rounded bg-surface-3" aria-hidden>
                          <div className="h-full bg-accent" style={{ width: `${Math.min(100, (s.flops / s.target) * 100)}%` }} />
                        </div>
                        <span className="font-mono text-xs">
                          {s.flops} / {s.target}
                        </span>
                      </div>
                    ) : (
                      <span className="font-mono text-xs">{s.flops}</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5">{s.storedTurns ? "yes" : "–"}</td>
                  <td className="px-3 py-1.5 text-right">
                    <StudyLink spot={s} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      {cat?.singleSize && <SingleSizeSection ss={cat.singleSize} />}
    </section>
  );
}

const SS_LISTED = 40;

/** The single-size library beside this one (ss_index.json): its own source, one bet size a node, on fewer flops. */
function SingleSizeSection({ ss }: { ss: SingleSizeCoverage }) {
  const [all, setAll] = useState(false);
  const shown = all ? ss.flops : ss.flops.slice(0, SS_LISTED);
  const plain = ss.spots.some((s) => !s.game && s.players !== 3);
  return (
    <div className="space-y-2">
      <div className="scroll-x rounded-lg border border-border">
        <table className="w-full min-w-[560px] text-sm">
          <caption className="bg-surface-2 px-3 py-1.5 text-left font-medium">
            Single-size library: 6-max 100bb, one bet size a node, the flop&apos;s chosen for each flop by the solver&apos;s automatic sizing
            {ss.games.length > 0 && "; also ante and straddle games, their ranges from Lizard's stored preflop solve of the game"}
            {ss.multiway && `; also 3-way lines on the 3-way single-size tree (one fixed flop size${ss.multiway.pct !== null ? ` of ${ss.multiway.pct}%` : ""} for every flop, turn and river 50%, three-player CFR: no Nash guarantee)`}
          </caption>
          <thead className="text-xs text-muted">
            <tr>
              <th className="px-3 py-1.5 text-left font-normal">Spot</th>
              <th className="px-3 py-1.5 text-left font-normal">Flops</th>
              <th className="px-3 py-1.5 font-normal">
                <span className="sr-only">Open in Study</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {ss.spots.map((s) => (
              <tr key={s.id} className="border-t border-border/60">
                <td className="px-3 py-1.5">
                  <div>{s.label}</div>
                  <div className="font-mono text-xs text-faint">{s.id}</div>
                  {s.game && (
                    <div className="text-xs text-muted">
                      Ranges entering the flop: Lizard&apos;s stored preflop solve of this game ({s.gameWords}), not the charts; preflop is approximate
                    </div>
                  )}
                  {s.players === 3 && (
                    <div className="text-xs text-muted">
                      3-way single-size tree{s.conv?.iters ? `: median ${s.conv.iters} iterations` : ""}
                      {typeof s.conv?.expl === "number" ? `, mean best-response gain ${s.conv.expl.toFixed(2)}% of the pot` : ""}; three-player CFR has no Nash guarantee
                    </div>
                  )}
                </td>
                <td className="px-3 py-1.5 font-mono text-xs">
                  {s.flops}
                  {(s.game || s.players === 3 ? s.target : ss.target) ? ` / ${s.game || s.players === 3 ? s.target : ss.target}` : ""}
                </td>
                <td className="px-3 py-1.5 text-right">
                  {parseLine(s.line).length > 0 && (
                    <Link to={`/study?${ssStudyQuery(s)}`} className="text-accent hover:underline">
                      Study →
                    </Link>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {ss.games.map((g) => <GameFlops key={`${g.ante}|${g.straddle}`} g={g} />)}
      {ss.multiway && (
        <GameFlops g={{ ante: 0, straddle: false, words: "3-way line", flops: ss.multiway.flops, target: ss.multiway.target }} what="every 3-way spot" />
      )}
      {plain && (
        <p className="text-xs text-muted">
          Flops covered on every 100bb spot ({ss.flops.length}
          {ss.target ? ` of ${ss.target} planned` : ""}): <span className="font-mono">{shown.join(" ")}</span>
          {ss.flops.length > SS_LISTED && (
            <>
              {all ? "" : " …"}{" "}
              <button type="button" onClick={() => setAll(!all)} className="underline hover:text-text">
                {all ? "Fewer" : `All ${ss.flops.length}`}
              </button>
            </>
          )}
          . Any other flop is asked from the library or solved live.
        </p>
      )}
    </div>
  );
}

/** A single-size spot's Study query: the 6-max 100bb game, its line, the single-size source, and its ante or straddle. */
function ssStudyQuery(s: { line: string; game?: { ante: number; straddle: boolean } }): string {
  const q = new URLSearchParams({ p: "6", s: "100", pre: s.line, lib: "ss" });
  if (s.game?.ante) q.set("ante", String(s.game.ante));
  if (s.game?.straddle) q.set("straddle", "1");
  return q.toString();
}

/** An ante or straddle game's covered flops, in a line under the table. */
function GameFlops({ g, what }: { g: SingleSizeCoverage["games"][number]; what?: string }) {
  const [all, setAll] = useState(false);
  const shown = all ? g.flops : g.flops.slice(0, SS_LISTED);
  return (
    <p className="text-xs text-muted">
      Flops covered on {what ?? `every spot with a ${g.words}`} ({g.flops.length}
      {g.target ? ` of ${g.target} planned` : ""}): <span className="font-mono">{shown.join(" ")}</span>
      {g.flops.length > SS_LISTED && (
        <>
          {all ? "" : " …"}{" "}
          <button type="button" onClick={() => setAll(!all)} className="underline hover:text-text">
            {all ? "Fewer" : `All ${g.flops.length}`}
          </button>
        </>
      )}
      . Any other flop is asked from the library or solved live.
    </p>
  );
}

function StudyLink({ spot }: { spot: SpotCoverage }) {
  if (!spot.line || parseLine(spot.line).length === 0) return null;
  const q = new URLSearchParams({ p: String(spot.tablePlayers), s: String(spot.tableStack), pre: spot.line });
  return (
    <Link to={`/study?${q.toString()}`} className="text-accent hover:underline">
      Study →
    </Link>
  );
}
