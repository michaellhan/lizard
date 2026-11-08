// Analyze: your hand histories imported into this browser (pasted, or files and folders picked or dropped), read
// by the classic importer's port (hh/), kept in IndexedDB once each (data/hands.ts), under one row of filters in the
// URL that every report follows (FilterBar.tsx), and each hand replayed street by street with every decision of yours
// opening in Study; your decisions graded against the
// stored preflop solve or else the charts, and the flop library, or by triage or a solve (GradingPanel.tsx), each grade shown
// with what it stands on;
// your sittings and how the grades moved across them (SessionsPanel.tsx).
import { useDeferredValue, useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { Link, useSearchParams } from "react-router";
import { bringIntoView } from "@/components/scroll";
import { PhoneColumns } from "@/components/PhoneColumns";
import { PlayingCard } from "@/components/PlayingCard";
import { VerdictTag } from "@/components/VerdictTag";
import { recentSessions, type DecisionRecord, type HandRecord } from "@/data/db";
import { addHands, deleteImport, importsOf, listDecisions, listHands, putHandNotes, PRACTICE_SITE, type ImportSummary } from "@/data/hands";
import { readTags } from "@/data/saved";
import type { Verdict } from "@/grading/grade";
import { newId } from "@/data/saved";
import { HH_SITES } from "@/hh/parse";
import { finalSim, importHand, type ReplayedHand } from "@/hh/replay";
import { seatLabel, seatsOf } from "@/poker/seats";
import type { Move, Street } from "@/poker/table";
import { filesName, filterHands, filterKey, hhFiles, lostByHand, prepare, SKIP_TEXT, STREETS, studyLinkAt, type Prepared, type SkipKind } from "./analyze";
import { CLASSIC_SITE, classicRecords, readClassicHands, type ClassicImport } from "./classic";
import { decisionNote } from "./DecisionTables";
import { FilterBar } from "./FilterBar";
import { GradePanel, GradeReport } from "./GradingPanel";
import { leakParam, parseLeakParam } from "./leakDrill";
import { LeakDrill } from "./LeakDrillPanel";
import { decisionId } from "./grading";
import { isGraded, isOk, lostByKind } from "./report";
import { importTooBig } from "@/data/limits";
import { droppedFiles, entriesOf, type PickedFile } from "./dropped";
import { exploitImports, exploitsApartNote, isEquilibriumHand } from "./sessions";
import { SessionsPanel } from "./SessionsPanel";
import { StatsPanel } from "./StatsPanel";
import { WinningsPanel } from "./WinningsPanel";
import { LIMITS } from "@/features/solve/setup";
import { handOut } from "@/features/review/fromAnalyze";
import { ADD_RULE } from "@/features/review/schedule";
import { AddToReview } from "./AddToReview";
import { About } from "@/components/About";

/** hands listed before "Show all" */
export const ROW_LIMIT = 200;
/** the most listed at a press: tens of thousands of rows of cards would hold the page */
const ROW_STEP = 1000;
const NO_LOST: ReadonlyMap<string, number> = new Map();
const NO_EXPLOITS: ReadonlySet<string> = new Set();
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
  // (the `game` filter's: a kept hand doesn't say it was an exploit session's)
  const [exploits, setExploits] = useState(NO_EXPLOITS);
  const [n, setN] = useState(0);
  const reload = () => setN((x) => x + 1);
  useEffect(() => {
    let alive = true;
    void Promise.all([listHands(), listDecisions(), recentSessions("exploit", Infinity)]).then(([h, d, s]) => {
      if (!alive) return;
      setHands(h);
      setDecisions(d);
      setExploits(exploitImports(s));
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
  const drillParam = params.get("drill");
  const drill = useMemo(() => parseLeakParam(drillParam), [drillParam]);
  const open = id ? hands?.find((h) => h.id === id) : undefined;
  // (the filters apply to every report. Grading adds decisions hand by hand: what counts them follows at its own pace)
  const later = useDeferredValue(decisions);
  const lost = useMemo(() => lostByHand(later), [later]);
  const key = filterKey(params);
  const filters = useMemo(() => new URLSearchParams(key), [key]);
  // (the same hands, the same array, while the filters stand: opening a hand, or a grade, recounts nothing)
  const lostFor = filters.get("lost") ? lost : NO_LOST;
  const shown = useMemo(() => (hands ? filterHands(hands, filters, lostFor, exploits) : null), [hands, filters, lostFor, exploits]);
  const shownById = useMemo(() => new Map(shown?.map((h) => [h.id, h])), [shown]);
  const lossesShown = useMemo(() => lostByKind(later, shownById), [later, shownById]);
  // (an exploit session's hands stay listed and count nowhere: sessions.ts exploitsApartNote)
  const played = useMemo(() => (hands && exploits.size ? hands.filter((h) => !exploits.has(h.importId)) : hands), [hands, exploits]);
  // (what a leak is made of, as its drill deals: a tournament hand's decisions are in no leak)
  const leakHands = useMemo(() => played?.filter((h) => isEquilibriumHand(h, exploits)), [played, exploits]);
  const counted = useMemo(() => (shown && exploits.size ? shown.filter((h) => !exploits.has(h.importId)) : shown), [shown, exploits]);
  const countedById = useMemo(() => new Map(counted?.map((h) => [h.id, h])), [counted]);
  const losses = useMemo(() => lostByKind(later, countedById), [later, countedById]);
  const graded = useMemo(() => later.reduce((n, d) => n + Number(isGraded(d)), 0), [later]);
  const openDecisions = useMemo(() => (open ? decisions.filter((d) => d.handId === open.id) : []), [open, decisions]);
  const [result, setResult] = useState<Result | null>(null);
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

  const tab = tabOf(params);
  const total = useMemo(() => played?.reduce((n, h) => n + h.decisions, 0) ?? 0, [played]);
  const missed = useMemo(() => later.reduce((n, d) => n + Number(countedById.has(d.handId) && isGraded(d) && !isOk(d)), 0), [later, countedById]);
  const go = (t: Tab) => set({ tab: t === "hands" ? null : t });

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Analyze</h1>
        <p className="text-sm text-muted">Import your hand histories, replay them, and grade your decisions. Nothing leaves this browser.</p>
        <About>
          <p>
            Your hand histories are read and kept in this browser only; nothing is uploaded. Each hand replays street by street, and each of your decisions
            opens in Study at that point. Your decisions can be graded against the stored preflop solve where it reads the spot, else the preflop charts, and
            the flop library, or on every street by a Quick triage or a Fast solve, each grade saying what it stands on, and your sessions show how those
            grades moved over time.
          </p>
        </About>
      </div>
      {result && <ImportBanner r={result} onClose={() => setResult(null)} />}
      {hands === null || shown === null ? (
        <p className="text-sm text-muted">Reading the hands kept here…</p>
      ) : hands.length === 0 ? (
        <ImportPanel onImported={reload} setResult={setResult} />
      ) : (
        <>
          <Overview hands={hands.length} total={total} graded={graded} missed={missed} go={go} />
          <TabBar tab={tab} go={go} />
          <div role="tabpanel" id={`analyze-${tab}`} aria-labelledby={`analyze-tab-${tab}`} className="space-y-4">
            {tab !== "import" && (
              <FilterBar hands={hands} shown={shown} graded={graded} gradedShown={lossesShown.reduce((n, k) => n + k.graded, 0)} params={params} set={set} />
            )}
            {leakHands && counted && drill && <LeakDrill key={leakParam(drill)} leak={drill} decisions={decisions} hands={counted.filter((h) => isEquilibriumHand(h, exploits))} kept={leakHands} onClose={() => set({ drill: null })} />}
            {open && (
              <HandDetail
                hand={open}
                decisions={openDecisions}
                exploits={exploits}
                onSaved={(h) => setHands((prev) => prev && prev.map((x) => (x.id === h.id ? h : x)))}
                onClose={() => {
                  // (back to the Open that opened it, or, not listed now, the page's main)
                  const opener = [...document.querySelectorAll<HTMLElement>("[data-open-hand]")].find((b) => b.dataset.openHand === open.id);
                  (opener ?? document.getElementById("main"))?.focus();
                  set({ hand: null });
                }}
              />
            )}
            {id && !open && <p className="text-sm text-muted">That hand isn't kept in this browser (deleted, or imported in another).</p>}
            {tab === "hands" && (
              <>
                <HandsTable hands={hands} shown={shown} set={set} rowLimit={rowLimit} />
                {counted && counted.length < shown.length && <p className="text-sm text-muted">{exploitsApartNote(shown.length - counted.length)}</p>}
              </>
            )}
            {tab === "grades" && played && counted && (
              <>
                {played.length > 0 && <GradePanel hands={params.get("sess") ? counted : played} decisions={decisions} onGraded={onGraded} />}
                <GradeReport decisions={later} hands={counted} of={played.length} exploits={exploits} />
              </>
            )}
            {tab === "results" && counted && (counted.length > 0 ? <WinningsPanel hands={counted} of={played?.length ?? hands.length} losses={losses} /> : <Nothing />)}
            {tab === "stats" && counted && (counted.length > 0 ? <StatsPanel hands={counted} of={played?.length ?? hands.length} /> : <Nothing />)}
            {tab === "sessions" && played && (played.length > 0 ? <SessionsPanel hands={played} decisions={decisions} params={params} lost={lost} exploits={exploits} set={set} /> : <Nothing />)}
            {tab === "import" && (
              <>
                <ImportPanel onImported={reload} setResult={setResult} />
                <Imports hands={hands} onChange={reload} />
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// The page's views, one at a time, in the URL (`tab`; Hands when it's absent, the grades when a leak drill is open)
const TABS = [
  ["hands", "Hands"],
  ["grades", "Grades & leaks"],
  ["results", "Results"],
  ["stats", "Stats"],
  ["sessions", "Sessions"],
  ["import", "Import"],
] as const;
export type Tab = (typeof TABS)[number][0];
export const tabOf = (p: URLSearchParams): Tab => {
  const t = p.get("tab");
  return TABS.some(([k]) => k === t) ? (t as Tab) : p.get("drill") ? "grades" : "hands";
};

function TabBar({ tab, go }: { tab: Tab; go: (t: Tab) => void }) {
  const at = TABS.findIndex(([k]) => k === tab);
  const key = (e: KeyboardEvent) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    const to = e.key === "Home" ? 0 : e.key === "End" ? TABS.length - 1 : step ? (at + step + TABS.length) % TABS.length : -1;
    if (to < 0) return;
    e.preventDefault();
    go(TABS[to]![0]);
    document.getElementById(`analyze-tab-${TABS[to]![0]}`)?.focus();
  };
  return (
    <div role="tablist" aria-label="Analyze views" onKeyDown={key} className="scroll-x flex gap-1 border-b border-border">
      {TABS.map(([k, label]) => (
        <button
          key={k}
          id={`analyze-tab-${k}`}
          type="button"
          role="tab"
          aria-selected={k === tab}
          aria-controls={`analyze-${k}`}
          tabIndex={k === tab ? 0 : -1}
          onClick={() => go(k)}
          className={`-mb-px whitespace-nowrap border-b-2 px-3 py-1.5 text-sm ${k === tab ? "border-accent font-medium text-text" : "border-transparent text-muted hover:text-text"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** What's here and the one thing to do next: grade, then review what the grades found. */
function Overview({ hands, total, graded, missed, go }: { hands: number; total: number; graded: number; missed: number; go: (t: Tab) => void }) {
  const tile = (label: string, value: string, sub?: string) => (
    <div className="min-w-0 rounded-lg border border-border bg-surface px-2 py-2 sm:min-w-32 sm:px-3">
      <div className="text-xs text-muted">{label}</div>
      <div className="whitespace-nowrap text-lg font-semibold tabular-nums sm:text-xl">{value}</div>
      {sub && <div className="hidden text-xs text-muted sm:block">{sub}</div>}
    </div>
  );
  const next: [string, Tab] = !graded ? ["Grade your decisions", "grades"] : missed ? [`Review ${missed.toLocaleString()} ${missed === 1 ? "miss" : "misses"}`, "grades"] : ["Import more hands", "import"];
  return (
    <section aria-label="Overview" className="grid grid-cols-3 items-stretch gap-2 sm:flex sm:flex-wrap">
      {tile("Hands kept", hands.toLocaleString())}
      {tile("Decisions graded", `${graded.toLocaleString()} of ${total.toLocaleString()}`, graded ? undefined : "none yet")}
      {graded > 0 && tile("Outside the mix", missed.toLocaleString(), "Inaccuracy, Mistake or Blunder")}
      <div className="col-span-3 flex items-center">
        <button type="button" onClick={() => (go(next[1]), graded > 0 && missed > 0 && reveal("analyze-misses"))} className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-bg">
          {next[0]}
        </button>
      </div>
    </section>
  );
}

/** Scrolls to an element once the tab that holds it has drawn it (grading a few thousand hands' report takes a moment). */
function reveal(id: string, tries = 60) {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView?.({ block: "start" }); // (jsdom has none)
  else if (tries > 0) setTimeout(() => reveal(id, tries - 1), 50);
}

function Nothing() {
  return <p className="text-sm text-muted">None of the hands the filters show counts here.</p>;
}

/** The last import's result, wherever the page is, until closed. */
function ImportBanner({ r, onClose }: { r: Result; onClose: () => void }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-accent/40 bg-surface p-3">
      <div className="min-w-0 flex-1">
        <ImportResult r={r} />
      </div>
      <button type="button" onClick={onClose} aria-label="Close the import result" className="rounded px-1 text-muted hover:text-text">
        ✕
      </button>
    </div>
  );
}

type ClassicResult = { none: true } | { none?: undefined; from: string; read: number; imported: ClassicImport; kept: { added: number; existing: number } | null };

function ImportPanel({ onImported, setResult }: { onImported: () => void; setResult: (r: Result | null) => void }) {
  const [text, setText] = useState("");
  const [classic, setClassic] = useState<ClassicResult | null>(null);
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null);
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
  // the classic app's My hands in this browser, read only (classic.ts)
  const fromClassic = async () => {
    setError(null);
    setResult(null);
    setClassic(null);
    setBusy({ done: 0, total: 0 });
    try {
      const got = await readClassicHands();
      if (!got || !got.recs.length) {
        setClassic({ none: true });
        return;
      }
      const imported = classicRecords(got.recs, Date.now());
      const kept = imported.hands.length ? await addHands(imported.hands) : { added: 0, existing: 0 };
      setClassic({ from: got.from, read: got.recs.length, imported, kept });
      if (kept?.added) onImported();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  const readFiles = async (list: Iterable<PickedFile> | null) => {
    const all = [...(list ?? [])];
    const picked = hhFiles(all);
    if (!picked.length) {
      setError(all.length ? `None of the ${all.length} files is a hand history (.txt, .xml, .log, .hh, or PokerNow's .json).` : "No files picked.");
      return;
    }
    const big = importTooBig(picked.reduce((n, f) => n + (f.size ?? 0), 0), "Import the files a few at a time.");
    if (big) {
      setError(big);
      return;
    }
    const files = await Promise.all(picked.map(async (f) => ({ name: f.webkitRelativePath || f.name, text: await f.text() })));
    await run(files, filesName(picked));
  };
  const drop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    // (a dropped folder is read through: its entries are taken now, while the drop lasts)
    const entries = entriesOf(e.dataTransfer);
    const files = [...e.dataTransfer.files];
    void droppedFiles(entries, files)
      .then(readFiles)
      .catch((x: unknown) => setError(`The dropped folder couldn't be read: ${x instanceof Error ? x.message : String(x)}`));
  };

  return (
    <section aria-label="Import" className="space-y-2 rounded-lg border border-border bg-surface p-3">
      <h2 className="text-lg font-semibold">Import hands</h2>
      <p className="text-xs text-muted">Reads {HH_SITES.join(", ")} hand histories, as your poker client saves them (PokerNow: its hands download, a .json file); Hold'em only.</p>
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
          placeholder="Paste one hand history or many, or drop files or a folder here"
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
          <label className="cursor-pointer rounded border border-border px-3 py-1 hover:bg-surface-2 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent">
            Choose files…
            <input
              type="file"
              multiple
              accept=".txt,.xml,.log,.hh,.json,text/plain,application/json"
              aria-label="Choose hand-history files"
              className="sr-only"
              disabled={!!busy}
              onChange={(e) => void readFiles(e.target.files).then(() => (e.target.value = ""))}
            />
          </label>
          <label className="cursor-pointer rounded border border-border px-3 py-1 hover:bg-surface-2 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent">
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
      <About label="Used the older gto-solver site in this browser?">
        <p>
          <button type="button" disabled={!!busy} onClick={() => void fromClassic()} className="rounded border border-border px-2 py-0.5 text-text hover:bg-surface-2 disabled:opacity-40">
            Import its My hands
          </button>{" "}
          Read only: that site&rsquo;s data is left as it is. Your tags and notes come along; its grades don&rsquo;t (graded again here).
        </p>
      </About>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {classic && <ClassicResultLine r={classic} />}
    </section>
  );
}

function ClassicResultLine({ r }: { r: ClassicResult }) {
  if (r.none) return <p role="status" className="text-sm">The older gto-solver site keeps no hands in this browser.</p>;
  const left = Object.entries(r.imported.skipped);
  const n = (x: number, one: string, many = `${one}s`) => `${x.toLocaleString()} ${x === 1 ? one : many}`;
  return (
    <p role="status" className="text-sm">
      From the older gto-solver site ({r.from}): {n(r.read, "hand")} read; {n(r.kept?.added ?? 0, "hand")} imported
      {r.kept?.existing ? `, ${n(r.kept.existing, "hand")} already here` : ""}
      {left.length ? `; left out: ${left.map(([why, k]) => `${why} (${k})`).join(", ")}` : ""}.
    </p>
  );
}

// (each file's count; past a few files, folded away like the unreadable hands)
const FEW_FILES = 8;
function FileList({ files }: { files: NonNullable<Prepared["files"]> }) {
  const list = (
    <ul className="text-xs text-muted">
      {files.map((f, i) => (
        <li key={i}>
          {f.name}: {f.total} read, {f.hands} to keep
        </li>
      ))}
    </ul>
  );
  if (files.length <= FEW_FILES) return list;
  return (
    <details className="text-xs">
      <summary className="cursor-pointer">Each file ({files.length.toLocaleString()})</summary>
      <div className="mt-1">{list}</div>
    </details>
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
      {prep.files && <FileList files={prep.files} />}
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
  set,
  rowLimit,
}: {
  hands: HandRecord[];
  /** the hands the filters show */
  shown: HandRecord[];
  set: (o: Record<string, string | null>) => void;
  rowLimit: number;
}) {
  const [limit, setLimit] = useState(rowLimit);
  if (!hands.length)
    return (
      <p className="rounded-lg border border-border bg-surface p-3 text-sm text-muted">
        No hands kept yet: import some in the Import tab.
      </p>
    );
  const listed = shown.slice(0, limit);
  const rest = shown.length - listed.length;
  return (
    <section aria-label="Hands" className="space-y-2">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <h2 className="text-lg font-semibold">Hands</h2>
        <span className="text-muted">
          {shown.length.toLocaleString()} of {hands.length.toLocaleString()}
        </span>
      </div>
      {/* (relative: the sr-only header's absolute box stays inside the scrolling box, not widening the page) */}
      <PhoneColumns hidden={["Site", "Big blind"]}>
      <div className="relative scroll-x rounded-lg border border-border">
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
              <th className="phone-col px-2 py-1">Site</th>
              <th className="phone-col px-2 py-1">Big blind</th>
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
                <td className="phone-col px-2 py-1">{h.site}</td>
                <td className="phone-col whitespace-nowrap px-2 py-1">
                  {h.bb}
                  {h.tournament ? <span className="text-xs text-muted"> MTT</span> : null}
                </td>
                <td className="px-2 py-1">
                  <button type="button" data-open-hand={h.id} onClick={() => set({ hand: h.id })} className="underline">
                    Open
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </PhoneColumns>
      {!shown.length && <p className="text-sm text-muted">No hand kept matches these filters.</p>}
      {rest > 0 && (
        <p className="text-sm text-muted">
          {listed.length.toLocaleString()} of {shown.length.toLocaleString()} hands listed, the latest played first.{" "}
          <button type="button" onClick={() => setLimit(limit + ROW_STEP)} className="underline">
            {rest <= ROW_STEP ? `Show all ${shown.length.toLocaleString()} hands` : `Show ${ROW_STEP.toLocaleString()} more`}
          </button>
        </p>
      )}
    </section>
  );
}

function HandDetail({ hand, decisions, exploits, onSaved, onClose }: { hand: HandRecord; decisions: DecisionRecord[]; exploits: ReadonlySet<string>; onSaved: (h: HandRecord) => void; onClose: () => void }) {
  const graded = useMemo(() => new Map(decisions.map((d) => [d.id, d])), [decisions]);
  const box = useRef<HTMLElement>(null);
  // (opened from the table below it: brought into view, with the keyboard where its Open had it, and not on a link's first load)
  useEffect(() => {
    bringIntoView(box.current);
    if (document.activeElement?.closest("[data-open-hand]")) box.current?.focus({ preventScroll: true });
  }, [hand.id]);
  const r = useMemo((): ReplayedHand | string => {
    try {
      return importHand(hand.text);
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  }, [hand.text]);
  if (typeof r === "string")
    return (
      <section ref={box} tabIndex={-1} aria-label="Hand" className="rounded-lg border border-border bg-surface p-3 text-sm">
        <p role="alert">This hand can't be read again: {r}</p>
      </section>
    );
  const h = r.hand;
  const sim = finalSim(r);
  const out = handOut(hand, exploits);
  const misses = decisions.some((d) => isGraded(d) && !isOk(d));
  const stacks = Object.entries(r.setup.stacks);
  const even = stacks.every(([, v]) => v === stacks[0]![1]);
  return (
    <section ref={box} tabIndex={-1} aria-label="Hand" className="scroll-mt-16 space-y-3 rounded-lg border border-border bg-surface p-3 text-sm">
      <div className="flex flex-wrap items-start gap-2">
        <div className="space-y-0.5">
          <h2 className="text-lg font-semibold">
            {hand.site} hand{hand.number ? ` #${hand.number}` : ""}
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
          <StreetRow key={st} r={r} street={st} graded={(i) => graded.get(decisionId(hand.id, st, i))} hand={out ? null : hand} />
        ))}
      </ol>
      <p className="text-muted">
        Pot {fmt(sim.pot)}bb ({hand.end}). {hand.site === PRACTICE_SITE
          ? `A hand you played in Practice${hand.playedFor ? ", preflop played for you from the charts" : ""}`
          : hand.site === CLASSIC_SITE
            ? "A hand from My hands on the older gto-solver site"
            : "From your hand history"}
        , replayed on Lizard's table.
        {decisions.length
          ? hand.playedFor
            ? " Grades: each move from the flop against what answered it, which its grade names."
            : ` Grades: ${decisions.some((d) => d.street === "preflop" && d.source === "preflop-solve") ? "your preflop moves as each is marked, the preflop solve (by EV, a class-level model, not a full solve) or the preflop charts (by frequency, not a solve)" : "your preflop moves against the preflop charts (by frequency, not a solve)"}; after the flop, each move against what answered it, which its grade names.`
          : " None of your decisions here is graded yet."}
        {hand.revealed?.length ? ` ${hand.revealed.length === 1 ? "One decision here was" : `${hand.revealed.length} decisions here were`} made after Reveal in Practice, so ${hand.revealed.length === 1 ? "it isn't" : "they aren't"} graded.` : ""}
        {h.ante > LIMITS.ante && ` Study can't set up an ante over ${LIMITS.ante}bb a seat, so its decisions don't open in Study.`}
        {h.tournament && " A tournament hand: Study answers it in chips, with no ICM or bounties; “with prizes” opens a decision on the Tournaments page, to add the prizes left and any bounties."}
      </p>
      {misses && <p className="text-xs text-muted">{out ?? ADD_RULE}</p>}
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

/** `hand`: the kept hand, where its decisions can go to Review. */
function StreetRow({ r, street, graded, hand }: { r: ReplayedHand; street: Street; graded: (i: number) => DecisionRecord | undefined; hand: HandRecord | null }) {
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
            const link = you ? studyLinkAt(r, street, i, hand?.setup) : null;
            const d = you ? graded(i) : undefined;
            return (
              <li key={i} className={you ? "font-semibold" : "text-muted"}>
                {say(m)}
                {d && (
                  <span role="group" className="ml-1 inline-flex items-center gap-1 font-normal" aria-label={`Grade of ${street} decision ${i + 1}`} title={decisionNote(d)}>
                    {isGraded(d) ? <VerdictTag v={d.verdict as Verdict} /> : <span className="text-xs text-muted">not graded</span>}
                    {d.evLossBb != null && d.evLossBb > 0 && <span className="text-xs text-muted">−{d.roughEv ? "≈" : ""}{fmt(d.evLossBb)}bb</span>}
                    {street === "preflop" && isGraded(d) && (d.source === "preflop-solve" || d.source === "charts") && <span className="text-xs text-muted">{d.source === "charts" ? "charts" : "preflop solve"}</span>}
                    {hand && isGraded(d) && !isOk(d) && <AddToReview d={d} hand={hand} r={r} name={`${street} decision ${i + 1}`} />}
                  </span>
                )}
                {link && (
                  <>
                    {" "}
                    <Link to={link} className="text-xs font-normal underline" aria-label={`Study ${street} decision ${i + 1}`}>
                      Study
                    </Link>
                    {h.tournament && (
                      <>
                        {" "}
                        <Link to={link.replace(/^\/study\?/, "/tournaments?")} className="text-xs font-normal underline" aria-label={`Set up ${street} decision ${i + 1} as a tournament`}>
                          with prizes
                        </Link>
                      </>
                    )}
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
