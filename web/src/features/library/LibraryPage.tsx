// Library coverage, read live from the published index: as the heads-up builds complete more flops and the library
// is republished, this page (and the engine) pick them up without a redeploy.
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { LIBRARY_SOURCES, type LibrarySourceId } from "@/config";
import { loadCatalog, type LibraryCatalog, type SpotCoverage } from "@/library/catalog";
import { parseLine } from "@/features/study/studyState";

const KIND: Record<SpotCoverage["kind"], string> = {
  srp: "Single-raised",
  "3bp": "3-bet pot",
  limped: "Limped",
  multiway: "3-way",
  other: "Other",
};

export function LibraryPage() {
  const [cats, setCats] = useState<Partial<Record<LibrarySourceId, LibraryCatalog>>>({});
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    for (const s of LIBRARY_SOURCES) {
      void loadCatalog(s.id)
        .catch(
          (e: unknown): LibraryCatalog => ({
            source: s.id,
            base: s.base,
            available: false,
            spots: [],
            fetchedAt: Date.now(),
            error: String(e),
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
          <p className="max-w-2xl text-sm text-muted">
            Flops answered instantly from solutions computed offline (each entry within ~0.1-0.15% of the pot of equilibrium in its
            abstraction). Anything not listed is solved live. Coverage is read from the published index each time.
          </p>
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

function SourceSection({ label, base, cat }: { label: string; base: string; cat: LibraryCatalog | undefined }) {
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
      {cat && !cat.available && <p className="text-sm text-muted">Not published yet ({cat.error}).</p>}
      {groups.map(([game, spots]) => (
        <div key={game} className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[560px] text-sm">
            <caption className="bg-surface-2 px-3 py-1.5 text-left font-medium">{game}</caption>
            <thead className="text-xs text-muted">
              <tr>
                <th className="px-3 py-1.5 text-left font-normal">Spot</th>
                <th className="px-3 py-1.5 text-left font-normal">Type</th>
                <th className="px-3 py-1.5 text-left font-normal">Flops</th>
                <th className="px-3 py-1.5 text-left font-normal">Stored turns</th>
                <th className="px-3 py-1.5" />
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
                        <span className="font-mono text-xs" title={`${s.flops} of the ${s.target} flops this spot is built over`}>
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
    </section>
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
