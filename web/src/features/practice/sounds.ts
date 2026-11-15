// Practice's sound effects, made on the spot with Web Audio (no files to fetch): a card dealt or turned, a check's knock,
// chips for a call or a bet, a fold's swish, a short chime for a good decision and a low one for a costly one. Off in
// Settings or by the Practice page's switch (`sounds`); silent where the browser has no Web Audio (tests) or the tab
// is hidden.
import { useEffect, useRef } from "react";
import { useSettings } from "@/state/settings";
import type { PracticeHand } from "./practice";
import type { MoveKind } from "@/poker/table";

export type Sound = "deal" | "card" | "check" | "call" | "bet" | "allin" | "fold" | "good" | "bad" | "win";

let ctx: AudioContext | null = null;
let noise: AudioBuffer | null = null;

function audio(): AudioContext | null {
  if (ctx) return ctx;
  const AC = typeof window === "undefined" ? undefined : (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
  if (!AC) return null;
  try {
    ctx = new AC();
  } catch {
    return null;
  }
  return ctx;
}

function noiseOf(c: AudioContext): AudioBuffer {
  if (noise) return noise;
  const b = c.createBuffer(1, Math.floor(c.sampleRate * 0.4), c.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return (noise = b);
}

/** a short burst of filtered noise: cards, folds, knocks */
function hiss(c: AudioContext, at: number, dur: number, freq: number, q: number, gain: number, type: BiquadFilterType = "bandpass") {
  const src = c.createBufferSource();
  src.buffer = noiseOf(c);
  const f = c.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(gain, at);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  src.connect(f).connect(g).connect(c.destination);
  src.start(at);
  src.stop(at + dur + 0.02);
}

/** a decaying tone: chips, chimes */
function tone(c: AudioContext, at: number, freq: number, dur: number, gain: number, type: OscillatorType = "sine", toFreq?: number) {
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, at);
  if (toFreq) o.frequency.exponentialRampToValueAtTime(toFreq, at + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g).connect(c.destination);
  o.start(at);
  o.stop(at + dur + 0.02);
}

/** one chip landing: two bright partials, slightly detuned per chip */
function chip(c: AudioContext, at: number, gain = 0.06) {
  const base = 2600 + Math.random() * 500;
  tone(c, at, base, 0.06, gain, "triangle");
  tone(c, at, base * 1.48, 0.04, gain * 0.6, "sine");
  hiss(c, at, 0.03, 5000, 1.5, gain * 0.8);
}

/** Play one sound now (or `delay` seconds from now). Does nothing where it can't. */
export function playSound(s: Sound, delay = 0) {
  if (typeof document !== "undefined" && document.hidden) return;
  const c = audio();
  if (!c) return;
  if (c.state === "suspended") void c.resume().catch(() => {});
  const t = c.currentTime + 0.01 + delay;
  switch (s) {
    case "deal":
      hiss(c, t, 0.05, 3200, 0.8, 0.18);
      hiss(c, t + 0.09, 0.05, 3200, 0.8, 0.18);
      break;
    case "card":
      hiss(c, t, 0.07, 2400, 0.7, 0.2);
      break;
    case "check":
      tone(c, t, 180, 0.07, 0.25, "sine", 90);
      tone(c, t + 0.1, 180, 0.07, 0.2, "sine", 90);
      break;
    case "call":
      chip(c, t);
      chip(c, t + 0.05);
      break;
    case "bet":
      for (let i = 0; i < 4; i++) chip(c, t + i * 0.045);
      break;
    case "allin":
      for (let i = 0; i < 9; i++) chip(c, t + i * 0.035 + Math.random() * 0.01, 0.05);
      break;
    case "fold":
      hiss(c, t, 0.18, 1200, 0.5, 0.12, "lowpass");
      break;
    case "good":
      tone(c, t, 880, 0.18, 0.08);
      tone(c, t + 0.08, 1320, 0.25, 0.07);
      break;
    case "bad":
      tone(c, t, 330, 0.22, 0.09, "triangle", 247);
      break;
    case "win":
      tone(c, t, 660, 0.15, 0.07);
      tone(c, t + 0.09, 880, 0.15, 0.07);
      tone(c, t + 0.18, 1320, 0.3, 0.07);
      break;
  }
}

const MOVE_SOUND: Record<MoveKind, Sound> = { fold: "fold", check: "check", call: "call", bet: "bet", raise: "bet", "all-in": "allin" };

const movesIn = (h: PracticeHand) => h.lines.preflop.length + h.lines.flop.length + h.lines.turn.length + h.lines.river.length;
const lastMove = (h: PracticeHand) => h.lines.river.at(-1) ?? h.lines.turn.at(-1) ?? h.lines.flop.at(-1) ?? h.lines.preflop.at(-1);
const graded = (h: PracticeHand) => h.decisions.filter((d) => d.grade).length;

/** What changed from one state of a table's hand to the next, as the sounds to play (exported for its test). */
export function soundsBetween(prev: PracticeHand, next: PracticeHand): Sound[] {
  if (prev.seed !== next.seed || prev.n !== next.n) return ["deal"];
  const out: Sound[] = [];
  if (movesIn(next) > movesIn(prev)) {
    const m = lastMove(next);
    if (m) out.push(MOVE_SOUND[m.action]);
  }
  if (next.shown > prev.shown) out.push("card");
  if (graded(next) > graded(prev)) {
    const v = next.decisions.filter((d) => d.grade).at(-1)!.grade!.verdict;
    if (v === "Best" || v === "Correct") out.push("good");
    else if (v === "Mistake" || v === "Blunder") out.push("bad");
  }
  if (!prev.result && next.result && !next.result.cut && next.result.net > 0) out.push("win");
  return out;
}

/** Play a table's sounds as its hand moves on (nothing on mount: a hand restored on a reload is quiet). */
export function useHandSounds(hand: PracticeHand) {
  const on = useSettings((s) => s.sounds);
  const prev = useRef(hand);
  useEffect(() => {
    const was = prev.current;
    prev.current = hand;
    if (!on || was === hand) return;
    soundsBetween(was, hand).forEach((s, i) => playSound(s, i * 0.12));
  }, [hand, on]);
}
