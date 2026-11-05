// Keeps the keyboard in a part of the page whose contents come and go. Spread what this returns on an element that stays
// mounted: when what had focus inside it is taken away, focus goes to that element and not to the page's <body>, and when
// new contents arrive it moves on to the first of them marked `data-focus-first`.
import { useEffect, useRef, type RefObject } from "react";

export interface FocusHold<T extends HTMLElement> {
  ref: RefObject<T | null>;
  tabIndex: -1;
  onFocus: () => void;
  onBlur: () => void;
}

export function useFocusHold<T extends HTMLElement>(): FocusHold<T> {
  const ref = useRef<T>(null);
  // (React delivers no blur for an element it removes, so this still says the keyboard was here)
  const inside = useRef(false);
  const held = useRef(false);
  useEffect(() => {
    const box = ref.current;
    if (!box) return;
    if (inside.current && document.activeElement === document.body) {
      box.focus({ preventScroll: true });
      held.current = true;
    }
    if (document.activeElement !== box) {
      held.current = false;
    } else if (held.current) {
      const first = box.querySelector<HTMLElement>("[data-focus-first]");
      if (first) {
        held.current = false;
        first.focus({ preventScroll: true });
      }
    }
  });
  return {
    ref,
    tabIndex: -1,
    onFocus: () => {
      inside.current = true;
    },
    onBlur: () => {
      inside.current = false;
    },
  };
}
