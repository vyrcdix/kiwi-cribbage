// What sits on the table top: the top row (deck and starter left, crib right) and the
// stage in the middle, which is the only thing that changes with the phase.
import { type CSSProperties, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Card } from '../../shared/cards';
import type { Play, PlayerView, Seat, SeatStats } from '../../shared/game';
import { Trophy } from '../brand/Mark';
import { type CardState, CardView } from '../cards/CardView';
import { cardText } from '../lib/format';
import type { ShowLine } from './callouts';
import { CSS_EASE, DUR, appear, flyFrom, reducedMotion, rememberRect, takeRect } from './motion';
import type { PegDisplay } from './pegging';
import { toneOfSeat } from './seating';

// ---------- top row ----------

export function TopRow({
  deckAway, starter, starterAway, cribCount, cribLabel, lit,
}: {
  deckAway: boolean;
  starter: Card | null;
  starterAway: boolean;
  cribCount: number;
  cribLabel: string;
  lit: Card[];
}) {
  return (
    <div className="toprow">
      <div className="toprow__group">
        <div className="toprow__cards">
          {deckAway ? <div className="slot slot--small" data-zone="deck" /> : <span data-zone="deck"><CardView card={null} fluid label="The deck" /></span>}
          {starter !== null && !starterAway && (
            <CardView card={starter} fluid state={lit.includes(starter) ? 'lit' : ''} label={`Starter: ${cardText(starter)}`} />
          )}
          {starter !== null && starterAway && <div className="slot slot--small" />}
        </div>
        <span>{starter !== null ? 'Deck · starter' : 'Deck'}</span>
      </div>
      <div className="toprow__group toprow__group--end">
        <div className="toprow__cards toprow__cards--pile" data-zone="crib" aria-label={`${cribLabel}: ${cribCount} cards`}>
          {cribCount === 0 ? <div className="slot slot--small" /> : Array.from({ length: Math.min(4, cribCount) }, (_, i) => <CardView key={i} card={null} fluid decorative />)}
        </div>
        <span>{cribCount > 0 && cribCount < 4 ? `${cribLabel} · ${cribCount} of 4` : cribLabel}</span>
      </div>
    </div>
  );
}

// ---------- deal ----------

/** Your discards land in the dashed slots, turn face down, then slide to the crib. */
export function DealStage({
  slots, sent, note, onSlotsReady,
}: {
  slots: number;
  /** Cards you have just sent, still on their way to the crib. */
  sent: { cards: Card[]; down: boolean } | null;
  note: string | null;
  onSlotsReady?: (els: HTMLElement[]) => void;
}) {
  const refs = useRef<(HTMLDivElement | null)[]>([]);
  useLayoutEffect(() => {
    if (!sent) return;
    refs.current.forEach((el, i) => {
      const c = sent.cards[i];
      const from = c !== undefined ? takeRect(`disc:${c}`) : undefined;
      const card = el?.firstElementChild as HTMLElement | null;
      if (card && from) flyFrom(card, from, { duration: 180 });
    });
    onSlotsReady?.(refs.current.filter(Boolean) as HTMLElement[]);
    // Only when a new send lands in the slots.
  }, [sent?.cards.join(',')]);
  return (
    <>
      <div className="stage__row">
        {Array.from({ length: slots }, (_, i) => {
          const c = sent?.cards[i];
          return (
            <div key={i} className="slot" ref={(el) => { refs.current[i] = el; }}>
              {c !== undefined && (
                <CardView key={sent!.down ? 'down' : 'up'} card={sent!.down ? null : c} fluid className={sent!.down ? 'is-flipping' : undefined} decorative />
              )}
            </div>
          );
        })}
      </div>
      <p className="caption">{slots === 2 ? 'Your two land here, then slide to the crib' : 'Your card lands here, then slides to the crib'}</p>
      {note && <p className="caption caption--note">{note}</p>}
    </>
  );
}

// ---------- cut ----------

