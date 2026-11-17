// League: the standings (any season, or all time), every game still being
// played and who it is waiting on, the whole queue, and recent results.
import { useEffect, useState } from 'react';
import type { SeasonFilter, StandingRow } from '../../shared/league';
import { api, errorMessage } from '../lib/api';
import { navigate, onLink } from '../lib/router';
import { useApi, useSession } from '../lib/session';
import { Avatar } from '../ui/Avatar';
import { Empty, ErrorLine, Form, Loading, PageHead, SeasonPicker, Section, ShareBox, pct, plural } from '../ui/bits';
import { FixtureRow, PendingRow, ResultRow } from '../ui/games';
import { Shell } from '../ui/Shell';
import { inviteUrl } from '../lib/router';

function Standings({ rows, meId }: { rows: StandingRow[]; meId: string }) {
  return (
    <div className="standings-wrap">
      <table className="standings">
        <thead>
          <tr>
            <th scope="col" className="st-rank"><span className="sr-only">Rank</span>#</th>
            <th scope="col" className="st-player">Player</th>
            <th scope="col" className="st-num" title="Played">P</th>
            <th scope="col" className="st-num" title="Won">W</th>
            <th scope="col" className="st-num" title="Lost">L</th>
            <th scope="col" className="st-num st-wide" title="Win rate">Win</th>
            <th scope="col" className="st-num st-wide" title="Skunks given / taken">Skunks</th>
            <th scope="col" className="st-num st-wide" title="Board points for minus against">+/−</th>
            <th scope="col" className="st-form st-wide">Last five</th>
            <th scope="col" className="st-pts" title="Match points">Pts</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const none = r.played === 0;
            const to = `/players/${r.player.id}`;
            return (
              <tr key={r.player.id} className={`${none ? 'is-unplayed' : ''}${r.player.id === meId ? ' is-me' : ''}`} onClick={() => navigate(to)}>
                <td className="st-rank">{none ? '–' : r.rank}</td>
                <th scope="row" className="st-player">
                  <a className="st-who" href={to} onClick={(e) => { e.stopPropagation(); onLink(e, to); }}>
                    <Avatar player={r.player} size={30} />
                    <span className="st-who__text">
                      <span className="st-who__name">{r.player.name}{r.player.id === meId && <span className="who__you"> (you)</span>}</span>
                      <span className="st-who__form"><Form chips={r.lastFive} /></span>
                    </span>
                  </a>
                </th>
                <td className="st-num">{r.played}</td>
                <td className="st-num">{r.won}</td>
                <td className="st-num">{r.lost}</td>
                <td className="st-num st-wide">{none ? '–' : pct(r.winRate)}</td>
                <td className="st-num st-wide">{r.skunksGiven}–{r.skunksTaken}</td>
                <td className="st-num st-wide">{none ? '–' : r.pointDifference > 0 ? `+${r.pointDifference}` : r.pointDifference}</td>
                <td className="st-form st-wide"><Form chips={r.lastFive} /></td>
                <td className="st-pts">{r.matchPoints}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function Invite() {
  const { token } = useSession();
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const make = async () => {
    setBusy(true);
    setError(null);
    try {
      const inv = await api.createInvite(token);
      setUrl(inviteUrl(inv.token));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="invite-box">
      {url ? (
        <ShareBox url={url} shareText="Join our cribbage league on Cabbage." qr>
          <p className="caption">Works once, for one new member, for seven days.</p>
        </ShareBox>
      ) : (
        <>
          <p className="muted">Members join by invitation. Make a link for one person and send it to them.</p>
          <button type="button" className="btn btn--quiet" onClick={make} disabled={busy}>{busy ? 'Making a link…' : 'Make an invite link'}</button>
        </>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
  );
}

const QUEUE_SHOWN = 8;
const RESULTS_SHOWN = 10;

export function League() {
  const { league, profile, isCommissioner, token } = useSession();
  const meId = profile.id;
  const [season, setSeason] = useState<SeasonFilter | null>(null);
  useEffect(() => {
    if (season === null && league) setSeason(league.season.id);
  }, [league, season]);
  const sKey = season === null ? null : String(season);
  const standings = useApi(sKey && `standings-${sKey}`, (t) => api.standings(t, season!));
  const results = useApi(sKey && `results-${sKey}`, (t) => api.results(t, { season: season! }));
  const pending = useApi('pending', (t) => api.pending(t));
  const fixtures = useApi('fixtures-open', (t) => api.fixtures(t, { status: 'open' }));
  const [allQueue, setAllQueue] = useState(false);
  const [moreResults, setMoreResults] = useState(false);
  const [starting, setStarting] = useState<string | null>(null);

  const pend = [...(pending.data?.games ?? [])].sort((a, b) =>
    a.status === b.status ? b.idleSeconds - a.idleSeconds : a.status === 'active' ? -1 : 1,
  );
  const queue = fixtures.data?.fixtures ?? [];
  const shownQueue = allQueue ? queue : queue.slice(0, QUEUE_SHOWN);
  const res = results.data?.games ?? [];
  const shownResults = moreResults ? res : res.slice(0, RESULTS_SHOWN);
  const seasonName = season === 'all' ? 'All time' : league?.seasons.find((s) => s.id === season)?.name ?? '';
  const holdups = pend.filter((g) => g.status === 'active' && g.idleSeconds >= 2 * 86400).length;

  const play = async (id: string) => {
    setStarting(id);
    try {
      const r = await api.startFixture(token, id);
      navigate(`/g/${r.code}`);
    } catch {
      setStarting(null);
      fixtures.reload();
    }
  };

  return (
    <Shell tab="league">
      <PageHead
        title="League"
        sub={league ? `${plural(league.members.filter((m) => m.active).length, 'member')} · ${league.season.name}` : undefined}
      >
        {isCommissioner && (
          <a className="link link--small" href="/commissioner" onClick={(e) => onLink(e, '/commissioner')}>Commissioner tools</a>
        )}
      </PageHead>

      <div className="league-grid">
        <div className="league-grid__main">
          <Section
            title="Standings"
            action={league && season !== null ? <SeasonPicker seasons={league.seasons} value={season} onChange={setSeason} /> : undefined}
          >
            {standings.error && <ErrorLine error={standings.error} retry={standings.reload} />}
            {!standings.data && !standings.error && <Loading what="Fetching the standings" />}
            {standings.data && (
              <div className={standings.loading ? 'is-refreshing' : undefined}>
                {standings.data.games === 0 ? (
                  <Empty title={season === 'all' ? 'No games yet' : 'No games this season yet'}>
                    The table fills in as games finish: 2 points for a win, 3 for a skunk, 4 for a double skunk.
                  </Empty>
                ) : (
                  <>
                    <Standings rows={standings.data.rows} meId={meId} />
                    <p className="caption standings__key">
                      {plural(standings.data.games, 'game')} counted. Points: 2 a win, 3 a skunk, 4 a double skunk. Tap anyone for their page.
                    </p>
                  </>
                )}
              </div>
            )}
          </Section>

          <Section title={seasonName ? `Results · ${seasonName}` : 'Results'}>
            {!results.data && !results.error && <Loading what="Fetching results" />}
            {results.error && <ErrorLine error={results.error} retry={results.reload} />}
            {results.data && res.length === 0 && <Empty small title="No finished games">Every finished game shows up here with its replay.</Empty>}
            {res.length > 0 && (
              <>
                <ul className="rows">{shownResults.map((g) => <ResultRow key={g.code} g={g} meId={meId} />)}</ul>
                {res.length > RESULTS_SHOWN && (
                  <button type="button" className="link" onClick={() => setMoreResults((v) => !v)}>
                    {moreResults ? 'Show fewer' : `Show all ${res.length}`}
                  </button>
                )}
              </>
            )}
          </Section>
        </div>

        <div className="league-grid__side">
          <Section title={pending.data ? `Being played · ${pend.length}` : 'Being played'} id="pending">
            {!pending.data && !pending.error && <Loading what="Checking the tables" />}
            {holdups > 0 && <p className="holdup-note">{holdups === 1 ? 'One game has' : `${holdups} games have`} sat for two days or more.</p>}
            {pending.error && <ErrorLine error={pending.error} retry={pending.reload} />}
            {pending.data && pend.length === 0 && <Empty small title="Nothing in progress">When games are under way you’ll see who each one is waiting on.</Empty>}
            {pend.length > 0 && <ul className="rows">{pend.map((g) => <PendingRow key={g.code} g={g} meId={meId} />)}</ul>}
          </Section>

          <Section title={fixtures.data ? `The queue · ${queue.length}` : 'The queue'} id="queue">
            {!fixtures.data && !fixtures.error && <Loading what="Fetching the queue" />}
            {fixtures.error && <ErrorLine error={fixtures.error} retry={fixtures.reload} />}
            {fixtures.data && queue.length === 0 && (
              <Empty small title="The queue is empty">Challenges and the commissioner’s round robin line up here, in the order they’ll be played.</Empty>
            )}
            {queue.length > 0 && (
              <>
                <ol className="rows fixtures">
                  {shownQueue.map((f) => (
                    <FixtureRow
                      key={f.id}
                      f={f}
                      n={queue.indexOf(f) + 1}
                      meId={meId}
                      action={
                        f.status === 'queued' && f.seats.some((p) => p.id === meId) ? (
                          <button type="button" className="btn btn--small" onClick={() => play(f.id)} disabled={starting !== null}>Play</button>
                        ) : undefined
                      }
                    />
                  ))}
                </ol>
                {queue.length > QUEUE_SHOWN && (
                  <button type="button" className="link" onClick={() => setAllQueue((v) => !v)}>
                    {allQueue ? 'Show fewer' : `Show all ${queue.length}`}
                  </button>
                )}
              </>
            )}
          </Section>

          <Section title="Invite someone">
            <Invite />
          </Section>
        </div>
      </div>
    </Shell>
  );
}
