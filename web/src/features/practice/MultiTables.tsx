// Practice at two to four tables: the row above the score, the tiles (TableTile.tsx), one dock for the table in front, and
// a rail with your last verdict, a row per table and your decisions across them. The Room runs it all and this draws its
// snapshot, so everything here is what a table says it is and each action names the table it's for: a dock's button
// carries its spot's key, and the Room drops a press whose spot has gone. Below `sm` only the table in front is drawn, under
// tabs that stick below the app's header (Shell's, `sticky top-0 z-40`, 49px) for as long as the tables and dock go on, so
// they sit directly in the wrapper that holds both, with the dock stuck to the bottom. There's no pace and no Run it out
// here, and a finished table deals again by itself. How many tables there are is simply how many the Room has (the kept doc
// brings them back), so no setting can say otherwise.
import { useEffect, useRef, useState, type KeyboardEvent, type Ref, type RefObject } from "react";
import { rowKeys } from "@/components/rowKeys";
import { bb, kindOf, pct } from "@/components/actions";
import { GRADE_WAYS, sourcesText, WAY_WORDS, wayFigures } from "@/features/history/history";
import { seatLabel, seatsOf } from "@/poker/seats";
import { useSettings } from "@/state/settings";
import { MAX_TABLES } from "./keep";
import { DecisionView, FallbackMoves, fmt, KeepHand, optionLabel, RangeView, ReviewMistakes, signed, useHandKeys } from "./PracticeParts";
import { PRIZE_UNIT } from "@/solver/provenance";
import { anyHandOnly, INSTANT_FLOPS, isPotDrill, phaseOf, POT_DRILLS, simOf } from "./practice";
import { optionsAt } from "./pfGrade";
import { flopsNote, seatOf, seatsFor, spotOf, type Room, type RoomSnapshot, type RoomTable, type Spot } from "./room";
import { keyOf, type PracticeSession } from "./session";
import { resultLine, Spinner, stateOf, TableTile, verdictLine, type TableState } from "./TableTile";

const CONTROL = "rounded border border-border bg-surface-2 px-1.5 py-1";

/** What a spot deals, above the tiles. (Heads-up, a pot drill or Instant flops has no betting rules in it; any hand may.) */
const spotNote = (spot: Spot, preflopOnly: boolean) =>
  preflopOnly
    ? "Each table plays its preflop and stops as the flop comes. The charts answer it, not a solve."
    : spot === "any"
      ? "Each table plays a whole hand. Preflop is answered from the charts, not solved; later streets are read from the library or solved while you play the other tables, and a flop or turn with five or more players still in is answered by betting rules, not solved."
      : spot === "lib"
        ? "Preflop is played for you from the charts, not solved. Each table is dealt until a heads-up flop the library holds. Flops answer at once; later streets are solved while you play the others."
        : `Preflop is played for you from the charts, not solved. Each table is dealt until ${POT_DRILLS[spot].one}; later streets are read from the library or solved while you play the other tables.`;

/** ms from a key to the change it makes, and from that change to giving focus back if nothing else has changed: longer
 * than a browser's type-ahead holds a word, so B, T, N gets to BTN */
const STEP_MS = 100;
const IDLE_MS = 1500;

/** A select gives focus back once it's set: on one, the page's keys don't work and the next is type-ahead, so C would pick
 * CO, S the SB or Single-raised pots and 3 3-bet pots. Only once it's set, though: an arrow steps a closed select, a change
 * at each press, so a change right after a key stays, and Enter or Escape, on the way up, says you've done. A letter makes
 * a change right after a key too, and nothing says you've done after one, so a change that stays stays for IDLE_MS, and only
 * another change puts that off: a key that changes nothing hasn't done anything to wait for. */
function useLeave() {
  const keyAt = useRef(-Infinity);
  const idle = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(idle.current), []);
  const leave = (select: HTMLSelectElement) => {
    clearTimeout(idle.current);
    if (performance.now() - keyAt.current > STEP_MS) select.blur();
    else idle.current = setTimeout(() => select.blur(), IDLE_MS);
  };
  const keys = {
    onKeyDown: () => {
      keyAt.current = performance.now();
    },
    onKeyUp: (e: KeyboardEvent<HTMLSelectElement>) => {
      if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur();
    },
  };
  return { leave, keys };
}

