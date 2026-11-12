// Saved: the spots saved from Study with their answers, the drills saved from Practice and Analyze, the Practice scenarios
// to start again, and the ranges saved from the Ranges editor, kept in this browser (IndexedDB), with search, sort, tags,
// rename, delete, one item to a file, and a backup to one JSON file and back (data/backup.ts).
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { DeleteButton } from "@/components/DeleteButton";
import { useFocusHold } from "@/components/useFocusHold";
import type { SavedDrill, SavedRange, SavedReport, SavedScenario, SavedSpot } from "@/data/db";
import { answerWords, kb, listAnswers, seenWords, type KeptAnswer } from "@/data/answers";
import { nudgeState, onNudgeState, type NudgeState } from "@/data/backupNudge";
import { kvGet, kvSet } from "@/data/db";
import { NOT_SAVED, SAVED_SORTS, deleteDrill, deleteRange, deleteSpot, isDrillLink, isSavedSort, listDrills, listRanges, listSpots, putDrill, putRange, putSpot, readTags, sortSaved, spotMatches, stored, textMatches, type SavedSort } from "@/data/saved";
import { deleteReport, listReports, putReport, reportLink, reportWords } from "@/data/reports";
import { deleteScenario, listScenarios, putScenario, scenarioWords } from "@/data/scenarios";
import { describeSetup } from "@/features/solve/setup";
import { describeLine, fromSearch } from "@/features/study/studyState";
import { downloadBackup, downloadItem, restoreFile } from "./backupFile";
import { useCurrentBuild } from "./useSavedAnswer";

const lineText = (line: string) => {
  const h = fromSearch(line);
  return h ? [`${h.players === 2 ? "HU" : `${h.players}-max`} ${h.stack}bb`, ...describeSetup(h.setup), ...describeLine(h)].join(" · ") : line;
};
const day = (t: number) => new Date(t).toLocaleDateString();
const SORT_KEY = "savedSort";

/** A record's tags as the page draws them. */
function TagChips({ tags }: { tags?: string[] }) {
  return tags?.map((t) => (
    <span key={t} className="rounded bg-surface-3 px-1.5 py-0.5 text-xs">
      {t}
    </span>
  ));
}

function TagsField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <input aria-label="Tags" value={value} onChange={(e) => onChange(e.target.value)} placeholder="Tags, separated by commas" className="w-full rounded border border-border bg-surface-2 px-2 py-1" />;
}

/** One item to a file a restore takes (data/backup.ts itemBackup). */
function ExportButton({ name, item }: { name: string; item: Parameters<typeof downloadItem> }) {
  const [failed, setFailed] = useState(false);
  const save = async () => {
    setFailed(false);
    try {
      await downloadItem(...item);
    } catch (e) {
      console.error("The export failed:", e);
      setFailed(true);
    }
  };
  return (
    <>
      <button type="button" aria-label={`Export ${name}`} title="Download as a file" onClick={() => void save()} className="rounded px-2 py-0.5 text-muted hover:bg-surface-2">
        Export
      </button>
      {failed && (
        <span role="alert" className="text-xs text-danger">
          No file was made.
        </span>
      )}
    </>
  );
}

