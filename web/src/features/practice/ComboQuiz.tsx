// Practice's Combos tab: a combo-counting quiz (combos.ts). Your hand, a flop and the opponent's range, and one question:
// how many combos of a hand category they can have, or how many your cards take out. Four choices; the other counts can be
// opened first (the answer is then marked as helped). Each answer is explained by the classes that make it, and kept in a
// record by category, in this browser (kv), which isn't in backups or sync.
// Every number is an exact count made in this page; the ranges are inputs and say where they came from.
import { useEffect, useMemo, useRef, useState } from "react";
import { PlayingCard } from "@/components/PlayingCard";
import { kvGet, kvSet } from "@/data/db";
import { listRanges } from "@/data/saved";
import { isNextKey } from "./keys";
import { Kbd } from "./HintReveal";
import { useHandKeys } from "./PracticeParts";
import {
  answered,
  CATEGORIES,
  categoryLabel,
  classesOf,
  dayOf,
  emptyStats,
  fmtCount,
  makeQuestion,
  ranked,
  rangeCombos,
  readStats,
  record,
  SAMPLE_RANGES,
  STATS_KEY,
  successRate,
  type Bucket,
  type CategoryId,
  type Outcome,
  type Question,
  type QuizRange,
  type QuizStats,
} from "./combos";

/** Where the numbers come from, under the quiz. */
export const COMBO_SOURCE = "Exact counts, made in this page: every combo of the range is checked against the flop and your two cards. No solver or chart is involved.";

const MIX = "mix";
const TYPED = "typed";
const pct = (x: number) => `${Math.round(x * 100)}%`;
const BUCKET_WORDS: Record<Bucket, string> = { live: "They can have", hand: "Your hand takes out" };

function question(q: Question) {
  const what = categoryLabel(q.cat).toLowerCase();
  return q.bucket === "live" ? `How many ${what} combos can they have?` : `How many of their ${what} combos does your hand take out?`;
}

/** Why a wrong choice is what it is, where it's a slip the choices were built from. */
function slipWords(q: Question, picked: number): string | null {
  const t = q.tally;
  const near = (x: number) => Math.abs(x - picked) < 0.005;
  if (q.bucket === "live") {
    if (t.hand[q.cat] > 0 && near(q.answer + t.hand[q.cat])) return "That counts the combos your hand takes out as well.";
    if (near(q.answer + t.hand[q.cat] + t.board[q.cat])) return "That counts every combo of these classes, before the flop and your hand take any out.";
  } else {
    if (t.board[q.cat] > 0 && near(q.answer + t.board[q.cat])) return "That counts the combos dead on the flop as well.";
    if (near(t.live[q.cat])) return "That's how many they can have; the question was how many your hand takes out.";
  }
  return null;
}

