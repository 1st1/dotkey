import { toColor, type RawColor } from '../model/color.js';
import type {
  Build,
  BuildAnimation,
  BuildDelivery,
  BuildKind,
  DeliveryOrder,
  Easing,
  EffectDirection,
  Rect,
  ShapePath,
  SlideTransition,
  TransitionKind,
} from '../model/types.js';
import type { Ref } from '../document/store.js';
import type { BuildContext } from './context.js';
import { toShapePath } from './geometry.js';
import { isBag, type PropertyBag } from './styles.js';

/**
 * Transitions and object builds.
 *
 * Keynote stores animation in two unrelated places. A slide's `transition` is a
 * single `KN.TransitionArchive`. Object builds are a list of `KN.BuildArchive`
 * (what happens, and to which drawable) paired with a list of
 * `KN.BuildChunkArchive` — and it is the *chunk* list that defines play order
 * and, through its `automatic` flag, where each click falls.
 */

interface RawAnimationAttributes {
  animation_type?: string;
  effect?: string;
  duration?: number;
  direction?: number;
  delay?: number;
  is_automatic?: boolean;
  color?: RawColor;
  custom_detail?: number;
}

interface RawTransition {
  attributes?: {
    animationAttributes?: RawAnimationAttributes;
    custom_magic_move_fade_unmatched_objects?: boolean;
    custom_timing_curve?: string;
    custom_travel_distance?: number;
  };
}

interface RawBuild {
  drawable?: Ref;
  delivery?: string;
  attributes?: {
    animationAttributes?: RawAnimationAttributes;
    eventTrigger?: number;
    action_rotationAngle?: number;
    action_rotationDirection?: string;
    action_scaleSize?: number;
    action_colorAlpha?: number;
    action_acceleration?: string;
    action_motionPathSource?: unknown;
    custom_textDelivery?: string;
    custom_deliveryOption?: string;
    custom_action_repeatCount?: number;
    custom_scale_amount?: number;
    custom_travel_distance?: number;
  };
}

interface RawBuildChunk {
  build?: Ref;
  delay?: number;
  duration?: number;
  automatic?: boolean;
}

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

/**
 * Effect id -> renderable family. Matched on the id with the `apple:` prefix
 * removed, longest key first, so `objectcube` wins over `cube`.
 */
const TRANSITION_KINDS: ReadonlyArray<readonly [string, TransitionKind]> = [
  ['magic-move', 'magicMove'],
  ['magicmove', 'magicMove'],
  ['fade-through-color', 'fadeThroughColor'],
  ['dissolve', 'dissolve'],
  ['motion-dissolve', 'dissolve'],
  ['push', 'push'],
  ['move-in', 'moveIn'],
  ['movein', 'moveIn'],
  ['reveal', 'reveal'],
  ['wipe', 'wipe'],
  ['blinds', 'wipe'],
  ['iris', 'iris'],
  ['scale', 'scale'],
  ['objectzoom', 'scale'],
  ['flip', 'flip'],
  ['flop', 'flip'],
  ['cube', 'cube'],
  ['objectcube', 'cube'],
  ['door', 'cube'],
  ['swap', 'cube'],
  ['page-flip', 'flip'],
];

export function toTransition(raw: unknown): SlideTransition | undefined {
  if (!isBag(raw)) return undefined;
  const transition = raw as RawTransition;
  const attributes = transition.attributes?.animationAttributes;
  if (!attributes) return undefined;

  const effect = attributes.effect ?? 'none';
  // Keynote keeps a full attribute record for slides with no transition at all.
  if (effect === 'none' || effect === '') return undefined;

  const kind = classify(effect, TRANSITION_KINDS);
  const color = toColor(attributes.color);

  return {
    effect,
    kind,
    duration: attributes.duration ?? 1,
    delay: attributes.delay ?? 0,
    automatic: attributes.is_automatic === true,
    direction: toDirection(attributes.direction),
    directionValue: attributes.direction ?? 0,
    ...(color ? { color } : {}),
    ...(kind === 'magicMove'
      ? {
          fadeUnmatched:
            transition.attributes?.custom_magic_move_fade_unmatched_objects !== false,
        }
      : {}),
  };
}

// ---------------------------------------------------------------------------
// Builds
// ---------------------------------------------------------------------------

const BUILD_KINDS: Record<string, BuildKind> = {
  In: 'in',
  Out: 'out',
  Action: 'action',
};

const TEXT_DELIVERY: Record<string, BuildDelivery> = {
  kTextDeliveryUndefined: 'object',
  kTextDeliveryByObject: 'object',
  kTextDeliveryByLine: 'line',
  kTextDeliveryByWord: 'word',
  kTextDeliveryByCharacter: 'character',
};

const DELIVERY_ORDER: Record<string, DeliveryOrder> = {
  kDeliveryOptionUndefined: 'forward',
  kDeliveryOptionForward: 'forward',
  kDeliveryOptionBackward: 'backward',
  kDeliveryOptionFromCenter: 'fromCenter',
  kDeliveryOptionFromEdges: 'fromEdges',
  kDeliveryOptionRandom: 'random',
};

