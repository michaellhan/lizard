// Screenshot to spot: a picture of a hand that's over, or of a table being studied, read in this browser (cards by their
// shapes and colours, cards.ts; numbers by Tesseract's OCR, ocr.ts) into a form prefilled with what was read, each field
// marked read, to check, or not read. Confirmed, it opens the spot in Study or Solve by the same link Analyze's decisions
// use. Review only: nothing here captures a screen, watches a window or sits over a table, and the image never leaves
// the browser. Its own chunk (AnalyzePage loads it lazily), so neither the reader nor the OCR loads with Analyze.
import { useEffect, useId, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import { Link } from "react-router";
import { About } from "@/components/About";
import { PlayingCard } from "@/components/PlayingCard";
import { parseCards } from "@/engine/nlhe/cards";
import { SEATS, seatLabel } from "@/poker/seats";
import { STREETS, type Street } from "@/features/study/studyState";
import { dealerBox, scanCards } from "./cards";
import { decodeImage } from "./decode";
import type { Img } from "./image";
import { formatAmount, type OcrLine } from "./numbers";
import { readText, type OcrProgress } from "./ocr";
import { readTable, type Reading } from "./read";
import { defaultPair, draftOf, spotOf, valuesOf, type Draft, type Line, type Mark, type Values } from "./spot";

/** Reads a picture: the cards, then the text. Injectable, so tests run the form without Tesseract. */
export type Reader = (img: Img, progress: OcrProgress) => Promise<Reading>;

export const readScreenshot: Reader = async (img, progress) => {
  progress("finding the cards", 0);
  // (a frame for the status to show: the card scan holds this thread for a moment)
  await new Promise((r) => setTimeout(r, 0));
  const scan = scanCards(img);
  let lines: OcrLine[] = [];
  let failed: string | null = null;
  try {
    lines = await readText(img, [...scan.cards.map((c) => c.box), ...(scan.dealer ? [dealerBox(scan.dealer)] : [])], progress);
  } catch (e) {
    failed = e instanceof Error ? e.message : String(e);
  }
  const r = readTable(img, scan, lines);
  if (failed) r.notes.unshift(`The text reader didn't start (${failed}), so no number was read: the cards were.`);
  return r;
};

const STATUS: Record<string, string> = {
  "finding the cards": "Finding the cards",
  "loading tesseract core": "Loading the text reader (the first time, about 7 MB from this site)",
  "initializing tesseract": "Starting the text reader",
  "loading language traineddata": "Loading the English text data (kept in this browser after the first time)",
  "loading language traineddata (from cache)": "Loading the English text data from this browser",
  "initializing api": "Starting the text reader",
  "recognizing text": "Reading the numbers",
};

type Phase = { at: "idle" } | { at: "reading"; status: string; progress: number } | { at: "error"; message: string } | { at: "form"; img: Img; reading: Reading; n: number };
type Marks = Partial<Record<keyof Draft, Mark | "edited">>;

const MARK_WORDS: Record<Mark | "edited", { text: string; tone: string }> = {
  read: { text: "read from the image", tone: "text-accent" },
  check: { text: "read from the image: check it", tone: "text-warn" },
  guess: { text: "not read: a default", tone: "text-muted" },
  edited: { text: "set by you", tone: "text-muted" },
};

const isImage = (f: File) => f.type.startsWith("image/") || /\.(png|jpe?g|webp|gif|bmp)$/i.test(f.name);

export function ScreenshotImport({ reader = readScreenshot, onClose }: { reader?: Reader; onClose?: () => void }) {
  const [phase, setPhase] = useState<Phase>({ at: "idle" });
  const [over, setOver] = useState(false);
  const run = useRef(0);

  const read = async (file: File | null | undefined) => {
    if (!file) return;
    if (!isImage(file)) {
      setPhase({ at: "error", message: `${file.name || "That file"} isn't an image: a PNG or JPEG screenshot reads best.` });
      return;
    }
    const n = ++run.current;
    setPhase({ at: "reading", status: "Opening the picture", progress: 0 });
    try {
      const img = await decodeImage(file);
      if (n !== run.current) return;
      if (!img) {
        setPhase({ at: "error", message: "This browser couldn't open that picture." });
        return;
      }
      const reading = await reader(img, (status, progress) => {
        if (n === run.current) setPhase({ at: "reading", status: STATUS[status] ?? "Reading", progress });
      });
      if (n === run.current) setPhase({ at: "form", img, reading, n });
    } catch (e) {
      if (n === run.current) setPhase({ at: "error", message: `The picture couldn't be read: ${e instanceof Error ? e.message : String(e)}` });
    }
  };

  // a picture pasted anywhere on the page while this is open (not into a text field: that's the field's)
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, [contenteditable='true']")) return;
      const file = [...(e.clipboardData?.files ?? [])].find(isImage);
      if (!file) return;
      e.preventDefault();
      void read(file);
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
    // (read only reads refs and setters)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const drop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    void read([...e.dataTransfer.files].find(isImage) ?? e.dataTransfer.files[0]);
  };

  return (
    <section aria-label="From a screenshot" className="space-y-3 panel p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">From a screenshot</h2>
        {onClose && (
          <button type="button" onClick={onClose} className="rounded px-2 py-0.5 text-sm text-muted hover:bg-surface-2 hover:text-text">
            Close
          </button>
        )}
      </div>
      <p className="max-w-prose text-sm">
        For review: a screenshot of a hand that&rsquo;s over, or of a spot you want to study. Lizard reads the cards, the pot and the stacks
        where it can, and you check them before the spot opens.
      </p>
      <ul className="max-w-prose list-disc space-y-0.5 pl-5 text-xs text-muted" aria-label="What this does and doesn't do">
        <li>The picture is read in this browser and never leaves it: nothing is uploaded.</li>
        <li>Review only, not for use while you play: Lizard doesn&rsquo;t capture your screen, watch a window or sit over a table.</li>
        <li>The text reader (about 7 MB) loads from this site the first time you read a picture. Once loaded, reading needs no connection.</li>
      </ul>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={drop}
        className={`flex flex-wrap items-center gap-2 rounded border border-dashed p-3 text-sm ${over ? "border-accent bg-surface-2" : "border-border"}`}
      >
        <label className="cursor-pointer rounded bg-accent px-3 py-1 font-medium text-bg focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent">
          Choose a screenshot…
          <input
            type="file"
            accept="image/*"
            aria-label="Choose a screenshot"
            className="sr-only"
            disabled={phase.at === "reading"}
            onChange={(e) => void read(e.target.files?.[0]).then(() => (e.target.value = ""))}
          />
        </label>
        <span className="text-muted">or drop one here, or paste one (Ctrl+V or ⌘V).</span>
      </div>
      {phase.at === "reading" && (
        <p role="status" className="text-sm">
          {phase.status}
          {phase.progress > 0 && phase.progress < 1 ? ` (${Math.round(phase.progress * 100)}%)` : "…"}
        </p>
      )}
      {phase.at === "error" && (
        <p role="alert" className="text-sm text-danger">
          {phase.message}
        </p>
      )}
      {phase.at === "form" && <SpotForm key={phase.n} img={phase.img} reading={phase.reading} />}
      <About label="How the picture is read, and what it can't read">
        <p>
          Cards are found by their faces and read from the rank and suit in a corner, matched against letter shapes; the suit&rsquo;s colour
          settles it, four-colour decks included. Numbers are read by Tesseract&rsquo;s text recognition, served from this site. Your cards are
          the pair lowest on the screen; the seats go round the table from the dealer button.
        </p>
        <p>
          Measured on pictures Lizard draws itself, not on any poker room&rsquo;s: about 99% of cards and nine in ten stacks read right there.
          Real rooms differ: cards drawn sideways or fanned, unusual fonts, and tables in light colours read worse. The betting isn&rsquo;t read at
          all, and the stacks a screenshot shows are after the hand&rsquo;s bets, so the stack and the line before the street are yours to set.
        </p>
      </About>
    </section>
  );
}

