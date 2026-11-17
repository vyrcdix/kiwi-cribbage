# Sound

Twelve sounds, all synthesised in `sounds.js` with Web Audio. No audio files to ship, cache
or license. `sound-board.html` plays each one, alone and in sequence at game pace.

**Not heard by the designer.** These were designed as recipes and checked only for running
without errors. The owner auditions them on the sound board and picks the variants; expect a
round of tuning.

## The palette

A kitchen table, not an arcade. Every sound is something that could happen at one: paper on
oilcloth, wood in a hole, a knuckle on the table, a spoon on an enamel mug, a kitchen timer.
Short, dry, quiet. Nothing musical except the count, the win and the 29.

| Sound | What it is | Fires when | Length |
|---|---|---|---|
| `snap` | A card landing. Variants: **soft** (pick), crisp | A played card or discard lands | 50 ms |
| `deal` | The snap, quieter, slightly different each time | Each dealt card lands | 35 ms |
| `flip` | A swish, then a snap | The starter turns over | 170 ms |
| `peg` | A peg seating. Variants: **wood** (pick), pin | A peg seats; one click per move | 70 ms |
| `pegTick` | A faint tick | Every fifth hole of a move longer than 5 | 20 ms |
| `tick` | A fingertip tap. Variants: **rising** (pick), flat | Each phrase of the spoken count | 60 ms |
| `ting` | A spoon on enamel. Variants: **mug** (pick), bowl | A score in pegging; the total of a count | 400 ms |
| `knock` | Two knuckle knocks | "Go" | 250 ms |
| `win` | Three tings, climbing | The winning peg seats | 1.2 s |
| `thud` | A soft heavy thump and one bounce | The kiwi lands | 400 ms |
| `stamp` | A flat stamp | The SKUNKED plate | 100 ms |
| `twentyNine` | A kitchen timer bell | The 29, on "29" appearing | 2.2 s |

The rising `tick` is the one idea worth protecting: each step of the count is a note higher
(a major pentatonic), so a four-point hand goes up two notes and a 29 climbs the whole scale
before the timer goes off. Pass `{ step }` from 0. A folded group still ticks once per phrase.

"Go" is a knock because players really do knock. With the Go button gone, the knock and the
word in the prompt are what is left of the ritual.

## Rules

- **Sound fires when something lands,** never when it starts. Schedule with `{ at }` from the
  animation's end time; do not use `setTimeout`.
- **Call `unlock()` from the first tap** on the table. Browsers will not start audio otherwise.
- **On by default, one switch to turn it off,** on the profile, stored per device. Add a volume
  only if someone asks.
- **Tap to skip** must not replay skipped sounds in a burst. `play()` already drops repeats of
  `snap`, `deal` and `pegTick` that arrive too close together; when a skip jumps to an end state,
  play only the last landing sound.
- **Keep the deal short with more players.** In three- and four-player games play `deal` only
  for cards dealt to you; the others land silently.
- **Reduced motion does not mean reduced sound.** When nothing travels, the sounds are most of
  the feedback.
- **Haptics pair with sounds** as listed in `motion.md`. A phone on silent still gets them.
- **Nothing plays for:** errors, reconnecting, your turn, navigation, typing. If "your turn"
  needs a cue when the tab is in the background, use the page title, not a sound.

## If synthesis is not good enough

The two sounds most likely to disappoint are `snap` and `peg`, because the real things are so
familiar. They are also the easiest to replace: record a card slapped on a table and a peg
pushed into a board with a phone, trim to 80 ms, and swap them in as two small buffers. The
other ten are abstract enough that synthesis should hold.
