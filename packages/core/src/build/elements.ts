import type { ArchiveObject, Ref } from '../document/store.js';
import type {
  Element,
  Fill,
  PlaceholderKind,
  ShapeElement,
  Size,
  Stroke,
  TextBlock,
} from '../model/types.js';
import type { BuildContext } from './context.js';
import {
  anchorFrame,
  applyMask,
  drawableGeometry,
  toFrame,
  toRotation,
  toShapePath,
  type RawGeometry,
} from './geometry.js';
import { shapePaint, toStroke } from './paint.js';
import { fromSuperChain, isBag, resolveProperties, type PropertyBag } from './styles.js';
import { buildTextBlock } from './text.js';

const PLACEHOLDER_KIND: Record<string, PlaceholderKind> = {
  kKindPlaceholder: 'generic',
  kKindSlideNumberPlaceholder: 'slideNumber',
  kKindTitlePlaceholder: 'title',
  kKindBodyPlaceholder: 'body',
  kKindObjectPlaceholder: 'object',
};

const MOVIE_LOOP: Record<string, 'none' | 'repeat' | 'backAndForth'> = {
  None: 'none',
  Repeat: 'repeat',
  BackAndForth: 'backAndForth',
};

export interface ElementOptions {
  fromMaster?: boolean;
}

/** Convert a drawable reference into a model element, or `undefined` to skip it. */
export function buildElement(
  context: BuildContext,
  ref: Ref | null | undefined,
  options: ElementOptions = {},
): Element | undefined {
  const object = context.store.deref(ref);
  if (!object?.value) return undefined;
  return buildFromObject(context, object, options);
}

function buildFromObject(
  context: BuildContext,
  object: ArchiveObject,
  options: ElementOptions,
): Element | undefined {
  const value = object.value as PropertyBag;

  switch (object.name) {
    case 'TSD.GroupArchive':
      return buildGroup(context, object, value, options);
    case 'TSD.ImageArchive':
      return buildImage(context, object, value, options);
    case 'TSD.MovieArchive':
      return buildMovie(context, object, value, options);
    case 'TSWP.ShapeInfoArchive':
    case 'TSD.ShapeArchive':
    case 'TSD.ConnectionLineArchive':
    case 'KN.PlaceholderArchive':
      return buildShape(context, object, value, options);
    case 'TSWP.CommentInfoArchive':
      // Comments are editor annotations, never part of the rendered slide.
      return undefined;
    default:
      context.noteUnsupported(object.name ?? `type:${object.type}`);
      return buildUnsupported(context, object, value, options);
  }
}

// ---------------------------------------------------------------------------
// Common drawable attributes
// ---------------------------------------------------------------------------

interface Common {
  id: string;
  frame: ReturnType<typeof toFrame>;
  rotation: number;
  geometry: RawGeometry | undefined;
  hyperlink?: string;
  description?: string;
  fromMaster?: boolean;
}

function common(object: ArchiveObject, value: PropertyBag, options: ElementOptions): Common {
  const geometry = drawableGeometry(value);
  const hyperlink = fromSuperChain<string>(value, 'hyperlink_url');
  const description = fromSuperChain<string>(value, 'accessibility_description');
  return {
    id: String(object.id),
    frame: toFrame(geometry),
    rotation: toRotation(geometry),
    geometry,
    ...(hyperlink ? { hyperlink } : {}),
    ...(description ? { description } : {}),
    ...(options.fromMaster ? { fromMaster: true } : {}),
  };
}

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

function buildGroup(
  context: BuildContext,
  object: ArchiveObject,
  value: PropertyBag,
  options: ElementOptions,
): Element {
  const base = common(object, value, options);
  const children: Element[] = [];
  for (const child of asRefs(value['children'])) {
    const element = buildElement(context, child, options);
    if (element) children.push(element);
  }

  return {
    kind: 'group',
    id: base.id,
    frame: base.frame,
    rotation: base.rotation,
    flipH: false,
    flipV: false,
    opacity: 1,
    ...(base.hyperlink ? { hyperlink: base.hyperlink } : {}),
    ...(base.description ? { description: base.description } : {}),
    ...(base.fromMaster ? { fromMaster: true } : {}),
    children,
  };
}

