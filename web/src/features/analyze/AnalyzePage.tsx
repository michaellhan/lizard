// Analyze: your hand histories imported into this browser (pasted, or files and folders picked or dropped), read
// by the classic importer's port (hh/), kept in IndexedDB once each (data/hands.ts), listed with filters, and each
// hand replayed street by street with every decision of yours opening in Study; your decisions graded against the
// charts and the flop library (Grading.tsx), each grade shown with what it stands on.
import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { Link, useSearchParams } from "react-router";
import { PlayingCard } from "@/components/PlayingCard";
import { VerdictTag } from "@/components/VerdictTag";
import type { DecisionRecord, HandRecord } from "@/data/db";
import { addHands, deleteImport, importsOf, listDecisions, listHands, putHandNotes, type ImportSummary } from "@/data/hands";
import { readTags } from "@/data/saved";
import type { Verdict } from "@/grading/grade";
import { newId } from "@/data/saved";
import { HH_SITES } from "@/hh/parse";
import { finalSim, importHand, type ReplayedHand } from "@/hh/replay";
import { seatLabel, seatsOf } from "@/poker/seats";
import type { Move, Street } from "@/poker/table";
import { filesName, filterHands, HAND_FILTERS, hhFiles, POT_TYPES, prepare, SKIP_TEXT, STREETS, studyLinkAt, type Prepared, type SkipKind } from "./analyze";
import { decisionNote, GradePanel, GradeReport } from "./GradingPanel";
import { leakParam, parseLeakParam } from "./leakDrill";
import { LeakDrill } from "./LeakDrillPanel";
import { decisionId } from "./grading";
import { isGraded } from "./report";
import { StatsPanel } from "./StatsPanel";

/** hands listed before "Show all" */
export const ROW_LIMIT = 200;
const fmt = (x: number) => String(Math.round(x * 100) / 100);
const cardsOf = (s: string) => s.match(/../g) ?? [];
// each move said of another seat, and of you
const SAY: Record<string, [string, string]> = {
  fold: ["folds", "fold"],
  check: ["checks", "check"],
  call: ["calls", "call"],
  bet: ["bets", "bet"],
  raise: ["raises to", "raise to"],
  "all-in": ["goes all-in", "go all-in"],
};

interface Result {
  name: string;
  prep: Prepared;
  /** null: this browser keeps nothing (IndexedDB unavailable) */
  kept: { added: number; existing: number } | null;
}

