// PokerNow's hands download (the JSON a game's or tournament's "Download hands" gives: `playerId`, `hands`, each hand
// its players and events) rewritten as one PokerStars-like hand history per hand, which the importer (parse.ts) reads
// as it reads any site's. Lizard's own reading: PokerNow publishes no schema, so the event codes below are the ones
// seen in real exports, checked on every hand of one (chips put in less any bet returned add up to what's collected).
// A hand holding any other code is refused with the code named, never guessed at.
//
//   0 check · 2 big blind · 3 small blind · 7 call, or a bet into no bet · 8 raise (a bet into no bet) · 9 cards
//   dealt to the board (`turn` 1 flop, 2 turn, 3 river; `run` 2 a run-it-twice's second board) · 10 a pot won ·
//   11 fold · 12 cards shown · 15 the hand's end · 16 a bet nobody matched, given back.
// An amount is the seat's total on the street (as parse.ts's actions are), in hundredths when `cents` is set.

export interface PokerNowHand {
  /** the history to import, or why the hand can't be */
  text?: string;
  error?: string;
  /** the hand's number, for the list of unreadable hands */
  number: string;
}

/** events read in one hand before it's refused (a real hand has a few dozen) */
const MAX_EVENTS = 1000;
/** players listed in one hand before it's refused (a PokerNow table seats 10) */
const MAX_PLAYERS = 12;

const KNOWN = new Set([0, 2, 3, 7, 8, 9, 10, 11, 12, 15, 16]);

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === "object" && x !== null && !Array.isArray(x);
const int = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : null);
const card = (c: unknown): string | null => {
  const m = String(c).match(/^(10|[2-9TJQKA])([shdc])$/i);
  return m ? (m[1] === "10" ? "T" : m[1]!.toUpperCase()) + m[2]!.toLowerCase() : null;
};
const cards = (x: unknown): string[] | null => {
  if (!Array.isArray(x)) return null;
  const cs = x.map(card);
  return cs.every((c): c is string => !!c) ? cs : null;
};

/** FNV-1a as hex: a hand's PokerNow id in the history's number (hex has no letters that spell a game, see below) */
const fnv = (s: string) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(16).padStart(8, "0");
};

// A player's name as the history writes it. parse.ts finds who acted by a line's start, and takes some line starts as
// its own ("Dealt to", "Seat 3:", a site's header), so a name keeps letters, digits, spaces, dots, dashes and
// underscores, never starts like one of those lines, and isn't "Cashout" (results.ts reads that as GG's EV Cashout).
const RESERVED = /^(dealt to|seat\b|board\b|uncalled|total\b|table\b|tournament\b|winamax poker|pokernow hand)/i;
function nameOf(raw: unknown, seat: number): string {
  let n = String(raw ?? "")
    .replace(/[^\p{L}\p{N} ._-]/gu, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 32)
    .replace(/cashout/gi, "cash_out");
  if (!n) n = `Seat ${seat}`;
  return RESERVED.test(n) ? `_${n}` : n;
}

const pad = (x: number) => String(x).padStart(2, "0");
/** When the hand started, on this browser's clock (the download has only the instant; analyze.ts reads the history's
 * time as its site's own clock, and PokerNow's is the one its page showed you) */
const when = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

