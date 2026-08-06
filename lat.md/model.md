# Document model

The renderer-agnostic IR, defined in [[packages/core/src/model/types.ts]]. Everything is JSON-serialisable so a deck can be parsed once and rendered anywhere. This file records the parts whose shape encodes a decision rather than just mirroring the file format.

## Frame anchoring

A `Frame` carries `autoWidth`/`autoHeight` plus `anchorX`/`anchorY`, because Keynote does not store the size of a text box that grows with its content — and the stored position means different things depending on which way it grows.

`anchorY` is `center` for a middle-aligned auto-height box, `bottom` for a bottom-aligned one, `top` otherwise. A renderer places the box at `y` and then shifts it by the anchor. Getting this wrong offsets text by 40–100 px per box, which is what it did before [[lat.md/format#iWork format conventions#Auto-height boxes grow from their alignment anchor]] was understood.

## Elements

A discriminated union on `kind`, always with geometry even when the content cannot be drawn. Groups nest arbitrarily and their children's frames are parent-relative.

`group`, `shape`, `image`, `movie`, `line`, `table`, `chart`, `unsupported`. A shape carries its outline, fill, stroke and optional text — Keynote has no separate "text box" archive, so a text box is a shape with no paint.

## Shape paths

`ShapePath` keeps parametric forms (`rect`, `roundedRect`, `ellipse`, `polygon`, `star`) when they survive a round trip, because they scale without distortion, and falls back to `path` with an explicit `viewBox`.

The `viewBox` is a `Rect`, not a `Size`, and it is the path's **own bounding box** — see [[lat.md/format#iWork format conventions#Bezier paths are authored at an arbitrary scale]].

## Text

`TextBlock` → `Paragraph[]` → `Run[]`, with the style cascade already collapsed: each run's `CharacterStyle` is a complete answer, not a delta.

`CharacterStyle.color` is always the closest single colour, and `fill` is set only when the paint is not solid — Keynote can fill glyphs with a gradient. That way a renderer without gradient text still shows something sensible.

`Bullet.textIndent` is a **multiple of the font size** and a minimum, not a fixed width; `Bullet.indent` is points. See [[lat.md/format#iWork format conventions#List indents mix units]].

## Colour

`{ space, r, g, b, a }` with components as 0–1 floats, preserving the source colour space rather than flattening to 8-bit sRGB. `colorToCss` emits `color(display-p3 …)` only when the source used P3.

## Fonts

`Deck.fonts` is every PostScript name the deck references, sorted. It is a list of *requirements*, not resources: no font bytes exist anywhere in a `.key` file.

`parseFontName` turns a name into a CSS family, numeric weight and style — `GeistMono-SemiBold` becomes `Geist Mono` at 600. The traps are foundry suffixes that stack (`TimesNewRomanPSMT`), compound weights that CamelCase splitting separates (`SemiBold` must not read as `Bold`), and 400-weight synonyms that are really part of a family name (`Roman` in `TimesNewRoman`).

## Resources

A `Resource` is a handle, not bytes: id, file name, size, availability and the two mime types. Media lives outside the JSON so a `Deck` stays serialisable and cacheable.

`mimeType` is what the resource is *served* as and `sourceMimeType` what it was stored as, so a consumer can rely on `mimeType` matching the bytes it gets back without knowing anything about transcoding.

## Animation

`Slide.builds` is a flat list, each build carrying the click `stage` it belongs to, and `Slide.stageCount` is how many clicks the slide takes to play out. Ordering and stage assignment come from the chunk list — see [[lat.md/format#iWork format conventions#Build order lives in the chunk list]].

`BuildAnimation` is a normalised union (`fade`, `move`, `scale`, `blur`, `wipe`, `pivot`, `motionPath`, `opacity`, `rotate`, `resize`, `emphasis`, `media`, `appear`, `unsupported`) so a renderer never has to know Keynote's effect vocabulary. The raw `effect` id is kept on every build and transition anyway, so a host can special-case any of them.
