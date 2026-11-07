// Account sync, in Settings. It loads only when asked for and shows nothing until the service answers, so a visitor with no
// account never meets it. Nothing here is needed for anything else on the site.
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { DeleteButton } from "@/components/DeleteButton";
import { GOOGLE_SIGN_IN, syncAvailable, SyncFailed } from "@/sync/api";
import { lastSync, onLastSync, runSync, startAuto } from "@/sync/auto";
import { MIN_PASSPHRASE } from "@/sync/crypto";
import { choosePassphrase, deleteEverything, leave, lock, resume, status, unlock, type SyncStatus } from "@/sync/session";

export const ABOUT_SYNC =
  "Optional, and Lizard is whole without it. It keeps your saved spots, session history, imported hands and kept mistakes the same on your devices. They're sealed here with your passphrase before they leave, so the server holds only ciphertext: it can see how many records there are, their sizes, when they arrived and which of those four kinds each is, and nothing inside them. You sign in with Google, which tells the service only which account it is, as a number it keeps a keyed hash of: it never sees your email or name. Google can see that you signed in here. Saved answers, grades, ranges, drills and settings stay in each browser.";
export const LOST_WORDS = "Nobody can reset a passphrase, because nobody else ever has it. If you lose it the synced copy is gone. What's kept in each browser stays, and a new passphrase can start a new synced copy from it.";

const ERROR = "#sync-error=";
const SIGN_IN_WORDS: Record<string, string> = {
  cancelled: "Sign-in was cancelled. Nothing changed.",
  busy: "Too many sign-ins from here. Wait a while, then try again.",
  failed: "Google sign-in didn't finish. Try again in a while.",
};

/** What Google sent back, if this page is its answer. */
const cameBack = () => (location.hash.startsWith(ERROR) ? (SIGN_IN_WORDS[location.hash.slice(ERROR.length)] ?? SIGN_IN_WORDS.failed!) : null);

const failed = (e: unknown) => (e instanceof SyncFailed ? e.message : "Sync failed. Everything here stays as it is.");

const megabytes = (n: number) => (n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0);

function Field({ label, ...rest }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      {label}
      <input className="w-72 max-w-full rounded border border-border bg-surface-2 px-2 py-1" {...rest} />
    </label>
  );
}

const BUTTON = "rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface-2 disabled:opacity-50";

function SignIn() {
  return (
    <a href={GOOGLE_SIGN_IN} className={`${BUTTON} inline-block`}>
      Sign in with Google
    </a>
  );
}

function Stay({ stay, setStay }: { stay: boolean; setStay: (b: boolean) => void }) {
  return (
    <>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={stay} onChange={(e) => setStay(e.target.checked)} />
        Stay unlocked on this device
      </label>
      <p className="text-xs text-muted">Off, you type the passphrase each time you open Lizard. On, anyone using this browser can reach the synced copy until you press Lock, so leave it off on a shared computer.</p>
    </>
  );
}

function Choose({ busy, act, reset, cancel }: { busy: boolean; act: (f: () => Promise<string | void>) => void; reset?: boolean; cancel?: () => void }) {
  const [one, setOne] = useState("");
  const [two, setTwo] = useState("");
  const [stay, setStay] = useState(false);
  const differ = two !== "" && one !== two;
  const send = (e: FormEvent) => {
    e.preventDefault();
    act(() => choosePassphrase(one, stay, reset));
  };
  return (
    <form onSubmit={send} className="space-y-2">
      <p className="text-sm">{reset ? "A new passphrase replaces the synced copy with what's in this browser. Your other devices will ask for the new one." : "Choose a passphrase. It seals your data before it leaves this browser."}</p>
      <p className="text-xs text-muted">{LOST_WORDS}</p>
      <Field label={`Passphrase (at least ${MIN_PASSPHRASE} characters; a few unrelated words is best)`} type="password" required minLength={MIN_PASSPHRASE} autoComplete="new-password" value={one} onChange={(e) => setOne(e.target.value)} />
      <Field label="The same again" type="password" required autoComplete="new-password" value={two} onChange={(e) => setTwo(e.target.value)} />
      {differ && <p className="text-xs">Those two don&rsquo;t match.</p>}
      <Stay stay={stay} setStay={setStay} />
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy || one !== two || one.length < MIN_PASSPHRASE} className={BUTTON}>
          {reset ? "Start a new synced copy" : "Start syncing"}
        </button>
        {cancel && (
          <button type="button" onClick={cancel} className={BUTTON}>
            Keep the synced copy
          </button>
        )}
      </div>
    </form>
  );
}

