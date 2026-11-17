// League statistics, computed from stored records only: finished games with
// their seats (games / game_players) and the flattened hand rows (hand_seats).
// Everything here is pure; the caller decides which games count (finished,
// not voided, optionally one season).
import type { Card } from '../../shared/cards.js';
import { type PlayerCount, type SkunkLevel, teamCount, teamOf } from '../../shared/game.js';
import {
  type Averages,
  type H2HSide,
  type HallOfFame,
  type HandHighlight,
  type HeadToHead,
  type Honour,
  type HonourKind,
  type HonourOccurrence,
  HONOUR_KINDS,
  type PlayerCard,
  type PlayerStats,
  type RecordLine,
  type Result,
  type ResultChip,
  type Season,
  type StandingRow,
  type Streak,
} from '../../shared/league.js';
import type { HandSeatRow } from './store.js';

/** A counted game: finished, not voided. */
export interface GameRec {
  code: string;
  players: PlayerCount;
  seasonId: number;
  createdAt: string;
  finishedAt: string;
  /** Tie-break for games finished in the same millisecond. */
  seq: number;
  /** By team. */
  scores: number[];
  winnerTeam: number;
  /** By team. */
  skunk: SkunkLevel[];
  /** Player id by seat. */
  seats: string[];
  /** Finishing place by seat (1 = won). */
  places: number[];
}

export type HandRec = HandSeatRow & { finished_at: string };

export interface Outcome {
  game: GameRec;
  seat: number;
  team: number;
  won: boolean;
  matchPoints: number;
  /** Won: the worst skunk among the losers. */
  skunkGiven: SkunkLevel;
  /** Your team's skunk level. */
  skunkTaken: SkunkLevel;
  pointsFor: number;
  /** The best opposing score. */
  pointsAgainst: number;
}

const chronological = (a: GameRec, b: GameRec) =>
  a.finishedAt < b.finishedAt ? -1 : a.finishedAt > b.finishedAt ? 1 : a.seq - b.seq;

export function outcome(g: GameRec, playerId: string): Outcome | null {
  const seat = g.seats.indexOf(playerId);
  if (seat < 0) return null;
  const team = teamOf(g.players, seat);
  const teams = Array.from({ length: teamCount(g.players) }, (_, t) => t);
  const won = team === g.winnerTeam;
  const worstLoser = Math.max(...teams.filter((t) => t !== g.winnerTeam).map((t) => g.skunk[t])) as SkunkLevel;
  return {
    game: g,
    seat,
    team,
    won,
    matchPoints: won ? 2 + worstLoser : 0,
    skunkGiven: won ? worstLoser : 0,
    skunkTaken: g.skunk[team],
    pointsFor: g.scores[team],
    pointsAgainst: Math.max(...teams.filter((t) => t !== team).map((t) => g.scores[t])),
  };
}

/** A player's outcomes in these games, oldest first. */
export const outcomesFor = (games: GameRec[], playerId: string): Outcome[] =>
  [...games].sort(chronological).map((g) => outcome(g, playerId)).filter((o): o is Outcome => o !== null);

export const emptyLine = (): RecordLine => ({
  played: 0, won: 0, lost: 0, matchPoints: 0, winRate: 0,
  skunksGiven: 0, skunksTaken: 0, doubleSkunksGiven: 0, doubleSkunksTaken: 0, pointsFor: 0, pointsAgainst: 0,
});

export function lineOf(outcomes: Outcome[]): RecordLine {
  const l = emptyLine();
  for (const o of outcomes) {
    l.played++;
    if (o.won) l.won++;
    else l.lost++;
    l.matchPoints += o.matchPoints;
    if (o.skunkGiven >= 1) l.skunksGiven++;
    if (o.skunkGiven === 2) l.doubleSkunksGiven++;
    if (o.skunkTaken >= 1) l.skunksTaken++;
    if (o.skunkTaken === 2) l.doubleSkunksTaken++;
    l.pointsFor += o.pointsFor;
    l.pointsAgainst += o.pointsAgainst;
  }
  l.winRate = l.played ? l.won / l.played : 0;
  return l;
}

