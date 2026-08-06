import {
  colorToCss,
  type Element,
  type Frame,
  type ImageElement,
  type MovieElement,
  type ShapeElement,
  type UnsupportedElement,
} from '@dotkey/core';
import { useRef, type CSSProperties, type ReactNode } from 'react';

import { useElementAnimation, useMediaGate } from './animation/useElementAnimation.js';
import { useKeynoteContext } from './context.jsx';
import { dropShadowFilter } from './css.js';
import { ShapeView } from './ShapeView.jsx';
import { TextView } from './TextView.jsx';

export interface ElementViewProps {
  element: Element;
}

/** Render one element and, for groups, everything inside it. */
export function ElementView({ element }: ElementViewProps) {
  switch (element.kind) {
    case 'group':
      return (
        <Positioned element={element}>
          {element.children.map((child) => (
            <ElementView key={child.id} element={child} />
          ))}
        </Positioned>
      );
    case 'shape':
      return <ShapeElementView element={element} />;
    case 'image':
      return <ImageElementView element={element} />;
    case 'movie':
      return <MovieElementView element={element} />;
    case 'line':
    case 'table':
    case 'chart':
      return <UnsupportedView element={{ ...element, kind: 'unsupported', archive: element.kind }} />;
    case 'unsupported':
      return <UnsupportedView element={element} />;
  }
}

// ---------------------------------------------------------------------------
// Positioning
// ---------------------------------------------------------------------------

interface PositionedProps {
  element: Element;
  style?: CSSProperties;
  children?: ReactNode;
}

/**
 * Absolute placement shared by every element.
 *
 * Auto-sized axes deliberately leave `width`/`height` unset so the browser
 * measures the content, which is how Keynote's growing text boxes behave.
 * Rotation is about the frame centre, matching Keynote's stored geometry.
 */
function Positioned({ element, style, children }: PositionedProps) {
  const { frame } = element;
  const { playback } = useKeynoteContext();
  const ref = useRef<HTMLDivElement>(null);

  // A percentage translate resolves against the element's own measured size,
  // which is exactly what an auto-sized box needs: `top` marks the anchor point
  // and the box grows around it.
  const shiftX = frame.anchorX === 'center' ? '-50%' : frame.anchorX === 'right' ? '-100%' : '0';
  const shiftY = frame.anchorY === 'center' ? '-50%' : frame.anchorY === 'bottom' ? '-100%' : '0';
  const base: string[] = [];
  if (shiftX !== '0' || shiftY !== '0') base.push(`translate(${shiftX}, ${shiftY})`);
  if (element.rotation !== 0) base.push(`rotate(${element.rotation}deg)`);

  // Builds layer their own transform and opacity on top of the base transform;
  // the hook owns both so the settled state and the animation always agree.
  const animation = useElementAnimation(
    ref,
    playback?.byElement.get(element.id),
    playback,
    base.join(' '),
    element.opacity,
  );

  const css: CSSProperties = {
    position: 'absolute',
    left: frame.x,
    top: frame.y,
    ...(frame.autoWidth ? {} : { width: frame.width }),
    ...(frame.autoHeight ? {} : { height: frame.height }),
    transformOrigin: 'center center',
    ...animation.style,
    // Kept in the tree while hidden: unmounting would discard decoded images and
    // restart videos every time the user steps backwards.
    ...(animation.visible ? {} : { visibility: 'hidden' }),
    ...style,
  };

  const content = (
    <div
      ref={ref}
      style={css}
      data-keynote-id={element.id}
      data-keynote-kind={element.kind}
      {...(animation.visible ? {} : { 'aria-hidden': true })}
    >
      {children}
    </div>
  );

  if (!element.hyperlink) return content;
  return (
    <a
      href={element.hyperlink}
      style={{ display: 'contents' }}
      target="_blank"
      rel="noreferrer noopener"
    >
      {content}
    </a>
  );
}

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

