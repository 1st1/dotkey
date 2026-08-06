import { directionVector, type Build, type Easing } from '@dotkey/core';

import { pathEndPoint, samplePath } from './path.js';

/**
 * Turning builds into concrete animation.
 *
 * Two things are computed here. `settle` folds every build up to a given stage
 * into the styles an element should be *left* with — that is the element's
 * static appearance, and it survives re-renders. `keyframesFor` produces the
 * transition between two settled states for one build, which is handed to the
 * Web Animations API.
 *
 * Animation never writes the element's positioning transform. Instead the base
 * transform (anchor offset plus rotation) is passed in and re-composed, so
 * motion happens in the parent's coordinate space (outer) while scaling and
 * spinning happen about the element's own centre (inner).
 */

export interface Settled {
  /** Translation in parent space, points. */
  x: number;
  y: number;
  /** Scale about the element centre. */
  scale: number;
  /** Extra rotation about the element centre, degrees. */
  rotate: number;
  opacity: number;
  /** False while a build-in is pending or after a build-out has played. */
  visible: boolean;
}

export const NEUTRAL: Settled = { x: 0, y: 0, scale: 1, rotate: 0, opacity: 1, visible: true };

export interface ElementBuilds {
  buildIn?: Build;
  buildOut?: Build;
  /** Action builds in stage order. */
  actions: Build[];
  /** Builds that start media playback, in stage order. */
  media: Build[];
}

/** Group a slide's builds by the element they animate. */
export function groupBuilds(builds: readonly Build[]): Map<string, ElementBuilds> {
  const map = new Map<string, ElementBuilds>();
  for (const build of builds) {
    let entry = map.get(build.elementId);
    if (!entry) {
      entry = { actions: [], media: [] };
      map.set(build.elementId, entry);
    }
    if (build.animation.type === 'media') entry.media.push(build);
    else if (build.kind === 'action') entry.actions.push(build);
    else if (build.kind === 'out') entry.buildOut ??= build;
    else entry.buildIn ??= build;
  }
  for (const entry of map.values()) {
    entry.actions.sort((a, b) => a.stage - b.stage || a.order - b.order);
  }
  return map;
}

/**
 * The styles an element is left with once every build up to `stage` has run.
 * `baseOpacity` is the element's own opacity from the document, which an
 * opacity action replaces outright — that is what Keynote does.
 */
export function settle(
  builds: ElementBuilds | undefined,
  stage: number,
  baseOpacity = 1,
): Settled {
  if (!builds) return { ...NEUTRAL, opacity: baseOpacity };

  let state: Settled = { ...NEUTRAL, opacity: baseOpacity };

  if (builds.buildIn && stage < builds.buildIn.stage) state.visible = false;
  if (builds.buildOut && stage >= builds.buildOut.stage) state.visible = false;

  for (const action of builds.actions) {
    if (action.stage > stage) break;
    state = applyAction(state, action);
  }
  return state;
}

