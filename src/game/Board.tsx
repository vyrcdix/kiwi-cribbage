// The board as SVG (handoff v2 Board.jsx): four rows of 30, a lane per team, front and
// back pegs, the skunk (91) and double-skunk (61) tabs at the heads of rows four and
// three, and the finish hole. Two or three lanes in the same 358 x 156 drawing: with
// three, the lanes sit 9 apart, holes are 3.6 and pegs 9 across. Lanes run top to
// bottom clockwise from your left; yours is always the bottom one. Pegs move in JS
// along the track (motion.md): the back peg leapfrogs the front one, lifting, hopping
// or gliding, fading across a row change and seating with a small overshoot.
import { play } from './sounds';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { onSkip, reducedMotion } from './motion';
import {
  FINISH, HOLES_X2, PER_ROW, ROWS, START_X, VIEW_H, VIEW_W, X0,
  type PegFrame, holeXY, laneY, pegTimeline, rowCentre,
} from './pegPath';
import type { TeamColour } from './TeamMark';

export interface BoardTeam {
  team: number;
  /** tomato is always your team; blue the other team; mustard the third player in cut-throat. */
  colour: TeamColour;
  name: string;
}

interface Props {
  /** Top to bottom, clockwise from your left: the others' lanes above, yours at the bottom. */
  teams: BoardTeam[];
  /** By team: where the pegs should be. Changing these animates the pegs. */
  scores: number[];
  back: number[];
  /** Called as each team's peg seats. */
  onSeated?: (team: number, score: number) => void;
  /** The finish hole's ring turns butter when someone wins. */
  finishLit?: boolean;
}

// One dot per hole, five to a group. A round-capped zero-length dash draws a dot.
const HOLES = '0.01 9.59 0.01 9.59 0.01 9.59 0.01 9.59 0.01 12.59';

/** Team colours. `shape` is the second cue, so colour is never the only one. */
export const TEAM: Record<TeamColour, { peg: string; ring: string; tint: string; outline: string; shape: 'round' | 'diamond' }> = {
  tomato: { peg: '#BE3228', ring: '#BE3228', tint: '#CC8F88', outline: '#FCFAF4', shape: 'round' },
  blue: { peg: '#2B5278', ring: '#2B5278', tint: '#7F93A8', outline: '#FCFAF4', shape: 'round' },
  mustard: { peg: '#C8900F', ring: '#8F6608', tint: '#94803F', outline: '#1F2723', shape: 'diamond' },
};

/** Hole, peg and ring sizes for two and three lanes. */
const LAYOUT = {
  2: { hole: 4.4, peg: 5.6, back: 4.2, ring: 2.4 },
  3: { hole: 3.6, peg: 4.5, back: 3.3, ring: 2 },
} as const;

interface PegPair {
  pos: [number, number];
  /** Index into pos of the front peg. */
  front: 0 | 1;
}

interface Running {
  finish: () => void;
}

const frameAttr = (f: PegFrame) => `translate(${f.x.toFixed(2)} ${f.y.toFixed(2)}) scale(${f.s.toFixed(3)})`;

