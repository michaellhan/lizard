// Saved: the spots saved from Study and the ranges saved from the Ranges editor, kept in this browser (IndexedDB),
// with search, rename, delete, and a backup to one JSON file and back (data/backup.ts).
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import type { SavedRange, SavedSpot } from "@/data/db";
import { backupFileName, makeBackup, restoreBackup, restoreSummary } from "@/data/backup";
import { deleteRange, deleteSpot, listRanges, listSpots, putSpot, readTags, spotMatches } from "@/data/saved";
import { describeLine, fromSearch } from "@/features/study/studyState";

const lineText = (line: string) => {
  const h = fromSearch(line);
  return h ? [`${h.players === 2 ? "HU" : `${h.players}-max`} ${h.stack}bb`, ...describeLine(h)].join(" · ") : line;
};
const day = (t: number) => new Date(t).toLocaleDateString();

export function SavedPage() {
  const [spots, setSpots] = useState<SavedSpot[] | null>(null);
  const [ranges, setRanges] = useState<SavedRange[] | null>(null);
  const [query, setQuery] = useState("");
  const [n, setN] = useState(0);
  const reload = () => setN((x) => x + 1);

  useEffect(() => {
    let alive = true;
    void Promise.all([listSpots(), listRanges()]).then(([s, r]) => {
      if (!alive) return;
      setSpots(s);
      setRanges(r);
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
          Spots saved from Study and ranges saved from Ranges. They're kept in this browser only: back them up to a file to keep them safe or to move
          them to another browser.
        </p>
      </div>

      <section aria-label="Saved spots" className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold">Spots</h2>
          <span className="text-sm text-muted">{spots ? `${spots.length} saved` : "…"}</span>
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
            <SpotRow key={s.id} spot={s} onChange={reload} />
          ))}
        </ul>
      </section>

      <section aria-label="Saved ranges" className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold">Ranges</h2>
          <span className="text-sm text-muted">{ranges ? `${ranges.length} saved` : "…"}</span>
        </div>
        {ranges && ranges.length === 0 && (
          <p className="rounded-lg border border-border bg-surface p-3 text-sm text-muted">
            No saved ranges yet. The <Link to="/ranges" className="underline">Ranges</Link> editor saves one under a name.
          </p>
        )}
        <ul className="space-y-2">
          {(ranges ?? []).map((r) => (
            <RangeRow key={r.id} range={r} onChange={reload} />
          ))}
        </ul>
      </section>

      <BackupPanel onRestored={reload} />
    </div>
  );
}

/** A delete that asks once more before it acts. */
function DeleteButton({ what, onDelete }: { what: string; onDelete: () => void }) {
  const [sure, setSure] = useState(false);
  return sure ? (
    <span className="inline-flex items-center gap-1">
      <button type="button" onClick={onDelete} className="rounded border border-danger/60 px-2 py-0.5 text-danger hover:bg-danger/10">
        Delete {what}
      </button>
      <button type="button" onClick={() => setSure(false)} className="rounded px-2 py-0.5 text-muted hover:bg-surface-2">
        Keep
      </button>
    </span>
  ) : (
    <button type="button" onClick={() => setSure(true)} className="rounded px-2 py-0.5 text-muted hover:bg-surface-2">
      Delete
    </button>
  );
}

function SpotRow({ spot, onChange }: { spot: SavedSpot; onChange: () => void }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(spot.title);
  const [tags, setTags] = useState(spot.tags.join(", "));
  const [note, setNote] = useState(spot.note);
  const save = async () => {
    await putSpot({ ...spot, title: title.trim() || spot.title, tags: readTags(tags), note: note.trim(), updatedAt: Date.now() });
    setEditing(false);
    onChange();
  };
  return (
    <li aria-label={spot.title} className="space-y-1 rounded-lg border border-border bg-surface p-3 text-sm">
      {editing ? (
        <form
          aria-label={`Edit ${spot.title}`}
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <input aria-label="Name" value={title} onChange={(e) => setTitle(e.target.value)} className="w-full rounded border border-border bg-surface-2 px-2 py-1" />
          <input aria-label="Tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="Tags, separated by commas" className="w-full rounded border border-border bg-surface-2 px-2 py-1" />
          <textarea aria-label="Note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="w-full rounded border border-border bg-surface-2 px-2 py-1" />
          <div className="flex gap-2">
            <button type="submit" className="rounded-md bg-accent px-3 py-1 font-medium text-bg">
              Save
            </button>
            <button type="button" onClick={() => setEditing(false)} className="rounded-md border border-border px-3 py-1 hover:bg-surface-2">
              Cancel
            </button>
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
            <button type="button" onClick={() => setEditing(true)} className="rounded px-2 py-0.5 text-muted hover:bg-surface-2">
              Edit
            </button>
            <DeleteButton
              what="spot"
              onDelete={() => {
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

function RangeRow({ range, onChange }: { range: SavedRange; onChange: () => void }) {
  return (
    <li aria-label={range.name} className="space-y-1 rounded-lg border border-border bg-surface p-3 text-sm">
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
          onDelete={() => {
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

  const download = async () => {
    setMsg(null);
    const b = await makeBackup();
    const blob = new Blob([JSON.stringify(b, null, 1)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = backupFileName();
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMsg({ ok: true, text: `Backup made: ${b.counts.savedSpots} spots, ${b.counts.savedRanges} ranges, ${b.counts.sessions} sessions.` });
  };

  const restore = async (file: File) => {
    setBusy(true);
    setMsg(null);
    try {
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
        One file with your saved spots, saved ranges and session history (Practice hands, drills, range-builder scores); settings are not in it.
        Restoring merges: a record missing here comes back, of two copies the later one stays, and nothing here is deleted.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => void download()} className="rounded-md border border-border px-3 py-1.5 hover:bg-surface-2">
          Download backup
        </button>
        <label className="cursor-pointer rounded-md border border-border px-3 py-1.5 hover:bg-surface-2">
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
