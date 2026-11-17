import { type ReactElement, useEffect, useState } from 'react';
import { type Card, value } from '../../shared/cards';
import { type Action, type PlayerView, type Seat, other } from '../../shared/game';
import { CardView } from '../cards/CardView';
import { cardText, possessive } from '../lib/format';
import type { ConnStatus, StateMsg } from '../lib/useGameSocket';
import type { Line } from './callouts';
import { GameOver } from './GameOver';
import { ScoreTrack } from './ScoreTrack';
import { ShowPanel } from './ShowPanel';
import { TopBar } from './TopBar';

interface Props {
  msg: StateMsg;
  view: PlayerView;
  names: [string, string];
  status: ConnStatus;
  pending: boolean;
  act: (a: Action) => void;
  callouts: Line[];
  log: Line[];
  toast: string | null;
  rematch: { busy: boolean; error: string | null; go: () => void };
}

const seatClass = (seat: Seat | null, you: Seat) => (seat === null ? '' : seat === you ? 'is-you' : 'is-opp');

function PlayerBar({
  name, seat, view, online, active, isYou,
}: { name: string; seat: Seat; view: PlayerView; online?: boolean; active: boolean; isYou: boolean }) {
  const dealer = view.dealer === seat;
  return (
    <div className={`player ${isYou ? 'player--you is-you' : 'player--opp is-opp'}${active ? ' is-active' : ''}`}>
      <span className="player__peg" aria-hidden="true" />
      <span className="player__name">
        <span className="player__label">{name}</span>
        {!isYou && (
          <span className={`presence ${online ? 'is-online' : 'is-offline'}`} title={online ? 'Online' : 'Offline'}>
            <span className="sr-only">{online ? 'online' : 'offline'}</span>
          </span>
        )}
      </span>
      {dealer && <span className="chip chip--dealer" title="Dealer: the crib is theirs">Dealer</span>}
      {active && <span className="player__turn">{isYou ? 'your turn' : 'thinking…'}</span>}
      <span className="player__score" aria-label={`${view.scores[seat]} points`}>{view.scores[seat]}</span>
    </div>
  );
}

function PlayedRow({ view }: { view: PlayerView }) {
  const firstLive = view.played.length - view.pile.length;
  return (
    <ol className="played" aria-label="Cards played this hand">
      {view.played.map((p, i) => {
        const mine = p.seat === view.you;
        const live = i >= firstLive;
        return (
          <li key={p.card} className={`played__card ${mine ? 'is-you' : 'is-opp'}${live ? ' is-live' : ' is-old'}`}>
            <CardView card={p.card} dimmed={!live} label={`${mine ? 'You' : 'Opponent'}: ${cardText(p.card)}`} />
          </li>
        );
      })}
    </ol>
  );
}

