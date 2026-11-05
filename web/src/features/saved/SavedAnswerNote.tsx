// What Study says over a saved answer: that it's saved, from which version, and how to ask the engine instead.
import { answerWords, versionStand, type KeptAnswer } from "@/data/answers";
import { useCurrentBuild, type SavedHold } from "./useSavedAnswer";

export function SavedAnswerNote({ hold, onResolve }: { hold: SavedHold; onResolve: () => void }) {
  if (hold.kept) return <Held kept={hold.kept} onResolve={onResolve} />;
  if (!hold.lost) return null;
  return (
    <p role="status" className="rounded-lg border border-warn/50 bg-warn/10 px-3 py-2 text-sm">
      The answer saved with this spot is gone or can&rsquo;t be read, so this one is asked afresh.
    </p>
  );
}

function Held({ kept, onResolve }: { kept: KeptAnswer; onResolve: () => void }) {
  const current = useCurrentBuild();
  const another = versionStand(kept.record, current) === "another";
  return (
    <div role="group" aria-label="Saved answer" className={`flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm ${another ? "border-warn/50 bg-warn/10" : "border-border bg-surface"}`}>
      <p className="min-w-0 flex-1">{answerWords(kept, current)}</p>
      <button type="button" onClick={onResolve} className="rounded-md border border-border px-3 py-1 hover:bg-surface-2">
        Re-solve
      </button>
    </div>
  );
}
