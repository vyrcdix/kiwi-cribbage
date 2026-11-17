// The board: a straight track in four rows of 30, drawn in a 358 x 156 viewBox and scaled by width.
// Every row runs left to right. Row three starts at 61 (the double-skunk line) and row four at 91
// (the skunk line), so each line is the start of a row, marked with a tomato tab.
// Row four is tinted green: once you are on it you are safe from the skunk.
// In each row the opponent's lane is the upper one and yours the lower, matching the screen.

const ROWS = 4;
const PER_ROW = 30;
const ROW_TOP = 21;          // opponent lane of row one
const ROW_STEP = 34;
const LANE_GAP = 12;         // your lane sits this far below the opponent's
const X0 = 38;               // first hole of a row
const PITCH = 9.6;           // hole to hole inside a group of five
const GROUP = 51;            // start of one group to the start of the next
const START_X = 32;          // the off-board starting holes
export const FINISH = { x: 344, y: 129 };
// One dot per hole, five to a group. A round-capped zero-length dash draws a dot.
const HOLES = '0.01 9.59 0.01 9.59 0.01 9.59 0.01 9.59 0.01 12.59';
const LANE_TINT = ['#7F93A8', '#CC8F88']; // opponent, you: quiet versions of the peg colours
const PEG = ['#2B5278', '#BE3228'];

/** Hole centre for a score 0..121. lane: 0 opponent, 1 you. */
export function holeXY(score, lane) {
  if (score >= 121) return FINISH;
  if (score <= 0) return { x: START_X, y: ROW_TOP + lane * LANE_GAP };
  const m = (score - 1) % PER_ROW;
  return {
    x: X0 + Math.floor(m / 5) * GROUP + (m % 5) * PITCH,
    y: ROW_TOP + Math.floor((score - 1) / PER_ROW) * ROW_STEP + lane * LANE_GAP,
  };
}

function Peg({ score, lane, back }) {
  const { x, y } = holeXY(score, lane);
  // Position by transform so it can be animated. See motion.md, "The peg advancing".
  return (
    <g className={back ? 'peg peg--back' : 'peg'} style={{ transform: `translate(${x}px, ${y}px)` }}>
      {back
        ? <circle r="4.2" fill="#FCFAF4" stroke={PEG[lane]} strokeWidth="2.4" />
        : (
          <>
            <circle r="5.6" fill={PEG[lane]} stroke="#FCFAF4" strokeWidth="1.5" />
            <circle cx="-1.7" cy="-1.7" r="1.5" fill="#FCFAF4" opacity="0.6" />
          </>
        )}
    </g>
  );
}

/** opp, you: { score, prev, name }. prev is the back peg. */
export function Board({ opp, you }) {
  const rows = Array.from({ length: ROWS }, (_, r) => r);
  return (
    <svg
      className="board"
      viewBox="0 0 358 156"
      role="img"
      aria-label={`Board. ${opp.name} ${opp.score}, ${you.name} ${you.score}. Double skunk line at 61, skunk line at 91.`}
    >
      <rect x="0.75" y="0.75" width="356.5" height="154.5" rx="14" fill="#FCFAF4" stroke="#1F2723" strokeWidth="1.5" />

      {rows.map((r) => {
        const y = ROW_TOP + r * ROW_STEP;
        const line = r >= 2; // rows three and four start at 61 and 91
        return (
          <g key={r}>
            <rect x="6" y={y - 9} width="346" height="30" rx="8" fill={r === 3 ? '#DCE8C8' : '#F1EBDA'} />
            {line && <rect x="6" y={y - 9} width="23" height="30" rx="8" fill="#BE3228" />}
            <text className="board__row" x="17.5" y={y + 10} fill={line ? '#FCFAF4' : '#1F2723'}>{r * PER_ROW + 1}</text>
            {[0, 1].map((lane) => (
              <line
                key={lane}
                x1={X0} x2="333" y1={y + lane * LANE_GAP} y2={y + lane * LANE_GAP}
                stroke={LANE_TINT[lane]} strokeWidth="4.4" strokeLinecap="round" strokeDasharray={HOLES}
              />
            ))}
          </g>
        );
      })}

      <circle cx={START_X} cy={ROW_TOP} r="1.8" fill={LANE_TINT[0]} />
      <circle cx={START_X} cy={ROW_TOP + LANE_GAP} r="1.8" fill={LANE_TINT[1]} />

      <g className="board__finish">
        <circle cx={FINISH.x} cy={FINISH.y} r="6.5" fill="#FCFAF4" stroke="#1F2723" strokeWidth="1.5" />
        <circle cx={FINISH.x} cy={FINISH.y} r="2.6" fill="#1F2723" />
      </g>

      <Peg score={opp.prev} lane={0} back />
      <Peg score={you.prev} lane={1} back />
      <Peg score={opp.score} lane={0} />
      <Peg score={you.score} lane={1} />
    </svg>
  );
}
