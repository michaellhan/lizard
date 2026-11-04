// What the solver is asked next. The solver answers one request at a time, so the Room keeps one in flight, and this
// says, from what the tables want, whether that one goes on, whether it stops, and what goes out once it's gone. Pure:
// the flight, its promise and the clock stay with the Room. One table wants one thing at a time, so the first job is
// the next.
import type { Need } from "./flow";

export type Asked = Extract<Need, { key: string }>;

/** A request a table wants. `table`: its place in the Room. */
export interface Job {
  need: Asked;
  table: number;
}

/** The request in flight, as far as a plan reads it. `stopping`: stopped already, and not settled. */
export interface InFlight {
  key: string;
  stopping: boolean;
}

export interface Plan {
  /** nobody needs the flight now (its hand ended or moved on, the mode changed) */
  stop: boolean;
  /** the request to send: only with nothing in flight, as a stopped request stays pending until it settles */
  launch: Job | null;
}

export function plan(flight: InFlight | null, jobs: readonly Job[]): Plan {
  if (flight) return { stop: !flight.stopping && !jobs.some((j) => j.need.key === flight.key), launch: null };
  return { stop: false, launch: jobs[0] ?? null };
}
