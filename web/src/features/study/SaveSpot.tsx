// Study's "Save spot": the line kept in this browser (data/saved.ts) with a name, tags, a note, the provenance of the
// answer seen and the answer itself (data/answers.ts), listed on the Saved page. A line is saved once: saving it again
// updates that spot, and an answer finished by then takes the place of the one kept.
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { answerToKeep } from "@/data/answers";
import type { SavedAnswer, SavedSpot } from "@/data/db";
import { NOT_SAVED, newId, putSpot, readTags, spotAt, stored } from "@/data/saved";
import { describe } from "@/solver/provenance";
import type { Provenance, SolveResult } from "@/solver/types";
import { describeLine, studyRequest, toSearch, type StudyHand } from "./studyState";

/** `answer`: the finished answer on screen, kept with the spot (none while a saved answer is shown: that one stays). */
export function SaveSpot({ hand, provenance, answer }: { hand: StudyHand; provenance?: Provenance; answer?: SolveResult }) {
  const line = toSearch(hand);
  // undefined while looking, null where the line isn't saved
  const [saved, setSaved] = useState<SavedSpot | null | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const close = () => {
    setOpen(false);
    toggle.current?.focus();
  };
  const [title, setTitle] = useState("");
  const [tags, setTags] = useState("");
  const [note, setNote] = useState("");
  const [done, setDone] = useState(false);
  const [failed, setFailed] = useState(false);
  // why the line was saved without its answer
  const [without, setWithout] = useState("");

  useEffect(() => {
    let alive = true;
    void spotAt(line).then((s) => alive && setSaved(s ?? null));
    return () => {
      alive = false;
    };
  }, [line]);

  const start = () => {
    setTitle(saved?.title ?? (describeLine(hand).join(" · ") || `${hand.players === 2 ? "HU" : `${hand.players}-max`} ${hand.stack}bb preflop`));
    setTags(saved?.tags.join(", ") ?? "");
    setNote(saved?.note ?? "");
    setDone(false);
    setFailed(false);
    setWithout("");
    setOpen((o) => !o);
  };

  const save = async () => {
    const t = Date.now();
    // (looked up again: a second click may come before the first save's answer)
    const here = (await spotAt(line)) ?? saved ?? undefined;
    const id = here?.id ?? newId();
    const keep = answer ? answerToKeep(id, line, answer, t) : null;
    const s: SavedSpot = {
      id,
      title: title.trim() || line,
      line,
      state: studyRequest(hand) as unknown as Record<string, unknown>,
      tags: readTags(tags),
      note: note.trim(),
      seen: provenance ? { source: provenance.source, label: describe(provenance) } : here?.seen,
      createdAt: here?.createdAt ?? t,
      updatedAt: t,
    };
    const fits: SavedAnswer | undefined = keep && "answer" in keep ? keep.answer : undefined;
    const kept = await stored(() => putSpot(s, fits));
    setFailed(!kept);
    setDone(kept);
    setWithout(kept && keep && "refused" in keep ? keep.refused : "");
    if (kept) setSaved(s);
  };

  return (
    <div
      className="relative"
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) close();
      }}
    >
      <button
        ref={toggle}
        type="button"
        onClick={start}
        aria-expanded={open}
        disabled={saved === undefined}
        title={saved ? "This line is saved: edit its name, tags or note" : "Keep this line in this browser, with a name, tags and a note"}
        className="rounded px-2 py-0.5 text-muted hover:bg-surface-2 disabled:opacity-40"
      >
        {saved ? "★ Saved" : "☆ Save spot"}
      </button>
      {open && (
        <form
          aria-label="Save spot"
          className="z-20 mt-1 space-y-2 max-sm:fixed max-sm:inset-x-4 sm:absolute sm:right-0 sm:top-full sm:w-72 rounded-lg border border-border bg-surface p-3 text-sm shadow-lg"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label className="block">
            <span className="text-xs text-muted">Name</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} className="mt-0.5 w-full rounded border border-border bg-surface-2 px-2 py-1" />
          </label>
          <label className="block">
            <span className="text-xs text-muted">Tags, separated by commas</span>
            <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="srp, dry, c-bet" className="mt-0.5 w-full rounded border border-border bg-surface-2 px-2 py-1" />
          </label>
          <label className="block">
            <span className="text-xs text-muted">Note</span>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="mt-0.5 w-full rounded border border-border bg-surface-2 px-2 py-1" />
          </label>
          {provenance && <p className="text-xs text-muted">{answer ? "Keeps this answer with the spot" : "Kept with the answer's source"}: {describe(provenance)}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" className="rounded-md bg-accent px-3 py-1 font-medium text-bg">
              Save
            </button>
            <button type="button" onClick={close} className="rounded-md border border-border px-3 py-1 hover:bg-surface-2">
              Close
            </button>
            {done && (
              <span role="status" className="text-xs">
                Saved in this browser. <Link to="/saved" className="underline">See saved spots</Link>
              </span>
            )}
            {without && (
              <span role="alert" className="text-xs text-warn">
                The line is saved, but not its answer: {without}.
              </span>
            )}
            {failed && (
              <span role="alert" className="text-xs text-danger">
                {NOT_SAVED}
              </span>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
