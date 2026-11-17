# Design hand-back

> **From:** Claude design · **To:** the build side
> **Covers:** identity, the table in five phases, the board, the card system, motion notes.
> **Not covered yet:** waiting / offline / reconnecting states, and the other screens in §3.6 of the brief.

The game is being renamed, and the mark is now a **kiwi**, not a cabbage. The skunk line reads
"Dot gets the kiwi". This folder and the canvas wordmark still say "cabbage" until the new name
is chosen; nothing in the code depends on the name.

## What is in here

| File | What it is |
|---|---|
| `tokens.css`, `tokens.json` | Colour, type, spacing, radii, zone heights, motion durations and easings |
| `styles.css` | All CSS for the table, board and cards. Imports `tokens.css` |
| `Table.jsx` | The table in each phase, plus the laptop layout |
| `Board.jsx` | The board as SVG, with `holeXY(score, lane)` |
| `CardView.jsx` | Number card, court frame with photo slot, back |
| `decks.js` | The three house decks as token sets, suit glyphs, pip layouts |
| `Mark.jsx`, `mark.svg`, `mark-mono.svg`, `favicon.svg` | The kiwi mark and the trophy |
| `deck-photo-spec.md`, `photo-treatment.js` | Photo slot, safe area, size floors, and the baked treatments (revised in hand-back 2) |
| `Players.jsx` | Compact strips, owner chips and the long show tracker for three and four players |
| `Count.jsx` | The spoken-count stage for the show |
| `sounds.js`, `sound.md`, `sound-board.html` | Twelve synthesised sounds, when each fires, and a page to audition them |
| `design-handback-3.md` | Reply to the build's hand-back 2. **Read this first; it supersedes hand-back 2 and answer 2 below** |
| `design-handback-2.md` | Earlier reply, kept for the record |
| `motion.md` | Motion, sound and haptic notes for every moment in §3.5 |

Screen padding on the canvas is 6 px top and bottom; `styles.css` grows it to the device safe
area.

The JSX is reference code: plain React and CSS, no libraries. It compiles and server-renders
every phase without errors, but it has not been run in a browser or against the real server
state. The canvas artboards are the visual source of truth; where the two disagree, trust the
canvas and tell me.

## The look

An enamel kitchen table. Cream enamel top with a tomato rim line, a faint oilcloth check on the
cloth and on card backs, dark rim ink for outlines. Flat colour and hard edges throughout: no
gradients, blurs or textures, so it is cheap on an old phone and nothing like a casino.

- **Type.** Familjen Grotesk for the interface. Besley, a slab, for every number that matters:
  the count, the scores, card indices. Both are on Google Fonts.
- **Colour.** Green is the action colour. Tomato is you; enamel blue is your opponent. Butter
  yellow means "this is scoring right now" and is used for nothing else.
- **Pegs are tomato and blue, not red and green,** so they stay apart for colour-blind players.
  They also differ by lane, so colour is never the only cue.

## The table

Six fixed zones, top to bottom, the same in every phase:

| Zone | Height | Holds |
|---|---|---|
| Opponent strip | 56 | Avatar, name, status line, cards held, score |
| Board | 156 | Always visible. 358 × 156 drawing, scaled to the width |
| Table top | flex | Deck and starter top left, crib top right, the stage in the middle |
| Prompt | 48 | One line saying what to do now, and at most one button |
| Hand | 92 | Your cards; the show's progress steps; Home at game over |
| Your strip | 52 | Avatar, name, status line, score |

Only the stage changes with the phase, which is how the layout holds without jumping.

- **Six cards at 360 wide.** Hand cards are `min(56px, (100vw - 52px) / 6)`: 56 px at 390,
  51 px at 360, 4 px apart. Each card is its own button and stays over 44 px wide.
- **Pegging.** The count is 96 px Besley, the largest thing on screen. Opponent's cards sit high
  with a blue bar above them; yours sit 20 px lower with a tomato bar below. Cards from a finished
  count shrink to 34 px, dim, and move to a "last count" row with its outcome beside it.
- **Eight played cards.** Up to five sit side by side at 52 px. From six on they overlap evenly
  so eight fit at 360; the index is top left, so it stays readable when overlapped.
