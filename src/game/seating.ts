// Presentation logic, kept free of JSX so any table layout can reuse it: who
// sits where relative to you, teams and their names and colours, whose crib,
// prompt and status text, and the end-of-game verdict.
import {
  type GameSummary,
  type PlayerCount,
  type PlayerView,
  type Seat,
  type SkunkLevel,
  type Team,
  discardCount,
  leftOf,
  placings,
  showSeat,
  teamCount,
  teamOf,
  teamSeats,
} from '../../shared/game';
import { possessive } from '../lib/format';

export type Relation = 'you' | 'partner' | 'opponent';
export type Position = 'bottom' | 'left' | 'opposite' | 'right';

/** Everyone else, clockwise from your left: drawn left to right across the top of the table. */
export function othersClockwise(players: PlayerCount, you: Seat): Seat[] {
  return Array.from({ length: players - 1 }, (_, i) => (you + 1 + i) % players);
}

/** Where a seat sits as seen from yours. */
export function positionOf(players: PlayerCount, you: Seat, seat: Seat): Position {
  const d = (seat - you + players) % players;
  if (d === 0) return 'bottom';
  if (players === 2) return 'opposite';
  if (players === 3) return d === 1 ? 'left' : 'right';
  return d === 1 ? 'left' : d === 2 ? 'opposite' : 'right';
}

export function relationOf(players: PlayerCount, you: Seat, seat: Seat): Relation {
  if (seat === you) return 'you';
  return teamOf(players, seat) === teamOf(players, you) ? 'partner' : 'opponent';
}

/**
 * Colour slot for a team, the same everywhere (track lane, name plate, played
 * card marker, callouts): 0 is always your team; the others follow clockwise
 * from your left.
 */
export function toneOf(players: PlayerCount, you: Seat, team: Team): number {
  const mine = teamOf(players, you);
  if (team === mine) return 0;
  const order: Team[] = [];
  for (const s of othersClockwise(players, you)) {
    const t = teamOf(players, s);
    if (t !== mine && !order.includes(t)) order.push(t);
  }
  return 1 + order.indexOf(team);
}

export const toneOfSeat = (players: PlayerCount, you: Seat, seat: Seat): number =>
  toneOf(players, you, teamOf(players, seat));

/** CSS class carrying the team colour. */
export const toneClass = (tone: number): string => `tone-${tone}`;

/** "You" or the player's name. */
export const seatName = (names: string[], you: Seat, seat: Seat): string => (seat === you ? 'You' : names[seat]);

/** "Margaret & Bob", "You & Bob", or a single name / "You" for a team of one. */
export function teamName(players: PlayerCount, names: string[], you: Seat, team: Team): string {
  const seats = teamSeats(players, team);
  // Put "You" first when it's your team.
  seats.sort((a, b) => (a === you ? -1 : b === you ? 1 : a - b));
  return seats.map((s) => seatName(names, you, s)).join(' & ');
}

/** Teams in the order lanes are drawn: yours first, then clockwise. */
export function teamsInOrder(players: PlayerCount, you: Seat): Team[] {
  return Array.from({ length: teamCount(players) }, (_, t) => t).sort(
    (a, b) => toneOf(players, you, a) - toneOf(players, you, b),
  );
}

/** "Your crib", "Bob’s crib", and in partnerships "Bob’s crib (your side)". */
export function cribLabel(players: PlayerCount, names: string[], you: Seat, dealer: Seat): string {
  if (dealer === you) return 'Your crib';
  const base = `${possessive(names[dealer])} crib`;
  return relationOf(players, you, dealer) === 'partner' ? `${base} (your side)` : base;
}

/** Lower-case form for use mid-sentence. */
export const cribPhrase = (players: PlayerCount, names: string[], you: Seat, dealer: Seat): string => {
  const l = cribLabel(players, names, you, dealer);
  return l.startsWith('Your') ? 'your crib' : l;
};

