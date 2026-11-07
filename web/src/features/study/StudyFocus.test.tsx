// Study's main loop at the keyboard: where focus goes as answers come and go, what a reader is told, Stop and Try again,
// and the page's keys.
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdvisorResponse, AdvisorState } from "@/solver/protocol";
import { provenanceOf } from "@/solver/provenance";
import { SolverError, type SolveResult } from "@/solver/types";
import { DEFAULT_SETTINGS, useSettings } from "@/state/settings";

import { StudyPage } from "./StudyPage";
import { studyKeyFrom } from "./studyState";

// the solver stubbed: `hold` keeps answers back until `release()` (or Stop, which rejects as the client does), after
// handing over `partial`, if any; `fail` rejects the next request
type Ask = { state: AdvisorState; signal?: AbortSignal; onPartial?: (r: SolveResult) => void };
const stub = vi.hoisted(() => {
  const s = {
    asked: [] as AdvisorState[],
    answerFor: (() => ({})) as (st: AdvisorState) => AdvisorResponse,
    hold: false,
    partial: null as AdvisorResponse | null,
    fail: null as string | null,
    release: () => {},
    result: null as unknown as (d: AdvisorResponse, partial?: boolean) => SolveResult,
    cancelled: null as unknown as () => Error,
    getSolver: null as unknown as () => Promise<unknown>,
  };
  const client = {
    solve: async (req: Ask): Promise<SolveResult> => {
      s.asked.push(req.state);
      if (s.partial) req.onPartial?.(s.result(s.partial, true));
      if (s.hold)
        await new Promise<void>((ok, no) => {
          s.release = ok;
          req.signal?.addEventListener("abort", () => no(s.cancelled()));
        });
      if (s.fail) throw new Error(s.fail);
      return s.result(s.answerFor(req.state));
    },
  };
  s.getSolver = async () => client;
  return s;
});
vi.mock("@/solver/useSolver", () => ({ useSolver: () => stub.getSolver }));

const node = (actor: string, street: AdvisorResponse["street"] = "preflop"): AdvisorResponse => ({
  study: "node",
  street,
  actor,
  pot_bb: 1.5,
  to_call_bb: 1,
  actions: [
    { action: "fold", freq: 0.8, combos: 1000 },
    { action: "raise 2.5", amount_bb: 2.5, freq: 0.2, combos: 200 },
  ],
  grid: { actions: ["fold", "raise 2.5"], cells: { AA: { w: 1, f: [0, 1] } } },
  range_combos: 1200,
});

const answers = () => screen.getByRole("group", { name: "Answer" });
const heading = () => within(screen.getByRole("region", { name: "Actions" })).getByRole("heading");
const told = () => screen.getAllByRole("status").find((n) => n.className.includes("sr-only"))!;
const search = () => new URLSearchParams(screen.getByLabelText("URL").textContent ?? "");
const firstAction = async (name: RegExp = /^fold/) => within(await screen.findByRole("region", { name: "Actions" })).findByRole("button", { name });

function Where() {
  return <output aria-label="URL">{useLocation().search}</output>;
}

function renderAt(search = "p=6&s=100") {
  return render(
    <MemoryRouter initialEntries={[`/study?${search}`]}>
      <StudyPage />
      <Where />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  stub.asked.length = 0;
  stub.hold = false;
  stub.partial = null;
  stub.fail = null;
  stub.result = (d, partial = false) => ({ data: d, provenance: provenanceOf(d, { mode: "fast", transport: "worker", solverVersion: "test", partial }) });
  stub.cancelled = () => new SolverError("cancelled", "cancelled");
  stub.answerFor = (st) => node(st.preflop?.length ? "HJ" : "UTG");
  useSettings.setState({ ...DEFAULT_SETTINGS });
});

