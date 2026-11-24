import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SsIndex } from "@/library/singleSize";
import { FlopSource, offersFlopSource, SingleSizeNote } from "./FlopSource";
import { parseLine } from "./studyState";

const SRP = "UTG:f,HJ:f,CO:f,BTN:r2.5,SB:f,BB:c";
const IDX: SsIndex = {
  format: 2,
  ss_format: 1,
  flops: ["Ac7d2h", "KcQc8d"],
  spots: [{ id: "ss_srp_btn_bb", label: "BTN vs BB single-raised pot, single size", line: SRP, seats: ["BB", "BTN"], pot: 5.5, stack: 97.5, flops: { Ac7d2h: "1", KcQc8d: "2" }, sizes: { Ac7d2h: 25, KcQc8d: 33 } }],
};
const hand = (line: string, board: string) => ({ players: 6, stack: 100, board, preflop: parseLine(line) });
const MW_LINE = "UTG:f,HJ:f,CO:f,BTN:r2.5,SB:c,BB:c";
const MW3: SsIndex = {
  ...IDX,
  spots: [
    ...IDX.spots,
    { id: "ss_mw_btn_sb_bb", label: "BTN open, SB and BB call, 3-way single size", line: MW_LINE, seats: ["SB", "BB", "BTN"], pot: 7.5, stack: 97.5, players: 3, flops: { Qs9h4c: "3", Ac7d2h: "4", "5c4d2h": "5" }, sizes: { Qs9h4c: 33, Ac7d2h: 33, "5c4d2h": 33 }, conv: { iters: 400, expl: 0.08 } },
  ],
};

