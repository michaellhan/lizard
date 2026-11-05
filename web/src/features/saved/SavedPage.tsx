// Saved: the spots saved from Study, the drills saved from Practice and Analyze, the Practice scenarios to start again, and
// the ranges saved from the Ranges editor, kept in this browser (IndexedDB), with search, rename, delete, and a backup to one JSON file and back
// (data/backup.ts).
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { useFocusHold } from "@/components/useFocusHold";
import type { SavedDrill, SavedRange, SavedReport, SavedScenario, SavedSpot } from "@/data/db";
import { restoreBackup, restoreSummary } from "@/data/backup";
import { importTooBig } from "@/data/limits";
import { nudgeState, onNudgeState, type NudgeState } from "@/data/backupNudge";
import { NOT_SAVED, deleteDrill, deleteRange, deleteSpot, isDrillLink, listDrills, listRanges, listSpots, putDrill, putSpot, readTags, spotMatches, stored } from "@/data/saved";
import { deleteReport, listReports, putReport, reportLink, reportWords } from "@/data/reports";
import { deleteScenario, listScenarios, putScenario, scenarioWords } from "@/data/scenarios";
import { describeSetup } from "@/features/solve/setup";
import { describeLine, fromSearch } from "@/features/study/studyState";
import { downloadBackup } from "./backupFile";

const lineText = (line: string) => {
  const h = fromSearch(line);
  return h ? [`${h.players === 2 ? "HU" : `${h.players}-max`} ${h.stack}bb`, ...describeSetup(h.setup), ...describeLine(h)].join(" · ") : line;
};
const day = (t: number) => new Date(t).toLocaleDateString();

