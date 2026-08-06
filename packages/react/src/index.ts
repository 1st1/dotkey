/**
 * @dotkey/react — render Apple Keynote presentations in React.
 *
 * ```tsx
 * import { Keynote } from '@dotkey/react';
 *
 * <Keynote src={file} style={{ height: '100dvh' }} />
 * ```
 *
 * For finer control, parse with `@dotkey/core` and compose the pieces:
 * `KeynoteProvider` + `Stage` + `SlidePlayer` (animated) or `SlideView`
 * (static) + `ElementView`.
 */

export {
  Keynote,
  type KeynoteControls,
  type KeynoteProps,
  type KeynoteMode,
} from './Keynote.jsx';
export { SlidePlayer, type SlidePlayerProps } from './SlidePlayer.jsx';
export {
  SlideStage,
  SlideView,
  Stage,
  type SlideStageProps,
  type SlideViewProps,
  type StageProps,
} from './SlideView.jsx';
export { ElementView, type ElementViewProps } from './ElementView.jsx';
export { ShapeView, type ShapeViewProps } from './ShapeView.jsx';
export { TextView, type TextViewProps } from './TextView.jsx';
export {
  KeynoteProvider,
  PlaybackProvider,
  useKeynoteContext,
  type KeynoteProviderProps,
  type KeynoteRenderContext,
} from './context.jsx';
export {
  useKeynoteFonts,
  type FontStatus,
  type KeynoteFontOptions,
  type KeynoteFontsResult,
} from './fonts/useKeynoteFonts.js';
export {
  useKeynote,
  type KeynoteSource,
  type KeynoteStatus,
  type UseKeynoteResult,
} from './useKeynote.js';

// Animation primitives, for hosts that want to drive playback themselves.
export {
  buildsAtStage,
  usePlayback,
  usePrefersReducedMotion,
  type Playback,
  type UsePlaybackOptions,
} from './animation/usePlayback.js';
export {
  groupBuilds,
  keyframesFor,
  settle,
  transformFor,
  NEUTRAL,
  type BuildKeyframes,
  type ElementBuilds,
  type Settled,
} from './animation/effects.js';
export {
  matchElements,
  transitionOptions,
  transitionSpec,
  type MagicMovePair,
  type TransitionSpec,
} from './animation/transitions.js';
export { useElementAnimation, useMediaGate } from './animation/useElementAnimation.js';
export { pathEndPoint, samplePath, type PathPoint } from './animation/path.js';

export {
  DEFAULT_LINE_HEIGHT_BASIS,
  boxShadowCss,
  dropShadowFilter,
  fillStyle,
  gradientCss,
  lineHeightCss,
  runStyle,
  strokeAttributes,
  textAlignCss,
  textShadowCss,
} from './css.js';
