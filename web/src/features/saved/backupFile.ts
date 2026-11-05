// A backup of everything kept here (data/backup.ts) saved by the browser as a file, and the backup reminder's count
// started again (data/backupNudge.ts); one saved item the same way; and a backup file read back.
import { backupFileName, itemBackup, makeBackup, restoreBackup, RestoreStopped, restoreSummary, type Backup } from "@/data/backup";
import { noteBackedUp } from "@/data/backupNudge";
import { importTooBig, MAX_RESTORE_BYTES } from "@/data/limits";

/** The backup as text; throws, in words, where it's more than a browser can hold in one string. */
function backupText(b: Backup): string {
  try {
    return JSON.stringify(b, null, 1);
  } catch (e) {
    if (e instanceof RangeError) throw new Error("that's more than this browser can write to one file.", { cause: e });
    throw e;
  }
}

/** A backup saved by the browser as a file. */
export function saveBackup(b: Backup, name: string): void {
  const blob = new Blob([backupText(b)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function downloadBackup(): Promise<Backup> {
  const b = await makeBackup();
  saveBackup(b, backupFileName());
  await noteBackedUp();
  return b;
}

/** One saved item as a file a restore takes. It isn't a backup of everything, so the reminder's count stands. */
export async function downloadItem(...item: Parameters<typeof itemBackup>): Promise<void> {
  saveBackup(await itemBackup(...item), backupFileName(new Date(), "saved-item"));
}

/** A backup file merged in: what happened, in words. Throws, in words, where it can't be. */
export async function restoreFile(file: File): Promise<string> {
  const big = importTooBig(file.size, "Is this the right file?", MAX_RESTORE_BYTES);
  if (big) throw new Error(big);
  let text: string;
  try {
    text = await file.text();
  } catch (e) {
    throw new Error("This browser couldn't read that file in one go.", { cause: e });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error("That file isn't JSON.", { cause: e });
  }
  try {
    return `Restored: ${restoreSummary(await restoreBackup(parsed))}. Nothing here was deleted.`;
  } catch (e) {
    if (!(e instanceof RestoreStopped)) throw e;
    const why = e.cause instanceof Error ? e.cause.message : String(e.cause);
    throw new Error(`Only part of the file came in: ${restoreSummary(e.done)}. Then the browser stopped it: ${why} Nothing here was deleted, and restoring the same file again is safe.`, { cause: e });
  }
}
