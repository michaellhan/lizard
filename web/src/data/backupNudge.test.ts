import { beforeEach, describe, expect, it } from "vitest";
import { noteBackedUp, noteSaved, nudgeDue, nudgeState, NUDGE, onNudgeState, snoozeNudge } from "./backupNudge";
import { db, type HandRecord } from "./db";
import { addHands, putHandNotes } from "./hands";
import { putDrill, putRange, putSpot } from "./saved";

beforeEach(async () => {
  const d = (await db())!;
  await d.delete("kv", "backupNudge");
  await d.clear("hands");
});

describe("the backup reminder's count", () => {
  it("counts each save: a spot, a range, a drill, hands kept (new ones only), a note on a hand", async () => {
    expect(await nudgeState()).toEqual({ saves: 0 });
    await putSpot({ id: "s", title: "t", line: "p=6&s=100", state: {}, tags: [], note: "", createdAt: 1, updatedAt: 1 });
    await putRange({ id: "r", name: "n", text: "22+", combos: 78, note: "", createdAt: 1, updatedAt: 1 });
    await putDrill({ id: "d", name: "n", kind: "library", to: "/practice?tab=drills", about: "", note: "", createdAt: 1, updatedAt: 1 });
    expect((await nudgeState()).saves).toBe(3);
    const hand = (id: string) => ({ id }) as HandRecord;
    expect(await addHands([hand("a"), hand("b")])).toEqual({ added: 2, existing: 0 });
    expect(await addHands([hand("a"), hand("c")])).toEqual({ added: 1, existing: 1 });
    await putHandNotes("a", ["x"], "");
    expect((await nudgeState()).saves).toBe(7);
  });

  it("says it only past many saves and two weeks, a month later once put off, and starts again with a backup", async () => {
    const DAY = 86_400_000;
    const t0 = 1_000 * DAY;
    const heard: number[] = [];
    const off = onNudgeState(() => heard.push(1));
    await noteSaved(NUDGE.saves - 1, t0);
    expect(await nudgeState()).toEqual({ saves: NUDGE.saves - 1, since: t0 });
    expect(nudgeDue(await nudgeState(), t0 + 60 * DAY)).toBe(false); // too few saves, however long
    await noteSaved(1, t0 + DAY);
    expect((await nudgeState()).since).toBe(t0); // (the days count from the first save)
    expect(nudgeDue(await nudgeState(), t0 + (NUDGE.days - 1) * DAY)).toBe(false); // too soon
    const due = t0 + NUDGE.days * DAY;
    expect(nudgeDue(await nudgeState(), due)).toBe(true);
    await snoozeNudge(due);
    expect(nudgeDue(await nudgeState(), due + (NUDGE.snoozeDays - 1) * DAY)).toBe(false);
    expect(nudgeDue(await nudgeState(), due + NUDGE.snoozeDays * DAY)).toBe(true);
    await noteBackedUp(1234);
    expect(await nudgeState()).toEqual({ saves: 0, lastBackupAt: 1234 });
    expect(nudgeDue(await nudgeState(), due + 365 * DAY)).toBe(false);
    await noteSaved(0);
    expect(heard).toHaveLength(4);
    off();
    // (saves at once all count)
    await Promise.all([noteSaved(), noteSaved(), noteSaved()]);
    expect((await nudgeState()).saves).toBe(3);
    expect(heard).toHaveLength(4);
  });

  it("starts the days of a count kept before they were (not said to someone at once after this change)", async () => {
    await (await db())!.put("kv", { saves: 115, snoozedAt: 110 }, "backupNudge");
    expect(await nudgeState()).toEqual({ saves: 115 });
    expect(nudgeDue(await nudgeState())).toBe(false);
    await noteSaved(1, 5);
    expect(await nudgeState()).toEqual({ saves: 116, since: 5 });
  });
});
