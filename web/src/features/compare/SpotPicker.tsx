// The Compare page's picker (ROADMAP Phase 8: any two nodes): each side from your saved spots, the spot pinned in
// Study, or any Study link pasted; Swap; Compare opens the two. Study's "Compare this spot" links stay the quick way.
import { useEffect, useId, useState } from "react";
import type { SavedSpot } from "@/data/db";
import { listSpots } from "@/data/saved";
import { describeLine, fromSearch, toSearch, type StudyHand } from "@/features/study/studyState";
import { studyQueryOf, usePin } from "./pin";

type Side = "a" | "b";

const tableOf = (h: StudyHand) => `${h.players === 2 ? "HU" : `${h.players}-max`} ${h.stack}bb${h.pf === "solver" && !h.board ? " (preflop solve)" : ""}`;
const lineOf = (h: StudyHand) => describeLine(h).join(" ") || "the first decision";

/** A spot in a few words: the table, the line. */
export const spotTitle = (search: string): string => {
  const h = fromSearch(search);
  return h ? `${tableOf(h)}: ${lineOf(h)}` : "?";
};

/** A saved spot: its title, and the table (with the line where the title isn't already the line). */
const savedTitle = (s: SavedSpot, h: StudyHand) =>
  `${s.title} (${s.title.split("·").map((x) => x.trim()).join(" ").trim() === lineOf(h) ? tableOf(h) : spotTitle(s.line)})`;

export function SpotPicker({ a, b, onPick }: { a: string | null; b: string | null; onPick: (a: string, b: string) => void }) {
  const [draft, setDraft] = useState<Record<Side, string>>({ a: a ?? "", b: b ?? "" });
  const [typed, setTyped] = useState<Record<Side, string>>({ a: "", b: "" });
  const [err, setErr] = useState<Partial<Record<Side, string>>>({});
  const [spots, setSpots] = useState<SavedSpot[]>([]);
  const pin = usePin((s) => s.pin);
  const errId = useId();
  useEffect(() => {
    let alive = true;
    void listSpots()
      .then((s) => alive && setSpots(s))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const set = (side: Side, search: string) => {
    setDraft((d) => ({ ...d, [side]: search }));
    setErr((e) => ({ ...e, [side]: undefined }));
  };
  const paste = (side: Side) => {
    const q = studyQueryOf(typed[side]);
    const h = q ? fromSearch(q) : null;
    if (!h) return setErr((e) => ({ ...e, [side]: "Not a Study link: open the spot in Study and copy the address." }));
    set(side, toSearch(h));
    setTyped((t) => ({ ...t, [side]: "" }));
  };
  const choices: [string, string][] = [
    ...(pin && fromSearch(pin) ? [[pin, `Pinned in Study: ${spotTitle(pin)}`] as [string, string]] : []),
    ...spots.flatMap((s) => {
      const h = fromSearch(s.line);
      return h ? [[s.line, savedTitle(s, h)] as [string, string]] : [];
    }),
  ];
  const ready = Boolean(fromSearch(draft.a) && fromSearch(draft.b));

  return (
    <section aria-label="Pick the spots" className="space-y-3 rounded-lg border border-border bg-surface p-3 text-sm">
      {(["a", "b"] as const).map((side) => {
        const name = side.toUpperCase();
        const cur = draft[side];
        // (a spot that isn't one of the choices, pasted or opened from a link, is listed as itself)
        const opts = cur && !choices.some(([v]) => v === cur) ? [[cur, spotTitle(cur)] as [string, string], ...choices] : choices;
        return (
          <div key={side} className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-4 font-medium">{name}</span>
              <select
                aria-label={`Spot ${name}`}
                value={cur}
                onChange={(e) => set(side, e.target.value)}
                className="min-w-0 max-w-full flex-1 rounded border border-border bg-surface-2 px-2 py-1"
              >
                <option value="">{opts.length ? "Pick a spot…" : "No saved or pinned spots yet"}</option>
                {opts.map(([v, label]) => (
                  <option key={v} value={v}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <form
              className="flex flex-wrap items-center gap-2 pl-6"
              onSubmit={(e) => {
                e.preventDefault();
                paste(side);
              }}
            >
              <input
                aria-label={`Spot ${name} as a Study link`}
                value={typed[side]}
                onChange={(e) => setTyped((t) => ({ ...t, [side]: e.target.value }))}
                placeholder="or paste a Study link"
                className="min-w-0 flex-1 rounded border border-border bg-surface-2 px-2 py-1 font-mono text-xs"
                aria-invalid={Boolean(err[side])}
                aria-describedby={err[side] ? `${errId}-${side}` : undefined}
              />
              <button type="submit" disabled={!typed[side].trim()} className="rounded border border-border px-2 py-0.5 hover:bg-surface-2 disabled:opacity-40">
                Use
              </button>
              {err[side] && (
                <span id={`${errId}-${side}`} role="alert" className="w-full text-xs text-danger">
                  {err[side]}
                </span>
              )}
            </form>
          </div>
        );
      })}
      <div className="flex flex-wrap items-center gap-2 pl-6">
        <button
          type="button"
          disabled={!ready}
          onClick={() => onPick(draft.a, draft.b)}
          className="rounded bg-accent px-3 py-1 font-medium text-bg disabled:opacity-40"
        >
          Compare
        </button>
        <button type="button" onClick={() => setDraft((d) => ({ a: d.b, b: d.a }))} className="rounded border border-border px-2 py-0.5 hover:bg-surface-2">
          Swap A and B
        </button>
        <span className="text-xs text-muted">Saved or pinned spots in Study list here.</span>
      </div>
    </section>
  );
}
