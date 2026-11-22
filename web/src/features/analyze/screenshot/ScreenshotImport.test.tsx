import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FoundCard } from "./cards";
import type { Reading } from "./read";
import { ScreenshotImport, type Reader } from "./ScreenshotImport";

// (jsdom decodes no images and draws no canvas: the picture is a blank one, the preview draws nothing)
vi.mock("./decode", () => ({ decodeImage: vi.fn(async () => ({ width: 800, height: 600, data: new Uint8ClampedArray(800 * 600 * 4) })) }));
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});

const card = (code: string, x: number, y: number, conf = 0.9): FoundCard => ({ code, box: { x, y, w: 40, h: 56 }, faceH: 56, conf, rankConf: conf, suitConf: conf, suitBy: "colour" });
const seat = (pos: string, value: number, hero = false, conf = 0.9) => ({
  stack: { amount: { value, unit: "bb" as const }, allIn: false, conf, box: { x: 0, y: 0, w: 1, h: 1 }, from: `${value} BB` },
  pos,
  hero,
  dealer: pos === "BTN",
});
const hero = [card("9d", 380, 480), card("Jc", 400, 480)];
const board = [card("Kh", 300, 270), card("5h", 345, 270), card("6h", 390, 270, 0.4)];
const READING: Reading = {
  width: 800,
  height: 600,
  cards: [...hero, ...board],
  groups: { board, hands: [hero], loose: [], boardGap: false },
  hero: { cards: hero, conf: 0.9 },
  fourColour: false,
  dealer: { x: 0, y: 0, r: 10, conf: 0.9 },
  blinds: null,
  pot: { value: { value: 8, unit: "bb" }, conf: 0.9, from: "Pot: 8 BB" },
  unit: "bb",
  currency: "",
  layout: { seats: [seat("CO", 120, true), seat("BTN", 300), seat("SB", 150), seat("BB", 80), seat("UTG", 400), seat("HJ", 90, false, 0.3)], middle: { x: 400, y: 300 }, hero: 0, dealer: 1 },
  lines: [],
  notes: ["The blinds weren't read, so the stacks weren't put in big blinds: set the stack yourself."],
};

function setup(reader: Reader = async () => READING) {
  render(
    <MemoryRouter>
      <ScreenshotImport reader={reader} />
    </MemoryRouter>,
  );
}
const pick = (name = "table.png", type = "image/png") => fireEvent.change(screen.getByLabelText("Choose a screenshot"), { target: { files: [new File(["x"], name, { type })] } });

describe("ScreenshotImport", () => {
  it("says what it is for, and that the picture stays in the browser", () => {
    setup();
    const what = screen.getByRole("list", { name: /what this does/i });
    expect(within(what).getByText(/never leaves it/)).toBeInTheDocument();
    expect(within(what).getByText(/Review only, not for use while you play/)).toBeInTheDocument();
    expect(within(what).getByText(/doesn.t capture your screen, watch a window or sit over a table/)).toBeInTheDocument();
  });

  it("prefills the form from the picture, each field marked, and opens the spot in Study", async () => {
    setup();
    pick();
    const form = await screen.findByRole("form", { name: "The spot" });
    const cards = within(form).getByLabelText("Your cards");
    expect(cards).toHaveValue("9dJc");
    expect(cards).toHaveAccessibleDescription("read from the image");
    // a board card read without much confidence: the board is to check
    expect(within(form).getByLabelText("Board")).toHaveValue("Kh5h6h");
    expect(within(form).getByLabelText("Board")).toHaveAccessibleDescription("read from the image: check it");
    expect(within(form).getByLabelText("Your seat")).toHaveValue("CO");
    // the stack is yours against the deepest other, always to check
    expect(within(form).getByLabelText("Stack (bb)")).toHaveValue("120");
    expect(within(form).getByLabelText("Stack (bb)")).toHaveAccessibleDescription("read from the image: check it");
    const study = within(form).getByRole("link", { name: "Open in Study" });
    expect(study.getAttribute("href")).toMatch(/^\/study\?p=6&s=120&pre=.*&b=Kh5h6h.*hand=9dJc/);
    expect(within(form).getByRole("link", { name: "Set up in Solve" }).getAttribute("href")).toMatch(/^\/solve\?p=6/);
    // what wasn't read is said
    expect(screen.getByRole("list", { name: "Not read" })).toHaveTextContent(/blinds weren't read/);
    expect(screen.getByRole("region", { name: "What was read" })).toHaveTextContent(/Pot: 8bb/);
  });

  it("holds the spot back until the form is right, and marks what you change", async () => {
    setup();
    pick();
    const form = await screen.findByRole("form", { name: "The spot" });
    fireEvent.change(within(form).getByLabelText("Your cards"), { target: { value: "9d" } });
    expect(within(form).getByLabelText("Your cards")).toHaveAccessibleDescription("set by you");
    expect(within(form).getByRole("alert")).toHaveTextContent(/your cards/);
    expect(within(form).queryByRole("link", { name: "Open in Study" })).toBeNull();
    expect(within(form).getByRole("button", { name: "Open in Study" })).toBeDisabled();
    fireEvent.change(within(form).getByLabelText("Your cards"), { target: { value: "AsAd" } });
    expect(within(form).getByRole("link", { name: "Open in Study" }).getAttribute("href")).toContain("hand=AsAd");
  });

  it("a smaller table puts seats it lacks back to defaults", async () => {
    setup();
    pick();
    const form = await screen.findByRole("form", { name: "The spot" });
    fireEvent.change(within(form).getByLabelText("Players"), { target: { value: "2" } });
    expect(within(form).getByLabelText("Your seat")).toHaveValue("SB");
    expect(within(form).getByRole("link", { name: "Open in Study" }).getAttribute("href")).toMatch(/p=2/);
  });

  it("turns away a file that isn't a picture", () => {
    setup();
    pick("hands.txt", "text/plain");
    expect(screen.getByRole("alert")).toHaveTextContent(/isn't an image/);
  });

  it("shows the reader's progress, then a failure in words", async () => {
    let fail: (e: Error) => void = () => undefined;
    setup((_img, progress) => {
      progress("recognizing text", 0.5);
      return new Promise((_r, j) => (fail = j));
    });
    pick();
    expect(await screen.findByRole("status")).toHaveTextContent("Reading the numbers (50%)");
    fail(new Error("no memory"));
    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't be read: no memory/);
  });
});
