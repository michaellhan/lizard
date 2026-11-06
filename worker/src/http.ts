// Answers: a code and no detail, never a body or a stack, and nothing cached or sniffed.
const HEADERS = { "content-type": "application/json", "cache-control": "no-store", "x-content-type-options": "nosniff" };

export const json = (body: unknown, status = 200, extra: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { ...HEADERS, ...extra } });
export const refuse = (status: number, code: string) => json({ error: code }, status);

/** A refusal raised from anywhere in a request. */
export class Refused extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

export const MAX_BODY = 4 * 1024 * 1024 + 64 * 1024;

/** A request's JSON, its size checked as read: a missing or false Content-Length doesn't get round it. */
export async function readJson(req: Request): Promise<Record<string, unknown>> {
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY) throw new Refused(413, "too_large");
  const text = await req.text();
  if (text.length > MAX_BODY) throw new Refused(413, "too_large");
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    throw new Refused(400, "bad_json");
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Refused(400, "bad_json");
  return v as Record<string, unknown>;
}
