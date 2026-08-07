# @dotkey/vercel

Vercel-style full-screen presentation chrome for `@dotkey/react`.

```sh
npm i @dotkey/react @dotkey/vercel react react-dom
```

```tsx
import { VercelPresentation } from '@dotkey/vercel';
import '@dotkey/vercel/styles.css';

<VercelPresentation src="/presentation.key" />;
```

The component includes single-slide, grid and continuous-scroll views,
build-aware previous/next controls, clickable progress markers, responsive
layout, fullscreen control, and the official Vercel logotype. Double-click a
grid thumbnail to open that slide in the single-slide view.

Use `mode`/`slide` for controlled state or `defaultMode`/`defaultSlide` for
uncontrolled state. Pass renderer options through `keynoteProps`, and replace
the logo with the `brand` prop.

MIT. Vercel is a trademark of Vercel Inc. This package is not affiliated with
or endorsed by Vercel Inc.
