# dotkey

Read Apple Keynote (`.key`) files in TypeScript, and render them in React.

```bash
npm i @dotkey/core @dotkey/react
```

```tsx
import { Keynote } from '@dotkey/react';

<Keynote src={file} style={{ height: '100dvh' }} />;
```

A **renderer, not an editor**. It opens the package, decodes the iWork archives,
resolves the style graph into a plain JSON document model, and draws that model
with DOM, SVG and the Web Animations API.

Measured against Keynote's own PDF export of a 21-slide deck at 1920×1080, the
mean per-pixel mismatch is **1.3 %**; slides without photographs land between
0.07 % and 1.6 %. Object builds and slide transitions play. See
[Verification](#verification).

---

## Why this exists

Keynote can already publish a deck for the web, but it does so by rasterising
each slide to images at a fixed resolution. On a high-DPI display the result is
visibly soft — worst of all on text, which is the part of a slide that most
needs to be sharp.

dotkey renders the deck rather than photographing it. Text stays real text,
shapes stay vector, and each slide is laid out at its authored size and fitted
with a single `transform: scale()` — so it is as crisp on a 5K display as in a
thumbnail, at no extra cost in bytes. The text is also still text: `plainText`
on every slide makes a deck searchable, and screen readers see words rather than
a picture of words.

The scope is deliberately narrower than Keynote's. This reads and draws
presentations; it does not set out to reproduce Keynote's editing interface.
What it produces is a documented JSON model, and what a host application does
with that model is up to it.

---

## Packages

| Package | What it does | Runs on |
| --- | --- | --- |
| [`@dotkey/core`](packages/core) | `.key` → `Deck` (plain JSON) | browsers, Node, Deno, Bun, workers |
| [`@dotkey/react`](packages/react) | `Deck` → React elements | React ≥ 18 |
| [`@dotkey/vercel`](packages/vercel) | Vercel-style full-screen viewer chrome | React ≥ 18 |

The split is deliberate: parsing has no opinion about rendering. You can parse
on a server, cache the JSON, and render it with React, canvas, or a PDF writer.
`@dotkey/core` has no React dependency and no `node:` imports — the browser
bundle is verified to contain none.

---

## Parsing

```ts
import { parseKeynote } from '@dotkey/core';

const doc = await parseKeynote(await file.arrayBuffer());

doc.deck.size;                 // { width: 1920, height: 1080 }
doc.deck.slides[0].elements;   // z-ordered element tree
doc.deck.slides[0].plainText;  // text content, for search or an outline
doc.deck.slides[0].builds;     // object animations, each with a click stage
doc.deck.fonts;                // ['Geist-Medium', 'HelveticaNeue', …]
doc.resourceUrl('8073');       // blob: URL, transcoding TIFF if needed
```

`parseKeynote` accepts an `ArrayBuffer`, `Uint8Array`, `Blob` or `File`. Node has
an entry point that also reads expanded `.key` package directories:

```ts
import { readKeynoteFile } from '@dotkey/core/node';

const doc = await readKeynoteFile('deck.key');
```

Everything in `doc.deck` is plain JSON — no protobuf, no object references, no
binary. It survives a `JSON.parse(JSON.stringify(…))` round trip, which is a
test, so you can cache it or send it over the wire.

## Rendering

```tsx
<Keynote src="/deck.key" mode="slide" />   // one slide, arrow keys to navigate
<Keynote src="/deck.key" mode="scroll" />  // every slide stacked
<Keynote src="/deck.key" mode="grid" />    // thumbnail grid
```

In `slide` mode a click or arrow key advances the next object build and only
moves on once the slide is fully built — the sequence Keynote itself plays.
`animate={false}` renders every slide fully built instead, and a viewer who has
asked for reduced motion gets that automatically.

| Prop | Default | |
| --- | --- | --- |
| `src` | — | URL, `File`/`Blob`, bytes, or a parsed `KeynoteDocument` |
| `mode` | `'slide'` | `'slide'` \| `'scroll'` \| `'grid'` |
| `slide` / `defaultSlide` | `0` | controlled / uncontrolled slide index |
| `animate` | `true` | play builds and transitions |
| `fonts` | `{}` | see [Fonts](#fonts); `false` disables all font loading |
| `keyboard` | `true` | arrows, space, page up/down, home/end |
| `clickToAdvance` | `true` | clicking the slide advances it |
| `playMedia` | `true` | autoplay video and animated media |
| `respectSkipped` | `true` | skip slides marked "skip" when navigating |
| `lineHeightBasis` | `1.2` | tunes relative line spacing (see below) |
| `controlsRef` | — | receives `{ advance, retreat, goToSlide }` |
| `onSlideChange`, `onStageChange`, `onLoad` | — | callbacks |
| `loading`, `error` | — | render slots |

Drive it from your own chrome with `controlsRef` — `advance()` is the same
action a click performs, so a custom "next" button plays the slide's builds
before moving on. Setting the `slide` prop directly jumps and skips them, which
is what you want for a thumbnail grid and not for a next button.

```tsx
const controls = useRef<KeynoteControls>(null);

<Keynote src={file} controlsRef={controls} />
<button onClick={() => controls.current?.advance()}>Next</button>
```

Or compose the pieces yourself — `SlideView` for a static slide, `SlidePlayer`
for an animated one:

```tsx
import { KeynoteProvider, SlidePlayer, Stage } from '@dotkey/react';

<KeynoteProvider deck={doc.deck} source={doc}>
  <Stage containerStyle={{ height: '100dvh' }}>
    <SlidePlayer slide={doc.deck.slides[3]} playbackRef={playback} />
  </Stage>
</KeynoteProvider>;
```

`usePlayback` drives the build sequence on its own if you would rather build all
the chrome: it exposes `stage`, `stageCount`, `next()`, `previous()`, `goTo()`
and `showAll()`.

## Fonts

Keynote references fonts **by name only** — no `.key` file contains font data.
A deck using a typeface the viewer lacks renders with fallback metrics, and
because auto-sized text boxes are measured by the browser, that changes geometry
rather than just letterforms.

`<Keynote>` handles this by default: families that ship with macOS or Windows are
never fetched, and the rest are matched against Google Fonts and requested in
exactly the weights the deck uses.

```
system       Arial           wants 400            | load —
google       Geist           wants 500,700        | load 500,700
google       Geist Mono      wants 400,400i,600   | load 400,400i,600
system       Helvetica Neue  wants 400,500,700    | load —
```

Slides are held back until those faces are usable, with a timeout so a blocked
CDN cannot hang the viewer.

```tsx
<Keynote src={file} fonts={false} />                             // load nothing
<Keynote src={file} fonts={{ origin: 'https://fonts.acme' }} />  // self-hosted
<Keynote src={file} fonts={{ display: 'swap', timeout: 1000 }} />
```

Plan it yourself — the matcher is a pure function, no network, no DOM:

```ts
import { googleFontsUrl, planFonts } from '@dotkey/core/fonts';

const planned = planFonts(deck.fonts);
planned.filter((f) => f.source === 'unavailable'); // you must supply these
googleFontsUrl(planned);
```

This is a separate entry point because it carries a catalogue of 1942 families
(34 KB, 12 KB compressed) that decks with only installed fonts never need.

---

## How it works

A `.key` file is a zip archive:

```
Index/*.iwa        the document, as compressed protobuf archives
Data/*             images, movies, thumbnails
Metadata/*.plist   document identity and version history
preview*.jpg       thumbnails Finder and Quick Look use
```

1. **Unzip** — `fflate`, so the same code runs in a browser and in Node.
2. **Decompress** — each `.iwa` is a chunk stream: a `0x00` byte, a 3-byte
   little-endian length, then a *raw* Snappy block. Not the Snappy framing
   format, so the decoder is written from scratch.
3. **Decode** — the result is `varint(len) TSP.ArchiveInfo <payloads…>` records.
   Each payload's numeric type maps to a protobuf message via `TSPRegistry`.
4. **Index** — objects go into a store keyed by identifier, so `TSP.Reference`
   fields can be chased across components.
5. **Build the model** — walk `KN.DocumentArchive → ShowArchive → SlideTree`,
   resolve the TSS style cascade, emit the `Deck`.
6. **Render** — absolutely-positioned elements, SVG for outlines, real DOM text
   so the browser handles line breaking and shaping, WAAPI for animation.

### The document model

```
Deck
├─ size, fonts, resources, metadata
└─ slides[]
   ├─ background, masterElements[], elements[]
   │  └─ group | shape | image | movie | table | chart | unsupported
   │     ├─ frame { x, y, width, height, autoWidth, autoHeight, anchorX, anchorY }
   │     ├─ rotation, opacity, shadow, hyperlink
   │     └─ shape: { path, fill, stroke, text }
   ├─ builds[]      { elementId, kind: in|out|action, animation, stage, … }
   ├─ stageCount    clicks needed to play the slide out
   └─ notes, transition, plainText
```

Lengths are PostScript points. Colours keep their source colour space (`srgb` or
`p3`) as 0–1 floats. Anything recognised but not modelled becomes an
`unsupported` element that keeps its geometry, so a renderer draws a placeholder
rather than silently dropping content.

### Three decisions that do most of the work

- **Scale by transform, not by recomputing sizes.** The slide is laid out at its
  authored size and `transform: scale()`-ed to fit, so text metrics, line breaks
  and auto-sized boxes are identical at every zoom.
- **Let the browser lay out text.** Keynote stores no size for boxes that grow
  with their content. `width: max-content` plus `white-space: pre` reproduces an
  auto-width box exactly.
- **Playback is one integer.** Every build carries its click stage, so jumping to
  any stage — or to the fully-built state for printing — is free.

---

## What the format took to get right

The interesting bugs were all in Keynote's conventions, not the plumbing. Each
of these was found by diffing against the PDF export:

- **`GeometryArchive.flags` is a validity mask over `size`**, not a flip mask.
  Bit 0 means the width is explicit, bit 1 the height.
- **An auto-height text box grows around its vertical-alignment anchor.** A
  middle-aligned box is *centred* on the stored `y`. Getting this wrong offsets
  text by 40–100 px per box.
- **Bezier paths are authored at an arbitrary scale** — the same document holds
  paths at natural size, normalised to 0..100, and at 0.375×. `naturalSize`
  cannot be trusted; the path's own bounding box is what maps onto the frame.
- **`TSDEmptyPattern` means "no border".** Keynote writes a 1 pt black stroke
  record for every unbordered text box.
- **Two opposite conventions for null attribute entries.** For character styles a
  null *clears* the override; for paragraph and list styles it means *unchanged*.
- **Gradient angles live in `gradientangle`**, not `angle`. Reading the wrong
  name silently rotates every gradient 90°.
- **List `text_indents` are multiples of the font size**, while `indents` are
  points — and the indent is a minimum, not a fixed width.
- **Paragraph spacing is suppressed at the edges of a text frame.**
- **An image mask is a window in the image's own coordinates.**
- **Keynote embeds formats browsers cannot show** (TIFF) and keeps only a *small*
  PNG thumbnail beside them, so the original is decoded and re-encoded instead.
- **Build order lives in the chunk list**, not the build list. A chunk with
  `automatic: false` opens a new click stage; an automatic chunk that comes
  first is stage 0, playing on slide entry with no click.

---

## Coverage

| Supported | Not yet |
| --- | --- |
| Slides, masters, backgrounds, skipped slides, presenter notes | Tables (modelled, drawn as a placeholder) |
| Groups, nesting, z-order, rotation, opacity, flips | Charts (modelled, drawn as a placeholder) |
| Shapes: bezier, rounded rect, polygon, star, callout | Equations, 3-D charts, motion backgrounds |
| Fills: colour, gradient, image (5 techniques); strokes with dashes; shadows | Live video sources, comments |
| Images with masks/crops and adjustments; movies, audio, GIFs; TIFF transcoding | Vertical (CJK) text, ruby annotations |
| Text: full style cascade, runs, bullets, lists, alignment, line spacing, indents, tracking, gradient fill, hyperlinks | Text builds by word/character (parsed, played as one object) |
| Builds: appear, dissolve, move, scale, blur, wipe, pivot; actions for motion path, opacity, rotate, resize, emphasis; media start | Effects with no CSS equivalent (Confetti, Sparkle, …) — they fade |
| Transitions: dissolve, fade through colour, push, move in, reveal, wipe, iris, scale, flip, cube, Magic Move | Mosaic, Twist, Clothesline, … — they dissolve |

Tables and charts have model types and extraction hooks, but no sample deck
exercised them, so drawing them is left unimplemented rather than written blind.

Two limits are not ours to fix. Keynote distinguishes "start with previous" from
"start after previous", but the archive records only one automatic flag per
chunk, so automatic builds play *with* the previous one. And Magic Move pairs
objects by content — same media, same words, same outline — because the identity
Keynote matches on is not written to the file.

Relative line spacing is a multiple of the font's own default line height, which
needs metrics the parser does not have; a single ratio (`lineHeightBasis`,
default 1.2) stands in for it, accurate to a few pixels for the grotesques
Keynote themes use.

---

## Development

```bash
pnpm install
pnpm build
pnpm test
pnpm dev        # http://localhost:5273
```

| | |
| --- | --- |
| `pnpm build` | build both packages |
| `pnpm test` | unit tests + deck-backed tests |
| `pnpm typecheck` | every package |
| `pnpm schema` | regenerate the protobuf descriptor from `vendor/iwork/` |
| `pnpm fonts` | regenerate the Google Fonts catalogue |

### Testing with your own deck

**No `.key` file is committed** — presentations are their author's content, and
`*.key` and `*.pdf` are gitignored. Tests come in two kinds:

- **Invariants** hold for any deck: parses without warnings, frames finite, every
  build targets an element that exists, no image left in a format the browser
  cannot show, the model round-trips through JSON. These run against whatever
  `.key` is present.
- **Pinned** expectations name specific slides, colours and pixel sizes. They run
  only against the deck they were written from, identified by hash, so a
  different file skips them rather than failing.

Drop a `.key` anywhere in the repository root, or point `DOTKEY_FIXTURE` at one:

```bash
DOTKEY_FIXTURE=~/decks/mine.key pnpm test
```

| | passed | skipped |
| --- | --- | --- |
| the deck the expectations were pinned to | 165 | 0 |
| any other deck | 140 | 25 |
| no deck at all | 127 | 38 |

A `DOTKEY_FIXTURE` that does not resolve is an error, not a silent skip — the
worst answer to a typo is a green run that tested nothing.

### Verification

Two harnesses drive the demo app in a real browser. They need a dev server and
the [`agent-browser`](https://www.npmjs.com/package/agent-browser) CLI, so they
are not part of `pnpm test`.

```bash
pnpm dev                            # in one terminal
node scripts/verify.mjs             # per-pixel diff against the PDF export
node scripts/verify-animation.mjs   # build and transition playback
```

`verify.mjs` renders every slide at 1920×1080 and compares it with the matching
page of Keynote's own PDF, rasterised at the same size by pdf.js so both go
through one screenshot path. It needs `sample.key` and `sample.pdf` in
`apps/demo/public/` — copy a deck and its PDF export there.

`verify-animation.mjs` makes 29 assertions about playback. It does not watch
animations run — a headless browser produces no frames, and a headed window that
loses focus is throttled to none. Instead it *drives* them: each animation is
paused and seeked to a fixed progress, which applies the interpolated value
synchronously. That tests the keyframes and the settled state deterministically.

### Schema

iWork's protobuf definitions are not published. `vendor/iwork/14.4/` holds
reverse-engineered `.proto` files and the `TSPRegistry` table;
`tools/gen-schema.mjs` compiles them to a pruned protobuf.js descriptor
(380 KB, 56 KB compressed) which is committed, so consumers need neither
`protoc` nor a local Keynote install.

For a different iWork release, drop its definitions into
`vendor/iwork/<version>/` and run `IWORK_VERSION=<version> pnpm schema`, or pass
your own schema at runtime:

```ts
import { createSchema, parseKeynote } from '@dotkey/core';

await parseKeynote(bytes, { schema: createSchema({ schema, registry }) });
```

Unmapped archive types degrade gracefully: the object is skipped and the element
becomes `unsupported` rather than failing the parse.

---

## Licence

MIT — see [LICENSE](LICENSE).

The vendored iWork protobuf definitions come from
[psobot/keynote-parser](https://github.com/psobot/keynote-parser) (MIT); the font
catalogue is factual data derived from Google Fonts' public metadata. Both are
credited in [NOTICE.md](NOTICE.md).

Keynote, iWork and Apple are trademarks of Apple Inc. This project is not
affiliated with, endorsed by, or sponsored by Apple. It reads a file format; it
contains no Apple code.
