# @dotkey/vercel

The generic `@dotkey/preview` presentation GUI with the official Vercel
logotype.

```sh
npm i @dotkey/vercel @dotkey/preview @dotkey/react react react-dom
```

```tsx
import { VercelPreview } from '@dotkey/vercel';
import '@dotkey/vercel/styles.css';

<VercelPreview src="/presentation.key" />;
```

Every `Preview` prop is supported. Pass `brand` to replace the Vercel logotype.
The former `VercelPresentation` name remains as a deprecated compatibility
alias.

MIT. Vercel is a trademark of Vercel Inc. This package is not affiliated with
or endorsed by Vercel Inc.
