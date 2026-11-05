// Study's hold on a saved answer: a link from the Saved page (`?saved=<spot id>`) shows the answer kept with the spot in
// place of asking the engine, until the node, the mode or the Re-solve button moves it on. Walking the line drops the
// parameter, as Study's links are written from the hand, so a node past the saved one is asked as usual.
import { useEffect, useState } from "react";
import { openAnswer, type KeptAnswer } from "@/data/answers";
import { loadManifest, solverVersionOf } from "@/solver/runtime";
import type { SolveResult } from "@/solver/types";
import { useSettings } from "@/state/settings";

/** The build this page runs, read without starting the engine; null where it can't be told. */
export const currentBuild = (): Promise<string | null> =>
  loadManifest().then((m) => (m ? solverVersionOf(m) : null));

export function useCurrentBuild(): string | null {
  const [build, setBuild] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void currentBuild().then((b) => alive && setBuild(b));
    return () => {
      alive = false;
    };
  }, []);
  return build;
}

export interface SavedHold {
  /** looking the answer up: nothing is asked yet */
  reading: boolean;
  /** what to show instead of asking */
  result?: SolveResult;
  /** the answer held */
  kept?: KeptAnswer;
  /** a link to a saved answer that isn't there or can't be read: the engine is asked instead, and the page says so */
  lost: boolean;
}

/** `id`: the spot named in the URL. `line`: the node on screen. `request`: all that makes a solve of it, the mode with it. */
export function useSavedAnswer(id: string | null, line: string, request: string): SavedHold {
  const [got, setGot] = useState<{ id: string; line: string; kept: KeptAnswer | null } | null>(null);
  // the request it opened at: another mode picked from here is a solve (and the settings arriving, on a reload, isn't one)
  const loaded = useSettings((s) => s.loaded);
  const [opened, setOpened] = useState({ id, request, loaded });
  if (opened.id !== id || opened.loaded !== loaded) setOpened({ id, request, loaded });
  useEffect(() => {
    if (!id) return;
    let alive = true;
    void openAnswer(id, line).then((kept) => alive && setGot({ id, line, kept }));
    return () => {
      alive = false;
    };
  }, [id, line]);
  if (!id) return { reading: false, lost: false };
  if (got?.id !== id || got.line !== line) return { reading: true, lost: false };
  if (!got.kept) return { reading: false, lost: true };
  const at = opened.id === id && opened.loaded === loaded ? opened.request : request;
  return at === request ? { reading: false, lost: false, kept: got.kept, result: got.kept.result } : { reading: false, lost: false };
}
