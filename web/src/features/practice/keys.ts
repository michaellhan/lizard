// Practice's keys, one scheme for a full hand at one table or several and for the drills, so a session can be played
// from the keyboard alone. Options go by what they are (F, C/X, R/B, A) so a key stays put when the order changes, or by
// place (1–9). KEY_HELP is what the page's key list (?) shows.
import { kindOf } from "@/components/actions";

/** The option a key takes among `actions` (each option's action name, in the order shown), or -1. 1–9 by place; F fold;
 * C or X check or call; R or B the smallest bet or raise, Shift with it the largest; A all-in. */
export function optionFromKey(key: string, actions: readonly string[]): number {
  if (/^[1-9]$/.test(key)) {
    const i = Number(key) - 1;
    return i < actions.length ? i : -1;
  }
  const kinds = actions.map(kindOf);
  const k = key.toLowerCase();
  if (k === "f") return kinds.indexOf("fold");
  if (k === "c" || k === "x") return kinds.findIndex((a) => a === "check" || a === "call");
  if (k === "a") return kinds.indexOf("all-in");
  if (k === "r" || k === "b") {
    // (in the order shown, the sizes go up; an all-in counts as the largest only where there's no other bet or raise)
    const agg = kinds.flatMap((a, i) => (a === "bet" || a === "raise" ? [i] : []));
    const pool = agg.length ? agg : kinds.flatMap((a, i) => (a === "all-in" ? [i] : []));
    if (!pool.length) return -1;
    return key === "R" || key === "B" ? pool[pool.length - 1]! : pool[0]!;
  }
  return -1;
}

/** "Next hand": Enter, Space or N. */
export const isNextKey = (key: string) => key === "Enter" || key === " " || key.toLowerCase() === "n";

export type KeyRow = { keys: string[]; what: string };
export type KeyGroup = { title: string; rows: KeyRow[] };

export const KEY_HELP: readonly KeyGroup[] = [
  {
    title: "Your move",
    rows: [
      { keys: ["1", "–", "9"], what: "Your options, in the order shown" },
      { keys: ["F"], what: "Fold" },
      { keys: ["C", "X"], what: "Check or call" },
      { keys: ["R", "B"], what: "The smallest bet or raise" },
      { keys: ["Shift+R"], what: "The largest bet or raise" },
      { keys: ["A"], what: "All-in" },
      { keys: ["H"], what: "Hint: what the spot is" },
      { keys: ["Shift+H"], what: "Reveal the answer (that decision isn't graded)" },
    ],
  },
  {
    title: "After you act",
    rows: [
      { keys: ["Enter", "Space", "N"], what: "Next hand (several tables: deal the finished ones)" },
      { keys: ["O"], what: "Run it out or show hands" },
      { keys: ["K"], what: "Keep the finished hand in Analyze" },
      { keys: ["G"], what: "Open or close the range grid of your last decision" },
    ],
  },
  {
    title: "The page",
    rows: [
      { keys: ["S"], what: "Several tables: go to the next one waiting for you" },
      { keys: ["E"], what: "Edit the game: open the setup and go to its first field" },
      { keys: ["D"], what: "Switch between Full hands and Drills" },
      { keys: ["Esc"], what: "Leave a field, so these keys work again" },
      { keys: ["?"], what: "Show or hide this list" },
    ],
  },
];
