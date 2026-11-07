import { useEffect, useRef, useState } from 'react';
import { Check, Globe, Loader2, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useApp, toastError } from '@/lib/store';
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
        update(r.available ? { status: 'free', domain: r.domain } : { status: ['taken', 'has_tunnel'].includes(r.reason) ? r.reason : 'invalid', domain: r.domain || '' });
      } catch {
        if (!stale) update({ status: 'error', domain: '' });
      }
    }, 400);
    return () => { stale = true; clearTimeout(t); };
  }, [value]);

  const { status, domain } = state;
  const message = {
    idle: [T('اكتب اسم المطعم بالأحرف الإنجليزية؛ فهو الذي يظهر في رابط قائمة الطعام'), 'text-muted'],
    checking: [T('جارٍ التحقق من توفر الاسم…'), 'text-muted'],
    free: [`${T('متاح')}: ${domain}`, 'text-success'],
    taken: [T('هذا الاسم محجوز، اختر اسماً آخر'), 'text-danger'],
    has_tunnel: [`${T('لحسابك رابط بالفعل')}: ${domain}`, 'text-danger'],
    invalid: [T('استخدم الحروف الإنجليزية والأرقام والشَّرطة (-) فقط'), 'text-danger'],
    error: [T('تعذّر التحقق من الاسم، تأكد من الاتصال بالإنترنت'), 'text-danger'],
  }[status];
  const Icon = { checking: Loader2, free: Check, taken: X, has_tunnel: X, invalid: X, error: X }[status];
  return (
    <Field label={T('رابط قائمة الطعام الإلكترونية')}>
      <Input dir="ltr" value={value} maxLength={63} placeholder="pizza-house" aria-label={T('رابط قائمة الطعام الإلكترونية')}
        onChange={(e) => onChange(e.target.value.toLowerCase().trim())} />
      <span role="status" className={cx('mt-1 flex items-center gap-1 text-xs', message[1])} dir="auto">
        {Icon && <Icon className={cx('size-3.5 shrink-0', status === 'checking' && 'animate-spin')} aria-hidden />}{message[0]}
      </span>
    </Field>
  );
}

// How long to wait for the Platform's background job before saying so.
const CLAIM_TIMEOUT = 90_000;

// For an account connected without a domain (Settings → Subscription). The
// Platform builds the tunnel in the background, so "created" isn't known yet:
// this waits until the domain arrives, a failure arrives, or time runs out.
export function DomainForm({ name }) {
  const { platform, loadPlatform } = useApp();
  const [value, setValue] = useState(() => slugify(name));
  const [status, setStatus] = useState('idle');
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const failed = platform?.domain_error;

  useEffect(() => {
    if (!waiting) return undefined;
    const poll = setInterval(loadPlatform, 5000);
    const stop = setTimeout(() => { setWaiting(false); setTimedOut(true); }, CLAIM_TIMEOUT);
    return () => { clearInterval(poll); clearTimeout(stop); };
  }, [waiting, loadPlatform]);
  useEffect(() => { if (failed) setWaiting(false); }, [failed]);

  const claim = async () => {
    setBusy(true);
    setTimedOut(false);
    try {
      const r = await api.post('/platform/domain', { subdomain: value });
      if (r.available) {
        await loadPlatform(); // clears the last failure before waiting
        setWaiting(true);
      } else toastError(new Error(T('هذا الاسم محجوز، اختر اسماً آخر')));
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  if (waiting) {
    return <p className="flex items-center gap-2 text-sm text-muted"><Loader2 className="size-4 animate-spin" aria-hidden />{T('جارٍ تجهيز رابط قائمة الطعام، وسيعمل تلقائياً خلال دقيقة')}</p>;
  }
  return (
    <div className="grid gap-3">
      {failed && <p role="alert" className="rounded-xl bg-danger-soft p-2.5 text-sm text-danger" dir="auto">{T('تعذّر إنشاء الرابط')}: {failed}</p>}
      {timedOut && <p role="alert" className="rounded-xl bg-warning-soft p-2.5 text-sm text-warning">{T('لم يُجهَّز الرابط بعد. أعد المحاولة، وإن استمرت المشكلة فتواصل مع الدعم الفني.')}</p>}
      <DomainField value={value} onChange={setValue} onStatus={setStatus} />
      <div><Button icon={Globe} busy={busy} disabled={status !== 'free'} onClick={claim}>{T('إنشاء الرابط')}</Button></div>
    </div>
  );
}
