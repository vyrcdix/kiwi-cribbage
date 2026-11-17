// /deck — every card of a deck laid out at the full face, so a deck can be checked
// (and admired) without waiting to be dealt the right cards. Switch between the four
// decks, try four-colour suits, and preview the photo treatments on the twelve courts.
import { useContext, useState } from 'react';
import { RANKS, SUIT_NAMES, card } from '../../shared/cards';
import { Brand } from '../brand/Mark';
import { CardView } from '../cards/CardView';
import { DECKS, DECK_ORDER, DEFAULT_DECK, DeckContext, type DeckSpec, type PhotoTreatment } from '../cards/decks';
import { useFourColour } from '../cards/prefs';
import { navigate } from '../lib/router';

export function DeckGallery() {
  const yours = useContext(DeckContext);
  const [deckId, setDeckId] = useState<string>(() => {
    const q = new URLSearchParams(location.search).get('d');
    return q && DECKS[q] ? q : DECKS[yours] ? yours : DEFAULT_DECK;
  });
  const [four, setFour] = useFourColour();
  const deck = DECKS[deckId];
  const pick = (id: string) => {
    setDeckId(id);
    history.replaceState(null, '', id === DEFAULT_DECK ? '/deck' : `/deck?d=${id}`);
  };

  return (
    <div className="page page--wide">
      <main className="gallery">
        <header className="gallery__head">
          <button type="button" className="link" onClick={() => (history.length > 1 ? history.back() : navigate('/'))}>‹ Back</button>
          <Brand size="small" />
        </header>
        <h1 className="gallery__title">The {deck.name} deck</h1>
        <div className="segmented" role="radiogroup" aria-label="Deck">
          {DECK_ORDER.map((id) => (
            <button key={id} type="button" role="radio" aria-checked={id === deckId} className="segmented__opt" onClick={() => pick(id)}>
              {DECKS[id].name}
            </button>
          ))}
        </div>
        <label className="switch switch--inline">
          <input type="checkbox" checked={four} onChange={(e) => setFour(e.target.checked)} />
          <span className="switch__track" aria-hidden="true" />
          <span className="switch__text"><strong>Four-colour suits</strong></span>
        </label>

        <DeckContext.Provider value={deckId}>
          <TreatmentPreview key={deckId} deck={deck} />
          <section className="gallery__group" aria-label="Back">
            <h2 className="eyebrow">Back</h2>
            <div className="gallery__grid">
              <CardView card={null} fluid face="full" label={`${deck.name} back`} />
            </div>
          </section>
          {[0, 1, 2, 3].map((s) => (
            <section key={s} className="gallery__group" aria-label={SUIT_NAMES[s]}>
              <h2 className="eyebrow">{SUIT_NAMES[s]}</h2>
              <div className="gallery__grid">
                {RANKS.map((_, r) => <CardView key={r} card={card(r, s)} fluid face="full" />)}
              </div>
            </section>
          ))}
        </DeckContext.Provider>
      </main>
    </div>
  );
}

const TREATMENTS: { id: PhotoTreatment; name: string; note: string }[] = [
  { id: 'natural', name: 'Natural', note: 'The photos as they are.' },
  { id: 'tinted', name: 'Tinted', note: 'Colour kept at 65%, pulled 22% toward the suit’s ink. The house default.' },
  { id: 'tritone', name: 'Tritone', note: 'Shadow ink, suit ink, card stock. For photos separated by light and dark.' },
];

/**
 * The owner's choice of treatment, previewed live on all twelve courts at full size
 * and at table size (deck-photo-spec.md). A preview only: nothing is saved. At table
 * size the mini-slot always shows the tinted render, whatever the treatment.
 */
function TreatmentPreview({ deck }: { deck: DeckSpec }) {
  const [t, setT] = useState<PhotoTreatment>(deck.photoTreatment);
  const courts = [10, 11, 12].flatMap((r) => [0, 1, 2, 3].map((s) => card(r, s)));
  const hasPhotos = courts.some((c) => deck.photos[['J', 'Q', 'K'][(c % 13) - 10] + 'SHDC'[Math.floor(c / 13)]]);
  if (!hasPhotos) return null;
  const note = TREATMENTS.find((x) => x.id === t)!.note;
  return (
    <section className="treat" aria-label="Photo treatment preview">
      <div className="treat__head">
        <h2 className="eyebrow">Photo treatment · preview</h2>
        <div className="segmented segmented--start" role="radiogroup" aria-label="Photo treatment">
          {TREATMENTS.map((x) => (
            <button key={x.id} type="button" role="radio" aria-checked={x.id === t} className="segmented__opt" onClick={() => setT(x.id)}>
              {x.name}{x.id === deck.photoTreatment ? ' · current' : ''}
            </button>
          ))}
        </div>
        <p className="caption">{note} Previewing changes nothing: the {deck.name} deck stays {deck.photoTreatment}.</p>
      </div>
      <h3 className="eyebrow">Full size</h3>
      <div className="treat__grid treat__grid--full">
        {courts.map((c) => <CardView key={c} card={c} fluid face="full" treatment={t} />)}
      </div>
      <h3 className="eyebrow">Table size</h3>
      <div className="treat__grid treat__grid--table">
        {courts.map((c) => <CardView key={c} card={c} fluid />)}
      </div>
      <p className="caption">At table size the photo is about 26 px wide and always shows the tinted render, whatever the treatment: tritone turns to a smudge that small.</p>
    </section>
  );
}
