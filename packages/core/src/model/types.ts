/**
 * The Keynote document model.
 *
 * Everything here is plain JSON: no protobuf, no object references, no binary.
 * A `Deck` can be produced on a server, cached, shipped to a browser and
 * rendered by any backend (React/DOM, canvas, PDF, native). `@dotkey/react` is
 * one consumer of this model, not a privileged one.
 *
 * Units are PostScript points, matching what Keynote stores. Widescreen decks
 * are typically 1920x1080. The origin is the top-left of the slide, y grows
 * downward, and every `frame` is relative to its parent group.
 */

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Rect extends Point, Size {}

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Components are 0..1 floats, preserving the source colour space. */
export interface Color {
  space: 'srgb' | 'p3';
  r: number;
  g: number;
  b: number;
  a: number;
}

// ---------------------------------------------------------------------------
// Paint
// ---------------------------------------------------------------------------

export interface GradientStop {
  color: Color;
  /** Position along the gradient, 0..1. */
  offset: number;
  /** Midpoint bias towards the next stop, 0..1 (Keynote's "inflection"). */
  inflection?: number;
}

export interface Gradient {
  type: 'linear' | 'radial';
  stops: GradientStop[];
  /** Degrees clockwise from "pointing up", matching CSS `linear-gradient`. */
  angle: number;
  opacity?: number;
}

export type ImageFillTechnique = 'natural' | 'stretch' | 'tile' | 'fill' | 'fit';

export type Fill =
  | { type: 'color'; color: Color }
  | { type: 'gradient'; gradient: Gradient }
  | {
      type: 'image';
      resource: ResourceId | null;
      technique: ImageFillTechnique;
      tint?: Color;
      /** Tile size for `technique: 'tile'`. */
      size?: Size;
    };

export type LineCap = 'butt' | 'round' | 'square';
export type LineJoin = 'miter' | 'round' | 'bevel';

export interface Stroke {
  color: Color;
  width: number;
  cap: LineCap;
  join: LineJoin;
  /** Dash pattern in points; empty means solid. */
  dash: number[];
  dashOffset: number;
}

