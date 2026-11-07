import { Link } from "react-router";
import { ROUTES, type RouteStatus } from "@/app/routes";

const BADGE: Record<RouteStatus, { text: string; cls: string }> = {
  working: { text: "Working", cls: "bg-accent/15 text-accent" },
  partial: { text: "Partial", cls: "bg-act-bet1/15 text-act-bet1" },
  classic: { text: "Engine ready · page on the older gto-solver site", cls: "bg-surface-3 text-muted" },
  planned: { text: "Planned", cls: "bg-surface-3 text-faint" },
};

export function HomePage() {
  return (
    <div className="space-y-8">
      <section className="space-y-3 pt-2">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Study poker at equilibrium.</h1>
        <p className="max-w-2xl text-muted">
          Lizard solves No-Limit Hold'em in your browser — preflop charts, a precomputed flop library, live turn and river solves — and
          labels every number with what produced it and how close to equilibrium it is. No account needed; your data stays on this device unless you sign in to sync it.
        </p>
        <div className="flex flex-wrap gap-2">
          <Link to="/study" className="rounded-md bg-accent px-4 py-2 font-medium text-bg hover:bg-accent-strong">
            Open Study
          </Link>
          <Link to="/library" className="rounded-md border border-border px-4 py-2 hover:bg-surface-2">
            What's precomputed
          </Link>
        </div>
      </section>
      <section aria-label="Areas" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {ROUTES.filter((r) => r.nav).map((r) => (
          <Link key={r.path} to={`/${r.path}`} className="rounded-lg border border-border bg-surface p-4 hover:border-accent/50">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-semibold">{r.label}</h2>
              <span className={`rounded px-2 py-0.5 text-xs ${BADGE[r.status].cls}`}>{BADGE[r.status].text}</span>
            </div>
            <p className="mt-1 text-sm text-muted">{r.summary}</p>
          </Link>
        ))}
      </section>
      <p className="text-sm text-muted">
        Lizard solves no-limit Hold&rsquo;em. For Omaha there&rsquo;s a{" "}
        <Link to="/equity" className="underline">
          PLO4 equity calculator
        </Link>{" "}
        and an{" "}
        <Link to="/plo" className="underline">
          exact heads-up river solve
        </Link>{" "}
        at listed sizes. No earlier PLO street is solved.
      </p>
    </div>
  );
}
