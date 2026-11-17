import { CardView } from './CardView.jsx';
import { Board } from './Board.jsx';
import { Trophy } from './Mark.jsx';

// The table. Six fixed zones, top to bottom, identical in every phase so nothing jumps:
//   opponent strip (56) / board (156) / table top (flex) / prompt (48) / hand (92) / your strip (52)
// Only the stage inside the table top, and what the prompt and hand zones hold, change by phase.
//
// Expected shape (all of it is text or state the server already has):
// game = {
//   phase: 'deal' | 'cut' | 'pegging' | 'show' | 'over',
//   deck, fourColour,
//   you:  { name, initial, score, prev, status },             status: "Ahead by 5"
//   opp:  { name, initial, score, prev, status, held, considering },  held: cards in hand
//   crib: { owner: "Dot's crib", count },
//   starter: { rank, suit } | null,
//   hand: [{ id, rank, suit, state, disabled }],              state: '' | 'dim' | 'picked'
//   prompt: { text, action: { label, onPress } | null },
//   pegging: { count, last: { cards, note } | null, current: [{ rank, suit, by: 'you' | 'opp' }] },
//   show: { stage: 0 | 1 | 2, stages: [...names], cards: [{ rank, suit, state, starter }],
//           steps: [{ name, detail, running, current }] },
//   over: { headline, detail, skunk: 0 | 1 | 2, tally: [{ label, you, opp }] },
//   tally: [{ label, you, opp }], log: [{ text, value, score }]   laptop only
// }

export function Table({ game, onCard }) {
  const { phase, you, opp, deck, fourColour } = game;
  const card = { deck, fourColour };
  return (
    <main className="table" data-phase={phase}>
      <PlayerStrip who="opp" player={opp} card={card} />
      <div className="table__board"><Board opp={opp} you={you} /></div>

      <section className="table__top" aria-label="Table">
        {phase !== 'over' && <TopRow game={game} card={card} />}
        <div className="stage">
          {phase === 'deal' && <DealStage />}
          {phase === 'cut' && <CutStage game={game} card={card} />}
          {phase === 'pegging' && <PeggingStage pegging={game.pegging} card={card} />}
          {phase === 'show' && <ShowStage show={game.show} card={card} />}
          {phase === 'over' && <OverStage over={game.over} />}
        </div>
      </section>

      {/* One clear line saying what to do now. aria-live so it is also the spoken line. */}
      <div className="table__prompt">
        {phase === 'over'
          ? <button type="button" className="btn btn--wide" onClick={game.over.onRematch}>Rematch</button>
          : (
            <>
              <p aria-live="polite">{game.prompt.text}</p>
              {game.prompt.action && (
                <button type="button" className="btn" onClick={game.prompt.action.onPress}>{game.prompt.action.label}</button>
              )}
            </>
          )}
      </div>

      <div className="table__hand">
        {phase === 'over' && <button type="button" className="btn btn--wide btn--quiet" onClick={game.over.onHome}>Home</button>}
        {phase === 'show' && (
          <ol className="steps">
            {game.show.stages.map((name, i) => (
              <li key={name} aria-current={i === game.show.stage ? 'step' : undefined}>{name}</li>
            ))}
          </ol>
        )}
        {phase !== 'over' && phase !== 'show' && game.hand.map((c) => (
          <button
            key={c.id}
            type="button"
            className="hand-card"
            disabled={c.disabled}
            aria-pressed={phase === 'deal' ? c.state === 'picked' : undefined}
            onClick={() => onCard(c.id)}
          >
            <CardView rank={c.rank} suit={c.suit} state={c.state} fluid {...card} />
          </button>
        ))}
      </div>

      <PlayerStrip who="you" player={you} card={card} />
      {game.tally && phase !== 'over' && (
        <div className="table__tally"><Tally rows={game.tally} first="You" second={opp.name} /></div>
      )}
      {game.log && <HandLog log={game.log} />}
    </main>
  );
}

function PlayerStrip({ who, player, card }) {
  return (
    <div className={`player player--${who}`}>
      <div className="player__avatar" aria-hidden="true">{player.initial}</div>
      <div className="player__text">
        <strong>{player.name}</strong>
        <span>{player.status}</span>
      </div>
      {who === 'opp' && player.held > 0 && (
        // Presence without chat: the card the opponent is considering lifts. Nothing else is shown.
        <div className="player__held" role="img" aria-label={`${player.name} holds ${player.held} cards`}>
          {Array.from({ length: player.held }, (_, i) => (
            <span key={i} data-considering={player.considering === i || undefined}>
              <CardView faceDown width={22} {...card} />
            </span>
          ))}
        </div>
      )}
      <div className="player__score">{player.score}</div>
    </div>
  );
}

