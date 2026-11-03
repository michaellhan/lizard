import { useCallback } from "react";
import { useSettings } from "@/state/settings";
import { useRuntime } from "./runtime";
import type { SolverClient } from "./client";

/** The solver client for the current settings (created on first use). */
export function useSolver(): () => Promise<SolverClient> {
  const transport = useSettings((s) => s.transport);
  const localSolverUrl = useSettings((s) => s.localSolverUrl);
  const librarySource = useSettings((s) => s.librarySource);
  const ensure = useRuntime((s) => s.ensure);
  return useCallback(
    () => ensure({ transport, localSolverUrl, librarySource }),
    [ensure, transport, localSolverUrl, librarySource],
  );
}
