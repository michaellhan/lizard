// A tournament answer's own numbers (advisor.py _tournament_info, _bounty_info): the actor's prize equity, the bubble
// factor against each opponent (what a chip lost to them costs over what one won gains), and in a bounty tournament
// what busting each covered opponent is worth. The badge says which model the answer is in (provenance.ts). Every
// pair's bubble factor (the answer gives the actor's only) is worked out in the page from the setup (tournaments/icm.ts).
import { BubbleTable } from "@/features/tournaments/BubbleTable";
import type { BubbleTable as Pairs } from "@/features/tournaments/icm";

export interface TournamentInfo {
  equity_share?: number;
  /** null: a chip won gains nothing (a seat all but locked up, or every player left already paid), so no ratio */
  bubble_factors?: Record<string, number | null>;
  note?: string;
  bounties?: {
    format?: string;
    pool?: number;
    bounties?: Record<string, number>;
    you_bust?: Record<string, { bb?: number; cash?: number; in_hand?: boolean }>;
    bust_you?: Record<string, number>;
  };
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

/** out: the seats that have folded (bust_you lists every seat that covers the actor, in the hand or not); pairs: every
 * pair's bubble factor, from the spot's setup. */
export function TournamentPanel({ t, actor, out = [], pairs }: { t: TournamentInfo; actor: string | undefined; out?: readonly string[]; pairs?: Pairs | null }) {
  const who = actor ?? "The player to act";
  const bf = Object.entries(t.bubble_factors ?? {});
  const busts = Object.entries(t.bounties?.you_bust ?? {}).filter(([, v]) => v.in_hand && typeof v.bb === "number");
  const covered = Object.keys(t.bounties?.bust_you ?? {}).filter((p) => !out.includes(p));
  const winnerTakesAll = (t.note ?? "").includes("winner-take-all");
  const assumed = (t.note ?? "").startsWith("tournament: no payouts");
  return (
    <div role="group" aria-label="Tournament" className="space-y-1 rounded-md border border-border bg-surface-2 px-3 py-2 text-xs">
      {typeof t.equity_share === "number" && (
        <p>
          <span className="font-medium">Prize equity:</span> {who} {pct(t.equity_share)} of what's left to pay
          {winnerTakesAll ? " (winner takes all: that's their share of the chips)" : ""}.
        </p>
      )}
      {bf.length > 0 && !winnerTakesAll && (
        <p>
          <span className="font-medium">Bubble factors</span> <span className="text-muted">(a chip {who} loses to them costs this many chips won):</span>{" "}
          {bf.every(([, v]) => v === null)
            ? "none: a chip won from anyone gains nothing."
            : bf.map(([p, v]) => `${p} ${v === null ? "(a chip won gains nothing)" : v.toFixed(2)}`).join(" · ")}
        </p>
      )}
      {pairs && !winnerTakesAll && (
        <details>
          <summary className="cursor-pointer text-muted hover:text-text">Every pair</summary>
          <div className="mt-1.5">
            <BubbleTable table={pairs} actor={actor} />
          </div>
        </details>
      )}
      {(busts.length > 0 || covered.length > 0) && (
        <p>
          <span className="font-medium">Bounties</span>{" "}
          {busts.length > 0 ? (
            <>
              <span className="text-muted">(busting them, for {who}):</span>{" "}
              {busts.map(([p, v]) => `${p} ${v.bb}bb${typeof v.cash === "number" ? ` (pays ${v.cash})` : ""}`).join(" · ")}.
            </>
          ) : (
            `${who} covers nobody still in the hand who carries a bounty.`
          )}
          {covered.length > 0 ? ` Covered by ${covered.join(", ")}.` : ""}
        </p>
      )}
      <p className="text-muted">{assumed ? "Where EVs show, they're chips, the bounties priced in chips." : "Where EVs show, they're in prize equity, as chips worth as much."}</p>
    </div>
  );
}
