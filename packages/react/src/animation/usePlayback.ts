import type { Build, Slide } from '@dotkey/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { groupBuilds, type ElementBuilds } from './effects.js';
import { useIsomorphicLayoutEffect } from './useIsomorphicLayoutEffect.js';

/**
 * Build playback for one slide.
 *
 * A slide is a sequence of stages. Stage 0 is what you see the moment the slide
 * appears; each click advances one stage. Every build knows its stage, so the
 * whole thing is driven by a single integer — which means jumping straight to
 * any stage (or to the end, for printing and thumbnails) costs nothing.
 */
export interface Playback {
  stage: number;
  stageCount: number;
  /**
   * The stage whose animations should be running, or `null` when the current
   * state was reached without animating (a backwards step, or a jump).
   */
  animatingStage: number | null;
  /** Bumped every time animations start, so effects re-run on a repeat visit. */
  token: number;
  hasNext: boolean;
  hasPrevious: boolean;
  /** Builds grouped by the element they animate. */
  byElement: Map<string, ElementBuilds>;
  next(): boolean;
  previous(): boolean;
  goTo(stage: number, options?: { animate?: boolean }): void;
  /** Jump to the fully-built state without animating. */
  showAll(): void;
}

export interface UsePlaybackOptions {
  /** Play animations. When false the slide renders fully built. Default `true`. */
  animate?: boolean;
  /**
   * Enter the slide fully built rather than at stage 0. Navigating *backwards*
   * into a slide should show it as the audience last saw it.
   */
  enterAtEnd?: boolean;
  /** Called when `next()` is asked to go past the last stage. */
  onExhausted?: () => void;
}

interface PlaybackState {
  /** The slide this state belongs to, so a slide change can be detected. */
  slideId: string;
  stage: number;
  animating: number | null;
  token: number;
}

export function usePlayback(slide: Slide, options: UsePlaybackOptions = {}): Playback {
  const animate = options.animate ?? true;
  const stageCount = animate ? slide.stageCount : 0;
  const enterAtEnd = options.enterAtEnd ?? false;

  /** Where a slide starts: fully built when entered backwards, else stage 0. */
  const entry = (token: number): PlaybackState => ({
    slideId: slide.id,
    stage: enterAtEnd ? stageCount : 0,
    // Stage 0 animates on arrival, so automatic entrance builds play themselves.
    animating: enterAtEnd ? null : 0,
    token,
  });

  const [state, setState] = useState(() => entry(0));

  /**
   * Reset during render rather than in an effect.
   *
   * An effect runs after paint, so the new slide would paint once with the
   * previous slide's stage — every build-in fully visible — and only then snap
   * to stage 0. That is a one-frame flash of the finished slide. Comparing
   * against `slideId` held in *state* (not a ref) keeps this correct when React
   * replays a render.
   */
  const changed = state.slideId !== slide.id;
  if (changed) setState(entry(state.token + 1));

  // Use the reset values immediately, so even the render React is about to
  // discard describes the new slide correctly.
  const current = changed ? entry(state.token + 1) : state;
  const stage = current.stage;

  const byElement = useMemo(() => groupBuilds(animate ? slide.builds : []), [slide.builds, animate]);

  /**
   * The live stage, so `next()` and `previous()` can report whether they moved.
   * Reading it out of a `setState` updater does not work: React only evaluates
   * updaters eagerly when the fiber has no pending work, so on a fresh mount the
   * return value was always `false` and the caller advanced the slide instead of
   * playing the slide's builds.
   */
  const stageRef = useRef(stage);
  useIsomorphicLayoutEffect(() => {
    stageRef.current = stage;
  }, [stage]);
  if (changed) stageRef.current = stage;

  const goTo = useCallback(
    (target: number, goToOptions: { animate?: boolean } = {}) => {
      const clamped = Math.max(0, Math.min(target, stageCount));
      // Only forward movement animates; stepping back snaps.
      const shouldAnimate = (goToOptions.animate ?? true) && clamped > stageRef.current;
      stageRef.current = clamped;
      setState((previousState) => ({
        ...previousState,
        stage: clamped,
        animating: shouldAnimate ? clamped : null,
        token: previousState.token + 1,
      }));
    },
    [stageCount],
  );

  const next = useCallback(() => {
    if (stageRef.current >= stageCount) {
      options.onExhausted?.();
      return false;
    }
    const target = stageRef.current + 1;
    stageRef.current = target;
    setState((previousState) => ({
      ...previousState,
      stage: target,
      animating: target,
      token: previousState.token + 1,
    }));
    return true;
    // `onExhausted` is read through the options object on purpose: callers pass
    // an inline function, and re-creating this callback every render is wasteful.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stageCount]);

  const previous = useCallback(() => {
    if (stageRef.current <= 0) return false;
    const target = stageRef.current - 1;
    stageRef.current = target;
    setState((previousState) => ({
      ...previousState,
      stage: target,
      // Stepping back snaps rather than playing the build in reverse.
      animating: null,
      token: previousState.token + 1,
    }));
    return true;
  }, []);

  const showAll = useCallback(() => {
    stageRef.current = stageCount;
    setState((previousState) => ({
      ...previousState,
      stage: stageCount,
      animating: null,
      token: previousState.token + 1,
    }));
  }, [stageCount]);

  return {
    stage,
    stageCount,
    animatingStage: current.animating,
    token: current.token,
    hasNext: stage < stageCount,
    hasPrevious: stage > 0,
    byElement,
    next,
    previous,
    goTo,
    showAll,
  };
}

/** Builds that fire when entering `stage`. */
export function buildsAtStage(builds: ElementBuilds | undefined, stage: number): Build[] {
  if (!builds) return [];
  const out: Build[] = [];
  if (builds.buildIn?.stage === stage) out.push(builds.buildIn);
  if (builds.buildOut?.stage === stage) out.push(builds.buildOut);
  for (const action of builds.actions) if (action.stage === stage) out.push(action);
  for (const media of builds.media) if (media.stage === stage) out.push(media);
  return out.sort((a, b) => a.order - b.order);
}

/** True when the user has asked the system to minimise animation. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(query.matches);
    const listener = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener('change', listener);
    return () => query.removeEventListener('change', listener);
  }, []);

  return reduced;
}