export function CutStage({
  canCut, revealed, starter, lit, onCut,
}: {
  canCut: boolean;
  revealed: boolean;
  starter: Card | null;
  lit: boolean;
  onCut: () => void;
}) {
  const [lifting, setLifting] = useState(false);
  const lifted = lifting || revealed;
  const deck = (
    <span className="cut__deck">
      <CardView card={null} fluid decorative />
      <span className={`cut__lifted${lifted ? ' is-lifted' : ''}`}><CardView card={null} fluid decorative /></span>
      {revealed && starter !== null && (
        <span className="cut__starter"><CardView card={starter} fluid state={lit ? 'lit' : ''} label={`Starter: ${cardText(starter)}`} /></span>
      )}
    </span>
  );
  return (
    <>
      <div className="cut">
        {canCut && !revealed ? (
          <button
            type="button"
            className="cut__button"
            aria-label="Cut the deck"
            onClick={() => {
              setLifting(true);
              onCut();
            }}
          >
            {deck}
          </button>
        ) : (
          deck
        )}
      </div>
      <p className="eyebrow">Starter</p>
    </>
  );
}

// ---------- pegging ----------

function PlayedCard({ play, view, names, state, fresh }: { play: Play; view: PlayerView; names: string[]; state: CardState; fresh: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const mine = play.seat === view.you;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !fresh) return;
    const from = takeRect(`card:${play.card}`)
      ?? document.querySelector(`[data-held-seat="${play.seat}"]`)?.getBoundingClientRect();
    if (from) flyFrom(el.querySelector('.card') as HTMLElement, from, { duration: 200, overshoot: 4, scaleFrom: true });
    // On first mount only.
  }, []);
  useLayoutEffect(() => {
    rememberRect(`peg:${play.card}`, ref.current?.querySelector('.card'));
  });
  const tone = toneOfSeat(view.players, view.you, play.seat);
  return (
    <div
      ref={ref}
      className={`played__card tone-${tone}`}
      data-by={mine ? 'you' : 'opp'}
      role="group"
      aria-label={mine ? 'Played by you' : `Played by ${names[play.seat]}`}
    >
      <CardView card={play.card} fluid state={state} />
    </div>
  );
}

function LastCard({ c }: { c: Card }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const from = takeRect(`peg:${c}`);
    const el = ref.current?.firstElementChild as HTMLElement | null;
    if (el && from) flyFrom(el, from, { duration: 260, scaleFrom: true });
  }, []);
  return <span ref={ref}><CardView card={c} state="dim" fluid /></span>;
}

/** The count: the old number slides up and out, the new one in from below. */
function Count({ value }: { value: number }) {
  const [shown, setShown] = useState<{ cur: number; prev: number | null }>({ cur: value, prev: null });
  if (shown.cur !== value) setShown({ cur: value, prev: shown.cur });
  useEffect(() => {
    if (shown.prev === null) return;
    const t = setTimeout(() => setShown((s) => ({ ...s, prev: null })), 140);
    return () => clearTimeout(t);
  }, [shown]);
  return (
    <p className="count" aria-live="polite">
      <strong>
        {shown.prev !== null && <span className="count__old" aria-hidden="true">{shown.prev}</span>}
        <span className={shown.prev !== null ? 'count__new' : undefined} key={shown.cur}>{shown.cur}</span>
      </strong>{' '}
      <span className="count__of">of 31</span>
    </p>
  );
}

export function PeggingStage({
  display, view, names, lit, justPlayed,
}: {
  display: PegDisplay;
  view: PlayerView;
  names: string[];
  lit: Card[];
  justPlayed: Set<Card>;
}) {
  const last = display.last;
  const who = (s: Seat) => (s === view.you ? 'you' : names[s]);
  return (
    <>
      <div className="lastcount" aria-label="Last count">
        {last && (
          <>
            <div className="stage__row stage__row--tight">
              {last.cards.map((p) => <LastCard key={p.card} c={p.card} />)}
            </div>
            <p className="caption">
              {last.total === 31 ? `31 · two to ${who(last.seat)}` : `${last.total}, go · one to ${who(last.seat)}`}
            </p>
          </>
        )}
      </div>
      <Count value={display.count} />
      <div className="played" style={{ '--n': Math.max(1, display.current.length) } as CSSProperties}>
        {display.current.map((p) => (
          <PlayedCard key={p.card} play={p} view={view} names={names} state={lit.includes(p.card) ? 'lit' : ''} fresh={justPlayed.has(p.card)} />
        ))}
      </div>
    </>
  );
}

// ---------- the show ----------

