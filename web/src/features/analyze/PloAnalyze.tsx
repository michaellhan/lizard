// Analyze for Pot-Limit Omaha (registry: PLO4): the PLO hands you've imported (pasted or picked here, or found in a
// Hold'em import), kept apart from Hold'em's, each street you acted on with what can grade it (omaha.ts): preflop never
// (PLO preflop isn't solved), a heads-up street with chips behind on a solve you run in Study, its grade kept here after,
// anything else said ungraded. Loaded in its own chunk only when the link names PLO.
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { GamePicker, NotForGame } from "@/components/GamePicker";
import { VerdictTag } from "@/components/VerdictTag";
import { addPloHands, deletePloHands, listPloHands, type PloHandRecord } from "@/data/ploHands";
import { PLO4 } from "@/engine/registry";
import { splitHands } from "@/hh/parse";
import { readOmaha, streetRows } from "./omaha";

const inputClass = "w-full min-w-0 rounded border border-border bg-surface px-2 py-1 font-mono text-xs";
const buttonClass = "rounded border border-border px-3 py-1 text-sm hover:bg-surface-2 disabled:opacity-40";
const ROWS = 100;

/** Histories as PLO hands to keep, and how many weren't. */
export function readOmahaFiles(texts: readonly string[], name: string, at = Date.now()): { hands: PloHandRecord[]; read: number; skipped: number; why: string[] } {
  const hands: PloHandRecord[] = [];
  const why = new Set<string>();
  let read = 0;
  for (const t of texts.flatMap((x) => splitHands(x))) {
    read++;
    const r = readOmaha(t, { name, at });
    if (typeof r === "string") why.add(r);
    else hands.push(r);
  }
  return { hands, read, skipped: read - hands.length, why: [...why] };
}

