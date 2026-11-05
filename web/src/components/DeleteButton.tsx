// A delete that asks once more before it acts: the app's way with what can't be got back (Saved, Review).
import { useState } from "react";
import { useFocusHold } from "./useFocusHold";

/** `what`: the second press's words ("Delete spot"). `name`: the first press's name for a screen reader, where rows repeat. */
export function DeleteButton({ what, name, onDelete }: { what: string; name?: string; onDelete: (from: HTMLElement) => void }) {
  const [sure, setSure] = useState(false);
  // (the question takes the keyboard, to Keep, so a second Enter deletes nothing; Keep gives it back to Delete. The keys
  // keep React from reusing the Delete button, focus and all, as the button that really deletes.)
  const hold = useFocusHold<HTMLSpanElement>();
  return (
    <span {...hold} className="inline-flex items-center gap-1">
      {sure ? (
        <>
          <button key="delete" type="button" onClick={(e) => onDelete(e.currentTarget)} className="rounded border border-danger/60 px-2 py-0.5 text-danger hover:bg-danger/10">
            Delete {what}
          </button>
          <button type="button" data-focus-first onClick={() => setSure(false)} className="rounded px-2 py-0.5 text-muted hover:bg-surface-2">
            Keep
          </button>
        </>
      ) : (
        <button key="ask" type="button" data-focus-first aria-label={name} onClick={() => setSure(true)} className="rounded px-2 py-0.5 text-muted hover:bg-surface-2">
          Delete
        </button>
      )}
    </span>
  );
}
