// A plain, legible cribbage track: three streets of 40 holes, two lanes each
// (opponent above, you below), a front and back peg per player, the skunk
// line at 91 (and the double-skunk line at 61), and the game hole at 121.
import type { ReactElement } from 'react';
import type { Seat } from '../../shared/game';

const ROWS = 3;
const HOLE = 10;
const GAP = 6; // extra space between groups of five
const PAD_L = 20;
const PAD_R = 22;
const TOP = 9;
const LANE = 10;
const STREET = 34; // vertical distance between streets
const BAR_H = 24;

interface Props {
  target: number;
  you: Seat;
  scores: [number, number];
  back: [number, number];
  names: [string, string];
}

export function ScoreTrack({ target, you, scores, back, names }: Props) {
  const holes = target - 1;
  const cols = Math.ceil(holes / ROWS);
  const groups = Math.ceil(cols / 5);
  const width = PAD_L + cols * HOLE + (groups - 1) * GAP + PAD_R;
  const height = TOP + (ROWS - 1) * STREET + BAR_H + 6;
  const opp: Seat = you === 0 ? 1 : 0;
  // lane 0 = opponent (top), lane 1 = you (bottom), matching the table.
  const laneOf = (seat: Seat) => (seat === you ? 1 : 0);

  const colX = (col: number) => PAD_L + col * HOLE + Math.floor(col / 5) * GAP + HOLE / 2;
  const laneY = (row: number, lane: number) => TOP + row * STREET + 7 + lane * LANE;
  const finishX = width - PAD_R / 2 - 1;

  const pos = (score: number, lane: number): [number, number] => {
    if (score <= 0) return [PAD_L / 2, laneY(0, lane)];
    if (score >= target) return [finishX, laneY(ROWS - 1, lane)];
    const i = score - 1;
    return [colX(i % cols), laneY(Math.floor(i / cols), lane)];
  };

  // x of the boundary just before hole n, and its street.
  const lineAt = (n: number) => {
    const i = n - 1;
    const col = i % cols;
    const x = col === 0 ? PAD_L - 2 : (colX(col - 1) + colX(col)) / 2;
    return { x, row: Math.floor(i / cols) };
  };
  const skunk = lineAt(Math.ceil((target * 3) / 4));
  const double = lineAt(Math.ceil(target / 2));

  const holesEls: ReactElement[] = [];
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < cols; col++) {
      if (row * cols + col >= holes) break;
      for (let lane = 0; lane < 2; lane++) {
        holesEls.push(<circle key={`${row}-${col}-${lane}`} cx={colX(col)} cy={laneY(row, lane)} r={1.9} className="track__hole" />);
      }
    }
  }

  const peg = (seat: Seat, which: 'front' | 'back') => {
    const lane = laneOf(seat);
    const score = which === 'front' ? scores[seat] : back[seat];
    const [x, y] = pos(score, lane);
    return (
      <circle
        key={`${seat}-${which}`}
        className={`track__peg track__peg--${which} ${seat === you ? 'is-you' : 'is-opp'}`}
        r={which === 'front' ? 4.4 : 3.4}
        cx={0}
        cy={0}
        style={{ transform: `translate(${x}px, ${y}px)` }}
      />
    );
  };

  const label = `Score: you ${scores[you]}, ${names[opp]} ${scores[opp]}. ${target} to win.`;

  return (
    <svg className="track" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
      {Array.from({ length: ROWS }, (_, row) => (
        <rect
          key={row}
          className="track__street"
          x={PAD_L - 4}
          y={TOP + row * STREET}
          width={width - PAD_L - PAD_R + 8}
          height={BAR_H}
          rx={6}
        />
      ))}
      {/* start slots */}
      <rect className="track__start" x={2} y={TOP} width={PAD_L - 6} height={BAR_H} rx={5} />
      {/* game hole */}
      <rect className="track__finish" x={width - PAD_R + 4} y={TOP + (ROWS - 1) * STREET} width={PAD_R - 6} height={BAR_H} rx={5} />
      <text className="track__label" x={width - PAD_R / 2 - 1} y={TOP + (ROWS - 1) * STREET - 2.5} textAnchor="middle">
        {target}
      </text>
      {holesEls}
      <g className="track__line track__line--double">
        <line x1={double.x} x2={double.x} y1={TOP + double.row * STREET - 2} y2={TOP + double.row * STREET + BAR_H + 2} />
        <text x={double.x} y={TOP + double.row * STREET - 3} textAnchor="middle">{Math.ceil(target / 2)}</text>
      </g>
      <g className="track__line track__line--skunk">
        <line x1={skunk.x} x2={skunk.x} y1={TOP + skunk.row * STREET - 3} y2={TOP + skunk.row * STREET + BAR_H + 3} />
        <text x={skunk.x} y={TOP + skunk.row * STREET - 3.5} textAnchor="middle">skunk {Math.ceil((target * 3) / 4)}</text>
      </g>
      {back[opp] !== scores[opp] && peg(opp, 'back')}
      {back[you] !== scores[you] && peg(you, 'back')}
      {peg(opp, 'front')}
      {peg(you, 'front')}
    </svg>
  );
}