export interface Shadow {
  color: Color;
  /** Degrees clockwise from "pointing up". */
  angle: number;
  /** Distance from the element, in points. */
  offset: number;
  /** Blur radius in points. */
  radius: number;
  opacity: number;
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

export type TextAlign = 'left' | 'center' | 'right' | 'justify' | 'natural';
export type VerticalAlign = 'top' | 'middle' | 'bottom' | 'justify';
export type Underline = 'none' | 'single' | 'double' | 'wavy';
export type Strikethrough = 'none' | 'single' | 'double' | 'triple';
export type Capitalization = 'none' | 'uppercase' | 'smallCaps' | 'titleCase';
export type Superscript = 'none' | 'super' | 'sub';
export type WritingDirection = 'natural' | 'ltr' | 'rtl';

export interface CharacterStyle {
  /** PostScript name as stored, e.g. `"HelveticaNeue-Medium"`. */
  fontName: string;
  /** Family parsed out of the PostScript name, e.g. `"Helvetica Neue"`. */
  fontFamily: string;
  /** CSS numeric weight derived from the PostScript name. */
  fontWeight: number;
  fontStyle: 'normal' | 'italic';
  /** Points. */
  fontSize: number;
  /**
   * Solid glyph colour. When {@link fill} is set this is the closest single
   * colour, so renderers without gradient text still show something sensible.
   */
  color?: Color;
  /**
   * Non-solid glyph paint (Keynote can fill text with a gradient or an image).
   * Only present when it is not a plain colour.
   */
  fill?: Fill;
  backgroundColor?: Color;
  underline: Underline;
  underlineColor?: Color;
  strikethrough: Strikethrough;
  strikethroughColor?: Color;
  capitalization: Capitalization;
  superscript: Superscript;
  /** Letter spacing as a fraction of the font size. */
  tracking: number;
  /** Baseline offset as a fraction of the font size; positive raises. */
  baselineShift: number;
  /** Outline width as a fraction of the font size, when text is stroked. */
  outlineWidth?: number;
  outlineColor?: Color;
  shadow?: Shadow;
  strikethroughWidth?: number;
  language?: string;
}

export type LineSpacingMode = 'relative' | 'minimum' | 'exact' | 'maximum' | 'between';

export interface LineSpacing {
  mode: LineSpacingMode;
  /** Multiplier for `relative`, points for every other mode. */
  amount: number;
}

export type BulletKind = 'none' | 'text' | 'number' | 'image';

export interface Bullet {
  kind: BulletKind;
  /** Literal bullet glyph, for `kind: 'text'`. */
  text?: string;
  /** Rendered label for `kind: 'number'`, e.g. `"3."` or `"iv)"`. */
  label?: string;
  resource?: ResourceId | null;
  color?: Color;
  fontName?: string;
  /** Size relative to the paragraph's text, 1 = same size. */
  scale: number;
  /** Minimum distance from the label to the text, as a multiple of font size. */
  textIndent: number;
  /** Distance from the text box edge to the label, in points. */
  indent: number;
}

export interface Run {
  text: string;
  style: CharacterStyle;
  link?: string;
}

export interface Paragraph {
  runs: Run[];
  align: TextAlign;
  writingDirection: WritingDirection;
  firstLineIndent: number;
  leftIndent: number;
  rightIndent: number;
  spaceBefore: number;
  spaceAfter: number;
  lineSpacing: LineSpacing;
  /** Nesting depth for list items; 0 for top level. */
  listLevel: number;
  bullet?: Bullet;
  /** Style used when the paragraph has no runs (an empty line still has height). */
  defaultStyle: CharacterStyle;
}

export interface TextBlock {
  paragraphs: Paragraph[];
  verticalAlign: VerticalAlign;
  padding: Insets;
  columns?: { count: number; gap: number };
  /** Keynote's "shrink text to fit" — the renderer scales text down to fit. */
  shrinkToFit: boolean;
  /** Plain text with paragraph breaks, for search, a11y and thumbnails. */
  plainText: string;
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

export interface Frame extends Rect {
  /**
   * Keynote stores no width for text boxes that size themselves to their
   * content; `width` is 0 and the renderer must measure. Same for `height`.
   */
  autoWidth: boolean;
  autoHeight: boolean;
  /**
   * Which part of the box `y` locates. A box that grows vertically does so from
   * its vertical-alignment anchor, so a middle-aligned auto-height text box is
   * *centred* on `y` rather than starting there. Always `top` when `autoHeight`
   * is false.
   */
  anchorY: 'top' | 'center' | 'bottom';
  /** Horizontal counterpart of {@link anchorY}. Always `left` today. */
  anchorX: 'left' | 'center' | 'right';
}

/**
 * A shape outline. `path` covers the general case (Keynote bakes most shapes
 * into beziers); the parametric variants are kept when they survive a round
 * trip, because they scale without distortion.
 */
export type ShapePath =
  | { type: 'rect' }
  | { type: 'roundedRect'; radius: number }
  | { type: 'ellipse' }
  | { type: 'polygon'; sides: number }
  | { type: 'star'; points: number; innerRadius: number }
  | {
      type: 'path';
      /** SVG path data in the coordinate space described by `viewBox`. */
      d: string;
      /**
       * The region of path space that maps onto the element frame. Keynote
       * authors paths at an arbitrary scale, so this is the path's own bounding
       * box; stretch it to the frame (`preserveAspectRatio="none"`).
       */
      viewBox: Rect;
      /** True when the path is a single unclosed run — stroke only, never filled. */
      open: boolean;
    };

// ---------------------------------------------------------------------------
// Elements
// ---------------------------------------------------------------------------

export type ResourceId = string;

export type PlaceholderKind = 'title' | 'body' | 'slideNumber' | 'object' | 'generic';

export interface ElementBase {
  id: string;
  frame: Frame;
  /** Degrees clockwise about the frame centre. */
  rotation: number;
  flipH: boolean;
  flipV: boolean;
  opacity: number;
  shadow?: Shadow;
  hyperlink?: string;
  /** Accessibility description authored in Keynote. */
  description?: string;
  /** Set when the element came from a master/template slide. */
  fromMaster?: boolean;
  placeholder?: PlaceholderKind;
}

export interface GroupElement extends ElementBase {
  kind: 'group';
  children: Element[];
}

export interface ShapeElement extends ElementBase {
  kind: 'shape';
  path: ShapePath;
  fill?: Fill;
  stroke?: Stroke;
  text?: TextBlock;
  /** A shape whose only purpose is to hold text (no fill, no stroke). */
  isTextBox: boolean;
}

export interface ImageElement extends ElementBase {
  kind: 'image';
  resource: ResourceId | null;
  naturalSize: Size;
  /**
   * Where the full image sits relative to the element frame, when the image is
   * cropped/masked. Absent means "fill the frame exactly".
   */
  crop?: Rect;
  stroke?: Stroke;
  /** Non-destructive colour adjustments applied in Keynote. */
  adjustments?: ImageAdjustments;
}

export interface ImageAdjustments {
  exposure?: number;
  saturation?: number;
  contrast?: number;
  temperature?: number;
  tint?: number;
  gamma?: number;
}

export interface MovieElement extends ElementBase {
  kind: 'movie';
  resource: ResourceId | null;
  /** Still frame shown before playback. Always present for exported decks. */
  poster: ResourceId | null;
  remoteUrl?: string;
  loop: 'none' | 'repeat' | 'backAndForth';
  audioOnly: boolean;
  startTime?: number;
  endTime?: number;
  naturalSize?: Size;
  stroke?: Stroke;
}

export interface LineElement extends ElementBase {
  kind: 'line';
  /** Endpoints in the element's own coordinate space. */
  from: Point;
  to: Point;
  stroke?: Stroke;
}

export interface TableElement extends ElementBase {
  kind: 'table';
  rows: number;
  columns: number;
  /** Row-major cells; `null` for cells covered by a merge. */
  cells: (TableCell | null)[][];
  columnWidths: number[];
  rowHeights: number[];
  headerRows: number;
  headerColumns: number;
}

export interface TableCell {
  text?: TextBlock;
  fill?: Fill;
  rowSpan: number;
  columnSpan: number;
}

export interface ChartElement extends ElementBase {
  kind: 'chart';
  chartType: string;
  /** Series values as stored, so a host app can draw its own chart. */
  series: { name?: string; values: (number | null)[] }[];
  categories: string[];
  title?: TextBlock;
}

/**
 * An element the parser recognised but cannot express in the model yet. Kept in
 * the tree (with correct geometry) so renderers can draw a placeholder rather
 * than silently dropping content.
 */
export interface UnsupportedElement extends ElementBase {
  kind: 'unsupported';
  /** The iWork archive name, e.g. `"TSCH.ChartDrawableArchive"`. */
  archive: string;
}

export type Element =
  | GroupElement
  | ShapeElement
  | ImageElement
  | MovieElement
  | LineElement
  | TableElement
  | ChartElement
  | UnsupportedElement;

// ---------------------------------------------------------------------------
// Slides & deck
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Animation
// ---------------------------------------------------------------------------

/**
 * Direction an effect travels. Keynote stores this as an integer; the mapping
 * below is inferred and the raw value is kept alongside it.
 */
export type EffectDirection =
  | 'leftToRight'
  | 'rightToLeft'
  | 'topToBottom'
  | 'bottomToTop'
  | 'in'
  | 'out';

/** Effect families the renderer knows how to draw. */
export type TransitionKind =
  | 'none'
  | 'dissolve'
  | 'fadeThroughColor'
  | 'push'
  | 'moveIn'
  | 'reveal'
  | 'wipe'
  | 'iris'
  | 'scale'
  | 'flip'
  | 'cube'
  | 'magicMove'
  /** Recognised but not drawable; renderers should fall back to a dissolve. */
  | 'unsupported';

export interface SlideTransition {
  /** Raw Keynote effect id, e.g. `"apple:dissolve"`. */
  effect: string;
  kind: TransitionKind;
  /** Seconds. */
  duration: number;
  /** Seconds to wait before starting. */
  delay: number;
  /** True when the slide advances on its own rather than on a click. */
  automatic: boolean;
  direction: EffectDirection;
  /** Raw direction value, for renderers that want finer control. */
  directionValue: number;
  /** Colour for `fadeThroughColor`. */
  color?: Color;
  /** Magic Move: cross-fade objects with no counterpart on the other slide. */
  fadeUnmatched?: boolean;
}

export type BuildKind = 'in' | 'out' | 'action';

/**
 * When a build starts. Keynote also distinguishes "with previous" from "after
 * previous", but the archive only records a single automatic flag per chunk, so
 * automatic builds are treated as starting alongside the previous one.
 */
export type BuildTrigger = 'onClick' | 'automatic';

/** How a text build is delivered. */
export type BuildDelivery = 'object' | 'line' | 'word' | 'character';

export type DeliveryOrder =
  | 'forward'
  | 'backward'
  | 'fromCenter'
  | 'fromEdges'
  | 'random';

export type Easing = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut';

/**
 * A build's visual effect, normalised into something a renderer can execute.
 * `unsupported` keeps the original effect id so a host can special-case it.
 */
export type BuildAnimation =
  /** Instantaneous show/hide. */
  | { type: 'appear' }
  | { type: 'fade' }
  /** Slides in/out from `direction`, `distance` points away. */
  | { type: 'move'; distance: number }
  | { type: 'scale'; from: number }
  | { type: 'blur' }
  | { type: 'wipe' }
  /** Spins in/out about the frame centre. */
  | { type: 'pivot'; angle: number }
  /** Action: travel along a path, in points relative to the element's position. */
  | { type: 'motionPath'; d: string; bounds: Rect }
  /** Action: change opacity to `to`. */
  | { type: 'opacity'; to: number }
  /** Action: rotate by `angle` degrees. */
  | { type: 'rotate'; angle: number; clockwise: boolean }
  /** Action: scale by a factor. */
  | { type: 'resize'; to: number }
  /** Action: attention-grabbing effect that returns to the starting state. */
  | { type: 'emphasis'; effect: 'blink' | 'bounce' | 'jiggle' | 'pulse' | 'flip'; repeat: number }
  /** Start playing an audio or video element. */
  | { type: 'media' }
  | { type: 'unsupported' };

export interface Build {
  id: string;
  /** Element the build applies to. */
  elementId: string;
  kind: BuildKind;
  /** Raw Keynote effect id, e.g. `"apple:action-motion-path"`. */
  effect: string;
  animation: BuildAnimation;
  /** Seconds. */
  duration: number;
  /** Seconds after its stage begins. */
  delay: number;
  direction: EffectDirection;
  directionValue: number;
  easing: Easing;
  trigger: BuildTrigger;
  delivery: BuildDelivery;
  deliveryOrder: DeliveryOrder;
  /**
   * Click-advance stage this build belongs to, starting at 1. Stage 0 is the
   * slide's initial state, before any click.
   */
  stage: number;
  /** Position within the whole slide's build sequence. */
  order: number;
}

export interface Slide {
  id: string;
  /** Position in the deck, including skipped slides. */
  index: number;
  /** Number shown on the slide; skipped slides do not consume one. */
  number: number | null;
  skipped: boolean;
  name?: string;
  /** Slide background, resolved from the slide style or its master. */
  background?: Fill;
  /** Master/template content, drawn beneath `elements`. */
  masterElements: Element[];
  /** The slide's own content, in z-order (bottom first). */
  elements: Element[];
  /** Presenter notes. */
  notes?: TextBlock;
  /** Transition played when moving *to* this slide. */
  transition?: SlideTransition;
  /** Object builds, ordered by play sequence. */
  builds: Build[];
  /**
   * Number of clicks needed to play the slide out. 0 means the slide is fully
   * built as soon as it appears.
   */
  stageCount: number;
  /** Depth in Keynote's slide navigator (indented slides). */
  depth: number;
  /** Convenience: concatenated text of the slide, for search and outlines. */
  plainText: string;
}

export interface Resource {
  id: ResourceId;
  fileName: string;
  /**
   * The type the resource is *served* as. Keynote embeds formats browsers cannot
   * display (TIFF); those are transcoded on access, and this reports the result.
   */
  mimeType: string;
  /** The type as stored, when it differs from {@link mimeType}. */
  sourceMimeType?: string;
  /** Size of the stored payload in bytes, before any transcoding. */
  byteLength: number;
  /** False when the package references media it does not contain (iCloud decks). */
  available: boolean;
}

export interface DeckMetadata {
  /** iWork file format version, e.g. `"14.4.1"`. */
  fileFormatVersion: string;
  /** Theme name, when the document records one. */
  theme?: string;
  title?: string;
  authors?: string[];
  /** Archives encountered that the model does not cover, with counts. */
  unsupported: Record<string, number>;
}

export interface Deck {
  size: Size;
  slides: Slide[];
  resources: Record<ResourceId, Resource>;
  /** Every font family referenced by the deck, for preloading. */
  fonts: string[];
  metadata: DeckMetadata;
}