/** The label on the discard button for this many selected cards. */
export function discardPrompt(players: PlayerCount, names: string[], you: Seat, dealer: Seat, selected: number): string {
  const need = discardCount(players) - selected;
  const crib = cribPhrase(players, names, you, dealer);
  if (need <= 0) return `Send to ${crib}`;
  // Three and four players discard one: "Pick one for Dot's crib" (handoff v2 §2).
  if (need === discardCount(players)) return need === 2 ? `Pick two cards for ${crib}` : `Pick one for ${crib}`;
  return 'Pick one more card';
}

/** Seats that still have to do something before the game moves on. */
export function waitingOn(view: PlayerView): Seat[] {
  const all = Array.from({ length: view.players }, (_, s) => s);
  switch (view.phase) {
    case 'discard':
      return all.filter((s) => !view.discarded[s]);
    case 'cut':
      return [leftOf(view.players, view.dealer)];
    case 'peg':
      return [view.turn];
    case 'show':
      return all.filter((s) => !view.acks[s]);
    default:
      return [];
  }
}

/** "Bob", "Bob and Carol", "Bob, Carol and Dave". */
export function listNames(xs: string[]): string {
  if (xs.length <= 1) return xs.join('');
  return `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
}

/** Status line when it isn't your move. */
export function waitingText(view: PlayerView, names: string[], online: boolean[]): string {
  const others = waitingOn(view).filter((s) => s !== view.you);
  const who = listNames(others.map((s) => (online[s] === false ? `${names[s]} (offline)` : names[s])));
  switch (view.phase) {
    case 'discard':
      return others.length ? `Waiting for ${who}…` : 'Cutting the deck…';
    case 'cut':
      return `${who} is cutting…`;
    case 'peg':
      return `${who}’s turn…`;
    case 'show':
      return `Waiting for ${who}…`;
    default:
      return '';
  }
}

/** Title for the show panel, and where we are in the count. */
export function showHeading(view: PlayerView, names: string[]): { title: string; step: string; tone: number } {
  const r = view.showResult!;
  const whose = r.seat === view.you ? 'Your' : possessive(names[r.seat]);
  const title = `${whose} ${r.crib ? 'crib' : 'hand'}`;
  const last = view.players; // the crib
  const what = r.crib ? 'The crib' : showSeat(view.players, view.dealer, view.showStep) === view.dealer ? 'Dealer’s hand' : 'Hand';
  return { title, step: `${what} · ${view.showStep + 1} of ${last + 1}`, tone: toneOfSeat(view.players, view.you, r.seat) };
}

export interface Standing {
  team: Team;
  name: string;
  score: number;
  place: number;
  skunk: SkunkLevel;
  tone: number;
  seats: Seat[];
}

/** Teams by finishing place (ties keep table order). */
export function standings(view: PlayerView, names: string[]): Standing[] {
  const places = placings(view.scores, view.winner);
  return teamsInOrder(view.players, view.you)
    .map((team) => ({
      team,
      name: teamName(view.players, names, view.you, team),
      score: view.scores[team],
      place: places[team],
      skunk: view.skunk[team] ?? 0,
      tone: toneOf(view.players, view.you, team),
      seats: teamSeats(view.players, team),
    }))
    .sort((a, b) => a.place - b.place);
}

const SKUNK_TEXT = ['', 'skunked', 'double skunked'];

/** The headline and the per-loser lines for the game-over screen. */
export function verdict(view: PlayerView, names: string[]): { head: string; won: boolean; lines: string[] } {
  const winner = view.winner as Team;
  const won = teamOf(view.players, view.you) === winner;
  const winName = teamName(view.players, names, view.you, winner);
  const plural = teamSeats(view.players, winner).length > 1;
  const head = won ? (plural ? `${winName} win!` : 'You win!') : `${winName} ${plural ? 'win' : 'wins'}`;
  const ordinals = ['', '1st', '2nd', '3rd', '4th'];
  const lines: string[] = [];
  for (const st of standings(view, names)) {
    if (st.team === winner) continue;
    const yours = st.team === teamOf(view.players, view.you);
    const verb = st.name === 'You' || yours || st.seats.length > 1 ? 'are' : 'is';
    const place = view.players === 3 ? `${ordinals[st.place]}: ` : '';
    lines.push(st.skunk ? `${place}${st.name} ${verb} ${SKUNK_TEXT[st.skunk]} (${st.score})` : `${place}${st.name} ${st.score} — no skunk`);
  }
  return { head, won, lines };
}

/** "you", "Bob", "you and Carol", "Bob & Dave". */
const joinNames = (xs: string[]) => listNames(xs);

/**
 * What the game-over stage says. The skunk line names the recipient: "Bob gets the
 * kiwi" for the winner, "You get the kiwi" for the loser (motion.md). Otherwise a
 * line of table talk chosen by the margin, so it reads the same on every screen.
 */
export function overCopy(view: PlayerView, names: string[]): {
  headline: string; detail: string; skunk: SkunkLevel; plate: string; won: boolean;
} {
  const n = view.players;
  const winner = view.winner as Team;
  const mine = teamOf(n, view.you);
  const won = mine === winner;
  const table = standings(view, names);
  const losers = table.filter((s) => s.team !== winner);
  const skunked = losers.filter((s) => s.skunk > 0);
  const skunk = skunked.reduce<number>((m, s) => Math.max(m, s.skunk), 0) as SkunkLevel;
  const winName = teamName(n, names, view.you, winner);
  const winPlural = teamSeats(n, winner).length > 1;
  const target = view.target;
  const plate = skunk === 2 ? 'DOUBLE SKUNK' : 'SKUNKED';
  const ordinals = ['', '1st', '2nd', '3rd', '4th'];

  if (n === 3) {
    const standingsLine = losers
      .map((s) => `${ordinals[s.place]} ${s.name === 'You' ? 'you' : s.name} ${s.score}`)
      .join(' · ');
    if (skunked.length) {
      const who = skunked.map((s) => s.name);
      const you = who.includes('You');
      const ordered = you ? ['You', ...who.filter((w) => w !== 'You')] : who;
      const text = joinNames(ordered);
      const verb = ordered.length > 1 || you ? 'get' : 'gets';
      return { headline: `${text} ${verb} the kiwi${skunk === 2 ? ', twice over' : ''}`, detail: `${won ? 'You win' : `${winName} wins`}. ${standingsLine}`, skunk, plate, won };
    }
    return { headline: won ? 'You win!' : `${winName} wins`, detail: standingsLine, skunk, plate, won };
  }

  // Two sides: two players, or two partnerships.
  const loser = losers[0];
  const theirs = loser.score;
  const loserName = loser.name; // "Bob", "You", "You & Carol", "Bob & Dave"
  if (loser.skunk) {
    const plural = loserName === 'You' || loser.seats.length > 1;
    const headline = `${loserName} ${plural ? 'get' : 'gets'} ${loser.skunk === 2 ? 'two kiwis' : 'the kiwi'}`;
    const line = loser.skunk === 2 ? `Under ${Math.ceil(target / 2)}: a double skunk.` : `Under ${Math.ceil((target * 3) / 4)}: skunked.`;
    const detail = won
      ? `${winPlural ? `${winName} win` : 'You win'}, ${target} to ${theirs}. ${line}`
      : `${winName} ${winPlural ? 'win' : 'wins'}, ${target} to ${theirs}. ${line}`;
    return { headline, detail, skunk, plate, won };
  }
  const margin = target - theirs;
  if (won) {
    const flavour = margin <= 5 ? 'By the skin of your teeth.' : margin <= 15 ? 'Nicely pegged.' : 'Never in doubt.';
    return { headline: winPlural ? `${winName} win!` : 'You win!', detail: `${target} to ${theirs}. ${flavour}`, skunk, plate, won };
  }
  const flavour = margin <= 5 ? 'One more hand and it was yours.' : margin <= 15 ? 'Close enough to want a rematch.' : 'The cards will come round.';
  return {
    headline: `${winName} ${winPlural ? 'win' : 'wins'}`,
    detail: `${theirs} to ${target}. ${flavour}`,
    skunk, plate, won,
  };
}

// ---- strips, status lines, the show tracker ----

/** "Ahead by 5", "Behind by 3", "Level": a team against the best of the rest. */
export function leadText(scores: number[], team: Team): string {
  const mine = scores[team] ?? 0;
  const best = Math.max(...scores.filter((_, t) => t !== team));
  const d = mine - best;
  return d > 0 ? `Ahead by ${d}` : d < 0 ? `Behind by ${-d}` : 'Level';
}

/** What a seat is doing right now, in a few words, or null. */
export function activityOf(view: PlayerView, seat: Seat, online: boolean[]): string | null {
  const you = seat === view.you;
  if (!you && online[seat] === false) return 'Offline';
  switch (view.phase) {
    case 'discard':
      return view.discarded[seat] ? (you ? null : 'Ready') : you ? null : 'Choosing…';
    case 'cut':
      return leftOf(view.players, view.dealer) === seat ? (you ? 'Your cut' : 'Cutting…') : null;
    case 'peg':
      if (view.turn === seat) return you ? 'Your turn' : 'Thinking…';
      return view.handCounts[seat] === 0 ? 'Out of cards' : null;
    case 'show':
      return view.acks[seat] && !you ? 'Ready' : null;
    default:
      return null;
  }
}

/** The status line under a name. `scores` are the scores as currently shown on the board. */
export function statusLine(view: PlayerView, seat: Seat, online: boolean[], scores: number[]): string {
  const team = teamOf(view.players, seat);
  const lead = leadText(scores, team);
  const act = activityOf(view, seat, online);
  const dealer = view.dealer === seat;
  if (seat === view.you) return [lead, dealer ? 'your crib' : null, act === 'Your turn' || act === 'Your cut' ? null : act].filter(Boolean).join(' · ');
  const bits = [act, dealer ? 'Dealer' : null].filter(Boolean);
  return bits.length ? bits.join(' · ') : lead;
}

/** The short status for a compact strip (the dealer has its own badge there): "Thinking…", "Up 8". */
export function compactStatus(view: PlayerView, seat: Seat, online: boolean[], scores: number[]): string {
  const act = activityOf(view, seat, online);
  if (act) return act;
  const team = teamOf(view.players, seat);
  const d = (scores[team] ?? 0) - Math.max(...scores.filter((_, t) => t !== team));
  return d > 0 ? `Up ${d}` : d < 0 ? `Down ${-d}` : 'Level';
}

/**
 * Line two of a compact strip during the show (handoff v2 §2): "Counting now",
 * "Counts next", "Crib next"… for the player whose hand or crib it is.
 */
export function showStatusOf(view: PlayerView, seat: Seat): string {
  const n = view.players;
  // Three cells across a 360 screen leave line two about 55 px beside the score: say less.
  const short = n === 4;
  const step = view.showStep;
  const at = (i: number) => (i === n ? view.dealer : showSeat(n, view.dealer, i));
  if (at(step) === seat) return step === n ? (short ? 'Crib now' : 'Counting crib') : short ? 'Counting' : 'Counting now';
  if (step + 1 <= n && at(step + 1) === seat) return step + 1 === n ? 'Crib next' : short ? 'Next' : 'Counts next';
  const mine = Array.from({ length: n + 1 }, (_, i) => i).filter((i) => at(i) === seat);
  if (mine.every((i) => i < step)) return 'Counted';
  return seat === view.dealer ? 'Crib last' : short ? 'Later' : 'Counts later';
}

export interface TrackerStage {
  /** "Your hand", "Sam’s hand", "Margaret’s crib". */
  name: string;
  /** Colour slot of the team that scores it. */
  tone: number;
}

/** The show's steps for the one-line tracker (four or five steps): whose hand, and who scores it. */
export function showStages(view: PlayerView, names: string[]): TrackerStage[] {
  const n = view.players;
  return Array.from({ length: n + 1 }, (_, i) => {
    const s = i === n ? view.dealer : showSeat(n, view.dealer, i);
    const whose = s === view.you ? 'Your' : possessive(names[s]);
    return { name: `${whose} ${i === n ? 'crib' : 'hand'}`, tone: toneOfSeat(n, view.you, s) };
  });
}

/** Labels for the show's step tracker: one step per hand, then the crib. */
export function showStepLabels(view: PlayerView, names: string[]): string[] {
  const n = view.players;
  return Array.from({ length: n + 1 }, (_, i) => {
    if (i === n) return 'Crib';
    const s = showSeat(n, view.dealer, i);
    return s === view.you ? (n === 2 ? 'Your hand' : 'You') : names[s];
  });
}

// ---- lobby rows ----

/** Title, detail line and badge for one game in the home-screen list. */
export function summaryText(g: GameSummary): {
  title: string;
  detail: string;
  badge: string | null;
  tone: 'is-waiting' | 'is-active' | 'is-won' | 'is-lost';
} {
  const n = g.players;
  const name = (s: Seat) => (s === g.you ? 'You' : g.seats[s]?.name ?? 'Someone');
  const team = (t: Team) =>
    teamSeats(n, t)
      .sort((a, b) => (a === g.you ? -1 : b === g.you ? 1 : a - b))
      .map(name)
      .join(' & ');
  const opp = listNames(g.opponents.map((p) => p.name)) || 'Someone';
  const scoreLine = teamsInOrder(n, g.you)
    .map((t) => `${n === 4 ? (t === g.team ? 'Us' : 'Them') : team(t)} ${g.scores[t]}`)
    .join(' · ');
  if (g.status === 'waiting') {
    const seated = g.seats.filter(Boolean).length;
    return {
      title: n === 2 ? 'Waiting for an opponent' : `Waiting for players · ${seated} of ${n}`,
      detail: `Code ${g.code} · tap to share the link`,
      badge: n === 2 ? null : `${n} players`,
      tone: 'is-waiting',
    };
  }
  if (g.status === 'active') {
    const mine = g.scores[g.team];
    const best = Math.max(...g.scores.filter((_, t) => t !== g.team));
    return {
      title: n === 4 ? `${team(g.team)} vs ${opp.replace(' and ', ' & ')}` : `vs ${opp}`,
      detail: scoreLine,
      badge: mine > best ? 'ahead' : mine < best ? 'behind' : 'level',
      tone: 'is-active',
    };
  }
  const won = g.winner === g.team;
  const ordinal = ['', '1st', '2nd', '3rd'][g.place ?? 0] ?? '';
  const title =
    n === 4
      ? `${team(g.team)} ${won ? 'beat' : 'lost to'} ${opp.replace(' and ', ' & ')}`
      : n === 3
        ? `${ordinal} vs ${opp}`
        : won ? `Beat ${opp}` : `Lost to ${opp}`;
  const skunk = won ? Math.max(...g.skunk) : g.skunk[g.team];
  return {
    title,
    detail: scoreLine,
    badge: skunk ? (skunk === 2 ? 'double skunk' : 'skunk') : null,
    tone: won ? 'is-won' : 'is-lost',
  };
}

/**
 * The text on each player's owner chip (handoff v3): one letter, or two when a letter
 * repeats within a team. Margaret B. and Margaret T. are MB and MT; Dave and Dot are
 * Da and Do; two plain Margarets are M1 and M2.
 */
export function chipLabels(players: PlayerCount, names: string[]): string[] {
  const letters = (name: string) => name.replace(/[^\p{L}\p{N}]/gu, '');
  const first = (name: string) => (letters(name)[0] ?? '?').toUpperCase();
  return names.map((name, i) => {
    const clash = names.filter((q, j) => j !== i && teamOf(players, j as Seat) === teamOf(players, i as Seat) && first(q) === first(name));
    if (!clash.length) return first(name);
    const a = letters(name);
    for (let k = 1; k < a.length; k++) {
      if (clash.every((q) => (letters(q)[k] ?? '').toLowerCase() !== a[k].toLowerCase())) return first(name) + a[k];
    }
    return first(name) + (i + 1);
  });
}
