// Study's side panel under the actions: three tabs in place of a column of stacked panels and a "More tools" fold. Hand
// (the class picked in the grid), Breakdown (the range by category, equity, blockers) and Tools (the solves and links that
// work on this node). One at a time keeps the panel about as tall as the grid beside it, and every tool is named on its tab.
import { useState, type KeyboardEvent, type ReactNode } from "react";

export type StudyTab = "hand" | "breakdown" | "tools";

export const TAB_LABELS: Record<StudyTab, string> = {
  hand: "Hand",
  breakdown: "Breakdown",
  tools: "Tools",
};

/**
 * The tabs offered (in order) and their panels. A panel is mounted the first time its tab is picked and then kept (hidden
 * while another tab is up), so a tool half filled in or a breakdown asked for isn't lost by looking at another tab; the
 * page keys this per node, so a new node starts afresh. Arrow keys move along the tabs (and not along the line).
 */
export function StudyTabs({
  tabs,
  active,
  onPick,
  label,
  panels,
}: {
  tabs: StudyTab[];
  active: StudyTab;
  onPick: (t: StudyTab) => void;
  /** what a tab says, where it says more than its name (the class picked, on Hand) */
  label?: Partial<Record<StudyTab, string>>;
  panels: Record<StudyTab, ReactNode>;
}) {
  const at = tabs.includes(active) ? active : tabs[0]!;
  const [seen, setSeen] = useState<ReadonlySet<StudyTab>>(() => new Set([at]));
  if (!seen.has(at)) setSeen(new Set([...seen, at]));
  const id = (t: StudyTab, part: "tab" | "panel") => `study-${t}-${part}`;
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = tabs.indexOf(at);
    const to =
      e.key === "ArrowRight"
        ? tabs[(i + 1) % tabs.length]
        : e.key === "ArrowLeft"
          ? tabs[(i - 1 + tabs.length) % tabs.length]
          : e.key === "Home"
            ? tabs[0]
            : e.key === "End"
              ? tabs.at(-1)
              : undefined;
    if (!to) return;
    // (handled here: Study's own arrow keys walk the line, and skip what's defaultPrevented)
    e.preventDefault();
    onPick(to);
    document.getElementById(id(to, "tab"))?.focus();
  };
  return (
    <div className="space-y-3">
      <div role="tablist" aria-label="Study panel" onKeyDown={onKey} className="flex gap-1 border-b border-border text-sm">
        {tabs.map((t) => (
          <button
            key={t}
            id={id(t, "tab")}
            type="button"
            role="tab"
            aria-selected={t === at}
            aria-controls={id(t, "panel")}
            tabIndex={t === at ? 0 : -1}
            onClick={() => onPick(t)}
            className={`-mb-px border-b-2 px-3 py-1.5 ${t === at ? "border-accent font-medium text-text" : "border-transparent text-muted hover:text-text"}`}
          >
            {label?.[t] ?? TAB_LABELS[t]}
          </button>
        ))}
      </div>
      {tabs.map((t) =>
        seen.has(t) ? (
          <div key={t} id={id(t, "panel")} role="tabpanel" aria-labelledby={id(t, "tab")} hidden={t !== at}>
            {panels[t]}
          </div>
        ) : null,
      )}
    </div>
  );
}

/** One tool on the Tools tab: its name, a line on what it does, and the tool itself, mounted only while open (so a tool
 * that solves starts when it's opened and stops when it's closed). */
export function ToolFold({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)} className="w-full panel p-3 text-sm">
      <summary className="cursor-pointer">
        <span className="font-medium">{title}</span>
        {hint && <span className="ml-2 text-xs text-muted">{hint}</span>}
      </summary>
      {open && <div className="mt-3">{children}</div>}
    </details>
  );
}
