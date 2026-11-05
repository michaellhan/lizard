// The parts of Practice's full hands: the score, a seat, chips carried, your moves where a spot has no answer, your
// last decision and your range at it, the hand's log, keeping a hand, and Review mistakes. Each draws what it's given:
// the hand and the session stay with the page. And the keys' rules, which each view of the hand keeps.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { PlayingCard } from "@/components/PlayingCard";
import { ProvenanceBadge } from "@/components/ProvenanceBadge";
import { VerdictTag } from "@/components/VerdictTag";
import { actionColors, bb, kindOf, pct } from "@/components/actions";
import { RangeMatrix } from "@/components/RangeMatrix";
import { sourcesText } from "@/features/history/history";
import { whoOf, whyText } from "@/grading/grade";
import { seatLabel } from "@/poker/seats";
import { behind, legal, STREETS, type Move, type Sim } from "@/poker/table";
import { describe as describeProvenance, sourceLabel } from "@/solver/provenance";
import type { StopCost } from "@/solver/types";
import { useSettings } from "@/state/settings";
import { ASK_AHEAD, meterLine, type AheadMeter } from "./ahead";
import { chipsAfter, runEnd, sayMove, setupOf, shownCards, simOf, type Decision, type PracticeHand, type RangeAt } from "./practice";
import { mistakes, recent, type Reviewed } from "./review";
import type { Kept, PracticeSession } from "./session";

export const fmt = (x: number) => String(Math.round(x * 100) / 100);
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

/** "bet 33%" (to 1.8bb), "raise 2.5": the solver's name, with the size it plays where the name doesn't say it. */
export function optionLabel(name: string, amount: number | undefined): string {
  const k = kindOf(name);
  if ((k === "bet" || k === "raise") && typeof amount === "number" && !name.includes(fmt(amount))) return `${name} (${fmt(amount)}bb)`;
  return name;
}

/** `reserve`: hold the line under it before there's anything to say, as above one table the dock sits below it. */
export function ScoreStrip({ session, acc, loss, lossPct, reserve }: { session: PracticeSession; acc: number; loss: number | null; lossPct: number | null; reserve?: boolean }) {
  const s = session.score;
  const item = (label: string, value: string) => (
    <div className="rounded bg-surface-2 px-2 py-1">
      <div className="text-xs text-muted">{label}</div>
      <div className="font-mono">{value}</div>
    </div>
  );
  return (
    <section aria-label="Score" className="flex flex-wrap gap-2 text-sm">
      {item("Hands", String(session.hands))}
      {item("Decisions graded", String(s.n))}
      {item("Best or correct", s.n ? pct(acc, 0) : "–")}
      {item("EV lost a decision", loss == null ? "–" : `${bb(loss)}bb · ${lossPct!.toFixed(1)}% pot`)}
      {item("Streak", `${s.streak} (best ${s.best})`)}
      {!session.opts.preflopOnly && item("Net", `${signed(session.net)}bb`)}
      {(s.n > 0 || reserve) && <p className={`basis-full text-xs text-muted ${reserve ? "min-h-8" : ""}`}>{s.n > 0 && `Graded against: ${sourcesText(session.sources)}`}</p>}
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
        title="While you decide, the solver works on your likeliest next spots, so an answer can be there when you reach one. It's the same answer, and it uses the solver while you think. Only what should be quick is asked ahead, though a rare one can run on until you move."
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
      {kills && <span className="text-xs text-muted">Off: this browser can&rsquo;t stop a solve, so a wrong guess would hold up your next answer.</span>}
      {!kills && restarts > 0 && <span className="text-xs text-muted">Off on this page: the solver didn&rsquo;t answer a stop and had to restart.</span>}
    </div>
  );
}

/** How asking ahead has gone, under the score, once it has run: since the Room began, which is this page opening, as it
 * isn't kept with the session and New session leaves it. While it's on its room is kept, a phone's being three lines, or the
 * page would move as the first look-ahead goes out, just as the options you're about to press have come up. */
export function AheadLine({ on, meter }: { on: boolean; meter: AheadMeter }) {
  if (!on && !meter.asked) return null;
  return <p className="min-h-12 text-xs text-muted sm:min-h-8">{meter.asked > 0 && `Asking ahead, measured in this browser since this page opened: ${meterLine(meter)}`}</p>;
}

/** Your decisions this session (review.ts): the last few, newest first, or your biggest mistakes once asked for,
 * each opening its spot and verdict. */
