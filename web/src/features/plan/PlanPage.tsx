// The plan, now part of Review: what you've demonstrated, as what to do next, in order (the leaks, the rows too few to
// read, a Practice drill), with the 12 lessons beside it on that page. All of it comes from plan.ts, once, as what's kept
// is read: state holds the finished plan and not the hands, so nothing recounts on a render. Everything is in this
// browser, with no account. Review's own Due now box says what's due, so the plan's reviews step isn't shown here, and a
// part with nothing in it isn't shown at all. /plan, its old address, goes to Review.
import { About } from "@/components/About";
import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router";
import { allSessions } from "@/data/db";
import { listDecisions, listHands } from "@/data/hands";
import { listMistakes } from "@/data/mistakes";
import { SaveDrill } from "@/features/saved/SaveDrill";
import { SaveScenario } from "@/features/saved/SaveScenario";
import { libraryFiles } from "@/features/review/retry";
import type { LibraryFiles } from "@/library/files";
import { buildPlan, THIN_SHOWN, withLibrary, type DrillStep, type Plan, type PlanFirst, type PlanStep } from "./plan";

const START = "rounded-md bg-accent px-3 py-1.5 font-medium text-bg hover:bg-accent-strong";
const QUIET = "rounded border border-border px-2 py-1 hover:bg-surface-2";

async function load(): Promise<Plan> {
  const [{ list, damaged }, hands, decisions, sessions] = await Promise.all([listMistakes(), listHands(), listDecisions(), allSessions()]);
  return buildPlan({ now: Date.now(), mistakes: list, damaged, hands, decisions, sessions });
}

/** The plan, built once as the page opens; the drill on the flop or turn is the library's where it holds the seat. */
export function usePlan(files?: LibraryFiles): { plan: Plan | null; failed: boolean } {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    void load()
      .then((p) => alive && setPlan(p))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  // (without the library the drill stays a session of hands)
  const street = plan?.drill?.street;
  useEffect(() => {
    if (street !== "flop" && street !== "turn") return;
    let alive = true;
    void (async () => {
      const { spots } = await (await (files ? Promise.resolve(files) : libraryFiles())).index();
      if (alive) setPlan((p) => p && withLibrary(p, spots));
    })().catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [street, files]);
  return { plan, failed };
}

/** /plan's old address: the plan is on Review now. */
export function PlanPage() {
  return <Navigate to="/review" replace />;
}

/** What to do first where there's no step to give, with where it's done. */
export function StartHere({ first }: { first: PlanFirst }) {
  return (
    <section aria-label="Start here" className="space-y-2 panel p-3 text-sm">
      <h2 className="font-medium">Start here</h2>
      <p>{first.text}</p>
      <div className="flex flex-wrap gap-2">
        {first.links.map((l, i) => (
          <Link key={l.to} to={l.to} className={i ? QUIET : START}>
            {l.label}
          </Link>
        ))}
      </div>
    </section>
  );
}

/** The plan's steps past the reviews: each part only where it has a step, one count down them. */
export function PlanSteps({ plan }: { plan: Plan }) {
  const { leaks, thin, drill, next, apart } = plan;
  const [more, setMore] = useState(false);
  // (with no next step, a leak not done is one with nothing to deal: every other kind would be next)
  const stuck = next ? 0 : leaks.filter((l) => !l.done).length;
  const shown = more ? thin : thin.slice(0, THIN_SHOWN);
  const thinFrom = 1 + leaks.length;
  const drillAt = thinFrom + thin.length;
  // (a count for one step counts nothing)
  const one = drillAt === (drill ? 1 : 2);
  return (
    <>
      {leaks.length > 0 && (
        <Part label="Leaks">
          {stuck > 0 && (
            <p className="text-sm text-muted">
              Nothing to start: {stuck === 1 ? "the open leak keeps" : `the ${stuck.toLocaleString()} open leaks keep`} no mix. Forget the grades and grade again.
            </p>
          )}
          <ol className="space-y-2">
            {leaks.map((s, i) => (
              <Row key={s.id} step={s} at={one ? null : 1 + i} next={next} />
            ))}
          </ol>
        </Part>
      )}
      {thin.length > 0 && (
        <Part label="Too few to read">
          <p className="text-sm text-muted">Not leaks: too few decisions yet.</p>
          <ol className="space-y-2">
            {shown.map((s, i) => (
              <Row key={s.id} step={s} at={one ? null : thinFrom + i} next={next} />
            ))}
          </ol>
          {shown.length < thin.length && (
            <button type="button" onClick={() => setMore(true)} className={QUIET + " text-sm"}>
              Show {(thin.length - shown.length).toLocaleString()} more
            </button>
          )}
        </Part>
      )}
      {drill && (
        <Part label="Practice drill">
          <ol>
            <Row step={drill} at={one ? null : drillAt} next={next} />
          </ol>
        </Part>
      )}
      {apart && <p className="text-sm text-muted">{apart}</p>}
    </>
  );
}

function Part({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section aria-label={label} className="space-y-2">
      <h2 className="text-lg font-semibold">{label}</h2>
      {children}
    </section>
  );
}

function Row({ step, at, next }: { step: PlanStep; at: number | null; next: PlanStep | null }) {
  const isNext = next?.id === step.id;
  return (
    <li aria-label={step.what} aria-current={isNext ? "step" : undefined} className="list-none space-y-1 panel px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        {at !== null && <span className="text-muted tabular-nums">{at}.</span>}
        {/* (a step whose link says what it is, as a drill's does, says it once) */}
        {step.what !== step.title && <span className="font-medium">{step.what}</span>}
        {step.done && <span className="rounded border border-border px-1.5 py-0.5 text-xs">Done</span>}
        <span className="flex-1" />
        <span className="flex flex-wrap items-center gap-2">
          <Link to={step.to} className={isNext ? START : QUIET}>
            {step.title}
          </Link>
          {step.kind === "thin" && (
            <Link to={step.also.to} className={QUIET}>
              {step.also.label}
            </Link>
          )}
          {step.kind === "drill" && <KeepDrill step={step} />}
        </span>
      </div>
      {step.says[0] && <p className="text-muted">{step.says[0]}</p>}
      {step.progress && <p>{step.progress}</p>}
      {step.says.length > 1 && (
        <About label="Details">
          {step.says.slice(1).map((x) => (
            <p key={x}>{x}</p>
          ))}
        </About>
      )}
    </li>
  );
}

/** The drill as settings kept on the Saved page, with its link: a table as a scenario, a library drill as a drill. */
function KeepDrill({ step: { target } }: { step: DrillStep }) {
  return target.kind === "setup" ? <SaveScenario setup={target.setup} /> : <SaveDrill kind="library" to={target.to} about={target.about} />;
}
