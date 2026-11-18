// Real payout structures as rooms post them publicly (owner's decision of 2026-11-17: each with its public source and the
// date it was read; none invented). Each table is copied from the page named, place by place or band by band; a band
// ("11-15") pays each place in it the percentage given. roomPayouts.test.ts checks every table adds up to 100% with its
// bands spelled out, which is how the pages' own columns add up.
//
// Rooms looked for and left out, as they post no standard table (their pages say a tournament's payouts are in its lobby)
// or the page couldn't be read: PokerStars, GGPoker, partypoker, 888poker, Winamax (403), WPT Global, Americas Cardroom,
// iPoker/Betfair, Unibet, BetRivers (an expired certificate). See docs/FEATURE_MATRIX.md, Real tournament presets.

export interface RoomSource {
  room: string;
  title: string;
  url: string;
  /** the date the page was read (yyyy-mm-dd) */
  read: string;
  /** how it was read, and anything on the page that disagrees with the table */
  note?: string;
}

export interface RoomPayout {
  /** what it pays out for, in words ("Sit & go, 9 players", "MTT, 151-200 entrants, top 10% paid") */
  name: string;
  /** an MTT's entrants (inclusive); sit & goes have their own count */
  entrants: [number, number];
  /** % of the prize pool by place, first place first, bands spelled out */
  payouts: number[];
  source: RoomSource;
}

const READ = "2026-11-17";

const WSOP_SNG: RoomSource = {
  room: "WSOP Online",
  title: "How to Play | Sit & Go Payouts",
  url: "https://wsoponline.com/nj/how-to-play-poker/sng-tournament-payouts/",
  read: READ,
  note: "The same site's Sit & Go rules page gives 6-handed as 65/35 and calls its percentages approximate; the payouts page, copied here, gives 70/30.",
};
const WSOP_MTT: RoomSource = {
  room: "WSOP Online",
  title: "How to Play | Multi-Table Payouts",
  url: "https://wsoponline.com/nj/how-to-play-poker/mtt-tournament-payouts/",
  read: READ,
};
const BETMGM_SNG: RoomSource = {
  room: "BetMGM Poker",
  title: "Sit & Go Poker Tournaments Explained | BetMGM Poker",
  url: "https://www.betmgm.com/en/poker/p/online-poker-guide/tournament-types/sit-n-go",
  read: READ,
  note: "The page is drawn by script; the table was read from its rendered text, twice, alike.",
};
const PLAYNOW_SNG: RoomSource = {
  room: "PlayNow (BCLC)",
  title: "Sit & Go Tournament Rules",
  url: "https://www.playnow.com/mb/poker/tournaments/sit-and-go-tournament-info.html",
  read: READ,
};

/** "1:24.5 2:14.25 11-15:1.25" -> every place's %, bands spelled out. */
export function expandPlaces(spec: string): number[] {
  const out: number[] = [];
  for (const tok of spec.trim().split(/\s+/)) {
    const [places, pct] = tok.split(":");
    const [a, b] = places!.split("-").map(Number);
    for (let k = a!; k <= (b ?? a!); k++) out[k - 1] = Number(pct);
  }
  return out;
}

const range = (r: string): [number, number] => {
  if (r.endsWith("+")) return [Number(r.slice(0, -1)), Infinity];
  const [a, b] = r.split("-").map(Number);
  return [a!, b ?? a!];
};

