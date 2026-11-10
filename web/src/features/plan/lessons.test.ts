import { describe, expect, it } from "vitest";
import type { SessionRecord } from "@/data/db";
import { validSession } from "@/data/shapes";
import { dealtFrom, TEXTURE_GROUPS } from "@/features/practice/texture";
import { course, LESSON_TARGET, LESSONS, lessonDrill, lessonProgress, lessonReport } from "./lessons";

// the spots both libraries hold, each with its seats (out of position first), as their index.json gives them on 2026-11-10
const SPOTS: Record<string, string[]> = { srp_btn_bb: ["BB", "BTN"], srp_sb_bb: ["SB", "BB"], srp_utg_bb: ["BB", "UTG"], srp_utg_btn: ["UTG", "BTN"], "3bp_bb_btn": ["BB", "BTN"], "3bp_btn_co": ["CO", "BTN"] };

const drill = (o: { spot?: string; view?: string; street?: string; byDeal?: Record<string, { n: number; ok: number }>; kind?: SessionRecord["kind"] }): SessionRecord => ({
  id: `d${Math.random()}`,
  kind: o.kind ?? "drill",
  startedAt: 1,
  endedAt: 2,
  decisions: Object.values(o.byDeal ?? {}).reduce((a, c) => a + c.n, 0),
  evLossBb: 0,
  meta: { spot: o.spot ?? "srp_btn_bb", view: o.view ?? "ip", ...(o.street ? { street: o.street } : {}), ...(o.byDeal ? { byDeal: o.byDeal } : {}) },
});

describe("lessons", () => {
  it("each drills a spot both libraries hold, at a decision it has, with known texture values, and ids are unique", () => {
    expect(new Set(LESSONS.map((l) => l.id)).size).toBe(LESSONS.length);
    for (const l of LESSONS) {
      expect(SPOTS[l.spot], l.id).toBeDefined();
      expect(["oop", "ip", "vsbet", "ipvsbet"]).toContain(l.view);
      for (const [k, v] of Object.entries(l.texture ?? {})) expect(TEXTURE_GROUPS.find((g) => g.key === k)?.values[v!], `${l.id} ${k}`).toBeDefined();
      // the words name the seats the decision is between
      const [oop, ip] = SPOTS[l.spot]!;
      expect(l.idea, l.id).toContain(oop!);
      expect(l.idea, l.id).toContain(ip!);
    }
  });

  it("links the drill and the report with the lesson's flops", () => {
    const mono = LESSONS.find((l) => l.id === "btn-mono")!;
    expect(lessonDrill(mono)).toBe("/practice?tab=drills&spot=srp_btn_bb&view=ip&suits=mono");
    // the report reads every suit, to compare them
    expect(lessonReport(mono)).toBe("/reports?spot=srp_btn_bb&view=ip&group=suits");
    expect(lessonDrill(LESSONS[0]!)).toBe("/practice?tab=drills&spot=srp_btn_bb&view=ip");
  });

  it("counts only the decisions drilled at its spot and decision on the flop, dealt from exactly its flops with no hand asked for", () => {
    const first = LESSONS[0]!;
    const paired = LESSONS.find((l) => l.id === "btn-paired")!;
    const sessions = [
      drill({ byDeal: { "": { n: 12, ok: 9 }, [dealtFrom({ pair: "paired" }, null)]: { n: 5, ok: 2 }, [dealtFrom({}, "AA")]: { n: 4, ok: 4 } } }),
      drill({ byDeal: { "": { n: 8, ok: 8 } } }),
      // another decision, the turn, another spot, a Practice session, and one kept before byDeal: none counts
      drill({ view: "oop", byDeal: { "": { n: 30, ok: 30 } } }),
      drill({ street: "turn", byDeal: { "": { n: 30, ok: 30 } } }),
      drill({ spot: "srp_co_bb", byDeal: { "": { n: 30, ok: 30 } } }),
      drill({ kind: "practice", byDeal: { "": { n: 30, ok: 30 } } }),
      drill({}),
    ];
    expect(lessonProgress(first, sessions)).toEqual({ n: 20, ok: 17, done: true });
    expect(lessonProgress(paired, sessions)).toEqual({ n: 5, ok: 2, done: false });
    const c = course(sessions);
    // the first, and BB first to act (the oop session's 30)
    expect(c.done).toBe(2);
    expect(c.next).toBe(paired);
    expect(course([]).next).toBe(first);
    expect(LESSON_TARGET).toBe(20);
  });

  it("keeps byDeal through a restore only when it's well formed", () => {
    const ok = drill({ byDeal: { "": { n: 3, ok: 2 } } });
    expect(validSession(ok as unknown as Record<string, unknown>)).toBe(true);
    for (const byDeal of [{ "": { n: 2, ok: 3 } }, { "": { n: -1, ok: 0 } }, { "": "3" }, []])
      expect(validSession({ ...ok, meta: { ...ok.meta, byDeal } } as unknown as Record<string, unknown>), JSON.stringify(byDeal)).toBe(false);
  });
});