export function Table({ msg, view, names, status, pending, act, callouts, log, toast, rematch }: Props) {
  const you = view.you;
  const opp = other(you);
  const oppName = names[opp];
  const youDeal = view.dealer === you;
  const cribName = youDeal ? 'your crib' : `${possessive(oppName)} crib`;
  const [selected, setSelected] = useState<Card[]>([]);

  // A new deal or phase clears any half-made selection.
  useEffect(() => setSelected([]), [view.handNo, view.phase]);
  const sel = selected.filter((c) => view.hand.includes(c));

  const toggle = (c: Card) =>
    setSelected((s0) => {
      const s = s0.filter((x) => view.hand.includes(x));
      if (s.includes(c)) return s.filter((x) => x !== c);
      return s.length < 2 ? [...s, c] : [s[1], c];
    });

  const phase = view.phase;
  const iDiscarded = view.discarded[you];
  const myTurn = phase === 'peg' && view.turn === you;
  const iCut = phase === 'cut' && !youDeal;

  // ---- the hand ----
  let handCards: ReactElement[] = [];
  if (phase === 'discard' && !iDiscarded) {
    handCards = view.hand.map((c) => (
      <CardView key={c} card={c} selected={sel.includes(c)} onClick={() => toggle(c)} disabled={pending} />
    ));
  } else if (myTurn) {
    handCards = view.hand.map((c) => {
      const legal = view.count + value(c) <= 31;
      return legal ? (
        <CardView key={c} card={c} onClick={() => act({ t: 'play', card: c })} disabled={pending} className="is-playable" />
      ) : (
        <CardView key={c} card={c} dimmed label={`${cardText(c)} (would go over 31)`} />
      );
    });
  } else {
    handCards = view.hand.map((c) => <CardView key={c} card={c} />);
  }

  // ---- the action line ----
  let action: ReactElement | null = null;
  if (phase === 'discard') {
    if (!iDiscarded) {
      const need = 2 - sel.length;
      action = (
        <button
          type="button"
          className="btn btn--primary btn--wide"
          disabled={need > 0 || pending}
          onClick={() => act({ t: 'discard', cards: [sel[0], sel[1]] })}
        >
          {need === 2 ? `Choose two cards for ${cribName}` : need === 1 ? 'Choose one more card' : `Send to ${cribName}`}
        </button>
      );
    } else {
      action = <p className="status">{view.discarded[opp] ? 'Cutting the deck…' : `Waiting for ${oppName}…`}</p>;
    }
  } else if (phase === 'cut') {
    action = iCut ? (
      <button type="button" className="btn btn--primary btn--wide" disabled={pending} onClick={() => act({ t: 'cut' })}>
        Cut the deck
      </button>
    ) : (
      <p className="status">{oppName} is cutting…</p>
    );
  } else if (phase === 'peg') {
    action = myTurn ? (
      <p className="status status--you">Your turn: tap a card to play</p>
    ) : (
      <p className="status">{oppName}’s turn…</p>
    );
  } else if (phase === 'show') {
    action = view.acks[you] ? (
      <p className="status">
        Waiting for {oppName}
        {msg.online[opp] ? '…' : ' (offline)…'}
      </p>
    ) : (
      <button type="button" className="btn btn--primary btn--wide" disabled={pending} onClick={() => act({ t: 'ack' })}>
        {view.showStep === 2 ? 'Next deal' : 'Continue'}
        {view.acks[opp] && <span className="btn__note">{oppName} is ready</span>}
      </button>
    );
  }

  // ---- the middle of the table ----
  const deckButton = iCut ? (
    <button type="button" className="deck deck--cut" onClick={() => act({ t: 'cut' })} disabled={pending} aria-label="Cut the deck">
      <span className="deck__stack" aria-hidden="true">
        <CardView card={null} />
        <CardView card={null} />
        <CardView card={null} />
      </span>
      <span className="deck__caption">Tap to cut</span>
    </button>
  ) : (
    <div className="deck">
      <span className="deck__stack">
        <CardView card={null} />
        <CardView card={null} />
        {view.starter !== null ? <CardView card={view.starter} className="deck__starter" /> : <CardView card={null} />}
      </span>
      <span className="deck__caption">{view.starter !== null ? 'Starter' : 'Deck'}</span>
    </div>
  );

  const crib = (
    <div className={`crib ${youDeal ? 'is-you' : 'is-opp'}`}>
      <span className="crib__stack" aria-hidden="true">
        {view.cribCount === 0 ? (
          <span className="crib__empty" />
        ) : (
          Array.from({ length: Math.min(view.cribCount, 4) }, (_, i) => <CardView key={i} card={null} />)
        )}
      </span>
      <span className="crib__caption">{youDeal ? 'Your crib' : `${possessive(oppName)} crib`}</span>
    </div>
  );

  let middle: ReactElement;
  if (phase === 'show' && view.showResult) {
    middle = <ShowPanel key={`${view.handNo}-${view.showStep}`} view={view} names={names} />;
  } else if (phase === 'over') {
    middle = (
      <GameOver view={view} names={names} next={msg.next} busy={rematch.busy} error={rematch.error} onRematch={rematch.go} />
    );
  } else {
    middle = (
      <>
        <div className="felt__top">
          {deckButton}
          {crib}
          {phase === 'peg' && (
            <div className="count" aria-live="polite">
              <span className="count__label">Count</span>
              <span className="count__value" key={view.count}>{view.count}</span>
            </div>
          )}
        </div>
        {phase === 'peg' && <PlayedRow view={view} />}
        {phase === 'discard' && view.handNo === 1 && (
          <p className="felt__note">
            Cut for deal: you {cardText(view.firstCut[you])}, {oppName} {cardText(view.firstCut[opp])}.{' '}
            {youDeal ? 'Low card — you deal first.' : `Low card — ${oppName} deals first.`}
          </p>
        )}
      </>
    );
  }

  const handHidden = phase === 'show' || phase === 'over';

  return (
    <div className="page page--game">
      <TopBar status={status} code={msg.code} hand={view.handNo} />
      <main className={`table phase-${phase}`}>
        <section className="opp" aria-label={`${oppName}`}>
          <PlayerBar
            name={oppName}
            seat={opp}
            view={view}
            online={msg.online[opp]}
            isYou={false}
            active={(phase === 'peg' && view.turn === opp) || (phase === 'cut' && youDeal)}
          />
          <div className="opp__hand" aria-label={`${oppName} holds ${view.oppHandCount} cards`}>
            {Array.from({ length: view.oppHandCount }, (_, i) => (
              <CardView key={i} card={null} />
            ))}
          </div>
        </section>

        <ScoreTrack target={view.target} you={you} scores={view.scores} back={view.back} names={names} />

        <section className={`felt${phase === 'show' || phase === 'over' ? ' felt--panel' : ''}`}>{middle}</section>

        {/* Over the opponent's corner: never hides the cards in play or anything tappable. */}
        <div className="callouts" aria-live="assertive">
          {callouts.map((c) => (
            <p key={c.id} className={`callout ${seatClass(c.seat, you)}`}>
              {c.text}
            </p>
          ))}
        </div>

        {log.length > 0 && (
          <ol className="log" aria-label="Recent plays">
            {log.slice(0, 3).map((l) => (
              <li key={l.id} className={seatClass(l.seat, you)}>
                {l.text}
              </li>
            ))}
          </ol>
        )}

        <section className="me" aria-label="You">
          <PlayerBar name={names[you]} seat={you} view={view} isYou active={myTurn || iCut} />
          {!handHidden && (
            <div className={`hand${view.hand.length > 4 ? ' hand--crowded' : ''}${myTurn ? ' is-turn' : ''}`}>{handCards}</div>
          )}
          {action && <div className="actions">{action}</div>}
        </section>

        {toast && (
          <p className="toast" role="alert">
            {toast}
          </p>
        )}
      </main>
    </div>
  );
}
