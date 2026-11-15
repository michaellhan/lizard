// Practice's drills: one spot's decision dealt hand after hand from the precomputed library, read in the page from the
// library's files (src/library/files.ts) with no solver, so each answer is there at once. Pick a spot, a street, a
// decision (on the flop: out of position first, in position after a check, facing a bet; on a turn a flop's turn file
// stores, the first two), a texture and a kind of hand. A flop pick is graded against the stored mix and EVs for your
// hand with the stored solve's provenance; a turn pick against the stored mix alone, as no file holds a hand's EV there,
// with the stored turn's (src/grading/grade.ts, drills.ts). The drill's settings are in the URL, only the ones set; its
// score is kept in IndexedDB (sessions). Nothing is solved here. Reveal shows the same stored mix before you pick, and a
// pick after it has no grade: it adds nothing to the score and keeps no mistake, and the session only counts how many
// there were. What no file stores, a river and a turn facing a bet, is a live drill's (LiveDrill.tsx): the same page and
// settings, each hand answered by a solve.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { PlayingCard } from "@/components/PlayingCard";
import { ProvenanceBadge } from "@/components/ProvenanceBadge";
import { VerdictTag } from "@/components/VerdictTag";
import { bb, pct } from "@/components/actions";
import { LIBRARY_SOURCES } from "@/config";
import { putSession, recentSessions, type SessionRecord } from "@/data/db";
import { keepMistake } from "@/data/mistakes";
import { addVersion } from "@/features/history/history";
import { drillMistake, drillMix, missedAgain } from "@/features/review/mistakes";
import { addScore, emptyScore, summary, whyText, type Grade, type Score } from "@/grading/grade";
import { gameLabel, isDrillable, resolveLibrarySource, storedTurnFlops, type LibraryIndex, type LibrarySpotIndex } from "@/library/catalog";
import type { Entry, LibraryRanges } from "@/library/entry";
import { LibraryFiles, type LibraryReport } from "@/library/files";
import { spotStamp } from "@/library/version";
import { SaveDrill } from "@/features/saved/SaveDrill";
import { useSettings } from "@/state/settings";
import {
  candidates,
  DRILL_VIEWS,
  drillActionLabel,
  drillProvenance,
  flopDeals,
  gradeDrill,
  heroOf,
  holding,
  pick,
  problem,
  sampleFlops,
  story,
  studyLink,
  TEXTURE_GROUPS,
  TURN_VIEWS,
  turnCandidates,
  turnDeals,
  turnProblem,
  turnViewLabel,
  viewLabel,
  type Candidate,
  type DealCount,
  type DrillProblem,
  type DrillStreet,
  type DrillView,
  type TextureFilter,
} from "./drills";
import { drillText } from "./copyForAi";
import { HAND_GROUPS, handLabel, isHandKey } from "./handFilter";
import { dealtFrom } from "./texture";
import { drillHint, DRILL_HINT_SOURCE } from "./hint";
import { CopyForAi, HintReveal, Kbd, REVEAL_NOTE, RevealedMix } from "./HintReveal";
import { isNextKey, optionFromKey } from "./keys";
import { LiveDrill } from "./LiveDrill";
import { PastDrills } from "./PastDrills";
import { isLiveTurnView, isRiverView, LIVE_TURN_VIEWS, liveViewLabel, RIVER_VIEWS, type LiveStreet, type LiveView } from "./liveDeal";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const isView = (v: string | null): v is DrillView => DRILL_VIEWS.includes(v as DrillView);
/** a count's flops read, at most: each is a file or two fetched */
const COUNT_FLOPS = 12;
/** under this many matching deals on the flops read, a filter is said to leave too few */
const FEW_DEALS = 20;
/** the flops a deal draws before it gives up: more where a hand filter may miss on most of them */
const TRIES = 8;
const FILTER_TRIES = 24;
/** flops looked through at a time for the hands asked for, the page answering between batches (a big spot's whole
 * range on all of its flops takes some of a second) */
