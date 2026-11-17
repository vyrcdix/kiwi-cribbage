// Turns server events into short announcements, and keeps the running log.
import { useCallback, useEffect, useRef, useState } from 'react';
import { type GameEvent, type Seat, other } from '../../shared/game';
import { describeItem } from '../../shared/scoring';
import { cardText, possessive } from '../lib/format';

export interface Line {
  id: number;
  text: string;
  /** Who it's about, for colouring; null for neutral. */
  seat: Seat | null;
}

interface Described {
  text: string;
  seat: Seat | null;
  /** Shown prominently, not just logged. */
  big: boolean;
  /** Replaces whatever else is showing (the win). */
  final?: boolean;
}

export function describeEvents(events: GameEvent[], you: Seat, names: [string, string]): Described[] {
  const who = (s: Seat) => (s === you ? 'You' : names[s]);
  const whose = (s: Seat) => (s === you ? 'Your' : possessive(names[s]));
  const out: Described[] = [];
  for (const e of events) {
    switch (e.t) {
      case 'firstcut':
        out.push({
          text: `Cut for deal: you ${cardText(e.cards[you])}, ${names[other(you)]} ${cardText(e.cards[other(you)])}. ${
            e.dealer === you ? 'You deal first.' : `${names[e.dealer]} deals first.`
          }`,
          seat: e.dealer,
          // The table shows the cut for the whole first discard, so just log it.
          big: false,
        });
        break;
      case 'deal':
        if (e.handNo > 1) out.push({ text: `${whose(e.dealer)} deal`, seat: e.dealer, big: true });
        break;
      case 'discard':
        if (e.seat !== you) out.push({ text: `${names[e.seat]} sent two to the crib`, seat: e.seat, big: false });
        break;
      case 'starter':
        out.push({ text: `Starter: ${cardText(e.card)}`, seat: null, big: true });
        break;
      case 'play':
        out.push({ text: `${who(e.seat)} played ${cardText(e.card)} — ${e.count}`, seat: e.seat, big: false });
        break;
      case 'go':
        out.push({ text: e.seat === you ? 'You say go' : `${names[e.seat]} says go`, seat: e.seat, big: true });
        break;
      case 'score':
        if (e.why === 'hand' || e.why === 'crib') {
          out.push({ text: `${whose(e.seat)} ${e.why}: ${e.points}`, seat: e.seat, big: false });
        } else {
          out.push({ text: `${who(e.seat)}: ${e.items.map(describeItem).join(', ')}`, seat: e.seat, big: true });
        }
        break;
      case 'win':
        out.push({ text: e.seat === you ? 'You win!' : `${names[e.seat]} wins!`, seat: e.seat, big: true, final: true });
        break;
    }
  }
  return out;
}

const LOG_SIZE = 12;

export function useCallouts() {
  const [active, setActive] = useState<(Line & { until: number })[]>([]);
  const [log, setLog] = useState<Line[]>([]);
  const nextId = useRef(1);

  const push = useCallback((items: Described[]) => {
    if (!items.length) return;
    const now = Date.now();
    const lines = items.map((d) => ({ id: nextId.current++, text: d.text, seat: d.seat, big: d.big, final: d.final }));
    setLog((l) => [...lines.map(({ id, text, seat }) => ({ id, text, seat })), ...l.slice(0, LOG_SIZE)].slice(0, LOG_SIZE));
    const finals = lines.filter((l) => l.final);
    if (finals.length) {
      setActive(finals.map(({ id, text, seat }) => ({ id, text, seat, until: now + 4000 })));
      return;
    }
    const big = lines.filter((l) => l.big);
    if (big.length) {
      const hold = 1900 + 700 * big.length;
      setActive((a) => [...a, ...big.map(({ id, text, seat }) => ({ id, text, seat, until: now + hold }))].slice(-3));
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
