import { Link } from "react-router";
import { useRuntime } from "@/solver/runtime";

const TONE: Record<string, string> = {
  idle: "bg-surface-3 text-muted",
  booting: "bg-warn/15 text-warn",
  ready: "bg-accent/15 text-accent",
  busy: "bg-accent/25 text-accent",
  failed: "bg-danger/15 text-danger",
};

const LABEL: Record<string, string> = {
  idle: "Engine idle",
  booting: "Engine starting",
  ready: "Engine ready",
  busy: "Solving",
  failed: "Engine error",
};

export function EngineStatusPill() {
  const status = useRuntime((s) => s.status);
  const threads = status.setup?.threads;
  return (
    <Link
      to="/engine"
      className={`hidden rounded-full px-2.5 py-1 text-xs font-medium sm:inline-block ${TONE[status.phase] ?? TONE.idle}`}
      title={status.message ?? status.error ?? ""}
    >
      {LABEL[status.phase]}
      {status.phase !== "idle" && threads ? ` · ${threads} thread${threads === 1 ? "" : "s"}` : ""}
    </Link>
  );
}
