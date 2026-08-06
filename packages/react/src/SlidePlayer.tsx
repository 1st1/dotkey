import type { Slide } from '@dotkey/core';
import { useEffect, useRef, useState, type CSSProperties, type MutableRefObject } from 'react';

import {
  matchElements,
  transitionOptions,
  transitionSpec,
  type TransitionSpec,
} from './animation/transitions.js';
import { useIsomorphicLayoutEffect } from './animation/useIsomorphicLayoutEffect.js';
import { usePlayback, usePrefersReducedMotion, type Playback } from './animation/usePlayback.js';
import { useKeynoteContext } from './context.jsx';
import { SlideView } from './SlideView.jsx';

export interface SlidePlayerProps {
  slide: Slide;
  /** Play builds and transitions. Default `true`. */
  animate?: boolean;
  /** Enter the slide fully built — used when navigating backwards. */
  enterAtEnd?: boolean;
  /** Called when the slide has no further build stages to play. */
  onExhausted?: () => void;
  /**
   * Receives the playback controls so a parent can drive navigation. A ref
   * rather than a callback on purpose: the controls object is rebuilt on every
   * render, and handing that to a `setState` would loop forever.
   */
  playbackRef?: MutableRefObject<Playback | null>;
  /** Called when the build stage changes. */
  onStageChange?: (stage: number, stageCount: number) => void;
  className?: string;
  style?: CSSProperties;
}

/**
 * One slide, animated: object builds plus the transition that brought it here.
 *
 * The outgoing slide stays mounted for the length of the transition and both
 * layers are animated with the Web Animations API. Everything is keyed off the
 * slide's own model, so a re-render mid-transition is harmless.
 */
export function SlidePlayer({
  slide,
  animate = true,
  enterAtEnd = false,
  onExhausted,
  playbackRef,
  onStageChange,
  className,
  style,
}: SlidePlayerProps) {
  const { deck } = useKeynoteContext();
  const reducedMotion = usePrefersReducedMotion();
  const enabled = animate && !reducedMotion;

  const playback = usePlayback(slide, {
    animate: enabled,
    enterAtEnd,
    ...(onExhausted ? { onExhausted } : {}),
  });

  // Publish the controls before paint, so a key press handled in the same tick
  // already sees the current stage.
  useIsomorphicLayoutEffect(() => {
    if (playbackRef) playbackRef.current = playback;
  });

  const { stage, stageCount } = playback;
  useEffect(() => {
    onStageChange?.(stage, stageCount);
  }, [onStageChange, stage, stageCount]);

  const transition = useSlideTransition(slide, enabled);

  const layer: CSSProperties = {
    position: 'absolute',
    inset: 0,
    // Each layer is its own paint surface, so the two never bleed together.
    backfaceVisibility: 'hidden',
  };

  return (
    <div
      className={className}
      style={{
        position: 'relative',
        width: deck.size.width,
        height: deck.size.height,
        overflow: 'hidden',
        ...(transition.spec?.background ? { background: transition.spec.background } : {}),
        ...(transition.spec?.perspective
          ? { perspective: `${transition.spec.perspective}px`, transformStyle: 'preserve-3d' }
          : {}),
        ...style,
      }}
    >
      {transition.outgoing ? (
        <div
          ref={transition.outgoingRef}
          style={{ ...layer, zIndex: transition.spec?.incomingBelow ? 2 : 1 }}
          aria-hidden
        >
          <SlideView slide={transition.outgoing} />
        </div>
      ) : null}
      <div
        ref={transition.incomingRef}
        style={{ ...layer, zIndex: transition.spec?.incomingBelow ? 1 : 2 }}
      >
        <SlideView slide={slide} playback={playback} />
      </div>
    </div>
  );
}

interface SlideTransitionState {
  /** The slide being left, while its transition plays. */
  outgoing: Slide | null;
  spec: TransitionSpec | null;
  outgoingRef: MutableRefObject<HTMLDivElement | null>;
  incomingRef: MutableRefObject<HTMLDivElement | null>;
}

interface OutgoingLayer {
  slide: Slide;
  /** False when navigating backwards, which mirrors directional effects. */
  forward: boolean;
}

