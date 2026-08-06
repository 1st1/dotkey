import { toColor, type RawColor } from '../model/color.js';
import { parseFontName } from '../model/fonts.js';
import type {
  Bullet,
  Capitalization,
  CharacterStyle,
  Color,
  Fill,
  Insets,
  LineSpacing,
  LineSpacingMode,
  Paragraph,
  Run,
  Strikethrough,
  Superscript,
  TextAlign,
  TextBlock,
  Underline,
  VerticalAlign,
  WritingDirection,
} from '../model/types.js';
import type { Ref } from '../document/store.js';
import type { BuildContext } from './context.js';
import { toFill, toShadow } from './paint.js';
import { isBag, mergeProperties, resolveProperties, type PropertyBag } from './styles.js';

/** Unicode object-replacement character; marks an inline attachment. */
const ATTACHMENT = '￼';
/** Keynote writes a line separator for shift-return soft breaks. */
const LINE_SEPARATOR = ' ';

interface AttributeEntry {
  character_index?: number;
  object?: Ref | null;
}

interface ParaDataEntry {
  character_index?: number;
  first?: number;
  second?: number;
}

interface RawStorage {
  text?: string[];
  table_para_style?: { entries?: AttributeEntry[] };
  table_char_style?: { entries?: AttributeEntry[] };
  table_list_style?: { entries?: AttributeEntry[] };
  table_para_data?: { entries?: ParaDataEntry[] };
  table_attachment?: { entries?: AttributeEntry[] };
  table_smartfield?: { entries?: AttributeEntry[] };
}

const TEXT_ALIGN: Record<string, TextAlign> = {
  TATvalue0: 'left',
  TATvalue1: 'right',
  TATvalue2: 'center',
  TATvalue3: 'justify',
  TATvalue4: 'natural',
};

const VERTICAL_ALIGN: Record<string, VerticalAlign> = {
  kFrameAlignTop: 'top',
  kFrameAlignMiddle: 'middle',
  kFrameAlignBottom: 'bottom',
  kFrameAlignJustify: 'justify',
};

const UNDERLINE: Record<string, Underline> = {
  kNoUnderline: 'none',
  kSingleUnderline: 'single',
  kDoubleUnderline: 'double',
  kWavyUnderline: 'wavy',
};

const STRIKETHROUGH: Record<string, Strikethrough> = {
  kNoStrikethru: 'none',
  kSingleStrikethru: 'single',
  kDoubleStrikethru: 'double',
  kTripleStrikethru: 'triple',
};

const CAPITALIZATION: Record<string, Capitalization> = {
  kNoCaps: 'none',
  kAllCaps: 'uppercase',
  kSmallCaps: 'smallCaps',
  kTitled: 'titleCase',
};

const SUPERSCRIPT: Record<string, Superscript> = {
  kNoScript: 'none',
  kSuperscript: 'super',
  kSubscript: 'sub',
};

const LINE_SPACING_MODE: Record<string, LineSpacingMode> = {
  kRelativeLineSpacing: 'relative',
  kMinimumLineSpacing: 'minimum',
  kExactLineSpacing: 'exact',
  kMaximumLineSpacing: 'maximum',
  kSpaceBetweenLineSpacing: 'between',
};

const WRITING_DIRECTION: Record<string, WritingDirection> = {
  kWritingDirectionNatural: 'natural',
  kWritingDirectionLeftToRight: 'ltr',
  kWritingDirectionRightToLeft: 'rtl',
};

const DEFAULT_PADDING: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

export interface TextFrameOptions {
  /** Resolved `shape_properties` for the containing shape. */
  shapeProperties?: PropertyBag;
}

/**
 * Turn a `TSWP.StorageArchive` into a `TextBlock`.
 *
 * Text is stored as one flat string plus parallel "attribute tables" — sorted
 * lists of `(characterIndex, styleRef)` pairs. Paragraph boundaries come from
 * the paragraph-style table, character runs from the character-style table, and
 * list nesting from the paragraph-data table.
 */
