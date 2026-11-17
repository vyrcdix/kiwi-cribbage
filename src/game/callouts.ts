// Turns server events into short announcements, and keeps the running log.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Card } from '../../shared/cards';
import { type GameEvent, type PlayerCount, type Seat, type ShowResult, discardCount } from '../../shared/game';
import { type ScoreItem, describeItem } from '../../shared/scoring';
import { cardText, possessive } from '../lib/format';
import { capitalise, countAloud } from './countAloud';
import { listNames, teamName, toneOf, toneOfSeat } from './seating';

export interface Line {
  id: number;
  text: string;
  /** Team colour slot (see seating.toneOf); null for neutral. */
  tone: number | null;
}

interface Described {
  text: string;
  tone: number | null;
  /** Shown prominently, not just logged. */
  big: boolean;
  /** Replaces whatever else is showing (the win). */
  final?: boolean;
}

export function describeEvents(events: GameEvent[], you: Seat, names: string[], players: PlayerCount): Described[] {
  const who = (s: Seat) => (s === you ? 'You' : names[s]);
  const whose = (s: Seat) => (s === you ? 'Your' : possessive(names[s]));
  const tone = (s: Seat) => toneOfSeat(players, you, s);
  const out: Described[] = [];
  for (const e of events) {
    switch (e.t) {
      case 'firstcut': {
        const cuts = e.cards.map((c, s) => `${s === you ? 'you' : names[s]} ${cardText(c)}`);
        out.push({
          text: `Cut for deal: ${listNames(cuts)}. ${e.dealer === you ? 'You deal first.' : `${names[e.dealer]} deals first.`}`,
          tone: tone(e.dealer),
          // The table shows the cut for the whole first discard, so just log it.
          big: false,
        });
        break;
      }
      case 'deal':
        if (e.handNo > 1) out.push({ text: `${whose(e.dealer)} deal`, tone: tone(e.dealer), big: true });
        break;
      case 'discard':
        if (e.seat !== you)
          out.push({
            text: `${names[e.seat]} sent ${discardCount(players) === 2 ? 'two' : 'one'} to the crib`,
            tone: tone(e.seat),
            big: false,
          });
        break;
      case 'starter':
        out.push({ text: `Starter: ${cardText(e.card)}`, tone: null, big: true });
        break;
      case 'play':
        out.push({ text: `${who(e.seat)} played ${cardText(e.card)} — ${e.count}`, tone: tone(e.seat), big: false });
        break;
      case 'go':
        out.push({ text: e.seat === you ? 'You say go' : `${names[e.seat]} says go`, tone: tone(e.seat), big: true });
        break;
      case 'score':
        if (e.why === 'hand' || e.why === 'crib') {
          out.push({ text: `${whose(e.seat)} ${e.why}: ${e.points}`, tone: tone(e.seat), big: false });
        } else {
          out.push({ text: `${who(e.seat)}: ${e.items.map(describeItem).join(', ')}`, tone: tone(e.seat), big: true });
        }
        break;
      case 'win': {
        const name = teamName(players, names, you, e.team);
        const text = name === 'You' ? 'You win!' : `${name} ${name.includes(' & ') ? 'win' : 'wins'}!`;
        out.push({ text, tone: toneOf(players, you, e.team), big: true, final: true });
        break;
      }
    }
  }
  return out;
}

// ---- the prompt line's calls (motion.md, "A score in pegging") ----

const NUM = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const num = (n: number) => NUM[n] ?? String(n);

