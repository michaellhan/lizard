// A drop's files, a dropped folder read through (dropped.ts), on stand-ins for the browser's FileSystemEntry objects.
import { describe, expect, it } from "vitest";
import { dirEntry, fileEntry } from "@/test/entries";
import { droppedFiles, entriesOf } from "./dropped";

describe("dropped files", () => {
  it("reads a dropped folder through, subfolders and all, each file with its path", async () => {
    const tree = dirEntry("hh", [fileEntry("hh/a.txt", "A"), dirEntry("hh/2024", [fileEntry("hh/2024/b.txt", "B"), fileEntry("hh/2024/c.png", "C")]), fileEntry("hh/d.txt", "D")]);
    const got = await droppedFiles([tree], []);
    expect(got.map((f) => f.webkitRelativePath)).toEqual(["hh/2024/b.txt", "hh/2024/c.png", "hh/a.txt", "hh/d.txt"]);
    expect(await Promise.all(got.map((f) => f.text()))).toEqual(["B", "C", "A", "D"]);
    expect(got.map((f) => f.type)).toEqual(["text/plain", "image/png", "text/plain", "text/plain"]);
  });

  it("puts a folder's files in order of their paths, numbers as numbers", async () => {
    const tree = dirEntry("hh", ["t10.txt", "t2.txt", "t1.txt", "s/t3.txt"].map((n) => fileEntry(`hh/${n}`, n)));
    expect((await droppedFiles([tree], [])).map((f) => f.webkitRelativePath)).toEqual(["hh/s/t3.txt", "hh/t1.txt", "hh/t2.txt", "hh/t10.txt"]);
  });

  it("keeps a drop of files as it is", async () => {
    const f = new File(["x"], "a.txt");
    expect(await droppedFiles([fileEntry("a.txt", "x")], [f])).toEqual([f]);
    expect(await droppedFiles([], [f])).toEqual([f]);
  });

  it("takes the entries a drop's items have", () => {
    const e = fileEntry("a.txt", "x");
    const dt = { items: [{ webkitGetAsEntry: () => e }, { webkitGetAsEntry: () => null }, {}] } as unknown as DataTransfer;
    expect(entriesOf(dt)).toEqual([e]);
    expect(entriesOf({} as DataTransfer)).toEqual([]);
  });
});
