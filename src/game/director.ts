// The table's choreography (motion.md). The server sends the new state at once;
// this turns each message's events into a short script of beats so the table can
// tell the story in order: the cards that scored glow butter and the prompt makes
// the call, then the peg moves, then the count clears; the show runs its steps
// before the peg moves; a win lights the finish hole before the result appears.
//
// While a script runs, `dir` overrides parts of what the table shows (the stage,
// the board's target, a frozen count). When it ends, everything follows the server
// state again. A newer message fast-forwards whatever is still running.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Card } from '../../shared/cards';
import { type GameEvent, type Phase, type PlayerView, type Seat, teamOf } from '../../shared/game';
import { scoreCall } from './callouts';
import { haptic } from './haptics';
import { DUR, onSkip } from './motion';
import { litCards } from './pegging';
import { toneOfSeat } from './seating';

export type Stage = 'deal' | 'cut' | 'pegging' | 'show' | 'over';

export const stageOf = (p: Phase): Stage =>
  p === 'discard' ? 'deal' : p === 'cut' ? 'cut' : p === 'peg' ? 'pegging' : p === 'show' ? 'show' : 'over';

export interface BoardTarget {
  scores: number[];
  back: number[];
}

export interface Direction {
  /** Stage to show instead of the server's phase. */
  stage: Stage | null;
  /** Keep a count that has just ended on the stage. */
  frozen: boolean;
  /** Cards with the butter outline. */
  lit: Card[];
  /** The call the prompt line carries. */
  call: string | null;
  callTone: number | null;
  /** The call announces points (butter); a plain "says go" does not. */
  callScores: boolean;
  /** Where the board's pegs should be, if not the server's scores. */
  board: BoardTarget | null;
  /** The cut stage holds the turned starter beside the lifted deck. */
  cutReveal: boolean;
  finishLit: boolean;
  /** Key (hand-step) of a show whose steps should run now; otherwise the show is drawn complete. */
  showRun: string | null;
}

export const IDLE: Direction = {
  stage: null, frozen: false, lit: [], call: null, callTone: null, callScores: true, board: null, cutReveal: false, finishLit: false, showRun: null,
};

type Wait = number | 'seat' | 'show';
interface Step {
  dir: Direction;
  wait: Wait;
  enter?: () => void;
}

export interface Beat {
  id: number;
  events: GameEvent[];
  /** First state after a (re)connect: draw it as it is, replay nothing. */
  fresh: boolean;
}

interface Ctx {
  you: Seat;
  names: string[];
}

export const showKeyOf = (v: PlayerView): string | null =>
  v.showResult && (v.phase === 'show' || v.phase === 'over') ? `${v.handNo}-${v.showStep}` : null;

type ScoreEvent = Extract<GameEvent, { t: 'score' }>;

function buildScript(events: GameEvent[], view: PlayerView, prev: Memory, ctx: Ctx): Step[] {
  const steps: Step[] = [];
  const n = view.players;
  const mine = teamOf(n, ctx.you);
  let board: BoardTarget = { scores: [...prev.scores], back: [...prev.back] };
  const snap = () => ({ scores: [...board.scores], back: [...board.back] });
  const apply = (e: ScoreEvent) => {
    const s = [...board.scores];
    const b = [...board.back];
    b[e.team] = s[e.team];
    s[e.team] = Math.min(view.target, s[e.team] + e.points);
    board = { scores: s, back: b };
  };
  let stage: Stage = stageOf(prev.phase);
  const push = (d: Partial<Direction>, wait: Wait, enter?: () => void) => {
    stage = d.stage ?? stage;
    steps.push({ dir: { ...IDLE, stage, board: snap(), ...d }, wait, enter });
  };

  const scores = events.filter((e): e is ScoreEvent => e.t === 'score');
  const starter = events.find((e): e is Extract<GameEvent, { t: 'starter' }> => e.t === 'starter');
  const heels = scores.find((e) => e.why === 'heels');
  const peg = scores.filter((e) => e.why === 'peg');
  const hand = scores.filter((e) => e.why === 'hand' || e.why === 'crib');
  const win = events.find((e) => e.t === 'win');
  const gos = events.filter((e): e is Extract<GameEvent, { t: 'go' }> => e.t === 'go');
  const key = showKeyOf(view);
  const newShow = key !== null && key !== prev.showKey;
  const tone = (s: Seat) => toneOfSeat(n, ctx.you, s);

  if (starter) {
    // Lift (160) + flip (320) + hold (600), then deck and starter go home.
    push({ stage: 'cut', cutReveal: true }, 160 + DUR.flip + 600);
    if (heels) {
      const call = scoreCall(heels, ctx.you, ctx.names);
      push({ stage: 'cut', cutReveal: true, lit: [starter.card], call, callTone: tone(heels.seat) }, DUR.scoreHold, () =>
        haptic(heels.seat === ctx.you || teamOf(n, heels.seat) === mine ? 'medium' : 'light'));
      apply(heels);
      push({ stage: 'cut', cutReveal: true, lit: [starter.card], call, callTone: tone(heels.seat) }, 'seat');
    }
  }

  // "Go" stays a spoken call in the prompt (design-handback-2 §4), though the server
  // says it for whoever cannot play.
  const said = (g: Extract<GameEvent, { t: 'go' }>) => (g.seat === ctx.you ? '“Go,” you say.' : `“Go,” says ${ctx.names[g.seat]}.`);
  const lastGo = gos[gos.length - 1];
  if (peg.length) {
    let call = peg.map((e) => scoreCall(e, ctx.you, ctx.names)).join(' · ');
    const onlyGo = peg.length === 1 && peg[0].items.length === 1 && peg[0].items[0].kind === 'go';
    if (lastGo && onlyGo) call = `${said(lastGo)} One to ${peg[0].seat === ctx.you ? 'you' : ctx.names[peg[0].seat]}.`;
    else if (lastGo && peg.some((e) => e.items.some((it) => it.kind === 'go'))) {
      // The point for the go was just said aloud; name it plainly after the other scores.
      call = `${said(lastGo)} ${call.replace(/Go\. One to (.+?)\./g, 'one for the go to $1')}`;
    }
    const callTone = tone(peg[peg.length - 1].seat);
    const scorerMine = teamOf(n, peg[peg.length - 1].seat) === mine;
    push({ stage: 'pegging', frozen: true, lit: litCards(peg.flatMap((e) => e.items)), call, callTone }, DUR.scoreHold, () => {
      if (scorerMine) haptic('medium');
    });
    peg.forEach(apply);
    push({ stage: 'pegging', frozen: true, call, callTone }, 'seat');
    // Let the call be read, then the ended count slides to the "last count" row.
    push({ stage: 'pegging', frozen: true, call, callTone }, 450);
  } else if (lastGo && view.phase === 'peg') {
    push({ call: said(lastGo), callTone: tone(lastGo.seat), callScores: false }, 1100);
  }

  if (newShow) {
    push({ stage: 'show', showRun: key }, 'show');
    if (hand.length) {
      hand.forEach(apply);
      push({ stage: 'show' }, 'seat');
    }
  }

  if (win) {
    push({ finishLit: true }, 300 + 200);
  }
  return steps;
}

