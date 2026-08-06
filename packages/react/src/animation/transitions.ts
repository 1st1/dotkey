import { directionVector, type Element, type Size, type Slide } from '@dotkey/core';

/**
 * Slide transitions.
 *
 * Both slides are mounted at once and each gets its own Web Animations
 * timeline, so no CSS has to be injected and the transition can be cancelled
 * cleanly if the user clicks through it.
 *
 * Going backwards replays the transition of the slide being entered, mirrored —
 * which is what Keynote does and what a viewer expects.
 */

export interface TransitionSpec {
  /** Keyframes for the slide being left. */
  outgoing?: Keyframe[];
  /** Keyframes for the slide being entered. */
  incoming?: Keyframe[];
  /** Background painted between the two layers, for fade-through-colour. */
  background?: string;
  /** The incoming slide is drawn under the outgoing one (Reveal). */
  incomingBelow?: boolean;
  /** 3-D effects need a perspective on the container. */
  perspective?: number;
}

const EASE = 'cubic-bezier(0.4, 0, 0.2, 1)';

export function transitionOptions(duration: number): KeyframeAnimationOptions {
  return {
    duration: Math.max(duration, 0) * 1000,
    easing: EASE,
    fill: 'both',
  };
}

/**
 * Keyframes for a transition. `forward` is false when navigating backwards, in
 * which case directional effects are mirrored.
 */
export function transitionSpec(
  transition: Slide['transition'],
  size: Size,
  forward: boolean,
): TransitionSpec {
  const kind = transition?.kind ?? 'dissolve';
  const vector = directionVector(transition?.direction ?? 'leftToRight');
  const sign = forward ? 1 : -1;
  // A push travels *against* its direction vector: "left to right" means the
  // incoming slide arrives from the left.
  const dx = -vector.x * sign * size.width;
  const dy = -vector.y * sign * size.height;

  switch (kind) {
    case 'dissolve':
    case 'magicMove':
    case 'unsupported':
    case 'none':
      return {
        outgoing: [{ opacity: 1 }, { opacity: 0 }],
        incoming: [{ opacity: 0 }, { opacity: 1 }],
      };

    case 'fadeThroughColor':
      return {
        outgoing: [
          { opacity: 1, offset: 0 },
          { opacity: 0, offset: 0.5 },
          { opacity: 0, offset: 1 },
        ],
        incoming: [
          { opacity: 0, offset: 0 },
          { opacity: 0, offset: 0.5 },
          { opacity: 1, offset: 1 },
        ],
      };

    case 'push':
      return {
        outgoing: [{ transform: 'translate(0, 0)' }, { transform: `translate(${-dx}px, ${-dy}px)` }],
        incoming: [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }],
      };

    case 'moveIn':
      return {
        incoming: [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }],
      };

    case 'reveal':
      return {
        outgoing: [
          { transform: 'translate(0, 0)' },
          { transform: `translate(${-dx}px, ${-dy}px)` },
        ],
        incomingBelow: true,
      };

    case 'wipe':
      return { incoming: [{ clipPath: wipeFrom(dx, dy) }, { clipPath: 'inset(0%)' }] };

    case 'iris':
      return {
        incoming: [{ clipPath: 'circle(0% at 50% 50%)' }, { clipPath: 'circle(75% at 50% 50%)' }],
      };

    case 'scale':
      return {
        outgoing: [
          { transform: 'scale(1)', opacity: 1 },
          { transform: 'scale(1.25)', opacity: 0 },
        ],
        incoming: [
          { transform: 'scale(0.75)', opacity: 0 },
          { transform: 'scale(1)', opacity: 1 },
        ],
      };

    case 'flip':
      return {
        perspective: size.width * 1.5,
        outgoing: [
          { transform: 'rotateY(0deg)', opacity: 1, offset: 0 },
          { transform: `rotateY(${-90 * sign}deg)`, opacity: 1, offset: 0.5 },
          { transform: `rotateY(${-90 * sign}deg)`, opacity: 0, offset: 0.5001 },
        ],
        incoming: [
          { transform: `rotateY(${90 * sign}deg)`, opacity: 0, offset: 0 },
          { transform: `rotateY(${90 * sign}deg)`, opacity: 0, offset: 0.5 },
          { transform: `rotateY(${90 * sign}deg)`, opacity: 1, offset: 0.5001 },
          { transform: 'rotateY(0deg)', opacity: 1, offset: 1 },
        ],
      };

    case 'cube': {
      const half = size.width / 2;
      return {
        perspective: size.width * 1.5,
        outgoing: [
          { transform: 'translateZ(0) rotateY(0deg)' },
          { transform: `translateZ(${-half}px) rotateY(${-90 * sign}deg)` },
        ],
        incoming: [
          { transform: `translateZ(${-half}px) rotateY(${90 * sign}deg)` },
          { transform: 'translateZ(0) rotateY(0deg)' },
        ],
      };
    }
  }
}

