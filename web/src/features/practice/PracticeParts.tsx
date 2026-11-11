// The parts of Practice's full hands: the score, a seat, chips carried, your moves where a spot has no answer, your
// last decision and your range at it, the hand's log, keeping a hand, and Review mistakes with stepping back through
// your decisions. Each draws what it's given: the hand and the session stay with the page. And the keys' rules, which
// each view of the hand keeps.
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { PlayingCard } from "@/components/PlayingCard";
import { ProvenanceBadge } from "@/components/ProvenanceBadge";
import { VerdictTag } from "@/components/VerdictTag";
import { actionFills, bb, pct } from "@/components/actions";
import { RangeMatrix } from "@/components/RangeMatrix";
import { cellWays, GRADE_WAYS, sourcesText, WAY_HEADS, wayFigures } from "@/features/history/history";
import { whoOf, whyText } from "@/grading/grade";
import { seatLabel } from "@/poker/seats";
import { behind, legal, type Sim } from "@/poker/table";
import type { GetClient } from "@/features/review/retry";
import { describe as describeProvenance, evUnit, sourceLabel } from "@/solver/provenance";
import type { Provenance, StopCost } from "@/solver/types";
import { useSettings } from "@/state/settings";
import { ASK_AHEAD, meterLine, type AheadMeter } from "./ahead";
import { reviewedText } from "./copyForAi";
import { exploitNote } from "./exploit";

const many = (n: number, one: string) => `${n.toLocaleString()} ${one}${n === 1 ? "" : "s"}`;
import { pfWords } from "./pfGrade";
import { CopyForAi, Kbd, MixTable, REVEAL_NOTE } from "./HintReveal";
import { chipsAfter, optionLabel, runEnd, setupOf, shownCards, simOf, type Decision, type HandTournament, type PracticeHand, type RangeAt } from "./practice";
import { mistakes, recent, type Reviewed } from "./review";
import { LEVEL_HANDS, leftOf, levelOf } from "./tournamentPlay";
import { sessionUnit, type Kept, type PracticeSession } from "./session";
import { retrySpot, SessionRetry } from "./SessionRetry";