/** The picture with what was read boxed on it (a canvas: the page's policy allows no blob: images). */
function Preview({ img, reading }: { img: Img; reading: Reading }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    c.width = img.width;
    c.height = img.height;
    ctx.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
    const lw = Math.max(2, Math.round(img.width / 400));
    ctx.lineWidth = lw;
    const style = getComputedStyle(c);
    const sure = style.getPropertyValue("--color-accent").trim() || "#7ddc5a";
    const check = style.getPropertyValue("--color-warn").trim() || "#f0b429";
    for (const card of reading.cards) {
      ctx.strokeStyle = card.conf >= 0.6 ? sure : check;
      ctx.strokeRect(card.box.x, card.box.y, card.box.w, card.box.h);
    }
    ctx.font = `${Math.max(12, Math.round(img.width / 70))}px sans-serif`;
    for (const s of reading.layout?.seats ?? []) {
      const b = s.stack.box;
      ctx.strokeStyle = s.stack.conf >= 0.6 ? sure : check;
      ctx.strokeRect(b.x - lw, b.y - lw, b.w + 2 * lw, b.h + 2 * lw);
      if (s.pos) {
        ctx.fillStyle = ctx.strokeStyle;
        ctx.fillText(s.pos, b.x, b.y - 2 * lw);
      }
    }
    if (reading.dealer) {
      ctx.strokeStyle = reading.dealer.conf >= 0.6 ? sure : check;
      ctx.beginPath();
      ctx.arc(reading.dealer.x, reading.dealer.y, reading.dealer.r + lw, 0, 2 * Math.PI);
      ctx.stroke();
    }
  }, [img, reading]);
  return (
    <canvas
      ref={ref}
      role="img"
      aria-label={`The screenshot, ${reading.cards.length} cards and ${reading.layout?.seats.length ?? 0} stacks boxed where read`}
      className="h-auto max-h-96 w-auto max-w-full rounded border border-border"
    />
  );
}

