// Explain: an AI explanation of the decision's numbers, from Lizard's proxy (explain-worker/), drawn under those numbers and
// labelled as what it is. It's in the build only with VITE_EXPLAIN=on. Where the service says it isn't switched on, its
// month's budget is used, or it can't be reached, the button stays disabled with the reason beside it; nothing else on the
// page depends on it. The answer is drawn as text (React escapes it): its **bold** and "- " bullets only are read.
import { Fragment, useEffect, useState, type ReactNode } from "react";
import { availability, explain, explainOn, type Availability } from "./client";
import type { ExplainRequest } from "./request";

export const AI_LABEL = "AI explanation of the numbers above; may be wrong.";

type State = { st: "idle" } | { st: "asking" } | { st: "done"; text: string; cut: boolean } | { st: "failed"; why: string };

function bold(s: string): ReactNode[] {
  return s.split(/\*\*(.+?)\*\*/g).map((part, i) => (i % 2 ? <strong key={i}>{part}</strong> : <Fragment key={i}>{part}</Fragment>));
}

/** The answer's lines: a bullet run as a list, the rest as paragraphs. */
export function AnswerText({ text }: { text: string }) {
  const out: ReactNode[] = [];
  let items: string[] = [];
  const flush = () => {
    if (items.length) out.push(<ul key={`u${out.length}`} className="list-disc space-y-0.5 pl-5">{items.map((t, i) => <li key={i}>{bold(t)}</li>)}</ul>);
    items = [];
  };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const item = /^[-*•]\s+(.*)$/.exec(line);
    if (item) items.push(item[1]!);
    else {
      flush();
      out.push(<p key={`p${out.length}`}>{bold(line)}</p>);
    }
  }
  flush();
  return <div className="space-y-1">{out}</div>;
}

function Explain({ request }: { request: () => ExplainRequest | null }) {
  const [avail, setAvail] = useState<Availability | null>(null);
  const [state, setState] = useState<State>({ st: "idle" });
  useEffect(() => {
    let live = true;
    void availability().then((a) => live && setAvail(a));
    return () => {
      live = false;
    };
  }, []);
  const ask = async () => {
    const req = request();
    if (!req) return setState({ st: "failed", why: "This decision can't be sent for an explanation." });
    setState({ st: "asking" });
    const a = await explain(req);
    setState(a.ok ? { st: "done", text: a.text, cut: a.cut } : { st: "failed", why: a.why });
  };
  const off = !avail?.ok;
  return (
    <div className="space-y-1 text-sm" data-testid="explain">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={off || state.st === "asking"}
          onClick={() => void ask()}
          title="An AI explanation of these numbers (it sends the decision's numbers, never your other data)"
          className="rounded-md border border-border px-3 py-1.5 hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {state.st === "asking" ? "Explaining…" : "Explain"}
        </button>
        {avail && !avail.ok && <span className="text-xs text-muted">{avail.why}</span>}
        {!avail && <span className="text-xs text-muted">Checking AI explanations…</span>}
      </div>
      {state.st === "failed" && (
        <p role="status" className="text-muted">
          {state.why}
        </p>
      )}
      {state.st === "done" && (
        <section aria-label="AI explanation" className="space-y-1 rounded-md border border-border bg-surface-2 p-2">
          <p className="text-xs font-medium text-muted">{AI_LABEL}</p>
          <AnswerText text={state.text} />
          {state.cut && <p className="text-xs text-muted">(cut short at its length limit)</p>}
        </section>
      )}
    </div>
  );
}

/** The Explain button, or nothing in a build without VITE_EXPLAIN=on. `request` is made as it's asked for. */
export function ExplainButton({ request }: { request: () => ExplainRequest | null }) {
  return explainOn() ? <Explain request={request} /> : null;
}
