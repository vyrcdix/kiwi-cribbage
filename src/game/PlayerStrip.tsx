// A player's strip (handoff Table.jsx, and v2 Players.jsx for three and four players).
// Two players: one wide strip for your opponent: avatar, name, status line, cards
// held, score. Three and four players: a compact two-line cell per other player,
// side by side in clockwise order (OpponentStrips in v2): line one is the 20 px team
// marker, the name (it gets the rest of the line) and the dealer disc; line two is
// the cards held, or a short status, then the score. Your partner's cell has no
// score: your own strip carries it. Your own strip carries the way home.
import type { ReactNode } from 'react';
import { CardView } from '../cards/CardView';
import { navigate } from '../lib/router';
import { TeamMark } from './TeamMark';

interface Props {
  who: 'opp' | 'you';
  seat: number;
  name: string;
  status: ReactNode;
  /** Omitted for your partner's compact cell. */
  score: number | null;
  tone: number;
  held?: number;
  dealer?: boolean;
  partner?: boolean;
  active?: boolean;
  compact?: boolean;
  /** Compact cells: show the status on line two in place of the cards held. */
  statusFirst?: boolean;
  /** The name the avatar's initial comes from, when the label is not just the name ("You and Sam"). */
  avatarName?: string;
  /** The player's chosen emoji (their league avatar), drawn on the team-coloured disc in place of the initial. */
  emoji?: string | null;
  /**
   * Presence (README answer 4): which of this player's face-down cards they are
   * considering; it lifts 6 px. The slot comes from the server, which scrambles
   * the order per hand so the position says nothing about the card.
   */
  considering?: number;
}

const initialOf = (name: string) => (name.trim()[0] ?? '?').toUpperCase();

function Held({ seat, name, held, considering, className }: { seat: number; name: string; held: number; considering?: number; className: string }) {
  return (
    <div className={className} data-held-seat={seat} role="img" aria-label={`${name} holds ${held} card${held === 1 ? '' : 's'}`}>
      {Array.from({ length: held }, (_, i) => (
        <span key={i} data-considering={considering === i || undefined}>
          <CardView card={null} fluid decorative />
        </span>
      ))}
    </div>
  );
}

export function PlayerStrip(props: Props) {
  const { who, seat, name, status, score, tone, held = 0, partner, active, compact, emoji, considering, avatarName } = props;
  if (compact && who === 'opp') return <CompactStrip {...props} />;
  return (
    <div
      className={`player player--${who} tone-${tone}`}
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
      <div className={`player__avatar${emoji ? ' player__avatar--emoji' : ''}`} aria-hidden="true">{emoji ?? initialOf(avatarName ?? name)}</div>
      <div className="player__text">
        <strong>
          <span className="player__name">{name}</span>
          {partner && <span className="sr-only"> (your partner)</span>}
        </strong>
        <span className="player__status">{status}</span>
      </div>
      {who === 'opp' && <Held seat={seat} name={name} held={held} considering={considering} className="player__held" />}
      {score !== null && <div className="player__score" aria-label={`${score} points`}>{score}</div>}
    </div>
  );
}

/** The dealer holds the deck. A glyph, not a letter, so it can never be read as an initial (handoff v3). */
function DeckGlyph() {
  return (
    <svg className="strip__dealer" viewBox="0 0 16 16" role="img" aria-label="Dealer">
      <rect x="2" y="4" width="9" height="11" rx="1.5" fill="#FCFAF4" stroke="#1F2723" strokeWidth="1.5" />
      <rect x="5" y="1" width="9" height="11" rx="1.5" fill="#1F2723" />
    </svg>
  );
}

function CompactStrip({ seat, name, status, score, tone, held = 0, dealer, partner, active, statusFirst, emoji, considering }: Props) {
  const showHeld = held > 0 && !statusFirst;
  return (
    <div
      className={`player player--opp player--compact strip tone-${tone}`}
      data-active={active || undefined}
      data-seat={seat}
    >
      <div className="strip__top">
        <TeamMark tone={tone} initial={initialOf(name)} emoji={emoji} size={20} />
        <strong className="player__name" title={name}>{name}</strong>
        {partner && <span className="sr-only"> (your partner)</span>}
      </div>
      <div className="strip__bottom">
        {dealer && <DeckGlyph />}
        {showHeld
          ? <Held seat={seat} name={name} held={held} considering={considering} className="player__held strip__held" />
          : <span className="strip__status">{status}</span>}
        {score !== null && <b className="player__score" aria-label={`${score} points`}>{score}</b>}
      </div>
    </div>
  );
}
