// Replay: a finished game, one hand at a time. Who dealt; what everyone was
// dealt and kept; the crib and the starter; the pegging play by play with the
// running count and points; every counted hand with its breakdown; and the
// score after the hand on the real board. Clarity over animation.
import { type CSSProperties, useEffect, useMemo, useState } from 'react';
import type { Card } from '../../shared/cards';
import { type PlayerCount, type Seat, teamSeats } from '../../shared/game';
import type { HandRecord, HandsResponse, PegEntry, PlayerCard, ShowRecord } from '../../shared/league';
import { describeItem } from '../../shared/scoring';
import { CardView } from '../cards/CardView';
import { Board, type BoardLane } from '../game/Board';
import { showLines } from '../game/callouts';
import { teamsInOrder, toneOf, toneOfSeat } from '../game/seating';
import { api } from '../lib/api';
import { cardText } from '../lib/format';
import { navigate } from '../lib/router';
import { useApi, useSession } from '../lib/session';
import { Avatar } from '../ui/Avatar';
import { ErrorLine, HandCards, Loading, SkunkTag, Who, fmtDate } from '../ui/bits';
import { teamLines } from '../ui/games';
import { Shell } from '../ui/Shell';

const handFromUrl = () => {
  const n = Number(new URLSearchParams(location.search).get('hand'));
  return Number.isInteger(n) && n > 0 ? n : null;
};

interface Ctx {
  n: PlayerCount;
  seats: (PlayerCard | null)[];
  view: Seat;
  meId: string;
}
const nameOf = (c: Ctx, s: Seat) => (c.seats[s]?.id === c.meId ? 'You' : c.seats[s]?.name ?? `Seat ${s + 1}`);
const toneOfS = (c: Ctx, s: Seat) => toneOfSeat(c.n, c.view, s);

function TeamScore({ c, scores, before }: { c: Ctx; scores: number[]; before?: number[] }) {
  return (
    <p className="replay-score">
      {teamsInOrder(c.n, c.view).map((t) => {
        const gain = before ? scores[t] - before[t] : 0;
        return (
          <span key={t} className={`replay-score__team tone-${toneOf(c.n, c.view, t)}`}>
            <i aria-hidden="true" />
            {teamSeats(c.n, t).map((s) => nameOf(c, s)).join(' & ')} <b>{scores[t]}</b>
            {before && gain > 0 && <small>+{gain}</small>}
          </span>
        );
      })}
    </p>
  );
}

function Deal({ c, h }: { c: Ctx; h: HandRecord }) {
  return (
    <div className="deal-list">
      {Array.from({ length: c.n }, (_, s) => {
        const dealt = h.dealt[s];
        const gave = h.discards[s] ?? [];
        return (
          <div key={s} className={`deal-seat tone-${toneOfS(c, s)}`}>
            <p className="deal-seat__who">
              <Avatar player={c.seats[s]} size={22} />
              <strong>{nameOf(c, s)}</strong>
              {s === h.dealer && <span className="player__dealer" title="Dealer">D</span>}
              <span className="caption">{s === h.dealer ? 'dealt · their crib' : ''}</span>
            </p>
            {dealt ? (
              <div className="deal-seat__cards" style={{ '--w': '38px' } as CSSProperties}>
                {dealt.map((card) => (
                  <span key={card} className={`deal-card${gave.includes(card) ? ' is-gone' : ''}`}>
                    <CardView card={card} fluid label={`${cardText(card)}${gave.includes(card) ? ' (to the crib)' : ''}`} />
                  </span>
                ))}
              </div>
            ) : (
              <p className="caption">Hidden while the hand is played.</p>
            )}
            {dealt && gave.length > 0 && <p className="caption">Kept four; {gave.map(cardText).join(' ')} to the crib.</p>}
          </div>
        );
      })}
    </div>
  );
}

/** The pegging, split into counts (a 31 or a go starts the next). */
function Pegging({ c, peg, heels, dealer }: { c: Ctx; peg: PegEntry[]; heels: number; dealer: Seat }) {
  const runs: PegEntry[][] = [[]];
  for (const e of peg) {
    runs[runs.length - 1].push(e);
    const reset = (e.t === 'play' && e.count === 31) || e.t === 'point';
    if (reset) runs.push([]);
  }
  if (!runs[runs.length - 1].length) runs.pop();
  return (
    <div className="peg-log">
      {heels > 0 && <p className="peg-heels">His heels: {nameOf(c, dealer)} pegs 2 for the jack turned up.</p>}
      {runs.length === 0 && <p className="caption">No cards were played.</p>}
      {runs.map((run, i) => (
        <ol key={i} className="peg-run" aria-label={`Count ${i + 1}`}>
          {run.map((e, k) => {
            const tone = toneOfS(c, e.seat);
            if (e.t === 'play') {
              return (
                <li key={k} className={`peg-line tone-${tone}`}>
                  <span className="peg-line__card" style={{ '--w': '30px' } as CSSProperties}><CardView card={e.card} fluid /></span>
                  <span className="peg-line__who">{nameOf(c, e.seat)}</span>
                  <span className="peg-line__count">{e.count}</span>
                  <span className="peg-line__pts">
                    {e.items.length > 0 && <><span className="peg-line__what">{e.items.map(describeItem).join(', ')}</span></>}
                  </span>
                </li>
              );
            }
            if (e.t === 'go') {
              return (
                <li key={k} className={`peg-line peg-line--go tone-${tone}`}>
                  <span className="peg-line__card" />
                  <span className="peg-line__who">{nameOf(c, e.seat)}</span>
                  <span className="peg-line__count" />
                  <span className="peg-line__pts"><span className="peg-line__what muted">go</span></span>
                </li>
              );
            }
            return (
              <li key={k} className={`peg-line peg-line--point tone-${tone}`}>
                <span className="peg-line__card" />
                <span className="peg-line__who">{nameOf(c, e.seat)}</span>
                <span className="peg-line__count" />
                <span className="peg-line__pts"><span className="peg-line__what">{e.kind === 'go' ? 'One for the go' : 'One for last card'}</span></span>
              </li>
            );
          })}
        </ol>
      ))}
    </div>
  );
}

