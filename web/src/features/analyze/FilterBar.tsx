// The filters every Analyze report follows, in the page's URL: the days played, site, stakes, your seat, pot type, tag,
// EV lost and a search, together. It says how much of what's kept they leave, and when they leave nothing.
import { useMemo, useRef } from "react";
import type { HandRecord } from "@/data/db";
import { HAND_FILTERS, LOST_STEPS, POT_TYPES } from "./analyze";

const count = (n: number, one: string) => `${n.toLocaleString()} ${one}${n === 1 ? "" : "s"}`;

function Choice({ label, value, values, onChange }: { label: string; value: string | null; values: readonly string[]; onChange: (v: string | null) => void }) {
  return (
    <label className="flex items-center gap-1">
      <span className="text-muted">{label}</span>
      <select aria-label={label} value={value ?? ""} onChange={(e) => onChange(e.target.value || null)} className="rounded border border-border bg-surface-2 px-1 py-0.5">
        <option value="">Any</option>
        {values.map((x) => (
          <option key={x} value={x}>
            {x}
          </option>
        ))}
      </select>
    </label>
  );
}

export function FilterBar({
  hands,
  shown,
  graded,
  gradedShown,
  params,
  set,
}: {
  /** every hand kept, and those the filters keep */
  hands: readonly HandRecord[];
  shown: readonly HandRecord[];
  /** decisions graded, in all and in the hands kept */
  graded: number;
  gradedShown: number;
  params: URLSearchParams;
  set: (o: Record<string, string | null>) => void;
}) {
  const opts = useMemo(() => {
    const unique = (of: (h: HandRecord) => string) => [...new Set(hands.map(of))].sort();
    // (the days played, by the site's clock, as the history writes them)
    const days = unique((h) => h.played.slice(0, 10)).filter(Boolean);
    return {
      seats: unique((h) => h.hero),
      pots: POT_TYPES.filter((p) => hands.some((h) => h.potType === p)),
      sites: unique((h) => h.site),
      stakes: unique((h) => h.bb),
      tags: [...new Set(hands.flatMap((h) => h.tags ?? []))].sort(),
      first: days[0],
      last: days.at(-1),
      undated: hands.reduce((n, h) => n + (h.played ? 0 : 1), 0),
    };
  }, [hands]);
  const [from, to] = [params.get("from"), params.get("to")];
  const on = HAND_FILTERS.some((k) => params.get(k));
  // (the button pressed goes as the filters clear: the heading holds the place)
  const head = useRef<HTMLHeadingElement>(null);
  const date = (label: string, k: string) => (
    <label className="flex items-center gap-1">
      <span className="text-muted">{label}</span>
      <input
        type="date"
        aria-label={label}
        value={params.get(k) ?? ""}
        min={opts.first}
        max={opts.last}
        onChange={(e) => set({ [k]: e.target.value || null })}
        className="rounded border border-border bg-surface-2 px-1 py-0.5"
      />
    </label>
  );
  return (
    <section aria-label="Filters" className="space-y-2 rounded-lg border border-border bg-surface p-3 text-sm">
      <h2 ref={head} tabIndex={-1} className="text-lg font-semibold">
        Filters
      </h2>
      <div className="flex flex-wrap items-center gap-3">
        {date("From", "from")}
        {date("To", "to")}
        <Choice label="Site" value={params.get("site")} values={opts.sites} onChange={(v) => set({ site: v })} />
        <Choice label="Stakes" value={params.get("bb")} values={opts.stakes} onChange={(v) => set({ bb: v })} />
        <Choice label="Your seat" value={params.get("pos")} values={opts.seats} onChange={(v) => set({ pos: v })} />
        <Choice label="Pot" value={params.get("pot")} values={opts.pots} onChange={(v) => set({ pot: v })} />
        {opts.tags.length > 0 && <Choice label="Tag" value={params.get("tag")} values={opts.tags} onChange={(v) => set({ tag: v })} />}
        <label className="flex items-center gap-1" title="The EV your graded decisions gave up in the hand, from the answers they were graded against (the preflop charts' grades have no EVs)">
          <span className="text-muted">EV lost</span>
          <select aria-label="EV lost" value={params.get("lost") ?? ""} onChange={(e) => set({ lost: e.target.value || null })} className="rounded border border-border bg-surface-2 px-1 py-0.5">
            <option value="">Any</option>
            {LOST_STEPS.map((x) => (
              <option key={x} value={x}>
                {x}bb or more
              </option>
            ))}
          </select>
        </label>
        <input
          type="search"
          aria-label="Search hands"
          value={params.get("q") ?? ""}
          onChange={(e) => set({ q: e.target.value || null })}
          placeholder="Search cards, number, tags, notes"
          className="w-56 max-w-full rounded border border-border bg-surface-2 px-2 py-0.5"
        />
        {on && (
          <button
            type="button"
            onClick={() => {
              head.current?.focus();
              set(Object.fromEntries(HAND_FILTERS.map((k) => [k, null])));
            }}
            className="rounded border border-border px-2 py-0.5 hover:bg-surface-2"
          >
            Clear filters
          </button>
        )}
      </div>
      <p role="status" aria-label="Sample after filtering">
        {shown.length === hands.length
          ? `Every report covers all your ${count(hands.length, "hand")} and ${count(graded, "graded decision")}.`
          : `Every report covers ${count(shown.length, "hand")} of ${hands.length.toLocaleString()} and ${gradedShown.toLocaleString()} of ${count(graded, "graded decision")}.`}
      </p>
      {shown.length === 0 && (
        <p aria-label="Nothing left" className="text-danger">
          {from && to && from > to ? "From is later than To, so no day can match." : "None of your hands matches all of these filters together."} Every report is empty until you change them.
        </p>
      )}
      {(from || to) && opts.undated > 0 && <p className="text-xs text-muted">{count(opts.undated, "hand")} with no date in the history {opts.undated === 1 ? "is" : "are"} left out while a date is set.</p>}
      <p className="text-xs text-muted">Sessions, the report and its leaks, drills, your results and your stats all follow these. Stakes are the big blind as the history writes it, and days are by the site&rsquo;s own clock.</p>
    </section>
  );
}
