// Reports: a precomputed spot's flop strategy across every stored flop (classic reports.js), read in the page from
// the library's <spot>/report.json with no solver. One decision at a time (out of position first, in position after a
// check, out of position facing a bet, in position facing one), per flop and averaged by texture group, each flop weighted by how many of the
// 22100 it stands for; filters, grouping and sorting on every column; each player's EQR; a CSV of the rows shown; a
// flop opens in Study at the decision. A chart view draws the same rows (ReportChart.tsx). Everything chosen is in
// the URL. A 3-way spot's report is built in the page from its stored flops' entries (strategies only). Below it, a turn report
// over a sample of the spot's flops of the texture chosen (TurnReportPanel.tsx).
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { PlayingCard } from "@/components/PlayingCard";
import { PhoneColumns } from "@/components/PhoneColumns";
import { ProvenanceBadge } from "@/components/ProvenanceBadge";
import { bb, pct } from "@/components/actions";
import { LIBRARY_SOURCES } from "@/config";
import { TEXTURE_GROUPS, type TextureFilter, type TextureKey } from "@/features/practice/drills";
import { gameLabel, resolveLibrarySource, type LibraryIndex, type LibrarySpotIndex } from "@/library/catalog";
import { flopCards } from "@/library/entry";
import { LibraryFiles, NUT_EQUITY, type LibraryReport } from "@/library/files";
import { useSettings } from "@/state/settings";
import { MixBar } from "./MixBar";
import { ReportChart } from "./ReportChart";
import { TurnReportPanel, type KeptTurns } from "./TurnReportPanel";
import {
  ALL_FLOPS,
  average,
  columns,
  coverage,
  eqr,
  facingText,
  filterRows,
  FLOP_CLASSES,
  groups,
  hasEv,
  isFacing,
  nutFlops,
  rangeLeadText,
  REPORT_VIEWS,
  reportProvenance,
  rows,
  sortRows,
  studyLink,
  toCsv,
  viewLabel,
  viewsFor,
  viewsOf,
  type Average,
  type ReportView,
} from "./reports";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const reportable = (s: LibrarySpotIndex) => s.seats.length === 2 && Boolean(s.report);
// (a 3-way spot: its report is built from its entries)
const mwReportable = (s: LibrarySpotIndex) => s.seats.length === 3 && Object.keys(s.flops ?? {}).length > 0;
const isView = (v: string | null): v is ReportView => REPORT_VIEWS.includes(v as ReportView);
const isGroup = (v: string | null): v is TextureKey => TEXTURE_GROUPS.some((g) => g.key === v);
const label = (n: string) => n[0]!.toUpperCase() + n.slice(1);
const ratio = (x: number | null) => (x == null ? "–" : x.toFixed(2));

type Lib = { st: "loading" } | { st: "ready"; files: LibraryFiles; index: LibraryIndex; mw: LibraryIndex | null; label: string } | { st: "error"; message: string };

/** flop rows listed before "Show all" (a spot can store all 1,755; averages, groups and the CSV take every flop) */
export const ROW_LIMIT = 300;

/** `files`: the library to read (tests); otherwise the one Settings picks. `turnSample`: flops the turn report reads at a
 * time (tests). */
