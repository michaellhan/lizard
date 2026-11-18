// A preflop hand in an any-spot drill (pfDrill.ts): a decision on a library spot's preflop line, a hand from the range
// that reaches it, graded by the stored preflop solve. That solve is an equilibrium of a simplified class-level game, not
// a full solve: its badge says so, and a grade under it stops at Inaccuracy. A node is asked once and kept for the page's
// life (the stored solve answers every class of it at once); a node it can't grade by is said in words and passed over.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { PlayingCard } from "@/components/PlayingCard";
import { ProvenanceBadge } from "@/components/ProvenanceBadge";
import { VerdictTag } from "@/components/VerdictTag";
import { CAPPED_WORDS, lossWords, whoOf, whyText, type Grade } from "@/grading/grade";
import { basisOf } from "@/grading/basis";
import { gameLabel, type LibrarySpotIndex } from "@/library/catalog";
import type { LibraryFiles } from "@/library/files";
import { evUnit } from "@/solver/provenance";
import type { Provenance, SolveResult } from "@/solver/types";
import { useSolver } from "@/solver/useSolver";
import { useSettings } from "@/state/settings";
import { addGraded, type Shared } from "./anySession";
import { HandStory } from "./HandStory";
import { Kbd, MixTable } from "./HintReveal";
import { isNextKey, optionFromKey } from "./keys";
import { gradeLive } from "./liveDeal";
import { pfActionLabel, pfDeal, pfDecisions, pfDrillState, pfStory, type PfSpotAt } from "./pfDrill";
import { pfNodeRead } from "./pfGrade";
import { mixOf, type Decision } from "./practice";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** the nodes asked so far, by spot and place on its line, and the ones the solve can't grade by */
const NODES = new Map<string, Promise<SolveResult>>();
const REFUSED = new Map<string, string>();

type Dealt = {
  at: PfSpotAt;
  hole: [string, string];
  mix: Decision["mix"];
  pot: number;
  toCall: number;
  provenance: Provenance;
  node: SolveResult["data"];
};
type State = { st: "dealing" } | { st: "ready"; d: Dealt } | { st: "error"; message: string };
type Picked = { a: number; g: Grade };