export function buildTextBlock(
  context: BuildContext,
  storageRef: Ref | null | undefined,
  options: TextFrameOptions = {},
): TextBlock | undefined {
  const storage = context.store.resolve<RawStorage>(storageRef);
  if (!storage) return undefined;

  const text = (storage.text ?? []).join('');
  const shapeProperties = options.shapeProperties ?? {};

  // The text box's default paragraph style, used where the storage has none.
  const frameParagraphStyleRef = asRef(shapeProperties['paragraph_style']);
  const frameCharProps = resolveProperties(
    context.store,
    frameParagraphStyleRef,
    'char_properties',
  );
  const frameParaProps = resolveProperties(
    context.store,
    frameParagraphStyleRef,
    'para_properties',
  );

  const paraEntries = sorted(storage.table_para_style?.entries);
  const charEntries = sorted(storage.table_char_style?.entries);
  const listEntries = sorted(storage.table_list_style?.entries);
  const paraData = sortedData(storage.table_para_data?.entries);
  const attachments = sorted(storage.table_attachment?.entries);

  const bounds = paragraphBounds(text, paraEntries);
  const paragraphs: Paragraph[] = [];
  const numbering = new ListNumbering();

  let lastParaStyle: Ref | null | undefined;
  let lastListStyle: Ref | null | undefined;

  for (const [index, bound] of bounds.entries()) {
    const { start, end } = bound;

    // A null style at a paragraph start means "carry the previous one forward".
    const paraStyleRef = inheritedAttributeAt(paraEntries, start, lastParaStyle);
    lastParaStyle = paraStyleRef ?? lastParaStyle;
    const listStyleRef = inheritedAttributeAt(listEntries, start, lastListStyle);
    lastListStyle = listStyleRef ?? lastListStyle;

    const paraProps = mergeProperties(
      frameParaProps,
      resolveProperties(context.store, paraStyleRef, 'para_properties'),
    );
    const paraCharProps = mergeProperties(
      frameCharProps,
      resolveProperties(context.store, paraStyleRef, 'char_properties'),
    );

    const level = levelAt(paraData, start);
    const runs = buildRuns(
      context,
      text,
      start,
      end,
      charEntries,
      attachments,
      paraCharProps,
      index,
    );

    const defaultStyle = toCharacterStyle(context, paraCharProps);
    const listStyle =
      listStyleRef ?
        context.store.resolve<PropertyBag>(listStyleRef)
      : paraProps['list_style'] !== undefined ?
        context.store.resolve<PropertyBag>(asRef(paraProps['list_style']))
      : undefined;

    const bullet = buildBullet(context, listStyle, level, numbering, defaultStyle);

    paragraphs.push({
      runs,
      align: TEXT_ALIGN[String(paraProps['alignment'] ?? '')] ?? 'natural',
      writingDirection:
        WRITING_DIRECTION[String(paraProps['writing_direction'] ?? '')] ?? 'natural',
      firstLineIndent: numberOr(paraProps['first_line_indent'], 0),
      leftIndent: numberOr(paraProps['left_indent'], 0),
      rightIndent: numberOr(paraProps['right_indent'], 0),
      // Keynote suppresses paragraph spacing at the edges of a text frame, so
      // a "space before" of 45pt does not push the first line down.
      spaceBefore: index === 0 ? 0 : numberOr(paraProps['space_before'], 0),
      spaceAfter: index === bounds.length - 1 ? 0 : numberOr(paraProps['space_after'], 0),
      lineSpacing: toLineSpacing(paraProps['line_spacing']),
      listLevel: level,
      ...(bullet ? { bullet } : {}),
      defaultStyle,
    });
  }

  const padding = toInsets(shapeProperties['padding']);
  const columns = toColumns(shapeProperties['columns']);

  return {
    paragraphs,
    verticalAlign: VERTICAL_ALIGN[String(shapeProperties['vertical_alignment'] ?? '')] ?? 'top',
    padding,
    ...(columns ? { columns } : {}),
    shrinkToFit: shapeProperties['shrink_to_fit'] === true,
    plainText: paragraphs.map((p) => p.runs.map((r) => r.text).join('')).join('\n'),
  };
}

// ---------------------------------------------------------------------------
// Paragraph and run slicing
// ---------------------------------------------------------------------------

interface Bound {
  start: number;
  end: number;
}

/**
 * Paragraph starts come from the paragraph-style table. Fall back to splitting
 * on newlines when the table is missing or disagrees with the text length.
 */
function paragraphBounds(text: string, entries: AttributeEntry[]): Bound[] {
  const starts =
    entries.length > 0 ?
      entries.map((entry) => entry.character_index ?? 0)
    : newlineStarts(text);

  const bounds: Bound[] = [];
  for (const [index, start] of starts.entries()) {
    const rawEnd = starts[index + 1] ?? text.length;
    const clampedStart = Math.min(start, text.length);
    let end = Math.min(rawEnd, text.length);
    // The paragraph separator belongs to the break, not to the text.
    if (end > clampedStart && text[end - 1] === '\n') end -= 1;
    bounds.push({ start: clampedStart, end: Math.max(clampedStart, end) });
  }

  if (bounds.length === 0) bounds.push({ start: 0, end: text.length });
  return bounds;
}

function newlineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n' && i + 1 <= text.length) starts.push(i + 1);
  }
  // A trailing newline does not open a new paragraph.
  if (starts.length > 1 && starts[starts.length - 1] === text.length) starts.pop();
  return starts;
}

function buildRuns(
  context: BuildContext,
  text: string,
  start: number,
  end: number,
  charEntries: AttributeEntry[],
  attachments: AttributeEntry[],
  paragraphProps: PropertyBag,
  paragraphIndex: number,
): Run[] {
  if (end <= start) return [];

  // Every character-style change inside the paragraph opens a new run.
  const cuts = new Set<number>([start, end]);
  for (const entry of charEntries) {
    const index = entry.character_index ?? 0;
    if (index > start && index < end) cuts.add(index);
  }
  const ordered = [...cuts].sort((a, b) => a - b);

  const runs: Run[] = [];
  for (let i = 0; i < ordered.length - 1; i++) {
    const from = ordered[i]!;
    const to = ordered[i + 1]!;
    const styleRef = attributeAt(charEntries, from);
    const props = mergeProperties(
      paragraphProps,
      resolveProperties(context.store, styleRef, 'char_properties'),
    );
    const style = toCharacterStyle(context, props);

    const raw = text.slice(from, to);
    const resolved = resolveAttachments(context, raw, from, attachments, paragraphIndex);
    if (resolved.length === 0) continue;

    const previous = runs[runs.length - 1];
    // Merge adjacent runs that ended up with identical styling.
    if (previous && sameStyle(previous.style, style)) previous.text += resolved;
    else runs.push({ text: resolved, style });
  }

  return runs;
}

/**
 * Replace inline attachments. Slide numbers and other number attachments carry
 * a rendered string; anything else is dropped so a stray U+FFFC never reaches
 * the output.
 */
function resolveAttachments(
  context: BuildContext,
  text: string,
  offset: number,
  attachments: AttributeEntry[],
  paragraphIndex: number,
): string {
  if (!text.includes(ATTACHMENT)) return text.replaceAll(LINE_SEPARATOR, '\n');

  let out = '';
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (char !== ATTACHMENT) {
      out += char === LINE_SEPARATOR ? '\n' : char;
      continue;
    }
    const entry = attachments.find((candidate) => candidate.character_index === offset + i);
    const attachment = context.store.deref(entry?.object);
    if (attachment?.name === 'TSWP.NumberAttachmentArchive') {
      const value = (attachment.value as { string_value?: string } | undefined)?.string_value;
      out += value ?? String(paragraphIndex + 1);
    }
    // Drawable attachments are extracted as their own elements elsewhere.
  }
  return out;
}

function sameStyle(a: CharacterStyle, b: CharacterStyle): boolean {
  return (
    a.fontName === b.fontName &&
    a.fontSize === b.fontSize &&
    a.fontWeight === b.fontWeight &&
    a.fontStyle === b.fontStyle &&
    a.underline === b.underline &&
    a.strikethrough === b.strikethrough &&
    a.capitalization === b.capitalization &&
    a.superscript === b.superscript &&
    a.tracking === b.tracking &&
    a.baselineShift === b.baselineShift &&
    sameColor(a.color, b.color) &&
    sameColor(a.backgroundColor, b.backgroundColor)
  );
}

function sameColor(a: CharacterStyle['color'], b: CharacterStyle['color']): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a && a.space === b.space;
}

// ---------------------------------------------------------------------------
// Style conversion
// ---------------------------------------------------------------------------

