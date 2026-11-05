// The first grade beside a retry's: like with like or not, a cap on the first is said either way.
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CAPPED_WORDS } from "@/grading/grade";
import { CHART, LIVE, mistake } from "@/test/mistake";
import { Compare } from "./Compare";
import { retried } from "./mistakes";

const capped = mistake({ grade: { ...mistake().grade, verdict: "Inaccuracy", loss: 2, lossPct: 30, capped: true } });

describe("a first grade stopped at Inaccuracy", () => {
  it("says why beside a like answer", () => {
    render(<Compare m={capped} r={retried(capped, { mix: capped.mix, pot: 5.5, provenance: LIVE }, 1, 5)} />);
    expect(screen.getByText(`Your first grade: ${CAPPED_WORDS}`)).toBeInTheDocument();
  });

  it("says why where the answer changed", () => {
    render(<Compare m={capped} r={retried(capped, { mix: capped.mix, pot: 5.5, provenance: CHART }, 1, 5)} />);
    expect(screen.getByText(/aren.t compared/)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(CAPPED_WORDS))).toBeInTheDocument();
  });

  it("says nothing of a cap there wasn't", () => {
    const m = mistake();
    render(<Compare m={m} r={retried(m, { mix: m.mix, pot: 5.5, provenance: LIVE }, 1, 5)} />);
    expect(screen.queryByText(new RegExp(CAPPED_WORDS))).toBeNull();
  });
});
