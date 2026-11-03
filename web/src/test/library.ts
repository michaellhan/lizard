/// <reference types="node" />
// Library files for tests: a small subset of the solver snapshot's flop library, committed in fixtures/flop_library
// (scripts/library/make_web_fixtures.py; the library itself is git-ignored). Entries and ranges are byte for byte
// the snapshot's; index.json and the reports keep only the subset's flops. Resolved from the test root, web/ (under
// jsdom import.meta.url isn't a file URL).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const FIXTURE_LIBRARY = join(process.cwd(), "src", "test", "fixtures", "flop_library");
export const libFile = (path: string): Buffer => readFileSync(join(FIXTURE_LIBRARY, path));
export const libJson = <T,>(path: string): T => JSON.parse(libFile(path).toString("utf8")) as T;

/** the whole snapshot library, where it's on disk (not in CI): for checks over every spot */
export const SNAPSHOT_LIBRARY = join(process.cwd(), "..", "solver", "gto", "static", "flop_library");
export const hasSnapshot = existsSync(join(SNAPSHOT_LIBRARY, "index.json"));
export const snapshotJson = <T,>(path: string): T => JSON.parse(readFileSync(join(SNAPSHOT_LIBRARY, path), "utf8")) as T;
export const snapshotFile = (path: string): Buffer => readFileSync(join(SNAPSHOT_LIBRARY, path));
