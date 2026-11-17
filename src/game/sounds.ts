// Sounds, synthesised with Web Audio. No files, no libraries, about 4 KB.
// The palette is a kitchen table: a card on oilcloth, a wooden peg, a knuckle on the table for
// "go", a spoon on an enamel mug for a score, a kitchen timer for the 29.
//
//   unlock()                      call once from the first tap; browsers need a gesture
//   play('snap')                  now
//   play('tick', { step: 3 })     the count: each step a note higher
//   play('peg', { at: 0.2 })      0.2 s from now
//   setVolume(0..1), setMuted(bool), setVariant('peg', 'pin')
//
// These were designed on paper and have not been heard by the designer. Audition them on the
// sound board page, pick by ear, and change VARIANT below to match.
//
// Ported from handoff v3 sounds.js with types and two additions (sound.md): the on/off
// switch, kept on this device (on by default; the toggle is on the Profile screen), and
// play() never starts the audio context itself, so nothing sounds before the first tap.
import { useSyncExternalStore } from 'react';

export type SoundName =
  | 'snap' | 'deal' | 'flip' | 'peg' | 'pegTick' | 'tick' | 'ting' | 'knock' | 'win' | 'thud' | 'stamp' | 'twentyNine';
export interface PlayOptions {
  /** Seconds from now. */
  at?: number;
  /** The count: which step this is, from 0. */
  step?: number;
}

let ctx!: AudioContext;
let master!: GainNode;
let ready = false;

// ---- the switch: one per device, on by default ----

const KEY = 'cabbage:sound';
const listeners = new Set<() => void>();
function readOn(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}
let on = typeof localStorage === 'undefined' ? true : readOn();
let muted = !on;

export function setSoundOn(next: boolean): void {
  on = next;
  muted = !next;
  try {
    localStorage.setItem(KEY, next ? 'on' : 'off');
  } catch {
    // Private mode: keep it for this visit.
  }
  for (const l of listeners) l();
}

export function useSoundOn(): [boolean, (on: boolean) => void] {
  const v = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => on,
    () => on,
  );
  return [v, setSoundOn];
}

export const VARIANT: Record<'snap' | 'peg' | 'tick' | 'ting', string> = { snap: 'soft', peg: 'wood', tick: 'rising', ting: 'mug' };
export const setVariant = (name: keyof typeof VARIANT, v: string): void => { VARIANT[name] = v; };

/** Call from a tap: browsers only start audio on a gesture. */
export function unlock(): AudioContext | null {
  if (muted && !ready) return null; // sound off: never make a context at all
  if (!ready) {
    const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
    const AC = w.AudioContext || w.webkitAudioContext;
    if (!AC) return null;
    try {
      ctx = new AC();
    } catch {
      return null;
    }
    master = ctx.createGain();
    master.gain.value = 0.6;
    master.connect(ctx.destination);
    ready = true;
  }
  if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
  return ctx;
}
export function setVolume(v: number): void { if (ready) master.gain.value = Math.max(0, Math.min(1, v)); }
export function setMuted(m: boolean): void { muted = m; }

// ---- three building blocks ----

let noiseBuf: AudioBuffer | null = null;
function noiseBuffer(): AudioBuffer {
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}

function shape(gainNode: GainNode, t: number, peak: number, attack: number, decay: number): void {
  const g = gainNode.gain;
  g.setValueAtTime(0.0001, t);
  g.exponentialRampToValueAtTime(peak, t + attack);
  g.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}

/** Filtered noise: the papery, tappy part of a sound. */
function burst(t: number, { type = 'bandpass', freq, to, q = 1, dur, gain }: { type?: BiquadFilterType; freq: number; to?: number; q?: number; dur: number; gain: number }): void {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer();
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.Q.value = q;
  f.frequency.setValueAtTime(freq, t);
  if (to) f.frequency.exponentialRampToValueAtTime(to, t + dur);
  const g = ctx.createGain();
  shape(g, t, gain, 0.002, dur);
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.02);
}

