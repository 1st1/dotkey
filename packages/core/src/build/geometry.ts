import type { Frame, Point, Rect, ShapePath, Size, VerticalAlign } from '../model/types.js';
import { fromSuperChain, isBag, type PropertyBag } from './styles.js';

export interface RawGeometry {
  position?: { x?: number; y?: number };
  size?: { width?: number; height?: number };
  flags?: number;
  angle?: number;
}

/**
 * `TSD.GeometryArchive.flags` is a validity mask over `size`. Keynote leaves
 * `size` at 0 for text boxes that grow with their content and marks the
 * corresponding axis invalid; the renderer has to measure those.
 */
const WIDTH_IS_EXPLICIT = 1 << 0;
const HEIGHT_IS_EXPLICIT = 1 << 1;

export const EMPTY_FRAME: Frame = {
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  autoWidth: true,
  autoHeight: true,
  anchorX: 'left',
  anchorY: 'top',
};

export function toFrame(raw: RawGeometry | undefined): Frame {
  if (!raw) return { ...EMPTY_FRAME };
  const flags = raw.flags ?? 0;
  return {
    x: raw.position?.x ?? 0,
    y: raw.position?.y ?? 0,
    width: raw.size?.width ?? 0,
    height: raw.size?.height ?? 0,
    autoWidth: (flags & WIDTH_IS_EXPLICIT) === 0,
    autoHeight: (flags & HEIGHT_IS_EXPLICIT) === 0,
    anchorX: 'left',
    anchorY: 'top',
  };
}

/**
 * A text box with no stored height grows around the point Keynote anchored it
 * to, which is its vertical alignment. Measured against Keynote's own PDF
 * export: a middle-aligned auto-height box is centred on `position.y`, and a
 * bottom-aligned one ends there.
 */
export function anchorFrame(frame: Frame, verticalAlign: VerticalAlign | undefined): Frame {
  if (!frame.autoHeight) return frame;
  const anchorY =
    verticalAlign === 'middle' ? 'center' : verticalAlign === 'bottom' ? 'bottom' : 'top';
  return anchorY === 'top' ? frame : { ...frame, anchorY };
}

/** Offset from the stored position to the box's top-left corner. */
export function anchorOffset(frame: Frame): Point {
  return {
    x: zero(
      frame.anchorX === 'center' ? -frame.width / 2
      : frame.anchorX === 'right' ? -frame.width
      : 0,
    ),
    y: zero(
      frame.anchorY === 'center' ? -frame.height / 2
      : frame.anchorY === 'bottom' ? -frame.height
      : 0,
    ),
  };
}

/**
 * Keynote stores angles counter-clockwise in degrees; the model uses the screen
 * convention (clockwise) so renderers can pass it straight to `rotate()`.
 */
export function toRotation(raw: RawGeometry | undefined): number {
  const angle = raw?.angle ?? 0;
  if (angle === 0) return 0;
  const wrapped = -angle % 360;
  return zero(wrapped < 0 ? wrapped + 360 : wrapped);
}

/** Geometry lives on `TSD.DrawableArchive`, at the bottom of the `super` stack. */
export function drawableGeometry(value: PropertyBag | undefined): RawGeometry | undefined {
  const geometry = fromSuperChain<unknown>(value, 'geometry');
  return isBag(geometry) ? (geometry as RawGeometry) : undefined;
}

// ---------------------------------------------------------------------------
// Path sources
// ---------------------------------------------------------------------------

interface RawPathElement {
  type?: string;
  points?: { x?: number; y?: number }[];
}

interface RawPathSource {
  horizontalFlip?: boolean;
  verticalFlip?: boolean;
  bezier_path_source?: { naturalSize?: Size; path?: { elements?: RawPathElement[] } };
  editable_bezier_path_source?: {
    naturalSize?: Size;
    subpaths?: {
      closed?: boolean;
      nodes?: {
        inControlPoint?: Point;
        nodePoint?: Point;
        outControlPoint?: Point;
      }[];
    }[];
  };
  scalar_path_source?: { type?: string; scalar?: number; naturalSize?: Size };
  point_path_source?: { type?: string; point?: Point; naturalSize?: Size };
  callout_path_source?: { natural_size?: Size; corner_radius?: number };
  connection_line_path_source?: unknown;
}

