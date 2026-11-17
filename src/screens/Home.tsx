// Home: your league day. The next game in your queue with one button to play
// it; your games in progress (the ones waiting on you first); the rest of your
// queue; a challenge; an ad-hoc game by link; your recent results.
import { type FormEvent, useMemo, useState } from 'react';
import type { PlayerCount } from '../../shared/game';
import type { Fixture, PendingGame, PlayerCard } from '../../shared/league';
import { Mark } from '../brand/Mark';
import { summaryText } from '../game/seating';
import { type GameSummary, api, errorMessage } from '../lib/api';
import { greeting } from '../lib/format';
import { navigate } from '../lib/router';
import { useApi, useSession } from '../lib/session';
import { Avatar } from '../ui/Avatar';
import { Empty, ErrorLine, Faces, Loading, Section, fmtDate, fmtIdle } from '../ui/bits';
import { Shell } from '../ui/Shell';
import { fixtureKind, fixtureTitle } from '../lib/league-text';
import { Invite } from './League';

const ts = (v: string | null | undefined) => (v ? new Date(v).getTime() || 0 : 0);



function Chevron() {
  return (
    <svg className="game-row__chev" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MyGame({ g, pending, members }: { g: GameSummary; pending?: PendingGame; members: Map<string, PlayerCard> }) {
  const { title, detail, badge, tone } = summaryText(g);
  const finished = g.status === 'finished';
  const others = g.seats.filter((_, s) => s !== g.you).map((p) => (p ? members.get(p.id) ?? { ...p, avatar: null } : null));
  let line = detail;
  let tag: { text: string; kind: string } | null = badge ? { text: badge, kind: /skunk/.test(badge) ? 'skunk' : 'plain' } : null;
  if (g.status === 'active') {
    const idle = pending ? fmtIdle(pending.idleSeconds) : '';
    if (g.waitingOnYou) {
      tag = { text: 'Your move', kind: 'go' };
      line = `${detail}${idle ? ` · ${idle}` : ''}`;
    } else if (pending?.waitingOn.length) {
      line = `${detail} · waiting on ${pending.waitingOn.map((p) => p.name).join(', ')}${idle ? `, ${idle}` : ''}`;
    }
  }
  if (finished) line = `${detail} · ${fmtDate(g.finishedAt)}`;
  return (
    <li>
      <button type="button" className={`game-row ${tone}${g.waitingOnYou ? ' is-yours' : ''}`} onClick={() => navigate(finished ? `/replay/${g.code}` : `/g/${g.code}`)}>
        <Faces players={others} size={30} />
        <span className="game-row__main">
          <span className="game-row__title">{title}</span>
          <span className="game-row__detail">{line}</span>
        </span>
        {tag && (
          <span className={`game-row__badge game-row__badge--${tag.kind}`}>
            {tag.kind === 'skunk' && <Mark variant="simple" size={14} />}
            {tag.text}
          </span>
        )}
        <Chevron />
      </button>
    </li>
  );
}

function QueueRow({ f, meId, busy, onPlay, onClose }: { f: Fixture; meId: string; busy: boolean; onPlay: () => void; onClose: (how: 'decline' | 'cancel') => void }) {
  const others = f.seats.filter((p) => p.id !== meId);
  const canDecline = f.kind === 'challenge' && f.createdBy.id !== meId && f.status === 'queued';
  const canCancel = f.createdBy.id === meId && f.status === 'queued';
  return (
    <li className="queue-row">
      <Faces players={others} size={30} />
      <span className="queue-row__main">
        <span className="queue-row__title">{fixtureTitle(f, meId)}</span>
        <span className="queue-row__detail">
          {fixtureKind(f, meId)} · {f.players === 4 ? 'partners' : `${f.players} players`}
          {canDecline && <> · <button type="button" className="link link--small" onClick={() => onClose('decline')} disabled={busy}>Decline</button></>}
          {canCancel && <> · <button type="button" className="link link--small" onClick={() => onClose('cancel')} disabled={busy}>Cancel</button></>}
        </span>
      </span>
      {f.status === 'playing' && f.gameCode ? (
        <button type="button" className="btn btn--small btn--quiet" onClick={() => navigate(`/g/${f.gameCode}`)}>Open</button>
      ) : (
        <button type="button" className="btn btn--small" onClick={onPlay} disabled={busy}>Play</button>
      )}
    </li>
  );
}

/** Pick one to three members; with three, pick which one partners you. */
function Challenge({ onDone }: { onDone: () => void }) {
  const { league, me, token } = useSession();
  const [picked, setPicked] = useState<string[]>([]);
  const [partner, setPartner] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const others = (league?.members ?? []).filter((p) => p.active && p.id !== me?.id);
  if (!me) return null;
  if (others.length === 0) {
    return (
      <>
        <Empty small title="Nobody to challenge yet">Invite someone to the league and they’ll appear here, ready to play.</Empty>
        <Invite />
      </>
    );
  }
  const toggle = (id: string) => {
    setNote(null);
    setPicked((xs) => {
      const next = xs.includes(id) ? xs.filter((x) => x !== id) : xs.length < 3 ? [...xs, id] : xs;
      if (next.length !== 3) setPartner(null);
      else if (!partner || !next.includes(partner)) setPartner(next[0]);
      return next;
    });
  };
  const n = (picked.length + 1) as PlayerCount;
  const nameOf = (id: string) => others.find((p) => p.id === id)?.name ?? '';
  const ready = picked.length >= 1 && (picked.length < 3 || partner !== null);
  const summary =
    picked.length === 0
      ? 'Pick one to three members.'
      : picked.length === 3 && partner
        ? `You & ${nameOf(partner)} v ${picked.filter((x) => x !== partner).map(nameOf).join(' & ')}`
        : `You v ${picked.map(nameOf).join(' v ')}`;
  const send = async (playNow: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const body = picked.length === 3 && partner
        ? { opponents: picked.filter((x) => x !== partner), partner }
        : { opponents: picked };
      const f = await api.challenge(token, body);
      if (playNow) {
        const r = await api.startFixture(token, f.id);
        navigate(`/g/${r.code}`);
        return;
      }
      setPicked([]);
      setPartner(null);
      setNote('Added to the queue.');
      onDone();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="challenge">
      <ul className="chips" aria-label="Members">
        {others.map((p) => {
          const on = picked.includes(p.id);
          return (
            <li key={p.id}>
              <button type="button" className={`chip${on ? ' is-on' : ''}`} aria-pressed={on} onClick={() => toggle(p.id)} disabled={!on && picked.length >= 3}>
                <Avatar player={p} size={26} />
                <span>{p.name}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {picked.length === 3 && (
        <fieldset className="partner-pick">
          <legend>Who’s your partner?</legend>
          <div className="segmented segmented--start" role="radiogroup">
            {picked.map((id) => (
              <button key={id} type="button" role="radio" aria-checked={partner === id} className="segmented__opt" onClick={() => setPartner(id)}>
                {nameOf(id)}
              </button>
            ))}
          </div>
        </fieldset>
      )}
      <p className="challenge__summary">
        <strong>{summary}</strong>
        {picked.length > 0 && <span> · {n === 2 ? 'head to head' : n === 3 ? 'cut-throat' : 'two pairs'}</span>}
      </p>
      {error && <p className="form-error" role="alert">{error}</p>}
      {note && <p className="ok-note" role="status">{note}</p>}
      <div className="button-row">
        <button type="button" className="btn" onClick={() => send(true)} disabled={!ready || busy}>Play now</button>
        <button type="button" className="btn btn--quiet" onClick={() => send(false)} disabled={!ready || busy}>Add to queue</button>
      </div>
    </div>
  );
}

function ByLink() {
  const { token } = useSession();
  const [players, setPlayers] = useState<PlayerCount>(2);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const newGame = async () => {
    setCreating(true);
    setError(null);
    try {
      const r = await api.createGame(token, players);
      navigate(`/g/${r.code}`);
    } catch (e) {
      setError(errorMessage(e));
      setCreating(false);
    }
  };
  const joinByCode = (e: FormEvent) => {
    e.preventDefault();
    const c = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (c) navigate(`/g/${c}`);
  };
  return (
    <div className="bylink">
      <div className="count-pick" role="radiogroup" aria-label="Players">
        {([2, 3, 4] as const).map((n) => (
          <button key={n} type="button" role="radio" aria-checked={players === n} className={`count-pick__opt${players === n ? ' is-on' : ''}`} onClick={() => setPlayers(n)}>
            <strong>{n} players</strong>
            <span>{n === 2 ? 'head to head' : n === 3 ? 'cut-throat' : 'two pairs'}</span>
          </button>
        ))}
      </div>
      <button type="button" className="btn btn--wide btn--quiet" onClick={newGame} disabled={creating}>
        {creating ? 'Shuffling…' : `Open a ${players}-player table`}
        <span className="btn__note">You’ll get a link to send{players > 2 ? ' to everyone' : ''}</span>
      </button>
      {error && <p className="form-error" role="alert">{error}</p>}
      <form className="code-form" onSubmit={joinByCode}>
        <label htmlFor="code">Have a game code?</label>
        <div className="code-form__row">
          <input id="code" className="input input--code" value={code} onChange={(e) => setCode(e.target.value)} maxLength={8} autoCapitalize="characters" autoComplete="off" spellCheck={false} placeholder="ABCDE" />
          <button type="submit" className="btn btn--quiet" disabled={!code.trim()}>Join</button>
        </div>
      </form>
    </div>
  );
}

export function Home() {
  const { me, profile, token, members, league } = useSession();
  const meId = profile.id;
  const games = useApi('games', (t) => api.listGames(t));
  const queue = useApi('fixtures-mine', (t) => api.myFixtures(t));
  const pending = useApi('pending', (t) => api.pending(t));
  const [starting, setStarting] = useState<string | null>(null);
  const [queueError, setQueueError] = useState<string | null>(null);

  const pendingBy = useMemo(() => new Map((pending.data?.games ?? []).map((g) => [g.code, g])), [pending.data]);
  const all = games.data?.games ?? [];
  const live = all
    .filter((g) => g.status !== 'finished' && !g.voided)
    .sort((a, b) => {
      const rank = (g: GameSummary) => (g.waitingOnYou ? 0 : g.status === 'active' ? 1 : 2);
      return rank(a) - rank(b) || ts(b.lastMoveAt ?? b.createdAt) - ts(a.lastMoveAt ?? a.createdAt);
    });
  const yourMove = live.filter((g) => g.waitingOnYou).length;
  const done = all
    .filter((g) => g.status === 'finished')
    .sort((a, b) => ts(b.finishedAt) - ts(a.finishedAt))
    .slice(0, 8);
  const fixtures = (queue.data?.fixtures ?? []).filter((f) => f.status === 'queued' || (f.status === 'playing' && !live.some((g) => g.code === f.gameCode)));
  const queued = fixtures.filter((f) => f.status === 'queued');
  const next = queued[0] ?? null;
  const rest = fixtures.filter((f) => f !== next);

  const play = async (f: Fixture) => {
    setStarting(f.id);
    setQueueError(null);
    try {
      const r = await api.startFixture(token, f.id);
      navigate(`/g/${r.code}`);
    } catch (e) {
      setQueueError(errorMessage(e));
      setStarting(null);
    }
  };
  const close = async (f: Fixture, how: 'decline' | 'cancel') => {
    setStarting(f.id);
    setQueueError(null);
    try {
      await (how === 'decline' ? api.declineFixture(token, f.id) : api.cancelFixture(token, f.id));
      queue.reload();
    } catch (e) {
      setQueueError(errorMessage(e));
    } finally {
      setStarting(null);
    }
  };

  const nextOthers = next ? next.seats.filter((p) => p.id !== meId) : [];
  return (
    <Shell tab="home">
      <header className="home-head">
        <p className="home-head__hello">{greeting()}, <strong>{me?.name ?? profile.name}</strong>.</p>
        <p className="home-head__meta">
          {league ? league.season.name : ''}
          {yourMove > 0 && <> · <strong className="home-head__move">{yourMove === 1 ? 'one game' : `${yourMove} games`} waiting on you</strong></>}
        </p>
      </header>

      {(games.error || queue.error) && <ErrorLine error={(games.error ?? queue.error)!} retry={() => { games.reload(); queue.reload(); }} />}

      <div className="home-grid">
      <div className="home-grid__main">
      {queue.data && (
        next ? (
          <section className="upnext panel" aria-label="Up next">
            <p className="eyebrow">Up next · {fixtureKind(next, meId)}</p>
            <div className="upnext__faces">
              {nextOthers.map((p) => (
                <span key={p.id} className="upnext__face"><Avatar player={p} size={52} /><span>{p.name}</span></span>
              ))}
            </div>
            <p className="upnext__title">{fixtureTitle(next, meId)}</p>
            <button type="button" className="btn btn--hero" onClick={() => play(next)} disabled={starting !== null}>
              {starting === next.id ? 'Dealing…' : `Play ${nextOthers.length === 1 ? nextOthers[0].name : 'now'}`}
            </button>
            {queueError && <p className="form-error" role="alert">{queueError}</p>}
          </section>
        ) : (
          <section className="upnext upnext--empty" aria-label="Up next">
            <p className="eyebrow">Up next</p>
            {games.data && all.length === 0 ? (
              <>
                <p className="upnext__title">Welcome to the league</p>
                <p className="muted">Challenge someone below for your first game — or open a table and send the link.</p>
              </>
            ) : (
              <>
                <p className="upnext__title">Nothing in your queue</p>
                <p className="muted">Challenge someone below, or wait for the commissioner’s round robin.</p>
              </>
            )}
          </section>
        )
      )}

      {games.data === null && !games.error && <Loading what="Fetching your games" />}

      {live.length > 0 && (
        <Section title={yourMove ? 'Your games · your move first' : 'Your games'}>
          <ul className="rows">{live.map((g) => <MyGame key={g.code} g={g} pending={pendingBy.get(g.code)} members={members} />)}</ul>
        </Section>
      )}

      {rest.length > 0 && (
        <Section title={`Your queue · ${rest.length} more`}>
          <ul className="rows">
            {rest.map((f) => (
              <QueueRow key={f.id} f={f} meId={meId} busy={starting !== null} onPlay={() => play(f)} onClose={(how) => close(f, how)} />
            ))}
          </ul>
          {!next && queueError && <p className="form-error" role="alert">{queueError}</p>}
        </Section>
      )}

      </div>
      <div className="home-grid__side">
      <Section title="Challenge">
        <Challenge onDone={queue.reload} />
      </Section>

      <Section title="Deal a game by link">
        <ByLink />
      </Section>

      <Section title="Your recent results" action={done.length ? <a className="link link--small" href="/league" onClick={(e) => { e.preventDefault(); navigate('/league'); }}>All results</a> : undefined}>
        {done.length ? (
          <ul className="rows">{done.map((g) => <MyGame key={g.code} g={g} members={members} />)}</ul>
        ) : (
          games.data && <Empty small title="No finished games yet">Your results will collect here, each one with a hand-by-hand replay.</Empty>
        )}
      </Section>
      </div>
      </div>
    </Shell>
  );
}