const EASING: Record<string, Easing> = {
  kNone: 'linear',
  kEaseIn: 'easeIn',
  kEaseOut: 'easeOut',
  kEaseBoth: 'easeInOut',
  kCustom: 'easeInOut',
};

/** Words in a `delivery` string that mean the text is split up. */
const DELIVERY_FROM_STRING: ReadonlyArray<readonly [string, BuildDelivery]> = [
  ['character', 'character'],
  ['word', 'word'],
  ['line', 'line'],
  ['paragraph', 'line'],
  ['bullet', 'line'],
];

export interface BuildsResult {
  builds: Build[];
  stageCount: number;
}

/**
 * Build the slide's animation sequence.
 *
 * `buildChunks` is walked in order: a chunk that is not automatic begins a new
 * click stage, and automatic chunks join the stage in progress. Builds with no
 * chunk (older documents) are appended, each on its own stage.
 */
export function toBuilds(
  context: BuildContext,
  buildRefs: readonly Ref[] | undefined,
  chunkRefs: readonly Ref[] | undefined,
): BuildsResult {
  const store = context.store;

  const rawBuilds = new Map<number, RawBuild>();
  for (const ref of buildRefs ?? []) {
    const value = store.resolveAs<RawBuild>(ref, 'KN.BuildArchive');
    if (value && ref.identifier !== undefined) rawBuilds.set(ref.identifier, value);
  }
  if (rawBuilds.size === 0) return { builds: [], stageCount: 0 };

  const builds: Build[] = [];
  const sequenced = new Set<number>();
  let stage = 0;
  let order = 0;

  const push = (id: number, raw: RawBuild, chunk: RawBuildChunk | undefined) => {
    const build = toBuild(context, String(id), raw, chunk, stage, order);
    if (!build) return;
    builds.push(build);
    order += 1;
  };

  for (const ref of chunkRefs ?? []) {
    const chunk = store.resolveAs<RawBuildChunk>(ref, 'KN.BuildChunkArchive');
    const buildId = chunk?.build?.identifier;
    if (!chunk || buildId === undefined) continue;
    const raw = rawBuilds.get(buildId);
    if (!raw) continue;

    // A chunk that waits for a click opens the next stage. An automatic chunk
    // joins the stage in progress — and if it comes first, that is stage 0: the
    // build plays as the slide appears, with no click at all.
    if (chunk.automatic !== true) stage += 1;
    sequenced.add(buildId);
    push(buildId, raw, chunk);
  }

  // Builds the chunk list does not mention still have to play.
  for (const [id, raw] of rawBuilds) {
    if (sequenced.has(id)) continue;
    stage += 1;
    push(id, raw, undefined);
  }

  return { builds, stageCount: stage };
}

function toBuild(
  context: BuildContext,
  id: string,
  raw: RawBuild,
  chunk: RawBuildChunk | undefined,
  stage: number,
  order: number,
): Build | undefined {
  const elementId = raw.drawable?.identifier;
  if (elementId === undefined) return undefined;

  const attributes = raw.attributes ?? {};
  const animation = attributes.animationAttributes ?? {};
  const effect = animation.effect ?? 'none';
  const kind = BUILD_KINDS[animation.animation_type ?? 'In'] ?? 'in';

  const duration = chunk?.duration ?? animation.duration ?? 0.5;
  const delay = chunk?.delay ?? animation.delay ?? 0;

  return {
    id,
    elementId: String(elementId),
    kind,
    effect,
    animation: toBuildAnimation(context, kind, effect, attributes),
    duration,
    delay,
    direction: toDirection(animation.direction),
    directionValue: animation.direction ?? 0,
    easing: EASING[attributes.action_acceleration ?? ''] ?? 'easeInOut',
    trigger: chunk?.automatic === true ? 'automatic' : 'onClick',
    delivery: toDeliveryKind(raw.delivery, attributes.custom_textDelivery),
    deliveryOrder: DELIVERY_ORDER[attributes.custom_deliveryOption ?? ''] ?? 'forward',
    stage,
    order,
  };
}

/** Effect id -> animation family, for build-in and build-out effects. */
const BUILD_KINDS_BY_EFFECT: ReadonlyArray<readonly [string, BuildAnimation['type']]> = [
  ['appear', 'appear'],
  ['dissolve', 'fade'],
  ['fade', 'fade'],
  ['move-in', 'move'],
  ['movein', 'move'],
  ['move', 'move'],
  ['scale', 'scale'],
  ['pop', 'scale'],
  ['grow', 'scale'],
  ['shrink', 'scale'],
  ['blur', 'blur'],
  ['wipe', 'wipe'],
  ['blinds', 'wipe'],
  ['iris', 'wipe'],
  ['pivot', 'pivot'],
  ['twirl', 'pivot'],
  ['flip', 'pivot'],
  ['swing', 'pivot'],
];