export function SavedPage() {
  const [spots, setSpots] = useState<SavedSpot[] | null>(null);
  const [ranges, setRanges] = useState<SavedRange[] | null>(null);
  const [drills, setDrills] = useState<SavedDrill[] | null>(null);
  const [scenarios, setScenarios] = useState<{ list: SavedScenario[]; damaged: number } | null>(null);
  const [reports, setReports] = useState<{ list: SavedReport[]; damaged: number } | null>(null);
  const [query, setQuery] = useState("");
  const [n, setN] = useState(0);
  const reload = () => setN((x) => x + 1);
  // a row being deleted: said at once, and the keyboard goes to the row that takes its place once it's gone
  const leaving = useRef<HTMLElement | null>(null);
  const place = useRef<{ list: Element; at: number } | null>(null);
  const [said, setSaid] = useState("");
  const onGone = (from: HTMLElement, what: string) => {
    const row = from.closest("li");
    if (row?.parentElement) {
      leaving.current = row;
      place.current = { list: row.parentElement, at: [...row.parentElement.children].indexOf(row) };
    }
    setSaid(`${what} deleted.`);
  };
  useEffect(() => {
    if (!place.current || leaving.current?.isConnected) return;
    const { list, at } = place.current;
    place.current = null;
    const row = list.children[at] ?? list.lastElementChild ?? list.closest("section");
    (row as HTMLElement | null)?.focus();
  });

  useEffect(() => {
    let alive = true;
    void Promise.all([listSpots(), listRanges(), listDrills(), listScenarios(), listReports()]).then(([s, r, d, c, p]) => {
      if (!alive) return;
      setSpots(s);
      setRanges(r);
      setDrills(d);
      setScenarios(c);
      setReports(p);
    });
    return () => {
      alive = false;
    };
  }, [n]);

  const shown = useMemo(() => (spots ?? []).filter((s) => spotMatches(s, query, lineText(s.line))), [spots, query]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Saved</h1>
        <p className="text-sm text-muted">
          Spots saved from Study, drills saved from Practice and Analyze, and ranges saved from Ranges. They're kept in this browser only: back them
          up to a file to keep them safe or to move them to another browser.
        </p>
      </div>
      <p role="status" className="sr-only">
        {said}
      </p>

      <section aria-label="Saved spots" tabIndex={-1} className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold">Spots</h2>
          <span className="text-sm text-muted">{spots ? `${spots.length} saved` : "Reading…"}</span>
          <span className="flex-1" />
          <input
            type="search"
            aria-label="Search saved spots"
            placeholder="Search names, tags, notes, lines"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-64 max-w-full rounded border border-border bg-surface-2 px-2 py-1 text-sm"
          />
        </div>
        {spots && spots.length === 0 && (
          <p className="rounded-lg border border-border bg-surface p-3 text-sm text-muted">
            No saved spots yet. In <Link to="/study" className="underline">Study</Link>, "☆ Save spot" keeps the line you're on.
          </p>
        )}
        {spots && spots.length > 0 && shown.length === 0 && <p className="text-sm text-muted">No saved spot matches “{query}”.</p>}
        <ul className="space-y-2">
          {shown.map((s) => (
            <SpotRow key={s.id} spot={s} onChange={reload} onGone={onGone} />
          ))}
        </ul>
      </section>

      <section aria-label="Saved drills" tabIndex={-1} className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold">Drills</h2>
          <span className="text-sm text-muted">{drills ? `${drills.length} saved` : "Reading…"}</span>
        </div>
        {drills && drills.length === 0 && (
          <p className="rounded-lg border border-border bg-surface p-3 text-sm text-muted">
            No saved drills yet. "☆ Save drill" keeps a drill as it's set: in <Link to="/practice?tab=drills" className="underline">Practice&rsquo;s drills</Link>{" "}
            (spot, decision, texture), or a leak drill in <Link to="/analyze" className="underline">Analyze</Link> (the leak, over the hands its filters keep).
          </p>
        )}
        <ul className="space-y-2">
          {(drills ?? []).map((d) => (
            <DrillRow key={d.id} drill={d} onChange={reload} onGone={onGone} />
          ))}
        </ul>
      </section>

      <section aria-label="Saved scenarios" tabIndex={-1} className="space-y-2">
        <div className="flex flex-wrap items-baseline gap-2">
          <h2 className="text-lg font-semibold">Scenarios</h2>
          <span className="text-sm text-muted">{scenarios ? `${scenarios.list.length} saved` : "Reading…"}</span>
        </div>
        {scenarios && scenarios.list.length === 0 && (
          <p className="text-sm text-muted">
            No saved scenarios yet. Save scenario, beside the setup in <Link to="/practice" className="underline">Practice</Link>, keeps a table as it&rsquo;s set to start again from here.
          </p>
        )}
        {!!scenarios?.damaged && (
          <p role="status" className="text-sm text-warn">
            {scenarios.damaged} saved scenario{scenarios.damaged === 1 ? " is" : "s are"} damaged and can&rsquo;t be read, so {scenarios.damaged === 1 ? "it's" : "they're"} left out here.
          </p>
        )}
        <ul className="space-y-2">
          {(scenarios?.list ?? []).map((s) => (
            <ScenarioRow key={s.id} scenario={s} onChange={reload} onGone={onGone} />
          ))}
        </ul>
      </section>

      <section aria-label="Saved reports" tabIndex={-1} className="space-y-2">
        <div className="flex flex-wrap items-baseline gap-2">
          <h2 className="text-lg font-semibold">Reports</h2>
          <span className="text-sm text-muted">{reports ? `${reports.list.length} saved` : "Loading"}</span>
        </div>
        {reports && reports.list.length === 0 && (
          <p className="text-sm text-muted">
            No saved reports yet. Save this report, under the filters in{" "}
            <Link to="/analyze" className="underline">
              Analyze
            </Link>
            , keeps them here.
          </p>
        )}
        {!!reports?.damaged && (
          <p role="status" className="text-sm text-warn">
            {reports.damaged} saved report{reports.damaged === 1 ? " is" : "s are"} damaged and can&rsquo;t be read, so {reports.damaged === 1 ? "it isn" : "they aren"}
            &rsquo;t listed.
          </p>
        )}
        <ul className="space-y-2">
          {(reports?.list ?? []).map((r) => (
            <ReportRow key={r.id} report={r} onChange={reload} onGone={onGone} />
          ))}
        </ul>
      </section>

      <section aria-label="Saved ranges" tabIndex={-1} className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold">Ranges</h2>
          <span className="text-sm text-muted">{ranges ? `${ranges.length} saved` : "Reading…"}</span>
        </div>
        {ranges && ranges.length === 0 && (
          <p className="rounded-lg border border-border bg-surface p-3 text-sm text-muted">
            No saved ranges yet. The <Link to="/ranges" className="underline">Ranges</Link> editor saves one under a name.
          </p>
        )}
        <ul className="space-y-2">
          {(ranges ?? []).map((r) => (
            <RangeRow key={r.id} range={r} onChange={reload} onGone={onGone} />
          ))}
        </ul>
      </section>

      <BackupPanel onRestored={reload} />
    </div>
  );
}

