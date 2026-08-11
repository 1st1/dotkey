# @dotkey/preview

Full-screen presentation GUI for `@dotkey/react`.

```sh
npm i @dotkey/preview @dotkey/react react react-dom
```

```tsx
import { Preview } from '@dotkey/preview';
import '@dotkey/preview/styles.css';

<Preview src="/presentation.key" />;
```

`Preview` includes single-slide, grid, continuous-scroll, and fullscreen modes;
build-aware navigation; clickable progress markers; responsive layout; and an
optional `brand` slot. Double-clicking a grid thumbnail opens that slide.

Use `mode`/`slide` for controlled state or `defaultMode`/`defaultSlide` for
uncontrolled state. Renderer options pass through `keynoteProps`.

MIT.
