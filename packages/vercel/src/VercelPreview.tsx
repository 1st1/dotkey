import { Preview, type PreviewProps } from '@dotkey/preview';
import type { ReactNode } from 'react';

import vercelLogo from './vercel-logotype.svg';
import './styles.css';

export interface VercelPreviewProps extends Omit<PreviewProps, 'brand'> {
  /** Replace the official Vercel logotype. */
  brand?: ReactNode;
}

/** The generic `Preview` GUI with the official Vercel logotype. */
export function VercelPreview({ brand, ...props }: VercelPreviewProps) {
  return (
    <Preview
      {...props}
      brand={
        brand ?? (
          <img
            src={vercelLogo}
            alt="Vercel"
            style={{ display: 'block', width: '100%', height: 'auto' }}
          />
        )
      }
    />
  );
}

/** @deprecated Use `VercelPreview`. */
export type VercelPresentationProps = VercelPreviewProps;

/** @deprecated Use `VercelPreview`. */
export function VercelPresentation(props: VercelPresentationProps) {
  return <VercelPreview {...props} />;
}
