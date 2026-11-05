// Bringing a panel into view: smoothly, unless the reader's system asks for less motion, which CSS can't do for a script's scroll.
export function bringIntoView(el: Element | null | undefined): void {
  const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  // (nothing returned: Chrome's scrollIntoView returns a promise that React would take for an effect's cleanup)
  el?.scrollIntoView?.({ block: "start", behavior: still ? "auto" : "smooth" });
}