export function toCharacterStyle(
  context: BuildContext,
  props: PropertyBag,
): CharacterStyle {
  const fontName = typeof props['font_name'] === 'string' ? props['font_name'] : 'Helvetica';
  context.font(fontName);
  const parsed = parseFontName(fontName);

  // `bold` / `italic` are synthetic toggles layered on top of the named face.
  const weight = props['bold'] === true ? Math.max(parsed.weight, 700) : parsed.weight;
  const style = props['italic'] === true ? 'italic' : parsed.style;

  // Text can be painted with a gradient or an image, not just a colour.
  const textFill = toFill(context, props['tsd_fill']);
  const color =
    textFill?.type === 'color' ? textFill.color
    : (toColor(props['font_color'] as RawColor | undefined) ?? dominantColor(textFill));
  const fill = textFill && textFill.type !== 'color' ? textFill : undefined;

  const strokeWidth = numberOr(props['outline'], 0);
  const shadow = toShadow(props['shadow']);

  return {
    fontName,
    fontFamily: parsed.family,
    fontWeight: weight,
    fontStyle: style,
    fontSize: numberOr(props['font_size'], 12),
    ...(color ? { color } : {}),
    ...(fill ? { fill } : {}),
    ...(toColor(props['background_color'] as RawColor | undefined)
      ? { backgroundColor: toColor(props['background_color'] as RawColor | undefined)! }
      : {}),
    underline: UNDERLINE[String(props['underline'] ?? '')] ?? 'none',
    ...(toColor(props['underline_color'] as RawColor | undefined)
      ? { underlineColor: toColor(props['underline_color'] as RawColor | undefined)! }
      : {}),
    strikethrough: STRIKETHROUGH[String(props['strikethru'] ?? '')] ?? 'none',
    ...(toColor(props['strikethru_color'] as RawColor | undefined)
      ? { strikethroughColor: toColor(props['strikethru_color'] as RawColor | undefined)! }
      : {}),
    capitalization: CAPITALIZATION[String(props['capitalization'] ?? '')] ?? 'none',
    superscript: SUPERSCRIPT[String(props['superscript'] ?? '')] ?? 'none',
    tracking: numberOr(props['tracking'], 0),
    baselineShift: numberOr(props['baseline_shift'], 0),
    ...(strokeWidth !== 0 ? { outlineWidth: strokeWidth } : {}),
    ...(strokeWidth !== 0 && toColor(props['outline_color'] as RawColor | undefined)
      ? { outlineColor: toColor(props['outline_color'] as RawColor | undefined)! }
      : {}),
    ...(shadow ? { shadow } : {}),
    ...(typeof props['language'] === 'string' ? { language: props['language'] } : {}),
  };
}

/** First gradient stop, used as the fallback colour for non-solid text fills. */
function dominantColor(fill: Fill | undefined): Color | undefined {
  if (fill?.type === 'gradient') return fill.gradient.stops[0]?.color;
  if (fill?.type === 'image') return fill.tint;
  return undefined;
}

function toLineSpacing(raw: unknown): LineSpacing {
  if (!isBag(raw)) return { mode: 'relative', amount: 1 };
  const mode = LINE_SPACING_MODE[String(raw['mode'] ?? '')] ?? 'relative';
  const amount = numberOr(raw['amount'], mode === 'relative' ? 1 : 0);
  return { mode, amount };
}

function toInsets(raw: unknown): Insets {
  if (!isBag(raw)) return { ...DEFAULT_PADDING };
  return {
    top: numberOr(raw['top'], 0),
    right: numberOr(raw['right'], 0),
    bottom: numberOr(raw['bottom'], 0),
    left: numberOr(raw['left'], 0),
  };
}

function toColumns(raw: unknown): { count: number; gap: number } | undefined {
  if (!isBag(raw)) return undefined;
  const equal = raw['equal_columns'];
  if (!isBag(equal)) return undefined;
  const count = numberOr(equal['count'], 1);
  if (count <= 1) return undefined;
  return { count, gap: numberOr(equal['gap'], 0) };
}

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

