// Both players' ranges side by side in Study: the player to act's grid and one opponent's. On or off is in the link, as
// `vs`: "1" for the first opponent, or the seat picked in a multiway pot; walking the line keeps it, so it stays on from
// node to node, and a link opens with it.

/** The URL parameter: absent, Study draws one grid at a time as ever. */
export const VS = "vs";

/** Which of the answer's opponents goes beside the actor's range: the seat `vs` names where it's one of them, else the
 * first; null where side by side is off or the answer has no opponent's range (Study's preflop answers have none). */
export function pickOpp(opps: readonly { seat: string }[], vs: string | null): number | null {
  if (!vs || !opps.length) return null;
  const i = opps.findIndex((o) => o.seat === vs);
  return i >= 0 ? i : 0;
}

/** A line's link (toSearch's) with `vs` kept on it, so a new node stays side by side. */
export function keepVs(search: string, vs: string | null): string {
  if (!vs) return search;
  const q = new URLSearchParams(search);
  q.set(VS, vs);
  return q.toString();
}
