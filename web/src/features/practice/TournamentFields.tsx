// A tournament session's setup on the New session form: what the answers are in, the prizes left, each seat's chips and the
// other tables, and KO, PKO or mystery bounties. It's what the Tournaments page sets up, as far as Practice can play it:
// every seat starts with the same KO or PKO bounty (played out, a bounty follows its player, and a PKO's grows), and a
// mystery's envelopes are typed one by one ("500, 100x4, 25x20"), as played out each knockout draws one.
import { LIMITS } from "@/features/solve/setup";
import { FORMAT_PRESETS, PAYOUT_PRESETS, parsePayouts, pastedPayouts, presetAnte, STAGE_PRESETS, tournamentProblems, type StagePreset } from "@/features/tournaments/tournament";
import { seatLabel, seatsOf } from "@/poker/seats";
import type { TournamentOptions } from "./practice";

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
  bounty: "" | "ko" | "pko" | "mystery";
  /** every seat's bounty to start, and the other tables' average (blank: the same) */
  each: string;
  bountyField: string;
  /** mystery: the envelopes, "500, 100x4, 25x20" */
  envelopes: string;
}

/** most envelopes a mystery session holds */
export const MAX_ENVELOPES = 10000;

/** Envelopes typed as values, each with a count after an x ("500, 100x4, 25x20"), or what's wrong with them. */
export function parseEnvelopes(text: string): number[] | string {
  const out: number[] = [];
  for (const part of text.split(/[\s,;]+/).filter(Boolean)) {
    const m = /^(\d+(?:\.\d+)?|\.\d+)(?:[x×*](\d+))?$/i.exec(part);
    if (!m) return `"${part}" isn't an envelope: a value, with a count after an x (100x4)`;
    const v = Number(m[1]);
    const k = m[2] === undefined ? 1 : Number(m[2]);
    if (!(v > 0) || !(k >= 1)) return `"${part}": an envelope is worth more than 0, and its count is 1 or more`;
    if (out.length + k > MAX_ENVELOPES) return `at most ${MAX_ENVELOPES} envelopes`;
    for (let i = 0; i < k; i++) out.push(v);
  }
  return out.length ? out : "type the envelopes, in the prizes' units: 500, 100x4, 25x20";
}

/** Envelopes as typed, the biggest first, each value once with its count. */
export function envelopesText(env: readonly number[]): string {
  const counts = new Map<number, number>();
  for (const v of env) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([v, k]) => (k > 1 ? `${v}x${k}` : String(v)))
    .join(", ");
}

export const draftOf = (t: TournamentOptions | undefined, stack: number): TournamentDraft => ({
  model: t?.model ?? "icm",
  payouts: (t?.payouts ?? [50, 30, 20]).join(", "),
  stacks: Object.fromEntries(Object.entries(t?.stacks ?? {}).filter(([, v]) => v !== stack).map(([p, v]) => [p, String(v)])),
  others: t?.field ? String(t.field.players) : "",
  avg: t?.field ? String(t.field.avg) : "",
  bounty: t?.bounty?.format ?? "",
  each: t?.bounty && t.bounty.format !== "mystery" ? String(Math.max(...Object.values(t.bounty.seats))) : "",
  bountyField: t?.bounty && t.bounty.format !== "mystery" ? String(t.bounty.field) : "",
  envelopes: t?.bounty?.format === "mystery" ? envelopesText(t.bounty.envelopes ?? []) : "",
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
  if (d.bounty === "mystery") {
    const env = parseEnvelopes(d.envelopes);
    if (typeof env === "string") problems.push(`mystery bounties: ${env}`);
    else bounty = { format: "mystery", seats: {}, field: 0, envelopes: env };
  } else if (d.bounty) {
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
    ante: presetAnte(st),
    draft: {
      // (one prize: chips are prizes, which is chip EV)
      model: st.payouts.length >= 2 ? "icm" : "chips",
      payouts: st.payouts.join(", "),
      stacks: Object.fromEntries(seats.flatMap((p, i) => (st.stacks[i] !== top ? [[p, String(st.stacks[i])]] : []))),
      others: st.field ? String(st.field.players) : "",
      avg: st.field ? String(st.field.avg) : "",
      bounty: "",
      each: "",
      bountyField: "",
      envelopes: "",
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
          title="Table, stacks, ante and prizes at once"
          value=""
          onChange={(e) => {
            const st = [...STAGE_PRESETS, ...FORMAT_PRESETS].find((x) => x.name === e.target.value);
            if (st) onStage(st);
          }}
          className={INPUT}
        >
          <option value="">A stage or format…</option>
          <optgroup label="Stages of an MTT">
            {STAGE_PRESETS.map((st) => (
              <option key={st.name} value={st.name} title={st.about}>
                {st.name}
              </option>
            ))}
          </optgroup>
          <optgroup label="Sit & go and spin">
            {FORMAT_PRESETS.map((st) => (
              <option key={st.name} value={st.name} title={st.about}>
                {st.name}
              </option>
            ))}
          </optgroup>
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
          <label className="flex items-center gap-1" title="First place first; a pasted payout table works">
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
          <label className="flex items-center gap-1" title="Blank: none">
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
          <label className="flex items-center gap-1" title="KO pays all; PKO half; Mystery draws an envelope">
            <span className="text-muted">Bounties</span>
            <select aria-label="Bounties" value={draft.bounty} onChange={(e) => set({ bounty: e.target.value as TournamentDraft["bounty"] })} className={INPUT}>
              <option value="">None</option>
              <option value="ko">KO</option>
              <option value="pko">PKO</option>
              <option value="mystery">Mystery</option>
            </select>
          </label>
          {draft.bounty === "mystery" && (
            <label className="flex items-center gap-1" title="Prize units, count after x">
              <span className="text-muted">Envelopes</span>
              <input aria-label="Mystery envelopes" type="text" placeholder="500, 100x4, 25x20" value={draft.envelopes} onChange={(e) => set({ envelopes: e.target.value })} className={`w-44 ${INPUT}`} />
            </label>
          )}
          {(draft.bounty === "ko" || draft.bounty === "pko") && (
            <>
              <label className="flex items-center gap-1" title="Starting bounty, in prize units">
                <span className="text-muted">Each</span>
                <input aria-label="Each seat's bounty" type="number" min={0} step="any" value={draft.each} onChange={(e) => set({ each: e.target.value })} className={`w-16 ${INPUT}`} />
              </label>
              <label className="flex items-center gap-1" title="Blank: same">
                <span className="text-muted">Others&rsquo; bounty</span>
                <input aria-label="The other tables' average bounty" type="number" min={0} step="any" placeholder={draft.each} value={draft.bountyField} onChange={(e) => set({ bountyField: e.target.value })} className={`w-16 ${INPUT}`} />
              </label>
            </>
          )}
        </>
      )}
      <label className="flex items-center gap-1.5">
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
        <span className="text-muted">bb (blank: Stack)</span>
      </div>
      {problems.length > 0 && (
        <p role="alert" className="basis-full text-xs text-danger">
          {problems.join("; ")}
        </p>
      )}
      <p className="basis-full text-xs text-muted">
        {playOut ? "" : "Each hand restarts from these stacks. "}
        {icm ? "ICM (Malmuth-Harville); non-jam preflop spots are heuristic charts." : "Chip EV: cash-game answers in bb."}
      </p>
    </fieldset>
  );
}
