import { DECKS, GLYPH, PIPS, RANK_NAMES, SUIT_NAMES, suitInk } from './decks.js';
import { Mark } from './Mark.jsx';

// Below this width the card drops its pip layout for a large index and one pip.
// A six-card hand on a 360 px phone is 51 px per card, so the table always uses this face.
const COMPACT_BELOW = 90;

function Pip({ suit, className, style }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} style={style}>
      <path d={GLYPH[suit]} fill="currentColor" />
    </svg>
  );
}

/**
 * rank: 'A' | '2'..'10' | 'J' | 'Q' | 'K'      suit: 'S' | 'H' | 'D' | 'C'
 * width: px                                    state: '' | 'dim' | 'lit' | 'picked'
 * deck: a key of DECKS or a deck object        faceDown, fourColour: boolean
 * fluid: take the width from CSS (--w on an ancestor rule) instead of the width prop.
 *        Used for the hand and the played row, which size to the viewport. Always the compact face.
 */
export function CardView({ rank, suit, width = 56, fluid = false, deck = 'enamel', faceDown = false, fourColour = false, state = '' }) {
  const d = typeof deck === 'string' ? DECKS[deck] : deck;
  const compact = fluid || width < COMPACT_BELOW;
  const court = rank === 'J' || rank === 'Q' || rank === 'K';
  const photo = d.photos[rank + suit] || null;
  const vars = {
    ...(fluid ? {} : { '--w': width + 'px' }),
    '--stock': d.stock,
    '--edge': d.edge,
    '--radius': d.radius,
    '--ink': faceDown ? d.back.ink : suitInk(d, suit, fourColour),
    '--index-font': d.indexFont,
  };

  if (faceDown) {
    return (
      <div className="card card--back" style={vars} role="img" aria-label="Card, face down">
        <div
          className="card__back"
          style={d.back.photo ? { backgroundImage: `url(${d.back.photo})`, backgroundSize: 'cover' } : undefined}
        />
        {!compact && !d.back.photo && (
          <div className="card__roundel"><Mark variant="mono" /></div>
        )}
      </div>
    );
  }

  const label = `${RANK_NAMES[rank] || rank} of ${SUIT_NAMES[suit]}`;

  if (compact) {
    return (
      <div className="card card--compact" data-state={state} style={vars} role="img" aria-label={label}>
        <div className="card__index">
          <span className="card__rank">{rank}</span>
          <Pip suit={suit} className="card__index-pip" />
        </div>
        {court
          ? <div className="card__mini-slot" style={photo ? { backgroundImage: `url(${photo})` } : undefined} />
          : <Pip suit={suit} className="card__big-pip" />}
      </div>
    );
  }

  return (
    <div className="card card--full" data-state={state} style={vars} role="img" aria-label={label}>
      <div className="card__index">
        <span className="card__rank">{rank}</span>
        <Pip suit={suit} className="card__index-pip" />
      </div>
      <div className="card__index card__index--foot" aria-hidden="true">
        <span className="card__rank">{rank}</span>
        <Pip suit={suit} className="card__index-pip" />
      </div>

      {!court && (photo && rank === 'A'
        ? <div className="card__slot" data-frame={d.frame}><CourtPhoto src={photo} treatment={d.photoTreatment} /></div>
        : PIPS[rank].map(([x, y], i) => (
          <Pip
            key={i}
            suit={suit}
            className={rank === 'A' ? 'card__pip card__pip--ace' : 'card__pip'}
            style={{ left: x * 100 + '%', top: y * 100 + '%', '--turn': y > 0.5 ? '180deg' : '0deg' }}
          />
        )))}

      {court && (
        <div className="card__slot" data-frame={d.frame}>
          {photo
            ? <CourtPhoto src={photo} treatment={d.photoTreatment} />
            : (
              <div className="card__house-court">
                <span>{rank}</span>
                <Pip suit={suit} className="card__court-pip" />
              </div>
            )}
        </div>
      )}
    </div>
  );
}

// Photo slot: 4:5, object-fit cover, anchored slightly above centre so faces survive the crop.
// See deck-photo-spec.md. The treatment is baked at upload (photo-treatment.js), so the image arrives
// already treated and CSS adds only the vignette. The mini-slot shows the same render as the full face.
function CourtPhoto({ src, treatment }) {
  return (
    <div className="card__photo" data-treatment={treatment}>
      <img src={src} alt="" loading="lazy" decoding="async" />
    </div>
  );
}
