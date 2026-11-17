// Pure helpers for what the pegging stage shows, from the server's `played` and `pile`.
import { type Card, value } from '../../shared/cards';
import type { Play, PlayerView } from '../../shared/game';
import type { ScoreItem } from '../../shared/scoring';

/**
 * Split every card played this hand into counts. Exact: the engine only resets
 * the count at 31 or when nobody can play, and in the second case every card
 * still held would take the old count past 31, so the next card always would.
 */
export function countSegments(played: Play[]): { cards: Play[]; total: number; closed: boolean }[] {
  const out: { cards: Play[]; total: number; closed: boolean }[] = [];
  let cur: Play[] = [];
  let c = 0;
  for (const p of played) {
    const v = value(p.card);
    if (cur.length && c + v > 31) {
      out.push({ cards: cur, total: c, closed: true });
      cur = [];
      c = 0;
    }
    cur.push(p);
    c += v;
    if (c === 31) {
      out.push({ cards: cur, total: c, closed: true });
      cur = [];
      c = 0;
    }
  }
  if (cur.length) out.push({ cards: cur, total: c, closed: false });
  return out;
}

export interface PegDisplay {
  count: number;
  current: Play[];
  last: { cards: Play[]; total: number; seat: number } | null;
}

/**
 * What the stage shows. `frozen` holds a count that has just ended (31 or a go)
 * on the stage, with its total, until the peg has moved; then it slides to the
 * "last count" row.
 */
export function pegDisplay(view: Pick<PlayerView, 'played' | 'pile' | 'count'>, frozen: boolean): PegDisplay {
  const segs = countSegments(view.played);
  const open = view.pile.length > 0 && segs.length > 0 && !segs[segs.length - 1].closed;
  // A trailing segment the engine has already reset (pile empty) counts as closed.
  const closed = segs.map((s, i) => (i === segs.length - 1 && !open ? { ...s, closed: true } : s)).filter((s) => s.closed);
  const lastOf = (s: { cards: Play[]; total: number } | undefined) =>
    s ? { cards: s.cards, total: s.total, seat: s.cards[s.cards.length - 1].seat } : null;
  if (frozen && !open && closed.length) {
    const cur = closed[closed.length - 1];
    return { count: cur.total, current: cur.cards, last: lastOf(closed[closed.length - 2]) };
  }
  return { count: open ? view.count : 0, current: open ? view.pile : [], last: lastOf(closed[closed.length - 1]) };
}

/** The cards a pegging score lights (empty for a go). */
export function litCards(items: ScoreItem[]): Card[] {
  return [...new Set(items.flatMap((it) => it.cards))];
}
