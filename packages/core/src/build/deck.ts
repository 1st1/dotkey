import type { KeynoteBundle } from '../document/bundle.js';
import type { ArchiveObject, Ref } from '../document/store.js';
import type { Deck, Element, Fill, Size, Slide } from '../model/types.js';
import { toBuilds, toTransition } from './animation.js';
import { BuildContext } from './context.js';
import { buildElement, elementIsVisible } from './elements.js';
import { toFill } from './paint.js';
import { isBag, resolveProperties, type PropertyBag } from './styles.js';
import { buildTextBlock } from './text.js';

const DEFAULT_SIZE: Size = { width: 1024, height: 768 };

interface RawShow {
  theme?: Ref;
  slideTree?: { slides?: Ref[] };
  size?: { width?: number; height?: number };
  stylesheet?: Ref;
}

interface RawSlideNode {
  slide?: Ref;
  isSkipped?: boolean;
  depth?: number;
  hasNote?: boolean;
}

interface RawSlide {
  style?: Ref;
  owned_drawables?: Ref[];
  drawables_z_order?: Ref[];
  template_slide?: Ref;
  note?: Ref;
  name?: string;
  transition?: unknown;
  builds?: Ref[];
  buildChunks?: Ref[];
  slide_objects_layer_with_template?: boolean;
}

export interface BuildDeckOptions {
  /** Include master/template content on each slide. Default `true`. */
  includeMasters?: boolean;
  /** Include presenter notes. Default `true`. */
  includeNotes?: boolean;
  /** Include slides marked "skip" in Keynote. Default `true` (flagged, not dropped). */
  includeSkipped?: boolean;
  /**
   * Extract transitions and object builds. Default `true`. Turn it off to get a
   * fully-built static model with no animation metadata.
   */
  includeAnimation?: boolean;
}

/** Build the document model from a parsed package. */
export function buildDeck(bundle: KeynoteBundle, options: BuildDeckOptions = {}): Deck {
  const includeMasters = options.includeMasters ?? true;
  const includeNotes = options.includeNotes ?? true;
  const includeSkipped = options.includeSkipped ?? true;
  const includeAnimation = options.includeAnimation ?? true;

  const context = new BuildContext(bundle);
  const store = bundle.store;

  const document = store.first('KN.DocumentArchive');
  const show = store.resolve<RawShow>((document?.value as PropertyBag | undefined)?.['show'] as Ref);

  const size: Size = {
    width: show?.size?.width ?? DEFAULT_SIZE.width,
    height: show?.size?.height ?? DEFAULT_SIZE.height,
  };

  const slides: Slide[] = [];
  let visibleNumber = 0;

  for (const [index, nodeRef] of (show?.slideTree?.slides ?? []).entries()) {
    const node = store.resolve<RawSlideNode>(nodeRef);
    if (!node) continue;
    const slideObject = store.deref(node.slide);
    if (!slideObject?.value) continue;

    const skipped = node.isSkipped === true;
    if (skipped && !includeSkipped) continue;
    if (!skipped) visibleNumber += 1;

    slides.push(
      buildSlide(context, {
        object: slideObject,
        index,
        number: skipped ? null : visibleNumber,
        skipped,
        depth: node.depth ?? 1,
        includeMasters,
        includeNotes,
        includeAnimation,
      }),
    );
  }

  const themeObject = store.deref(show?.theme);
  const themeName = themeIdentifier(themeObject);

  return {
    size,
    slides,
    resources: Object.fromEntries(context.resources),
    fonts: [...context.fonts].sort(),
    metadata: {
      fileFormatVersion: bundle.fileFormatVersion,
      ...(themeName ? { theme: themeName } : {}),
      unsupported: context.unsupported,
    },
  };
}

interface SlideParams {
  object: ArchiveObject;
  index: number;
  number: number | null;
  skipped: boolean;
  depth: number;
  includeMasters: boolean;
  includeNotes: boolean;
  includeAnimation: boolean;
}

