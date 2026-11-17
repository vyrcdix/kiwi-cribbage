import { describe, expect, it } from 'vitest';
import type { Fixture, PlayerCard } from '../../shared/league';
import { fixtureKind, fixtureTitle, nextLabel, pairColours, teamLines } from './league-text';
import { parseRoute } from './router';

const card = (id: string, name: string, colour?: string): PlayerCard => ({
  id, name, avatar: colour ? { emoji: '🦉', colour } : null, deck: null, fourColour: false, active: true, commissioner: false,
});
const [me, nan, ruth, tom] = [card('me', 'Bob'), card('n', 'Nan'), card('r', 'Ruth'), card('t', 'Tom')];
const fixture = (seats: PlayerCard[], over: Partial<Fixture> = {}): Fixture => ({
  id: 'f', seasonId: 1, kind: 'challenge', players: seats.length as 2 | 3 | 4, seats, createdBy: seats[0],
  createdAt: '', status: 'queued', gameCode: null, closedBy: null, closedAt: null, ...over,
});

describe('fixture wording', () => {
  it('puts you first, and partners together in four-player fixtures', () => {
    expect(fixtureTitle(fixture([nan, me]), 'me')).toBe('You v Nan');
    expect(fixtureTitle(fixture([me, nan, tom]), 'me')).toBe('You v Nan v Tom');
    // seats 0 & 2 partner against 1 & 3; you in seat 3 partner seat 1
    expect(fixtureTitle(fixture([nan, ruth, tom, me]), 'me')).toBe('You & Ruth v Nan & Tom');
    expect(nextLabel(fixture([nan, ruth, tom, me]), 'me')).toBe('Next game: you & Ruth');
    expect(nextLabel(fixture([nan, me]), 'me')).toBe('Next game: Nan');
  });
  it('says whose challenge it is', () => {
    expect(fixtureKind(fixture([nan, me]), 'me')).toBe('Challenge from Nan');
    expect(fixtureKind(fixture([me, nan]), 'me')).toBe('Your challenge');
    expect(fixtureKind(fixture([me, nan], { kind: 'round-robin' }), 'me')).toBe('Round robin');
  });
});

describe('teamLines', () => {
  it('groups seats by team and puts the winner first', () => {
    const lines = teamLines(4, [me, nan, ruth, tom], [98, 121], [0, 0], 1);
    expect(lines.map((t) => t.players.map((p) => p?.name))).toEqual([['Nan', 'Tom'], ['Bob', 'Ruth']]);
    expect(lines[0].score).toBe(121);
  });
  it('orders by score without a winner (games in progress)', () => {
    expect(teamLines(3, [me, nan, null], [10, 30, 20]).map((t) => t.score)).toEqual([30, 20, 10]);
  });
});

describe('pairColours', () => {
  it('uses the players’ own colours when they differ, else tomato and blue', () => {
    expect(pairColours(card('a', 'A', '#2f6b45'), card('b', 'B', '#be3228'))).toEqual(['#2f6b45', '#be3228']);
    expect(pairColours(card('a', 'A', '#be3228'), card('b', 'B', '#a5402a'))).toEqual(['#BE3228', '#2B5278']);
    expect(pairColours(card('a', 'A'), card('b', 'B'))).toEqual(['#BE3228', '#2B5278']);
  });
});

describe('parseRoute', () => {
  it('knows every league route', () => {
    expect(parseRoute('/league')).toEqual({ name: 'league' });
    expect(parseRoute('/stats/abc/def')).toEqual({ name: 'stats', a: 'abc', b: 'def' });
    expect(parseRoute('/players/01ABC')).toEqual({ name: 'player', id: '01ABC' });
    expect(parseRoute('/replay/ab3cd')).toEqual({ name: 'replay', code: 'AB3CD' });
    expect(parseRoute('/invite/iw9ycFAvZirRIDQFgoN-yBQfj10KADKg')).toEqual({ name: 'invite', token: 'iw9ycFAvZirRIDQFgoN-yBQfj10KADKg' });
    expect(parseRoute('/link/abcd-efgh')).toEqual({ name: 'link', code: 'ABCD-EFGH' });
    expect(parseRoute('/g/abcde')).toEqual({ name: 'game', code: 'ABCDE' });
    expect(parseRoute('/me/')).toEqual({ name: 'profile' });
    expect(parseRoute('/nope')).toEqual({ name: 'unknown' });
  });
});
