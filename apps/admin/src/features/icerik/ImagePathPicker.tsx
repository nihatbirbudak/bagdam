import { ImagePlus } from 'lucide-react';
import { useState } from 'react';
import type { ImagePickerProps } from '../../components/ui/SchemaForm';
import { btn } from '../../lib/buttonStyles';
import { cn } from '../../lib/utils';
import { MediaPickerModal } from '../medya/MediaPickerModal';
import { toSiteMediaPath } from './schemaForm';

/** SchemaForm `image` alanı için medya seçici: seçilen dosyanın site-göreli yolunu (`assets/…` / `uploads/…`) verir. */
export function ImagePathPicker({ onPick, disabled }: ImagePickerProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" disabled={disabled} onClick={() => setOpen(true)} className={cn(btn.secondary, 'shrink-0')} title="Medyadan seç">
        <ImagePlus className="h-3.5 w-3.5" aria-hidden />
        Seç
      </button>
      <MediaPickerModal
        open={open}
        onClose={() => setOpen(false)}
        onSelect={(file) => onPick(toSiteMediaPath(file.url))}
        title="Görsel seç"
        defaultFolder="sahne"
      />
    </>
  );
}