// WSOP Online's MTT tables: [entrants, places]. Places 1-10 one by one, then bands.
const W10: [string, string][] = [
  ["2", "1:100"],
  ["3-10", "1:70 2:30"],
  ["11-30", "1:50 2:30 3:20"],
  ["31-40", "1:40 2:25 3:20 4:15"],
  ["41-50", "1:37 2:25 3:15 4:12 5:11"],
  ["51-60", "1:35 2:22 3:15 4:11 5:9 6:8"],
  ["61-75", "1:31 2:21 3:13 4:10 5:8.5 6:6.5 7:5.5 8:4.5"],
  ["76-100", "1:30 2:20 3:12 4:9.5 5:8 6:6 7:5 8:4 9:3 10:2.5"],
  ["101-150", "1:28 2:17 3:10.6 4:8.6 5:7.6 6:5.3 7:4.3 8:3.3 9:2.7 10:2.1 11-15:2.1"],
  ["151-200", "1:27 2:16 3:10 4:8 5:7 6:4.9 7:3.9 8:2.9 9:2.4 10:1.9 11-15:1.9 16-20:1.3"],
  ["201-250", "1:26.5 2:15.5 3:9.8 4:7.8 5:6.8 6:4.6 7:3.6 8:2.8 9:2.2 10:1.65 11-15:1.65 16-20:1.1 21-25:1"],
  ["251-300", "1:26 2:15 3:9.6 4:7.6 5:6.6 6:4.5 7:3.5 8:2.6 9:2.1 10:1.5 11-15:1.5 16-20:1 21-25:0.9 26-30:0.8"],
  ["301-350", "1:25.5 2:14.75 3:9.4 4:7.4 5:6.4 6:4.4 7:3.4 8:2.4 9:1.95 10:1.4 11-15:1.4 16-20:0.95 21-25:0.85 26-30:0.75 31-35:0.65"],
  ["351-400", "1:25 2:14.5 3:9.2 4:7.2 5:6.2 6:4.3 7:3.3 8:2.3 9:1.85 10:1.4 11-15:1.4 16-20:0.9 21-25:0.8 26-30:0.7 31-35:0.6 36-40:0.55"],
  ["401-500", "1:24.5 2:14.25 3:9 4:7 5:6 6:4.2 7:3.2 8:2.2 9:1.65 10:1.25 11-15:1.25 16-20:0.85 21-25:0.75 26-30:0.65 31-35:0.55 36-40:0.5 41-50:0.4"],
  ["501-700", "1:24 2:14 3:8.8 4:6.8 5:5.8 6:4.1 7:3.1 8:2.1 9:1.5 10:1.1 11-15:1.1 16-20:0.85 21-25:0.75 26-30:0.65 31-35:0.55 36-40:0.5 41-50:0.37 51-60:0.3"],
  ["701-800", "1:23.5 2:13.75 3:8.8 4:6.8 5:5.8 6:4.1 7:3.1 8:2.1 9:1.5 10:1.1 11-15:1.1 16-20:0.75 21-25:0.65 26-30:0.55 31-35:0.5 36-40:0.45 41-50:0.3 51-60:0.27 61-75:0.25"],
  ["801-1000", "1:23 2:13.5 3:8.5 4:6.5 5:5.5 6:3.9 7:2.9 8:1.9 9:1.3 10:1 11-15:1 16-20:0.7 21-25:0.6 26-30:0.5 31-35:0.45 36-40:0.4 41-50:0.28 51-60:0.24 61-75:0.22 76-100:0.21"],
];
const W15: [string, string][] = [
  ["2", "1:100"],
  ["3-10", "1:70 2:30"],
  ["11-20", "1:50 2:30 3:20"],
  ["21-30", "1:37 2:25 3:15 4:12 5:11"],
  ["31-40", "1:35 2:22 3:15 4:11 5:9 6:8"],
  ["41-50", "1:32 2:18 3:12.5 4:10.5 5:8.3 6:7.3 7:6.2 8:5.2"],
  ["51-60", "1:30 2:17.5 3:12.2 4:10.2 5:8.1 6:7.1 7:6.1 8:5.1 9:3.7"],
  ["61-75", "1:29 2:17 3:12 4:10 5:8 6:6.9 7:5.9 8:4.9 9:3.5 10:2.8"],
  ["76-100", "1:28.5 2:16.5 3:10 4:8 5:6.9 6:5.9 7:4.9 8:3.4 9:2.7 10:2.2 11-15:2.2"],
  ["101-125", "1:28 2:16.2 3:9.3 4:7.3 5:6.3 6:5.3 7:4.2 8:2.8 9:2.1 10:1.75 11-15:1.75 16-20:1.6"],
  ["126-150", "1:27.5 2:16 3:9.1 4:7.1 5:6.1 6:5.1 7:3.9 8:2.5 9:1.8 10:1.4 11-15:1.4 16-20:1.3 21-25:1.2"],
  ["151-200", "1:27 2:15.75 3:9 4:7 5:6 6:5 7:3.8 8:2.4 9:1.7 10:1.3 11-15:1.3 16-20:1.05 21-25:0.95 26-30:0.91"],
  ["201-250", "1:26.5 2:15.5 3:8.85 4:6.8 5:5.8 6:4.8 7:3.6 8:2.4 9:1.7 10:1.3 11-15:1.3 16-20:1 21-25:0.8 26-30:0.75 31-35:0.7"],
  ["251-300", "1:26 2:15 3:8.8 4:6.8 5:5.7 6:4.7 7:3.6 8:2.4 9:1.7 10:1.3 11-15:1.3 16-20:0.95 21-25:0.75 26-30:0.65 31-35:0.6 36-40:0.55"],
  ["301-350", "1:25.5 2:14.5 3:8.6 4:6.6 5:5.6 6:4.6 7:3.5 8:2.3 9:1.6 10:1.2 11-15:1.2 16-20:0.9 21-25:0.6 26-30:0.55 31-35:0.53 36-40:0.5 41-50:0.46"],
  ["351-400", "1:25 2:14 3:8.5 4:6.5 5:5.5 6:4.5 7:3.4 8:2.3 9:1.5 10:1.2 11-15:1.2 16-20:0.8 21-25:0.52 26-30:0.47 31-35:0.44 36-40:0.43 41-50:0.42 51-60:0.41"],
  ["401-500", "1:24.5 2:13.75 3:8.4 4:6.4 5:5.4 6:4.4 7:3.3 8:2.2 9:1.45 10:1.1 11-15:1.1 16-20:0.8 21-25:0.5 26-30:0.4 31-35:0.37 36-40:0.35 41-50:0.34 51-60:0.33 61-75:0.32"],
  ["501-600", "1:24 2:12.7 3:8.3 4:6.3 5:5.3 6:4.3 7:3.2 8:2.1 9:1.4 10:1.1 11-15:1.1 16-20:0.8 21-25:0.5 26-30:0.4 31-35:0.35 36-40:0.3 41-50:0.28 51-60:0.27 61-75:0.22 76-100:0.21"],
  ["601-700", "1:23.5 2:12.5 3:8.2 4:6.2 5:5.2 6:4.2 7:3.1 8:2 9:1.4 10:1.1 11-15:1.1 16-20:0.7 21-25:0.45 26-30:0.35 31-35:0.32 36-40:0.25 41-50:0.24 51-60:0.23 61-75:0.22 76-100:0.18 101-125:0.17"],
  ["701-800", "1:23 2:12.15 3:8 4:6 5:5 6:4 7:2.9 8:1.8 9:1.3 10:1 11-15:1 16-20:0.6 21-25:0.4 26-30:0.31 31-35:0.29 36-40:0.24 41-50:0.23 51-60:0.22 61-75:0.21 76-100:0.19 101-125:0.17 126-150:0.16"],
  ["801-900", "1:22.5 2:11.7 3:7.9 4:5.9 5:4.9 6:3.9 7:2.9 8:1.8 9:1.3 10:0.9 11-15:0.9 16-20:0.6 21-25:0.4 26-30:0.31 31-35:0.29 36-40:0.22 41-50:0.21 51-60:0.2 61-75:0.19 76-100:0.18 101-125:0.16 126-150:0.15 151-175:0.14"],
  ["901-1000", "1:22 2:11.35 3:7.9 4:5.9 5:4.9 6:3.9 7:2.9 8:1.8 9:1.3 10:0.9 11-15:0.9 16-20:0.59 21-25:0.4 26-30:0.29 31-35:0.27 36-40:0.21 41-50:0.2 51-60:0.19 61-75:0.18 76-100:0.17 101-125:0.15 126-150:0.14 151-175:0.12 176-200:0.11"],
];
const W20: [string, string][] = [
  ["2", "1:100"],
  ["3-10", "1:70 2:30"],
  ["11-20", "1:40 2:25 3:20 4:15"],
  ["21-30", "1:35 2:22 3:15 4:11 5:9 6:8"],
  ["31-40", "1:33 2:20 3:12 4:9 5:8 6:7 7:6 8:5"],
  ["41-50", "1:31 2:19 3:9.8 4:8.8 5:7.8 6:6.8 7:5.5 8:4.4 9:3.7 10:3.2"],
  ["51-75", "1:29 2:17.5 3:8.9 4:7.9 5:6.9 6:5.9 7:4.7 8:3.5 9:2.9 10:2.3 11-15:2.1"],
  ["76-100", "1:28 2:17 3:8.4 4:7.5 5:6.5 6:5.5 7:4.3 8:2.9 9:2.6 10:1.8 11-15:1.8 16-20:1.3"],
  ["101-125", "1:27 2:16.5 3:8.2 4:7.2 5:6.2 6:5.2 7:4 8:2.7 9:2.4 10:1.6 11-15:1.6 16-20:1.15 21-25:1.05"],
  ["126-150", "1:26 2:16 3:8.1 4:7.1 5:6.1 6:5.1 7:3.9 8:2.6 9:2.3 10:1.55 11-15:1.55 16-20:1.05 21-25:0.9 26-30:0.75"],
  ["151-200", "1:25 2:15.5 3:7.9 4:6.9 5:5.9 6:4.9 7:3.7 8:2.4 9:2.1 10:1.45 11-15:1.45 16-20:0.95 21-25:0.75 26-30:0.6 31-35:0.55 36-40:0.55"],
  ["201-250", "1:24 2:15 3:7.8 4:6.8 5:5.8 6:4.8 7:3.6 8:2.3 9:2 10:1.4 11-15:1.4 16-20:0.8 21-25:0.7 26-30:0.55 31-35:0.5 36-40:0.45 41-50:0.45"],
  ["251-300", "1:23 2:14.5 3:7.7 4:6.7 5:5.7 6:4.7 7:3.5 8:2.2 9:1.9 10:1.3 11-15:1.3 16-20:0.8 21-25:0.7 26-30:0.55 31-35:0.5 36-40:0.45 41-50:0.4 51-60:0.33"],
  ["301-400", "1:22.5 2:14.25 3:7.6 4:6.6 5:5.6 6:4.6 7:3.4 8:2.1 9:1.8 10:1.25 11-15:1.25 16-20:0.75 21-25:0.65 26-30:0.55 31-35:0.45 36-40:0.4 41-50:0.35 51-60:0.31 61-75:0.23"],
  ["401-500", "1:22 2:14 3:7.5 4:6.5 5:5.5 6:4.5 7:3.3 8:2 9:1.7 10:1.2 11-15:1.2 16-20:0.75 21-25:0.6 26-30:0.5 31-35:0.4 36-40:0.35 41-50:0.31 51-60:0.26 61-75:0.19 76-100:0.17"],
  ["501-600", "1:21.5 2:13.75 3:7.4 4:6.4 5:5.4 6:4.4 7:3.2 8:1.9 9:1.6 10:1.15 11-15:1.15 16-20:0.7 21-25:0.55 26-30:0.45 31-35:0.35 36-40:0.3 41-50:0.25 51-60:0.22 61-75:0.19 76-100:0.17 101-125:0.16"],
  ["601-800", "1:21 2:13.5 3:7.4 4:6.4 5:5.4 6:4.4 7:3.2 8:1.9 9:1.6 10:1.15 11-15:1.15 16-20:0.65 21-25:0.5 26-30:0.4 31-35:0.3 36-40:0.25 41-50:0.21 51-60:0.19 61-75:0.17 76-100:0.16 101-125:0.15 126-150:0.14"],
  ["801-900", "1:20.5 2:13.25 3:7.2 4:6.2 5:5.2 6:4.2 7:3 8:1.8 9:1.5 10:1.1 11-15:1.1 16-20:0.6 21-25:0.5 26-30:0.4 31-35:0.3 36-40:0.25 41-50:0.21 51-60:0.19 61-75:0.17 76-100:0.15 101-125:0.14 126-150:0.13 151-175:0.13"],
  ["901-1000", "1:20 2:13 3:7.2 4:6.2 5:5.2 6:4.2 7:3 8:1.8 9:1.5 10:1.1 11-15:1.1 16-20:0.6 21-25:0.5 26-30:0.4 31-35:0.3 36-40:0.25 41-50:0.21 51-60:0.18 61-75:0.16 76-100:0.13 101-125:0.12 126-150:0.12 151-175:0.11 176-200:0.11"],
];

