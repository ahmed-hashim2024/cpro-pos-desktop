import { useEffect, useRef, useState } from 'react';
import { Globe, Loader2, RotateCcw, ExternalLink, CheckCircle2 } from 'lucide-react';
import { api } from '@/lib/api';
import { openExternal } from '@/lib/open';
import { Button } from '@/components/ui';
import { T } from '@/lib/i18n';

// Links this computer to the owner's account from the browser: the app gets
// a short code, opens the Platform's /link page (sign in or sign up there,
// with Google or email), and waits for the owner to approve.
//
// setup: first run (before any local user exists) uses /setup/link.
export function BrowserLink({ setup = false, auto = false, onDone, deviceName = '' }) {
  const base = setup ? '/setup/link' : '/platform/link';
  const [link, setLink] = useState(null); // {state, code, url}
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const started = useRef(false);
  const done = useRef(onDone);
  done.current = onDone;

  const start = async () => {
    setBusy(true);
    setError('');
    try {
      const l = await api.post(base, { device_name: deviceName });
      setLink(l);
      openExternal(l.url);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (auto && !started.current) {
      started.current = true;
      start();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto]);

  useEffect(() => {
    if (link?.state !== 'pending') return undefined;
    let stop = false;
    const t = setInterval(async () => {
      try {
        const l = await api.get(base);
        if (stop) return;
        if (l.state === 'idle') return;
        setLink((cur) => ({ ...cur, ...l }));
        if (l.state === 'approved') done.current?.();
      } catch (e) {
        setError(e.message);
      }
    }, 2000);
    return () => { stop = true; clearInterval(t); };
  }, [link?.state, base]);

  if (link?.state === 'approved') {
    return (
      <div className="flex items-center gap-3 rounded-2xl bg-success-soft p-4 font-semibold text-success">
        <CheckCircle2 className="size-6" aria-hidden />{T('تم ربط البرنامج بحسابك')}
      </div>
    );
  }

  if (link?.state === 'pending') {
    return (
      <div className="grid gap-3 rounded-2xl border border-line bg-surface-2 p-4 text-center">
        <p className="text-sm text-muted">{T('سجّل الدخول في المتصفح ثم اضغط «ربط الجهاز». تأكد إن الكود ده هو نفس الكود الظاهر هناك:')}</p>
        <div className="num text-3xl font-black tracking-[0.2em]" dir="ltr">{link.code}</div>
        <div className="flex items-center justify-center gap-2 text-sm text-muted">
          <Loader2 className="size-4 animate-spin" aria-hidden />{T('في انتظار الموافقة من المتصفح…')}
        </div>
        <div className="flex justify-center gap-2">
          <Button size="sm" variant="secondary" icon={ExternalLink} onClick={() => openExternal(link.url)}>{T('فتح المتصفح مرة أخرى')}</Button>
          <Button size="sm" variant="ghost" icon={RotateCcw} onClick={start} busy={busy}>{T('كود جديد')}</Button>
        </div>
        {error && <p className="text-sm text-danger">{error}</p>}
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      {link && (link.state === 'denied' || link.state === 'expired') && (
        <p className="rounded-xl bg-warning-soft p-3 text-sm text-warning">
          {link.state === 'denied' ? T('تم رفض الربط من المتصفح') : T('انتهت صلاحية الكود، ابدأ من جديد')}
        </p>
      )}
      <Button size="lg" icon={Globe} busy={busy} onClick={start}>{T('تسجيل الدخول من المتصفح')}</Button>
      <p className="text-center text-xs text-muted">{T('هيفتح المتصفح لتسجيل حساب جديد أو الدخول بحسابك (جوجل أو الإيميل)')}</p>
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}