/** A delete that asks once more before it acts. */
function DeleteButton({ what, onDelete }: { what: string; onDelete: (from: HTMLElement) => void }) {
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
        <button key="ask" type="button" data-focus-first onClick={() => setSure(true)} className="rounded px-2 py-0.5 text-muted hover:bg-surface-2">
          Delete
        </button>
      )}
    </span>
  );
}

function SpotRow({ spot, onChange, onGone }: { spot: SavedSpot; onChange: () => void; onGone: (from: HTMLElement, what: string) => void }) {
  // (Edit takes the keyboard to the form's first field, and Cancel or Save brings it back to Edit)
  const hold = useFocusHold<HTMLLIElement>();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(spot.title);
  const [tags, setTags] = useState(spot.tags.join(", "));
  const [note, setNote] = useState(spot.note);
  const [failed, setFailed] = useState(false);
  const save = async () => {
    const kept = await stored(() => putSpot({ ...spot, title: title.trim() || spot.title, tags: readTags(tags), note: note.trim(), updatedAt: Date.now() }));
    setFailed(!kept);
    if (!kept) return;
    setEditing(false);
    onChange();
  };
  return (
    <li {...hold} aria-label={spot.title} className="space-y-1 rounded-lg border border-border bg-surface p-3 text-sm">
      {editing ? (
        <form
          aria-label={`Edit ${spot.title}`}
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <input data-focus-first aria-label="Name" value={title} onChange={(e) => setTitle(e.target.value)} className="w-full rounded border border-border bg-surface-2 px-2 py-1" />
          <input aria-label="Tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="Tags, separated by commas" className="w-full rounded border border-border bg-surface-2 px-2 py-1" />
          <textarea aria-label="Note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="w-full rounded border border-border bg-surface-2 px-2 py-1" />
          <div className="flex gap-2">
            <button type="submit" className="rounded-md bg-accent px-3 py-1 font-medium text-bg">
              Save
            </button>
            <button type="button" onClick={() => setEditing(false)} className="rounded-md border border-border px-3 py-1 hover:bg-surface-2">
              Cancel
            </button>
            {failed && (
              <span role="alert" className="text-xs text-danger">
                {NOT_SAVED}
              </span>
            )}
          </div>
        </form>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <strong>{spot.title}</strong>
            {spot.tags.map((t) => (
              <span key={t} className="rounded bg-surface-3 px-1.5 py-0.5 text-xs">
                {t}
              </span>
            ))}
            <span className="flex-1" />
            <Link to={`/study?${spot.line}`} className="rounded border border-border px-2 py-0.5 hover:bg-surface-2">
              Open in Study
            </Link>
            <button type="button" data-focus-first onClick={() => setEditing(true)} className="rounded px-2 py-0.5 text-muted hover:bg-surface-2">
              Edit
            </button>
            <DeleteButton
              what="spot"
              onDelete={(from) => {
                onGone(from, `Spot ${spot.title}`);
                void deleteSpot(spot.id).then(onChange);
              }}
            />
          </div>
          <p className="font-mono text-xs">{lineText(spot.line)}</p>
          {spot.note && <p className="whitespace-pre-wrap">{spot.note}</p>}
          <p className="text-xs text-muted">
            Saved {day(spot.createdAt)}
            {spot.updatedAt !== spot.createdAt ? `, changed ${day(spot.updatedAt)}` : ""}
            {spot.seen ? ` · the answer then: ${spot.seen.label}` : ""}
          </p>
        </>
      )}
    </li>
  );
}

