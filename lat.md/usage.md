# Usage and development

Choose the highest-level package that owns the behavior you need, or work directly with the JSON model. This page holds operational detail so the repository README can remain a compact entry point.

## Choosing a package

Four packages separate parsing, rendering, presentation controls, and branding.

| Package | Use it for |
| --- | --- |
| `@dotkey/core` | Parsing `.key` files into a plain JSON `Deck` |
| `@dotkey/react` | Rendering a deck with application-owned controls |
| `@dotkey/preview` | A complete, brand-neutral presentation UI |
| `@dotkey/vercel` | `Preview` with the official Vercel logotype |

The dependency direction and runtime boundaries are described in [[lat.md/architecture#Architecture#Packages]].

## Full presentation UI

`Preview` provides slide, grid, continuous-scroll, and browser-fullscreen modes, plus build-aware navigation and an optional brand slot.

```bash
npm install @dotkey/preview @dotkey/react react react-dom
```

```tsx
import { Preview } from '@dotkey/preview';
import '@dotkey/preview/styles.css';

<Preview src={file} />;
```

`src` accepts the same inputs as `Keynote`: a URL, `File`/`Blob`, bytes, or a parsed `KeynoteDocument`. Use `mode` and `slide` for controlled state, or `defaultMode` and `defaultSlide` for local state. Renderer options pass through `keynoteProps`.

For Vercel branding, install `@dotkey/vercel` and render `VercelPreview` with `@dotkey/vercel/styles.css`; its props are otherwise the same.

## Renderer only

`Keynote` renders a presentation without imposing application chrome, while its lower-level exports support fully custom composition.

```bash
npm install @dotkey/core @dotkey/react react react-dom
```

```tsx
import { Keynote } from '@dotkey/react';

<Keynote src={file} mode="slide" style={{ height: '100dvh' }} />;
```

Modes are `slide`, `scroll`, and `grid`. In slide mode, clicks and keyboard navigation play object builds before changing slides. Custom next/previous controls should call `controlsRef.advance()` and `controlsRef.retreat()`; changing the `slide` prop directly intentionally skips builds.

For custom rendering, compose `KeynoteProvider`, `Stage`, `SlidePlayer` or `SlideView`, and `ElementView`. Animation state and its click-stage model are documented in [[lat.md/model#Document model#Animation]].

## Parse without React

`@dotkey/core` parses in browsers, Node, Deno, Bun, and workers and produces the model described in [[lat.md/model#Document model]].

```ts
import { parseKeynote } from '@dotkey/core';

const document = await parseKeynote(await file.arrayBuffer());
const deck = document.deck;
```

`parseKeynote` accepts `ArrayBuffer`, `Uint8Array`, `Blob`, or `File`. In Node, `readKeynoteFile` from `@dotkey/core/node` also accepts a `.key` path or an expanded package directory.

`deck` contains no protobuf objects or binary data and survives a JSON round trip. Media stays behind resource handles; use the source document's resource methods to retrieve it. See [[lat.md/model#Document model#Resources]].

## Fonts

Keynote files name fonts but do not contain their bytes, so hosts must decide how unavailable fonts are supplied.

`Keynote` matches supported families to Google Fonts by default. Pass `fonts={false}` to disable loading, configure `fonts.origin` for a mirror, or use `planFonts` from `@dotkey/core/fonts` to plan loading yourself. The constraints are explained in [[lat.md/architecture#Architecture#Font matching]] and [[lat.md/roadmap#Limitations#Fonts are a host responsibility the library can help with]].

## Developing dotkey

The pnpm workspace builds and tests every publishable package; the Vite demo is the interactive `.key` fixture viewer.

```bash
pnpm install
pnpm build
pnpm test
pnpm typecheck
pnpm dev
```

`pnpm schema` regenerates the protobuf descriptor from `vendor/iwork/`, and `pnpm fonts` regenerates the Google Fonts catalogue.

No presentation is committed. Put a `.key` file in the repository root or set `DOTKEY_FIXTURE=/path/to/deck.key` for deck-backed tests. Fixture-independent invariants always run; expectations pinned to another deck skip. See [[lat.md/tests#Tests#Invariants hold for any deck]].

For pixel and animation verification, run the demo and then `node scripts/verify.mjs` or `node scripts/verify-animation.mjs`. The harness setup and guarantees are in [[lat.md/tests#Tests#Browser verification]].

## Documentation boundary

The README is a landing page, not the project manual: it states the purpose, points into the knowledge base, and keeps only the shortest happy-path usage and build commands.

Architecture, decisions, behavior, limitations, and detailed workflows belong in `lat.md/`. Package-specific READMEs may document their own install and minimal API surface. When behavior changes, update the relevant `lat.md/` section and link to it instead of expanding the root README.
