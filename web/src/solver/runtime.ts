// The app's solver instance: built from settings, rebuilt when the transport or library source changes.
import { create } from "zustand";
import { LIBRARY_SOURCES, SOLVER_ASSET_BASE, type LibrarySourceId } from "@/config";
import { loadStamps, resolveLibrarySource } from "@/library/catalog";
import type { LibraryStamp } from "@/library/version";
import { useSettings } from "@/state/settings";
import { SolverClient } from "./client";
import { HttpTransport } from "./http-transport";
import type { RuntimeStatus, TransportKind } from "./types";
import { WorkerTransport } from "./worker-transport";

/** Written by scripts/build-solver-assets.mjs next to worker.js. */
export interface SolverManifest {
  version: string;
  upstream: { repo: string; commit: string; date: string };
  builtAt: string;
  files: string[];
}

let manifestP: Promise<SolverManifest | null> | null = null;

export function loadManifest(): Promise<SolverManifest | null> {
  manifestP ??= fetch(`${SOLVER_ASSET_BASE}manifest.json`, { cache: "no-cache" })
    .then((r) => (r.ok ? (r.json() as Promise<SolverManifest>) : null))
    .catch(() => null);
  return manifestP;
}

/** The build a client says it's running, as its answers' provenance carries it. */
export const solverVersionOf = (m: SolverManifest | null) => (m ? `${m.upstream.commit.slice(0, 8)}/${m.version}` : "dev");

/** The library's stamps, read once when a stored answer first needs them (again next time where they couldn't be). The
 * worker reads its index once too, so the two say the same library for a client's life. */
export function stampsAt(base: string): () => Promise<LibraryStamp | null> {
  let kept: Promise<LibraryStamp | null> | null = null;
  return () => {
    const p = (kept ??= loadStamps(base).catch(() => null));
    void p.then((s) => {
      if (!s && kept === p) kept = null;
    });
    return p;
  };
}

interface RuntimeState {
  client: SolverClient | null;
  status: RuntimeStatus;
  manifest: SolverManifest | null;
  key: string;
  /** the library the worker reads ("auto" resolved) */
  librarySource: LibrarySourceId | null;
  ensure: (opts: Connection) => Promise<SolverClient>;
}

interface Connection {
  transport: TransportKind;
  localSolverUrl: string;
  librarySource: string;
}

const IDLE: RuntimeStatus = { phase: "idle", transport: "worker", crossOriginIsolated: false };

export const useRuntime = create<RuntimeState>((set, get) => {
  // Only the last `ensure` begun may set the client. Settings can change while one waits on the library's HEAD (a load
  // with a library saved does this: the first request goes out before settings are read), and an older call finishing
  // last would put its settings back over the newer client, which nothing would then dispose: a second worker, and the
  // first running for the life of the tab. So an overtaken call builds nothing and answers with what the last one comes
  // to, and a client is disposed only as another replaces it, so the one held is never a dead one.
  let calls = 0;
  let last: Promise<SolverClient>;

  const connect = async (call: number, { transport, localSolverUrl, librarySource }: Connection): Promise<SolverClient> => {
    const key = `${transport}|${localSolverUrl}|${librarySource}`;
    const cur = get();
    if (cur.client && cur.key === key) return cur.client;
    const manifest = await loadManifest();
    const version = manifest?.version ?? "dev";
    const resolved = librarySource === "auto" ? await resolveLibrarySource() : librarySource;
    if (call !== calls) return last;
    const lib = LIBRARY_SOURCES.find((s) => s.id === resolved) ?? LIBRARY_SOURCES[0];
    const t =
      transport === "http"
        ? new HttpTransport({ url: localSolverUrl })
        : new WorkerTransport({ assetBase: SOLVER_ASSET_BASE, version, libraryBase: lib.base });
    const client = new SolverClient(t, solverVersionOf(manifest), transport === "worker" ? stampsAt(lib.base) : undefined, () => useSettings.getState().treeCap);
    get().client?.dispose();
    client.onStatus((status) => set({ status }));
    set({ client, manifest, key, librarySource: lib.id });
    if (t instanceof HttpTransport) void t.probe();
    return client;
  };

  return {
    client: null,
    status: IDLE,
    manifest: null,
    key: "",
    librarySource: null,
    ensure: (opts) => (last = connect(++calls, opts)),
  };
});
