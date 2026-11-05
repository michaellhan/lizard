// What the page offers when the browser won't open the database (data/db.ts): what happened, trying again, a download of
// whatever can still be read (data/recovery.ts), and starting fresh, which deletes it all. That last is behind a confirm
// that says what goes, and is followed by the chance to restore a backup. The notice over it (app/DbNotice.tsx) says that
// nothing is being kept; this says what can be done.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { backupFileName } from "@/data/backup";
import { db, dbFailure, dbState, deleteLizardDB, onDbState } from "@/data/db";
import { FAILURE_WORDS, WHOLE_LOSS, salvage, salvageWords, type Salvage } from "@/data/recovery";
import { restoreFile, saveBackup } from "./backupFile";

type Stage = "failed" | "confirm" | "deleting" | "blocked" | "fresh";

const BUTTON = "rounded-md border border-border px-3 py-1.5 hover:bg-surface-2";

export function DbRecovery({ reload = () => location.reload() }: { reload?: () => void }) {
  const state = useSyncExternalStore(onDbState, dbState);
  const [stage, setStage] = useState<Stage>("failed");
  // (a delete under way opens the new database itself, and stays up from there for the restore)
  if (state !== "failed" && stage !== "fresh" && stage !== "deleting" && stage !== "blocked") return null;
  return <Panel stage={stage} setStage={setStage} reload={reload} />;
}

function Panel({ stage, setStage, reload }: { stage: Stage; setStage: (s: Stage) => void; reload: () => void }) {
  const kind = dbFailure()?.kind ?? "damaged";
  const storing = kind !== "unavailable";
  // undefined while reading
  const [found, setFound] = useState<Salvage | undefined>(storing ? undefined : { backup: null, read: 0, unread: [] });
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  const [trying, setTrying] = useState(false);
  const keep = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!storing) return;
    let alive = true;
    void salvage().then((s) => alive && setFound(s));
    return () => {
      alive = false;
    };
  }, [storing]);
  useEffect(() => {
    if (stage === "confirm") keep.current?.focus();
  }, [stage]);

  const again = async () => {
    setTrying(true);
    setSaid(null);
    await db();
    setTrying(false);
    // (every page read nothing while it failed: a reload lets them read what's there)
    if (dbState() === "ok") reload();
    else setSaid({ ok: false, text: "It still won't open." });
  };

  const download = () => {
    if (!found?.backup) return;
    saveBackup(found.backup, backupFileName(new Date(), "recovered"));
    setSaid({ ok: true, text: `Downloaded ${found.read} record${found.read === 1 ? "" : "s"}. Restore this file from the Saved page to bring them back.` });
  };

  const startFresh = async () => {
    setStage("deleting");
    setSaid(null);
    try {
      const open = await deleteLizardDB(() => setStage("blocked"));
      if (open) setStage("fresh");
      else {
        setStage("failed");
        setSaid({ ok: false, text: "The old data is deleted, but a new database wouldn't open either." });
      }
    } catch (e) {
      console.error("Starting fresh failed:", e);
      setStage("failed");
      setSaid({ ok: false, text: "The browser wouldn't delete it, so nothing has changed. Clearing this site's data in the browser's settings does the same." });
    }
  };

  const restore = async (file: File) => {
    setSaid(null);
    try {
      setSaid({ ok: true, text: await restoreFile(file) });
    } catch (e) {
      setSaid({ ok: false, text: e instanceof Error ? e.message : String(e) });
    }
  };

  const readWords = !found ? "Looking for what can still be read…" : found.read ? `It can still read ${salvageWords(found)}.` : storing ? "Nothing could be read from it." : "";
  const partly = found?.unread.length ? ` ${found.unread.length} part${found.unread.length === 1 ? "" : "s"} of it couldn't be read to the end, so the file may be short.` : "";

  return (
    <section aria-label="Saved data recovery" className="mx-auto w-full max-w-3xl space-y-2 px-4 pt-4 text-sm">
      <div className="space-y-2 rounded-lg border border-warn/50 bg-surface p-3">
        {stage === "fresh" ? (
          <>
            <h2 className="text-lg font-semibold">Started fresh</h2>
            <p>The old data is gone and this browser is keeping data again. If you have a backup, restore it here.</p>
            <div className="flex flex-wrap items-center gap-2">
              <label className={`${BUTTON} cursor-pointer focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent`}>
                Restore from a file
                <input
                  type="file"
                  accept="application/json,.json"
                  aria-label="Backup file to restore"
                  className="sr-only"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f) void restore(f);
                  }}
                />
              </label>
              <button type="button" onClick={reload} className={BUTTON}>
                Reload the page
              </button>
            </div>
          </>
        ) : stage === "confirm" ? (
          <>
            <h2 className="text-lg font-semibold">Delete everything kept here?</h2>
            <p role="alert">
              Starting fresh deletes {WHOLE_LOSS}{found?.read ? ` (it can still read ${salvageWords(found)})` : ""}. It can&rsquo;t be undone
              {found?.backup ? ", so download what can be read first" : ""}. A backup file you already have isn&rsquo;t touched, and you can restore it straight after.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <button ref={keep} type="button" onClick={() => setStage("failed")} className={BUTTON}>
                Keep it
              </button>
              <button type="button" onClick={() => void startFresh()} className="rounded-md bg-danger px-3 py-1.5 font-medium text-bg">
                Delete everything and start fresh
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 className="text-lg font-semibold">Lizard&rsquo;s saved data won&rsquo;t open</h2>
            <p>{FAILURE_WORDS[kind]}</p>
            {readWords && (
              <p role="status">
                {readWords}
                {partly}
              </p>
            )}
            {stage === "blocked" && <p role="status">Another Lizard tab is holding the data. Close the other Lizard tabs and this carries on.</p>}
            {stage === "deleting" && <p role="status">Deleting…</p>}
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" disabled={trying} onClick={() => void again()} className={BUTTON}>
                Try again
              </button>
              {found?.backup && (
                <button type="button" onClick={download} className={BUTTON}>
                  Download what can be read
                </button>
              )}
              {storing && (
                <button type="button" disabled={stage !== "failed"} onClick={() => setStage("confirm")} className={BUTTON}>
                  Start fresh…
                </button>
              )}
            </div>
          </>
        )}
        {said && (
          <p role={said.ok ? "status" : "alert"} className={said.ok ? "" : "text-danger"}>
            {said.text}
          </p>
        )}
      </div>
    </section>
  );
}
