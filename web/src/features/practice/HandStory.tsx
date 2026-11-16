// The hand up to a drill's decision (drills.ts `story`, liveDeal.ts `liveStory`, preflop.ts `pfStory`), shared by every
// drill: the streets before it a line each, and the street you act on.
import type { Story } from "./drills";

const fmtBb = (x: number) => String(Math.round(x * 100) / 100);

/** The hand up to your decision, a street a line, the street you act on last and marked: its pot, its action so far,
 * who acts, the price of a call and what they have behind. `bare`: the marked line says only the action and who acts,
 * for a page that says the pot and the price elsewhere (Review's retry: the pot by the board, the price on Call). */
export function HandStory({ story: { steps, now }, bare = false }: { story: Story; bare?: boolean }) {
  return (
    <ol aria-label="The hand so far" className="space-y-1 text-sm">
      {steps.map((s) => (
        <li key={s.street} className="flex gap-3">
          <span className="w-16 shrink-0 pt-0.5 text-xs text-muted">{s.street}</span>
          <span>
            {s.pot != null && <span className="text-muted">pot {fmtBb(s.pot)}bb · </span>}
            {s.text}
          </span>
        </li>
      ))}
      <li aria-current="step" className="flex gap-3 rounded border-l-2 border-accent bg-surface-2 py-1 pr-2">
        <span className="w-16 shrink-0 pl-2 pt-0.5 text-xs font-medium text-accent">{now.street}</span>
        <span>
          {!bare && <span className="text-muted">pot {fmtBb(now.pot)}bb · </span>}
          {now.line && <>{now.line} · </>}
          <span className="font-medium">
            {now.hero} to act{!bare && now.toCall > 0 ? `, ${fmtBb(now.toCall)}bb to call` : ""}
          </span>
          {!bare && now.behind != null && <span className="text-muted"> · {fmtBb(now.behind)}bb behind</span>}
        </span>
      </li>
    </ol>
  );
}
