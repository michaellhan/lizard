// A mix as a bar, with its numbers as its accessible name: a flop report's row and a turn report's.
import { actionFills, pct } from "@/components/actions";

export function MixBar({ freqs, cols }: { freqs: readonly number[] | null; cols: readonly string[] }) {
  if (!freqs) return <span className="text-xs text-faint">not stored</span>;
  const colors = actionFills(cols);
  return (
    <span className="flex h-3 w-full min-w-24 gap-px overflow-hidden rounded-sm bg-surface-3" aria-label={cols.map((c, i) => `${c} ${pct(freqs[i])}`).join(", ")} role="img">
      {freqs.map((x, i) => (x > 0.001 ? <i key={i} className="block h-full" style={{ width: `${(x * 100).toFixed(2)}%`, background: colors[i] }} /> : null))}
    </span>
  );
}
