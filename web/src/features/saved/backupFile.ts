// A backup of everything kept here (data/backup.ts) saved by the browser as a file, and the backup reminder's count
// started again (data/backupNudge.ts).
import { backupFileName, makeBackup, type Backup } from "@/data/backup";
import { noteBackedUp } from "@/data/backupNudge";

export async function downloadBackup(): Promise<Backup> {
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
  await noteBackedUp();
  return b;
}
