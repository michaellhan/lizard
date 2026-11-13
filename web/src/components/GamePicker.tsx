// Which game a page is on, from the registry (engine/registry.ts): a link per game the page opens for, the game in the
// link's `game` (none for Hold'em, so every Hold'em link stays as it was).
import { Link } from "react-router";
import { gamesFor } from "@/engine/registry";
import type { GameId, GamePage } from "@/engine/types";

const SHORT: Record<GameId, string> = { nlhe: "Hold'em", plo4: "PLO" };

export function GamePicker({ page, current }: { page: GamePage; current: GameId }) {
  const games = gamesFor(page);
  if (games.length < 2) return null;
  return (
    <nav aria-label="Game" className="flex flex-wrap items-center gap-1 text-sm">
      {games.map((g) => (
        <Link
          key={g.id}
          to={g.id === "nlhe" ? `/${page}` : `/${page}?game=${g.id}`}
          aria-current={g.id === current ? "page" : undefined}
          title={g.name}
          className={`rounded border px-2 py-0.5 ${g.id === current ? "border-accent bg-surface-3" : "border-border text-muted hover:bg-surface-2"}`}
        >
          {SHORT[g.id]}
        </Link>
      ))}
    </nav>
  );
}

/** What a page doesn't have for a game, said once: the registry's list, so nothing missing is left looking like it works. */
export function NotForGame({ page, name, missing }: { page: GamePage; name: string; missing: readonly string[] }) {
  if (!missing.length) return null;
  return (
    <details className="text-xs text-muted">
      <summary className="cursor-pointer">Not in {name} {page === "study" ? "Study" : page === "practice" ? "Practice" : "Analyze"} yet</summary>
      <ul aria-label={`Not for ${name}`} className="mt-1 list-disc pl-5">
        {missing.map((m) => (
          <li key={m}>{m}</li>
        ))}
      </ul>
    </details>
  );
}