/** One preflop hand dealt on the spot, scored in the any-spot session. */
export function PreflopDrill({ files, spot, rng, shared }: { files: LibraryFiles; spot: LibrarySpotIndex; rng: () => number; shared: Shared }) {
  const mode = useSettings((s) => s.mode);
  const getSolver = useSolver();
  const [state, setState] = useState<State>({ st: "dealing" });
  const [picked, setPicked] = useState<Picked | null>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const { skip, next, setSession } = shared;

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const { report } = await files.spot(spot);
        const open = pfDecisions(report.line).filter((at) => !REFUSED.has(`${spot.id}|${at.k}`));
        if (!alive) return;
        if (!open.length) return skip();
        const at = open[Math.floor(rng() * open.length)]!;
        const key = `${spot.id}|${at.k}`;
        let asked = NODES.get(key);
        if (!asked) {
          const client = await getSolver();
          asked = client.solve({ state: pfDrillState(report, at), mode, untimed: true });
          NODES.set(key, asked);
          asked.catch(() => NODES.delete(key));
        }
        const res = await asked;
        if (!alive) return;
        const dealt = pfDeal(res.data, rng);
        const read = dealt ? pfNodeRead(res, at.hero, dealt.hole.join("")) : { why: "No hand reaches this spot in the solve." };
        if ("why" in read) {
          REFUSED.set(key, read.why);
          return skip();
        }
        setState({ st: "ready", d: { at, hole: dealt!.hole, mix: mixOf(read.data), pot: read.data.pot_bb ?? 1.5, toCall: read.data.to_call_bb ?? 0, provenance: read.provenance, node: read.data } });
      } catch (e) {
        if (alive) setState({ st: "error", message: message(e) });
      }
    })();
    return () => {
      alive = false;
    };
  }, [files, spot, rng, getSolver, mode, skip]);

  const d = state.st === "ready" ? state.d : null;
  const choose = useCallback(
    (a: number) => {
      if (!d || picked) return;
      // (graded as Practice grades the same answer: within the model's measured noise, grade.ts pfNoisePct)
      const g = gradeLive({ mix: d.mix, pot: d.pot, basis: basisOf(d.provenance, { res: d.node }) }, a);
      setPicked({ a, g });
      setSession((s) => addGraded(s, g, "preflop", "preflop-solve"));
    },
    [d, picked, setSession],
  );

  useEffect(() => {
    if (picked) nextRef.current?.focus();
  }, [picked]);

  const keyState = useRef({ d, picked, choose, next });
  useLayoutEffect(() => {
    keyState.current = { d, picked, choose, next };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { d, picked, choose, next } = keyState.current;
      const tag = (e.target as HTMLElement | null)?.tagName ?? "";
      if (e.metaKey || e.ctrlKey || e.altKey || /^(INPUT|SELECT|TEXTAREA)$/.test(tag) || e.repeat) return;
      const i = d && !picked ? optionFromKey(e.key, d.mix.map((a) => a.action)) : -1;
      if (i >= 0) choose(i);
      else if (picked && isNextKey(e.key) && (e.key.toLowerCase() === "n" || !/^(BUTTON|A)$/.test(tag))) {
        e.preventDefault();
        next();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (state.st === "dealing") return <p className="panel p-3 text-sm text-muted">Dealing…</p>;
  if (state.st === "error")
    return (
      <p role="alert" className="panel p-3 text-sm text-danger">
        The preflop solve couldn&rsquo;t answer: {state.message}{" "}
        <button type="button" className="underline" onClick={next}>
          Deal again
        </button>
      </p>
    );

  const { at, hole, mix, provenance, toCall } = state.d;
  const label = (row: Decision["mix"][number]) => pfActionLabel(toCall, row);
  return (
    <div className="space-y-4 lg:grid lg:grid-cols-2 lg:items-start lg:gap-4 lg:space-y-0">
      <section aria-label="Your hand" className="space-y-3 panel p-3">
        <p className="text-xs text-muted">
          Preflop · {gameLabel(spot)} · graded by the preflop solve (a simplified model)
        </p>
        <div role="group" aria-label="Your cards" className="flex items-center gap-1">
          <span className="text-xs text-muted">{at.hero} · you</span>
          {hole.map((c) => (
            <PlayingCard key={c} card={c} />
          ))}
        </div>
        <HandStory story={pfStory(at, state.d.node)} />
        <div role="group" aria-label="Your options" className="flex flex-wrap gap-2">
          {mix.map((row, i) => (
            <button
              key={row.action + (row.amount ?? "")}
              type="button"
              disabled={Boolean(picked)}
              aria-pressed={picked ? picked.a === i : undefined}
              onClick={() => choose(i)}
              className={`rounded-md border px-3 py-1.5 text-sm hover:bg-surface-3 disabled:cursor-default ${picked?.a === i ? "border-accent bg-surface-3" : "border-border bg-surface-2"}`}
            >
              <span aria-hidden className="mr-1.5 text-xs text-faint">
                {i + 1}
              </span>
              {label(row)}
            </button>
          ))}
        </div>
      </section>

      {picked && (
        <section aria-label="Answer" className="space-y-2 panel p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <VerdictTag v={picked.g.verdict} />
            <span>
              you took <span className="font-mono">{label(mix[picked.a]!)}</span>
              {picked.g.a !== picked.g.best && (
                <>
                  ; the best was <span className="font-mono">{label(mix[picked.g.best]!)}</span>
                </>
              )}
            </span>
            <ProvenanceBadge p={provenance} />
          </div>
          <p>
            {whyText(
              picked.g,
              mix.map(label),
              mix.map((a) => a.freq),
              whoOf(provenance.source),
            )}
          </p>
          <p className="text-muted">
            {lossWords(picked.g, state.d.pot, evUnit(provenance)) ?? "No EV given up."}
            {picked.g.mixed && " This hand mixes actions here."}
            {picked.g.capped && ` ${picked.g.capWhy ?? CAPPED_WORDS}`}
          </p>
          <MixTable mix={mix} hasEv={mix.every((a) => a.ev !== null)} labelOf={label} chose={mix[picked.a]!.action} unit={evUnit(provenance)} />
          <button ref={nextRef} type="button" onClick={next} className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-bg hover:bg-accent-strong">
            Next hand
            <Kbd>N</Kbd>
          </button>
        </section>
      )}
    </div>
  );
}

/** for tests: forget the nodes asked */
export const forgetPfNodes = () => {
  NODES.clear();
  REFUSED.clear();
};
