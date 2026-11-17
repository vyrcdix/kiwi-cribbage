import { CardView } from './CardView.jsx';

// The spoken count: the stage during the show, drawn for the build's slower, said-aloud count.
// Top to bottom:
//   the hand, with exactly the current step's cards lit (starter included) and the rest dim
//   what has been said so far, small and quiet, folded once it would pass two lines
//   what is being said now, large, with the reason under it; the running total in the butter box
//
// count = {
//   cards: [{ rank, suit, starter, lit }],
//   said: ['Fifteen two', 'fifteen four'],          earlier phrases, already folded by the caller
//   phrase: 'and a run of four is eight',           the current step, as spoken
//   reason: '6 · 7 · 8 · 9',                        '5 + K = 15', 'two 9s', "jack of the starter's suit"
//   total: 8,
//   final: false                                    true on the last beat ("Eight.")
// }
// Tapping the stage steps on. The prompt zone holds Count again (icon) and Continue.

export function CountStage({ count, card, onStep }) {
  return (
    <div className="stage stage--count" onClick={onStep}>
      <div className="stage__row stage__row--show">
        {count.cards.map((c, i) => (
          <div key={i} className={c.starter ? 'show__starter' : undefined}>
            <CardView rank={c.rank} suit={c.suit} state={count.final ? '' : c.lit ? 'lit' : 'dim'} width={56} {...card} />
          </div>
        ))}
      </div>
      {count.said.length > 0 && <p className="count-said">{count.said.join(', ')},</p>}
      <div className="count-now" aria-live="polite">
        <div className="count-now__text">
          <p className="count-now__phrase">{count.phrase}</p>
          {count.reason && <p className="count-now__reason">{count.reason}</p>}
        </div>
        <div className="count-total" data-final={count.final || undefined} role="img" aria-label={`Running total, ${count.total}`}>
          {count.total}
        </div>
      </div>
    </div>
  );
}

export function CountAgain({ onPress }) {
  return (
    <button type="button" className="btn btn--icon" aria-label="Count again" onClick={onPress}>
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 12 a8 8 0 1 0 2.6 -5.9" /><path d="M4 4 V8.5 H8.5" />
      </svg>
    </button>
  );
}
