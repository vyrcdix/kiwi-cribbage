// The board: a straight track in four rows of 30, drawn in a 358 x 156 viewBox and scaled by width.
// Every row runs left to right. Row three starts at 61 (the double-skunk line) and row four at 91
// (the skunk line), so each line is the start of a row, marked with a tomato tab.
// Row four is tinted green: once you are on it you are safe from the skunk.
//
// One lane per TEAM, two or three lanes to a row. Lanes run top to bottom in seating order,
// clockwise from your left, and your own lane is always the bottom one.
// The drawing is the same height for two and three lanes; with three, holes and pegs are smaller.

const PER_ROW = 30;
const BAND_TOP = 12;         // top of the first row's band
const BAND_H = 30;
const ROW_STEP = 34;
const X0 = 38;               // first hole of a row
const PITCH = 9.6;           // hole to hole inside a group of five
const GROUP = 51;            // start of one group to the start of the next
const START_X = 32;          // the off-board starting holes
export const FINISH = { x: 344, y: 129 };
// One dot per hole, five to a group. A round-capped zero-length dash draws a dot.
const HOLES = '0.01 9.59 0.01 9.59 0.01 9.59 0.01 9.59 0.01 12.59';

const LAYOUT = {
  2: { lanes: [9, 21], hole: 4.4, peg: 5.6, back: 4.2, ring: 2.4 },
  3: { lanes: [6, 15, 24], hole: 3.6, peg: 4.5, back: 3.3, ring: 2 },
};

// Team colours. `shape` is the second cue, so colour is never the only one.
export const TEAM = {
  tomato: { peg: '#BE3228', ring: '#BE3228', tint: '#CC8F88', outline: '#FCFAF4', shape: 'round' },
  blue: { peg: '#2B5278', ring: '#2B5278', tint: '#7F93A8', outline: '#FCFAF4', shape: 'round' },
  mustard: { peg: '#C8900F', ring: '#8F6608', tint: '#BFA256', outline: '#1F2723', shape: 'diamond' },
};

/** Hole centre for a score 0..121. lane: index from the top. lanes: 2 or 3. */
export function holeXY(score, lane, lanes = 2) {
  if (score >= 121) return FINISH;
  const dy = LAYOUT[lanes].lanes[lane];
  if (score <= 0) return { x: START_X, y: BAND_TOP + dy };
  const m = (score - 1) % PER_ROW;
  return {
    x: X0 + Math.floor(m / 5) * GROUP + (m % 5) * PITCH,
    y: BAND_TOP + Math.floor((score - 1) / PER_ROW) * ROW_STEP + dy,
  };
}

function Peg({ score, lane, lanes, team, back }) {
  const { x, y } = holeXY(score, lane, lanes);
  const L = LAYOUT[lanes];
  const t = TEAM[team];
  const r = back ? L.back : L.peg;
  const fill = back ? '#FCFAF4' : t.peg;
  const stroke = back ? t.ring : t.outline;
  const sw = back ? L.ring : t.shape === 'diamond' ? 1.1 : 1.4;
  // Position by transform so it can be animated. See motion.md, "The peg advancing".
  return (
    <g className={back ? 'peg peg--back' : 'peg'} style={{ transform: `translate(${x}px, ${y}px)` }}>
      {t.shape === 'diamond'
        ? <rect x={-r * 0.88} y={-r * 0.88} width={r * 1.76} height={r * 1.76} transform="rotate(45)" fill={fill} stroke={stroke} strokeWidth={sw} />
        : <circle r={r} fill={fill} stroke={stroke} strokeWidth={sw} />}
      {!back && t.shape === 'round' && <circle cx={-r * 0.3} cy={-r * 0.3} r={r * 0.27} fill="#FCFAF4" opacity="0.6" />}
    </g>
  );
}

/**
 * teams: two or three of { name, score, prev, colour }, top lane first, you (or your team) last.
 * colour: 'tomato' | 'blue' | 'mustard'. prev is the back peg.
 */
export function Board({ teams }) {
  const n = teams.length;
  const L = LAYOUT[n];
  const rows = [0, 1, 2, 3];
  const scores = teams.map((t) => `${t.name} ${t.score}`).join(', ');
  return (
    <svg className="board" viewBox="0 0 358 156" role="img" aria-label={`Board. ${scores}. Double skunk line at 61, skunk line at 91.`}>
      <rect x="0.75" y="0.75" width="356.5" height="154.5" rx="14" fill="#FCFAF4" stroke="#1F2723" strokeWidth="1.5" />

      {rows.map((r) => {
        const y = BAND_TOP + r * ROW_STEP;
        const line = r >= 2; // rows three and four start at 61 and 91
        return (
          <g key={r}>
            <rect x="6" y={y} width="346" height={BAND_H} rx="8" fill={r === 3 ? '#DCE8C8' : '#F1EBDA'} />
            {line && <rect className="board__tab" x="6" y={y} width="23" height={BAND_H} rx="8" fill="#BE3228" />}
            <text className="board__row" x="17.5" y={y + 19} fill={line ? '#FCFAF4' : '#1F2723'}>{r * PER_ROW + 1}</text>
            {teams.map((t, lane) => (
              <line
                key={lane}
                x1={X0} x2="333" y1={y + L.lanes[lane]} y2={y + L.lanes[lane]}
                stroke={TEAM[t.colour].tint} strokeWidth={L.hole} strokeLinecap="round" strokeDasharray={HOLES}
              />
            ))}
          </g>
        );
      })}

      {teams.map((t, lane) => (
        <circle key={lane} cx={START_X} cy={BAND_TOP + L.lanes[lane]} r={L.hole * 0.42} fill={TEAM[t.colour].tint} />
      ))}

      <g className="board__finish">
        <circle cx={FINISH.x} cy={FINISH.y} r="6.5" fill="#FCFAF4" stroke="#1F2723" strokeWidth="1.5" />
        <circle cx={FINISH.x} cy={FINISH.y} r="2.6" fill="#1F2723" />
      </g>

      {teams.map((t, lane) => <Peg key={'b' + lane} score={t.prev} lane={lane} lanes={n} team={t.colour} back />)}
      {teams.map((t, lane) => <Peg key={'f' + lane} score={t.score} lane={lane} lanes={n} team={t.colour} />)}
    </svg>
  );
}