export function streaks(results: Result[]): { current: Streak | null; longestWin: number } {
  let longestWin = 0;
  let run = 0;
  let prev: Result | null = null;
  for (const r of results) {
    run = r === prev ? run + 1 : 1;
    prev = r;
    if (r === 'W') longestWin = Math.max(longestWin, run);
  }
  return { current: prev ? { result: prev, length: run } : null, longestWin };
}

const chip = (o: Outcome): ResultChip => ({
  code: o.game.code,
  result: o.won ? 'W' : 'L',
  players: o.game.players,
  finishedAt: o.game.finishedAt,
  score: o.pointsFor,
  opponentScore: o.pointsAgainst,
  skunk: o.won ? o.skunkGiven : o.skunkTaken,
});

// ---- standings ----

export function standings(games: GameRec[], members: PlayerCard[]): StandingRow[] {
  const rows = members.map((player) => {
    const os = outcomesFor(games, player.id);
    const l = lineOf(os);
    const { current } = streaks(os.map((o) => (o.won ? 'W' : 'L')));
    const row: StandingRow = {
      rank: 0,
      player,
      played: l.played,
      won: l.won,
      lost: l.lost,
      matchPoints: l.matchPoints,
      winRate: l.winRate,
      skunksGiven: l.skunksGiven,
      skunksTaken: l.skunksTaken,
      doubleSkunksGiven: l.doubleSkunksGiven,
      doubleSkunksTaken: l.doubleSkunksTaken,
      pointsFor: l.pointsFor,
      pointsAgainst: l.pointsAgainst,
      pointDifference: l.pointsFor - l.pointsAgainst,
      streak: current,
      lastFive: os.slice(-5).reverse().map(chip),
    };
    return row;
  });
  const key = (r: StandingRow) => [r.played > 0 ? 1 : 0, r.matchPoints, r.winRate, r.pointDifference];
  const cmp = (a: StandingRow, b: StandingRow) => {
    const ka = key(a);
    const kb = key(b);
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return kb[i] - ka[i];
    return 0;
  };
  rows.sort((a, b) => cmp(a, b) || a.player.name.localeCompare(b.player.name) || (a.player.id < b.player.id ? -1 : 1));
  rows.forEach((r, i) => {
    r.rank = i > 0 && cmp(rows[i - 1], r) === 0 ? rows[i - 1].rank : i + 1;
  });
  return rows;
}

// ---- hands ----

export function averages(hands: HandRec[]): Averages {
  const a: Averages = { hand: null, handTotal: 0, hands: 0, crib: null, cribTotal: 0, cribs: 0, pegging: null, peggingTotal: 0, peggingHands: 0 };
  for (const h of hands) {
    if (h.hand_points !== null) {
      a.hands++;
      a.handTotal += h.hand_points;
    }
    if (h.is_dealer && h.crib_points !== null) {
      a.cribs++;
      a.cribTotal += h.crib_points;
    }
    if (h.pegged_out) {
      a.peggingHands++;
      a.peggingTotal += h.peg_points;
    }
  }
  a.hand = a.hands ? a.handTotal / a.hands : null;
  a.crib = a.cribs ? a.cribTotal / a.cribs : null;
  a.pegging = a.peggingHands ? a.peggingTotal / a.peggingHands : null;
  return a;
}

const highlight = (h: HandRec, crib: boolean): HandHighlight => ({
  code: h.game_code,
  handNo: h.hand_no,
  at: h.finished_at,
  cards: JSON.parse(crib ? h.crib_cards! : h.hand_cards) as Card[],
  starter: h.starter!,
  points: (crib ? h.crib_points : h.hand_points)!,
  crib,
});

/** The highest counted hand (or crib); the earliest wins a tie. Rows are oldest first. */
export function best(hands: HandRec[], crib: boolean): HandHighlight | null {
  let top: HandRec | null = null;
  for (const h of hands) {
    const pts = crib ? (h.is_dealer ? h.crib_points : null) : h.hand_points;
    if (pts === null) continue;
    const topPts = top ? (crib ? top.crib_points! : top.hand_points!) : -1;
    if (pts > topPts) top = h;
  }
  return top ? highlight(top, crib) : null;
}

// ---- honours ----

const handOccurrence = (h: HandRec, crib: boolean): HonourOccurrence => ({
  code: h.game_code,
  at: h.finished_at,
  handNo: h.hand_no,
  cards: JSON.parse(crib ? h.crib_cards! : h.hand_cards) as Card[],
  starter: h.starter,
});

