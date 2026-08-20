import {
  Bold,
  Code2,
  Heading2,
  Heading3,
  Italic,
  Link2,
  List,
  ListOrdered,
  Pilcrow,
  RemoveFormatting,
  Unlink,
} from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState, type ClipboardEvent } from 'react';
import { cn } from '../../lib/utils';
import { inputErrorCls } from './FormField';

type Props = {
  /** HTML değeri (kontrollü). */
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  /** Editör alanının en az yüksekliği (CSS uzunluğu). */
  minHeight?: string;
  id?: string;
  invalid?: boolean;
  disabled?: boolean;
  className?: string;
  /** Başlık/liste düğmeleri olmadan kısa araç çubuğu (tek satırlık HTML alanları için). */
  compact?: boolean;
  'aria-label'?: string;
};

const toolBtn =
  'inline-flex h-7 w-7 items-center justify-center rounded text-brand-500 transition-colors hover:bg-brand-100 hover:text-brand-900 disabled:opacity-30 disabled:hover:bg-transparent';

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Boş editör `<br>` / boş `<p>` bırakır; bunları boş string say. */
export function normalizeEditorHtml(html: string): string {
  const t = html.trim();
  if (!t) return '';
  if (/^(<br\s*\/?>|<p>(\s|&nbsp;|<br\s*\/?>)*<\/p>|<div>(\s|&nbsp;|<br\s*\/?>)*<\/div>)+$/i.test(t)) return '';
  return html;
}

/** Düz metin yapıştırmayı paragraf/satır sonlarıyla HTML'e çevirir (Word/Docs artıkları gelmez). */
export function plainTextToHtml(text: string): string {
  const normalized = text.replace(/\r\n?/g, '\n').trim();
  if (!normalized) return '';
  const paragraphs = normalized.split(/\n{2,}/);
  if (paragraphs.length === 1 && !normalized.includes('\n')) return escapeText(normalized);
  return paragraphs.map((p) => `<p>${escapeText(p).replace(/\n/g, '<br>')}</p>`).join('');
}

function execCommand(command: string, value?: string): boolean {
  if (typeof document === 'undefined' || typeof document.execCommand !== 'function') return false;
  try {
    return document.execCommand(command, false, value);
  } catch {
    return false;
  }
}

/**
 * Hafif zengin metin editörü (contenteditable + execCommand): kalın / italik / H2 / H3 / paragraf / listeler /
 * bağlantı / biçim temizle + ham HTML görünümü. tiptap kurulu olmadığından (F5) bağımlılıksızdır; çıktı HTML string.
 * Sunucu tarafı temizleme yapmaz — yalnız yetkili personel kullanır (ADMIN/STAFF).
 */