export function AnalyzePage({ rowLimit = ROW_LIMIT }: { rowLimit?: number } = {}) {
  const [params, setParams] = useSearchParams();
  const [hands, setHands] = useState<HandRecord[] | null>(null);
  const [decisions, setDecisions] = useState<DecisionRecord[]>([]);
  const [n, setN] = useState(0);
  const reload = () => setN((x) => x + 1);
  useEffect(() => {
    let alive = true;
    void Promise.all([listHands(), listDecisions()]).then(([h, d]) => {
      if (!alive) return;
      setHands(h);
      setDecisions(d);
    });
    return () => {
      alive = false;
    };
  }, [n]);
  // graded decisions as they come (null: all forgotten)
  const onGraded = (ds: DecisionRecord[] | null) =>
    setDecisions((prev) => {
      if (!ds) return [];
      const m = new Map(prev.map((d) => [d.id, d]));
      for (const d of ds) m.set(d.id, d);
      return [...m.values()];
    });

  const id = params.get("hand");
  const drill = parseLeakParam(params.get("drill"));
  const open = id ? hands?.find((h) => h.id === id) : undefined;
  // (the hands table's filters apply to the report, the drill and the stats too)
  const shown = useMemo(() => (hands ? filterHands(hands, params) : null), [hands, params]);
  const set = (o: Record<string, string | null>) =>
    setParams(
      (p) => {
        const q = new URLSearchParams(p);
        for (const [k, v] of Object.entries(o)) if (v) q.set(k, v);
        else q.delete(k);
        return q;
      },
      { replace: true },
    );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Analyze</h1>
        <p className="text-sm text-muted">
          Import your hand histories: they're read and kept in this browser only, nothing is uploaded. Each hand replays street by street, and each of
          your decisions opens in Study at that point. Your preflop and flop decisions can be graded against the preflop charts and the flop library;
          turns and rivers aren't graded yet.
        </p>
      </div>
      <ImportPanel onImported={reload} />
      {hands && hands.length > 0 && <Imports hands={hands} onChange={reload} />}
      {hands && hands.length > 0 && <GradePanel hands={hands} decisions={decisions} onGraded={onGraded} />}
      {hands && shown && drill && <LeakDrill key={leakParam(drill)} leak={drill} decisions={decisions} hands={shown} onClose={() => set({ drill: null })} />}
      {hands && shown && <GradeReport decisions={decisions} hands={shown} of={hands.length} />}
      {open && (
        <HandDetail
          hand={open}
          decisions={decisions.filter((d) => d.handId === open.id)}
          onSaved={(h) => setHands((prev) => prev && prev.map((x) => (x.id === h.id ? h : x)))}
          onClose={() => set({ hand: null })}
        />
      )}
      {id && hands && !open && <p className="text-sm text-muted">That hand isn't kept in this browser (deleted, or imported in another).</p>}
      {hands === null || shown === null ? (
        <p className="text-sm text-muted">…</p>
      ) : (
        <>
          <HandsTable hands={hands} shown={shown} params={params} set={set} rowLimit={rowLimit} />
          {shown.length > 0 && <StatsPanel hands={shown} of={hands.length} />}
        </>
      )}
    </div>
  );
}

