import "@testing-library/jest-dom/vitest";
import "fake-indexeddb/auto";
import { cleanup, configure } from "@testing-library/react";
import { afterEach } from "vitest";

// A screen gets 5 s to appear, not the default 1 s: see `testTimeout` in vite.config.ts.
configure({ asyncUtilTimeout: 5000 });

// Testing Library unmounts after each test by itself only with Vitest globals, which this project does not enable
afterEach(() => cleanup());

// Practice opens on the game last started (practice/room.ts LAST_SETUP_KEY): one test's New session mustn't set the next
// test's table, so each begins at the default
afterEach(() => {
  try {
    localStorage.removeItem("lizard.practiceSetup.v1");
    // (and each page's last address, app/lastSearch.ts, which the bar's links read)
    localStorage.removeItem("lizard.lastSearch.v1");
    // (and the range on Ranges' board, features/ranges/RangesPage.tsx DRAFT_KEY)
    localStorage.removeItem("lizard.rangeDraft.v1");
  } catch {
    // (an environment without localStorage has nothing kept)
  }
});
