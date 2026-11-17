// The league contract: every request and response body of the league API
// (membership, devices, profiles, seasons, standings, head-to-head, player
// stats, honours, pending games, the fixture queue, commissioner tools and
// hand records), plus a few pure helpers both sides can use.
//
// Endpoints (all under /api; "member" = signed in with an active membership;
// the type each returns is named after the arrow):
//   POST   /players                      public (needs an invite)  CreatePlayerRequest → 201 CreatePlayerResponse
//   POST   /invites                      member                    → 201 LeagueInvite
//   GET    /invites/:token               public                    → InviteStatus
//   POST   /link                         member                    → 201 DeviceLinkCode
//   POST   /link/redeem                  public                    RedeemLinkRequest → 201 CreatePlayerResponse
//   GET    /me                           member                    → Me
//   PATCH  /me                           member                    UpdateMeRequest → Me
//   POST   /me/sign-out                  member                    → OkResponse (this session ends)
//   GET    /me/sessions                  member                    → SessionsResponse
//   DELETE /me/sessions/:id              member (own sessions)     → OkResponse
//   GET    /league                       member                    → LeagueResponse
//   GET    /seasons                      member                    → SeasonsResponse
//   GET    /standings?season=            member                    → StandingsResponse   (default current season)
//   GET    /h2h/:a/:b?season=            member                    → HeadToHead          (default all time)
//   GET    /players/:id/stats?season=    member                    → PlayerStats         (default all time)
//   GET    /hall-of-fame?season=         member                    → HallOfFame          (default all time)
//   GET    /pending                      member                    → PendingResponse
//   GET    /results?season=&player=      member                    → ResultsResponse     (default current season)
//   GET    /games/:code/hands            game member; any member once finished → HandsResponse
//   GET    /games                        member (existing)         → { games: GameSummary[] } (+ waitingOnYou, lastMoveAt, …)
//   POST   /games/:code/remove           the game's creator, waiting only  RemovePlayerRequest → SeatingResponse
//   POST   /games/:code/leave            a seated player, waiting only     → SeatingResponse
//   POST   /fixtures                     member                    ChallengeRequest → 201 Fixture
//   GET    /fixtures?status=&season=&player=  member               → FixturesResponse
//   GET    /fixtures/mine                member                    → FixturesResponse
//   GET    /fixtures/next                member                    → NextFixtureResponse
//   POST   /fixtures/:id/start           a participant             → StartFixtureResponse
//   POST   /fixtures/:id/decline         a challenged participant  → Fixture
//   POST   /fixtures/:id/cancel          its creator or the commissioner → Fixture
//   POST   /commissioner/seasons         commissioner              NewSeasonRequest → 201 Season
//   POST   /commissioner/round-robin     commissioner              RoundRobinRequest → 201 RoundRobinResponse
//   POST   /commissioner/games/:code/void    commissioner          VoidRequest → VoidResponse
//   POST   /commissioner/games/:code/unvoid  commissioner          → VoidResponse
//   POST   /commissioner/players/:id/deactivate  commissioner      → PlayerCard
//   POST   /commissioner/players/:id/reactivate  commissioner      → PlayerCard
//   POST   /commissioner/handover        commissioner              HandoverRequest → PlayerCard (the new commissioner)
//
// Conventions (same as the rest of the API):
// - Auth is `Authorization: Bearer <token>`; errors are JSON `{ error: string }`
//   with 400 (bad input), 401 (not signed in / deactivated), 403 (not allowed),
//   404 (no such thing), 409 (wrong state for that).
// - Timestamps are ISO-8601 UTC strings. Ids are opaque strings; seasons are integers.
// - "Counted" games are finished and not voided. Only counted games feed any statistic.
import { type Card, sortHand } from './cards.js';
import type { HandLog, PegEntry, Phase, PlayerCount, Seat, ShowResult, SkunkLevel, Team } from './game.js';
import type { ScoreItem } from './scoring.js';

export type { PegEntry };

// ---------------------------------------------------------------- profiles

/** A small picture for a player: one emoji on a coloured disc. */
export interface Avatar {
  /** A single emoji (one grapheme). */
  emoji: string;
  /** `#rrggbb`. */
  colour: string;
}