/**
 * Keeps the previous slide mounted for the duration of the transition and runs
 * the two layers' animations.
 *
 * The slide change is detected in a *layout* effect rather than during render.
 * Deriving it during render means mutating a ref to remember the previous slide,
 * and React replays renders — under StrictMode, in particular — which makes that
 * ref lie. A layout effect runs exactly once per commit and still lands before
 * paint, so the outgoing layer appears without a flash.
 */
function useSlideTransition(slide: Slide, enabled: boolean): SlideTransitionState {
  const { deck } = useKeynoteContext();
  const outgoingRef = useRef<HTMLDivElement | null>(null);
  const incomingRef = useRef<HTMLDivElement | null>(null);

  const [outgoing, setOutgoing] = useState<OutgoingLayer | null>(null);
  const shown = useRef(slide);

  useIsomorphicLayoutEffect(() => {
    const previous = shown.current;
    if (previous.index === slide.index) return;
    shown.current = slide;
    setOutgoing(
      enabled && slide.transition
        ? { slide: previous, forward: slide.index > previous.index }
        : null,
    );
  }, [slide, enabled]);

  const spec =
    outgoing && slide.transition
      ? transitionSpec(slide.transition, deck.size, outgoing.forward)
      : null;

  useIsomorphicLayoutEffect(() => {
    const transition = slide.transition;
    if (!outgoing || !transition || !spec) return;

    const options = transitionOptions(transition.duration);
    const animations: Animation[] = [];

    const run = (element: HTMLElement | null, keyframes: Keyframe[] | undefined) => {
      if (!element || !keyframes || typeof element.animate !== 'function') return;
      try {
        animations.push(element.animate(keyframes, options));
      } catch {
        // Ignore: without animation the new slide simply appears.
      }
    };

    run(outgoingRef.current, spec.outgoing);
    run(incomingRef.current, spec.incoming);

    if (transition.kind === 'magicMove' && incomingRef.current && outgoingRef.current) {
      animations.push(
        ...runMagicMove(outgoing.slide, slide, incomingRef.current, outgoingRef.current, options),
      );
    }

    let cancelled = false;
    const clear = () => {
      if (!cancelled) setOutgoing(null);
    };

    // Nothing to play: drop the old layer rather than leaving it on screen.
    if (animations.length === 0) {
      clear();
      return;
    }

    void Promise.all(animations.map((animation) => animation.finished.catch(() => {}))).then(clear);
    // Safety net, so a stalled animation can never strand the previous slide.
    const timer = setTimeout(clear, transition.duration * 1000 + 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      for (const animation of animations) animation.cancel();
    };
    // `spec` is derived from `outgoing` and `slide`, both already dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outgoing, slide]);

  return { outgoing: outgoing?.slide ?? null, spec, outgoingRef, incomingRef };
}

/**
 * Magic Move: slide matched objects from where they were to where they are now,
 * and let the transition's cross-fade handle everything unmatched.
 *
 * `composite: 'add'` layers the offset on top of each element's own transform
 * (anchor, rotation, builds) instead of replacing it.
 */
function runMagicMove(
  from: Slide,
  to: Slide,
  incomingLayer: HTMLElement,
  outgoingLayer: HTMLElement,
  options: KeyframeAnimationOptions,
): Animation[] {
  const animations: Animation[] = [];
  const pairs = matchElements(from, to);
  if (pairs.length === 0) return animations;

  for (const pair of pairs) {
    const target = incomingLayer.querySelector<HTMLElement>(`[data-keynote-id="${pair.toId}"]`);
    const source = outgoingLayer.querySelector<HTMLElement>(`[data-keynote-id="${pair.fromId}"]`);
    if (!target) continue;

    // The old copy would otherwise cross-fade under the moving one.
    if (source) {
      try {
        animations.push(source.animate([{ opacity: 0 }, { opacity: 0 }], options));
      } catch {
        /* not fatal */
      }
    }

    const moved = pair.dx !== 0 || pair.dy !== 0;
    const scaled = Math.abs(pair.sx - 1) > 0.001 || Math.abs(pair.sy - 1) > 0.001;
    if (!moved && !scaled) continue;

    try {
      animations.push(
        target.animate(
          [
            { transform: `translate(${pair.dx}px, ${pair.dy}px) scale(${pair.sx}, ${pair.sy})` },
            { transform: 'translate(0px, 0px) scale(1, 1)' },
          ],
          { ...options, composite: 'add' },
        ),
      );
    } catch {
      /* a browser without additive transforms just cross-fades */
    }
  }
  return animations;
}
