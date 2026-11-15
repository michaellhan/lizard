// How big a preflop solve this device can take (ROADMAP Phase 9, "7-9 players in the browser where memory allows,
// with per-device caps"). The worker names the memory a game's solve needs ("estimate_mb" in its pf_unsolved answer:
// engine/pf_solve.py Spec.estimate_mb, fitted to measured peaks, about 90 MB plus 11.8 KB a tree node a seat) and the
// most it will build in any tab ("max_mb", 2 GB: Pyodide's heap is 32-bit). The page holds a solve to a lower cap a
// device: a quarter of the memory the browser reports (navigator.deviceMemory: Chrome and Edge, rounded down and capped
// at 8 GB), and 1 GB where it reports none (Safari, Firefox) or on a phone or tablet, whose tabs are killed far sooner.

export const CAP_UNKNOWN_MB = 1024;
export const CAP_TOUCH_MB = 768;
export const CAP_MAX_MB = 2048;

export interface DeviceInfo {
  /** navigator.deviceMemory, GB (undefined where the browser doesn't say) */
  memoryGb?: number;
  /** a coarse pointer (a phone or tablet) */
  touch?: boolean;
}

export function deviceInfo(): DeviceInfo {
  if (typeof navigator === "undefined") return {};
  const gb = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  const touch = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  return { ...(typeof gb === "number" && gb > 0 ? { memoryGb: gb } : {}), touch };
}

/** The most memory (MB) a preflop solve may take on this device, and why. */
export function solveCapMb(d: DeviceInfo = deviceInfo()): { mb: number; why: string } {
  if (d.memoryGb !== undefined) {
    const mb = Math.min(CAP_MAX_MB, Math.round((d.memoryGb * 1024) / 4));
    return { mb: d.touch ? Math.min(mb, CAP_TOUCH_MB) : mb, why: `a quarter of the ${d.memoryGb} GB this browser reports${d.touch ? ", at most 768 MB on a touch device" : ""}` };
  }
  if (d.touch) return { mb: CAP_TOUCH_MB, why: "a phone or tablet whose memory the browser doesn't report" };
  return { mb: CAP_UNKNOWN_MB, why: "a browser that doesn't report the device's memory" };
}

/** Over the cap: the words to say instead of offering the solve (null where it fits). */
export function overCap(estimateMb: number | undefined, maxMb: number | undefined, d: DeviceInfo = deviceInfo()): string | null {
  if (typeof estimateMb !== "number") return null;
  const cap = solveCapMb(d);
  const limit = Math.min(cap.mb, typeof maxMb === "number" ? maxMb : CAP_MAX_MB);
  if (estimateMb <= limit) return null;
  const whyLimit = typeof maxMb === "number" && maxMb < cap.mb ? `the ${maxMb.toLocaleString()} MB a browser tab can hold` : `${limit.toLocaleString()} MB on this device (${cap.why})`;
  return `This tree needs about ${Math.round(estimateMb).toLocaleString()} MB to solve, more than ${whyLimit}.`;
}