- **Unplayable cards** dim to 40% and their buttons are disabled. The prompt says why, and the
  button becomes "Go".
- **Laptop (960 px and up).** The same zones open sideways: players and the running tally in a
  left rail, board and table in the middle, a log of the hand on the right. Pegging lays out as a
  row: last count, the count at 132 px, the cards in play.

## Answers to the brief's questions

1. **Board: straight, in four rows of 30.** A single straight row puts holes 3 px apart at phone
   width, and two rows of 60 were still too small to see. Four rows give holes nearly 10 px apart
   and pegs 11 px across at 390 wide. A serpentine reverses direction, so "who is ahead" needs
   thought; these rows all run left to right and read like lines of text. Your opponent's lane
   is the upper one in each row and yours the lower, matching the screen, and each lane's holes
   carry a quiet tint of that player's peg colour. The numbers fall out well: the double-skunk
   line (61) is the start of row three and the skunk line (91) is the start of row four, so each
   is a tomato tab at the head of its row. Row four is green: on it, you are safe from the skunk.
2. **Court frame: one frame, one default treatment.** The photo sits in a 4:5 window, and rank
   and suit sit outside it on card stock, so a busy photo can never hide them. Duotone in the
   suit ink does the unifying: it removes mismatched colour casts and lighting, which is most of
   what makes family snaps look uneven. "Natural" is a deck-level opt-out for owners with good
   photos. **This is untested against real photos.** Please try a studio portrait and a blurry
   holiday snap early and send me the result.
3. **The show happens in place.** The four cards and the starter lift onto the stage, each
   combination lights its cards in turn and adds a line with the running total. The hand zone
   becomes a three-step tracker (your hand, their hand, the crib). No separate screen.
4. **Presence, without chat.** The opponent's face-down cards in their strip are live: the card
   they are considering lifts 6 px. That is the whole feature. It needs one small message from the
   server (index of the hovered card, throttled to about 4 per second). No reactions, no text.

## The cards

- **Two faces, chosen by width.** Under 90 px a card shows a large index and one pip, because a
  pip layout is unreadable at hand size. At 90 px and over it gets corner indices and the full
  pip layout. The table only ever uses the compact face; the full face is for the deck picker,
  replay and the 29.
- **Suit glyphs are SVG paths**, not font characters, so no platform can swap in an emoji heart.
- **Four-colour suits:** spades ink, hearts red, diamonds blue, clubs green. A per-player
  setting, not a deck property; every deck defines all four inks.
- **House decks:** Enamel (the classic), Seed Packet (kraft stock, squarer corners, rust and
  green), Blue Plate (cool white, navy, rounder corners, grotesk index). Without photos, courts
  draw a large letter in a tinted frame.

## Things I would like the build to push back on

- **The CSS duotone uses blend modes on every court card.** It is fine for twelve small cards,
  but I would rather the duotone be baked once at upload (canvas, then store the result) and the
  CSS path kept only as a fallback. See `deck-photo-spec.md`.
- **Board holes are eight dashed lines**, one dot per dash, not 240 circles. It is light, but
  check it on Safari on an old iPhone; if the dots look square, swap in circles from `holeXY`.
- **The board now takes 156 px of height.** I paid for it with tighter outer padding (6 px top
  and bottom, 6 px between zones). On a phone shorter than about 700 px the table top gets tight;
  if you support those, shrink the trophy and the count before you shrink the board.
- **Peg travel needs JS.** A CSS transition cannot follow the track round the row change.
  `motion.md` gives the timings; `holeXY` gives every waypoint.
- **`color-mix()` is used for tints.** If your support floor is older than 2023 browsers, I will
  give you fixed hex values per deck instead.
- **Game stats and names on the canvas are sample data.** The tally rows assume the per-game
  pegging / hands / crib totals the brief says the server can supply.

## Not designed yet

Waiting for an opponent, opponent offline, reconnecting, "his heels" as a drawn state, the 29 as
a drawn state, and all of §3.6: welcome, home, profile, head-to-head, hall of fame, deck picker,
replay. Motion for the drawn-later states is already in `motion.md`.
