import { ChevronDown, ChevronUp, GripVertical } from 'lucide-react';
import { cn } from '../../lib/utils';

type Props = {
  index: number;
  count: number;
  onMove: (from: number, to: number) => void;
  disabled?: boolean;
  /** Sürükleme tutamağı gösterilsin (HTML5 DnD satırda). */
  handle?: boolean;
  className?: string;
};

/**
 * Yukarı/aşağı sıralama düğmeleri (+ isteğe bağlı sürükleme tutamağı).
 * @dnd-kit kurulu olmadığından satır sürükleme HTML5 DnD ile ebeveynde yapılır; bu düğmeler klavye/mobil alternatifidir.
 */
export function ReorderButtons({ index, count, onMove, disabled, handle = true, className }: Props) {
  const b = 'inline-flex h-6 w-6 items-center justify-center rounded text-brand-400 hover:bg-brand-100 hover:text-brand-700 disabled:opacity-30 disabled:hover:bg-transparent';
  return (
    <div className={cn('flex items-center', className)}>
      {handle && <GripVertical className="mr-0.5 h-4 w-4 cursor-grab text-brand-300" aria-hidden />}
      <button type="button" className={b} disabled={disabled || index <= 0} onClick={() => onMove(index, index - 1)} aria-label="Yukarı taşı">
        <ChevronUp className="h-3.5 w-3.5" aria-hidden />
      </button>
      <button type="button" className={b} disabled={disabled || index >= count - 1} onClick={() => onMove(index, index + 1)} aria-label="Aşağı taşı">
        <ChevronDown className="h-3.5 w-3.5" aria-hidden />
      </button>
    </div>
  );
}