function DrillRow({ drill, onChange, onGone }: { drill: SavedDrill; onChange: () => void; onGone: (from: HTMLElement, what: string) => void }) {
  const hold = useFocusHold<HTMLLIElement>();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(drill.name);
  const [note, setNote] = useState(drill.note);
  const [failed, setFailed] = useState(false);
  const save = async () => {
    const kept = await stored(() => putDrill({ ...drill, name: name.trim() || drill.name, note: note.trim(), updatedAt: Date.now() }));
    setFailed(!kept);
    if (!kept) return;
    setEditing(false);
    onChange();
  };
  return (
    <li {...hold} aria-label={drill.name} className="space-y-1 rounded-lg border border-border bg-surface p-3 text-sm">
      {editing ? (
        <form
          aria-label={`Edit ${drill.name}`}
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <input data-focus-first aria-label="Name" value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded border border-border bg-surface-2 px-2 py-1" />
          <textarea aria-label="Note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="w-full rounded border border-border bg-surface-2 px-2 py-1" />
          <div className="flex gap-2">
            <button type="submit" className="rounded-md bg-accent px-3 py-1 font-medium text-bg">
              Save
            </button>
            <button type="button" onClick={() => setEditing(false)} className="rounded-md border border-border px-3 py-1 hover:bg-surface-2">
              Cancel
            </button>
            {failed && (
              <span role="alert" className="text-xs text-danger">
                {NOT_SAVED}
              </span>
            )}
          </div>
        </form>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <strong>{drill.name}</strong>
            <span className="rounded bg-surface-3 px-1.5 py-0.5 text-xs">{drill.kind === "library" ? "library drill" : "leak drill"}</span>
            <span className="flex-1" />
            {isDrillLink(drill.kind, drill.to) && (
              <Link to={drill.to} className="rounded border border-border px-2 py-0.5 hover:bg-surface-2">
                {drill.kind === "library" ? "Open in Practice" : "Open in Analyze"}
              </Link>
            )}
            <button type="button" data-focus-first onClick={() => setEditing(true)} className="rounded px-2 py-0.5 text-muted hover:bg-surface-2">
              Edit
            </button>
            <DeleteButton
              what="drill"
              onDelete={(from) => {
                onGone(from, `Drill ${drill.name}`);
                void deleteDrill(drill.id).then(onChange);
              }}
            />
          </div>
          {drill.about !== drill.name && <p className="text-xs">{drill.about}</p>}
          {drill.note && <p className="whitespace-pre-wrap">{drill.note}</p>}
          <p className="text-xs text-muted">
            Saved {day(drill.createdAt)}
            {drill.updatedAt !== drill.createdAt ? `, changed ${day(drill.updatedAt)}` : ""}
            {drill.kind === "leak" ? " · dealt from your graded decisions as they are when opened" : " · dealt from the precomputed library"}
          </p>
        </>
      )}
    </li>
  );
}