const gameOccurrence = (g: GameRec): HonourOccurrence => ({ code: g.code, at: g.finishedAt, handNo: null, cards: null, starter: null });

/** Every occurrence of every honour for one player, oldest first. */
export function honourOccurrences(games: GameRec[], hands: HandRec[], playerId: string): Record<HonourKind, HonourOccurrence[]> {
  const out = Object.fromEntries(HONOUR_KINDS.map((k) => [k, [] as HonourOccurrence[]])) as Record<HonourKind, HonourOccurrence[]>;
  for (const h of hands) {
    if (h.player_id !== playerId) continue;
    for (const [pts, crib] of [[h.hand_points, false], [h.is_dealer ? h.crib_points : null, true]] as const) {
      if (pts === 29) out['twenty-nine'].push(handOccurrence(h, crib));
      if (pts === 28) out['twenty-eight'].push(handOccurrence(h, crib));
      if (pts === 0 && !crib) out.nineteen.push(handOccurrence(h, crib));
    }
  }
  for (const o of outcomesFor(games, playerId)) {
    if (o.skunkGiven === 2) out['double-skunk'].push(gameOccurrence(o.game));
    if (o.skunkTaken >= 1) out.kiwi.push(gameOccurrence(o.game));
  }
  for (const k of HONOUR_KINDS) out[k].sort((x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : 0));
  return out;
}

const honourOf = (kind: HonourKind, list: HonourOccurrence[]): Honour => ({
  kind,
  count: list.length,
  first: list[0] ?? null,
  latest: list[list.length - 1] ?? null,
  recent: list.slice(-20).reverse(),
});

// ---- player stats ----

export function playerStats(
  games: GameRec[], hands: HandRec[], player: PlayerCard, season: Season | null,
): PlayerStats {
  const os = outcomesFor(games, player.id);
  const mine = hands.filter((h) => h.player_id === player.id);
  const sizeOf = new Map(games.map((g) => [g.code, g.players]));
  const bySize = { '2': emptyLine(), '3': emptyLine(), '4': emptyLine() };
  const averagesBySize = { '2': averages([]), '3': averages([]), '4': averages([]) };
  for (const n of [2, 3, 4] as const) {
    bySize[String(n) as '2'] = lineOf(os.filter((o) => o.game.players === n));
    averagesBySize[String(n) as '2'] = averages(mine.filter((h) => sizeOf.get(h.game_code) === n));
  }
  const st = streaks(os.map((o) => (o.won ? 'W' : 'L')));
  const occ = honourOccurrences(games, hands, player.id);
  return {
    season,
    player,
    overall: lineOf(os),
    bySize,
    averages: averages(mine),
    averagesBySize,
    bestHand: best(mine, false),
    bestCrib: best(mine, true),
    currentStreak: st.current,
    longestWinningStreak: st.longestWin,
    honours: HONOUR_KINDS.map((k) => honourOf(k, occ[k])),
    recent: os.slice(-10).reverse().map(chip),
  };
}

// ---- head-to-head ----

