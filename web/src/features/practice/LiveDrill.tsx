// A live drill: one decision no file stores, dealt hand after hand from a spot's stored turns and answered by a live
// solve while you wait (liveDeal.ts). The cards and the spot come first, the options with the answer. Where the answer
// can't grade the spot it's said in words and dealt again, with nothing scored. Kept apart from the stored drills, which
// answer at once and read no solver.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { PlayingCard } from "@/components/PlayingCard";
import { ProvenanceBadge } from "@/components/ProvenanceBadge";
import { VerdictTag } from "@/components/VerdictTag";
import { bb, pct } from "@/components/actions";
import { putSession, recentSessions, type SessionRecord } from "@/data/db";
import { keepMistake } from "@/data/mistakes";
import { missedAgain } from "@/features/review/mistakes";
import { CAPPED_WORDS, summary, whoOf, whyText, type Grade } from "@/grading/grade";
import { storedTurnFlops, type LibrarySpotIndex } from "@/library/catalog";
import type { LibraryRanges } from "@/library/entry";
import type { LibraryFiles, LibraryReport } from "@/library/files";
import { evUnit } from "@/solver/provenance";
import { SolverError } from "@/solver/types";
import { useSolver } from "@/solver/useSolver";
import { useSettings } from "@/state/settings";
import { liveDrillText } from "./copyForAi";
import { pick, turnCandidates, type TextureFilter } from "./drills";
import { PastDrills } from "./PastDrills";
import { liveHint, LIVE_HINT_SOURCE } from "./hint";
import { CopyForAi, HintReveal, Kbd, MixTable, REVEAL_NOTE, RevealedMix } from "./HintReveal";
import { isNextKey, optionFromKey } from "./keys";
import { afterLive, freshLiveSession, gradeLive, liveActionLabel, liveMistake, liveMode, liveDrillKey, liveProblem, liveRecord, liveStudyLink, readLive, type LiveAnswer, type LiveProblem, type LiveSession, type LiveStreet, type LiveView } from "./liveDeal";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
/** the flops a deal draws before it gives up: more where a hand filter may miss on most of them */
const TRIES = 8;
const FILTER_TRIES = 24;

type SpotData = { st: "loading" } | { st: "ready"; report: LibraryReport; ranges: LibraryRanges } | { st: "error"; message: string };
type Deal = { key: string } & ({ st: "ready"; pr: LiveProblem } | { st: "none"; message: string });
type Solved = { key: string } & ({ st: "answer"; answer: LiveAnswer } | { st: "refused"; words: string });
type Picked = { key: string; a: number; g: Grade | null };

