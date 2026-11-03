// User preferences, persisted to IndexedDB (kv store) and mirrored synchronously in memory.
import { create } from "zustand";
import { kvGet, kvSet } from "@/data/db";
import { DEFAULT_LOCAL_SOLVER_URL, type LibraryChoice } from "@/config";
import type { SolveMode, TransportKind } from "@/solver/types";

export interface Settings {
  mode: SolveMode;
  transport: TransportKind;
  localSolverUrl: string;
  librarySource: LibraryChoice;
  /** how EVs are displayed: bb, or % of the pot at the node (Study's action buttons, combo panel) */
  evUnit: "bb" | "pot";
}

export const DEFAULT_SETTINGS: Settings = {
  mode: "fast",
  transport: "worker",
  localSolverUrl: DEFAULT_LOCAL_SOLVER_URL,
  librarySource: "auto",
  evUnit: "bb",
};

const KEY = "settings.v1";

interface SettingsState extends Settings {
  loaded: boolean;
  set: (patch: Partial<Settings>) => void;
  load: () => Promise<void>;
  reset: () => void;
}

function pick(s: SettingsState): Settings {
  // (a key saved by an older version and since removed, such as colorByAction, is dropped here)
  const { mode, transport, localSolverUrl, librarySource, evUnit } = s;
  return { mode, transport, localSolverUrl, librarySource, evUnit };
}

export const useSettings = create<SettingsState>((set, get) => ({
  ...DEFAULT_SETTINGS,
  loaded: false,
  set: (patch) => {
    set(patch);
    void kvSet(KEY, pick(get()));
  },
  load: async () => {
    const saved = await kvGet<Partial<Settings>>(KEY).catch(() => undefined);
    set({ ...DEFAULT_SETTINGS, ...(saved ?? {}), loaded: true });
  },
  reset: () => {
    set({ ...DEFAULT_SETTINGS });
    void kvSet(KEY, DEFAULT_SETTINGS);
  },
}));
