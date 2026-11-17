import { CardView } from './CardView.jsx';

// Compact strips for two or three other players, side by side across the top in clockwise
// order. Same 56 px zone as the single opponent strip. Each cell is two lines:
//   line 1: team marker, name (gets all the width that is left), dealer disc
//   line 2: cards held, or a short status; then the score
// At 360 wide a cell is 161 px with two players and 105 px with three, which leaves the name
// about 120 px or 65 px. Names longer than that end in an ellipsis; nothing else is dropped.
//
// player: { name, initial, team: 'tomato' | 'blue' | 'mustard', held, status, score, dealer, active }
// score: omit it for your partner, whose team score is already on your own strip.

export function TeamMark({ team, initial, size = 20 }) {
  // Mustard is a diamond with no letter; the others are discs with the player's initial.
  return (
    <span className="mark" data-team={team} style={{ '--m': size + 'px' }} aria-hidden="true">
      {team === 'mustard' ? null : initial}
    </span>
  );
}

export function OpponentStrips({ players, card }) {
  return (
    <div className="strips" data-count={players.length}>
      {players.map((p) => (
        <div key={p.name} className="strip" data-active={p.active || undefined}>
          <div className="strip__top">
            <TeamMark team={p.team} initial={p.initial} />
            <strong title={p.name}>{p.name}</strong>
            {p.dealer && <span className="strip__dealer" role="img" aria-label="Dealer">D</span>}
          </div>
          <div className="strip__bottom">
            {p.held > 0
              ? (
                <span className="strip__held" role="img" aria-label={`Holds ${p.held} cards`}>
                  {Array.from({ length: p.held }, (_, i) => <CardView key={i} faceDown width={16} {...card} />)}
                </span>
              )
              : <span className="strip__status">{p.status}</span>}
            {p.score != null && <b>{p.score}</b>}
          </div>
        </div>
      ))}
    </div>
  );
}

// A played card with three or four players: a chip says who. Yours still sit low, chip below.
export function PlayedCard({ by, children }) {
  return (
    <div className="played__card played__card--chip" data-mine={by.mine || undefined} role="group" aria-label={`Played by ${by.mine ? 'you' : by.name}`}>
      <TeamMark team={by.team} initial={by.initial} size={16} />
      {children}
    </div>
  );
}

// The show tracker for four or five stages: one segment per hand plus the crib, in the colour
// of the team that scores it. With three stages, keep the pills from Table.jsx.
// stages: [{ name, team }]   current: index
export function ShowTracker({ stages, current }) {
  const next = stages[current + 1];
  return (
    <div className="tracker">
      <p>
        <strong>{stages[current].name}</strong> <span>{current + 1} of {stages.length}</span>
        {next && <span className="tracker__next">Next: {next.name}</span>}
      </p>
      <ol aria-label="Show progress">
        {stages.map((s, i) => (
          <li
            key={s.name}
            data-team={s.team}
            data-done={i <= current || undefined}
            aria-current={i === current ? 'step' : undefined}
            aria-label={s.name}
          />
        ))}
      </ol>
    </div>
  );
}
