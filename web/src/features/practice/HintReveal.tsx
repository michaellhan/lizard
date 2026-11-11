// Hint, Reveal and Copy for AI: what a decision offers beside the options. Each draws what it's given, for full hands
// and the drills alike. Reveal's rule is kept by whoever holds the decision (room.ts, DrillsPanel.tsx); this says it.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ProvenanceBadge } from "@/components/ProvenanceBadge";
import { bb, pct } from "@/components/actions";
import { whoOf } from "@/grading/grade";
import { evUnit } from "@/solver/provenance";
import type { Provenance } from "@/solver/types";
import { clipboardWhy, toClipboard } from "./copyForAi";
import type { Decision } from "./practice";

type Mix = Decision["mix"];

/** What's said once the answer is shown, and after the move. */
export const REVEAL_NOTE = "You saw the answer first, so this decision isn't graded. It doesn't count toward your score, your streak, History or Review.";
/** Reveal's rule, on its button. */
export const REVEAL_TIP = "Shows the answer for your hand; what you do after it isn't graded.";
/** A hand's chips are what happened at the table: only the decision is left out. */
export const REVEAL_CHIPS = "The hand still counts in Hands and Net.";

/** Your hand's mix: each action, how often it's played, and its EV where `hasEv`. `chose`: your action, marked. */
export function MixTable({ mix, hasEv, labelOf, chose, unit = "bb" }: { mix: Mix; hasEv: boolean; labelOf: (a: Mix[number]) => string; chose?: string; unit?: string }) {
  return (
    <table className="w-full max-w-md text-left font-mono text-xs">
      <thead className="text-muted">
        <tr>
          <th className="py-0.5 font-normal">Action</th>
          <th className="py-0.5 text-right font-normal">Played</th>
          {hasEv && <th className="py-0.5 text-right font-normal">EV {unit}</th>}
        </tr>
      </thead>
      <tbody>
        {mix.map((a) => (
          <tr key={a.action} className={a.action === chose ? "text-accent" : ""}>
            <td className="py-0.5">
              {labelOf(a)}
              {a.action === chose && " ← you"}
            </td>
            <td className="py-0.5 text-right">{pct(a.freq)}</td>
            {hasEv && <td className="py-0.5 text-right">{a.rough && a.ev !== null ? "≈" : ""}{bb(a.ev)}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** The answer's mix shown before you act, with what answered and that the decision no longer counts. */
export function RevealedMix({ mix, provenance, labelOf, note }: { mix: Mix; provenance: Provenance; labelOf: (a: Mix[number]) => string; note: string }) {
  const hasEv = mix.some((a) => a.ev !== null);
  return (
    <div role="group" aria-label="Revealed answer" className="space-y-1 rounded border border-warn/60 p-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{whoOf(provenance.source)}&rsquo;s mix for your hand</span>
        <ProvenanceBadge p={provenance} />
      </div>
      <MixTable mix={mix} hasEv={hasEv} labelOf={labelOf} unit={evUnit(provenance)} />
      {!hasEv && <p className="text-xs text-muted">This answer has no EVs for your hand.</p>}
      <p role="status">{note}</p>
    </div>
  );
}

/** Hint and Reveal at a decision. `hint`: the words, made as it's asked for. `onReveal`: null until there's an answer in
 * hand to show. `revealed`: what's shown once it's been pressed. Mounted afresh for each spot. */
export function HintReveal({ hint, source, onReveal, revealed, keys = false }: { hint: () => string; source: string; onReveal: (() => void) | null; revealed: ReactNode; keys?: boolean }) {
  const [said, setSaid] = useState<string | null>(null);
  // `keys`: H the hint, Shift+H Reveal (keys.ts), while the decision is the one in front (not in a field, or under a retry)
  const now = useRef({ said, hint, onReveal, revealed });
  useEffect(() => {
    now.current = { said, hint, onReveal, revealed };
  });
  useEffect(() => {
    if (!keys) return;
    const on = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName ?? "";
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || /^(INPUT|SELECT|TEXTAREA)$/.test(tag)) return;
      const c = now.current;
      if (e.key === "h") setSaid(c.said === null ? c.hint() : null);
      else if (e.key === "H" && !c.revealed) c.onReveal?.();
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [keys]);
  return (
    <div className="space-y-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" aria-expanded={said !== null} onClick={() => setSaid(said === null ? hint() : null)} className="rounded-md border border-border px-3 py-1.5 hover:bg-surface-2">
          Hint{keys && <Kbd>H</Kbd>}
        </button>
        {!revealed && (
          <>
            <button type="button" disabled={!onReveal} onClick={() => onReveal?.()} title={REVEAL_TIP} className="rounded-md border border-border px-3 py-1.5 hover:bg-surface-2 disabled:opacity-50">
              Reveal{keys && <Kbd>Shift+H</Kbd>}
            </button>
          </>
        )}
      </div>
      {said !== null && (
        <p role="status">
          {said} <span className="text-xs text-muted">{source}</span>
        </p>
      )}
      {revealed}
    </div>
  );
}

type Copied = { st: "idle" } | { st: "done" } | { st: "failed"; why: string; text: string };

/** Copy for AI: `text`, made as it's asked for, onto your clipboard. Where that fails the page says why and holds the
 * text for you to copy by hand. */
export function CopyForAi({ text }: { text: () => string }) {
  const [copied, setCopied] = useState<Copied>({ st: "idle" });
  const copy = async () => {
    const t = text();
    try {
      await toClipboard(t);
      setCopied({ st: "done" });
    } catch (e) {
      setCopied({ st: "failed", why: clipboardWhy(e), text: t });
    }
  };
  return (
    <div className="space-y-1 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => void copy()} title="Plain text for you to paste into a chatbot. Lizard sends nothing itself." className="rounded-md border border-border px-3 py-1.5 hover:bg-surface-2">
          Copy for AI
        </button>
        {copied.st === "done" && (
          <span role="status" className="text-xs text-muted">
            Copied. Lizard sent nothing: paste it yourself, and check what a chatbot says against the numbers.
          </span>
        )}
      </div>
      {copied.st === "failed" && (
        <div className="space-y-1">
          <p role="alert" className="text-danger">
            Not copied: {copied.why}. The text is here to copy by hand.
          </p>
          <textarea readOnly aria-label="Text for AI" value={copied.text} rows={6} className="w-full rounded border border-border bg-surface-2 p-1 font-mono text-xs" />
        </div>
      )}
    </div>
  );
}

/** A key's name beside a control, for the eye only (the control's name stays its label). */
export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd aria-hidden className="ml-1.5 hidden rounded border border-current/30 px-1 font-mono text-[0.65rem] opacity-70 sm:inline">
      {children}
    </kbd>
  );
}
