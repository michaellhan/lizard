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
  /** how EVs are displayed */
  evUnit: "bb" | "pot";
  /** color mixed-frequency cells by action (true) or by EV (false) */
  colorByAction: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  mode: "fast",
  transport: "worker",
  localSolverUrl: DEFAULT_LOCAL_SOLVER_URL,
  librarySource: "auto",
  evUnit: "bb",
  colorByAction: true,
};

const KEY = "settings.v1";

interface SettingsState extends Settings {
  loaded: boolean;
  set: (patch: Partial<Settings>) => void;
  load: () => Promise<void>;
  reset: () => void;
}

function pick(s: SettingsState): Settings {
  const { mode, transport, localSolverUrl, librarySource, evUnit, colorByAction } = s;
  return { mode, transport, localSolverUrl, librarySource, evUnit, colorByAction };
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
