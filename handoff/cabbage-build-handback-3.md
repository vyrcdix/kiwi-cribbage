# Cabbage: the build's note back on handoff v3

Reply to `handoff/handoff/design_handoff_cabbage_v3/`. Everything in v3 is built. Checked in headless Chrome at 390×844 and 360×740; not yet on Safari or a real phone, and nobody has heard the sounds.

## Attachments

Design said three sets of files never arrived. They are in this folder, alongside the new ones:

| File | What it is |
|---|---|
| `lily-treatment-test-3.png` | New. Natural, tinted and mono, full card and table size, from the build's own renders |
| `mustard-cvd-test-2.png` | New. The CVD sheet re-run with the mustard hole tint at `#94803F` |
| `v3-screens/` | New. The count stage (mid-count, finished, a 29, a zero hand), chips and strips at 360, two at 390 |
| `lily-treatment-test-2.png`, `mustard-cvd-test.png`, `league-screens/` | The v2 attachments design never received |

## §1 Photo treatments: done

- Three treatments: natural (the default for every deck), tinted (saturation 0.85, strength 0.5 × (1 − tone)), mono (black ink for every suit).
- The mini slot uses the same render as the full card. The `miniTreatment` prop is gone.
- Tritone renders are deleted. Lily is rebaked: 30 files (12 tinted, 6 tinted four-colour, 12 mono).
- Tinted stays in the picker. Look at the new sheet: at table size it is hard to tell from natural, so design may want to drop it.

## §2 Mustard: done

Lane hole tint is `#94803F`. The CVD sheet is re-run and attached; design has not seen it yet.

## §3 Strips and chips: done

- The dealer is a deck glyph at the start of line two of the compact strip.
- Chips sit below the card. Your own cards drop by `--drop`: 20 px, 16 px in a short stage, 10 px in the shortest. Design gave one value; the two smaller ones are the build's, to keep the row inside the stage at 360×740.
- `chipLabels` gives one letter unless partners share an initial; then the first letter that differs (Da / Do, MB / MT), else the seat number (M1 / M3). Two-letter chips are wide pills.

## §4 The spoken count: done

- One quiet line of what has been said, the current phrase large with its reason, and the running total in the butter box. Long counts fold: "Fifteens, eight of them: 16; pairs, four of them: 8,".
- Count again is a 44 px round icon button before Continue. It shows only when a finished count had something in it.
- While counting the prompt reads "Your hand · tap to step on". At 360 wide that wraps to two lines beside Skip to total. Shorter wording welcome.
- The optional pace is in: the third and later steps of the same kind take 0.9 s.
- Zero hand: "Nineteen. Nothing this time.", total box 0.
- 120 ms cross-fade between phrases and a 120 ms roll on the total; both collapse under reduced motion.

## §5 Sound: done, unheard

`src/game/sounds.ts` is a typed port of `sounds.js`. Every cue in `sound.md` is wired to the moment the thing lands. One switch on Profile, on by default, kept per device.

Where the build differs or had to decide:

- `play()` never unlocks audio itself. Only the first tap at the table, or turning the Profile switch on, does.
- No `ting` for a zero hand, and none when the count is skipped to the total.
- A go that scores plays the knock, then the ting 0.4 s later.
- Under reduced motion the kiwi's thud is dropped (there is no drop to land); the stamp still sounds.
- `pegTick` timers are cancelled with the move, so a skip cannot burst.

## Also built since v2: presence

Other players see a card lift in your hand while you consider it. The server sends a scrambled slot number, never the card, so the lift says nothing about rank. It works in the deal and the pegging, at 2, 3 and 4 players. Design has not drawn this; what is there is a small lift on the card back in the strip.

## Still open

- Safari and a real phone, including whether audio unlocks on the first tap on iOS.
- The sounds need a listen by a person: levels, and whether `deal` is too busy in a two-player deal.
- Whether tinted stays.
- The name.
