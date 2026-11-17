# Deck photo spec

Revised after the Lily test (hand-back 1). Changes: the default treatment is now **tinted**,
duotone is replaced by **tritone**, and the size floors are lower.

A custom deck is about 14 images: 12 courts (J, Q, K in each suit), one back, and optionally an
ace of spades. Everything else is drawn from the deck's tokens.

## Court and ace photos

| | |
|---|---|
| Aspect ratio | **4:5 portrait**. Anything else is centre-cropped to 4:5 on upload |
| Slot on the card | 70% of the card's width, centred; 15% margin each side, 18.75% top and bottom |
| Face safe area | An ellipse 56% of the photo's width by 50% of its height, starting 16% from the top. Eyes (or the dog's) should sit in its upper half |
| Preferred size | 800 × 1000 px or larger |
| Warn below | 800 × 1000 px: "This one will look soft at full size" |
| Refuse below | **200 × 250 px**. Under that it is soft even in the mini-slot |
| Stored size | Resize down to 800 × 1000 at most; never upscale. JPEG or WebP at about 80% quality |
| Crop anchor | `object-position: 50% 35%`, so a slightly loose crop keeps the face |

The full face is only ever seen in the deck picker, the replay and a 29. On the table a court
photo is a 23 × 29 px mini-slot (CSS pixels), so a 300 px source is plenty there. That is why
small photos get a warning, not a refusal.

The upload screen should show the dashed ellipse over the photo and let the owner drag and
pinch to place the subject inside it. That one step fixes most bad crops.

## Treatment

One treatment per deck, chosen by the owner in the deck picker **with all twelve courts
previewed live**, at full size and at table size. Baked at upload with `photo-treatment.js`.

| Treatment | What it does | Use it when |
|---|---|---|
| `tinted` (default) | Saturation down to 65%, then pulled 22% toward the suit's tritone. Levels stretched first | Almost always. It keeps hue, so a rust dog still stands off green grass |
| `tritone` | Shadow ink → suit ink → stock. Black maps to the ink mixed 85% toward rim ink; the pure ink sits in the lower-middle tones | Portraits with strong light and dark, where the subject is separated by brightness |
| `natural` | Untouched | A deck of consistent, well-lit photos |

Rules that hold for every treatment:

- **Below 90 px card width, the mini-slot always shows the `tinted` render**, whatever the
  deck's treatment. Tritone turns to a smudge at 23 px wide; tinted and natural do not.
- **Vignette:** a soft darkening toward the frame, in the suit ink at 35%, centred a little
  above the middle. CSS, not baked.
- **Frame:** a 1.5 px rule in the suit ink, with an optional inner rule (`frame: 'double'`).
- Rank and suit are never placed over the photo. They sit in the corners, on card stock.

What the old duotone got wrong: it mapped black to the ink itself. The red ink is a mid-tone,
so the whole photo was squeezed into the lighter part of the range (0.67 of the lightness span,
against 0.81 for tritone and 0.96 for tinted, on the same test pixels). No single-ink mapping
can rescue a subject that differs from its background by hue alone, which is why tritone is no
longer the default.

A court needs at most two renders per treatment: its two-colour ink and its four-colour ink
(the same for spades and hearts). Store tinted always, for the mini-slot.

## The back

| | |
|---|---|
| Aspect ratio | **5:7 portrait**, full bleed inside a 6% stock border |
| Preferred size | 750 × 1050 px. This is for the deck picker, where a back is shown about 250 px wide on a 3× screen |
| Warn below | **500 × 700 px**. Lily's 600 × 840 is fine and gets no warning |
| Refuse below | 250 × 350 px |
| Safe area | Keep anything important in the middle 80%; the corners are rounded |
| Treatment | None by default. Backs appear at 16 to 22 px wide in the opponent strips, so bold, simple images work best |
| Default | Oilcloth check in the deck's back ink, with the kiwi roundel at 90 px and over |

## What a deck can set

| Token | Type | House default (Enamel) |
|---|---|---|
| `stock` | colour | `#FCFAF4` |
| `edge` | colour | `#CFC8B6` |
| `inks.black`, `inks.red` | colour | `#1F2723`, `#BE3228` |
| `inks.blue`, `inks.green` | colour, used for four-colour suits | `#2F6FA8`, `#1E5C3A` |
| `back.ink` | colour | `#2F6B45` |
| `back.photo` | image or null | null |
| `radius` | fraction of card width, 0.03 to 0.12 | 0.07 |
| `indexFont` | font stack | Besley |
| `frame` | `'single'` or `'double'` | `'double'` |
| `photoTreatment` | `'tinted'`, `'tritone'` or `'natural'` | `'tinted'` |
| `photos` | map of card code to image, e.g. `QH` | empty |

Every ink must reach 4.5:1 against the deck's stock. Check this when a deck is saved.
