import { Link } from "react-router";

/** The four main pages, each with what it's for in a line. */
const MAIN: { path: string; label: string; blurb: string; cta: string }[] = [
  { path: "study", label: "Study", blurb: "Equilibrium strategy for any spot.", cta: "Open Study" },
  { path: "practice", label: "Practice", blurb: "Play hands; every decision graded.", cta: "Play a hand" },
  { path: "analyze", label: "Analyze", blurb: "Import hand histories, find lost EV.", cta: "Import hands" },
  { path: "solve", label: "Solve", blurb: "Solve your own spot.", cta: "Set up a spot" },
];

export function HomePage() {
  return (
    <div className="space-y-8">
      <section className="space-y-3 pt-2">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Study poker at equilibrium.</h1>
        <p className="max-w-2xl text-muted">
          A No-Limit Hold&rsquo;em solver and trainer in your browser. No account; your data stays on this device.
        </p>
      </section>
      <section aria-label="Main pages" className="grid gap-3 sm:grid-cols-2">
        {MAIN.map((m) => (
          <Link key={m.path} to={`/${m.path}`} className="group panel p-5 hover:border-accent/50">
            <h2 className="text-lg font-semibold">{m.label}</h2>
            <p className="mt-1 text-sm text-muted">{m.blurb}</p>
            <span className="mt-3 inline-block text-sm text-accent group-hover:underline">{m.cta} →</span>
          </Link>
        ))}
      </section>
    </div>
  );
}
