// The backup reminder (data/backupNudge.ts): rarely (many saves, weeks of them, no backup), one quiet line under the
// header says that it's all in this browser only, with a link that downloads a backup and one that puts it off a month.
// Not on the Saved page, whose backup panel says the same, and never once account sync is on (it keeps a copy).
import { useEffect, useState } from "react";
import { useLocation } from "react-router";
import { nudgeDue, nudgeState, onNudgeState, snoozeNudge, type NudgeState } from "@/data/backupNudge";
import { downloadBackup } from "@/features/saved/backupFile";

// (sync/session.ts's FLAG, set while signed in; not imported, which would load sync into the first bundle)
const syncing = () => {
  try {
    return localStorage.getItem("lizard-sync") !== null;
  } catch {
    return false;
  }
};

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
  if (!s || !nudgeDue(s) || pathname === "/saved" || syncing()) return null;
  return (
    <div role="region" aria-label="Backup reminder" className="border-b border-border px-4 py-1.5 text-center text-xs text-muted">
      Your saved work is only in this browser.{" "}
      <button
        type="button"
        onClick={() => {
          setFailed(null);
          downloadBackup().catch((e: unknown) => setFailed(e instanceof Error ? e.message : String(e)));
        }}
        className="text-text underline underline-offset-2 hover:text-accent"
      >
        Download a backup
      </button>
      {" · "}
      <button type="button" onClick={() => void snoozeNudge()} className="underline-offset-2 hover:text-text hover:underline">
        Later
      </button>
      {failed && (
        <span role="alert" className="ml-2 text-danger">
          Not made: {failed}
        </span>
      )}
    </div>
  );
}