export function ReportsPage({ files, rowLimit = ROW_LIMIT, turnSample }: { files?: LibraryFiles; rowLimit?: number; turnSample?: number } = {}) {
  const [params, setParams] = useSearchParams();
  const choice = useSettings((s) => s.librarySource);
  const [lib, setLib] = useState<Lib>({ st: "loading" });
  const [keptTurns] = useState<KeptTurns>(() => new Map());

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        let f = files;
        let name = "the library";
        if (!f) {
          const id = choice === "auto" ? await resolveLibrarySource() : choice;
          const src = LIBRARY_SOURCES.find((s) => s.id === id) ?? LIBRARY_SOURCES[0];
          f = new LibraryFiles(src.base);
          name = src.label;
        }
        const [index, mw] = await Promise.all([f.index(), f.mwIndex().catch(() => null)]);
        if (alive) setLib({ st: "ready", files: f, index, mw, label: name });
      } catch (e) {
        if (alive) setLib({ st: "error", message: message(e) });
      }
    })();
    return () => {
      alive = false;
    };
  }, [files, choice]);

  const all = lib.st === "ready" ? lib.index.spots : [];
  const mw = lib.st === "ready" ? (lib.mw?.spots ?? []).filter(mwReportable) : [];
  const spots = [...all.filter(reportable), ...mw];
  const spot = spots.find((s) => s.id === params.get("spot")) ?? spots[0];
  const set = (kv: Record<string, string | null>) =>
    setParams(
      (p) => {
        const q = new URLSearchParams(p);
        for (const [k, v] of Object.entries(kv)) {
          if (v) q.set(k, v);
          else q.delete(k);
        }
        return q;
      },
      { replace: true },
    );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Reports</h1>
        <p className="text-sm text-muted">
          A precomputed spot&rsquo;s flop strategy across every flop it stores, read from the library with no solve: per flop and averaged by
          texture, each flop weighted by how often it comes up. Only spots in the library have reports.
        </p>
      </div>
      {lib.st === "loading" && <p className="text-sm text-muted">Loading the library&rsquo;s index…</p>}
      {lib.st === "error" && (
        <p role="alert" className="text-sm text-danger">
          Couldn&rsquo;t read the library: {lib.message}
        </p>
      )}
      {lib.st === "ready" && !spot && <p className="text-sm text-muted">This library has no spot with a flop report.</p>}
      {lib.st === "ready" && spot && <SpotReport key={spot.id} files={lib.files} spot={spot} spots={spots} params={params} set={set} rowLimit={rowLimit} keptTurns={keptTurns} turnSample={turnSample} />}
      {lib.st === "ready" && <Coverage spots={all} mw={mw} source={lib.label} />}
    </div>
  );
}

type Rep = { st: "loading"; done?: number; total?: number } | { st: "ready"; rep: LibraryReport } | { st: "error"; message: string };

