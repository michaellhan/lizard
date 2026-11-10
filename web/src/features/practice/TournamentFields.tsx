// A tournament session's setup on the New session form: what the answers are in, the prizes left, each seat's chips and the
// other tables, and KO or PKO bounties. It's what the Tournaments page sets up, as far as Practice can play it: every seat
// starts with the same bounty (played out, a bounty follows its player, and a PKO's grows), and no mystery bounties, whose
// envelopes a session has no draw for.
import { LIMITS } from "@/features/solve/setup";
import { PAYOUT_PRESETS, parsePayouts, pastedPayouts, STAGE_PRESETS, stageAnte, tournamentProblems, type StagePreset } from "@/features/tournaments/tournament";
import { seatLabel, seatsOf } from "@/poker/seats";
import { PUSH_FOLD_MAX, type TournamentOptions } from "./practice";

/** A seat's fewest chips: the blinds and something behind. The engine answers to 1bb, but a hand with a seat all-in for its
 * blind has little to practise. */
export const T_MIN_STACK = 2;

/** What's typed: blank seats have the table's stack. */
export interface TournamentDraft {
  model: TournamentOptions["model"];
  payouts: string;
  stacks: Record<string, string>;
  others: string;
  avg: string;
  /** "" for none */
  bounty: "" | "ko" | "pko";
  /** every seat's bounty to start, and the other tables' average (blank: the same) */
  each: string;
  bountyField: string;
}

export const draftOf = (t: TournamentOptions | undefined, stack: number): TournamentDraft => ({
  model: t?.model ?? "icm",
  payouts: (t?.payouts ?? [50, 30, 20]).join(", "),
  stacks: Object.fromEntries(Object.entries(t?.stacks ?? {}).filter(([, v]) => v !== stack).map(([p, v]) => [p, String(v)])),
  others: t?.field ? String(t.field.players) : "",
  avg: t?.field ? String(t.field.avg) : "",
  bounty: t?.bounty?.format ?? "",
  each: t?.bounty ? String(Math.max(...Object.values(t.bounty.seats))) : "",
  bountyField: t?.bounty ? String(t.bounty.field) : "",
});

/** The draft as a session's options at this table, or what's wrong with it, in words. */
export function readDraft(d: TournamentDraft, players: number, stack: number, maxStack: number): { value: TournamentOptions | null; problems: string[] } {
  const problems: string[] = [];
  const seats = seatsOf(players);
  const stacks = Object.fromEntries(seats.map((p) => [p, (d.stacks[p] ?? "").trim() === "" ? stack : Number(d.stacks[p])]));
  for (const p of seats) if (!(stacks[p]! >= T_MIN_STACK && stacks[p]! <= Math.min(maxStack, LIMITS.stack[1]))) problems.push(`${seatLabel(p, players)}'s stack must be ${T_MIN_STACK}–${maxStack}bb`);
  if (d.model === "chips") return problems.length ? { value: null, problems } : { value: { model: "chips", stacks }, problems };
  const payouts = parsePayouts(d.payouts);
  const others = d.others.trim() === "" ? 0 : Number(d.others);
  const field = others > 0 ? { players: others, avg: Number(d.avg) } : undefined;
  if (payouts.length < 2) problems.push("ICM needs two or more prizes. With one prize chips are prizes, which is Chip EV");
  problems.push(...tournamentProblems(players, { payouts, ...(field ? { field } : {}) }));
  let bounty: TournamentOptions["bounty"];
  if (d.bounty) {
    const each = Number(d.each);
    const avg = d.bountyField.trim() === "" ? each : Number(d.bountyField);
    if (!(d.each.trim() !== "" && Number.isFinite(each) && each > 0)) problems.push("each seat's bounty must be more than 0, in the prizes' units");
    else if (!(Number.isFinite(avg) && avg >= 0)) problems.push("the other tables' average bounty must be 0 or more");
    else bounty = { format: d.bounty, seats: Object.fromEntries(seats.map((p) => [p, each])), field: avg };
  }
  return problems.length ? { value: null, problems } : { value: { model: "icm", stacks, payouts, ...(field ? { field } : {}), ...(bounty ? { bounty } : {}) }, problems };
}