function ScenarioRow({ scenario, onChange, onGone }: { scenario: SavedScenario; onChange: () => void; onGone: (from: HTMLElement, what: string) => void }) {
  const hold = useFocusHold<HTMLLIElement>();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(scenario.name);
  const [note, setNote] = useState(scenario.note);
  const [failed, setFailed] = useState(false);
  const save = async () => {
    const kept = await stored(() => putScenario({ ...scenario, name: name.trim() || scenario.name, note: note.trim(), updatedAt: Date.now() }));
    setFailed(!kept);
    if (!kept) return;
    setEditing(false);
    onChange();
  };
  const about = scenarioWords(scenario);
  return (
    <li {...hold} aria-label={scenario.name} className="space-y-1 rounded-lg border border-border bg-surface p-3 text-sm">
      {editing ? (
        <form
          aria-label={`Edit ${scenario.name}`}
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <input data-focus-first aria-label="Name" value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded border border-border bg-surface-2 px-2 py-1" />
          <textarea aria-label="Note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="w-full rounded border border-border bg-surface-2 px-2 py-1" />
          <div className="flex gap-2">
            <button type="submit" className="rounded-md bg-accent px-3 py-1 font-medium text-bg">
              Save
            </button>
            <button type="button" onClick={() => setEditing(false)} className="rounded-md border border-border px-3 py-1 hover:bg-surface-2">
              Cancel
            </button>
            {failed && (
              <span role="alert" className="text-xs text-danger">
                {NOT_SAVED}
              </span>
            )}
          </div>
        </form>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <strong>{scenario.name}</strong>
            <span className="flex-1" />
            <Link to={`/practice?scenario=${encodeURIComponent(scenario.id)}`} aria-label={`Start ${scenario.name}`} className="rounded border border-border px-2 py-0.5 hover:bg-surface-2">
              Start in Practice
            </Link>
            <button type="button" data-focus-first onClick={() => setEditing(true)} className="rounded px-2 py-0.5 text-muted hover:bg-surface-2">
              Edit
            </button>
            <DeleteButton
              what="scenario"
              onDelete={(from) => {
                onGone(from, `Scenario ${scenario.name}`);
                void deleteScenario(scenario.id).then(onChange);
              }}
            />
          </div>
          {about !== scenario.name && <p className="text-xs">{about}</p>}
          {scenario.note && <p className="whitespace-pre-wrap">{scenario.note}</p>}
          <p className="text-xs text-muted">
            Saved {day(scenario.createdAt)}
            {scenario.updatedAt !== scenario.createdAt ? `, changed ${day(scenario.updatedAt)}` : ""}
            {" · starts a new session at one table in place of the one in Practice"}
          </p>
        </>
      )}
    </li>
  );
}

function ReportRow({ report, onChange, onGone }: { report: SavedReport; onChange: () => void; onGone: (from: HTMLElement, what: string) => void }) {
  const hold = useFocusHold<HTMLLIElement>();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(report.name);
  const [note, setNote] = useState(report.note);
  const [failed, setFailed] = useState(false);
  const save = async () => {
    const kept = await stored(() => putReport({ ...report, name: name.trim() || report.name, note: note.trim(), updatedAt: Date.now() }));
    setFailed(!kept);
    if (!kept) return;
    setEditing(false);
    onChange();
  };
  const about = reportWords(report.filters);
  return (
    <li {...hold} aria-label={report.name} className="space-y-1 rounded-lg border border-border bg-surface p-3 text-sm">
      {editing ? (
        <form
          aria-label={`Edit ${report.name}`}
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <input data-focus-first aria-label="Name" value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded border border-border bg-surface-2 px-2 py-1" />
          <textarea aria-label="Note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="w-full rounded border border-border bg-surface-2 px-2 py-1" />
          <div className="flex gap-2">
            <button type="submit" className="rounded-md bg-accent px-3 py-1 font-medium text-bg">
              Save
            </button>
            <button type="button" onClick={() => setEditing(false)} className="rounded-md border border-border px-3 py-1 hover:bg-surface-2">
              Cancel
            </button>
            {failed && (
              <span role="alert" className="text-xs text-danger">
                {NOT_SAVED}
              </span>
            )}
          </div>
        </form>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <strong>{report.name}</strong>
            <span className="flex-1" />
            <Link to={reportLink(report.filters)} aria-label={`Open ${report.name}`} className="rounded border border-border px-2 py-0.5 hover:bg-surface-2">
              Open in Analyze
            </Link>
            <button type="button" data-focus-first onClick={() => setEditing(true)} className="rounded px-2 py-0.5 text-muted hover:bg-surface-2">
              Edit
            </button>
            <DeleteButton
              what="report"
              onDelete={(from) => {
                onGone(from, `Report ${report.name}`);
                void deleteReport(report.id).then(onChange);
              }}
            />
          </div>
          {about !== report.name && <p className="text-xs">{about}</p>}
          {report.note && <p className="whitespace-pre-wrap">{report.note}</p>}
          <p className="text-xs text-muted">
            Saved {day(report.createdAt)}
            {report.updatedAt !== report.createdAt ? `, changed ${day(report.updatedAt)}` : ""}
            {" · keeps the filters, not the numbers: opening it counts what's kept by then"}
          </p>
        </>
      )}
    </li>
  );
}

