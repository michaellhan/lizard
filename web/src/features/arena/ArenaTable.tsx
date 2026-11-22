// The table as your seat sees it: the other seat, the board and the pot, your seat, the clock, your moves on your turn,
// and once a hand is over what happened, the next hand and "Review in Analyze". It draws the view the server sent
// (protocol.ts TableView) and sends what you click; it computes no rule of its own. The cards are Practice's
// (components/PlayingCard), the seats laid out as Practice's are (practice/PracticeParts.tsx SeatView).
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { PlayingCard } from "@/components/PlayingCard";
import type { ArenaAction, ClientMessage, HandView, SeatView, TableView } from "./protocol";

const fmt = (x: number) => String(Math.round(x * 100) / 100);
const signed = (x: number) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${fmt(Math.abs(x))}`;
const STREET_NAMES = { preflop: "Preflop", flop: "Flop", turn: "Turn", river: "River" } as const;

/** Seconds left on the clock of the seat to act, and whether it's into its bank. */
function useClock(hand: HandView | null, skew: number): { left: number; bank: boolean } | null {
  const [now, setNow] = useState(() => Date.now());
  const live = !!hand && hand.deadline !== null && !hand.result;
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [live]);
  if (!hand || hand.deadline === null || hand.result) return null;
  const at = now + skew;
  return { left: Math.max(0, Math.ceil((hand.deadline - at) / 1000)), bank: hand.bankFrom !== null && at >= hand.bankFrom };
}

function Seat({ seat, label, you, cards, bet, behind, toAct, folded, clock }: { seat: SeatView | null; label: string; you: boolean; cards: (string | null)[] | null; bet: number; behind: number | null; toAct: boolean; folded: boolean; clock: { left: number; bank: boolean } | null }) {
  return (
    <li
      aria-label={`${seat?.name ?? "Empty seat"}${you ? " (you)" : ""}`}
      aria-current={toAct ? "true" : undefined}
      className={`space-y-1 rounded-md border p-2 text-xs ${toAct ? "border-accent" : "border-border"} ${you ? "bg-surface-2" : ""} ${folded && !you ? "opacity-50" : ""}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">
          {seat?.name ?? "Waiting for a player"}
          {you && <span className="text-accent"> · you</span>}
          <span className="text-muted"> · {label}</span>
        </span>
        {seat && (
          <span className="flex items-center gap-2">
            {!seat.connected && <span className="text-danger">away</span>}
            {behind !== null && <span className="font-mono text-muted">{fmt(behind)}bb</span>}
          </span>
        )}
      </div>
      <div className="flex gap-0.5">{cards ? cards.map((c, i) => <PlayingCard key={i} card={c} size={you ? "lg" : "md"} raised={you} />) : <span className="h-11 text-muted">{folded ? "folded" : ""}</span>}</div>
      <div className="flex h-4 justify-between font-mono">
        <span>{bet > 0 ? `bet ${fmt(bet)}` : ""}</span>
        {toAct && clock && (
          <span role="timer" aria-label={`${clock.left} seconds left`} className={clock.bank ? "text-danger" : ""}>
            {clock.bank ? "bank " : ""}
            {clock.left}s
          </span>
        )}
      </div>
    </li>
  );
}

