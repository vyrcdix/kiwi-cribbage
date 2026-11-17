import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { type GameSummary, type Profile, api, errorMessage, errorStatus } from '../lib/api';
import { greeting, timeAgo } from '../lib/format';
import { navigate } from '../lib/router';

const RECENT_FINISHED = 10;
const ts = (v: string | number | null) => (v === null ? 0 : new Date(v).getTime() || 0);

function GameRow({ g }: { g: GameSummary }) {
  const you = g.you;
  const opp = you === 0 ? 1 : 0;
  const oppName = g.opponent?.name ?? 'Someone';
  let title: string;
  let detail: string;
  let badge: string | null = null;
  let tone = '';
  if (g.status === 'waiting') {
    title = 'Waiting for an opponent';
    detail = `Code ${g.code} · tap to share the link`;
    tone = 'is-waiting';
  } else if (g.status === 'active') {
    title = `vs ${oppName}`;
    const diff = g.scores[you] - g.scores[opp];
    detail = `You ${g.scores[you]} · ${oppName} ${g.scores[opp]}`;
    badge = diff > 0 ? 'ahead' : diff < 0 ? 'behind' : 'level';
    tone = 'is-active';
  } else {
    const won = g.winner === you;
    title = won ? `Beat ${oppName}` : `Lost to ${oppName}`;
    detail = `${g.scores[you]}–${g.scores[opp]} · ${timeAgo(g.finishedAt ?? g.createdAt)}`;
    if (g.skunk) badge = `${g.skunk === 2 ? '🥬🥬 double skunk' : '🥬 skunk'}`;
    tone = won ? 'is-won' : 'is-lost';
  }
  return (
    <li>
      <button type="button" className={`game-row ${tone}`} onClick={() => navigate(`/g/${g.code}`)}>
        <span className="game-row__main">
          <span className="game-row__title">{title}</span>
          <span className="game-row__detail">{detail}</span>
        </span>
        {badge && <span className="game-row__badge">{badge}</span>}
        <svg className="game-row__chev" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </li>
  );
}

export function Home({ profile, onAuthLost }: { profile: Profile; onAuthLost: () => void }) {
  const token = profile.token;
  const [games, setGames] = useState<GameSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [code, setCode] = useState('');

  const load = useCallback(async () => {
    try {
      const r = await api.listGames(token);
      setGames(r.games);
      setError(null);
    } catch (e) {
      if (errorStatus(e) === 401) onAuthLost();
      else setError(errorMessage(e));
    }
  }, [token, onAuthLost]);

  useEffect(() => {
    void load();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [load]);

  const newGame = async () => {
    setCreating(true);
    setError(null);
    try {
      const r = await api.createGame(token);
      navigate(`/g/${r.code}`);
    } catch (e) {
      if (errorStatus(e) === 401) onAuthLost();
      setError(errorMessage(e));
      setCreating(false);
    }
  };

  const joinByCode = (e: FormEvent) => {
    e.preventDefault();
    const c = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (c) navigate(`/g/${c}`);
  };

  const live = (games ?? [])
    .filter((g) => g.status !== 'finished')
    .sort((a, b) => (a.status === b.status ? ts(b.createdAt) - ts(a.createdAt) : a.status === 'active' ? -1 : 1));
  const done = (games ?? [])
    .filter((g) => g.status === 'finished')
    .sort((a, b) => ts(b.finishedAt ?? b.createdAt) - ts(a.finishedAt ?? a.createdAt))
    .slice(0, RECENT_FINISHED);

  return (
    <div className="page">
      <main className="home">
        <header className="home__head">
          <h1 className="brand brand--small">Cabbage</h1>
          <p className="home__hello">
            {greeting()}, <strong>{profile.name}</strong>.
          </p>
        </header>

        <button type="button" className="btn btn--primary btn--hero" onClick={newGame} disabled={creating}>
          {creating ? 'Shuffling…' : 'New game'}
          <span className="btn__note">You’ll get a link to send</span>
        </button>

        {error && <p className="form-error" role="alert">{error}</p>}

        {games === null && !error && <p className="muted">Fetching your games…</p>}

        {live.length > 0 && (
          <section className="games">
            <h2>In progress</h2>
            <ul>{live.map((g) => <GameRow key={g.code} g={g} />)}</ul>
          </section>
        )}

        {done.length > 0 && (
          <section className="games">
            <h2>Recent games</h2>
            <ul>{done.map((g) => <GameRow key={g.code} g={g} />)}</ul>
          </section>
        )}

        {games !== null && games.length === 0 && (
          <p className="empty">No games yet. Start one and send the link to someone you like.</p>
        )}

        <form className="code-form" onSubmit={joinByCode}>
          <label htmlFor="code">Have a game code?</label>
          <div className="code-form__row">
            <input
              id="code"
              className="input input--code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              maxLength={8}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              placeholder="ABCDE"
            />
            <button type="submit" className="btn btn--ghost" disabled={!code.trim()}>
              Join
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}
