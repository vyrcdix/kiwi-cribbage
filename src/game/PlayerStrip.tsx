// A player's strip: avatar, name, status line, cards held, score (handoff Table.jsx).
// Two players: one wide strip for your opponent. Three and four players: a compact
// strip per other player, side by side in clockwise order, the team colour as a bar
// along the top (design-handback-1 §2). Your own strip carries the way home.
import type { ReactNode } from 'react';
import { CardView } from '../cards/CardView';
import { navigate } from '../lib/router';

interface Props {
  who: 'opp' | 'you';
  seat: number;
  name: string;
  status: ReactNode;
  score: number;
  tone: number;
  held?: number;
  dealer?: boolean;
  partner?: boolean;
  active?: boolean;
  compact?: boolean;
  /** The player's chosen emoji (their league avatar), drawn on the team-coloured disc in place of the initial. */
  emoji?: string | null;
  /**
   * PRESENCE HOOK (not built): index of the face-down card this opponent is
   * considering, which lifts 6 px (README answer 4). Needs a server message
   * carrying the hovered index, throttled to about 4 a second; nothing sends it
   * yet, so this is always undefined.
   */
  considering?: number;
}

export function PlayerStrip({ who, seat, name, status, score, tone, held = 0, dealer, partner, active, compact, emoji, considering }: Props) {
  const initial = (name.trim()[0] ?? '?').toUpperCase();
  return (
    <div
      className={`player player--${who}${compact ? ' player--compact' : ''} tone-${tone}`}
      data-active={active || undefined}
      data-seat={seat}
    >
      {who === 'you' && (
        <button type="button" className="player__home" onClick={() => navigate('/')} aria-label="Back to your games">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
      <div className={`player__avatar${emoji ? ' player__avatar--emoji' : ''}`} aria-hidden="true">{emoji ?? initial}</div>
      <div className="player__text">
        <strong>
          {compact && emoji && <span className="player__emoji" aria-hidden="true">{emoji}</span>}
          <span className="player__name">{name}</span>
          {compact && dealer && <span className="player__dealer" title="Dealer">D</span>}
          {partner && <span className="sr-only"> (your partner)</span>}
        </strong>
        <span className="player__status">{status}</span>
      </div>
      {who === 'opp' && (
        <div className="player__held" data-held-seat={seat} role="img" aria-label={`${name} holds ${held} card${held === 1 ? '' : 's'}`}>
          {Array.from({ length: held }, (_, i) => (
            <span key={i} data-considering={considering === i || undefined}>
              <CardView card={null} fluid decorative />
            </span>
          ))}
        </div>
      )}
      <div className="player__score" aria-label={`${score} points`}>{score}</div>
    </div>
  );
}
