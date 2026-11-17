// The one place cards get drawn (handoff CardView.jsx, ported to the real Card type).
//
// Two faces, chosen by width: under 90 px a card shows a large index and one pip
// (a pip layout is unreadable at hand size); at 90 px and over it gets corner
// indices and the full pip layout. Courts put the photo in a 4:5 slot with rank
// and suit outside it on card stock. Backs are the oilcloth check in the deck's
// back ink (with the kiwi roundel at 90 px and over) or the deck's back photo.
//
// Court photos (deck-photo-spec.md, design-handback-2 §1): the full face shows the
// deck's treatment ('tinted', 'tritone' or 'natural'); the mini-slot under 90 px
// always shows the tinted render, whatever the treatment. Treated photos come from
// the baked renders when they exist (scripts/bake-deck.mjs); otherwise the photo is
// treated in the browser with the same code, and until that is ready a CSS
// approximation of tinted stands in.
import { type CSSProperties, useContext, useState } from 'react';
import { type Card, rank, suit } from '../../shared/cards';
import { Mark } from '../brand/Mark';
import { cardSpoken } from '../lib/format';
import { DeckContext, type DeckSpec, PIPS, type PhotoTreatment, bakedPhoto, cardCode, getDeck, suitInk } from './decks';
import { useFourColour } from './prefs';
import { useTreatedPhoto } from './useTreatedPhoto';
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
  /** Preview a photo treatment on the full face instead of the deck's own (the /deck switcher). */
  treatment?: PhotoTreatment;
  /** Development sheets only: break the rule that the mini-slot always shows the tinted render. */
  miniTreatment?: PhotoTreatment;
}

/** Where a court photo comes from for one treatment: baked file, live render, or the original with the CSS stand-in. */
function usePhotoSource(deck: DeckSpec, code: string, original: string | null, treatment: PhotoTreatment, ink: string, four: boolean) {
  const baked = original ? bakedPhoto(deck, code, treatment, four) : null;
  const live = useTreatedPhoto(original && !baked && treatment !== 'natural' ? original : null, treatment, ink, deck.stock);
  if (!original) return { src: null, unbaked: false };
  if (treatment === 'natural') return { src: original, unbaked: false };
  if (baked) return { src: baked, unbaked: false };
  if (live) return { src: live, unbaked: false };
  return { src: original, unbaked: true };
}

// Remember photos that failed so every card falls back at once rather than retrying.
const failedImages = new Set<string>();

function CourtPhoto({ src, original, treatment, unbaked, fallback }: {
  src: string;
  /** The untreated photo, to fall back on if a baked render is missing. */
  original: string;
  treatment: PhotoTreatment;
  unbaked: boolean;
  fallback: () => JSX.Element;
}) {
  const pick = (s: string) => (!failedImages.has(s) ? s : !failedImages.has(original) ? original : null);
  const [, bump] = useState(0);
  const cur = pick(src);
  if (!cur) return fallback();
  return (
    <div className="card__photo" data-treatment={treatment} data-unbaked={unbaked || cur !== src || undefined}>
      <img
        src={cur}
        alt=""
        draggable={false}
        decoding="async"
        onError={() => {
          failedImages.add(cur);
          bump((n) => n + 1);
        }}
      />
    </div>
  );
}

export function CardView({
  card, width = 56, fluid = false, face, state = '', deck: deckId, fourColour, label, className, style, decorative,
  treatment, miniTreatment = 'tinted',
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
  const code = faceDown ? '' : cardCode(card);
  const original = faceDown ? null : d.photos[code] ?? null;
  const ink = faceDown ? d.back.ink : suitInk(d, s, four);
  // Hooks run for every card; only the face that is drawn uses its result.
  const full = usePhotoSource(d, code, compact ? null : original, treatment ?? d.photoTreatment, ink, four);
  const mini = usePhotoSource(d, code, compact ? original : null, miniTreatment, ink, four);

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

  const rankLabel = code.slice(0, -1);
  const court = r >= 10;
  const photo = full.src;
  const index = (foot?: boolean) => (
    <div className={foot ? 'card__index card__index--foot' : 'card__index'} aria-hidden={foot || undefined}>
      <span className="card__rank">{rankLabel}</span>
      <Pip s={s} className="card__index-pip" />
    </div>
  );

  if (compact) {
    const miniSrc = mini.src && !failedImages.has(mini.src) ? mini.src : original && !failedImages.has(original) ? original : null;
    return (
      <div className={cls('card--compact')} data-state={state} style={vars} {...a11y}>
        {index()}
        {court ? (
          <div
            className="card__mini-slot"
            data-photo={miniSrc ? '' : undefined}
            data-unbaked={miniSrc && (mini.unbaked || miniSrc !== mini.src) && miniTreatment !== 'natural' ? '' : undefined}
            style={miniSrc ? { backgroundImage: `url(${miniSrc})` } : undefined}
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
            <CourtPhoto src={photo} original={original!} treatment={treatment ?? d.photoTreatment} unbaked={full.unbaked} fallback={houseCourt} />
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
          {photo ? <CourtPhoto src={photo} original={original!} treatment={treatment ?? d.photoTreatment} unbaked={full.unbaked} fallback={houseCourt} /> : houseCourt()}
        </div>
      )}
    </div>
  );
}
