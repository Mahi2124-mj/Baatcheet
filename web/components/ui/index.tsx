'use client';
// Baatcheet's small component library: one look for buttons, inputs, dialogs, avatars, toasts.
import { createContext, forwardRef, useCallback, useContext, useEffect, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';
import { Loader2, X } from 'lucide-react';
import { cx } from '@/lib/format';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean; size?: 'sm' | 'md' | 'lg' }>(
  function Button({ variant = 'primary', loading, size = 'md', className, children, disabled, ...rest }, ref) {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={cx(
          'inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition active:opacity-70 disabled:opacity-50 disabled:cursor-not-allowed select-none',
          size === 'sm' && 'h-8 px-3 text-sm',
          size === 'md' && 'h-10 px-4 text-sm',
          size === 'lg' && 'h-12 px-5 text-base',
          variant === 'primary' && 'bg-accent text-accent-ink hover:brightness-110',
          variant === 'secondary' && 'bg-accent-soft text-accent hover:brightness-95',
          variant === 'ghost' && 'text-accent hover:bg-hover',
          variant === 'danger' && 'bg-danger text-white hover:brightness-110',
          className,
        )}
        {...rest}
      >
        {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
        {children}
      </button>
    );
  },
);

export function IconButton({ label, className, children, active, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <button
      aria-label={label}
      title={label}
      className={cx('inline-flex size-10 items-center justify-center rounded-full text-muted hover:bg-hover hover:text-text transition disabled:opacity-40', active && 'text-accent', className)}
      {...rest}
    >
      {children}
    </button>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { label?: string; error?: string | null; hint?: string }>(
  function Input({ label, error, hint, className, id, ...rest }, ref) {
    const inputId = id ?? (label ? `in-${label.replace(/\W+/g, '-').toLowerCase()}` : undefined);
    return (
      <label className="block space-y-1.5" htmlFor={inputId}>
        {label && <span className="text-sm font-medium text-text">{label}</span>}
        <input
          ref={ref}
          id={inputId}
          aria-invalid={Boolean(error)}
          className={cx(
            'h-11 w-full rounded-xl border border-line bg-panel-2 px-3.5 text-[15px] text-text placeholder:text-muted outline-none focus:border-accent',
            error && 'border-danger',
            className,
          )}
          {...rest}
        />
        {error ? <span className="text-xs text-danger">{error}</span> : hint ? <span className="text-xs text-muted">{hint}</span> : null}
      </label>
    );
  },
);

export function Avatar({ name, url, size = 40, online, className }: { name: string; url?: string | null; size?: number; online?: boolean; className?: string }) {
  const [broken, setBroken] = useState(false);
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || '?';
  let hue = 0;
  for (const ch of name) hue = (hue * 31 + ch.charCodeAt(0)) % 360;
  return (
    <span className={cx('relative inline-flex shrink-0', className)} style={{ width: size, height: size }}>
      {url && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" onError={() => setBroken(true)} className="size-full rounded-full object-cover" />
      ) : (
        <span className="flex size-full items-center justify-center rounded-full font-semibold text-white" style={{ background: `hsl(${hue} 45% 42%)`, fontSize: size * 0.38 }} aria-hidden>
          {initials}
        </span>
      )}
      {online && <span className="absolute bottom-0 right-0 size-3 rounded-full border-2 border-panel bg-ok" aria-label="online" />}
    </span>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx('size-5 animate-spin text-muted', className)} aria-label="Loading" />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('skeleton rounded-lg', className)} aria-hidden />;
}

export function Empty({ icon, title, text, action }: { icon?: ReactNode; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
      {icon && <div className="flex size-14 items-center justify-center rounded-2xl bg-accent-soft text-accent">{icon}</div>}
      <p className="font-semibold">{title}</p>
      {text && <p className="max-w-xs text-sm text-muted">{text}</p>}
      {action}
    </div>
  );
}

