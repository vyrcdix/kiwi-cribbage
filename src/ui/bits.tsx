// Small pieces the league screens share: headings, empty states, season picker,
// player names, result marks, rows of cards, confirmations, share boxes and QR codes.
import qrcode from 'qrcode-generator';
import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { Card } from '../../shared/cards';
import type { PlayerCard, Result, Season, SeasonFilter } from '../../shared/league';
import { Mark } from '../brand/Mark';
import { CardView } from '../cards/CardView';
import { onLink } from '../lib/router';
import { Avatar, type PlayerLike } from './Avatar';

// ---------------------------------------------------------------- formatting

export function fmtDate(iso: string | null | undefined, withYear = false): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(withYear || !sameYear ? { year: 'numeric' } : {}) });
}

/** "4 min", "3 h", "2 days" — how long something has been sitting. */
export function fmtIdle(seconds: number): string {
  if (seconds < 60) return 'just now';
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h`;
  return `${Math.floor(h / 24)} days`;
}

export const pct = (x: number) => `${Math.round(x * 100)}%`;
export const avg = (x: number | null) => (x === null ? '–' : x.toFixed(1));
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ---------------------------------------------------------------- layout

export function PageHead({ title, sub, children }: { title: ReactNode; sub?: ReactNode; children?: ReactNode }) {
  return (
    <header className="page-head">
      <div className="page-head__text">
        <h1 className="page-head__title">{title}</h1>
        {sub && <p className="page-head__sub">{sub}</p>}
      </div>
      {children && <div className="page-head__side">{children}</div>}
    </header>
  );
}

export function Section({ title, action, children, className, id }: { title: ReactNode; action?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  return (
    <section className={['block', className].filter(Boolean).join(' ')} id={id}>
      <div className="block__head">
        <h2 className="eyebrow">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** A friendly blank: a kiwi, a line of what this will show, and maybe something to do. */
export function Empty({ title, children, action, small }: { title: string; children?: ReactNode; action?: ReactNode; small?: boolean }) {
  return (
    <div className={`empty-state${small ? ' empty-state--small' : ''}`}>
      {!small && <Mark variant="simple" size={40} />}
      <p className="empty-state__title">{title}</p>
      {children && <p className="empty-state__text">{children}</p>}
      {action}
    </div>
  );
}

export function Loading({ what = 'Fetching' }: { what?: string }) {
  return <p className="loading muted" role="status">{what}…</p>;
}

export function ErrorLine({ error, retry }: { error: string; retry?: () => void }) {
  return (
    <p className="error-line" role="alert">
      {error}
      {retry && (
        <button type="button" className="link" onClick={retry}>Try again</button>
      )}
    </p>
  );
}

// ---------------------------------------------------------------- seasons

/** Season choice: each season by name (current marked), plus all time. */
export function SeasonPicker({ seasons, value, onChange, label = 'Season' }: {
  seasons: Season[];
  value: SeasonFilter;
  onChange: (v: SeasonFilter) => void;
  label?: string;
}) {
  const id = useId();
  return (
    <label className="picker" htmlFor={id}>
      <span className="sr-only">{label}</span>
      <select
        id={id}
        className="picker__select"
        value={String(value)}
        onChange={(e) => onChange(e.target.value === 'all' ? 'all' : Number(e.target.value))}
      >
        {[...seasons].reverse().map((s) => (
          <option key={s.id} value={s.id}>{s.name}{s.current ? ' (now)' : ''}</option>
        ))}
        <option value="all">All time</option>
      </select>
      <svg className="picker__chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
    </label>
  );
}

// ---------------------------------------------------------------- players

/** Avatar and name, linking to the player's page. */
export function Who({ player, size = 28, you, link = true, strong }: { player: PlayerLike | null; size?: number; you?: boolean; link?: boolean; strong?: boolean }) {
  if (!player) return <span className="who who--open"><Avatar player={null} size={size} /><span className="who__name">Open seat</span></span>;
  const body = (
    <>
      <Avatar player={player} size={size} />
      <span className="who__name">{strong ? <strong>{player.name}</strong> : player.name}{you && <span className="who__you"> (you)</span>}</span>
    </>
  );
  if (!link) return <span className="who">{body}</span>;
  const to = `/players/${player.id}`;
  return <a className="who who--link" href={to} onClick={(e) => onLink(e, to)}>{body}</a>;
}

/** A row of overlapping avatars. */
export function Faces({ players, size = 24 }: { players: (PlayerLike | null)[]; size?: number }) {
  return (
    <span className="faces">
      {players.map((p, i) => <Avatar key={p?.id ?? `open-${i}`} player={p} size={size} ring />)}
    </span>
  );
}

export const names = (ps: (PlayerCard | null)[], meId?: string) =>
  ps.map((p) => (p ? (p.id === meId ? 'You' : p.name) : 'Open seat'));

// ---------------------------------------------------------------- results

/** W / L squares, most recent first. Skunks get a kiwi seed. */
export function Form({ chips }: { chips: { result: Result; skunk: number }[] }) {
  if (!chips.length) return <span className="form form--none">no games yet</span>;
  return (
    <span className="form" aria-label={`Last ${chips.length}: ${chips.map((c) => (c.result === 'W' ? 'won' : 'lost')).join(', ')}`}>
      {chips.map((c, i) => (
        <span key={i} className={`form__chip form__chip--${c.result}`} data-skunk={c.skunk || undefined}>{c.result}</span>
      ))}
    </span>
  );
}

export function SkunkTag({ level }: { level: number }) {
  if (!level) return null;
  return (
    <span className="tag tag--skunk">
      <Mark variant="simple" size={13} />
      {level === 2 ? 'double skunk' : 'skunk'}
    </span>
  );
}

// ---------------------------------------------------------------- cards

/** A counted hand: the four cards, a gap, then the starter. */
export function HandCards({ cards, starter, width = 40, lit }: { cards: Card[]; starter?: Card | null; width?: number; lit?: Card[] }) {
  return (
    <span className="hand-cards" style={{ ['--w' as string]: `${width}px` }}>
      {cards.map((c) => <CardView key={c} card={c} fluid state={lit?.includes(c) ? 'lit' : ''} />)}
      {starter !== undefined && starter !== null && (
        <span className="hand-cards__starter"><CardView card={starter} fluid label={`Starter`} state={lit?.includes(starter) ? 'lit' : ''} /></span>
      )}
    </span>
  );
}

// ---------------------------------------------------------------- confirm

/**
 * A confirmation for anything that can't be undone lightly. Rendered in place
 * as a modal sheet; Escape or the backdrop cancels.
 */
export function Confirm({ title, children, confirm, danger, busy, onConfirm, onCancel }: {
  title: string;
  children?: ReactNode;
  confirm: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [onCancel]);
  return (
    <div className="sheet" role="presentation" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="sheet__panel panel" role="alertdialog" aria-modal="true" aria-labelledby="sheet-title" ref={ref}>
        <h2 id="sheet-title" className="sheet__title">{title}</h2>
        {children && <div className="sheet__body">{children}</div>}
        <div className="sheet__buttons">
          <button type="button" className="btn btn--quiet" onClick={onCancel} data-autofocus>Cancel</button>
          <button type="button" className={`btn${danger ? ' btn--danger' : ''}`} onClick={onConfirm} disabled={busy}>
            {busy ? 'One moment…' : confirm}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- sharing

export function QrCode({ text, size = 176, label }: { text: string; size?: number; label: string }) {
  const { path, n } = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const count = qr.getModuleCount();
    let d = '';
    for (let r = 0; r < count; r++) for (let c = 0; c < count; c++) if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
    return { path: d, n: count };
  }, [text]);
  const q = 3; // quiet zone, in modules
  return (
    <svg className="qr" width={size} height={size} viewBox={`${-q} ${-q} ${n + 2 * q} ${n + 2 * q}`} role="img" aria-label={label} shapeRendering="crispEdges">
      <rect x={-q} y={-q} width={n + 2 * q} height={n + 2 * q} fill="#FCFAF4" />
      <path d={path} fill="#1F2723" />
    </svg>
  );
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      return document.execCommand('copy');
    } catch {
      return false;
    } finally {
      ta.remove();
    }
  }
}

/** A link to hand over: shown in full, copy, share (where the device can), optionally a QR code. */
export function ShareBox({ url, shareText, qr, children }: { url: string; shareText: string; qr?: boolean; children?: ReactNode }) {
  const [copied, setCopied] = useState<'yes' | 'no' | null>(null);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(null), 2200);
    return () => clearTimeout(t);
  }, [copied]);
  const canShare = typeof navigator.share === 'function';
  return (
    <div className="sharebox">
      {qr && <QrCode text={url} label="QR code of the link" />}
      <a className="sharebox__url" href={url} onClick={(e) => e.preventDefault()}>{url.replace(/^https?:\/\//, '')}</a>
      <div className="sharebox__buttons">
        <button type="button" className="btn" onClick={async () => setCopied((await copyText(url)) ? 'yes' : 'no')}>
          {copied === 'yes' ? 'Copied!' : copied === 'no' ? 'Copy failed' : 'Copy link'}
        </button>
        {canShare && (
          <button
            type="button"
            className="btn btn--quiet"
            onClick={() => navigator.share({ title: 'Cabbage', text: shareText, url }).catch(() => {})}
          >
            Share…
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

/** A count-down to an expiry time ("9:41 left"); calls onExpire once at zero. */
export function useCountdown(until: string | null, onExpire?: () => void): string {
  const [now, setNow] = useState(() => Date.now());
  const fired = useRef(false);
  useEffect(() => {
    fired.current = false;
    if (!until) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [until]);
  if (!until) return '';
  const left = Math.max(0, Math.round((Date.parse(until) - now) / 1000));
  if (left === 0 && !fired.current) {
    fired.current = true;
    setTimeout(() => onExpire?.(), 0);
  }
  return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
}