const ROMAN: ReadonlyArray<readonly [number, string]> = [
  [1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'],
  [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i'],
];

/** Tracks per-level counters so numbered lists restart correctly on outdent. */
class ListNumbering {
  #counters: number[] = [];

  next(level: number): number {
    this.#counters.length = Math.max(this.#counters.length, level + 1);
    for (let i = level + 1; i < this.#counters.length; i++) this.#counters[i] = 0;
    this.#counters[level] = (this.#counters[level] ?? 0) + 1;
    return this.#counters[level]!;
  }

  reset(level: number): void {
    for (let i = level; i < this.#counters.length; i++) this.#counters[i] = 0;
  }
}

function buildBullet(
  context: BuildContext,
  listStyle: PropertyBag | undefined,
  level: number,
  numbering: ListNumbering,
  paragraphStyle: CharacterStyle,
): Bullet | undefined {
  if (!listStyle) {
    numbering.reset(level);
    return undefined;
  }

  const labelType = at(listStyle['label_types'], level) ?? 'kNone';
  if (labelType === 'kNone') {
    numbering.reset(level);
    return undefined;
  }

  const geometry = at<PropertyBag>(listStyle['geometries'], level);
  const scale = numberOr(geometry?.['scale'], 1);
  const textIndent = numberOr(at<number>(listStyle['text_indents'], level), 0);
  const indent = numberOr(at<number>(listStyle['indents'], level), 0);
  const color = toColor(listStyle['font_color'] as RawColor | undefined) ?? paragraphStyle.color;
  const fontName =
    typeof listStyle['font_name'] === 'string' ? listStyle['font_name'] : paragraphStyle.fontName;
  context.font(fontName);

  const base: Bullet = {
    kind: 'none',
    scale,
    textIndent,
    indent,
    ...(color ? { color } : {}),
    fontName,
  };

  switch (labelType) {
    case 'kString': {
      numbering.reset(level);
      const text = at<string>(listStyle['strings'], level) ?? '•';
      return { ...base, kind: 'text', text };
    }
    case 'kImage': {
      numbering.reset(level);
      const image = at<PropertyBag>(listStyle['images'], level);
      const resource = context.resource(asRef(image?.['image']));
      return { ...base, kind: 'image', resource };
    }
    case 'kNumber': {
      const value = numbering.next(level);
      const numberType = at<string>(listStyle['number_types'], level) ?? 'kNumericDecimal';
      return { ...base, kind: 'number', label: formatNumber(value, numberType) };
    }
    default:
      numbering.reset(level);
      return undefined;
  }
}

function formatNumber(value: number, numberType: string): string {
  const body = numberBody(value, numberType);
  if (numberType.includes('DoubleParen')) return `(${body})`;
  if (numberType.includes('RightParen')) return `${body})`;
  return `${body}.`;
}

function numberBody(value: number, numberType: string): string {
  if (numberType.startsWith('kRomanUpper')) return toRoman(value).toUpperCase();
  if (numberType.startsWith('kRomanLower')) return toRoman(value);
  if (numberType.startsWith('kAlphaUpper')) return toAlpha(value).toUpperCase();
  if (numberType.startsWith('kAlphaLower')) return toAlpha(value);
  return String(value);
}

function toRoman(value: number): string {
  let remaining = Math.max(1, Math.floor(value));
  let out = '';
  for (const [amount, glyph] of ROMAN) {
    while (remaining >= amount) {
      out += glyph;
      remaining -= amount;
    }
  }
  return out;
}

function toAlpha(value: number): string {
  let remaining = Math.max(1, Math.floor(value));
  let out = '';
  while (remaining > 0) {
    remaining -= 1;
    out = String.fromCharCode(97 + (remaining % 26)) + out;
    remaining = Math.floor(remaining / 26);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Attribute table helpers
// ---------------------------------------------------------------------------

function sorted(entries: AttributeEntry[] | undefined): AttributeEntry[] {
  return [...(entries ?? [])].sort(
    (a, b) => (a.character_index ?? 0) - (b.character_index ?? 0),
  );
}

function sortedData(entries: ParaDataEntry[] | undefined): ParaDataEntry[] {
  return [...(entries ?? [])].sort(
    (a, b) => (a.character_index ?? 0) - (b.character_index ?? 0),
  );
}

/**
 * The value in effect at `index`: whatever the last entry at or before it says.
 *
 * An entry with a null object *clears* the attribute for the range it opens —
 * that is how Keynote spells "this run has no character override, use the
 * paragraph style". Carrying the previous value forward instead makes a coloured
 * word bleed across the rest of the line.
 */
function attributeAt(entries: AttributeEntry[], index: number): Ref | undefined {
  let found: Ref | undefined;
  for (const entry of entries) {
    const at = entry.character_index ?? 0;
    if (at > index) break;
    found = entry.object ?? undefined;
  }
  return found;
}

/**
 * Same lookup, but a null object means "unchanged". Paragraph and list styles
 * work this way: the table marks every paragraph start, and only the ones whose
 * style actually differs carry an object.
 */
function inheritedAttributeAt(
  entries: AttributeEntry[],
  index: number,
  fallback: Ref | null | undefined,
): Ref | null | undefined {
  let found: Ref | null | undefined = fallback;
  for (const entry of entries) {
    const at = entry.character_index ?? 0;
    if (at > index) break;
    if (entry.object) found = entry.object;
  }
  return found;
}

function levelAt(entries: ParaDataEntry[], index: number): number {
  let level = 0;
  for (const entry of entries) {
    if ((entry.character_index ?? 0) > index) break;
    level = entry.first ?? 0;
  }
  return level;
}

function at<T>(value: unknown, index: number): T | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  // iWork list styles define fewer levels than the maximum nesting depth; the
  // deepest defined level applies to everything below it.
  return (value[Math.min(index, value.length - 1)] ?? undefined) as T | undefined;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asRef(value: unknown): Ref | undefined {
  return isBag(value) && typeof value['identifier'] === 'number' ? (value as Ref) : undefined;
}
