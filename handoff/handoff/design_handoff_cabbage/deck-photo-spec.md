# Deck photo spec

A custom deck is about 14 images: 12 courts (J, Q, K in each suit), one back, and optionally an
ace of spades. Everything else is drawn from the deck's tokens.

## Court and ace photos

| | |
|---|---|
| Aspect ratio | **4:5 portrait**. Anything else is centre-cropped to 4:5 on upload |
| Slot on the card | 70% of the card's width, centred; 15% margin each side, 18.75% top and bottom |
| Face safe area | An ellipse 56% of the photo's width by 50% of its height, starting 16% from the top. Eyes should sit in its upper half |
| Minimum size | **800 × 1000 px**. Warn below this; refuse below 400 × 500 |
| Preferred size | 1200 × 1500 px |
| Stored size | Resize to 800 × 1000, JPEG or WebP at about 80% quality; target under 150 KB each |
| Crop anchor | `object-position: 50% 35%`, so a slightly loose crop keeps the face |

The upload screen should show the dashed ellipse over the photo and let the owner drag and
pinch to place the face inside it. That one step fixes most bad crops.

## Treatment

Applied to every photo in a deck, so twelve unrelated pictures read as one set.

1. **Duotone (default).** Convert to greyscale, raise contrast by 15%, then map black to the
   card's suit ink and white to the card stock. Hearts and diamonds come out in the red ink,
   spades and clubs in the black; with four-colour suits on, each suit takes its own ink.
2. **Vignette.** A soft darkening toward the frame, in the suit ink at 35%, centred a little
   above the middle. It hides messy backgrounds and pulls the eye to the face.
3. **Frame.** A 1.5 px rule in the suit ink, with an optional inner rule (`frame: 'double'`).

`photoTreatment: 'natural'` skips step 1 only. It suits a deck of consistent, well-lit photos.

**Bake the duotone at upload.** Because the ink depends on the suit and on the four-colour
setting, a court photo needs at most two renders (its two-colour ink and its four-colour ink;
they are the same for spades and hearts). Draw to a canvas, map the luminance between the two
colours, and store the result. `styles.css` has a CSS blend-mode version as the fallback.

Rank and suit are never placed over the photo. They sit in the corners, on card stock.

## The back

| | |
|---|---|
| Aspect ratio | **5:7 portrait**, full bleed inside a 6% stock border |
| Minimum size | 750 × 1050 px |
| Safe area | Keep anything important in the middle 80%; the corners are rounded |
| Treatment | None by default. Backs appear at 22 px wide in the opponent's strip, so bold, simple images work best |
| Default | Oilcloth check in the deck's back ink, with the kiwi roundel at 90 px and over |

A back must not reveal orientation: reject or warn on images that look clearly different upside
down only if you later add card rotation. Today cards never rotate, so this is not a constraint.

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
| `photoTreatment` | `'duotone'` or `'natural'` | `'duotone'` |
| `photos` | map of card code to image, e.g. `QH` | empty |

Every ink must reach 4.5:1 against the deck's stock. Check this when a deck is saved.
