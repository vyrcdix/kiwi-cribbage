// A player's page: record overall and by game size, averages, best hand and
// crib in real cards, streaks, honours with dates, and recent results.
import { useState } from 'react';
import type { Averages, HandHighlight, PlayerStats, RecordLine, SeasonFilter } from '../../shared/league';
import { api, errorMessage } from '../lib/api';
import { navigate, onLink } from '../lib/router';
import { useApi, useSession } from '../lib/session';
import { HONOUR_INFO, Medal } from '../stats/honours';
import { Avatar } from '../ui/Avatar';
import { Empty, ErrorLine, Form, HandCards, Loading, SeasonPicker, Section, SkunkTag, avg, fmtDate, pct, plural } from '../ui/bits';
import { Shell } from '../ui/Shell';

function SizeTable({ s }: { s: PlayerStats }) {
  const rows: [string, RecordLine, Averages][] = [
    ['Two players', s.bySize['2'], s.averagesBySize['2']],
    ['Three players', s.bySize['3'], s.averagesBySize['3']],
    ['Four (partners)', s.bySize['4'], s.averagesBySize['4']],
  ];
  return (
    <div className="table-scroll">
      <table className="sizes">
        <thead>
          <tr>
            <th scope="col">Game</th>
            <th scope="col">P</th>
            <th scope="col">W–L</th>
            <th scope="col">Win</th>
            <th scope="col">Pts</th>
            <th scope="col" className="st-wide">Skunks</th>
            <th scope="col" className="st-wide">Hand</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, r, a]) => (
            <tr key={label} className={r.played ? undefined : 'is-unplayed'}>
              <th scope="row">{label}</th>
              <td>{r.played}</td>
              <td>{r.won}–{r.lost}</td>
              <td>{r.played ? pct(r.winRate) : '–'}</td>
              <td className="sizes__pts">{r.matchPoints}</td>
              <td className="st-wide">{r.skunksGiven}–{r.skunksTaken}</td>
              <td className="st-wide">{avg(a.hand)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Highlight({ title, h }: { title: string; h: HandHighlight | null }) {
  return (
    <div className="best">
      <p className="best__who">{title}</p>
      {h ? (
        <>
          <HandCards cards={h.cards} starter={h.starter} width={42} />
          <p className="best__meta">
            <b className="best__pts">{h.points}</b> · {fmtDate(h.at, true)} ·{' '}
            <a href={`/replay/${h.code}?hand=${h.handNo}`} onClick={(e) => onLink(e, `/replay/${h.code}?hand=${h.handNo}`)}>replay</a>
          </p>
        </>
      ) : (
        <p className="muted">Nothing counted yet.</p>
      )}
    </div>
  );
}

export function PlayerPage({ id }: { id: string }) {
  const { league, profile, token, members } = useSession();
  const [season, setSeason] = useState<SeasonFilter>('all');
  const [note, setNote] = useState<string | null>(null);
  const st = useApi(`player-${id}-${season}`, (t) => api.playerStats(t, id, season));
  const s = st.data;
  const p = s?.player ?? members.get(id) ?? null;
  const me = id === profile.id;

  const challenge = async () => {
    try {
      await api.challenge(token, { opponents: [id] });
      setNote(`Challenge sent: it’s in your queue and ${p?.name ?? 'theirs'}.`);
    } catch (e) {
      setNote(errorMessage(e));
    }
  };

  return (
    <Shell tab="stats">
      {p && (
        <header className="player-head">
          <Avatar player={p} size={72} />
          <div className="player-head__text">
            <h1 className="page-head__title">{p.name}{me && <span className="who__you"> (you)</span>}</h1>
            <p className="player-head__tags">
              {p.commissioner && <span className="tag tag--ink">Commissioner</span>}
              {!p.active && <span className="tag">Left the league</span>}
              {s?.currentStreak && s.currentStreak.length > 1 && (
                <span className="tag">{s.currentStreak.result === 'W' ? `${s.currentStreak.length} wins in a row` : `${s.currentStreak.length} losses in a row`}</span>
              )}
            </p>
          </div>
        </header>
      )}
      <div className="player-actions">
        {league && <SeasonPicker seasons={league.seasons} value={season} onChange={setSeason} />}
        {!me && (
          <>
            <button type="button" className="btn btn--small btn--quiet" onClick={() => navigate(`/stats/${profile.id}/${id}`)}>Head to head with you</button>
            {p?.active && <button type="button" className="btn btn--small" onClick={challenge}>Challenge</button>}
          </>
        )}
      </div>
      {note && <p className="ok-note" role="status">{note}</p>}
      {st.error && <ErrorLine error={st.error} retry={st.reload} />}
      {!s && !st.error && <Loading what="Totting up" />}
      {s && (
        <div className={`stack${st.loading ? ' is-refreshing' : ''}`}>
          {s.overall.played === 0 ? (
            <Empty title={season === 'all' ? `${s.player.name} hasn’t finished a game yet` : `No games in ${s.season?.name ?? 'this season'}`}>
              Records, averages, best hands and honours appear here once games are finished.
            </Empty>
          ) : (
            <>
              <section className="record-strip" aria-label="Record">
                <div><b>{s.overall.played}</b><span>played</span></div>
                <div><b>{s.overall.won}–{s.overall.lost}</b><span>won–lost</span></div>
                <div><b>{pct(s.overall.winRate)}</b><span>win rate</span></div>
                <div className="record-strip__pts"><b>{s.overall.matchPoints}</b><span>match points</span></div>
              </section>
              <div className="record-form">
                <p className="caption">Last {s.recent.length} <Form chips={s.recent} /></p>
                <p className="caption">
                  {s.longestWinningStreak > 1 && <>Longest winning streak {s.longestWinningStreak} · </>}
                  Skunks {s.overall.skunksGiven} given, {s.overall.skunksTaken} taken
                </p>
              </div>

              <Section title="By game size">
                <SizeTable s={s} />
              </Section>

              <Section title="Averages per hand">
                <div className="avgs">
                  <div><b>{avg(s.averages.hand)}</b><span>hand</span><small>{plural(s.averages.hands, 'hand')}</small></div>
                  <div><b>{avg(s.averages.crib)}</b><span>crib</span><small>{plural(s.averages.cribs, 'crib')}</small></div>
                  <div><b>{avg(s.averages.pegging)}</b><span>pegging</span><small>{plural(s.averages.peggingHands, 'hand')}</small></div>
                </div>
              </Section>

              <Section title="Best of">
                <div className="best-pair">
                  <Highlight title="Best hand" h={s.bestHand} />
                  <Highlight title="Best crib" h={s.bestCrib} />
                </div>
              </Section>
            </>
          )}

          <Section title="Honours">
            <ul className="honours">
              {s.honours.map((h) => (
                <li key={h.kind} className={`honour${h.count ? '' : ' is-none'}`}>
                  <Medal kind={h.kind} size={40} />
                  <span className="honour__text">
                    <strong>{HONOUR_INFO[h.kind].title}</strong>
                    <span className="caption">
                      {h.count === 0
                        ? 'Not yet'
                        : h.count === 1
                          ? `Once, ${fmtDate(h.first?.at, true)}`
                          : `${h.count} times · first ${fmtDate(h.first?.at, true)}, latest ${fmtDate(h.latest?.at, true)}`}
                    </span>
                  </span>
                  {h.latest?.cards && h.latest.starter !== null && (
                    <span className="honour__cards"><HandCards cards={h.latest.cards} starter={h.latest.starter} width={24} /></span>
                  )}
                </li>
              ))}
            </ul>
          </Section>

          {s.recent.length > 0 && (
            <Section title="Recent games">
              <ul className="rows">
                {s.recent.map((r) => (
                  <li key={r.code}>
                    <button type="button" className={`game-row ${r.result === 'W' ? 'is-won' : 'is-lost'}`} onClick={() => navigate(`/replay/${r.code}`)}>
                      <span className={`form__chip form__chip--${r.result}`}>{r.result}</span>
                      <span className="game-row__main">
                        <span className="game-row__title">{r.result === 'W' ? 'Won' : 'Lost'} {r.score}–{r.opponentScore}</span>
                        <span className="game-row__detail">{r.players === 4 ? 'partners' : `${r.players} players`} · {fmtDate(r.finishedAt)}</span>
                      </span>
                      <SkunkTag level={r.skunk} />
                      <svg className="game-row__chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </button>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>
      )}
    </Shell>
  );
}
