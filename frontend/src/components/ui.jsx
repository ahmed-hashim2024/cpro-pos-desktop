import { useEffect, useState, useCallback, useRef } from 'react';
import { X, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { useToast, toastError } from '@/lib/store';

export const cx = (...c) => c.filter(Boolean).join(' ');

// ---- buttons -----------------------------------------------------------------

const variants = {
  primary: 'bg-brand text-white shadow-sm shadow-primary/30 hover:brightness-110 disabled:opacity-50 disabled:shadow-none',
  secondary: 'bg-surface text-fg border border-line hover:bg-surface-2 disabled:opacity-50',
  soft: 'bg-primary-soft text-primary-ink hover:brightness-95 disabled:opacity-50',
  danger: 'bg-danger text-white hover:brightness-110 disabled:opacity-50',
  'danger-soft': 'bg-danger-soft text-danger border border-danger/20 hover:brightness-95 disabled:opacity-50',
  ghost: 'text-muted hover:bg-surface-2 hover:text-fg disabled:opacity-50',
  success: 'bg-success text-white hover:brightness-110 disabled:opacity-50',
};
const sizes = { sm: 'h-8 px-3 text-sm rounded-lg', md: 'h-10 px-4 rounded-xl', lg: 'h-12 px-6 text-base rounded-xl', xl: 'h-14 px-6 text-lg rounded-2xl' };

export function Button({ variant = 'primary', size = 'md', busy, icon: Icon, className, children, ...p }) {
  return (
    <button {...p} disabled={p.disabled || busy}
      className={cx('inline-flex items-center justify-center gap-2 font-semibold whitespace-nowrap transition duration-150 active:scale-[.98]', variants[variant], sizes[size], className)}>
      {busy ? <Loader2 className="size-4 animate-spin" /> : Icon && <Icon className="size-4" aria-hidden />}
      {children}
    </button>
  );
}

export function IconButton({ icon: Icon, label, className, active, ...p }) {
  return (
    <button {...p} aria-label={label} title={label}
      className={cx('inline-flex size-10 items-center justify-center rounded-xl border transition',
        active ? 'border-primary bg-primary-soft text-primary-ink' : 'border-line bg-surface text-muted hover:bg-surface-2 hover:text-fg', className)}>
      <Icon className="size-[18px]" aria-hidden />
    </button>
  );
}

// ---- form fields -------------------------------------------------------------

export function Field({ label, hint, children, className }) {
  return (
    <label className={cx('block', className)}>
      {label && <span className="mb-1.5 block text-sm font-semibold text-fg">{label}</span>}
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

const inputCls = 'h-10 min-w-0 rounded-xl border border-line bg-surface px-3 text-fg placeholder:text-muted/70 outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/15 disabled:bg-surface-2 disabled:text-muted';
// Full width unless the caller sizes the field itself (w-*, flex-1).
const sized = (className) => cx(inputCls, /(^|\s)(w-|flex-1)/.test(className || '') ? '' : 'w-full', className);
export const Input = ({ className, ...p }) => <input {...p} className={sized(className)} />;
export const Textarea = ({ className, ...p }) => <textarea {...p} className={cx(sized(className), 'h-20 py-2')} />;
export const Select = ({ className, children, ...p }) => <select {...p} className={sized(className)}>{children}</select>;

export function SearchInput({ className, ...p }) {
  return (
    <div className={cx('relative', className)}>
      <svg className="pointer-events-none absolute right-3 top-1/2 size-[18px] -translate-y-1/2 text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
      </svg>
      <input {...p} className={cx(inputCls, 'h-11 w-full bg-surface-2 pr-10 focus:bg-surface')} />
    </div>
  );
}

export function Checkbox({ label, checked, onChange }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-fg">
      <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={!!checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export function Segmented({ options, value, onChange, className }) {
  return (
    <div className={cx('grid gap-1 rounded-xl bg-surface-2 p-1', className)} style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map(([k, label]) => (
        <button key={k} onClick={() => onChange(k)} aria-pressed={value === k}
          className={cx('rounded-lg py-1.5 text-sm font-semibold transition', value === k ? 'bg-surface text-primary-ink shadow-card' : 'text-muted hover:text-fg')}>
          {label}
        </button>
      ))}
    </div>
  );
}

// ---- surfaces ----------------------------------------------------------------

export function Card({ title, icon: Icon, actions, children, className, bodyClass = 'p-5' }) {
  return (
    <section className={cx('rounded-card border border-line bg-surface shadow-card', className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-2 border-b border-line px-5 py-3.5">
          <h3 className="flex items-center gap-2 font-bold">
            {Icon && <Icon className="size-[18px] text-primary" aria-hidden />}{title}
          </h3>
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        </header>
      )}
      <div className={bodyClass}>{children}</div>
    </section>
  );
}

const tones = {
  primary: 'bg-primary-soft text-primary-ink', success: 'bg-success-soft text-success', warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger', info: 'bg-info-soft text-info', gray: 'bg-surface-2 text-muted',
};

export function Stat({ label, value, sub, icon: Icon, tone = 'primary' }) {
  return (
    <div className="rounded-card border border-line bg-surface p-5 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div className="text-sm font-semibold text-muted">{label}</div>
        {Icon && <span className={cx('flex size-10 shrink-0 items-center justify-center rounded-xl', tones[tone] || tones.primary)}><Icon className="size-5" aria-hidden /></span>}
      </div>
      <div className="num mt-2 text-[1.75rem] font-bold leading-tight" style={{ direction: 'rtl' }}>{value}</div>
      {sub && <div className="mt-1 text-xs text-muted">{sub}</div>}
    </div>
  );
}

export function Badge({ tone = 'gray', children, dot }) {
  const map = { ...tones, green: tones.success, red: tones.danger, amber: tones.warning, blue: tones.info };
  return (
    <span className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold', map[tone])}>
      {dot && <span className="size-1.5 rounded-full bg-current" />}{children}
    </span>
  );
}

export function Modal({ open, onClose, title, subtitle, icon: Icon, children, footer, size = 'md' }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  const widths = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl' };
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-[3px]" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}
        className={cx('flex max-h-full w-full flex-col overflow-hidden rounded-3xl border border-line bg-surface shadow-pop', widths[size])} onMouseDown={(e) => e.stopPropagation()}>
        <header className="bg-brand flex items-center gap-3 px-6 py-4 text-white">
          {Icon && <span className="flex size-11 items-center justify-center rounded-xl bg-white/20"><Icon className="size-5" aria-hidden /></span>}
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-bold">{title}</h2>
            {subtitle && <p className="text-sm text-white/80">{subtitle}</p>}
          </div>
          <button aria-label="إغلاق" className="flex size-10 items-center justify-center rounded-xl bg-white/15 hover:bg-white/25" onClick={onClose}><X className="size-5" /></button>
        </header>
        <div className="overflow-y-auto bg-bg/40 p-6">{children}</div>
        {footer && <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-surface px-6 py-4">{footer}</footer>}
      </div>
    </div>
  );
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div role="tablist" className="mb-5 flex flex-wrap gap-1 rounded-2xl border border-line bg-surface p-1 shadow-card">
      {tabs.map(([key, label, Icon]) => (
        <button key={key} role="tab" aria-selected={value === key} onClick={() => onChange(key)}
          className={cx('flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition',
            value === key ? 'bg-primary-soft text-primary-ink' : 'text-muted hover:bg-surface-2 hover:text-fg')}>
          {Icon && <Icon className="size-4" aria-hidden />}{label}
        </button>
      ))}
    </div>
  );
}

export function Table({ head, children, empty = 'لا توجد بيانات', className }) {
  const rows = Array.isArray(children) ? children.filter(Boolean) : children;
  const isEmpty = Array.isArray(rows) && rows.length === 0;
  return (
    <div className={cx('overflow-auto rounded-card border border-line bg-surface shadow-card', className)}>
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-[1] bg-surface-2 text-muted">
          <tr>{head.map((h, i) => <th key={i} className="whitespace-nowrap px-4 py-3 text-right text-xs font-bold">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-line">
          {isEmpty ? <tr><td colSpan={head.length} className="px-4 py-14 text-center text-muted">{empty}</td></tr> : rows}
        </tbody>
      </table>
    </div>
  );
}
export const Td = ({ className, ...p }) => <td {...p} className={cx('px-4 py-3', className)} />;

export const Spinner = () => <div className="flex justify-center p-12"><Loader2 className="size-7 animate-spin text-primary" aria-label="جارٍ التحميل" /></div>;

// Page title block: icon tile, title, subtitle, breadcrumb chip, actions.
export function PageHeader({ title, subtitle, icon: Icon, crumb, children }) {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-line pb-5">
      <div className="flex items-center gap-4">
        {Icon && (
          <span className="flex size-16 items-center justify-center rounded-2xl border border-line bg-surface text-primary shadow-card">
            <Icon className="size-8" aria-hidden />
          </span>
        )}
        <div>
          <h1 className="text-2xl font-bold">{title}</h1>
          {subtitle && <p className="mt-0.5 text-muted">{subtitle}</p>}
          {crumb && <span className="mt-1.5 inline-block rounded-full bg-primary-soft px-3 py-0.5 text-xs font-semibold text-primary-ink">{crumb}</span>}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

export function DateRange({ from, to, onChange }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-line bg-surface p-1 shadow-card">
      <input type="date" aria-label="من" value={from} onChange={(e) => onChange(e.target.value, to)} className="h-8 rounded-lg bg-transparent px-2 text-sm outline-none focus:bg-surface-2" />
      <span className="text-muted">←</span>
      <input type="date" aria-label="إلى" value={to} onChange={(e) => onChange(from, e.target.value)} className="h-8 rounded-lg bg-transparent px-2 text-sm outline-none focus:bg-surface-2" />
    </div>
  );
}

export function Toasts() {
  const items = useToast((s) => s.items);
  return (
    <div className="pointer-events-none fixed bottom-5 left-5 z-50 flex flex-col gap-2" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={cx('flex items-center gap-2 rounded-xl border px-4 py-3 font-semibold shadow-pop',
          t.kind === 'error' ? 'border-danger/30 bg-danger-soft text-danger' : 'border-success/30 bg-success-soft text-success')}>
          {t.kind === 'error' ? <AlertCircle className="size-5" /> : <CheckCircle2 className="size-5" />}{t.msg}
        </div>
      ))}
    </div>
  );
}

// useLoad fetches data, re-fetching when deps change; reload() refreshes.
export function useLoad(fn, deps = [], { poll } = {}) {
  const [state, set] = useState({ data: null, loading: true, error: null });
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const reload = useCallback(async (quiet) => {
    if (!quiet) set((s) => ({ ...s, loading: true }));
    try {
      const data = await fnRef.current();
      set({ data, loading: false, error: null });
    } catch (e) {
      set((s) => ({ ...s, loading: false, error: e }));
      if (!quiet) toastError(e);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    reload();
    if (!poll) return;
    const t = setInterval(() => reload(true), poll);
    return () => clearInterval(t);
  }, [reload, poll]);
  return { ...state, reload };
}

// useAction wraps an async call with a busy flag and error toast.
export function useAction() {
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (fn) => {
    setBusy(true);
    try {
      return await fn();
    } catch (e) {
      toastError(e);
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);
  return [busy, run];
}

export function Empty({ icon: Icon, title, children }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 p-12 text-center">
      {Icon && <span className="flex size-20 items-center justify-center rounded-full bg-primary-soft text-primary"><Icon className="size-9" aria-hidden /></span>}
      {title && <div className="text-lg font-bold">{title}</div>}
      <div className="text-muted">{children}</div>
    </div>
  );
}
