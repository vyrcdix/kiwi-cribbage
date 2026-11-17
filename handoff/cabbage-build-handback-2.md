# Build hand-back 2 — build side to Claude design

> **Re:** `handoff/handoff/design_handoff_cabbage_v2/`. Everything in your hand-back 2 is built
> and has been played end to end in Chrome with 2, 3 and 4 players at 390, 360 and 1280 wide.
> Still not seen on Safari or a real phone. Three things are attached for you:
> `handoff/lily-treatment-test-2.png`, `handoff/mustard-cvd-test.png`, and
> `handoff/league-screens/` (19 screenshots at 390 wide, for mark-up).

## 1. The treatment sheet

Twelve Lily courts as natural, tinted and tritone, at full size and at table size, baked with
your `photo-treatment.js` (ported unchanged; browser and bake agree to within JPEG noise).

- **Tinted works.** On the dog-on-grass photos that failed before (QH, QD, KD) Lily stays
  separate from the grass, because the hue survives. The cost is that every photo looks a
  little greyed and flat next to the natural one. And the 22% pull toward the ink is so mild
  that red-suit and black-suit cards look almost the same, so it does little to unify a deck.
- **Tritone in red is better than the old duotone and still not usable on these photos.** It
  now has deep red shadows instead of pale pink, but dog and grass merge into one red texture;
  the face survives by shape, the body does not. KD is the worst. At table size the red
  tritones are red smudges. Tritone in black reads well, as before.
- **At table size, natural reads more clearly than tinted.** The table follows your rule (the
  mini-slot always shows tinted), but for this deck natural is visibly crisper at 26 px.

Where that leaves Lily: natural at the full face, tinted in the mini-slot. The owner asked for
Lily's photos as they are, so we would like your agreement to let a `natural` deck stay natural
in the mini-slot too.

## 2. Mustard under colour-vision deficiency

Simulated with the Machado 2009 matrices on the real strips, three-lane board, chips and
tracker.

- **Protanopia and deuteranopia:** tomato becomes a dark olive and mustard a yellow olive. They
  stay apart by lightness and, more reliably, by shape. Blue stays distinct. The quiet hole
  tints of the tomato and mustard lanes become nearly the same olive, so those two lanes are
  told apart only by position.
- **Tritanopia:** blue goes teal, tomato stays red, mustard turns pink; distinguishable by
  lightness and by the diamond.

All three teams stay distinguishable, but for red-blind players that rests on the diamond and
on lightness, not on colour. The diamond is doing the work you meant it to.

Mustard as text or a hairline is too light on enamel, so the build uses your
`--c-mustard-deep` for those.

## 3. What did not behave as the arithmetic expected

1. **"Margaret" at 360 with three opponents.** She needs 59 px. A cell without the dealer disc
   gives 65 px and she fits. With the dealer disc the name gets 43 px and shows "Marg…".
2. **Owner chips cancel the 20 px drop.** A chip plus its gap is 20 px above the other
   players' cards, which exactly cancels the 20 px your own cards sit lower. The build makes
   yours 20 px lower at 390, 10 px lower at the 76 px count step, and level at 360 × 740,
   where only the chip below marks them.
3. **"Counting now" / "Counts next" do not fit** beside the score with three opponents at 360.
   Four-player uses "Counting / Next / Later / Counted / Crib now / Crib next / Crib last".
4. **The 56 px strip zone overflowed by about 1.4 px.** Vertical padding trimmed to 5 px.
5. **Initials collide.** Two Margarets get the same "M" chip, and a blue "D" marker for Dave
   sits next to the black "D" dealer disc.
6. **The 44 px Home button and the your-turn outline** are unscoped in the v2 CSS, so they now
   apply to two-player games as well. We assume that is intended.

## 4. A deliberate departure: the count is spoken, and slower

The owner asked for the hand count to be "more obvious… step by step so it mimics a person
looking at the card and at a more human pace: 15 two, 15 four, a run is 3 for total of 7".
This replaces `motion.md`'s 450 ms show step.

- Each step is said with the running total carried forward: "Fifteen two", "fifteen four",
  "and a run of three is seven", then "Seven." as its own beat. A zero hand is
  "Nineteen — nothing this time".
- While a step is current, exactly its cards are lit (the starter included) and the reason
  sits under the phrase in small text: "5 + K = 15", "two 9s", "3 · 4 · 5", "jack of the
  starter's suit". Pairs and runs are counted one combination at a time.
- The running total is the large Besley number on the stage, in the butter box.
- Pace: 1.4 s per step, 1.8 s on the total, 200 ms with nothing lit between steps. A "brisk"
  setting on the profile halves it. Tapping the stage steps forward at once; "Count again"
  replays it.
- Your fold is in: once five lines would show, finished groups fold ("Fifteens, eight of
  them: 16"), and a 29 ends on one screen at 360 with no scrolling.

A relaxed 29 takes about 23 seconds unless the player taps. The stage during the count has no
drawing from you; it would benefit from one.

## 5. Also built since hand-back 1, without drawings

The league: home (your next game, games waiting on you, your queue), league (standings,
games being played and who each is waiting on, the queue, results), head-to-head with a
running-record chart, player page, hall of fame, hand-by-hand replay, profile (avatar, deck,
device linking by QR), commissioner tools, and bottom-tab navigation. All in
`handoff/league-screens/`.

## 6. Still open

- Safari and a real phone, including the dashed-line board holes.
- Presence.
- Sound.
- Your call on §1 (natural in the mini-slot) and on the collisions in §3.5.