export function Board({ teams: lanes, scores, back, onSeated, finishLit }: Props) {
  const nLanes = lanes.length;
  const small = nLanes > 2;
  const L = LAYOUT[small ? 3 : 2];
  const laneOf = (team: number) => lanes.findIndex((l) => l.team === team);
  const pairs = useRef<Record<number, PegPair>>({});
  const pegEls = useRef<Record<string, SVGGElement | null>>({});
  const running = useRef<Record<number, Running>>({});
  const [, rerender] = useState(0);
  const [pulse, setPulse] = useState<number | null>(null);
  const [flashes, setFlashes] = useState<{ id: number; x: number; y: number }[]>([]);
  const flashId = useRef(0);
  const seated = useRef(onSeated);
  seated.current = onSeated;

  // First sight of a team: pegs where the server says, no motion.
  for (const l of lanes) {
    if (!pairs.current[l.team]) pairs.current[l.team] = { pos: [back[l.team] ?? 0, scores[l.team] ?? 0], front: 1 };
  }

  useEffect(() => onSkip(() => {
    for (const r of Object.values(running.current)) r.finish();
  }), []);

  useLayoutEffect(() => {
    for (const l of lanes) {
      const t = l.team;
      const pair = pairs.current[t];
      const target: [number, number] = [back[t] ?? 0, scores[t] ?? 0];
      const fp = pair.pos[pair.front];
      const bp = pair.pos[1 - pair.front];
      if (fp === target[1] && bp === target[0]) continue;
      running.current[t]?.finish();

      const lane = laneOf(t);
      const reduced = reducedMotion();
      const backIdx = (1 - pair.front) as 0 | 1;
      let moves: { peg: 0 | 1; to: number }[];
      if (fp === target[0] && target[1] > fp) moves = [{ peg: backIdx, to: target[1] }];
      else if (target[0] > fp && target[1] > target[0] && bp <= target[0]) {
        // Two awards in one message: back peg to the new back, then the other to the front.
        moves = [{ peg: backIdx, to: target[0] }, { peg: pair.front, to: target[1] }];
      } else {
        // A jump we can't explain as peg moves (reconnect, a new game): just place them.
        pair.pos = [target[0], target[1]];
        pair.front = 1;
        rerender((n) => n + 1);
        seated.current?.(t, target[1]);
        continue;
      }
      runMoves(t, lane, moves, reduced);
    }
  }, [scores.join(','), back.join(','), lanes.map((l) => l.team).join(',')]);

  function runMoves(team: number, lane: number, moves: { peg: 0 | 1; to: number }[], reduced: boolean) {
    let i = 0;
    let raf = 0;
    let cancelled = false;
    const pair = pairs.current[team];
    const tabTimers: ReturnType<typeof setTimeout>[] = [];

    const seat = (m: { peg: 0 | 1; to: number }) => {
      pair.pos[m.peg] = m.to;
      pair.front = m.peg;
      const el = pegEls.current[`${team}-${m.peg}`];
      if (el) {
        const { x, y } = holeXY(m.to, lane, nLanes);
        el.setAttribute('transform', `translate(${x} ${y}) scale(1)`);
        el.setAttribute('opacity', '1');
        el.removeAttribute('data-lifted');
      }
      if (reduced) {
        const { x, y } = holeXY(m.to, lane, nLanes);
        const id = ++flashId.current;
        setFlashes((f) => [...f, { id, x, y }]);
        setTimeout(() => setFlashes((f) => f.filter((x2) => x2.id !== id)), 500);
      }
    };

    const startMove = () => {
      const m = moves[i];
      const from = pair.pos[m.peg];
      const tl = pegTimeline(from, m.to, lane, nLanes, reduced);
      const el = pegEls.current[`${team}-${m.peg}`];
      const shadow = el?.querySelector('.peg__shadow');
      el?.setAttribute('data-lifted', '');
      for (const e of tl.rowEntries) {
        if (e.row >= 2) tabTimers.push(setTimeout(() => setPulse(e.row), e.t));
      }
      // A long move ticks, barely, past every fifth hole (sound.md). Cleared with the
      // move, so a skip never bursts.
      if (!reduced && m.to - from > 5) {
        for (let h = Math.ceil((from + 1) / 5) * 5; h < m.to; h += 5) {
          tabTimers.push(setTimeout(() => play('pegTick'), (tl.duration * (h - from)) / (m.to - from)));
        }
      }
      const t0 = performance.now();
      const tick = (now: number) => {
        if (cancelled) return;
        const t = now - t0;
        if (t >= tl.duration) {
          seat(m);
          i += 1;
          if (i < moves.length) startMove();
          else done();
          return;
        }
        const f = tl.at(t);
        if (el) {
          el.setAttribute('transform', frameAttr(f));
          el.setAttribute('opacity', f.o.toFixed(3));
          shadow?.setAttribute('opacity', (((f.s - 1) / 0.25) * 0.22).toFixed(3));
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    };

    const done = () => {
      delete running.current[team];
      rerender((n) => n + 1);
      seated.current?.(team, pair.pos[pair.front]);
    };

    running.current[team] = {
      finish: () => {
        if (cancelled) return;
        cancelled = true;
        cancelAnimationFrame(raf);
        tabTimers.forEach(clearTimeout);
        for (; i < moves.length; i++) seat(moves[i]);
        done();
      },
    };
    startMove();
  }

  useEffect(() => {
    if (pulse === null) return;
    const t = setTimeout(() => setPulse(null), 450);
    return () => clearTimeout(t);
  }, [pulse]);

  useEffect(() => () => {
    for (const r of Object.values(running.current)) r.finish();
  }, []);

  const label = `Board. ${lanes.map((l) => `${l.name} ${scores[l.team]}`).join(', ')}. Double skunk line at 61, skunk line at 91.`;

  return (
    <svg className="board" viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} role="img" aria-label={label} data-lanes={nLanes}>
      <rect x="0.75" y="0.75" width="356.5" height="154.5" rx="14" fill="#FCFAF4" stroke="#1F2723" strokeWidth="1.5" />

      {Array.from({ length: ROWS }, (_, row) => {
        const top = rowCentre(row) - 15;
        const line = row >= 2; // rows three and four start at 61 and 91
        return (
          <g key={row}>
            <rect x="6" y={top} width="346" height="30" rx="8" fill={row === 3 ? '#DCE8C8' : '#F1EBDA'} />
            {line && (
              <rect className={`board__tab${pulse === row ? ' is-pulsing' : ''}`} x="6" y={top} width="23" height="30" rx="8" fill="#BE3228" />
            )}
            <text className="board__row" x="17.5" y={rowCentre(row) + 4} fill={line ? '#FCFAF4' : '#1F2723'}>
              {row * PER_ROW + 1}
            </text>
            {lanes.map((l, lane) => (
              <line
                key={l.team}
                x1={X0}
                x2={HOLES_X2}
                y1={laneY(row, lane, nLanes)}
                y2={laneY(row, lane, nLanes)}
                stroke={TEAM[l.colour].tint}
                strokeWidth={L.hole}
                strokeLinecap="round"
                strokeDasharray={HOLES}
              />
            ))}
          </g>
        );
      })}

      {lanes.map((l, lane) => (
        <circle key={l.team} cx={START_X} cy={laneY(0, lane, nLanes)} r={L.hole * 0.42} fill={TEAM[l.colour].tint} />
      ))}

      <g className={`board__finish${finishLit ? ' is-lit' : ''}`}>
        <circle cx={FINISH.x} cy={FINISH.y} r="6.5" fill="#FCFAF4" stroke={finishLit ? '#E9B93B' : '#1F2723'} strokeWidth={finishLit ? 3 : 1.5} />
        <circle cx={FINISH.x} cy={FINISH.y} r="2.6" fill="#1F2723" />
      </g>

      {flashes.map((f) => (
        <circle key={f.id} className="board__flash" cx={f.x} cy={f.y} r={small ? 6.5 : 8} fill="none" stroke="#E9B93B" strokeWidth="2.5" />
      ))}

      {/* Back pegs first, so a front peg sharing a hole sits on top. */}
      {[false, true].map((drawFront) =>
        lanes.map((l, lane) => {
          const pair = pairs.current[l.team];
          return ([0, 1] as const)
            .filter((i) => (i === pair.front) === drawFront)
            .map((i) => {
              const { x, y } = holeXY(pair.pos[i], lane, nLanes);
              const t = TEAM[l.colour];
              const isFront = i === pair.front;
              const r = isFront ? L.peg : L.back;
              const fill = isFront ? t.peg : '#FCFAF4';
              const stroke = isFront ? t.outline : t.ring;
              const sw = isFront ? (t.shape === 'diamond' ? 1.1 : 1.4) : L.ring;
              return (
                <g
                  key={`${l.team}-${i}`}
                  ref={(el) => {
                    pegEls.current[`${l.team}-${i}`] = el;
                  }}
                  className={isFront ? 'peg peg--front' : 'peg peg--back'}
                  data-shape={t.shape}
                  transform={`translate(${x} ${y}) scale(1)`}
                >
                  <circle className="peg__shadow" cx="0.8" cy="1.6" r={L.peg} fill="#1F2723" opacity="0" />
                  {t.shape === 'diamond' ? (
                    <rect x={-r * 0.88} y={-r * 0.88} width={r * 1.76} height={r * 1.76} transform="rotate(45)" fill={fill} stroke={stroke} strokeWidth={sw} />
                  ) : (
                    <circle r={r} fill={fill} stroke={stroke} strokeWidth={sw} />
                  )}
                  {isFront && t.shape === 'round' && <circle cx={-r * 0.3} cy={-r * 0.3} r={r * 0.27} fill="#FCFAF4" opacity="0.6" />}
                </g>
              );
            });
        }),
      )}
    </svg>
  );
}