/** One hand of the download as a history, or why not. `hero`: the downloader's player id; `slug`: the tournament's. */
export function pokerNowHand(h: Obj, hero: string, slug: string | null): PokerNowHand {
  const number = String(h.number ?? "").slice(0, 16);
  const fail = (error: string): PokerNowHand => ({ error, number });
  if (h.gameType !== "th") return fail("Only Hold'em hands can be imported.");
  if (h.bombPot) return fail("A bomb pot has no preflop betting: the page can't play it.");
  if (h.doubleBoard) return fail("A double-board hand can't be imported.");
  const div = h.cents ? 100 : 1;
  const amt = (v: number) => String(Math.round((v / div) * 100) / 100);
  const sb = int(h.smallBlind);
  const bb = int(h.bigBlind);
  if (!sb || !bb) return fail("The hand has no blinds.");
  const players = Array.isArray(h.players) ? h.players.filter(isObj) : [];
  const events = Array.isArray(h.events) ? h.events.filter(isObj).map((e) => (isObj(e.payload) ? e.payload : {})) : [];
  if (players.length > MAX_PLAYERS) return fail(`${players.length} players listed: too many for a table.`);
  if (events.length > MAX_EVENTS) return fail(`${events.length} events in this hand: too many to be one hand.`);
  const unknown = [...new Set(events.map((e) => e.type).filter((t) => !KNOWN.has(t as number)))];
  if (unknown.length) return fail(`PokerNow event type ${unknown.map(String).join(", ")} isn't read here yet (antes, straddles and the like), so the hand is left out.`);
  if (!events.some((e) => e.type === 15)) return fail("This hand hadn't finished when the hands were downloaded.");

  // seats: each player's name, made unique (PokerNow ids are; names needn't be)
  const name = new Map<number, string>();
  const used = new Set<string>();
  const seats: { seat: number; name: string; stack: number }[] = [];
  let heroSeat: number | null = null;
  let hole: string[] | null = null;
  for (const p of players) {
    const seat = int(p.seat);
    const stack = int(p.stack);
    if (seat == null || stack == null || name.has(seat)) return fail("A player's seat or stack can't be read.");
    let n = nameOf(p.name, seat);
    if (used.has(n.toLowerCase())) n = `${n}_${seat}`;
    used.add(n.toLowerCase());
    name.set(seat, n);
    seats.push({ seat, name: n, stack });
    if (p.id === hero) {
      heroSeat = seat;
      hole = cards(p.hand);
    }
  }
  seats.sort((a, b) => a.seat - b.seat);
  const who = (e: Obj) => {
    const s = int(e.seat);
    return s != null ? name.get(s) : undefined;
  };

  const head = [
    // (the header line holds no player's or tournament's text: parse.ts reads a game's name in it, "PLO", "Stud")
    `PokerNow Hand #${number.replace(/\D/g, "") || "0"}-${fnv(`${slug ?? ""}|${String(h.id ?? "")}`)}: Hold'em No Limit (${amt(sb)}/${amt(bb)}) - ${when(int(h.startedAt) ?? 0)}`,
    ...(slug ? [`Tournament "${slug.replace(/[^\w-]/g, "_").slice(0, 64)}"`] : []),
    `Table 'PokerNow' ${Math.max(seats.length, 2)}-max Seat #${int(h.dealerSeat) ?? 0} is the button`,
    ...seats.map((s) => `Seat ${s.seat}: ${s.name} (${amt(s.stack)} in chips)`),
  ];
  const posts: string[] = [];
  const play: string[] = [];
  const end: string[] = [];
  const board: string[] = [];
  let put = new Map<string, number>();
  let top = 0;
  let second = false;
  let pot = 0;
  for (const e of events) {
    const n = who(e);
    const v = int(e.value) ?? 0;
    const allIn = e.allIn ? " and is all-in" : "";
    switch (e.type) {
      case 2:
      case 3:
        if (!n) break;
        posts.push(`${n}: posts ${e.type === 3 ? "small" : "big"} blind ${amt(v)}${allIn}`);
        put.set(n, v);
        top = Math.max(top, v);
        break;
      case 0:
        if (n) play.push(`${n}: checks`);
        break;
      case 11:
        if (n) play.push(`${n}: folds`);
        break;
      case 7:
      case 8: {
        if (!n) break;
        const before = put.get(n) ?? 0;
        if (top === 0) play.push(`${n}: bets ${amt(v)}${allIn}`);
        else if (e.type === 7 || v <= top) play.push(`${n}: calls ${amt(Math.max(0, v - before))}${allIn}`);
        else play.push(`${n}: raises ${amt(v - top)} to ${amt(v)}${allIn}`);
        put.set(n, Math.max(before, v));
        top = Math.max(top, v);
        break;
      }
      case 9: {
        if (e.run === 2) second = true;
        const cs = cards(e.cards);
        if (second || !cs) break;
        // (one event can bring more than one street's cards: each street gets its header)
        for (const c of cs) {
          board.push(c);
          const k = board.length;
          if (k === 3) play.push(`*** FLOP *** [${board.join(" ")}]`);
          else if (k === 4 || k === 5) play.push(`*** ${k === 4 ? "TURN" : "RIVER"} *** [${board.slice(0, k - 1).join(" ")}] [${c}]`);
        }
        if (board.length >= 3) {
          put = new Map();
          top = 0;
        }
        break;
      }
      case 12: {
        const cs = cards(e.cards);
        if (n && cs) end.push(`${n}: shows [${cs.join(" ")}]`);
        break;
      }
      case 10:
        if (!n) break;
        end.push(`${n} collected ${amt(v)} from pot`);
        pot += v;
        break;
      case 16:
        if (n) end.push(`Uncalled bet (${amt(v)}) returned to ${n}`);
        break;
    }
  }
  const heroName = heroSeat != null ? name.get(heroSeat) : undefined;
  const lines = [
    ...head,
    ...posts,
    "*** HOLE CARDS ***",
    ...(heroName && hole?.length === 2 ? [`Dealt to ${heroName} [${hole.join(" ")}]`] : []),
    ...play,
    "*** SHOW DOWN ***",
    ...end,
    "*** SUMMARY ***",
    `Total pot ${amt(pot)}`,
    ...(board.length ? [`Board [${board.join(" ")}]`] : []),
  ];
  return { text: lines.join("\n"), number };
}

/** A PokerNow hands download as one history per hand; null when the text isn't one (another site's text is read
 * as it always was). JSON that isn't a PokerNow download gives one entry saying so. */
export function pokerNowHands(text: string): PokerNowHand[] | null {
  if (!/^\s*[{[]/.test(text)) return null;
  const notOne = [{ error: 'Not a PokerNow hands download (a JSON file with "playerId" and "hands").', number: "" }];
  let d: unknown;
  try {
    d = JSON.parse(text);
  } catch {
    return /"events"\s*:/.test(text.slice(0, 65536)) ? notOne : null;
  }
  if (!isObj(d) || !Array.isArray(d.hands)) return notOne;
  if (typeof d.playerId !== "string" || !d.playerId)
    return [{ error: 'The download has no "playerId", so whose hands these are can\'t be told: download them again from PokerNow while signed in.', number: "" }];
  const slug = typeof d.tournamentSlug === "string" && d.tournamentSlug ? d.tournamentSlug : null;
  const hero = d.playerId;
  return d.hands.map((h) => (isObj(h) ? pokerNowHand(h, hero, slug) : { error: "A hand in the download can't be read.", number: "" }));
}
