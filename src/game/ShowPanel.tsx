import { useState } from 'react';
import type { Card } from '../../shared/cards';
import type { PlayerView } from '../../shared/game';
import { describeItem } from '../../shared/scoring';
import { CardView } from '../cards/CardView';
import { cardText, possessive } from '../lib/format';

const STEP_NAMES = ['Non-dealer’s hand', 'Dealer’s hand', 'The crib'];

/** The counting of one hand or crib. Keyed by the caller per show step, so highlight state resets. */
export function ShowPanel({ view, names }: { view: PlayerView; names: [string, string] }) {
  const r = view.showResult!;
  const starter = view.starter!;
  const [hover, setHover] = useState<number | null>(null);
  const [pinned, setPinned] = useState<number | null>(null);
  const active = hover ?? pinned;
  const hl = active === null || !r.items[active] ? null : new Set<Card>(r.items[active].cards);

  const whose = r.seat === view.you ? 'Your' : possessive(names[r.seat]);
  const title = `${whose} ${r.crib ? 'crib' : 'hand'}`;
  const cardState = (c: Card) => ({ highlighted: hl ? hl.has(c) : false, dimmed: hl ? !hl.has(c) : false });

  return (
    <section className="show" aria-labelledby="show-title">
      <header className="show__head">
        <h2 id="show-title" className={r.seat === view.you ? 'is-you' : 'is-opp'}>{title}</h2>
        <span className="show__step">
          {STEP_NAMES[view.showStep]} · {view.showStep + 1} of 3
        </span>
      </header>
      <div className="show__cards">
        {r.cards.map((c) => (
          <CardView key={c} card={c} {...cardState(c)} />
        ))}
        <div className="show__starter">
          <CardView card={starter} {...cardState(starter)} />
          <span>Starter</span>
        </div>
      </div>
      {r.items.length > 0 ? (
        <ul className="show__items">
          {r.items.map((it, i) => (
            <li key={i}>
              <button
                type="button"
                className={`show__item${active === i ? ' is-active' : ''}`}
                aria-pressed={pinned === i}
                onPointerEnter={(e) => e.pointerType === 'mouse' && setHover(i)}
                onPointerLeave={(e) => e.pointerType === 'mouse' && setHover(null)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                onClick={() => setPinned((p) => (p === i ? null : i))}
              >
                <span className="show__desc">{describeItem(it)}</span>
                <span className="show__which">{it.cards.map(cardText).join(' ')}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="show__nothing">Nineteen! (That’s cribbage for “not a single point”.)</p>
      )}
      <p className="show__total">
        Total <strong>{r.total}</strong>
      </p>
    </section>
  );
}
