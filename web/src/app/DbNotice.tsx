// Says so when this tab can't use the browser's database because of another Lizard tab (data/db.ts DbState): an
// older tab holding it at its version (this tab's upgrade waits), or a newer tab that upgraded it (this tab stepped
// aside). Without it, saved spots, settings and scores would just never load.
import { useSyncExternalStore } from "react";
import { dbState, onDbState } from "@/data/db";

export function DbNotice() {
  const state = useSyncExternalStore(onDbState, dbState);
  if (state === "ok") return null;
  return (
    <div role="alert" className="border-b border-warn/50 bg-warn/10 px-4 py-2 text-center text-sm">
      {state === "waiting" ? (
        "Another Lizard tab (most likely one open since before an update) is holding this browser's saved data. Close or reload the other Lizard tabs and this page carries on; until then, nothing saved here can load."
      ) : (
        <>
          Lizard was updated in another tab, so nothing you do in this tab is saved until it&rsquo;s reloaded.{" "}
          <button type="button" onClick={() => location.reload()} className="underline">
            Reload this page
          </button>
        </>
      )}
    </div>
  );
}