describe("the flop source", () => {
  it("is a two-way choice", () => {
    const pick = vi.fn();
    render(<FlopSource value="library" onChange={pick} />);
    expect(screen.getByRole("radio", { name: "Library" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("radio", { name: "Single size" }));
    expect(pick).toHaveBeenCalledWith("ss");
  });

  it("is offered on the single-size library's game only, with no setup of the hand's own", () => {
    expect(offersFlopSource(hand(SRP, ""))).toBe(true);
    expect(offersFlopSource({ ...hand(SRP, ""), stack: 40 })).toBe(false);
    expect(offersFlopSource({ ...hand(SRP, ""), setup: { sizes: { flop: [50] } } })).toBe(false);
  });

  it("is offered in the ante and straddle games the library is built for, and no other", () => {
    expect(offersFlopSource({ ...hand(SRP, ""), setup: { ante: 0.17 } })).toBe(
      true,
    );
    expect(
      offersFlopSource({ ...hand(SRP, ""), setup: { straddle: true } }),
    ).toBe(true);
    expect(offersFlopSource({ ...hand(SRP, ""), setup: { ante: 0.1 } })).toBe(
      false,
    );
    expect(
      offersFlopSource({
        ...hand(SRP, ""),
        setup: { ante: 0.17, straddle: true },
      }),
    ).toBe(false);
    expect(
      offersFlopSource({
        ...hand(SRP, ""),
        setup: { ante: 0.17, rake: { pct: 5, cap: 3 } },
      }),
    ).toBe(false);
  });

  it("names an ante game's ranges as its preflop solve's, with the game's own flops", () => {
    const idx: SsIndex = {
      ...IDX,
      spots: [
        ...IDX.spots,
        {
          id: "ss_srp_btn_bb_ante",
          label:
            "BTN vs BB single-raised pot, 1bb big-blind ante (0.17bb a seat), single size",
          line: SRP,
          seats: ["BB", "BTN"],
          pot: 6.52,
          stack: 97.33,
          flops: { "5c4d2h": "1" },
          sizes: { "5c4d2h": 33 },
          game: { players: 6, stack: 100, ante: 0.17, straddle: false },
          pf: {
            key: "lz4_6max_100bb_a0.17_ch",
            words: "1bb big-blind ante (0.17bb a seat)",
          },
        },
      ],
    };
    const { rerender } = render(
      <SingleSizeNote
        hand={{ ...hand(SRP, "5c4d2h"), setup: { ante: 0.17 } }}
        idx={idx}
      />,
    );
    expect(
      screen.getByText(
        /BTN vs BB single-raised pot, 1bb big-blind ante \(0.17bb a seat\), single size: this flop is held, its one flop bet size 33%/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /In this game \(1bb big-blind ante \(0.17bb a seat\)\) its ranges entering the flop are Lizard's stored preflop solve of the game, not the charts/,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("5c4d2h")).toBeInTheDocument();
    rerender(
      <SingleSizeNote
        hand={{ ...hand(SRP, "5c4d2h"), setup: { straddle: true } }}
        idx={idx}
      />,
    );
    expect(
      screen.getByText(
        /holds no lines in this game \(2bb straddle from UTG\) yet/,
      ),
    ).toBeInTheDocument();
  });

  it("says this flop's size and which flops are covered", () => {
    render(<SingleSizeNote hand={hand(SRP, "Ac7d2h")} idx={IDX} />);
    expect(screen.getByText(/this flop is held, its one flop bet size 25% chosen by the solver's automatic sizing/)).toBeInTheDocument();
    expect(screen.getByText(/Covers 2 representative flops on every line/)).toBeInTheDocument();
    expect(screen.getByText("Ac7d2h KcQc8d")).toBeInTheDocument();
  });

  it("says a 3-way line's flop is on the 3-way single-size tree, with its own flops, and that it has no Nash guarantee", () => {
    const { rerender } = render(<SingleSizeNote hand={hand(MW_LINE, "Ac7d2h")} idx={MW3} />);
    expect(screen.getByText(/this flop is held on the 3-way single-size tree, its one flop bet size 33% \(one fixed size for every flop, as the automatic sizing is heads-up only; on a 24-pair sample 25, 33 and 50% gave up the same within noise \(25% least\)\); turn and river bets 50%/)).toBeInTheDocument();
    expect(screen.getByText(/median 400 iterations, mean best-response gain 0.08% of the pot\), which has no Nash guarantee/)).toBeInTheDocument();
    expect(screen.getByText(/Covers 3 representative flops on every 3-way line/)).toBeInTheDocument();
    expect(screen.getByText("Qs9h4c Ac7d2h 5c4d2h")).toBeInTheDocument();
    rerender(<SingleSizeNote hand={hand(SRP, "Ac7d2h")} idx={MW3} />);
    expect(screen.getByText(/Covers 2 representative flops on every line/)).toBeInTheDocument();
    expect(screen.queryByText(/Nash/)).toBeNull();
    rerender(<SingleSizeNote hand={hand("UTG:r2,HJ:c", "Qs9h4c")} idx={MW3} />);
    expect(screen.getByText(/it has 1 heads-up 6-max 100bb lines and 1 3-way ones/)).toBeInTheDocument();
  });

  it("says when the flop or the line isn't held, or the library isn't published", () => {
    const { rerender } = render(<SingleSizeNote hand={hand(SRP, "Qs9h4c")} idx={IDX} />);
    expect(screen.getByText(/this flop isn't one of its flops, so this node is asked from the library as usual/)).toBeInTheDocument();
    rerender(<SingleSizeNote hand={hand("UTG:r2,HJ:c", "Qs9h4c")} idx={IDX} />);
    expect(screen.getByText(/doesn't hold this preflop line/)).toBeInTheDocument();
    rerender(<SingleSizeNote hand={hand(SRP, "Qs9h4c")} idx={null} />);
    expect(screen.getByText(/isn't published yet/)).toBeInTheDocument();
    rerender(<SingleSizeNote hand={hand(SRP, "Qs9h4c")} idx={undefined} />);
    expect(screen.getByText(/Reading the single-size library/)).toBeInTheDocument();
  });
});
