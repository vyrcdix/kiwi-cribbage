// The one place cards get drawn (handoff CardView.jsx, ported to the real Card type).
//
// Two faces, chosen by width: under 90 px a card shows a large index and one pip
// (a pip layout is unreadable at hand size); at 90 px and over it gets corner
// indices and the full pip layout. Courts put the photo in a 4:5 slot with rank
// and suit outside it on card stock. Backs are the oilcloth check in the deck's
// back ink (with the kiwi roundel at 90 px and over) or the deck's back photo.
import { type CSSProperties, useContext, useState } from 'react';
import { type Card, rank, suit } from '../../shared/cards';
import { Mark } from '../brand/Mark';
import { cardSpoken } from '../lib/format';
import { DeckContext, type DeckSpec, PIPS, cardCode, getDeck, suitInk } from './decks';
import { useFourColour } from './prefs';
import { Pip } from './Suit';
import './cards.css';

/** Below this width the card drops its pip layout for a large index and one pip. */
export const COMPACT_BELOW = 90;

export type CardState = '' | 'dim' | 'lit' | 'picked';

export interface CardViewProps {
  /** The card, or null for a face-down card. */
  card: Card | null;
  /** Width in px (height is 7/5 of it). Ignored when `fluid`. */
  width?: number;
  /** Take the width from CSS (`--w` on an ancestor rule). Always the compact face unless `face` says otherwise. */
  fluid?: boolean;
  /** Force a face instead of choosing by width. */
  face?: 'full' | 'compact';
  state?: CardState;
  /** Override the deck from DeckContext. */
  deck?: string;
  /** Override the player's four-colour preference. */
  fourColour?: boolean;
  label?: string;
  className?: string;
  style?: CSSProperties;
  /** Purely decorative (a ghost in flight, a stack): hide from assistive tech. */
  decorative?: boolean;
}

// Remember photos that failed so every card falls back at once rather than retrying.
const failedImages = new Set<string>();

function CourtPhoto({ src, deck, fallback }: { src: string; deck: DeckSpec; fallback: () => JSX.Element }) {
  const [failed, setFailed] = useState(() => failedImages.has(src));
  if (failed) return fallback();
  return (
    <div className="card__photo" data-treatment={deck.photoTreatment}>
      <img
        src={src}
        alt=""
        draggable={false}
        decoding="async"
        onError={() => {
          failedImages.add(src);
          setFailed(true);
        }}
      />
    </div>
  );
}

export function CardView({
  card, width = 56, fluid = false, face, state = '', deck: deckId, fourColour, label, className, style, decorative,
}: CardViewProps) {
  const contextDeck = useContext(DeckContext);
  const [prefFour] = useFourColour();
  const d = getDeck(deckId ?? contextDeck);
  const four = fourColour ?? prefFour;
  const compact = face ? face === 'compact' : fluid || width < COMPACT_BELOW;
  const faceDown = card === null;
  const s = faceDown ? 0 : suit(card);
  const r = faceDown ? 0 : rank(card);
  const vars = {
    ...(fluid ? {} : { '--w': `${width}px` }),
    '--stock': d.stock,
    '--edge': d.edge,
    '--radius': d.radius,
    '--ink': faceDown ? d.back.ink : suitInk(d, s, four),
    '--index-font': d.indexFont,
    ...style,
  } as CSSProperties;
  const a11y = decorative
    ? { 'aria-hidden': true as const }
    : { role: 'img', 'aria-label': label ?? (faceDown ? 'Card, face down' : cardSpoken(card)) };
  const cls = (extra: string) => ['card', extra, className].filter(Boolean).join(' ');

  if (faceDown) {
    const photo = d.back.photo && !failedImages.has(d.back.photo) ? d.back.photo : null;
    return (
      <div className={cls('card--back')} data-state={state} style={vars} {...a11y}>
        <div
          className="card__back"
          data-photo={photo ? '' : undefined}
          style={photo ? ({ '--back-photo': `url(${photo})` } as CSSProperties) : undefined}
        />
        {!compact && !photo && (
          <div className="card__roundel"><Mark variant="mono" /></div>
        )}
      </div>
    );
  }

  const code = cardCode(card);
  const rankLabel = code.slice(0, -1);
  const court = r >= 10;
  const photo = d.photos[code] ?? null;
  const index = (foot?: boolean) => (
    <div className={foot ? 'card__index card__index--foot' : 'card__index'} aria-hidden={foot || undefined}>
      <span className="card__rank">{rankLabel}</span>
      <Pip s={s} className="card__index-pip" />
    </div>
  );

  if (compact) {
    const photoOk = photo && !failedImages.has(photo);
    return (
      <div className={cls('card--compact')} data-state={state} style={vars} {...a11y}>
        {index()}
        {court ? (
          <div
            className="card__mini-slot"
            data-photo={photoOk ? '' : undefined}
            style={photoOk ? { backgroundImage: `url(${photo})` } : undefined}
          />
        ) : (
          <Pip s={s} className="card__big-pip" />
        )}
      </div>
    );
  }

  const houseCourt = () => (
    <div className="card__house-court">
      <span>{rankLabel}</span>
      <Pip s={s} className="card__court-pip" />
    </div>
  );

  return (
    <div className={cls('card--full')} data-state={state} style={vars} {...a11y}>
      {index()}
      {index(true)}
      {!court &&
        (photo && r === 0 ? (
          <div className="card__slot" data-frame={d.frame}>
            <CourtPhoto src={photo} deck={d} fallback={houseCourt} />
          </div>
        ) : (
          PIPS[r].map(([x, y], i) => (
            <Pip
              key={i}
              s={s}
              className={r === 0 ? 'card__pip card__pip--ace' : 'card__pip'}
              style={{ left: `${x * 100}%`, top: `${y * 100}%`, '--turn': y > 0.5 ? '180deg' : '0deg' } as CSSProperties}
            />
          ))
        ))}
      {court && (
        <div className="card__slot" data-frame={d.frame}>
          {photo ? <CourtPhoto src={photo} deck={d} fallback={houseCourt} /> : houseCourt()}
        </div>
      )}
    </div>
  );
}
