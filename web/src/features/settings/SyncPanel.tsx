// Account sync, in Settings. It loads only when asked for and shows nothing until the service answers. Its words are above
// the button because signing in is the whole of the consent: the first sync follows at once. Nothing here is needed for
// anything else on the site.
import { useCallback, useEffect, useRef, useState } from "react";
import { DeleteButton } from "@/components/DeleteButton";
import { GOOGLE_SIGN_IN, syncAvailable, SyncFailed } from "@/sync/api";
import { lastSync, onLastSync, runSync, startAuto } from "@/sync/auto";
import { deleteEverything, leave, status, type SyncStatus } from "@/sync/session";

export const ABOUT_SYNC =
  "Optional, and Lizard is whole without it. Signing in starts it: your saved spots, session history, imported hands and kept mistakes are copied to this site's service, and kept the same on your devices. They aren't encrypted end to end, so the site's owner can read them, imported hands and the player names in them included, and so could Cloudflare, which hosts it. If you'd rather that didn't happen, stay signed out and use Download backup. You sign in with Google, which tells the service only which account it is, as a number it keeps a keyed hash of: it never sees your email or name. Google can see that you signed in here. Saved answers, grades, ranges, drills and settings stay in each browser.";
export const DELETE_WORDS = "Delete my account takes the account and the synced copy off the service straight away. The database's own restore points can hold a copy for up to 30 days after that.";

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

const BUTTON = "rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface-2 disabled:opacity-50";

function SignIn() {
  return (
    <a href={GOOGLE_SIGN_IN} className={`${BUTTON} inline-block`}>
      Sign in with Google
    </a>
  );
}

function Syncing({ st, busy, act, reload }: { st: SyncStatus; busy: boolean; act: (f: () => Promise<string | void>) => void; reload: () => void }) {
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
        {megabytes(st.bytes)} MB of {megabytes(st.maxBytes)} MB used. A deletion here reaches your other devices too, unless a copy there was changed after it.
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} className={BUTTON} onClick={() => act(() => runSync())}>
          Sync now
        </button>
        <button type="button" disabled={busy} className={BUTTON} onClick={() => act(() => leave())}>
          Sign out
        </button>
        <DeleteButton what="the account and the synced copy" name="Delete my account" onDelete={() => act(() => deleteEverything())} />
      </div>
      <p className="text-xs text-muted">{DELETE_WORDS}</p>
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
      {st?.signedIn && <Syncing st={st} busy={busy} act={act} reload={reload} />}
      {said && (
        <p className="text-sm" role="alert">
          {said}
        </p>
      )}
    </fieldset>
  );
}
