// Stats: head-to-head between any two members (by default you and whoever you
// have played most): the record and its story over time, streaks, skunks,
// averages side by side, each player's best hand in real cards, and how they
// do as partners and as opponents in bigger games.
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import type { Averages, H2HSide, HeadToHead, PlayerCard, Season, SeasonFilter } from '../../shared/league';
import { api, errorMessage } from '../lib/api';
import { navigate, onLink } from '../lib/router';
import { useApi, useSession } from '../lib/session';
import { RecordChart } from '../stats/RecordChart';
import { Avatar } from '../ui/Avatar';
import { Empty, ErrorLine, HandCards, Loading, SeasonPicker, Section, SkunkTag, avg, fmtDate, plural } from '../ui/bits';
import { Shell } from '../ui/Shell';
import { pairColours } from '../lib/league-text';

export function StatsTabs({ active }: { active: 'h2h' | 'fame' }) {
  const tabs: [typeof active, string, string][] = [['h2h', '/stats', 'Head to head'], ['fame', '/fame', 'Hall of fame']];
  return (
    <nav className="subtabs" aria-label="Stats">
      {tabs.map(([k, to, label]) => (
        <a key={k} className="subtabs__tab" href={to} aria-current={active === k ? 'page' : undefined} onClick={(e) => onLink(e, to)}>{label}</a>
      ))}
    </nav>
  );
}

function PlayerSelect({ value, members, onChange, label, not }: { value: string; members: PlayerCard[]; onChange: (id: string) => void; label: string; not: string }) {
  const p = members.find((m) => m.id === value);
  return (
    <label className="h2h-pick">
      <span className="sr-only">{label}</span>
      <Avatar player={p} size={34} />
      <select className="h2h-pick__select" value={value} onChange={(e) => onChange(e.target.value)}>
        {members.map((m) => (
          <option key={m.id} value={m.id} disabled={m.id === not}>{m.name}{m.active ? '' : ' (left)'}</option>
        ))}
      </select>
      <svg className="picker__chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
    </label>
  );
}

function FactRow({ label, a, b, better }: { label: string; a: ReactNode; b: ReactNode; better?: 'a' | 'b' | null }) {
  return (
    <tr>
      <td className={better === 'a' ? 'is-better' : undefined}>{a}</td>
      <th scope="row">{label}</th>
      <td className={better === 'b' ? 'is-better' : undefined}>{b}</td>
    </tr>
  );
}
const cmp = (x: number, y: number, higherBetter = true): 'a' | 'b' | null =>
  x === y ? null : (x > y) === higherBetter ? 'a' : 'b';

/** Averages as a butterfly: a's bar grows left, b's right, on one scale per row. */
function AverageBars({ a, b, colours }: { a: Averages; b: Averages; colours: [string, string] }) {
  const rows: [string, number | null, number | null, string][] = [
    ['Hand', a.hand, b.hand, `${a.hands} / ${b.hands} hands`],
    ['Crib', a.crib, b.crib, `${a.cribs} / ${b.cribs} cribs`],
    ['Pegging', a.pegging, b.pegging, `${a.peggingHands} / ${b.peggingHands} hands`],
  ];
  return (
    <div className="bars">
      {rows.map(([label, x, y, n]) => {
        const max = Math.max(x ?? 0, y ?? 0, 1);
        return (
          <div key={label} className="bars__row">
            <span className="bars__val bars__val--a">{avg(x)}</span>
            <span className="bars__track bars__track--a"><span style={{ width: `${((x ?? 0) / max) * 100}%`, background: colours[0] }} /></span>
            <span className="bars__label">{label}<small>{n}</small></span>
            <span className="bars__track bars__track--b"><span style={{ width: `${((y ?? 0) / max) * 100}%`, background: colours[1] }} /></span>
            <span className="bars__val bars__val--b">{avg(y)}</span>
          </div>
        );
      })}
    </div>
  );
}

function BestHand({ side, colour }: { side: H2HSide; colour: string }) {
  const h = side.bestHand;
  return (
    <div className="best" style={{ ['--tone' as string]: colour }}>
      <p className="best__who"><Avatar player={side.player} size={22} /> {side.player.name}</p>
      {h ? (
        <>
          <HandCards cards={h.cards} starter={h.starter} width={42} />
          <p className="best__meta">
            <b className="best__pts">{h.points}</b> {h.crib ? 'in the crib' : 'in hand'} · {fmtDate(h.at)} ·{' '}
            <a href={`/replay/${h.code}?hand=${h.handNo}`} onClick={(e) => onLink(e, `/replay/${h.code}?hand=${h.handNo}`)}>replay</a>
          </p>
        </>
      ) : (
        <p className="muted">No counted hands yet.</p>
      )}
    </div>
  );
}

