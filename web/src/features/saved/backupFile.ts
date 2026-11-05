// A backup of everything kept here (data/backup.ts) saved by the browser as a file, and the backup reminder's count
// started again (data/backupNudge.ts); one saved item the same way; and a backup file read back.
import { backupFileName, itemBackup, makeBackup, restoreBackup, restoreSummary, type Backup } from "@/data/backup";
import { noteBackedUp } from "@/data/backupNudge";
import { importTooBig } from "@/data/limits";

/** A backup saved by the browser as a file. */
export function saveBackup(b: Backup, name: string): void {
  const blob = new Blob([JSON.stringify(b, null, 1)], { type: "application/json" });
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
  const big = importTooBig(file.size, "Is this the right file?");
  if (big) throw new Error(big);
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    throw new Error("That file isn't JSON.");
  }
  return `Restored: ${restoreSummary(await restoreBackup(parsed))}. Nothing here was deleted.`;
}
