// A playing card: rank and suit symbol in the theme's four-color deck (--color-suit-*); face down where `card` is null.
const SUIT: Record<string, { sym: string; name: string; tone: string }> = {
  s: { sym: "♠", name: "spades", tone: "text-suit-s" },
  h: { sym: "♥", name: "hearts", tone: "text-suit-h" },
  d: { sym: "♦", name: "diamonds", tone: "text-suit-d" },
  c: { sym: "♣", name: "clubs", tone: "text-suit-c" },
};
const RANK_NAME: Record<string, string> = { A: "ace", K: "king", Q: "queen", J: "jack", T: "ten" };

export function PlayingCard({ card, size = "md" }: { card: string | null; size?: "sm" | "md" | "lg" }) {
  const box = size === "sm" ? "h-8 w-6 text-xs" : size === "lg" ? "h-14 w-10 text-base" : "h-11 w-8 text-sm";
  if (!card)
    return <span role="img" aria-label="face-down card" className={`inline-block ${box} rounded border border-border bg-[repeating-linear-gradient(45deg,var(--color-surface-3)_0_4px,var(--color-surface-2)_4px_8px)]`} />;
  const s = SUIT[card[1]!]!;
  const r = card[0]!;
  return (
    <span
      role="img"
      aria-label={`${RANK_NAME[r] ?? r} of ${s.name}`}
      className={`inline-flex ${box} flex-col items-center justify-center rounded border border-border bg-surface-2 font-semibold leading-none ${s.tone}`}
    >
      <span>{r === "T" ? "10" : r}</span>
      <span aria-hidden>{s.sym}</span>
    </span>
  );
}
