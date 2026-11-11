import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * One styled menu for every `<select>` in the app, in place of the system's popup. Mounted once at the root: a mouse
 * press or an opening key on a select opens this list under it, and a choice is written back to the select with a
 * change event, so the select stays the control (its value, its name to a screen reader, forms and tests). A touch
 * keeps the phone's own picker.
 */

type Item = { kind: "group"; label: string } | { kind: "option"; index: number; label: string; disabled: boolean };

type Open = { sel: HTMLSelectElement; items: Item[]; active: number };

const MENU_ID = "lz-select-menu";
const optId = (i: number) => `${MENU_ID}-${i}`;

function eligible(el: EventTarget | null): HTMLSelectElement | null {
  const sel = el instanceof Element ? el.closest("select") : null;
  if (!sel || sel.multiple || sel.size > 1 || sel.disabled) return null;
  return sel;
}

function readItems(sel: HTMLSelectElement): Item[] {
  const out: Item[] = [];
  let group: HTMLOptGroupElement | null = null;
  Array.from(sel.options).forEach((o, index) => {
    const g = o.parentElement instanceof HTMLOptGroupElement ? o.parentElement : null;
    if (g && g !== group) out.push({ kind: "group", label: g.label });
    group = g;
    if (o.hidden) return;
    out.push({ kind: "option", index, label: o.label || o.text, disabled: o.disabled || !!g?.disabled });
  });
  return out;
}

/** The next choosable item from `from` in direction `dir`, or `from` itself when there is none. */
function step(items: Item[], from: number, dir: 1 | -1): number {
  for (let i = from + dir; i >= 0 && i < items.length; i += dir) {
    const it = items[i]!;
    if (it.kind === "option" && !it.disabled) return i;
  }
  return from;
}

function choose(sel: HTMLSelectElement, index: number) {
  if (sel.selectedIndex === index) return;
  sel.selectedIndex = index;
  sel.dispatchEvent(new Event("input", { bubbles: true }));
  sel.dispatchEvent(new Event("change", { bubbles: true }));
}

