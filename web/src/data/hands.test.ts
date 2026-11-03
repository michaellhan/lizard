import { describe, expect, it } from "vitest";
import type { DecisionRecord, HandRecord } from "./db";
import { addHands, decisionsOf, deleteImport, getHand, importsOf, listHands, putDecisions } from "./hands";

const hand = (id: string, importId: string, playedAt: number): HandRecord => ({
  id, site: "PokerStars", number: id, played: "", playedAt, hero: "BTN", players: 6, hole: "AhQd", board: "", bb: "$1", potType: "SRP",
  pot: 3.5, end: "won, all folded", decisions: 1, text: `hand ${id}`, importId, importName: `import ${importId}`, importedAt: importId === "a" ? 1 : 2,
});
const decision = (handId: string, i: number): DecisionRecord => ({
  id: `${handId}|preflop|${i}`, handId, street: "preflop", pos: "BTN", action: "raise 2.5", verdict: "Best", evLossBb: null, source: "chart", label: "", gradedAt: 1,
});

describe("hands", () => {
  it("keeps each hand once, lists the latest played first, and deletes an import with its decisions", async () => {
    expect(await addHands([hand("1", "a", 10), hand("2", "a", 30)])).toEqual({ added: 2, existing: 0 });
    expect(await addHands([hand("2", "b", 30), hand("3", "b", 20)])).toEqual({ added: 1, existing: 1 });
    expect((await getHand("2"))?.importId).toBe("a"); // (the first import keeps it)
    const all = await listHands();
    expect(all.map((h) => h.id)).toEqual(["2", "3", "1"]);
    expect(importsOf(all).map((i) => [i.id, i.hands, i.chars])).toEqual([["b", 1, 6], ["a", 2, 12]]);
    await putDecisions([decision("1", 0), decision("2", 0), decision("3", 0)]);
    expect(await deleteImport("a")).toBe(2);
    expect((await listHands()).map((h) => h.id)).toEqual(["3"]);
    expect([await decisionsOf("1"), await decisionsOf("2")]).toEqual([[], []]);
    expect(await decisionsOf("3")).toHaveLength(1);
  });
});