function Show({ c, s, starter }: { c: Ctx; s: ShowRecord; starter: Card | null }) {
  const lines = s.counted && s.cards ? showLines({ seat: s.seat, crib: s.crib, cards: s.cards, items: s.items, total: s.total ?? 0 }) : [];
  return (
    <div className={`show-rec tone-${toneOfS(c, s.seat)}${s.counted ? '' : ' is-uncounted'}`}>
      <p className="show-rec__head">
        <Avatar player={c.seats[s.seat]} size={22} />
        <strong>{nameOf(c, s.seat) === 'You' ? 'Your' : `${nameOf(c, s.seat)}’s`} {s.crib ? 'crib' : 'hand'}</strong>
        <b className="show-rec__total">{s.counted ? (s.total === 0 ? '0' : s.total) : '–'}</b>
      </p>
      {s.cards ? <HandCards cards={s.cards} starter={starter} width={38} /> : <p className="caption">Hidden.</p>}
      {s.counted ? (
        lines.length ? (
          <ol className="show-rec__lines">
            {lines.map((l, i) => (
              <li key={i}><span><strong>{l.name}</strong> {l.detail}</span><b>{l.running}</b></li>
            ))}
          </ol>
        ) : (
          <p className="show-rec__nineteen"><strong>Nineteen</strong> — not a single point.</p>
        )
      ) : (
        <p className="caption">Not counted: the game was already over.</p>
      )}
    </div>
  );
}

function HandView({ c, h, total }: { c: Ctx; h: HandRecord; total: number }) {
  return (
    <article className="hand-rec" aria-label={`Hand ${h.handNo}`}>
      <section className="replay-block">
        <h2 className="eyebrow">The deal · {nameOf(c, h.dealer) === 'You' ? 'you dealt' : `${nameOf(c, h.dealer)} dealt`}</h2>
        <Deal c={c} h={h} />
      </section>
      <section className="replay-block replay-block--row">
        <div>
          <h2 className="eyebrow">Starter</h2>
          {h.starter !== null ? (
            <div className="replay-starter" style={{ '--w': '52px' } as CSSProperties}>
              <CardView card={h.starter} fluid label={`Starter: ${cardText(h.starter)}`} />
            </div>
          ) : (
            <p className="caption">Not cut.</p>
          )}
        </div>
        <div>
          <h2 className="eyebrow">Crib · {nameOf(c, h.dealer) === 'You' ? 'yours' : `${nameOf(c, h.dealer)}’s`}</h2>
          {h.crib ? <HandCards cards={h.crib} width={40} /> : <p className="caption">Hidden.</p>}
          {c.n === 3 && h.deckToCrib !== null && <p className="caption">{cardText(h.deckToCrib)} came straight from the deck.</p>}
        </div>
      </section>
      <section className="replay-block">
        <h2 className="eyebrow">Pegging</h2>
        <Pegging c={c} peg={h.peg} heels={h.heels} dealer={h.dealer} />
      </section>
      <section className="replay-block">
        <h2 className="eyebrow">The show</h2>
        {h.shows.length === 0 ? (
          <p className="caption">{h.endedGame ? 'The game ended during the pegging, before anything was counted.' : 'Not counted yet.'}</p>
        ) : (
          <div className="shows">{h.shows.map((s, i) => <Show key={i} c={c} s={s} starter={h.starter} />)}</div>
        )}
      </section>
      {h.endedGame && <p className="replay-end">That was the last hand — hand {h.handNo} of {total}.</p>}
    </article>
  );
}

