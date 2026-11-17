// The running head-to-head record as hand-built SVG: one line per player,
// counting their wins game by game, in each player's colour. Every game is a
// point on the winner's line (skunks drawn larger with a cream eye). Season
// changes are marked. Sized to its container so text stays the same size from a
// phone to a laptop, and the dots shrink as games pile up (3 games or 80).
import { type KeyboardEvent, type PointerEvent, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { H2HGame, Season } from '../../shared/league';
import { fmtDate } from '../ui/bits';

interface Props {
  games: H2HGame[];
  /** Player ids [a, b], to tell whose win each game was. */
  ids: [string, string];
  names: [string, string];
  colours: [string, string];
  seasons: Season[];
  selected: number;
  onSelect: (i: number) => void;
}

const PAD = { l: 30, r: 44, t: 22, b: 26 };

function niceTicks(max: number): number[] {
  if (max <= 4) return Array.from({ length: max + 1 }, (_, i) => i);
  const step = max <= 10 ? 2 : max <= 25 ? 5 : max <= 60 ? 10 : 20;
  const out: number[] = [];
  for (let v = 0; v <= max; v += step) out.push(v);
  return out;
}

export function RecordChart({ games, ids, names, colours, seasons, selected, onSelect }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(340);
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    setW(el.clientWidth || 340);
    const ro = new ResizeObserver(() => setW(el.clientWidth || 340));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const n = games.length;
  const h = w >= 560 ? 250 : 210;
  const last = games[n - 1];
  const maxWins = Math.max(1, last ? Math.max(last.record[0], last.record[1]) : 1);
  const ticks = niceTicks(maxWins);
  const top = Math.max(maxWins, ticks[ticks.length - 1]);
  const iw = w - PAD.l - PAD.r;
  const ih = h - PAD.t - PAD.b;
  const x = (i: number) => PAD.l + (n === 0 ? 0 : (i / n) * iw);
  const y = (v: number) => PAD.t + ih - (v / top) * ih;
  const r = Math.max(2.4, Math.min(6, (iw / Math.max(1, n)) * 0.32));

  // Running record, starting from 0–0 before the first game.
  const pts: [number, number][] = [[0, 0], ...games.map((g) => g.record)];
  // Where both records are level the two lines would draw exactly on top of each
  // other, so each is nudged half a line apart there (the first up, the second down)
  // and both stay visible side by side.
  const NUDGE = 1.6;
  const yAt = (p: [number, number], k: 0 | 1) => y(p[k]) + (p[0] === p[1] ? (k === 0 ? -NUDGE : NUDGE) : 0);
  // A staircase: level until the game, then up a step for a win.
  const line = (k: 0 | 1) =>
    pts.map((p, i) => (i === 0 ? `M${x(0).toFixed(1)} ${yAt(p, k).toFixed(1)}` : `H${x(i).toFixed(1)}V${yAt(p, k).toFixed(1)}`)).join('');

  // Season changes inside the timeline.
  const breaks: { i: number; name: string }[] = [];
  games.forEach((g, i) => {
    if (i > 0 && g.seasonId !== games[i - 1].seasonId) breaks.push({ i, name: seasons.find((s) => s.id === g.seasonId)?.name ?? `Season ${g.seasonId}` });
  });
  const firstSeason = n ? seasons.find((s) => s.id === games[0].seasonId)?.name : null;

  const pickAt = (clientX: number) => {
    const rect = wrap.current?.getBoundingClientRect();
    if (!rect || n === 0) return;
    const px = clientX - rect.left;
    const i = Math.round(((px - PAD.l) / iw) * n);
    onSelect(Math.min(n - 1, Math.max(0, i - 1)));
  };
  const dragging = useRef(false);
  const onDown = (e: PointerEvent) => {
    dragging.current = true;
    pickAt(e.clientX);
  };
  const onMove = (e: PointerEvent) => {
    if (dragging.current || e.pointerType === 'mouse') pickAt(e.clientX);
  };
  useEffect(() => {
    const up = () => {
      dragging.current = false;
    };
    window.addEventListener('pointerup', up);
    return () => window.removeEventListener('pointerup', up);
  }, []);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowLeft') onSelect(Math.max(0, selected - 1));
    else if (e.key === 'ArrowRight') onSelect(Math.min(n - 1, selected + 1));
    else return;
    e.preventDefault();
  };

  const sel = games[selected];
  const label = last
    ? `Running record over ${n} games: ${names[0]} ${last.record[0]}, ${names[1]} ${last.record[1]}. Use the arrow keys to step through the games.`
    : 'No games yet';

  return (
    <div className="chart" ref={wrap}>
      <svg
        className="chart__svg"
        width={w}
        height={h}
        viewBox={`0 0 ${w} ${h}`}
        role="img"
        aria-label={label}
        tabIndex={0}
        onKeyDown={onKey}
        onPointerDown={onDown}
        onPointerMove={onMove}
      >
        {/* grid and axis */}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={w - PAD.r} y1={y(t)} y2={y(t)} className={t === 0 ? 'chart__axis' : 'chart__grid'} />
            <text x={PAD.l - 8} y={y(t) + 4} className="chart__tick" textAnchor="end">{t}</text>
          </g>
        ))}
        {firstSeason && breaks.length > 0 && (
          <text x={PAD.l + 2} y={PAD.t - 8} className="chart__season">{firstSeason}</text>
        )}
        {breaks.map((b) => (
          <g key={b.i}>
            <line x1={(x(b.i) + x(b.i + 1)) / 2} x2={(x(b.i) + x(b.i + 1)) / 2} y1={PAD.t - 4} y2={PAD.t + ih} className="chart__break" />
            <text x={(x(b.i) + x(b.i + 1)) / 2 + 4} y={PAD.t - 8} className="chart__season">{b.name}</text>
          </g>
        ))}

        {/* the selected game */}
        {sel && <line x1={x(selected + 1)} x2={x(selected + 1)} y1={PAD.t} y2={PAD.t + ih} className="chart__cursor" />}

        {/* the two records */}
        {([1, 0] as const).map((k) => (
          <path key={k} d={line(k)} fill="none" stroke={colours[k]} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
        ))}

        {/* every game a point on the winner's line */}
        {games.map((g, i) => {
          const k = g.winner === ids[0] ? 0 : 1;
          const cx = x(i + 1);
          const cy = yAt(g.record, k);
          const big = g.skunk > 0;
          const rr = big ? r * 1.45 : r;
          return (
            <g key={g.code} className={i === selected ? 'chart__dot is-selected' : 'chart__dot'}>
              <circle cx={cx} cy={cy} r={rr + (i === selected ? 1.5 : 0)} fill={colours[k]} stroke="#FCFAF4" strokeWidth={1.2} />
              {big && <circle cx={cx} cy={cy} r={rr * 0.42} fill="#FCFAF4" />}
              {i === selected && <circle cx={cx} cy={cy} r={rr + 4} fill="none" stroke="#1F2723" strokeWidth={1.5} />}
            </g>
          );
        })}

        {/* where each line ends */}
        {last && ([0, 1] as const).map((k) => {
          const other = last.record[1 - k];
          const mine = last.record[k];
          const close = Math.abs(y(mine) - y(other)) < 16;
          const dy = close ? (mine > other || (mine === other && k === 0) ? -8 : 8) : 0;
          return (
            <text key={k} x={w - PAD.r + 16} y={y(mine) + 4 + dy} className="chart__end" fill={colours[k]}>{mine}</text>
          );
        })}

        {/* dates under the axis */}
        {n > 0 && (
          <>
            <text x={PAD.l} y={h - 6} className="chart__tick" textAnchor="start">{fmtDate(games[0].finishedAt)}</text>
            {n > 1 && <text x={w - PAD.r} y={h - 6} className="chart__tick" textAnchor="end">{fmtDate(last!.finishedAt)}</text>}
          </>
        )}
      </svg>
    </div>
  );
}
