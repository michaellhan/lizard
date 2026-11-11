// "Review your misses": the graded decisions outside the mix (missesOf, worst first), one at a time. Each shows the spot as
// you faced it (your seat and cards, the board, the action before), what you played and how bad it was, the answer for your
// hand with why in a line, and what graded it (the grade's own provenance: nothing is solved here). One click opens the
// spot in Study on your own hand. Arrow keys move, Escape closes; the miss you're on is in the URL (`miss`).
import { useEffect, useMemo, useRef } from "react";
import { Link, useSearchParams } from "react-router";
import { PlayingCard } from "@/components/PlayingCard";
import { describe } from "@/solver/provenance";
import { VerdictTag } from "@/components/VerdictTag";
import type { DecisionRecord, HandRecord } from "@/data/db";
import type { Verdict } from "@/grading/grade";
import { importHand } from "@/hh/replay";
import { seatLabel } from "@/poker/seats";
import type { Street } from "@/poker/table";
import { decisionProvenance } from "@/features/review/fromAnalyze";
import { studyLinkAt, withMyHand } from "./analyze";
import { decisionIndex, lineBefore, roughActions, withParams } from "./leakDrill";

const pct = (x: number) => `${Math.round(x * 100)}%`;
const fmt = (x: number) => String(Math.round(x * 100) / 100);
const readHand = (text: string) => {
  try {
    return importHand(text);
  } catch {
    return null;
  }
};
const STREET_WORD: Record<string, string> = { preflop: "Preflop", flop: "Flop", turn: "Turn", river: "River" };

/** `k`: the card shown, 0-based (kept in range here). */
export function MissCards({ misses, byId, k, setK, onClose }: { misses: readonly DecisionRecord[]; byId: ReadonlyMap<string, HandRecord>; k: number; setK: (k: number) => void; onClose: () => void }) {
  const n = misses.length;
  const at = Math.min(Math.max(k, 0), Math.max(n - 1, 0));
  const d = misses[at];
  const hand = d ? byId.get(d.handId) : undefined;
  const box = useRef<HTMLElement>(null);

  // (focus comes to the card as it opens, so the keys work at once)
  useEffect(() => box.current?.focus({ preventScroll: false }), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) || t?.isContentEditable) return;
      if (e.key === "ArrowRight" && at < n - 1) setK(at + 1);
      else if (e.key === "ArrowLeft" && at > 0) setK(at - 1);
      else if (e.key === "Escape") onClose();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [at, n, setK, onClose]);

  return (
    <section ref={box} tabIndex={-1} aria-label="Your misses" className="mx-auto max-w-2xl space-y-3 panel p-4 text-sm outline-none">
      <div className="flex items-center gap-3">
        <h2 className="font-semibold">{n ? `Miss ${at + 1} of ${n}` : "Your misses"}</h2>
        {n > 1 && (
          <div aria-hidden className="h-1 flex-1 overflow-hidden rounded bg-surface-2">
            <div className="h-full bg-accent" style={{ width: `${((at + 1) / n) * 100}%` }} />
          </div>
        )}
        <button type="button" onClick={onClose} className="ml-auto rounded border border-border px-2 py-0.5 text-xs hover:bg-surface-2">
          Done
        </button>
      </div>
      {!d ? (
        <p className="text-muted">No misses here.</p>
      ) : (
        <Card key={d.id} d={d} hand={hand} />
      )}
      {n > 0 && (
        <div className="flex items-center gap-2 border-t border-border pt-3">
          <button type="button" disabled={at === 0} onClick={() => setK(at - 1)} className="rounded border border-border px-3 py-1 hover:bg-surface-2 disabled:opacity-40">
            ← Previous
          </button>
          <span className="flex-1 text-center text-xs text-muted">
            <span className="hidden sm:inline">← → to move · Esc to close</span>
          </span>
          {at < n - 1 ? (
            <button type="button" onClick={() => setK(at + 1)} className="rounded bg-accent px-3 py-1 font-medium text-bg">
              Next →
            </button>
          ) : (
            <button type="button" onClick={onClose} className="rounded bg-accent px-3 py-1 font-medium text-bg">
              Finish
            </button>
          )}
        </div>
      )}
    </section>
  );
}

/** What graded it, in a few words; the full line (how close to equilibrium, confidence) a click away, kept with the grade. */
function GradedBy({ d }: { d: DecisionRecord }) {
  const p = decisionProvenance(d);
  const full = describe(p);
  const short = d.source === "charts" ? "the preflop charts (by frequency, not a solve)" : full.split(" · ")[0];
  return (
    <details className="text-xs text-muted">
      <summary className="cursor-pointer hover:text-text">Graded by {short}</summary>
      <p className="mt-1">{full}</p>
    </details>
  );
}

/** Why the answer differs, in a line, from the answer's own numbers: by EV, what the best action is worth and what yours
 * gave up; by frequency (the charts), how often each is played. */
