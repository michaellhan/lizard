// Practice's key list, shown with ? (keys.ts holds the keys and what each does).
import { KEY_HELP } from "./keys";

export function KeysHelp({ onClose }: { onClose: () => void }) {
  return (
    <section aria-label="Keyboard shortcuts" className="space-y-2 rounded-lg border border-border bg-surface p-3 text-sm">
      <div className="flex items-center gap-2">
        <h2 className="font-medium">Keyboard</h2>
        <button type="button" onClick={onClose} className="ml-auto text-xs underline">
          Close (?)
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {KEY_HELP.map((g) => (
          <div key={g.title}>
            <h3 className="mb-1 text-xs font-medium text-muted">{g.title}</h3>
            <dl className="space-y-0.5">
              {g.rows.map((r) => (
                <div key={r.what} className="flex gap-2">
                  <dt className="w-28 shrink-0">
                    {r.keys.map((k, i) =>
                      k === "–" ? (
                        <span key={i}>–</span>
                      ) : (
                        <kbd key={i} className="mr-1 rounded border border-border px-1 font-mono text-xs">
                          {k}
                        </kbd>
                      ),
                    )}
                  </dt>
                  <dd className="text-muted">{r.what}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </section>
  );
}
