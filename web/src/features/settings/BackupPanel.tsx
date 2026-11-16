// Backup and restore: everything kept in this browser (saved items, sessions, hands, grades, kept mistakes) to one JSON
// file and back, merging (data/backup.ts). On Settings, beside account sync, since it's about all of your data.
import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router";
import { nudgeState, onNudgeState, type NudgeState } from "@/data/backupNudge";
import { downloadBackup, restoreFile } from "@/features/saved/backupFile";

const day = (t: number) => new Date(t).toLocaleDateString();

export function BackupPanel({ onRestored }: { onRestored?: () => void }) {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // opened at /settings#backup (Saved's link): the panel comes into view and takes the keyboard, after the page's own
  // move to its heading (Shell's RouteChange)
  const { hash } = useLocation();
  const box = useRef<HTMLElement>(null);
  useEffect(() => {
    if (hash !== "#backup") return;
    const f = requestAnimationFrame(() => {
      box.current?.scrollIntoView({ block: "start" });
      box.current?.focus();
    });
    return () => cancelAnimationFrame(f);
  }, [hash]);

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
        text: `Backup made: ${b.counts.savedSpots} spots, ${b.counts.savedAnswers} saved answers, ${b.counts.savedDrills} drills, ${b.counts.savedScenarios} scenarios, ${b.counts.savedRanges} ranges, ${b.counts.savedReports} saved reports, ${b.counts.flopReports} flop reports, ${b.counts.sessions} sessions, ${b.counts.hands} hands, ${b.counts.decisions} graded decisions, ${b.counts.mistakes} kept mistakes.`,
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
      onRestored?.();
    }
  };

  return (
    <section ref={box} id="backup" tabIndex={-1} aria-label="Backup" className="space-y-2 panel p-3 text-sm">
      <h2 className="text-lg font-semibold">Backup and restore</h2>
      <p className="text-muted">Everything but settings. A restore merges.</p>
      {count && (
        <p role="group" aria-label="Last backup">
          {count.lastBackupAt ? `Last backup made here ${day(count.lastBackupAt)}` : "No backup made in this browser yet"}
          {/* (every write to the data counts, hands kept and imported too, not only this page's saved spots) */}
          {`; ${count.saves} ${count.saves === 1 ? "change" : "changes"} to your data ${count.lastBackupAt ? "since" : "so far"}.`}
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
