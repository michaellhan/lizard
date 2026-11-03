// The app's solver instance: built from settings, rebuilt when the transport or library source changes.
import { create } from "zustand";
import { LIBRARY_SOURCES, SOLVER_ASSET_BASE, type LibrarySourceId } from "@/config";
import { resolveLibrarySource } from "@/library/catalog";
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

interface RuntimeState {
  client: SolverClient | null;
  status: RuntimeStatus;
  manifest: SolverManifest | null;
  key: string;
  /** the library the worker reads ("auto" resolved) */
  librarySource: LibrarySourceId | null;
  ensure: (opts: { transport: TransportKind; localSolverUrl: string; librarySource: string }) => Promise<SolverClient>;
}

const IDLE: RuntimeStatus = { phase: "idle", transport: "worker", crossOriginIsolated: false };

export const useRuntime = create<RuntimeState>((set, get) => ({
  client: null,
  status: IDLE,
  manifest: null,
  key: "",
  librarySource: null,
  ensure: async ({ transport, localSolverUrl, librarySource }) => {
    const key = `${transport}|${localSolverUrl}|${librarySource}`;
    const cur = get();
    if (cur.client && cur.key === key) return cur.client;
    cur.client?.dispose();
    const manifest = await loadManifest();
    const version = manifest?.version ?? "dev";
    const resolved = librarySource === "auto" ? await resolveLibrarySource() : librarySource;
    if (get().key === key && get().client) return get().client!; // a concurrent ensure() won
    const lib = LIBRARY_SOURCES.find((s) => s.id === resolved) ?? LIBRARY_SOURCES[0];
    const t =
      transport === "http"
        ? new HttpTransport({ url: localSolverUrl })
        : new WorkerTransport({ assetBase: SOLVER_ASSET_BASE, version, libraryBase: lib.base });
    const client = new SolverClient(t, manifest ? `${manifest.upstream.commit.slice(0, 8)}/${version}` : "dev");
    client.onStatus((status) => set({ status }));
    set({ client, manifest, key, librarySource: lib.id });
    if (t instanceof HttpTransport) void t.probe();
    return client;
  },
}));
