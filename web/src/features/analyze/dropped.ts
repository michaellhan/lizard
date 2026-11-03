// What a drop on the import box holds: its files, and a dropped folder's files read through, subfolders and all (the
// browser's FileSystemEntry API, as the classic page reads a picked folder). A dropped folder has no files of its own
// in `dataTransfer.files`, only an entry; each file read from one keeps its path under the folder dropped, so the
// import is named after the folder as a picked folder's is.

/** A file to import: a `File`, or one read from a dropped folder with its path. */
export interface PickedFile {
  name: string;
  type?: string;
  webkitRelativePath?: string;
  text(): Promise<string>;
}

const fileOf = (e: FileSystemFileEntry) => new Promise<File>((ok, no) => e.file(ok, no));
const batchOf = (r: FileSystemDirectoryReader) => new Promise<FileSystemEntry[]>((ok, no) => r.readEntries(ok, no));

async function walk(e: FileSystemEntry, out: PickedFile[]): Promise<void> {
  if (e.isFile) {
    const f = await fileOf(e as FileSystemFileEntry);
    out.push({ name: f.name, type: f.type, webkitRelativePath: e.fullPath.replace(/^\//, ""), text: () => f.text() });
  } else if (e.isDirectory) {
    const r = (e as FileSystemDirectoryEntry).createReader();
    // (a reader hands its entries over in batches, an empty one at the end)
    for (let batch = await batchOf(r); batch.length; batch = await batchOf(r)) for (const c of batch) await walk(c, out);
  }
}

/** The entries of a drop, taken while the drop event lasts (they're gone after it). */
export const entriesOf = (dt: DataTransfer): FileSystemEntry[] =>
  [...(dt.items ?? [])].map((i) => (typeof i.webkitGetAsEntry === "function" ? i.webkitGetAsEntry() : null)).filter((e): e is FileSystemEntry => !!e);

const byPath = new Intl.Collator(undefined, { numeric: true });

/** The dropped files: with no folder among the entries, the drop's own files; else every file read through, in
 * order of their paths (t2 before t10; a reader hands them over in no order of its own). */
export async function droppedFiles(entries: readonly FileSystemEntry[], files: readonly File[]): Promise<PickedFile[]> {
  if (!entries.some((e) => e.isDirectory)) return [...files];
  const out: PickedFile[] = [];
  for (const e of entries) await walk(e, out);
  return out.sort((a, b) => byPath.compare(a.webkitRelativePath ?? a.name, b.webkitRelativePath ?? b.name));
}
