// Study's two columns, the range and the panel beside it: one split, the Setting `studySplit`, wherever the range is
// shown, so the solution and the range builder sit at the same size and a move in either lasts in both.
import { useSyncExternalStore, type ReactNode } from "react";
import { ResizableWorkspace, WIDE_QUERY } from "@/components/ResizableWorkspace";
import { useSettings } from "@/state/settings";

/** The grid's share of the width beside its panel, 1.4 to 1 as before it could be moved; and in px, the narrowest each can
 * go: 420 leaves the 13 columns about 30px each for their labels, 320 the combo table its four columns. */
const STUDY_SPLIT = 1.4 / 2.4;
const STUDY_MIN_MATRIX = 420;
const STUDY_MIN_PANEL = 320;

function subscribeWide(onChange: () => void) {
  if (typeof matchMedia !== "function") return () => {};
  const q = matchMedia(WIDE_QUERY);
  q.addEventListener("change", onChange);
  return () => q.removeEventListener("change", onChange);
}

const isWide = () => typeof matchMedia === "function" && matchMedia(WIDE_QUERY).matches;

/** Whether the panes are side by side: stacked, the panel comes after the range, so what reads before the range can't be in it. */
export function useSplitWide() {
  return useSyncExternalStore(subscribeWide, isWide);
}

export function StudySplit({ children }: { children: [ReactNode, ReactNode] }) {
  const size = useSettings((s) => s.studySplit);
  const save = useSettings((s) => s.set);
  return (
    <ResizableWorkspace
      label="Resize the range and the panel beside it"
      size={size}
      onResize={(s) => save({ studySplit: s })}
      defaultSize={STUDY_SPLIT}
      minStart={STUDY_MIN_MATRIX}
      minEnd={STUDY_MIN_PANEL}
    >
      {children}
    </ResizableWorkspace>
  );
}