export function ComboQuiz({ rand = Math.random, active = true }: { rand?: () => number; active?: boolean }) {
  const [saved, setSaved] = useState<QuizRange[]>([]);
  const [choice, setChoice] = useState(MIX);
  const [typed, setTyped] = useState("");
  const [typedRange, setTypedRange] = useState<QuizRange | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [q, setQ] = useState<Question | null>(() => makeQuestion(SAMPLE_RANGES[Math.floor(rand() * SAMPLE_RANGES.length)]!, rand));
  const [picked, setPicked] = useState<number | null>(null);
  const [helped, setHelped] = useState(false);
  const [countsOpen, setCountsOpen] = useState(false);
  const [stats, setStats] = useState<QuizStats>(emptyStats);
  const nextRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let alive = true;
    void kvGet(STATS_KEY)
      .then((s) => alive && setStats((now) => (answered(now.total) ? now : readStats(s))))
      .catch(() => undefined);
    void listRanges()
      .then((rs) => alive && setSaved(rs.map((r) => ({ key: `saved:${r.id}`, name: r.name, text: r.text, source: "Your saved range, from Ranges." }))))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const rangeFor = (key: string): QuizRange | null => {
    if (key === MIX) return SAMPLE_RANGES[Math.floor(rand() * SAMPLE_RANGES.length)]!;
    if (key === TYPED) return typedRange;
    return [...SAMPLE_RANGES, ...saved].find((r) => r.key === key) ?? null;
  };

  const deal = (r: QuizRange | null) => {
    if (!r) return;
    const next = makeQuestion(r, rand);
    if (!next) {
      setSaid(rangeCombos(r.text) ? `${r.name} has no combo that can be dealt.` : `${r.name} doesn't read as a range.`);
      return;
    }
    setSaid(null);
    setQ(next);
    setPicked(null);
    setHelped(false);
    setCountsOpen(false);
  };

  const answer = (o: number) => {
    if (!q || picked !== null) return;
    const right = Math.abs(o - q.answer) < 0.005;
    const outcome: Outcome = right ? (helped ? "assisted" : "correct") : "wrong";
    const s = record(stats, q.bucket, q.cat, outcome, dayOf(new Date()));
    setStats(s);
    void kvSet(STATS_KEY, s).catch(() => undefined);
    setPicked(o);
    setCountsOpen(true);
  };

  useEffect(() => {
    if (picked !== null && active) nextRef.current?.focus({ preventScroll: true });
  }, [picked, active]);

  // keys: 1–4 a choice; once answered, Enter, Space or N the next question (Enter or Space on a focused control is its own)
  useHandKeys(active && !!q, (e, tag) => {
    if (!q) return;
    if (picked === null) {
      if (/^[1-4]$/.test(e.key)) answer(q.options[Number(e.key) - 1]!);
    } else if (isNextKey(e.key)) {
      if (e.key.toLowerCase() !== "n" && /^(BUTTON|A|SUMMARY)$/.test(tag)) return;
      e.preventDefault();
      deal(rangeFor(choice));
    }
  });

  const typedCheck = useMemo(() => (typed.trim() ? rangeCombos(typed) : undefined), [typed]);

  return (
    <div className="space-y-3 lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start lg:gap-4 lg:space-y-0">
      <div className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label htmlFor="combo-range" className="text-muted">
            Their range
          </label>
          <select
            id="combo-range"
            value={choice}
            onChange={(e) => {
              setChoice(e.target.value);
              if (e.target.value !== TYPED) deal(rangeFor(e.target.value));
              else if (typedRange) deal(typedRange);
            }}
            className="min-w-0 rounded-md border border-border bg-surface-2 px-2 py-1"
          >
            <optgroup label="Sample ranges">
              <option value={MIX}>A sample range each time</option>
              {SAMPLE_RANGES.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.name}
                </option>
              ))}
            </optgroup>
            {saved.length > 0 && (
              <optgroup label="Your saved ranges">
                {saved.map((r) => (
                  <option key={r.key} value={r.key}>
                    {r.name}
                  </option>
                ))}
              </optgroup>
            )}
            <option value={TYPED}>Type a range…</option>
          </select>
        </div>
        {choice === TYPED && (
          <form
            className="flex flex-wrap items-center gap-2 text-sm"
            onSubmit={(e) => {
              e.preventDefault();
              if (!typedCheck?.length) return;
              const r: QuizRange = { key: TYPED, name: "Your range", text: typed.trim(), source: "The range you typed." };
              setTypedRange(r);
              deal(r);
            }}
          >
            <label htmlFor="combo-typed" className="sr-only">
              Range text
            </label>
            <input
              id="combo-typed"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="e.g. 22+, A2s+, KTo+"
              className="min-w-0 flex-1 basis-60 rounded-md border border-border bg-surface-2 px-2 py-1 font-mono"
            />
            <button type="submit" disabled={!typedCheck?.length} className="rounded-md border border-border px-3 py-1 hover:bg-surface-2 disabled:opacity-50">
              Use this range
            </button>
            {typedCheck === null && <span className="basis-full text-xs text-danger">That doesn&apos;t read as a range.</span>}
          </form>
        )}
        {said && (
          <p role="alert" className="text-sm text-danger">
            {said}
          </p>
        )}

        {q && (
          <>
            <section aria-label="Situation" className="space-y-3 panel p-3">
              <div className="flex flex-wrap gap-6">
                <div>
                  <h2 className="mb-1 text-xs text-muted">Your hand</h2>
                  <div role="group" aria-label="Your cards" className="flex gap-1">
                    {q.hero.map((c) => (
                      <PlayingCard key={c} card={c} />
                    ))}
                  </div>
                </div>
                <div>
                  <h2 className="mb-1 text-xs text-muted">Flop</h2>
                  <div role="group" aria-label="Board" className="flex gap-1">
                    {q.flop.map((c) => (
                      <PlayingCard key={c} card={c} />
                    ))}
                  </div>
                </div>
              </div>
              <div className="text-sm">
                <h2 className="text-xs text-muted">Their range</h2>
                <p>
                  <span className="font-medium">{q.range.name}</span>
                  <span className="text-muted">
                    {" "}
                    · {fmtCount(q.rangeSize)} of 1,326 combos ({((q.rangeSize / 1326) * 100).toFixed(1)}%)
                  </span>
                </p>
                <p className="break-words font-mono text-xs">{q.range.text}</p>
                <p className="text-xs text-muted">{q.range.source}</p>
              </div>
            </section>

            <section aria-label="Question" className="space-y-3 panel p-3">
              <p className="font-medium">{question(q)}</p>
              <div role="group" aria-label="Choices" className="flex flex-wrap gap-2">
                {q.options.map((o, i) => {
                  const right = picked !== null && Math.abs(o - q.answer) < 0.005;
                  const wrongPick = picked !== null && o === picked && !right;
                  return (
                    <button
                      key={o}
                      type="button"
                      disabled={picked !== null}
                      aria-pressed={picked === o}
                      onClick={() => answer(o)}
                      className={`min-w-16 rounded-md border px-3 py-1.5 font-mono text-sm ${right ? "border-accent bg-accent/15" : wrongPick ? "border-danger bg-danger/10" : "border-border bg-surface-2 hover:bg-surface-3"} disabled:cursor-default`}
                    >
                      <span aria-hidden className="mr-1.5 text-xs text-faint">
                        {i + 1}
                      </span>
                      {fmtCount(o)}
                    </button>
                  );
                })}
              </div>
              {picked !== null && <Verdict q={q} picked={picked} helped={helped} />}
              {picked !== null && (
                <button ref={nextRef} type="button" onClick={() => deal(rangeFor(choice))} className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-bg hover:bg-accent-strong">
                  Next question
                  <Kbd>N</Kbd>
                </button>
              )}
              <details
                open={countsOpen}
                onToggle={(e) => {
                  const open = e.currentTarget.open;
                  setCountsOpen(open);
                  if (open && picked === null) setHelped(true);
                }}
                className="text-sm"
              >
                <summary className="cursor-pointer text-muted">{picked === null ? "Show the other counts (the answer then counts as helped)" : "All the counts"}</summary>
                <CountsTable q={q} hide={picked === null} />
              </details>
              <p className="text-xs text-muted">{COMBO_SOURCE}</p>
            </section>
          </>
        )}
      </div>

      <aside aria-label="Your record" className="min-w-0">
        <Record stats={stats} onClear={() => (setStats(emptyStats()), void kvSet(STATS_KEY, emptyStats()).catch(() => undefined))} />
      </aside>
    </div>
  );
}

