import { useState } from 'react';
import { Link } from 'react-router-dom';
import { KeyRound, LayoutDashboard, ShieldAlert, ShieldCheck, Clock } from 'lucide-react';
import { api } from '@/lib/api';
import { useApp, toast, toastError } from '@/lib/store';
import { dateTime } from '@/lib/format';
import { Button, Field, Input, cx } from '@/components/ui';
import { T } from '@/lib/i18n';

export const licenseReason = (p) => ({
  expired: T('انتهى الاشتراك. جدّده من حسابك على المنصة ثم اضغط مزامنة'),
  trial_ended: T('انتهت الفترة التجريبية. اشترك من حسابك على المنصة ثم اضغط مزامنة'),
  suspended: T('الحساب موقوف. تواصل مع الدعم'),
  revoked: T('تم إيقاف هذا الجهاز من حسابك على المنصة. فعّله مرة أخرى بكود التفعيل'),
}[p?.reason] || T('فعّل البرنامج بكود التفعيل الموجود في حسابك على المنصة'));

// The activation code form (Settings and the POS gate).
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
      <Field label={T('كود التفعيل')} hint={compact ? T('تجده في حسابك على المنصة ← حسابي') : undefined}>
        <Input autoFocus dir="ltr" className="num uppercase tracking-wider" placeholder="ACT-XXXXXXXXXX" value={code} onChange={(e) => setCode(e.target.value)} />
      </Field>
      <Field label={T('اسم الجهاز')}>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={T('الكاشير الرئيسي')} />
      </Field>
      <Button busy={busy} icon={KeyRound} disabled={code.trim().length < 6}>{T('تفعيل')}</Button>
    </form>
  );
}

// Full-screen block on the POS while the app can't sell.
export function ActivationGate({ onBack }) {
  const { platform, can } = useApp();
  const owner = can('settings.manage');
  return (
    <div className="flex h-full items-center justify-center bg-bg p-6">
      <div className="w-full max-w-lg overflow-hidden rounded-3xl border border-line bg-surface shadow-pop">
        <div className="bg-brand flex flex-col items-center gap-2 px-6 py-6 text-center text-white">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-white/20"><ShieldAlert className="size-7" aria-hidden /></span>
          <h1 className="text-xl font-bold">{platform?.state === 'unlicensed' ? T('البرنامج غير مفعّل') : T('البيع متوقف')}</h1>
          <p className="text-sm text-white/85">{licenseReason(platform)}</p>
        </div>
        <div className="grid gap-4 p-6">
          {owner ? <ActivationForm compact /> : <p className="text-center text-muted">{T('اطلب من المالك تفعيل البرنامج من الإعدادات ← الاشتراك')}</p>}
          <p className="text-center text-xs text-muted">{T('التقارير والنسخ الاحتياطي تعمل دائماً — بياناتك محفوظة على هذا الجهاز')}</p>
          <Button type="button" variant="ghost" icon={LayoutDashboard} onClick={onBack}>{T('الرجوع للوحة التحكم')}</Button>
        </div>
      </div>
    </div>
  );
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
  } else if (state === 'unlicensed' || state === 'restricted') {
    tone = 'bg-danger-soft text-danger';
    icon = ShieldAlert;
    text = licenseReason(platform);
  } else if (state === 'trial' && platform.expires_at) {
    const days = Math.ceil((new Date(platform.expires_at) - Date.now()) / 864e5);
    if (days > 3) return null;
    tone = 'bg-info-soft text-info';
    icon = ShieldCheck;
    text = T('الفترة التجريبية تنتهي خلال {0} يوم', [Math.max(days, 0)]);
  } else return null;
  const Icon = icon;
  return (
    <div className={cx('flex items-center gap-2 px-4 py-2 text-sm font-semibold', tone)} role="status">
      <Icon className="size-4 shrink-0" aria-hidden />
      <span className="flex-1">{text}</span>
      {can('settings.manage') && <Link to="/settings?tab=platform" className="underline underline-offset-2">{T('الاشتراك')}</Link>}
    </div>
  );
}