function MarkTag({ id, mark }: { id?: string; mark: Mark | "edited" | undefined }) {
  if (!mark) return null;
  const m = MARK_WORDS[mark];
  return (
    <span id={id} className={`text-xs ${m.tone}`}>
      {m.text}
    </span>
  );
}

function Field({ label, mark, children }: { label: string; mark: Mark | "edited" | undefined; children: (ids: { id: string; describedBy: string }) => ReactNode }) {
  const id = useId();
  const tag = `${id}-mark`;
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        <MarkTag id={tag} mark={mark} />
      </div>
      {children({ id, describedBy: tag })}
    </div>
  );
}

const fieldClass = (mark: Mark | "edited" | undefined) => `rounded border bg-surface-2 px-2 py-1 text-sm ${mark === "check" ? "border-warn" : "border-control"}`;

const cardsOf = (s: string) => parseCards(s.replace(/10/g, "T")) ?? [];

function SpotForm({ img, reading }: { img: Img; reading: Reading }) {
  const draft = useMemo(() => draftOf(reading), [reading]);
  const [v, setV] = useState<Values>(() => valuesOf(draft));
  const [marks, setMarks] = useState<Marks>(() => Object.fromEntries(Object.entries(draft).filter(([, f]) => f && typeof f === "object" && "mark" in f).map(([k, f]) => [k, (f as { mark: Mark }).mark])) as Marks);
  const set = <K extends keyof Values>(k: K, value: Values[K]) => {
    setV((old) => {
      const next = { ...old, [k]: value };
      // a table of another size: seats it doesn't have go back to the defaults
      if (k === "players") {
        const seats = SEATS[value as number] ?? [];
        if (!seats.includes(next.heroPos)) next.heroPos = seats.includes("BTN") ? "BTN" : seats[0]!;
        if (!seats.includes(next.opener) || !seats.includes(next.caller)) Object.assign(next, defaultPair(next.players, next.heroPos));
      }
      return next;
    });
    setMarks((m) => ({ ...m, [k]: "edited" }));
  };
  const { spot, problems, notes } = spotOf(v);
  const seats = SEATS[v.players] ?? [];
  const r = reading;
  const money = (x: number) => formatAmount(x, r.unit, r.currency);

  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-2">
          <Preview img={img} reading={r} />
          <section aria-label="What was read" className="space-y-1 text-sm">
            <h3 className="font-semibold">What was read</h3>
            <ul className="space-y-0.5 text-xs">
              <li>
                Cards: {r.cards.length ? `${r.cards.length} found` : "none found"}
                {r.fourColour ? " (a four-colour deck)" : ""}
                {r.dealer ? "; the dealer button found" : "; no dealer button found"}
              </li>
              <li>
                Blinds:{" "}
                {r.blinds ? (
                  <>
                    {formatAmount(r.blinds.value.sb, "money", r.currency)} / {formatAmount(r.blinds.value.bb, "money", r.currency)} <MarkTag mark={r.blinds.conf >= 0.6 ? "read" : "check"} />
                  </>
                ) : (
                  <span className="text-muted">not read</span>
                )}
              </li>
              <li>
                Pot:{" "}
                {r.pot ? (
                  <>
                    {money(r.pot.value.value)} <MarkTag mark={r.pot.conf >= 0.6 ? "read" : "check"} />
                  </>
                ) : (
                  <span className="text-muted">not read</span>
                )}
              </li>
              {draft.seats.length > 0 && (
                <li>
                  Stacks:{" "}
                  {draft.seats.map((s, i) => (
                    <span key={i} className={`mr-2 inline-block ${s.mark === "check" ? "text-warn" : ""}`}>
                      {s.pos ? seatLabel(s.pos, draft.seats.length) : `seat ${i + 1}`}
                      {s.hero ? " (you)" : ""} {s.allIn ? "all-in" : money(s.amount)}
                    </span>
                  ))}
                </li>
              )}
            </ul>
            {r.notes.length > 0 && (
              <ul aria-label="Not read" className="list-disc space-y-0.5 pl-5 text-xs text-muted">
                {r.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            )}
          </section>
        </div>
        <form aria-label="The spot" className="space-y-2" onSubmit={(e) => e.preventDefault()}>
          <h3 className="font-semibold">The spot: check it</h3>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Players" mark={marks.players}>
              {({ id, describedBy }) => (
                <select id={id} aria-describedby={describedBy} value={v.players} onChange={(e) => set("players", Number(e.target.value))} className={fieldClass(marks.players)}>
                  {[2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Your seat" mark={marks.heroPos}>
              {({ id, describedBy }) => (
                <select id={id} aria-describedby={describedBy} value={v.heroPos} onChange={(e) => set("heroPos", e.target.value)} className={fieldClass(marks.heroPos)}>
                  {seats.map((p) => (
                    <option key={p} value={p}>
                      {seatLabel(p, v.players)}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Your cards" mark={marks.hero}>
              {({ id, describedBy }) => (
                <div className="flex items-center gap-1">
                  <input id={id} aria-describedby={describedBy} value={v.hero} placeholder="AsKd" onChange={(e) => set("hero", e.target.value.trim())} className={`${fieldClass(marks.hero)} w-24 font-mono`} />
                  {cardsOf(v.hero).map((c) => (
                    <PlayingCard key={c} card={c} size="sm" />
                  ))}
                </div>
              )}
            </Field>
            <Field label="Board" mark={marks.board}>
              {({ id, describedBy }) => (
                <div className="flex flex-wrap items-center gap-1">
                  <input id={id} aria-describedby={describedBy} value={v.board} placeholder="none, or Kh5h6h" onChange={(e) => set("board", e.target.value.trim())} className={`${fieldClass(marks.board)} w-32 font-mono`} />
                  {cardsOf(v.board).map((c) => (
                    <PlayingCard key={c} card={c} size="sm" />
                  ))}
                </div>
              )}
            </Field>
            <Field label="Stack (bb)" mark={marks.stack}>
              {({ id, describedBy }) => <input id={id} aria-describedby={describedBy} inputMode="decimal" value={v.stack} onChange={(e) => set("stack", e.target.value)} className={`${fieldClass(marks.stack)} w-24`} />}
            </Field>
            <Field label="Open on" mark={marks.street}>
              {({ id, describedBy }) => (
                <select id={id} aria-describedby={describedBy} value={v.street} onChange={(e) => set("street", e.target.value as Street)} className={fieldClass(marks.street)}>
                  {STREETS.map((s) => (
                    <option key={s} value={s}>
                      the {s}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          </div>
          <fieldset className="space-y-2 rounded border border-border p-2">
            <legend className="px-1 text-sm font-medium">
              Before the street <MarkTag mark={marks.line} />
            </legend>
            <p className="text-xs text-muted">A screenshot doesn&rsquo;t show the betting: say how the pot was made.</p>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Preflop" mark={undefined}>
                {({ id }) => (
                  <select id={id} value={v.line} onChange={(e) => set("line", e.target.value as Line)} className={fieldClass(marks.line)}>
                    <option value="srp">a single-raised pot</option>
                    <option value="3bet">a 3-bet pot</option>
                    <option value="none">no action yet (Study opens preflop)</option>
                  </select>
                )}
              </Field>
              {v.line !== "none" && (
                <>
                  <Field label="Opener" mark={undefined}>
                    {({ id }) => (
                      <select id={id} value={v.opener} onChange={(e) => set("opener", e.target.value)} className={fieldClass(marks.opener)}>
                        {seats.map((p) => (
                          <option key={p} value={p}>
                            {seatLabel(p, v.players)}
                          </option>
                        ))}
                      </select>
                    )}
                  </Field>
                  <Field label={v.line === "3bet" ? "3-bettor" : "Caller"} mark={undefined}>
                    {({ id }) => (
                      <select id={id} value={v.caller} onChange={(e) => set("caller", e.target.value)} className={fieldClass(marks.caller)}>
                        {seats.map((p) => (
                          <option key={p} value={p}>
                            {seatLabel(p, v.players)}
                          </option>
                        ))}
                      </select>
                    )}
                  </Field>
                  <Field label="Open to (bb)" mark={undefined}>
                    {({ id }) => <input id={id} inputMode="decimal" value={v.open} onChange={(e) => set("open", e.target.value)} className={`${fieldClass(marks.open)} w-24`} />}
                  </Field>
                  {v.line === "3bet" && (
                    <Field label="3-bet to (bb)" mark={undefined}>
                      {({ id }) => <input id={id} inputMode="decimal" value={v.threeBet} onChange={(e) => set("threeBet", e.target.value)} className={`${fieldClass(marks.threeBet)} w-24`} />}
                    </Field>
                  )}
                </>
              )}
            </div>
          </fieldset>
          {problems.length > 0 && (
            <div role="alert" className="text-sm">
              <p className="font-medium text-danger">Before it opens, fix:</p>
              <ul className="list-disc pl-5 text-xs">
                {problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
          )}
          {notes.length > 0 && (
            <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted">
              {notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-2 text-sm">
            {spot ? (
              <>
                <Link to={spot.study} className="rounded bg-accent px-3 py-1 font-medium text-bg">
                  Open in Study
                </Link>
                <Link to={spot.solve} className="rounded border border-border px-3 py-1 hover:bg-surface-2">
                  Set up in Solve
                </Link>
              </>
            ) : (
              <>
                <button type="button" disabled className="rounded bg-accent px-3 py-1 font-medium text-bg opacity-40">
                  Open in Study
                </button>
                <button type="button" disabled className="rounded border border-border px-3 py-1 opacity-40">
                  Set up in Solve
                </button>
              </>
            )}
          </div>
          <p className="text-xs text-muted">The cards, seats and stack come from the picture or from you; anything Study shows after is its own, with its provenance.</p>
        </form>
      </div>
    </div>
  );
}
