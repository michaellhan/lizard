// "Play a friend": a private heads-up table reached only by its link. Make one, send the link, and the first hand is dealt
// when your friend sits down; no account, and nothing kept on the server once the table's been idle a while. Play money
// for practice only. After each hand its history can go to Analyze, where the solver grades it; nothing here consults a
// solver during a hand. In the build only with VITE_ARENA=on (the repo variable LIZARD_ARENA), and loaded with its route.
import { useCallback, useEffect, useState } from "react";
import { ArenaTable, type ReviewState } from "./ArenaTable";
import { createTable, ENDED_TEXT, idOf, saveName, savedName, savedToken, shareLink, useArena, type CreateError } from "./client";
import { CLOCKS, cleanName, ERROR_TEXT, IDLE_MS, NAME_MAX, STACKS, type TableRules } from "./protocol";
import { analyzeLink, keepForReview } from "./review";

const field = "rounded-md border border-control bg-surface px-2 py-1";
const button = "rounded-md border border-accent bg-surface-2 px-3 py-1.5 font-medium hover:bg-surface-3 disabled:opacity-50";

function PlayMoney() {
  return (
    <p className="rounded-md border border-warn/40 bg-surface-2 p-2 text-sm">
      <strong>Play money, for practice only.</strong> No real money, prizes or wagering of any kind. No account: a table is open to whoever has its
      link, holds two players and no spectators, and is forgotten after {IDLE_MS / 60_000} minutes with nothing played. Your name is the only thing
      you give, and it's shown to the other player.
    </p>
  );
}

function NameField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      Your name at the table
      <input value={value} onChange={(e) => onChange(e.target.value)} maxLength={NAME_MAX} autoComplete="nickname" className={field} />
    </label>
  );
}

const CREATE_TEXT: Record<CreateError, string> = {
  slow_down: "Too many tables made from here lately: try again later.",
  unavailable: "The table server isn't reachable right now.",
  failed: "The table couldn't be made.",
};

function CreateTable({ onMade }: { onMade: (id: string, name: string) => void }) {
  const [name, setName] = useState(savedName);
  const [rules, setRules] = useState<TableRules>({ stack: 100, clock: 30 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clean = cleanName(name);
  return (
    <form
      aria-label="Make a table"
      className="max-w-md space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!clean) return;
        setBusy(true);
        setError(null);
        const r = await createTable(rules);
        setBusy(false);
        if ("id" in r) onMade(r.id, clean);
        else setError(CREATE_TEXT[r.error]);
      }}
    >
      <NameField value={name} onChange={setName} />
      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col gap-1 text-sm">
          Stacks (every hand)
          <select value={rules.stack} onChange={(e) => setRules({ ...rules, stack: Number(e.target.value) })} className={field}>
            {STACKS.map((s) => (
              <option key={s} value={s}>
                {s}bb
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Time per decision
          <select value={rules.clock} onChange={(e) => setRules({ ...rules, clock: Number(e.target.value) })} className={field}>
            {CLOCKS.map((s) => (
              <option key={s} value={s}>
                {s}s + bank
              </option>
            ))}
          </select>
        </label>
      </div>
      {name && !clean && <p className="text-sm text-danger">{ERROR_TEXT.bad_name}</p>}
      <button type="submit" disabled={!clean || busy} className={button}>
        {busy ? "Making the table…" : "Make a table"}
      </button>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <p className="text-xs text-muted">Heads-up no-limit hold'em, blinds 0.5/1. You get a link to send; whoever opens it first takes the other seat.</p>
    </form>
  );
}

function JoinTable({ onJoin }: { onJoin: (name: string) => void }) {
  const [name, setName] = useState(savedName);
  const clean = cleanName(name);
  return (
    <form
      aria-label="Join the table"
      className="max-w-md space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (clean) onJoin(clean);
      }}
    >
      <p className="text-sm">You've been invited to a heads-up table.</p>
      <NameField value={name} onChange={setName} />
      {name && !clean && <p className="text-sm text-danger">{ERROR_TEXT.bad_name}</p>}
      <button type="submit" disabled={!clean} className={button}>
        Sit down
      </button>
    </form>
  );
}

function CopyLink({ id }: { id: string }) {
  const link = shareLink(id);
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-muted">Invite link:</span>
      <input readOnly value={link} aria-label="Invite link" onFocus={(e) => e.target.select()} className={`${field} w-full max-w-md font-mono text-xs`} />
      <button
        type="button"
        className="rounded-md border border-border px-2 py-1 hover:bg-surface-2"
        onClick={() => {
          void navigator.clipboard?.writeText(link).then(
            () => setCopied(true),
            () => setCopied(false),
          );
        }}
      >
        {copied ? "Copied" : "Copy link"}
      </button>
    </div>
  );
}

