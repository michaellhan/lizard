// The review schedule: the steps and their edges, on the local calendar.
import { describe, expect, it } from "vitest";
import { chartMistake, DAY_ONE, mistake } from "@/test/mistake";
import { afterRetry, dueAfter, dueQueue, dueWords, FINISHED, isDue, REVIEW_DAYS, stepAfter } from "./schedule";

const date = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo, d, h, mi).getTime();

describe("the schedule", () => {
  it("is 1, 3, 7 and 21 days", () => {
    expect(REVIEW_DAYS).toEqual([1, 3, 7, 21]);
    expect(FINISHED).toBe(4);
  });

  it("counts calendar days: a mistake late at night is due from the next midnight, not 24 hours on", () => {
    expect(dueAfter(date(2026, 10, 2, 23, 59), 0)).toBe(date(2026, 10, 3));
    expect(dueAfter(date(2026, 10, 2, 0, 1), 1)).toBe(date(2026, 10, 5));
    expect(dueAfter(date(2026, 10, 2, 12), 3)).toBe(date(2026, 10, 23));
  });

  it("crosses a month and a year end", () => {
    expect(dueAfter(date(2026, 0, 31, 9), 0)).toBe(date(2026, 1, 1));
    expect(dueAfter(date(2026, 11, 20, 9), 3)).toBe(date(2027, 0, 10));
  });

  it("isn't moved by a clock change: the due day is a local midnight", () => {
    // (US: 1 March 2026 + 21 days crosses 8 March, EU: 29 March; either way a calendar date)
    const d = new Date(dueAfter(date(2026, 2, 1, 12), 3)!);
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2026, 2, 22, 0]);
    const back = new Date(dueAfter(date(2026, 9, 20, 12), 3)!);
    expect([back.getMonth(), back.getDate(), back.getHours()]).toEqual([10, 10, 0]);
  });

  it("steps on after Best or Correct and stops at finished, back after a miss and stops at the first", () => {
    expect([0, 1, 2, 3].map((s) => stepAfter(s, true))).toEqual([1, 2, 3, 4]);
    expect(stepAfter(FINISHED, true)).toBe(FINISHED);
    expect([3, 2, 1, 0].map((s) => stepAfter(s, false))).toEqual([2, 1, 0, 0]);
  });

  it("is due from the day itself", () => {
    const due = date(2026, 10, 3);
    expect(isDue({ due }, due - 1)).toBe(false);
    expect(isDue({ due }, due)).toBe(true);
    expect(isDue({ due }, due + 1)).toBe(true);
    expect(isDue({ due: null }, due)).toBe(false);
  });

  it("moves on a due retry: on to the next wait, or back to the one before", () => {
    const now = date(2026, 10, 3, 9);
    expect(afterRetry({ step: 0, due: date(2026, 10, 3) }, true, now)).toEqual({ step: 1, due: date(2026, 10, 6), moved: true });
    expect(afterRetry({ step: 2, due: date(2026, 10, 3) }, false, now)).toEqual({ step: 1, due: date(2026, 10, 6), moved: true });
    expect(afterRetry({ step: 0, due: date(2026, 10, 3) }, false, now)).toEqual({ step: 0, due: date(2026, 10, 4), moved: true });
  });

  it("finishes after the last wait, and there's no date after that", () => {
    expect(afterRetry({ step: 3, due: date(2026, 10, 3) }, true, date(2026, 10, 4))).toEqual({ step: 4, due: null, moved: true });
  });

  it("moves nothing on a retry before its day, or of a finished one", () => {
    const due = date(2026, 10, 6);
    expect(afterRetry({ step: 1, due }, true, due - 1)).toEqual({ step: 1, due, moved: false });
    expect(afterRetry({ step: 1, due }, false, due - 1)).toEqual({ step: 1, due, moved: false });
    expect(afterRetry({ step: 4, due: null }, false, due)).toEqual({ step: 4, due: null, moved: false });
  });

  it("queues the longest overdue, then the worst grade, then the latest missed, and leaves out what isn't due", () => {
    const now = date(2026, 10, 10);
    const old = mistake({ id: "old", due: date(2026, 10, 3) });
    const blunder = mistake({ id: "blunder", due: date(2026, 10, 5), grade: { ...mistake().grade, verdict: "Blunder" } });
    const worse = mistake({ id: "late", due: date(2026, 10, 5), lastAt: DAY_ONE + 5 });
    const early = mistake({ id: "early", due: date(2026, 10, 5) });
    const chart = chartMistake({ id: "chart", due: date(2026, 10, 5) });
    const list = [early, chart, mistake({ id: "soon", due: date(2026, 10, 11) }), worse, mistake({ id: "done", due: null, step: 4 }), blunder, old];
    expect(dueQueue(list, now).map((m) => m.id)).toEqual(["old", "blunder", "late", "early", "chart"]);
  });

  it("says when in plain words", () => {
    const now = date(2026, 10, 10, 15);
    expect(dueWords({ due: null }, now)).toBe("Finished");
    expect(dueWords({ due: date(2026, 10, 10) }, now)).toBe("Due today");
    expect(dueWords({ due: date(2026, 10, 9) }, now)).toBe("Due, 1 day overdue");
    expect(dueWords({ due: date(2026, 10, 3) }, now)).toBe("Due, 7 days overdue");
    expect(dueWords({ due: date(2026, 10, 11) }, now)).toBe("Due tomorrow");
    expect(dueWords({ due: date(2026, 10, 31) }, now)).toBe("Due in 21 days");
  });
});
