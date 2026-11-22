// The wire between "Play a friend" (this folder) and its server (arena-worker/, which imports this file): what a page
// sends, what it's sent back, and the limits both sides hold to. Pure, with no imports, so the Worker's bundle and the
// page's lazy chunk each take only this. The server is the dealer and the rules' authority: a page draws what it's sent
// and asks; it is never sent its opponent's cards before a showdown, nor a card of the board before it's dealt.

/** The site a hand history is written under, and Analyze keeps it under. */
export const ARENA_SITE = "Lizard Arena";

/** A table's id and share link: 128 random bits as 32 lowercase hex digits. */
export const TABLE_ID = /^[0-9a-f]{32}$/;
/** A seat's reconnect token: 128 random bits as 32 lowercase hex digits. */
export const SEAT_TOKEN = /^[0-9a-f]{32}$/;

/** Every hand starts both seats at this many big blinds (blinds 0.5/1): chosen when the table is made. */
export const STACKS = [20, 40, 60, 100, 150, 200] as const;
/** Seconds for each decision before the time bank starts to run. */
export const CLOCKS = [15, 30, 60] as const;
/** Each seat's time bank at the start, seconds; +BANK_REFILL every hand, up to this again. */
export const BANK_SECONDS = 60;
export const BANK_REFILL = 10;

/** A table nobody has sent anything to for this long is closed and forgotten. */
export const IDLE_MS = 30 * 60_000;
/** The longest message a page may send, bytes. */
export const MAX_MESSAGE = 512;
/** Messages one connection may send in a window, and the window. */
export const MESSAGE_RATE = { max: 30, ms: 10_000 } as const;
/** A display name: 1 to 16 letters, digits, spaces, dots, dashes or underscores, starting with a letter or digit. */
export const NAME_MAX = 16;
const NAME = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,15}$/;

/** The name as it's kept, or null where it can't be one: trimmed, runs of spaces made one. */
export function cleanName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().replace(/\s+/g, " ");
  return NAME.test(s) ? s : null;
}

export type ArenaAction = "fold" | "check" | "call" | "bet" | "raise" | "all-in";
export const ACTIONS: readonly ArenaAction[] = ["fold", "check", "call", "bet", "raise", "all-in"];

/** What a page sends. `n` on an action is the hand it's meant for, so a click that lands after the hand moved on is refused. */
export type ClientMessage =
  | { t: "join"; name: string; token?: string }
  | { t: "act"; n: number; action: ArenaAction; to?: number }
  | { t: "next" }
  | { t: "leave" };

/** A table's settings, chosen when it's made. */
export interface TableRules {
  /** big blinds each seat starts every hand with */
  stack: number;
  /** seconds per decision before the bank runs */
  clock: number;
}

export interface SeatView {
  name: string;
  connected: boolean;
  /** asked for the next hand */
  ready: boolean;
  /** time bank left, ms */
  bank: number;
  /** big blinds won (lost below 0) over the hands played here */
  score: number;
}

export interface HandMove {
  pos: "SB" | "BB";
  action: ArenaAction;
  /** a bet's or raise's total for the street, bb */
  to?: number;
}

export interface HandView {
  n: number;
  /** the seat (0 or 1) on each blind: heads-up the small blind is the button and acts first before the flop */
  pos: { SB: 0 | 1; BB: 0 | 1 };
  /** your two cards */
  cards: [string, string];
  /** your opponent's, only once they're shown (a showdown, or all in with nothing left to bet) */
  theirs: [string, string] | null;
  /** the board as far as it's dealt */
  board: string[];
  lines: { preflop: HandMove[]; flop: HandMove[]; turn: HandMove[]; river: HandMove[] };
  /** chips in on the street in progress, by blind */
  bets: { SB: number; BB: number };
  /** chips behind, by blind */
  behind: { SB: number; BB: number };
  pot: number;
  /** the seat to act, or null */
  toAct: 0 | 1 | null;
  /** when the seat to act runs out of time (server clock, ms), the bank included */
  deadline: number | null;
  /** when its decision clock ends and the bank starts to run */
  bankFrom: number | null;
  /** your options, on your turn */
  legal: { toCall: number; canRaise: boolean; minTo: number; allInTo: number; curBet: number } | null;
  result: HandResultView | null;
}

export interface HandResultView {
  /** chips won or lost over the hand, by seat */
  net: [number, number];
  winners: (0 | 1)[];
  /** "Bob wins 12bb with two pair", in words */
  says: string;
  /** the hand as a history in Lizard's format (Practice's layout under its own header), from your seat: what Analyze imports */
  history: string;
  /** a seat ran out of time */
  timedOut?: 0 | 1;
}

export interface TableView {
  t: "state";
  rules: TableRules;
  /** your seat */
  you: 0 | 1;
  seats: [SeatView | null, SeatView | null];
  hand: HandView | null;
  /** the server's clock when this was sent, so a page can count down whatever its own clock says */
  now: number;
}

/** What a page is sent: the table as its seat sees it, its seat and token on joining, or a refusal. */
export type ServerMessage =
  | TableView
  | { t: "seated"; seat: 0 | 1; token: string }
  | { t: "error"; code: ErrorCode };

export type ErrorCode =
  | "bad_message"
  | "not_seated"
  | "full"
  | "bad_name"
  | "not_your_turn"
  | "illegal"
  | "stale"
  | "slow_down"
  | "no_table";

/** Words for a refusal, on the page. */
export const ERROR_TEXT: Record<ErrorCode, string> = {
  bad_message: "The server couldn't read that.",
  not_seated: "Take a seat first.",
  full: "Both seats are taken at this table.",
  bad_name: `A name is 1 to ${NAME_MAX} letters, digits, spaces, dots, dashes or underscores.`,
  not_your_turn: "It isn't your turn.",
  illegal: "That move isn't allowed here.",
  stale: "That was for a hand that's over.",
  slow_down: "Too many messages: wait a moment.",
  no_table: "This table doesn't exist or has expired.",
};

/** WebSocket close codes the server uses (4000-4999 are the application's). */
export const CLOSE = { expired: 4000, full: 4001, replaced: 4002, abuse: 4003, noTable: 4004, left: 4005 } as const;
