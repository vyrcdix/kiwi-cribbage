// Development only (/dev/table): the real Table driven by fixture states, for states a
// real game rarely reaches (a 29, a double skunk, eight cards in one count). Not
// routed in production builds.
//   /dev/table?p=2|3|4&s=deal|cut|peg|peg8|show|show29|over|over2
import { useEffect, useState } from 'react';
import { card } from '../../shared/cards';
import type { GameEvent, PlayerCount, PlayerView, Play } from '../../shared/game';
import { scoreHand } from '../../shared/scoring';
import type { Beat } from '../game/director';
import { Table } from '../game/Table';
import type { ConnStatus, StateMsg } from '../lib/useGameSocket';
import { CvdSheet, TreatmentSheet } from './Sheets';

const NAMES = ['Margaret', 'Bob', 'Carol', 'Dave'];
// ?names=Margaret,Christabel-Anne,… to try longer names in the strips.
const namesFrom = (q: URLSearchParams, n: number) => (q.get('names')?.split(',') ?? NAMES).concat(NAMES).slice(0, n);

function base(n: PlayerCount): PlayerView {
  const teams = n === 4 ? 2 : n;
  return {
    you: 0, players: n, target: 121, handNo: 3, dealer: 1, firstCut: [],
    scores: Array.from({ length: teams }, (_, t) => [72, 64, 58][t]),
    back: Array.from({ length: teams }, (_, t) => [66, 60, 51][t]),
    phase: 'discard', hand: [], handCounts: Array(n).fill(n === 2 ? 6 : 5), discarded: Array(n).fill(false),
    cribCount: n === 3 ? 1 : 0, starter: null, turn: 0, count: 0, pile: [], played: [],
    showStep: 0, showResult: null, acks: Array(n).fill(false), winner: null, skunk: Array(teams).fill(0),
    stats: Array.from({ length: n }, (_, s) => ({ peg: 12 + s, hand: 30 + 3 * s, crib: 8 + s, best: 12 + s })),
  };
}

function fixture(n: PlayerCount, s: string): { view: PlayerView; prev?: PlayerView; events?: GameEvent[] } {
  const v = base(n);
  const hand6 = [card(0, 0), card(4, 1), card(4, 2), card(6, 3), card(9, 0), card(12, 1)];
  switch (s) {
    case 'deal':
      return { view: { ...v, hand: n === 2 ? hand6 : hand6.slice(0, 5), discarded: v.discarded.map((_, i) => i === 2) } };
    case 'cut':
      return { view: { ...v, phase: 'cut', hand: hand6.slice(0, 4), handCounts: Array(n).fill(4), cribCount: 4, discarded: Array(n).fill(true), dealer: n - 1 } };
    case 'peg':
    case 'peg8': {
      const seq: [number, number][] = s === 'peg8'
        ? [[0, 0], [0, 1], [1, 0], [1, 1], [2, 2], [2, 3], [3, 0], [3, 1]]
        : [[9, 2], [12, 3], [10, 1], [4, 0], [5, 2], [3, 1]];
      const played: Play[] = seq.map(([r, su], i) => ({ card: card(r, su), seat: i % n }));
      const pile = s === 'peg8' ? played : played.slice(3);
      const count = pile.reduce((a, p) => a + Math.min(10, (p.card % 13) + 1), 0);
      return {
        view: {
          ...v, phase: 'peg', starter: card(7, 2), cribCount: 4, discarded: Array(n).fill(true),
          hand: [card(1, 0), card(11, 3)], handCounts: Array(n).fill(2), played, pile, count, turn: 0,
        },
      };
    }
    case 'show':
    case 'show29':
    case 'show7':
    case 'showroyal':
    case 'show0': {
      // show7: two fifteens and a run (3 4 5 K, starter 8); showroyal: a pair royal (9 9 9 2, starter Q);
      // show0: nothing (2 4 6 8, starter Q).
      const HANDS: Record<string, [number[], number]> = {
        show: [[card(3, 0), card(4, 1), card(5, 2), card(10, 3)], card(4, 0)],
        show29: [[card(4, 0), card(4, 1), card(4, 3), card(10, 2)], card(4, 2)],
        show7: [[card(2, 0), card(3, 1), card(4, 2), card(12, 3)], card(7, 0)],
        showroyal: [[card(8, 0), card(8, 1), card(8, 2), card(1, 3)], card(11, 0)],
        show0: [[card(1, 0), card(3, 1), card(5, 2), card(7, 3)], card(11, 0)],
      };
      const [cards, starter] = HANDS[s];
      const { items, total } = scoreHand(cards, starter);
      const scores = [...v.scores];
      const back = [...v.back];
      back[0] = scores[0];
      scores[0] = scores[0] + total;
      const prev: PlayerView = { ...v, phase: 'peg', starter, cribCount: 4, discarded: Array(n).fill(true), handCounts: Array(n).fill(0), hand: [] };
      return {
        prev,
        view: { ...prev, phase: 'show', scores, back, showStep: n - 2, showResult: { seat: 0, crib: false, cards, items, total } },
        events: [{ t: 'score', seat: 0, team: 0, items, points: total, why: 'hand' }],
      };
    }
    case 'over':
    case 'over2': {
      const lose = s === 'over2' ? 55 : 84;
      const scores = v.scores.map((_, t) => (t === 1 ? 121 : t === 0 ? lose : 97));
      return { view: { ...v, phase: 'over', scores, back: scores.map((x) => x - 6), winner: 1, skunk: scores.map((x, t) => (t === 1 ? 0 : x < 61 ? 2 : x < 91 ? 1 : 0)) as (0 | 1 | 2)[] } };
    }
    default:
      return { view: v };
  }
}

/** /dev/table, /dev/sheet or /dev/cvd. */
export function Preview() {
  if (location.pathname.startsWith('/dev/sheet')) return <TreatmentSheet />;
  if (location.pathname.startsWith('/dev/cvd')) return <CvdSheet />;
  return <TablePreview />;
}

function TablePreview() {
  const q = new URLSearchParams(location.search);
  const n = Number(q.get('p') ?? 2) as PlayerCount;
  const s = q.get('s') ?? 'peg';
  const f = fixture(n, s);
  const names = namesFrom(q, n);
  const [view, setView] = useState<PlayerView>(f.prev ?? f.view);
  const [beat, setBeat] = useState<Beat>({ id: 1, events: [], fresh: true });
  useEffect(() => {
    if (!f.prev) return;
    const t = setTimeout(() => {
      setView(f.view);
      setBeat({ id: 2, events: f.events ?? [], fresh: false });
    }, 400);
    return () => clearTimeout(t);
  }, []);
  const msg: StateMsg = {
    t: 'state', code: 'DEMO1', status: s.startsWith('over') ? 'finished' : 'active',
    players: names.map((name, i) => ({ id: String(i), name })), online: Array(n).fill(true),
    creator: '0', you: 0, view, events: [], next: null,
  };
  return (
    <Table
      msg={msg} view={view} names={names} status={(q.get('conn') as ConnStatus | null) ?? 'open'} pending={false}
      act={() => undefined} beat={beat} toast={null}
      rematch={{ busy: false, error: null, go: () => undefined }}
      emojis={q.get('emoji') ? ['🐶', '🦊', '🐸', '🐼'].slice(0, n) : undefined}
    />
  );
}
