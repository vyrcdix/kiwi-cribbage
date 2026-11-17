# Design hand-back 3 — Claude design to the build side

> **Re:** your build hand-back 2. Thank you for running the sheets and the simulator; both
> changed decisions below.
> **In this drop (`design_handoff_cabbage_v3`):** revised `photo-treatment.js` and
> `deck-photo-spec.md`; `Count.jsx` and a rewritten show section in `motion.md` for the spoken
> count; revised `Players.jsx` (dealer glyph, chips below, chip labels); a darker mustard lane
> tint in `Board.jsx`; and sound: `sounds.js`, `sound.md`, `sound-board.html`.
> **On the canvas:** "4 Show" and "Four players: show" are redrawn for the spoken count;
> "Three players: pegging" and "Board, three lanes" are corrected.

**What I did not receive.** `lily-treatment-test-2.png`, `mustard-cvd-test.png` and the 19
league screenshots did not reach me, only your note. Sections 1 and 2 rest on your written
findings. I cannot mark up the league screens until the owner attaches the images.

**What I checked.** Every component compiles and server-renders. `chipLabels` and the
treatment recipes were run on test values. `sounds.js` was run against a mock audio context to
confirm every call is valid. I have not heard a single sound, and nothing was viewed in a
browser.

## 1. Photo treatment

Your sheet settles it, and I am backing off further than you asked.

- **Agreed: a `natural` deck stays natural in the mini-slot.** The rule is now "the mini-slot
  shows the same render as the full face", for every treatment.
- **`natural` is now the default** for new decks. You found it crispest at every size, and the
  frame, vignette and crop already do the unifying. Lily stays natural.
- **`tritone` in red is withdrawn.** Two sheets are enough. It is replaced by **`mono`**: one
  ink for every suit, the deck's black ink → stock, with the suit carried by the frame and
  index. That is the ramp you reported reads well. Pass `deck.inks.black` whatever the suit.
- **`tinted` is retuned,** since you found it greyed and too mild to tell suits apart. It now
  keeps 85% of the colour (was 65%) and puts the ink into the shadows only, at up to 50%, fading
  to nothing at white. On test pixels the dog-to-grass distance is 64 in red and 57 in black
  (natural is 95, the old tinted was 52), and a dark grey lands on `#452A27` in red against
  `#313432` in black. It is an owner's option, not a default, and **untested on a photograph**.
  If a third sheet is cheap, I would like to see it; if not, ship natural and mono and leave
  tinted out of the picker.

## 2. Mustard

Accepted as you found it: shape and lightness carry it for red-blind players, which is what the
diamond is for. Two changes:

- **The mustard lane's hole tint is darker, `#94803F`** (was `#BFA256`), so under protanopia
  and deuteranopia the tomato and mustard lanes differ in lightness as well as position.
  Please re-run that one strip through the simulator.
- **`--c-mustard-deep` for text and hairlines: agreed.** Mustard itself is for fills only.

## 3. What did not behave

| # | Finding | Decision |
|---|---|---|
| 1 | "Margaret" gets 43 px beside the dealer disc | **The dealer marker moves to line two.** Line one is only the team marker and the name, so the name always has the full 65 px |
| 2 | Chips cancel the 20 px drop | **Every chip goes below its card.** Other players' cards then start at the top of the row and yours start lower, at no cost in height. Keep your 20 / 10 / 0 steps as `--drop`; with chips below, 10 px fits at 360 × 740 on my arithmetic, so try 10 before 0 |
| 3 | Statuses too long | **Yours stand:** Counting / Next / Later / Counted / Crib now / Crib next / Crib last |
| 4 | 1.4 px overflow | **Accepted:** 5 px vertical padding |
| 5 | Initials collide | **Two fixes.** The dealer is now a deck glyph, never a letter. Chips take a label from `chipLabels(players)`: one letter, or two when a letter repeats within a team (Margaret B. and Margaret T. are MB and MT; Dave and Dot are Da and Do; two plain Margarets are M1 and M2). Two-letter chips widen to a pill |
| 6 | Home button and your-turn outline in two-player | **Intended.** "4 Show" on the canvas now shows the Home button in a two-player game |

## 4. The spoken count

Accepted in full, and drawn. It is better than what I specified. The stage, top to bottom:

1. **The hand,** with exactly the current step's cards lit and the rest dim.
2. **What has been said,** one quiet line: "Fifteen two, fifteen four,". This is where your
   folded groups go.
3. **What is being said now,** large (26 px at 390, 22 px at 360), with the reason under it in
   small text. To its right, the running total in the butter box: 80 px square with a 54 px
   Besley number at 390, 64 px and 44 px at 360.

The prompt zone holds "Count again" as a 44 px round icon button, then "Continue". The prompt
text says whose count it is and that a tap steps on. On the last beat the cards return to full
strength and the total box goes from soft butter to full butter.

One suggestion on pace, optional: inside a run of the same kind, play the third and later
steps at 0.9 s. Eight fifteens then take 8 s instead of 11, and a relaxed 29 comes in near 18 s
without anyone touching the brisk setting.

## 5. Sound

Designed and built as recipes; **the owner picks the variants by ear** on the sound board.

- `sounds.js`: twelve sounds synthesised with Web Audio. No files, no libraries, about 4 KB.
- `sound.md`: what each is, when it fires, and the rules (fire on landing, unlock on first tap,
  on by default with one switch, nothing replayed in a burst on tap-to-skip).
- `sound-board.html`: plays each sound, and seven moments in sequence at game pace.

The palette is a kitchen table: a card on oilcloth, a wooden peg, a knuckle knocking for "go",
a spoon on an enamel mug for a score, a kitchen timer for the 29. The count's tick climbs a
note with each step, so a big hand rises before the total rings.

`VARIANT` at the top of `sounds.js` holds my picks (soft snap, wood peg, rising tick, mug
ting). The owner may change them. If `snap` and `peg` sound synthetic, `sound.md` says how to
swap in two recorded samples.

## 6. Still open

- The league screenshots, for mark-up. Not received.
- A third treatment sheet, if cheap: `tinted` (new recipe) and `mono`.
- The darker mustard lane tint through the simulator.
- Safari and a real phone: the dashed-line board holes, and now Web Audio unlock on iOS.
- Presence.
- The name.
