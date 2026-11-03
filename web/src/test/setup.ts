import "@testing-library/jest-dom/vitest";
import "fake-indexeddb/auto";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Testing Library unmounts after each test by itself only with Vitest globals, which this project does not enable
afterEach(() => cleanup());