describe("Study's focus", () => {
  it("keeps focus in the answer on every step, even for an instant chart answer", async () => {
    renderAt();
    const fold = await firstAction();
    fold.focus();
    fireEvent.click(fold);
    await waitFor(() => expect(heading()).toHaveTextContent("HJ"));
    await waitFor(() => expect(heading()).toHaveFocus());
  });

  it("holds focus on something in the answer while it's loading, and hands it on when the answer lands", async () => {
    renderAt();
    const fold = await firstAction();
    stub.hold = true;
    fold.focus();
    fireEvent.click(fold);
    await waitFor(() => expect(stub.asked).toHaveLength(2));
    await waitFor(() => expect(answers()).toHaveFocus());
    await act(async () => stub.release());
    await waitFor(() => expect(heading()).toHaveFocus());
  });

  it("leaves focus alone when it had moved away before the answer landed", async () => {
    renderAt();
    const fold = await firstAction();
    stub.hold = true;
    fold.focus();
    fireEvent.click(fold);
    await waitFor(() => expect(answers()).toHaveFocus());
    const reset = screen.getByRole("button", { name: "Reset" });
    reset.focus();
    await act(async () => stub.release());
    await firstAction();
    expect(reset).toHaveFocus();
  });

  it("takes no focus when none was there", async () => {
    renderAt();
    await firstAction();
    fireEvent.keyDown(document.body, { key: "1" });
    await waitFor(() => expect(heading()).toHaveTextContent("HJ"));
    expect(document.body).toHaveFocus();
  });

  it("goes to the next form after Deal and Random", async () => {
    stub.answerFor = (st) => (st.board ? node("BB", "flop") : ({ study: "deal", street: "flop" } as AdvisorResponse));
    renderAt();
    const random = await screen.findByRole("button", { name: "Random" });
    random.focus();
    fireEvent.click(random);
    await waitFor(() => expect(heading()).toHaveTextContent("BB"));
    await waitFor(() => expect(heading()).toHaveFocus());
  });

  it("lands in the Deal form's field where the next node deals a card", async () => {
    stub.answerFor = (st) => (st.preflop?.length ? ({ study: "deal", street: "flop" } as AdvisorResponse) : node("UTG"));
    renderAt();
    const fold = await firstAction();
    fold.focus();
    fireEvent.click(fold);
    await waitFor(() => expect(screen.getByRole("textbox", { name: /Deal the flop/ })).toHaveFocus());
  });

  it("keeps Actions' first button an action, with the heading before it", async () => {
    renderAt();
    await firstAction();
    expect(within(screen.getByRole("region", { name: "Actions" })).getAllByRole("button")[0]).toHaveTextContent(/^fold/);
  });

  it("hands the keyboard over at the end of the line, where Back or Forward disables", async () => {
    renderAt();
    fireEvent.click(await firstAction());
    await screen.findByRole("button", { name: "← Back" });
    const back = screen.getByRole("button", { name: "← Back" });
    const forward = screen.getByRole("button", { name: "Forward →" });
    await waitFor(() => expect(back).toBeEnabled());
    back.focus();
    fireEvent.click(back);
    await waitFor(() => expect(back).toBeDisabled());
    expect(forward).toHaveFocus();
    fireEvent.click(forward);
    await waitFor(() => expect(forward).toBeDisabled());
    expect(back).toHaveFocus();
  });

  it("keeps the keyboard on New hand when a new stack rebuilds its form", async () => {
    renderAt();
    fireEvent.change(await screen.findByLabelText("Stack in big blinds"), { target: { value: "50" } });
    const start = screen.getByRole("button", { name: "New hand" });
    start.focus();
    fireEvent.submit(start.closest("form")!);
    await waitFor(() => expect(search().get("s")).toBe("50"));
    await waitFor(() => expect(screen.getByRole("button", { name: "New hand" })).toHaveFocus());
  });

  it("keeps focus when Fold to has no seats left to offer", async () => {
    // (one fold is left, and with it no seat to offer)
    stub.answerFor = () => node("SB");
    renderAt("p=6&s=100&pre=UTG:f,HJ:f,CO:f,BTN:r2.5");
    const seat = await within(await screen.findByRole("group", { name: "Fold to a seat" })).findByRole("button", { name: "SB folds, BB to act" });
    stub.answerFor = () => node("BB");
    seat.focus();
    fireEvent.click(seat);
    await waitFor(() => expect(heading()).toHaveTextContent("BB"));
    expect(screen.queryByRole("group", { name: "Fold to a seat" })).toBeNull();
    await waitFor(() => expect(heading()).toHaveFocus());
  });
});

