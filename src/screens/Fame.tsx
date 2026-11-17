// The hall of fame: who holds a 29, a 28, a nineteen, a double skunk, who got
// the kiwi; the best hands ever counted; the longest winning streaks.
import { useState } from 'react';
import type { SeasonFilter } from '../../shared/league';
import { api } from '../lib/api';
import { onLink } from '../lib/router';
import { useApi, useSession } from '../lib/session';
import { HONOUR_INFO, Medal } from '../stats/honours';
import { Avatar } from '../ui/Avatar';
import { Empty, ErrorLine, HandCards, Loading, SeasonPicker, Section, Who, fmtDate, plural } from '../ui/bits';
import { Shell } from '../ui/Shell';
import { StatsTabs } from './HeadToHead';

export function Fame() {
  const { league } = useSession();
  const [season, setSeason] = useState<SeasonFilter>('all');
  const hof = useApi(`fame-${season}`, (t) => api.hallOfFame(t, season));
  const h = hof.data;
  const nothing = h && h.bestHands.length === 0 && h.longestStreaks.length === 0;
  return (
    <Shell tab="stats">
      <StatsTabs active="fame" />
      <div className="h2h-controls">
        <p className="fame-lede">The league’s honours roll{h?.season ? `, ${h.season.name}` : ', all time'}.</p>
        {league && <SeasonPicker seasons={league.seasons} value={season} onChange={setSeason} />}
      </div>
      {hof.error && <ErrorLine error={hof.error} retry={hof.reload} />}
      {!h && !hof.error && <Loading what="Polishing the trophies" />}
      {nothing && (
        <Empty title="The hall is empty — for now">
          The first 29, the first nineteen, the first skunk: they’ll all be written up here, with the date and the cards.
        </Empty>
      )}
      {h && !nothing && (
        <div className={`stack${hof.loading ? ' is-refreshing' : ''}`}>
          <ul className="fame-grid">
            {h.honours.map((x) => (
              <li key={x.kind} className={`fame-card${x.holders.length ? '' : ' is-none'}`}>
                <div className="fame-card__head">
                  <Medal kind={x.kind} size={48} />
                  <div>
                    <h3 className="fame-card__title">{HONOUR_INFO[x.kind].title}</h3>
                    <p className="caption">{HONOUR_INFO[x.kind].line}</p>
                  </div>
                </div>
                {x.holders.length === 0 ? (
                  <p className="fame-card__empty">{HONOUR_INFO[x.kind].empty}</p>
                ) : (
                  <ol className="holders">
                    {x.holders.map((hd) => (
                      <li key={hd.player.id}>
                        <Who player={hd.player} size={26} />
                        <span className="holders__count">{hd.count > 1 ? `×${hd.count}` : ''}</span>
                        <a className="holders__when" href={`/replay/${hd.latest.code}${hd.latest.handNo ? `?hand=${hd.latest.handNo}` : ''}`} onClick={(e) => onLink(e, `/replay/${hd.latest.code}${hd.latest.handNo ? `?hand=${hd.latest.handNo}` : ''}`)}>
                          {fmtDate(hd.latest.at)}
                        </a>
                      </li>
                    ))}
                  </ol>
                )}
                {x.holders[0]?.latest.cards && x.holders[0].latest.starter !== null && (x.kind === 'twenty-nine' || x.kind === 'twenty-eight') && (
                  <div className="fame-card__cards"><HandCards cards={x.holders[0].latest.cards} starter={x.holders[0].latest.starter} width={34} /></div>
                )}
              </li>
            ))}
          </ul>

          <div className="fame-cols">
            <Section title="Best hands">
              {h.bestHands.length === 0 ? (
                <Empty small title="No hands counted yet" />
              ) : (
                <ol className="tophands">
                  {h.bestHands.map((b, i) => (
                    <li key={`${b.hand.code}-${b.hand.handNo}-${b.player.id}`}>
                      <span className="tophands__n">{i + 1}</span>
                      <span className="tophands__pts">{b.hand.points}</span>
                      <span className="tophands__main">
                        <HandCards cards={b.hand.cards} starter={b.hand.starter} width={30} />
                        <span className="tophands__who">
                          <Avatar player={b.player} size={20} /> {b.player.name} ·{' '}
                          <a href={`/replay/${b.hand.code}?hand=${b.hand.handNo}`} onClick={(e) => onLink(e, `/replay/${b.hand.code}?hand=${b.hand.handNo}`)}>{fmtDate(b.hand.at)}</a>
                        </span>
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </Section>

            <Section title="Longest winning streaks">
              {h.longestStreaks.length === 0 ? (
                <Empty small title="No streaks yet" />
              ) : (
                <ol className="streaks">
                  {h.longestStreaks.map((s, i) => (
                    <li key={s.player.id}>
                      <span className="tophands__n">{i + 1}</span>
                      <Who player={s.player} size={26} />
                      <span className="streaks__bar"><span style={{ width: `${(s.length / h.longestStreaks[0].length) * 100}%` }} /></span>
                      <b className="streaks__len">{plural(s.length, 'win')}</b>
                    </li>
                  ))}
                </ol>
              )}
            </Section>
          </div>
        </div>
      )}
    </Shell>
  );
}
