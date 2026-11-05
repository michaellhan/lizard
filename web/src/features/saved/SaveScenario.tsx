// "Save scenario": the New session form's setup kept under a name in this browser (data/scenarios.ts), to start again from
// the Saved page. Saving under a name already kept changes that scenario.
import { useRef, useState } from "react";
import { Link } from "react-router";
import type { SavedScenario } from "@/data/db";
import { NOT_SAVED, newId, stored } from "@/data/saved";
import { listScenarios, putScenario, scenarioWords, type ScenarioSetup } from "@/data/scenarios";

export function SaveScenario({ setup }: { setup: ScenarioSetup | null }) {
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
  const about = setup ? scenarioWords(setup) : "";

  const start = () => {
    setDone(null);
    setFailed(false);
    if (!open) setName(about);
    setOpen((o) => !o);
  };

  const save = async () => {
    if (!setup) return;
    const t = Date.now();
    const title = name.trim() || about;
    const kept = await stored(async () => {
      const here = (await listScenarios()).list.find((s) => s.name === title);
      const s: SavedScenario = { id: here?.id ?? newId(), name: title, ...setup, note: note.trim(), createdAt: here?.createdAt ?? t, updatedAt: t };
      const put = await putScenario(s);
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
      <button
        ref={toggle}
        type="button"
        onClick={start}
        aria-expanded={open}
        disabled={!setup}
        title={setup ? "Keep this setup, as it's set, in this browser under a name" : "Fix the setup first: it can't start as it stands"}
        className="rounded border border-border px-2.5 py-1 hover:bg-surface-2 disabled:opacity-40"
      >
        Save scenario
      </button>
      {open && setup && (
        // (a group, not a <form>: this sits inside the New session form, and a form can't hold a form)
        <div
          role="form"
          aria-label="Save scenario"
          className="z-20 mt-1 space-y-2 rounded-lg border border-border bg-surface p-3 text-sm shadow-lg max-sm:fixed max-sm:inset-x-4 sm:absolute sm:left-0 sm:top-full sm:w-80"
          onKeyDown={(e) => {
            if (e.key !== "Enter" || e.target instanceof HTMLTextAreaElement) return;
            e.preventDefault();
            if (!(e.target instanceof HTMLButtonElement)) void save();
            else e.target.click();
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
            <button type="button" onClick={() => void save()} className="rounded-md bg-accent px-3 py-1 font-medium text-bg">
              Save
            </button>
            <button type="button" onClick={close} className="rounded-md border border-border px-3 py-1 hover:bg-surface-2">
              Close
            </button>
            {done && (
              <span role="status" className="text-xs">
                {done === "changed" ? "Changed the scenario with this name." : "Saved in this browser."}{" "}
                <Link to="/saved" className="underline">
                  See saved scenarios
                </Link>
              </span>
            )}
            {failed && (
              <span role="alert" className="text-xs text-danger">
                {NOT_SAVED}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
