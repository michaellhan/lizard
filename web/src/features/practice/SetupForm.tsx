// The New session form: the table's size and stack, your seat, what's played (full hands, preflop only, one kind of pot,
// push/fold or a tournament), in one kind of pot an assumed profile to exploit, the ante, rake and straddle, chips carried
// and your own bet sizes. It holds what's typed until it's submitted, and keeps a setup that can start as a saved scenario.
import { useState } from "react";
import { SaveScenario } from "@/features/saved/SaveScenario";
import { describeSetup, LIMITS, numsOf, setupProblems, SIZE_STREETS, type SizeStreet } from "@/features/solve/setup";
import { MAX_PLAYERS, MIN_PLAYERS, seatLabel, seatsOf } from "@/poker/seats";
import {
  ASSUMED,
  EXPLOIT_PROFILES,
  EXPLOIT_SCOPE,
  EXPLOIT_TABLE,
  exploitNumbers,
  exploitOf,
  isProfile,
  profileName,
  type ExploitProfile,
} from "./exploit";
import { HAND_GROUPS, handFits, handLabel } from "./handFilter";
import { carries, drillTries, hardHand, handWorks, isPotDrill, MAX_STACK, MIN_STACK, POT_DRILLS, PUSH_FOLD_MAX, REBUY, type SessionOptions, type Sizes } from "./practice";
import { flopsLike, TEXTURE_GROUPS, type TextureFilter, type TextureKey } from "./texture";
import { draftOf, readDraft, TournamentFields } from "./TournamentFields";

const setTexture = (f: TextureFilter, key: TextureKey, v: string): TextureFilter =>
  Object.fromEntries(Object.entries({ ...f, [key]: v }).filter(([, x]) => x));

const ON_WORDS = { flop: "read on the flop dealt", cards: "read on your two cards" } as const;

const SIZE_LABEL: Record<SizeStreet, string> = { flop: "Flop bets", turn: "Turn bets", river: "River bets", raise: "Raises" };

