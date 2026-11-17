// Rows for games across the league: a finished result, a pending game, a fixture in the queue.
import type { ReactNode } from 'react';
import type { Fixture, GameResult, PendingGame, PlayerCard } from '../../shared/league';
import { type TeamLine, teamLines } from '../lib/league-text';
import { navigate } from '../lib/router';
import { Avatar } from './Avatar';
import { Faces, SkunkTag, fmtDate, fmtIdle } from './bits';

export { teamLines };

const teamName = (t: TeamLine, meId?: string) =>
  t.players.map((p) => (p ? (p.id === meId ? 'You' : p.name) : 'Open seat')).join(' & ');

function Chevron() {
  return (
    <svg className="game-row__chev" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** One finished game: winner first in bold, the scores, skunks, the date; tap for the replay. */
export function ResultRow({ g, meId, action, link = true }: { g: GameResult; meId?: string; action?: ReactNode; link?: boolean }) {
  const lines = teamLines(g.players, g.seats, g.scores, g.skunk, g.winnerTeam);
  const winner = lines[0];
  const worst = Math.max(...g.skunk);
  const mine = meId ? g.seats.some((p) => p.id === meId) : false;
  const won = meId ? winner.players.some((p) => p?.id === meId) : false;
  const body = (
    <>
      <Faces players={winner.players} size={30} />
      <span className="game-row__main">
        <span className="game-row__title">
          {teamName(winner, meId)} <span className="result__verb">beat</span>{' '}
          {lines.slice(1).map((t) => teamName(t, meId)).join(' and ')}
        </span>
        <span className="game-row__detail">
          {lines.map((t) => t.score).join('–')} · {g.players === 4 ? 'partners' : `${g.players}p`} · {fmtDate(g.finishedAt)}
          {g.voided && <span className="result__void"> · void{g.voidReason ? `: ${g.voidReason}` : ''}</span>}
        </span>
      </span>
      {!g.voided && <SkunkTag level={worst} />}
    </>
  );
  const cls = `game-row result${g.voided ? ' is-void' : ''}${mine && !g.voided ? (won ? ' is-won' : ' is-lost') : ''}`;
  return (
    <li className="result-li">
      {link ? (
        <button type="button" className={cls} onClick={() => navigate(`/replay/${g.code}`)}>
          {body}
          <Chevron />
        </button>
      ) : (
        <div className={cls}>{body}</div>
      )}
      {action}
    </li>
  );
}

const PHASE: Record<string, string> = { discard: 'discarding', cut: 'the cut', peg: 'pegging', show: 'counting', over: 'over' };

/** A game still being played (or waiting for players), and who it is waiting on. */
export function PendingRow({ g, meId }: { g: PendingGame; meId: string }) {
  const mine = g.seats.some((p) => p?.id === meId);
  const waitingIds = new Set(g.waitingOn.map((p) => p.id));
  const stale = g.status === 'active' && g.idleSeconds >= 2 * 86400;
  const lines = teamLines(g.players, g.seats, g.scores);
  const body = (
    <>
      <span className="pending__teams">
        {lines.map((t) => (
          <span key={t.team} className="pending__team">
            {t.players.map((p, i) => (
              <span key={p?.id ?? `open-${i}`} className={`pending__player${p && waitingIds.has(p.id) ? ' is-waited' : ''}`}>
                <Avatar player={p} size={26} />
                <span className="pending__name">{p ? (p.id === meId ? 'You' : p.name) : 'Open'}</span>
              </span>
            ))}
            {g.status === 'active' && <b className="pending__score">{t.score}</b>}
          </span>
        ))}
      </span>
      <span className={`pending__status${stale ? ' is-stale' : ''}`}>
        {g.status === 'waiting' ? (
          <>Waiting for {g.openSeats === 1 ? 'one more player' : `${g.openSeats} more players`} · open {fmtIdle(g.idleSeconds)}</>
        ) : (
          <>
            <span className="pending__on">
              {g.waitingOn.length
                ? `Waiting on ${g.waitingOn.map((p) => (p.id === meId ? 'you' : p.name)).join(', ')}`
                : 'Between moves'}
            </span>
            {' · '}
            <span className="pending__idle">{stale && <ClockIcon />}{fmtIdle(g.idleSeconds)}</span>
            {' · '}deal {g.handNo}{g.phase ? `, ${PHASE[g.phase] ?? g.phase}` : ''}
          </>
        )}
      </span>
    </>
  );
  return (
    <li>
      {mine ? (
        <button type="button" className={`pending${stale ? ' is-stale' : ''} is-mine`} onClick={() => navigate(`/g/${g.code}`)}>{body}</button>
      ) : (
        <div className={`pending${stale ? ' is-stale' : ''}`}>{body}</div>
      )}
    </li>
  );
}

function ClockIcon() {
  return (
    <svg className="pending__clock" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  );
}

/** A fixture in the league's queue, numbered by its place in it. */
export function FixtureRow({ f, n, meId, action }: { f: Fixture; n: number; meId: string; action?: ReactNode }) {
  const sides = f.players === 4 ? [[f.seats[0], f.seats[2]], [f.seats[1], f.seats[3]]] : f.seats.map((p) => [p]);
  const nm = (p: PlayerCard) => (p.id === meId ? 'You' : p.name);
  return (
    <li className={`fixture${f.seats.some((p) => p.id === meId) ? ' is-mine' : ''}`}>
      <span className="fixture__n">{n}</span>
      <span className="fixture__main">
        <span className="fixture__sides">
          {sides.map((side, i) => (
            <span key={i} className="fixture__side">
              {i > 0 && <span className="fixture__v">v</span>}
              <Faces players={side} size={22} />
              <span className="fixture__names">{side.map(nm).join(' & ')}</span>
            </span>
          ))}
        </span>
        <span className="fixture__detail">
          {f.kind === 'round-robin' ? 'Round robin' : `Challenge by ${f.createdBy.id === meId ? 'you' : f.createdBy.name}`}
          {f.status === 'playing' ? <strong className="fixture__playing"> · being played</strong> : ` · queued ${fmtDate(f.createdAt)}`}
        </span>
      </span>
      {action}
    </li>
  );
}