// ---------------------------------------------------------------------------
// Shapes and text boxes
// ---------------------------------------------------------------------------

function buildShape(
  context: BuildContext,
  object: ArchiveObject,
  value: PropertyBag,
  options: ElementOptions,
): ShapeElement {
  const base = common(object, value, options);

  // `KN.PlaceholderArchive` wraps `TSWP.ShapeInfoArchive` wraps
  // `TSD.ShapeArchive`; the fields we need live at different depths.
  const styleRef = fromSuperChain<Ref>(value, 'style');
  const properties = resolveProperties(context.store, styleRef, 'shape_properties');
  const paint = shapePaint(context, properties);

  const pathSource = fromSuperChain<unknown>(value, 'pathsource');
  const { path, flipH, flipV } = toShapePath(pathSource);

  const storageRef =
    fromSuperChain<Ref>(value, 'owned_storage') ?? fromSuperChain<Ref>(value, 'text_flow');
  const text = buildTextBlock(context, storageRef, { shapeProperties: properties });

  const placeholderKind =
    object.name === 'KN.PlaceholderArchive'
      ? (PLACEHOLDER_KIND[String(value['kind'] ?? 'kKindPlaceholder')] ?? 'generic')
      : undefined;

  const isTextBox =
    fromSuperChain<boolean>(value, 'is_text_box') === true ||
    (!paint.fill && !paint.stroke && text !== undefined);

  return {
    kind: 'shape',
    id: base.id,
    // An auto-height text box grows around its vertical-alignment anchor, so
    // the frame's meaning depends on the text it contains.
    frame: text ? anchorFrame(base.frame, text.verticalAlign) : base.frame,
    rotation: base.rotation,
    flipH,
    flipV,
    opacity: paint.opacity,
    ...(paint.shadow ? { shadow: paint.shadow } : {}),
    ...(base.hyperlink ? { hyperlink: base.hyperlink } : {}),
    ...(base.description ? { description: base.description } : {}),
    ...(base.fromMaster ? { fromMaster: true } : {}),
    ...(placeholderKind ? { placeholder: placeholderKind } : {}),
    path,
    ...(paint.fill ? { fill: paint.fill } : {}),
    ...(paint.stroke ? { stroke: paint.stroke } : {}),
    ...(text ? { text } : {}),
    isTextBox,
  };
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

function buildImage(
  context: BuildContext,
  object: ArchiveObject,
  value: PropertyBag,
  options: ElementOptions,
): Element {
  const base = common(object, value, options);

  const maskObject = context.store.deref(asRef(value['mask']));
  const maskGeometry = drawableGeometry(maskObject?.value as PropertyBag | undefined);
  const { frame, crop } = applyMask(base.frame, maskGeometry);

  const resource = context.displayableResource(
    asRef(value['data']),
    asRef(value['adjustedImageData']),
    asRef(value['originalData']),
    asRef(value['thumbnailData']),
  );

  const properties = resolveProperties(context.store, asRef(value['style']), 'media_properties');
  const stroke = toStroke(properties['stroke']);
  const shadow = shapePaint(context, properties).shadow;

  const natural = asSize(value['naturalSize']) ??
    asSize(value['originalSize']) ?? { width: frame.width, height: frame.height };

  return {
    kind: 'image',
    id: base.id,
    frame,
    rotation: base.rotation,
    flipH: false,
    flipV: false,
    opacity: numberOr(properties['opacity'], 1),
    ...(shadow ? { shadow } : {}),
    ...(base.hyperlink ? { hyperlink: base.hyperlink } : {}),
    ...(base.description ? { description: base.description } : {}),
    ...(base.fromMaster ? { fromMaster: true } : {}),
    resource,
    naturalSize: natural,
    ...(crop ? { crop } : {}),
    ...(stroke ? { stroke } : {}),
    ...buildAdjustments(value['imageAdjustments']),
  };
}

function buildAdjustments(raw: unknown): { adjustments?: Record<string, number> } {
  if (!isBag(raw)) return {};
  const keys = ['exposure', 'saturation', 'contrast', 'temperature', 'tint', 'gamma'] as const;
  const adjustments: Record<string, number> = {};
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === 'number' && value !== 0) adjustments[key] = value;
  }
  return Object.keys(adjustments).length > 0 ? { adjustments } : {};
}

