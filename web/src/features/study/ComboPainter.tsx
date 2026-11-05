// The range builder's open hand: each combo of one class with its own mix. A combo blocked by the board or out of the
// range can't be painted and isn't counted. Typing an action's share and leaving the box (or Enter) is one change,
// one undo step; the rest of the combo's mix keeps its proportions (features/ranges/build.ts brush).
import { useState } from "react";
import { pct } from "@/components/actions";
import { ProvenanceBadge } from "@/components/ProvenanceBadge";
import type { Provenance } from "@/solver/types";
import type { ComboSlot } from "@/features/ranges/build";

/** A share in percent, committed once: on leaving the box or on Enter. Escape puts it back. */
function ShareInput({ label, value, disabled, onCommit }: { label: string; value: number; disabled: boolean; onCommit: (t: number) => void }) {
  const shown = String(Number((value * 100).toFixed(1)));
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    setDraft(null);
    const x = Number(draft);
    if (!draft.trim() || !Number.isFinite(x) || draft === shown) return;
    onCommit(Math.min(100, Math.max(0, x)) / 100);
  };
  return (
    <input
      type="number"
      inputMode="decimal"
      min={0}
      max={100}
      step={1}
      aria-label={label}
      value={draft ?? shown}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        else if (e.key === "Escape") setDraft(null);
      }}
      className="w-14 rounded border border-border bg-surface-2 px-1 py-0.5 text-right font-mono disabled:opacity-40"
    />
  );
}

export function ComboPainter({
  cls,
  slots,
  mixOf,
  own,
  mean,
  names,
  colors,
  provenance,
  locked,
  onSet,
  onClear,
  onClose,
}: {
  cls: string;
  slots: readonly ComboSlot[];
  /** a combo's mix as painted */
  mixOf: (combo: string) => readonly number[];
  own: (combo: string) => boolean;
  /** the class's mix over its live combos */
  mean: readonly number[];
  names: readonly string[];
  colors: readonly string[];
  provenance: Provenance;
  locked: boolean;
  onSet: (combo: string, a: number, t: number) => void;
  onClear: (combo: string) => void;
  onClose: () => void;
}) {
  const live = slots.filter((s) => s.state === "live").length;
  const blocked = slots.filter((s) => s.state === "blocked").length;
  return (
    <section aria-label={`${cls} combos`} className="space-y-2 rounded-lg border border-border bg-surface p-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <b className="font-mono text-sm">{cls}</b>
        <span className="text-muted">
          {live} of {slots.length - blocked} legal combos in the range
          {blocked > 0 && ` · ${blocked} blocked by the board`}
        </span>
        <ProvenanceBadge p={provenance} />
        <button type="button" onClick={onClose} className="ml-auto rounded border border-border px-2 py-0.5 hover:bg-surface-2">
          Close combos
        </button>
      </div>
      <p aria-label={`${cls} as painted`}>
        Over its {live} live combo{live === 1 ? "" : "s"}, by reach: {names.map((n, a) => `${n} ${pct(mean[a], 1)}`).join(" · ")}
      </p>
      {locked ? <p className="text-warn">Locked: unlock the hand to paint its combos.</p> : <p className="text-muted">A combo's share of each action, in %: the rest of its mix keeps its proportions. Each change is one undo step.</p>}
      <ul className="space-y-1.5">
        {slots.map(({ combo, state, row }) => (
          <li key={combo} className="border-t border-border/60 pt-1.5">
            {state !== "live" ? (
              <p className="text-muted">
                <span className="font-mono">{combo}</span> {state === "blocked" ? "blocked by the board: not painted, not counted" : "not in this range: not painted, not counted"}
              </p>
            ) : (
              <div role="group" aria-label={combo} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="w-24 font-mono">
                  {combo}
                  {row![1] < 0.999 && <span className="text-faint"> ({pct(row![1], 0)})</span>}
                </span>
                {names.map((n, a) => (
                  <label key={n} className="inline-flex items-center gap-1">
                    <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: colors[a] }} />
                    {n}
                    <ShareInput label={`${combo} ${n} %`} value={mixOf(combo)[a] ?? 0} disabled={locked} onCommit={(t) => onSet(combo, a, t)} />
                  </label>
                ))}
                {own(combo) && (
                  <button type="button" aria-label={`${combo} back to the class`} disabled={locked} onClick={() => onClear(combo)} className="rounded border border-border px-1.5 py-0.5 hover:bg-surface-2 disabled:opacity-40">
                    Back to class
                  </button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