/** "Fifteen for two", "Pair royal for six", "Run of three"… for one pegging score item. */
function pegPhrase(it: ScoreItem): string {
  switch (it.kind) {
    case 'fifteen': return 'Fifteen for two';
    case 'thirtyone': return 'Thirty-one for two';
    case 'pair': return it.points === 2 ? 'Pair for two' : it.points === 6 ? 'Pair royal for six' : 'Double pair royal for twelve';
    case 'run': return `Run of ${num(it.points)}`;
    default: return describeItem(it);
  }
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The call for a score in pegging or at the cut, as the prompt line carries it:
 * "Fifteen for two to Bob", "Go. One to you.", "His heels. Two for Bob."
 */
export function scoreCall(e: Extract<GameEvent, { t: 'score' }>, you: Seat, names: string[]): string {
  const to = e.seat === you ? 'you' : names[e.seat];
  const items = e.items;
  if (e.why === 'heels') return `His heels. Two for ${to}.`;
  if (items.length === 1 && (items[0].kind === 'go' || items[0].kind === 'last')) {
    return `${items[0].kind === 'go' ? 'Go' : 'Last card'}. One to ${to}.`;
  }
  if (items.length === 1) return `${pegPhrase(items[0])} to ${to}`;
  const parts = items.map((it) => pegPhrase(it).replace(/ for \w+$/, '').toLowerCase());
  return `${cap(parts.join(' and '))}: ${num(e.points)} to ${to}`;
}

// ---- the show (README answer 3) ----

export interface ShowLine {
  name: string;
  detail: string;
  /** Running total after this line. */
  running: number;
  cards: Card[];
  kind: string;
  points: number;
}

/**
 * One line per combination, said the way players count aloud (countAloud.ts), in
 * traditional order: "Fifteen two" / "7 + 8 = 15", "fifteen four", "and a pair is six".
 */
export function showLines(r: ShowResult): ShowLine[] {
  return countAloud(r.items).steps.map((st) => ({
    name: capitalise(st.phrase),
    detail: st.reason,
    running: st.running,
    cards: st.cards,
    kind: st.kind,
    points: st.points,
  }));
}

/** One row of the show's list: a single combination, or a finished group folded into one line. */
export interface ShowRow {
  key: number;
  name: string;
  detail: string;
  /** Running total after the row. */
  running: number;
  /** How many combinations the row stands for (1 for an ordinary line). */
  count: number;
  /** The combination being counted now. */
  current: boolean;
}

const GROUP_NAME: Record<string, (first: ShowLine) => string> = {
  fifteen: () => 'Fifteens',
  pair: () => 'Pairs',
  run: (l) => `Runs of ${num(l.points)}`,
};

/**
 * The rows the show's list draws (design-handback-2 §4). The steps still play one
 * at a time; once the list passes `max` lines, every finished group of the same
 * kind folds into one line ("Fifteens, eight of them: 16"), and if that is still
 * too many, so do the lines already counted in the group being counted now. A 29
 * (fifteen lines) ends as three. `current` is the index being counted, or -1 when
 * the list is drawn complete.
 */
export function showRows(lines: ShowLine[], current: number, max = 6): ShowRow[] {
  const visible = current >= 0 ? lines.slice(0, current + 1) : lines;
  const one = (l: ShowLine, i: number): ShowRow => ({ key: i, name: l.name, detail: l.detail, running: l.running, count: 1, current: i === current });
  if (visible.length <= max) return visible.map(one);
  // Runs of the same kind, as [first, last] indices.
  const groups: [number, number][] = [];
  visible.forEach((l, i) => {
    const g = groups[groups.length - 1];
    if (g && visible[g[1]].kind === l.kind) g[1] = i;
    else groups.push([i, i]);
  });
  const fold = (a: number, b: number): ShowRow => {
    const part = visible.slice(a, b + 1);
    const name = (GROUP_NAME[part[0].kind] ?? ((l: ShowLine) => `${l.name}s`))(part[0]);
    const points = part.reduce((t, l) => t + l.points, 0);
    return { key: a, name, detail: `${num(part.length)} of them: ${points}`, running: part[part.length - 1].running, count: part.length, current: false };
  };
  const build = (foldCurrent: boolean): ShowRow[] => groups.flatMap(([a, b]) => {
    const live = current >= a && current <= b;
    if (!live) return b > a ? [fold(a, b)] : [one(visible[a], a)];
    if (foldCurrent && current - a >= 2) return [fold(a, current - 1), one(visible[current], current)];
    return visible.slice(a, b + 1).map((l, k) => one(l, a + k));
  });
  const rows = build(false);
  return rows.length <= max ? rows : build(true);
}

// ---- the hand log (laptop: the right-hand column) ----

export interface LogEntry {
  id: number;
  text: string;
  value: string;
  score: boolean;
  tone: number | null;
}

/** Log rows for one message's events. Returns null at a new deal (the log starts over). */
export function logEntries(
  events: GameEvent[], you: Seat, names: string[], players: PlayerCount, nextId: () => number,
): { reset: boolean; rows: LogEntry[] } {
  const who = (s: Seat) => (s === you ? 'You' : names[s]);
  const whose = (s: Seat) => (s === you ? 'Your' : possessive(names[s]));
  const tone = (s: Seat) => toneOfSeat(players, you, s);
  let reset = false;
  let rows: LogEntry[] = [];
  const row = (text: string, value: string, score: boolean, t: number | null) =>
    rows.push({ id: nextId(), text, value, score, tone: t });
  for (const e of events) {
    switch (e.t) {
      case 'deal':
        reset = true;
        rows = [];
        row(`${whose(e.dealer)} deal`, `Deal ${e.handNo}`, false, tone(e.dealer));
        break;
      case 'discard':
        row(`${who(e.seat)} ${e.seat === you ? 'send' : 'sends'} ${discardCount(players) === 2 ? 'two' : 'one'} to the crib`, '', false, tone(e.seat));
        break;
      case 'starter':
        row('Starter', cardText(e.card), false, null);
        break;
      case 'play':
        row(`${who(e.seat)} ${e.seat === you ? 'play' : 'plays'} ${cardText(e.card)}`, String(e.count), false, tone(e.seat));
        break;
      case 'go':
        row(e.seat === you ? 'You say go' : `${names[e.seat]} says go`, '', false, tone(e.seat));
        break;
      case 'score':
        if (e.why === 'hand' || e.why === 'crib') row(`${whose(e.seat)} ${e.why}`, `+${e.points}`, true, tone(e.seat));
        else row(`${who(e.seat)}: ${e.items.map(describeItem).join(', ')}`, `+${e.points}`, true, tone(e.seat));
        break;
      case 'win': {
        const name = teamName(players, names, you, e.team);
        row(name === 'You' ? 'You win' : `${name} ${name.includes(' & ') ? 'win' : 'wins'}`, '121', true, toneOf(players, you, e.team));
        break;
      }
      default:
        break;
    }
  }
  return { reset, rows };
}

const LOG_SIZE = 12;

export function useCallouts() {
  const [active, setActive] = useState<(Line & { until: number })[]>([]);
  const [log, setLog] = useState<Line[]>([]);
  const nextId = useRef(1);

  const push = useCallback((items: Described[]) => {
    if (!items.length) return;
    const now = Date.now();
    const lines = items.map((d) => ({ id: nextId.current++, text: d.text, tone: d.tone, big: d.big, final: d.final }));
    setLog((l) => [...lines.map(({ id, text, tone }) => ({ id, text, tone })), ...l.slice(0, LOG_SIZE)].slice(0, LOG_SIZE));
    const finals = lines.filter((l) => l.final);
    if (finals.length) {
      setActive(finals.map(({ id, text, tone }) => ({ id, text, tone, until: now + 4000 })));
      return;
    }
    const big = lines.filter((l) => l.big);
    if (big.length) {
      const hold = 1900 + 700 * big.length;
      setActive((a) => [...a, ...big.map(({ id, text, tone }) => ({ id, text, tone, until: now + hold }))].slice(-3));
    }
  }, []);

  useEffect(() => {
    if (!active.length) return;
    const soonest = Math.min(...active.map((a) => a.until));
    const t = setTimeout(() => {
      const now = Date.now();
      setActive((a) => a.filter((x) => x.until > now + 30));
    }, Math.max(0, soonest - Date.now()));
    return () => clearTimeout(t);
  }, [active]);

  return { active: active as Line[], log, push };
}
