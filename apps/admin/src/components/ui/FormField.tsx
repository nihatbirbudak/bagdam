import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

/* ── Ortak form ilkelleri (Bağdam paleti). Hata metni alanın altında, `aria-invalid` ile. ── */

export const inputCls =
  'w-full rounded-md border border-brand-300 bg-white px-3 py-2 text-sm text-brand-900 placeholder:text-brand-400 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 disabled:bg-brand-50 disabled:text-brand-500';
export const inputErrorCls = 'border-accent-dark focus:border-accent-dark focus:ring-accent-dark/20';
export const labelCls = 'mb-1 block text-xs font-medium text-brand-600';

type FieldProps = {
  label?: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  required?: boolean;
  className?: string;
  /** Etiketin bağlanacağı id; verilmezse üretilir ve çocuk render fonksiyonuna geçirilir. */
  id?: string;
  children: ReactNode | ((ctx: { id: string; invalid: boolean; describedBy?: string }) => ReactNode);
};

/** Etiket + alan + ipucu/hata sarmalayıcı. */
export function Field({ label, hint, error, required, className, id: givenId, children }: FieldProps) {
  const autoId = useId();
  const id = givenId ?? autoId;
  const describedBy = error ? `${id}-err` : hint ? `${id}-hint` : undefined;
  return (
    <div className={cn('min-w-0', className)}>
      {label && (
        <label htmlFor={id} className={labelCls}>
          {label}
          {required && <span className="ml-0.5 text-accent-dark" aria-hidden>*</span>}
        </label>
      )}
      {typeof children === 'function' ? children({ id, invalid: !!error, describedBy }) : children}
      {error ? (
        <p id={`${id}-err`} role="alert" className="mt-1 text-xs text-accent-dark">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1 text-[11px] leading-snug text-brand-500">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

type TextInputProps = InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean };

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  { className, invalid, ...rest },
  ref,
) {
  return <input ref={ref} aria-invalid={invalid || undefined} className={cn(inputCls, invalid && inputErrorCls, className)} {...rest} />;
});

type TextAreaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean };

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  { className, invalid, rows = 3, ...rest },
  ref,
) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      aria-invalid={invalid || undefined}
      className={cn(inputCls, 'min-h-[2.5rem] leading-relaxed', invalid && inputErrorCls, className)}
      {...rest}
    />
  );
});

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean };

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, invalid, children, ...rest },
  ref,
) {
  return (
    <select ref={ref} aria-invalid={invalid || undefined} className={cn(inputCls, 'pr-8', invalid && inputErrorCls, className)} {...rest}>
      {children}
    </select>
  );
});

type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  label: ReactNode;
  description?: ReactNode;
};

/** Etiketli onay kutusu. */
export function Checkbox({ label, description, className, id: givenId, ...rest }: CheckboxProps) {
  const autoId = useId();
  const id = givenId ?? autoId;
  return (
    <label htmlFor={id} className={cn('flex cursor-pointer items-start gap-2.5 text-sm text-brand-800', className)}>
      <input
        id={id}
        type="checkbox"
        className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-brand-400 accent-accent"
        {...rest}
      />
      <span className="min-w-0">
        <span className="font-medium">{label}</span>
        {description && <span className="block text-[11px] leading-snug text-brand-500">{description}</span>}
      </span>
    </label>
  );
}

/** Form bölümü başlığı. */
export function FormSection({ title, description, children, className }: { title: string; description?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('space-y-3', className)}>
      <header>
        <h3 className="text-sm font-semibold text-brand-900">{title}</h3>
        {description && <p className="text-xs text-brand-500">{description}</p>}
      </header>
      {children}
    </section>
  );
}

/** Sayfa/panel üstünde genel hata kutusu. */
export function FormErrorBanner({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return (
    <div role="alert" className="rounded-md border border-accent/30 bg-accent-light px-3 py-2 text-xs text-accent-dark">
      {message}
    </div>
  );
}