function ImportPanel({ onImported }: { onImported: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const folder = useRef<HTMLInputElement>(null);
  useEffect(() => {
    // (React has no prop for it)
    folder.current?.setAttribute("webkitdirectory", "");
  }, []);

  const run = async (files: { name: string; text: string }[], name: string) => {
    setError(null);
    setResult(null);
    setBusy({ done: 0, total: 0 });
    try {
      const imp = { id: newId(), name, at: Date.now() };
      const prep = await prepare(files, imp, (done, total) => setBusy({ done, total }));
      const kept = prep.hands.length ? await addHands(prep.hands) : { added: 0, existing: 0 };
      setResult({ name, prep, kept });
      if (kept?.added) onImported();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  const readFiles = async (list: FileList | File[] | null) => {
    const all = [...(list ?? [])];
    const picked = hhFiles(all);
    if (!picked.length) {
      setError(all.length ? `None of the ${all.length} files is a hand history (.txt, .xml, .log or .hh).` : "No files picked.");
      return;
    }
    const files = await Promise.all(picked.map(async (f) => ({ name: f.webkitRelativePath || f.name, text: await f.text() })));
    await run(files, filesName(picked));
  };
  const drop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    void readFiles(e.dataTransfer.files);
  };

  return (
    <section aria-label="Import" className="space-y-2 rounded-lg border border-border bg-surface p-3">
      <h2 className="text-lg font-semibold">Import hands</h2>
      <p className="text-xs text-muted">Reads {HH_SITES.join(", ")} hand histories, as your poker client saves them; Hold'em only.</p>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={drop}
        className={`space-y-2 rounded border border-dashed p-3 ${over ? "border-accent bg-surface-2" : "border-border"}`}
      >
        <textarea
          aria-label="Paste hand histories"
          placeholder="Paste one hand history or many, or drop files here"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          className="w-full rounded border border-border bg-surface-2 p-2 font-mono text-xs"
        />
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <button
            type="button"
            disabled={!text.trim() || !!busy}
            onClick={() => void run([{ name: "pasted", text }], "Pasted hands").then(() => setText(""))}
            className="rounded bg-accent px-3 py-1 font-medium text-bg disabled:opacity-40"
          >
            Import pasted hands
          </button>
          <label className="cursor-pointer rounded border border-border px-3 py-1 hover:bg-surface-2">
            Choose files…
            <input
              type="file"
              multiple
              accept=".txt,.xml,.log,.hh,text/plain"
              aria-label="Choose hand-history files"
              className="sr-only"
              disabled={!!busy}
              onChange={(e) => void readFiles(e.target.files).then(() => (e.target.value = ""))}
            />
          </label>
          <label className="cursor-pointer rounded border border-border px-3 py-1 hover:bg-surface-2">
            Choose a folder…
            <input
              ref={folder}
              type="file"
              multiple
              aria-label="Choose a folder of hand histories"
              className="sr-only"
              disabled={!!busy}
              onChange={(e) => void readFiles(e.target.files).then(() => (e.target.value = ""))}
            />
          </label>
        </div>
      </div>
      {busy && (
        <p role="status" className="text-sm">
          Reading hands{busy.total ? `: ${busy.done.toLocaleString()} of ${busy.total.toLocaleString()}` : "…"}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {result && <ImportResult r={result} />}
    </section>
  );
}

function ImportResult({ r }: { r: Result }) {
  const { prep, kept } = r;
  const skips = (Object.entries(prep.skipped) as [SkipKind, number][]).filter(([, v]) => v > 0);
  return (
    <div role="status" aria-label="Import result" className="space-y-1 text-sm">
      <p>
        {r.name}: {prep.total.toLocaleString()} {prep.total === 1 ? "hand" : "hands"} read, {prep.hands.length.toLocaleString()} to keep
        {kept && prep.hands.length > 0 ? ` (${kept.added.toLocaleString()} new, ${kept.existing.toLocaleString()} already kept from an earlier import)` : ""}.
        {kept === null && " This browser isn't keeping data (private browsing, or storage turned off), so nothing was kept."}
      </p>
      {skips.length > 0 && <p className="text-muted">Skipped: {skips.map(([k, v]) => `${v} ${SKIP_TEXT[k]}`).join(", ")}.</p>}
      {prep.files && (
        <ul className="text-xs text-muted">
          {prep.files.map((f, i) => (
            <li key={i}>
              {f.name}: {f.total} read, {f.hands} to keep
            </li>
          ))}
        </ul>
      )}
      {prep.errors.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer">Unreadable hands ({prep.errors.length})</summary>
          <ul className="mt-1 space-y-0.5">
            {prep.errors.slice(0, 20).map((e, i) => (
              <li key={i}>
                {e.file ? `${e.file}, ` : ""}hand {e.n}
                {e.number ? ` (#${e.number})` : ""}: {e.msg}
              </li>
            ))}
            {prep.errors.length > 20 && <li>…and {prep.errors.length - 20} more</li>}
          </ul>
        </details>
      )}
    </div>
  );
}

function Imports({ hands, onChange }: { hands: HandRecord[]; onChange: () => void }) {
  const imports = useMemo(() => importsOf(hands), [hands]);
  const [usage, setUsage] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    void navigator.storage
      ?.estimate?.()
      .then((e) => alive && setUsage(e.usage ?? null))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [hands]);
  const chars = imports.reduce((a, b) => a + b.chars, 0);
  return (
    <section aria-label="Imports" className="space-y-1">
      <h2 className="text-lg font-semibold">Imports</h2>
      <p className="text-xs text-muted">
        {hands.length.toLocaleString()} hands kept, {mb(chars)} of history text
        {usage != null ? `; Lizard uses ${mb(usage)} of this browser's storage in all` : ""}.
      </p>
      <ul className="space-y-1">
        {imports.map((i) => (
          <ImportRow key={i.id} imp={i} onChange={onChange} />
        ))}
      </ul>
    </section>
  );
}
const mb = (bytes: number) => (bytes < 1e6 ? `${Math.max(1, Math.round(bytes / 1e3))} kB` : `${(bytes / 1e6).toFixed(1)} MB`);

function ImportRow({ imp, onChange }: { imp: ImportSummary; onChange: () => void }) {
  const [arm, setArm] = useState(false);
  return (
    <li className="flex flex-wrap items-center gap-2 rounded border border-border bg-surface px-2 py-1 text-sm">
      <span className="font-medium">{imp.name}</span>
      <span className="text-muted">
        {imp.hands.toLocaleString()} {imp.hands === 1 ? "hand" : "hands"}, imported {new Date(imp.at).toLocaleString()}
      </span>
      <span className="flex-1" />
      {arm ? (
        <>
          <button type="button" onClick={() => void deleteImport(imp.id).then(onChange)} className="rounded border border-danger/60 px-2 py-0.5 text-danger hover:bg-danger/10">
            Delete {imp.hands} {imp.hands === 1 ? "hand" : "hands"}
            {imp.annotated > 0 && `, ${imp.annotated} with your tags or note`}
          </button>
          <button type="button" onClick={() => setArm(false)} className="rounded border border-border px-2 py-0.5">
            Keep
          </button>
        </>
      ) : (
        <button type="button" onClick={() => setArm(true)} className="rounded border border-border px-2 py-0.5 hover:bg-surface-2">
          Delete this import
        </button>
      )}
    </li>
  );
}

function HandsTable({
  hands,
  shown,
  params,
  set,
  rowLimit,
}: {
  hands: HandRecord[];
  /** the hands the filters show */
  shown: HandRecord[];
  params: URLSearchParams;
  set: (o: Record<string, string | null>) => void;
  rowLimit: number;
}) {
  const [all, setAll] = useState(false);
  const opts = (k: keyof HandRecord) => [...new Set(hands.map((h) => String(h[k])))].sort();
  if (!hands.length)
    return (
      <p className="rounded-lg border border-border bg-surface p-3 text-sm text-muted">
        No hands kept yet. Paste a hand history above, or pick your client's hand-history files or folder.
      </p>
    );
  const listed = all ? shown : shown.slice(0, rowLimit);
  const select = (label: string, k: string, v: string | null, values: string[]) => (
    <label className="flex items-center gap-1">
      <span className="text-muted">{label}</span>
      <select aria-label={label} value={v ?? ""} onChange={(e) => set({ [k]: e.target.value || null })} className="rounded border border-border bg-surface-2 px-1 py-0.5">
        <option value="">Any</option>
        {values.map((x) => (
          <option key={x} value={x}>
            {x}
          </option>
        ))}
      </select>
    </label>
  );
  const tags = [...new Set(hands.flatMap((h) => h.tags ?? []))].sort();
  // (the days played, by the site's clock, as the history writes them)
  const days = hands.map((h) => h.played.slice(0, 10)).filter(Boolean).sort();
  const date = (label: string, k: string) => (
    <label className="flex items-center gap-1">
      <span className="text-muted">{label}</span>
      <input
        type="date"
        aria-label={label}
        value={params.get(k) ?? ""}
        min={days[0]}
        max={days.at(-1)}
        onChange={(e) => set({ [k]: e.target.value || null })}
        className="rounded border border-border bg-surface-2 px-1 py-0.5"
      />
    </label>
  );
  return (
    <section aria-label="Hands" className="space-y-2">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <h2 className="text-lg font-semibold">Hands</h2>
        {select("Your seat", "pos", params.get("pos"), opts("hero"))}
        {select("Pot", "pot", params.get("pot"), POT_TYPES.filter((p) => hands.some((h) => h.potType === p)))}
        {select("Site", "site", params.get("site"), opts("site"))}
        {select("Stakes", "bb", params.get("bb"), opts("bb"))}
        {date("From", "from")}
        {date("To", "to")}
        {tags.length > 0 && select("Tag", "tag", params.get("tag"), tags)}
        <input
          type="search"
          aria-label="Search hands"
          value={params.get("q") ?? ""}
          onChange={(e) => set({ q: e.target.value || null })}
          placeholder="Search cards, number, tags, notes"
          className="w-56 max-w-full rounded border border-border bg-surface-2 px-2 py-0.5"
        />
        <span className="text-muted">
          {shown.length.toLocaleString()} of {hands.length.toLocaleString()}
        </span>
        {HAND_FILTERS.some((k) => params.get(k)) && (
          <button type="button" onClick={() => set(Object.fromEntries(HAND_FILTERS.map((k) => [k, null])))} className="rounded border border-border px-2 py-0.5 hover:bg-surface-2">
            Clear filters
          </button>
        )}
      </div>
      {/* (relative: the sr-only header's absolute box stays inside the scrolling box, not widening the page) */}
      <div className="relative overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-left text-xs text-muted">
            <tr>
              <th className="px-2 py-1">Played</th>
              <th className="px-2 py-1">Your seat</th>
              <th className="px-2 py-1">Cards</th>
              <th className="px-2 py-1">Board</th>
              <th className="px-2 py-1">Pot type</th>
              <th className="px-2 py-1 text-right">Pot (bb)</th>
              <th className="px-2 py-1">End</th>
              <th className="hidden px-2 py-1 sm:table-cell">Site</th>
              <th className="hidden px-2 py-1 sm:table-cell">Big blind</th>
              <th className="px-2 py-1">
                <span className="sr-only">Open</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {listed.map((h) => (
              <tr key={h.id} aria-label={`Hand ${h.number || h.id}`} className="border-t border-border">
                <td className="whitespace-nowrap px-2 py-1 font-mono text-xs">{h.played || "–"}</td>
                <td className="px-2 py-1">
                  {seatLabel(h.hero, h.players)} <span className="text-xs text-muted">of {h.players}</span>
                </td>
                <td className="px-2 py-1">
                  <span className="flex gap-0.5">
                    {cardsOf(h.hole).map((c) => (
                      <PlayingCard key={c} card={c} size="sm" />
                    ))}
                  </span>
                </td>
                <td className="px-2 py-1">
                  <span className="flex gap-0.5">
                    {cardsOf(h.board).map((c) => (
                      <PlayingCard key={c} card={c} size="sm" />
                    ))}
                  </span>
                </td>
                <td className="whitespace-nowrap px-2 py-1">{h.potType}</td>
                <td className="px-2 py-1 text-right tabular-nums">{fmt(h.pot)}</td>
                <td className="px-2 py-1">
                  <span className="whitespace-nowrap">{h.end}</span>
                  {(h.tags?.length || h.note) && (
                    <span className="mt-0.5 flex flex-wrap gap-1">
                      {h.tags?.map((t) => (
                        <span key={t} className="rounded bg-surface-2 px-1 text-xs">
                          {t}
                        </span>
                      ))}
                      {h.note && <span className="text-xs text-muted" title={h.note}>note</span>}
                    </span>
                  )}
                </td>
                <td className="hidden px-2 py-1 sm:table-cell">{h.site}</td>
                <td className="hidden whitespace-nowrap px-2 py-1 sm:table-cell">
                  {h.bb}
                  {h.tournament ? <span className="text-xs text-muted"> MTT</span> : null}
                </td>
                <td className="px-2 py-1">
                  <button type="button" onClick={() => set({ hand: h.id })} className="underline">
                    Open
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!shown.length && <p className="text-sm text-muted">No hand kept matches these filters.</p>}
      {!all && shown.length > listed.length && (
        <p className="text-sm text-muted">
          {listed.length} of {shown.length.toLocaleString()} hands listed, the latest played first.{" "}
          <button type="button" onClick={() => setAll(true)} className="underline">
            Show all {shown.length.toLocaleString()} hands
          </button>
        </p>
      )}
    </section>
  );
}

function HandDetail({ hand, decisions, onSaved, onClose }: { hand: HandRecord; decisions: DecisionRecord[]; onSaved: (h: HandRecord) => void; onClose: () => void }) {
  const graded = useMemo(() => new Map(decisions.map((d) => [d.id, d])), [decisions]);
  const box = useRef<HTMLElement>(null);
  // (opened from the table below it: brought into view)
  useEffect(() => box.current?.scrollIntoView?.({ block: "start", behavior: "smooth" }), [hand.id]);
  const r = useMemo((): ReplayedHand | string => {
    try {
      return importHand(hand.text);
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  }, [hand.text]);
  if (typeof r === "string")
    return (
      <section aria-label="Hand" className="rounded-lg border border-border bg-surface p-3 text-sm">
        <p role="alert">This hand can't be read again: {r}</p>
      </section>
    );
  const h = r.hand;
  const sim = finalSim(r);
  const stacks = Object.entries(r.setup.stacks);
  const even = stacks.every(([, v]) => v === stacks[0]![1]);
  return (
    <section ref={box} aria-label="Hand" className="scroll-mt-16 space-y-3 rounded-lg border border-border bg-surface p-3 text-sm">
      <div className="flex flex-wrap items-start gap-2">
        <div className="space-y-0.5">
          <h2 className="text-lg font-semibold">
            {h.site} hand{hand.number ? ` #${hand.number}` : ""}
          </h2>
          <p className="text-muted">
            {[hand.played, `${h.players}-handed`, `big blind ${hand.bb}`, h.tournament ? `tournament ${h.tournament.name ?? h.tournament.id ?? ""}` : null, h.ante ? `${fmt(h.ante)}bb ante` : null, h.straddle ? `${seatsOf(h.players)[0]} straddles` : null]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <span className="flex-1" />
        <button type="button" onClick={onClose} className="rounded border border-border px-2 py-0.5 hover:bg-surface-2">
          Close
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span>
          You are <b>{seatLabel(h.hero, h.players)}</b> with
        </span>
        <span className="flex gap-0.5">
          {h.hole.map((c) => (
            <PlayingCard key={c} card={c} size="sm" />
          ))}
        </span>
        <span className="text-muted">
          {even ? `${fmt(h.stack)}bb stacks` : `you ${fmt(h.stack)}bb; ${stacks.filter(([p]) => p !== h.hero).map(([p, v]) => `${seatLabel(p, h.players)} ${fmt(v)}`).join(", ")}`}
        </span>
      </div>
      <ol className="space-y-2">
        {STREETS.map((st) => (
          <StreetRow key={st} r={r} street={st} graded={(i) => graded.get(decisionId(hand.id, st, i))} />
        ))}
      </ol>
      <p className="text-muted">
        Pot {fmt(sim.pot)}bb ({hand.end}). From your hand history, replayed on Lizard's table.
        {decisions.length ? " Grades: your preflop moves against the preflop charts (by frequency, not a solve), your flop moves against the flop library." : " None of your decisions here is graded yet."}
        {(h.ante > 0 || h.straddle) && " Study can't set up this hand's ante or straddle, so its decisions don't open in Study."}
      </p>
      {r.warnings.length > 0 && (
        <ul className="list-disc pl-5 text-xs text-muted" aria-label="Warnings">
          {r.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
      <HandNotes key={hand.id} hand={hand} onSaved={onSaved} />
    </section>
  );
}

/** Your tags and note on a kept hand: searchable, a tag filters the table, both kept in the backup. */
function HandNotes({ hand, onSaved }: { hand: HandRecord; onSaved: (h: HandRecord) => void }) {
  const [edit, setEdit] = useState(false);
  const [tags, setTags] = useState((hand.tags ?? []).join(", "));
  const [note, setNote] = useState(hand.note ?? "");
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    const h = await putHandNotes(hand.id, readTags(tags), note).catch(() => undefined);
    if (!h) return setErr("Not saved: this browser keeps nothing here, or the hand was deleted.");
    setErr(null);
    setEdit(false);
    onSaved(h);
  };
  if (edit)
    return (
      <div aria-label="Your tags and note" role="group" className="space-y-1">
        <input aria-label="Tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="Tags, separated by commas" className="w-full rounded border border-border bg-surface-2 px-2 py-1" />
        <textarea aria-label="Note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="A note on this hand" className="w-full rounded border border-border bg-surface-2 px-2 py-1" />
        <div className="flex gap-2">
          <button type="button" onClick={() => void save()} className="rounded bg-accent px-3 py-1 font-medium text-bg">
            Save
          </button>
          <button
            type="button"
            onClick={() => {
              setTags((hand.tags ?? []).join(", "));
              setNote(hand.note ?? "");
              setEdit(false);
            }}
            className="rounded border border-border px-3 py-1 hover:bg-surface-2"
          >
            Cancel
          </button>
        </div>
        {err && <p role="alert" className="text-danger">{err}</p>}
      </div>
    );
  return (
    <div aria-label="Your tags and note" role="group" className="flex flex-wrap items-center gap-2">
      {hand.tags?.map((t) => (
        <span key={t} className="rounded bg-surface-2 px-1.5 py-0.5 text-xs">
          {t}
        </span>
      ))}
      {hand.note && <p className="w-full whitespace-pre-wrap">{hand.note}</p>}
      <button type="button" onClick={() => setEdit(true)} className="rounded border border-border px-2 py-0.5 text-xs hover:bg-surface-2">
        {hand.tags?.length || hand.note ? "Edit tags and note" : "Add tags or a note"}
      </button>
    </div>
  );
}

const NEW_CARDS: Record<Street, [number, number]> = { preflop: [0, 0], flop: [0, 3], turn: [3, 4], river: [4, 5] };

function StreetRow({ r, street, graded }: { r: ReplayedHand; street: Street; graded: (i: number) => DecisionRecord | undefined }) {
  const h = r.hand;
  const moves = r.lines[street];
  const cards = h.board.slice(...NEW_CARDS[street]);
  if (street !== "preflop" && !cards.length && !moves.length) return null;
  const say = (m: Move) => {
    const you = m.pos === h.hero;
    return `${you ? "You" : seatLabel(m.pos, h.players)} ${SAY[m.action]?.[you ? 1 : 0] ?? m.action}${m.to !== undefined ? ` ${fmt(m.to)}` : ""}`;
  };
  return (
    <li aria-label={street} className="space-y-1">
      <div className="flex items-center gap-2">
        <span className="w-14 text-xs uppercase text-muted">{street}</span>
        {cards.map((c) => (
          <PlayingCard key={c} card={c} size="sm" />
        ))}
      </div>
      {moves.length > 0 && (
        <ul className="flex flex-wrap gap-x-3 gap-y-1 pl-16">
          {moves.map((m, i) => {
            const you = m.pos === h.hero;
            const link = you ? studyLinkAt(r, street, i) : null;
            const d = you ? graded(i) : undefined;
            return (
              <li key={i} className={you ? "font-semibold" : "text-muted"}>
                {say(m)}
                {d && (
                  <span className="ml-1 inline-flex items-center gap-1 font-normal" aria-label={`Grade of ${street} decision ${i + 1}`} title={decisionNote(d)}>
                    {isGraded(d) ? <VerdictTag v={d.verdict as Verdict} /> : <span className="text-xs text-muted">not graded</span>}
                    {d.evLossBb != null && d.evLossBb > 0 && <span className="text-xs text-muted">−{fmt(d.evLossBb)}bb</span>}
                  </span>
                )}
                {link && (
                  <>
                    {" "}
                    <Link to={link} className="text-xs font-normal underline" aria-label={`Study ${street} decision ${i + 1}`}>
                      Study
                    </Link>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}