interface Memory {
  scores: number[];
  back: number[];
  phase: Phase;
  showKey: string | null;
}

interface State {
  beatId: number;
  steps: Step[];
  i: number;
  dir: Direction;
  memory: Memory;
}

const remember = (v: PlayerView): Memory => ({ scores: [...v.scores], back: [...v.back], phase: v.phase, showKey: showKeyOf(v) });

export function useDirector(view: PlayerView, beat: Beat, ctx: Ctx) {
  const [state, setState] = useState<State>(() => ({ beatId: beat.id, steps: [], i: 0, dir: IDLE, memory: remember(view) }));
  let current = state;

  // Derive the new script during render, so the first paint of a new state is
  // already choreographed (the board must not jump ahead before the effect runs).
  if (beat.id !== state.beatId) {
    const hasNews = beat.events.length > 0 || showKeyOf(view) !== state.memory.showKey;
    if (beat.fresh) {
      current = { beatId: beat.id, steps: [], i: 0, dir: IDLE, memory: remember(view) };
    } else if (!hasNews) {
      // Someone acked or reconnected: nothing to tell; let any running script carry on.
      current = { ...state, beatId: beat.id, memory: remember(view) };
    } else {
      const steps = buildScript(beat.events, view, state.memory, ctx);
      current = { beatId: beat.id, steps, i: 0, dir: steps[0]?.dir ?? IDLE, memory: remember(view) };
    }
    setState(current);
  }

  const advance = useCallback((fromBeat: number, fromI: number) => {
    setState((s) => {
      if (s.beatId !== fromBeat || s.i !== fromI) return s;
      const i = s.i + 1;
      return { ...s, i, dir: s.steps[i]?.dir ?? IDLE };
    });
  }, []);

  const waiting = useRef<{ kind: Wait; go: () => void } | null>(null);
  const step = current.steps[current.i];

  useEffect(() => {
    if (!step) {
      waiting.current = null;
      return;
    }
    step.enter?.();
    const go = () => advance(current.beatId, current.i);
    let t: ReturnType<typeof setTimeout>;
    if (typeof step.wait === 'number') t = setTimeout(go, step.wait);
    // Fallbacks so a missed callback can never wedge the table.
    else t = setTimeout(go, step.wait === 'seat' ? 2600 : 60_000);
    waiting.current = { kind: step.wait, go };
    return () => clearTimeout(t);
  }, [current.beatId, current.i, step, advance]);

  // A tap skips timed holds and peg moves (not the show: Continue does that).
  useEffect(() => onSkip(() => {
    const w = waiting.current;
    if (w && w.kind !== 'show') w.go();
  }), []);

  const seated = useCallback(() => {
    const w = waiting.current;
    if (w && w.kind === 'seat') w.go();
  }, []);
  const showDone = useCallback(() => {
    const w = waiting.current;
    if (w && w.kind === 'show') w.go();
  }, []);

  return { dir: current.dir, seated, showDone };
}
