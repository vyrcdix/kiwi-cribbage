// Board geometry and peg motion, kept free of React (handoff Board.jsx and motion.md,
// "The peg advancing").
//
// A straight track in four rows of 30, drawn in a 358 x 156 viewBox. Every row runs
// left to right; row three starts at 61 (the double-skunk line) and row four at 91
// (the skunk line). One lane per team inside each row: two lanes as designed, three
// for a three-player game (the lanes sit closer and the pegs are a little smaller).
import { DUR, EASE } from './motion';

export const ROWS = 4;
export const PER_ROW = 30;
export const VIEW_W = 358;
export const VIEW_H = 156;
const ROW_CENTRE = 27; // centre of row one's lanes
export const ROW_STEP = 34;
export const X0 = 38; // first hole of a row
export const PITCH = 9.6; // hole to hole inside a group of five
export const GROUP = 51; // start of one group to the start of the next
export const START_X = 32; // the off-board starting holes
export const HOLES_X2 = 333;
export const FINISH = { x: 344, y: ROW_CENTRE + 3 * ROW_STEP };
export const GAME = 121;

export const laneGap = (lanes: number): number => (lanes >= 3 ? 9.6 : 12);
export const rowCentre = (row: number): number => ROW_CENTRE + row * ROW_STEP;
export const laneY = (row: number, lane: number, lanes: number): number =>
  rowCentre(row) + (lane - (lanes - 1) / 2) * laneGap(lanes);

/** Which row a score sits in (0 … 3). The start holes are in row one, the finish in row four. */
export const rowOf = (score: number): number =>
  score <= 0 ? 0 : score >= GAME ? ROWS - 1 : Math.floor((score - 1) / PER_ROW);

export interface XY { x: number; y: number }

/** Hole centre for a score 0 … 121 in a lane (0 = the top lane). */
export function holeXY(score: number, lane: number, lanes: number): XY {
  if (score >= GAME) return FINISH;
  if (score <= 0) return { x: START_X, y: laneY(0, lane, lanes) };
  const m = (score - 1) % PER_ROW;
  return { x: X0 + Math.floor(m / 5) * GROUP + (m % 5) * PITCH, y: laneY(rowOf(score), lane, lanes) };
}

// ---- motion ----

export interface PegFrame {
  x: number;
  y: number;
  /** Scale: 1.25 while lifted. */
  s: number;
  /** Opacity: fades across a row change. */
  o: number;
}

export interface PegTimeline {
  duration: number;
  at: (t: number) => PegFrame;
  /** When the peg appears at the head of a new row (for the tomato tab pulse). */
  rowEntries: { t: number; row: number }[];
}

interface Phase {
  dur: number;
  f: (u: number) => PegFrame;
}

const LIFT = 1.25;

/**
 * The path of one peg from `from` to `to` (to > from):
 * lift (90 ms) → hop hole by hole (70 ms each, moves of 5 or fewer) or glide
 * (30 ms a hole, at most 900 ms, ease-in-out) → seat (120 ms, overshoot).
 * A row change never flies diagonally: the peg fades out at the end of one row
 * and in at the head of the next (120 ms). Reduced motion: fade out, fade in.
 */
export function pegTimeline(from: number, to: number, lane: number, lanes: number, reduced: boolean): PegTimeline {
  const at = (sc: number) => holeXY(sc, lane, lanes);
  const phases: Phase[] = [];
  const rowEntries: { t: number; row: number }[] = [];
  const total = () => phases.reduce((n, p) => n + p.dur, 0);

  if (reduced || to <= from) {
    const a = at(from);
    const b = at(to);
    phases.push({ dur: DUR.reduced / 2, f: (u) => ({ ...a, s: 1, o: 1 - u }) });
    phases.push({ dur: DUR.reduced / 2, f: (u) => ({ ...b, s: 1, o: u }) });
  } else {
    const n = to - from;
    const hop = n <= 5;
    const perHole = hop ? DUR.pegHop : Math.min(DUR.pegGlidePerHole, DUR.pegGlideMax / n);
    // Split the holes into runs that stay in one row.
    const runs: [number, number][] = [];
    let start = from;
    for (let sc = from + 1; sc <= to; sc++) {
      if (rowOf(sc) !== rowOf(sc - 1)) {
        runs.push([start, sc - 1]);
        start = sc;
      }
    }
    runs.push([start, to]);

    const a0 = at(from);
    phases.push({ dur: DUR.pegLift, f: (u) => ({ ...a0, s: 1 + (LIFT - 1) * EASE.out(u), o: 1 }) });
    runs.forEach(([a, b], i) => {
      if (i > 0) {
        const prev = at(runs[i - 1][1]);
        const next = at(a);
        phases.push({ dur: DUR.pegRow / 2, f: (u) => ({ ...prev, s: LIFT, o: 1 - u }) });
        rowEntries.push({ t: total(), row: rowOf(a) });
        phases.push({ dur: DUR.pegRow / 2, f: (u) => ({ ...next, s: LIFT, o: u }) });
      }
      const moves = b - a;
      if (moves <= 0) return;
      phases.push({
        dur: moves * perHole,
        f: (u) => {
          const k = (hop ? u : EASE.inOut(u)) * moves;
          const idx = Math.min(moves - 1, Math.floor(k));
          const frac = k - idx;
          const p = at(a + idx);
          const q = at(a + idx + 1);
          const e = hop ? EASE.out(frac) : frac;
          const arc = hop ? Math.sin(Math.PI * frac) * 2.4 : 0;
          return { x: p.x + (q.x - p.x) * e, y: p.y + (q.y - p.y) * e - arc, s: LIFT, o: 1 };
        },
      });
    });
    const z = at(to);
    phases.push({ dur: DUR.pegSeat, f: (u) => ({ ...z, s: LIFT + (1 - LIFT) * EASE.seat(u), o: 1 }) });
  }

  const duration = total();
  return {
    duration,
    rowEntries,
    at: (t: number) => {
      let acc = 0;
      for (const p of phases) {
        if (t < acc + p.dur) return p.f(p.dur ? (t - acc) / p.dur : 1);
        acc += p.dur;
      }
      const last = phases[phases.length - 1];
      return last.f(1);
    },
  };
}
