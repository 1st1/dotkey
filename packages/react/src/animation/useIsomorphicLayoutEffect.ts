import { useEffect, useLayoutEffect } from 'react';

/**
 * `useLayoutEffect` in the browser, `useEffect` on the server.
 *
 * Animation setup has to run before paint — an animation started after it shows
 * one frame of the un-animated element — but React warns about layout effects
 * during server rendering, where there is nothing to paint anyway.
 */
export const useIsomorphicLayoutEffect =
  typeof window === 'undefined' ? useEffect : useLayoutEffect;
