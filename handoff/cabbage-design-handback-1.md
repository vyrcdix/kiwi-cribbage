# Design hand-back 1 — build side to Claude design

> **Re:** `handoff/handoff/design_handoff_cabbage/` · The direction is accepted and is being
> built as specified. This note covers the photo test you asked for, one scope change you
> could not have known about, and three questions.

## 1. The real-photo test (README answer 2)

`handoff/lily-treatment-test.png` shows the twelve Lily court photos, re-cut to the 4:5 slot
at 800 × 1000: natural on top, duotone in the suit ink below (baked with the spec's recipe:
greyscale, contrast × 1.15, black → ink, white → stock), and both at table size.

**Result: duotone works in the black ink and fails in the red.**

- Spades and clubs read well. The black ink keeps the full tonal range.
- Hearts and diamonds wash out. The red ink (`#BE3228`) is a mid-tone, so mapping black to it
  leaves less than half the luminance range. The cards go pale pink.
- The subject makes it worse. A rust-coloured dog on green grass is separated from its
  background by hue, not by brightness; greyscale removes exactly that separation. On KD, QH,
  QD and JD the dog disappears into the grass.
- At table size (the ~34 px mini-slot) the red duotones are unreadable smudges; the natural
  photos are still clearly a dog.

**What the build is doing:** the Lily deck ships with `photoTreatment: 'natural'`. The
vignette and frame still apply.

**Request:** a duotone that survives a mid-tone ink. Options we can see: map black to a
darkened ink (ink mixed toward `--c-ink`) rather than the ink itself; or tritone (dark ink →
suit ink → stock); or keep duotone for black suits and use a tinted-natural treatment for red.
Your call.

## 2. Scope change: three- and four-player games

The owner has asked for 3-player (cut-throat, three scores) and 4-player (partnerships, two
team scores) games. The engine and server now support both. The handoff assumes one opponent,
so the build is adapting it as follows until you say otherwise:

- **Opponent strip:** one strip per other player, side by side across the top in clockwise
  order (two or three compact strips instead of one wide one). In 4-player your partner sits
  in the middle and carries your team colour.
- **Board:** one lane per team. Two lanes for 2- and 4-player games, as designed. Three lanes
  per row for 3-player, which needs a third peg colour that stays apart from tomato and blue
  for colour-blind players. The build is using the green from the palette for now.
- **Played cards:** the bar marking who played a card takes that player's team colour;
  with three or four players "high row / low row" alone no longer says who.
- **Show tracker:** one step per hand plus the crib (four steps for 3-player, five for
  4-player).
- **Deal:** in 3- and 4-player each player discards one card, not two.

Please review these and replace any of them with a designed answer, in particular the
3-lane board and the multi-opponent strip at 360 px.

## 3. Questions

1. **The name.** The handoff says the game is being renamed and the mark is a kiwi. The build
   still says "Cabbage" everywhere, including the hostname. What is the name?
2. **The 5:7 back.** Lily's back photo is 600 × 840, under the 750 × 1050 minimum. It looks
   fine at every size the table uses. Is the minimum there for the deck picker?
3. **Five of the twelve court photos are below the 400 × 500 "refuse" floor** (they are crops
   from one collage, about 307 px wide at source). They are acceptable in the mini-slot and
   soft at full size. The build accepts them with a warning rather than refusing; say if you
   disagree.

## 4. Built, and what did not survive contact

The handoff is implemented: tokens, self-hosted Familjen Grotesk and Besley, the six-zone table
in every phase, the four-row board with JS peg travel, the card system with compact and full
faces, the three house decks plus Lily, the kiwi mark, the show in place, motion with a
reduced-motion fallback, and the laptop layout. It has been played end to end in Chrome with
2, 3 and 4 players at 390, 360 and 1280 wide. It has not been seen on Safari or a real phone.

Where the build departed from the design, for you to accept or redraw:

1. **No Go button.** The server says go automatically for a player who cannot play. The
   prompt says why the dimmed cards are unplayable ("6 and Q would go past 31").
2. **Score calls hold longer than 500 ms.** 500 ms was too short to read. A call stays in the
   prompt until the peg seats, plus 450 ms, and names who scored.
3. **Pegging does not fit at 360 × 740 at the designed sizes.** It needs about 370 px of table
   top and gets about 280. Following your note, the count steps down 96 → 76 → 62 px by
   container query, and the played cards and top row shrink with it; the board is untouched.
4. **A long show needs a scrolling list.** A 29 is 15 lines. The list scrolls inside the stage
   and follows the current line; Continue never leaves the screen. At 360 the top row hides
   during the 29 so the fan fits.
5. **No top bar on the table**, as drawn, which left three things homeless: the way home is a
   round button at the left of your strip; "Reconnecting…" replaces your strip's status line;
   server errors show in the prompt line.
6. **The designed board is about 300 px tall at laptop width.** It is capped at 620 px wide.
7. **Tap to skip** was added: a tap skips card flights, peg moves and score holds, but not
   the show or the 29.
8. **Presence** (the considered card lifting) is not built; it needs a server message.
9. **Sound** is not built.

Still wanted from design, beyond §2 and §3:

- A designed compact opponent strip. To fit three at 360 the build dropped the avatar and
  truncates names ("Margar…").
- A third team colour. Green works on the board but is also the action colour.
- The CSS duotone has still never been seen on a real photo: the house decks have none and
  Lily is natural.
- The league screens (home, standings, pending games, queue, head-to-head, player page, hall
  of fame, replay, profile, commissioner) are being built in the handoff's language without
  drawings. They will want your eye once they exist.
