// The table (handoff Table.jsx). Six fixed zones, top to bottom, the same in every
// phase so nothing jumps:
//   opponent strip(s) 56 / board 156 / table top (flex) / prompt 48 / hand 92 / your strip 52
// Only the stage inside the table top, and what the prompt and hand zones hold,
// change with the phase. At 960 px and over the same zones open sideways: players
// and the running tally in a left rail, board and table in the middle, the hand's
// log on the right.
import { type CSSProperties, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { type Card, RANKS, rank, value } from '../../shared/cards';
import {
  type Action, type PlayerView, type Seat, discardCount, leftOf, showSeat, teamOf,
} from '../../shared/game';
import { cardText, possessive } from '../lib/format';
import type { ConnStatus, StateMsg } from '../lib/useGameSocket';
import { Board } from './Board';
import { type LogEntry, describeEvents, logEntries, showLines } from './callouts';
import { type Beat, stageOf, useDirector } from './director';
import { Flights, fly } from './Flights';
import { haptic } from './haptics';
import { CSS_EASE, DUR, reducedMotion, rememberRect, skipAnimations } from './motion';
import { countTiming, usePace } from './pace';
import { countAloud } from './countAloud';
import { pegDisplay } from './pegging';
import { PlayerStrip } from './PlayerStrip';
import {
  compactStatus, cribLabel, discardPrompt, listNames, othersClockwise, overCopy, relationOf, showStages, showStatusOf,
  showStepLabels, statusLine, teamName, teamsInOrder, toneOf, toneOfSeat, waitingText,
} from './seating';
import { CutStage, DealStage, OverStage, PeggingStage, ShowStage, ShowTracker, Tally, type TallyColumn, TopRow } from './stages';
import { teamColourOf } from './TeamMark';
import { CardView } from '../cards/CardView';
import { navigate } from '../lib/router';

interface Props {
  msg: StateMsg;
  view: PlayerView;
  names: string[];
  status: ConnStatus;
  pending: boolean;
  act: (a: Action) => void;
  beat: Beat;
  toast: string | null;
  rematch: { busy: boolean; error: string | null; go: () => void };
  /** By seat: each player's league avatar emoji, if they have one. */
  emojis?: (string | null)[];
  /** Your next queued fixture, offered at game over ("finishing a game offers you the next"). */
  next?: { label: string; busy: boolean; error: string | null; go: () => void } | null;
}

/**
 * The show counted aloud, step by step at a human pace (owner's request; a deliberate
 * departure from motion.md's 450 ms a step): the cards slide in, then each
 * combination gets about 1.4 s (relaxed) with a short moment of nothing lit between
 * steps, then the total holds as its own beat. A 29 ends on the fan instead, which
 * cannot be skipped. `next` advances a step at once (a tap on the stage), `jump`
 * goes to the end, `restart` counts again from the start. `onDone` fires once per
 * show, when the first count ends; a recount never fires it again.
 */
function useShowSequence(key: string | null, count: number, running: boolean, is29: boolean, onDone: () => void) {
  const [pace] = usePace();
  const T = countTiming(pace);
  // i: -1 entering, 0 … count-1 a step, count the total beat. playing: the count is running.
  const [st, setSt] = useState({ key, i: -1, gap: false, nine: false, playing: false });
  if (st.key !== key) setSt({ key, i: -1, gap: false, nine: false, playing: false });
  const done = useRef(onDone);
  done.current = onDone;
  const fired = useRef<string | null>(null);
  const finish = useCallback(() => {
    if (key !== null && fired.current !== key) {
      fired.current = key;
      done.current();
    }
  }, [key]);

  // The director says go: start counting (once per show).
  useEffect(() => {
    if (running && key !== null && fired.current !== key) setSt({ key, i: -1, gap: false, nine: false, playing: true });
  }, [running, key]);

  // One timer for whatever comes next.
  useEffect(() => {
    if (!st.playing || st.key !== key) return;
    let ms: number;
    let to: () => void;
    if (st.nine) {
      ms = 300 + 1600;
      to = () => { setSt((s) => ({ ...s, nine: false, playing: false, i: count })); finish(); };
    } else if (st.gap) {
      ms = T.gap;
      to = () => setSt((s) => ({ ...s, gap: false }));
    } else if (st.i < 0) {
      ms = reducedMotion() ? DUR.reduced : 260;
      to = () => setSt((s) => ({ ...s, i: 0, gap: count > 0 }));
    } else if (st.i < count) {
      ms = T.step - T.gap;
      to = () => setSt((s) => ({ ...s, i: s.i + 1, gap: true }));
    } else {
      ms = is29 ? 0 : T.total;
      to = is29
        ? () => setSt((s) => ({ ...s, nine: true }))
        : () => { setSt((s) => ({ ...s, playing: false })); finish(); };
    }
    const t = setTimeout(to, ms);
    return () => clearTimeout(t);
  }, [st, key, count, is29, T.gap, T.step, T.total, finish]);

  const cur = useRef(st);
  cur.current = st;

  /** A tap on the stage: on to the next step now. */
  const next = useCallback(() => {
    const s = cur.current;
    if (!s.playing || s.nine) return;
    if (s.i < count) setSt({ ...s, i: s.i + 1, gap: false });
    else if (is29) setSt({ ...s, nine: true });
    else {
      setSt({ ...s, playing: false });
      finish();
    }
  }, [count, is29, finish]);

  /** Straight to the end (Continue pressed early). The 29's fan still plays out. */
  const jump = useCallback(() => {
    const s = cur.current;
    if (s.nine) return false;
    if (s.playing && is29 && fired.current !== key) {
      setSt({ ...s, i: count, gap: false, nine: true });
      return true;
    }
    setSt({ ...s, i: count, gap: false, playing: false });
    finish();
    return true;
  }, [count, is29, finish, key]);

  const restart = useCallback(() => setSt((s) => ({ ...s, i: -1, gap: false, nine: false, playing: true })), []);

  const playing = st.playing && st.key === key;
  return {
    current: playing ? st.i : count,
    gap: playing && st.gap,
    nine: playing && st.nine,
    playing,
    /** The count is still going (Continue would skip it). */
    counting: playing && st.i < count,
    next, jump, restart,
  };
}

const cribRect = (): DOMRect | null => {
  const pile = document.querySelector('[data-zone="crib"]');
  if (!pile) return null;
  const r = pile.getBoundingClientRect();
  const first = pile.firstElementChild?.getBoundingClientRect();
  const w = first?.width || 44;
  const h = first?.height || w * 1.4;
  return new DOMRect(r.right - w, r.top, w, h);
};

export function Table({ msg, view, names, status, pending, act, beat, toast, rematch, emojis, next }: Props) {
  const you = view.you;
  const n = view.players;
  const mine = teamOf(n, you);
  const others = othersClockwise(n, you);
  const cutter = leftOf(n, view.dealer);
  const need = discardCount(n);
  const tableRef = useRef<HTMLElement>(null);
  const ctx = useMemo(() => ({ you, names }), [you, names]);
  const { dir, seated, showDone } = useDirector(view, beat, ctx);
  const stage = dir.stage ?? stageOf(view.phase);
  const connText = status === 'open' ? null : status === 'failed' ? 'Disconnected' : 'Reconnecting…';
  const offline = connText !== null;

  // ---- scores in the strips update as the peg seats ----
  const [shown, setShown] = useState<number[]>(() => [...view.scores]);
  useEffect(() => {
    if (beat.fresh) setShown([...view.scores]);
  }, [beat.id]);
  useEffect(() => {
    if (dir.board) return;
    const t = setTimeout(() => setShown([...view.scores]), 1600);
    return () => clearTimeout(t);
  }, [dir.board, view.scores]);
  const onSeated = useCallback((team: number, score: number) => {
    setShown((s) => {
      const x = [...s];
      x[team] = score;
      return x;
    });
    if (team === mine) haptic('light');
    seated();
  }, [mine, seated]);
  const boardScores = dir.board?.scores ?? view.scores;
  const boardBack = dir.board?.back ?? view.back;

  // ---- discard: pick, send, and the cards' trip to the crib ----
  const [selected, setSelected] = useState<Card[]>([]);
  const [sent, setSent] = useState<{ hand: number; cards: Card[]; down: boolean } | null>(null);
  const [flying, setFlying] = useState(0);
  useEffect(() => setSelected([]), [view.handNo, view.phase]);
  const sel = selected.filter((c) => view.hand.includes(c));
  const sentNow = sent && sent.hand === view.handNo ? sent : null;
  const iDiscarded = view.discarded[you];

  useEffect(() => {
    if (!pending && sent && !iDiscarded && view.phase === 'discard') setSent(null); // refused: put them back
  }, [pending, sent, iDiscarded, view.phase]);
  useEffect(() => {
    if (!sentNow || !iDiscarded) return;
    if (reducedMotion()) {
      setSent(null);
      return;
    }
    let t2: ReturnType<typeof setTimeout>;
    const t1 = setTimeout(() => {
      setSent((s) => (s ? { ...s, down: true } : s));
      t2 = setTimeout(() => {
        const to = cribRect();
        const slots = [...document.querySelectorAll('.stage .slot')];
        let launched = 0;
        sentNow.cards.forEach((_, i) => {
          const from = slots[i]?.firstElementChild?.getBoundingClientRect();
          if (to && from && fly({ card: null, from, to, delay: i * 80, duration: 260, easing: CSS_EASE.inOut, onLand: () => setFlying((f) => Math.max(0, f - 1)) })) launched++;
        });
        setFlying((f) => f + launched);
        setSent(null);
      }, DUR.flip);
    }, 180);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [sentNow?.cards.join(','), iDiscarded]);

  const toggle = (c: Card) => {
    haptic('light');
    setSelected((s0) => {
      const s = s0.filter((x) => view.hand.includes(x));
      if (s.includes(c)) return s.filter((x) => x !== c);
      return s.length < need ? [...s, c] : [...s.slice(1), c];
    });
  };
  const send = () => {
    for (const c of sel) rememberRect(`disc:${c}`, document.querySelector(`[data-card="${c}"] .card`));
    setSent({ hand: view.handNo, cards: sel, down: false });
    act({ t: 'discard', cards: sel });
  };

  // ---- events that move things: the deal, others' discards, your own lay ----
  const justPlayed = useMemo(
    () => new Set(beat.fresh ? [] : beat.events.flatMap((e) => (e.t === 'play' ? [e.card] : []))),
    [beat],
  );
  const handled = useRef(beat.id);
  useLayoutEffect(() => {
    if (beat.fresh || handled.current === beat.id) return;
    handled.current = beat.id;
    const table = tableRef.current;
    for (const e of beat.events) if (e.t === 'play' && e.seat === you) haptic('light');

    // Others' discards slide from their strip to the crib.
    const to = cribRect();
    let launched = 0;
    for (const e of beat.events) {
      if (e.t !== 'discard' || e.seat === you || !to) continue;
      const from = document.querySelector(`[data-held-seat="${e.seat}"]`)?.getBoundingClientRect();
      if (!from) continue;
      const w = to.width;
      const src = new DOMRect(from.left, from.top, w * 0.5, w * 0.7);
      for (let k = 0; k < need; k++) {
        if (fly({ card: null, from: src, to, delay: k * 80, duration: 260, easing: CSS_EASE.inOut, onLand: () => setFlying((f) => Math.max(0, f - 1)) })) launched++;
      }
    }
    if (launched) setFlying((f) => f + launched);

    // The deal: cards leave the deck one at a time, opponent first, 60 ms apart.
    const deal = beat.events.find((e) => e.t === 'deal');
    const deck = document.querySelector('[data-zone="deck"] .card')?.getBoundingClientRect();
    if (!deal || !table || !deck || reducedMotion()) return;
    table.querySelectorAll('[data-landed]').forEach((el) => el.removeAttribute('data-landed'));
    const handEls = [...table.querySelectorAll<HTMLElement>('.table__hand .hand-card')];
    let release!: () => void;
    const released = new Promise<void>((r) => { release = r; });
    let mineLeft = handEls.length;
    const finish = () => {
      table.classList.add('is-flipping');
      table.classList.remove('is-dealing');
      release();
      setTimeout(() => table.classList.remove('is-flipping'), DUR.flip + 40);
    };
    table.classList.add('is-dealing');
    const size = Math.max(...view.handCounts, view.hand.length);
    let i = 0;
    for (let round = 0; round < size; round++) {
      for (let k = 0; k < n; k++) {
        const seat = (view.dealer + 1 + k) % n;
        const target = seat === you
          ? handEls[round]?.querySelector('.card')
          : table.querySelector(`[data-held-seat="${seat}"] > span:nth-child(${round + 1})`);
        const rect = target?.getBoundingClientRect();
        if (!target || !rect) continue;
        const holder = seat === you ? handEls[round] : (target as HTMLElement);
        const ok = fly({
          card: null, from: deck, to: rect, delay: i * 60, duration: DUR.card,
          release: seat === you ? released : undefined,
          onLand: () => {
            holder.setAttribute('data-landed', '');
            if (seat === you && --mineLeft === 0) setTimeout(finish, 60);
          },
        });
        if (!ok) holder.setAttribute('data-landed', '');
        else i++;
        if (!ok && seat === you && --mineLeft === 0) finish();
      }
    }
    if (handEls.length === 0) finish();
    // Never leave the hand hidden.
    setTimeout(() => {
      if (table.classList.contains('is-dealing')) finish();
    }, i * 60 + 1500);
  }, [beat, you, n, need, view]);

  // A tap anywhere skips running animations to their end state.
  useEffect(() => {
    const onDown = () => skipAnimations();
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, []);

  // ---- the show ----
  const result = view.showResult;
  const showKey = result && (view.phase === 'show' || view.phase === 'over') ? `${view.handNo}-${view.showStep}` : null;
  const lines = useMemo(() => (result ? showLines(result) : []), [result]);
  const is29 = result?.total === 29;
  const seq = useShowSequence(showKey, lines.length, dir.showRun !== null && dir.showRun === showKey, is29, showDone);
  const showTitle = result ? `${result.seat === you ? 'Your' : possessive(names[result.seat])} ${result.crib ? 'crib' : 'hand'}` : '';
  const runningTotal = seq.current >= lines.length ? result?.total ?? 0 : seq.current >= 0 ? lines[seq.current].running : 0;

  // Spoken announcements for screen readers (the starter, a go, a new deal, the win).
  const spoken = useMemo(
    () => (beat.fresh ? '' : describeEvents(beat.events, you, names, n).filter((d) => d.big).map((d) => d.text).join('. ')),
    [beat, you, names, n],
  );

  // ---- the hand log (laptop) ----
  const [log, setLog] = useState<LogEntry[]>([]);
  const logId = useRef(1);
  const logged = useRef(beat.id);
  useEffect(() => {
    if (logged.current === beat.id) return;
    logged.current = beat.id;
    if (beat.fresh || !beat.events.length) return;
    const { reset, rows } = logEntries(beat.events, you, names, n, () => logId.current++);
    setLog((l) => (reset ? rows : [...l, ...rows]).slice(-40));
  }, [beat, you, names, n]);

  // ---- game over: haptics as the result lands ----
  const overSeen = useRef(view.phase === 'over');
  const copy = view.phase === 'over' && view.winner !== null ? overCopy(view, names) : null;
  const won = copy?.won ?? false;
  const skunkLevel = copy?.skunk ?? 0;
  useEffect(() => {
    if (stage !== 'over' || overSeen.current) return;
    overSeen.current = true;
    if (won) haptic('heavy');
    // The plate stamps after the plinth rises and the kiwi drops: heavy, both players.
    if (skunkLevel > 0) setTimeout(() => haptic('heavy'), 220 + 500 + 140);
  }, [stage, won, skunkLevel]);

  // ---- the prompt: one line saying what to do now, and at most one button ----
  const myTurn = view.phase === 'peg' && view.turn === you;
  const iCut = view.phase === 'cut' && cutter === you;
  const unplayable = myTurn ? view.hand.filter((c) => view.count + value(c) > 31) : [];
  let text = '';
  let button: { label: string; onPress: () => void; disabled?: boolean; quiet?: boolean } | null = null;
  const waiting = waitingText(view, names, msg.online);
  if (view.phase === 'discard') {
    if (!iDiscarded && !sentNow) {
      text = discardPrompt(n, names, you, view.dealer, sel.length);
      button = { label: 'Send', onPress: send, disabled: sel.length !== need || pending || offline };
    } else text = waiting;
  } else if (view.phase === 'cut') {
    text = iCut ? 'Tap the deck to cut' : waiting;
  } else if (view.phase === 'peg') {
    if (myTurn) {
      text = unplayable.length
        ? `Your turn. ${listNames([...new Set(unplayable.map((c) => RANKS[rank(c)]))])} would go past 31.`
        : 'Your turn: lay a card';
    } else text = waiting;
  } else if (view.phase === 'show' || stage === 'show') {
    const counting = seq.counting;
    text = counting ? `${showTitle} · ${runningTotal}` : `${showTitle}: ${result?.total === 0 ? 'nineteen' : result?.total ?? 0}`;
    if (view.phase === 'show') {
      if (view.acks[you] && !counting) text = waiting;
      else if (counting && !view.acks[you]) {
        // Continue appears when the count is finished; pressed early, it skips to the total first.
        button = { label: 'Skip to total', quiet: true, onPress: () => { seq.jump(); } };
      } else if (!view.acks[you]) {
        button = {
          label: view.showStep === n ? 'Next deal' : 'Continue',
          disabled: pending,
          onPress: () => {
            seq.jump();
            showDone();
            act({ t: 'ack' });
          },
        };
      }
    }
  }
  // The 29's hold cannot be skipped: Continue stays in place but waits.
  if (stage === 'show' && seq.nine && button) button = { ...button, disabled: true };
  const promptText = toast ?? dir.call ?? text;
  const promptKind = toast ? 'error' : dir.call ? (dir.callScores ? 'call' : 'note') : 'plain';

  // ---- strips ----
  const lanes = useMemo(() => {
    const order = teamsInOrder(n, you);
    return [...order.slice(1), order[0]].map((team) => ({ team, colour: teamColourOf(toneOf(n, you, team)), name: teamName(n, names, you, team) }));
  }, [n, you, names]);
  const busySeat = (s: Seat) => (view.phase === 'peg' && view.turn === s) || (view.phase === 'cut' && cutter === s);
  const compact = n > 2;
  // Line two of a compact cell: the cards held, or a short status when that says more.
  const compactLine = (s: Seat): { text: string; first: boolean } => {
    if (msg.online[s] === false) return { text: 'Offline', first: true };
    if (stage === 'show' && view.showResult) return { text: showStatusOf(view, s), first: true };
    return { text: compactStatus(view, s, msg.online, shown), first: false };
  };
  const partnerSeat = n === 4 ? others.find((s) => relationOf(n, you, s) === 'partner') : undefined;
  const yourLabel = partnerSeat !== undefined ? `You and ${names[partnerSeat]}` : names[you];

  // ---- hand zone ----
  const handCards = sentNow ? view.hand.filter((c) => !sentNow.cards.includes(c)) : view.hand;
  const play = (c: Card) => {
    rememberRect(`card:${c}`, document.querySelector(`[data-card="${c}"] .card`));
    act({ t: 'play', card: c });
  };

  const cribShown = Math.max(0, view.cribCount - (sentNow && iDiscarded ? sentNow.cards.length : 0) - flying);
  const pegShown = pegDisplay(view, dir.frozen);
  const tallyColumns: TallyColumn[] = [you, ...others].map((s) => ({ seat: s, label: s === you ? 'You' : names[s], tone: toneOfSeat(n, you, s) }));
  const firstCutNote = view.handNo === 1 && view.firstCut.length === n
    ? `Cut for deal: ${listNames(view.firstCut.map((c, s) => `${s === you ? 'you' : names[s]} ${cardText(c)}`))}. Low card deals.`
    : null;

  return (
    <main
      ref={tableRef}
      className="table"
      data-phase={stage}
      data-players={n}
      style={{ '--opps': others.length } as CSSProperties}
    >
      <div className={`table__opps${compact ? ' table__opps--compact' : ''}`} data-count={others.length}>
        {others.map((s) => {
          const line = compact ? compactLine(s) : null;
          const isPartner = relationOf(n, you, s) === 'partner';
          return (
            <PlayerStrip
              key={s}
              who="opp"
              seat={s}
              name={names[s]}
              tone={toneOfSeat(n, you, s)}
              // Your partner's cell has no score: your own strip carries the team's.
              score={compact && isPartner ? null : shown[teamOf(n, s)] ?? 0}
              status={line ? line.text : statusLine(view, s, msg.online, shown)}
              statusFirst={line?.first}
              held={view.handCounts[s]}
              dealer={view.dealer === s}
              partner={isPartner}
              active={busySeat(s)}
              compact={compact}
              emoji={emojis?.[s]}
            />
          );
        })}
      </div>

      <div className="table__board">
        <Board teams={lanes} scores={boardScores} back={boardBack} onSeated={onSeated} finishLit={dir.finishLit || stage === 'over'} />
      </div>

      <section className="table__top" aria-label="Table" data-rim={is29 && stage === 'show' && (seq.nine || seq.current >= lines.length) ? 'butter' : undefined}>
        {stage !== 'over' && !seq.nine && (
          <TopRow
            deckAway={stage === 'cut'}
            starter={stage === 'cut' ? null : view.starter}
            starterAway={stage === 'show'}
            cribCount={cribShown}
            cribLabel={cribLabel(n, names, you, view.dealer)}
            lit={dir.lit}
          />
        )}
        <div className="stage" key={stage}>
          {stage === 'deal' && (
            <DealStage slots={need} sent={sentNow && (iDiscarded || pending) ? sentNow : null} note={firstCutNote} />
          )}
          {stage === 'cut' && (
            <CutStage
              canCut={iCut && !pending}
              revealed={dir.cutReveal}
              starter={view.starter}
              lit={view.starter !== null && dir.lit.includes(view.starter)}
              onCut={() => {
                haptic('light');
                act({ t: 'cut' });
              }}
            />
          )}
          {stage === 'pegging' && (
            <PeggingStage display={pegShown} view={view} names={names} lit={dir.lit} justPlayed={justPlayed} />
          )}
          {stage === 'show' && result && view.starter !== null && (
            <ShowStage
              cards={result.cards}
              crib={result.crib}
              starter={view.starter}
              lines={lines}
              current={seq.current}
              playing={seq.playing}
              gap={seq.gap}
              twentyNine={seq.nine}
              total={result.total}
              totalPhrase={countAloud(result.items).totalPhrase}
              onTap={seq.next}
              onRecount={seq.restart}
            />
          )}
          {stage === 'over' && copy && (
            <OverStage headline={copy.headline} detail={copy.detail} skunk={copy.skunk} plate={copy.plate}>
              <Tally columns={tallyColumns} stats={view.stats} best />
              {msg.next && <p className="over__note">A rematch is ready.</p>}
              {rematch.error && <p className="over__note over__note--error" role="alert">{rematch.error}</p>}
              {next?.error && <p className="over__note over__note--error" role="alert">{next.error}</p>}
            </OverStage>
          )}
        </div>
      </section>

      <div className="table__prompt">
        {stage === 'over' && next ? (
          <button type="button" className="btn btn--wide" onClick={next.go} disabled={next.busy}>
            {next.busy ? 'Dealing…' : next.label}
          </button>
        ) : stage === 'over' ? (
          <button type="button" className="btn btn--wide" onClick={rematch.go} disabled={rematch.busy}>
            {msg.next ? 'Join rematch' : rematch.busy ? 'Shuffling…' : 'Rematch'}
          </button>
        ) : (
          <>
            <p aria-live="polite" data-kind={promptKind} className={dir.call ? `tone-${dir.callTone ?? 0}` : undefined}>{promptText}</p>
            {button && (
              <button type="button" className={`btn${button.quiet ? ' btn--quiet' : ''}`} onClick={button.onPress} disabled={button.disabled}>{button.label}</button>
            )}
          </>
        )}
      </div>

      <div className="table__hand" data-offline={offline || undefined}>
        {stage === 'over' && next && (
          <button type="button" className="btn btn--wide btn--quiet" onClick={rematch.go} disabled={rematch.busy}>
            {msg.next ? 'Join rematch' : rematch.busy ? 'Shuffling…' : 'Rematch'}
          </button>
        )}
        {stage === 'over' && (
          <button type="button" className="btn btn--wide btn--quiet" onClick={() => navigate('/')}>Home</button>
        )}
        {stage === 'show' && n > 2 && <ShowTracker stages={showStages(view, names)} current={view.showStep} />}
        {stage === 'show' && n === 2 && (
          <ol className="steps" style={{ '--steps': n + 1 } as CSSProperties}>
            {showStepLabels(view, names).map((label, i) => {
              const seat = i === n ? view.dealer : showSeat(n, view.dealer, i);
              return (
                <li key={i} className={`tone-${toneOfSeat(n, you, seat)}`} aria-current={i === view.showStep ? 'step' : undefined} data-done={i < view.showStep || undefined}>
                  {label}
                </li>
              );
            })}
          </ol>
        )}
        {stage !== 'over' && stage !== 'show' && handCards.map((c) => {
          const discarding = view.phase === 'discard' && !iDiscarded && !sentNow;
          const legal = myTurn && view.count + value(c) <= 31;
          const picked = discarding && sel.includes(c);
          const dim = (myTurn && !legal) || offline;
          // While reconnecting the hand is dimmed and nothing in it can be pressed.
          const enabled = (discarding || legal) && !pending && !offline;
          return (
            <button
              key={c}
              type="button"
              className="hand-card"
              data-card={c}
              disabled={!enabled}
              aria-pressed={discarding ? picked : undefined}
              onClick={() => (discarding ? toggle(c) : play(c))}
            >
              <CardView card={c} fluid state={offline ? 'dim' : picked ? 'picked' : dim ? 'dim' : ''} label={myTurn && !legal ? `${cardText(c)} (would go past 31)` : undefined} />
            </button>
          );
        })}
      </div>

      <PlayerStrip
        who="you"
        seat={you}
        name={yourLabel}
        avatarName={names[you]}
        tone={0}
        score={shown[mine] ?? 0}
        status={connText ? <span className="conn" role="status">{status !== 'failed' && <span className="conn__spin" aria-hidden="true" />}{connText}</span> : statusLine(view, you, msg.online, shown)}
        dealer={view.dealer === you}
        active={myTurn || iCut}
        emoji={emojis?.[you]}
      />

      {/* Laptop only: the running tally in the left rail (at game over it carries the best hand too). */}
      <div className="table__tally"><Tally columns={tallyColumns} stats={view.stats} best={stage === 'over'} /></div>
      <aside className="log" aria-label="This hand">
        <h2 className="eyebrow">This hand{view.handNo ? ` · deal ${view.handNo}` : ''} <span className="log__code">{msg.code}</span></h2>
        <ol>
          {[...log].reverse().map((e) => (
            <li key={e.id} data-score={e.score || undefined} className={e.tone !== null ? `tone-${e.tone}` : undefined}>
              <span>{e.text}</span>
              <b>{e.value}</b>
            </li>
          ))}
        </ol>
      </aside>

      <p className="sr-only" aria-live="polite">{spoken}</p>
      <Flights />
    </main>
  );
}
