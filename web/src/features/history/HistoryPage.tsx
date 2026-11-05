// History: every session kept in this browser, by day, newest first, with lifetime totals by kind, Practice's finished
// hands by pot type (features/history/history.ts), and decisions by street and over time (progress.ts). Each row says
// what graded it; nothing here is solved anew.
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { bb, pct } from "@/components/actions";
import { allSessions, type SessionRecord } from "@/data/db";
import { listMistakes } from "@/data/mistakes";
import { TrendChart } from "@/features/analyze/SessionsPanel";
import { dueQueue } from "@/features/review/schedule";
import { byDay, KINDS, kindLabel, kindTotals, potTotals, rowOf, sourcesText, type SessionKind, type SessionRow } from "./history";
import { BASIS_WORDS, BLOCK, MIN_BLOCKS, MIN_SHARE, shareText, streetTotals, trends, type BasisTrend } from "./progress";

const isKind = (k: string | null): k is SessionKind => KINDS.some((x) => x.id === k);
const signed = (x: number) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(Math.round(x * 100) / 100)}`;
const lossText = (bbPer: number | null, pctPer: number | null) => (bbPer == null ? "–" : `${bb(bbPer)}bb${pctPer == null ? "" : ` · ${pctPer.toFixed(1)}% pot`}`);
const many = (n: number, one: string, more = `${one}s`) => `${n} ${n === 1 ? one : more}`;
const okText = (ok: number | null, n: number) => (ok == null || !n ? "–" : pct(ok / n, 0));

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
  const days = useMemo(() => byDay((sessions ?? []).filter((s) => !kind || s.kind === kind).map(rowOf)), [sessions, kind]);

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
        <p className="text-sm text-muted">
          Every session kept in this browser: Practice&rsquo;s full hands and drills, Analyze&rsquo;s leak drills and Study&rsquo;s range builds, newest first.
          Each one&rsquo;s grades are against the answers it was played with, said in its row; nothing here is solved again. The sittings in your imported hands
          are in <Link to="/analyze" className="underline">Analyze</Link>, under Your sessions, read from those hands.
        </p>
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
          No session kept yet. Play hands or drills in <Link to="/practice" className="underline">Practice</Link>, drill a leak in{" "}
          <Link to="/analyze" className="underline">Analyze</Link> or build a range in <Link to="/study" className="underline">Study</Link>: each is kept here as you go.
        </p>
      ) : (
        <>
          <Lifetime totals={totals} />
          <PotTypes pots={pots} />
          <Streets t={streets} />
          <Trends lines={lines} />
          <section aria-label="Sessions" className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold">Sessions</h2>
              <label className="text-sm">
                <span className="text-muted">Show</span>{" "}
                <select value={kind ?? ""} onChange={(e) => setKind(e.target.value)} className="rounded border border-border bg-surface-2 px-1 py-0.5">
                  <option value="">Every kind</option>
                  {KINDS.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {!days.length && <p className="text-sm text-muted">No {kind ? kindLabel(kind).toLowerCase() : "session"} kept yet.</p>}
            {days.map((d) => (
              <section key={d.key} aria-label={d.label} className="space-y-1 rounded-lg border border-border bg-surface p-3">
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

function SessionItem({ r }: { r: SessionRow }) {
  const time = new Date(r.at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const parts =
    r.kind === "build"
      ? [r.acc == null ? null : `${pct(r.acc)} accurate`, r.buildLoss == null ? null : `${r.buildLoss.toFixed(3)}bb a combo`]
      : [
          r.hands != null ? many(r.hands, "hand") : null,
          many(r.n, "decision"),
          r.n ? `${okText(r.ok, r.n)} Best or Correct` : null,
          r.lossPer == null ? null : `${lossText(r.lossPer, r.lossPctPer)} lost a decision`,
          r.kind === "practice" ? (r.net == null ? "no net (preflop only)" : `net ${signed(r.net)}bb`) : null,
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
      <p className="text-muted">{parts.filter(Boolean).join(" · ")}</p>
      <p className="text-xs text-muted">Graded against: {r.graded}</p>
    </li>
  );
}

function Lifetime({ totals }: { totals: ReturnType<typeof kindTotals> }) {
  return (
    <section aria-label="Lifetime totals" className="space-y-1">
      <h2 className="text-lg font-semibold">Lifetime</h2>
      <div className="overflow-x-auto">
        <table className="text-left text-sm" aria-label="Totals by kind">
          <thead className="text-xs text-muted">
            <tr>
              <th className="py-0.5 pr-4 font-normal">Kind</th>
              <th className="py-0.5 pr-4 font-normal">Sessions</th>
              <th className="py-0.5 pr-4 font-normal">Decisions</th>
              <th className="py-0.5 pr-4 font-normal">Best or Correct</th>
              <th className="py-0.5 pr-4 font-normal">EV lost a decision</th>
              <th className="py-0.5 pr-4 font-normal">Hands · net</th>
            </tr>
          </thead>
          <tbody className="font-mono">
            {totals.map((t) =>
              t.kind === "build" ? (
                <tr key={t.kind}>
                  <td className="py-0.5 pr-4 font-sans">{kindLabel(t.kind)}</td>
                  <td className="py-0.5 pr-4">{t.sessions}</td>
                  <td className="py-0.5 pr-4 font-sans" colSpan={4}>
                    {t.acc == null ? "–" : `${pct(t.acc)} accurate on average`}
                    {t.buildLoss == null ? "" : ` · ${t.buildLoss.toFixed(3)}bb a combo lost on average`}
                  </td>
                </tr>
              ) : (
                <tr key={t.kind}>
                  <td className="py-0.5 pr-4 font-sans">{kindLabel(t.kind)}</td>
                  <td className="py-0.5 pr-4">{t.sessions}</td>
                  <td className="py-0.5 pr-4">{t.n}</td>
                  <td className="py-0.5 pr-4">{okText(t.ok, t.n)}</td>
                  <td className="py-0.5 pr-4">{lossText(t.ne ? t.loss / t.ne : null, t.ne ? t.lossPct / t.ne : null)}</td>
                  <td className="py-0.5 pr-4">{t.kind === "practice" ? `${t.hands}${t.played ? ` · ${signed(t.net)}bb over ${t.played}` : ""}` : "–"}</td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted">
        EV lost is averaged over the decisions graded by EV (the preflop charts grade by frequency only). Net counts the hands played out, not those played preflop
        only. A range build is scored by its accuracy over the node&rsquo;s hand classes.
      </p>
    </section>
  );
}

function Streets({ t }: { t: ReturnType<typeof streetTotals> }) {
  if (!t.rows.length && !t.apartDecisions && !t.leakDecisions) return null;
  return (
    <section aria-label="Decisions by street" className="space-y-1">
      <h2 className="text-lg font-semibold">Decisions by street</h2>
      {t.rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="text-left text-sm" aria-label="Totals by street">
            <thead className="text-xs text-muted">
              <tr>
                <th className="py-0.5 pr-4 font-normal">Street</th>
                <th className="py-0.5 pr-4 font-normal">Decisions</th>
                <th className="py-0.5 pr-4 font-normal">Best or Correct</th>
                <th className="py-0.5 pr-4 font-normal">Graded by EV</th>
                <th className="py-0.5 pr-4 font-normal">EV lost a decision</th>
                <th className="py-0.5 pr-4 font-normal">Graded against</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {t.rows.map((r) => (
                <tr key={r.street}>
                  <td className="py-0.5 pr-4 font-sans capitalize">{r.street}</td>
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
      <p className="text-xs text-muted">
        Full hands and drills. Under {MIN_SHARE} decisions a share is written as a count. EV lost is what a decision gave up against the answer named, averaged over those graded by EV: it isn&rsquo;t a
        result or a win rate. Decisions graded by frequency count no EV.
        {t.apartDecisions > 0 &&
          ` ${many(t.apartDecisions, "decision")} in ${many(t.apartSessions, "earlier session")} ${t.apartDecisions === 1 ? "was" : "were"} played before streets were kept, and ${t.apartDecisions === 1 ? "isn't" : "aren't"} split.`}
        {t.leakDecisions > 0 && ` ${many(t.leakDecisions, "leak drill decision")} ${t.leakDecisions === 1 ? "isn't" : "aren't"} split: a leak drill keeps no street.`}
      </p>
    </section>
  );
}

function Trends({ lines }: { lines: BasisTrend[] }) {
  if (!lines.length) return null;
  const end = (t: BasisTrend) => {
    if (!t.line) return null;
    const last = t.blocks.at(-1)!;
    const before = t.blocks.slice(0, -1).reduce((a, b) => ({ n: a.n + b.n, ok: a.ok + b.ok }), { n: 0, ok: 0 });
    return `Your last stretch: ${shareText(last.ok, last.n)} of ${last.n}, against ${shareText(before.ok, before.n)} of ${before.n} before it. ${t.change ? `${t.change}: beyond what chance explains.` : "No clear change: what's moved is within chance."}`;
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
              about={`share of decisions in the mix (Best or Correct), in stretches of ${BLOCK} decisions or more, whole sessions, the band its 95% range.`}
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
              EV lost a decision by stretch, oldest first: {t.blocks.map((b) => `${(b.lossPct / b.ne).toFixed(1)}%`).join(", ")} of the pot, against the answers named. It isn&rsquo;t a result or a win rate.
            </p>
          )}
          <p className="text-xs text-muted">
            {many(t.n, "decision")} in {many(t.sessions, "session")}. Graded against: {sourcesText(t.sources)}.
          </p>
        </div>
      ))}
      <p className="text-xs text-muted">
        A line takes {MIN_BLOCKS} stretches of {BLOCK} decisions or more. The two kinds of grade are kept apart, as how many of each you played would otherwise move the line. Retries aren&rsquo;t counted: they&rsquo;re
        spots you&rsquo;ve already missed. Full hands from before the split was kept aren&rsquo;t in either.
      </p>
    </section>
  );
}

function PotTypes({ pots }: { pots: ReturnType<typeof potTotals> }) {
  if (!pots.rows.length && !pots.without) return null;
  return (
    <section aria-label="Full hands by pot type" className="space-y-1">
      <h2 className="text-lg font-semibold">Full hands by pot type</h2>
      {pots.rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="text-left text-sm" aria-label="Totals by pot type">
            <thead className="text-xs text-muted">
              <tr>
                <th className="py-0.5 pr-4 font-normal">Pot</th>
                <th className="py-0.5 pr-4 font-normal">Hands</th>
                <th className="py-0.5 pr-4 font-normal">Decisions</th>
                <th className="py-0.5 pr-4 font-normal">Best or Correct</th>
                <th className="py-0.5 pr-4 font-normal">EV lost a decision</th>
                <th className="py-0.5 pr-4 font-normal">Net</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {pots.rows.map((t) => (
                <tr key={t.pot}>
                  <td className="py-0.5 pr-4 font-sans">{t.pot}</td>
                  <td className="py-0.5 pr-4">{t.hands}</td>
                  <td className="py-0.5 pr-4">{t.n}</td>
                  <td className="py-0.5 pr-4">{okText(t.ok, t.n)}</td>
                  <td className="py-0.5 pr-4">{lossText(t.ne ? t.loss / t.ne : null, t.ne ? t.lossPct / t.ne : null)}</td>
                  <td className="py-0.5 pr-4">{t.played ? `${signed(t.net)}bb over ${t.played}` : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted">
        Finished hands only, each under its pot as the preflop went while you were in it (&ldquo;Unopened&rdquo;: nobody raised or called).
        {pots.without > 0 &&
          ` ${pots.without} earlier session${pots.without === 1 ? "" : "s"} (${pots.withoutHands} hand${pots.withoutHands === 1 ? "" : "s"}) ${pots.without === 1 ? "was" : "were"} played before pot types were kept, and ${pots.without === 1 ? "isn't" : "aren't"} split.`}
      </p>
    </section>
  );
}
