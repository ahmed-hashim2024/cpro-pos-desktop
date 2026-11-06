import { useEffect, useRef, useState } from 'react';
import { Check, Globe, Loader2, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useApp, toast, toastError } from '@/lib/store';
import { Button, Field, Input, cx } from '@/components/ui';
import { T } from '@/lib/i18n';

// A menu address from the restaurant's name: English letters only, because
// that's all a domain takes. An Arabic name gives "" and the owner types one.
export const slugify = (name) => (name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

// The address field. It asks the Platform as you type whether the name is
// free, and reports idle | checking | free | taken | invalid | error.
export function DomainField({ value, onChange, onStatus }) {
  const [state, setState] = useState({ status: 'idle', domain: '' });
  const report = useRef(onStatus);
  report.current = onStatus;
  useEffect(() => {
    const update = (s) => { setState(s); report.current?.(s.status); };
    if (!value) { update({ status: 'idle', domain: '' }); return undefined; }
    update({ status: 'checking', domain: '' });
    let stale = false;
    const t = setTimeout(async () => {
      try {
        const r = await api.post('/platform/domain/check', { subdomain: value });
        if (stale) return;
        update(r.available ? { status: 'free', domain: r.domain } : { status: r.reason === 'taken' ? 'taken' : 'invalid', domain: '' });
      } catch {
        if (!stale) update({ status: 'error', domain: '' });
      }
    }, 400);
    return () => { stale = true; clearTimeout(t); };
  }, [value]);

  const { status, domain } = state;
  const message = {
    idle: [T('اكتب اسم المطعم بالإنجليزي، ده اللي هيظهر في رابط المنيو'), 'text-muted'],
    checking: [T('بنشوف الاسم متاح ولا لأ…'), 'text-muted'],
    free: [`${T('متاح')}: ${domain}`, 'text-success'],
    taken: [T('الاسم ده محجوز، اختار اسم تاني'), 'text-danger'],
    invalid: [T('استخدم حروف إنجليزي وأرقام وشرطة (-) بس'), 'text-danger'],
    error: [T('تعذر التحقق من الاسم، اتأكد من الإنترنت'), 'text-danger'],
  }[status];
  const Icon = { checking: Loader2, free: Check, taken: X, invalid: X, error: X }[status];
  return (
    <Field label={T('رابط المنيو الإلكتروني')}>
      <Input dir="ltr" value={value} maxLength={63} placeholder="pizza-house" aria-label={T('رابط المنيو الإلكتروني')}
        onChange={(e) => onChange(e.target.value.toLowerCase().trim())} />
      <span role="status" className={cx('mt-1 flex items-center gap-1 text-xs', message[1])} dir="auto">
        {Icon && <Icon className={cx('size-3.5 shrink-0', status === 'checking' && 'animate-spin')} aria-hidden />}{message[0]}
      </span>
    </Field>
  );
}

// For an account connected before it had a domain (Settings → Subscription).
export function DomainForm({ name }) {
  const loadPlatform = useApp((s) => s.loadPlatform);
  const [value, setValue] = useState(() => slugify(name));
  const [status, setStatus] = useState('idle');
  const [busy, setBusy] = useState(false);
  const [claimed, setClaimed] = useState(false);
  const claim = async () => {
    setBusy(true);
    try {
      await api.post('/platform/domain', { subdomain: value });
      setClaimed(true);
      toast(T('جاري تجهيز رابط المنيو، هيشتغل لوحده خلال دقيقة'));
      setTimeout(loadPlatform, 20000);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  if (claimed) return <p className="text-sm text-muted">{T('جاري تجهيز رابط المنيو، هيشتغل لوحده خلال دقيقة')}</p>;
  return (
    <div className="grid gap-3">
      <DomainField value={value} onChange={setValue} onStatus={setStatus} />
      <div><Button icon={Globe} busy={busy} disabled={status !== 'free'} onClick={claim}>{T('إنشاء الرابط')}</Button></div>
    </div>
  );
}
