import { describe, expect, it } from "vitest";
import { retryStory } from "./retryStory";

const at = (study: string | null, street: string, _pot: number, seat: string, players = 6) => ({ study, street, seat, players });

describe("retryStory", () => {
  it("tells a flop decision: preflop a line, the flop's pot as it began and the price of a call", () => {
    const s = retryStory(at("p=2&s=100&pre=SB:r2.5,BB:c&b=6c5s3d&flop=BB:x,SB:b4.13", "flop", 9.63, "BB", 2))!;
    expect(s.steps.map((x) => x.street)).toEqual(["Preflop"]);
    // (the pot from the line: 2.5bb each)
    expect(s.now).toMatchObject({ street: "Flop", pot: 5, hero: "BB", toCall: 4.13 });
    expect(s.now.line).toBe("BB checks, BTN/SB bets 4.13bb");
  });

  it("tells a preflop decision from the blinds", () => {
    const s = retryStory(at("p=6&s=100&pre=UTG:f,HJ:f,CO:r2.5", "preflop", 4, "BTN"))!;
    expect(s.steps).toEqual([]);
    expect(s.now).toMatchObject({ street: "Preflop", pot: 1.5, toCall: 2.5 });
  });

  it("gives the earlier streets a line each, their action only (the board is drawn above)", () => {
    const s = retryStory(at("p=6&s=100&pre=UTG:f,HJ:f,CO:r2.5,BTN:f,SB:f,BB:c&b=Kd7s2cQh&flop=BB:x,CO:x&turn=BB:b3", "turn", 8.5, "CO"))!;
    expect(s.steps.map((x) => x.text)).toEqual([expect.any(String), "BB checks, CO checks"]);
    expect(s.now).toMatchObject({ street: "Turn", pot: 5.5, toCall: 3, line: "BB bets 3bb" });
  });

  it("gives up where it can't tell the money: no line, or one the table can't play to your turn", () => {
    expect(retryStory(at(null, "flop", 5, "BB"))).toBeNull();
    expect(retryStory(at("p=2&s=100&pre=SB:r2.5,BB:c&b=6c5s3d&flop=BB:x", "flop", 5, "BB", 2))).toBeNull();
  });

  it("prices an all-in at the chips it puts in, and a call at no more than your stack", () => {
    const s = retryStory(at("p=2&s=100&pre=SB:r2.5,BB:c&b=6c5s3d&flop=BB:a", "flop", 102.5, "SB", 2))!;
    expect(s.now).toMatchObject({ pot: 5, toCall: 97.5, line: "BB goes all-in" });
    // (you have 20bb, 17.5bb behind on the flop: a 40bb bet costs you 17.5bb)
    const short = retryStory(at("p=2&s=100&pre=SB:r2.5,BB:c&b=6c5s3d&flop=BB:b40&stacks=SB:20", "flop", 45, "SB", 2));
    expect(short?.now).toMatchObject({ pot: 5, toCall: 17.5 });
  });

  it("counts the pot from what each seat put in, and an all-in that only calls as a call", () => {
    // (BTN has 2bb: all-in after a 2.5bb open, it only calls)
    const s = retryStory(at("p=6&s=100&stacks=BTN:2&pre=UTG:r2.5,HJ:f,CO:c,BTN:a,SB:f,BB:f&b=Kd7s2c&flop=UTG:b4", "flop", 12.5, "CO"))!;
    expect(s.steps.map((x) => x.text)).toEqual(["UTG raises to 2.5bb, CO calls, BTN calls all-in"]);
    expect(s.now).toMatchObject({ street: "Flop", pot: 8.5, toCall: 4, hero: "CO" });
  });
});
