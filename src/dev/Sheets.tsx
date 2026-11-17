// Development-only sheets, for the designer (design-handback-2 §5). Not routed in production.
//   /dev/sheet  the twelve court photos of a deck as natural, tinted and tritone, at full-card
//               size and at table (mini-slot) size, in the two-colour ink
//   /dev/cvd    the three-lane board, owner chips and strips, normally and under simulated
//               protanopia, deuteranopia and tritanopia (Machado et al. 2009, severity 1,
//               applied in linear RGB with SVG feColorMatrix)
import type { CSSProperties, ReactNode } from 'react';
import { card } from '../../shared/cards';
import type { PlayerView } from '../../shared/game';
import { CardView } from '../cards/CardView';
import { DECKS, type PhotoTreatment, bakedPhoto, suitInk } from '../cards/decks';
import { treat } from '../cards/photoTreatment';
import { Board } from '../game/Board';
import { PlayerStrip } from '../game/PlayerStrip';
import { PeggingStage, ShowTracker } from '../game/stages';
import './sheets.css';

const TREATMENTS: PhotoTreatment[] = ['natural', 'tinted', 'tritone'];
const COURTS = [10, 11, 12].flatMap((r) => [0, 1, 2, 3].map((s) => card(r, s)));
const CODE = (c: number) => ['J', 'Q', 'K'][(c % 13) - 10] + 'SHDC'[Math.floor(c / 13)];