function RangeRow({ range, onChange, onGone }: { range: SavedRange; onChange: () => void; onGone: (from: HTMLElement, what: string) => void }) {
  return (
    <li aria-label={range.name} tabIndex={-1} className="space-y-1 rounded-lg border border-border bg-surface p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <strong>{range.name}</strong>
        <span className="text-muted">
          {range.combos.toFixed(1)} combos · {((range.combos / 1326) * 100).toFixed(1)}% of hands
        </span>
        <span className="flex-1" />
        <Link to={`/ranges?range=${encodeURIComponent(range.id)}`} className="rounded border border-border px-2 py-0.5 hover:bg-surface-2">
          Open in Ranges
        </Link>
        <DeleteButton
          what="range"
          onDelete={(from) => {
            onGone(from, `Range ${range.name}`);
            void deleteRange(range.id).then(onChange);
          }}
        />
      </div>
      <p className="break-all font-mono text-xs text-muted">{range.text || "(empty)"}</p>
    </li>
  );
}

function BackupPanel({ onRestored }: { onRestored: () => void }) {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // saves since the last backup made here (data/backupNudge.ts)
  const [count, setCount] = useState<NudgeState | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => void nudgeState().then((s) => alive && setCount(s));
    load();
    const off = onNudgeState(load);
    return () => {
      alive = false;
      off();
    };
  }, []);

  const download = async () => {
    setMsg(null);
    try {
      const b = await downloadBackup();
      setMsg({
        ok: true,
        text: `Backup made: ${b.counts.savedSpots} spots, ${b.counts.savedDrills} drills, ${b.counts.savedScenarios} scenarios, ${b.counts.savedRanges} ranges, ${b.counts.sessions} sessions, ${b.counts.hands} hands, ${b.counts.decisions} graded decisions, ${b.counts.mistakes} kept mistakes.`,
      });
    } catch (e) {
      console.error("The backup failed:", e);
      setMsg({ ok: false, text: `No backup was made: ${e instanceof Error ? e.message : String(e)}` });
    }
  };

  const restore = async (file: File) => {
    setBusy(true);
    setMsg(null);
    try {
      const big = importTooBig(file.size, "Is this the right file?");
      if (big) throw new Error(big);
      let parsed: unknown;
      try {
        parsed = JSON.parse(await file.text());
      } catch {
        throw new Error("That file isn't JSON.");
      }
      const r = await restoreBackup(parsed);
      setMsg({ ok: true, text: `Restored: ${restoreSummary(r)}. Nothing here was deleted.` });
      onRestored();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="Backup" className="space-y-2 rounded-lg border border-border bg-surface p-3 text-sm">
      <h2 className="text-lg font-semibold">Backup and restore</h2>
      <p className="text-muted">
        One file with your saved spots, saved drills, saved scenarios, saved ranges, session history (Practice hands, drills, leak drills, range-builder scores), and the hands
        imported into Analyze with your tags, notes and grades, and the mistakes kept for review with their schedule; settings are not in it.
        Restoring merges: a record missing here comes back, of two copies the later one stays, and nothing here is deleted.
      </p>
      {count && (
        <p role="group" aria-label="Last backup">
          {count.lastBackupAt ? `Last backup made here ${day(count.lastBackupAt)}` : "No backup made in this browser yet"}
          {`; ${count.saves} ${count.saves === 1 ? "save" : "saves"} ${count.lastBackupAt ? "since" : "counted so far"}.`}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => void download()} className="rounded-md border border-border px-3 py-1.5 hover:bg-surface-2">
          Download backup
        </button>
        <label className="cursor-pointer rounded-md border border-border px-3 py-1.5 hover:bg-surface-2 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent">
          {busy ? "Restoring…" : "Restore from a file"}
          <input
            type="file"
            accept="application/json,.json"
            aria-label="Backup file to restore"
            className="sr-only"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void restore(f);
            }}
          />
        </label>
      </div>
      {msg && (
        <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "" : "text-danger"}>
          {msg.text}
        </p>
      )}
    </section>
  );
}