function ReplayBody({ d }: { d: HandsResponse }) {
  const { profile } = useSession();
  const hands = d.hands;
  const [i, setI] = useState(() => {
    const want = handFromUrl();
    const k = want === null ? -1 : hands.findIndex((h) => h.handNo === want);
    return k >= 0 ? k : 0;
  });
  useEffect(() => {
    const h = hands[i];
    if (h) history.replaceState(null, '', `/replay/${d.code}?hand=${h.handNo}`);
  }, [i, hands, d.code]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.('input,select,textarea')) return;
      if (e.key === 'ArrowLeft') setI((x) => Math.max(0, x - 1));
      if (e.key === 'ArrowRight') setI((x) => Math.min(hands.length - 1, x + 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hands.length]);

  const c: Ctx = { n: d.players, seats: d.seats, view: d.you ?? 0, meId: profile.id };
  const lanes: BoardLane[] = useMemo(() => {
    const order = teamsInOrder(d.players, d.you ?? 0);
    return [...order.slice(1), order[0]].map((team) => ({
      team, tone: toneOf(d.players, d.you ?? 0, team), name: teamSeats(d.players, team).map((s) => d.seats[s]?.name ?? '').join(' & '),
    }));
  }, [d]);
  const h = hands[i];
  const last = hands[hands.length - 1];
  const final = last?.scoresAfter ?? [];
  const winner = d.status === 'finished' && final.length ? final.indexOf(Math.max(...final)) : null;
  const tl = teamLines(d.players, d.seats, final, [], winner);

  if (!h) {
    return <p className="muted">No hands were recorded for this game{d.firstRecordedHand === null ? ' (it was played before hand records existed)' : ''}.</p>;
  }
  return (
    <>
      <header className="replay-head">
        <p className="eyebrow">Replay · {d.code}{last?.finishedAt ? ` · ${fmtDate(last.finishedAt, true)}` : ''}</p>
        <h1 className="replay-head__title">
          {tl.map((t, k) => (
            <span key={t.team} className="replay-head__team">
              {k > 0 && <span className="replay-head__v"> v </span>}
              {t.players.map((p) => (p?.id === profile.id ? 'You' : p?.name ?? '?')).join(' & ')} <b>{t.score}</b>
            </span>
          ))}
        </h1>
        <p className="replay-head__faces">
          {d.seats.map((p, s) => <Who key={s} player={p} size={24} you={p?.id === profile.id} />)}
          {d.status !== 'finished' && <span className="tag">in progress</span>}
          {winner !== null && <SkunkTag level={tl.slice(1).reduce((m, t) => Math.max(m, t.score < 61 ? 2 : t.score < 91 ? 1 : 0), 0)} />}
        </p>
        {d.firstRecordedHand !== null && d.firstRecordedHand > 1 && (
          <p className="caption">The record starts at hand {d.firstRecordedHand}: earlier hands were played before hand records existed.</p>
        )}
      </header>

      <div className="stepper">
        <button type="button" className="stepper__btn" onClick={() => setI((x) => Math.max(0, x - 1))} disabled={i === 0} aria-label="Previous hand">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
        </button>
        <div className="stepper__mid">
          <span><strong>Hand {h.handNo}</strong> <span className="muted">of {last.handNo}</span></span>
          <ol className="stepper__dots" aria-label="Hands">
            {hands.map((x, k) => (
              <li key={x.handNo}>
                <button
                  type="button"
                  aria-current={k === i ? 'step' : undefined}
                  aria-label={`Hand ${x.handNo}`}
                  className={`tone-${toneOfS(c, x.dealer)}`}
                  onClick={() => setI(k)}
                />
              </li>
            ))}
          </ol>
        </div>
        <button type="button" className="stepper__btn" onClick={() => setI((x) => Math.min(hands.length - 1, x + 1))} disabled={i === hands.length - 1} aria-label="Next hand">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>
        </button>
      </div>

      <div className="replay-grid">
        <div className="replay-board">
          <Board lanes={lanes} scores={h.scoresAfter} back={h.scoresBefore} finishLit={h.endedGame} />
          <TeamScore c={c} scores={h.scoresAfter} before={h.scoresBefore} />
          <p className="caption">Score after hand {h.handNo}; the back pegs show where it started.</p>
        </div>
        <HandView c={c} h={h} total={last.handNo} />
      </div>

      <div className="replay-foot">
        <button type="button" className="btn btn--quiet" onClick={() => { setI((x) => Math.max(0, x - 1)); window.scrollTo(0, 0); }} disabled={i === 0}>Previous hand</button>
        <button type="button" className="btn" onClick={() => { setI((x) => Math.min(hands.length - 1, x + 1)); window.scrollTo(0, 0); }} disabled={i === hands.length - 1}>Next hand</button>
      </div>
    </>
  );
}

export function Replay({ code }: { code: string }) {
  const d = useApi(`hands-${code}`, (t) => api.hands(t, code));
  return (
    <Shell tab="league">
      <button type="button" className="backlink" onClick={() => (history.length > 1 ? history.back() : navigate('/league'))}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg> Back
      </button>
      {d.error && <ErrorLine error={d.error.includes('in progress') ? 'This game is still being played — its replay opens when it finishes.' : d.error} retry={d.reload} />}
      {!d.data && !d.error && <Loading what="Laying out the hands" />}
      {d.data && <ReplayBody d={d.data} />}
    </Shell>
  );
}