export function ShowStage({
  cards, starter, lines, current, running, twentyNine, crib,
}: {
  crib: boolean;
  cards: Card[];
  starter: Card;
  lines: ShowLine[];
  /** Index of the line being counted now; lines.length when the count is complete. */
  current: number;
  /** Steps are running (otherwise the count is drawn complete and still). */
  running: boolean;
  twentyNine: boolean;
}) {
  const listRef = useRef<HTMLOListElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const entering = running && current < 0;
  // The four cards and the starter slide onto the stage (260 ms).
  useLayoutEffect(() => {
    if (!entering) return;
    rowRef.current?.querySelectorAll<HTMLElement>('.show__card').forEach((el, i) => {
      // The crib's cards come face down, so they turn over as they arrive.
      if (crib && !el.classList.contains('show__starter') && !reducedMotion() && typeof el.animate === 'function') {
        el.animate([{ transform: 'scaleX(0)' }, { transform: 'none' }], { duration: DUR.flip, delay: i * 40, easing: CSS_EASE.out, fill: 'backwards' });
      } else appear(el, { rise: 14, delay: i * 30, duration: 260 });
    });
  }, [entering, crib]);
  const active = running && current >= 0 && current < lines.length ? lines[current] : null;
  const stateOf = (c: Card): CardState => (active ? (active.cards.includes(c) ? 'lit' : 'dim') : '');
  useLayoutEffect(() => {
    const el = listRef.current?.querySelector('[aria-current]') ?? listRef.current?.lastElementChild;
    if (el && 'scrollIntoView' in el) (el as HTMLElement).scrollIntoView({ block: 'nearest' });
  }, [current]);
  const shown = running ? lines.slice(0, Math.max(0, current + 1)) : lines;

  if (twentyNine) {
    return (
      <div className="twentynine">
        <div className="twentynine__fan">
          {[...cards, starter].map((c, i) => (
            <span key={c} style={{ '--i': i - 2 } as CSSProperties}><CardView card={c} width={96} face="full" /></span>
          ))}
        </div>
        <p className="twentynine__num" aria-live="assertive">29</p>
      </div>
    );
  }

  return (
    <>
      <div className="stage__row stage__row--show" ref={rowRef}>
        {cards.map((c, i) => (
          <span key={c} className="show__card" style={{ '--i': i } as CSSProperties}>
            <CardView card={c} fluid state={stateOf(c)} />
          </span>
        ))}
        <span className="show__card show__starter">
          <CardView card={starter} fluid state={stateOf(starter)} label={`Starter: ${cardText(starter)}`} />
        </span>
      </div>
      <ol className="combos" ref={listRef}>
        {lines.length === 0 ? (
          <li aria-current={running ? 'true' : undefined}><span><strong>Nineteen</strong> not a single point</span><b>0</b></li>
        ) : (
          shown.map((l, i) => (
            <li key={i} aria-current={running && i === current ? 'true' : undefined}>
              <span><strong>{l.name}</strong> {l.detail}</span>
              <b>{l.running}</b>
            </li>
          ))
        )}
      </ol>
    </>
  );
}

// ---------- game over ----------

export function OverStage({
  headline, detail, skunk, plate, children,
}: {
  headline: string;
  detail: string;
  skunk: 0 | 1 | 2;
  plate: string;
  children?: ReactNode;
}) {
  return (
    <div className="over">
      {skunk > 0 && <Trophy count={skunk as 1 | 2} plate={plate} />}
      <div className="over__text">
        <h1>{headline}</h1>
        <p>{detail}</p>
      </div>
      {children}
    </div>
  );
}

export interface TallyColumn {
  seat: Seat;
  label: string;
  tone: number;
}

export function Tally({ columns, stats, best }: { columns: TallyColumn[]; stats: SeatStats[]; best?: boolean }) {
  const rows: [string, (s: SeatStats) => number][] = [
    ['Pegging', (s) => s.peg],
    ['Hands', (s) => s.hand],
    ['Crib', (s) => s.crib],
  ];
  if (best) rows.push(['Best hand', (s) => s.best]);
  return (
    <table className="tally">
      <thead>
        <tr>
          <th scope="col">This game</th>
          {columns.map((c) => <th key={c.seat} scope="col" className={`tone-${c.tone}`}>{c.label}</th>)}
        </tr>
      </thead>
      <tbody>
        {rows.map(([label, get]) => (
          <tr key={label}>
            <th scope="row">{label}</th>
            {columns.map((c) => <td key={c.seat}>{stats[c.seat] ? get(stats[c.seat]) : 0}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
