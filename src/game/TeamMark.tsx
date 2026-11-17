// The team marker (handoff v2 Players.jsx, TeamMark): a disc in the team colour
// carrying the player's emoji or initial; for mustard, the third player in
// cut-throat, a diamond with an ink outline instead, so shape carries the team
// when colour does not. Used for the 20 px marker in the compact strips and the
// 16 px owner chip on played cards.

/** Team colour names by colour slot (seating.toneOf: 0 is your team). */
export const TEAM_COLOURS = ['tomato', 'blue', 'mustard'] as const;
export type TeamColour = (typeof TEAM_COLOURS)[number];

export const teamColourOf = (tone: number): TeamColour => TEAM_COLOURS[tone] ?? 'blue';

export function TeamMark({
  tone, initial, emoji, size = 20, label,
}: {
  tone: number;
  /** The player's initial, or a two-character chip label (seating.chipLabels), which widens the disc to a pill. Mustard carries no letter (handoff v2): the diamond is the cue. */
  initial?: string;
  /** The player's league avatar emoji, drawn inside the marker in place of the initial. */
  emoji?: string | null;
  size?: number;
  /** Spoken label; omit to hide the marker from assistive tech. */
  label?: string;
}) {
  const team = teamColourOf(tone);
  const content = emoji ? <span className="mark__emoji">{emoji}</span> : team === 'mustard' ? null : initial;
  return (
    <span
      className="mark"
      data-team={team}
      data-emoji={emoji ? '' : undefined}
      data-wide={!emoji && team !== 'mustard' && initial && initial.length > 1 ? '' : undefined}
      style={{ ['--m' as string]: `${size}px` }}
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
    >
      {content}
    </span>
  );
}
