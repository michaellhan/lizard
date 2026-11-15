// The Combos tab's "?": how a combo count is worked out by hand, and a few questions worked through. The examples share one
// hand and flop, and each says the range, the state and the category it counts, so ComboHelp.test.tsx checks every
// stated answer against combos.ts's own count.
import type { CategoryId, ComboState } from "./combos";

export const EXAMPLE_HERO = ["As", "Kc"] as const;
export const EXAMPLE_FLOP = ["5c", "Ad", "Jh"] as const;

export interface ComboExample {
  q: string;
  steps: string[];
  answer: number;
  /** what the answer counts, for the test: the range, the combos' state and (where a category is asked) the category */
  check: { range: string; state: ComboState; cat?: CategoryId };
}

export const COMBO_EXAMPLES: ComboExample[] = [
  {
    q: "How many AA combos can they have?",
    steps: ["Aces left: A♥ and A♣. Yours is A♠ and the flop has A♦.", "2 live aces make 2 × 1 ÷ 2 = 1 combo: A♥A♣ (6 with a full deck)."],
    answer: 1,
    check: { range: "AA", state: "live" },
  },
  {
    q: "How many AJ offsuit combos can they have?",
    steps: [
      "Live aces: A♥ A♣ (2). Live jacks: J♠ J♦ J♣ (3), as J♥ is on the flop.",
      "2 × 3 = 6 AJ combos in all.",
      "Suited ones need a suit live in both: only clubs (A♣J♣), so 1 is suited and 6 − 1 = 5 are offsuit (12 with a full deck).",
    ],
    answer: 5,
    check: { range: "AJo", state: "live" },
  },
  {
    q: "How many of their KQ suited combos does your hand take out?",
    steps: ["Your K♣ is in one of them: K♣Q♣. So 1.", "They can still have the other 3: K♠Q♠, K♥Q♥ and K♦Q♦."],
    answer: 1,
    check: { range: "KQs", state: "hand" },
  },
  {
    q: "Their range is AJo, AJs, A5s and KQo. How many two-pair combos can they have?",
    steps: [
      "Two pair needs both of their cards to pair the flop: AJ (A and J) and A5 (A and 5). KQ pairs nothing.",
      "AJo: 5, as above. AJs: 1 (A♣J♣).",
      "A5s: live aces ♥ ♣, live fives ♠ ♥ ♦ (5♣ is on the flop). Hearts is the only suit in both, so 1 (A♥5♥).",
      "5 + 1 + 1 = 7.",
    ],
    answer: 7,
    check: { range: "AJo,AJs,A5s,KQo", state: "live", cat: "twopair" },
  },
];

const RULES: [string, string][] = [
  ["Pocket pair (QQ)", "6: 4 × 3 ÷ 2"],
  ["Suited (AKs)", "4: one a suit"],
  ["Offsuit (AKo)", "12: 4 × 4 − 4"],
  ["Both (AK)", "16"],
];

const Cards = ({ cards }: { cards: readonly string[] }) => (
  <span className="font-mono">{cards.map((c) => c[0] + { s: "♠", h: "♥", d: "♦", c: "♣" }[c[1]!]!).join(" ")}</span>
);

export function ComboHelp() {
  return (
    <section aria-label="How combos are counted" className="space-y-3 rounded-md bg-surface-2 p-3 text-sm">
      <div className="space-y-1">
        <h3 className="font-medium">With a full deck</h3>
        <table className="text-xs">
          <tbody>
            {RULES.map(([k, v]) => (
              <tr key={k}>
                <td className="py-0.5 pr-4 text-muted">{k}</td>
                <td className="py-0.5 font-mono">{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="space-y-1">
        <h3 className="font-medium">Cards you can see take combos away</h3>
        <p>They can&apos;t hold a card that&apos;s in your hand or on the flop. Count the cards left of each rank (the live ones):</p>
        <ul className="list-disc space-y-0.5 pl-5">
          <li>
            A pair with <span className="font-mono">n</span> live cards: <span className="font-mono">n × (n − 1) ÷ 2</span>. With 4, 3, 2 or 1 left: 6, 3, 1, 0.
          </li>
          <li>
            Two ranks with <span className="font-mono">a</span> and <span className="font-mono">b</span> live: <span className="font-mono">a × b</span> in all. The suited ones are the suits live in both; the rest are offsuit.
          </li>
          <li>A category (top pair, two pair…) is those counts added up over the classes in their range that make it. A class at 50% counts half.</li>
        </ul>
      </div>
      <div className="space-y-1">
        <h3 className="font-medium">The two questions</h3>
        <ul className="list-disc space-y-0.5 pl-5">
          <li>
            <span className="font-medium">Can they have</span>: only combos with none of your cards and none of the flop&apos;s.
          </li>
          <li>
            <span className="font-medium">Your hand takes out</span>: the combos in their range that hold one of your cards (one that also holds a flop card is the flop&apos;s, not yours).
          </li>
        </ul>
      </div>
      <div className="space-y-2">
        <h3 className="font-medium">
          Worked examples: you hold <Cards cards={EXAMPLE_HERO} />, the flop is <Cards cards={EXAMPLE_FLOP} />
        </h3>
        <ol className="space-y-2">
          {COMBO_EXAMPLES.map((e, i) => (
            <li key={e.q} className="space-y-1">
              <p>
                <span className="text-muted">{i + 1}.</span> {e.q}
              </p>
              <details className="pl-4">
                <summary className="cursor-pointer text-accent">Solution</summary>
                <div className="space-y-0.5 pt-1">
                  {e.steps.map((s) => (
                    <p key={s}>{s}</p>
                  ))}
                  <p className="font-medium">Answer: {e.answer}</p>
                </div>
              </details>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