export function headToHead(
  games: GameRec[], hands: HandRec[], a: PlayerCard, b: PlayerCard, season: Season | null,
): HeadToHead {
  const both = [...games].sort(chronological).filter((g) => g.seats.includes(a.id) && g.seats.includes(b.id));
  const singles = both.filter((g) => g.players === 2);
  const oa = singles.map((g) => outcome(g, a.id)!);
  const ob = singles.map((g) => outcome(g, b.id)!);
  const codes = new Set(singles.map((g) => g.code));
  const handsIn = (id: string) => hands.filter((h) => h.player_id === id && codes.has(h.game_code));

  const side = (player: PlayerCard, mineO: Outcome[], theirs: Outcome[]): H2HSide => {
    const l = lineOf(mineO);
    const results: Result[] = mineO.map((o) => (o.won ? 'W' : 'L'));
    const st = streaks(results);
    const myHands = handsIn(player.id);
    return {
      player,
      won: l.won,
      matchPoints: l.matchPoints,
      skunksGiven: l.skunksGiven,
      skunksTaken: lineOf(theirs).skunksGiven,
      doubleSkunksGiven: l.doubleSkunksGiven,
      doubleSkunksTaken: lineOf(theirs).doubleSkunksGiven,
      pointsFor: l.pointsFor,
      currentStreak: st.current?.result === 'W' ? st.current.length : 0,
      longestStreak: st.longestWin,
      averages: averages(myHands),
      bestHand: best(myHands, false),
    };
  };

  let aw = 0;
  let bw = 0;
  const timeline = singles.map((g, i) => {
    const aWon = oa[i].won;
    if (aWon) aw++;
    else bw++;
    return {
      code: g.code,
      finishedAt: g.finishedAt,
      seasonId: g.seasonId,
      scores: [oa[i].pointsFor, ob[i].pointsFor] as [number, number],
      winner: aWon ? a.id : b.id,
      skunk: (aWon ? ob[i].skunkTaken : oa[i].skunkTaken) as SkunkLevel,
      record: [aw, bw] as [number, number],
    };
  });

  const partnerGames = both.filter((g) => g.players === 4 && teamOf(4, g.seats.indexOf(a.id)) === teamOf(4, g.seats.indexOf(b.id)));
  const opponentGames = both.filter((g) => g.players > 2 && !partnerGames.includes(g));
  let aWon = 0, bWon = 0, neither = 0, aAhead = 0, bAhead = 0;
  for (const g of opponentGames) {
    const sa = g.seats.indexOf(a.id);
    const sb = g.seats.indexOf(b.id);
    const ta = teamOf(g.players, sa);
    const tb = teamOf(g.players, sb);
    if (g.winnerTeam === ta) aWon++;
    else if (g.winnerTeam === tb) bWon++;
    else neither++;
    if (g.places[sa] < g.places[sb]) aAhead++;
    else if (g.places[sb] < g.places[sa]) bAhead++;
  }
  const partnersWon = partnerGames.filter((g) => outcome(g, a.id)!.won).length;
  return {
    season,
    a: side(a, oa, ob),
    b: side(b, ob, oa),
    played: singles.length,
    timeline,
    partners: { played: partnerGames.length, won: partnersWon, lost: partnerGames.length - partnersWon, games: partnerGames.map((g) => g.code) },
    opponents: {
      played: opponentGames.length,
      threePlayer: opponentGames.filter((g) => g.players === 3).length,
      fourPlayer: opponentGames.filter((g) => g.players === 4).length,
      aWon, bWon, neitherWon: neither, aAhead, bAhead,
      games: opponentGames.map((g) => g.code),
    },
  };
}

// ---- hall of fame ----

export function hallOfFame(games: GameRec[], hands: HandRec[], people: PlayerCard[], season: Season | null): HallOfFame {
  const honours = HONOUR_KINDS.map((kind) => ({ kind, holders: [] as HallOfFame['honours'][number]['holders'] }));
  const streakList: { player: PlayerCard; length: number }[] = [];
  for (const p of people) {
    const occ = honourOccurrences(games, hands, p.id);
    HONOUR_KINDS.forEach((k, i) => {
      if (occ[k].length) honours[i].holders.push({ player: p, count: occ[k].length, latest: occ[k][occ[k].length - 1] });
    });
    const st = streaks(outcomesFor(games, p.id).map((o) => (o.won ? 'W' : 'L')));
    if (st.longestWin > 0) streakList.push({ player: p, length: st.longestWin });
  }
  for (const h of honours)
    h.holders.sort((x, y) => y.count - x.count || (x.latest.at > y.latest.at ? -1 : x.latest.at < y.latest.at ? 1 : 0));
  const byId = new Map(people.map((p) => [p.id, p]));
  const bestHands = hands
    .filter((h) => h.hand_points !== null && byId.has(h.player_id))
    .sort((x, y) => y.hand_points! - x.hand_points! || (x.finished_at < y.finished_at ? -1 : x.finished_at > y.finished_at ? 1 : 0))
    .slice(0, 10)
    .map((h) => ({ player: byId.get(h.player_id)!, hand: highlight(h, false) }));
  streakList.sort((x, y) => y.length - x.length || x.player.name.localeCompare(y.player.name));
  return { season, honours, bestHands, longestStreaks: streakList.slice(0, 10) };
}
