# dotkey

Read Apple Keynote (`.key`) files in TypeScript and render them in React. dotkey
parses presentations into a renderer-neutral JSON model, draws real text and
vector shapes, and plays object builds and slide transitions. It is a renderer,
not an editor.

The project is split into `@dotkey/core`, `@dotkey/react`, `@dotkey/preview`, and
the optional `@dotkey/vercel` branded preview.

## Documentation

- [Architecture and package boundaries](lat.md/architecture.md)
- [Document model](lat.md/model.md)
- [Format decisions and reverse-engineered conventions](lat.md/format.md)
- [Usage and development](lat.md/usage.md)
- [Tests and browser verification](lat.md/tests.md)
- [Vision and limitations](lat.md/roadmap.md)

## Use it

For a complete presentation UI:

```bash
npm install @dotkey/preview @dotkey/react react react-dom
```

```tsx
import { Preview } from '@dotkey/preview';
import '@dotkey/preview/styles.css';

<Preview src={file} />;
```

Use [`@dotkey/react`](lat.md/usage.md#renderer-only) for renderer-only controls or
[`@dotkey/core`](lat.md/usage.md#parse-without-react) to parse a deck without
React. See [Choosing a package](lat.md/usage.md#choosing-a-package) for all four
entry points.

## Build it

```bash
pnpm install
pnpm build
pnpm test
pnpm dev
```

`pnpm dev` opens the local `.key` drop target. Fixture setup, type-checking,
schema generation, and visual verification are documented in
[Developing dotkey](lat.md/usage.md#developing-dotkey).

MIT. See [LICENSE](LICENSE) and [NOTICE.md](NOTICE.md). Keynote, iWork, Apple, and
Vercel are trademarks of their respective owners; this project is not affiliated
with or endorsed by them.