function H2HBody({ d, seasons, onChallenge, challengeNote }: { d: HeadToHead; seasons: Season[]; onChallenge?: () => void; challengeNote: string | null }) {
  const { a, b } = d;
  const colours = pairColours(a.player, b.player);
  const [sel, setSel] = useState(d.timeline.length - 1);
  useEffect(() => setSel(d.timeline.length - 1), [d]);
  const game = d.timeline[sel];
  const nothing = d.played === 0 && d.partners.played === 0 && d.opponents.played === 0;
  if (nothing) {
    return (
      <Empty title={`${a.player.name} and ${b.player.name} haven’t met yet`} action={onChallenge && <button type="button" className="btn" onClick={onChallenge}>Challenge {b.player.name}</button>}>
        {d.season ? `Not in ${d.season.name}, anyway. ` : ''}Once they play, their record, its story over time and their best hands appear here.
        {challengeNote && <><br /><strong>{challengeNote}</strong></>}
      </Empty>
    );
  }
  const holder = a.currentStreak > 0 ? a : b.currentStreak > 0 ? b : null;
  return (
    <>
      <section className="scoreline panel" aria-label="Record">
        {([a, b] as const).map((s, k) => (
          <a key={s.player.id} className={`scoreline__side scoreline__side--${k ? 'b' : 'a'}`} href={`/players/${s.player.id}`} onClick={(e) => onLink(e, `/players/${s.player.id}`)}>
            <Avatar player={s.player} size={56} />
            <span className="scoreline__name">{s.player.name}</span>
          </a>
        ))}
        <p className="scoreline__score">
          <b style={{ color: colours[0] }}>{a.won}</b>
          <span className="scoreline__dash">–</span>
          <b style={{ color: colours[1] }}>{b.won}</b>
        </p>
        <p className="scoreline__sub">
          {d.played ? `${plural(d.played, 'game')} head to head` : 'No two-player games yet'}
          {holder && ` · ${holder.player.name} on ${plural(holder.currentStreak, 'win')} in a row`}
        </p>
      </section>

      {d.played > 0 && (
        <Section title="The record over time">
          <div className="panel-plain chart-box">
            <div className="chart-legend">
              {([a, b] as const).map((s, k) => (
                <span key={s.player.id} className="chart-legend__item"><i style={{ background: colours[k] }} />{s.player.name}’s wins</span>
              ))}
              <span className="chart-legend__item chart-legend__item--skunk"><i /> skunk</span>
            </div>
            <RecordChart
              games={d.timeline}
              ids={[a.player.id, b.player.id]}
              names={[a.player.name, b.player.name]}
              colours={colours}
              seasons={seasons}
              selected={sel}
              onSelect={setSel}
            />
            {game && (
              <div className="chart-pick">
                <span className="chart-pick__text">
                  <strong>Game {sel + 1}</strong> · {fmtDate(game.finishedAt, true)} · {a.player.name} {game.scores[0]}–{game.scores[1]} {b.player.name}
                  {' · '}{game.winner === a.player.id ? a.player.name : b.player.name} won
                  {' '}<SkunkTag level={game.skunk} />
                </span>
                <button type="button" className="btn btn--small btn--quiet" onClick={() => navigate(`/replay/${game.code}`)}>Replay</button>
              </div>
            )}
            <p className="caption chart-hint">Tap or drag along the chart to pick a game.</p>
          </div>
        </Section>
      )}

      <div className="duo">
      {d.played > 0 && (
        <Section title="Side by side">
          <table className="facts">
            <thead>
              <tr>
                <th scope="col" style={{ color: colours[0] }}>{a.player.name}</th>
                <th scope="col"><span className="sr-only">Statistic</span></th>
                <th scope="col" style={{ color: colours[1] }}>{b.player.name}</th>
              </tr>
            </thead>
            <tbody>
              <FactRow label="Wins" a={a.won} b={b.won} better={cmp(a.won, b.won)} />
              <FactRow label="Match points" a={a.matchPoints} b={b.matchPoints} better={cmp(a.matchPoints, b.matchPoints)} />
              <FactRow label="Winning streak now" a={a.currentStreak || '–'} b={b.currentStreak || '–'} better={cmp(a.currentStreak, b.currentStreak)} />
              <FactRow label="Longest streak" a={a.longestStreak} b={b.longestStreak} better={cmp(a.longestStreak, b.longestStreak)} />
              <FactRow label="Skunks given" a={a.skunksGiven} b={b.skunksGiven} better={cmp(a.skunksGiven, b.skunksGiven)} />
              <FactRow label="Skunks taken" a={a.skunksTaken} b={b.skunksTaken} better={cmp(a.skunksTaken, b.skunksTaken, false)} />
              <FactRow label="Double skunks given" a={a.doubleSkunksGiven} b={b.doubleSkunksGiven} better={cmp(a.doubleSkunksGiven, b.doubleSkunksGiven)} />
              <FactRow label="Board points" a={a.pointsFor} b={b.pointsFor} better={cmp(a.pointsFor, b.pointsFor)} />
            </tbody>
          </table>
        </Section>
      )}

      {d.played > 0 && (
        <Section title="Averages per hand, in these games">
          <AverageBars a={a.averages} b={b.averages} colours={colours} />
        </Section>
      )}

      </div>
      {d.played > 0 && (
        <Section title="Best hands against each other">
          <div className="best-pair">
            <BestHand side={a} colour={colours[0]} />
            <BestHand side={b} colour={colours[1]} />
          </div>
        </Section>
      )}

      <Section title="In bigger games">
        <div className="group-cards">
          <div className="group-card">
            <p className="group-card__title">As partners</p>
            {d.partners.played ? (
              <>
                <p className="group-card__big"><b>{d.partners.won}</b>–<b>{d.partners.lost}</b></p>
                <p className="caption">Won {d.partners.won} of {plural(d.partners.played, 'four-player game')} on the same side.</p>
              </>
            ) : (
              <p className="caption">Never partnered in a four-player game.</p>
            )}
          </div>
          <div className="group-card">
            <p className="group-card__title">As opponents</p>
            {d.opponents.played ? (
              <>
                <p className="group-card__big">
                  <b style={{ color: colours[0] }}>{d.opponents.aAhead}</b>–<b style={{ color: colours[1] }}>{d.opponents.bAhead}</b>
                </p>
                <p className="caption">
                  Who finished ahead, over {plural(d.opponents.played, 'game')}
                  {' '}({d.opponents.threePlayer} three-player, {d.opponents.fourPlayer} four-player). Wins: {a.player.name} {d.opponents.aWon},
                  {' '}{b.player.name} {d.opponents.bWon}{d.opponents.neitherWon ? `, someone else ${d.opponents.neitherWon}` : ''}.
                </p>
              </>
            ) : (
              <p className="caption">Never on opposite sides of a three- or four-player game.</p>
            )}
          </div>
        </div>
      </Section>
      {d.played === 0 && onChallenge && (
        <div className="center-row">
          <button type="button" className="btn" onClick={onChallenge}>Challenge {b.player.name} head to head</button>
          {challengeNote && <p className="ok-note">{challengeNote}</p>}
        </div>
      )}
    </>
  );
}

