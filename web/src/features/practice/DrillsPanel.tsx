// Practice's drills: one spot's flop decision dealt hand after hand from the precomputed library, read in the page
// from the library's files (src/library/files.ts) with no solver, so each answer is there at once. Pick a spot, a
// decision (out of position first, in position after a check, out of position facing a bet) and a texture; your
// pick is graded against the stored mix and EVs for your hand (src/grading/grade.ts), with the stored solve's
// provenance. The drill's spot, decision and texture are in the URL; its score is kept in IndexedDB (sessions).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { PlayingCard } from "@/components/PlayingCard";
import { ProvenanceBadge } from "@/components/ProvenanceBadge";
import { VerdictTag } from "@/components/VerdictTag";
import { bb, pct } from "@/components/actions";
import { LIBRARY_SOURCES } from "@/config";
import { putSession, recentSessions, type SessionRecord } from "@/data/db";
import { addScore, emptyScore, GRADE_RULES, summary, type Grade, type Score } from "@/grading/grade";
import { gameLabel, resolveLibrarySource, type LibraryIndex, type LibrarySpotIndex } from "@/library/catalog";
import type { Entry, LibraryRanges } from "@/library/entry";
import { LibraryFiles, type LibraryReport } from "@/library/files";
import { SaveDrill } from "@/features/saved/SaveDrill";
import { useSettings } from "@/state/settings";
import {
  candidates,
  DRILL_VIEWS,
  drillActionLabel,
  drillProvenance,
  gradeDrill,
  pick,
  problem,
  situation,
  studyLink,
  TEXTURE_GROUPS,
  viewLabel,
  type DrillProblem,
  type DrillView,
  type TextureFilter,
} from "./drills";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const isView = (v: string | null): v is DrillView => DRILL_VIEWS.includes(v as DrillView);
const drillable = (s: LibrarySpotIndex) => s.seats.length === 2 && Boolean(s.report) && Object.keys(s.flops ?? {}).length > 0;

type Lib = { st: "loading" } | { st: "ready"; files: LibraryFiles; index: LibraryIndex; label: string } | { st: "error"; message: string };