function Table({ id, name, onLeave }: { id: string; name: string; onLeave: () => void }) {
  const arena = useArena(id, name);
  const [review, setReview] = useState<{ n: number; st: ReviewState } | null>(null);
  const n = arena.view?.hand?.n ?? 0;
  const onReview = useCallback(
    async (history: string) => {
      setReview({ n, st: { st: "saving" } });
      const r = await keepForReview(history);
      setReview({ n, st: "id" in r ? { st: "kept", link: analyzeLink(r.id) } : { st: "error", message: r.error } });
    },
    [n],
  );
  if (arena.ended) {
    return (
      <div className="space-y-3">
        <p role="alert" className="text-sm">
          {ENDED_TEXT[arena.ended]}
        </p>
        <button type="button" className={button} onClick={onLeave}>
          Make a new table
        </button>
      </div>
    );
  }
  const seated = arena.view;
  return (
    <div className="space-y-3">
      <CopyLink id={id} />
      {arena.status === "connecting" && <p className="text-sm text-muted">{seated ? "Reconnecting…" : "Connecting to the table…"}</p>}
      {arena.error && (
        <p role="alert" className="text-sm text-danger">
          {ERROR_TEXT[arena.error]}
        </p>
      )}
      {seated && <ArenaTable view={seated} skew={arena.skew} send={arena.send} review={review?.n === n ? review.st : null} onReview={(h) => void onReview(h)} />}
      {seated && (
        <button
          type="button"
          className="rounded-md border border-border px-2 py-1 text-xs text-muted hover:bg-surface-2"
          onClick={() => {
            arena.send({ t: "leave" });
            onLeave();
          }}
        >
          Leave the table
        </button>
      )}
    </div>
  );
}

export function ArenaPage() {
  const [id, setId] = useState(() => idOf(location.hash));
  // (a returning seat, with its token in this browser, sits straight back down under the name it last used)
  const [name, setName] = useState<string | null>(() => (id && savedToken(id) ? cleanName(savedName()) ?? "Player" : null));
  useEffect(() => {
    const on = () => {
      const next = idOf(location.hash);
      setId(next);
      setName(next && savedToken(next) ? cleanName(savedName()) ?? "Player" : null);
    };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const sit = (n: string) => {
    saveName(n);
    setName(n);
  };
  return (
    <div className="max-w-3xl space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Play a friend</h1>
        <p className="text-sm text-muted">A private heads-up table by link. Review each hand in Analyze afterwards, graded by the solver.</p>
      </header>
      <PlayMoney />
      {!id ? (
        <CreateTable
          onMade={(made, n) => {
            sit(n);
            setId(made);
            history.replaceState(history.state, "", `#${made}`);
          }}
        />
      ) : name === null ? (
        <JoinTable onJoin={sit} />
      ) : (
        <Table
          key={id}
          id={id}
          name={name}
          onLeave={() => {
            setId(null);
            setName(null);
            history.replaceState(history.state, "", location.pathname + location.search);
          }}
        />
      )}
    </div>
  );
}
