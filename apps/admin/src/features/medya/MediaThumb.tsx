import { ImageIcon } from 'lucide-react';
import { useState } from 'react';
import { resolveMediaUrl } from '../../lib/api';
import { cn } from '../../lib/utils';

type Props = {
  /** Önce thumbUrl, yoksa url. */
  src: string | null | undefined;
  alt?: string | null;
  className?: string;
  /** `object-cover` yerine `object-contain`. */
  contain?: boolean;
};

/** Medya küçük resmi; yüklenemezse ikon. */
export function MediaThumb({ src, alt, className, contain }: Props) {
  const [broken, setBroken] = useState(false);
  const url = resolveMediaUrl(src);
  if (!url || broken) {
    return (
      <span className={cn('flex items-center justify-center rounded border border-brand-200 bg-brand-50 text-brand-300', className)} aria-hidden>
        <ImageIcon className="h-5 w-5" />
      </span>
    );
  }
  return (
    <img
      src={url}
      alt={alt ?? ''}
      loading="lazy"
      onError={() => setBroken(true)}
      className={cn('rounded border border-brand-200 bg-brand-50', contain ? 'object-contain' : 'object-cover', className)}
    />
  );
}
