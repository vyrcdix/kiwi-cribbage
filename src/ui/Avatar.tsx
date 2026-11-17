// A player's picture: their emoji on their colour, or their initial on a colour
// picked from their id when they haven't chosen one. Used wherever a player appears.
import type { CSSProperties } from 'react';
import type { Avatar as AvatarSpec } from '../../shared/league';

export interface PlayerLike {
  id: string;
  name: string;
  avatar?: AvatarSpec | null;
  active?: boolean;
}

/** Disc colours for the profile picker; every one carries cream text and sits well on the cloth. */
export const AVATAR_COLOURS = [
  '#be3228', '#2b5278', '#2f6b45', '#7b5b3a', '#8a3b74',
  '#b35c00', '#1f2723', '#5a6b1e', '#2f6fa8', '#a5402a',
] as const;

const FALLBACK = ['#2b5278', '#2f6b45', '#7b5b3a', '#8a3b74', '#b35c00', '#5a6b1e'];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** The colour that stands for this player (their avatar's, or a stable stand-in). */
export const playerColour = (p: PlayerLike | null | undefined): string =>
  p?.avatar?.colour ?? (p ? FALLBACK[hash(p.id) % FALLBACK.length] : '#6B746E');

export function Avatar({ player, size = 32, className, ring }: { player: PlayerLike | null | undefined; size?: number; className?: string; ring?: boolean }) {
  const style = { '--av': `${size}px`, '--av-bg': playerColour(player) } as CSSProperties;
  const cls = ['avatar', ring ? 'avatar--ring' : '', player?.active === false ? 'avatar--gone' : '', className].filter(Boolean).join(' ');
  if (!player) return <span className={`${cls} avatar--empty`} style={style} aria-hidden="true" />;
  const emoji = player.avatar?.emoji;
  return (
    <span className={cls} style={style} aria-hidden="true">
      {emoji ? <span className="avatar__emoji">{emoji}</span> : <span className="avatar__initial">{(player.name.trim()[0] ?? '?').toUpperCase()}</span>}
    </span>
  );
}
