// The kiwi mark. Same drawing as mark.svg, mark-mono.svg and favicon.svg.
// variant: 'full' (icon, trophy) | 'simple' (favicon, under 40 px) | 'mono' (card backs; inherits currentColor)

const SEEDS = Array.from({ length: 12 }, (_, i) => {
  const deg = 15 + i * 30;
  const a = (deg * Math.PI) / 180;
  return { x: 60 + 21 * Math.cos(a), y: 60 + 19 * Math.sin(a), turn: deg - 90 };
});

const RAYS = Array.from({ length: 12 }, (_, i) => {
  const a = (i * 30 * Math.PI) / 180;
  const p = (r) => `${(60 + r * Math.cos(a)).toFixed(1)} ${(60 + r * 0.91 * Math.sin(a)).toFixed(1)}`;
  return `M${p(16)}L${p(39)}`;
}).join('');

const SIX = [[84, 60], [72, 79], [48, 79], [36, 60], [48, 41], [72, 41]];

export function Mark({ variant = 'full', size, title }) {
  const a11y = title ? { role: 'img', 'aria-label': title } : { 'aria-hidden': true };
  const box = { viewBox: '0 0 120 120', width: size, height: size, ...a11y };

  if (variant === 'mono') {
    return (
      <svg {...box} fill="currentColor">
        <path fillRule="evenodd" d="M60 10a54 50 0 1 0 0 100a54 50 0 1 0 0-100ZM60 20a44 40 0 1 1 0 80a44 40 0 1 1 0-80Z" />
        <ellipse cx="60" cy="60" rx="13" ry="11" />
        {SIX.map(([x, y]) => <circle key={x + '-' + y} cx={x} cy={y} r="4.5" />)}
      </svg>
    );
  }

  if (variant === 'simple') {
    return (
      <svg {...box}>
        <ellipse cx="60" cy="60" rx="56" ry="52" fill="#7B5B3A" />
        <ellipse cx="60" cy="60" rx="46" ry="42" fill="#A9C98A" />
        <ellipse cx="60" cy="60" rx="15" ry="13" fill="#FCFAF4" />
        {SIX.map(([x, y]) => <circle key={x + '-' + y} cx={x} cy={y} r="5" fill="#1F2723" />)}
      </svg>
    );
  }

  return (
    <svg {...box}>
      <ellipse cx="60" cy="60" rx="50" ry="46" fill="#7B5B3A" />
      <ellipse cx="60" cy="60" rx="45" ry="41" fill="#A9C98A" />
      <path d={RAYS} fill="none" stroke="#DCE8C8" strokeWidth="2" strokeLinecap="round" />
      <ellipse cx="60" cy="60" rx="13" ry="11.5" fill="#FCFAF4" />
      {SEEDS.map((s, i) => (
        <ellipse key={i} cx={s.x} cy={s.y} rx="1.7" ry="3.2" fill="#1F2723" transform={`rotate(${s.turn} ${s.x} ${s.y})`} />
      ))}
    </svg>
  );
}

// The booby prize: the kiwi on a plinth. count = 2 for a double skunk.
export function Trophy({ size = 112, count = 1, plate = 'SKUNKED' }) {
  return (
    <div className="trophy" style={{ '--t': size + 'px' }}>
      <div className="trophy__fruit">
        {Array.from({ length: count }, (_, i) => <Mark key={i} size={size} title={i === 0 ? 'The kiwi' : undefined} />)}
      </div>
      <div className="trophy__cap" />
      <div className="trophy__plate">{plate}</div>
    </div>
  );
}
