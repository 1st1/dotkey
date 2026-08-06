import { fontStack, parseFontName, type Paragraph, type TextBlock } from '@dotkey/core';
import { Fragment, type CSSProperties } from 'react';

import { useKeynoteContext } from './context.jsx';
import { lineHeightCss, runStyle, textAlignCss, toCss } from './css.js';

const VERTICAL_ALIGN: Record<TextBlock['verticalAlign'], CSSProperties['justifyContent']> = {
  top: 'flex-start',
  middle: 'center',
  bottom: 'flex-end',
  justify: 'space-between',
};

export interface TextViewProps {
  text: TextBlock;
  /** Text wraps only when the shape has a fixed width. */
  wrap: boolean;
  /** Applied to the flex container, e.g. a scale for shrink-to-fit. */
  style?: CSSProperties;
}

/**
 * Lays a `TextBlock` out with the browser's own text engine.
 *
 * Keynote does not store the size of auto-growing text boxes, so the layout has
 * to reproduce them: with `wrap` off the block is `max-content` wide and only
 * breaks at hard returns, exactly like an auto-width box in Keynote.
 */
export function TextView({ text, wrap, style }: TextViewProps) {
  const { lineHeightBasis } = useKeynoteContext();

  const containerStyle: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    justifyContent: VERTICAL_ALIGN[text.verticalAlign],
    boxSizing: 'border-box',
    paddingTop: text.padding.top,
    paddingRight: text.padding.right,
    paddingBottom: text.padding.bottom,
    paddingLeft: text.padding.left,
    whiteSpace: wrap ? 'pre-wrap' : 'pre',
    overflowWrap: wrap ? 'break-word' : 'normal',
    width: wrap ? '100%' : 'max-content',
    height: '100%',
    ...(text.columns
      ? { columnCount: text.columns.count, columnGap: text.columns.gap, display: 'block' }
      : {}),
    ...style,
  };

  return (
    <div style={containerStyle}>
      {text.paragraphs.map((paragraph, index) => (
        <ParagraphView
          // Paragraphs have no stable identity in the source document.
          // eslint-disable-next-line react/no-array-index-key
          key={index}
          paragraph={paragraph}
          lineHeightBasis={lineHeightBasis}
        />
      ))}
    </div>
  );
}

interface ParagraphViewProps {
  paragraph: Paragraph;
  lineHeightBasis: number;
}

function ParagraphView({ paragraph, lineHeightBasis }: ParagraphViewProps) {
  const bullet = paragraph.bullet;
  const baseSize = paragraph.runs[0]?.style.fontSize ?? paragraph.defaultStyle.fontSize;

  // Bulleted paragraphs use a hanging indent so wrapped lines align with the
  // text rather than the label. `textIndent` is a multiple of the font size,
  // and only a *minimum*: a label wider than that pushes the text along.
  const labelWidth = bullet ? Math.max(bullet.textIndent, 0) * baseSize : 0;
  const paddingLeft = paragraph.leftIndent + (bullet ? bullet.indent + labelWidth : 0);

  const style: CSSProperties = {
    margin: 0,
    textAlign: textAlignCss(paragraph.align),
    paddingLeft,
    paddingRight: paragraph.rightIndent,
    marginTop: paragraph.spaceBefore,
    marginBottom: paragraph.spaceAfter,
    lineHeight: lineHeightCss(paragraph.lineSpacing, baseSize, lineHeightBasis),
    textIndent: bullet ? -labelWidth : paragraph.firstLineIndent,
    ...(paragraph.writingDirection !== 'natural'
      ? { direction: paragraph.writingDirection === 'rtl' ? 'rtl' : 'ltr' }
      : {}),
  };

  return (
    <p style={style}>
      {bullet ? <BulletLabel bullet={bullet} width={labelWidth} baseSize={baseSize} /> : null}
      {paragraph.runs.length === 0 ? (
        // An empty paragraph still occupies a line; the zero-width space gives
        // the line box the paragraph's own font metrics.
        <span style={runStyle(paragraph.defaultStyle)}>{'​'}</span>
      ) : (
        paragraph.runs.map((run, index) => {
          const content = <span style={runStyle(run.style)}>{run.text}</span>;
          return (
            <Fragment key={index}>
              {run.link ? (
                <a href={run.link} style={{ color: 'inherit' }}>
                  {content}
                </a>
              ) : (
                content
              )}
            </Fragment>
          );
        })
      )}
    </p>
  );
}

interface BulletLabelProps {
  bullet: NonNullable<Paragraph['bullet']>;
  width: number;
  baseSize: number;
}

function BulletLabel({ bullet, width, baseSize }: BulletLabelProps) {
  const { resolveUrl } = useKeynoteContext();
  const size = baseSize * bullet.scale;

  const style: CSSProperties = {
    display: 'inline-block',
    // A minimum rather than a fixed width: a glyph wider than the configured
    // indent must not overlap the text that follows it.
    minWidth: width,
    textIndent: 0,
    // The label must not pick up the paragraph's justification.
    textAlign: 'start',
    fontSize: size,
    ...(bullet.color ? { color: toCss(bullet.color) } : {}),
    ...(bullet.fontName ? { fontFamily: fontStack(parseFontName(bullet.fontName).family) } : {}),
  };

  if (bullet.kind === 'image') {
    const url = bullet.resource ? resolveUrl(bullet.resource) : undefined;
    return (
      <span style={style} aria-hidden>
        {url ? <img src={url} alt="" style={{ height: size, verticalAlign: 'middle' }} /> : null}
      </span>
    );
  }

  return (
    <span style={style} aria-hidden>
      {bullet.kind === 'number' ? bullet.label : bullet.text}
    </span>
  );
}
