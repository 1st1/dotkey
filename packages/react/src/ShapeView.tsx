import {
  colorToCss,
  expandGradientStops,
  type Rect,
  type ShapeElement,
  type ShapePath,
} from '@dotkey/core';
import { useId, type CSSProperties, type ReactElement } from 'react';

import { useKeynoteContext } from './context.jsx';
import { gradientCss, strokeAttributes } from './css.js';

export interface ShapeViewProps {
  element: ShapeElement;
}

/**
 * Draws the shape outline as SVG behind the element's text.
 *
 * The SVG stretches to the element box with `preserveAspectRatio="none"`,
 * because Keynote paths are authored in their own coordinate space and resized
 * freely. `vector-effect="non-scaling-stroke"` keeps the border width honest
 * under that stretch.
 */
export function ShapeView({ element }: ShapeViewProps) {
  const { resolveUrl } = useKeynoteContext();
  const gradientId = useId();
  const patternId = useId();

  const { fill, stroke, path } = element;
  if (!fill && !stroke) return null;

  const viewBox = pathViewBox(path);
  const strokeProps = strokeAttributes(stroke);

  let fillValue = 'none';
  let defs: ReactElement | null = null;

  if (fill?.type === 'color') {
    fillValue = colorToCss(fill.color);
  } else if (fill?.type === 'gradient') {
    fillValue = `url(#${gradientId})`;
    const { x1, y1, x2, y2 } = gradientVector(fill.gradient.angle);
    // `stop-opacity` is separate from `stop-color` in SVG: an rgba() stop colour
    // is not reliably honoured, and a gradient fading to transparent — which is
    // how Keynote builds its scrims — depends on it entirely.
    const stops = expandGradientStops(fill.gradient).map((stop, index) => (
      <stop
        key={index}
        offset={stop.offset}
        stopColor={colorToCss({ ...stop.color, a: 1 })}
        stopOpacity={stop.color.a}
      />
    ));
    defs =
      fill.gradient.type === 'radial' ? (
        <radialGradient id={gradientId}>{stops}</radialGradient>
      ) : (
        <linearGradient id={gradientId} x1={x1} y1={y1} x2={x2} y2={y2}>
          {stops}
        </linearGradient>
      );
  } else if (fill?.type === 'image') {
    const url = fill.resource ? resolveUrl(fill.resource) : undefined;
    if (url) {
      fillValue = `url(#${patternId})`;
      defs = (
        <pattern id={patternId} width="1" height="1" patternContentUnits="objectBoundingBox">
          <image
            href={url}
            width="1"
            height="1"
            preserveAspectRatio={
              fill.technique === 'fit'
                ? 'xMidYMid meet'
                : fill.technique === 'stretch'
                  ? 'none'
                  : 'xMidYMid slice'
            }
          />
        </pattern>
      );
    } else if (fill.tint) {
      fillValue = colorToCss(fill.tint);
    }
  }

  const svgStyle: CSSProperties = {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    // Rules and dividers are stored as shapes with a zero-height frame. An SVG
    // viewport with no area paints nothing, so keep one pixel of it alive and
    // let the stroke overflow.
    minWidth: 1,
    minHeight: 1,
    overflow: 'visible',
    pointerEvents: 'none',
  };

  return (
    <svg
      style={svgStyle}
      viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
      preserveAspectRatio="none"
      aria-hidden
    >
      {defs ? <defs>{defs}</defs> : null}
      <ShapeGeometry
        path={path}
        viewBox={viewBox}
        fill={fillValue}
        strokeProps={strokeProps}
        flipH={element.flipH}
        flipV={element.flipV}
      />
    </svg>
  );
}

interface ShapeGeometryProps {
  path: ShapePath;
  viewBox: Rect;
  fill: string;
  strokeProps: ReturnType<typeof strokeAttributes>;
  flipH: boolean;
  flipV: boolean;
}

function ShapeGeometry({ path, viewBox, fill, strokeProps, flipH, flipV }: ShapeGeometryProps) {
  const shared = {
    fill,
    ...strokeProps,
    vectorEffect: 'non-scaling-stroke' as const,
    ...(flipH || flipV
      ? {
          transform:
            `translate(${flipH ? 2 * viewBox.x + viewBox.width : 0} ` +
            `${flipV ? 2 * viewBox.y + viewBox.height : 0}) ` +
            `scale(${flipH ? -1 : 1} ${flipV ? -1 : 1})`,
        }
      : {}),
  };

  switch (path.type) {
    case 'rect':
      return (
        <rect x={viewBox.x} y={viewBox.y} width={viewBox.width} height={viewBox.height} {...shared} />
      );
    case 'roundedRect':
      return (
        <rect
          x={viewBox.x}
          y={viewBox.y}
          width={viewBox.width}
          height={viewBox.height}
          rx={path.radius}
          ry={path.radius}
          {...shared}
        />
      );
    case 'ellipse':
      return (
        <ellipse
          cx={viewBox.x + viewBox.width / 2}
          cy={viewBox.y + viewBox.height / 2}
          rx={viewBox.width / 2}
          ry={viewBox.height / 2}
          {...shared}
        />
      );
    case 'polygon':
      return <polygon points={regularPolygon(path.sides, viewBox)} {...shared} />;
    case 'star':
      return <polygon points={star(path.points, path.innerRadius, viewBox)} {...shared} />;
    case 'path':
      // An unclosed path is a stroke-only figure; filling it would paint the
      // implicit closing chord.
      return <path d={path.d} {...shared} {...(path.open ? { fill: 'none' } : {})} />;
  }
}

function pathViewBox(path: ShapePath): Rect {
  return path.type === 'path' ? path.viewBox : { x: 0, y: 0, width: 100, height: 100 };
}

/** Convert a CSS-style gradient angle into SVG `x1,y1 -> x2,y2` in unit space. */
function gradientVector(angle: number): { x1: number; y1: number; x2: number; y2: number } {
  const radians = ((angle - 90) * Math.PI) / 180;
  const dx = Math.cos(radians) / 2;
  const dy = Math.sin(radians) / 2;
  return { x1: 0.5 - dx, y1: 0.5 - dy, x2: 0.5 + dx, y2: 0.5 + dy };
}

function regularPolygon(sides: number, box: Rect): string {
  return radialPoints(sides, box, () => 0.5);
}

function star(count: number, innerRadius: number, box: Rect): string {
  return radialPoints(count * 2, box, (i) => (i % 2 === 0 ? 0.5 : 0.5 * innerRadius));
}

function radialPoints(count: number, box: Rect, radiusAt: (index: number) => number): string {
  const points: string[] = [];
  for (let i = 0; i < count; i++) {
    const radius = radiusAt(i);
    const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
    points.push(
      `${box.x + (0.5 + Math.cos(angle) * radius) * box.width},` +
        `${box.y + (0.5 + Math.sin(angle) * radius) * box.height}`,
    );
  }
  return points.join(' ');
}
