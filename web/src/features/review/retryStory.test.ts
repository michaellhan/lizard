import { describe, expect, it } from "vitest";
import { retryStory } from "./retryStory";

const at = (study: string | null, street: string, pot: number, seat: string, players = 6) => ({ study, street, pot, seat, players });

describe("retryStory", () => {
  it("tells a flop decision: preflop a line, the flop's pot as it began and the price of a call", () => {
    const s = retryStory(at("p=2&s=100&pre=SB:r2.5,BB:c&b=6c5s3d&flop=BB:x,SB:b4.13", "flop", 9.63, "BB", 2))!;
    expect(s.steps.map((x) => x.street)).toEqual(["Preflop"]);
    expect(s.now).toMatchObject({ street: "Flop", pot: 5.5, hero: "BB", toCall: 4.13 });
    expect(s.now.line).toBe("6c 5s 3d · BB checks, SB bets 4.13bb");
  });

  it("tells a preflop decision from the blinds", () => {
    const s = retryStory(at("p=6&s=100&pre=UTG:f,HJ:f,CO:r2.5", "preflop", 4, "BTN"))!;
    expect(s.steps).toEqual([]);
    expect(s.now).toMatchObject({ street: "Preflop", pot: 1.5, toCall: 2.5 });
  });

  it("gives the earlier streets a line each, with their cards", () => {
    const s = retryStory(at("p=6&s=100&pre=CO:r2.5,BB:c&b=Kd7s2cQh&flop=BB:x,CO:x&turn=BB:b3", "turn", 8.5, "CO"))!;
    expect(s.steps.map((x) => x.text)).toEqual([expect.any(String), "Kd 7s 2c · BB checks, CO checks"]);
    expect(s.now).toMatchObject({ street: "Turn", pot: 5.5, toCall: 3, line: "Qh · BB bets 3bb" });
  });

  it("gives up where it can't tell the money: no line, or an all-in", () => {
    expect(retryStory(at(null, "flop", 5, "BB"))).toBeNull();
    expect(retryStory(at("p=2&s=100&pre=SB:r2.5,BB:c&b=6c5s3d&flop=BB:a", "flop", 105, "SB", 2))).toBeNull();
  });
});
