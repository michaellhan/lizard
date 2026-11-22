// Calls to the explain proxy (explain-worker/), on the site's own origin. It holds no key and reads none: the owner's key is
// a secret of that Worker, and Lizard never reads the key the classic app keeps in localStorage. Nothing here throws to the page:
// every failure comes back as a state with words, and the rest of the page goes on as it was.
import type { ExplainRequest } from "./request";

const BASE = "/lizard/api/explain";

/** Explain is in this build only with VITE_EXPLAIN=on (the repo variable LIZARD_EXPLAIN), as sync is with VITE_SYNC. */
export const explainOn = (): boolean => import.meta.env.VITE_EXPLAIN === "on";

export type Availability = { ok: true } | { ok: false; why: string };
export type Answer = { ok: true; text: string; cut: boolean } | { ok: false; why: string };

const WORDS: Record<string, string> = {
  not_configured: "AI explanations aren't switched on yet.",
  over_budget: "This month's budget for AI explanations is used up. They come back next month.",
  slow_down: "Too many explanations just now. Wait a little and try again.",
  upstream_busy: "The AI service is busy. Try again in a moment.",
  upstream_unreachable: "The AI service couldn't be reached. Try again in a moment.",
  refused: "The AI service declined to explain this one.",
  no_answer: "No explanation came back for this one.",
  bad_request: "This decision couldn't be sent in the shape the service takes.",
  too_large: "This decision couldn't be sent in the shape the service takes.",
};
const UNREACHABLE = "AI explanations can't be reached from here right now.";

/** What a code means, in words. */
export const wordsFor = (code: string | undefined) => (code && WORDS[code]) || UNREACHABLE;

async function read(res: Response): Promise<Record<string, unknown> | null> {
  if (!(res.headers.get("content-type") ?? "").includes("json")) return null;
  return (await res.json().catch(() => null)) as Record<string, unknown> | null;
}

let checked: Promise<Availability> | null = null;

/** Whether the service will take a request: asked once a page load (it costs nothing), as the button is first drawn. */
export function availability(): Promise<Availability> {
  checked ??= fetch(`${BASE}/health`, { credentials: "same-origin" })
    .then(async (res) => {
      const body = await read(res);
      if (res.ok && body?.ok === true) return { ok: true } as const;
      return { ok: false, why: wordsFor(typeof body?.error === "string" ? body.error : undefined) } as const;
    })
    .catch(() => ({ ok: false, why: UNREACHABLE }) as const);
  return checked;
}

/** Forgets the health answer (tests; and after a refusal that says the state changed). */
export const forgetAvailability = () => void (checked = null);

/** Asks for an explanation of `req`. */
export async function explain(req: ExplainRequest): Promise<Answer> {
  let res: Response;
  try {
    res = await fetch(BASE, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-lizard": "1" }, body: JSON.stringify(req) });
  } catch {
    return { ok: false, why: UNREACHABLE };
  }
  const body = await read(res);
  if (res.ok && typeof body?.text === "string" && body.text.trim()) return { ok: true, text: body.text, cut: body.cut === true };
  const code = typeof body?.error === "string" ? body.error : undefined;
  if (code === "not_configured" || code === "over_budget") forgetAvailability();
  return { ok: false, why: wordsFor(code) };
}