// Deck and starter live top left, the crib top right, in every phase.
function TopRow({ game, card }) {
  const { phase, starter, crib } = game;
  const deckAway = phase === 'cut';
  return (
    <div className="toprow">
      <div className="toprow__group">
        <div className="toprow__cards">
          {deckAway ? <div className="slot slot--small" /> : <CardView faceDown width={44} {...card} />}
          {starter && phase !== 'cut' && phase !== 'show' && <CardView {...starter} width={44} {...card} />}
          {phase === 'show' && <div className="slot slot--small" />}
        </div>
        <span>{starter ? 'Deck · starter' : 'Deck'}</span>
      </div>
      <div className="toprow__group toprow__group--end">
        <div className="toprow__cards toprow__cards--pile">
          {Array.from({ length: crib.count }, (_, i) => <CardView key={i} faceDown width={44} {...card} />)}
        </div>
        <span>{crib.count < 4 ? `${crib.owner} · ${crib.count} of 4` : crib.owner}</span>
      </div>
    </div>
  );
}

function DealStage() {
  return (
    <>
      <div className="stage__row"><div className="slot" /><div className="slot" /></div>
      <p className="caption">Your two land here, then slide to the crib</p>
    </>
  );
}

function CutStage({ game, card }) {
  return (
    <>
      <div className="cut">
        <CardView faceDown width={96} {...card} />
        <div className="cut__lifted"><CardView faceDown width={96} {...card} /></div>
        {game.starter && <div className="cut__starter"><CardView {...game.starter} width={96} {...card} /></div>}
      </div>
      <p className="eyebrow">Starter</p>
    </>
  );
}

function PeggingStage({ pegging, card }) {
  return (
    <>
      {pegging.last && (
        <div className="lastcount">
          <div className="stage__row stage__row--tight">
            {pegging.last.cards.map((c, i) => <CardView key={i} {...c} state="dim" width={34} {...card} />)}
          </div>
          <p className="caption">{pegging.last.note}</p>
        </div>
      )}
      {/* The most important number on screen during pegging. */}
      <p className="count" aria-live="polite"><strong>{pegging.count}</strong> <span>of 31</span></p>
      {/* Up to five sit side by side; from six they overlap evenly so eight still fit at 360. */}
      <div className="played" style={{ '--n': pegging.current.length }}>
        {pegging.current.map((c, i) => (
          // Theirs sit high with a blue bar above; yours sit low with a tomato bar below.
          <div key={i} className="played__card" data-by={c.by} role="group" aria-label={c.by === 'you' ? 'Played by you' : 'Played by opponent'}>
            <CardView rank={c.rank} suit={c.suit} fluid {...card} />
          </div>
        ))}
      </div>
    </>
  );
}

function ShowStage({ show, card }) {
  return (
    <>
      <div className="stage__row stage__row--show">
        {show.cards.map((c, i) => (
          <div key={i} className={c.starter ? 'show__starter' : undefined}>
            <CardView rank={c.rank} suit={c.suit} state={c.state} width={56} {...card} />
          </div>
        ))}
      </div>
      <ol className="combos">
        {show.steps.map((s, i) => (
          <li key={i} aria-current={s.current ? 'true' : undefined}>
            <span><strong>{s.name}</strong> {s.detail}</span>
            <b>{s.running}</b>
          </li>
        ))}
      </ol>
    </>
  );
}

function OverStage({ over }) {
  return (
    <>
      {over.skunk > 0 && <Trophy count={over.skunk} plate={over.skunk === 2 ? 'DOUBLE SKUNK' : 'SKUNKED'} />}
      <div className="over__text">
        <h1>{over.headline}</h1>
        <p>{over.detail}</p>
      </div>
      <Tally rows={over.tally} first="You" second={over.oppName} />
    </>
  );
}

export function Tally({ rows, first, second }) {
  return (
    <table className="tally">
      <thead><tr><th scope="col">This game</th><th scope="col">{first}</th><th scope="col">{second}</th></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.label}><th scope="row">{r.label}</th><td>{r.you}</td><td>{r.opp}</td></tr>
        ))}
      </tbody>
    </table>
  );
}

function HandLog({ log }) {
  return (
    <aside className="log" aria-label="This hand">
      <h2 className="eyebrow">This hand</h2>
      <ol>
        {log.map((e, i) => (
          <li key={i} data-score={e.score || undefined}><span>{e.text}</span><b>{e.value}</b></li>
        ))}
      </ol>
    </aside>
  );
}