function Verdict({ q, picked, helped }: { q: Question; picked: number; helped: boolean }) {
  const right = Math.abs(picked - q.answer) < 0.005;
  const classes = classesOf(q.counted, q.bucket, q.cat);
  const slip = right ? null : slipWords(q, picked);
  return (
    <div className="space-y-1 text-sm">
      <p role="status" className={right ? "font-medium text-accent" : "font-medium text-danger"}>
        {right ? (helped ? "Right, with the counts open." : "Right.") : `Not quite: it's ${fmtCount(q.answer)}.`}
        {slip && <span className="font-normal text-text"> {slip}</span>}
      </p>
      <p className="text-muted">
        {categoryLabel(q.cat)}, {BUCKET_WORDS[q.bucket].toLowerCase()}:{" "}
        {classes.map((c, i) => (
          <span key={c.cls} title={c.combos.join(" ")}>
            {i > 0 && " · "}
            <span className="font-mono text-text">{c.cls}</span> {fmtCount(c.n)}
          </span>
        ))}
      </p>
    </div>
  );
}

/** Every category's counts in each state; before an answer, the asked one's cell is a question mark. Categories with no
 * combo in any state are left out. */
function CountsTable({ q, hide }: { q: Question; hide: boolean }) {
  const t = q.tally;
  const rows = CATEGORIES.filter((c) => t.live[c.id] + t.hand[c.id] + t.board[c.id] > 0);
  const cell = (b: "live" | "hand" | "board", id: CategoryId) => (hide && b === q.bucket && id === q.cat ? "?" : fmtCount(t[b][id]));
  return (
    <table className="mt-2 w-full max-w-md text-left text-sm">
      <thead className="text-xs text-muted">
        <tr>
          <th className="py-0.5 font-normal">Category</th>
          <th className="py-0.5 pl-3 text-right font-normal">They can have</th>
          <th className="py-0.5 pl-3 text-right font-normal">Your hand takes out</th>
          <th className="py-0.5 pl-3 text-right font-normal">Dead on the flop</th>
        </tr>
      </thead>
      <tbody className="font-mono">
        {rows.map((c) => (
          <tr key={c.id} className={c.id === q.cat ? "bg-surface-2" : ""}>
            <td className="py-0.5 font-sans">{c.label}</td>
            <td className="py-0.5 text-right">{cell("live", c.id)}</td>
            <td className="py-0.5 text-right">{cell("hand", c.id)}</td>
            <td className="py-0.5 text-right">{cell("board", c.id)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const MARK: Record<Outcome, { tone: string; words: string }> = {
  correct: { tone: "bg-accent", words: "right" },
  assisted: { tone: "bg-warn", words: "right with the counts open" },
  wrong: { tone: "bg-danger", words: "wrong" },
};

function Record({ stats, onClear }: { stats: QuizStats; onClear: () => void }) {
  const [asking, setAsking] = useState(false);
  const n = answered(stats.total);
  const today = stats.days[dayOf(new Date())] ?? 0;
  const r = ranked(stats);
  const name = (b: Bucket, c: CategoryId) => `${categoryLabel(c)} · ${b === "live" ? "they have" : "you take out"}`;
  const rows = CATEGORIES.flatMap((c) => (["live", "hand"] as const).map((b) => ({ b, c: c.id, m: stats.byCat[`${b}:${c.id}`] }))).filter((x) => x.m && answered(x.m));
  return (
    <section aria-label="Combo record" className="space-y-3 panel p-3 text-sm">
      <h2 className="font-medium">Your record</h2>
      <dl className="grid grid-cols-2 gap-2">
        <div>
          <dt className="text-xs text-muted">Questions</dt>
          <dd className="font-mono">{n}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Right first time</dt>
          <dd className="font-mono">{n ? pct(successRate(stats.total)) : "–"}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Today</dt>
          <dd className="font-mono">{today}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Streak</dt>
          <dd className="font-mono">
            {stats.streak} <span className="text-xs text-muted">(best {stats.best})</span>
          </dd>
        </div>
      </dl>
      {stats.recent.length > 0 && (
        <div>
          <h3 className="mb-1 text-xs text-muted">Last {stats.recent.length}</h3>
          <ol aria-label={`Last answers: ${stats.recent.map((o) => MARK[o].words).join(", ")}`} className="flex flex-wrap gap-1">
            {stats.recent.map((o, i) => (
              <li key={i} aria-hidden className={`h-3 w-3 rounded-sm ${MARK[o].tone}`} />
            ))}
          </ol>
        </div>
      )}
      {r.length > 1 && (
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <h3 className="mb-1 text-muted">Hardest</h3>
            <ul>
              {r.slice(0, 3).map((x) => (
                <li key={x.key}>
                  {name(x.bucket, x.cat)} <span className="font-mono">{pct(x.rate)}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="mb-1 text-muted">Best</h3>
            <ul>
              {[...r].reverse().slice(0, 3).map((x) => (
                <li key={x.key}>
                  {name(x.bucket, x.cat)} <span className="font-mono">{pct(x.rate)}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
      {rows.length > 0 && (
        <table className="w-full text-left text-xs">
          <caption className="mb-1 text-left text-muted">By category</caption>
          <thead className="text-muted">
            <tr>
              <th className="font-normal">Category</th>
              <th className="text-right font-normal">Right</th>
              <th className="text-right font-normal">Helped</th>
              <th className="text-right font-normal">Wrong</th>
            </tr>
          </thead>
          <tbody className="font-mono">
            {rows.map(({ b, c, m }) => (
              <tr key={`${b}:${c}`}>
                <td className="font-sans">{name(b, c)}</td>
                <td className="text-right">{m!.correct}</td>
                <td className="text-right">{m!.assisted}</td>
                <td className="text-right">{m!.wrong}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="text-xs text-muted">Kept in this browser only: not in backups or sync.</p>
      {n > 0 &&
        (asking ? (
          <div role="group" aria-label="Clear the record?" className="flex flex-wrap items-center gap-2 text-xs">
            <span>Clear {n} answers? This can&apos;t be undone.</span>
            <button type="button" onClick={() => (onClear(), setAsking(false))} className="rounded border border-danger px-2 py-0.5 text-danger">
              Clear
            </button>
            <button type="button" onClick={() => setAsking(false)} className="rounded border border-border px-2 py-0.5">
              Keep
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => setAsking(true)} className="text-xs text-muted underline">
            Clear the record
          </button>
        ))}
    </section>
  );
}
