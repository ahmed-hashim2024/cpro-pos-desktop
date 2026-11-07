import { useEffect, useState } from 'react';
import { ShieldAlert, ExternalLink, LogOut, Loader2, WifiOff, CalendarClock } from 'lucide-react';
import { api } from '@/lib/api';
import { useApp, toastError } from '@/lib/store';
import { openExternal } from '@/lib/open';
import { Button, cx } from '@/components/ui';
import { T } from '@/lib/i18n';

export const licenseReason = (p) => ({
  trial_ended: T('انتهت الفترة التجريبية. اشترك من حسابك على المنصة ثم اضغط مزامنة'),
  suspended: T('الحساب موقوف. تواصل مع الدعم'),
  revoked: T('أُزيل هذا الجهاز من حسابك على المنصة. اربطه مرة أخرى للمتابعة'),
  offline: T('جميع بياناتك محفوظة ولم يُفقد شيء. صِل الجهاز بالإنترنت وسيعود إلى العمل تلقائياً خلال دقيقة.'),
}[p?.reason] || T('اربط البرنامج بحسابك للبدء'));

const daysLeft = (iso) => Math.max(Math.ceil((new Date(iso) - Date.now()) / 864e5), 0);

// Where the owner manages the subscription on the Platform.
export const openAccount = (p) => p?.url && openExternal(`${p.url}/portal/pos`);

function GoogleIcon() {
  return (
    <svg className="size-5" viewBox="0 0 24 24" aria-hidden>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.99.66-2.25 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.85A11 11 0 0012 23z" />
      <path fill="#FBBC05" d="M5.84 14.09A6.6 6.6 0 015.5 12c0-.73.13-1.43.34-2.09V7.07H2.18A11 11 0 001 12c0 1.77.43 3.45 1.18 4.93l3.66-2.84z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  );
}

// «Continue with Google»: opens the Platform in the browser (sign up or log
// in) and waits for the app to be connected. No key to type.
export function ConnectGoogle({ onDone }) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    if (!url) return undefined;
    const t = setInterval(async () => {
      try {
        const st = await api.get('/platform/connect');
        if (st.state === 'done') { clearInterval(t); setUrl(''); onDone?.(); }
        if (st.state === 'failed') { clearInterval(t); setUrl(''); setError(st.error); }
      } catch { /* the next tick retries */ }
    }, 1500);
    return () => clearInterval(t);
  }, [url, onDone]);
  const start = async () => {
    setError('');
    try {
      const r = await api.post('/platform/connect');
      setUrl(r.url);
      openExternal(r.url);
    } catch (e) {
      setError(e.message);
    }
  };
  return (
    <div className="grid gap-3">
      <button type="button" onClick={start} disabled={!!url}
        className="flex h-12 w-full items-center justify-center gap-3 rounded-xl border border-line bg-surface font-bold shadow-card transition hover:bg-surface-2 disabled:opacity-60" dir="ltr">
        {url ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <GoogleIcon />}Continue with Google
      </button>
      {url && (
        <p className="text-center text-sm text-muted">
          {T('أكمل تسجيل الدخول في المتصفح، وسيُفعَّل البرنامج تلقائياً.')}{' '}
          <button type="button" className="font-semibold text-primary hover:underline" onClick={() => openExternal(url)}>{T('أعد فتح الصفحة')}</button>
        </p>
      )}
      {error && <p role="alert" className="rounded-xl bg-danger-soft p-2.5 text-center text-sm text-danger" dir="auto">{error}</p>}
    </div>
  );
}

