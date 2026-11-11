import { Link } from "react-router";
import { MORE } from "@/app/routes";

/** The four main pages, each with what it's for in a line. */
const MAIN: { path: string; label: string; blurb: string; cta: string }[] = [
  { path: "study", label: "Study", blurb: "Look up the equilibrium strategy for any spot, hand by hand, preflop to river.", cta: "Open Study" },
  { path: "practice", label: "Practice", blurb: "Play hands against equilibrium opponents. Every decision you make is graded.", cta: "Play a hand" },
  { path: "analyze", label: "Analyze", blurb: "Paste or drop your hand histories and see where you lost EV.", cta: "Import hands" },
  { path: "solve", label: "Solve", blurb: "Set up your own spot (stacks, ranges, bet sizes, rake) and solve it.", cta: "Set up a spot" },
];

export function HomePage() {
  return (
    <div className="space-y-8">
      <section className="space-y-3 pt-2">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Study poker at equilibrium.</h1>
        <p className="max-w-2xl text-muted">
          A No-Limit Hold&rsquo;em solver and trainer that runs in your browser. Every number says where it came from. No account
          needed, and your data stays on this device.
        </p>
      </section>
      <section aria-label="Main pages" className="grid gap-3 sm:grid-cols-2">
        {MAIN.map((m) => (
          <Link key={m.path} to={`/${m.path}`} className="group rounded-lg border border-border bg-surface p-5 hover:border-accent/50">
            <h2 className="text-lg font-semibold">{m.label}</h2>
            <p className="mt-1 text-sm text-muted">{m.blurb}</p>
            <span className="mt-3 inline-block text-sm text-accent group-hover:underline">{m.cta} →</span>
          </Link>
        ))}
      </section>
      <section aria-label="More tools" className="space-y-2">
        <h2 className="text-sm font-semibold text-muted">More</h2>
        <ul className="grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
          {MORE.map((m) => (
            <li key={m.path} className="text-sm">
              <Link to={`/${m.path}`} className="underline decoration-border underline-offset-2 hover:decoration-accent">
                {m.label}
              </Link>{" "}
              <span className="text-faint">· {m.blurb}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
