# @dotkey/react

Render Apple Keynote (`.key`) presentations in React, including object builds
and slide transitions.

```bash
npm i @dotkey/core @dotkey/react
```

```tsx
import { Keynote } from '@dotkey/react';

<Keynote src={file} style={{ height: '100dvh' }} />;
```

`mode="slide" | "scroll" | "grid"`. In slide mode a click or arrow key advances
the next object build and only moves on once the slide is fully built — the
sequence Keynote itself plays.

Keynote files reference fonts by name and embed no font data, so `<Keynote>`
matches the deck's fonts against Google Fonts and loads exactly the weights it
uses. Pass `fonts={false}` to opt out.

For finer control, compose `KeynoteProvider` + `Stage` + `SlidePlayer` (animated)
or `SlideView` (static) + `ElementView`, or drive playback yourself with
`usePlayback`.

Full documentation is in the [repository README](https://github.com/1st1/dotkey#readme).

MIT. Keynote, iWork and Apple are trademarks of Apple Inc.; this project is not
affiliated with Apple.