export const fmt = (x: number) => String(Math.round(x * 100) / 100);
export { optionLabel };
export const signed = (x: number) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${fmt(Math.abs(x))}`;

/** Keys for a view of the hand while its tab is shown, `tag` being what's focused (the latest handler, read through a ref:
 * the listener stays, and it's set as the page commits, so a key pressed once the new options show never reaches the last
 * spot's handler). A held key doesn't repeat into the next spot; a modifier, or typing in a field, is someone else's. */
export function useHandKeys(active: boolean, onKey: (e: KeyboardEvent, tag: string) => void): void {
  const handler = useRef(onKey);
  useLayoutEffect(() => {
    handler.current = onKey;
  });
  useEffect(() => {
    if (!active) return;
    const on = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName ?? "";
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || /^(INPUT|SELECT|TEXTAREA)$/.test(tag)) return;
      handler.current(e, tag);
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [active]);
}

/** The finished hand kept in Analyze (graded there as an imported hand), or a button to keep it; and keeping
 * every hand. */
export function KeepHand({ kept, all, onKeep, onAll }: { kept: Kept | null; all: boolean; onKeep: () => void; onAll: (all: boolean) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      {kept?.st === "kept" ? (
        <p aria-live="polite">
          {kept.had ? "Already kept" : "Kept"} in Analyze ·{" "}
          <Link to={`/analyze?hand=${encodeURIComponent(kept.id)}`} className="underline">
            Open it there
          </Link>
        </p>
      ) : (
        <button
          type="button"
          disabled={kept?.st === "saving"}
          onClick={onKeep}
          className="rounded-md border border-border px-3 py-1.5 hover:bg-surface-2 disabled:opacity-50"
        >
          {kept?.st === "saving" ? "Keeping…" : "Keep in Analyze"}
          <Kbd>K</Kbd>
        </button>
      )}
      {kept?.st === "error" && (
        <p role="alert" className="text-danger">
          Not kept: {kept.message}
        </p>
      )}
      <label className="flex items-center gap-1.5 text-muted">
        <input type="checkbox" checked={all} onChange={(e) => onAll(e.target.checked)} />
        Keep every hand
      </label>
    </div>
  );
}

/** What a tournament session's numbers are, under its score. */
export const tournamentNote = (t: Pick<HandTournament, "model">) =>
  t.model === "icm"
    ? "Tournament, ICM: EVs in chips of prize equity, kept apart."
    : "Tournament, chip EV: EVs in bb of chips, kept apart.";

/** A grade with no EV, in words: what it went by, and why there's none. */
export function byFrequency(p: Provenance | null | undefined): string {
  if (p?.source === "library-turn") return "Graded by frequency: no EV stored.";
  if (p?.source === "push-fold") return "Graded by push/fold frequency: no EVs.";
  if (p?.evIn === "chips") return "Graded by frequency: rule EVs are chips, not prize equity.";
  return "Graded by chart frequency: charts have no EVs.";
}

/** The score in one line, and what it rests on folded under it (the sources it was graded against on the fold's own line;
 * how the two ways of grading preflop split, the game's notes and `children`, the ask-ahead meter, inside): the numbers stay
 * on the first screen beside the table, and where they come from is a line under them. */
export function ScoreStrip({ session, acc, loss, lossPct, children }: { session: PracticeSession; acc: number; loss: number | null; lossPct: number | null; children?: ReactNode }) {
  const s = session.score;
  // (graded more than one way, a single rate or EV figure would add unlike things: each way gets its own, as in History)
  const ways = cellWays(Object.values(session.cells ?? {}));
  const split = GRADE_WAYS.filter((w) => ways[w]);
  const item = (label: string, value: string) => (
    <div className="flex items-baseline gap-1.5">
      <span className="text-xs text-muted">{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
  const notes = [
    session.opts.pfSolve && pfWords(session.cells),
    session.opts.tournament && tournamentNote(session.opts.tournament),
    session.opts.exploit && exploitNote(session.opts.exploit),
    session.opts.exploit && !!session.read?.off && `${many(session.read.off, "hand")} left out of Net against the profile.`,
    !!session.revealed && `${session.revealed} revealed decision${session.revealed === 1 ? "" : "s"} not graded.`,
  ].filter((x): x is string => !!x);
  return (
    <section aria-label="Score" className="flex flex-wrap items-baseline gap-x-5 gap-y-1 panel px-3 py-2 text-sm">
      {item("Hands", String(session.hands))}
      {item("Decisions graded", String(s.n))}
      {split.length > 1 ? (
        split.map((w) => <Fragment key={w}>{item(WAY_HEADS[w], wayFigures(w, ways[w]!, sessionUnit(session.opts)))}</Fragment>)
      ) : (
        <>
          {item("Best or correct", s.n ? pct(acc, 0) : "–")}
          {item("EV lost per decision", loss == null ? "–" : `${bb(loss)}${sessionUnit(session.opts)} · ${lossPct!.toFixed(1)}% pot`)}
        </>
      )}
      {item("Streak", `${s.streak} (best ${s.best})`)}
      {!session.opts.preflopOnly && !session.opts.tournament && !session.opts.exploit && item("Net", `${signed(session.net)}bb`)}
      {session.opts.exploit && item("Net against the profile", session.read?.hands ? `${signed(session.read.net)}bb · ${many(session.read.hands, "hand")}` : "–")}
      {/* (always there and one line high, so nothing under it moves as the first grade or look-ahead comes in) */}
      <details className="basis-full text-xs text-muted">
        <summary className="cursor-pointer">{s.n > 0 ? `Graded against: ${sourcesText(session.sources)}` : "Nothing graded yet"}</summary>
        <div className="mt-1 space-y-1">
          {notes.map((n) => (
            <p key={n}>{n}</p>
          ))}
          {children}
        </div>
      </details>
    </section>
  );
}

/** Asking ahead, by the mode picker: a wrong guess has to be taken back, so a browser where a stop would end the solver
 * can't have it, and says so in words, as a phone has no tooltip. Nor can a page where a stop has ended one (`restarts`).
 * The box gives focus back once set: on it the page's keys don't work. */
export function AskAhead({ stopCost, restarts }: { stopCost: StopCost | null; restarts: number }) {
  const saved = useSettings((s) => s.askAhead);
  const set = useSettings((s) => s.set);
  const kills = stopCost === "kills";
  return (
    <div className="flex flex-wrap items-center gap-x-2 text-sm">
      <label
        className="flex items-center gap-1.5"
        title="Solve likely next spots while you think"
      >
        <input
          type="checkbox"
          aria-label="Ask ahead"
          checked={!kills && (saved ?? ASK_AHEAD)}
          disabled={kills}
          onChange={(e) => {
            set({ askAhead: e.target.checked });
            e.currentTarget.blur();
          }}
        />
        <span className="text-muted">Ask ahead</span>
      </label>
      {kills && <span className="text-xs text-muted">Off: this browser can&rsquo;t stop a solve.</span>}
      {!kills && restarts > 0 && <span className="text-xs text-muted">Off: the solver had to restart.</span>}
    </div>
  );
}

/** How asking ahead has gone, under the score, once it has run: since the Room began, which is this page opening, as it
 * isn't kept with the session and New session leaves it. While it's on its room is kept, a phone's being three lines, or the
 * page would move as the first look-ahead goes out, just as the options you're about to press have come up. */
export function AheadLine({ on, meter }: { on: boolean; meter: AheadMeter }) {
  if (!on && !meter.asked) return null;
  return meter.asked > 0 ? <p>Asking ahead: {meterLine(meter)}</p> : null;
}

function RetryOpener({ back, onClick }: { back: boolean; onClick: () => void }) {
  const b = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (back) b.current?.focus();
  }, [back]);
  return (
    <button ref={b} type="button" onClick={onClick} className="rounded-md border border-border px-3 py-1.5 hover:bg-surface-2">
      Retry this decision
    </button>
  );
}

/** Your decisions this session (review.ts): the last few, newest first, or your biggest mistakes once asked for,
 * each opening its spot and verdict. `retry`, at one table: Previous and Later step through all of them, and any can be
 * retried; `onOpen` says when a retry is open, as the table's keys would play a real move under it. */
export function ReviewMistakes({ review, retry }: { review: Reviewed[]; retry?: { getClient: GetClient; onOpen: (open: boolean) => void } }) {
  const [open, setOpen] = useState(false);
  // (the one open, by itself: the list moves on past REVIEW_KEEP)
  const [pick, setPick] = useState<Reviewed | null>(null);
  const [retrying, setRetrying] = useState<Reviewed | null>(null);
  // the one a retry was just closed on: its button takes the keyboard back
  const [closed, setClosed] = useState<Reviewed | null>(null);
  const onOpen = retry?.onOpen;
  useEffect(() => {
    onOpen?.(retrying !== null);
    return () => onOpen?.(false);
  }, [retrying, onOpen]);
  const bad = mistakes(review);
  const xs = open ? bad : recent(review);
  const at = pick ? review.indexOf(pick) : -1;
  const show = (e: Reviewed | null) => {
    setPick(e);
    setRetrying(null);
  };
  const detail = (e: Reviewed) => (
    <div className="space-y-2 pl-2">
      <p className="flex flex-wrap items-center gap-1 text-muted">
        {seatLabel(e.seat, e.players)}
        {e.board.length > 0 && (
          <>
            {" · "}
            {e.board.map((c) => (
              <PlayingCard key={c} card={c} size="sm" />
            ))}
          </>
        )}
        {` · ${e.line}`}
      </p>
      <DecisionView d={e.d} players={e.players} title={e.table ? `Table ${e.table}, hand ${e.n}, ${e.d.street}` : `Hand ${e.n}, ${e.d.street}`} spot={e} />
      {retry &&
        (retrying === e ? (
          <SessionRetry key={`${e.n}|${e.d.study}`} e={e} getClient={retry.getClient} onClose={() => {
            setRetrying(null);
            setClosed(e);
          }} />
        ) : retrySpot(e) ? (
          <RetryOpener back={closed === e} onClick={() => setRetrying(e)} />
        ) : (
          <p className="text-xs text-muted">Can&rsquo;t retry: spot not kept.</p>
        ))}
    </div>
  );
  return (
    <section aria-label="Your decisions" className="space-y-2 panel p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-medium">
          {open ? (
            <>
              Your biggest mistakes <span className="text-muted">· last {review.length} decisions</span>
            </>
          ) : (
            "Recent decisions"
          )}
        </h2>
        <button
          type="button"
          aria-expanded={open}
          aria-label={`${open ? "Hide" : "Review"} mistakes${bad.length ? ` (${bad.length})` : ""}`}
          onClick={() => setOpen(!open)}
          className="rounded-md border border-border px-3 py-1.5 hover:bg-surface-2"
        >
          {open ? "Hide mistakes" : "Review mistakes"}
          {bad.length > 0 && <span className="ml-2 rounded-full bg-surface-3 px-1.5 font-mono text-xs">{bad.length}</span>}
        </button>
      </div>
      <Link to="/review" className="text-xs underline">
        All mistakes in Review
      </Link>
      {retry && (
        <div role="group" aria-label="Step through your decisions" className="flex flex-wrap items-center gap-2">
          <button type="button" disabled={at === 0} onClick={() => show(review[at < 0 ? review.length - 1 : at - 1] ?? null)} className="rounded-md border border-border px-3 py-1.5 hover:bg-surface-2 disabled:opacity-50">
            Previous
          </button>
          <button type="button" disabled={at < 0 || at === review.length - 1} onClick={() => show(review[at + 1] ?? null)} className="rounded-md border border-border px-3 py-1.5 hover:bg-surface-2 disabled:opacity-50">
            Later
          </button>
          <span className="text-xs text-muted">{at >= 0 ? `Decision ${at + 1} of ${review.length}` : `Last ${review.length} graded decision${review.length === 1 ? "" : "s"}`}</span>
        </div>
      )}
      {pick && !xs.some((x) => x.e === pick) && detail(pick)}
      {xs.length === 0 ? (
        <p className="text-muted">No mistakes in your last {review.length} decisions so far.</p>
      ) : (
        <ul className="space-y-1">
          {xs.map(({ e, i }) => {
            const g = e.d.grade!;
            const p = e.d.provenance;
            return (
              <li key={i} className="space-y-2">
                <button
                  type="button"
                  aria-expanded={pick === e}
                  onClick={() => show(pick === e ? null : e)}
                  className={`flex w-full flex-wrap items-center gap-2 rounded-md border px-2 py-1 text-left hover:bg-surface-2 ${pick === e ? "border-accent" : "border-border"}`}
                >
                  <span className="font-mono text-xs text-muted">
                    {e.table ? `T${e.table} ` : ""}#{e.n} {e.d.street}
                  </span>
                  <span className="flex gap-0.5">
                    {e.hole.map((c) => (
                      <PlayingCard key={c} card={c} size="sm" />
                    ))}
                  </span>
                  <span className="font-mono">{e.d.chose}</span>
                  <VerdictTag v={g.verdict} />
                  <span className="font-mono text-xs">{g.byEv ? (g.loss > 0.005 ? `${bb(g.loss)}${evUnit(p)} lost` : "no EV lost") : `played ${pct(e.d.mix[g.a]?.freq ?? 0)}`}</span>
                  {p && (
                    <span className="text-xs text-muted" title={describeProvenance(p)}>
                      {p.approximate && "≈ "}
                      {sourceLabel(p.source)}
                    </span>
                  )}
                </button>
                {pick === e && detail(e)}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** After your fold: the run-out under way, or how it ended (your result stays as at your fold). */
export function RunText({ hand, sim }: { hand: PracticeHand; sim: Sim }) {
  if (hand.run !== "played") return null;
  const end = runEnd(hand, sim);
  const who = (p: string) => seatLabel(p, hand.players);
  return (
    <span className="text-muted">
      {" · "}
      {!end ? "running it out…" : end.says ? `run out: ${end.says}` : `run out: ${end.winners.map(who).join(" and ")} took the pot`}
    </span>
  );
}

/** Chips carried: your stack as the hand started (and as it ended), who rebought, and Reset stacks (between hands). */
export function Carried({ hand, sim, onReset }: { hand: PracticeHand; sim: Sim; onReset: () => void }) {
  const start = hand.stacks![hand.hero]!;
  const re = (hand.rebuys ?? []).map((p) => (p === hand.hero ? "you" : seatLabel(p, hand.players)));
  const names = re.length > 2 ? `${re.slice(0, -1).join(", ")} and ${re.at(-1)}` : re.join(" and ");
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
      <span>
        Chips carried: your stack <span className="font-mono text-text">{fmt(start)}bb</span>
        {hand.result && (
          <>
            {" "}
            → <span className="font-mono text-text">{fmt(chipsAfter(hand, sim)[hand.hero]!)}bb</span>
          </>
        )}
        {names && ` · ${names} rebought to ${hand.stack}bb`}
      </span>
      <button
        type="button"
        onClick={onReset}
        disabled={!hand.result}
        title={`Every seat back to ${hand.stack}bb`}
        className="rounded border border-border px-2 py-0.5 hover:bg-surface-2 disabled:opacity-40"
      >
        Reset stacks
      </button>
    </div>
  );
}

/** A tournament played out: the level, the players left and the prizes, your chips, what happened since the last
 * hand, and a way to start it over. */
export function PlayedOut({ hand, sim, onRestart }: { hand: PracticeHand; sim: Sim; onRestart: () => void }) {
  const t = hand.tournament!;
  const left = leftOf(hand.players, t);
  const paid = t.model === "icm" ? (t.payouts?.length ?? 0) : 0;
  const into = (t.played ?? 0) % LEVEL_HANDS;
  return (
    <div className="space-y-1 text-xs text-muted" aria-label="The tournament">
      {!!t.news?.length && (
        <ul aria-live="polite" className="space-y-0.5 text-text">
          {t.news.map((x, i) => (
            <li key={i}>{x}</li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span>
          Level {levelOf(t) + 1}, hand {into + 1} of {LEVEL_HANDS} · {left} left{paid ? (paid >= left ? ", all paid" : `, ${paid} paid`) : ""} · your stack{" "}
          <span className="font-mono text-text">{fmt(hand.stacks![hand.hero]!)}bb</span>
          {hand.result && (
            <>
              {" "}
              → <span className="font-mono text-text">{fmt(chipsAfter(hand, sim)[hand.hero]!)}bb</span>
            </>
          )}
          {t.bounty?.format === "mystery" ? (
            <>
              {" "}· mystery envelopes left <span className="font-mono text-text">{t.bounty.envelopes?.length ?? 0}</span>
              {t.bounty.envelopes?.length ? (
                <>
                  {" "}(average <span className="font-mono text-text">{fmt(t.bounty.envelopes.reduce((x, y) => x + y, 0) / t.bounty.envelopes.length)}</span>)
                </>
              ) : null}
              , drawn by you <span className="font-mono text-text">{fmt(t.won ?? 0)}</span>
            </>
          ) : (
            t.bounty && (
              <>
                {" "}· your bounty <span className="font-mono text-text">{fmt(t.bounty.seats[hand.hero] ?? 0)}</span>, bounties collected{" "}
                <span className="font-mono text-text">{fmt(t.won ?? 0)}</span>
              </>
            )
          )}
          </span>
        <button
          type="button"
          onClick={onRestart}
          disabled={!hand.result}
          className="rounded border border-border px-2 py-0.5 hover:bg-surface-2 disabled:opacity-40"
        >
          Start over
        </button>
      </div>
    </div>
  );
}

export function SeatView({ hand, sim, p }: { hand: PracticeHand; sim: Sim; p: string }) {
  const t = setupOf(hand);
  const you = p === hand.hero;
  const folded = !sim.active.has(p);
  const cards = shownCards(hand, p, sim);
  const bet = sim.cur?.bets[p] ?? 0;
  const won = (runEnd(hand, sim) ?? hand.result)?.pays[p];
  const toAct = !hand.result && sim.toAct === p;
  return (
    <li
      aria-label={`${seatLabel(p, hand.players)}${you ? " (you)" : ""}`}
      aria-current={toAct ? "true" : undefined}
      className={`space-y-1 rounded-md border p-2 text-xs ${toAct ? "border-accent" : "border-border"} ${you ? "bg-surface-2" : ""} ${folded ? "opacity-50" : ""}`}
    >
      <div className="flex items-center justify-between gap-1">
        <span className="font-medium">
          {seatLabel(p, hand.players)}
          {you && <span className="text-accent"> · you</span>}
        </span>
        <span className="font-mono text-muted">{fmt(behind(t, sim, p))}</span>
      </div>
      <div className="flex gap-0.5">
        {folded && !you && !cards ? (
          <span className="text-muted">folded</span>
        ) : (
          (cards ?? [null, null]).map((c, i) => <PlayingCard key={i} card={c} size="sm" />)
        )}
      </div>
      <div className="h-4 font-mono">
        {won ? <span className="text-accent">won {fmt(won)}</span> : bet > 0 ? <span>bet {fmt(bet)}</span> : sim.allin.has(p) && !folded ? "all-in" : ""}
      </div>
    </li>
  );
}

/** Your moves where the spot has no answer: fold, check or call, the smallest bet or raise, all-in (not graded). */
export function FallbackMoves({ hand, onMove }: { hand: PracticeHand; onMove: (a: { action: string; to?: number }) => void }) {
  const sim = simOf(hand);
  const lg = legal(setupOf(hand), sim);
  if (!lg) return null;
  const btn = (label: string, a: { action: string; to?: number }) => (
    <button key={label} type="button" onClick={() => onMove(a)} className="rounded-md border border-border bg-surface-2 px-3 py-1.5 hover:bg-surface-3">
      {label}
    </button>
  );
  const facing = lg.toCall > 1e-9;
  return (
    <div role="group" aria-label="Moves without a grade" className="flex flex-wrap items-center gap-2">
      <span className="text-muted">Play on without a grade:</span>
      {facing && btn("fold", { action: "fold" })}
      {btn(facing ? `call ${fmt(lg.toCall)}` : "check", { action: facing ? "call" : "check" })}
      {lg.canRaise && lg.minTo < lg.allInTo && btn(`${facing || (sim.cur?.curBet ?? 0) > 0 ? "raise to" : "bet"} ${fmt(lg.minTo)}`, { action: "raise", to: lg.minTo })}
      {lg.canRaise && btn(`all-in ${fmt(lg.allInTo)}`, { action: "all-in" })}
    </div>
  );
}

/** `spot`: where it was taken, for Copy for AI, on a graded decision. */
// (`players` is no longer read; kept so callers outside Practice stay unchanged)
export function DecisionView({ d, title = "Your last decision", spot, children }: { d: Omit<Decision, "move">; players?: number; title?: string; spot?: Reviewed; children?: ReactNode }) {
  const g = d.grade;
  // (a stored turn keeps no hand's EV, so there's no column of dashes to read as if one had been left out)
  const hasEv = d.provenance?.source !== "library-turn" && d.provenance?.source !== "push-fold" && d.provenance?.evIn !== "chips" && d.mix.some((a) => a.ev != null);
  return (
    <section aria-label={title === "Your last decision" ? "Last decision" : title} className="space-y-2 panel p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-medium">{title}</h2>
        {g ? <VerdictTag v={g.verdict} /> : <span className="text-xs text-muted">Not graded{d.revealed ? ": you revealed the answer first" : d.offProfile ? ": no best response came back here" : ""}</span>}
        <span>
          {d.street}: you took <span className="font-mono">{d.chose}</span>
          {g && g.a !== g.best && d.mix[g.best] && (
            <>
              ; {whoOf(d.provenance?.source).replace(/^The /, "the ")}&rsquo;s best was <span className="font-mono">{d.mix[g.best]!.action}</span>
            </>
          )}
        </span>
        {d.provenance && <ProvenanceBadge p={d.provenance} />}
      </div>
      {d.revealed && (
        <p role="status" className="text-muted">
          {REVEAL_NOTE}
        </p>
      )}
      {d.offProfile && (
        <p className="text-muted">
          No best response to the profile here: not counted.
        </p>
      )}
      {g && d.pfWhy && <p className="text-muted">Chart&rsquo;s grade, not the solve&rsquo;s: {d.pfWhy}</p>}
      {g && d.mix.length > 0 && (
        <p>
          {whyText(
            g,
            d.mix.map((a) => optionLabel(a.action, a.amount)),
            d.mix.map((a) => a.freq),
            whoOf(d.provenance?.source),
          )}
        </p>
      )}
      {g && (
        <p className="text-muted">
          {g.byEv
            ? g.loss > 0
              ? `EV given up: ${d.mix[g.a]?.rough || d.mix[g.best]?.rough ? "≈" : ""}${bb(g.loss)}${evUnit(d.provenance)}, ${g.lossPct.toFixed(1)}% of the ${fmt(d.pot)}bb pot.`
              : "No EV given up."
            : byFrequency(d.provenance)}
          {g.mixed && " This hand mixes actions here."}
        </p>
      )}
      {d.mix.length > 0 && <MixTable mix={d.mix} hasEv={hasEv} labelOf={(a) => optionLabel(a.action, a.amount)} chose={d.chose} unit={evUnit(d.provenance)} />}
      {children}
      {g && spot && <CopyForAi key={`${spot.n}|${d.study}|${d.chose}`} text={() => reviewedText(spot)} />}
      {d.study && (
        <p>
          <Link to={`/study?${d.study}`} className="text-accent hover:underline">
            Open this spot in Study →
          </Link>
          {d.provenance?.source === "best-response" && <span className="text-xs text-muted"> (at equilibrium)</span>}
        </p>
      )}
    </section>
  );
}

/** Your whole range at your last decision, as the same answer plays it (the badge above): each hand's mix, yours
 * picked; a hand picked says its mix in words. Shown once asked for (kept from decision to decision). */
export function RangeView({ r, open, onToggle }: { r: RangeAt; open: boolean; onToggle: (open: boolean) => void }) {
  const [sel, setSel] = useState<string>(r.cls);
  const colors = actionFills(r.grid.actions);
  const cell = r.grid.cells[sel];
  const mix = cell ? r.grid.actions.map((a, i) => ({ a, f: cell.f[i] ?? 0 })).filter((x) => x.f >= 0.0005) : [];
  return (
    <details open={open} onToggle={(e) => onToggle(e.currentTarget.open)} className="space-y-2">
      <summary className="cursor-pointer text-accent">{r.label}</summary>
      <div className="flex flex-wrap gap-2 text-xs">
        {r.grid.actions.map((a, i) => (
          <span key={a} className="inline-flex items-center gap-1">
            <span className="inline-block h-3.5 w-3.5 shrink-0 rounded-sm" style={{ background: colors[i] }} />
            {a}
          </span>
        ))}
      </div>
      <div className="max-w-md">
        <RangeMatrix cells={r.grid.cells} actions={r.grid.actions} colors={colors} selected={sel} onSelect={setSel} caption={r.label} />
      </div>
      <p className="text-xs">
        <span className="font-mono">{sel}</span>
        {sel === r.cls && " (your hand)"}:{" "}
        {mix.length ? mix.map((x) => `${x.a} ${pct(x.f)}`).join(", ") : "not in your range here"}
        {cell && cell.w < 0.999 && <span className="text-muted"> · {pct(cell.w)} of its combos in the range</span>}
      </p>
    </details>
  );
}