/** The row above the score: Tables, always, and Spots and Seat from two up, with what they mean and why any is held. */
export function TablesBar({
  room,
  session,
  count,
  stopCost,
  flops,
  pressRef,
}: {
  room: Room;
  session: PracticeSession;
  count: number;
  stopCost: RoomSnapshot["stopCost"];
  flops: RoomSnapshot["flops"];
  pressRef: RefObject<boolean>;
}) {
  const set = useSettings((s) => s.set);
  const { leave, keys } = useLeave();
  const preflopOnly = session.opts.preflopOnly;
  const saved = spotOf(useSettings((s) => s.practiceSpot), anyHandOnly(session.opts), flops.off === null);
  const { exploit, pot } = session.opts;
  const spot = exploit ? (pot ?? "any") : saved;
  const fixedGame = !!session.opts.pushFold || !!session.opts.tournament || !!exploit;
  const seat = seatOf(useSettings((s) => s.practiceSeat), session.players, spot);
  const seats = seatsFor(session.players, spot);
  return (
    <div className="space-y-1 text-sm">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-1.5">
          <span className="text-muted">Tables</span>
          <div
            role="radiogroup"
            aria-label="Tables"
            onKeyDown={(e) =>
              rowKeys("radio", (i) => {
                // (not as a press: the arrows stay here to go on through the row)
                pressRef.current = false;
                room.setTables(i + 1);
              })(e)
            }
            className="inline-flex rounded-md border border-border bg-surface-2 p-0.5"
          >
            {Array.from({ length: MAX_TABLES }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={n === count}
                tabIndex={n === count ? 0 : -1}
                title={n === 1 ? "One table: Table 1's hand goes on here" : `${n} tables at once, one score across them`}
                onClick={() => {
                  pressRef.current = n > 1 && n !== count;
                  room.setTables(n);
                }}
                className={`rounded px-2.5 py-1 ${n === count ? "bg-surface-3 text-text" : "text-muted hover:text-text"}`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
        {count > 1 && (
          <>
            {!fixedGame && (
              <label className="flex items-center gap-1">
                <span className="text-muted">Spots</span>
                <select
                  aria-label="Spots"
                  value={spot}
                  {...keys}
                  onChange={(e) => {
                    set({ practiceSpot: e.target.value as Spot });
                    leave(e.currentTarget);
                  }}
                  title={spot === "any" ? undefined : spot === "lib" ? INSTANT_FLOPS.tip : POT_DRILLS[spot].tip}
                  className={CONTROL}
                >
                  <option value="lib" title={INSTANT_FLOPS.tip} disabled={flops.off !== null}>
                    {INSTANT_FLOPS.label}
                  </option>
                  <option value="any">Any hand</option>
                  {Object.entries(POT_DRILLS).map(([k, d]) => (
                    <option key={k} value={k} title={d.tip} disabled={preflopOnly}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="flex items-center gap-1">
              <span className="text-muted">Seat</span>
              <select
                aria-label="Seat"
                value={seat}
                {...keys}
                onChange={(e) => {
                  set({ practiceSeat: e.target.value });
                  leave(e.currentTarget);
                }}
                className={CONTROL}
              >
                <option value="random">Random</option>
                {seatsOf(session.players).map((p) => (
                  <option key={p} value={p} disabled={!seats.includes(p)}>
                    {seatLabel(p, session.players)}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
      </div>
      {count > 1 && (
        <p className="text-xs text-muted">
          {exploit && isPotDrill(pot)
            ? `Each table deals ${POT_DRILLS[pot].one}, as an exploit session stays in its pot. Seat applies from each table\u2019s next hand.`
            : fixedGame
              ? "Each table deals any hand of this game. Seat applies from each table\u2019s next hand."
              : `${spotNote(spot, preflopOnly)} Spots and Seat apply from each table\u2019s next hand.`}
          {flops.off && !fixedGame && ` ${flopsNote(flops, spot)}`}
          {stopCost === "kills" && " This browser can't stop a solve: tables wait for it to finish."}
        </p>
      )}
    </div>
  );
}

/** The table in front: its options, or what it's waiting on, or what to do where it failed. A failed move is only ever
 * yours to play where it was your spot: an opponent's seat never goes into your decisions. */
function Dock({ room, snap, state, head }: { room: Room; snap: RoomSnapshot; state: TableState; head: Ref<HTMLHeadingElement> }) {
  const { tables, focus, queue, guarded } = snap;
  const t = tables[focus]!;
  const h = t.hand;
  const sim = simOf(h);
  const ph = phaseOf(h, sim);
  const seat = seatLabel(h.hero, h.players);
  const moving = ph.kind === "villain" || ph.kind === "auto" ? ph : null;
  const ready = t.answer;
  const key = t.turnKey ?? "";
  const options = optionsAt(h, ready, sim);
  const next = queue[0];
  const more = queue.filter((i) => i !== focus).length;
  const busy = tables.filter((x) => !x.hand.result && !x.failed && !x.spent).length;
  // (where the spot is, as a next one at the same table can be ready at once, and a line that hasn't changed isn't read out;
  // and a table behind yours, as one you've picked stays in front while it thinks)
  const said = ready
    ? `Table ${focus + 1}: your turn, ${sim.current}, pot ${fmt(sim.pot)}bb`
    : [state.tone === "fail" ? `Table ${focus + 1}: ${state.text.replace(/\.$/, "")}` : "", next === undefined ? "" : `Table ${next + 1}: your turn`].filter(Boolean).join(". ");
  return (
    <>
      {/* (only what you'd act on, as the whole dock read out at each change would run over the next one) */}
      <p role="status" aria-atomic="true" className="sr-only">
        {said}
      </p>
      <section aria-label="Your move" className="sticky bottom-0 z-20 min-h-32 space-y-2 rounded-lg border border-border bg-surface p-3 text-sm">
        {/* (focus only rests here, nothing happens on it: a ring would read as a field to type in) */}
        <h2 ref={head} tabIndex={-1} className="font-medium outline-none!">
          Table {focus + 1} · {ready ? `your turn · ${seat} · ${sim.current} · pot ${fmt(sim.pot)}bb` : state.text}
        </h2>
        {ready && (
          <>
            <div role="group" aria-label="Your options" aria-disabled={guarded || undefined} className={`flex flex-wrap gap-2 ${guarded ? "opacity-50" : ""}`}>
              {options.map((a, i) => (
                <button
                  key={`${focus}|${key}|${a.action}`}
                  type="button"
                  aria-disabled={guarded || undefined}
                  onClick={() => room.choose(focus, key, i)}
                  className="rounded-md border border-border bg-surface-2 px-3 py-1.5 hover:bg-surface-3"
                >
                  {i < 9 && (
                    <span aria-hidden className="mr-1.5 text-xs text-faint">
                      {i + 1}
                    </span>
                  )}
                  {optionLabel(a.action, a.amount_bb)}
                </button>
              ))}
            </div>
            {/* (one line, what waits and no keys below `sm`: as it wrapped it moved the options under your thumb) */}
            <p className="min-h-4 text-xs text-muted">
              {more > 0 && `${more} more waiting`}
              <span className="hidden sm:inline">
                {more > 0 ? " · S next table · " : ""}F fold · C or X check or call · 1&ndash;{Math.min(options.length, 9)} your options
              </span>
            </p>
          </>
        )}
        {(t.failed || t.spent) && (
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className="rounded-md border border-border px-3 py-1.5 hover:bg-surface-2" onClick={() => room.retry(focus)}>
              {t.spent ? "Try again" : "Ask again"}
            </button>
            {t.failed && ph.kind === "hero" && <FallbackMoves hand={h} onMove={(a) => room.ungraded(a, focus)} />}
            {t.failed && moving && (
              <button type="button" className="underline" onClick={() => room.playOn(focus)}>
                Play on: {seatLabel(moving.seat, h.players)} checks or calls (not a solve)
              </button>
            )}
          </div>
        )}
        {!ready && next !== undefined && (
          <p>
            Table {next + 1} is waiting for you ·{" "}
            <button type="button" className="underline" onClick={() => room.skip()}>
              Go (S)
            </button>
          </p>
        )}
        {!ready && next === undefined && state.tone !== "fail" && (
          <p className="flex items-center gap-2 text-muted">
            <Spinner />
            {busy ? `No table needs you yet: working on ${busy} table${busy === 1 ? "" : "s"}.` : "Dealing the next hands…"}
          </p>
        )}
      </section>
    </>
  );
}

/** A row of the rail: a table's results, its last hand, and what graded them. */
function TableRow({ i, t, front }: { i: number; t: RoomTable; front: boolean }) {
  const s = t.stats;
  const last = t.lastHand;
  const unit = t.hand.tournament?.model === "icm" ? PRIZE_UNIT : "bb";
  const split = GRADE_WAYS.filter((w) => s.ways?.[w]);
  return (
    <li aria-label={`Table ${i + 1}`} aria-current={front ? "true" : undefined} className="space-y-0.5 border-t border-border pt-1.5 first:border-t-0 first:pt-0">
      <p className="flex flex-wrap gap-x-2">
        <span className="font-medium">Table {i + 1}</span>
        <span>
          {s.hands} hand{s.hands === 1 ? "" : "s"}
        </span>
        {split.length > 1 ? (
          split.map((w) => (
            <span key={w} className="font-mono">
              {WAY_WORDS[w]}: {wayFigures(w, s.ways![w]!, unit)}
            </span>
          ))
        ) : (
          <>
            {s.n > 0 && <span className="font-mono">{pct(s.ok / s.n, 0)} best or correct</span>}
            {s.ne > 0 && <span className="font-mono">{bb(s.loss / s.ne)}{unit} lost per decision</span>}
          </>
        )}
        {s.played > 0 && !t.hand.tournament && !t.hand.exploit && <span className="font-mono">net {signed(s.net)}bb</span>}
      </p>
      {last && (
        <p className="text-xs" title={last.result.says || undefined}>
          Last hand: #{last.n + 1} · {seatLabel(last.seat, t.hand.players)} · {resultLine(last.result)}
        </p>
      )}
      {/* (none, beside a count: the doc's were unreadable, not that nothing was graded) */}
      {s.n > 0 && <p className="text-xs text-muted">Graded against: {sourcesText(Object.keys(t.sources).length ? t.sources : null)}</p>}
    </li>
  );
}

/** The tables, the dock and the rail (`snap`: the Room's, which the page holds). `active`: its tab is the one shown (its
 * keys work only then). `pressRef`: set by a press above that brings tables up, as what had focus may have gone with it. */
export function MultiTables({ room, snap, active, pressRef }: { room: Room; snap: RoomSnapshot; active: boolean; pressRef: RefObject<boolean> }) {
  const { session, tables, kept, focus, queue, ended } = snap;
  const keepAll = useSettings((s) => s.keepHands);
  const setSettings = useSettings((s) => s.set);
  const [rangeOpen, setRangeOpen] = useState(false);
  const [verdictOpen, setVerdictOpen] = useState(false);
  const states = tables.map((t, i) => stateOf(t, i, queue));
  const front = tables[focus]!;

  // your last verdict, whichever table it was at (a decision at one table, before there were more, was at Table 1)
  const last = session.review.at(-1) ?? null;
  const lastAt = last?.table ?? 1;
  // (a table's range is its last graded decision's: a move after it that nothing graded clears it, and it isn't kept)
  const range = tables[lastAt - 1]?.lastRange;
  const verdict = last && verdictLine(last.d);
  const view = last && (
    <DecisionView d={last.d} players={last.players} title={`Table ${lastAt}, hand ${last.n}, ${last.d.street}`} spot={last}>
      {range && <RangeView key={`${last.d.study}|${range.cls}`} r={range} open={rangeOpen} onToggle={setRangeOpen} />}
    </DecisionView>
  );
  const keptEnded = ended && kept?.key === keyOf(session, ended.hand) ? kept : null;

  // Where a press leaves you: a control that's done would hold focus, and Enter or Space would go to it again, New session
  // with no confirm or a pick where you meant to deal, so focus goes to the dock (a table's Next hand does this at one table).
  const head = useRef<HTMLHeadingElement>(null);
  const toDock = () => head.current?.focus({ preventScroll: true });
  const pick = (i: number) => {
    room.pick(i);
    toDock();
  };
  // (a field too, where Enter started the session: your next key is an option, not a digit for it. Only after a press up
  // there, which also brings the tables up, or they'd open out of sight below the setup: tables coming back by themselves,
  // from a reload or from another page, leave focus and the page where they were.)
  const top = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!pressRef.current) return;
    pressRef.current = false;
    head.current?.focus({ preventScroll: true });
    top.current?.scrollIntoView?.({ block: "start" });
  }, [session.id, tables.length, pressRef]);

  // F, C and X go by what the option is, so they stay put when the order flips; 1–9 by its place; S the next waiting
  // table; Enter or Space deal finished tables now (on a focused control, it's that control's own, and with nothing
  // finished Space still doesn't scroll the page out from under the tiles); K the last finished hand
  useHandKeys(active, (e, tag) => {
    const k = e.key.toLowerCase();
    if (k === "s") return room.skip();
    if (k === "k") {
      if (ended && (!keptEnded || keptEnded.st === "error")) room.keep();
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      if (/^(BUTTON|A|SUMMARY)$/.test(tag)) return;
      e.preventDefault();
      return room.dealFinished();
    }
    if (!front.turnKey) return;
    const options = optionsAt(front.hand, front.answer);
    const kinds = options.map((a) => kindOf(a.action));
    const i = /^[1-9]$/.test(e.key) ? Number(e.key) - 1 : k === "f" ? kinds.indexOf("fold") : k === "c" || k === "x" ? kinds.findIndex((a) => a === "call" || a === "check") : -1;
    if (i >= 0 && i < options.length) room.choose(focus, front.turnKey, i);
  });

  return (
    <div ref={top} className="scroll-mt-14 space-y-4">
      <div role="tablist" aria-label="Tables" onKeyDown={(e) => rowKeys("tab", pick)(e)} className="sticky top-12 z-30 -mx-4 flex gap-1 border-b border-border bg-bg/95 px-4 py-1 text-sm backdrop-blur sm:hidden">
        {tables.map((_, i) => {
          const s = states[i]!;
          return (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={i === focus}
              tabIndex={i === focus ? 0 : -1}
              aria-controls={`practice-table-${i}`}
              aria-label={`Table ${i + 1}: ${s.text}`}
              title={`Table ${i + 1}: ${s.text}`}
              onClick={() => pick(i)}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded px-2 py-1 ${i === focus ? "bg-surface-3 font-medium" : "text-muted"}`}
            >
              {i + 1}
              {s.spin ? <Spinner /> : <span aria-hidden className={`inline-block h-2 w-2 rounded-full ${s.tone === "wait" ? "bg-warn" : s.tone === "fail" ? "bg-danger" : "bg-border"}`} />}
              {s.place > 0 && <span className="rounded-full bg-warn/15 px-1.5 font-mono text-xs text-warn">{s.place}</span>}
            </button>
          );
        })}
      </div>
      {verdict && (
        <div className="space-y-2 sm:hidden">
          <button type="button" aria-expanded={verdictOpen} title={verdict.title} onClick={() => setVerdictOpen(!verdictOpen)} className="w-full rounded-md border border-border px-2 py-1 text-left text-xs">
            {verdict.text}
          </button>
          {verdictOpen && view}
        </div>
      )}

      <div className="space-y-4 lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start lg:gap-4 lg:space-y-0">
        <div className="min-w-0 space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            {tables.map((t, i) => (
              <TableTile key={i} i={i} t={t} state={states[i]!} front={i === focus} onPick={() => pick(i)} onRetry={() => room.retry(i)} />
            ))}
          </div>
          <Dock room={room} snap={snap} state={states[focus]!} head={head} />
        </div>

        <aside aria-label="Your results" className="min-w-0 space-y-3">
          {/* (the phone's opens under its tabs) */}
          {view ? (
            <div className={`hidden sm:block ${queue.includes(focus) ? "opacity-60" : ""}`}>{view}</div>
          ) : (
            <p className="rounded-lg border border-border bg-surface p-3 text-sm text-muted">Each decision is graded here once you act: the verdict, the EV it gave up and the solver&rsquo;s mix, whichever table it was at.</p>
          )}
          <section aria-label="Tables' results" className="rounded-lg border border-border bg-surface p-3 text-sm">
            <h2 className="mb-1 font-medium">Tables</h2>
            <ul className="space-y-1.5">
              {tables.map((t, i) => (
                <TableRow key={i} i={i} t={t} front={i === focus} />
              ))}
            </ul>
          </section>
          {ended && (
            <section aria-label="Last finished hand" className="space-y-1.5 rounded-lg border border-border bg-surface p-3 text-sm">
              <p>
                Last finished: Table {ended.table + 1} · #{ended.hand.n + 1} · {resultLine(ended.hand.result!)}
              </p>
              <KeepHand
                kept={keptEnded}
                all={keepAll}
                onKeep={() => room.keep()}
                onAll={(all) => {
                  setSettings({ keepHands: all });
                  if (all && !keptEnded) room.keep();
                  toDock();
                }}
              />
            </section>
          )}
          {session.review.length > 0 && <ReviewMistakes review={session.review} />}
        </aside>
      </div>
    </div>
  );
}
