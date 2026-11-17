// Pure wording and arithmetic for the league screens (no React), so it can be tested.
import { type PlayerCount, teamCount, teamOf } from '../../shared/game';
import type { Fixture, PlayerCard } from '../../shared/league';

/** "You v Nan", "You & Ruth v Grandad & Tom", "You v Nan v Tom". */
export function fixtureTitle(f: Fixture, meId: string): string {
  const nm = (p: PlayerCard) => (p.id === meId ? 'You' : p.name);
  if (f.players === 4) {
    const side = (a: number, b: number) => {
      const xs = [f.seats[a], f.seats[b]];
      xs.sort((x, y) => (x.id === meId ? -1 : y.id === meId ? 1 : 0));
      return xs.map(nm).join(' & ');
    };
    const mine = f.seats.findIndex((p) => p.id === meId);
    const first = mine >= 0 && mine % 2 === 1 ? 1 : 0;
    return `${side(first, first + 2)} v ${side(1 - first, 3 - first)}`;
  }
  const xs = [...f.seats].sort((x, y) => (x.id === meId ? -1 : y.id === meId ? 1 : 0));
  return xs.map(nm).join(' v ');
}

export function fixtureKind(f: Fixture, meId: string): string {
  if (f.kind === 'round-robin') return 'Round robin';
  return f.createdBy.id === meId ? 'Your challenge' : `Challenge from ${f.createdBy.name}`;
}

/** "Next game: Nan", "Next game: you & Ruth v Grandad & Tom". */
export function nextLabel(f: Fixture, meId: string): string {
  const others = f.seats.filter((p) => p.id !== meId);
  if (f.players === 2) return `Next game: ${others[0]?.name ?? 'your queue'}`;
  if (f.players === 3) return `Next game: ${others.map((p) => p.name).join(' & ')}`;
  const mine = f.seats.findIndex((p) => p.id === meId);
  const partner = f.seats[(mine + 2) % 4];
  return `Next game: you & ${partner?.name ?? '?'}`;
}

const hex = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const distance = (a: string, b: string) => {
  const [x, y] = [hex(a), hex(b)];
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
};
/** The two players' own colours, unless they are missing or too alike: then tomato and enamel blue. */
export function pairColours(a: PlayerCard, b: PlayerCard): [string, string] {
  const ca = a.avatar?.colour;
  const cb = b.avatar?.colour;
  if (ca && cb && distance(ca, cb) > 90) return [ca, cb];
  if (ca && !cb && distance(ca, '#2B5278') > 90) return [ca, '#2B5278'];
  if (cb && !ca && distance(cb, '#BE3228') > 90) return ['#BE3228', cb];
  return ['#BE3228', '#2B5278'];
}

export interface TeamLine {
  team: number;
  players: (PlayerCard | null)[];
  score: number;
  skunk: number;
}

/** Teams of a game with their players and scores, winner (or leader) first. */
export function teamLines(players: PlayerCount, seats: (PlayerCard | null)[], scores: number[], skunk: number[] = [], winner: number | null = null): TeamLine[] {
  const out: TeamLine[] = Array.from({ length: teamCount(players) }, (_, t) => ({ team: t, players: [], score: scores[t] ?? 0, skunk: skunk[t] ?? 0 }));
  seats.forEach((p, s) => out[teamOf(players, s)].players.push(p));
  return out.sort((a, b) => (a.team === winner ? -1 : b.team === winner ? 1 : b.score - a.score));
}