/** One spot's live decision drilled: mounted afresh (a new score) for each spot, street and decision. */
export function LiveDrill({ files, spot, street, view, filter, hand, rng, source }: { files: LibraryFiles; spot: LibrarySpotIndex; street: LiveStreet; view: LiveView; filter: TextureFilter; hand: string | null; rng: () => number; source: string }) {
  const mode = useSettings((s) => s.mode);
  const getSolver = useSolver();
  const [data, setData] = useState<SpotData>({ st: "loading" });
  const [session, setSession] = useState<LiveSession>(freshLiveSession);
  const [n, setN] = useState(0);
  const [deal, setDeal] = useState<Deal | null>(null);
  const [solved, setSolved] = useState<Solved | null>(null);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [peeked, setPeeked] = useState<string | null>(null);
  const nextRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let alive = true;
    files.spot(spot).then(
      (d) => alive && setData({ st: "ready", ...d }),
      (e: unknown) => alive && setData({ st: "error", message: message(e) }),
    );
    return () => {
      alive = false;
    };
  }, [files, spot]);

  const filterKey = JSON.stringify([filter, hand]);
  const cands = useMemo(
    () => (data.st === "ready" ? turnCandidates(data.report, storedTurnFlops(spot), filter) : []),
    [data, spot, filterKey], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const dealKey = `${filterKey}|${n}`;
  const noDraws = street === "river" && !!hand?.startsWith("d:");

  // a flop drawn by weight, its entry and turn file read, a spot and a hand dealt on them
  useEffect(() => {
    if (data.st !== "ready" || !cands.length || noDraws) return;
    let alive = true;
    void (async () => {
      try {
        const tries = hand ? FILTER_TRIES : TRIES;
        for (let i = 0; i < tries; i++) {
          const c = cands[pick(cands.map((x) => x.w), rng)]!;
          const entry = await files.entry(spot, c.f);
          const turns = await files.turns(spot, c.f);
          if (!alive) return;
          const pr = liveProblem(data.report, entry, turns, street, view, data.ranges, rng, hand);
          if (pr) {
            setDeal({ key: dealKey, st: "ready", pr });
            return;
          }
        }
        setDeal({ key: dealKey, st: "none", message: hand ? `None of these hands on ${tries} flops drawn: widen a filter.` : "No stored line reaches this decision: deal again." });
      } catch (e) {
        if (alive) setDeal({ key: dealKey, st: "none", message: `Couldn't deal: ${message(e)}` });
      }
    })();
    return () => {
      alive = false;
    };
  }, [data, cands, dealKey, files, spot, street, view, hand, rng, noDraws]);

  const shown = deal?.key === dealKey ? deal : null;
  const pr = shown?.st === "ready" ? shown.pr : null;

  // the live solve of what's dealt, dropped if you've moved on
  useEffect(() => {
    if (!pr) return;
    let alive = true;
    const ctl = new AbortController();
    void (async () => {
      try {
        const client = await getSolver();
        const res = await client.solve({ state: pr.state, mode: liveMode(mode), signal: ctl.signal });
        if (alive) setSolved({ key: dealKey, ...readLive(res, pr) });
      } catch (e) {
        if (alive && !(e instanceof SolverError && e.kind === "cancelled")) setSolved({ key: dealKey, st: "refused", words: `The solver couldn't answer this spot: ${message(e)}` });
      }
    })();
    return () => {
      alive = false;
      ctl.abort();
    };
  }, [pr, dealKey, getSolver, mode]);

  const told = solved?.key === dealKey ? solved : null;
  const answer = told?.st === "answer" ? told.answer : null;
  const graded = picked?.key === dealKey ? picked : null;

  const drillKey = liveDrillKey(spot.id, street, view);
  useEffect(() => {
    if (session.score.n && data.st === "ready") void putSession(liveRecord(session, data.report, spot.seats[view === "ip" || view === "ipfaces" ? 1 : 0]!, drillKey)).catch(() => {});
  }, [session, data, spot, view, drillKey]);

  // this drill's earlier sessions, read once as it opens (this one's own is left out as it's kept)
  const [past, setPast] = useState<SessionRecord[]>([]);
  useEffect(() => {
    let alive = true;
    void recentSessions("practice", 60)
      .then((xs) => alive && setPast(xs.filter((x) => x.meta.liveDrill === drillKey).slice(0, 6)))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [drillKey]);

  const choose = useCallback(
    (a: number) => {
      if (!pr || !answer || graded || data.st !== "ready") return;
      if (peeked === dealKey) {
        setPicked({ key: dealKey, a, g: null });
        setSession((s) => ({ ...s, revealed: (s.revealed ?? 0) + 1 }));
        return;
      }
      const g = gradeLive(answer, a);
      setPicked({ key: dealKey, a, g });
      setSession((s) => afterLive(s, pr, g, answer.provenance));
      const m = liveMistake(session.id, data.report, pr, answer, g, Date.now());
      if (m) void keepMistake(m, missedAgain).catch(() => {});
    },
    [pr, answer, graded, data, peeked, dealKey, session.id],
  );
  const next = useCallback(() => setN((x) => x + 1), []);

  useEffect(() => {
    if (graded) nextRef.current?.focus();
  }, [graded]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName ?? "";
      if (e.metaKey || e.ctrlKey || e.altKey || /^(INPUT|SELECT|TEXTAREA)$/.test(tag)) return;
      if (e.repeat) return;
      // (keys.ts: by place or by what the option is)
      const i = answer && !graded ? optionFromKey(e.key, answer.mix.map((a) => a.action)) : -1;
      if (i >= 0) choose(i);
      else if ((graded || told?.st === "refused") && isNextKey(e.key) && (e.key.toLowerCase() === "n" || !/^(BUTTON|A)$/.test(tag))) {
        e.preventDefault();
        next();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [answer, graded, told, choose, next]);

  if (data.st === "loading") return <p className="text-sm text-muted">Loading {spot.label}…</p>;
  if (data.st === "error")
    return (
      <p role="alert" className="text-sm text-danger">
        Couldn&rsquo;t load the spot: {data.message}
      </p>
    );

  const rep = data.report;
  const filtered = Object.values(filter).some(Boolean);
  const sum = summary(session.score);
  const s = session.score;
  const item = (label: string, value: string) => (
    <div className="rounded bg-surface-2 px-2 py-1">
      <div className="text-xs text-muted">{label}</div>
      <div className="font-mono">{value}</div>
    </div>
  );
  const label = (row: LiveAnswer["mix"][number]) => (answer ? liveActionLabel(answer, row) : row.action);
  const link = pr ? liveStudyLink(rep, pr) : null;
  const hasEv = !!answer?.mix.every((a) => a.ev !== null);

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted">
        {spot.label} in {source}: {new Set(cands.map((c) => c.f)).size.toLocaleString()} flops with stored turns{filtered ? " and this texture" : ""}. Each hand is a live solve (some seconds).
        {street === "river" ? " Rivers only after a checked turn." : ""}
      </p>

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

      {/* (wide: the hand on the left, its answer on the right once you've picked) */}
      <div className="space-y-4 lg:grid lg:grid-cols-2 lg:items-start lg:gap-4 lg:space-y-0">
      <section aria-label="Your hand" className="space-y-3 panel p-3">
        {noDraws ? (
          <p role="status" className="text-sm text-muted">
            No river draws: pick a made hand or class.
          </p>
        ) : !cands.length ? (
          <p role="status" className="text-sm text-muted">
            {spot.label} stores no turn{filtered ? " with that texture: widen the filter" : ": pick another spot"}.
          </p>
        ) : !shown ? (
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
            <p className="text-sm">{shown.pr.words}</p>
            {told?.st === "refused" ? (
              <p role="alert" className="text-sm text-danger">
                {told.words} Nothing was scored.{" "}
                <button type="button" className="underline" onClick={next}>
                  Deal again
                </button>
              </p>
            ) : !answer ? (
              <p role="status" className="text-sm text-muted">
                Solving this spot live…
              </p>
            ) : (
              <div role="group" aria-label="Your options" className="flex flex-wrap gap-2">
                {answer.mix.map((row, i) => (
                  <button
                    key={row.action}
                    type="button"
                    disabled={Boolean(graded)}
                    aria-pressed={graded ? graded.a === i : undefined}
                    onClick={() => choose(i)}
                    className={`rounded-md border px-3 py-1.5 text-sm hover:bg-surface-3 disabled:cursor-default ${graded?.a === i ? "border-accent bg-surface-3" : "border-border bg-surface-2"}`}
                  >
                    <span aria-hidden className="mr-1.5 text-xs text-faint">
                      {i + 1}
                    </span>
                    {label(row)}
                  </button>
                ))}
              </div>
            )}
            {!graded && told?.st !== "refused" && (
              <HintReveal
                key={dealKey}
                keys
                hint={() => liveHint(shown.pr)}
                source={LIVE_HINT_SOURCE}
                onReveal={answer ? () => setPeeked(dealKey) : null}
                revealed={answer && peeked === dealKey ? <RevealedMix mix={answer.mix} provenance={answer.provenance} labelOf={label} note={REVEAL_NOTE} /> : null}
              />
            )}
          </>
        )}
      </section>

      {pr && answer && graded && (
        <section aria-label="Answer" className="space-y-2 panel p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            {graded.g ? <VerdictTag v={graded.g.verdict} /> : <span className="text-xs text-muted">Not graded: revealed</span>}
            <span>
              you took <span className="font-mono">{label(answer.mix[graded.a]!)}</span>
              {graded.g && graded.g.a !== graded.g.best && (
                <>
                  ; the best was <span className="font-mono">{label(answer.mix[graded.g.best]!)}</span>
                </>
              )}
            </span>
            <ProvenanceBadge p={answer.provenance} />
          </div>
          {graded.g ? (
            <>
              <p>
                {whyText(
                  graded.g,
                  answer.mix.map(label),
                  answer.mix.map((a) => a.freq),
                  whoOf(answer.provenance.source),
                )}
              </p>
              <p className="text-muted">
                {graded.g.loss > 0 ? `EV given up: ${bb(graded.g.loss)}bb, ${graded.g.lossPct.toFixed(1)}% of the ${bb(answer.pot)}bb pot.` : "No EV given up."}
                {graded.g.mixed && " This hand mixes actions here."}
                {graded.g.capped && ` ${CAPPED_WORDS}`}
              </p>
            </>
          ) : (
            <p role="status" className="text-muted">
              {REVEAL_NOTE}
            </p>
          )}
          {answer.off && <p className="text-warn">Off the solve here: {answer.off}.</p>}
          <MixTable mix={answer.mix} hasEv={hasEv} labelOf={label} chose={answer.mix[graded.a]!.action} unit={evUnit(answer.provenance)} />
          <p className="text-xs text-muted">
            {pr.flop} {pr.cards.join(" ")} shown in other suits.
          </p>
          {graded.g && <CopyForAi key={dealKey} text={() => liveDrillText(rep, pr, graded.g!, answer)} />}
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


      <PastDrills past={past} current={session.id} history="/history?kind=practice" historyLabel="Every Practice session" />
    </div>
  );
}