function toBuildAnimation(
  context: BuildContext,
  kind: BuildKind,
  effect: string,
  attributes: NonNullable<RawBuild['attributes']>,
): BuildAnimation {
  const id = normalizeEffect(effect);

  if (kind === 'action') return toActionAnimation(context, id, attributes);
  if (id === 'none' || id === '') return { type: 'appear' };
  if (id.includes('movie-start') || id.includes('audio-start')) return { type: 'media' };

  const family = classify(effect, BUILD_KINDS_BY_EFFECT, undefined);
  switch (family) {
    case 'appear':
      return { type: 'appear' };
    case 'fade':
      return { type: 'fade' };
    case 'move':
      return { type: 'move', distance: attributes.custom_travel_distance ?? 0 };
    case 'scale':
      // Keynote's Scale build grows from small for a build-in and to large for a
      // build-out; `custom_scale_amount` overrides the default when set.
      return { type: 'scale', from: attributes.custom_scale_amount ?? 0.01 };
    case 'blur':
      return { type: 'blur' };
    case 'wipe':
      return { type: 'wipe' };
    case 'pivot':
      return { type: 'pivot', angle: 90 };
    default:
      // Recognised effect, no drawable equivalent — the renderer falls back to a
      // fade, which is always better than the object popping in.
      context.noteUnsupported(`build:${effect}`);
      return { type: 'unsupported' };
  }
}

function toActionAnimation(
  context: BuildContext,
  id: string,
  attributes: NonNullable<RawBuild['attributes']>,
): BuildAnimation {
  if (id.includes('motion-path') || id.includes('move')) {
    const path = motionPath(attributes.action_motionPathSource);
    if (path) return path;
    return { type: 'unsupported' };
  }
  if (id.includes('opacity')) {
    return { type: 'opacity', to: attributes.action_colorAlpha ?? 0 };
  }
  if (id.includes('rotate') || id.includes('spin')) {
    return {
      type: 'rotate',
      angle: attributes.action_rotationAngle ?? 360,
      clockwise: attributes.action_rotationDirection !== 'kCounterclockwise',
    };
  }
  if (id.includes('scale') || id.includes('resize')) {
    return { type: 'resize', to: attributes.action_scaleSize ?? 1 };
  }
  for (const effect of ['blink', 'bounce', 'jiggle', 'pulse', 'flip'] as const) {
    if (id.includes(effect)) {
      return {
        type: 'emphasis',
        effect,
        repeat: Math.max(1, attributes.custom_action_repeatCount ?? 1),
      };
    }
  }
  context.noteUnsupported(`action:${id}`);
  return { type: 'unsupported' };
}

/**
 * A motion path is a `TSD.PathSourceArchive` whose coordinates are offsets in
 * points from the element's own position, starting at (0,0).
 */
function motionPath(raw: unknown): BuildAnimation | undefined {
  if (!isBag(raw)) return undefined;
  const parsed: ShapePath = toShapePath(raw).path;
  if (parsed.type !== 'path' || !parsed.d) return undefined;
  const bounds: Rect = parsed.viewBox;
  return { type: 'motionPath', d: parsed.d, bounds };
}

function toDeliveryKind(
  delivery: string | undefined,
  textDelivery: string | undefined,
): BuildDelivery {
  const mapped = TEXT_DELIVERY[textDelivery ?? ''];
  if (mapped && mapped !== 'object') return mapped;

  // Older documents only carry the human-readable delivery string.
  const lower = (delivery ?? '').toLowerCase();
  for (const [needle, kind] of DELIVERY_FROM_STRING) {
    if (lower.includes(needle)) return kind;
  }
  return 'object';
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function normalizeEffect(effect: string): string {
  return effect.replace(/^apple:/, '').replace(/^bc-/, '').trim().toLowerCase();
}

function classify<T>(
  effect: string,
  table: ReadonlyArray<readonly [string, T]>,
  fallback: T | 'unsupported' = 'unsupported',
): T {
  const id = normalizeEffect(effect);
  let best: { key: string; value: T } | undefined;
  for (const [key, value] of table) {
    if (!id.includes(key)) continue;
    if (!best || key.length > best.key.length) best = { key, value };
  }
  return best ? best.value : (fallback as T);
}

/**
 * Keynote stores direction as a small integer. The mapping is inferred from the
 * order of the options in Keynote's inspector; the raw value is preserved on
 * every transition and build so a host can second-guess it.
 */
const DIRECTIONS: readonly EffectDirection[] = [
  'leftToRight',
  'rightToLeft',
  'topToBottom',
  'bottomToTop',
  'in',
  'out',
];

function toDirection(value: number | undefined): EffectDirection {
  return DIRECTIONS[value ?? 0] ?? 'leftToRight';
}

/** Unit vector an effect travels along, in screen coordinates. */
export function directionVector(direction: EffectDirection): { x: number; y: number } {
  switch (direction) {
    case 'rightToLeft':
      return { x: -1, y: 0 };
    case 'topToBottom':
      return { x: 0, y: 1 };
    case 'bottomToTop':
      return { x: 0, y: -1 };
    case 'leftToRight':
    default:
      return { x: 1, y: 0 };
  }
}
