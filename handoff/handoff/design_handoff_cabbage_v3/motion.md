# Motion, sound and haptics

Players see each of these thousands of times, so every routine moment finishes in under a
second and none of them blocks input. Token names refer to `tokens.css`.

**Rules for all of it**

- Only `transform` and `opacity` animate. No filters, no blurs, no layout properties.
- A tap during any animation skips it to its end state. The 29 is the one exception.
- Sound and haptics fire when something **lands**, never when it starts.
- Under `prefers-reduced-motion`, nothing travels. Things fade between states in
  `--dur-reduced` (120 ms). Sound and haptics are unchanged; they are the feedback that is left.

Sounds: **snap** (a card landing), **click** (a peg seating), **tick** (a soft count), **thud**
(the trophy). Haptics: light, medium, heavy.

## The deal

1. Twelve cards leave the deck one at a time, alternating players, opponent first.
   `--dur-card` (220 ms) each, started 60 ms apart, `--ease-out`. About 0.9 s in total.
2. Your six arrive face down in dealt order, then flip together (`--dur-flip`, 320 ms) and
   slide into sorted order (220 ms).

Snap on every second card, quietly. No haptic.

## The two discards

1. Tap a card: it lifts 14 px with a green outline (`--dur-tap`, 90 ms). Light haptic.
2. Confirm: both slide to the dashed slots on the stage (180 ms) and flip face down (320 ms).
3. They slide to the crib, top right (260 ms, `--ease-in-out`), 80 ms apart. Snap as each lands.

The opponent's discards do the same from their strip, without the pause on the stage.

## The cut and the starter

1. The deck slides from its home to the centre of the stage (200 ms). Prompt: "Tap the deck to
   cut". The deck is the tap target; it is 96 px wide here.
2. On tap: the top half lifts 18 px and tilts 5° (160 ms). Light haptic.
3. The starter flips face up beside it (`--dur-flip`). Snap.
4. Hold 600 ms, then deck and starter return home, top left (260 ms).

**His heels.** If the starter is a jack: during the hold, the starter gets the butter outline
and the prompt reads "His heels. Two for Dot." The dealer's peg moves before the cards go home.
Medium haptic for the dealer, light for the other player. Adds about 700 ms.

## Laying a card in pegging

1. The card travels from the hand to the end of the played row (200 ms, `--ease-out`) and
   settles with a 4 px overshoot. Yours settle low, theirs high.
2. The count changes as the card lands: the old number slides up and out, the new one slides in
   from below (`--dur-count`, 120 ms).

Snap on landing. Light haptic for your own card only.

## A score in pegging

1. The cards that made the score get the butter outline together, until the peg seats.
2. The prompt line carries the call, naming who scored, until the peg seats plus 450 ms
   (the build found 500 ms too short to read): "Fifteen for two", "Pair for two",
   "Run of three", "Thirty-one for two", "Go. One to you."
3. The peg advances (below).

On 31 or a go, after the peg seats, the played cards shrink to 34 px, dim, and slide to the
"last count" row (260 ms); the count rolls back to 0. Tick on the call. Medium haptic for the
player who scored.

## The show: the spoken count

Rewritten to the build's slower, said-aloud count (build hand-back 2, §4). Drawn on the canvas
as "4 Show" and "Four players: show"; the component is `Count.jsx`.

Three to five stages in order: each hand from the dealer's left, the dealer's hand, the crib.

1. The four cards and the starter slide to the stage (260 ms). The crib's cards flip first.
2. Each step is one spoken phrase with the running total carried forward: "Fifteen two",
   "fifteen four", "and a run of four is eight". Order: fifteens, pairs, runs, flush, his nobs.
   Pairs and runs are counted one combination at a time.
