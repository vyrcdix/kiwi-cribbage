# Cabbage — design brief

> **From:** Cabbage build side · **To:** Claude design ·
> **Asking for:** the visual identity, the game table, the cribbage board, and
> the card system, returned as `handoff/design_handoff_cabbage/` (README +
> tokens + JSX/SVG reference), the same shape as the Kennel handoffs.

## 1. What Cabbage is

A cribbage game for two people on different phones or computers, playing in
real time. It is private: a circle of friends and family who join by invite
link. Nobody is a stranger, so the tone is a kitchen-table game between people
who have been keeping score against each other for years.

The name is a joke on "cribbage", and the joke is load-bearing: a player who is
skunked (loses with fewer than 91 points) **gets the cabbage**. The cabbage is
the mark, the trophy, and the booby prize.

Most play happens on a phone held upright. Laptop and tablet matter, but phone
portrait is the design target: **390 × 844**, and it must still work at 360
wide.

## 2. What already exists

A working, unstyled-but-functional slice. Design is restyling and restructuring
real screens, not inventing a product.

- The server runs the rules and sends each player only what they may see.
- The client has: welcome (enter your name), home (new game, your games), and
  the table with every phase of a hand.
- Every card on screen is drawn by one component, `CardView`. Whatever the card
  system becomes, it lands there.

### The phases of a hand (each needs a designed state)

| Phase | What the player does | What is on the table |
|---|---|---|
| Deal / discard | Picks 2 of 6 cards for the crib, confirms | Own 6 cards, opponent's 6 face-down, deck, whose crib it is |
| Cut | Non-dealer taps the deck | Deck, then the starter card turned up. A jack scores 2 for the dealer ("his heels") |
| Pegging | Players alternate laying cards, count runs to 31 | Running count, cards played in order and by whom, cards that can't be played are dimmed, "go" |
| Show | Watches three counts: non-dealer's hand, dealer's hand, the crib | Four cards + starter, each scoring combination called out in turn, total, Continue |
| Game over | Rematch or home | Winner, final scores, skunk / double skunk, game stats |

Also: waiting for an opponent (invite link, copy, share), opponent offline,
reconnecting.

## 3. What we need designed

### 3.1 Identity
- A cabbage mark that works as an app icon, a favicon, and a trophy.
- Palette, type, and the general material of the thing. Our starting instinct
  is a warm card table (felt, wood, brass, cream card stock) but we would
  rather be surprised than confirmed. The one thing to avoid is casino.

### 3.2 The table (phone portrait first)
One layout that holds through every phase above without things jumping around:
opponent at the top, you at the bottom, the board, the deck and starter, the
play area, and one clear line saying what you should do now.

The hard constraints:
- Six cards in your hand must be individually tappable at 360 wide.
- During pegging, up to eight played cards are visible, and it must be obvious
  which were yours, which were theirs, and which belong to the current count.
- The running count is the most important number on screen during pegging.
- The board is always visible. People look at it constantly.

Please also show how the layout opens up at laptop width.

### 3.3 The board
This is the emotional centre of cribbage and where we most want craft.

- 121 holes per player, two players, a front peg and a back peg each. The back
  peg marks the previous score; pegs leapfrog.
- Skunk line at 91, double-skunk line at 61, and the finish hole.
- Legible on a phone: a player must be able to see at a glance who is ahead and
  by roughly how much. A serpentine or three-street layout is traditional; a
  straight track is easier to read. Your call, with reasons.
- Peg movement: how the peg lifts, travels and seats, for 1 point and for 24.
- It should be buildable as SVG.

### 3.4 The card system
This is the feature the owner cares about most: **custom decks made from their
own photos.**

A deck is supplied as roughly 14 images: 12 court cards (J, Q, K in each suit),
one back, and optionally an ace of spades. Everything else — the 40 number
cards and the frame around the photos — is drawn in code to match.

