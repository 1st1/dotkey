# iWork format conventions

How Keynote actually stores things. Every entry here was a bug first, found by diffing against Keynote's own PDF export.

None of it is guessable from the protobuf schema: the field exists, but its meaning does not.

## Geometry flags are a size validity mask

`TSD.GeometryArchive.flags` is not a flip mask. Bit 0 means the width is explicit, bit 1 the height.

Measured across the sample deck: 133 objects with `flags = 0` all have `size = 0×0`; 25 with `flags = 1` all have a real width and zero height; 194 with `flags = 3` have both. A text box that grows with its content stores no size and marks the axis invalid. Flips live on the path source, not here.

## Auto-height boxes grow from their alignment anchor

A text box with no stored height grows around the point Keynote anchored it to, which is its vertical alignment. A middle-aligned box is *centred* on `position.y`; only a top-aligned one starts there.

Verified against four boxes on one slide, predicting ink positions to within 1 px. This is why [[lat.md/model#Document model#Frame anchoring]] exists in the model instead of the renderer just using `top`.

## Bezier paths are authored at an arbitrary scale

The same document contains paths in the shape's natural size, paths normalised to a 0..100 box, and paths at 0.375× the natural size. `naturalSize` cannot be trusted.

The one invariant is that the path fills the shape, so its own bounding box is what maps onto the element frame. Trusting `naturalSize` drew highlight rectangles at 37 % of their intended size.

## TSDEmptyPattern means no border

Keynote writes a complete stroke record — 1 pt, black — for every unbordered text box, and marks the pattern empty. 264 of the 277 shapes in the sample deck are in that state.

Reading width and colour alone paints a black box around every piece of text on the deck.

## Two opposite conventions for null attribute entries

Text attributes are sorted `(characterIndex, object)` tables. A null object means opposite things depending on the table.

- **Character styles**: null *clears* the override for the range it opens. Carrying the previous value forward makes a coloured word bleed to the end of the line.
- **Paragraph and list styles**: null means *unchanged*. The table marks every paragraph start, and only the ones whose style differs carry an object.

Both are implemented in [[packages/core/src/build/text.ts#attributeAt]] and [[packages/core/src/build/text.ts#inheritedAttributeAt]].

## Gradient angles live in the gradientangle field

`TSD.AngleGradientArchive` names its only field `gradientangle`, not `angle`. Reading the wrong name silently yields the default and rotates every gradient 90°.

Keynote measures counter-clockwise from "pointing right", so its 0° is a left-to-right ramp — CSS `90deg`. An "advanced" gradient stores a `start`/`end` axis instead, and the angle has to be derived from it.

SVG needs `stop-opacity` separately from `stop-color`: a gradient fading to transparent, which is how Keynote builds scrims, depends on it entirely.

A draggable midpoint between two stops is stored as an `inflection` on the first of the pair — the fraction of the span where the colours mix 50/50. CSS and SVG always blend linearly, so [[packages/core/src/model/gradient.ts#expandGradientStops]] turns an off-centre midpoint into an explicit third stop, and leaves the default alone.

## List indents mix units

`text_indents` are multiples of the font size (0.375, 0.45, 1.0, 2.14…) while `indents` are points (0, 18, 36, 48). The text indent is a *minimum* — a label wider than it pushes the text along rather than overlapping it.

## Paragraph spacing is suppressed at frame edges

A 45 pt "space before" must not push the first line of a text box down, nor "space after" pad the last. Applying them adds 45 px of phantom space to every single-paragraph box.

## An image mask is a window in the image's own coordinates

`ImageArchive.super.geometry` places the whole picture in parent coordinates; the mask's geometry is the visible window relative to the image.

So the element frame is `imageOrigin + maskOrigin` sized to the mask, and the picture is positioned relative to that frame as a crop rectangle.

## Keynote embeds formats browsers cannot show

TIFF and HEIC appear as the primary `data` reference, with a PNG derivative alongside in `thumbnailData`.

That derivative is a *thumbnail*, not an equivalent: a 900x560 pasted screenshot ships beside a 256x159 PNG. Preferring it keeps the image on screen but throws away most of its resolution, so a format we can decode ourselves counts as displayable and only one we can neither show nor decode (HEIC) falls back. See [[lat.md/architecture#Architecture#Media transcoding]].

## Build order lives in the chunk list

A slide has `builds` (what happens, to which drawable) and `buildChunks` (the play order). The chunk list is authoritative.

A chunk with `automatic: false` opens a new click stage; automatic ones join the stage in progress. An automatic chunk that comes *first* is stage 0 — it plays on slide entry with no click at all, which is how a movie set to autoplay is encoded.

Keynote also distinguishes "start with previous" from "start after previous", but only a single automatic flag per chunk is recorded, so that distinction is not recoverable. See [[lat.md/roadmap#Limitations]].