export function TreatmentSheet() {
  const q = new URLSearchParams(location.search);
  const deckId = q.get('d') ?? 'lily';
  const w = Number(q.get('w') ?? 120);
  const deck = DECKS[deckId];
  return (
    <div className="devsheet" style={{ '--sheet-w': `${w}px` } as CSSProperties}>
      <header className="devsheet__head">
        <h1>{deck.name} deck · court photos as natural, tinted and tritone</h1>
        <p>
          Baked by <code>scripts/bake-deck.mjs</code> with <code>photo-treatment.js</code> (ported as <code>src/cards/photoTreatment.ts</code>):
          tinted = saturation 65%, 22% toward the suit’s tritone; tritone = shadow ink → suit ink → stock.
          Two-colour ink: hearts and diamonds in red {deck.inks.red}, spades and clubs in black {deck.inks.black}, on stock {deck.stock}.
          Full-card size is {w} px wide; table size is the 56 px compact face used for the hand at 390 wide (photo slot about 26 × 32 px).
          Frame and vignette are CSS, as on the table.
        </p>
      </header>
      <table className="devsheet__grid">
        <thead>
          <tr>
            <th />
            {COURTS.map((c) => <th key={c}>{CODE(c)}</th>)}
          </tr>
        </thead>
        <tbody>
          {TREATMENTS.map((t) => (
            <Row key={t} label={<>{t}<small>full card</small></>}>
              {COURTS.map((c) => <td key={c}><CardView card={c} deck={deckId} width={w} face="full" treatment={t} fourColour={false} /></td>)}
            </Row>
          ))}
          {TREATMENTS.map((t) => (
            <Row key={`m${t}`} label={<>{t}<small>table size{t === 'tinted' ? ' · what the table shows' : ''}</small></>} mini>
              {COURTS.map((c) => <td key={c}><CardView card={c} deck={deckId} width={56} treatment={t} miniTreatment={t} fourColour={false} /></td>)}
            </Row>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Row({ label, mini, children }: { label: ReactNode; mini?: boolean; children: ReactNode }) {
  return (
    <tr className={mini ? 'is-mini' : undefined}>
      <th scope="row">{label}</th>
      {children}
    </tr>
  );
}

/**
 * For the browser check that the port matches the bake: treat each original in a canvas
 * and compare with the baked JPEG. Resolves to the mean absolute difference per channel.
 */
async function compareLive(deckId = 'lily', treatment: PhotoTreatment = 'tinted'): Promise<Record<string, number>> {
  const deck = DECKS[deckId];
  const load = (src: string) => new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = src;
  });
  const pixels = (img: HTMLImageElement) => {
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const x = c.getContext('2d', { willReadFrequently: true })!;
    x.drawImage(img, 0, 0);
    return x.getImageData(0, 0, c.width, c.height).data;
  };
  const out: Record<string, number> = {};
  for (const c of COURTS) {
    const code = CODE(c);
    const baked = bakedPhoto(deck, code, treatment, false);
    const orig = deck.photos[code];
    if (!baked || !orig) continue;
    const a = pixels(await load(orig));
    treat(a, { treatment, ink: suitInk(deck, Math.floor(c / 13), false), stock: deck.stock });
    const b = pixels(await load(baked));
    let sum = 0;
    let n = 0;
    for (let i = 0; i < a.length && i < b.length; i += 4) {
      sum += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
      n += 3;
    }
    out[code] = Math.round((sum / n) * 100) / 100;
  }
  return out;
}
(window as unknown as { __compareLive: typeof compareLive }).__compareLive = compareLive;

// ---------------------------------------------------------------- colour vision

const CVD: { id: string; name: string; values: string }[] = [
  { id: 'none', name: 'Normal vision', values: '' },
  { id: 'protan', name: 'Protanopia (no red cones)', values: '0.152286 1.052583 -0.204868 0 0  0.114503 0.786281 0.099216 0 0  -0.003882 -0.048116 1.051998 0 0  0 0 0 1 0' },
  { id: 'deutan', name: 'Deuteranopia (no green cones)', values: '0.367322 0.860646 -0.227968 0 0  0.280085 0.672501 0.047413 0 0  -0.011820 0.042940 0.968881 0 0  0 0 0 1 0' },
  { id: 'tritan', name: 'Tritanopia (no blue cones)', values: '1.255528 -0.076749 -0.178779 0 0  -0.078411 0.930809 0.147602 0 0  0.004733 0.691367 0.303900 0 0  0 0 0 1 0' },
];

const NAMES = ['Margaret', 'Bob', 'Carol'];

function pegView(): PlayerView {
  const played = [[9, 2, 1], [4, 1, 2], [5, 3, 0], [3, 0, 1], [2, 2, 2], [0, 1, 0]].map(([r, s, seat]) => ({ card: card(r, s), seat }));
  return {
    you: 0, players: 3, target: 121, handNo: 4, dealer: 2, firstCut: [],
    scores: [70, 74, 66], back: [61, 70, 60], phase: 'peg', hand: [], handCounts: [1, 1, 1], discarded: [true, true, true],
    cribCount: 4, starter: card(7, 2), turn: 0, count: 29, pile: played, played,
    showStep: 0, showResult: null, acks: [false, false, false], winner: null, skunk: [0, 0, 0],
    stats: [0, 1, 2].map(() => ({ peg: 0, hand: 0, crib: 0, best: 0 })),
  };
}

export function CvdSheet() {
  const view = pegView();
  const teams = [
    { team: 1, colour: 'blue' as const, name: 'Bob' },
    { team: 2, colour: 'mustard' as const, name: 'Carol' },
    { team: 0, colour: 'tomato' as const, name: 'You' },
  ];
  return (
    <div className="devsheet devsheet--cvd">
      <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
        <defs>
          {CVD.filter((f) => f.values).map((f) => (
            <filter key={f.id} id={`cvd-${f.id}`} colorInterpolationFilters="linearRGB">
              <feColorMatrix type="matrix" values={f.values} />
            </filter>
          ))}
        </defs>
      </svg>
      <header className="devsheet__head">
        <h1>Mustard, the third team, under simulated colour-vision deficiency</h1>
        <p>
          The real components: the three-lane board (Bob blue at the top, Carol mustard in the middle, you tomato at the bottom; front and back pegs),
          the owner chips on played cards (theirs high with the chip above, yours low with the chip below), the compact strips and the show tracker.
          Simulation: Machado, Oliveira and Fernandes (2009) matrices at full severity, applied in linear RGB with an SVG feColorMatrix filter.
        </p>
      </header>
      <div className="devsheet__cvd">
        {CVD.map((f) => (
          <section key={f.id} className="devsheet__panel">
            <h2>{f.name}</h2>
            <div className="devsheet__sim" style={f.values ? { filter: `url(#cvd-${f.id})` } : undefined}>
              <div className="table__opps table__opps--compact devsheet__strips">
                <PlayerStrip who="opp" seat={1} name="Bob" status="" score={74} tone={1} held={1} compact active />
                <PlayerStrip who="opp" seat={2} name="Carol" status="" score={66} tone={2} held={1} dealer compact />
              </div>
              <Board teams={teams} scores={[70, 74, 66]} back={[61, 70, 60]} />
              <div className="devsheet__peg">
                <PeggingStage display={{ count: 29, current: view.pile, last: null }} view={view} names={NAMES} lit={[]} justPlayed={new Set()} />
              </div>
              <ShowTracker stages={[{ name: 'Bob’s hand', tone: 1 }, { name: 'Carol’s hand', tone: 2 }, { name: 'Your hand', tone: 0 }, { name: 'Carol’s crib', tone: 2 }]} current={1} />
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
