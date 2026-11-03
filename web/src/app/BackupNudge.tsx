// The backup reminder (data/backupNudge.ts): past a number of saves since the last backup, a line under the header
// says that all of it is in this browser only, with a button that downloads a backup and one that puts it off. Not on
// the Saved page, whose backup panel says the same.
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router";
import { nudgeDue, nudgeState, onNudgeState, snoozeNudge, type NudgeState } from "@/data/backupNudge";
import { downloadBackup } from "@/features/saved/backupFile";

export function BackupNudge() {
  const [s, setS] = useState<NudgeState | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const { pathname } = useLocation();
  useEffect(() => {
    let alive = true;
    const load = () => void nudgeState().then((x) => alive && setS(x));
    load();
    const off = onNudgeState(load);
    return () => {
      alive = false;
      off();
    };
  }, []);
  if (!s || !nudgeDue(s) || pathname === "/saved") return null;
  return (
    <div role="region" aria-label="Backup reminder" className="border-b border-border bg-surface-2 px-4 py-2 text-center text-sm">
      {s.saves} saves since {s.lastBackupAt ? `your last backup (${new Date(s.lastBackupAt).toLocaleDateString()})` : "Lizard started counting, and no backup yet"}: they&rsquo;re kept in this
      browser only, and a browser can clear a site&rsquo;s data (a phone short of space, Safari after weeks away).{" "}
      <button
        type="button"
        onClick={() => {
          setFailed(null);
          downloadBackup().catch((e: unknown) => setFailed(e instanceof Error ? e.message : String(e)));
        }}
        className="rounded border border-border px-2 py-0.5 hover:bg-surface-3"
      >
        Download a backup
      </button>{" "}
      <button type="button" onClick={() => void snoozeNudge()} className="rounded px-2 py-0.5 text-muted hover:bg-surface-3">
        Not now
      </button>{" "}
      <Link to="/saved" className="text-muted underline">
        Backup and restore
      </Link>
      {failed && (
        <span role="alert" className="ml-2 text-danger">
          Not made: {failed}
        </span>
      )}
    </div>
  );
}
