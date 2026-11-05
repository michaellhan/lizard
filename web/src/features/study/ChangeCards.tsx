// "Change the turn": the same line on another card, the plan's board replacements. Only the street on screen's cards
// change, so nothing after them has to be worked out again: for an earlier street, go back to it first.
import { useId, useState } from "react";
import { cardsNeeded, randomReplacement, readReplacement, replaceCards, streetOf, type StudyHand } from "./studyState";

export function ChangeCards({ hand, onChange }: { hand: StudyHand; onChange: (h: StudyHand) => void }) {
  const street = streetOf(hand);
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const errId = useId();
  if (street === "preflop") return null;
  const n = cardsNeeded(street);
  const button = "rounded px-2 py-0.5 text-muted hover:bg-surface-2";
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={button}>
        Change the {street}
      </button>
    );
  }
  return (
    <form
      aria-label={`Change the ${street}`}
      className="flex flex-wrap items-center gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        const r = readReplacement(hand, typed, n);
        if ("error" in r) setErr(r.error);
        else onChange(replaceCards(hand, r.cards));
      }}
    >
      <input
        aria-label={`New ${street}`}
        value={typed}
        onChange={(e) => {
          setTyped(e.target.value);
          setErr(null);
        }}
        placeholder={n === 1 ? "5s" : "Kd7c2h"}
        aria-invalid={Boolean(err)}
        aria-describedby={err ? errId : undefined}
        autoFocus
        className="w-24 rounded border border-border bg-surface-2 px-2 py-0.5 font-mono"
      />
      <button type="submit" className={button}>
        Change
      </button>
      <button type="button" onClick={() => onChange(replaceCards(hand, randomReplacement(hand, n)))} className={button}>
        Random
      </button>
      <button type="button" onClick={() => setOpen(false)} className={button}>
        Keep it
      </button>
      {err && (
        <span id={errId} role="alert" className="text-xs text-danger">
          {err}
        </span>
      )}
    </form>
  );
}