export function HeadToHeadScreen({ a, b }: { a?: string; b?: string }) {
  const { league, profile, token } = useSession();
  const meId = profile.id;
  const [season, setSeason] = useState<SeasonFilter>('all');
  const [note, setNote] = useState<string | null>(null);
  // Without a pair in the URL: you and the member you've played most.
  const mine = useApi(a && b ? null : 'results-mine-all', (t) => api.results(t, { season: 'all', player: meId }));
  const members = useMemo(() => {
    const ms = league?.members ?? [];
    return [...ms].sort((x, y) => Number(y.active) - Number(x.active) || x.name.localeCompare(y.name));
  }, [league]);
  const defaultB = useMemo(() => {
    if (a && b) return null;
    if (!mine.data || !league) return null;
    const count = new Map<string, number>();
    for (const g of mine.data.games) {
      if (g.voided) continue;
      for (const p of g.seats) if (p.id !== meId) count.set(p.id, (count.get(p.id) ?? 0) + (g.players === 2 ? 10 : 1));
    }
    const best = [...count.entries()].sort((x, y) => y[1] - x[1])[0]?.[0];
    return best ?? league.members.find((m) => m.active && m.id !== meId)?.id ?? '';
  }, [a, b, mine.data, league, meId]);
  const pa = a ?? meId;
  const pb = b ?? defaultB;
  const ready = pb !== null && pb !== '' && pa !== pb;
  const d = useApi(ready ? `h2h-${pa}-${pb}-${season}` : null, (t) => api.h2h(t, pa, pb!, season));

  const go = (x: string, y: string) => navigate(`/stats/${x}/${y}`, true);
  const challenge = pa === meId && pb ? async () => {
    try {
      await api.challenge(token, { opponents: [pb] });
      setNote('Added to your queue.');
    } catch (e) {
      setNote(errorMessage(e));
    }
  } : undefined;

  return (
    <Shell tab="stats">
      <StatsTabs active="h2h" />
      {league && pb === '' && (
        <Empty title="Head to head needs two members">Invite someone to the league; once you’ve played, your record together shows up here.</Empty>
      )}
      {league && ready && (
        <div className="h2h-controls">
          <div className="h2h-picks">
            <PlayerSelect value={pa} members={members} not={pb!} label="First player" onChange={(id) => go(id, pb!)} />
            <button type="button" className="swap" onClick={() => go(pb!, pa)} aria-label="Swap the two players">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7h11l-3-3M17 17H6l3 3" /></svg>
            </button>
            <PlayerSelect value={pb!} members={members} not={pa} label="Second player" onChange={(id) => go(pa, id)} />
          </div>
          <SeasonPicker seasons={league.seasons} value={season} onChange={setSeason} />
        </div>
      )}
      {(mine.error || d.error) && <ErrorLine error={(mine.error ?? d.error)!} retry={() => { mine.reload(); d.reload(); }} />}
      {!d.data && !d.error && ready && <Loading what="Totting up" />}
      {(!league || (pb === null && !mine.error)) && <Loading what="Totting up" />}
      {d.data && ready && (
        <div className={`stack${d.loading ? ' is-refreshing' : ''}`}>
          <H2HBody d={d.data} seasons={league?.seasons ?? []} onChallenge={challenge} challengeNote={note} />
        </div>
      )}
    </Shell>
  );
}

