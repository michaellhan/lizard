import { describe, expect, it } from "vitest";
import { importTooBig, MAX_IMPORT_BYTES } from "./limits";

describe("import limit", () => {
  it("lets the limit itself through and says why it refuses over it", () => {
    expect(importTooBig(MAX_IMPORT_BYTES, "x")).toBeNull();
    expect(importTooBig(MAX_IMPORT_BYTES + 1, "Try fewer.")).toBe("That's 257 MB, over the 256 MB one import can read. Try fewer.");
  });
});