export function SetupForm({
  players,
  stack,
  opts,
  tables = 1,
  onEdit,
  onStart,
}: {
  players: number;
  stack: number;
  opts: SessionOptions;
  /** the tables set now: a filter deals at one */
  tables?: number;
  /** you've gone to the form: what's typed here goes if it's drawn again for another session */
  onEdit: () => void;
  onStart: (players: number, stack: number, opts: SessionOptions) => void;
}) {
  const [p, setP] = useState(players);
  const [s, setS] = useState(String(stack));
  const [seat, setSeat] = useState(opts.seat);
  const [play, setPlay] = useState<string>(
    opts.pushFold ? "pushfold" : opts.tournament ? "tournament" : (opts.pot ?? (opts.preflopOnly ? "preflop" : "full")),
  );
  const [profile, setProfile] = useState<ExploitProfile | "">(opts.exploit?.profile ?? "");
  const [draft, setDraft] = useState(() => draftOf(opts.tournament, stack));
  const [stop, setStop] = useState(!!opts.tournament && opts.preflopOnly);
  const [board, setBoard] = useState<TextureFilter>(opts.board ?? {});
  const [hand, setHand] = useState(opts.hand ?? "");
  const [ante, setAnte] = useState(opts.ante ? String(opts.ante) : "");
  const [straddle, setStraddle] = useState(opts.straddle);
  const [carry, setCarry] = useState(opts.carry);
  const [rake, setRake] = useState(opts.rake ? String(opts.rake) : "");
  const [cap, setCap] = useState(opts.rakeCap ? String(opts.rakeCap) : "");
  const [sizeText, setSizeText] = useState<Record<SizeStreet, string>>(
    () => Object.fromEntries(SIZE_STREETS.map((k) => [k, (opts.sizes?.[k] ?? []).join(", ")])) as Record<SizeStreet, string>,
  );
  // (blank: the engine's own; preflop only has no use for them)
  const parsed = SIZE_STREETS.flatMap((k) => (numsOf(sizeText[k]).length ? [[k, numsOf(sizeText[k])] as const] : []));
  const isPF = play === "pushfold";
  const isT = play === "tournament";
  const noFlop = play === "preflop" || isPF || isT;
  const sizes: Sizes | null = parsed.length && !noFlop ? Object.fromEntries(parsed) : null;
  const sizeProblems = sizes ? setupProblems(p, { sizes }) : [];
  // (a seat the table size doesn't have moves)
  const seatOk = seat === "moves" || seat === "random" || seatsOf(p).includes(seat);
  const canCarry =
    carries({
      carry: true,
      seat: seatOk ? seat : "moves",
      preflopOnly: play === "preflop",
      pot: isPotDrill(play) ? play : null,
      pushFold: isPF,
    }) && !isT;
  const n = Number(s);
  const a = ante.trim() === "" ? 0 : Number(ante);
  const anteOk = Number.isFinite(a) && a >= 0 && a <= LIMITS.ante;
  const rk = rake.trim() === "" ? 0 : Number(rake);
  const rc = cap.trim() === "" ? 0 : Number(cap);
  const rakeOk = Number.isFinite(rk) && rk >= 0 && rk <= LIMITS.rakePct && Number.isFinite(rc) && rc >= 0;
  // (a pot-type mode's board filter: the flops of the 22,100 it leaves, none being a filter no flop can meet)
  const boardOn = isPotDrill(play) && Object.values(board).some(Boolean);
  const fits = boardOn ? flopsLike(board).length : null;
  // (the hand filter, as this pot offers it, none being one these flops can't deal)
  const handOn = handWorks(play, hand);
  const handOk = !handOn || fits === 0 || handFits(hand, boardOn ? board : null);
  const hard = handOn && isPotDrill(play) ? hardHand(play, hand) : null;
  const pfOk = !isPF || n <= PUSH_FOLD_MAX;
  const tournament = isT ? readDraft(draft, p, n, MAX_STACK) : null;
  const ok =
    Number.isFinite(n) &&
    n >= MIN_STACK &&
    n <= MAX_STACK &&
    anteOk &&
    (isT || rakeOk) &&
    !sizeProblems.length &&
    fits !== 0 &&
    handOk &&
    pfOk &&
    !tournament?.problems.length;
  // (only a kind of pot can be exploited: exploit.ts)
  const exploit = isPotDrill(play) && profile ? exploitOf(profile) : null;
  const setup: SessionOptions | null = ok
    ? {
        seat: seatOk ? seat : "moves",
        preflopOnly: play === "preflop" || (isT && stop),
        pot: isPotDrill(play) ? play : null,
        ante: a,
        straddle: straddle && p >= 3 && !isT,
        carry: carry && canCarry,
        sizes,
        rake: isT ? 0 : rk,
        rakeCap: rk && !isT ? rc : 0,
        board: boardOn ? board : null,
        ...(handOn ? { hand } : {}),
        ...(isPF ? { pushFold: true } : {}),
        ...(tournament?.value ? { tournament: tournament.value } : {}),
        ...(exploit ? { exploit } : {}),
      }
    : null;
  return (
    <form
      aria-label="New session"
      className="flex flex-wrap items-center gap-2 text-sm"
      onFocus={onEdit}
      onChange={onEdit}
      onSubmit={(e) => {
        e.preventDefault();
        if (setup) onStart(p, n, setup);
      }}
    >
      <label className="flex items-center gap-1">
        <span className="text-muted">Players</span>
        <select
          aria-label="Players"
          value={p}
          onChange={(e) => setP(Number(e.target.value))}
          className="rounded border border-border bg-surface-2 px-1.5 py-1"
        >
          {Array.from({ length: MAX_PLAYERS - MIN_PLAYERS + 1 }, (_, i) => i + MIN_PLAYERS).map((x) => (
            <option key={x} value={x}>
              {x === 2 ? "Heads-up" : `${x}-max`}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-1">
        <span className="text-muted">Stack</span>
        <input
          aria-label="Stack in big blinds"
          type="number"
          min={MIN_STACK}
          max={MAX_STACK}
          step={0.5}
          value={s}
          onChange={(e) => setS(e.target.value)}
          className="w-20 rounded border border-border bg-surface-2 px-1.5 py-1"
        />
        <span className="text-muted">bb</span>
      </label>
      <label className="flex items-center gap-1">
        <span className="text-muted">Your seat</span>
        <select
          aria-label="Your seat"
          value={seatOk ? seat : "moves"}
          onChange={(e) => setSeat(e.target.value)}
          className="rounded border border-border bg-surface-2 px-1.5 py-1"
        >
          <option value="moves">Moves each hand</option>
          <option value="random">Random</option>
          {seatsOf(p).map((x) => (
            <option key={x} value={x}>
              {seatLabel(x, p)}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-1">
        <span className="text-muted">Play</span>
        <select
          aria-label="Play"
          value={play}
          onChange={(e) => {
            setPlay(e.target.value);
            // (the band is what the mode is, so the stack comes down to it)
            if (e.target.value === "pushfold" && !(n <= PUSH_FOLD_MAX)) setS(String(PUSH_FOLD_MAX));
          }}
          title={isPotDrill(play) ? POT_DRILLS[play].tip : undefined}
          className="rounded border border-border bg-surface-2 px-1.5 py-1"
        >
          <option value="full">Full hands</option>
          <option value="preflop">Preflop only</option>
          {Object.entries(POT_DRILLS).map(([k, d]) => (
            <option key={k} value={k} title={d.tip}>
              {d.label}
            </option>
          ))}
          <option value="pushfold" title={`All-in or fold at ${PUSH_FOLD_MAX}bb or less`}>
            Push/fold
          </option>
          <option value="tournament" title="A payout and each seat's stack, answered in chip EV or prize equity">
            Tournament
          </option>
        </select>
      </label>
      <label className="flex items-center gap-1">
        <span className="text-muted">Exploit</span>
        <select
          aria-label="Exploit"
          aria-describedby="exploit-note"
          value={isPotDrill(play) ? profile : ""}
          disabled={!isPotDrill(play)}
          onChange={(e) => setProfile(isProfile(e.target.value) ? e.target.value : "")}
          className="rounded border border-border bg-surface-2 px-1.5 py-1"
        >
          <option value="">No profile: equilibrium</option>
          {EXPLOIT_PROFILES.map((k) => (
            <option key={k} value={k}>
              {profileName(k)} (assumed)
            </option>
          ))}
        </select>
      </label>
      <p id="exploit-note" className={`text-xs text-muted ${isPotDrill(play) ? "basis-full" : ""}`}>
        {exploit
          ? `${profileName(exploit.profile)}: ${exploitNumbers(exploit)}. ${ASSUMED} You're graded against the best response to these numbers, never against equilibrium, and the answers are solved live, so each takes a few seconds. ${EXPLOIT_SCOPE} ${EXPLOIT_TABLE}`
          : isPotDrill(play)
            ? "Pick a profile to be graded against the best response to it, in place of equilibrium."
            : "Needs a pot drill under Play."}
      </p>
      {isPF && (
        <p role={pfOk ? undefined : "alert"} className={`basis-full text-xs ${pfOk ? "text-muted" : "text-danger"}`}>
          {pfOk ? "" : `Push/fold is ${MIN_STACK} to ${PUSH_FOLD_MAX}bb: bring the stack down. `}
          The engine jams or folds first in at {PUSH_FOLD_MAX}bb or less, and Practice&rsquo;s tables start at {MIN_STACK}bb. Facing a jam
          you call or fold. The answers are the push/fold model, an equilibrium by hand class with no EVs, so a decision is graded by how
          often it plays your hand. An all-in runs out. A stack under {MIN_STACK}bb is a seat&rsquo;s own, under Tournament.
        </p>
      )}
      {isT && (
        <TournamentFields
          draft={draft}
          onDraft={setDraft}
          stop={stop}
          onStop={setStop}
          players={p}
          stack={s}
          problems={tournament?.problems ?? []}
        />
      )}
      {isPotDrill(play) && (
        <fieldset className="flex basis-full flex-wrap items-center gap-2">
          <legend className="sr-only">Flop in {POT_DRILLS[play].label.toLowerCase()}</legend>
          <span className="text-muted">Flop</span>
          {TEXTURE_GROUPS.map((g) => (
            <select
              key={g.key}
              aria-label={`Flop: ${g.label}`}
              title={g.label}
              value={board[g.key] ?? ""}
              onChange={(e) => setBoard(setTexture(board, g.key, e.target.value))}
              className="rounded border border-border bg-surface-2 px-1.5 py-1"
            >
              <option value="">{`${g.label}: any`}</option>
              {Object.entries(g.values).map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
          ))}
          {fits !== null && (
            <span role={fits ? "status" : "alert"} className={`text-xs ${fits ? "text-muted" : "text-danger"}`}>
              {fits ? `${fits.toLocaleString()} of 22,100 flops fit, at one table.` : "No flop fits these: widen them."}
            </span>
          )}
        </fieldset>
      )}
      {isPotDrill(play) && (
        <div className="flex basis-full flex-wrap items-center gap-2">
          <label className="flex items-center gap-1">
            <span className="text-muted">Hands</span>
            <select
              aria-label="Hands"
              aria-describedby="hands-note"
              value={handOn ? hand : ""}
              onChange={(e) => setHand(e.target.value)}
              className="rounded border border-border bg-surface-2 px-1.5 py-1"
            >
              <option value="">Any hand</option>
              {HAND_GROUPS.map((g) => (
                <optgroup key={g.label} label={`${g.label}: ${ON_WORDS[g.on]}`}>
                  {g.options
                    .filter((o) => handWorks(play, o.key))
                    .map((o) => (
                      <option key={o.key} value={o.key}>
                        {o.label}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </label>
          <p id="hands-note" className="min-w-0 flex-1 text-xs text-muted">
            {handOn
              ? `${handLabel(hand)}: ${ON_WORDS[HAND_GROUPS.find((g) => g.options.some((o) => o.key === hand))?.on ?? "flop"]}, at one table. This only picks what you're dealt: each decision is graded as any other hand's, against the strategy for every hand you could hold there, not one fitted to these hands.${hard ? ` Rare in ${POT_DRILLS[play].label.toLowerCase()}: on the 6-max 100bb charts about 1 deal in ${hard.toLocaleString("en-US")} gets here at the hardest seat, so the ${drillTries(play).toLocaleString("en-US")} deals can run out.` : ""}`
              : `Made hands and draws are read on the flop dealt, hand classes on your two cards.${isPotDrill(play) && HAND_GROUPS.some((g) => g.options.some((o) => !handWorks(play, o.key))) ? " Hands this pot almost never reaches aren't listed." : ""}`}
          </p>
          {handOn && tables > 1 && (
            <p role="status" className="basis-full text-xs text-danger">
              {`${tables} tables are set, and hands are filtered at one table only: above it they aren't.`}
            </p>
          )}
          {!handOk && (
            <p role="alert" className="basis-full text-xs text-danger">
              {`No ${handLabel(hand)} turned up on these flops: widen them or pick other hands.`}
            </p>
          )}
        </div>
      )}
      <label className="flex items-center gap-1" title={`Each seat's ante, 0–${LIMITS.ante}bb`}>
        <span className="text-muted">Ante</span>
        <input
          aria-label="Ante"
          type="number"
          inputMode="decimal"
          min={0}
          max={LIMITS.ante}
          step="any"
          placeholder="0"
          value={ante}
          onChange={(e) => setAnte(e.target.value)}
          aria-invalid={!anteOk}
          className="w-16 rounded border border-border bg-surface-2 px-1.5 py-1"
        />
        <span className="text-muted">bb</span>
      </label>
      <label
        className="flex items-center gap-1"
        title={
          isT
            ? "A tournament has no rake"
            : `Taken from pots that see a flop, 0–${LIMITS.rakePct}% of the pot, capped in bb (blank: no cap)`
        }
      >
        <span className="text-muted">Rake</span>
        <input
          aria-label="Rake"
          type="number"
          inputMode="decimal"
          min={0}
          max={LIMITS.rakePct}
          step="any"
          placeholder="0"
          value={rake}
          onChange={(e) => setRake(e.target.value)}
          aria-invalid={!rakeOk}
          disabled={isT}
          className="w-14 rounded border border-border bg-surface-2 px-1.5 py-1"
        />
        <span className="text-muted">% cap</span>
        <input
          aria-label="Rake cap"
          type="number"
          inputMode="decimal"
          min={0}
          step="any"
          placeholder="none"
          value={cap}
          onChange={(e) => setCap(e.target.value)}
          aria-invalid={!rakeOk}
          disabled={isT}
          className="w-14 rounded border border-border bg-surface-2 px-1.5 py-1"
        />
        <span className="text-muted">bb</span>
      </label>
      <label
        className="flex items-center gap-1.5"
        title={
          isT
            ? "A tournament has no straddle"
            : p < 3
              ? "A straddle needs 3 or more players"
              : "A 2bb straddle from the first seat, acting last preflop"
        }
      >
        <input
          type="checkbox"
          aria-label="Straddle"
          checked={straddle && p >= 3 && !isT}
          disabled={p < 3 || isT}
          onChange={(e) => setStraddle(e.target.checked)}
        />
        <span className="text-muted">Straddle</span>
      </label>
      <label
        className="flex items-center gap-1.5"
        title={
          canCarry
            ? `A ring game: each player's chips carry to the next hand, a seat under ${REBUY * 100}% of the stack rebuying to it`
            : "Chips carry in full hands with your seat moving each hand"
        }
      >
        <input
          type="checkbox"
          aria-label="Carry chips"
          checked={carry && canCarry}
          disabled={!canCarry}
          onChange={(e) => setCarry(e.target.checked)}
        />
        <span className="text-muted">Carry chips</span>
      </label>
      <button type="submit" disabled={!ok} className="rounded border border-border px-2.5 py-1 hover:bg-surface-2 disabled:opacity-40">
        New session
      </button>
      <SaveScenario setup={setup && { players: p, stack: n, opts: setup }} />
      <details className="basis-full" open={!!opts.sizes}>
        <summary className="cursor-pointer text-muted">Your own bet sizes{sizes ? `: ${describeSetup({ sizes }).join(", ")}` : ""}</summary>
        <p className="mt-1 text-xs text-muted">
          Postflop, in % of the pot, up to {LIMITS.sizes} a street, as on the Solve page: the solver&rsquo;s tree, your options and the
          opponents&rsquo; bets use them from the flop on. The flop library answers only where its tree has the same sizes; otherwise the
          flop is solved live. Blank: the engine&rsquo;s own.
        </p>
        <div className="mt-1 grid gap-2 sm:grid-cols-2">
          {SIZE_STREETS.map((k) => (
            <label key={k} className="flex items-center gap-2">
              <span className="w-20 shrink-0 text-muted">{SIZE_LABEL[k]}</span>
              <input
                aria-label={SIZE_LABEL[k]}
                placeholder="e.g. 33, 75"
                value={sizeText[k]}
                disabled={noFlop}
                onChange={(e) => setSizeText({ ...sizeText, [k]: e.target.value })}
                className="min-w-0 flex-1 rounded border border-border bg-surface-2 px-1.5 py-1"
              />
              <span className="text-muted">%</span>
            </label>
          ))}
        </div>
        {sizeProblems.length > 0 && (
          <p role="alert" className="mt-1 text-xs text-danger">
            {sizeProblems.join("; ")}
          </p>
        )}
      </details>
    </form>
  );
}