const mtt = (rows: [string, string][], pct: number): RoomPayout[] =>
  rows.map(([r, spec]) => ({ name: `MTT, ${r} entrants, top ${pct}% paid`, entrants: range(r), payouts: expandPlaces(spec), source: WSOP_MTT }));

const sng = (name: string, entrants: number, payouts: number[], source: RoomSource): RoomPayout => ({ name, entrants: [entrants, entrants], payouts, source });

/** Every table, by room. WSOP Online's MTT tables go up to 1,000 entrants here (the page has them to 5,001+, past what a
 * prize list of 200 places holds at 20% paid). */
export const ROOM_PAYOUTS: readonly RoomPayout[] = [
  sng("Sit & go, heads-up", 2, [100], WSOP_SNG),
  sng("Sit & go, 6 players", 6, [70, 30], WSOP_SNG),
  sng("Sit & go, 9 players", 9, [50, 30, 20], WSOP_SNG),
  sng("Sit & go, 18 players", 18, [45, 30, 15, 10], WSOP_SNG),
  sng("Sit & go, 27 players", 27, [45, 25, 15, 10, 5], WSOP_SNG),
  ...mtt(W10, 10),
  ...mtt(W15, 15),
  ...mtt(W20, 20),
  sng("Sit & go, 10-handed", 10, [50, 30, 20], BETMGM_SNG),
  sng("Sit & go, 6-handed", 6, [60, 40], BETMGM_SNG),
  sng("Sit & go, 2 tables", 20, [40, 30, 20, 10], BETMGM_SNG),
  sng("Sit & go, 3 tables", 30, [30, 25, 20, 15, 10], BETMGM_SNG),
  sng("Sit & go, 5 tables", 50, [30, 22, 17, 12, 9, 6, 4], BETMGM_SNG),
  sng("Sit & go paying 4 places", 10, [41, 29, 19, 11], PLAYNOW_SNG),
  sng("Cooler (double up), 10 players", 10, [20, 20, 20, 20, 20], PLAYNOW_SNG),
  sng("Cooler (double up), 8-handed", 8, [25, 25, 25, 25], PLAYNOW_SNG),
  sng("Triple up, 30 players", 30, Array<number>(10).fill(10), PLAYNOW_SNG),
];

export const ROOMS: readonly string[] = [...new Set(ROOM_PAYOUTS.map((p) => p.source.room))];

/** The label a table carries wherever it's used: "as posted by WSOP Online on 2026-11-17". */
export const postedBy = (p: RoomPayout) => `as posted by ${p.source.room} on ${p.source.read}`;

/** The room's table for a field of this many entrants (an MTT's by its range), or null. */
export function roomPayoutFor(room: string, name: string): RoomPayout | null {
  return ROOM_PAYOUTS.find((p) => p.source.room === room && p.name === name) ?? null;
}

/** An MTT table of this room's at this share paid for this many entrants. */
export function roomMtt(room: string, pct: number, entrants: number): RoomPayout | null {
  return ROOM_PAYOUTS.find((p) => p.source.room === room && p.name.endsWith(`top ${pct}% paid`) && entrants >= p.entrants[0] && entrants <= p.entrants[1]) ?? null;
}