function buildSlide(context: BuildContext, params: SlideParams): Slide {
  const { object, index, number, skipped, depth } = params;
  const value = object.value as PropertyBag;
  const slide = value as RawSlide;
  const store = context.store;

  const templateObject = store.deref(slide.template_slide);
  const template = templateObject?.value as RawSlide | undefined;

  // A slide inherits its background from its template unless it overrides it.
  const background =
    slideBackground(context, slide.style) ??
    (template ? slideBackground(context, template.style) : undefined);

  const masterElements =
    params.includeMasters && template ? buildMasterElements(context, template) : [];

  const elements = drawableRefs(slide)
    .map((ref) => buildElement(context, ref))
    .filter((element): element is Element => element !== undefined && elementIsVisible(element));

  const notes =
    params.includeNotes ? buildNotes(context, slide.note) : undefined;

  const transition = params.includeAnimation ? toTransition(slide.transition) : undefined;
  const { builds, stageCount } =
    params.includeAnimation ?
      toBuilds(context, slide.builds, slide.buildChunks)
    : { builds: [], stageCount: 0 };

  // A build can only animate something that survived into the model.
  const present = new Set<string>();
  const collectIds = (list: readonly Element[]) => {
    for (const element of list) {
      present.add(element.id);
      if (element.kind === 'group') collectIds(element.children);
    }
  };
  collectIds(elements);

  return {
    id: String(object.id),
    index,
    number,
    skipped,
    ...(slide.name ? { name: slide.name } : {}),
    ...(background ? { background } : {}),
    masterElements,
    elements,
    ...(notes ? { notes } : {}),
    ...(transition ? { transition } : {}),
    builds: builds.filter((build) => present.has(build.elementId)),
    stageCount,
    depth,
    plainText: collectText(elements),
  };
}

/**
 * Template content sits beneath the slide. Placeholders are skipped: they exist
 * to position the slide's own title/body, and drawing them would paint the
 * template's prompt text ("Title Text") onto every slide.
 */
function buildMasterElements(context: BuildContext, template: RawSlide): Element[] {
  const out: Element[] = [];
  for (const ref of drawableRefs(template)) {
    if (context.store.typeName(ref) === 'KN.PlaceholderArchive') continue;
    const element = buildElement(context, ref, { fromMaster: true });
    if (element && elementIsVisible(element)) out.push(element);
  }
  return out;
}

/** Prefer the explicit z-order when present; `owned_drawables` is unordered. */
function drawableRefs(slide: RawSlide | undefined): Ref[] {
  if (!slide) return [];
  const ordered = slide.drawables_z_order ?? [];
  const owned = slide.owned_drawables ?? [];
  if (ordered.length >= owned.length) return ordered;

  // Keep anything the z-order list forgot, so content is never lost.
  const seen = new Set(ordered.map((ref) => ref.identifier));
  return [...ordered, ...owned.filter((ref) => !seen.has(ref.identifier))];
}

function slideBackground(context: BuildContext, styleRef: Ref | undefined): Fill | undefined {
  if (!styleRef) return undefined;
  const properties = resolveProperties(context.store, styleRef, 'slide_properties');
  return toFill(context, properties['fill']);
}

function buildNotes(context: BuildContext, noteRef: Ref | undefined) {
  const note = context.store.resolveAs<{ containedStorage?: Ref }>(noteRef, 'KN.NoteArchive');
  const text = buildTextBlock(context, note?.containedStorage);
  return text && text.plainText.trim().length > 0 ? text : undefined;
}

function themeIdentifier(theme: ArchiveObject | undefined): string | undefined {
  if (!theme?.value) return undefined;
  let current: PropertyBag | undefined = theme.value as PropertyBag;
  for (let i = 0; i < 8 && current; i++) {
    const identifier = current['theme_identifier'];
    if (typeof identifier === 'string' && identifier) return identifier;
    const next: unknown = current['super'];
    current = isBag(next) ? next : undefined;
  }
  return undefined;
}

function collectText(elements: readonly Element[]): string {
  const parts: string[] = [];
  const walk = (list: readonly Element[]) => {
    for (const element of list) {
      if (element.kind === 'group') walk(element.children);
      else if (element.kind === 'shape' && element.text) {
        const text = element.text.plainText.trim();
        if (text) parts.push(text);
      }
    }
  };
  walk(elements);
  return parts.join('\n');
}
