// "Save drill": a drill kept under a name in this browser (data/saved.ts), listed on the Saved page to open again as
// it was set. A drill is its page's URL (Practice's drills: spot, decision and texture; Analyze's leak drill: the
// leak and the hands' filters), saved once: saving it again updates it.
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import type { SavedDrill } from "@/data/db";
import { NOT_SAVED, drillAt, newId, putDrill, stored } from "@/data/saved";

export function SaveDrill({ kind, to, about }: { kind: SavedDrill["kind"]; to: string; about: string }) {
  // undefined while looking, null where the drill isn't saved
  const [saved, setSaved] = useState<SavedDrill | null | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const close = () => {
    setOpen(false);
    toggle.current?.focus();
  };
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [done, setDone] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    void drillAt(to).then((s) => alive && setSaved(s ?? null));
    return () => {
      alive = false;
    };
  }, [to]);

  const start = () => {
    setName(saved?.name ?? about);
    setNote(saved?.note ?? "");
    setDone(false);
    setFailed(false);
    setOpen((o) => !o);
  };

  const save = async () => {
    const t = Date.now();
    // (looked up again: a second click may come before the first save's answer)
    const here = (await drillAt(to)) ?? saved ?? undefined;
    const s: SavedDrill = {
      id: here?.id ?? newId(),
      name: name.trim() || about,
      kind,
      to,
      about,
      note: note.trim(),
      createdAt: here?.createdAt ?? t,
      updatedAt: t,
    };
    const kept = await stored(() => putDrill(s));
    setFailed(!kept);
    setDone(kept);
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
        title={saved ? "This drill is saved: edit its name or note" : "Keep this drill, as it's set, in this browser under a name"}
        className="rounded px-2 py-0.5 text-muted hover:bg-surface-2 disabled:opacity-40"
      >
        {saved ? "★ Saved drill" : "☆ Save drill"}
      </button>
      {open && (
        <form
          aria-label="Save drill"
          className="z-20 mt-1 space-y-2 max-sm:fixed max-sm:inset-x-4 sm:absolute sm:right-0 sm:top-full sm:w-72 rounded-lg border border-border bg-surface p-3 text-sm shadow-lg"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label className="block">
            <span className="text-xs text-muted">Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} className="mt-0.5 w-full rounded border border-border bg-surface-2 px-2 py-1" />
          </label>
          <label className="block">
            <span className="text-xs text-muted">Note</span>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="mt-0.5 w-full rounded border border-border bg-surface-2 px-2 py-1" />
          </label>
          <p className="text-xs text-muted">{about}</p>
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" className="rounded-md bg-accent px-3 py-1 font-medium text-bg">
              Save
            </button>
            <button type="button" onClick={close} className="rounded-md border border-border px-3 py-1 hover:bg-surface-2">
              Close
            </button>
            {done && (
              <span role="status" className="text-xs">
                Saved in this browser.{" "}
                <Link to="/saved" className="underline">
                  See saved drills
                </Link>
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
