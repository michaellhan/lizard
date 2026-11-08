// Both players' ranges side by side (sideBySideLink.ts): each grid's heading says whose range it is, the player to act's or an
// opponent's, with its totals and the badge of the answer they come from. The opponents' ranges are the same answer's
// (advisor.py _study_range), so they carry its provenance: a partial answer's are partial, a rules answer's are rules.
import { ProvenanceBadge } from "@/components/ProvenanceBadge";
import { RangeMatrix } from "@/components/RangeMatrix";
import { pct } from "@/components/actions";
import type { OpponentRange } from "@/solver/protocol";
import type { Provenance } from "@/solver/types";

/** A grid's heading: "BB's range, to act", the range's totals, and where they came from. */
export function RangeHeading({ seat, role, totals, provenance }: { seat: string; role: string; totals: string; provenance: Provenance }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      <h3 className="text-base font-semibold">
        {seat}'s range<span className="font-normal text-muted">, {role}</span>
      </h3>
      <span className="text-muted">{totals}</span>
      <span className="flex-1" />
      <ProvenanceBadge p={provenance} quiet />
    </div>
  );
}

/** An opponent's range in words: its combos and its equity against the player to act. */
export const oppTotals = (o: OpponentRange) => `${o.combos?.toFixed(1) ?? "–"} combos${o.eq != null ? ` · equity ${pct(o.eq)}` : ""}`;

/** The opponent's range beside the player to act's; in a multiway pot, buttons pick which opponent. */
export function OpponentSide({
  actor,
  opps,
  index,
  onPick,
  provenance,
  selected,
  onSelect,
}: {
  actor: string;
  opps: OpponentRange[];
  index: number;
  onPick: (seat: string) => void;
  provenance: Provenance;
  selected: string | null;
  onSelect: (cls: string) => void;
}) {
  const opp = opps[index]!;
  return (
    <section aria-label={`${opp.seat}'s range`} className="space-y-2">
      {opps.length > 1 && (
        <div role="group" aria-label={`Which opponent's range beside ${actor}'s`} className="flex flex-wrap items-center gap-1 text-sm">
          <span aria-hidden className="text-muted">
            Beside {actor}:
          </span>
          {opps.map((o, i) => (
            <button
              key={`${o.seat}-${i}`}
              type="button"
              aria-pressed={i === index}
              onClick={() => onPick(o.seat)}
              className={`rounded border border-border px-2 py-0.5 ${i === index ? "bg-surface-3 font-semibold" : "text-muted hover:bg-surface-2"}`}
            >
              {o.seat}
            </button>
          ))}
        </div>
      )}
      <RangeHeading seat={opp.seat} role="the opponent" totals={oppTotals(opp)} provenance={provenance} />
      <RangeMatrix cells={opp.grid.cells} actions={[]} colors={[]} selected={selected} onSelect={onSelect} view="weight" caption={`${opp.seat} range`} />
    </section>
  );
}