function Unlock({ busy, act }: { busy: boolean; act: (f: () => Promise<string | void>) => void }) {
  const [phrase, setPhrase] = useState("");
  const [stay, setStay] = useState(false);
  const [lost, setLost] = useState(false);
  const send = (e: FormEvent) => {
    e.preventDefault();
    act(async () => {
      if (!(await unlock(phrase, stay))) return "That isn't the passphrase of this synced copy.";
      setPhrase("");
    });
  };
  if (lost) return <Choose busy={busy} act={act} reset cancel={() => setLost(false)} />;
  return (
    <form onSubmit={send} className="space-y-2">
      <Field label="Passphrase" type="password" required autoComplete="current-password" value={phrase} onChange={(e) => setPhrase(e.target.value)} />
      <Stay stay={stay} setStay={setStay} />
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy || !phrase} className={BUTTON}>
          Unlock
        </button>
        <button type="button" onClick={() => setLost(true)} className={BUTTON}>
          Lost the passphrase?
        </button>
      </div>
    </form>
  );
}

function Unlocked({ st, busy, act, reload }: { st: SyncStatus; busy: boolean; act: (f: () => Promise<string | void>) => void; reload: () => void }) {
  const [last, setLast] = useState(lastSync);
  useEffect(() => {
    startAuto();
    return onLastSync(() => {
      setLast(lastSync());
      reload();
    });
  }, [reload]);
  return (
    <div className="space-y-2">
      <p className="text-sm" role="status">
        {last ? `${last.ok ? "Last synced" : "Last try failed"} at ${new Date(last.at).toLocaleTimeString()}: ${last.words}.` : "Syncing…"}
      </p>
      <p className="text-xs text-muted">
        {megabytes(st.bytes)} MB of {megabytes(st.maxBytes)} MB used. Signed in and unlocked here. A deletion here reaches your other devices too, unless a copy there was changed after it.
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} className={BUTTON} onClick={() => act(() => runSync())}>
          Sync now
        </button>
        <button type="button" disabled={busy} className={BUTTON} onClick={() => act(() => lock())}>
          Lock
        </button>
        <button type="button" disabled={busy} className={BUTTON} onClick={() => act(() => leave())}>
          Sign out
        </button>
        <DeleteButton what="the account and the synced copy" name="Delete my account" onDelete={() => act(() => deleteEverything())} />
      </div>
    </div>
  );
}

/** The sync panel; nothing until the service answers. */
export default function SyncPanel() {
  const [there, setThere] = useState(false);
  const [st, setSt] = useState<SyncStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState(cameBack);
  const alive = useRef(true);

  const reload = useCallback(() => {
    status().then(
      (s) => {
        if (alive.current) setSt(s);
      },
      (e: unknown) => {
        if (alive.current) setSaid(failed(e));
      },
    );
  }, []);

  useEffect(() => {
    alive.current = true;
    if (location.hash.startsWith(ERROR)) history.replaceState(history.state, "", location.pathname + location.search);
    void (async () => {
      if (!(await syncAvailable()) || !alive.current) return;
      setThere(true);
      await resume().catch(() => false);
      reload();
    })();
    return () => {
      alive.current = false;
    };
  }, [reload]);

  const act = useCallback(
    (f: () => Promise<string | void>) => {
      setBusy(true);
      setSaid(null);
      f()
        .then((words) => {
          if (alive.current && words) setSaid(words);
        })
        .catch((e: unknown) => {
          if (alive.current) setSaid(failed(e));
        })
        .finally(() => {
          if (alive.current) setBusy(false);
          reload();
        });
    },
    [reload],
  );

  if (!there) return null;
  return (
    <fieldset className="space-y-2 rounded-lg border border-border bg-surface p-4">
      <legend className="px-1 font-medium">Account sync</legend>
      <p className="text-xs text-muted">{ABOUT_SYNC}</p>
      {st && !st.signedIn && <SignIn />}
      {st?.signedIn && !st.hasPhrase && <Choose busy={busy} act={act} />}
      {st?.signedIn && st.hasPhrase && !st.unlocked && <Unlock busy={busy} act={act} />}
      {st?.signedIn && st.hasPhrase && st.unlocked && <Unlocked st={st} busy={busy} act={act} reload={reload} />}
      {said && (
        <p className="text-sm" role="alert">
          {said}
        </p>
      )}
    </fieldset>
  );
}
