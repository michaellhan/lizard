// The Plan page: what you've demonstrated, as what to do next, in order, with the rule that orders it said on the page.
// All of it comes from plan.ts, once, as what's kept is read: state holds the finished plan and not the hands, so nothing
// recounts on a render. Everything is in this browser, with no account. It has a route of its own for that load: every
// hand and decision kept, which Review has no need of, and it stands over Review, Analyze and Practice alike.
import { About } from "@/components/About";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { allSessions } from "@/data/db";
import { listDecisions, listHands } from "@/data/hands";
import { listMistakes } from "@/data/mistakes";
import { SaveDrill } from "@/features/saved/SaveDrill";
import { SaveScenario } from "@/features/saved/SaveScenario";
import { libraryFiles } from "@/features/review/retry";
import type { LibraryFiles } from "@/library/files";
import { Lessons } from "./LessonsPanel";
import { buildPlan, THIN_SHOWN, withLibrary, type DrillStep, type Plan, type PlanStep } from "./plan";

const START = "rounded-md bg-accent px-3 py-1.5 font-medium text-bg hover:bg-accent-strong";
const QUIET = "rounded border border-border px-2 py-1 hover:bg-surface-2";

async function load(): Promise<Plan> {
  const [{ list, damaged }, hands, decisions, sessions] = await Promise.all([listMistakes(), listHands(), listDecisions(), allSessions()]);
  return buildPlan({ now: Date.now(), mistakes: list, damaged, hands, decisions, sessions });
}

export function PlanPage({ files }: { files?: LibraryFiles } = {}) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [failed, setFailed] = useState(false);
  const [more, setMore] = useState(false);
  useEffect(() => {
    let alive = true;
    void load()
      .then((p) => alive && setPlan(p))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  // (the drill on the flop or turn is the library's where it holds the seat; without it the drill stays a session of hands)
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Plan</h1>
      </div>

      {failed ? (
        <p role="alert" className="text-danger">
          Couldn&rsquo;t read this browser&rsquo;s store.
        </p>
      ) : !plan ? (
        <p role="status" className="text-sm text-muted">
          Reading what&rsquo;s kept here&hellip;
        </p>
      ) : (
        <Steps plan={plan} more={more} onMore={() => setMore(true)} />
      )}

      <Lessons />
    </div>
  );
}

function Steps({ plan, more, onMore }: { plan: Plan; more: boolean; onMore: () => void }) {
  const { reviews, leaks, thin, drill, next, first, notes, apart, damaged } = plan;
  // (with no next step, a leak not done is one with nothing to deal: every other kind would be next)
  const stuck = leaks.filter((l) => !l.done).length;
  const shown = more ? thin : thin.slice(0, THIN_SHOWN);
  // (one count down the page, as the rule has it)
  const leakFrom = reviews ? 2 : 1;
  const thinFrom = leakFrom + leaks.length;
  const drillAt = thinFrom + thin.length;
  return (
    <>
      {first ? (
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
      ) : (
        <p role="status" aria-label="Next step" className="text-sm">
          {next ? (
            <>
              <span className="text-muted">Next: </span>
              <Link to={next.to} className="font-medium underline">
                {next.title}
              </Link>
            </>
          ) : stuck ? (
            `Nothing to start: ${stuck === 1 ? "the open leak keeps" : `the ${stuck.toLocaleString()} open leaks keep`} no mix. Forget the grades and grade again.`
          ) : (
            "Every step is done."
          )}
        </p>
      )}

      {!first && (
        <>
          <Part label="Reviews due" empty={!reviews && notes.reviews}>
            {reviews && (
              <ol>
                <Row step={reviews} at={1} next={next} />
              </ol>
            )}
          </Part>
          <Part label="Leaks" empty={!leaks.length && notes.leaks}>
            {leaks.length > 0 && (
              <ol className="space-y-2">
                {leaks.map((s, i) => (
                  <Row key={s.id} step={s} at={leakFrom + i} next={next} />
                ))}
              </ol>
            )}
          </Part>
          <Part label="Too few to read" empty={!thin.length && notes.thin}>
            {thin.length > 0 && (
              <>
                <p className="text-sm text-muted">Not leaks: too few decisions yet.</p>
                <ol className="space-y-2">
                  {shown.map((s, i) => (
                    <Row key={s.id} step={s} at={thinFrom + i} next={next} />
                  ))}
                </ol>
                {shown.length < thin.length && (
                  <button type="button" onClick={onMore} className={QUIET + " text-sm"}>
                    Show {(thin.length - shown.length).toLocaleString()} more
                  </button>
                )}
              </>
            )}
          </Part>
          <Part label="Practice drill" empty={!drill && notes.drill}>
            {drill && (
              <ol>
                <Row step={drill} at={drillAt} next={next} />
              </ol>
            )}
          </Part>
        </>
      )}

      {apart && <p className="text-sm text-muted">{apart}</p>}
      {damaged > 0 && <p className="text-sm text-muted">{damaged.toLocaleString()} kept {damaged === 1 ? "mistake" : "mistakes"} couldn&rsquo;t be read, and {damaged === 1 ? "isn't" : "aren't"} counted.</p>}
    </>
  );
}

/** A part of the plan. One with nothing in it is a line, its note beside its name, so the steps there are stay together. */
function Part({ label, empty, children }: { label: string; empty: string | false | null; children: React.ReactNode }) {
  if (empty)
    return (
      <section aria-label={label} className="text-sm">
        <h2 className="inline font-medium">{label}:</h2> <span className="text-muted">{empty}</span>
      </section>
    );
  return (
    <section aria-label={label} className="space-y-2">
      <h2 className="text-lg font-semibold">{label}</h2>
      {children}
    </section>
  );
}

function Row({ step, at, next }: { step: PlanStep; at: number; next: PlanStep | null }) {
  const isNext = next?.id === step.id;
  return (
    <li aria-label={step.what} aria-current={isNext ? "step" : undefined} className="list-none space-y-1 panel px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted">{at}.</span>
        <span className="font-medium">{step.what}</span>
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