export interface ParsedPath {
  path: ShapePath;
  flipH: boolean;
  flipV: boolean;
}

const RECT: ShapePath = { type: 'rect' };

export function toShapePath(raw: unknown): ParsedPath {
  if (!isBag(raw)) return { path: RECT, flipH: false, flipV: false };
  const source = raw as RawPathSource;
  const flipH = source.horizontalFlip === true;
  const flipV = source.verticalFlip === true;

  const path =
    scalarPath(source) ??
    pointPath(source) ??
    bezierPath(source) ??
    editableBezierPath(source) ??
    calloutPath(source) ??
    RECT;

  return { path, flipH, flipV };
}

function scalarPath(source: RawPathSource): ShapePath | undefined {
  const scalar = source.scalar_path_source;
  if (!scalar) return undefined;
  const natural = scalar.naturalSize;
  switch (scalar.type) {
    case 'kTSDRoundedRectangle': {
      // The scalar is the corner radius as a fraction of the shorter side.
      const shorter = Math.min(natural?.width ?? 0, natural?.height ?? 0);
      return { type: 'roundedRect', radius: (scalar.scalar ?? 0) * shorter * 0.5 };
    }
    case 'kTSDRegularPolygon':
      return { type: 'polygon', sides: Math.max(3, Math.round(scalar.scalar ?? 5)) };
    default:
      return undefined;
  }
}

function pointPath(source: RawPathSource): ShapePath | undefined {
  const point = source.point_path_source;
  if (!point) return undefined;
  if (point.type === 'kTSDStar') {
    return {
      type: 'star',
      points: Math.max(3, Math.round(point.point?.x ?? 5)),
      innerRadius: point.point?.y ?? 0.5,
    };
  }
  return undefined;
}

function bezierPath(source: RawPathSource): ShapePath | undefined {
  const bezier = source.bezier_path_source;
  const elements = bezier?.path?.elements;
  if (!elements?.length) return undefined;
  return buildPath(elements, bezier?.naturalSize);
}

