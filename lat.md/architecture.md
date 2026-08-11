# Architecture

Read Apple Keynote `.key` files and render them in React. Four packages separate parsing, rendering, presentation GUI, and optional branding so each layer remains independently reusable.

## Pipeline

Six stages take a zip archive to pixels. Each stage is a directory in `packages/core/src` and knows nothing about the ones above it.

1. **Unzip** — `fflate`, so identical code runs in a browser and in Node. Keynote stores members uncompressed; deflate is still handled.
2. **Decompress** — each `Index/*.iwa` is a chunk stream: a `0x00` byte, a 3-byte little-endian length, then a *raw* Snappy block. Not the Snappy framing format, so [[packages/core/src/iwa/snappy.ts#snappyDecompress]] is written from scratch.
3. **Decode** — the result is `varint(len) TSP.ArchiveInfo <payloads…>` records. Each payload carries a numeric type resolved to a protobuf message through the `TSPRegistry` table.
4. **Index** — objects land in [[packages/core/src/document/store.ts#ArchiveStore]] keyed by identifier so `TSP.Reference` fields can be chased across components.
5. **Build the model** — walk `KN.DocumentArchive → ShowArchive → SlideTree`, resolve the style cascade, emit [[lat.md/model#Document model]].
6. **Render** — `@dotkey/react` maps the model to absolutely-positioned DOM, SVG outlines and Web Animations.

## Packages

`@dotkey/core` is isomorphic, `@dotkey/react` renders its model, `@dotkey/preview` supplies a brand-neutral GUI, and `@dotkey/vercel` only adds Vercel branding.

- **`@dotkey/core`** — `.key` → `Deck`. Runs in browsers, Node, Deno, Bun and workers. `@dotkey/core/node` adds file/directory reading.
- **`@dotkey/react`** — `Deck` → React elements. `<Keynote>` for the whole deck, or `KeynoteProvider` + `Stage` + `SlidePlayer`/`SlideView` + `ElementView` composed by hand.
- **`@dotkey/preview`** — brand-neutral controls around `<Keynote>`, including single-slide, grid, continuous-scroll, and browser fullscreen modes.
- **`@dotkey/vercel`** — a thin `VercelPreview` wrapper that provides the official Vercel logotype to `Preview`'s brand slot.
- **`apps/demo`** — a drag-and-drop `.key` entry point for `Preview`; its `?bare=` route remains the target both verification harnesses drive.

## Document model

`Deck` is plain JSON: no protobuf, no object references, no binary. It can be produced on a server, cached, shipped to a browser and rendered by any backend — DOM, canvas, PDF, native.

Lengths are PostScript points, matching what Keynote stores. Colours keep their source colour space (`srgb` or `p3`) as 0–1 floats. Anything the parser recognises but cannot express becomes an `unsupported` element that keeps its geometry, so a renderer draws a placeholder instead of silently dropping content.

```
Deck
├─ size, fonts, resources, metadata
└─ slides[]
   ├─ background, masterElements[], elements[]
   ├─ builds[], stageCount
   └─ notes, transition, plainText
```

See [[lat.md/model#Document model]] for the element and text shapes.

## Media transcoding

Images in formats no browser can display are re-encoded to PNG on access, not at parse time, so opening a deck never pays for media nobody looks at. The result is cached per resource.

`media/tiff.ts` decodes the variants iWork actually writes — uncompressed, PackBits and Deflate strips; 8-bit greyscale, RGB, RGBA and palette; the horizontal differencing predictor — and returns `undefined` for anything else, which sends the caller back to the document's own derivative. LZW is not implemented.

`media/png.ts` re-encodes to 8-bit RGBA with filter 0. Its `IDAT` must hold a *zlib* stream, not the bare DEFLATE that `fflate`'s `deflateSync` produces; a raw stream yields a PNG that decodes nowhere.

A `Resource` therefore reports two types: `mimeType` is what it is served as, `sourceMimeType` what it was stored as.

## Font matching

Keynote embeds no font data — it records PostScript names and expects the machine to have them.

A deck using a non-installed typeface therefore renders with fallback metrics, and because auto-sized text boxes are measured by the browser, that changes geometry rather than only letterforms.

`@dotkey/core/fonts` classifies every family the deck names as `system` (already installed, never fetched), `google` (published by Google Fonts) or `unavailable`. It is a separate entry point because it carries a catalogue of 1942 families — 34 KB, 12 KB compressed — that decks with only installed fonts never need.

The catalogue records which weights and italics each family publishes, because `css2` answers a request for a weight a family does not have with a **400** and drops the whole stylesheet. Requested faces are snapped to the nearest published one, so the URL is never a guess.

`@dotkey/react` loads the plan through `useKeynoteFonts`: preconnect to both origins, inject one stylesheet, then await `document.fonts.load` per face and hold the slides back until they are usable. A timeout bounds that wait so a blocked CDN cannot hang the viewer.

## Schema

iWork's protobuf definitions are not published. `vendor/iwork/14.4/` holds reverse-engineered `.proto` files plus the `TSPRegistry` table, and `tools/gen-schema.mjs` compiles them to a pruned protobuf.js descriptor.

The generated descriptor is committed, so consumers need neither `protoc` nor a local Keynote install. Another release drops into `vendor/iwork/<version>/`; a caller can also pass its own schema at runtime. Unmapped archive types degrade to `unsupported` rather than failing the parse.

## Rendering to the DOM

Three decisions do most of the work. All three exist because Keynote leaves text measurement to the renderer.

- **Scale by transform, not by recomputing sizes.** The slide is laid out at its authored size and `transform: scale()`-ed to fit, so text metrics, line breaks and auto-sized boxes are identical at every zoom.
- **Let the browser lay out text.** Keynote stores no size for boxes that grow with their content. `width: max-content` plus `white-space: pre` reproduces an auto-width box exactly.
- **SVG for outlines, DOM for text.** Shape paths stretch to the element box with `preserveAspectRatio="none"` and `vector-effect="non-scaling-stroke"`.

## Animation

A slide is a sequence of *stages*: stage 0 is what you see on arrival, each click advances one. Every build carries its stage, so playback is a single integer — which makes jumping to any stage, or to the fully-built end state for printing, free.

Each element's inline style always holds the **settled** result for the current stage ([[packages/react/src/animation/effects.ts#settle]] folds every build up to it). Animations layer on top via `element.animate()` with `fill: 'backwards'`, so a finished animation hands back to the inline style with no flash, and a re-render mid-flight — or a browser that cannot animate — still shows the right thing.

Positioning and animation never fight over `transform`: the base transform (anchor offset, rotation) is composed with the animated one, motion in parent space on the outside, scaling and spinning about the element's centre on the inside.

Transitions mount both slides and animate the two layers.

Two timing rules matter, and both were bugs first. Build state resets when the slide changes **during render**, comparing an id held in state; doing it in an effect paints one frame of the new slide at the *previous* slide's stage, flashing every build-in fully visible. And animations are created in a **layout** effect, because one created after paint shows a frame of the un-animated element first.

The transition's own slide-change detection is the mirror image: it belongs in a layout effect, not in render, because deriving it during render needs a ref to remember the previous slide and React replays renders, which makes that ref lie.

Control flow never reads the result of a `setState` updater. React only evaluates updaters eagerly when the fiber has no pending work, so `next()` reporting whether it advanced from inside its own updater is unreliable; the live stage is tracked in a ref instead, and callers decide from `hasNext`.