export function SavedPage() {
  const [spots, setSpots] = useState<SavedSpot[] | null>(null);
  const [ranges, setRanges] = useState<SavedRange[] | null>(null);
  const [drills, setDrills] = useState<SavedDrill[] | null>(null);
  const [scenarios, setScenarios] = useState<{ list: SavedScenario[]; damaged: number } | null>(null);
  const [reports, setReports] = useState<{ list: SavedReport[]; damaged: number } | null>(null);
  const [answers, setAnswers] = useState<Map<string, KeptAnswer | null>>(new Map());
  const current = useCurrentBuild();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SavedSort>("changed");
  const pickSort = (s: SavedSort) => {
    setSort(s);
    void kvSet(SORT_KEY, s);
  };
  const [n, setN] = useState(0);
  const reload = () => setN((x) => x + 1);
  // a row being deleted: said at once, and the keyboard goes to the row that takes its place once it's gone
  const leaving = useRef<HTMLElement | null>(null);
  const place = useRef<{ list: Element; at: number } | null>(null);
  const [said, setSaid] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
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
    // (the last one of a kind gone takes its section with it: the keyboard goes to the page's heading)
    const row = list.isConnected ? (list.children[at] ?? list.lastElementChild ?? list.closest("section")) : heading.current;
    (row as HTMLElement | null)?.focus();
  });

  useEffect(() => {
    let alive = true;
    void kvGet<unknown>(SORT_KEY).then((s) => alive && isSavedSort(s) && setSort(s));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    void Promise.all([listSpots(), listRanges(), listDrills(), listScenarios(), listReports(), listAnswers()]).then(([s, r, d, c, p, a]) => {
      if (!alive) return;
      setSpots(s);
      setRanges(r);
      setDrills(d);
      setScenarios(c);
      setReports(p);
      setAnswers(a);
    });
    return () => {
      alive = false;
    };
  }, [n]);

  const shown = useMemo(() => sortSaved((spots ?? []).filter((s) => spotMatches(s, query, lineText(s.line))), sort, (s) => s.title), [spots, query, sort]);
  const shownDrills = useMemo(() => sortSaved((drills ?? []).filter((d) => textMatches([d.name, d.about, d.note, ...(d.tags ?? [])], query)), sort, (d) => d.name), [drills, query, sort]);
  const shownScenarios = useMemo(() => sortSaved((scenarios?.list ?? []).filter((c) => textMatches([c.name, c.note, ...(c.tags ?? []), scenarioWords(c)], query)), sort, (c) => c.name), [scenarios, query, sort]);
  const shownReports = useMemo(() => sortSaved((reports?.list ?? []).filter((r) => textMatches([r.name, r.note, ...(r.tags ?? []), reportWords(r.filters)], query)), sort, (r) => r.name), [reports, query, sort]);
  const shownRanges = useMemo(() => sortSaved((ranges ?? []).filter((r) => textMatches([r.name, r.note, ...(r.tags ?? []), r.text], query)), sort, (r) => r.name), [ranges, query, sort]);

  // (everything read, and nothing kept of any kind)
  const nothing = !!spots && !!drills && !!scenarios && !!reports && !!ranges && !spots.length && !drills.length && !scenarios.list.length && !scenarios.damaged && !reports.list.length && !reports.damaged && !ranges.length;

  return (
    <div className="space-y-6">
      <div>
        <h1 ref={heading} tabIndex={-1} className="text-2xl font-semibold">
          Saved
        </h1>
      </div>
      <p role="status" className="sr-only">
        {said}
      </p>
      {nothing ? (
        <p className="text-sm text-muted">
          Nothing saved yet. Save spots in <Link to="/study" className="underline">Study</Link>, ranges in <Link to="/ranges" className="underline">Ranges</Link>, drills and scenarios in{" "}
          <Link to="/practice" className="underline">Practice</Link>, reports in <Link to="/analyze" className="underline">Analyze</Link>.
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            aria-label="Search everything saved"
            placeholder="Search names, tags, notes, lines"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-64 max-w-full rounded border border-border bg-surface-2 px-2 py-1 text-sm"
          />
          <label className="flex items-center gap-1 text-sm text-muted">
            Sort
            <select value={sort} onChange={(e) => pickSort(e.target.value as SavedSort)} className="rounded border border-border bg-surface-2 px-2 py-1 text-text">
              {SAVED_SORTS.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {!!spots?.length && (
        <section aria-label="Saved spots" tabIndex={-1} className="space-y-2">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <h2 className="text-lg font-semibold">Spots</h2>
            <span className="text-sm text-muted">{spots.length}</span>
          </div>
          {spots && spots.length > 0 && shown.length === 0 && <p className="text-sm text-muted">No saved spot matches “{query}”.</p>}
          <ul className="space-y-2">
            {shown.map((s) => (
              <SpotRow key={s.id} spot={s} answer={answers.get(s.id)} current={current} onChange={reload} onGone={onGone} />
            ))}
          </ul>
        </section>
      )}

      {!!drills?.length && (
        <section aria-label="Saved drills" tabIndex={-1} className="space-y-2">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <h2 className="text-lg font-semibold">Drills</h2>
            <span className="text-sm text-muted">{drills.length}</span>
          </div>
          {!!drills?.length && !shownDrills.length && <p className="text-sm text-muted">No saved drill matches “{query}”.</p>}
          <ul className="space-y-2">
            {shownDrills.map((d) => (
              <DrillRow key={d.id} drill={d} onChange={reload} onGone={onGone} />
            ))}
          </ul>
        </section>
      )}

      {!!(scenarios?.list.length || scenarios?.damaged) && (
        <section aria-label="Saved scenarios" tabIndex={-1} className="space-y-2">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <h2 className="text-lg font-semibold">Scenarios</h2>
            <span className="text-sm text-muted">{scenarios.list.length}</span>
          </div>
          {!!scenarios?.damaged && (
            <p role="status" className="text-sm text-warn">
              {scenarios.damaged} saved scenario{scenarios.damaged === 1 ? "" : "s"} can&rsquo;t be read.
            </p>
          )}
          {!!scenarios?.list.length && !shownScenarios.length && <p className="text-sm text-muted">No saved scenario matches “{query}”.</p>}
          <ul className="space-y-2">
            {shownScenarios.map((s) => (
              <ScenarioRow key={s.id} scenario={s} onChange={reload} onGone={onGone} />
            ))}
          </ul>
        </section>
      )}

      {!!(reports?.list.length || reports?.damaged) && (
        <section aria-label="Saved reports" tabIndex={-1} className="space-y-2">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <h2 className="text-lg font-semibold">Reports</h2>
            <span className="text-sm text-muted">{reports.list.length}</span>
          </div>
          {!!reports?.damaged && (
            <p role="status" className="text-sm text-warn">
              {reports.damaged} saved report{reports.damaged === 1 ? "" : "s"} can&rsquo;t be read.
            </p>
          )}
          {!!reports?.list.length && !shownReports.length && <p className="text-sm text-muted">No saved report matches “{query}”.</p>}
          <ul className="space-y-2">
            {shownReports.map((r) => (
              <ReportRow key={r.id} report={r} onChange={reload} onGone={onGone} />
            ))}
          </ul>
        </section>
      )}

      {!!ranges?.length && (
        <section aria-label="Saved ranges" tabIndex={-1} className="space-y-2">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <h2 className="text-lg font-semibold">Ranges</h2>
            <span className="text-sm text-muted">{ranges.length}</span>
          </div>
          {!!ranges?.length && !shownRanges.length && <p className="text-sm text-muted">No saved range matches “{query}”.</p>}
          <ul className="space-y-2">
            {shownRanges.map((r) => (
              <RangeRow key={r.id} range={r} onChange={reload} onGone={onGone} />
            ))}
          </ul>
        </section>
      )}

      <BackupPanel onRestored={reload} />
    </div>
  );
}

function SpotRow({ spot, answer, current, onChange, onGone }: { spot: SavedSpot; answer: KeptAnswer | null | undefined; current: string | null; onChange: () => void; onGone: (from: HTMLElement, what: string) => void }) {
  // (Edit takes the keyboard to the form's first field, and Cancel or Save brings it back to Edit)
  const hold = useFocusHold<HTMLLIElement>();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(spot.title);
  const [tags, setTags] = useState(spot.tags.join(", "));
  const [note, setNote] = useState(spot.note);
  const [failed, setFailed] = useState(false);
  const edit = () => {
    setTitle(spot.title);
    setTags(spot.tags.join(", "));
    setNote(spot.note);
    setFailed(false);
    setEditing(true);
  };
  const seen = seenWords(spot.seen, spot.line);
  const save = async () => {
    const kept = await stored(() => putSpot({ ...spot, title: title.trim() || spot.title, tags: readTags(tags), note: note.trim(), updatedAt: Date.now() }));
    setFailed(!kept);
    if (!kept) return;
    setEditing(false);
    onChange();
  };
  return (
    <li {...hold} aria-label={spot.title} className="space-y-1 panel p-3 text-sm">
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
          <TagsField value={tags} onChange={setTags} />
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
            <TagChips tags={spot.tags} />
            <span className="flex-1" />
            <Link to={`/study?${spot.line}${answer ? `&saved=${encodeURIComponent(spot.id)}` : ""}`} className="rounded border border-border px-2 py-0.5 hover:bg-surface-2">
              Open in Study
            </Link>
            <button type="button" data-focus-first onClick={edit} className="rounded px-2 py-0.5 text-muted hover:bg-surface-2">
              Edit
            </button>
            <ExportButton name={spot.title} item={["savedSpots", spot]} />
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
            {seen && !answer ? ` · the answer then: ${seen}` : ""}
          </p>
          {answer && (
            <p className="text-xs">
              Answer kept: {answer.label} ({kb(answer.bytes)}). {answerWords(answer, current)}
            </p>
          )}
          {answer === null && <p className="text-xs text-warn">Saved answer unreadable: opening it solves again.</p>}
        </>
      )}
    </li>
  );
}

