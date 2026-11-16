import { describe, expect, it } from "vitest";
import { SETUP_PARAMS } from "@/features/practice/setupLink";
import { keptSearch, LAST_SEARCH_KEY, ONCE, pageLink, rememberSearch } from "./lastSearch";

describe("each page's last address", () => {
  it("is where the bar's link to the page goes, per page, until the page is left bare", () => {
    expect(pageLink("study")).toBe("/study");
    rememberSearch("/study", "?players=8&stack=60");
    rememberSearch("/reports", "?spot=srp");
    expect(pageLink("study")).toBe("/study?players=8&stack=60");
    expect(pageLink("reports")).toBe("/reports?spot=srp");
    rememberSearch("/study", "");
    expect(pageLink("study")).toBe("/study");
    expect(pageLink("reports")).toBe("/reports?spot=srp");
  });

  it("leaves out Practice's one-shot links, which start a session once", () => {
    expect(ONCE.practice).toEqual(["scenario", ...SETUP_PARAMS]);
    expect(keptSearch("practice", "?scenario=abc&tab=drills")).toBe("?tab=drills");
    expect(keptSearch("practice", "?play=srp&players=8")).toBe("");
    expect(keptSearch("practice", "?tab=drills&hand=m:set")).toBe("?tab=drills&hand=m%3Aset");
    rememberSearch("/practice", "?tab=drills&spot=x&scenario=abc");
    expect(pageLink("practice")).toBe("/practice?tab=drills&spot=x");
  });

  it("opens the page bare where what's kept is broken", () => {
    localStorage.setItem(LAST_SEARCH_KEY, "{oops");
    expect(pageLink("study")).toBe("/study");
    localStorage.setItem(LAST_SEARCH_KEY, JSON.stringify({ study: "http://elsewhere" }));
    expect(pageLink("study")).toBe("/study");
  });
});