export function whyLine(d: DecisionRecord): string | null {
  const mix = d.mix ?? [];
  const you = d.matched ?? d.action;
  const mine = mix.find((x) => x[0] === you);
  if (!mix.length) return d.best ? `The answer most often ${d.best}${d.bestFreq != null ? ` (${pct(d.bestFreq)})` : ""}.` : null;
  const byEv = mix.every((x) => x[2] !== null);
  const top = [...mix].sort((a, b) => (byEv ? b[2]! - a[2]! : b[1] - a[1]))[0]!;
  const often = (f: number) => (f < 0.005 ? "never played" : `played ${pct(f)} of the time`);
  if (byEv && mine && top[0] !== mine[0]) {
    const gap = top[2]! - mine[2]!;
    return `${cap(top[0])} is worth ${fmt(top[2]!)}bb with this hand, ${fmt(gap)}bb more than ${mine[0]}, which is ${often(mine[1])}.`;
  }
  if (mine && top[0] !== mine[0]) return `With this hand ${top[0]} is ${often(top[1])} and ${mine[0]} is ${often(mine[1])}.`;
  if (!mine) return `With this hand ${top[0]} is ${often(top[1])}; ${you} isn't one of the answer's actions here.`;
  return null;
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function Card({ d, hand }: { d: DecisionRecord; hand: HandRecord | undefined }) {
  const [params] = useSearchParams();
  const r = useMemo(() => (hand ? readHand(hand.text) : null), [hand]);
  const street = d.street as Street;
  const i = decisionIndex(d);
  const line = r ? lineBefore(r, street, i) : null;
  const spot = r && hand ? studyLinkAt(r, street, i, hand.setup) : null;
  const study = spot ? withMyHand(spot, hand?.hole) : null;
  const mix = d.mix ?? [];
  const byEv = mix.length > 0 && mix.every((x) => x[2] !== null);
  const rough = roughActions(d);
  const said = line?.streets.filter((s) => s.says.length) ?? [];
  const you = d.matched ?? d.action;
  const best = mix.length ? [...mix].sort((a, b) => (byEv ? b[2]! - a[2]! : b[1] - a[1]))[0]![0] : null;
  const why = whyLine(d);
  const lost =
    d.evLossBb != null
      ? d.evLossBb > 0
        ? `−${d.roughEv ? "≈" : ""}${fmt(d.evLossBb)}bb${d.lossPct != null ? ` · ${d.lossPct}% of the pot` : ""}`
        : "no EV lost"
      : "";
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">
        {STREET_WORD[d.street] ?? d.street}
        {d.situation ? ` · ${d.situation}` : ""}
        {hand ? ` · ${hand.site} hand ${hand.number ? `#${hand.number}` : ""}${hand.played ? `, ${hand.played}` : ""}` : ""}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <span>
          You are <b>{hand ? seatLabel(d.pos, hand.players) : d.pos}</b>
        </span>
        <span className="flex gap-1" aria-label="Your cards">
          {(hand?.hole.match(/../g) ?? []).map((c) => (
            <PlayingCard key={c} card={c} size="lg" />
          ))}
        </span>
        {line && line.board.length > 0 && (
          <span className="flex gap-1" aria-label="The board">
            {line.board.map((c) => (
              <PlayingCard key={c} card={c} size="md" />
            ))}
          </span>
        )}
      </div>
      {said.length > 0 && (
        <ul aria-label="The action before" className="space-y-0.5 text-muted">
          {said.map((s) => (
            <li key={s.street}>
              <span className="mr-2 text-xs uppercase">{s.street}</span>
              {s.says.join(", ")}
            </li>
          ))}
        </ul>
      )}
      {!line && street !== "preflop" && <p className="text-xs text-warn">History unreadable: board not shown.</p>}

      <div role="group" aria-label="The answer" className="space-y-2 border-t border-border pt-3">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-base">
          <span>
            You played <b>{d.action}</b>
          </span>
          <VerdictTag v={d.verdict as Verdict} />
          {lost && <span className="text-sm text-muted">{lost}</span>}
        </p>
        {why && <p>{why}</p>}
        {mix.length > 0 && (
          <table aria-label="The answer for your hand" className="w-full max-w-sm text-left">
            <thead className="text-xs text-muted">
              <tr>
                <th className="pr-4 font-normal">Action</th>
                <th className="pr-4 text-right font-normal">Frequency</th>
                {byEv && <th className="text-right font-normal">EV</th>}
              </tr>
            </thead>
            <tbody>
              {mix.map(([name, f, ev]) => (
                <tr key={name} className={`border-t border-border ${name === best ? "text-accent" : ""} ${name === you ? "font-semibold" : ""}`}>
                  <td className="pr-4">
                    {name}
                    {name === you && <span className="ml-1 text-xs font-normal text-muted">(you)</span>}
                  </td>
                  <td className="pr-4 text-right tabular-nums">{pct(f)}</td>
                  {byEv && <td className="text-right tabular-nums">{ev == null ? "—" : `${rough.has(name) ? "≈" : ""}${fmt(ev)}bb`}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {d.note && <p className="text-xs text-muted">{d.note}</p>}
        <GradedBy d={d} />
      </div>
      <p className="flex flex-wrap items-center gap-3 text-sm">
        {study && (
          <Link to={study} className="rounded bg-surface-3 px-3 py-1.5 font-medium hover:bg-surface-2">
            Study this spot with your hand →
          </Link>
        )}
        <Link to={withParams(params, { hand: d.handId })} className="text-xs text-muted underline hover:text-text">
          Open the hand
        </Link>
      </p>
    </div>
  );
}