3. While a step is current:
   - exactly its cards are lit (lifted 6 px, butter outline), the starter included; the rest dim;
   - the phrase is the large line, with the reason under it in small text ("7 + 8 = 15",
     "two 9s", "6 · 7 · 8 · 9", "jack of the starter's suit");
   - the running total sits in the butter box at the right and changes with a 120 ms roll;
   - the phrases already said sit above as one quiet line, folding finished groups once five
     would show ("Fifteens, eight of them: 16").
4. Pace: 1.4 s per step, then 200 ms with nothing lit. `tick` on each step, a note higher each
   time. A "brisk" setting on the profile halves both.
5. The last beat is the total alone ("Eight."): all five cards return to full strength, the
   total box turns from soft butter to full butter, and it holds 1.8 s. `ting`. Then the peg
   advances.
6. A zero hand is one beat: "Nineteen. Nothing this time." No cards lit, total box shows 0.

Tapping the stage steps forward at once. The prompt zone holds "Count again" (a round icon
button) and "Continue"; Continue jumps to the total and moves the peg.

Between phrases the large line cross-fades (120 ms); it does not slide. With reduced motion the
cards do not lift, they only take the outline.

## The peg advancing

The back peg always moves; it leapfrogs the front peg and becomes the new front peg.

1. **Lift.** The peg scales to 1.25 and gains a small shadow (`--dur-peg-lift`, 90 ms).
2. **Travel.**
   - **5 points or fewer:** it hops hole by hole, `--dur-peg-hop` (70 ms) per hole.
   - **More than 5:** it glides along the track at 30 ms per hole, `--ease-in-out`, capped at
     `--dur-peg-glide-max` (900 ms) in total.
   - **Crossing a row change (30 to 31, 60 to 61, 90 to 91):** it does not fly diagonally. It
     fades out at the end of one row and in at the start of the next (`--dur-peg-row`, 120 ms).
     Crossing onto row three or four, the tomato tab at the head of the row pulses once.
3. **Seat.** It drops back to scale 1 with a slight overshoot (`--dur-peg-seat`, 120 ms,
   `--ease-seat`). The outline swaps: the moved peg becomes solid, the other becomes a ring.

| Move | Total time | Sound |
|---|---|---|
| 1 point | about 280 ms | one click on seating |
| 24 points | about 930 ms, or 1050 ms across a row change | a faint tick every fifth hole, one click on seating |

Light haptic on seating, for the player who scored. The status line under each name ("Ahead by
6") updates as the peg seats, not before.

Reduced motion: the peg fades out of the old hole and into the new one, and the new hole's
outline flashes butter once.

## Winning

The peg glides into the finish hole and the hole's ring turns butter. The stage clears (200 ms
fade) and the result fades in: headline, score line, tally. Heavy haptic for the winner. About
1.2 s. No confetti.

## Being skunked, and the kiwi

After the win sequence, only when the loser is under 91:

1. The plinth and plate rise from the bottom of the stage (220 ms).
2. The kiwi drops from above the stage and lands on the plinth with one bounce (500 ms). Thud.
3. The plate stamps: scale 1.15 to 1 (140 ms), reading SKUNKED. Heavy haptic, both players.
4. The headline names the recipient: "Dot gets the kiwi" for the winner, "You get the kiwi" for
   the loser.

Double skunk (under 61): two kiwis drop 150 ms apart, the plate reads DOUBLE SKUNK.

## A 29

Once in about 216,000 hands. It is the only moment allowed to stop the game.

1. During the show, the steps run as usual up to 28.
2. On his nobs: the rim line of the table top turns from tomato to butter (300 ms). All five
   cards lift and switch to the full face at 96 px, fanned across the stage.
3. "29" appears at count size in the centre and holds for 1.6 s. This hold cannot be skipped.
4. The peg glides its 29 holes with a tick on every hole.
5. The hand is saved to the hall of fame and the prompt offers "Share" beside "Continue".

Its own sound, used nowhere else. Three medium haptics, 120 ms apart. The rim line stays butter
until the next deal.

## Presence

The opponent's considered card, in their strip, lifts 6 px over `--dur-card`. It drops when
they move off it. No sound, no haptic.
