// /deck — every card of the current deck laid out, so a deck can be checked
// (and admired) without waiting to be dealt the right cards.
import { fullDeck } from '../../shared/cards';
import { CardView } from '../cards/CardView';
import { DECKS, DEFAULT_DECK } from '../cards/decks';
import { navigate } from '../lib/router';

export function DeckGallery() {
  const deck = DECKS[DEFAULT_DECK];
  const cards = fullDeck();
  const courts = cards.filter((c) => c % 13 >= 10).sort((a, b) => (b % 13) - (a % 13) || a - b);
  const pips = cards.filter((c) => c % 13 < 10);
  const grid = { display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'center' } as const;
  return (
    <div className="page">
      <main style={{ padding: '20px 16px 40px', maxWidth: 760, margin: '0 auto' }}>
        <h1 className="brand" style={{ textAlign: 'center' }}>The {deck.name} deck</h1>
        <section style={{ ...grid, ['--card-w' as string]: 'clamp(76px, 21vw, 150px)', margin: '20px 0' }}>
          <CardView card={null} />
          {courts.map((c) => <CardView key={c} card={c} />)}
        </section>
        <section style={{ ...grid, ['--card-w' as string]: 'clamp(48px, 13vw, 76px)', gap: 6 }}>
          {pips.map((c) => <CardView key={c} card={c} />)}
        </section>
        <p style={{ textAlign: 'center', marginTop: 24 }}>
          <button type="button" className="btn" onClick={() => navigate('/')}>Home</button>
        </p>
      </main>
    </div>
  );
}
