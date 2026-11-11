// User preferences, persisted to IndexedDB (kv store) and mirrored synchronously in memory.
import { create } from "zustand";
import { kvGet, kvSet } from "@/data/db";
import { DEFAULT_LOCAL_SOLVER_URL, type LibraryChoice } from "@/config";
import type { Spot } from "@/features/practice/room";
import type { GridView } from "@/features/study/views";
import type { TreeCap } from "@/solver/treeDepth";
import type { SolveMode, TransportKind } from "@/solver/types";

export interface Settings {
  mode: SolveMode;
  transport: TransportKind;
  localSolverUrl: string;
  librarySource: LibraryChoice;
  /** how EVs are displayed: bb, or % of the pot at the node (Study's action buttons, combo panel) */
  evUnit: "bb" | "pot";
  /** Practice: keep every hand played in Analyze's hands */
  keepHands: boolean;
  /** Practice above one table: what the tables deal (null: not chosen, read by the Room's `spotOf` as Instant flops where
   * the library can deal it, else Any hand), and your seat there */
  practiceSpot: Spot | null;
  practiceSeat: string;
  /** Practice: ask ahead for your likeliest lines while you decide (null: not chosen, read as the measured default, ahead.ts's
   * `ASK_AHEAD`, which a saved `false` would hide when it changes) */
  askAhead: boolean | null;
  /** Study: what the grid shows, whether the breakdown is open, and which of its categories */
  studyView: GridView;
  breakdownOpen: boolean;
  breakdownPart: "made" | "draws";
  /** Study: the matrix column's share of the width beside its panel (null: not moved, read as the layout's default, which a
   * saved number would hide when it changes). Any saved value is clamped where it's read, by ResizableWorkspace */
  studySplit: number | null;
  /** Study: the keys that walk the line, play an action and open the range builder (off: none of them) */
  studyKeys: boolean;
  /** patterns over the action colours, wherever a mix is drawn (off, the default: colour alone). Saved under a new name
   * since 2026-11-11, when the default went to off: the older `patterns`, saved on by everyone, is dropped */
  actionPatterns: boolean;
  /** how big a tree this device's heads-up solves may build (solver/treeDepth.ts; the worker's alone) */
  treeCap: TreeCap;
}

export const DEFAULT_SETTINGS: Settings = {
  mode: "fast",
  transport: "worker",
  localSolverUrl: DEFAULT_LOCAL_SOLVER_URL,
  librarySource: "auto",
  evUnit: "bb",
  keepHands: false,
  practiceSpot: null,
  practiceSeat: "random",
  askAhead: null,
  studyView: "mix",
  breakdownOpen: false,
  breakdownPart: "made",
  studySplit: null,
  studyKeys: true,
  actionPatterns: false,
  treeCap: "standard",
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
  const { mode, transport, localSolverUrl, librarySource, evUnit, keepHands, practiceSpot, practiceSeat, askAhead, studyView, breakdownOpen, breakdownPart, studySplit, studyKeys, actionPatterns, treeCap } = s;
  return { mode, transport, localSolverUrl, librarySource, evUnit, keepHands, practiceSpot, practiceSeat, askAhead, studyView, breakdownOpen, breakdownPart, studySplit, studyKeys, actionPatterns, treeCap };
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

// The fills are CSS (index.css), so the switch is an attribute on the page: every mix drawn, now or later, follows it.
useSettings.subscribe((s) => {
  if (s.actionPatterns) document.documentElement.dataset.patterns = "on";
  else delete document.documentElement.dataset.patterns;
});
