// What sits on the table top: the top row (deck and starter left, crib right) and the
// stage in the middle, which is the only thing that changes with the phase.
import { type CSSProperties, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Card } from '../../shared/cards';
import type { Play, PlayerView, Seat, SeatStats } from '../../shared/game';
import { Trophy } from '../brand/Mark';
import { type CardState, CardView } from '../cards/CardView';
import { cardText } from '../lib/format';
import { type ShowLine, showRows } from './callouts';
import { CSS_EASE, DUR, appear, flyFrom, reducedMotion, rememberRect, takeRect } from './motion';
import type { PegDisplay } from './pegging';
import { type TrackerStage, toneOfSeat } from './seating';
import { TeamMark, teamColourOf } from './TeamMark';

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
  const who = mine ? 'Played by you' : `Played by ${names[play.seat]}`;
  // Three and four players: a chip in the team colour with the player's initial says
  // whose card it is (a bare diamond for mustard). Theirs sit high, chip above; yours
  // still sit 20 px low with the chip below. Two players keep the plain bars.
  if (view.players > 2) {
    return (
      <div
        ref={ref}
        className={`played__card played__card--chip tone-${tone}`}
        data-by={mine ? 'you' : 'opp'}
        data-mine={mine || undefined}
        role="group"
        aria-label={who}
      >
        <TeamMark tone={tone} initial={(names[play.seat]?.trim()[0] ?? '?').toUpperCase()} size={16} />
        <CardView card={play.card} fluid state={state} />
      </div>
    );
  }
  return (
    <div
      ref={ref}
      className={`played__card tone-${tone}`}
      data-by={mine ? 'you' : 'opp'}
      role="group"
      aria-label={who}
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
  cards, starter, lines, current, playing, gap, twentyNine, crib, total, totalPhrase, onTap, onRecount,
}: {
  crib: boolean;
  cards: Card[];
  starter: Card;
  lines: ShowLine[];
  /** Index of the step being counted; -1 while the cards come in; lines.length for the total beat or a finished count. */
  current: number;
  /** The count is running (otherwise it is drawn finished and still). */
  playing: boolean;
  /** The moment with nothing lit between two steps. */
  gap: boolean;
  twentyNine: boolean;
  total: number;
  totalPhrase: string;
  /** A tap on the stage: the next step now. */
  onTap: () => void;
  /** Count the hand again from the start. */
  onRecount: () => void;
}) {
  const listRef = useRef<HTMLOListElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const entering = playing && current < 0;
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

  // The step on show in the big line: during the gap, still the one before.
  const L = lines.length;
  const finished = !playing || current >= L;
  const shownIdx = finished ? L : gap ? current - 1 : current;
  const step = shownIdx >= 0 && shownIdx < L ? lines[shownIdx] : null;
  const stateOf = (c: Card): CardState => (playing && step && !gap ? (step.cards.includes(c) ? 'lit' : 'dim') : '');
  const runningNow = finished ? total : step ? step.running : shownIdx >= 0 ? lines[shownIdx - 1]?.running ?? 0 : 0;
  // Earlier steps above it: long counts fold finished groups (never the step on show).
  const rows = finished
    ? showRows(lines, -1)
    // While counting, the big line below holds the current step, so the history folds
    // a line sooner (five in all) to keep a long count on one screen at 360.
    : shownIdx <= 0 ? [] : showRows(lines.slice(0, shownIdx + 1), shownIdx, 5).slice(0, -1);

  useLayoutEffect(() => {
    const el = listRef.current?.lastElementChild;
    if (el && 'scrollIntoView' in el) (el as HTMLElement).scrollIntoView({ block: 'nearest' });
  }, [shownIdx, rows.length]);

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

  // "twenty‑six" must not break at its hyphen.
  const nb = (t: string) => t.replace(/-/g, '‑');
  const phrase = nb(step ? step.name : finished ? totalPhrase : 'Counting…');
  return (
    <div className="show" data-playing={playing || undefined} onClick={playing ? onTap : undefined}>
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
      {rows.length > 0 && (
        <ol className="combos" ref={listRef} aria-label="Counted so far">
          {rows.map((l) => (
            <li key={l.key} data-folded={l.count > 1 || undefined}>
              {l.count > 1
                ? <span><strong>{l.name}</strong>, {l.detail}</span>
                : <span><strong>{nb(l.name)}</strong> <small>{l.detail}</small></span>}
              <b>{l.running}</b>
            </li>
          ))}
        </ol>
      )}
      <div className="saying" data-state={step && !gap ? 'step' : finished ? 'total' : 'wait'}>
        <div className="saying__text" aria-live="polite">
          <p className="saying__phrase" key={`p${shownIdx}`}>{phrase}</p>
          {step && <p className="saying__reason">{step.detail}</p>}
          {finished && L > 0 && !playing && (
            <button type="button" className="saying__again" onClick={(e) => { e.stopPropagation(); onRecount(); }}>Count again</button>
          )}
        </div>
        <b className="saying__total" key={`t${runningNow}`} aria-label={`${runningNow} points`}>{runningNow}</b>
      </div>
    </div>
  );
}

// ---------- the show tracker, four or five steps ----------

/**
 * One line, "Sam’s hand, 2 of 5" with "Next: Margaret’s hand" at the right, over a
 * segment per step coloured by the team that scores it (handoff v2 ShowTracker).
 * Five pills do not fit at 360; three-step games keep the pills.
 */
export function ShowTracker({ stages, current }: { stages: TrackerStage[]; current: number }) {
  const at = Math.min(stages.length - 1, Math.max(0, current));
  const next = stages[at + 1];
  return (
    <div className="tracker">
      <p>
        <strong>{stages[at].name}</strong>
        <span className="tracker__of">{at + 1} of {stages.length}</span>
        {next && <span className="tracker__next">Next: {next.name}</span>}
      </p>
      <ol aria-label="Show progress">
        {stages.map((st, i) => (
          <li
            key={i}
            data-team={teamColourOf(st.tone)}
            data-done={i <= at || undefined}
            aria-current={i === at ? 'step' : undefined}
            aria-label={st.name}
          />
        ))}
      </ol>
    </div>
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
