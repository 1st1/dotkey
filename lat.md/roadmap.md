# Vision

A `.key` file should be as ordinary to read as a `.json` file, and as ordinary to display as an image.

That means two things a library has to earn: a document model that outlives this renderer, and fidelity measured against Keynote rather than asserted.

## The gap this fills

Keynote's own web export rasterises each slide at a fixed resolution, which is visibly soft on a high-DPI display — worst on text, the part of a slide that most needs to be sharp.

Rendering the deck instead of photographing it makes resolution a non-issue: real text, vector shapes, one `transform: scale()` to fit. It also keeps the text *as text*, so a deck can be searched, linked into and read by a screen reader.

The scope stops short of Keynote's on purpose. This reads and draws presentations and does not set out to reproduce the editing interface; what it emits is a documented JSON model, and what a host does with that model is the host's business.

## Why a separate model

The parser emits plain JSON and knows nothing about React. `@dotkey/react` is the first consumer, not the privileged one.

A host can parse on a server, cache the result, ship it to a browser, and render it with DOM, canvas, a PDF writer or a native view.

The corollary is that anything the renderer needs must be *in* the model. Auto-size anchoring ([[lat.md/model#Document model#Frame anchoring]]) lives in the IR rather than in a React component for exactly this reason.

## Fidelity is measured, not claimed

Keynote can export the same deck to PDF, so there is a ground truth. `scripts/verify.mjs` rasterises both at 1920×1080 and reports per-pixel mismatch; the current mean is 1.38 % over 21 slides, with photo-free slides between 0.07 % and 1.6 %.

Every entry in [[lat.md/format#iWork format conventions]] was found this way. The workflow is the deliverable as much as the code: without it, a 90°-rotated gradient or a bled text colour looks like a design choice.

## Degrade visibly, never silently

An archive the parser does not understand becomes an `unsupported` element that keeps its geometry, and the renderer draws a labelled placeholder. An effect with no CSS equivalent cross-fades instead of snapping. Missing media gets a dashed outline.

The alternative — dropping content — makes a parser bug indistinguishable from an author's choice.

## Published as four packages

`@dotkey/core`, `@dotkey/react`, `@dotkey/preview`, and `@dotkey/vercel`, all MIT. Parsing, rendering, GUI, and branded composition are separate publication boundaries so consumers pay for and identify with only the layers they choose.

Nothing Apple-authored is redistributed: the vendored protobuf definitions are reverse-engineered interface descriptions (MIT, credited in `NOTICE.md`), and the font catalogue is factual availability data. Presentations used for testing are never committed.

# Limitations

Known gaps, each with the reason it is a gap. The distinction that matters is between "not built yet" and "not recoverable from the file".

## Not built yet

Tables and charts have model types, extraction hooks and correct geometry, but render as labelled placeholders.

The sample deck contains neither, so implementing them would mean writing renderers with no way to check them — the trade-off [[lat.md/roadmap#Vision#Fidelity is measured, not claimed]] exists to avoid.

Text builds delivered by word or character are parsed (`build.delivery`) but played as one object. Splitting runs into per-word spans is the remaining work.

## Not recoverable from the file

"Start with previous" versus "start after previous" is a single boolean per chunk in the archive. Automatic builds are played *with* the previous one, offset by their stored delay, which is correct for every case observed.

Magic Move pairs objects by content — same media, same words, same outline — because the identity Keynote matches on is not written to the file in any form this parser can read. The implementation is reasoned but untested: no sample deck uses it.

Fonts are referenced by PostScript name with no font data embedded, so loading them is the host's job. `deck.fonts` lists what a deck needs.

## Playback-aware navigation is the caller's job

Driving the `slide` prop jumps between slides and skips whatever builds lie between them. That is the right behaviour for a thumbnail grid and the wrong one for a "next" button.

`Keynote` exposes `controlsRef` with `advance`/`retreat` for this reason: they are the same actions a click or arrow key performs, so custom chrome plays a slide out before moving on. A next button wired to `slide + 1` looks like the renderer is ignoring animations.

## Fonts are a host responsibility the library can help with

No `.key` file contains font data, so perfect rendering is impossible without the host supplying the typefaces. The library closes as much of that gap as it honestly can.

It matches non-installed families against Google Fonts and loads exactly the weights in use, which covers a large share of real decks. What it cannot cover: a genuinely private typeface. Those are reported as `unavailable` so a host can supply them itself, rather than silently rendering wrong.

Fetching from a third party is a decision the host may not want made for it, so `fonts={false}` opts out entirely and `origin` points at a self-hosted mirror.

## Approximations

Keynote's "relative" line spacing is a multiple of the font's own default line height, which needs font metrics the parser does not have.

A single ratio (1.2, overridable per render) stands in for it — accurate to a few pixels for the grotesques Keynote themes use.

Effect direction is stored as a small integer whose mapping is inferred from the order of options in Keynote's inspector. The raw value is preserved on every build and transition so a host can second-guess it. No deck observed so far sets it.
