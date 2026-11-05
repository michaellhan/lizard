import "@testing-library/jest-dom/vitest";
import "fake-indexeddb/auto";
import { cleanup, configure } from "@testing-library/react";
import { afterEach } from "vitest";

// A screen gets 5 s to appear, not the default 1 s: see `testTimeout` in vite.config.ts.
configure({ asyncUtilTimeout: 5000 });

// Testing Library unmounts after each test by itself only with Vitest globals, which this project does not enable
afterEach(() => cleanup());
