# Design hand-back 2 — Claude design to the build side

> **Re:** your hand-back 1. Thank you for the photo test; it changed the default.
> **In this drop:** a new photo treatment (`photo-treatment.js`, revised `deck-photo-spec.md`),
> a board that takes two or three lanes (`Board.jsx`), compact opponent strips, owner chips and
> a five-step show tracker (`Players.jsx`, new section at the end of `styles.css`), a third team
> colour (`tokens.css`), and three new artboards on the canvas under "Three and four players".

**What I could and could not check.** I was not sent `lily-treatment-test.png`, so I am working
from your description of it. The new treatment code runs and I checked it on test pixels (a
rust tone, a grass tone, black, white), not on a photograph. The new components compile and
server-render. None of this has been seen in a browser by me, and the mustard colour has not
been through a colour-blindness simulator. Please treat sections 1 and 2 as designs to try,
and send back another sheet.

## 1. Photo treatment

You are right, and option three of yours is closest to what I am now asking for.

- **Default is now `tinted`,** for every suit: the photo keeps its colour at 65% saturation
  and is pulled 22% toward the suit's ink ramp. It unifies a deck without removing the hue
  difference that separates Lily from the grass. On the test pixels the dog-to-grass colour
  distance is 95 natural, 52 tinted and 36 tritone.
- **Duotone is replaced by `tritone`:** shadow ink → suit ink → stock. Black now maps to the
  ink mixed 85% toward rim ink, so red uses 0.81 of the lightness range (it was 0.67). For the
  black ink it is the same two-colour ramp that already tested well.
- **Tritone is an owner's choice, not a default.** No single-ink mapping can fix a subject
  separated from its background by hue alone, so I would rather not pretend one can.
- **The mini-slot always uses the tinted render,** whatever the deck's treatment.
- **The owner picks with a live preview** of all twelve courts, at full size and table size.

Shipping Lily as `natural` is fine. When you have a minute, bake Lily as `tinted` and as
`tritone` and send the sheet; if tinted reads well I would make it Lily's treatment.

## 2. Three and four players

| Your adaptation | Verdict |
|---|---|
| One strip per other player, clockwise | **Accepted, redrawn.** See below |
| One lane per team; three lanes for cut-throat | **Accepted, redrawn.** See below |
| Played-card bar takes the team colour | **Replaced** with a chip carrying the player's initial |
| One tracker step per hand plus the crib | **Replaced** for four and five steps |
| One discard each | **Accepted.** One dashed slot on the stage; prompt "Pick one for Dot's crib" |

**Third colour: mustard `#C8900F`, never green.** Green stays the action colour. Mustard is
used only for the third player in cut-throat. It is lighter than tomato and blue, and it is
always a **diamond with an ink outline** where the others are discs, so shape carries it when
colour does not. Partnerships need no third colour: your team is tomato, theirs is blue.

**The board with three lanes** keeps the same 358 × 156 drawing and the same rows, tabs and
finish. Lanes are 9 apart instead of 12, holes 3.6 instead of 4.4, pegs 9 across instead of 11.
Lanes run top to bottom clockwise from your left, and yours is always the bottom lane. I chose
smaller pegs over a taller board because 360 × 740 has no height to give. `Board` now takes
`teams`; `holeXY(score, lane, lanes)` takes the lane count.

**Compact opponent strips** (same 56 px zone). Each cell is two lines. Line one is the team
marker, the name and the dealer disc; line two is the cards held, then the score. The name gets
a whole line to itself, so at 360 wide it has about 120 px with two opponents and 65 px with
three. By my arithmetic "Margaret" just fits in the narrow one; I have not measured it in a
browser. Longer names still end in an ellipsis. The avatar is back, as a
20 px marker. The player whose turn it is gets an ink outline and an enamel fill; your own
strip takes the same outline on your turn.

- In partnerships the two opponents both show their team's score. Your partner's cell shows no
  score, because your strip already carries it and is labelled "You and Sam".
- During the show, line two becomes a short status ("Counting now", "Counts next").

**Owner chips on played cards.** With three or four players each played card carries a 16 px
chip in the team colour with the player's initial (a bare diamond for mustard). Other players'
cards sit high with the chip above; yours still sit 20 px low with the chip below, because
"mine or not" is the first thing a player looks for. Two-player games keep the plain bars.

**Show tracker for four or five steps.** Five pills do not fit at 360. It becomes one line,
"Sam's hand, 2 of 5", with "Next: Margaret's hand" at the right, over five segments coloured by
the team that scores each. Three-step games keep the pills.

## 3. Your questions

1. **The name.** Not mine to give. The owner has said only that it will be renamed. Keep
   "Cabbage" and the hostname until he does; nothing in the design depends on it.
2. **The 5:7 back.** Yes, the minimum was for the deck picker. It was too strict: 600 × 840
   is fine. New floors: prefer 750 × 1050, warn below 500 × 700, refuse below 250 × 350.
3. **Small court photos.** I agree with you: warn, do not refuse. The full face is only seen
   in the picker, the replay and a 29. New floors: warn below 800 × 1000, refuse below
   200 × 250. Never upscale on store.

## 4. Where the build departed

| # | Departure | Verdict |
|---|---|---|
| 1 | No Go button; the server says go | **Accepted.** Keep "Go" as a spoken call in the prompt so the ritual survives |
| 2 | Score calls hold until the peg seats, plus 450 ms | **Accepted.** `motion.md` is wrong at 500 ms; yours stands |
| 3 | Count steps 96 → 76 → 62 by container query | **Accepted.** The 3-player artboard is drawn at the 76 step |
| 4 | Long show scrolls; top row hides for the 29 at 360 | **Accepted.** One suggestion below |
| 5 | Home button in your strip; reconnecting in the status line; errors in the prompt | **Accepted, drawn.** Home is a 44 px round button at the far left of your strip. While reconnecting, also disable and dim the hand |
| 6 | Board capped at 620 px wide on a laptop | **Accepted** |
| 7 | Tap to skip, except the show and the 29 | **Accepted** |
| 8 | Presence not built | Fine. With three or four players it is worth more, not less; keep it on the list |
| 9 | Sound not built | Fine |

On 4: for a long show, consider folding a finished group into one line once the list passes
six ("Fifteens, eight of them: 16"). The steps still play one at a time; only the history
folds. It would keep a 29 on one screen without scrolling. Yours works; this is optional.

## 5. Still open

- A treatment sheet for Lily with `tinted` and `tritone`.
- Mustard through a colour-blindness simulator, on the board and as a chip.
- Safari and a real phone, especially the dashed-line board holes.
- The league screens. Send screenshots when they exist and I will mark them up.
- From me, when wanted: one-discard deal and game over for three and four players as
  artboards, and the waiting / offline states.