/** A stage of an MTT as a draft: the table's stack is the biggest, the seats with fewer chips have their own. */
export function stageDraft(st: StagePreset): { players: number; stack: number; ante: number; draft: TournamentDraft } {
  const top = Math.max(...st.stacks);
  const seats = seatsOf(st.players);
  return {
    players: st.players,
    stack: top,
    ante: stageAnte(st.players),
    draft: {
      model: "icm",
      payouts: st.payouts.join(", "),
      stacks: Object.fromEntries(seats.flatMap((p, i) => (st.stacks[i] !== top ? [[p, String(st.stacks[i])]] : []))),
      others: st.field ? String(st.field.players) : "",
      avg: st.field ? String(st.field.avg) : "",
      bounty: "",
      each: "",
      bountyField: "",
    },
  };
}

const INPUT = "rounded border border-border bg-surface-2 px-1.5 py-1";
const PRESETS = PAYOUT_PRESETS.filter((p) => p.payouts.length > 1);

export function TournamentFields({
  draft,
  onDraft,
  stop,
  onStop,
  players,
  stack,
  problems,
  onStage,
  playOut = false,
}: {
  draft: TournamentDraft;
  onDraft: (d: TournamentDraft) => void;
  /** hands stop as the preflop closes */
  stop: boolean;
  onStop: (v: boolean) => void;
  players: number;
  stack: string;
  problems: string[];
  /** set up a stage of an MTT: the table, the stacks, the ante and the prizes at once */
  onStage?: (st: StagePreset) => void;
  /** the tournament is played out (Play it out) */
  playOut?: boolean;
}) {
  const icm = draft.model === "icm";
  const set = (o: Partial<TournamentDraft>) => onDraft({ ...draft, ...o });
  return (
    <fieldset className="flex basis-full flex-wrap items-center gap-2">
      <legend className="sr-only">Tournament</legend>
      {onStage && (
        <select
          aria-label="Stage"
          title="Sets the table, each seat's chips, a 1bb big-blind ante, the prizes left and the other tables at once (Lizard's own shapes, not any site's)"
          value=""
          onChange={(e) => {
            const st = STAGE_PRESETS.find((x) => x.name === e.target.value);
            if (st) onStage(st);
          }}
          className={INPUT}
        >
          <option value="">A stage…</option>
          {STAGE_PRESETS.map((st) => (
            <option key={st.name} value={st.name} title={st.about}>
              {st.name}
            </option>
          ))}
        </select>
      )}
      <label className="flex items-center gap-1">
        <span className="text-muted">Answers in</span>
        <select aria-label="Answers in" value={draft.model} onChange={(e) => set({ model: e.target.value as TournamentDraft["model"] })} className={INPUT}>
          <option value="icm">Prize equity (ICM)</option>
          <option value="chips">Chip EV</option>
        </select>
      </label>
      {icm && (
        <>
          <label className="flex items-center gap-1" title="The prizes still to be paid, first place first, in any unit. A pasted payout table (1st $10,000, 4-6 $2,000) is read place by place.">
            <span className="text-muted">Prizes left</span>
            <input
              aria-label="Prizes left"
              value={draft.payouts}
              onChange={(e) => set({ payouts: e.target.value })}
              onPaste={(e) => {
                const t = pastedPayouts(e.clipboardData.getData("text"));
                if (t === null) return;
                e.preventDefault();
                set({ payouts: t });
              }}
              className={`w-44 ${INPUT}`} />
          </label>
          <select aria-label="Prize shapes" value="" onChange={(e) => e.target.value && set({ payouts: e.target.value })} className={INPUT}>
            <option value="">Or a shape</option>
            {PRESETS.map((p) => (
              <option key={p.name} value={p.payouts.join(", ")}>
                {p.name}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1" title="The players at other tables: blank for none">
            <span className="text-muted">Others</span>
            <input aria-label="Players at other tables" type="number" min={0} step={1} placeholder="0" value={draft.others} onChange={(e) => set({ others: e.target.value })} className={`w-16 ${INPUT}`} />
          </label>
          {draft.others.trim() !== "" && Number(draft.others) > 0 && (
            <label className="flex items-center gap-1">
              <span className="text-muted">Their average</span>
              <input aria-label="Their average stack" type="number" min={1} step="any" value={draft.avg} onChange={(e) => set({ avg: e.target.value })} className={`w-16 ${INPUT}`} />
              <span className="text-muted">bb</span>
            </label>
          )}
          <label className="flex items-center gap-1" title="KO: a player out pays their whole bounty to whoever knocked them out. PKO: half of it, the other half onto the taker's own bounty.">
            <span className="text-muted">Bounties</span>
            <select aria-label="Bounties" value={draft.bounty} onChange={(e) => set({ bounty: e.target.value as TournamentDraft["bounty"] })} className={INPUT}>
              <option value="">None</option>
              <option value="ko">KO</option>
              <option value="pko">PKO</option>
            </select>
          </label>
          {draft.bounty && (
            <>
              <label className="flex items-center gap-1" title="Every seat's bounty to start, in the prizes' units">
                <span className="text-muted">Each</span>
                <input aria-label="Each seat's bounty" type="number" min={0} step="any" value={draft.each} onChange={(e) => set({ each: e.target.value })} className={`w-16 ${INPUT}`} />
              </label>
              <label className="flex items-center gap-1" title="The other tables' average bounty, which a player from another table brings: blank for the same">
                <span className="text-muted">Others&rsquo; bounty</span>
                <input aria-label="The other tables' average bounty" type="number" min={0} step="any" placeholder={draft.each} value={draft.bountyField} onChange={(e) => set({ bountyField: e.target.value })} className={`w-16 ${INPUT}`} />
              </label>
            </>
          )}
        </>
      )}
      <label className="flex items-center gap-1.5" title="Each hand stops as the preflop closes">
        <input type="checkbox" aria-label="Stop at the flop" checked={stop} onChange={(e) => onStop(e.target.checked)} />
        <span className="text-muted">Stop at the flop</span>
      </label>
      <div className="flex basis-full flex-wrap items-center gap-2">
        <span className="text-muted">Stacks</span>
        {seatsOf(players).map((p) => (
          <label key={p} className="flex items-center gap-1">
            <span className="text-muted">{seatLabel(p, players)}</span>
            <input
              aria-label={`Stack at ${seatLabel(p, players)}`}
              type="number"
              inputMode="decimal"
              min={T_MIN_STACK}
              step="any"
              placeholder={stack}
              value={draft.stacks[p] ?? ""}
              onChange={(e) => set({ stacks: { ...draft.stacks, [p]: e.target.value } })}
              className={`w-16 ${INPUT}`}
            />
          </label>
        ))}
        <span className="text-muted">bb, blank for the Stack above</span>
      </div>
      {problems.length > 0 && (
        <p role="alert" className="basis-full text-xs text-danger">
          {problems.join("; ")}
        </p>
      )}
      <p className="basis-full text-xs text-muted">
        {playOut
          ? "The first hand starts from these stacks and prizes, and the tournament moves on from there: players knocked out, prizes paid, the blinds rising. Out, or with every chip, and it starts over."
          : "Every hand starts from these stacks and prizes, so the tournament doesn\u2019t move on and nobody\u2019s knocked out (Play it out moves it on)."}{" "}
        {icm
          ? `Answers are in prize equity by Malmuth-Harville. At ${PUSH_FOLD_MAX}bb or less your own all-in is the push/fold equilibrium in prize equity, and a call of a jam is priced in prize equity. Every other preflop spot is a chip chart with a risk premium, a heuristic. After the flop a solve pays prize equity, and betting rules play chips, so those are graded by frequency. The badge on each answer says which.${draft.bounty ? " Bounties are priced by a proportional model: solved for push/fold and after the flop, and a discount on the risk premium in other preflop spots. Mystery bounties are on the Tournaments page." : ""}`
          : "Chip EV means no prizes: the answers are what the engine gives these stacks in a cash game, in bb."}{" "}
        These sessions stay apart from your other numbers in History and Review.
      </p>
    </fieldset>
  );
}
