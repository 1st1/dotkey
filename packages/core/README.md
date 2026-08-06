# @dotkey/core

Read Apple Keynote (`.key`) files. Parses the iWork format into a
renderer-agnostic JSON document model.

```bash
npm i @dotkey/core
```

```ts
import { parseKeynote } from '@dotkey/core';

const doc = await parseKeynote(await file.arrayBuffer());

doc.deck.size;                 // { width: 1920, height: 1080 }
doc.deck.slides[0].elements;   // z-ordered element tree
doc.deck.slides[0].plainText;  // for search, outlines, accessibility
doc.deck.slides[0].builds;     // object animations, each with a click stage
doc.resourceUrl('8073');       // blob: URL for slide media
```

Isomorphic — browsers, Node, Deno, Bun and workers. No React, no `node:`
imports. Two dependencies: `fflate` and `protobufjs`.

## Entry points

| | |
| --- | --- |
| `@dotkey/core` | parsing and the document model |
| `@dotkey/core/node` | `readKeynoteFile()`, which also accepts expanded `.key` directories |
| `@dotkey/core/fonts` | match a deck's fonts to loadable web fonts |

Everything in `deck` is plain JSON: no protobuf, no object references, no
binary. It survives a `JSON.parse(JSON.stringify(…))` round trip, so it can be
produced on a server, cached, and rendered anywhere.

To draw it in React, see [`@dotkey/react`](https://www.npmjs.com/package/@dotkey/react).
Full documentation is in the [repository README](https://github.com/1st1/dotkey#readme).

MIT. Keynote, iWork and Apple are trademarks of Apple Inc.; this project is not
affiliated with Apple.
