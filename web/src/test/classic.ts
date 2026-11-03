// A fixture of the classic app's storage (solver/gto/static/store.js) for the classic import's tests.
import type { ClassicRecord } from "@/features/analyze/classic";

/** The classic store's database as store.js makes it (version 1, five stores keyed by id), holding these hands. */
export function classicDb(name: string, hands: readonly ClassicRecord[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const q = indexedDB.open(name, 1);
    q.onupgradeneeded = () => {
      for (const s of ["kv", "hands", "sessions", "blobs", "meta"]) q.result.createObjectStore(s, { keyPath: "id" });
    };
    q.onerror = () => reject(q.error);
    q.onsuccess = () => {
      const d = q.result;
      const t = d.transaction(["hands", "meta", "kv"], "readwrite");
      for (const h of hands) t.objectStore("hands").put(h);
      t.objectStore("meta").put({ id: "meta", schema: 1, device: "classic-device" });
      t.objectStore("kv").put({ id: "gto-speed", v: 1, created: 1, updated: 1, dev: "d", data: { raw: "accurate" } });
      t.oncomplete = () => {
        d.close();
        resolve();
      };
    };
  });
}