export function PloAnalyze() {
  const [hands, setHands] = useState<PloHandRecord[] | null>(null);
  const [text, setText] = useState("");
  const [said, setSaid] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [shown, setShown] = useState(ROWS);
  const [sure, setSure] = useState(false);
  const reload = () => void listPloHands().then(setHands);
  useEffect(reload, []);

  const take = async (texts: string[], name: string) => {
    const got = readOmahaFiles(texts, name);
    const kept = got.hands.length ? await addPloHands(got.hands) : { added: 0, existing: 0 };
    setSaid(
      `${got.read} ${got.read === 1 ? "hand" : "hands"} read: ${kept.added} new PLO ${kept.added === 1 ? "hand" : "hands"} kept${kept.existing ? `, ${kept.existing} kept before` : ""}${got.skipped ? `, ${got.skipped} skipped (${got.why.slice(0, 3).join(" ")})` : ""}.`,
    );
    reload();
  };

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Analyze</h1>
        <GamePicker page="analyze" current="plo4" />
      </div>
      <p className="text-sm text-muted">
        {PLO4.name}: your PLO hands, kept apart from Hold&apos;em&apos;s. A heads-up street with chips behind is graded on a solve you run in Study, from ranges you type ({PLO4.solverScope}); preflop and anything else is ungraded, and says so.
      </p>
      <NotForGame page="analyze" name="PLO" missing={PLO4.pages.analyze ?? []} />

      <details className="rounded border border-border p-3 text-sm" open={hands !== null && hands.length === 0}>
        <summary className="cursor-pointer">Import PLO hands</summary>
        <div className="mt-2 space-y-2">
          <p className="text-xs text-muted">Four-card pot-limit Omaha high, from PokerStars, GGPoker or the other sites Analyze reads. Omaha hands in a Hold&apos;em import land here too.</p>
          <textarea aria-label="PLO hand histories" rows={5} value={text} onChange={(e) => setText(e.target.value)} className={inputClass} spellCheck={false} />
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={buttonClass} disabled={!text.trim()} onClick={() => void take([text], "Pasted").then(() => setText(""))}>
              Import pasted
            </button>
            <label className={`${buttonClass} cursor-pointer`}>
              Pick files
              <input
                type="file"
                multiple
                accept=".txt,.log,.hh"
                className="sr-only"
                onChange={async (e) => {
                  const files = [...(e.target.files ?? [])];
                  if (files.length) await take(await Promise.all(files.map((f) => f.text())), files.length === 1 ? files[0]!.name : `${files.length} files`);
                }}
              />
            </label>
          </div>
          {said && (
            <p role="status" aria-label="Import result">
              {said}
            </p>
          )}
        </div>
      </details>

      {hands === null ? (
        <p className="text-sm text-muted">Reading the PLO hands kept here…</p>
      ) : hands.length === 0 ? (
        <p className="text-sm">No PLO hands kept yet.</p>
      ) : (
        <section aria-label="PLO hands" className="space-y-2">
          <p className="text-sm">
            {hands.length.toLocaleString("en-US")} PLO {hands.length === 1 ? "hand" : "hands"}, {hands.filter((h) => h.grades && Object.keys(h.grades).length).length.toLocaleString("en-US")} with a street graded. Not in a backup.
          </p>
          <div className="scroll-x">
            <table aria-label="PLO hands" className="w-full text-sm">
              <thead className="text-left text-muted">
                <tr>
                  <th className="py-1 pr-3 font-normal">Played</th>
                  <th className="py-1 pr-3 font-normal">Seat</th>
                  <th className="py-1 pr-3 font-normal">Cards</th>
                  <th className="py-1 pr-3 font-normal">Board</th>
                  <th className="py-1 font-normal">Graded</th>
                </tr>
              </thead>
              <tbody>
                {hands.slice(0, shown).map((h) => (
                  <HandRow key={h.id} h={h} open={open === h.id} onToggle={() => setOpen(open === h.id ? null : h.id)} />
                ))}
              </tbody>
            </table>
          </div>
          {hands.length > shown && (
            <button type="button" className={buttonClass} onClick={() => setShown((s) => s + ROWS)}>
              Show {Math.min(ROWS, hands.length - shown)} more
            </button>
          )}
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {sure ? (
              <>
                <span>Delete all {hands.length.toLocaleString("en-US")} PLO hands from this browser? It can&apos;t be undone.</span>
                <button
                  type="button"
                  className={`${buttonClass} text-danger`}
                  onClick={async () => {
                    await deletePloHands();
                    setSure(false);
                    reload();
                  }}
                >
                  Delete them
                </button>
                <button type="button" className={buttonClass} onClick={() => setSure(false)}>
                  Keep them
                </button>
              </>
            ) : (
              <button type="button" className={buttonClass} onClick={() => setSure(true)}>
                Delete the PLO hands
              </button>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

function HandRow({ h, open, onToggle }: { h: PloHandRecord; open: boolean; onToggle: () => void }) {
  const graded = Object.keys(h.grades ?? {}).length;
  return (
    <>
      <tr className="cursor-pointer border-t border-border hover:bg-surface-2" onClick={onToggle}>
        <td className="py-1 pr-3">
          <button type="button" aria-expanded={open} className="text-left underline-offset-2 hover:underline">
            {h.played || (h.number ? `#${h.number}` : "–")}
          </button>
        </td>
        <td className="py-1 pr-3">{h.hero}</td>
        <td className="py-1 pr-3 font-mono">{h.hole}</td>
        <td className="py-1 pr-3 font-mono">{h.board || "–"}</td>
        <td className="py-1">{graded ? `${graded} street${graded === 1 ? "" : "s"}` : "–"}</td>
      </tr>
      {open && (
        <tr>
          <td colSpan={5} className="pb-2">
            <StreetList h={h} />
          </td>
        </tr>
      )}
    </>
  );
}

function StreetList({ h }: { h: PloHandRecord }) {
  const rows = streetRows(h);
  return (
    <ul aria-label={`Streets of ${h.number ? `hand #${h.number}` : "this hand"}`} className="space-y-1 rounded bg-surface-2 p-2 text-sm">
      {rows.map((r) => (
        <li key={r.street}>
          <span className="font-medium">{r.street[0]!.toUpperCase() + r.street.slice(1)}</span>:{" "}
          {r.status === "ungraded" && <span className="text-muted">ungraded. {r.why}</span>}
          {r.status === "solve" && (
            <>
              not graded yet.{" "}
              <Link to={r.link!} className="underline">
                Solve it in Study to grade
              </Link>
            </>
          )}
          {r.status === "graded" && r.grade && (
            <>
              {r.grade.verdicts.map((v, i) => (
                <span key={i} className="mr-1">
                  <VerdictTag v={v} />
                </span>
              ))}
              {r.grade.loss > 0 ? `${r.grade.loss.toFixed(2)}bb given up` : "no EV given up"}, on a solve {r.grade.exploitabilityPct.toFixed(2)}% of the pot from equilibrium in its game, from your ranges
              {r.grade.ranges[0] ? ` (OOP ${r.grade.ranges[0]}, IP ${r.grade.ranges[1]})` : ""}.{" "}
              <Link to={r.link!} className="underline">
                Solve again
              </Link>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}