describe("Study's live region", () => {
  it("is one region, there before and after, that says who acts, the street, the pot and the source", async () => {
    stub.hold = true;
    renderAt();
    const region = told();
    expect(region).toHaveTextContent("Finding the answer.");
    await waitFor(() => expect(stub.asked).toHaveLength(1));
    await act(async () => stub.release());
    await firstAction();
    expect(told()).toBe(region);
    expect(region).toHaveTextContent("UTG to act on the preflop, pot 1.5bb. Preflop charts · approximate.");
  });

  it("isn't re-told as a partial answer's numbers move", async () => {
    stub.hold = true;
    stub.partial = node("BB", "flop");
    renderAt();
    await firstAction();
    expect(told()).toHaveTextContent("BB to act on the flop, pot 1.5bb. Partial answer, still refining.");
  });

  it("says it stopped or failed", async () => {
    stub.hold = true;
    renderAt();
    fireEvent.click(await screen.findByRole("button", { name: "Stop" }));
    await waitFor(() => expect(told()).toHaveTextContent("Stopped."));

    stub.fail = "The engine gave up.";
    stub.hold = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(told()).toHaveTextContent("The engine gave up."));
  });
});

describe("Stop and Try again", () => {
  it("keeps what a stopped partial answer showed, still labelled partial, and Try again re-asks", async () => {
    stub.hold = true;
    stub.partial = node("BB", "flop");
    renderAt();
    await firstAction();
    expect(screen.getAllByRole("gridcell")).toHaveLength(169);
    const stop = screen.getByRole("button", { name: "Stop" });
    stop.focus();
    fireEvent.click(stop);
    const again = await screen.findByRole("button", { name: "Try again" });
    await waitFor(() => expect(again).toHaveFocus());
    expect(screen.getAllByRole("gridcell")).toHaveLength(169);
    expect(within(screen.getByRole("region", { name: "Actions" })).getByText(/partial, stopped before it finished/)).toBeInTheDocument();
    expect(told()).toHaveTextContent("Stopped. What it had reached stays below, labelled partial.");

    stub.hold = false;
    stub.partial = null;
    stub.answerFor = () => node("BB", "flop");
    fireEvent.click(again);
    await waitFor(() => expect(stub.asked).toHaveLength(2));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Try again" })).toBeNull());
    expect(within(screen.getByRole("region", { name: "Actions" })).queryByText(/partial/)).toBeNull();
    await waitFor(() => expect(heading()).toHaveFocus());
  });

  it("offers Try again at the root, after a solver error with no partial answer", async () => {
    stub.fail = "The engine gave up.";
    renderAt();
    const again = await screen.findByRole("button", { name: "Try again" });
    expect(screen.getByRole("button", { name: /Back/ })).toBeDisabled();
    stub.fail = null;
    fireEvent.click(again);
    await firstAction();
    expect(stub.asked).toHaveLength(2);
  });

  it("offers no Try again on a setup that can't be asked", async () => {
    renderAt("p=2&s=100&rake=40");
    expect(await screen.findByRole("alert")).toHaveTextContent("This setup can't be solved");
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(told()).toHaveTextContent("");
  });
});

