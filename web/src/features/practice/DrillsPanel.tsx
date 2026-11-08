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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { addScore, emptyScore, GRADE_RULES, summary, whyText, type Grade, type Score } from "@/grading/grade";
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
  situation,
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
import { drillHint, DRILL_HINT_SOURCE } from "./hint";
import { CopyForAi, HintReveal, REVEAL_NOTE, RevealedMix } from "./HintReveal";
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
  const spot = spots.find((s) => s.id === params.get("spot")) ?? spots[0];
  const street: DrillStreet | "river" = params.get("street") === "turn" ? "turn" : params.get("street") === "river" ? "river" : "flop";
  const asked = params.get("view");
  // (a turn file stores only two decisions and the rest of the turn is live; a flop drill's setting stays in the URL for coming back to the flop)
  const live: LiveView | null = street === "river" ? (isRiverView(asked) ? asked : "oop") : street === "turn" && isLiveTurnView(asked) ? asked : null;
  const stored: DrillView = street === "turn" ? (TURN_VIEWS.includes(asked as DrillView) ? (asked as DrillView) : "oop") : isView(asked) ? asked : "vsbet";
  const view = live ?? stored;
  const hand = isHandKey(params.get("hand")) ? params.get("hand") : null;
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
  if (street !== "flop") link.set("street", street);
  for (const g of TEXTURE_GROUPS) if (filter[g.key]) link.set(g.key, filter[g.key]!);
  if (hand) link.set("hand", hand);
  const labelOf = (v: DrillView | LiveView) =>
    street === "river" || LIVE_TURN_VIEWS.includes(v as LiveView) ? liveViewLabel(street === "river" ? "river" : "turn", v as LiveView, spot.seats) : street === "turn" ? turnViewLabel(v as DrillView, spot.seats) : viewLabel(v as DrillView, spot.seats);
  const about = [
    `${spot.label}${spot.game ? ` (${gameLabel(spot)})` : ""}`,
    labelOf(view),
    ...TEXTURE_GROUPS.flatMap((g) => (filter[g.key] ? [g.values[filter[g.key]!] ?? filter[g.key]!] : [])),
    ...(hand ? [handLabel(hand)] : []),
  ].join(" · ");
  const hasTurns = storedTurnFlops(spot).length > 0;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        {live ? "One decision, dealt again and again from the library's stored lines and answered by a live solve while you wait." : "One decision, dealt again and again from the precomputed library: answered at once, with no solve."} The flop is drawn by how often it comes up, your
        hand by how often you&rsquo;d hold it here, among the hands you ask for. Keys: 1&ndash;9 answer, Enter or Space for the next hand.
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
            <span className="text-muted">Street</span>
            <select aria-label="Street" value={street} onChange={(e) => set("street", e.target.value === "flop" ? null : e.target.value)} className="rounded border border-border bg-surface-2 px-1.5 py-1">
              <option value="flop">Flop</option>
              <option value="turn" disabled={!hasTurns}>
                {hasTurns ? "Turn" : "Turn (none stored for this spot)"}
              </option>
              <option value="river" disabled={!hasTurns}>
                {hasTurns ? "River (live solve)" : "River (needs this spot's stored turns)"}
              </option>
            </select>
          </label>
          <label className="flex items-center gap-1">
            <span className="text-muted">Decision</span>
            <select aria-label="Decision" value={view} onChange={(e) => set("view", e.target.value)} className="max-w-[16rem] rounded border border-border bg-surface-2 px-1.5 py-1">
              {(street === "river" ? RIVER_VIEWS : street === "turn" ? [...TURN_VIEWS, ...LIVE_TURN_VIEWS] : DRILL_VIEWS).map((v) => (
                <option key={v} value={v}>
                  {labelOf(v)}
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
          <label className="flex items-center gap-1">
            <span className="text-muted">Hands</span>
            <select aria-label="Hands" value={hand ?? ""} onChange={(e) => set("hand", e.target.value || null)} className="max-w-[12rem] rounded border border-border bg-surface-2 px-1.5 py-1">
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
        </form>
        <SaveDrill kind="library" to={`/practice?${link}`} about={about} />
      </div>
      {live ? (
        <LiveDrill key={`${spot.id}|${street}|${view}`} files={lib.files} spot={spot} street={street as LiveStreet} view={live} filter={filter} hand={hand} rng={rng} source={lib.label} />
      ) : (
        <SpotDrill key={`${spot.id}|${street}|${view}`} files={lib.files} spot={spot} tree={lib.index.tree} street={street as DrillStreet} view={stored} filter={filter} hand={hand} rng={rng} source={lib.label} />
      )}
    </div>
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
      {c.match === 0 ? " None to deal here: widen a filter." : few ? " Too few: the same hands will keep coming back. Widen a filter for more." : ""}
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
}

const toRecord = (s: DrillSession, spot: LibrarySpotIndex, street: DrillStreet, view: DrillView): SessionRecord => ({
  id: s.id,
  kind: "drill",
  startedAt: s.startedAt,
  endedAt: Date.now(),
  decisions: s.score.n,
  evLossBb: s.score.loss,
  meta: { spot: spot.id, label: spot.label, view, ...(street === "turn" ? { street } : {}), ok: s.score.ok, graded: s.score.ne, lossPct: s.score.lossPct, best: s.score.best, versions: s.versions, ...(s.revealed ? { revealed: s.revealed } : {}) },
});

type SpotData = { st: "loading" } | { st: "ready"; report: LibraryReport; ranges: LibraryRanges } | { st: "error"; message: string };
type Deal = { key: string } & ({ st: "dealing" } | { st: "ready"; pr: DrillProblem; entry: Entry } | { st: "none"; message: string });
/** a hand filter's count, on the flops read */
type Counted = { key: string } & ({ st: "done"; read: number; c: DealCount } | { st: "failed" });
/** the draws of a filter that can hold its hands, once looked through */
type Screened = { key: string; cands: Candidate[] };

/** One spot's decision drilled: mounted afresh (a new score) for each spot, street and decision. */
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
}) {
  const mode = useSettings((s) => s.mode);
  const [data, setData] = useState<SpotData>({ st: "loading" });
  const [session, setSession] = useState<DrillSession>(() => ({
    id: `drill-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
    startedAt: Date.now(),
    score: emptyScore(),
    versions: {},
  }));
  const [n, setN] = useState(0);
  const [deal, setDeal] = useState<Deal>({ key: "", st: "dealing" });
  /** your pick: `g`, null where you'd seen the answer first */
  const [answer, setAnswer] = useState<{ key: string; a: number; g: Grade | null } | null>(null);
  /** the deal whose answer you've seen */
  const [peeked, setPeeked] = useState<string | null>(null);
  const [counted, setCounted] = useState<Counted | null>(null);
  const [screened, setScreened] = useState<Screened | null>(null);
  const [past, setPast] = useState<SessionRecord[]>([]);
  const nextRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let alive = true;
    files.spot(spot).then(
      (d) => alive && setData({ st: "ready", ...d }),
      (e: unknown) => alive && setData({ st: "error", message: message(e) }),
    );
    void recentSessions("drill", 12)
      .then((xs) => alive && setPast(xs.filter((x) => x.meta.spot === spot.id && x.meta.view === view && (x.meta.street ?? "flop") === street).slice(0, 5)))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [files, spot, street, view]);

  const filterKey = JSON.stringify([filter, hand]);
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
    if (data.st !== "ready" || !hand || street !== "flop") return;
    let alive = true;
    void (async () => {
      const out: Candidate[] = [];
      for (let i = 0; i < stored.length; i += SCREEN_BATCH) {
        out.push(...holding(stored.slice(i, i + SCREEN_BATCH), data.ranges, heroOf(view), hand));
        await new Promise((go) => setTimeout(go));
        if (!alive) return;
      }
      setScreened({ key: filterKey, cands: out });
    })();
    return () => {
      alive = false;
    };
  }, [data, stored, filterKey, hand, street, view]);

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
        setDeal({ key: dealKey, st: "none", message: hand ? `No hand of this kind reached this decision on the ${tries} flops drawn: widen a filter, or deal again.` : "No hand was found at the drawn spots: deal again." });
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
    if (data.st !== "ready" || !hand || !cands.length) return;
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
  }, [data, cands, filterKey, files, spot, street, view, hand]);

  useEffect(() => {
    if (session.score.n) void putSession(toRecord(session, spot, street, view)).catch(() => {});
  }, [session, spot, street, view]);

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
      setSession((s) => ({ ...s, score: addScore(s.score, g), versions: addVersion(s.versions, version) }));
      if (deal.st === "ready" && data.st === "ready") {
        const m = drillMistake(session.id, data.report, pr, g, drillProvenance(deal.entry, mode, pr, version), studyLink(data.report, pr), spot.flops[pr.flop], Date.now());
        if (m) void keepMistake(m, missedAgain).catch(() => {});
      }
    },
    [pr, graded, peeked, dealKey, deal, data, mode, session.id, spot, tree],
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
  const storing = new Set(stored.map((c) => c.f)).size;
  const able = new Set(cands.map((c) => c.f)).size;
  const filtered = Object.values(filter).some(Boolean);
  const texture = filtered ? " with this texture" : "";
  const count = hand && counted?.key === filterKey ? counted : null;
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
        {spot.label} in {source}: {flops.toLocaleString()} flops stored; {storing.toLocaleString()} store {street === "turn" ? "their turns" : "this decision"}
        {texture}
        {screens && !screening ? `, and ${able.toLocaleString()} of them can hold ${handLabel(hand!)}` : ""}.
      </p>
      {hand && cands.length > 0 && <DealsLeft hand={hand} of={able} count={count} />}
      {street === "turn" && (
        <p className="text-xs text-muted">
          Only the turn cards the stored flop solve played are dealt, on the flop lines it stored. A turn file stores a mix for your hand, in 5% steps, but no EV for it, so a turn is graded by that
          mix alone and no EV lost is counted. A bet to face on the turn and the river are live drills.
        </p>
      )}

      <section aria-label="Score" className="flex flex-wrap gap-2 text-sm">
        {item("Decisions", String(s.n))}
        {item("Best or correct", s.n ? pct(sum.acc, 0) : "–")}
        {item("EV lost per decision", sum.loss == null || !s.n ? "–" : `${bb(sum.loss)}bb · ${sum.lossPct!.toFixed(1)}% pot`)}
        {item("Streak", `${s.streak} (best ${s.best})`)}
        {!!session.revealed && (
          <p className="basis-full text-xs text-muted">
            {session.revealed} pick{session.revealed === 1 ? "" : "s"} made after Reveal, not in these numbers.
          </p>
        )}
      </section>

      <section aria-label="Your hand" className="space-y-3 rounded-lg border border-border bg-surface p-3">
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
            {!graded && (
              <HintReveal
                key={dealKey}
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
        <section aria-label="Answer" className="space-y-2 rounded-lg border border-border bg-surface p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            {graded.g ? <VerdictTag v={graded.g.verdict} /> : <span className="text-xs text-muted">Not graded: you revealed the answer first</span>}
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
                  ? "Graded by how often your hand plays each action: no EV is stored for it, so none is counted as lost."
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
          <table className="w-full max-w-md text-left font-mono text-xs">
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
            {pr.turn
              ? `Your hand's frequencies at this node, as stored for the flop ${pr.flop} and the turn ${pr.turn.card} (shown in other suits).${pr.turn.rangeEvs ? " The range's EV is what the hands of your range that take the action make on average, against folding now: not your hand's, and not what's graded." : ""}`
              : `Your hand's frequencies and EVs at this node, as stored for the flop ${pr.flop} (shown in other suits).`}
          </p>
          {graded.g && <CopyForAi key={dealKey} text={() => drillText(rep, pr, graded.g!, drillProvenance(shown.entry, mode, pr, spotStamp(spot, tree, pr.flop)))} />}
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
        <p className="mt-2 text-muted">
          {street === "turn"
            ? "A turn is graded by the rules' \"without EVs\" parts: no EV is stored for your hand there."
            : "The EVs are the stored solve\u2019s, kept in steps of 1% of the pot (coarser for actions far below the best)."}
        </p>
      </details>

      <PastDrills past={past} current={session.id} history="/history?kind=drill" historyLabel="Every drill session" />
    </div>
  );
}