function applyAction(state: Settled, build: Build): Settled {
  const animation = build.animation;
  switch (animation.type) {
    case 'motionPath': {
      const end = pathEndPoint(animation.d);
      return { ...state, x: state.x + end.x, y: state.y + end.y };
    }
    case 'opacity':
      return { ...state, opacity: animation.to };
    case 'rotate':
      return {
        ...state,
        rotate: state.rotate + (animation.clockwise ? animation.angle : -animation.angle),
      };
    case 'resize':
      return { ...state, scale: state.scale * animation.to };
    // Emphasis effects return to where they started, so they settle to nothing.
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// CSS composition
// ---------------------------------------------------------------------------

/**
 * Compose a transform. `base` positions the element (anchor offset, rotation);
 * the settled translation wraps it so motion is measured in parent space, while
 * scale and rotation are appended so they pivot about the element's centre.
 */
export function transformFor(base: string, state: Settled): string | undefined {
  const parts: string[] = [];
  if (state.x !== 0 || state.y !== 0) {
    parts.push(`translate(${round(state.x)}px, ${round(state.y)}px)`);
  }
  if (base) parts.push(base);
  if (state.scale !== 1) parts.push(`scale(${round(state.scale)})`);
  if (state.rotate !== 0) parts.push(`rotate(${round(state.rotate)}deg)`);
  return parts.length > 0 ? parts.join(' ') : undefined;
}

const EASINGS: Record<Easing, string> = {
  linear: 'linear',
  easeIn: 'cubic-bezier(0.42, 0, 1, 1)',
  easeOut: 'cubic-bezier(0, 0, 0.58, 1)',
  easeInOut: 'cubic-bezier(0.42, 0, 0.58, 1)',
};

export interface BuildKeyframes {
  keyframes: Keyframe[];
  options: KeyframeAnimationOptions;
}

/**
 * The animation for one build, moving the element from `before` to `after`.
 * Returns `undefined` for builds with nothing to animate (Appear, media).
 */
export function keyframesFor(
  build: Build,
  base: string,
  before: Settled,
  after: Settled,
): BuildKeyframes | undefined {
  const options: KeyframeAnimationOptions = {
    duration: Math.max(build.duration, 0) * 1000,
    delay: Math.max(build.delay, 0) * 1000,
    easing: EASINGS[build.easing] ?? EASINGS.easeInOut,
    // The element's own style already holds the settled result, so the
    // animation must not keep overriding it once finished.
    fill: 'backwards',
  };

  const animation = build.animation;
  const outgoing = build.kind === 'out';

  switch (animation.type) {
    case 'appear':
    case 'media':
      return undefined;

    case 'fade':
    case 'unsupported':
      // An unrecognised effect fades: less jarring than appearing instantly.
      return {
        keyframes: [{ opacity: outgoing ? 1 : 0 }, { opacity: outgoing ? 0 : 1 }],
        options,
      };

    case 'move': {
      const vector = directionVector(build.direction);
      // Keynote's default travel is a full slide width; the stored distance
      // overrides it when the author set one.
      const distance = animation.distance > 0 ? animation.distance : 600;
      const offset = { x: -vector.x * distance, y: -vector.y * distance };
      const away: Settled = { ...before, x: before.x + offset.x, y: before.y + offset.y };
      return {
        keyframes: outgoing
          ? [frame(base, before), { ...frame(base, away), opacity: 0 }]
          : [{ ...frame(base, away), opacity: 0 }, frame(base, after)],
        options,
      };
    }

    case 'scale': {
      const small: Settled = { ...before, scale: before.scale * Math.max(animation.from, 0.01) };
      return {
        keyframes: outgoing
          ? [frame(base, before), { ...frame(base, small), opacity: 0 }]
          : [{ ...frame(base, small), opacity: 0 }, frame(base, after)],
        options,
      };
    }

    case 'blur':
      return {
        keyframes: outgoing
          ? [{ filter: 'blur(0px)', opacity: 1 }, { filter: 'blur(24px)', opacity: 0 }]
          : [{ filter: 'blur(24px)', opacity: 0 }, { filter: 'blur(0px)', opacity: 1 }],
        options,
      };

    case 'wipe': {
      const hidden = wipeInset(build);
      return {
        keyframes: outgoing
          ? [{ clipPath: 'inset(0%)' }, { clipPath: hidden }]
          : [{ clipPath: hidden }, { clipPath: 'inset(0%)' }],
        options,
      };
    }

    case 'pivot': {
      const spun: Settled = { ...before, rotate: before.rotate + animation.angle };
      return {
        keyframes: outgoing
          ? [frame(base, before), { ...frame(base, spun), opacity: 0 }]
          : [{ ...frame(base, spun), opacity: 0 }, frame(base, after)],
        options,
      };
    }

    case 'motionPath': {
      // Sample the path so curves are followed, not cut across.
      const points = samplePath(animation.d);
      return {
        keyframes: points.map((point) =>
          frame(base, { ...before, x: before.x + point.x, y: before.y + point.y }),
        ),
        options,
      };
    }

    case 'opacity':
      return { keyframes: [{ opacity: before.opacity }, { opacity: after.opacity }], options };

    case 'rotate':
    case 'resize':
      return { keyframes: [frame(base, before), frame(base, after)], options };

    case 'emphasis':
      return { ...emphasisKeyframes(animation.effect, base, before), options: {
        ...options,
        iterations: animation.repeat,
      } };
  }
}

function frame(base: string, state: Settled): Keyframe {
  const transform = transformFor(base, state);
  return transform ? { transform } : { transform: 'none' };
}

/** `inset()` that hides the element, on the side the wipe travels from. */
function wipeInset(build: Build): string {
  switch (build.direction) {
    case 'rightToLeft':
      return 'inset(0% 0% 0% 100%)';
    case 'topToBottom':
      return 'inset(0% 0% 100% 0%)';
    case 'bottomToTop':
      return 'inset(100% 0% 0% 0%)';
    case 'leftToRight':
    default:
      return 'inset(0% 100% 0% 0%)';
  }
}

function emphasisKeyframes(
  effect: 'blink' | 'bounce' | 'jiggle' | 'pulse' | 'flip',
  base: string,
  state: Settled,
): { keyframes: Keyframe[] } {
  const at = (overrides: Partial<Settled>): Keyframe => frame(base, { ...state, ...overrides });
  switch (effect) {
    case 'blink':
      return { keyframes: [{ opacity: 1 }, { opacity: 0 }, { opacity: 1 }] };
    case 'bounce':
      return { keyframes: [at({}), at({ y: state.y - 40 }), at({})] };
    case 'jiggle':
      return {
        keyframes: [
          at({}),
          at({ rotate: state.rotate - 4 }),
          at({ rotate: state.rotate + 4 }),
          at({}),
        ],
      };
    case 'pulse':
      return { keyframes: [at({}), at({ scale: state.scale * 1.15 }), at({})] };
    case 'flip':
      return {
        keyframes: [
          { transform: `${transformFor(base, state) ?? ''} rotateY(0deg)`.trim() },
          { transform: `${transformFor(base, state) ?? ''} rotateY(360deg)`.trim() },
        ],
      };
  }
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
