// The commissioner's tools (only the commissioner sees them): end the season
// and start the next, generate the round robin, void or restore a game,
// deactivate or reactivate a member, hand the role on. Anything that changes
// the league asks first.
import { type ReactNode, useState } from 'react';
import { MAX_SEASON_NAME, MAX_VOID_REASON, type GameResult, type PlayerCard, type RoundRobinResponse, type SeasonFilter } from '../../shared/league';
import { api, errorMessage } from '../lib/api';
import { navigate } from '../lib/router';
import { useApi, useSession } from '../lib/session';
import { Avatar } from '../ui/Avatar';
import { Confirm, Empty, ErrorLine, Loading, PageHead, SeasonPicker, Section, fmtDate, plural } from '../ui/bits';
import { FixtureRow, ResultRow } from '../ui/games';
import { Shell } from '../ui/Shell';

type Pending =
  | { kind: 'season'; name: string }
  | { kind: 'rr'; times: number }
  | { kind: 'void'; game: GameResult; reason: string }
  | { kind: 'unvoid'; game: GameResult }
  | { kind: 'deactivate'; p: PlayerCard }
  | { kind: 'reactivate'; p: PlayerCard }
  | { kind: 'handover'; p: PlayerCard };

export function Commissioner() {
  const { league, isCommissioner, token, profile, refreshLeague } = useSession();
  const [seasonName, setSeasonName] = useState('');
  const [times, setTimes] = useState(1);
  const [ask, setAsk] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [rr, setRr] = useState<RoundRobinResponse | null>(null);
  const [gameSeason, setGameSeason] = useState<SeasonFilter | null>(null);
  const gs = gameSeason ?? league?.season.id ?? null;
  const results = useApi(gs === null ? null : `comm-results-${gs}`, (t) => api.results(t, { season: gs! }));
  const [voidFor, setVoidFor] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [allGames, setAllGames] = useState(false);

  if (league && !isCommissioner) {
    return (
      <Shell tab="me">
        <Empty title="Only the commissioner sees these tools">
          {league.commissioner ? `${league.commissioner.name} is the league’s commissioner.` : 'The league has no commissioner.'}
        </Empty>
      </Shell>
    );
  }

  const run = async () => {
    if (!ask) return;
    setBusy(true);
    setError(null);
    try {
      switch (ask.kind) {
        case 'season': {
          const s = await api.newSeason(token, ask.name);
          setDone(`${s.name} has begun. Queued fixtures carried over into it.`);
          setSeasonName('');
          setGameSeason(null);
          break;
        }
        case 'rr': {
          const r = await api.roundRobin(token, ask.times);
          setRr(r);
          setDone(null);
          break;
        }
        case 'void':
          await api.voidGame(token, ask.game.code, ask.reason.trim());
          setDone(`Game ${ask.game.code} is void: it no longer counts anywhere.`);
          setVoidFor(null);
          setReason('');
          break;
        case 'unvoid':
          await api.unvoidGame(token, ask.game.code);
          setDone(`Game ${ask.game.code} counts again.`);
          break;
        case 'deactivate':
          await api.deactivate(token, ask.p.id);
          setDone(`${ask.p.name} is deactivated. Their history stays; their queued fixtures were cancelled.`);
          break;
        case 'reactivate':
          await api.reactivate(token, ask.p.id);
          setDone(`${ask.p.name} is back in the league.`);
          break;
        case 'handover':
          await api.handover(token, ask.p.id);
          setDone(null);
          refreshLeague();
          navigate('/league');
          return;
      }
      refreshLeague();
      results.reload();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
      setAsk(null);
    }
  };

  let confirm: { title: string; body: ReactNode; label: string; danger?: boolean } | null = null;
  if (ask) {
    switch (ask.kind) {
      case 'season':
        confirm = {
          title: `End ${league?.season.name ?? 'this season'}?`,
          body: <>The standings for {league?.season.name} are final from now on, and <strong>{ask.name}</strong> starts with everyone on zero. Queued fixtures move into the new season.</>,
          label: 'End it and start the new season',
          danger: true,
        };
        break;
      case 'rr':
        confirm = {
          title: 'Generate the round robin?',
          body: <>Every pair of active members gets {ask.times === 1 ? 'a two-player fixture' : `${ask.times} two-player fixtures`} in the queue, in rounds. Pairs that already have one waiting are skipped.</>,
          label: 'Generate',
        };
        break;
      case 'void':
        confirm = {
          title: `Void game ${ask.game.code}?`,
          body: <>It stops counting in every standing and statistic (you can restore it later).{ask.reason.trim() && <> Reason: “{ask.reason.trim()}”.</>}</>,
          label: 'Void the game',
          danger: true,
        };
        break;
      case 'unvoid':
        confirm = { title: `Restore game ${ask.game.code}?`, body: 'It will count again in the standings and statistics.', label: 'Restore it' };
        break;
      case 'deactivate':
        confirm = {
          title: `Deactivate ${ask.p.name}?`,
          body: <>They’re signed out everywhere and can’t play; their queued fixtures are cancelled. Their history stays in the record, and you can reactivate them.</>,
          label: 'Deactivate',
          danger: true,
        };
        break;
      case 'reactivate':
        confirm = { title: `Reactivate ${ask.p.name}?`, body: 'They can sign in and play again.', label: 'Reactivate' };
        break;
      case 'handover':
        confirm = {
          title: `Make ${ask.p.name} the commissioner?`,
          body: <>You’ll lose these tools straight away — only {ask.p.name} can hand the role back.</>,
          label: `Hand over to ${ask.p.name}`,
          danger: true,
        };
        break;
    }
  }

  const members = league?.members ?? [];
  const games = results.data?.games ?? [];
  return (
    <Shell tab="me">
      <PageHead title="Commissioner" sub="Look after the league. Every change here is seen by everyone." />
      {!league && <Loading />}
      {done && <p className="ok-banner" role="status">{done}</p>}
      {error && <ErrorLine error={error} />}

      {league && (
        <div className="profile-grid">
          <div>
            <Section title="Season">
              <div className="comm-card">
                <p><strong>{league.season.name}</strong> <span className="muted">since {fmtDate(league.season.startedAt, true)}</span></p>
                <p className="caption">{plural(league.seasons.length, 'season')} so far. Ending this one freezes its standings.</p>
                <form
                  className="inline-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (seasonName.trim()) setAsk({ kind: 'season', name: seasonName.trim() });
                  }}
                >
                  <label htmlFor="season-name" className="sr-only">New season’s name</label>
                  <input id="season-name" className="input" value={seasonName} onChange={(e) => setSeasonName(e.target.value)} maxLength={MAX_SEASON_NAME} placeholder="Next season, e.g. Winter league" />
                  <button type="submit" className="btn btn--danger" disabled={!seasonName.trim()}>End season</button>
                </form>
              </div>
            </Section>

            <Section title="Round robin">
              <div className="comm-card">
                <p className="muted">Fill the queue so every active member plays every other, two-player, in rounds.</p>
                <div className="inline-form">
                  <div className="segmented segmented--start" role="radiogroup" aria-label="Times each pair meets">
                    {[1, 2, 3].map((t) => (
                      <button key={t} type="button" role="radio" aria-checked={times === t} className="segmented__opt" onClick={() => setTimes(t)}>
                        {t === 1 ? 'Once' : t === 2 ? 'Twice' : 'Three times'}
                      </button>
                    ))}
                  </div>
                  <button type="button" className="btn" onClick={() => setAsk({ kind: 'rr', times })}>Generate</button>
                </div>
                {rr && (
                  <div className="rr-result">
                    <p className="ok-note">
                      Added {plural(rr.created.length, 'fixture')} to the queue{rr.skippedPairs ? `; skipped ${plural(rr.skippedPairs, 'pair')} who already had one waiting` : ''}.
                    </p>
                    {rr.created.length > 0 && (
                      <ol className="rows fixtures">
                        {rr.created.map((f, i) => <FixtureRow key={f.id} f={f} n={i + 1} meId={profile.id} />)}
                      </ol>
                    )}
                  </div>
                )}
              </div>
            </Section>

            <Section title="Members">
              <ul className="rows">
                {members.map((p) => (
                  <li key={p.id} className={`member-row${p.active ? '' : ' is-gone'}`}>
                    <Avatar player={p} size={32} />
                    <span className="member-row__main">
                      <strong>{p.name}{p.id === profile.id && <span className="who__you"> (you)</span>}</strong>
                      <span className="caption">{p.commissioner ? 'Commissioner' : p.active ? 'Member' : 'Deactivated'}</span>
                    </span>
                    {p.id !== profile.id && (
                      <span className="member-row__actions">
                        {p.active ? (
                          <>
                            <button type="button" className="btn btn--small btn--quiet" onClick={() => setAsk({ kind: 'handover', p })}>Make commissioner</button>
                            <button type="button" className="btn btn--small btn--quiet btn--warn" onClick={() => setAsk({ kind: 'deactivate', p })}>Deactivate</button>
                          </>
                        ) : (
                          <button type="button" className="btn btn--small btn--quiet" onClick={() => setAsk({ kind: 'reactivate', p })}>Reactivate</button>
                        )}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </Section>
          </div>

          <div>
            <Section title="Void or restore a game" action={gs !== null ? <SeasonPicker seasons={league.seasons} value={gs} onChange={setGameSeason} /> : undefined}>
              <p className="caption comm-lede">A void game stays in the record but counts for nothing. A fixture’s game that’s voided goes back in the queue.</p>
              {results.error && <ErrorLine error={results.error} retry={results.reload} />}
              {results.data && games.length === 0 && <Empty small title="No finished games in this season" />}
              <ul className="rows">
                {(allGames ? games : games.slice(0, 10)).map((g) => (
                  <ResultRow
                    key={g.code}
                    g={g}
                    meId={profile.id}
                    action={
                      <div className="void-actions">
                        {g.voided ? (
                          <button type="button" className="btn btn--small btn--quiet" onClick={() => setAsk({ kind: 'unvoid', game: g })}>Restore</button>
                        ) : voidFor === g.code ? (
                          <form
                            className="inline-form inline-form--small"
                            onSubmit={(e) => {
                              e.preventDefault();
                              setAsk({ kind: 'void', game: g, reason });
                            }}
                          >
                            <label htmlFor={`reason-${g.code}`} className="sr-only">Reason</label>
                            <input id={`reason-${g.code}`} className="input input--small" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={MAX_VOID_REASON} placeholder="Reason (everyone sees it)" autoFocus />
                            <button type="submit" className="btn btn--small btn--danger">Void</button>
                            <button type="button" className="link link--small" onClick={() => setVoidFor(null)}>Cancel</button>
                          </form>
                        ) : (
                          <button type="button" className="btn btn--small btn--quiet btn--warn" onClick={() => { setVoidFor(g.code); setReason(''); }}>Void…</button>
                        )}
                      </div>
                    }
                  />
                ))}
              </ul>
              {games.length > 10 && (
                <button type="button" className="link" onClick={() => setAllGames((v) => !v)}>{allGames ? 'Show fewer' : `Show all ${games.length}`}</button>
              )}
            </Section>
          </div>
        </div>
      )}

      {confirm && (
        <Confirm title={confirm.title} confirm={confirm.label} danger={confirm.danger} busy={busy} onCancel={() => setAsk(null)} onConfirm={run}>
          {confirm.body}
        </Confirm>
      )}
    </Shell>
  );
}