/** `inset()` that hides the incoming slide on the side the wipe starts from. */
function wipeFrom(dx: number, dy: number): string {
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx > 0 ? 'inset(0% 0% 0% 100%)' : 'inset(0% 100% 0% 0%)';
  }
  return dy > 0 ? 'inset(0% 0% 100% 0%)' : 'inset(100% 0% 0% 0%)';
}

// ---------------------------------------------------------------------------
// Magic Move
// ---------------------------------------------------------------------------

export interface MagicMovePair {
  /** Element id on the slide being entered. */
  toId: string;
  /** Element id on the slide being left. */
  fromId: string;
  /** Offset, in slide points, from the old position to the new one. */
  dx: number;
  dy: number;
  /** Scale from the old size to the new one. */
  sx: number;
  sy: number;
}

interface Placed {
  id: string;
  key: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Pair up elements that appear on both slides.
 *
 * Keynote matches objects by an identity it does not write into the archive in
 * any form this parser can read, so matching is done on content: an image with
 * the same media, a text box with the same words, a shape with the same
 * outline. That is a heuristic — it will pair two identical bullets that the
 * author considers distinct — but for the case Magic Move exists to serve (the
 * same object repositioned on the next slide) it is reliable.
 */
export function matchElements(from: Slide, to: Slide): MagicMovePair[] {
  const source = new Map<string, Placed[]>();
  for (const element of place(from.elements)) {
    const list = source.get(element.key);
    if (list) list.push(element);
    else source.set(element.key, [element]);
  }

  const pairs: MagicMovePair[] = [];
  for (const target of place(to.elements)) {
    const candidates = source.get(target.key);
    if (!candidates?.length) continue;
    // Nearest candidate wins, so repeated content pairs up sensibly.
    let bestIndex = 0;
    let bestDistance = Infinity;
    for (const [index, candidate] of candidates.entries()) {
      const distance = Math.hypot(candidate.x - target.x, candidate.y - target.y);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    }
    const [match] = candidates.splice(bestIndex, 1);
    if (!match) continue;

    pairs.push({
      toId: target.id,
      fromId: match.id,
      dx: match.x - target.x,
      dy: match.y - target.y,
      sx: target.width > 0 ? match.width / target.width : 1,
      sy: target.height > 0 ? match.height / target.height : 1,
    });
  }
  return pairs;
}

/** Flatten to absolute positions, keeping a content key for matching. */
function place(elements: readonly Element[], offsetX = 0, offsetY = 0): Placed[] {
  const out: Placed[] = [];
  for (const element of elements) {
    const x = offsetX + element.frame.x;
    const y = offsetY + element.frame.y;
    if (element.kind === 'group') {
      out.push(...place(element.children, x, y));
      continue;
    }
    const key = contentKey(element);
    if (!key) continue;
    out.push({ id: element.id, key, x, y, width: element.frame.width, height: element.frame.height });
  }
  return out;
}

function contentKey(element: Element): string | undefined {
  switch (element.kind) {
    case 'image':
      return element.resource ? `image:${element.resource}` : undefined;
    case 'movie':
      return element.resource ? `movie:${element.resource}` : undefined;
    case 'shape': {
      const text = element.text?.plainText.trim();
      if (text) return `text:${text}`;
      // A blank shape is identified by its outline and paint instead.
      return `shape:${element.path.type}:${element.fill?.type ?? 'none'}`;
    }
    default:
      return undefined;
  }
}
