import type { Slide } from '@dotkey/core';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

import type { Playback } from './animation/usePlayback.js';
import { PlaybackProvider, useKeynoteContext } from './context.jsx';
import { fillStyle } from './css.js';
import { ElementView } from './ElementView.jsx';

export interface SlideViewProps {
  slide: Slide;
  /**
   * Build state. Omit to draw the slide fully built, which is what thumbnails
   * and printing want.
   */
  playback?: Playback;
  /** Extra content drawn above the slide, e.g. an overlay or watermark. */
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

/**
 * One slide at its authored size. Wrap it in {@link SlideStage} (or set your own
 * transform) to fit it to a container.
 */
export function SlideView({ slide, playback, children, className, style }: SlideViewProps) {
  const { deck, resolveUrl } = useKeynoteContext();

  return (
    <PlaybackProvider playback={playback}>
      <div
        className={className}
        style={{
          position: 'relative',
          width: deck.size.width,
          height: deck.size.height,
          overflow: 'hidden',
          ...fillStyle(slide.background, resolveUrl),
          ...style,
        }}
        data-keynote-slide={slide.index}
      >
        {slide.masterElements.map((element) => (
          <ElementView key={`master-${element.id}`} element={element} />
        ))}
        {slide.elements.map((element) => (
          <ElementView key={element.id} element={element} />
        ))}
        {children}
      </div>
    </PlaybackProvider>
  );
}

export interface StageProps {
  /** How the content is sized inside the container. Default `contain`. */
  fit?: 'contain' | 'cover' | 'width' | 'height';
  containerStyle?: CSSProperties;
  containerClassName?: string;
  children: ReactNode;
}

/**
 * Scales slide-sized content to fill its container.
 *
 * The content is laid out at full size and then transformed, rather than having
 * its dimensions recomputed: that keeps text metrics, line breaks and
 * auto-sized boxes identical at every zoom level.
 */
export function Stage({ fit = 'contain', containerStyle, containerClassName, children }: StageProps) {
  const { deck } = useKeynoteContext();
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const measure = () => {
      const { width, height } = container.getBoundingClientRect();
      if (width === 0 || height === 0) return;
      const sx = width / deck.size.width;
      const sy = height / deck.size.height;
      setScale(
        fit === 'width' ? sx
        : fit === 'height' ? sy
        : fit === 'cover' ? Math.max(sx, sy)
        : Math.min(sx, sy),
      );
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, [deck.size.width, deck.size.height, fit]);

  return (
    <div
      ref={containerRef}
      className={containerClassName}
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        ...containerStyle,
      }}
    >
      <div
        style={{
          width: deck.size.width * scale,
          height: deck.size.height * scale,
          // Hide the un-scaled first paint.
          visibility: scale > 0 ? 'visible' : 'hidden',
        }}
      >
        <div style={{ transform: `scale(${scale})`, transformOrigin: 'top left' }}>{children}</div>
      </div>
    </div>
  );
}

export interface SlideStageProps extends SlideViewProps, Omit<StageProps, 'children'> {}

/** A single slide, scaled to fit its container. */
export function SlideStage({
  fit,
  containerStyle,
  containerClassName,
  ...slideProps
}: SlideStageProps) {
  return (
    <Stage
      {...(fit ? { fit } : {})}
      {...(containerStyle ? { containerStyle } : {})}
      {...(containerClassName ? { containerClassName } : {})}
    >
      <SlideView {...slideProps} />
    </Stage>
  );
}