function Moves({ hand, send }: { hand: HandView; send: (m: ClientMessage) => void }) {
  const lg = hand.legal!;
  const facing = lg.toCall > 1e-9;
  const word = facing || lg.curBet > 0 ? "Raise to" : "Bet";
  const pot = hand.pot;
  // (the sizes a click offers: half the pot and the pot, as a street total, kept between the smallest raise and all-in)
  const sized = (f: number) => Math.min(lg.allInTo, Math.max(lg.minTo, Math.round((lg.curBet + f * (pot + lg.toCall)) * 2) / 2));
  const [to, setTo] = useState(() => String(lg.minTo));
  const act = (action: ArenaAction, size?: number) => send({ t: "act", n: hand.n, action, ...(size !== undefined ? { to: size } : {}) });
  const typed = Number(to);
  const btn = "rounded-md border border-border bg-surface-2 px-3 py-1.5 hover:bg-surface-3 disabled:opacity-50";
  return (
    <div role="group" aria-label="Your move" className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {facing && (
          <button type="button" className={btn} onClick={() => act("fold")}>
            Fold
          </button>
        )}
        <button type="button" className={btn} onClick={() => act(facing ? "call" : "check")}>
          {facing ? `Call ${fmt(lg.toCall)}` : "Check"}
        </button>
        {lg.canRaise && lg.minTo < lg.allInTo && (
          <form
            className="flex items-center gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              if (typed >= lg.allInTo) act("all-in");
              else act(facing || lg.curBet > 0 ? "raise" : "bet", typed);
            }}
          >
            <label className="flex items-center gap-1">
              <span className="sr-only">{word}, big blinds</span>
              <input type="number" inputMode="decimal" min={lg.minTo} max={lg.allInTo} step={0.5} value={to} onChange={(e) => setTo(e.target.value)} className="w-20 rounded-md border border-border bg-surface px-2 py-1 font-mono" />
            </label>
            <button type="submit" className={btn} disabled={!(typed >= lg.minTo)}>
              {word} {Number.isFinite(typed) ? fmt(Math.min(typed, lg.allInTo)) : ""}
            </button>
          </form>
        )}
        {lg.canRaise && (
          <button type="button" className={btn} onClick={() => act("all-in")}>
            All-in {fmt(lg.allInTo)}
          </button>
        )}
      </div>
      {lg.canRaise && lg.minTo < lg.allInTo && (
        <div className="flex flex-wrap gap-1 text-xs text-muted">
          <span>Sizes:</span>
          {(
            [
              ["min", lg.minTo],
              ["½ pot", sized(0.5)],
              ["pot", sized(1)],
            ] as const
          ).map(([l, x]) => (
            <button key={l} type="button" className="rounded border border-border px-1.5 py-0.5 hover:bg-surface-2" onClick={() => setTo(String(x))}>
              {l} {fmt(x)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function HandLog({ hand, names }: { hand: HandView; names: [string, string] }) {
  const who = (pos: "SB" | "BB") => names[hand.pos[pos]];
  const streets = (Object.keys(STREET_NAMES) as (keyof typeof STREET_NAMES)[]).filter((s) => hand.lines[s].length);
  if (!streets.length) return null;
  return (
    <ol aria-label="This hand's moves" className="space-y-0.5 text-xs text-muted">
      {streets.map((s) => (
        <li key={s}>
          <span className="font-medium text-text">{STREET_NAMES[s]}:</span>{" "}
          {hand.lines[s].map((m) => `${who(m.pos)} ${m.action}${m.to !== undefined && m.action !== "all-in" ? ` ${fmt(m.to)}` : ""}`).join(", ")}
        </li>
      ))}
    </ol>
  );
}

export interface ReviewState {
  st: "saving" | "kept" | "error";
  message?: string;
  link?: string;
}

/** The table: what's drawn from the server's view, and the moves, next hand and review sent back. */
export function ArenaTable({ view, skew, send, review, onReview }: { view: TableView; skew: number; send: (m: ClientMessage) => void; review: ReviewState | null; onReview: (history: string) => void }) {
  const hand = view.hand;
  const me = view.you;
  const them = me === 0 ? 1 : 0;
  const names: [string, string] = [view.seats[0]?.name ?? "Seat 1", view.seats[1]?.name ?? "Seat 2"];
  const clock = useClock(hand, skew);
  const posOf = (s: 0 | 1) => (hand ? (hand.pos.SB === s ? "SB" : "BB") : null);
  const label = (s: 0 | 1) => (posOf(s) === "SB" ? "button, small blind" : posOf(s) === "BB" ? "big blind" : "");
  const folded = (s: 0 | 1) => !!hand && Object.values(hand.lines).some((l) => l.some((m) => m.pos === posOf(s) && m.action === "fold"));
  const seatProps = (s: 0 | 1) => {
    const p = posOf(s);
    const cards = !hand ? null : s === me ? hand.cards : folded(s) ? null : (hand.theirs ?? [null, null]);
    return {
      seat: view.seats[s],
      label: label(s),
      you: s === me,
      cards,
      bet: hand && p && !hand.result ? hand.bets[p] : 0,
      behind: hand && p ? hand.behind[p] : null,
      toAct: !!hand && hand.toAct === s,
      folded: folded(s),
      clock,
    };
  };
  const mine = view.seats[me];
  const theirs = view.seats[them];
  const result = hand?.result ?? null;
  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        <Seat {...seatProps(them)} />
        <li aria-label="Board" className="flex flex-wrap items-center gap-3 rounded-md border border-dashed border-border p-2">
          <div className="flex gap-0.5">
            {[0, 1, 2, 3, 4].map((i) => (
              <PlayingCard key={i} card={hand?.board[i] ?? null} size="md" />
            ))}
          </div>
          {hand && <span className="font-mono text-sm">pot {fmt(hand.pot)}bb</span>}
          {hand && <span className="text-xs text-muted">hand {hand.n}</span>}
        </li>
        <Seat {...seatProps(me)} />
      </ul>

      {!hand && !theirs && <p className="text-sm text-muted">Waiting for your friend to open the link. The first hand is dealt as soon as they sit down.</p>}
      {hand && !result && hand.toAct === me && hand.legal && <Moves key={`${hand.n}-${Object.values(hand.lines).flat().length}`} hand={hand} send={send} />}
      {hand && !result && hand.toAct === them && <p className="text-sm text-muted">{names[them]} to act.</p>}

      {result && (
        <section aria-label="Hand over" className="space-y-2 rounded-md border border-border p-3 text-sm">
          <p aria-live="polite">
            {result.says} <span className="font-mono">({signed(result.net[me])}bb for you)</span>
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {mine?.ready ? (
              <span className="text-muted">{theirs ? `Waiting for ${theirs.name} to deal the next hand…` : "Waiting for a player…"}</span>
            ) : (
              <button type="button" className="rounded-md border border-accent bg-surface-2 px-3 py-1.5 hover:bg-surface-3" onClick={() => send({ t: "next" })}>
                Next hand
              </button>
            )}
            {review?.st === "kept" && review.link ? (
              <Link to={review.link} className="underline">
                Kept in Analyze: open it there
              </Link>
            ) : (
              <button type="button" disabled={review?.st === "saving"} onClick={() => onReview(result.history)} className="rounded-md border border-border px-3 py-1.5 hover:bg-surface-2 disabled:opacity-50">
                {review?.st === "saving" ? "Keeping…" : "Review in Analyze"}
              </button>
            )}
          </div>
          {review?.st === "error" && (
            <p role="alert" className="text-danger">
              Not kept: {review.message}
            </p>
          )}
          <p className="text-xs text-muted">The solver grades the hand in Analyze, after it's over; nothing here looks at a solver while you play.</p>
        </section>
      )}
      {hand && <HandLog hand={hand} names={names} />}
      {view.seats.some(Boolean) && (
        <p className="text-xs text-muted">
          Score over {hand?.n ?? 0} hand{hand?.n === 1 ? "" : "s"}: {view.seats.map((s, i) => (s ? `${s.name} ${signed(s.score)}bb` : `seat ${i + 1} empty`)).join(" · ")}. Each hand starts both seats at {view.rules.stack}bb; {view.rules.clock}s a decision, then a time bank.
        </p>
      )}
    </div>
  );
}
