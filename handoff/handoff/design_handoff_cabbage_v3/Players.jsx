import { CardView } from './CardView.jsx';

// Compact strips for two or three other players, side by side across the top in clockwise
// order. Same 56 px zone as the single opponent strip. Each cell is two lines:
//   line 1: team marker, name. Nothing else, so the name always gets the full 65 px at 360.
//   line 2: the dealer's deck glyph, cards held or a short status, then the score
// Names longer than the line end in an ellipsis; nothing else is dropped.
//
// player: { name, label, team: 'tomato' | 'blue' | 'mustard', held, status, score, dealer, active }
// label: what the chip says. Use chipLabels() below so two players never share one.
// status, during the show: Counting / Next / Later / Counted / Crib now / Crib next / Crib last.
// score: omit it for your partner, whose team score is already on your own strip.

// One letter each. If two players at the table would get the same letter in the same colour,
// both get two: the first letter plus the first letter that tells them apart (Margaret B. and
// Margaret T. become MB and MT; Dave and Dot become Da and Do). If nothing tells them apart,
// the seat number: M1, M2.
export function chipLabels(players) {
  return players.map((p, i) => {
    const clash = players.filter((q) => q !== p && q.team === p.team && q.name[0].toUpperCase() === p.name[0].toUpperCase());
    if (!clash.length) return p.name[0].toUpperCase();
    const a = p.name.replace(/[^\p{L}]/gu, '');
    for (let k = 1; k < a.length; k++) {
      if (clash.every((q) => (q.name.replace(/[^\p{L}]/gu, '')[k] || '').toLowerCase() !== a[k].toLowerCase())) return a[0].toUpperCase() + a[k];
    }
    return a[0].toUpperCase() + (i + 1);
  });
}

function DeckGlyph() {
  // The dealer holds the deck. A glyph, not a letter, so it can never be read as an initial.
  return (
    <svg className="strip__dealer" viewBox="0 0 16 16" role="img" aria-label="Dealer">
      <rect x="2" y="4" width="9" height="11" rx="1.5" fill="#FCFAF4" stroke="#1F2723" strokeWidth="1.5" />
      <rect x="5" y="1" width="9" height="11" rx="1.5" fill="#1F2723" />
    </svg>
  );
}

export function TeamMark({ team, label, size = 20 }) {
  // Mustard is a diamond with no letter; the others are discs with the player's label.
  return (
    <span className="mark" data-team={team} data-wide={label && label.length > 1 ? '' : undefined} style={{ '--m': size + 'px' }} aria-hidden="true">
      {team === 'mustard' ? null : label}
    </span>
  );
}

export function OpponentStrips({ players, card }) {
  return (
    <div className="strips" data-count={players.length}>
      {players.map((p) => (
        <div key={p.name} className="strip" data-active={p.active || undefined}>
          <div className="strip__top">
            <TeamMark team={p.team} label={p.label} />
            <strong title={p.name}>{p.name}</strong>
          </div>
          <div className="strip__bottom">
            {p.dealer && <DeckGlyph />}
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

// A played card with three or four players: a chip says who. The chip is always BELOW the card,
// so other players' cards start at the top of the row and yours can sit lower (styles.css, --drop).
export function PlayedCard({ by, children }) {
  return (
    <div className="played__card played__card--chip" data-mine={by.mine || undefined} role="group" aria-label={`Played by ${by.mine ? 'you' : by.name}`}>
      {children}
      <TeamMark team={by.team} label={by.label} size={16} />
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
