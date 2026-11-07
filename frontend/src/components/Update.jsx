import { useEffect, useState } from 'react';
import { Download, Loader2, LogOut, RefreshCw, Sparkles } from 'lucide-react';
import { api } from '@/lib/api';
import { useApp, toast, toastError } from '@/lib/store';
import { Button, cx } from '@/components/ui';
import { T } from '@/lib/i18n';

// Downloads the update (verified against the Platform's SHA-256) and starts
// the installer; the app closes itself. Only offered inside the desktop
// window, since the installer runs on that computer.
function InstallButton({ size }) {
  const { me, platform, loadPlatform } = useApp();
  const [busy, setBusy] = useState(false);
  const state = platform?.update?.state;
  const downloading = state === 'downloading';
  // Follow the download closely while it runs.
  useEffect(() => {
    if (!downloading) return undefined;
    const t = setInterval(loadPlatform, 2000);
    return () => clearInterval(t);
  }, [downloading, loadPlatform]);
  if (me?.channel !== 'app') return <p className="text-sm text-muted">{T('ثبّت التحديث من الجهاز الرئيسي لنقطة البيع')}</p>;
  const install = async () => {
    setBusy(true);
    try {
      await api.post('/update/install');
      await loadPlatform();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid gap-2">
      <Button type="button" size={size} icon={downloading ? Loader2 : Download} busy={busy} disabled={downloading} onClick={install}
        className={cx(downloading && '[&_svg]:animate-spin')}>
        {downloading ? T('جارٍ تحميل التحديث…') : state === 'ready' ? T('جارٍ فتح المثبّت…') : T('تحميل وتثبيت التحديث')}
      </Button>
      {state === 'error' && <p className="text-sm text-danger" dir="auto">{platform.update.error}</p>}
    </div>
  );
}

// Over every screen while a mandatory update waits. It can't be dismissed;
// selling is blocked on the server too.
export function UpdateAlert() {
  const { me, platform, canSell, logout } = useApp();
  const u = platform?.update;
  // The activation alert comes first when the app can't sell anyway.
  if (!me || !u?.available || !u.mandatory || !canSell()) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
      <div role="alertdialog" aria-modal="true" aria-labelledby="update-title"
        className="w-full max-w-md rounded-3xl border border-line bg-surface p-6 text-center shadow-pop motion-safe:animate-[pop_.2s_ease-out]">
        <span className="mx-auto flex size-20 items-center justify-center rounded-full border-4 border-primary/30 text-primary">
          <Sparkles className="size-10" aria-hidden />
        </span>
        <h2 id="update-title" className="mt-4 text-2xl font-bold">{T('تحديث إجباري')}</h2>
        <p className="mt-2 text-muted">{T('الإصدار {0} متاح ويجب تثبيته لمتابعة العمل. لن تتأثر بياناتك.', [u.version])}</p>
        {u.notes && <p className="mt-3 max-h-32 overflow-y-auto whitespace-pre-wrap rounded-xl bg-surface-2 p-3 text-start text-sm" dir="auto">{u.notes}</p>}
        <div className="mt-5"><InstallButton size="lg" /></div>
        <button type="button" onClick={logout} className="mt-4 inline-flex items-center gap-1.5 text-sm text-muted underline-offset-2 hover:text-fg hover:underline">
          <LogOut className="size-4" aria-hidden />{T('تسجيل الخروج')}
        </button>
      </div>
    </div>
  );
}

// Strip above every screen for an optional update.
export function UpdateBanner() {
  const { platform } = useApp();
  const u = platform?.update;
  if (!u?.available || u.mandatory) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 bg-primary-soft px-4 py-2 text-sm font-semibold text-primary-ink" role="status">
      <Sparkles className="size-4 shrink-0" aria-hidden />
      <span className="flex-1">{T('إصدار جديد متاح: {0}', [u.version])}</span>
      <InstallButton size="sm" />
    </div>
  );
}

// "Check for updates" in Settings.
export function CheckUpdateButton() {
  const loadPlatform = useApp((s) => s.loadPlatform);
  const [busy, setBusy] = useState(false);
  const check = async () => {
    setBusy(true);
    try {
      const u = await api.post('/update/check');
      await loadPlatform();
      toast(u.available ? T('إصدار جديد متاح: {0}', [u.version]) : T('البرنامج محدّث لآخر إصدار'));
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  return <Button type="button" size="sm" variant="secondary" icon={RefreshCw} busy={busy} onClick={check}>{T('البحث عن تحديث')}</Button>;
}
