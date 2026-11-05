// How much of a bet or raise is value and how much bluff, by combos, from the answer's own combo rows: each row's
// reach, its mix and its equity against the other range at this node. The answer doesn't hold the hands that would
// continue (that's the next node's mix), so the test is the one its numbers can carry: a combo is value when it has
// more than its fair share of the pot (1 / players) against the whole range. Called by everyone, a bet of b into a pot
// p returns e(p + nb) - b against e p for checking it down, which is more when e > 1 / n, whatever the size; a raise
// over a call gives the same line. Nothing here is guessed: an answer without equities gets a reason and no split.
import { kindOf, pct } from "@/components/actions";
import type { AdvisorResponse, Breakdown, ComboRow } from "@/solver/protocol";
import type { ResultSource } from "@/solver/types";
import { runoutText } from "./breakdown";

export const isAggressive = (name: string): boolean => ["bet", "raise", "all-in"].includes(kindOf(name));

/** What can't carry a hand-by-hand reading, and why in words (the preflop charts and the rules must never read as solved). */
const NOT_SOLVED: Partial<Record<ResultSource, string>> = {
  charts: "the preflop charts, not a solve",
  "preflop-solve": "the preflop solve, which works by hand class and holds no equities against a range",
  rules: "the betting rules, not a solve",
  equity: "an equity estimate, not a solve",
  unknown: "a source it doesn't name",
};

/** Why an answer from this source can't be read hand by hand, or null where it can. */
export const whyNotSolved = (source: ResultSource): string | null => {
  const what = NOT_SOLVED[source];
  return what ? `this answer came from ${what}` : null;
};

/** Below this many combos an action is too rare to split (the Advisor's own cut for an action's EV). */
const MIN_COMBOS = 0.05;

export interface Tally {
  value: number;
  bluff: number;
}

export interface ValueBluff extends Tally {
  kind: "split";
  /** the action's name */
  name: string;
  /** the equity a combo has to beat: its fair share of the pot */
  line: number;
  /** combos with no equity in the answer, in neither count */
  unknown: number;
  /** the same counts by category id */
  made: Record<string, Tally>;
  draws: Record<string, Tally>;
}

export type ValueBluffAnswer = ValueBluff | { kind: "none"; why: string };

export const valueShare = (t: Tally): number | null => (t.value + t.bluff > 0 ? t.value / (t.value + t.bluff) : null);

const add = (m: Record<string, Tally>, id: string | undefined, part: keyof Tally, c: number) => {
  if (id === undefined) return;
  (m[id] ??= { value: 0, bluff: 0 })[part] += c;
};

/** Action `a` split into value and bluff, or why it can't be. */
export function valueBluff(res: AdvisorResponse, bd: Breakdown, a: number, source: ResultSource): ValueBluffAnswer {
  const name = bd.actions[a] ?? "";
  const none = (why: string): ValueBluffAnswer => ({ kind: "none", why: `No value and bluff split: ${why}.` });
  const why = whyNotSolved(source);
  if (why) return none(why);
  if (!isAggressive(name)) return { kind: "none", why: "Value and bluff describe a bet or raise, the hands the other side can still fold to." };
  const players = 1 + bd.villains.length;
  const line = 1 / players;
  const out: ValueBluff = { kind: "split", name, line, value: 0, bluff: 0, unknown: 0, made: {}, draws: {} };
  const made = res.categories?.made ?? [];
  const draws = res.categories?.draws ?? [];
  const rows = Object.values(res.combos ?? {}).flat() as ComboRow[];
  const noEquities = players > 3 ? "a 4-way answer before the river holds no equities to test the hands with" : "this answer holds no equities to test the hands with";
  if (!rows.length) return none(noEquities);
  for (const row of rows) {
    const c = row[1] * (row[2][a] ?? 0);
    const eq = row[4];
    if (eq == null) {
      out.unknown += c;
      continue;
    }
    const part = eq > line ? "value" : "bluff";
    out[part] += c;
    add(out.made, made[row[5]]?.[0], part, c);
    add(out.draws, draws[row[6]]?.[0], part, c);
  }
  const known = out.value + out.bluff;
  if (known + out.unknown < MIN_COMBOS) return none(`the answer has hardly any combos that ${name}`);
  if (known < MIN_COMBOS) return none(noEquities);
  return out;
}

/** The definition, in words, for this answer. */
export function valueBluffText(s: ValueBluff, bd: Breakdown, res: AdvisorResponse): string {
  const line = pct(s.line, s.line === 0.5 ? 0 : 1);
  const heads = bd.villains.length === 1;
  const them = heads ? `${bd.villains[0]!.who}'s whole range` : bd.villains.length === 2 ? "both other ranges" : "the other ranges";
  const everyone = heads ? `${bd.villains[0]!.who} calls with everything` : "everyone calls with everything";
  const facing = (res.to_call_bb ?? 0) > 0;
  return [
    `Value: over ${line} equity against ${them} at this node, so before rake the ${facing ? "raise" : "bet"} earns more than ${facing ? "calling" : "checking"} even if ${everyone}.`,
    `Bluff: ${line} or less, so it needs folds.`,
    `Equities are all-in, ${runoutText(bd)}.`,
    `The answer doesn't hold which hands would continue. Those are stronger than the whole range, so some of this value is thinner than it looks.`,
    `It's a yardstick on the answer's equities: the solver doesn't label hands.`,
    res.tournament ? "In a tournament this test is in chips, not prizes." : "",
  ]
    .filter(Boolean)
    .join(" ");
}