The first real deck already exists and is the test case for everything below:
**the Lily deck**, built from phone photos of the owner's dog (a rust-coloured
vizsla). The back and all twelve court cards are in `public/decks/lily/`
(600×840 JPEGs), and `/deck` in the running app shows the whole deck. Some
sources are sharp portraits, five are small crops from one collage, one is a
motion-blurred action shot. That unevenness is typical of what decks will be
made from.

So a deck is really a **theme**: a set of tokens plus photo slots. We need:

- **The number cards**: pip layout, corner index, suit glyphs. Must stay
  readable when the card is about 52px wide (a six-card hand on a small phone).
- **The court frame**: how a portrait photo sits inside a J/Q/K. Rank and suit
  must still read instantly. Photos will be ordinary family pictures of uneven
  quality, lighting and crop, so the frame has to do a lot of unifying work
  (duotone? vignette? a consistent border?). Specify the photo slot: aspect
  ratio, safe area for the face, minimum resolution.
- **The back**: a full-bleed photo or pattern slot, plus a default.
- **The theme tokens** a deck can set: card stock colour, ink colours for the
  two (or four) suit colours, frame style, index typeface, photo treatment,
  corner radius.
- **Three house decks** built from those tokens with no photos, so the game
  looks finished before anyone uploads anything. One classic, two with
  personality.
- An option for four-colour suits, for colour-blind players.

Cards are 5:7.

### 3.5 Moments
Storyboards or motion notes for the handful of moments that make the game feel
alive. Keep them short; players will see each one thousands of times.

- The deal, and the two discards sliding to the crib.
- The cut and the turn of the starter. His heels.
- Laying a card in pegging; a score in pegging ("fifteen for two").
- The show: each combination lights up its cards in turn, in the traditional
  spoken order — "fifteen two, fifteen four, and a pair is six".
- The peg advancing.
- Winning. Being skunked, and receiving the cabbage.
- A 29 hand. It happens about once in 216,000 hands; it should be an event.

We will add sound (card snap, peg click) and phone vibration. Note where they
belong.

### 3.6 The other screens
Lower priority than the table; a consistent treatment is enough.

- Welcome / "you've been invited".
- Home: start a game, games in progress, recent results.
- Profile: name, avatar, chosen deck.
- Head-to-head: the rivalry page for two players. Lifetime record, current
  streak, skunks given and taken, average hand and crib, best hand. This is the
  page people will screenshot and send to each other.
- Hall of fame: badges for a 29, a 28, a "nineteen" (a zero-point hand), a
  double skunk.
- Deck picker.
- Replay of a finished game, hand by hand.

## 4. Constraints from the build

- React and plain CSS; no component or animation libraries. SVG is welcome.
- Animations must degrade cleanly under `prefers-reduced-motion`.
- Touch targets at least 44px. No horizontal scrolling at 360px.
- Light enough for a five-year-old phone: no full-screen blurs or large
  animated filters.
- Dark and light are not both required. One well-made look is better.
- Text the game can supply for any state: player names, scores, dealer, whose
  turn, the count, each scoring combination with its cards and points, and a
  per-game tally of pegging, hand and crib points.

## 5. What we would like back

`handoff/design_handoff_cabbage/` containing:

1. `README.md` — the decisions and the reasons, and anything you want the build
   to push back on.
2. Design tokens (colour, type, spacing, radii, motion durations and easings).
3. JSX + CSS reference for: the table in each phase, the board, `CardView`
   (number card, court frame with a photo slot, back), and the three house
   decks as token sets.
4. The deck photo spec: slot aspect ratio, safe area, minimum pixel size, and
   the treatment applied.
5. Motion notes for §3.5.
6. The cabbage mark as SVG.

## 6. Questions for design

1. Board layout: straight, serpentine, or something else, given a phone?
2. Can one court frame flatter both a studio portrait and a blurry holiday
   snap, or do we need two treatments the deck owner chooses between?
3. Where does the show happen: in place on the table, or as its own stage?
4. Is there a tasteful way to make the opponent feel present (their card being
   hovered, a small reaction) without it becoming chat?