/** A player as they appear in every list. */
export interface PlayerCard {
  id: string;
  name: string;
  avatar: Avatar | null;
  /** Preferred deck id (e.g. 'lily', 'classic'); null = the default deck. */
  deck: string | null;
  /** Prefers four-colour suits. */
  fourColour: boolean;
  /** False once the commissioner has deactivated them (history is kept). */
  active: boolean;
  commissioner: boolean;
}

/** GET /api/me, PATCH /api/me. */
export interface Me extends PlayerCard {
  createdAt: string;
}

/** PATCH /api/me — every field optional; `avatar: null` and `deck: null` clear them. */
export interface UpdateMeRequest {
  name?: string;
  avatar?: Avatar | null;
  deck?: string | null;
  fourColour?: boolean;
}

export const MAX_NAME = 24;
export const DECK_ID = /^[a-z0-9][a-z0-9-]{0,31}$/;
export const COLOUR = /^#[0-9a-fA-F]{6}$/;

/** True for exactly one emoji (one grapheme cluster that is pictographic, a flag or a keycap). */
export function isEmoji(x: unknown): x is string {
  if (typeof x !== 'string' || x.length === 0 || x.length > 32) return false;
  const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  const parts = [...seg.segment(x)];
  if (parts.length !== 1) return false;
  return /\p{Extended_Pictographic}|\p{Regional_Indicator}{2}|[0-9#*]️?⃣/u.test(x);
}

export function isAvatar(x: unknown): x is Avatar {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return false;
  const a = x as Record<string, unknown>;
  const keys = Object.keys(a);
  return keys.length === 2 && isEmoji(a.emoji) && typeof a.colour === 'string' && COLOUR.test(a.colour);
}

// One emoji, element by element: a pictographic emoji shown as an emoji (it
// has emoji presentation, or asks for it with VS16, or carries a skin tone).
const EMOJI_BASE = '(?=\\p{Emoji})(?![\\u00A9\\u00AE\\u2122])\\p{Extended_Pictographic}';
const EMOJI_ALONE = `(?:(?=\\p{Emoji_Modifier_Base})${EMOJI_BASE}\\p{Emoji_Modifier}|${EMOJI_BASE}\\uFE0F|(?=\\p{Emoji_Presentation})${EMOJI_BASE})`;
// Inside a ZWJ sequence the later parts may leave out VS16 (minimally-qualified sequences).
const EMOJI_PART = `${EMOJI_BASE}(?:\\p{Emoji_Modifier}|\\uFE0F)?`;
const SINGLE_EMOJI = new RegExp(
  '^(?:' +
    [
      `${EMOJI_ALONE}(?:\\u200D${EMOJI_PART})*`, // 😀 ❤️ 👍🏽 👨‍👩‍👧‍👦 🏳️‍🌈
      `${EMOJI_PART}(?:\\u200D${EMOJI_PART})+`,
      '\\p{Regional_Indicator}{2}', // 🇳🇿
      '[0-9#*]\\uFE0F?\\u20E3', // 1️⃣
      // England, Scotland, Wales: the only tag sequences that are emoji.
      '\\u{1F3F4}(?:\\u{E0067}\\u{E0062}(?:\\u{E0065}\\u{E006E}\\u{E0067}|\\u{E0073}\\u{E0063}\\u{E0074}|\\u{E0077}\\u{E006C}\\u{E0073}))\\u{E007F}',
    ].join('|') +
    ')$',
  'u',
);

/**
 * Stricter than isEmoji: exactly one genuine emoji and nothing hidden with it.
 * Skin tones, ZWJ sequences (families, rainbow flag), flags, keycaps and the
 * three subdivision flags pass; text symbols such as © ® ™ (with or without
 * VS16), a pictograph in text presentation, a lone regional indicator, and an
 * emoji followed by tag characters or other invisible extenders do not.
 * The server applies this to avatars.
 */
export function isSingleEmoji(x: unknown): x is string {
  return isEmoji(x) && SINGLE_EMOJI.test(x);
}

// ---------------------------------------------------------------- joining

/**
 * POST /api/players (public). Needs an invite: `code` (a game that is waiting
 * for players — the game invite link) or `invite` (a league invite token).
 * The very first player of a new league needs neither and becomes commissioner.
 * 201 → CreatePlayerResponse; 403 when the invite is missing, unknown, used or expired.
 */
export interface CreatePlayerRequest {
  name: string;
  code?: string;
  invite?: string;
}
/** The token is shown once; keep it (it is this device's session). */
export interface CreatePlayerResponse {
  id: string;
  name: string;
  token: string;
}

/** POST /api/invites (any member) → a single-use league invite, valid 7 days. */
export interface LeagueInvite {
  token: string;
  expiresAt: string;
}
/** GET /api/invites/:token (public) — for the welcome screen. */
export interface InviteStatus {
  valid: boolean;
  /** Why not, when not valid. */
  reason: 'unknown' | 'used' | 'expired' | null;
  invitedBy: { id: string; name: string } | null;
  expiresAt: string | null;
}

// ---------------------------------------------------------------- devices

/** POST /api/link (signed in) → a one-time code for a new device, valid 10 minutes. */
export interface DeviceLinkCode {
  /** 8 characters from the game-code alphabet; case and dashes are ignored on redeem. */
  code: string;
  expiresAt: string;
}
/** POST /api/link/redeem (public) → CreatePlayerResponse (a new token for the same player). */
export interface RedeemLinkRequest {
  code: string;
}
/** GET /api/me/sessions. */
export interface SessionInfo {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  /** The session making this request. */
  current: boolean;
}
export interface SessionsResponse {
  sessions: SessionInfo[];
}
/** POST /api/me/sign-out, DELETE /api/me/sessions/:id. */
export interface OkResponse {
  ok: true;
}

// ---------------------------------------------------------------- league & seasons

export interface Season {
  id: number;
  name: string;
  startedAt: string;
  /** null while it is the current season. */
  endedAt: string | null;
  current: boolean;
}

/** GET /api/league. */
export interface LeagueResponse {
  commissioner: PlayerCard | null;
  season: Season;
  seasons: Season[];
  /** Everyone, active first then by name; deactivated members have active: false. */
  members: PlayerCard[];
}
/** GET /api/seasons. */
export interface SeasonsResponse {
  current: Season;
  seasons: Season[];
}
/** POST /api/commissioner/seasons → Season (the new current season). */
export interface NewSeasonRequest {
  name: string;
}
export const MAX_SEASON_NAME = 40;

/**
 * Which games a statistic covers. Query parameter `season`: a season id, or
 * `all` for all time. Standings default to the current season; head-to-head,
 * player stats and the hall of fame default to all time.
 *
 * A game belongs to the season it was created (dealt or opened for players)
 * in, not the one it finishes in: a game still in progress when the
 * commissioner starts a new season counts, once finished, for the old season's
 * standings and statistics, never the new one's (its `seasonId` says which).
 * A fixture still queued at the rollover moves into the new season, as does one
 * put back in the queue later because its game was voided.
 */
export type SeasonFilter = number | 'all';

// ---------------------------------------------------------------- standings

export type Result = 'W' | 'L';

/** One finished game from a player's point of view. */
export interface ResultChip {
  code: string;
  result: Result;
  players: PlayerCount;
  finishedAt: string;
  /** Your team's score and the best opposing score. */
  score: number;
  opponentScore: number;
  /** Won: the skunk you gave (the worst among the losers). Lost: the skunk you took. */
  skunk: SkunkLevel;
}

export interface Streak {
  result: Result;
  length: number;
}

export interface StandingRow {
  /** 1-based; rows equal on every sort key share a rank. */
  rank: number;
  player: PlayerCard;
  played: number;
  won: number;
  lost: number;
  /** 2 a win, 3 a skunk win, 4 a double-skunk win, 0 a loss. */
  matchPoints: number;
  /** won / played (0 when nothing played). */
  winRate: number;
  /** Games won with at least one loser skunked (doubles included) / games your team was skunked. */
  skunksGiven: number;
  skunksTaken: number;
  doubleSkunksGiven: number;
  doubleSkunksTaken: number;
  /** Board points: your team's final score, summed over games. */
  pointsFor: number;
  /** The best opposing final score in each game, summed. */
  pointsAgainst: number;
  pointDifference: number;
  /** null before the first game. */
  streak: Streak | null;
  /** Most recent first, at most five. */
  lastFive: ResultChip[];
}

/** GET /api/standings?season=<id|all>. Active members only (deactivated players are left out). */
export interface StandingsResponse {
  /** The season covered, or null for all time. */
  season: Season | null;
  /** Sorted: match points, then win rate, then point difference (then name); unplayed last. */
  rows: StandingRow[];
  /** Counted games included. */
  games: number;
}

// ---------------------------------------------------------------- averages & hands

/**
 * Per-hand averages, with the totals and sample sizes they come from.
 * - hand: every counted hand of yours (not the crib);
 * - crib: every crib counted while you were the dealer;
 * - pegging: your pegging points (plays + go / last card, not heels) in every hand
 *   whose pegging was played out (the hand that ends a game mid-peg is left out).
 *   A hand counts when every card was played, so:
 *   - a game that ends during the pegging (before the last card) leaves that hand
 *     out of the pegging average for every player at the table, points pegged
 *     in it included (they still count on the board and towards the result);
 *   - a game that ends on the last card keeps that hand in, the winning play
 *     counted at its full rule value. If the last card's own score (a pair, a
 *     run, fifteen, 31…) ends the game, the one point for last card is never
 *     scored and so is not counted; if that one point is what ends it, it is;
 *   - a game that ends on the cut (his heels) has no pegging in that hand to
 *     count; one that ends in the show had its pegging played out, so it counts.
 *   Likewise a hand or crib that was never counted because the game ended first
 *   is left out of the hand and crib averages.
 * Values are the full rule values (a winning score capped at 121 still counts in full).
 */
export interface Averages {
  hand: number | null;
  handTotal: number;
  hands: number;
  crib: number | null;
  cribTotal: number;
  cribs: number;
  pegging: number | null;
  peggingTotal: number;
  peggingHands: number;
}

/** A counted hand (or crib) worth remembering. */
export interface HandHighlight {
  code: string;
  handNo: number;
  /** When that hand finished. */
  at: string;
  /** The four cards kept (or the crib), sorted. */
  cards: Card[];
  starter: Card;
  points: number;
  crib: boolean;
}

// ---------------------------------------------------------------- head-to-head

export interface H2HSide {
  player: PlayerCard;
  won: number;
  matchPoints: number;
  skunksGiven: number;
  skunksTaken: number;
  doubleSkunksGiven: number;
  doubleSkunksTaken: number;
  /** Board points summed. */
  pointsFor: number;
  /** Wins in a row this player holds right now (0 if the other leads the streak). */
  currentStreak: number;
  longestStreak: number;
  /** In these games only. */
  averages: Averages;
  bestHand: HandHighlight | null;
}

export interface H2HGame {
  code: string;
  finishedAt: string;
  seasonId: number;
  /** [a's score, b's score]. */
  scores: [number, number];
  winner: string;
  /** The loser's skunk level. */
  skunk: SkunkLevel;
  /** Running record after this game: [a's wins, b's wins]. */
  record: [number, number];
}

export interface H2HGroupSummary {
  played: number;
  /** Partners: games the pair won together. Opponents: games a won / b won / someone else won. */
  won: number;
  lost: number;
  games: string[];
}

export interface H2HOpponentsSummary {
  played: number;
  threePlayer: number;
  fourPlayer: number;
  aWon: number;
  bWon: number;
  /** Three-player games won by the third player. */
  neitherWon: number;
  /** Games where a finished ahead of b (better place) / b ahead of a. */
  aAhead: number;
  bAhead: number;
  games: string[];
}

/**
 * GET /api/h2h/:a/:b?season=<id|all> (any member; default all time).
 * `a`/`b`, `played`, `timeline` and the record come from their two-player games
 * against each other only; partners and multi-player opponents are summarised apart.
 */
export interface HeadToHead {
  season: Season | null;
  a: H2HSide;
  b: H2HSide;
  played: number;
  /** Oldest first. */
  timeline: H2HGame[];
  /** Four-player games on the same side. */
  partners: H2HGroupSummary;
  /** Three- and four-player games on opposite sides. */
  opponents: H2HOpponentsSummary;
}

// ---------------------------------------------------------------- player stats & honours

export type HonourKind = 'twenty-nine' | 'twenty-eight' | 'nineteen' | 'double-skunk' | 'kiwi';

/**
 * - twenty-nine / twenty-eight: a hand or crib of yours that counted 29 / 28;
 * - nineteen: a hand of yours (not a crib) that counted zero;
 * - double-skunk: you won (or your team won) with a loser under 61;
 * - kiwi: you (or your team) were skunked, double skunks included.
 */
export const HONOUR_KINDS: readonly HonourKind[] = ['twenty-nine', 'twenty-eight', 'nineteen', 'double-skunk', 'kiwi'];

export interface HonourOccurrence {
  code: string;
  /** The hand's finish time for hand honours, the game's for skunks. */
  at: string;
  /** Hand honours only. */
  handNo: number | null;
  cards: Card[] | null;
  starter: Card | null;
}

export interface Honour {
  kind: HonourKind;
  count: number;
  first: HonourOccurrence | null;
  latest: HonourOccurrence | null;
  /** Most recent first, at most 20. */
  recent: HonourOccurrence[];
}

export interface RecordLine {
  played: number;
  won: number;
  lost: number;
  matchPoints: number;
  winRate: number;
  skunksGiven: number;
  skunksTaken: number;
  doubleSkunksGiven: number;
  doubleSkunksTaken: number;
  pointsFor: number;
  pointsAgainst: number;
}

/** GET /api/players/:id/stats?season=<id|all> (any member; default all time). */
export interface PlayerStats {
  season: Season | null;
  player: PlayerCard;
  overall: RecordLine;
  bySize: Record<'2' | '3' | '4', RecordLine>;
  averages: Averages;
  averagesBySize: Record<'2' | '3' | '4', Averages>;
  bestHand: HandHighlight | null;
  bestCrib: HandHighlight | null;
  currentStreak: Streak | null;
  longestWinningStreak: number;
  /** Every honour kind, in HONOUR_KINDS order (count 0 if never). */
  honours: Honour[];
  /** Most recent first, at most 10. */
  recent: ResultChip[];
}

export interface HonourHolder {
  player: PlayerCard;
  count: number;
  latest: HonourOccurrence;
}

/** GET /api/hall-of-fame?season=<id|all> (any member; default all time). Deactivated players stay in. */
export interface HallOfFame {
  season: Season | null;
  honours: { kind: HonourKind; holders: HonourHolder[] }[];
  /** The best counted hands (not cribs), highest first, at most 10. */
  bestHands: { player: PlayerCard; hand: HandHighlight }[];
  /** Longest winning streaks, one entry per player, longest first, at most 10. */
  longestStreaks: { player: PlayerCard; length: number }[];
}

// ---------------------------------------------------------------- games across the league

/** GET /api/pending (any member): every waiting or active game that is not voided. */
export interface PendingGame {
  code: string;
  status: 'waiting' | 'active';
  players: PlayerCount;
  /** The season the game was created in; it counts for that season once finished (see SeasonFilter). */
  seasonId: number;
  fixtureId: string | null;
  /** By seat; null = an open seat. */
  seats: (PlayerCard | null)[];
  /** By team. */
  scores: number[];
  phase: Phase | null;
  handNo: number;
  createdAt: string;
  lastMoveAt: string;
  /** Seconds since lastMoveAt, at the time of the response. */
  idleSeconds: number;
  /** Who can act right now (active games); empty while waiting for players. */
  waitingOn: PlayerCard[];
  waitingOnSeats: Seat[];
  /** Seats still to fill (waiting games). */
  openSeats: number;
}
export interface PendingResponse {
  games: PendingGame[];
}

/** One finished game, league-wide. */
export interface GameResult {
  code: string;
  players: PlayerCount;
  /** The season the game was created in, which it counts for (see SeasonFilter). */
  seasonId: number;
  fixtureId: string | null;
  seats: PlayerCard[];
  scores: number[];
  winnerTeam: Team;
  /** By team. */
  skunk: SkunkLevel[];
  createdAt: string;
  finishedAt: string;
  voided: boolean;
  voidReason: string | null;
  voidedAt: string | null;
}
/** GET /api/results?season=<id|all>&player=<id> (any member; default current season). Voided games included, marked. */
export interface ResultsResponse {
  games: GameResult[];
}

// ---------------------------------------------------------------- hand records

/** A hand or crib at the show. `counted: false` = the game ended before it was counted. */
export interface ShowRecord {
  seat: Seat;
  crib: boolean;
  counted: boolean;
  /** null while hidden from you. */
  cards: Card[] | null;
  /** Empty and total null when not counted. */
  items: ScoreItem[];
  total: number | null;
}

/**
 * One hand, for statistics and replays. Hidden cards of a hand still in
 * progress come back as null (you only see your own cards, cards played, the
 * starter once cut and what has been counted).
 */
export interface HandRecord {
  handNo: number;
  dealer: Seat;
  /** The hand is over: fully counted, or the game ended during it. */
  complete: boolean;
  /** The game ended during this hand (it is the last hand). */
  endedGame: boolean;
  /** By team. */
  scoresBefore: number[];
  /** By team; the current scores while in progress. */
  scoresAfter: number[];
  /** By seat: the cards dealt, sorted. */
  dealt: (Card[] | null)[];
  /** By seat: the cards kept (empty until that seat has discarded). */
  kept: (Card[] | null)[];
  /** By seat: what that seat put in the crib (empty until it discards). */
  discards: (Card[] | null)[];
  /** Three players: the card dealt from the deck into the crib. */
  deckToCrib: Card | null;
  /** The whole crib once everyone has discarded. */
  crib: Card[] | null;
  starter: Card | null;
  /** 2 when the dealer pegged his heels, else 0. */
  heels: number;
  peg: PegEntry[];
  /** Every hand then the crib, in counting order (counted or not); empty until the show starts. */
  shows: ShowRecord[];
  /** When the hand finished; null while in progress. */
  finishedAt: string | null;
}

/**
 * GET /api/games/:code/hands — members of the game at any time, any league
 * member once it is finished. Hands from before hand records existed are
 * missing (firstRecordedHand tells you where the record starts).
 */
export interface HandsResponse {
  code: string;
  players: PlayerCount;
  status: 'waiting' | 'active' | 'finished';
  seats: (PlayerCard | null)[];
  /** Your seat, or null if you are not in the game. */
  you: Seat | null;
  firstRecordedHand: number | null;
  hands: HandRecord[];
}

/**
 * Build a HandRecord from the engine's log. `scoresAfter` is the board after the
 * hand (or now); `visibleTo` is the seat whose eyes we use while the hand is in
 * progress (null = nobody's: every hidden card is null); once `complete` every
 * card is shown.
 */
export function handRecordFrom(
  log: HandLog,
  players: PlayerCount,
  opts: { scoresAfter: number[]; complete: boolean; endedGame: boolean; finishedAt: string | null; visibleTo: Seat | null },
): HandRecord {
  const { complete, visibleTo } = opts;
  const show = (seat: Seat) => complete || seat === visibleTo;
  const n = players;
  const discarded = log.discards.map((d) => d.length > 0);
  const kept = log.dealt.map((d, s) => (discarded[s] ? d.filter((c) => !log.discards[s].includes(c)) : []));
  const allIn = discarded.every(Boolean);
  const crib = allIn ? [...(log.deckToCrib === null ? [] : [log.deckToCrib]), ...log.discards.flat()] : null;
  // Counting order: dealer's left first, the dealer, then the crib.
  const shows: ShowRecord[] = [];
  const peggedOut = log.peg.filter((p) => p.t === 'play').length === n * 4;
  if (log.starter !== null && (peggedOut || complete)) {
    for (let step = 0; step <= n; step++) {
      const isCrib = step === n;
      const seat = isCrib ? log.dealer : (log.dealer + 1 + step) % n;
      const done: ShowResult | undefined = log.shows[step];
      if (done) shows.push({ seat, crib: isCrib, counted: true, cards: [...done.cards], items: done.items, total: done.total });
      else {
        const cards = isCrib ? crib : kept[seat];
        shows.push({ seat, crib: isCrib, counted: false, cards: complete && cards ? sortHand(cards) : null, items: [], total: null });
      }
    }
  }
  return {
    handNo: log.handNo,
    dealer: log.dealer,
    complete,
    endedGame: opts.endedGame,
    scoresBefore: [...log.scoresBefore],
    scoresAfter: [...opts.scoresAfter],
    dealt: log.dealt.map((d, s) => (show(s) ? [...d] : null)),
    kept: kept.map((k, s) => (show(s) ? k : null)),
    discards: log.discards.map((d, s) => (show(s) ? [...d] : null)),
    deckToCrib: complete ? log.deckToCrib : null,
    crib: complete ? crib : null,
    starter: log.starter,
    heels: log.heels,
    peg: structuredClone(log.peg),
    shows,
    finishedAt: opts.finishedAt,
  };
}

// ---------------------------------------------------------------- fixtures (the queue)

export type FixtureStatus = 'queued' | 'playing' | 'done' | 'declined' | 'cancelled';
export type FixtureKind = 'challenge' | 'round-robin';

/**
 * A matchup waiting to be played. Seats are in table order: in a four-player
 * fixture seats 0 & 2 partner against 1 & 3.
 */
export interface Fixture {
  id: string;
  seasonId: number;
  kind: FixtureKind;
  players: PlayerCount;
  seats: PlayerCard[];
  createdBy: PlayerCard;
  createdAt: string;
  status: FixtureStatus;
  /** The game, once started. */
  gameCode: string | null;
  /** Who declined (status 'declined') or cancelled (status 'cancelled'). */
  closedBy: PlayerCard | null;
  /** When it finished, was declined or cancelled. */
  closedAt: string | null;
}

/**
 * POST /api/fixtures (any member) → 201 Fixture: challenge one, two or three
 * others. Two or three players: `opponents` lists them (you take seat 0, they
 * follow in order). Four players: name your `partner` and two `opponents`.
 */
export interface ChallengeRequest {
  opponents: string[];
  partner?: string;
}
/**
 * GET /api/fixtures?status=open|all&season=<id|current|all>&player=<id> (any
 * member): the league's queue in order. Default status=open (queued + playing),
 * which covers every season unless `season` is given; status=all defaults to
 * the current season. `player` narrows it to fixtures that player is in.
 * GET /api/fixtures/mine: your open fixtures in queue order.
 */
export interface FixturesResponse {
  fixtures: Fixture[];
}
/** GET /api/fixtures/next: your next fixture not yet started (null if none). */
export interface NextFixtureResponse {
  fixture: Fixture | null;
}
/** POST /api/fixtures/:id/start (a participant) → the game, everyone seated and dealt. Idempotent. */
export interface StartFixtureResponse {
  code: string;
  fixture: Fixture;
}
/** POST /api/commissioner/round-robin (commissioner). */
export interface RoundRobinRequest {
  /** How many times each pair meets (default 1, at most 10). */
  times?: number;
}
export interface RoundRobinResponse {
  created: Fixture[];
  /** Pairs skipped because they already have an unplayed fixture this season. */
  skippedPairs: number;
}

// ---------------------------------------------------------------- commissioner

/** POST /api/commissioner/games/:code/void → GameResult-like summary. */
export interface VoidRequest {
  reason?: string;
}
export const MAX_VOID_REASON = 200;
export interface VoidResponse {
  code: string;
  voided: boolean;
  voidReason: string | null;
  voidedAt: string | null;
}
/** POST /api/commissioner/handover. */
export interface HandoverRequest {
  playerId: string;
}

// ---------------------------------------------------------------- waiting-room changes

/** POST /api/games/:code/remove (the creator, while waiting). */
export interface RemovePlayerRequest {
  playerId: string;
}
/** POST /api/games/:code/remove and /leave → the seating afterwards. `deleted`: the last player left. */
export interface SeatingResponse {
  code: string;
  deleted: boolean;
  seats: ({ id: string; name: string } | null)[];
  creator: string | null;
}