export function ErrorBox({ text, retry }: { text: string; retry?: () => void }) {
  return (
    <div role="alert" className="m-4 rounded-xl border border-danger/40 bg-danger/10 p-4 text-sm">
      <p>{text}</p>
      {retry && (
        <Button variant="secondary" size="sm" className="mt-3" onClick={retry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    el?.querySelector<HTMLElement>('input,textarea,button:not([data-close]),select,[tabindex]')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab' && el) {
        // Keep focus inside the dialog.
        const f = [...el.querySelectorAll<HTMLElement>('a,button,input,textarea,select,[tabindex]:not([tabindex="-1"])')].filter((x) => !x.hasAttribute('disabled'));
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title} className={cx('safe-b max-h-[90dvh] w-full overflow-y-auto rounded-t-2xl border border-line bg-panel p-5 shadow-2xl sm:rounded-2xl', wide ? 'sm:max-w-2xl' : 'sm:max-w-md')}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <IconButton label="Close" onClick={onClose} data-close>
            <X className="size-5" />
          </IconButton>
        </div>
        {children}
      </div>
    </div>
  );
}

// ----- confirm dialog -----

interface ConfirmOpts {
  title: string;
  text?: string;
  confirm?: string;
  danger?: boolean;
}
const ConfirmCtx = createContext<(o: ConfirmOpts) => Promise<boolean>>(async () => false);
export const useConfirm = () => useContext(ConfirmCtx);

// ----- toasts -----

interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error' | 'ok';
  action?: { label: string; run: () => void };
}
const ToastCtx = createContext<(text: string, kind?: Toast['kind'], action?: Toast['action']) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function UiProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirm, setConfirm] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null);
  const toast = useCallback((text: string, kind: Toast['kind'] = 'info', action?: Toast['action']) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, text, kind, action }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 6000 : 4000);
  }, []);
  const ask = useCallback((o: ConfirmOpts) => new Promise<boolean>((resolve) => setConfirm({ ...o, resolve })), []);
  const close = (v: boolean) => {
    confirm?.resolve(v);
    setConfirm(null);
  };
  return (
    <ToastCtx.Provider value={toast}>
      <ConfirmCtx.Provider value={ask}>
        {children}
        <div className="safe-t pointer-events-none fixed inset-x-0 top-3 z-[70] flex flex-col items-center gap-2 px-4" aria-live="polite">
          {toasts.map((t) => (
            <div
              key={t.id}
              role={t.kind === 'error' ? 'alert' : 'status'}
              className={cx('pointer-events-auto flex max-w-md items-center gap-3 rounded-xl border px-4 py-3 text-sm shadow-xl', t.kind === 'error' ? 'border-danger/50 bg-[#2a1416] text-white' : 'border-line bg-panel-2')}
            >
              <span>{t.text}</span>
              {t.action && (
                <button className="font-semibold text-accent" onClick={t.action.run}>
                  {t.action.label}
                </button>
              )}
            </div>
          ))}
        </div>
        <Modal open={Boolean(confirm)} onClose={() => close(false)} title={confirm?.title ?? ''}>
          {confirm?.text && <p className="mb-5 text-sm text-muted">{confirm.text}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => close(false)}>
              Cancel
            </Button>
            <Button variant={confirm?.danger ? 'danger' : 'primary'} onClick={() => close(true)}>
              {confirm?.confirm ?? 'OK'}
            </Button>
          </div>
        </Modal>
      </ConfirmCtx.Provider>
    </ToastCtx.Provider>
  );
}

export function Switch({ checked, onChange, label, description }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: string }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 py-3">
      <span>
        <span className="block text-sm font-medium">{label}</span>
        {description && <span className="block text-xs text-muted">{description}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={cx('relative h-[31px] w-[51px] shrink-0 rounded-full transition-colors duration-200', checked ? 'bg-ok' : 'bg-hover')}
      >
        <span className={cx('absolute top-[2px] size-[27px] rounded-full bg-white shadow-[0_3px_8px_rgba(0,0,0,0.15),0_1px_1px_rgba(0,0,0,0.16)] transition-[left] duration-200', checked ? 'left-[22px]' : 'left-[2px]')} />
      </button>
    </label>
  );
}

export function Select<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label: string }) {
  return (
    <label className="flex items-center justify-between gap-4 py-3">
      <span className="text-sm font-medium">{label}</span>
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value as T)} className="h-9 rounded-lg border border-line bg-panel-2 px-2 text-sm">
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Card({ title, children, className }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <section className={className}>
      {title && <h2 className="mb-1.5 px-4 text-[13px] text-muted">{title}</h2>}
      <div className="rounded-xl bg-panel px-4 py-2">{children}</div>
    </section>
  );
}