export function SelectMenu() {
  const [open, setOpen] = useState<Open | null>(null);
  const openRef = useRef<Open | null>(null);
  useLayoutEffect(() => {
    openRef.current = open;
  }, [open]);
  const menuRef = useRef<HTMLDivElement>(null);
  const pointer = useRef("mouse");
  const typed = useRef({ text: "", at: 0 });

  const close = useCallback(() => setOpen(null), []);

  const show = useCallback((sel: HTMLSelectElement) => {
    const items = readItems(sel);
    const at = items.findIndex((it) => it.kind === "option" && it.index === sel.selectedIndex);
    setOpen({ sel, items, active: at >= 0 ? at : step(items, -1, 1) });
  }, []);

  // The select says it's open, and which option is active, while the menu shows.
  useEffect(() => {
    if (!open) return;
    const { sel, active } = open;
    sel.setAttribute("aria-expanded", "true");
    sel.setAttribute("aria-controls", MENU_ID);
    sel.setAttribute("aria-activedescendant", optId(active));
    return () => {
      sel.removeAttribute("aria-expanded");
      sel.removeAttribute("aria-controls");
      sel.removeAttribute("aria-activedescendant");
    };
  }, [open]);

  useEffect(() => {
    const onPointer = (e: PointerEvent) => {
      pointer.current = e.pointerType || "mouse";
    };
    const onMouseDown = (e: MouseEvent) => {
      const cur = openRef.current;
      if (cur && menuRef.current?.contains(e.target as Node)) return;
      const sel = eligible(e.target);
      if (sel && e.button === 0 && pointer.current === "mouse") {
        e.preventDefault();
        sel.focus();
        if (cur?.sel === sel) close();
        else show(sel);
        return;
      }
      if (cur) close();
    };
    const onKey = (e: KeyboardEvent) => {
      const cur = openRef.current;
      if (cur) {
        const { items, active, sel } = cur;
        const move = (to: number) => {
          e.preventDefault();
          setOpen({ ...cur, active: to });
        };
        switch (e.key) {
          case "ArrowDown":
            return e.altKey ? (e.preventDefault(), close()) : move(step(items, active, 1));
          case "ArrowUp":
            return e.altKey ? (e.preventDefault(), close()) : move(step(items, active, -1));
          case "Home":
            return move(step(items, -1, 1));
          case "End":
            return move(step(items, items.length, -1));
          case "PageDown":
            return move([...Array(8)].reduce((a: number) => step(items, a, 1), active));
          case "PageUp":
            return move([...Array(8)].reduce((a: number) => step(items, a, -1), active));
          case "Enter":
          case " ": {
            if (e.key === " " && typed.current.text && Date.now() - typed.current.at < 600) break;
            e.preventDefault();
            const it = items[active];
            close();
            if (it?.kind === "option" && !it.disabled) choose(sel, it.index);
            return;
          }
          case "Escape":
            e.preventDefault();
            e.stopPropagation();
            return close();
          case "Tab":
            return close();
        }
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          const now = Date.now();
          const t = typed.current;
          t.text = now - t.at < 600 ? t.text + e.key.toLowerCase() : e.key.toLowerCase();
          t.at = now;
          const n = items.length;
          for (let k = 1; k <= n; k++) {
            const i = (active + (t.text.length > 1 ? 0 : 1) + k - 1) % n;
            const it = items[i]!;
            if (it.kind === "option" && !it.disabled && it.label.toLowerCase().startsWith(t.text)) return move(i);
          }
          e.preventDefault();
        }
        return;
      }
      const sel = eligible(e.target);
      if (!sel || e.ctrlKey || e.metaKey) return;
      if (e.key === " " || e.key === "Enter" || e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "F4") {
        e.preventDefault();
        show(sel);
      }
    };
    const onFocusOut = (e: FocusEvent) => {
      const cur = openRef.current;
      if (cur && e.target === cur.sel && !menuRef.current?.contains(e.relatedTarget as Node)) close();
    };
    const onResize = () => close();
    document.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("mousedown", onMouseDown, true);
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("focusout", onFocusOut, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("pointerdown", onPointer, true);
      document.removeEventListener("mousedown", onMouseDown, true);
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("focusout", onFocusOut, true);
      window.removeEventListener("resize", onResize);
    };
  }, [close, show]);

  // Placed under the select (above it when there's more room there), and kept with it while the page moves or
  // re-renders; gone with it.
  useLayoutEffect(() => {
    if (!open) return;
    let frame = 0;
    const place = () => {
      const menu = menuRef.current;
      const { sel } = open;
      if (!sel.isConnected) return close();
      if (menu) {
        const r = sel.getBoundingClientRect();
        const below = innerHeight - r.bottom - 8;
        const above = r.top - 8;
        const up = below < 180 && above > below;
        const room = Math.max(120, Math.min(320, up ? above : below));
        menu.style.minWidth = `${r.width}px`;
        menu.style.maxHeight = `${room}px`;
        const w = menu.offsetWidth;
        menu.style.left = `${Math.max(8, Math.min(r.left, innerWidth - w - 8))}px`;
        menu.style.top = up ? "" : `${r.bottom + 4}px`;
        menu.style.bottom = up ? `${innerHeight - r.top + 4}px` : "";
      }
      frame = requestAnimationFrame(place);
    };
    place();
    return () => cancelAnimationFrame(frame);
  }, [open, close]);

  useEffect(() => {
    if (open) document.getElementById(optId(open.active))?.scrollIntoView?.({ block: "nearest" });
  }, [open]);

  if (!open) return null;
  const { sel, items, active } = open;
  const css = getComputedStyle(sel);
  const name = sel.getAttribute("aria-label") ?? sel.labels?.[0]?.textContent ?? undefined;
  return createPortal(
    <div
      ref={menuRef}
      id={MENU_ID}
      role="listbox"
      aria-label={name || undefined}
      tabIndex={-1}
      style={{ fontFamily: css.fontFamily }}
      className="fixed z-50 max-w-[min(28rem,calc(100vw-16px))] overflow-y-auto rounded-md border border-border bg-surface-2 py-1 text-sm text-text shadow-lg shadow-black/50"
    >
      {items.map((it, i) =>
        it.kind === "group" ? (
          <div key={`g${i}`} role="presentation" className="px-3 pb-0.5 pt-2 text-xs font-medium text-muted first:pt-1">
            {it.label}
          </div>
        ) : (
          <div
            key={i}
            id={optId(i)}
            role="option"
            aria-selected={it.index === sel.selectedIndex}
            aria-disabled={it.disabled || undefined}
            onMouseDown={(e) => e.preventDefault()}
            onMouseMove={() => !it.disabled && i !== active && setOpen({ ...open, active: i })}
            onClick={() => {
              if (it.disabled) return;
              close();
              choose(sel, it.index);
            }}
            className={`flex cursor-pointer items-center gap-2 whitespace-nowrap py-1 pl-2 pr-4 ${i === active ? "bg-surface-3" : ""} ${
              it.disabled ? "cursor-default text-faint" : it.index === sel.selectedIndex ? "text-accent" : ""
            }`}
          >
            <span aria-hidden className="w-3 shrink-0 text-center text-xs">
              {it.index === sel.selectedIndex ? "✓" : ""}
            </span>
            {it.label}
          </div>
        ),
      )}
    </div>,
    document.body,
  );
}
