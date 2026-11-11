// "Save this report": Analyze's filters as they're set, under a name in this browser (data/reports.ts), to open again from
// the Saved page. Saving under a name already kept changes that report.
import { useRef, useState } from "react";
import { Link } from "react-router";
import type { SavedReport } from "@/data/db";
import { NOT_SAVED, newId, stored } from "@/data/saved";
import { filtersOf, listReports, putReport, reportWords } from "@/data/reports";

export function SaveReport({ params }: { params: URLSearchParams }) {
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const close = () => {
    setOpen(false);
    toggle.current?.focus();
  };
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [done, setDone] = useState<"saved" | "changed" | null>(null);
  const [failed, setFailed] = useState(false);
  const filters = filtersOf(params);
  const about = reportWords(filters);

  const start = () => {
    setDone(null);
    setFailed(false);
    if (!open) setName(about);
    setOpen((o) => !o);
  };

  const save = async () => {
    const t = Date.now();
    const title = name.trim() || about;
    const kept = await stored(async () => {
      const here = (await listReports()).list.find((r) => r.name === title);
      const r: SavedReport = { id: here?.id ?? newId(), name: title, filters, note: note.trim(), ...(here?.tags ? { tags: here.tags } : {}), createdAt: here?.createdAt ?? t, updatedAt: t };
      const put = await putReport(r);
      if (put) setDone(here ? "changed" : "saved");
      return put;
    });
    setFailed(!kept);
    if (!kept) setDone(null);
  };

  return (
    <div
      className="relative text-sm"
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) close();
      }}
    >
      <button ref={toggle} type="button" onClick={start} aria-expanded={open} className="rounded border border-border px-2 py-0.5 hover:bg-surface-2">
        Save this report
      </button>
      {open && (
        <form
          aria-label="Save this report"
          className="z-20 mt-1 space-y-2 rounded-lg border border-border bg-surface p-3 text-sm shadow-lg max-sm:fixed max-sm:inset-x-4 sm:absolute sm:w-80"
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
          <p className="text-xs text-muted">{about}. Keeps the filters, not the numbers.</p>
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" className="rounded-md bg-accent px-3 py-1 font-medium text-bg">
              Save
            </button>
            <button type="button" onClick={close} className="rounded-md border border-border px-3 py-1 hover:bg-surface-2">
              Close
            </button>
            {done && (
              <span role="status" className="text-xs">
                {done === "changed" ? "Changed the report with this name." : "Saved in this browser."}{" "}
                <Link to="/saved" className="underline">
                  See saved reports
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