function editableBezierPath(source: RawPathSource): ShapePath | undefined {
  const editable = source.editable_bezier_path_source;
  if (!editable?.subpaths?.length) return undefined;

  const parts: string[] = [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let open = false;

  const track = (p: Point | undefined) => {
    if (!p) return;
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  };

  for (const subpath of editable.subpaths) {
    const nodes = subpath.nodes ?? [];
    if (nodes.length === 0) continue;
    const first = nodes[0]!;
    track(first.nodePoint);
    parts.push(`M${num(first.nodePoint?.x)} ${num(first.nodePoint?.y)}`);

    const count = subpath.closed ? nodes.length : nodes.length - 1;
    for (let i = 0; i < count; i++) {
      const from = nodes[i]!;
      const to = nodes[(i + 1) % nodes.length]!;
      track(to.nodePoint);
      track(from.outControlPoint);
      track(to.inControlPoint);
      parts.push(
        `C${num(from.outControlPoint?.x)} ${num(from.outControlPoint?.y)} ` +
          `${num(to.inControlPoint?.x)} ${num(to.inControlPoint?.y)} ` +
          `${num(to.nodePoint?.x)} ${num(to.nodePoint?.y)}`,
      );
    }
    if (subpath.closed) parts.push('Z');
    else open = true;
  }

  if (parts.length === 0) return undefined;
  return {
    type: 'path',
    d: parts.join(' '),
    viewBox: chooseViewBox(editable.naturalSize, minX, minY, maxX, maxY),
    open,
  };
}

function calloutPath(source: RawPathSource): ShapePath | undefined {
  const callout = source.callout_path_source;
  if (!callout) return undefined;
  // The tail is dropped; the body is the part that carries the text.
  return { type: 'roundedRect', radius: callout.corner_radius ?? 0 };
}

const COMMANDS: Record<string, { code: string; points: number }> = {
  moveTo: { code: 'M', points: 1 },
  lineTo: { code: 'L', points: 1 },
  quadCurveTo: { code: 'Q', points: 2 },
  curveTo: { code: 'C', points: 3 },
};

function buildPath(elements: RawPathElement[], natural: Size | undefined): ShapePath {
  const parts: string[] = [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let closed = 0;
  let subpaths = 0;
  let drawSinceMove = 0;

  for (const element of elements) {
    if (element.type === 'closeSubpath') {
      // Ignore a close that follows nothing (Keynote emits stray trailing
      // `moveTo` elements that would otherwise become a phantom subpath).
      if (drawSinceMove > 0) {
        parts.push('Z');
        closed++;
      }
      continue;
    }

    const command = COMMANDS[element.type ?? ''];
    if (!command) continue;
    const points = element.points ?? [];
    if (points.length < command.points) continue;

    if (element.type === 'moveTo') {
      // Drop the previous subpath if it never drew anything.
      if (subpaths > 0 && drawSinceMove === 0) parts.pop();
      subpaths++;
      drawSinceMove = 0;
    } else {
      drawSinceMove++;
    }

    const coords: string[] = [];
    for (let i = 0; i < command.points; i++) {
      const point = points[i]!;
      const x = point.x ?? 0;
      const y = point.y ?? 0;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      coords.push(`${num(x)} ${num(y)}`);
    }
    parts.push(command.code + coords.join(' '));
  }

  // A trailing `moveTo` with nothing after it draws nothing.
  if (subpaths > 0 && drawSinceMove === 0 && parts[parts.length - 1]?.startsWith('M')) {
    parts.pop();
    subpaths--;
  }

  return {
    type: 'path',
    d: parts.join(' '),
    viewBox: chooseViewBox(natural, minX, minY, maxX, maxY),
    open: closed === 0,
  };
}

/**
 * The region of path space that maps onto the element frame.
 *
 * Keynote authors bezier sources at whatever scale the shape happened to have
 * when it was created: the same document contains paths in the shape's natural
 * size, paths normalised to a 0..100 box, and paths at some arbitrary fraction
 * of the natural size. The one invariant is that the path fills the shape, so
 * its own bounding box is the mapping — `naturalSize` is unreliable and is only
 * consulted for degenerate paths.
 */
function chooseViewBox(
  natural: Size | undefined,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): Rect {
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
    return { x: 0, y: 0, width: natural?.width || 100, height: natural?.height || 100 };
  }

  const width = maxX - minX;
  const height = maxY - minY;

  // Rules and dividers are flat in one axis. Give that axis one unit of space
  // centred on the path so the stroke lands on the middle of the frame edge.
  return {
    x: width > 0 ? minX : minX - 0.5,
    y: height > 0 ? minY : minY - 0.5,
    width: width > 0 ? width : 1,
    height: height > 0 ? height : 1,
  };
}

function num(value: number | undefined): number {
  const n = value ?? 0;
  // Keynote emits values like -1.7e-13 for exact zeros; trim the noise so the
  // path data stays readable and stable.
  return zero(Math.round(n * 1000) / 1000);
}

/**
 * Collapse negative zero. It survives arithmetic but not `JSON.stringify`,
 * which would quietly break the model's round-trip guarantee.
 */
function zero(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}

/**
 * Combine an image frame with its mask window. The image geometry is the full
 * picture in parent coordinates; the mask geometry is the visible window in the
 * image's own coordinates.
 */
export function applyMask(
  imageFrame: Frame,
  maskGeometry: RawGeometry | undefined,
): { frame: Frame; crop?: Rect } {
  if (!maskGeometry?.size) return { frame: imageFrame };
  const maskX = maskGeometry.position?.x ?? 0;
  const maskY = maskGeometry.position?.y ?? 0;
  const maskWidth = maskGeometry.size.width ?? 0;
  const maskHeight = maskGeometry.size.height ?? 0;
  if (maskWidth <= 0 || maskHeight <= 0) return { frame: imageFrame };

  return {
    frame: {
      x: imageFrame.x + maskX,
      y: imageFrame.y + maskY,
      width: maskWidth,
      height: maskHeight,
      autoWidth: false,
      autoHeight: false,
      anchorX: 'left',
      anchorY: 'top',
    },
    crop: {
      x: zero(-maskX),
      y: zero(-maskY),
      width: imageFrame.width,
      height: imageFrame.height,
    },
  };
}
