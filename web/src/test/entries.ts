// Stand-ins for the browser's FileSystemEntry objects, as a dropped folder hands them over (features/analyze/dropped.ts).

/** a file entry, and a folder entry whose reader hands its entries over two at a time */
export const fileEntry = (path: string, text: string): FileSystemEntry =>
  ({ isFile: true, isDirectory: false, name: path.split("/").pop()!, fullPath: `/${path}`, file: (ok: (f: File) => void) => ok(new File([text], path.split("/").pop()!, { type: path.endsWith(".png") ? "image/png" : "text/plain" })) }) as unknown as FileSystemEntry;
export const dirEntry = (path: string, kids: FileSystemEntry[]): FileSystemEntry =>
  ({
    isFile: false,
    isDirectory: true,
    name: path.split("/").pop()!,
    fullPath: `/${path}`,
    createReader: () => {
      let at = 0;
      return { readEntries: (ok: (b: FileSystemEntry[]) => void) => ok(kids.slice(at, (at += 2))) };
    },
  }) as unknown as FileSystemEntry;
