// Build/runtime configuration. Everything is same-origin under www.michael-han.com in production.

/** Vite's base ("/lizard/" in production). Always ends with "/". */
export const BASE_URL: string = import.meta.env.BASE_URL;

/** Where scripts/build-solver-assets.mjs puts worker.js, solver.zip, pf/ and manifest.json. */
export const SOLVER_ASSET_BASE = `${BASE_URL}solver/`;

/**
 * Library sources, in priority order. The first is the default. Same origin, so no CORS and COEP-safe.
 *  - lizard-library: Lizard's assembled library (the 6-max entries plus the heads-up builds as they complete),
 *    published by scripts/library/publish.sh. Not live until the first publish.
 *  - gto-solver-library: the upstream's published 6-max library (read-only for Lizard).
 */
export const LIBRARY_SOURCES = [
  {
    id: "lizard-library",
    label: "Lizard library (6-max + heads-up builds)",
    base: (import.meta.env.VITE_LIZARD_LIBRARY_BASE as string | undefined) ?? "/lizard-library/",
  },
  { id: "gto-solver-library", label: "GTO Solver library (6-max)", base: "/gto-solver-library/" },
] as const;

export type LibrarySourceId = (typeof LIBRARY_SOURCES)[number]["id"];

/** A setting: a specific source, or "auto" (the first one that is published). */
export type LibraryChoice = LibrarySourceId | "auto";

/** Default local Python solver (solver/gto/server.py). */
export const DEFAULT_LOCAL_SOLVER_URL = "http://127.0.0.1:8765";

/** The upstream app, for features not yet ported to Lizard's UI. */
export const CLASSIC_URL = "/gto-solver/";
