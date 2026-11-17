// The kiwi mark: brand, favicon, card-back roundel and the skunk trophy.
// Same drawing as public/mark.svg and public/favicon.svg (handoff Mark.jsx).
import type { CSSProperties } from 'react';

const SEEDS = Array.from({ length: 12 }, (_, i) => {
  const deg = 15 + i * 30;
  const a = (deg * Math.PI) / 180;
  return { x: 60 + 21 * Math.cos(a), y: 60 + 19 * Math.sin(a), turn: deg - 90 };
});

const RAYS = Array.from({ length: 12 }, (_, i) => {
  const a = (i * 30 * Math.PI) / 180;
  const p = (r: number) => `${(60 + r * Math.cos(a)).toFixed(1)} ${(60 + r * 0.91 * Math.sin(a)).toFixed(1)}`;
  return `M${p(16)}L${p(39)}`;
}).join('');

const SIX: [number, number][] = [[84, 60], [72, 79], [48, 79], [36, 60], [48, 41], [72, 41]];

type Variant = 'full' | 'simple' | 'mono';

/** variant: 'full' (icon, trophy) | 'simple' (under 40 px) | 'mono' (card backs; inherits currentColor). */
export function Mark({ variant = 'full', size, title, className }: { variant?: Variant; size?: number; title?: string; className?: string }) {
  const a11y = title ? { role: 'img', 'aria-label': title } : { 'aria-hidden': true as const };
  const box = { viewBox: '0 0 120 120', width: size, height: size, className, ...a11y };

  if (variant === 'mono') {
    return (
      <svg {...box} fill="currentColor">
        <path fillRule="evenodd" d="M60 10a54 50 0 1 0 0 100a54 50 0 1 0 0-100ZM60 20a44 40 0 1 1 0 80a44 40 0 1 1 0-80Z" />
        <ellipse cx="60" cy="60" rx="13" ry="11" />
        {SIX.map(([x, y]) => <circle key={`${x}-${y}`} cx={x} cy={y} r="4.5" />)}
      </svg>
    );
  }

  if (variant === 'simple') {
    return (
      <svg {...box}>
        <ellipse cx="60" cy="60" rx="56" ry="52" fill="#7B5B3A" />
        <ellipse cx="60" cy="60" rx="46" ry="42" fill="#A9C98A" />
        <ellipse cx="60" cy="60" rx="15" ry="13" fill="#FCFAF4" />
        {SIX.map(([x, y]) => <circle key={`${x}-${y}`} cx={x} cy={y} r="5" fill="#1F2723" />)}
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

/** The booby prize: the kiwi on a plinth. count = 2 for a double skunk. Size comes from --t (CSS) unless given. */
export function Trophy({ size, count = 1, plate = 'SKUNKED' }: { size?: number; count?: 1 | 2; plate?: string }) {
  const style = size ? ({ '--t': `${size}px` } as CSSProperties) : undefined;
  return (
    <div className="trophy" style={style} data-count={count}>
      <div className="trophy__fruit">
        {Array.from({ length: count }, (_, i) => (
          <span key={i} className="trophy__kiwi" style={{ '--i': i } as CSSProperties}>
            <Mark title={i === 0 ? 'The kiwi' : undefined} />
          </span>
        ))}
      </div>
      <div className="trophy__cap" />
      <div className="trophy__plate">{plate}</div>
    </div>
  );
}

/** The wordmark: kiwi and the name. */
export function Brand({ size = 'large' }: { size?: 'large' | 'small' }) {
  return (
    <span className={`brand brand--${size}`}>
      <Mark variant={size === 'small' ? 'simple' : 'full'} className="brand__mark" />
      <span className="brand__name">Cabbage</span>
    </span>
  );
}
