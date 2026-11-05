// Study's range builder: paint the actor's strategy at this node hand class by hand class, then score it against
// the answer's own (features/ranges/build.ts). Painting: pick a brush (an action, at a share of the hand) and click
// or drag over hands; keys 1-9 pick a brush, Ctrl/Cmd+Z undoes, Shift+Ctrl/Cmd+Z or Ctrl+Y redoes. The lock tool
// keeps hands from being painted. A group of hands (a shape, or a made-hand or draw category where the answer has its
// combos) takes the brush or the lock at once, and so do hands typed as range text. Each scored range is kept in
// IndexedDB (sessions, kind "build").
import { memo, useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { classLabel, RANKS } from "@/engine/nlhe/cards";
import { ProvenanceBadge } from "@/components/ProvenanceBadge";
import { pct } from "@/components/actions";
import { useRovingGrid } from "@/components/rovingGrid";
import { putSession, recentSessions, type SessionRecord } from "@/data/db";
import { useSettings } from "@/state/settings";
import type { AdvisorResponse, GridCell, RangeGridData } from "@/solver/protocol";
import type { Provenance } from "@/solver/types";
import { studyKeyFrom } from "./studyState";
import {
  actionShares,
  AMOUNTS,
  amend,
  biggestMisses,
  blankPaint,
  grade,
  historyOf,
  paintClasses,
  paintWeights,
  passiveOf,
  record,
  redo,
  scoreBuild,
  scoreByCombo,
  SHAPES,
  undo,
  type BuildScore,
  type ComboScore,
  type History,
  type Paint,
} from "@/features/ranges/build";
import { formatRange, parseRange } from "@/features/ranges/rangeText";
import { catsOf, classesIn } from "./filters";

/** What a node's builder keeps while Study moves on and back (by the node's request). */
export interface BuildSaved {
  h: History<Paint>;
  locked: string[];
  scored: boolean;
}

interface Scores {
  cls: BuildScore;
  combo: ComboScore | null;
}

type Tool = number | "lock";

/** a press-and-drag over hands: the hands it has touched, whether it has its undo step, what the lock tool sets */
interface Stroke {
  done: Set<string>;
  recorded: boolean;
  lockTo?: boolean;
}

const segs = (f: readonly number[], colors: readonly string[]) =>
  f.map((x, a) => (x > 0.0005 ? <div key={a} style={{ width: `${x * 100}%`, background: colors[a] }} /> : null));

/** A hand in the builder in words: your paint, and once scored the solver's and how far off. */
const buildLabel = (cls: string, on: boolean, cell: GridCell | undefined, mine: number[] | undefined, names: readonly string[], locked: boolean, score?: BuildScore["cells"][string]) =>
  !on
    ? `${cls}: not in range`
    : `${cls}: yours ${mixText(mine!, names)}${score ? `; solver ${mixText(cell!.f, names)}; ${pct(score.off, 0)} different` : ""}${locked ? "; locked" : ""}`;

const mixText = (f: readonly number[], names: readonly string[]) =>
  names
    .map((n, a) => ((f[a] ?? 0) >= 0.005 ? `${n} ${pct(f[a], 0)}` : null))
    .filter(Boolean)
    .join(", ");

export function BuildMode({
  res,
  provenance,
  colors,
  lineKey,
  lineLabel,
  stored,
  onStore,
  onExit,
}: {
  res: AdvisorResponse & { grid: RangeGridData };
  provenance: Provenance;
  colors: readonly string[];
  /** the node, as Study's URL search (past scores are matched on it) */
  lineKey: string;
  lineLabel: string;
  stored?: BuildSaved;
  onStore: (s: BuildSaved) => void;
  onExit: () => void;
}) {
  const g = res.grid;
  const names = g.actions;
  const d = passiveOf(names);
  const [h, setH] = useState<History<Paint>>(() => stored?.h ?? historyOf(blankPaint(g)));
  const hRef = useRef(h);
  const [locked, setLocked] = useState<ReadonlySet<string>>(() => new Set(stored?.locked ?? []));
  const lockedRef = useRef(locked);
  const [tool, setTool] = useState<Tool>(0);
  const [amt, setAmt] = useState<number>(1);
  const [scored, setScored] = useState(stored?.scored ?? false);
  const [selected, setSelected] = useState<string | null>(null);
  const [past, setPast] = useState<SessionRecord[]>([]);
  const [saved, setSaved] = useState(0);
  const keys = useSettings((st) => st.studyKeys);
  const stroke = useRef<Stroke | null>(null);
  // a group of hands painted at once: "s:<shape>", or a category's "m:<id>" / "d:<id>"
  const cats = useMemo(() => catsOf(res), [res]);
  const [group, setGroup] = useState("s:pairs");
  const inGroup = useMemo(() => {
    const shape = group.startsWith("s:") ? SHAPES.find((x) => x.key === group.slice(2)) : undefined;
    const classes = shape ? Object.keys(g.cells).filter(shape.has) : classesIn(res, group);
    return classes.filter((cls) => (g.cells[cls]?.w ?? 0) > 0);
  }, [g, res, group]);

  const scores = useMemo<Scores | null>(
    () => (scored ? { cls: scoreBuild(res, h.now), combo: scoreByCombo(res, h.now) } : null),
    [scored, res, h.now],
  );
  const now = useMemo(() => (scores ? scores.cls : scoreBuild(res, h.now)), [scores, res, h.now]);

  // keep what's painted for when Study comes back to this node
  const store = useEffectEvent((v: BuildSaved) => onStore(v));
  useEffect(() => {
    store({ h, locked: [...locked], scored });
  }, [h, locked, scored]);

  useEffect(() => {
    let alive = true;
    void recentSessions("build", 200).then((all) => alive && setPast(all.filter((s) => s.meta.line === lineKey).slice(0, 5)));
    return () => {
      alive = false;
    };
  }, [lineKey, saved]);

  // the paint and the locks are read from refs in handlers: a drag paints faster than React renders
  const commit = useCallback((next: History<Paint>) => {
    if (next === hRef.current) return;
    hRef.current = next;
    setH(next);
  }, []);
  const setLocks = useCallback((next: ReadonlySet<string>) => {
    lockedRef.current = next;
    setLocked(next);
  }, []);

  /** a hand under the brush: painted (one undo step a stroke), or with the lock tool locked or unlocked */
  const touch = useCallback(
    (cls: string) => {
      const c = g.cells[cls];
      if (scored || !c || !(c.w > 0)) return;
      const s = stroke.current;
      if (s) {
        if (s.done.has(cls)) return;
        s.done.add(cls);
      }
      if (tool === "lock") {
        const cur = lockedRef.current;
        const to = s ? (s.lockTo ??= !cur.has(cls)) : !cur.has(cls);
        if (cur.has(cls) === to) return;
        const next = new Set(cur);
        if (to) next.add(cls);
        else next.delete(cls);
        setLocks(next);
        return;
      }
      const cur = hRef.current;
      const next = paintClasses(cur.now, [cls], tool, amt, d, lockedRef.current);
      if (s?.recorded) commit(amend(cur, next));
      else {
        const r = record(cur, next);
        if (s && r !== cur) s.recorded = true;
        commit(r);
      }
    },
    [g, scored, tool, amt, d, commit, setLocks],
  );
  const strokeStart = useCallback(
    (cls: string) => {
      stroke.current = { done: new Set(), recorded: false };
      touch(cls);
    },
    [touch],
  );
  const strokeEnd = useCallback(() => {
    stroke.current = null;
  }, []);
  const onSelect = useCallback((cls: string) => setSelected((s) => (s === cls ? null : cls)), []);
  // the hand painted from the keyboard, said once painted
  const [pressed, setPressed] = useState<string | null>(null);
  const onPress = useCallback(
    (cls: string) => {
      touch(cls);
      setPressed(cls);
    },
    [touch],
  );

  const fillAll = () => {
    if (tool === "lock") return;
    commit(record(hRef.current, paintClasses(hRef.current.now, Object.keys(hRef.current.now), tool, amt, d, lockedRef.current)));
  };
  // the group: painted (but its locked hands) as one undo step, or with the lock tool all locked (all unlocked when
  // they all are)
  const groupLocked = inGroup.length > 0 && inGroup.every((cls) => locked.has(cls));
  const groupFree = inGroup.filter((cls) => !locked.has(cls));
  const paintGroup = () => {
    if (tool !== "lock") {
      commit(record(hRef.current, paintClasses(hRef.current.now, inGroup, tool, amt, d, lockedRef.current)));
      return;
    }
    const next = new Set(lockedRef.current);
    for (const cls of inGroup) {
      if (groupLocked) next.delete(cls);
      else next.add(cls);
    }
    setLocks(next);
  };
  const groupN = tool === "lock" ? inGroup.length : groupFree.length;

  // hands typed as range text: the brush's action at each one's weight (none: all of it), as one undo step
  const [text, setText] = useState("");
  const [textMsg, setTextMsg] = useState<string | null>(null);
  const paintText = () => {
    if (tool === "lock") return;
    const r = parseRange(text);
    const listed = Object.keys(r.weights).filter((cls) => (r.weights[cls] ?? 0) > 0);
    const out = listed.filter((cls) => !hRef.current.now[cls]);
    const held = listed.filter((cls) => hRef.current.now[cls] && lockedRef.current.has(cls));
    const n = listed.length - out.length - held.length;
    commit(record(hRef.current, paintWeights(hRef.current.now, r.weights, tool, d, lockedRef.current)));
    setTextMsg(
      [
        `Painted ${n} hand${n === 1 ? "" : "s"} ${names[tool]}`,
        out.length ? `${out.length} not in this range` : "",
        held.length ? `${held.length} locked, left as ${held.length === 1 ? "it was" : "they were"}` : "",
        r.combos.length ? "single combos as their share of the class" : "",
        r.unknown.length ? `not understood: ${r.unknown.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join("; ") + ".",
    );
  };
  const reset = () => {
    commit(record(hRef.current, blankPaint(g)));
    setLocks(new Set());
  };

  const check = () => {
    const cls = scoreBuild(res, hRef.current.now);
    const combo = scoreByCombo(res, hRef.current.now);
    setScored(true);
    setSelected(null);
    const t = Date.now();
    void putSession({
      id: `build-${t}-${Math.random().toString(36).slice(2, 8)}`,
      kind: "build",
      startedAt: t,
      endedAt: t,
      decisions: 1,
      evLossBb: cls.ev_loss_bb ?? 0,
      meta: {
        line: lineKey,
        label: lineLabel,
        actor: res.actor,
        street: res.street,
        acc: cls.acc,
        evLossBb: cls.ev_loss_bb,
        evLossPct: cls.ev_loss_pct,
        comboAcc: combo?.acc ?? null,
        source: provenance.source,
        approximate: provenance.approximate,
      },
    }).then(() => setSaved((n) => n + 1));
  };

  // keys: 1-9 a brush (with Study's keys on, from the page or the grid, not from another control), Ctrl/Cmd+Z undo,
  // Shift+Ctrl/Cmd+Z or Ctrl+Y redo (not while typing)
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    const el = e.target as HTMLElement | null;
    if (el && ["INPUT", "SELECT", "TEXTAREA"].includes(el.tagName)) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && (e.key === "z" || e.key === "Z")) {
      e.preventDefault();
      if (!scored) commit(e.shiftKey ? redo(hRef.current) : undo(hRef.current));
    } else if (mod && (e.key === "y" || e.key === "Y")) {
      e.preventDefault();
      if (!scored) commit(redo(hRef.current));
    } else if (!mod && !e.altKey && /^[1-9]$/.test(e.key) && +e.key <= names.length && !scored && keys && (el?.closest?.('[role="gridcell"]') || studyKeyFrom(el, e.key))) setTool(+e.key - 1);
  });
  useEffect(() => {
    const on = (e: KeyboardEvent) => onKey(e);
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);

  const graded = provenance.source === "charts" ? "Graded against the preflop charts: an approximation, not a solve." : provenance.approximate ? "Graded against an approximate answer, not a converged solve." : null;
  const misses = scores ? biggestMisses(scores.cls) : [];
  const sel = selected && g.cells[selected]?.w ? selected : null;
  const spoken = scores ? sel : pressed;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <section aria-label="Build" className="space-y-2">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <strong>{res.actor}</strong>
          <span className="text-muted">
            {now.combos.toFixed(1)} combos · {scored ? "the solver's mix above yours" : "your paint"}
          </span>
        </div>
        <BuildMatrix
          grid={g}
          paint={h.now}
          colors={colors}
          locked={locked}
          cells={scores?.cls.cells}
          selected={sel}
          onTouch={touch}
          onPress={onPress}
          onStrokeStart={strokeStart}
          onStrokeEnd={strokeEnd}
          onSelect={onSelect}
          caption={`${res.actor} range, ${scored ? "scored" : "being painted"}`}
        />
        {/* (what the panel now shows of the hand picked, or the hand as painted) */}
        <p role="status" className="sr-only">
          {spoken ? buildLabel(spoken, Boolean(h.now[spoken]), g.cells[spoken], h.now[spoken], names, locked.has(spoken), scores?.cls.cells[spoken]) : ""}
        </p>
      </section>

      <aside className="space-y-3 text-sm">
        {!scores ? (
          <div className="space-y-3 rounded-lg border border-border bg-surface p-3">
            <p>
              Paint {res.actor}'s strategy: pick an action, then click or drag over hands. Unpainted hands {names[d]}.
            </p>
            <div role="group" aria-label="Brush" className="flex flex-wrap gap-1.5">
              {names.map((n, a) => (
                <button
                  key={n}
                  type="button"
                  aria-pressed={tool === a}
                  title={`Key ${a + 1}`}
                  onClick={() => setTool(a)}
                  className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 ${tool === a ? "border-accent ring-1 ring-accent" : "border-border hover:bg-surface-2"}`}
                >
                  <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: colors[a] }} />
                  {n}
                </button>
              ))}
              <button
                type="button"
                aria-pressed={tool === "lock"}
                title="Click or drag over hands to lock them (no brush paints a locked hand), again to unlock"
                onClick={() => setTool("lock")}
                className={`rounded-md border px-2.5 py-1 ${tool === "lock" ? "border-accent ring-1 ring-accent" : "border-border hover:bg-surface-2"}`}
              >
                Lock
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div role="group" aria-label="Brush amount" className="segmented inline-flex overflow-hidden rounded-md border border-border">
                {AMOUNTS.map((t) => (
                  <button
                    key={t}
                    type="button"
                    aria-pressed={amt === t}
                    disabled={tool === "lock"}
                    onClick={() => setAmt(t)}
                    className={`px-2 py-0.5 disabled:opacity-40 ${amt === t ? "bg-surface-3" : "hover:bg-surface-2"}`}
                  >
                    {t * 100}%
                  </button>
                ))}
              </div>
              <button type="button" onClick={fillAll} disabled={tool === "lock"} title="Paint every hand (but the locked ones) with this brush" className="rounded border border-border px-2 py-0.5 hover:bg-surface-2 disabled:opacity-40">
                Fill all
              </button>
              <button type="button" onClick={reset} className="rounded border border-border px-2 py-0.5 hover:bg-surface-2">
                Reset
              </button>
              <button type="button" onClick={() => commit(undo(hRef.current))} disabled={!h.past.length} title="Undo (Ctrl/Cmd+Z)" className="rounded border border-border px-2 py-0.5 hover:bg-surface-2 disabled:opacity-40">
                Undo
              </button>
              <button type="button" onClick={() => commit(redo(hRef.current))} disabled={!h.future.length} title="Redo (Shift+Ctrl/Cmd+Z)" className="rounded border border-border px-2 py-0.5 hover:bg-surface-2 disabled:opacity-40">
                Redo
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label="Hands to paint at once"
                title="A group of hands to paint or lock at once. A hand class goes whole: in a made-hand or draw category when at least half its combos here are in it"
                value={group}
                onChange={(e) => setGroup(e.target.value)}
                className="rounded border border-border bg-surface-2 px-2 py-0.5"
              >
                <optgroup label="Hand shapes">
                  {SHAPES.map((x) => (
                    <option key={x.key} value={`s:${x.key}`}>
                      {x.label}
                    </option>
                  ))}
                </optgroup>
                {(["m", "d"] as const).map((part) => {
                  const cs = cats.filter((c) => c.part === part);
                  return cs.length ? (
                    <optgroup key={part} label={part === "m" ? "Made hands" : "Draws"}>
                      {cs.map((c) => (
                        <option key={c.key} value={c.key}>
                          {c.label}
                        </option>
                      ))}
                    </optgroup>
                  ) : null;
                })}
              </select>
              <button
                type="button"
                onClick={paintGroup}
                disabled={!groupN}
                title={inGroup.join(" ")}
                className="rounded border border-border px-2 py-0.5 hover:bg-surface-2 disabled:opacity-40"
              >
                {tool === "lock" ? (groupLocked ? "Unlock" : "Lock") : "Paint"} {groupN} hand{groupN === 1 ? "" : "s"}
              </button>
            </div>
            <details className="rounded border border-border px-2 py-1">
              <summary className="cursor-pointer text-xs text-muted">As range text</summary>
              <div className="mt-2 space-y-2">
                <label htmlFor="build-text" className="block text-xs">
                  Hands that play {tool === "lock" ? "a brush (pick one)" : names[tool]}, each at its weight (none: all of it)
                </label>
                <textarea
                  id="build-text"
                  rows={2}
                  value={text}
                  placeholder="QQ+, AKs, A5s:0.5"
                  onChange={(e) => setText(e.target.value)}
                  className="w-full rounded border border-border bg-surface-2 p-1.5 font-mono text-xs"
                />
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={paintText} disabled={tool === "lock" || !text.trim()} className="rounded border border-border px-2 py-0.5 hover:bg-surface-2 disabled:opacity-40">
                    Paint these
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (tool === "lock") return;
                      setText(formatRange(actionShares(hRef.current.now, tool)));
                      setTextMsg(null);
                    }}
                    disabled={tool === "lock"}
                    className="rounded border border-border px-2 py-0.5 hover:bg-surface-2 disabled:opacity-40"
                  >
                    Your {tool === "lock" ? "brush's" : names[tool]} hands
                  </button>
                </div>
                {textMsg && (
                  <p role="status" className="text-xs text-muted">
                    {textMsg}
                  </p>
                )}
              </div>
            </details>
            <div>
              <p aria-label="Your range">
                Your range: {names.map((n, a) => `${n} ${pct(now.mine[a])}`).join(" · ")}
                {locked.size > 0 && <span className="text-muted"> · {locked.size} locked</span>}
              </p>
              <div className="mt-1 flex h-2 overflow-hidden rounded-sm bg-surface-2" aria-hidden>
                {segs(now.mine, colors)}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={check} className="rounded-md bg-accent px-3 py-1.5 font-medium text-bg">
                Check my range
              </button>
              <button type="button" onClick={onExit} className="rounded-md border border-border px-3 py-1.5 hover:bg-surface-2">
                Show the solution
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3 rounded-lg border border-border bg-surface p-3">
            <section aria-label="Your score" className="space-y-1">
              <p className="text-base">
                <b>{pct(scores.cls.acc)}</b> accurate · {grade(scores.cls.acc)}
              </p>
              {scores.cls.ev_loss_bb != null && (
                <p className="text-muted">
                  EV given up: <b className="text-text">{scores.cls.ev_loss_bb.toFixed(3)}</b>bb a combo
                  {scores.cls.ev_loss_pct != null && ` (${scores.cls.ev_loss_pct.toFixed(2)}% of the pot)`}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted">Against</span>
                <ProvenanceBadge p={provenance} />
              </div>
              {graded && <p className="text-xs text-warn">{graded}</p>}
              {scores.combo && (
                <p className="text-xs text-muted">
                  Combo by combo: {pct(scores.combo.acc)} accurate
                  {scores.combo.ev_loss_bb != null && `, ${scores.combo.ev_loss_bb.toFixed(3)}bb a combo given up`}. A
                  hand class can't tell its combos apart (a flush draw from the same hand without one): the solver's
                  class mixes, painted exactly, score {pct(scores.combo.ceiling.acc)}
                  {scores.combo.ceiling.ev_loss_bb != null && ` and give up ${scores.combo.ceiling.ev_loss_bb.toFixed(3)}bb`} this way.
                </p>
              )}
            </section>
            <table className="w-full text-left">
              <caption className="sr-only">Each action's share of the range, yours and the solver's</caption>
              <thead className="text-xs text-muted">
                <tr>
                  <th className="font-normal">Action</th>
                  <th className="text-right font-normal">Yours</th>
                  <th className="text-right font-normal">Solver</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {names.map((n, a) => (
                  <tr key={n}>
                    <td className="font-sans">
                      <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm" style={{ background: colors[a] }} />
                      {n}
                    </td>
                    <td className="text-right">{pct(scores.cls.mine[a])}</td>
                    <td className="text-right">{pct(scores.cls.gto[a])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-muted">Each hand: the solver's mix above, yours below; outlined where they differ by 20% or more (red: 50%).</p>
            {misses.length > 0 && (
              <div role="group" aria-label="Biggest differences" className="space-y-1">
                <p className="text-xs text-muted">Biggest differences:</p>
                <div className="flex flex-wrap gap-1.5">
                  {misses.map(([cls, x]) => (
                    <button
                      key={cls}
                      type="button"
                      aria-pressed={sel === cls}
                      onClick={() => setSelected((s) => (s === cls ? null : cls))}
                      className={`rounded border px-2 py-0.5 font-mono ${sel === cls ? "border-accent" : "border-border hover:bg-surface-2"}`}
                    >
                      {cls} <small className="text-muted">{pct(x.off, 0)}{x.loss != null ? ` · −${x.loss.toFixed(x.loss >= 0.01 ? 2 : 3)}bb` : ""}</small>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {sel ? (
              <HandDetail cls={sel} cell={g.cells[sel]!} mine={h.now[sel]!} score={scores.cls} names={names} />
            ) : (
              <p className="text-xs text-muted">Click a hand to compare it.</p>
            )}
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setScored(false)} className="rounded-md bg-accent px-3 py-1.5 font-medium text-bg">
                Try again
              </button>
              <button type="button" onClick={onExit} className="rounded-md border border-border px-3 py-1.5 hover:bg-surface-2">
                Show the solution
              </button>
            </div>
          </div>
        )}
        {past.length > 0 && (
          <section aria-label="Past ranges here" className="rounded-lg border border-border bg-surface p-3">
            <p className="mb-1 text-xs text-muted">Your ranges at this node</p>
            <ul className="space-y-0.5 font-mono text-xs">
              {past.map((s) => (
                <li key={s.id}>
                  {new Date(s.startedAt).toLocaleString()} · {pct(s.meta.acc as number)} accurate
                  {typeof s.meta.evLossBb === "number" ? ` · ${s.meta.evLossBb.toFixed(3)}bb a combo` : ""}
                </li>
              ))}
            </ul>
          </section>
        )}
      </aside>
    </div>
  );
}

function HandDetail({ cls, cell, mine, score, names }: { cls: string; cell: GridCell; mine: number[]; score: BuildScore; names: readonly string[] }) {
  const x = score.cells[cls];
  return (
    <section aria-label={`${cls} compared`} className="space-y-1 rounded border border-border p-2 text-xs">
      <p>
        <b className="font-mono text-sm">{cls}</b> <span className="text-muted">{x?.combos.toFixed(1)} combos</span>
      </p>
      <p>
        <span className="text-muted">Yours:</span> {mixText(mine, names)}
      </p>
      <p>
        <span className="text-muted">Solver:</span>{" "}
        {names
          .map((n, a) => ((cell.f[a] ?? 0) >= 0.005 ? `${n} ${pct(cell.f[a], 0)}${cell.ev ? ` (EV ${cell.ev[a]?.toFixed(2)})` : ""}` : null))
          .filter(Boolean)
          .join(", ")}
      </p>
      {x && (
        <p className="text-muted">
          {pct(x.off, 0)} of it played differently{x.loss != null ? `, ${x.loss.toFixed(3)}bb a combo given up` : ""}
        </p>
      )}
    </section>
  );
}

function BuildMatrix({
  grid,
  paint,
  colors,
  locked,
  cells,
  selected,
  onTouch,
  onPress,
  onStrokeStart,
  onStrokeEnd,
  onSelect,
  caption,
}: {
  grid: RangeGridData;
  paint: Paint;
  colors: readonly string[];
  locked: ReadonlySet<string>;
  cells?: BuildScore["cells"];
  selected: string | null;
  onTouch: (cls: string) => void;
  /** Enter or Space on a hand */
  onPress: (cls: string) => void;
  onSelect: (cls: string) => void;
  /** a press: a stroke starts on the hand; then each hand the pointer moves over (onTouch); the release ends it */
  onStrokeStart: (cls: string) => void;
  onStrokeEnd: () => void;
  caption: string;
}) {
  const scored = Boolean(cells);
  // where the pointer was, while a press that began on a hand of this grid lasts (after a press outside it, moves
  // paint nothing). A move paints every hand on its path, in steps of a few pixels: a quick drag skips none
  const last = useRef<{ x: number; y: number } | null>(null);
  const at = (x: number, y: number) =>
    (typeof document.elementFromPoint === "function" ? document.elementFromPoint(x, y) : null)?.closest<HTMLElement>("[data-cls]")?.dataset.cls;
  const { stop, gridProps } = useRovingGrid(selected);
  return (
    <div
      role="grid"
      aria-label={caption}
      className={`grid w-full gap-[2px] select-none ${scored ? "" : "touch-none"}`}
      style={{ gridTemplateColumns: "repeat(13, minmax(0, 1fr))" }}
      {...gridProps}
      onPointerDown={(e) => {
        if (scored || e.button !== 0) return;
        const cls = (e.target as HTMLElement).closest<HTMLElement>("[data-cls]")?.dataset.cls;
        if (!cls) return;
        e.preventDefault();
        last.current = { x: e.clientX, y: e.clientY };
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
        onStrokeStart(cls);
      }}
      onPointerMove={(e) => {
        const p = last.current;
        if (!p) return;
        const n = Math.max(1, Math.ceil(Math.hypot(e.clientX - p.x, e.clientY - p.y) / 6));
        for (let i = 1; i <= n; i++) {
          const cls = at(p.x + ((e.clientX - p.x) * i) / n, p.y + ((e.clientY - p.y) * i) / n);
          if (cls) onTouch(cls);
        }
        last.current = { x: e.clientX, y: e.clientY };
      }}
      onPointerUp={() => {
        last.current = null;
        onStrokeEnd();
      }}
      onPointerCancel={() => {
        last.current = null;
        onStrokeEnd();
      }}
    >
      {RANKS.map((_, i) => (
        <div role="row" key={i} className="contents">
          {RANKS.map((__, j) => {
            const cls = classLabel(i, j);
            return (
              <BuildCell
                key={cls}
                cls={cls}
                cell={grid.cells[cls]}
                mine={paint[cls]}
                names={grid.actions}
                colors={colors}
                locked={locked.has(cls)}
                score={cells?.[cls]}
                scored={scored}
                active={selected === cls}
                tabbable={stop === cls}
                onPress={onPress}
                onSelect={onSelect}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}

const BuildCell = memo(function BuildCell({
  cls,
  cell,
  mine,
  names,
  colors,
  locked,
  score,
  scored,
  active,
  tabbable,
  onPress,
  onSelect,
}: {
  cls: string;
  cell: GridCell | undefined;
  mine: number[] | undefined;
  names: readonly string[];
  colors: readonly string[];
  locked: boolean;
  score?: BuildScore["cells"][string];
  scored: boolean;
  active: boolean;
  tabbable: boolean;
  onPress: (cls: string) => void;
  onSelect: (cls: string) => void;
}) {
  const on = Boolean(cell && cell.w > 0 && mine);
  const w = on ? Math.min(1, cell!.w) : 0;
  const ring = score ? (score.off >= 0.5 ? "ring-2 ring-danger" : score.off >= 0.2 ? "ring-2 ring-warn" : "") : "";
  const label = buildLabel(cls, on, cell, mine, names, locked, score);
  return (
    <button
      type="button"
      role="gridcell"
      data-cls={on ? cls : undefined}
      aria-label={label}
      aria-selected={active}
      // (not `disabled`: the arrow keys go through a hand out of the range as through any other)
      aria-disabled={!on || undefined}
      tabIndex={tabbable ? 0 : -1}
      // a pointer paints on press (the grid's handler); a click with no pointer (keyboard: Enter or Space) paints
      // here, and once scored a click compares the hand
      onClick={(e) => {
        if (!on) return;
        if (scored) onSelect(cls);
        else if (e.detail === 0) onPress(cls);
      }}
      className={`relative aspect-square min-w-0 overflow-hidden rounded-[3px] bg-surface-2 text-left aria-disabled:cursor-default aria-disabled:opacity-40 ${
        scored ? "cursor-pointer" : "cursor-crosshair"
      } ${ring} ${active ? "outline outline-2 outline-offset-1 outline-accent" : ""} ${locked ? "border border-dashed border-text/70" : ""}`}
    >
      {on && !scored && (
        <div className="absolute inset-x-0 bottom-0 flex" style={{ height: `${w * 100}%` }}>
          {segs(mine!, colors)}
        </div>
      )}
      {on && scored && (
        <>
          <div className="absolute inset-x-0 top-0 flex h-1/2">{segs(cell!.f, colors)}</div>
          <div className="absolute inset-x-0 bottom-0 flex h-1/2">{segs(mine!, colors)}</div>
        </>
      )}
      <span className="pointer-events-none absolute left-0.5 top-0 z-10 font-mono text-[clamp(7px,1.4vw,12px)] font-medium leading-tight text-text drop-shadow-[0_1px_1px_rgba(0,0,0,0.9)]">
        {cls}
      </span>
      {locked && (
        <span aria-hidden className="pointer-events-none absolute bottom-0 right-0.5 z-10 text-[clamp(6px,1.1vw,10px)] text-text">
          L
        </span>
      )}
    </button>
  );
});