export function RichTextLite({
  value,
  onChange,
  placeholder = 'İçerik yazın…',
  minHeight = '10rem',
  id,
  invalid,
  disabled,
  className,
  compact,
  'aria-label': ariaLabel,
}: Props) {
  const autoId = useId();
  const editorId = id ?? autoId;
  const editorRef = useRef<HTMLDivElement>(null);
  const lastEmitted = useRef<string>(value);
  const savedRange = useRef<Range | null>(null);
  const [mode, setMode] = useState<'visual' | 'html'>('visual');
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');

  // Dışarıdan gelen değer değiştiyse (ya da görünüm moduna dönüldüyse) editörü eşitle; yazarken ezme.
  useEffect(() => {
    if (mode !== 'visual') return;
    const el = editorRef.current;
    if (!el) return;
    if (value !== lastEmitted.current || el.innerHTML !== value) {
      if (el.innerHTML !== value) el.innerHTML = value || '';
      lastEmitted.current = value;
    }
  }, [value, mode]);

  const emit = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    const html = normalizeEditorHtml(el.innerHTML);
    lastEmitted.current = html;
    onChange(html);
  }, [onChange]);

  const focusEditor = useCallback(() => {
    editorRef.current?.focus();
  }, []);

  const exec = useCallback(
    (command: string, arg?: string) => {
      if (disabled) return;
      focusEditor();
      execCommand(command, arg);
      emit();
    },
    [disabled, emit, focusEditor],
  );

  function saveSelection() {
    const sel = typeof window !== 'undefined' ? window.getSelection() : null;
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      if (editorRef.current?.contains(range.commonAncestorContainer)) savedRange.current = range.cloneRange();
    }
  }

  function restoreSelection() {
    const range = savedRange.current;
    const sel = typeof window !== 'undefined' ? window.getSelection() : null;
    if (!range || !sel) return;
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function openLink() {
    saveSelection();
    setLinkUrl('');
    setLinkOpen(true);
  }

  function applyLink() {
    const url = linkUrl.trim();
    setLinkOpen(false);
    if (!url) return;
    focusEditor();
    restoreSelection();
    const sel = typeof window !== 'undefined' ? window.getSelection() : null;
    const collapsed = !sel || sel.rangeCount === 0 || sel.getRangeAt(0).collapsed;
    if (collapsed) {
      execCommand('insertHTML', `<a href="${escapeText(url)}">${escapeText(url)}</a>`);
    } else {
      execCommand('createLink', url);
    }
    emit();
  }

  function onPaste(e: ClipboardEvent<HTMLDivElement>) {
    if (disabled) return;
    const text = e.clipboardData.getData('text/plain');
    if (!text) return;
    e.preventDefault();
    const html = plainTextToHtml(text);
    if (!html) return;
    if (!execCommand('insertHTML', html)) {
      // execCommand yoksa (test ortamı) metni sona ekle
      const el = editorRef.current;
      if (el) el.innerHTML += html;
    }
    emit();
  }

  function switchMode(next: 'visual' | 'html') {
    if (next === mode) return;
    if (mode === 'visual') emit();
    setMode(next);
  }

  const htmlTextareaId = `${editorId}-html`;

  return (
    <div
      className={cn(
        'overflow-hidden rounded-md border border-brand-300 bg-white focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20',
        invalid && inputErrorCls,
        disabled && 'opacity-60',
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-0.5 border-b border-brand-200 bg-brand-50/70 px-1.5 py-1" role="toolbar" aria-label="Biçimlendirme">
        <button type="button" className={toolBtn} title="Kalın (Ctrl+B)" aria-label="Kalın" disabled={disabled || mode === 'html'} onMouseDown={(e) => e.preventDefault()} onClick={() => exec('bold')}>
          <Bold className="h-4 w-4" aria-hidden />
        </button>
        <button type="button" className={toolBtn} title="İtalik (Ctrl+I)" aria-label="İtalik" disabled={disabled || mode === 'html'} onMouseDown={(e) => e.preventDefault()} onClick={() => exec('italic')}>
          <Italic className="h-4 w-4" aria-hidden />
        </button>
        {!compact && (
          <>
            <span className="mx-1 h-4 w-px bg-brand-200" aria-hidden />
            <button type="button" className={toolBtn} title="Başlık 2" aria-label="Başlık 2" disabled={disabled || mode === 'html'} onMouseDown={(e) => e.preventDefault()} onClick={() => exec('formatBlock', '<h2>')}>
              <Heading2 className="h-4 w-4" aria-hidden />
            </button>
            <button type="button" className={toolBtn} title="Başlık 3" aria-label="Başlık 3" disabled={disabled || mode === 'html'} onMouseDown={(e) => e.preventDefault()} onClick={() => exec('formatBlock', '<h3>')}>
              <Heading3 className="h-4 w-4" aria-hidden />
            </button>
            <button type="button" className={toolBtn} title="Paragraf" aria-label="Paragraf" disabled={disabled || mode === 'html'} onMouseDown={(e) => e.preventDefault()} onClick={() => exec('formatBlock', '<p>')}>
              <Pilcrow className="h-4 w-4" aria-hidden />
            </button>
            <span className="mx-1 h-4 w-px bg-brand-200" aria-hidden />
            <button type="button" className={toolBtn} title="Madde listesi" aria-label="Madde listesi" disabled={disabled || mode === 'html'} onMouseDown={(e) => e.preventDefault()} onClick={() => exec('insertUnorderedList')}>
              <List className="h-4 w-4" aria-hidden />
            </button>
            <button type="button" className={toolBtn} title="Numaralı liste" aria-label="Numaralı liste" disabled={disabled || mode === 'html'} onMouseDown={(e) => e.preventDefault()} onClick={() => exec('insertOrderedList')}>
              <ListOrdered className="h-4 w-4" aria-hidden />
            </button>
          </>
        )}
        <span className="mx-1 h-4 w-px bg-brand-200" aria-hidden />
        <button type="button" className={toolBtn} title="Bağlantı ekle" aria-label="Bağlantı ekle" disabled={disabled || mode === 'html'} onMouseDown={(e) => e.preventDefault()} onClick={openLink}>
          <Link2 className="h-4 w-4" aria-hidden />
        </button>
        <button type="button" className={toolBtn} title="Bağlantıyı kaldır" aria-label="Bağlantıyı kaldır" disabled={disabled || mode === 'html'} onMouseDown={(e) => e.preventDefault()} onClick={() => exec('unlink')}>
          <Unlink className="h-4 w-4" aria-hidden />
        </button>
        <button type="button" className={toolBtn} title="Biçimi temizle" aria-label="Biçimi temizle" disabled={disabled || mode === 'html'} onMouseDown={(e) => e.preventDefault()} onClick={() => exec('removeFormat')}>
          <RemoveFormatting className="h-4 w-4" aria-hidden />
        </button>
        <span className="ml-auto" />
        <button
          type="button"
          className={cn(toolBtn, 'w-auto gap-1 px-1.5 text-[11px] font-medium', mode === 'html' && 'bg-brand-200 text-brand-900')}
          title="Ham HTML'i göster/düzenle"
          aria-pressed={mode === 'html'}
          disabled={disabled}
          onClick={() => switchMode(mode === 'html' ? 'visual' : 'html')}
        >
          <Code2 className="h-4 w-4" aria-hidden />
          HTML
        </button>
      </div>

      {linkOpen && mode === 'visual' && (
        <div className="flex items-center gap-2 border-b border-brand-200 bg-brand-50 px-2 py-1.5">
          <input
            type="url"
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            placeholder="https://… ya da politikalar.html#kvkk"
            aria-label="Bağlantı adresi"
            autoFocus
            className="min-w-0 flex-1 rounded border border-brand-300 bg-white px-2 py-1 text-xs focus:border-accent focus:outline-none"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                applyLink();
              }
              if (e.key === 'Escape') setLinkOpen(false);
            }}
          />
          <button type="button" onClick={applyLink} className="rounded bg-accent px-2 py-1 text-xs font-medium text-white hover:bg-accent-dark">
            Uygula
          </button>
          <button type="button" onClick={() => setLinkOpen(false)} className="rounded px-2 py-1 text-xs text-brand-600 hover:bg-brand-100">
            Vazgeç
          </button>
        </div>
      )}

      {mode === 'visual' ? (
        <div
          ref={editorRef}
          id={editorId}
          role="textbox"
          aria-multiline="true"
          aria-label={ariaLabel}
          aria-invalid={invalid || undefined}
          contentEditable={!disabled}
          suppressContentEditableWarning
          data-placeholder={placeholder}
          onInput={emit}
          onBlur={emit}
          onPaste={onPaste}
          style={{ minHeight }}
          className="rich-text-content max-h-[60vh] overflow-y-auto px-3 py-2 text-sm text-brand-900 outline-none empty:before:pointer-events-none empty:before:text-brand-400 empty:before:content-[attr(data-placeholder)]"
        />
      ) : (
        <textarea
          id={htmlTextareaId}
          aria-label={ariaLabel ? `${ariaLabel} (HTML)` : 'HTML kaynağı'}
          value={value}
          disabled={disabled}
          onChange={(e) => {
            lastEmitted.current = e.target.value;
            onChange(e.target.value);
          }}
          spellCheck={false}
          style={{ minHeight }}
          className="block w-full resize-y bg-brand-50/40 px-3 py-2 font-mono text-xs leading-relaxed text-brand-900 outline-none"
        />
      )}
    </div>
  );
}
