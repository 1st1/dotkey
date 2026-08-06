import { useRef, type CSSProperties, type RefObject } from 'react';

import { useIsomorphicLayoutEffect } from './useIsomorphicLayoutEffect.js';

import { keyframesFor, settle, transformFor, type ElementBuilds } from './effects.js';
import { buildsAtStage, type Playback } from './usePlayback.js';

/**
 * Runs an element's builds with the Web Animations API.
 *
 * The element's inline style always holds the *settled* result for the current
 * stage, so a re-render — or a browser that cannot animate — still shows the
 * right thing. Animations are layered on top and use `fill: 'backwards'`, so
 * when one finishes it hands straight back to the inline style with no flash.
 */
export interface ElementAnimation {
  /** Inline style for the settled state at the current stage. */
  style: CSSProperties;
  /** False while a build-in is pending, or after a build-out has played. */
  visible: boolean;
}

export function useElementAnimation(
  ref: RefObject<HTMLElement>,
  builds: ElementBuilds | undefined,
  playback: Playback | undefined,
  baseTransform: string,
  baseOpacity: number,
): ElementAnimation {
  const stage = playback?.stage ?? 0;
  const animatingStage = playback?.animatingStage ?? null;
  const token = playback?.token ?? 0;

  const settled = settle(builds, stage, baseOpacity);
  const previous = settle(builds, Math.max(stage - 1, 0), baseOpacity);
  const running = useRef<Animation[]>([]);

  useIsomorphicLayoutEffect(() => {
    const element = ref.current;
    // Cancel anything still running from a previous stage before re-deciding.
    for (const animation of running.current) animation.cancel();
    running.current = [];

    if (!element || !builds || animatingStage === null) return;
    if (typeof element.animate !== 'function') return;

    const firing = buildsAtStage(builds, animatingStage);
    if (firing.length === 0) return;

    // Hide the element for the whole of a build-in's delay, otherwise it would
    // flash into view before its animation starts.
    for (const build of firing) {
      const spec = keyframesFor(build, baseTransform, previous, settled);
      if (!spec) continue;
      try {
        running.current.push(element.animate(spec.keyframes, spec.options));
      } catch {
        // A browser that rejects these keyframes still shows the settled state.
      }
    }

    const animations = running.current;
    return () => {
      for (const animation of animations) animation.cancel();
    };
    // `settled`/`previous` are derived from `stage`, and `token` changes on every
    // navigation, which is what should retrigger playback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, builds, animatingStage, token, baseTransform]);

  const transform = transformFor(baseTransform, settled);

  return {
    style: {
      ...(transform ? { transform } : {}),
      ...(settled.opacity !== 1 ? { opacity: settled.opacity } : {}),
    },
    visible: settled.visible,
  };
}

/**
 * Whether a media element should be playing. Movies with a `movie-start` build
 * stay on their poster frame until that build's stage is reached.
 */
export function useMediaGate(elementId: string, playback: Playback | undefined): boolean {
  const builds = playback?.byElement.get(elementId);
  if (!playback || !builds || builds.media.length === 0) return true;
  return builds.media.some((build) => build.stage <= playback.stage);
}