const SCREEN_BATCH = 100;

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

  const spots = useMemo(() => (lib.st === "ready" ? lib.index.spots.filter(isDrillable) : []), [lib]);
  // no spot asked for (or one this library doesn't hold): any spot, a new one each hand
  const spot = spots.find((s) => s.id === params.get("spot")) ?? null;
  const street: DrillStreet | "river" = params.get("street") === "turn" ? "turn" : params.get("street") === "river" ? "river" : "flop";
  const asked = params.get("view");
  // (a turn file stores only two decisions and the rest of the turn is live; a flop drill's setting stays in the URL for coming back to the flop)
  const live: LiveView | null = street === "river" ? (isRiverView(asked) ? asked : "oop") : street === "turn" && isLiveTurnView(asked) ? asked : null;
  const stored: DrillView = street === "turn" ? (TURN_VIEWS.includes(asked as DrillView) ? (asked as DrillView) : "oop") : isView(asked) ? asked : "vsbet";
  const view = live ?? stored;
  const hand = isHandKey(params.get("hand")) ? params.get("hand") : null;
  const filter: TextureFilter = Object.fromEntries(TEXTURE_GROUPS.flatMap((g) => (params.get(g.key) ? [[g.key, params.get(g.key)!]] : [])));
  const active = TEXTURE_GROUPS.filter((g) => filter[g.key]).length + (hand ? 1 : 0);
  // the filters fold away; open from the start when the URL sets one
  const [showFilters, setShowFilters] = useState(active > 0);
  const edit = (ch: Record<string, string | null>) =>
    setParams((p) => {
      const q = new URLSearchParams(p);
      for (const [k, v] of Object.entries(ch)) {
        if (v) q.set(k, v);
        else q.delete(k);
      }
      return q;
    });
  const set = (k: string, v: string | null) => edit({ [k]: v });

  if (lib.st === "loading") return <p className="text-sm text-muted">Loading the library&rsquo;s index…</p>;
  if (lib.st === "error")
    return (
      <p role="alert" className="text-sm text-danger">
        Couldn&rsquo;t read the library: {lib.message}
      </p>
    );
  if (!spots.length) return <p className="text-sm text-muted">This library has no two-player spot to drill.</p>;
  // the drill as set, to keep (Saved): the spot named, or any spot
  const link = new URLSearchParams({ tab: "drills" });
  if (spot) {
    link.set("spot", spot.id);
    link.set("view", view);
    if (street !== "flop") link.set("street", street);
  }
  for (const g of TEXTURE_GROUPS) if (filter[g.key]) link.set(g.key, filter[g.key]!);
  if (hand) link.set("hand", hand);
  const labelOf = (st: DrillStreet | "river", v: DrillView | LiveView, seats: readonly string[]) =>
    st === "river" || (st === "turn" && LIVE_TURN_VIEWS.includes(v as LiveView)) ? liveViewLabel(st === "river" ? "river" : "turn", v as LiveView, seats) : st === "turn" ? turnViewLabel(v as DrillView, seats) : viewLabel(v as DrillView, seats);
  const about = [
    spot ? `${spot.label}${spot.game ? ` (${gameLabel(spot)})` : ""}` : "Any spot",
    ...(spot ? [labelOf(street, view, spot.seats)] : []),
    ...TEXTURE_GROUPS.flatMap((g) => (filter[g.key] ? [g.values[filter[g.key]!] ?? filter[g.key]!] : [])),
    ...(hand ? [handLabel(hand)] : []),
  ].join(" · ");
  const hasTurns = spot ? storedTurnFlops(spot).length > 0 : false;
  const select = "rounded border border-border bg-surface-2 px-1.5 py-1";
  const decisions: { street: DrillStreet | "river"; label: string; views: readonly (DrillView | LiveView)[]; off: boolean }[] = [
    { street: "flop", label: "Flop", views: DRILL_VIEWS, off: false },
    { street: "turn", label: hasTurns ? "Turn" : "Turn (none stored for this spot)", views: [...TURN_VIEWS, ...LIVE_TURN_VIEWS], off: !hasTurns },
    { street: "river", label: hasTurns ? "River (live solve)" : "River (needs this spot's stored turns)", views: RIVER_VIEWS, off: !hasTurns },
  ];

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex flex-wrap items-start gap-2">
          <form aria-label="Drill" className="flex flex-1 flex-wrap items-center gap-2 text-sm" onSubmit={(e) => e.preventDefault()}>
            <select
              aria-label="Spot"
              value={spot?.id ?? ""}
              onChange={(e) => (e.target.value ? set("spot", e.target.value) : edit({ spot: null, street: null, view: null }))}
              className={`max-w-[18rem] ${select}`}
            >
              <option value="">Any spot</option>
              {spots.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                  {s.game ? ` (${gameLabel(s)})` : ""}
                </option>
              ))}
            </select>
            {spot && (
              <select
                aria-label="Decision"
                value={`${street}|${view}`}
                onChange={(e) => {
                  const [st, v] = e.target.value.split("|");
                  edit({ street: st === "flop" ? null : st!, view: v! });
                }}
                className={`max-w-[18rem] ${select}`}
              >
                {decisions.map((d) => (
                  <optgroup key={d.street} label={d.label}>
                    {d.views.map((v) => (
                      <option key={v} value={`${d.street}|${v}`} disabled={d.off}>
                        {labelOf(d.street, v, spot.seats)}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            )}
            <button
              type="button"
              aria-expanded={showFilters}
              aria-controls="drill-filters"
              onClick={() => setShowFilters((x) => !x)}
              className={`rounded border px-2 py-1 hover:bg-surface-3 ${active ? "border-accent text-accent" : "border-border text-muted"}`}
            >
              Filters{active ? ` · ${active}` : ""} {showFilters ? "▴" : "▾"}
            </button>
          </form>
          <SaveDrill kind="library" to={`/practice?${link}`} about={about} />
        </div>
        {showFilters && (
          <div id="drill-filters" role="group" aria-label="Filters" className="flex flex-wrap items-center gap-2 rounded-md bg-surface-2 p-2 text-sm">
            {TEXTURE_GROUPS.map((g) => (
              <label key={g.key} className="flex items-center gap-1">
                <span className="text-muted">{g.label}</span>
                <select aria-label={g.label} value={filter[g.key] ?? ""} onChange={(e) => set(g.key, e.target.value || null)} className={select}>
                  <option value="">Any</option>
                  {Object.entries(g.values).map(([v, label]) => (
                    <option key={v} value={v}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            <label className="flex items-center gap-1">
              <span className="text-muted">Hands</span>
              <select aria-label="Hands" value={hand ?? ""} onChange={(e) => set("hand", e.target.value || null)} className={`max-w-[12rem] ${select}`}>
                <option value="">Any</option>
                {HAND_GROUPS.map((g) => (
                  <optgroup key={g.label} label={g.label}>
                    {g.options.map((o) => (
                      <option key={o.key} value={o.key}>
                        {o.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            {active > 0 && (
              <button type="button" onClick={() => edit({ ...Object.fromEntries(TEXTURE_GROUPS.map((g) => [g.key, null])), hand: null })} className="text-xs text-accent hover:underline">
                Clear filters
              </button>
            )}
          </div>
        )}
      </div>
      {!spot ? (
        <AnyDrill files={lib.files} spots={spots} tree={lib.index.tree} filter={filter} hand={hand} rng={rng} source={lib.label} />
      ) : live ? (
        <LiveDrill key={`${spot.id}|${street}|${view}`} files={lib.files} spot={spot} street={street as LiveStreet} view={live} filter={filter} hand={hand} rng={rng} source={lib.label} />
      ) : (
        <SpotDrill key={`${spot.id}|${street}|${view}`} files={lib.files} spot={spot} tree={lib.index.tree} street={street as DrillStreet} view={stored} filter={filter} hand={hand} rng={rng} source={lib.label} />
      )}
    </div>
  );
}

const fmtBb = (x: number) => String(Math.round(x * 100) / 100);

/** The hand up to your decision, a street a line, and a last line for where you stand: who acts, the price, the pot and
 * what you have behind. */
function HandStory({ rep, pr }: { rep: LibraryReport; pr: DrillProblem }) {
  const { steps, now } = story(rep, pr);
  return (
    <ol aria-label="The hand so far" className="space-y-1 text-sm">
      {steps.map((s) => (
        <li key={s.street} className="flex gap-3">
          <span className="w-16 shrink-0 pt-0.5 text-xs text-muted">{s.street}</span>
          <span>
            {s.pot != null && <span className="text-muted">pot {fmtBb(s.pot)}bb · </span>}
            {s.text}
          </span>
        </li>
      ))}
      <li className="flex gap-3 rounded border-l-2 border-accent bg-surface-2 py-1 pr-2">
        <span className="w-16 shrink-0 pl-2 pt-0.5 text-xs text-accent">Now</span>
        <span>
          <span className="font-medium">{now.hero} (you) to act</span>
          {now.toCall > 0 ? `, ${fmtBb(now.toCall)}bb to call` : ""} · pot {fmtBb(now.pot)}bb{now.behind != null ? ` · ${fmtBb(now.behind)}bb behind` : ""}
        </span>
      </li>
    </ol>
  );
}

/** What a hand filter leaves: the deals (a hand at a stored spot) on the flops read, said plainly when it's too few. */
function DealsLeft({ hand, of, count }: { hand: string; of: number; count: Counted | null }) {
  const label = handLabel(hand);
  if (!count) return <p className="text-xs text-muted">Counting the deals that are {label}…</p>;
  if (count.st === "failed") return <p className="text-xs text-muted">Couldn&rsquo;t count the deals that are {label}.</p>;
  const { read, c } = count;
  const where = read >= of ? `on ${of === 1 ? "the 1 flop" : `all ${of.toLocaleString()} flops`}` : `on the ${read} of ${of.toLocaleString()} flops read for this count`;
  const few = c.match < FEW_DEALS;
  return (
    <p role={few ? "status" : undefined} className={`text-xs ${few ? "text-warn" : "text-muted"}`}>
      {label}: {c.match.toLocaleString()} of {c.deals.toLocaleString()} deals match {where}
      {c.deals ? ` (${pct(c.match / c.deals, 1)})` : ""}.
      {c.match === 0 ? " None: widen a filter." : few ? " Few: hands will repeat." : ""}
    </p>
  );
}

interface DrillSession {
  id: string;
  startedAt: number;
  score: Score;
  /** how many stand on each version of the spot (a decision's grade has its own) */
  versions: Record<string, number>;
  /** picks made after Reveal: none of them is in the score */
  revealed?: number;
  /** the graded decisions by what was dealt: the texture filter's key, and "|" and the hand where one was asked for
   * (dealtFrom; "" for every flop and hand), each with how many were Best or Correct. Lessons count by it. */
  byDeal?: Record<string, { n: number; ok: number }>;
}

const newSession = (): DrillSession => ({
  id: `drill-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
  startedAt: Date.now(),
  score: emptyScore(),
  versions: {},
});

/** an any-spot session's spot and decision in its record: many of both, so neither a lesson nor a plan's drill counts it */
const ANY_SPOT = "any";

const toRecord = (s: DrillSession, spot: { id: string; label: string }, street: DrillStreet, view: string): SessionRecord => ({
  id: s.id,
  kind: "drill",
  startedAt: s.startedAt,
  endedAt: Date.now(),
  decisions: s.score.n,
  evLossBb: s.score.loss,
  meta: { spot: spot.id, label: spot.label, view, ...(street === "turn" ? { street } : {}), ok: s.score.ok, graded: s.score.ne, lossPct: s.score.lossPct, best: s.score.best, versions: s.versions, ...(s.revealed ? { revealed: s.revealed } : {}), ...(s.byDeal ? { byDeal: s.byDeal } : {}) },
});

type SpotData = { st: "loading" } | { st: "ready"; report: LibraryReport; ranges: LibraryRanges } | { st: "error"; message: string };
type Deal = { key: string } & ({ st: "dealing" } | { st: "ready"; pr: DrillProblem; entry: Entry } | { st: "none"; message: string });
/** a hand filter's count, on the flops read */
type Counted = { key: string } & ({ st: "done"; read: number; c: DealCount } | { st: "failed" });
/** the draws of a filter that can hold its hands, once looked through */
type Screened = { key: string; cands: Candidate[] };

/** A session's score, over its graded decisions. */
function ScoreBar({ session }: { session: DrillSession }) {
  const sum = summary(session.score);
  const s = session.score;
  const item = (label: string, value: string) => (
    <div className="rounded bg-surface-2 px-2 py-1">
      <div className="text-xs text-muted">{label}</div>
      <div className="font-mono">{value}</div>
    </div>
  );
  return (
    <section aria-label="Score" className="flex flex-wrap gap-2 text-sm">
      {item("Decisions", String(s.n))}
      {item("Best or correct", s.n ? pct(sum.acc, 0) : "–")}
      {item("EV lost per decision", sum.loss == null || !s.n ? "–" : `${bb(sum.loss)}bb · ${sum.lossPct!.toFixed(1)}% pot`)}
      {item("Streak", `${s.streak} (best ${s.best})`)}
      {!!session.revealed && (
        <p className="basis-full text-xs text-muted">
          {session.revealed} revealed pick{session.revealed === 1 ? "" : "s"} not graded.
        </p>
      )}
    </section>
  );
}

/** what an any-spot drill lends the spot it drew for a hand: its session, the next draw, and the screened flops so far */
interface Shared {
  session: DrillSession;
  setSession: (f: (s: DrillSession) => DrillSession) => void;
  next: () => void;
  /** the spot drawn has nothing under the filters: draw another */
  skip: () => void;
  screens: Map<string, Candidate[]>;
}

/** draws in a row with nothing under the filters before an any-spot drill says so */
const ANY_TRIES = 16;

/** Any spot: each hand a spot and a flop decision drawn afresh (the stored ones only, so each answer is there at once),
 * one score over all of them. */
function AnyDrill({ files, spots, tree, filter, hand, rng, source }: { files: LibraryFiles; spots: LibrarySpotIndex[]; tree: unknown; filter: TextureFilter; hand: string | null; rng: () => number; source: string }) {
  const [session, setSession] = useState<DrillSession>(newSession);
  const draw = useCallback(() => ({ spot: spots[Math.floor(rng() * spots.length)]!, view: DRILL_VIEWS[Math.floor(rng() * DRILL_VIEWS.length)]! }), [spots, rng]);
  const [at, setAt] = useState(draw);
  const [round, setRound] = useState(0);
  const [misses, setMisses] = useState(0);
  const [past, setPast] = useState<SessionRecord[]>([]);
  const [screens] = useState(() => new Map<string, Candidate[]>());
  // a filter changed: the draws start counting again
  const filterKey = JSON.stringify([filter, hand]);
  const [seen, setSeen] = useState(filterKey);
  if (seen !== filterKey) {
    setSeen(filterKey);
    setMisses(0);
  }
  const next = useCallback(() => {
    setMisses(0);
    setAt(draw());
    setRound((r) => r + 1);
  }, [draw]);
  const skip = useCallback(() => {
    setMisses((m) => m + 1);
    setAt(draw());
    setRound((r) => r + 1);
  }, [draw]);
  const shared = useMemo(() => ({ session, setSession, next, skip, screens }), [session, next, skip, screens]);

  useEffect(() => {
    let alive = true;
    void recentSessions("drill", 12)
      .then((xs) => alive && setPast(xs.filter((x) => x.meta.spot === ANY_SPOT).slice(0, 5)))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    if (session.score.n) void putSession(toRecord(session, { id: ANY_SPOT, label: "Any spot" }, "flop", ANY_SPOT)).catch(() => {});
  }, [session]);

  return (
    <div className="space-y-4">
      <ScoreBar session={session} />
      {misses >= ANY_TRIES ? (
        <p role="status" className="panel p-3 text-sm text-muted">
          None of {ANY_TRIES} spots drawn has a flop with these filters: widen one.{" "}
          <button type="button" className="text-accent underline" onClick={next}>
            Draw again
          </button>
        </p>
      ) : (
        <SpotDrill key={round} files={files} spot={at.spot} tree={tree} street="flop" view={at.view} filter={filter} hand={hand} rng={rng} source={source} shared={shared} />
      )}
      <PastDrills past={past} current={session.id} history="/history?kind=drill" historyLabel="Every drill session" />
    </div>
  );
}

/** One spot's decision drilled: mounted afresh (a new score) for each spot, street and decision; or, under an any-spot
 * drill (`shared`), for each hand, its score and past sessions the any-spot drill's. */
function SpotDrill({
  files,
  spot,
  tree,
  street,
  view,
  filter,
  hand,
  rng,
  source,
  shared,
}: {
  files: LibraryFiles;
  spot: LibrarySpotIndex;
  /** the index's, which a spot's own tree goes before */
  tree: unknown;
  street: DrillStreet;
  view: DrillView;
  filter: TextureFilter;
  hand: string | null;
  rng: () => number;
  source: string;
  shared?: Shared;
}) {
  const mode = useSettings((s) => s.mode);
  const [data, setData] = useState<SpotData>({ st: "loading" });
  const [own, setOwn] = useState<DrillSession>(newSession);
  const session = shared?.session ?? own;
  const setSession = shared?.setSession ?? setOwn;
  const [n, setN] = useState(0);
  const [deal, setDeal] = useState<Deal>({ key: "", st: "dealing" });
  /** your pick: `g`, null where you'd seen the answer first */
  const [answer, setAnswer] = useState<{ key: string; a: number; g: Grade | null } | null>(null);
  /** the deal whose answer you've seen */
  const [peeked, setPeeked] = useState<string | null>(null);
  const [counted, setCounted] = useState<Counted | null>(null);
  const filterKey = JSON.stringify([filter, hand]);
  const screenKey = `${spot.id}|${view}|${filterKey}`;
  // (an any-spot drill keeps what it screened, as the same spot comes round again)
  const [screened, setScreened] = useState<Screened | null>(() => {
    const kept = shared?.screens.get(screenKey);
    return kept ? { key: filterKey, cands: kept } : null;
  });
  const [past, setPast] = useState<SessionRecord[]>([]);
  const nextRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let alive = true;
    files.spot(spot).then(
      (d) => alive && setData({ st: "ready", ...d }),
      (e: unknown) => alive && setData({ st: "error", message: message(e) }),
    );
    if (!shared)
      void recentSessions("drill", 12)
        .then((xs) => alive && setPast(xs.filter((x) => x.meta.spot === spot.id && x.meta.view === view && (x.meta.street ?? "flop") === street).slice(0, 5)))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [files, spot, street, view, shared]);

  // the draws of the texture; then, on a flop, those that can hold the hands asked for (a turn's cards aren't known yet)
  const stored = useMemo(
    () => (data.st !== "ready" ? [] : street === "turn" ? turnCandidates(data.report, storedTurnFlops(spot), filter) : candidates(data.report, view, filter)),
    [data, spot, street, view, filterKey], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const screens = Boolean(hand) && street === "flop";
  const screening = screens && screened?.key !== filterKey;
  const cands = useMemo(() => (!screens ? stored : screened?.key === filterKey ? screened.cands : []), [screens, stored, screened, filterKey]);
  const dealKey = `${filterKey}|${n}`;

  useEffect(() => {
    if (data.st !== "ready" || !hand || street !== "flop" || screened?.key === filterKey) return;
    let alive = true;
    void (async () => {
      const out: Candidate[] = [];
      for (let i = 0; i < stored.length; i += SCREEN_BATCH) {
        out.push(...holding(stored.slice(i, i + SCREEN_BATCH), data.ranges, heroOf(view), hand));
        await new Promise((go) => setTimeout(go));
        if (!alive) return;
      }
      shared?.screens.set(screenKey, out);
      setScreened({ key: filterKey, cands: out });
    })();
    return () => {
      alive = false;
    };
  }, [data, stored, filterKey, hand, street, view, shared, screenKey, screened]);

  // a hand dealt: a (flop, node) drawn by weight, its entry read, a hand drawn from the range there
  useEffect(() => {
    if (data.st !== "ready" || !cands.length) return;
    let alive = true;
    void (async () => {
      try {
        const tries = hand ? FILTER_TRIES : TRIES;
        for (let i = 0; i < tries; i++) {
          const c = cands[pick(cands.map((x) => x.w), rng)]!;
          const entry = await files.entry(spot, c.f);
          const turns = street === "turn" ? await files.turns(spot, c.f) : null;
          if (!alive) return;
          const pr = turns ? turnProblem(data.report, entry, turns, view, data.ranges, rng, hand) : problem(data.report, entry, c, data.ranges, rng, hand);
          if (pr) {
            setDeal({ key: dealKey, st: "ready", pr, entry });
            return;
          }
        }
        setDeal({ key: dealKey, st: "none", message: hand ? `None of these hands on ${tries} flops drawn: widen a filter.` : "No hand found: deal again." });
      } catch (e) {
        if (alive) setDeal({ key: dealKey, st: "none", message: `Couldn't deal: ${message(e)}` });
      }
    })();
    return () => {
      alive = false;
    };
  }, [data, cands, dealKey, files, spot, street, view, hand, rng]);

  // how many deals a hand filter leaves, on a sample of the flops (a spot's every file would be hundreds of fetches)
  useEffect(() => {
    if (data.st !== "ready" || !hand || !cands.length || shared) return;
    let alive = true;
    void (async () => {
      try {
        const flops = sampleFlops(cands, COUNT_FLOPS);
        const c: DealCount = { deals: 0, match: 0 };
        for (const f of flops) {
          const entry = await files.entry(spot, f);
          const turns = street === "turn" ? await files.turns(spot, f) : null;
          if (!alive) return;
          const one = turns
            ? turnDeals(entry, turns, view, data.ranges, hand)
            : flopDeals(entry, cands.filter((x) => x.f === f).map((x) => x.path), data.ranges, hand);
          c.deals += one.deals;
          c.match += one.match;
        }
        setCounted({ key: filterKey, st: "done", read: flops.length, c });
      } catch {
        if (alive) setCounted({ key: filterKey, st: "failed" });
      }
    })();
    return () => {
      alive = false;
    };
  }, [data, cands, filterKey, files, spot, street, view, hand, shared]);

  useEffect(() => {
    if (session.score.n && !shared) void putSession(toRecord(session, spot, street, view)).catch(() => {});
  }, [session, spot, street, view, shared]);

  // under an any-spot drill, a spot with nothing under the filters is passed over
  const empty = data.st === "ready" && !screening && !cands.length;
  const skip = shared?.skip;
  useEffect(() => {
    if (empty) skip?.();
  }, [empty, skip]);

  const shown: Deal = deal.key === dealKey ? deal : { key: dealKey, st: "dealing" };
  const pr = shown.st === "ready" ? shown.pr : null;
  const graded = answer && answer.key === dealKey ? answer : null;

  const choose = useCallback(
    (a: number) => {
      if (!pr || graded) return;
      if (peeked === dealKey) {
        setAnswer({ key: dealKey, a, g: null });
        setSession((s) => ({ ...s, revealed: (s.revealed ?? 0) + 1 }));
        return;
      }
      const g = gradeDrill(pr, a);
      setAnswer({ key: dealKey, a, g });
      const version = spotStamp(spot, tree, pr.flop);
      const dk = dealtFrom(filter, hand);
      setSession((s) => {
        const was = s.byDeal?.[dk] ?? { n: 0, ok: 0 };
        return { ...s, score: addScore(s.score, g), versions: addVersion(s.versions, version), byDeal: { ...s.byDeal, [dk]: { n: was.n + 1, ok: was.ok + (g.ok ? 1 : 0) } } };
      });
      if (deal.st === "ready" && data.st === "ready") {
        const m = drillMistake(session.id, data.report, pr, g, drillProvenance(deal.entry, mode, pr, version), studyLink(data.report, pr), spot.flops[pr.flop], Date.now());
        if (m) void keepMistake(m, missedAgain).catch(() => {});
      }
    },
    [pr, graded, peeked, dealKey, deal, data, mode, session.id, spot, tree, filter, hand, setSession],
  );
  const sharedNext = shared?.next;
  const next = useCallback(() => (sharedNext ? sharedNext() : setN((x) => x + 1)), [sharedNext]);

  // once answered, the next hand is a key away
  useEffect(() => {
    if (graded) nextRef.current?.focus();
  }, [graded]);

  // The keys read the hand on the screen through a ref set as it commits: an effect re-bound after paint left a key pressed
  // straight after the next deal showed with the last hand's handler, which took it as nothing (CI caught it on 2026-11-10).
  const keyState = useRef({ pr, graded, choose, next });
  useLayoutEffect(() => {
    keyState.current = { pr, graded, choose, next };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { pr, graded, choose, next } = keyState.current;
      const tag = (e.target as HTMLElement | null)?.tagName ?? "";
      if (e.metaKey || e.ctrlKey || e.altKey || /^(INPUT|SELECT|TEXTAREA)$/.test(tag)) return;
      if (e.repeat) return;
      // (keys.ts: by place or by what the option is)
      const i = pr && !graded ? optionFromKey(e.key, pr.names) : -1;
      if (i >= 0) choose(i);
      // (Enter or Space on a focused button or link is that control's own)
      else if (graded && isNextKey(e.key) && (e.key.toLowerCase() === "n" || !/^(BUTTON|A)$/.test(tag))) {
        e.preventDefault();
        next();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (shared && (data.st === "loading" || empty)) return <p className="panel p-3 text-sm text-muted">Dealing…</p>;
  if (data.st === "loading") return <p className="text-sm text-muted">Loading {spot.label}…</p>;
  if (data.st === "error")
    return (
      <p role="alert" className="text-sm text-danger">
        Couldn&rsquo;t load the spot: {data.message}
      </p>
    );

  const rep = data.report;
  const flops = Object.keys(spot.flops).length;
  const storing = new Set(stored.map((c) => c.f)).size;
  const able = new Set(cands.map((c) => c.f)).size;
  const filtered = Object.values(filter).some(Boolean);
  const texture = filtered ? " with this texture" : "";
  const count = hand && counted?.key === filterKey ? counted : null;
  const link = pr ? studyLink(rep, pr) : null;

  return (
    <div className="space-y-4">
      {/* (what the filters leave, said only under one) */}
      {!shared && (filtered || hand) && (
        <p className="text-xs text-muted">
          {spot.label} in {source}: {flops.toLocaleString()} flops stored; {storing.toLocaleString()} store {street === "turn" ? "their turns" : "this decision"}
          {texture}
          {screens && !screening ? `, and ${able.toLocaleString()} of them can hold ${handLabel(hand!)}` : ""}.
        </p>
      )}
      {!shared && hand && cands.length > 0 && <DealsLeft hand={hand} of={able} count={count} />}

      {!shared && <ScoreBar session={session} />}

      {/* (wide: the hand on the left, its answer on the right once you've picked) */}
      <div className="space-y-4 lg:grid lg:grid-cols-2 lg:items-start lg:gap-4 lg:space-y-0">
      <section aria-label="Your hand" className="space-y-3 panel p-3">
        {screening ? (
          <p className="text-sm text-muted">Looking for flops that can hold {handLabel(hand!)}…</p>
        ) : !cands.length ? (
          <p role="status" className="text-sm text-muted">
            {stored.length
              ? `No flop here can hold ${handLabel(hand!)}${filtered ? " with that texture" : ""}: widen a filter.`
              : street === "turn"
                ? `${spot.label} stores no turn${filtered ? " with that texture: widen the filter" : " in this library: pick another spot, or the flop"}.`
                : `No flop in this spot stores this decision${filtered ? " with that texture: widen the filter" : ""}.`}
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
            {shared && (
              <p className="text-xs text-muted">
                {spot.label}
                {spot.game ? ` (${gameLabel(spot)})` : ""} · {viewLabel(view, spot.seats)}
              </p>
            )}
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
            <HandStory rep={rep} pr={shown.pr} />
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
            {!graded && (
              <HintReveal
                key={dealKey}
                keys
                hint={() => drillHint(shown.pr)}
                source={DRILL_HINT_SOURCE}
                onReveal={() => setPeeked(dealKey)}
                revealed={
                  peeked === dealKey ? (
                    <RevealedMix mix={drillMix(shown.pr)} provenance={drillProvenance(shown.entry, mode, shown.pr, spotStamp(spot, tree, shown.pr.flop))} labelOf={(a) => drillActionLabel(shown.pr, a.action)} note={REVEAL_NOTE} />
                  ) : null
                }
              />
            )}
          </>
        )}
      </section>

      {pr && graded && shown.st === "ready" && (
        <section aria-label="Answer" className="space-y-2 panel p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            {graded.g ? <VerdictTag v={graded.g.verdict} /> : <span className="text-xs text-muted">Not graded: revealed</span>}
            <span>
              you took <span className="font-mono">{drillActionLabel(pr, pr.names[graded.a]!)}</span>
              {graded.g && graded.g.a !== graded.g.best && (
                <>
                  ; the best was <span className="font-mono">{drillActionLabel(pr, pr.names[graded.g.best]!)}</span>
                </>
              )}
            </span>
            <ProvenanceBadge p={drillProvenance(shown.entry, mode, pr, spotStamp(spot, tree, pr.flop))} />
          </div>
          {graded.g ? (
            <>
              <p>
                {whyText(
                  graded.g,
                  pr.names.map((n) => drillActionLabel(pr, n)),
                  pr.freqs,
                )}
              </p>
              <p className="text-muted">
                {!graded.g.byEv
                  ? "Graded by frequency: no EV stored."
                  : graded.g.loss > 0
                    ? `EV given up: ${bb(graded.g.loss)}bb, ${graded.g.lossPct.toFixed(1)}% of the ${bb(pr.pot)}bb pot.`
                    : "No EV given up."}
                {graded.g.mixed && " This hand mixes actions here."}
              </p>
            </>
          ) : (
            <p role="status" className="text-muted">
              {REVEAL_NOTE}
            </p>
          )}
          <table className="w-full max-w-md text-left text-xs">
            <thead className="text-muted">
              <tr>
                <th className="py-0.5 font-normal">Action</th>
                <th className="py-0.5 text-right font-normal">Played</th>
                {pr.evs ? <th className="py-0.5 text-right font-normal">EV bb</th> : pr.turn?.rangeEvs && <th className="py-0.5 text-right font-normal">Range&rsquo;s EV bb</th>}
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
                  {pr.evs ? <td className="py-0.5 text-right">{bb(pr.evs[i])}</td> : pr.turn?.rangeEvs && <td className="py-0.5 text-right">{pr.turn.rangeEvs[i] == null ? "–" : bb(pr.turn.rangeEvs[i]!)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-muted">
            Stored for {pr.flop}
            {pr.turn ? ` ${pr.turn.card}` : ""}, shown in other suits.
          </p>
          {graded.g && <CopyForAi key={dealKey} text={() => drillText(rep, pr, graded.g!, drillProvenance(shown.entry, mode, pr, spotStamp(spot, tree, pr.flop)))} />}
          <div className="flex flex-wrap items-center gap-3">
            <button ref={nextRef} type="button" onClick={next} className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-bg hover:bg-accent-strong">
              Next hand
              <Kbd>N</Kbd>
            </button>
            {link && (
              <Link to={link} className="text-accent hover:underline">
                Open in Study →
              </Link>
            )}
          </div>
        </section>
      )}
      </div>


      {!shared && <PastDrills past={past} current={session.id} history="/history?kind=drill" historyLabel="Every drill session" />}
    </div>
  );
}
