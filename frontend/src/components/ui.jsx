import { useEffect, useState, useCallback, useRef } from 'react';
import { X, Loader2 } from 'lucide-react';
import { useToast, toastError } from '@/lib/store';

export const cx = (...c) => c.filter(Boolean).join(' ');

const variants = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 disabled:bg-brand-600/50',
  secondary: 'bg-white text-ink border border-stone-300 hover:bg-stone-50',
  danger: 'bg-red-600 text-white hover:bg-red-700 disabled:bg-red-600/50',
  ghost: 'text-stone-700 hover:bg-stone-100',
  gold: 'bg-gold text-white hover:brightness-95',
};

export function Button({ variant = 'primary', size = 'md', busy, className, children, ...p }) {
  const sizes = { sm: 'h-8 px-3 text-sm', md: 'h-10 px-4', lg: 'h-14 px-6 text-lg' };
  return (
    <button
      {...p}
      disabled={p.disabled || busy}
      className={cx('inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition disabled:cursor-not-allowed', variants[variant], sizes[size], className)}
    >
      {busy && <Loader2 className="size-4 animate-spin" />}
      {children}
    </button>
  );
}

export function Field({ label, hint, children, className }) {
  return (
    <label className={cx('block', className)}>
      {label && <span className="mb-1 block text-sm font-medium text-stone-600">{label}</span>}
      {children}
      {hint && <span className="mt-1 block text-xs text-stone-500">{hint}</span>}
    </label>
  );
}

const inputCls = 'h-10 min-w-0 rounded-lg border border-stone-300 bg-white px-3 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 disabled:bg-stone-100';
// Full width unless the caller sizes the field itself (w-*, flex-1).
const sized = (className) => cx(inputCls, /(^|\s)(w-|flex-1)/.test(className || '') ? '' : 'w-full', className);
export const Input = ({ className, ...p }) => <input {...p} className={sized(className)} />;
export const Textarea = ({ className, ...p }) => <textarea {...p} className={cx(sized(className), 'h-20 py-2')} />;
export const Select = ({ className, children, ...p }) => (
  <select {...p} className={sized(className)}>{children}</select>
);

export function Checkbox({ label, checked, onChange }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2">
      <input type="checkbox" className="size-4 accent-brand-600" checked={!!checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export function Card({ title, actions, children, className }) {
  return (
    <section className={cx('rounded-xl border border-stone-200 bg-white', className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-2 border-b border-stone-100 px-4 py-3">
          <h3 className="font-bold">{title}</h3>
          <div className="flex gap-2">{actions}</div>
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Stat({ label, value, sub, tone = 'default' }) {
  const tones = { default: 'text-ink', good: 'text-brand-600', bad: 'text-red-600', gold: 'text-gold' };
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4">
      <div className="text-sm text-stone-500">{label}</div>
      <div className={cx('num mt-1 text-2xl font-bold', tones[tone])} style={{ direction: 'rtl' }}>{value}</div>
      {sub && <div className="mt-1 text-xs text-stone-500">{sub}</div>}
    </div>
  );
}

export function Badge({ tone = 'gray', children }) {
  const tones = {
    gray: 'bg-stone-100 text-stone-700', green: 'bg-brand-100 text-brand-700', red: 'bg-red-100 text-red-700',
    amber: 'bg-amber-100 text-amber-800', blue: 'bg-sky-100 text-sky-800',
  };
  return <span className={cx('inline-block rounded-full px-2 py-0.5 text-xs font-semibold', tones[tone])}>{children}</span>;
}

export function Modal({ open, onClose, title, children, footer, size = 'md' }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  const widths = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-3xl', xl: 'max-w-5xl' };
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" onMouseDown={onClose}>
      <div className={cx('flex max-h-full w-full flex-col rounded-2xl bg-white shadow-xl', widths[size])} onMouseDown={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between border-b border-stone-100 px-5 py-3">
          <h2 className="text-lg font-bold">{title}</h2>
          <button className="rounded p-1 text-stone-500 hover:bg-stone-100" onClick={onClose}><X className="size-5" /></button>
        </header>
        <div className="overflow-y-auto p-5">{children}</div>
        {footer && <footer className="flex justify-end gap-2 border-t border-stone-100 px-5 py-3">{footer}</footer>}
      </div>
    </div>
  );
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="mb-4 flex flex-wrap gap-1 rounded-xl bg-stone-100 p-1">
      {tabs.map(([key, label]) => (
        <button key={key} onClick={() => onChange(key)}
          className={cx('rounded-lg px-4 py-2 text-sm font-semibold', value === key ? 'bg-white shadow-sm text-brand-700' : 'text-stone-600 hover:text-ink')}>
          {label}
        </button>
      ))}
    </div>
  );
}

export function Table({ head, children, empty = 'لا توجد بيانات', className }) {
  const rows = Array.isArray(children) ? children.filter(Boolean) : children;
  const isEmpty = Array.isArray(rows) && rows.length === 0;
  return (
    <div className={cx('overflow-auto rounded-xl border border-stone-200 bg-white', className)}>
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-stone-50 text-stone-600">
          <tr>{head.map((h, i) => <th key={i} className="whitespace-nowrap px-3 py-2 text-right font-semibold">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-stone-100">
          {isEmpty ? <tr><td colSpan={head.length} className="px-3 py-10 text-center text-stone-400">{empty}</td></tr> : rows}
        </tbody>
      </table>
    </div>
  );
}
export const Td = ({ className, ...p }) => <td {...p} className={cx('px-3 py-2', className)} />;

export const Spinner = () => <div className="flex justify-center p-10"><Loader2 className="size-6 animate-spin text-brand-600" /></div>;

export function PageHeader({ title, children }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-2xl font-bold">{title}</h1>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

export function DateRange({ from, to, onChange }) {
  return (
    <div className="flex items-center gap-2">
      <Input type="date" value={from} onChange={(e) => onChange(e.target.value, to)} className="w-40" />
      <span className="text-stone-500">إلى</span>
      <Input type="date" value={to} onChange={(e) => onChange(from, e.target.value)} className="w-40" />
    </div>
  );
}

export function Toasts() {
  const items = useToast((s) => s.items);
  return (
    <div className="pointer-events-none fixed bottom-4 left-4 z-50 flex flex-col gap-2">
      {items.map((t) => (
        <div key={t.id} className={cx('rounded-lg px-4 py-3 font-semibold text-white shadow-lg', t.kind === 'error' ? 'bg-red-600' : 'bg-brand-700')}>
          {t.msg}
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

export function Empty({ icon: Icon, children }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 p-10 text-stone-400">
      {Icon && <Icon className="size-10" />}
      <div>{children}</div>
    </div>
  );
}
