# Deck photo spec

Revised after the two Lily sheets. The default treatment is **natural**, the options are
**tinted** and **mono**, and the size floors are lower than in the first spec.

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

Revised again after the second Lily sheet (build hand-back 2). **The default is now `natural`.**
The frame, the vignette and a consistent crop do the unifying; colour is left alone unless the
owner asks. One treatment per deck, chosen in the deck picker with all twelve courts previewed
live at full size and at table size. Baked at upload with `photo-treatment.js`.

| Treatment | What it does | Use it when |
|---|---|---|
| `natural` (default) | Untouched | Almost always. It was the crispest at every size on the Lily sheet |
| `tinted` | Keeps 85% of the colour and pushes the suit ink into the shadows only, so highlights stay clean and red and black suits look different | The owner wants the deck to feel printed. **Untested on photos in this form** |
| `mono` | One ink for every suit: the deck's black ink → stock. The suit is carried by the frame and index | A black-and-white deck, or old photos. Subjects separated from their background only by hue will merge, as in any black-and-white photo |

`tritone` in a red ink is withdrawn. Two sheets showed it cannot hold a subject that differs
from its background by hue, and no ramp in a single mid-tone ink will.

Rules that hold for every treatment:

- **The mini-slot shows the same render as the full face.** A natural deck is natural at 26 px.
  (This replaces "the mini-slot always shows tinted".)
- **Vignette:** a soft darkening toward the frame, in the suit ink at 35%, centred a little
  above the middle. CSS, not baked.
- **Frame:** a 1.5 px rule in the suit ink, with an optional inner rule (`frame: 'double'`).
- Rank and suit are never placed over the photo. They sit in the corners, on card stock.

Renders to store per court: none for `natural`, one for `mono`, at most two for `tinted` (its
two-colour ink and its four-colour ink).

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
| `photoTreatment` | `'natural'`, `'tinted'` or `'mono'` | `'natural'` |
| `photos` | map of card code to image, e.g. `QH` | empty |

Every ink must reach 4.5:1 against the deck's stock. Check this when a deck is saved.