/** A pitched thump or tock that falls in pitch as it dies. */
function tone(t: number, { from, to, dur, gain, wave = 'sine' }: { from: number; to: number; dur: number; gain: number; wave?: OscillatorType }): void {
  const o = ctx.createOscillator();
  o.type = wave;
  o.frequency.setValueAtTime(from, t);
  o.frequency.exponentialRampToValueAtTime(to, t + dur);
  const g = ctx.createGain();
  shape(g, t, gain, 0.002, dur);
  o.connect(g); g.connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

/** Struck metal: three partials that are not in tune with each other, like enamelware. */
function ring(t: number, { f, dur, gain }: { f: number; dur: number; gain: number }): void {
  [[1, 1], [2.76, 0.45], [5.4, 0.2]].forEach(([mult, level]) => {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = f * mult;
    const g = ctx.createGain();
    shape(g, t, gain * level, 0.001, dur / mult ** 0.5);
    o.connect(g); g.connect(master);
    o.start(t);
    o.stop(t + dur + 0.05);
  });
}

// ---- the sounds ----

const SCALE = [1, 9 / 8, 5 / 4, 3 / 2, 5 / 3, 2, 9 / 4, 5 / 2, 3, 10 / 3]; // major pentatonic, upward

const SOUNDS: Record<SoundName, (t: number, opts?: PlayOptions) => void> = {
  // A card landing. Fires when the card lands, never when it leaves.
  snap(t: number) {
    if (VARIANT.snap === 'crisp') {
      burst(t, { type: 'highpass', freq: 3500, dur: 0.03, gain: 0.55 });
      burst(t, { freq: 1200, q: 2, dur: 0.02, gain: 0.2 });
    } else {
      burst(t, { freq: 2600, q: 0.8, dur: 0.05, gain: 0.5 });
      tone(t, { from: 180, to: 90, dur: 0.04, gain: 0.25 });
    }
  },
  // Dealt cards: the snap, quieter, so twelve in a row are not tiring.
  deal(t: number) {
    burst(t, { freq: 2200 + Math.random() * 800, q: 0.8, dur: 0.035, gain: 0.22 });
  },
  // The starter turning over: a short swish, then it lands.
  flip(t: number) {
    burst(t, { freq: 800, to: 3200, q: 1.2, dur: 0.12, gain: 0.14 });
    SOUNDS.snap(t + 0.12);
  },
  // A peg seating in its hole.
  peg(t: number) {
    if (VARIANT.peg === 'pin') {
      tone(t, { from: 1500, to: 1100, dur: 0.04, gain: 0.35 });
      burst(t, { type: 'highpass', freq: 5000, dur: 0.008, gain: 0.2 });
    } else {
      tone(t, { from: 720, to: 520, dur: 0.07, gain: 0.5, wave: 'triangle' });
      burst(t, { freq: 2000, q: 3, dur: 0.012, gain: 0.3 });
    }
  },
  // A peg passing every fifth hole on a long move. Barely there.
  pegTick(t: number) {
    tone(t, { from: 1900, to: 1700, dur: 0.02, gain: 0.07 });
  },
  // One step of the spoken count: a fingertip on the table. With the 'rising' variant each
  // step is a note higher, so a big hand climbs; pass { step } starting at 0.
  tick(t: number, { step = 0 }: PlayOptions = {}) {
    const k = VARIANT.tick === 'rising' ? SCALE[Math.min(step, SCALE.length - 1)] : 1;
    tone(t, { from: 440 * k, to: 400 * k, dur: 0.06, gain: 0.22, wave: 'triangle' });
    burst(t, { type: 'lowpass', freq: 900, dur: 0.02, gain: 0.12 });
  },
  // A score in pegging, and the total at the end of a count: a spoon on an enamel mug.
  ting(t: number) {
    ring(t, { f: VARIANT.ting === 'bowl' ? 880 : 1320, dur: 0.4, gain: 0.28 });
  },
  // "Go": a knuckle on the table, twice. Players really do knock.
  knock(t: number) {
    [0, 0.16].forEach((dt, i) => {
      tone(t + dt, { from: 140, to: 70, dur: 0.09, gain: i ? 0.5 : 0.65 });
      burst(t + dt, { type: 'lowpass', freq: 400, dur: 0.03, gain: 0.35 });
    });
  },
  // Winning: three tings, climbing.
  win(t: number) {
    [1047, 1319, 1568].forEach((f, i) => ring(t + i * 0.14, { f, dur: i === 2 ? 0.9 : 0.35, gain: 0.26 }));
  },
  // The kiwi landing on its plinth: a soft, heavy thump and one small bounce.
  thud(t: number) {
    tone(t, { from: 110, to: 45, dur: 0.22, gain: 0.8 });
    burst(t, { type: 'lowpass', freq: 300, dur: 0.08, gain: 0.45 });
    tone(t + 0.28, { from: 95, to: 50, dur: 0.12, gain: 0.3 });
  },
  // The SKUNKED plate stamping.
  stamp(t: number) {
    burst(t, { freq: 600, q: 0.7, dur: 0.09, gain: 0.65 });
    tone(t, { from: 90, to: 60, dur: 0.1, gain: 0.5 });
  },
  // A 29: the kitchen timer goes off. Used nowhere else.
  twentyNine(t: number) {
    [0, 0.22, 0.44].forEach((dt) => ring(t + dt, { f: 1760, dur: 1.4, gain: 0.3 }));
    ring(t + 0.44, { f: 880, dur: 1.8, gain: 0.2 });
  },
};

export const NAMES = Object.keys(SOUNDS) as SoundName[];

const lastPlayed: Partial<Record<SoundName, number>> = {};
const MIN_GAP: Partial<Record<SoundName, number>> = { deal: 0.05, pegTick: 0.04, snap: 0.03 }; // seconds; stops machine-gunning on skip

export function play(name: SoundName, opts: PlayOptions = {}): void {
  // Nothing before the first tap has unlocked audio, and nothing while the tab is hidden.
  if (muted || !ready || !SOUNDS[name] || ctx.state !== 'running') return;
  if (typeof document !== 'undefined' && document.hidden) return;
  const t = ctx.currentTime + (opts.at || 0);
  const gap = MIN_GAP[name];
  const last = lastPlayed[name];
  if (gap && last !== undefined && t - last < gap) return;
  lastPlayed[name] = t;
  SOUNDS[name](t, opts);
}
