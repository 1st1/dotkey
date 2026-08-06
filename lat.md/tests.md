---
lat:
  require-code-mention: true
---

# Tests

What is verified and why. Three layers: unit tests over the pure decoders and resolvers, an end-to-end parse of a real 21-slide deck, and two browser harnesses that measure the rendered result against Keynote's own output.

The specs below are the load-bearing ones — the cases where a regression would be silent rather than loud. `pnpm test` runs 165 tests in total.

No presentation is committed, so deck-backed tests split in two: [[lat.md/tests#Tests#Invariants hold for any deck]] run against whatever `.key` is present, and pinned expectations run only against the deck they were written from, matched by hash.

## Invariants hold for any deck

Swapping the fixture must not turn a passing suite red. Invariants are the tests that keep working on someone else's file, so they are the ones that catch a regression after handover.

### Survives a fixture swap
With a different deck, pinned suites skip rather than fail; with no deck at all, everything not needing one still runs. The gate is a SHA-256 of the file, resolved from `DOTKEY_FIXTURE` or the first `.key` in the repository root.

### Holds structural properties on any deck
Parses without warnings, numbers slides contiguously, gives every element a finite frame and unique id, and resolves every run to a real font and size.

Also: every build targets an element that exists and sits within the slide's stage count, no image is left in a format the browser cannot show, resource bytes match their advertised type, and the whole model round-trips through JSON.

## Container layer

The `.iwa` reader has no external ground truth, so it is tested against hand-built byte sequences. A bug here corrupts everything downstream, and the symptom is a protobuf parse error with no useful location.

### Decodes a literal Snappy block
A block of one literal element round-trips to its bytes, including the extended-length form where the tag says how many extra length bytes follow.

### Handles overlapping back-references
Snappy encodes a run of repeated bytes as a copy whose offset is smaller than its length, so the copy reads bytes it is still writing. Copying byte-by-byte is required; a bulk copy silently produces the wrong output.

### Rejects a corrupt block
A copy offset reaching before the start of the output, or a block that produces fewer bytes than its length preamble claims, throws rather than returning truncated data.

## Style resolution

iWork styles are a `super` stack that ends in a parent pointer, with nullable properties stored as a value plus a `_null` flag. Resolution is the single most reused piece of the extractor.

### Merges a style chain from ancestor to leaf
A variation style inherits everything its parent declares and overrides only what it sets, so a 40 pt override on a 48 pt Body style yields 40 pt and keeps the parent's font.

### Applies a null flag as an explicit clear
`font_color_null: true` removes an inherited colour instead of falling through to it. Without this, a style that deliberately drops a property silently keeps its parent's value.

### Collects same-named bags from every super level
`TSWP.ShapeStyleArchive` carries text-frame properties while the `TSD.ShapeStyleArchive` it wraps carries fill and stroke — both named `shape_properties`. Both must be merged.

### Survives a cycle in the parent chain
A damaged document can point two styles at each other. Resolution terminates instead of hanging.

## Text

Text is a flat string plus parallel attribute tables, and the tables use two opposite conventions for a null entry. See [[lat.md/format#iWork format conventions#Two opposite conventions for null attribute entries]].

### Clears a character override at a null entry
A null character-style entry ends the run it opens rather than carrying the previous style forward. Carrying forward makes a coloured word bleed to the end of the line.

### Carries a paragraph style forward across a null entry
Paragraph and list tables mark every paragraph start, and only the ones whose style differs carry an object. A null entry means "unchanged", the opposite of the character-style rule.

### Suppresses paragraph spacing at frame edges
A 45 pt "space before" does not push the first line of a text box down, nor "space after" pad the last. Applying them adds phantom space to every single-paragraph box.

### Splits runs at every character style boundary
Run boundaries come from the attribute table, and adjacent runs that resolve to identical styling are merged so the output has no redundant spans.

## Paint

Fills and strokes are where the schema is most misleading: fields exist whose names or defaults do not mean what they appear to.

### Reads the gradient angle from the gradientangle field
`TSD.AngleGradientArchive` names its only field `gradientangle`; reading `angle` yields the default and rotates every gradient 90°. Keynote's 0° is a left-to-right ramp, which is CSS `90deg`.

### Derives an angle from an advanced gradient axis
An "advanced" gradient stores `start`/`end` points instead of an angle; the angle is computed from the delta so the fallback default is never used silently.

### Preserves stop alpha
A gradient fading to transparent — how Keynote builds scrims — depends entirely on per-stop alpha surviving extraction.

### Expands a dragged gradient midpoint
Keynote stores a draggable midpoint as an `inflection`; CSS and SVG always blend linearly, so an off-centre midpoint becomes an explicit extra stop. A default midpoint changes nothing.

### Treats an empty stroke pattern as no border
Keynote writes a 1 pt black stroke for every unbordered text box and marks the pattern empty. Reading width and colour alone paints a box around all text on the deck.

## Font matching

A deck names fonts it does not carry, so matching them to something loadable is the one place where a wrong answer silently changes text *geometry* rather than just its look.

### Classifies installed families as system
Helvetica Neue, Arial, Menlo, PingFang SC and the rest of the platform faces are never fetched, however the name is spaced or cased.

### Snaps a requested weight onto one the family publishes
Lobster ships only 400. Asking `css2` for `Lobster:wght@700` returns 400 and takes down every family in that stylesheet, so the plan resolves it to 400 instead.

### Orders italic axis tuples for css2
`css2` rejects axis tuples that are not in ascending order, so a family needing both roman and italic emits `ital,wght@0,600;1,400`.

### Requests nothing when every font is installed
A deck using only platform faces produces no stylesheet URL at all, and so makes no third-party request.

## Media

Keynote embeds images browsers cannot display, so the decoder and re-encoder are tested against hand-built files rather than the fixture — a wrong byte here shows up as an image that silently fails to load.

### Decodes uncompressed TIFF strips
An RGB TIFF round-trips to the right pixels, with the horizontal differencing predictor undone and WhiteIsZero greyscale inverted.

### Declines TIFF features it does not implement
LZW compression and bit depths other than 8 return `undefined` so the caller falls back to the document's derivative instead of receiving a half-decoded image.

### Writes IDAT as a zlib stream
PNG wraps its DEFLATE payload in a zlib header with a trailing Adler-32. Emitting the bare DEFLATE stream that `fflate`'s `deflateSync` returns produces a file no browser will decode — and one that still looks like a valid PNG to a casual check.

### Serves the original rather than the thumbnail
The sample deck's 900x560 TIFF is served as a 900x560 PNG, not as the 256x159 derivative stored beside it, and the stored bytes stay reachable.

## Animation

Builds are split across two lists, and the order comes from the one that does not describe what happens. See [[lat.md/format#iWork format conventions#Build order lives in the chunk list]].

### Assigns a click stage per non-automatic chunk
Walking the chunk list, a chunk that waits for a click opens the next stage and automatic ones join the stage in progress, so three simultaneous actions collapse to a single click.

### Plays a leading automatic chunk on slide entry
An automatic chunk that comes first is stage 0: it runs as the slide appears and the slide needs no clicks at all. This is how an autoplaying movie is encoded.

### Normalises effect ids to a renderable family
Keynote's effect vocabulary (`apple:bc-appear`, `apple:dissolve character`, `apple:action-motion-path`) maps to a small union the renderer understands, with the longest match winning so `objectcube` is not read as `cube`.

### Reads a motion path as offsets from the element position
An action build's path is a `TSD.PathSourceArchive` whose coordinates are deltas in points from where the element already sits.

## Whole-deck parse

An end-to-end parse of the sample deck guards the interactions that unit tests cannot reach: the style graph, the resource index and the element tree together.

### Parses the sample deck without warnings
2210 objects across 47 components decode with zero warnings and zero unrecognised drawables, which is the check that catches a schema or registry regression.

### Anchors auto-height text boxes on their alignment
A middle-aligned auto-height box reports `anchorY: 'center'`, so a renderer centres it on the stored `y` instead of starting there. See [[lat.md/format#iWork format conventions#Auto-height boxes grow from their alignment anchor]].

### Turns an image mask into a frame plus a crop
The element frame is the visible window and the picture is positioned relative to it, so a cropped image is never larger than the frame it is seen through.

### Prefers image data a browser can display
The deck embeds a TIFF alongside a PNG derivative; no element in the model may point at a format a browser cannot decode.

### Produces a JSON-serialisable model
The whole deck survives a `JSON.parse(JSON.stringify(...))` round trip unchanged, which is the property the renderer-agnostic design depends on.

## Browser verification

Two harnesses drive the demo app in a real browser. They are not part of `pnpm test` because they need a running dev server and the `agent-browser` CLI.

### Diffs every slide against the PDF export
All 21 slides are rendered at 1920x1080 and compared per-pixel with the matching page of Keynote's own PDF, rasterised at the same size by pdf.js so both go through one screenshot path. Mean mismatch is 1.38 %.

### Keeps a new slide's builds hidden on the first paint
Entering a slide must not paint one frame at the previous slide's stage. A mutation observer watches for any element that goes visible and then hidden across a slide change; there should be none.

### Drives build and transition playback
Playback is asserted by seeking rather than watching, because a headless browser produces no frames and a headed window that loses focus is throttled to none.

Every animation is paused and seeked to a fixed progress, which applies the interpolated value synchronously — testing the keyframes and the settled state deterministically.
