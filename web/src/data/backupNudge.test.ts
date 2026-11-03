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

  it("says it past the first count, again after more once put off, and starts again with a backup", async () => {
    const heard: number[] = [];
    const off = onNudgeState(() => heard.push(1));
    await noteSaved(NUDGE.first - 1);
    expect(nudgeDue(await nudgeState())).toBe(false);
    await noteSaved();
    expect(nudgeDue(await nudgeState())).toBe(true);
    await snoozeNudge();
    expect(await nudgeState()).toEqual({ saves: NUDGE.first, snoozedAt: NUDGE.first });
    await noteSaved(NUDGE.again - 1);
    expect(nudgeDue(await nudgeState())).toBe(false);
    await noteSaved();
    expect(nudgeDue(await nudgeState())).toBe(true);
    await noteBackedUp(1234);
    expect(await nudgeState()).toEqual({ saves: 0, lastBackupAt: 1234 });
    expect(nudgeDue(await nudgeState())).toBe(false);
    await noteSaved(0);
    expect(heard).toHaveLength(6);
    off();
    // (saves at once all count)
    await Promise.all([noteSaved(), noteSaved(), noteSaved()]);
    expect((await nudgeState()).saves).toBe(3);
    expect(heard).toHaveLength(6);
  });
});