// ---------------------------------------------------------------------------
// Movies
// ---------------------------------------------------------------------------

function buildMovie(
  context: BuildContext,
  object: ArchiveObject,
  value: PropertyBag,
  options: ElementOptions,
): Element {
  const base = common(object, value, options);
  const properties = resolveProperties(context.store, asRef(value['style']), 'media_properties');

  return {
    kind: 'movie',
    id: base.id,
    frame: base.frame,
    rotation: base.rotation,
    flipH: false,
    flipV: false,
    opacity: numberOr(properties['opacity'], 1),
    ...(base.hyperlink ? { hyperlink: base.hyperlink } : {}),
    ...(base.description ? { description: base.description } : {}),
    ...(base.fromMaster ? { fromMaster: true } : {}),
    resource: context.resource(asRef(value['movieData'])),
    poster:
      context.resource(asRef(value['posterImageData'])) ??
      context.resource(asRef(value['audioOnlyImageData'])),
    ...(typeof value['movieRemoteURL'] === 'string'
      ? { remoteUrl: value['movieRemoteURL'] }
      : {}),
    loop: MOVIE_LOOP[String(value['loop_option'] ?? 'None')] ?? 'none',
    audioOnly: value['audioOnly'] === true,
    ...(typeof value['startTime'] === 'number' ? { startTime: value['startTime'] } : {}),
    ...(typeof value['endTime'] === 'number' ? { endTime: value['endTime'] } : {}),
    ...(asSize(value['naturalSize']) ? { naturalSize: asSize(value['naturalSize'])! } : {}),
    ...(toStroke(properties['stroke']) ? { stroke: toStroke(properties['stroke'])! } : {}),
  };
}

// ---------------------------------------------------------------------------
// Fallback
// ---------------------------------------------------------------------------

function buildUnsupported(
  context: BuildContext,
  object: ArchiveObject,
  value: PropertyBag,
  options: ElementOptions,
): Element | undefined {
  const geometry = drawableGeometry(value);
  // Without geometry there is nothing meaningful to place on the slide.
  if (!geometry) return undefined;
  const base = common(object, value, options);
  return {
    kind: 'unsupported',
    id: base.id,
    frame: base.frame,
    rotation: base.rotation,
    flipH: false,
    flipV: false,
    opacity: 1,
    ...(base.description ? { description: base.description } : {}),
    ...(base.fromMaster ? { fromMaster: true } : {}),
    archive: object.name ?? `type:${object.type}`,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function elementHasText(element: Element): boolean {
  if (element.kind === 'shape') return hasText(element.text);
  if (element.kind === 'group') return element.children.some(elementHasText);
  return false;
}

export function hasText(text: TextBlock | undefined): boolean {
  return text !== undefined && text.plainText.trim().length > 0;
}

export function elementIsVisible(element: Element): boolean {
  if (element.opacity <= 0) return false;
  switch (element.kind) {
    case 'group':
      return element.children.some(elementIsVisible);
    case 'shape':
      return hasText(element.text) || hasPaint(element.fill, element.stroke);
    case 'image':
      return element.resource !== null;
    default:
      return true;
  }
}

function hasPaint(fill: Fill | undefined, stroke: Stroke | undefined): boolean {
  if (stroke) return true;
  if (!fill) return false;
  if (fill.type === 'color') return fill.color.a > 0;
  return true;
}

function asRef(value: unknown): Ref | undefined {
  return isBag(value) && typeof value['identifier'] === 'number' ? (value as Ref) : undefined;
}

function asRefs(value: unknown): Ref[] {
  return Array.isArray(value) ? value.filter((item): item is Ref => asRef(item) !== undefined) : [];
}

function asSize(value: unknown): Size | undefined {
  if (!isBag(value)) return undefined;
  const width = value['width'];
  const height = value['height'];
  if (typeof width !== 'number' || typeof height !== 'number') return undefined;
  return { width, height };
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