function ShapeElementView({ element }: { element: ShapeElement }) {
  const hasOutline = element.fill !== undefined || element.stroke !== undefined;
  const filter = dropShadowFilter(element.shadow);

  return (
    <Positioned
      element={element}
      style={{
        ...(filter ? { filter } : {}),
        ...(element.text ? {} : { pointerEvents: 'none' }),
      }}
    >
      {hasOutline ? <ShapeView element={element} /> : null}
      {element.text ? (
        <TextView
          text={element.text}
          wrap={!element.frame.autoWidth}
          style={{ position: 'relative' }}
        />
      ) : null}
    </Positioned>
  );
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

function ImageElementView({ element }: { element: ImageElement }) {
  const { resolveUrl } = useKeynoteContext();
  const url = element.resource ? resolveUrl(element.resource) : undefined;
  const filter = [dropShadowFilter(element.shadow), adjustmentFilter(element)]
    .filter(Boolean)
    .join(' ');

  // `crop` describes where the whole picture sits relative to the visible box.
  const inner: CSSProperties = element.crop
    ? {
        position: 'absolute',
        left: element.crop.x,
        top: element.crop.y,
        width: element.crop.width,
        height: element.crop.height,
      }
    : { position: 'absolute', inset: 0, width: '100%', height: '100%' };

  return (
    <Positioned
      element={element}
      style={{
        overflow: element.crop ? 'hidden' : 'visible',
        ...(filter ? { filter } : {}),
        ...(element.stroke
          ? {
              outline: `${element.stroke.width}px solid ${colorToCss(element.stroke.color)}`,
              outlineOffset: -element.stroke.width / 2,
            }
          : {}),
      }}
    >
      {url ? (
        <img
          src={url}
          alt={element.description ?? ''}
          draggable={false}
          style={{ ...inner, objectFit: 'fill', display: 'block' }}
        />
      ) : (
        <MissingMedia frame={element.frame} label="image" />
      )}
    </Positioned>
  );
}

function adjustmentFilter(element: ImageElement): string | undefined {
  const adjustments = element.adjustments;
  if (!adjustments) return undefined;
  const parts: string[] = [];
  // Keynote's adjustments are -1..1 offsets around neutral.
  if (adjustments.saturation !== undefined) parts.push(`saturate(${1 + adjustments.saturation})`);
  if (adjustments.contrast !== undefined) parts.push(`contrast(${1 + adjustments.contrast})`);
  if (adjustments.exposure !== undefined) parts.push(`brightness(${1 + adjustments.exposure})`);
  return parts.length > 0 ? parts.join(' ') : undefined;
}

// ---------------------------------------------------------------------------
// Movies
// ---------------------------------------------------------------------------

function MovieElementView({ element }: { element: MovieElement }) {
  const { resolveUrl, deck, playMedia, playback } = useKeynoteContext();
  // A `movie-start` build holds the poster frame until its stage is reached.
  const started = useMediaGate(element.id, playback);
  const resource = element.resource ? deck.resources[element.resource] : undefined;
  const url = element.resource ? resolveUrl(element.resource) : undefined;
  const poster = element.poster ? resolveUrl(element.poster) : undefined;
  const fill: CSSProperties = { width: '100%', height: '100%', objectFit: 'fill', display: 'block' };

  // Animated GIFs are stored as movies but are really images.
  const isImage = resource?.mimeType.startsWith('image/') ?? false;

  return (
    <Positioned element={element} style={{ overflow: 'hidden' }}>
      {url && isImage ? (
        <img src={url} alt={element.description ?? ''} style={fill} />
      ) : url && playMedia && started ? (
        <video
          src={url}
          poster={poster}
          style={fill}
          loop={element.loop !== 'none'}
          muted
          playsInline
          autoPlay
          controls={false}
        />
      ) : poster ? (
        <img src={poster} alt={element.description ?? ''} style={fill} />
      ) : (
        <MissingMedia frame={element.frame} label="media" />
      )}
    </Positioned>
  );
}

// ---------------------------------------------------------------------------
// Fallbacks
// ---------------------------------------------------------------------------

function UnsupportedView({ element }: { element: UnsupportedElement }) {
  return (
    <Positioned element={element}>
      <MissingMedia frame={element.frame} label={element.archive} />
    </Positioned>
  );
}

/**
 * A visible, unobtrusive marker. Silently dropping content makes missing media
 * look like a layout bug; a dashed outline makes it obvious what is absent.
 */
function MissingMedia({ frame, label }: { frame: Frame; label: string }) {
  return (
    <div
      style={{
        width: frame.autoWidth ? 120 : '100%',
        height: frame.autoHeight ? 60 : '100%',
        border: '1px dashed rgba(127,127,127,0.6)',
        borderRadius: 2,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'rgba(127,127,127,0.9)',
        font: '12px ui-sans-serif, system-ui, sans-serif',
        overflow: 'hidden',
        boxSizing: 'border-box',
      }}
      title={label}
    >
      {label}
    </div>
  );
}
