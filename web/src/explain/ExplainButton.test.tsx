// The Explain button: absent from a build without VITE_EXPLAIN=on; disabled with the reason when the proxy isn't switched
// on, is over its budget or can't be reached; and an answer drawn under its label. The proxy is stubbed: no request leaves.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DecisionView } from "@/features/practice/PracticeParts";
import type { Reviewed } from "@/features/practice/review";
import { forgetAvailability } from "./client";
import { AI_LABEL, ExplainButton } from "./ExplainButton";
import type { ExplainRequest } from "./request";

const req = { v: 1, where: "study" } as unknown as ExplainRequest;
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

let calls: { url: string; init?: RequestInit }[];
function proxy(answer: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return answer(url, init);
  });
}

beforeEach(() => {
  calls = [];
  forgetAvailability();
  vi.stubEnv("VITE_EXPLAIN", "on");
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));

describe("ExplainButton", () => {
  it("draws nothing, and asks nothing, without VITE_EXPLAIN=on", async () => {
    vi.stubEnv("VITE_EXPLAIN", "");
    proxy(() => reply(200, { ok: true }));
    const { container } = render(<ExplainButton request={() => req} />);
    await settle();
    expect(container.innerHTML).toBe("");
    expect(calls).toHaveLength(0);
  });

  it.each([
    [reply(503, { error: "not_configured" }), "AI explanations aren't switched on yet."],
    [reply(503, { error: "over_budget", retryAfter: 9 }), "This month's budget for AI explanations is used up. They come back next month."],
    [new Response("<!doctype html>", { status: 200, headers: { "content-type": "text/html" } }), "AI explanations can't be reached from here right now."],
  ])("is disabled with the reason when the proxy says so (%#)", async (res, why) => {
    proxy(() => res);
    render(<ExplainButton request={() => req} />);
    await settle();
    expect(screen.getByRole("button", { name: "Explain" })).toBeDisabled();
    expect(screen.getByText(why)).toBeInTheDocument();
  });

  it("is disabled, and the page stands, when the proxy can't be reached at all", async () => {
    proxy(() => Promise.reject(new TypeError("offline")));
    render(<ExplainButton request={() => req} />);
    await settle();
    expect(screen.getByRole("button", { name: "Explain" })).toBeDisabled();
    expect(screen.getByText("AI explanations can't be reached from here right now.")).toBeInTheDocument();
  });

  it("sends only the decision, with the app's header and no key, and draws the answer under its label", async () => {
    proxy((url) => (url.endsWith("/health") ? reply(200, { ok: true }) : reply(200, { text: "**In short:** check.\n- Reason one.\n- Reason two.\n**Takeaway:** keep it simple.", cut: false })));
    render(<ExplainButton request={() => req} />);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Explain" }));
    await settle();
    const post = calls.find((c) => c.init?.method === "POST")!;
    expect(post.url).toBe("/lizard/api/explain");
    expect(JSON.parse(String(post.init!.body))).toEqual(req);
    const headers = post.init!.headers as Record<string, string>;
    expect(headers).toEqual({ "content-type": "application/json", "x-lizard": "1" });
    const answer = screen.getByRole("region", { name: "AI explanation" });
    expect(answer).toHaveTextContent(AI_LABEL);
    expect(AI_LABEL).toBe("AI explanation of the numbers above; may be wrong.");
    expect(screen.getByText("In short:").tagName).toBe("STRONG");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("says why when the proxy refuses a request, and keeps the page", async () => {
    proxy((url) => (url.endsWith("/health") ? reply(200, { ok: true }) : reply(429, { error: "slow_down", scope: "ip", retryAfter: 30 })));
    render(<ExplainButton request={() => req} />);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Explain" }));
    await settle();
    expect(screen.getByText("Too many explanations just now. Wait a little and try again.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Explain" })).toBeEnabled();
  });
});

describe("on Practice's verdict", () => {
  it("sits beside Copy for AI on a graded decision, and sends that decision", async () => {
    const spot = {
      n: 1,
      seat: "BTN",
      players: 6,
      hole: ["Ah", "Kd"] as [string, string],
      board: [],
      line: "folded to you",
      d: {
        street: "preflop" as const,
        move: { pos: "BTN", action: "raise", to: 2.5 },
        chose: "raise 2.5",
        grade: { a: 0, best: 0, byEv: false, loss: 0, lossPct: 0, verdict: "Best" as const, mixed: false, ok: true },
        mix: [{ action: "raise 2.5", freq: 1, ev: null }],
        pot: 1.5,
        study: "",
        provenance: { source: "charts" as const, approximate: true, mode: "quick" as const, transport: "worker" as const, solverVersion: "t", partial: false, receivedAt: 0 },
      },
    } as unknown as Reviewed;
    proxy((url) => (url.endsWith("/health") ? reply(200, { ok: true }) : reply(200, { text: "**In short:** the chart raises.", cut: false })));
    render(
      <MemoryRouter>
        <DecisionView d={spot.d} spot={spot} />
      </MemoryRouter>,
    );
    await settle();
    expect(screen.getByRole("button", { name: "Copy for AI" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Explain" }));
    await settle();
    const sent = JSON.parse(String(calls.find((c) => c.init?.method === "POST")!.init!.body));
    expect(sent).toMatchObject({ where: "practice", hero: { seat: "BTN", cards: ["Ah", "Kd"] }, street: "preflop", board: [], line: ["folded to you"], provenance: { source: "charts", approximate: true } });
    expect(screen.getByRole("region", { name: "AI explanation" })).toHaveTextContent("the chart raises.");
  });
});
