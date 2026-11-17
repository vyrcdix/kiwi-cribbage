// The one place cards get drawn. Size comes from the `--card-w` CSS variable
// set by whatever contains the card; everything inside scales from it.
import { type CSSProperties, type ReactElement, useContext, useState } from 'react';
import { type Card, RANKS, isRed, rank, suit } from '../../shared/cards';
import { cardSpoken } from '../lib/format';
import { DeckContext, type DeckSpec, getDeck } from './decks';
import { Suit } from './Suit';
import './cards.css';

export interface CardViewProps {
  /** The card, or null for a face-down card. */
  card: Card | null;
  /** Override the deck from DeckContext. */
  deck?: string;
  selected?: boolean;
  dimmed?: boolean;
  highlighted?: boolean;
  /** Makes the card a button. */
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  style?: CSSProperties;
  label?: string;
}

// Remember images that failed so every card of that deck falls back at once,
// rather than each one retrying the broken URL.
const failedImages = new Set<string>();

function DeckImage({ src, className, fallback }: { src: string; className: string; fallback: ReactElement }) {
  const [failed, setFailed] = useState(() => failedImages.has(src));
  if (failed) return fallback;
  return (
    <img
      className={className}
      src={src}
      alt=""
      draggable={false}
      decoding="async"
      onError={() => {
        failedImages.add(src);
        setFailed(true);
      }}
    />
  );
}

function DrawnBack() {
  return <span className="card__pattern" />;
}

function CardBack({ deck }: { deck: DeckSpec }) {
  return deck.back ? (
    <span className="card__frame">
      <DeckImage src={deck.back} className="card__photo" fallback={<DrawnBack />} />
    </span>
  ) : (
    <DrawnBack />
  );
}

function DrawnFace({ card }: { card: Card }) {
  const r = rank(card);
  const s = suit(card);
  const label = RANKS[r];
  const corner = (
    <>
      <span className="card__rank">{label}</span>
      <Suit s={s} className="card__pip" />
    </>
  );
  return (
    <>
      <span className="card__corner card__corner--tl">{corner}</span>
      <span className="card__corner card__corner--br">{corner}</span>
      {r >= 10 ? (
        <span className="card__court">
          <span className="card__court-letter">{label}</span>
          <Suit s={s} className="card__court-suit" />
        </span>
      ) : (
        <span className={r === 0 ? 'card__center card__center--ace' : 'card__center'}>
          <Suit s={s} className="card__big" />
        </span>
      )}
    </>
  );
}

/** A photo inside the card's cream border, with the rank and suit on corner chips. */
function PhotoFace({ card, src }: { card: Card; src: string }) {
  const [failed, setFailed] = useState(() => failedImages.has(src));
  if (failed) return <DrawnFace card={card} />;
  const corner = (
    <>
      <span className="card__rank">{RANKS[rank(card)]}</span>
      <Suit s={suit(card)} className="card__pip" />
    </>
  );
  return (
    <>
      <span className="card__frame card__frame--face">
        <img
          className="card__photo"
          src={src}
          alt=""
          draggable={false}
          decoding="async"
          onError={() => {
            failedImages.add(src);
            setFailed(true);
          }}
        />
      </span>
      <span className="card__corner card__corner--tl card__corner--chip">{corner}</span>
      <span className="card__corner card__corner--br card__corner--chip">{corner}</span>
    </>
  );
}

function CardFace({ card, deck }: { card: Card; deck: DeckSpec }) {
  const src = deck.face?.(card);
  return src ? <PhotoFace card={card} src={src} /> : <DrawnFace card={card} />;
}

export function CardView({
  card, deck: deckId, selected, dimmed, highlighted, onClick, disabled, className, style, label,
}: CardViewProps) {
  const contextDeck = useContext(DeckContext);
  const deck = getDeck(deckId ?? contextDeck);
  const faceUp = card !== null;
  const cls = [
    'card',
    faceUp ? 'card--face' : 'card--back',
    faceUp && isRed(card) ? 'card--red' : '',
    selected ? 'is-selected' : '',
    dimmed ? 'is-dimmed' : '',
    highlighted ? 'is-highlighted' : '',
    deck.className ?? '',
    className ?? '',
  ].filter(Boolean).join(' ');
  const aria = label ?? (faceUp ? cardSpoken(card) : 'face-down card');
  const body = faceUp ? <CardFace card={card} deck={deck} /> : <CardBack deck={deck} />;

  if (onClick) {
    return (
      <button
        type="button"
        className={cls}
        style={style}
        onClick={onClick}
        disabled={disabled}
        aria-pressed={selected === undefined ? undefined : selected}
        aria-label={aria}
      >
        {body}
      </button>
    );
  }
  return (
    <div className={cls} style={style} role="img" aria-label={aria}>
      {body}
    </div>
  );
}
