// Answers: a code and no detail, never an upstream body or a stack, and nothing cached or sniffed.
const HEADERS = { "content-type": "application/json", "cache-control": "no-store", "x-content-type-options": "nosniff" };

export const json = (body: unknown, status = 200, extra: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { ...HEADERS, ...extra } });

/** A refusal raised from anywhere in a request: its code, and for a limit how long to wait. */
export class Refused extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

export function refuse(e: Refused): Response {
  const wait: Record<string, string> = typeof e.extra.retryAfter === "number" ? { "retry-after": String(e.extra.retryAfter) } : {};
  return json({ error: e.code, ...e.extra }, e.status, wait);
}

/** A request body: at most `max` bytes, its size checked as read, so a missing or false Content-Length doesn't get round it. */
export async function readBody(req: Request, max: number): Promise<unknown> {
  if (Number(req.headers.get("content-length") ?? 0) > max) throw new Refused(413, "too_large");
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.byteLength > max) throw new Refused(413, "too_large");
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Refused(400, "bad_json");
  }
}
