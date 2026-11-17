import { createHash, randomBytes, randomInt } from 'node:crypto';
import { ulid } from 'ulid';
import { fullDeck } from '../../shared/cards.js';
import type { Shuffle } from '../../shared/game.js';

/** Fisher–Yates over a fresh deck, driven by the CSPRNG. Never Math.random. */
export const shuffle: Shuffle = () => {
  const d = fullDeck();
  for (let i = d.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
};

/** Unambiguous alphabet: no 0/O, 1/I/L. */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 5;

export const randomCode = (): string => {
  let s = '';
  for (let i = 0; i < CODE_LENGTH; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return s;
};

/** Codes are case-insensitive on input. */
export const normalizeCode = (raw: unknown): string =>
  typeof raw === 'string' ? raw.trim().toUpperCase() : '';

export const newToken = (): string => randomBytes(24).toString('base64url');
export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');
export const newId = (): string => ulid();
