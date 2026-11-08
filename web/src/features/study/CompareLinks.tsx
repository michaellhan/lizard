// "Compare this spot" (ROADMAP Phase 8): the same spot and line with one thing changed, opened on the Compare page.
// A tournament in chip EV; preflop, the charts against the preflop solve (or the solve against the charts); postflop
// (where the rake is taken), a raked pot without rake or an unraked one with 5% capped at 3bb; and the table at
// another stack (seats with a stack of their own keep it); and "Pin as A": this spot kept for the visit, so any other
// spot links to a comparison with it (compare/pin.ts). Where the player to act can bet after the flop heads-up, another bet menu
// for this street (both players bet from a street's menu): the spot with those sizes, two size menus compared.
import { useState } from "react";
import { Link } from "react-router";
import { compareLink } from "@/features/compare/compare";
import { usePin } from "@/features/compare/pin";
import { LIMITS, setupProblems, tidySetup, type SizeStreet, type SpotSetup } from "@/features/solve/setup";
import type { AdvisorActionStat } from "@/solver/protocol";
import { chipHand } from "./ChipCompare";
import { fromSearch, toSearch, withPf, type StudyHand } from "./studyState";

const withSetup = (h: StudyHand, s: SpotSetup): StudyHand => {
  const out = { ...h };
  delete out.setup;
  const t = tidySetup(s);
  return t ? { ...out, setup: t } : out;
};

/** The variants offered for a spot: [what changes, spot B]. */
export function variantsOf(h: StudyHand): [string, StudyHand][] {
  const s = h.setup ?? {};
  if (s.tournament) return [["in chip EV", chipHand(h)]];
  // (a tournament's preflop isn't solved: the solve plays chips)
  if (!h.board) return h.pf === "solver" ? [["against the charts", withPf(h, "charts")]] : [["against the preflop solve", withPf(h, "solver")]];
  return s.rake ? [["without rake", withSetup(h, { ...s, rake: undefined, rakeCap: undefined })]] : [["with 5% rake, capped at 3bb", withSetup(h, { ...s, rake: 5, rakeCap: 3 })]];
}

/** A bet menu typed as "50, 100" or "50 100%": sorted, distinct. */
export const menuOf = (t: string) => [...new Set(t.split(/[\s,;/]+/).filter(Boolean).map((x) => Number(x.replace(/%$/, ""))))].sort((x, y) => x - y);

export const SAME_MENU = "the same menu as this spot's";

/** The spot with another bet menu on `street` (null where it's the same menu or can't be solved), and what's wrong. */
export function withMenu(h: StudyHand, street: SizeStreet, now: number[], typed: string): { b: StudyHand | null; problem: string | null } {
  const xs = menuOf(typed);
  if (!xs.length) return { b: null, problem: `type ${street} bet sizes, % of the pot` };
  if (xs.some((x) => !Number.isFinite(x))) return { b: null, problem: "sizes are numbers, % of the pot" };
  // (first: a library's menu can be longer than a typed one may be, and what the field starts on isn't a mistake)
  if (xs.join() === [...now].sort((x, y) => x - y).join()) return { b: null, problem: SAME_MENU };
  const s = h.setup ?? {};
  const next = { ...s, sizes: { ...s.sizes, [street]: xs } };
  const problem = setupProblems(h.players, next).find((p) => p.includes(`${street} bet sizes`));
  if (problem) return { b: null, problem };
  return { b: withSetup(h, next), problem: null };
}

/** Where the player to act can bet after the flop (check is an option: no bet yet this street), heads-up (a multiway
 * solve bets its own fixed sizes), the street and its menu now: the spot's own sizes for it, else the bets the answer
 * offers (% of the pot, as the engine names them). */
export function betMenuOf(h: StudyHand, res: { street?: string; multiway?: boolean; actions?: AdvisorActionStat[] }): { street: SizeStreet; now: number[] } | null {
  const street = res.street;
  if ((street !== "flop" && street !== "turn" && street !== "river") || res.multiway) return null;
  const acts = res.actions ?? [];
  if (!acts.some((a) => a.action === "check")) return null;
  const now = h.setup?.sizes?.[street] ?? acts.flatMap((a) => (/^bet \d/.test(a.action) ? [parseFloat(a.action.slice(4))] : []));
  return { street, now };
}

/** bets: where the player to act can bet after the flop, the street and its menu now (% of the pot). */
export function CompareLinks({ hand, min, max, bets }: { hand: StudyHand; min: number; max: number; bets?: { street: SizeStreet; now: number[] } | null }) {
  const [typed, setTyped] = useState(() => String(hand.stack > 2 * min ? Math.round(hand.stack / 2) : Math.min(max, hand.stack * 2)));
  const n = Number(typed);
  const ok = Number.isFinite(n) && n >= min && n <= max && n !== hand.stack;
  const link = "underline hover:text-text";
  const pin = usePin((s) => s.pin);
  const setPin = usePin((s) => s.setPin);
  const here = toSearch(hand);
  const pinned = pin && pin !== here ? fromSearch(pin) : null;
  return (
    <nav aria-label="Compare this spot" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
      <span>Compare this spot:</span>
      {variantsOf(hand).map(([label, b]) => (
        <Link key={label} to={compareLink(hand, b)} className={link}>
          {label}
        </Link>
      ))}
      <span className="flex items-center gap-1">
        at
        <input
          aria-label="Another stack"
          type="number"
          inputMode="decimal"
          step="any"
          min={min}
          max={max}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          aria-invalid={!ok}
          className="w-16 rounded border border-border bg-surface px-1.5 py-0.5 text-text"
        />
        bb{" "}
        {ok ? (
          <Link to={compareLink(hand, { ...hand, stack: n })} className={link}>
            compare
          </Link>
        ) : (
          <span title={`Another stack, ${min}–${max}bb`}>(another stack, {min}–{max}bb)</span>
        )}
      </span>
      {bets && <MenuLink hand={hand} street={bets.street} now={bets.now} />}
      {pinned && (
        <Link to={compareLink(pinned, hand)} className={link} title="The spot you pinned as A, this one as B">
          with the pinned spot
        </Link>
      )}
      <button
        type="button"
        aria-pressed={pin === here}
        onClick={() => setPin(pin === here ? null : here)}
        title={pin === here ? "Pinned: any other spot links to a comparison with this one" : "Keep this spot as A, to compare any other spot with it"}
        className="rounded border border-border px-2 py-0.5 hover:bg-surface-2"
      >
        {pin === here ? "Pinned as A · unpin" : "Pin as A"}
      </button>
    </nav>
  );
}

function MenuLink({ hand, street, now }: { hand: StudyHand; street: SizeStreet; now: number[] }) {
  const [typed, setTyped] = useState(() => now.join(", "));
  const { b, problem } = withMenu(hand, street, now, typed);
  return (
    <span className="flex items-center gap-1">
      with {street} bets
      <input
        aria-label={`Another ${street} bet menu`}
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        aria-invalid={!b && problem !== SAME_MENU}
        title={`Up to ${LIMITS.sizes} sizes, ${LIMITS.sizePct[0]}–${LIMITS.sizePct[1]}% of the pot`}
        className="w-24 rounded border border-border bg-surface px-1.5 py-0.5 text-text"
      />
      %{" "}
      {b ? (
        <Link to={compareLink(hand, b)} className="underline hover:text-text" title="This spot with its menu as A, the menu typed as B">
          compare menus
        </Link>
      ) : (
        <span>({problem})</span>
      )}
    </span>
  );
}