function SpotReport({
  files,
  spot,
  spots,
  params,
  set,
  rowLimit,
  keptTurns,
  turnSample,
}: {
  files: LibraryFiles;
  spot: LibrarySpotIndex;
  spots: LibrarySpotIndex[];
  params: URLSearchParams;
  set: (kv: Record<string, string | null>) => void;
  rowLimit: number;
  keptTurns: KeptTurns;
  turnSample?: number;
}) {
  const mode = useSettings((s) => s.mode);
  const sampleAgainRef = useRef(false);
  const [data, setData] = useState<Rep>({ st: "loading" });
  useEffect(() => {
    let alive = true;
    const ac = new AbortController();
    const report =
      spot.seats.length > 2
        ? files.mwReport(spot, { signal: ac.signal, onProgress: (done, total) => alive && setData({ st: "loading", done, total }) })
        : files.reportWithNuts(spot);
    report.then(
      (rep) => alive && setData({ st: "ready", rep }),
      (e: unknown) => alive && setData({ st: "error", message: message(e) }),
    );
    return () => {
      alive = false;
      ac.abort();
    };
  }, [files, spot]);

  const decisions = viewsFor(spot.seats);
  const view: ReportView = isView(params.get("view")) && decisions.includes(params.get("view") as ReportView) ? (params.get("view") as ReportView) : "oop";
  const group = isGroup(params.get("group")) ? (params.get("group") as TextureKey) : null;
  const sort = params.get("sort") ?? "flop";
  const desc = params.get("desc") !== "0";
  const chart = params.get("show") === "chart";
  const filter: TextureFilter = Object.fromEntries(TEXTURE_GROUPS.flatMap((g) => (params.get(g.key) ? [[g.key, params.get(g.key)!]] : [])));
  const filterKey = JSON.stringify(filter);
  const steadyFilter = useMemo(() => filter, [filterKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const rep = data.st === "ready" ? data.rep : null;
  const all = useMemo(() => (rep ? rows(rep, view) : []), [rep, view]);
  const shown = useMemo(() => (rep ? sortRows(filterRows(all, filter), sort, desc, rep.pot) : []), [rep, all, filterKey, sort, desc]); // eslint-disable-line react-hooks/exhaustive-deps
  const provenance = useMemo(() => (rep ? reportProvenance(rep, mode, spot.report) : null), [rep, mode, spot.report]);
  const cover = rep ? coverage(rep) : null;
  const views = useMemo(() => (rep ? viewsOf(rep) : null), [rep]);

  const download = () => {
    if (!rep || !provenance) return;
    const blob = new Blob([toCsv(rep, view, shown, provenance)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `lizard-report-${rep.id}-${view}.csv`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="space-y-3">
      <form aria-label="Report" className="flex flex-wrap items-center gap-2 text-sm" onSubmit={(e) => e.preventDefault()}>
        <label className="flex items-center gap-1">
          <span className="text-muted">Spot</span>
          <select aria-label="Spot" value={spot.id} onChange={(e) => set({ spot: e.target.value })} className="max-w-[16rem] rounded border border-border bg-surface-2 px-1.5 py-1">
            {(["Heads-up", "3-way"] as const).map((g) => (
              <optgroup key={g} label={g}>
                {spots
                  .filter((s) => (s.seats.length > 2) === (g === "3-way"))
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                      {s.game ? ` (${gameLabel(s)})` : ""}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </label>
        <span role="group" aria-label="Decision" className="segmented inline-flex overflow-hidden rounded-md border border-border">
          {decisions.map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={v === view}
              disabled={views != null && !views.includes(v) && v !== view}
              title={views != null && !views.includes(v) ? "No flop this report stores has this decision" : undefined}
              onClick={() => set({ view: v === "oop" ? null : v })}
              className={`px-2.5 py-1 disabled:opacity-40 ${v === view ? "bg-surface-3 text-text" : "text-muted enabled:hover:bg-surface-2"}`}
            >
              {viewLabel(v, spot.seats)}
            </button>
          ))}
        </span>
        {TEXTURE_GROUPS.map((g) => (
          <label key={g.key} className="flex items-center gap-1">
            <span className="text-muted">{g.label}</span>
            <select aria-label={g.label} value={filter[g.key] ?? ""} onChange={(e) => set({ [g.key]: e.target.value || null })} className="rounded border border-border bg-surface-2 px-1.5 py-1">
              <option value="">Any</option>
              {Object.entries(g.values).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        ))}
        <label className="flex items-center gap-1">
          <span className="text-muted">Group</span>
          <select aria-label="Group by" value={group ?? ""} onChange={(e) => set({ group: e.target.value || null })} className="rounded border border-border bg-surface-2 px-1.5 py-1">
            <option value="">No groups</option>
            {TEXTURE_GROUPS.map((g) => (
              <option key={g.key} value={g.key}>
                By {g.label.toLowerCase()}
              </option>
            ))}
          </select>
        </label>
      </form>

      {data.st === "loading" &&
        (data.total ? (
          <div className="max-w-md space-y-1 text-sm text-muted">
            <p>
              Building the 3-way report from its stored flops: {data.done} of {data.total} read…
            </p>
            <div className="h-1.5 overflow-hidden rounded bg-surface-3" role="progressbar" aria-label="Flops read" aria-valuemin={0} aria-valuemax={data.total} aria-valuenow={data.done}>
              <div className="h-full bg-accent" style={{ width: `${((data.done ?? 0) / data.total) * 100}%` }} />
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted">Loading the report…</p>
        ))}
      {data.st === "error" && (
        <p role="alert" className="text-sm text-danger">
          Couldn&rsquo;t load this spot&rsquo;s report: {data.message}
        </p>
      )}
      {rep && provenance && cover && (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <ProvenanceBadge p={provenance} />
            <span className="text-muted">
              {cover.flops} of {FLOP_CLASSES.toLocaleString()} flops stored, standing for {pct(cover.share)} of all {ALL_FLOPS.toLocaleString()}
            </span>
            <span className="flex-1" />
            <span role="group" aria-label="Show as" className="segmented inline-flex overflow-hidden rounded-md border border-border">
              {(["Table", "Chart"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={(v === "Chart") === chart}
                  onClick={() => set({ show: v === "Chart" ? "chart" : null })}
                  className={`px-2.5 py-1 ${(v === "Chart") === chart ? "bg-surface-3 text-text" : "text-muted hover:bg-surface-2"}`}
                >
                  {v}
                </button>
              ))}
            </span>
            <button type="button" onClick={download} disabled={!shown.length} className="rounded-md border border-border px-3 py-1 hover:bg-surface-2 disabled:opacity-40">
              Download CSV
            </button>
          </div>
          {chart ? (
            <ReportChart rep={rep} view={view} cols={columns(rep, view)} shown={shown} group={group} order={orderText(sort, desc, columns(rep, view), rep.seats)} set={set} />
          ) : (
            <ReportTable rep={rep} view={view} all={all} shown={shown} group={group} sort={sort} desc={desc} set={set} rowLimit={rowLimit} />
          )}
          <p className="text-xs text-muted">
            {rep.label}
            {rep.game ? `, ${gameLabel({ game: rep.game, seats: rep.seats })}` : ", 6-max 100bb"}. Frequencies are the range&rsquo;s at the decision
            {hasEv(rep)
              ? `; EV in bb at the start of the flop (pot ${rep.pot}bb); equity is range against range; EQR is EV over equity times the pot. A group's EQR is that of its averages. Range adv is the side with the higher range equity, and by how many points of equity. It's worked out from the stored equities, which run over every 8th turn and river runout (about 135 of the 1,081), so it can differ a little from Study's breakdown, which samples its own. A group's is that of its averaged equities, each flop weighted by how many of the ${ALL_FLOPS} it stands for. There's no nut advantage column: the library stores a range's equity with no equity by hand, so how much of a range is near the nuts can't be read from it. Study's breakdown works that out for one flop.`
              : ` (pot ${rep.pot}bb). The 3-way library stores each flop's strategies but no range EVs or equities, so this report has strategies only; it is built here from the ${rep.flops.length} flops' files, read once. Its flops are a sample spread over the flop space by how often each comes up, so each counts the same${rep.flops.some((f) => f.w === 0) ? `; ${rep.flops.filter((f) => f.w === 0).map((f) => f.f).join(", ")}, solved besides the sample, is listed but not averaged` : ""}.`}{" "}
            {nutFlops(rep) > 0 && (
              <>
                {" "}
                Nut adv is the side with more of its range at {pct(NUT_EQUITY, 0)} equity or more against the other range, and by how many points of range
                {nutFlops(rep) < rep.flops.length ? `, on ${nutFlops(rep)} of these ${rep.flops.length} flops so far; an average takes those` : ""}. It&rsquo;s
                calculated from the stored ranges, not solved, the way Study&rsquo;s breakdown reads it, over a sample of the runouts: on 20 flops checked
                against every runout a share was off by about half a point on average and 4.1 points at most, so a small lead may be no lead.
              </>
            )}{" "}
            Each flop is its own stored solve: open one in Study to see how close it is to equilibrium.
            {isFacing(view) &&
              ` Facing a bet, each flop shows its most common size (“vs 75%”: three quarters of the pot) and how often it's made; the library stores the response only where the bet is made at least 5% of the time, so other flops are left out.`}
          </p>
          {/* (a sample belongs to its texture and seed: a new one starts from the top, what's read kept in keptTurns) */}
          <TurnReportPanel key={`${filterKey}|${params.get("tseed") ?? ""}`} files={files} spot={spot} rep={rep} filter={steadyFilter} params={params} set={set} kept={keptTurns} sample={turnSample} againRef={sampleAgainRef} />
        </>
      )}
    </div>
  );
}

/** the table's order in words, for the chart */
function orderText(sort: string, desc: boolean, cols: string[], seats: readonly string[]): string {
  if (sort === "flop") return desc ? "high flops first" : "low flops first";
  if (sort === "w") return `by how often they come up, ${desc ? "most" : "least"} first`;
  if (sort === "adv") return `by range advantage, ${seats[desc ? 1 : 0]} most ahead first`;
  if (sort === "nut") return `by nut advantage, ${seats[desc ? 1 : 0]} most ahead first`;
  const m = /^(a|ev|eq|eqr)(\d+)$/.exec(sort);
  const i = Number(m?.[2] ?? 0);
  const what = !m ? sort : m[1] === "a" ? label(cols[i] ?? "") : `${seats[i]} ${m[1] === "ev" ? "EV" : m[1] === "eq" ? "equity" : "EQR"}`;
  return `by ${what}, ${desc ? "highest" : "lowest"} first`;
}

/** where only some of the flops store the decision, the share its strategy is from (the EVs are from them all) */
function Partial({ a }: { a: Pick<Average, "w" | "wf" | "freqs"> }) {
  if (!a.freqs || a.wf >= a.w * 0.9999) return null;
  return (
    <small className="block whitespace-nowrap font-normal text-faint" title="The strategy averages the flops that store this decision; the EVs and equities, every flop">
      strategy from {pct(a.wf / a.w, 0)} of them
    </small>
  );
}

function ReportTable({
  rep,
  view,
  all,
  shown,
  group,
  sort,
  desc,
  set,
  rowLimit,
}: {
  rep: LibraryReport;
  view: ReportView;
  all: ReturnType<typeof rows>;
  shown: ReturnType<typeof rows>;
  group: TextureKey | null;
  sort: string;
  desc: boolean;
  set: (kv: Record<string, string | null>) => void;
  rowLimit: number;
}) {
  const [showAll, setShowAll] = useState(false);
  const listed = showAll ? shown : shown.slice(0, rowLimit);
  const cols = columns(rep, view);
  const [o, p] = rep.seats;
  // (a 3-way report has strategies only: no EV, equity or EQR columns)
  const ev = hasEv(rep);
  const nuts = ev && nutFlops(rep) > 0;
  const tot = all.reduce((a, r) => a + r.w, 0);
  const sum = average(shown);
  const head = (key: string, text: string, cls = "") => (
    <th key={key} scope="col" aria-sort={sort === key ? (desc ? "descending" : "ascending") : "none"} className={`whitespace-nowrap px-2 py-1.5 font-medium ${cls}`}>
      {/* (the same column again turns the order around; a new one starts highest first) */}
      <button type="button" onClick={() => set({ sort: key === "flop" ? null : key, desc: sort === key && desc ? "0" : null })} className={`hover:text-text ${sort === key ? "text-accent" : ""}`}>
        {text}
        {sort === key ? (desc ? " ▾" : " ▴") : ""}
      </button>
    </th>
  );
  const nums = (a: Pick<Average, "freqs" | "ev" | "eq" | "nuts">) => (
    <>
      {cols.map((_, i) => (
        <td key={i} className="px-2 py-1 text-right">
          {pct(a.freqs?.[i])}
        </td>
      ))}
      {ev && (
        <>
          <td className="px-2 py-1 text-right">{bb(a.ev[0])}</td>
          <td className="px-2 py-1 text-right">{bb(a.ev[1])}</td>
          <td className="phone-col px-2 py-1 text-right">{pct(a.eq[0])}</td>
          <td className="phone-col px-2 py-1 text-right">{pct(a.eq[1])}</td>
          <td className="phone-col px-2 py-1 text-right">{ratio(eqr(a.ev[0], a.eq[0], rep.pot))}</td>
          <td className="phone-col px-2 py-1 text-right">{ratio(eqr(a.ev[1], a.eq[1], rep.pot))}</td>
          <td className="whitespace-nowrap px-2 py-1 text-right">{rangeLeadText(a.eq, rep.seats)}</td>
          {nuts && <td className="phone-col whitespace-nowrap px-2 py-1 text-right">{rangeLeadText(a.nuts, rep.seats)}</td>}
        </>
      )}
    </>
  );
  return (
    <PhoneColumns hidden={ev ? [`${o} eq`, `${p} eq`, `${o} EQR`, `${p} EQR`, ...(nuts ? ["Nut adv"] : [])] : []}>
    <div className="max-h-[70vh] overflow-auto rounded-lg border border-border">
      <table className="w-full border-collapse text-xs tabular-nums">
        <thead className="sticky top-0 z-10 bg-surface text-left text-muted">
          <tr>
            {head("flop", "Flop", "sticky left-0 bg-surface")}
            <th scope="col" className="px-2 py-1.5 font-medium">
              Strategy
            </th>
            {cols.map((c, i) => head(`a${i}`, label(c), "text-right"))}
            {ev && (
              <>
                {head("ev0", `${o} EV`, "text-right")}
                {head("ev1", `${p} EV`, "text-right")}
                {head("eq0", `${o} eq`, "phone-col text-right")}
                {head("eq1", `${p} eq`, "phone-col text-right")}
                {head("eqr0", `${o} EQR`, "phone-col text-right")}
                {head("eqr1", `${p} EQR`, "phone-col text-right")}
                {head("adv", "Range adv", "text-right")}
                {nuts && head("nut", "Nut adv", "phone-col text-right")}
              </>
            )}
            <th scope="col" className="px-2 py-1.5">
              <span className="sr-only">Study</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr aria-label="Average" className="border-t border-border bg-surface-2 font-semibold">
            <td className="sticky left-0 bg-surface-2 px-2 py-1">
              {/* (a spot still being built stores only some flops: its averages are over those) */}
              {shown.length < all.length ? `${shown.length} flops` : coverage(rep).share < 0.9999 ? "All stored flops" : "All flops"}
              <small className="block font-normal text-faint">{pct(tot ? sum.w / tot : 0, 0)} of flops</small>
              <Partial a={sum} />
            </td>
            <td className="w-1/3 px-2 py-1">
              <MixBar freqs={sum.freqs} cols={cols} />
            </td>
            {nums(sum)}
            <td />
          </tr>
          {group &&
            groups(shown, group).map((g) => (
              <tr key={g.g} aria-label={g.label} className="border-t border-border bg-surface">
                <td className="sticky left-0 bg-surface px-2 py-1">
                  <button type="button" onClick={() => set({ [group]: g.g, group: null })} title={`Show only ${g.label.toLowerCase()} flops`} className="text-left underline-offset-2 hover:underline">
                    {g.label}
                  </button>
                  <small className="block text-faint">{pct(tot ? g.w / tot : 0)}</small>
                  <Partial a={g} />
                </td>
                <td className="px-2 py-1">
                  <MixBar freqs={g.freqs} cols={cols} />
                </td>
                {nums(g)}
                <td />
              </tr>
            ))}
          {listed.map((r) => {
            const link = studyLink(rep, r.f, view);
            return (
              <tr key={r.f} aria-label={r.f} className="border-t border-border hover:bg-surface-2">
                <td className="sticky left-0 bg-bg px-2 py-1">
                  <span className="inline-flex gap-0.5">
                    {flopCards(r.f).map((c) => (
                      <PlayingCard key={c} card={c} size="sm" />
                    ))}
                  </span>
                  {r.bet && (
                    <small className="block text-faint">
                      {/* (the bet and how often it's made, a line each: the column is as narrow as the cards) */}
                      {facingText(r)
                        .split(", ")
                        .map((t) => (
                          <span key={t} className="block whitespace-nowrap">
                            {t}
                          </span>
                        ))}
                    </small>
                  )}
                </td>
                <td className="px-2 py-1">
                  <MixBar freqs={r.freqs} cols={cols} />
                </td>
                {nums(r)}
                <td className="px-2 py-1">
                  {link && (
                    <Link to={link} className="whitespace-nowrap rounded border border-border px-1.5 py-0.5 hover:bg-surface-2">
                      Study
                    </Link>
                  )}
                </td>
              </tr>
            );
          })}
          {listed.length < shown.length && (
            <tr className="border-t border-border">
              <td colSpan={cols.length + (nuts ? 11 : ev ? 10 : 3)} className="px-2 py-2 text-muted">
                {listed.length} of {shown.length} flops listed, in this order; the averages above take all of them.{" "}
                <button type="button" onClick={() => setShowAll(true)} className="rounded border border-border px-2 py-0.5 text-text hover:bg-surface-2">
                  Show all {shown.length} flops
                </button>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
    </PhoneColumns>
  );
}

function Coverage({ spots, mw, source }: { spots: LibrarySpotIndex[]; mw: LibrarySpotIndex[]; source: string }) {
  const two = spots.filter((s) => s.seats.length === 2);
  return (
    <details className="rounded-lg border border-border bg-surface p-3 text-sm">
      <summary className="cursor-pointer">
        Which spots have reports ({two.filter(reportable).length + mw.length} in {source})
      </summary>
      <ul className="mt-2 space-y-0.5 text-muted">
        {two.map((s) => (
          <li key={s.id}>
            {s.label}
            {s.game ? ` (${gameLabel(s)})` : ""}: {Object.keys(s.flops ?? {}).length} flops stored{s.report ? "" : ", no report"}
          </li>
        ))}
        {mw.map((s) => (
          <li key={s.id}>
            {s.label} (3-way): {Object.keys(s.flops).length} flops stored, the report built in the page
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted">
        A 3-way spot&rsquo;s report is built here from its stored flops&rsquo; files (each read once, about 1.3 MB for 185 flops), with
        strategies only. Spots still being built get more flops as new library builds publish; any other spot or flop is solved live in Study,
        one at a time.
      </p>
    </details>
  );
}
