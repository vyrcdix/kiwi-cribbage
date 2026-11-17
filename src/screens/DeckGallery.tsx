// /deck — every card of a deck laid out at the full face, so a deck can be checked
// (and admired) without waiting to be dealt the right cards. Switch between the four
// decks, and try four-colour suits.
import { useContext, useState } from 'react';
import { RANKS, SUIT_NAMES, card } from '../../shared/cards';
import { Brand } from '../brand/Mark';
import { CardView } from '../cards/CardView';
import { DECKS, DECK_ORDER, DEFAULT_DECK, DeckContext } from '../cards/decks';
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
