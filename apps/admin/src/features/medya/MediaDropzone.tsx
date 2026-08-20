import { Loader2, Upload } from 'lucide-react';
import { useCallback, useRef, useState, type DragEvent } from 'react';
import type { AdminMediaFile } from '../../lib/adminTypes';
import { errorMessage } from '../../lib/api';
import { toast } from '../../lib/toast';
import { cn } from '../../lib/utils';
import { MEDIA_ACCEPT, MEDIA_MAX_BYTES, mediaApi } from './api';

type Props = {
  folder: string;
  onUploaded: (files: AdminMediaFile[]) => void;
  /** Tek dosya (picker içinde). */
  multiple?: boolean;
  compact?: boolean;
  className?: string;
};

interface UploadRow {
  name: string;
  pct: number;
  error?: string;
}

/** Sürükle-bırak + dosya seçici yükleme alanı; sıralı yükler, ilerleme gösterir. */
export function MediaDropzone({ folder, onUploaded, multiple = true, compact, className }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [rows, setRows] = useState<UploadRow[]>([]);
  const busy = rows.some((r) => r.pct < 100 && !r.error);

  const uploadFiles = useCallback(
    async (fileList: FileList | File[]) => {
      const files = Array.from(fileList).filter(Boolean);
      if (files.length === 0) return;
      const selected = multiple ? files : files.slice(0, 1);
      const tooBig = selected.filter((f) => f.size > MEDIA_MAX_BYTES);
      if (tooBig.length) toast.error(`${tooBig.map((f) => f.name).join(', ')}: 20 MB sınırı aşıldı`);
      const okFiles = selected.filter((f) => f.size <= MEDIA_MAX_BYTES);
      if (okFiles.length === 0) return;

      setRows(okFiles.map((f) => ({ name: f.name, pct: 0 })));
      const uploaded: AdminMediaFile[] = [];
      for (let i = 0; i < okFiles.length; i++) {
        const file = okFiles[i];
        try {
          const res = await mediaApi.upload(file, {
            folder,
            onProgress: (pct) => setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, pct } : r))),
          });
          uploaded.push(res);
          setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, pct: 100 } : r)));
        } catch (e) {
          const msg = errorMessage(e, 'Yükleme başarısız');
          setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, error: msg } : r)));
          toast.error(`${file.name}: ${msg}`);
        }
      }
      if (uploaded.length) {
        toast.success(uploaded.length === 1 ? 'Görsel yüklendi' : `${uploaded.length} görsel yüklendi`);
        onUploaded(uploaded);
      }
      setTimeout(() => setRows((prev) => prev.filter((r) => r.error)), 1500);
      if (inputRef.current) inputRef.current.value = '';
    },
    [folder, multiple, onUploaded],
  );

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer?.files?.length) void uploadFiles(e.dataTransfer.files);
  }

  return (
    <div className={className}>
      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        aria-label="Görsel yükle"
        className={cn(
          'flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed text-center transition-colors',
          compact ? 'px-3 py-3' : 'px-4 py-8',
          dragOver ? 'border-accent bg-accent-light' : 'border-brand-300 bg-brand-50/60 hover:border-brand-400 hover:bg-brand-50',
        )}
      >
        {busy ? <Loader2 className="h-6 w-6 animate-spin text-accent" aria-hidden /> : <Upload className="h-6 w-6 text-brand-400" aria-hidden />}
        <p className="text-sm font-medium text-brand-800">
          {compact ? 'Yükle' : 'Görselleri buraya sürükleyin ya da tıklayın'}
        </p>
        {!compact && (
          <p className="text-[11px] text-brand-500">
            JPG · PNG · WEBP · 20 MB sınırı · klasör: <span className="font-mono">{folder}</span> · sunucu webp'ye çevirir (max 2000 px + 400 px küçük resim)
          </p>
        )}
        <input
          ref={inputRef}
          type="file"
          accept={MEDIA_ACCEPT}
          multiple={multiple}
          className="hidden"
          onChange={(e) => e.target.files && void uploadFiles(e.target.files)}
        />
      </div>
      {rows.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs">
          {rows.map((r, i) => (
            <li key={`${r.name}-${i}`} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-brand-700">{r.name}</span>
              {r.error ? (
                <span className="text-accent-dark">{r.error}</span>
              ) : (
                <span className="flex w-32 items-center gap-1.5">
                  <span className="h-1.5 flex-1 overflow-hidden rounded bg-brand-200">
                    <span className="block h-full bg-olive transition-all" style={{ width: `${r.pct}%` }} />
                  </span>
                  <span className="w-8 text-right tabular-nums text-brand-500">{r.pct}%</span>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