// Shown over every screen while the app can't be used (not connected, trial
// over, suspended, removed, or offline for too long). It can't be dismissed:
// it goes away by itself once that's fixed.
export function ActivationAlert() {
  const { me, platform, can, canSell, logout, loadPlatform } = useApp();
  // Re-check now and then so it appears when time runs out and goes away as
  // soon as the app is back online or the subscription is renewed.
  useEffect(() => {
    if (!me) return undefined;
    const t = setInterval(loadPlatform, 60_000);
    return () => clearInterval(t);
  }, [me, loadPlatform]);
  if (!me || !platform?.enabled || canSell()) return null;
  const owner = can('settings.manage');
  const { reason } = platform;
  const offline = reason === 'offline';
  const connect = reason === 'not_connected' || reason === 'revoked';
  const title = { trial_ended: T('انتهت الفترة التجريبية'), offline: T('البرنامج يحتاج إلى الاتصال بالإنترنت'), not_connected: T('اربط البرنامج بحسابك'), revoked: T('اربط الجهاز بحسابك') }[reason] || T('البيع متوقف');
  const Icon = offline ? WifiOff : ShieldAlert;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
      <div role="alertdialog" aria-modal="true" aria-labelledby="activation-title"
        className="w-full max-w-md rounded-3xl border border-line bg-surface p-6 text-center shadow-pop motion-safe:animate-[pop_.2s_ease-out]">
        <span className="mx-auto flex size-20 items-center justify-center rounded-full border-4 border-warning/30 text-warning">
          <Icon className="size-10" aria-hidden />
        </span>
        <h2 id="activation-title" className="mt-4 text-2xl font-bold">{title}</h2>
        <p className="mt-2 text-muted">{licenseReason(platform)}</p>
        {offline && <div className="mt-5"><SyncButton label={T('حاول الآن')} /></div>}
        {!offline && (owner ? (
          <div className="mt-5 grid gap-3 text-start">
            {connect ? <ConnectGoogle onDone={loadPlatform} /> : (
              <>
                {platform.url && <Button type="button" variant="secondary" icon={ExternalLink} onClick={() => openAccount(platform)}>{T('افتح حسابي على المنصة')}</Button>}
                <SyncButton />
              </>
            )}
          </div>
        ) : (
          <p className="mt-5 rounded-xl bg-surface-2 p-3 text-sm">{T('اطلب من المالك إتمام هذه الخطوة')}</p>
        ))}
        <p className="mt-4 text-xs text-muted">{T('بياناتك محفوظة على هذا الجهاز، والنسخ الاحتياطي التلقائي مفعّل')}</p>
        <button type="button" onClick={logout} className="mt-3 inline-flex items-center gap-1.5 text-sm text-muted underline-offset-2 hover:text-fg hover:underline">
          <LogOut className="size-4" aria-hidden />{T('تسجيل الخروج')}
        </button>
      </div>
    </div>
  );
}

function SyncButton({ label = T('مزامنة الآن') }) {
  const loadPlatform = useApp((s) => s.loadPlatform);
  const [busy, setBusy] = useState(false);
  const sync = async () => {
    setBusy(true);
    try {
      await api.post('/platform/sync');
      await loadPlatform();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  return <Button type="button" busy={busy} onClick={sync}>{label}</Button>;
}

// Counts down, one day at a time, once the app has been offline too long.
export function LicenseBanner() {
  const platform = useApp((s) => s.platform);
  if (!platform?.enabled || platform.state !== 'grace') return null;
  const days = daysLeft(platform.grace_until);
  return (
    <div className={cx('flex items-center gap-2 px-4 py-2 text-sm font-semibold', days <= 2 ? 'bg-danger-soft text-danger' : 'bg-warning-soft text-warning')} role="status">
      <CalendarClock className="size-4 shrink-0" aria-hidden />
      <span className="flex-1">
        {days > 1
          ? T('لم يتصل جهازك بالإنترنت منذ مدة. صِله في أقرب وقت ليستمر البرنامج في العمل — بقي {0} أيام', [days])
          : T('لم يتصل جهازك بالإنترنت منذ مدة. صِله اليوم ليستمر البرنامج في العمل — هذا هو اليوم الأخير')}
      </span>
    </div>
  );
}