function DrillRow({ drill, onChange, onGone }: { drill: SavedDrill; onChange: () => void; onGone: (from: HTMLElement, what: string) => void }) {
  const hold = useFocusHold<HTMLLIElement>();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(drill.name);
  const [tags, setTags] = useState((drill.tags ?? []).join(", "));
  const [note, setNote] = useState(drill.note);
  const [failed, setFailed] = useState(false);
  const edit = () => {
    setName(drill.name);
    setTags((drill.tags ?? []).join(", "));
    setNote(drill.note);
    setFailed(false);
    setEditing(true);
  };
  const save = async () => {
    const kept = await stored(() => putDrill({ ...drill, name: name.trim() || drill.name, tags: readTags(tags), note: note.trim(), updatedAt: Date.now() }));
    setFailed(!kept);
    if (!kept) return;
    setEditing(false);
    onChange();
  };
  return (
    <li {...hold} aria-label={drill.name} className="space-y-1 panel p-3 text-sm">
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
          <TagsField value={tags} onChange={setTags} />
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
            <TagChips tags={drill.tags} />
            <span className="flex-1" />
            {isDrillLink(drill.kind, drill.to) && (
              <Link to={drill.to} className="rounded border border-border px-2 py-0.5 hover:bg-surface-2">
                {drill.kind === "library" ? "Open in Practice" : "Open in Analyze"}
              </Link>
            )}
            <button type="button" data-focus-first onClick={edit} className="rounded px-2 py-0.5 text-muted hover:bg-surface-2">
              Edit
            </button>
            <ExportButton name={drill.name} item={["savedDrills", drill]} />
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
  const [tags, setTags] = useState((scenario.tags ?? []).join(", "));
  const [note, setNote] = useState(scenario.note);
  const [failed, setFailed] = useState(false);
  const edit = () => {
    setName(scenario.name);
    setTags((scenario.tags ?? []).join(", "));
    setNote(scenario.note);
    setFailed(false);
    setEditing(true);
  };
  const save = async () => {
    const kept = await stored(() => putScenario({ ...scenario, name: name.trim() || scenario.name, tags: readTags(tags), note: note.trim(), updatedAt: Date.now() }));
    setFailed(!kept);
    if (!kept) return;
    setEditing(false);
    onChange();
  };
  const about = scenarioWords(scenario);
  return (
    <li {...hold} aria-label={scenario.name} className="space-y-1 panel p-3 text-sm">
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
          <TagsField value={tags} onChange={setTags} />
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
            <TagChips tags={scenario.tags} />
            <span className="flex-1" />
            <Link to={`/practice?scenario=${encodeURIComponent(scenario.id)}`} aria-label={`Start ${scenario.name}`} className="rounded border border-border px-2 py-0.5 hover:bg-surface-2">
              Start in Practice
            </Link>
            <button type="button" data-focus-first onClick={edit} className="rounded px-2 py-0.5 text-muted hover:bg-surface-2">
              Edit
            </button>
            <ExportButton name={scenario.name} item={["savedScenarios", scenario]} />
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
  const [tags, setTags] = useState((report.tags ?? []).join(", "));
  const [note, setNote] = useState(report.note);
  const [failed, setFailed] = useState(false);
  const edit = () => {
    setName(report.name);
    setTags((report.tags ?? []).join(", "));
    setNote(report.note);
    setFailed(false);
    setEditing(true);
  };
  const save = async () => {
    const kept = await stored(() => putReport({ ...report, name: name.trim() || report.name, tags: readTags(tags), note: note.trim(), updatedAt: Date.now() }));
    setFailed(!kept);
    if (!kept) return;
    setEditing(false);
    onChange();
  };
  const about = reportWords(report.filters);
  return (
    <li {...hold} aria-label={report.name} className="space-y-1 panel p-3 text-sm">
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
          <TagsField value={tags} onChange={setTags} />
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
            <TagChips tags={report.tags} />
            <span className="flex-1" />
            <Link to={reportLink(report.filters)} aria-label={`Open ${report.name}`} className="rounded border border-border px-2 py-0.5 hover:bg-surface-2">
              Open in Analyze
            </Link>
            <button type="button" data-focus-first onClick={edit} className="rounded px-2 py-0.5 text-muted hover:bg-surface-2">
              Edit
            </button>
            <ExportButton name={report.name} item={["savedReports", report]} />
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
  const hold = useFocusHold<HTMLLIElement>();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(range.name);
  const [tags, setTags] = useState((range.tags ?? []).join(", "));
  const [note, setNote] = useState(range.note);
  const [failed, setFailed] = useState(false);
  const edit = () => {
    setName(range.name);
    setTags((range.tags ?? []).join(", "));
    setNote(range.note);
    setFailed(false);
    setEditing(true);
  };
  const save = async () => {
    const kept = await stored(() => putRange({ ...range, name: name.trim() || range.name, tags: readTags(tags), note: note.trim(), updatedAt: Date.now() }));
    setFailed(!kept);
    if (!kept) return;
    setEditing(false);
    onChange();
  };
  return (
    <li {...hold} aria-label={range.name} className="space-y-1 panel p-3 text-sm">
      {editing ? (
        <form
          aria-label={`Edit ${range.name}`}
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <input data-focus-first aria-label="Name" value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded border border-border bg-surface-2 px-2 py-1" />
          <TagsField value={tags} onChange={setTags} />
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
            <strong>{range.name}</strong>
            <TagChips tags={range.tags} />
            <span className="text-muted">
              {range.combos.toFixed(1)} combos · {((range.combos / 1326) * 100).toFixed(1)}% of hands
            </span>
            <span className="flex-1" />
            <Link to={`/ranges?range=${encodeURIComponent(range.id)}`} className="rounded border border-border px-2 py-0.5 hover:bg-surface-2">
              Open in Ranges
            </Link>
            <button type="button" data-focus-first onClick={edit} className="rounded px-2 py-0.5 text-muted hover:bg-surface-2">
              Edit
            </button>
            <ExportButton name={range.name} item={["savedRanges", range]} />
            <DeleteButton
              what="range"
              onDelete={(from) => {
                onGone(from, `Range ${range.name}`);
                void deleteRange(range.id).then(onChange);
              }}
            />
          </div>
          <p className="break-all font-mono text-xs text-muted">{range.text || "(empty)"}</p>
          {range.note && <p className="whitespace-pre-wrap">{range.note}</p>}
        </>
      )}
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
        text: `Backup made: ${b.counts.savedSpots} spots, ${b.counts.savedAnswers} saved answers, ${b.counts.savedDrills} drills, ${b.counts.savedScenarios} scenarios, ${b.counts.savedRanges} ranges, ${b.counts.savedReports} saved reports, ${b.counts.sessions} sessions, ${b.counts.hands} hands, ${b.counts.decisions} graded decisions, ${b.counts.mistakes} kept mistakes.`,
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
      setMsg({ ok: true, text: await restoreFile(file) });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
      // (a restore stopped partway still brought some in)
      onRestored();
    }
  };

  return (
    <section aria-label="Backup" className="space-y-2 panel p-3 text-sm">
      <h2 className="text-lg font-semibold">Backup and restore</h2>
      <p className="text-muted">Everything but settings. A restore merges.</p>
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
