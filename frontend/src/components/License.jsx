import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { KeyRound, ShieldAlert, ShieldCheck, Clock, ExternalLink, LogOut } from 'lucide-react';
import { api } from '@/lib/api';
import { useApp, toast, toastError } from '@/lib/store';
import { dateTime } from '@/lib/format';
import { openExternal } from '@/lib/open';
import { Button, Field, Input, cx } from '@/components/ui';
import { T } from '@/lib/i18n';

export const licenseReason = (p) => {
  if (p?.reason === 'trial_ended') {
    return p.linked
      ? T('انتهت الفترة التجريبية. اشترك من حسابك على المنصة ثم اضغط مزامنة')
      : T('انتهت الفترة التجريبية. ادخل على المنصة، خد كود التفعيل من حسابك واكتبه هنا');
  }
  return {
    expired: T('انتهى الاشتراك. جدّده من حسابك على المنصة ثم اضغط مزامنة'),
    suspended: T('الحساب موقوف. تواصل مع الدعم'),
    revoked: T('تم إيقاف هذا الجهاز من حسابك على المنصة. فعّله مرة أخرى بكود التفعيل'),
  }[p?.reason] || T('فعّل البرنامج بكود التفعيل الموجود في حسابك على المنصة');
};

const daysLeft = (iso) => Math.max(Math.ceil((new Date(iso) - Date.now()) / 864e5), 0);

// Where the owner finds the activation key on the Platform.
export const openAccount = (p) => p?.url && openExternal(`${p.url}/portal/pos`);

// The activation key form (Settings and the activation alert).
export function ActivationForm({ onDone, compact }) {
  const loadPlatform = useApp((s) => s.loadPlatform);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post('/platform/activate', { code, device_name: name });
      await loadPlatform();
      toast(T('تم تفعيل البرنامج'));
      onDone?.();
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className={cx('grid gap-3', !compact && 'sm:grid-cols-[2fr_1fr_auto] sm:items-end')}>
      <Field label={T('كود التفعيل')} hint={compact ? T('تجده في حسابك على المنصة ← برنامج الكاشير') : undefined}>
        <Input autoFocus dir="ltr" className="num uppercase tracking-wider" placeholder="ACT-XXXXXXXXXX" value={code} onChange={(e) => setCode(e.target.value)} />
      </Field>
      <Field label={T('اسم الجهاز')}>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={T('الكاشير الرئيسي')} />
      </Field>
      <Button busy={busy} icon={KeyRound} disabled={code.trim().length < 6}>{T('تفعيل')}</Button>
    </form>
  );
}

// Shown over every screen while selling is blocked (trial over, expired,
// suspended, revoked). It can't be dismissed: it goes away only once the
// app may sell again.
export function ActivationAlert() {
  const { me, platform, can, canSell, logout, loadPlatform } = useApp();
  // Re-check now and then so the alert shows when the trial runs out, and
  // goes away once the subscription is renewed on the Platform.
  useEffect(() => {
    if (!me) return undefined;
    const t = setInterval(loadPlatform, 60_000);
    return () => clearInterval(t);
  }, [me, loadPlatform]);
  if (!me || !platform?.enabled || canSell()) return null;
  const owner = can('settings.manage');
  const title = platform.reason === 'trial_ended' ? T('انتهت الفترة التجريبية')
    : platform.reason === 'expired' ? T('انتهى الاشتراك') : T('البيع متوقف');
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
      <div role="alertdialog" aria-modal="true" aria-labelledby="activation-title"
        className="w-full max-w-md rounded-3xl border border-line bg-surface p-6 text-center shadow-pop motion-safe:animate-[pop_.2s_ease-out]">
        <span className="mx-auto flex size-20 items-center justify-center rounded-full border-4 border-warning/30 text-warning">
          <ShieldAlert className="size-10" aria-hidden />
        </span>
        <h2 id="activation-title" className="mt-4 text-2xl font-bold">{title}</h2>
        <p className="mt-2 text-muted">{licenseReason(platform)}</p>
        {owner ? (
          <div className="mt-5 grid gap-4 text-start">
            {platform.url && (
              <Button type="button" variant="secondary" icon={ExternalLink} onClick={() => openAccount(platform)}>
                {T('افتح المنصة وخد كود التفعيل')}
              </Button>
            )}
            {platform.linked && platform.reason !== 'revoked'
              ? <SyncButton />
              : <ActivationForm compact />}
          </div>
        ) : (
          <p className="mt-5 rounded-xl bg-surface-2 p-3 text-sm">{T('اطلب من المالك إدخال كود التفعيل')}</p>
        )}
        <p className="mt-4 text-xs text-muted">{T('بياناتك محفوظة على هذا الجهاز والنسخ الاحتياطي التلقائي شغال')}</p>
        <button type="button" onClick={logout} className="mt-3 inline-flex items-center gap-1.5 text-sm text-muted underline-offset-2 hover:text-fg hover:underline">
          <LogOut className="size-4" aria-hidden />{T('تسجيل الخروج')}
        </button>
      </div>
    </div>
  );
}

function SyncButton() {
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
  return <Button type="button" busy={busy} onClick={sync}>{T('مزامنة الآن')}</Button>;
}

// Thin strip above every screen when the license needs attention.
export function LicenseBanner() {
  const { platform, can } = useApp();
  if (!platform?.enabled) return null;
  const { state } = platform;
  let tone, icon, text;
  if (state === 'grace') {
    tone = 'bg-warning-soft text-warning';
    icon = Clock;
    text = T('لا يوجد اتصال بالمنصة منذ مدة. البيع متاح حتى {0}', [dateTime(platform.grace_until)]);
  } else if (state === 'trial' && platform.expires_at) {
    tone = 'bg-info-soft text-info';
    icon = ShieldCheck;
    text = platform.linked
      ? T('الفترة التجريبية تنتهي خلال {0} يوم', [daysLeft(platform.expires_at)])
      : T('نسخة تجريبية: باقي {0} يوم. فعّل البرنامج بكود التفعيل من حسابك على المنصة', [daysLeft(platform.expires_at)]);
  } else return null;
  const Icon = icon;
  return (
    <div className={cx('flex items-center gap-2 px-4 py-2 text-sm font-semibold', tone)} role="status">
      <Icon className="size-4 shrink-0" aria-hidden />
      <span className="flex-1">{text}</span>
      {can('settings.manage') && <Link to="/settings?tab=platform" className="underline underline-offset-2">{T('تفعيل')}</Link>}
    </div>
  );
}
