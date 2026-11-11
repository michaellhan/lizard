// History: every session kept in this browser, by day, newest first, with lifetime totals by kind, Practice's finished
// hands by pot type (features/history/history.ts), and decisions by street, by seat, by pot and over time (progress.ts).
// Each row says what graded it; nothing here is solved anew.
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { bb, pct } from "@/components/actions";
import { allSessions, type SessionRecord } from "@/data/db";
import { listMistakes } from "@/data/mistakes";
import { TrendChart } from "@/features/analyze/SessionsPanel";
import { dueQueue } from "@/features/review/schedule";
import { VERSION_UNKNOWN, versionNote } from "@/grading/version";
import { byDay, GRADE_WAYS, KINDS, kindLabel, kindTotals, kindUnit, potTotals, rowOf, sourcesText, WAY_HEADS, WAY_WORDS, type GradeWay, type SessionKind, type SessionRow, type Split, type WayTally } from "./history";
import { BASIS_WORDS, MIN_SHARE, shareText, splitTotals, streetTotals, trends, type Basis, type BasisTrend, type SplitTotals } from "./progress";

const isKind = (k: string | null): k is SessionKind => KINDS.some((x) => x.id === k);
const signed = (x: number) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(Math.round(x * 100) / 100)}`;
const lossText = (bbPer: number | null, pctPer: number | null, unit = "bb") => (bbPer == null ? "–" : `${bb(bbPer)}${unit}${pctPer == null ? "" : ` · ${pctPer.toFixed(1)}% pot`}`);
const many = (n: number, one: string, more = `${one}s`) => `${n} ${n === 1 ? one : more}`;
const okText = (ok: number, n: number) => (!n ? "–" : pct(ok / n, 0));
/** A way's figures for a session's row. */
const wayText = (way: GradeWay, t: WayTally, unit: string) => `${okText(t.ok, t.n)} Best or Correct of ${t.n} ${WAY_WORDS[way]}${way === "freq" ? "" : `, ${lossText(t.loss / t.n, t.lossPct / t.n, unit)} lost per decision`}`;
/** The ways any of these totals used: a column for each, the preflop solve's only where it graded. */
const waysIn = (rows: readonly Split[]) => GRADE_WAYS.filter((w) => rows.some((r) => r.ways[w]));
/** A way's figures in a totals table. */
function WayCells({ row, ways, unit }: { row: Split; ways: readonly GradeWay[]; unit: string }) {
  return ways.map((w) => {
    const t = row.ways[w];
    return (
      <td key={w} className="py-0.5 pr-4">
        {!t ? "–" : `${t.n < MIN_SHARE ? shareText(t.ok, t.n) : `${shareText(t.ok, t.n)} of ${t.n}`}${w === "freq" ? "" : ` · ${lossText(t.loss / t.n, t.lossPct / t.n, unit)}`}`}
      </td>
    );
  });
}
/** The kinds the seat and pot rates read, as the street table does; a leak drill's are counted beside them. */
const SPLIT_KINDS: readonly SessionKind[] = ["practice", "drill", "analysis"];

/** An exploit session's net over the hands the profile played, in its row. */
function readNetText(r: SessionRow["readNet"]): string {
  if (!r) return "no net (kept before the opponent played the profile)";
  const off = r.off ? `, ${r.off} left out` : "";
  return r.hands ? `net ${signed(r.net)}bb against the profile over ${many(r.hands, "hand")}${off}` : `no hand the profile played throughout${off}`;
}

export function HistoryPage() {
  const [sessions, setSessions] = useState<SessionRecord[] | null>(null);
  const [mistakes, setMistakes] = useState<{ kept: number; due: number } | null>(null);
  const [params, setParams] = useSearchParams();
  const kind = isKind(params.get("kind")) ? (params.get("kind") as SessionKind) : null;

  useEffect(() => {
    let alive = true;
    void allSessions()
      .then((xs) => alive && setSessions(xs))
      .catch(() => alive && setSessions([]));
    void listMistakes()
      .then(({ list }) => alive && setMistakes({ kept: list.length, due: dueQueue(list, Date.now()).length }))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const totals = useMemo(() => kindTotals(sessions ?? []), [sessions]);
  const pots = useMemo(() => potTotals(sessions ?? []), [sessions]);
  const streets = useMemo(() => streetTotals(sessions ?? []), [sessions]);
  const lines = useMemo(() => trends(sessions ?? []), [sessions]);
  const shown = useMemo(() => (sessions ?? []).filter((s) => !kind || s.kind === kind), [sessions, kind]);
  const seats = useMemo(() => splitTotals(shown, "seat"), [shown]);
  const potSplit = useMemo(() => splitTotals(shown, "pot"), [shown]);
  const days = useMemo(() => byDay(shown.map(rowOf)), [shown]);

  const setKind = (k: string) =>
    setParams(
      (p) => {
        const q = new URLSearchParams(p);
        if (isKind(k)) q.set("kind", k);
        else q.delete("kind");
        return q;
      },
      { replace: true },
    );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">History</h1>
        {mistakes != null && mistakes.kept > 0 && (
          <p className="text-sm">
            <Link to="/review" className="underline">
              {many(mistakes.kept, "mistake")} kept for review, {mistakes.due} due
            </Link>
          </p>
        )}
      </div>

      {sessions == null ? (
        <p className="text-sm text-muted">Reading the sessions kept here…</p>
      ) : !sessions.length ? (
        <p className="text-sm text-muted">
          No sessions yet. Play some in <Link to="/practice" className="underline">Practice</Link>.
        </p>
      ) : (
        <>
          <div className="grid items-start gap-6 *:min-w-0 lg:grid-cols-2">
            <Lifetime totals={totals} />
            <PotTypes pots={pots} />
          </div>
          <Streets t={streets} />
          {sessions.some((s) => SPLIT_KINDS.includes(s.kind)) && <Splits seat={seats} pot={potSplit} kind={kind} setKind={setKind} />}
          <Trends lines={lines} />
          <section aria-label="Sessions" className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold">Sessions</h2>
              <KindSelect label="Show" kind={kind} setKind={setKind} />
            </div>
            {!days.length && <p className="text-sm text-muted">No {kind ? kindLabel(kind).toLowerCase() : "session"} kept yet.</p>}
            {days.map((d) => (
              <section key={d.key} aria-label={d.label} className="space-y-1 panel p-3">
                <h3 className="text-sm font-medium">{d.label}</h3>
                <ul className="divide-y divide-border">
                  {d.rows.map((r) => (
                    <SessionItem key={r.id} r={r} />
                  ))}
                </ul>
              </section>
            ))}
          </section>
        </>
      )}
    </div>
  );
}

/** The page's one filter, `kind` in the URL: said where it's used. */
function KindSelect({ label, kind, setKind }: { label: string; kind: SessionKind | null; setKind: (k: string) => void }) {
  return (
    <label className="text-sm">
      <span className="text-muted">{label}</span>{" "}
      <select value={kind ?? ""} onChange={(e) => setKind(e.target.value)} className="rounded border border-border bg-surface-2 px-1 py-0.5">
        <option value="">Every kind</option>
        {KINDS.map((k) => (
          <option key={k.id} value={k.id}>
            {k.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function SessionItem({ r }: { r: SessionRow }) {
  const time = new Date(r.at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const parts =
    r.kind === "build"
      ? [r.acc == null ? null : `${pct(r.acc)} accurate${r.byCombo ? ", by combo" : ""}`, r.buildLoss == null ? null : `${r.buildLoss.toFixed(3)}bb a combo`]
      : [
          r.hands != null ? many(r.hands, "hand") : null,
          many(r.n, "decision"),
          ...GRADE_WAYS.flatMap((w) => (r.split.ways[w] ? [wayText(w, r.split.ways[w], kindUnit(r.kind))] : [])),
          r.split.apart ? `${r.split.apart} not told apart by how ${r.split.apart === 1 ? "it was" : "they were"} graded` : null,
          r.kind === "practice" ? (r.net == null ? "no net (preflop only)" : `net ${signed(r.net)}bb`) : null,
          r.kind === "exploit" ? readNetText(r.readNet) : null,
        ];
  return (
    <li className="space-y-0.5 py-1.5 text-sm">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-mono text-xs text-muted">{time}</span>
        <span className="rounded bg-surface-2 px-1.5 text-xs">{kindLabel(r.kind)}</span>
        <span>{r.what}</span>
        {r.to && (
          <Link to={r.to.href} className="text-xs underline">
            {r.to.label}
          </Link>
        )}
      </div>
      <p className="text-muted">
        {parts.filter(Boolean).join(" · ")}
        <span className="text-xs"> · Graded against: {r.graded}</span>
      </p>
    </li>
  );
}

function Lifetime({ totals }: { totals: ReturnType<typeof kindTotals> }) {
  const ways = waysIn(totals);
  const apart = totals.reduce((a, t) => a + t.apart, 0);
  return (
    <section aria-label="Lifetime totals" className="space-y-1">
      <h2 className="text-lg font-semibold">Lifetime</h2>
      <div className="scroll-x" role="group" aria-label="Totals by kind, scrolls sideways" tabIndex={0}>
        <table className="text-left text-sm" aria-label="Totals by kind">
          <thead className="text-xs text-muted">
            <tr>
              <th className="py-0.5 pr-4 font-normal">Kind</th>
              <th className="py-0.5 pr-4 font-normal">Sessions</th>
              <th className="py-0.5 pr-4 font-normal">Decisions</th>
              {ways.map((w) => (
                <th key={w} className="py-0.5 pr-4 font-normal">
                  {WAY_HEADS[w]}
                </th>
              ))}
              <th className="py-0.5 pr-4 font-normal">Hands · net</th>
            </tr>
          </thead>
          <tbody>
            {totals.map((t) =>
              t.kind === "build" ? (
                <tr key={t.kind}>
                  <td className="py-0.5 pr-4 font-sans">{kindLabel(t.kind)}</td>
                  <td className="py-0.5 pr-4">{t.sessions}</td>
                  <td className="py-0.5 pr-4 font-sans" colSpan={ways.length + 2}>
                    {t.acc == null ? "–" : `${pct(t.acc)} accurate on average`}
                    {t.buildLoss == null ? "" : ` · ${t.buildLoss.toFixed(3)}bb a combo lost on average`}
                  </td>
                </tr>
              ) : (
                <tr key={t.kind}>
                  <td className="py-0.5 pr-4 font-sans">{kindLabel(t.kind)}</td>
                  <td className="py-0.5 pr-4">{t.sessions}</td>
                  <td className="py-0.5 pr-4">{t.n}</td>
                  <WayCells row={t} ways={ways} unit={kindUnit(t.kind)} />
                  <td className="py-0.5 pr-4">{t.kind === "practice" ? `${t.hands}${t.played ? ` · ${signed(t.net)}bb over ${t.played}` : ""}` : t.hands ? String(t.hands) : "–"}</td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
      {apart > 0 && <p className="text-xs text-muted">{many(apart, "decision")} from before grades were kept apart: not in these figures.</p>}
      {totals.some((t) => t.kind === "tournament" || t.kind === "tournament-chips") && <p className="text-xs text-muted">Tournaments each have their own row, in no other totals.</p>}
      {totals.some((t) => t.kind === "exploit") && <p className="text-xs text-muted">Exploit sessions have their own row, in no other totals.</p>}
    </section>
  );
}

function Streets({ t }: { t: ReturnType<typeof streetTotals> }) {
  if (!t.rows.length && !t.apartDecisions && !t.leakDecisions) return null;
  return (
    <section aria-label="Decisions by street" className="space-y-1">
      <h2 className="text-lg font-semibold">Decisions by street</h2>
      {t.rows.length > 0 && (
        <div className="scroll-x" role="group" aria-label="Totals by street, scrolls sideways" tabIndex={0}>
          <table className="text-left text-sm" aria-label="Totals by street">
            <thead className="text-xs text-muted">
              <tr>
                <th className="py-0.5 pr-4 font-normal">Street</th>
                <th className="py-0.5 pr-4 font-normal">Decisions</th>
                <th className="py-0.5 pr-4 font-normal">Best or Correct</th>
                <th className="py-0.5 pr-4 font-normal">Graded by EV</th>
                <th className="py-0.5 pr-4 font-normal">EV lost per decision</th>
                <th className="py-0.5 pr-4 font-normal">Graded against</th>
              </tr>
            </thead>
            <tbody>
              {t.rows.map((r) => (
                <tr key={`${r.street}|${r.basis ?? ""}`}>
                  <td className="py-0.5 pr-4 font-sans capitalize">
                    {r.street}
                    {r.basis && <span className="normal-case text-muted"> {r.basis === "ev" ? "by EV" : "by frequency"}</span>}
                  </td>
                  <td className="py-0.5 pr-4">{r.n}</td>
                  <td className="py-0.5 pr-4">{shareText(r.ok, r.n)}</td>
                  <td className="py-0.5 pr-4">{r.ne}</td>
                  <td className="py-0.5 pr-4">{r.ne ? lossText(r.loss / r.ne, r.lossPct / r.ne) : "none: by frequency"}</td>
                  <td className="py-0.5 pr-4 font-sans text-xs text-muted">{sourcesText(r.sources)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {t.apartDecisions > 0 && (
        <p className="text-xs text-muted">
          {many(t.apartDecisions, "decision")} in {many(t.apartSessions, "earlier session")}: not split.
        </p>
      )}
      {t.leakDecisions > 0 && <p className="text-xs text-muted">{many(t.leakDecisions, "leak drill decision")}: not split.</p>}
    </section>
  );
}

const SPLITS = { seat: { title: "By seat", head: "Seat", word: "seat" }, pot: { title: "By pot type", head: "Pot", word: "pot type" } };

function SplitTable({ t, basis }: { t: SplitTotals; basis: Basis }) {
  const { title, head } = SPLITS[t.by];
  const name = `${title}: ${BASIS_WORDS[basis]}`;
  return (
    <div className="space-y-0.5">
      <h4 className="text-xs font-medium text-muted">{BASIS_WORDS[basis]}</h4>
      {/* (focusable, so the keys scroll what doesn't fit a phone) */}
      <div className="scroll-x" role="group" aria-label={`${name}, scrolls sideways`} tabIndex={0}>
        <table className="text-left text-sm" aria-label={name}>
          <thead className="text-xs text-muted">
            <tr>
              <th className="py-0.5 pr-4 font-normal">{head}</th>
              <th className="py-0.5 pr-4 font-normal">Decisions</th>
              <th className="py-0.5 pr-4 font-normal">Best or Correct</th>
              {basis === "ev" && <th className="py-0.5 pr-4 font-normal">EV lost per decision</th>}
              <th className="py-0.5 pr-4 font-normal">Graded against</th>
            </tr>
          </thead>
          <tbody>
            {t[basis].map((r) => (
              <tr key={r.name}>
                <td className="py-0.5 pr-4 font-sans">{r.name}</td>
                <td className="py-0.5 pr-4">{r.n}</td>
                <td className="py-0.5 pr-4">{shareText(r.ok, r.n)}</td>
                {basis === "ev" && <td className="py-0.5 pr-4">{lossText(r.loss / r.ne, r.lossPct / r.ne)}</td>}
                <td className="py-0.5 pr-4 font-sans text-xs text-muted">{sourcesText(r.sources)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SplitBlock({ t }: { t: SplitTotals }) {
  const { title, word } = SPLITS[t.by];
  return (
    <div className="space-y-1">
      <h3 className="text-sm font-medium">{title}</h3>
      {t.ev.length > 0 && <SplitTable t={t} basis="ev" />}
      {t.freq.length > 0 && <SplitTable t={t} basis="freq" />}
      {!t.ev.length && !t.freq.length && <p className="text-sm text-muted">No decision here keeps its {word}.</p>}
      {t.notKept > 0 && (
        <p className="text-xs text-muted">
          {word[0]!.toUpperCase() + word.slice(1)} not kept: {many(t.notKept, "decision")} in {many(t.notKeptSessions, "session")}.
        </p>
      )}
    </div>
  );
}

function Splits({ seat, pot, kind, setKind }: { seat: SplitTotals; pot: SplitTotals; kind: SessionKind | null; setKind: (k: string) => void }) {
  return (
    <section aria-label="Rates by seat and pot type" className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold">Rates by seat and pot type</h2>
        <KindSelect label="Rates from" kind={kind} setKind={setKind} />
      </div>
      {kind && kind !== "practice" && kind !== "drill" ? (
        <p className="text-sm text-muted">{kindLabel(kind)}: not split by seat or pot.</p>
      ) : (
        <div className="grid items-start gap-4 *:min-w-0 2xl:grid-cols-2">
          <SplitBlock t={seat} />
          <SplitBlock t={pot} />
        </div>
      )}
      {(!kind || kind === "practice" || kind === "drill") && seat.leakDecisions > 0 && <p className="text-xs text-muted">{many(seat.leakDecisions, "leak drill decision")}: not split.</p>}
    </section>
  );
}

function Trends({ lines }: { lines: BasisTrend[] }) {
  if (!lines.length) return null;
  const end = (t: BasisTrend) => {
    if (!t.line) return null;
    const last = t.blocks.at(-1)!;
    const before = t.blocks.slice(0, -1).reduce((a, b) => ({ n: a.n + b.n, ok: a.ok + b.ok }), { n: 0, ok: 0 });
    return `Last stretch: ${shareText(last.ok, last.n)} of ${last.n}, against ${shareText(before.ok, before.n)} of ${before.n} before. ${t.change ? `${t.change}.` : "No clear change."}`;
  };
  return (
    <section aria-label="Over time" className="space-y-3">
      <h2 className="text-lg font-semibold">Over time</h2>
      {lines.map((t) => (
        <div key={t.basis} className="space-y-1 text-sm">
          {t.line ? (
            <TrendChart
              basis={BASIS_WORDS[t.basis]}
              points={t.blocks}
              about="share in the mix, 95% band"
            />
          ) : (
            <>
              <h3 className="font-medium">{BASIS_WORDS[t.basis]}</h3>
              <p className="text-muted">
                No line yet. {t.why} {shareText(t.blocks.reduce((a, b) => a + b.ok, 0), t.n)} Best or Correct over those.
              </p>
            </>
          )}
          {end(t) && <p>{end(t)}</p>}
          {t.basis === "ev" && t.line && (
            <p className="text-xs text-muted">
              EV lost per decision by stretch, oldest first: {t.blocks.map((b) => `${(b.lossPct / b.ne).toFixed(1)}%`).join(", ")} of the pot.
            </p>
          )}
          <p className="text-xs text-muted">
            {many(t.n, "decision")} in {many(t.sessions, "session")}. Graded against: {sourcesText(t.sources)}.
          </p>
          {versionNote(t.versions) && (
            <p role="group" aria-label="Versions compared" className="text-xs text-muted">
              {versionNote(t.versions)}
              {t.versions.unknown[0] + t.versions.unknown[1] > 0 ? ` ${VERSION_UNKNOWN}` : ""}
            </p>
          )}
        </div>
      ))}
    </section>
  );
}

function PotTypes({ pots }: { pots: ReturnType<typeof potTotals> }) {
  if (!pots.rows.length && !pots.without) return null;
  const ways = waysIn(pots.rows);
  const apart = pots.rows.reduce((a, t) => a + t.apart, 0);
  return (
    <section aria-label="Full hands by pot type" className="space-y-1">
      <h2 className="text-lg font-semibold">Full hands by pot type</h2>
      {pots.rows.length > 0 && (
        <div className="scroll-x">
          <table className="text-left text-sm" aria-label="Totals by pot type">
            <thead className="text-xs text-muted">
              <tr>
                <th className="py-0.5 pr-4 font-normal">Pot</th>
                <th className="py-0.5 pr-4 font-normal">Hands</th>
                <th className="py-0.5 pr-4 font-normal">Decisions</th>
                {ways.map((w) => (
                  <th key={w} className="py-0.5 pr-4 font-normal">
                    {WAY_HEADS[w]}
                  </th>
                ))}
                <th className="py-0.5 pr-4 font-normal">Net</th>
              </tr>
            </thead>
            <tbody>
              {pots.rows.map((t) => (
                <tr key={t.pot}>
                  <td className="py-0.5 pr-4 font-sans">{t.pot}</td>
                  <td className="py-0.5 pr-4">{t.hands}</td>
                  <td className="py-0.5 pr-4">{t.n}</td>
                  <WayCells row={t} ways={ways} unit="bb" />
                  <td className="py-0.5 pr-4">{t.played ? `${signed(t.net)}bb over ${t.played}` : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {apart > 0 && <p className="text-xs text-muted">{many(apart, "decision")} from before grades were kept apart: not in these.</p>}
      {pots.without > 0 && (
        <p className="text-xs text-muted">
          {many(pots.without, "earlier session")} ({many(pots.withoutHands, "hand")}): not split.
        </p>
      )}
    </section>
  );
}