/** `files`: the library to read (tests); otherwise the one Settings picks. `rng`: the deal's randomness. */
export function DrillsPanel({ files, rng = Math.random }: { files?: LibraryFiles; rng?: () => number } = {}) {
  const [params, setParams] = useSearchParams();
  const choice = useSettings((s) => s.librarySource);
  const [lib, setLib] = useState<Lib>({ st: "loading" });

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        let f = files;
        let label = "the library";
        if (!f) {
          const id = choice === "auto" ? await resolveLibrarySource() : choice;
          const src = LIBRARY_SOURCES.find((s) => s.id === id) ?? LIBRARY_SOURCES[0];
          f = new LibraryFiles(src.base);
          label = src.label;
        }
        const index = await f.index();
        if (alive) setLib({ st: "ready", files: f, index, label });
      } catch (e) {
        if (alive) setLib({ st: "error", message: message(e) });
      }
    })();
    return () => {
      alive = false;
    };
  }, [files, choice]);

  const spots = useMemo(() => (lib.st === "ready" ? lib.index.spots.filter(drillable) : []), [lib]);
  const spot = spots.find((s) => s.id === params.get("spot")) ?? spots[0];
  const view: DrillView = isView(params.get("view")) ? (params.get("view") as DrillView) : "vsbet";
  const filter: TextureFilter = Object.fromEntries(TEXTURE_GROUPS.flatMap((g) => (params.get(g.key) ? [[g.key, params.get(g.key)!]] : [])));
  const set = (k: string, v: string | null) =>
    setParams((p) => {
      const q = new URLSearchParams(p);
      if (v) q.set(k, v);
      else q.delete(k);
      return q;
    });

  if (lib.st === "loading") return <p className="text-sm text-muted">Loading the library&rsquo;s index…</p>;
  if (lib.st === "error")
    return (
      <p role="alert" className="text-sm text-danger">
        Couldn&rsquo;t read the library: {lib.message}
      </p>
    );
  if (!spot) return <p className="text-sm text-muted">This library has no two-player spot to drill.</p>;
  // the drill as set, to keep (Saved): the spot named, not left to the first
  const link = new URLSearchParams({ tab: "drills", spot: spot.id, view });
  for (const g of TEXTURE_GROUPS) if (filter[g.key]) link.set(g.key, filter[g.key]!);
  const about = [
    `${spot.label}${spot.game ? ` (${gameLabel(spot)})` : ""}`,
    viewLabel(view, spot.seats),
    ...TEXTURE_GROUPS.flatMap((g) => (filter[g.key] ? [g.values[filter[g.key]!] ?? filter[g.key]!] : [])),
  ].join(" · ");

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        One flop decision, dealt again and again from the precomputed library: answered at once, with no solve. The flop is drawn by how often it comes up,
        your hand by how often you&rsquo;d hold it here. Keys: 1&ndash;9 answer, Enter or Space for the next hand.
      </p>
      <div className="flex flex-wrap items-start gap-2">
        <form aria-label="Drill" className="flex flex-1 flex-wrap items-center gap-2 text-sm" onSubmit={(e) => e.preventDefault()}>
          <label className="flex items-center gap-1">
            <span className="text-muted">Spot</span>
            <select aria-label="Spot" value={spot.id} onChange={(e) => set("spot", e.target.value)} className="max-w-[16rem] rounded border border-border bg-surface-2 px-1.5 py-1">
              {spots.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                  {s.game ? ` (${gameLabel(s)})` : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1">
            <span className="text-muted">Decision</span>
            <select aria-label="Decision" value={view} onChange={(e) => set("view", e.target.value)} className="rounded border border-border bg-surface-2 px-1.5 py-1">
              {DRILL_VIEWS.map((v) => (
                <option key={v} value={v}>
                  {viewLabel(v, spot.seats)}
                </option>
              ))}
            </select>
          </label>
          {TEXTURE_GROUPS.map((g) => (
            <label key={g.key} className="flex items-center gap-1">
              <span className="text-muted">{g.label}</span>
              <select aria-label={g.label} value={filter[g.key] ?? ""} onChange={(e) => set(g.key, e.target.value || null)} className="rounded border border-border bg-surface-2 px-1.5 py-1">
                <option value="">Any</option>
                {Object.entries(g.values).map(([v, label]) => (
                  <option key={v} value={v}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </form>
        <SaveDrill kind="library" to={`/practice?${link}`} about={about} />
      </div>
      <SpotDrill key={`${spot.id}|${view}`} files={lib.files} spot={spot} view={view} filter={filter} rng={rng} source={lib.label} />
    </div>
  );
}

interface DrillSession {
  id: string;
  startedAt: number;
  score: Score;
}

const toRecord = (s: DrillSession, spot: LibrarySpotIndex, view: DrillView): SessionRecord => ({
  id: s.id,
  kind: "drill",
  startedAt: s.startedAt,
  endedAt: Date.now(),
  decisions: s.score.n,
  evLossBb: s.score.loss,
  meta: { spot: spot.id, label: spot.label, view, ok: s.score.ok, graded: s.score.ne, lossPct: s.score.lossPct, best: s.score.best },
});

type SpotData = { st: "loading" } | { st: "ready"; report: LibraryReport; ranges: LibraryRanges } | { st: "error"; message: string };
type Deal = { key: string } & ({ st: "dealing" } | { st: "ready"; pr: DrillProblem; entry: Entry } | { st: "none"; message: string });

/** One spot's decision drilled: mounted afresh (a new score) for each spot and decision. */
function SpotDrill({
  files,
  spot,
  view,
  filter,
  rng,
  source,
}: {
  files: LibraryFiles;
  spot: LibrarySpotIndex;
  view: DrillView;
  filter: TextureFilter;
  rng: () => number;
  source: string;
}) {
  const mode = useSettings((s) => s.mode);
  const [data, setData] = useState<SpotData>({ st: "loading" });
  const [session, setSession] = useState<DrillSession>(() => ({
    id: `drill-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
    startedAt: Date.now(),
    score: emptyScore(),
  }));
  const [n, setN] = useState(0);
  const [deal, setDeal] = useState<Deal>({ key: "", st: "dealing" });
  const [answer, setAnswer] = useState<{ key: string; a: number; g: Grade } | null>(null);
  const [past, setPast] = useState<SessionRecord[]>([]);
  const nextRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let alive = true;
    files.spot(spot).then(
      (d) => alive && setData({ st: "ready", ...d }),
      (e: unknown) => alive && setData({ st: "error", message: message(e) }),
    );
    void recentSessions("drill", 12)
      .then((xs) => alive && setPast(xs.filter((x) => x.meta.spot === spot.id && x.meta.view === view).slice(0, 5)))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [files, spot, view]);

  const filterKey = JSON.stringify(filter);
  const cands = useMemo(() => (data.st === "ready" ? candidates(data.report, view, filter) : []), [data, view, filterKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const dealKey = `${filterKey}|${n}`;

  // a hand dealt: a (flop, node) drawn by weight, its entry read, a hand drawn from the range there
  useEffect(() => {
    if (data.st !== "ready" || !cands.length) return;
    let alive = true;
    void (async () => {
      try {
        for (let tries = 0; tries < 8; tries++) {
          const c = cands[pick(cands.map((x) => x.w), rng)]!;
          const entry = await files.entry(spot, c.f);
          if (!alive) return;
          const pr = problem(data.report, entry, c, data.ranges, rng);
          if (pr) {
            setDeal({ key: dealKey, st: "ready", pr, entry });
            return;
          }
        }
        setDeal({ key: dealKey, st: "none", message: "No hand was found at the drawn spots: deal again." });
      } catch (e) {
        if (alive) setDeal({ key: dealKey, st: "none", message: `Couldn't deal: ${message(e)}` });
      }
    })();
    return () => {
      alive = false;
    };
  }, [data, cands, dealKey, files, spot, rng]);

  useEffect(() => {
    if (session.score.n) void putSession(toRecord(session, spot, view)).catch(() => {});
  }, [session, spot, view]);

  const shown: Deal = deal.key === dealKey ? deal : { key: dealKey, st: "dealing" };
  const pr = shown.st === "ready" ? shown.pr : null;
  const graded = answer && answer.key === dealKey ? answer : null;

  const choose = useCallback(
    (a: number) => {
      if (!pr || graded) return;
      const g = gradeDrill(pr, a);
      setAnswer({ key: dealKey, a, g });
      setSession((s) => ({ ...s, score: addScore(s.score, g) }));
    },
    [pr, graded, dealKey],
  );
  const next = useCallback(() => setN((x) => x + 1), []);

  // once answered, the next hand is a key away
  useEffect(() => {
    if (graded) nextRef.current?.focus();
  }, [graded]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName ?? "";
      if (e.metaKey || e.ctrlKey || e.altKey || /^(INPUT|SELECT|TEXTAREA)$/.test(tag)) return;
      if (pr && !graded && /^[1-9]$/.test(e.key) && Number(e.key) <= pr.names.length) choose(Number(e.key) - 1);
      // (Enter or Space on a focused button or link is that control's own)
      else if (graded && (e.key === "Enter" || e.key === " ") && !/^(BUTTON|A)$/.test(tag)) {
        e.preventDefault();
        next();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pr, graded, choose, next]);

  if (data.st === "loading") return <p className="text-sm text-muted">Loading {spot.label}…</p>;
  if (data.st === "error")
    return (
      <p role="alert" className="text-sm text-danger">
        Couldn&rsquo;t load the spot: {data.message}
      </p>
    );

  const rep = data.report;
  const flops = Object.keys(spot.flops).length;
  const storing = new Set(cands.map((c) => c.f)).size;
  const filtered = Object.values(filter).some(Boolean);
  const sum = summary(session.score);
  const s = session.score;
  const item = (label: string, value: string) => (
    <div className="rounded bg-surface-2 px-2 py-1">
      <div className="text-xs text-muted">{label}</div>
      <div className="font-mono">{value}</div>
    </div>
  );
  const link = pr ? studyLink(rep, pr) : null;

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted">
        {spot.label} in {source}: {flops.toLocaleString()} flops stored; {storing.toLocaleString()} store this decision
        {filtered ? " with this texture" : ""}.
      </p>

      <section aria-label="Score" className="flex flex-wrap gap-2 text-sm">
        {item("Decisions", String(s.n))}
        {item("Best or correct", s.n ? pct(sum.acc, 0) : "–")}
        {item("EV lost a decision", sum.loss == null || !s.n ? "–" : `${bb(sum.loss)}bb · ${sum.lossPct!.toFixed(1)}% pot`)}
        {item("Streak", `${s.streak} (best ${s.best})`)}
      </section>

      <section aria-label="Your hand" className="space-y-3 rounded-lg border border-border bg-surface p-3">
        {!cands.length ? (
          <p role="status" className="text-sm text-muted">
            No flop in this spot stores this decision{filtered ? " with that texture: widen the filter" : ""}.
          </p>
        ) : shown.st === "dealing" ? (
          <p className="text-sm text-muted">Dealing…</p>
        ) : shown.st === "none" ? (
          <p role="alert" className="text-sm text-danger">
            {shown.message}{" "}
            <button type="button" className="underline" onClick={next}>
              Deal again
            </button>
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-4">
              <div role="group" aria-label="Board" className="flex gap-1">
                {shown.pr.board.map((c) => (
                  <PlayingCard key={c} card={c} />
                ))}
              </div>
              <div role="group" aria-label="Your cards" className="flex items-center gap-1">
                <span className="text-xs text-muted">{shown.pr.hero} · you</span>
                {shown.pr.hand.map((c) => (
                  <PlayingCard key={c} card={c} />
                ))}
              </div>
            </div>
            <p className="text-sm">{situation(rep, shown.pr)}</p>
            <div role="group" aria-label="Your options" className="flex flex-wrap gap-2">
              {shown.pr.names.map((name, i) => (
                <button
                  key={name}
                  type="button"
                  disabled={Boolean(graded)}
                  aria-pressed={graded ? graded.a === i : undefined}
                  onClick={() => choose(i)}
                  className={`rounded-md border px-3 py-1.5 text-sm hover:bg-surface-3 disabled:cursor-default ${graded?.a === i ? "border-accent bg-surface-3" : "border-border bg-surface-2"}`}
                >
                  <span aria-hidden className="mr-1.5 text-xs text-faint">
                    {i + 1}
                  </span>
                  {drillActionLabel(shown.pr, name)}
                </button>
              ))}
            </div>
          </>
        )}
      </section>

      {pr && graded && shown.st === "ready" && (
        <section aria-label="Answer" className="space-y-2 rounded-lg border border-border bg-surface p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <VerdictTag v={graded.g.verdict} />
            <span>
              you took <span className="font-mono">{drillActionLabel(pr, pr.names[graded.a]!)}</span>
              {graded.g.a !== graded.g.best && (
                <>
                  ; the best was <span className="font-mono">{drillActionLabel(pr, pr.names[graded.g.best]!)}</span>
                </>
              )}
            </span>
            <ProvenanceBadge p={drillProvenance(shown.entry, mode)} />
          </div>
          <p className="text-muted">
            {graded.g.loss > 0 ? `EV given up: ${bb(graded.g.loss)}bb, ${graded.g.lossPct.toFixed(1)}% of the ${bb(pr.pot)}bb pot.` : "No EV given up."}
            {graded.g.mixed && " This hand mixes actions here."}
          </p>
          <table className="w-full max-w-md text-left font-mono text-xs">
            <thead className="text-muted">
              <tr>
                <th className="py-0.5 font-normal">Action</th>
                <th className="py-0.5 text-right font-normal">Played</th>
                <th className="py-0.5 text-right font-normal">EV bb</th>
              </tr>
            </thead>
            <tbody>
              {pr.names.map((name, i) => (
                <tr key={name} className={i === graded.a ? "text-accent" : ""}>
                  <td className="py-0.5">
                    {drillActionLabel(pr, name)}
                    {i === graded.a && " ← you"}
                  </td>
                  <td className="py-0.5 text-right">{pct(pr.freqs[i])}</td>
                  <td className="py-0.5 text-right">{bb(pr.evs[i])}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-muted">Your hand&rsquo;s frequencies and EVs at this node, as stored for the flop {pr.flop} (shown in other suits).</p>
          <div className="flex flex-wrap items-center gap-3">
            <button ref={nextRef} type="button" onClick={next} className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-bg hover:bg-accent-strong">
              Next hand
            </button>
            {link && (
              <Link to={link} className="text-accent hover:underline">
                Open in Study →
              </Link>
            )}
          </div>
        </section>
      )}

      <details className="rounded-lg border border-border bg-surface p-3 text-sm">
        <summary className="cursor-pointer">How decisions are graded</summary>
        <ul className="mt-2 space-y-1">
          {GRADE_RULES.map((r) => (
            <li key={r.verdict}>
              <VerdictTag v={r.verdict} /> {r.rule}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-muted">The EVs are the stored solve&rsquo;s, kept in steps of 1% of the pot (coarser for actions far below the best).</p>
      </details>

      {past.filter((p) => p.id !== session.id).length > 0 && (
        <section aria-label="Past drills" className="space-y-1 rounded-lg border border-border bg-surface p-3 text-sm">
          <h2 className="font-medium">Earlier sessions of this drill</h2>
          <ul className="space-y-0.5">
            {past
              .filter((p) => p.id !== session.id)
              .map((p) => (
                <li key={p.id} className="text-muted">
                  {new Date(p.startedAt).toLocaleString()} · {p.decisions} decisions
                  {p.decisions ? ` · ${pct((Number(p.meta.ok) || 0) / p.decisions, 0)} correct` : ""}
                  {p.decisions ? ` · ${bb(p.evLossBb / p.decisions)}bb lost a decision` : ""}
                </li>
              ))}
          </ul>
        </section>
      )}
    </div>
  );
}