describe("Study's keys", () => {
  it("leaves 1-9, b and Backspace to what's focused on a button or link", async () => {
    renderAt("p=6&s=100&pre=UTG:f");
    const fold = await firstAction();
    fold.focus();
    fireEvent.keyDown(fold, { key: "1" });
    fireEvent.keyDown(fold, { key: "b" });
    fireEvent.keyDown(fold, { key: "Backspace" });
    const link = screen.getByRole("link", { name: "Set up your own" });
    fireEvent.keyDown(link, { key: "1" });
    fireEvent.keyDown(link, { key: "Backspace" });
    await act(async () => {});
    expect(search().get("pre")).toBe("UTG:f");
    expect(screen.getByRole("button", { name: "✎ Build" })).toHaveAttribute("aria-pressed", "false");
    expect(stub.asked).toHaveLength(1);
  });

  it("leaves Enter and Space to a focused button", async () => {
    renderAt();
    const fold = await firstAction();
    expect(fireEvent.keyDown(fold, { key: "Enter" })).toBe(true); // (not prevented: the browser turns it into a click)
    expect(fireEvent.keyDown(fold, { key: " " })).toBe(true);
    expect(search().get("pre")).toBeNull();
  });

  it("fires from the page, and from the heading focus lands on", async () => {
    renderAt();
    await firstAction();
    fireEvent.keyDown(document.body, { key: "2" });
    await waitFor(() => expect(search().get("pre")).toBe("UTG:r2.5"));
    await waitFor(() => expect(heading()).toHaveTextContent("HJ"));
    heading().focus();
    fireEvent.keyDown(heading(), { key: "Backspace" });
    await waitFor(() => expect(search().get("pre")).toBeNull());
  });

  it("still walks the line with the arrows from a button", async () => {
    renderAt("p=6&s=100&pre=UTG:f");
    const fold = await firstAction();
    fireEvent.keyDown(fold, { key: "ArrowLeft" });
    await waitFor(() => expect(search().get("pre")).toBeNull());
  });

  it("does nothing with the setting off, and stops advertising the keys", async () => {
    useSettings.setState({ studyKeys: false });
    renderAt("p=6&s=100&pre=UTG:f");
    const fold = await firstAction();
    for (const key of ["1", "b", "Backspace", "ArrowLeft", "ArrowRight"]) fireEvent.keyDown(document.body, { key });
    await act(async () => {});
    expect(search().get("pre")).toBe("UTG:f");
    expect(fold).not.toHaveAttribute("aria-keyshortcuts");
    expect(fold.querySelector("kbd")).toBeNull();
    expect(screen.getByRole("button", { name: /Back/ })).not.toHaveAttribute("aria-keyshortcuts");
  });

  it("says which controls keep which keys", () => {
    const at = (html: string) => {
      const box = document.createElement("div");
      box.innerHTML = html;
      return box.firstElementChild!;
    };
    for (const el of ["<a href='#x'>x</a>", "<button>x</button>", "<select></select>", "<summary>x</summary>", "<span role='tab'>x</span>", "<div role='separator' tabindex='0'></div>"]) expect(studyKeyFrom(at(el), "1")).toBe(false);
    for (const el of ["<div tabindex='-1'>x</div>", "<h2>x</h2>", "<a>not a link</a>"]) expect(studyKeyFrom(at(el), "1")).toBe(true);
    expect(studyKeyFrom(at("<button>x</button>"), "ArrowLeft")).toBe(true);
    for (const el of ["<input>", "<textarea></textarea>", "<div contenteditable='true'>x</div>", "<div role='grid'><button role='gridcell'>x</button></div>"]) {
      expect(studyKeyFrom(at(el), "ArrowLeft")).toBe(false);
      expect(studyKeyFrom(at(el).firstElementChild ?? at(el), "1")).toBe(false);
    }
    expect(studyKeyFrom(null, "1")).toBe(true);
  });
});

describe("Study's grid", () => {
  it("walks itself, not the line, and says what the panel now shows", async () => {
    stub.answerFor = () => ({ ...node("BB", "flop"), combos: { AA: [["AsAh", 1, [0, 1], null, null, 0, 0]] } }) as unknown as AdvisorResponse;
    renderAt("p=6&s=100&pre=UTG:f");
    const aa = await screen.findByRole("gridcell", { name: /^AA:/ });
    aa.focus();
    for (const key of ["ArrowLeft", "ArrowRight", "ArrowLeft", "1", "Backspace"]) fireEvent.keyDown(document.activeElement!, { key });
    await act(async () => {});
    expect(search().get("pre")).toBe("UTG:f");
    expect(aa).toHaveFocus();
    fireEvent.click(aa);
    expect(aa).toHaveFocus();
    expect(screen.getByText(/^AA: 100% in range, fold 0%, raise 2\.5 100%\. /)).toHaveAttribute("role", "status");
  });
});

describe("Study's form errors", () => {
  it("ties the Deal form's error to its field", async () => {
    stub.answerFor = () => ({ study: "deal", street: "flop" }) as AdvisorResponse;
    renderAt();
    const field = await screen.findByRole("textbox", { name: /Deal the flop/ });
    fireEvent.change(field, { target: { value: "zz" } });
    fireEvent.click(screen.getByRole("button", { name: "Deal" }));
    const err = await screen.findByRole("alert");
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field).toHaveAttribute("aria-describedby", err.id);
  });

  it("puts New hand's stack limit in visible text tied to the field", async () => {
    renderAt();
    const stack = await screen.findByRole("spinbutton", { name: "Stack in big blinds" });
    const limit = document.getElementById(stack.getAttribute("aria-describedby")!)!;
    expect(limit).toHaveTextContent("bb (10 to 250)");
    expect(limit).toHaveClass("text-muted");
    fireEvent.change(stack, { target: { value: "5" } });
    expect(stack).toHaveAttribute("aria-invalid", "true");
    expect(limit).toHaveClass("text-danger");
  });

  it("shows no raw token where a node has no answer", async () => {
    stub.answerFor = () => ({ study: "pf_export", street: "preflop" }) as AdvisorResponse;
    renderAt();
    const says = await screen.findByText(/There's no study answer for this node/);
    expect(says.textContent).not.toContain("pf_");
  });
});
