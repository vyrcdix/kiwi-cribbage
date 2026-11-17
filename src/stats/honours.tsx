// The league's honours: what each one is called, a line about it, and its medal.
import type { HonourKind } from '../../shared/league';
import { Mark } from '../brand/Mark';

export const HONOUR_INFO: Record<HonourKind, { title: string; line: string; empty: string }> = {
  'twenty-nine': { title: 'The perfect 29', line: 'Three fives and the right jack, with the fourth five cut.', empty: 'Nobody yet. Odds of about 1 in 216,000 a hand.' },
  'twenty-eight': { title: 'A 28', line: 'Four fives and a ten-card to go with them.', empty: 'Nobody yet.' },
  nineteen: { title: 'Nineteen', line: 'A hand worth nothing at all (there’s no way to score 19).', empty: 'Nobody yet — it will come.' },
  'double-skunk': { title: 'Double skunk', line: 'Won with a loser still under 61.', empty: 'Nobody has managed one yet.' },
  kiwi: { title: 'Got the kiwi', line: 'Skunked: finished under 91 when someone else went out.', empty: 'Nobody has been skunked yet.' },
};

export function Medal({ kind, size = 44 }: { kind: HonourKind; size?: number }) {
  const style = { ['--m' as string]: `${size}px` };
  if (kind === 'kiwi' || kind === 'double-skunk') {
    return (
      <span className={`medal medal--kiwi${kind === 'double-skunk' ? ' medal--two' : ''}`} style={style} aria-hidden="true">
        <Mark variant="simple" />
        {kind === 'double-skunk' && <Mark variant="simple" />}
      </span>
    );
  }
  const num = kind === 'twenty-nine' ? 29 : kind === 'twenty-eight' ? 28 : 19;
  return (
    <span className={`medal medal--num medal--${kind}`} style={style} aria-hidden="true">{num}</span>
  );
}