export function ReviewMistakes({ review }: { review: Reviewed[] }) {
  const [open, setOpen] = useState(false);
  // (the one open, by itself: the list moves on past REVIEW_KEEP)
  const [pick, setPick] = useState<Reviewed | null>(null);
  const bad = mistakes(review);
  const xs = open ? bad : recent(review);
  return (
    <section aria-label="Your decisions" className="space-y-2 rounded-lg border border-border bg-surface p-3 text-sm">
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
                  onClick={() => setPick(pick === e ? null : e)}
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
                  <span className="font-mono text-xs">{g.byEv ? (g.loss > 0.005 ? `${bb(g.loss)}bb lost` : "no EV lost") : `played ${pct(e.d.mix[g.a]?.freq ?? 0)}`}</span>
                  {p && (
                    <span className="text-xs text-muted" title={describeProvenance(p)}>
                      {p.approximate && "≈ "}
                      {sourceLabel(p.source)}
                    </span>
                  )}
                </button>
                {pick === e && (
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
                    <DecisionView d={e.d} players={e.players} title={e.table ? `Table ${e.table}, hand ${e.n}, ${e.d.street}` : `Hand ${e.n}, ${e.d.street}`} />
                  </div>
                )}
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
        {hand.result?.folded && sim.active.size > 1 && !sim.handOver && " · the others' chips go as if they checked it down"}
      </span>
      <button
        type="button"
        onClick={onReset}
        disabled={!hand.result}
        title={`The next hand with every seat back at ${hand.stack}bb (the setup's stack)`}
        className="rounded border border-border px-2 py-0.5 hover:bg-surface-2 disabled:opacity-40"
      >
        Reset stacks
      </button>
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

export function DecisionView({ d, players, title = "Your last decision", children }: { d: Decision; players: number; title?: string; children?: ReactNode }) {
  const g = d.grade;
  return (
    <section aria-label={title === "Your last decision" ? "Last decision" : title} className="space-y-2 rounded-lg border border-border bg-surface p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-medium">{title}</h2>
        {g ? <VerdictTag v={g.verdict} /> : <span className="text-xs text-muted">Not graded</span>}
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
              ? `EV given up: ${bb(g.loss)}bb, ${g.lossPct.toFixed(1)}% of the ${fmt(d.pot)}bb pot.`
              : "No EV given up."
            : "Graded by how often the chart plays it: the preflop charts have no EVs."}
          {g.mixed && " This hand mixes actions here."}
        </p>
      )}
      {d.mix.length > 0 && (
        <table className="w-full max-w-md text-left font-mono text-xs">
          <thead className="text-muted">
            <tr>
              <th className="py-0.5 font-normal">Action</th>
              <th className="py-0.5 text-right font-normal">Played</th>
              <th className="py-0.5 text-right font-normal">EV bb</th>
            </tr>
          </thead>
          <tbody>
            {d.mix.map((a) => (
              <tr key={a.action} className={a.action === d.chose ? "text-accent" : ""}>
                <td className="py-0.5">
                  {optionLabel(a.action, a.amount)}
                  {a.action === d.chose && " ← you"}
                </td>
                <td className="py-0.5 text-right">{pct(a.freq)}</td>
                <td className="py-0.5 text-right">{bb(a.ev)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="text-xs text-muted">Your hand&rsquo;s frequencies and EVs at {players === 2 ? "this heads-up" : "this"} spot, from the answer named in the badge.</p>
      {children}
      <Link to={`/study?${d.study}`} className="inline-block text-accent hover:underline">
        Open this spot in Study →
      </Link>
    </section>
  );
}

/** Your whole range at your last decision, as the same answer plays it (the badge above): each hand's mix, yours
 * picked; a hand picked says its mix in words. Shown once asked for (kept from decision to decision). */
export function RangeView({ r, open, onToggle }: { r: RangeAt; open: boolean; onToggle: (open: boolean) => void }) {
  const [sel, setSel] = useState<string>(r.cls);
  const colors = actionColors(r.grid.actions);
  const cell = r.grid.cells[sel];
  const mix = cell ? r.grid.actions.map((a, i) => ({ a, f: cell.f[i] ?? 0 })).filter((x) => x.f >= 0.0005) : [];
  return (
    <details open={open} onToggle={(e) => onToggle(e.currentTarget.open)} className="space-y-2">
      <summary className="cursor-pointer text-accent">{r.label}</summary>
      <div className="flex flex-wrap gap-2 text-xs">
        {r.grid.actions.map((a, i) => (
          <span key={a} className="inline-flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: colors[i] }} />
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

export function HandLog({ hand }: { hand: PracticeHand }) {
  const say = (m: Move) => sayMove(m, hand.hero, hand.players);
  const out = [0, 3, 4, 5];
  const pre = hand.lines.preflop;
  const opened = pre.findIndex((m) => m.action !== "fold");
  // (preflop, the folds before anyone came in are left out; yours, and the one that ends the hand, are not)
  const keep = (m: Move, k: number) => m.action !== "fold" || m.pos === hand.hero || k === pre.length - 1 || (opened >= 0 && k > opened);
  const rows = STREETS.filter((_, i) => hand.shown >= out[i]!).map((st, i) => ({
    st,
    // (the street's own cards: the flop's three, then one each)
    cards: hand.board.slice(i <= 1 ? 0 : out[i - 1], out[i]).join(" "),
    moves: hand.lines[st].filter((m, k) => st !== "preflop" || keep(m, k)).map(say),
  }));
  return (
    <section aria-label="Hand history" className="rounded-lg border border-border bg-surface p-3 text-sm">
      <h2 className="mb-1 font-medium">This hand</h2>
      <ol className="space-y-0.5">
        {rows.map((r) => (
          <li key={r.st}>
            <span className="text-muted">{r.st}</span>
            {r.cards && <span className="font-mono"> [{r.cards}]</span>}
            {r.moves.length ? `: ${r.moves.join(", ")}` : ""}
          </li>
        ))}
      </ol>
    </section>
  );
}
