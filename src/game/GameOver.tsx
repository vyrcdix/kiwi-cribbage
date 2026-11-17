import { type PlayerView, type Seat, other } from '../../shared/game';
import { navigate } from '../lib/router';

interface Props {
  view: PlayerView;
  names: [string, string];
  next: string | null;
  busy: boolean;
  error: string | null;
  onRematch: () => void;
}

function verdict(view: PlayerView, names: [string, string]): { head: string; sub: string } {
  const winner = view.winner as Seat;
  const won = winner === view.you;
  const loserName = names[other(winner)];
  const head = won ? 'You win!' : `${names[winner]} wins`;
  if (view.skunk === 2) {
    return {
      head,
      sub: won
        ? `Double skunk! ${loserName} gets two cabbages 🥬🥬`
        : 'Double skunked. Two cabbages for you 🥬🥬 — eat your greens.',
    };
  }
  if (view.skunk === 1) {
    return {
      head,
      sub: won ? `Skunk! ${loserName} gets the cabbage 🥬` : 'Skunked! You get the cabbage 🥬',
    };
  }
  const margin = view.scores[winner] - view.scores[other(winner)];
  if (margin <= 6) return { head, sub: won ? 'By a whisker. Nicely pegged.' : 'So close. Rematch?' };
  return { head, sub: won ? 'Well played — no cabbage today.' : 'No cabbage, at least. Better luck next deal.' };
}

export function GameOver({ view, names, next, busy, error, onRematch }: Props) {
  const you = view.you;
  const opp = other(you);
  const { head, sub } = verdict(view, names);
  const rows: [string, (s: Seat) => number][] = [
    ['Pegging', (s) => view.stats[s].peg],
    ['Hands', (s) => view.stats[s].hand],
    ['Crib', (s) => view.stats[s].crib],
    ['Best hand', (s) => view.stats[s].best],
  ];

  return (
    <section className="over" aria-labelledby="over-title">
      <h2 id="over-title" className={`over__head ${view.winner === you ? 'is-you' : 'is-opp'}`}>{head}</h2>
      <p className="over__score">
        <span className="is-you">{view.scores[you]}</span>
        <span className="over__dash">–</span>
        <span className="is-opp">{view.scores[opp]}</span>
      </p>
      <p className="over__sub">{sub}</p>
      <table className="over__stats">
        <thead>
          <tr>
            <th scope="col"><span className="sr-only">Points from</span></th>
            <th scope="col" className="is-you">You</th>
            <th scope="col" className="is-opp">{names[opp]}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, get]) => (
            <tr key={label}>
              <th scope="row">{label}</th>
              <td>{get(you)}</td>
              <td>{get(opp)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {next && <p className="over__nudge">{names[opp]} wants a rematch!</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="over__buttons">
        <button type="button" className="btn btn--primary" onClick={onRematch} disabled={busy}>
          {next ? 'Join rematch' : busy ? 'Shuffling…' : 'Rematch'}
        </button>
        <button type="button" className="btn btn--ghost" onClick={() => navigate('/')}>
          Home
        </button>
      </div>
    </section>
  );
}
