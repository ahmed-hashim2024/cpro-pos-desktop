import { useEffect, useState } from 'react';
import { Share, SquarePlus, X, Download } from 'lucide-react';
import { store, useLockScroll, useEscape, PREVIEW } from './lib';

// Offers installing the menu as an app, at most once a day per phone:
// Chrome/Android get an "Install" button; iPhone gets the two Safari steps
// (iOS has no install button for websites). Nothing is shown once the app
// is installed or when the menu already runs as the app.

const KEY = 'cpro.menu.install'; // last day shown (YYYY-MM-DD) or 'installed'
const today = () => new Date().toLocaleDateString('en-CA');
const standalone = () => window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

// Links the manifest and the iOS icon only while the owner offers the app,
// and registers the service worker the install needs.
export function useAppLinks(app) {
  useEffect(() => {
    if (PREVIEW || !app?.installable) return undefined;
    const links = [['manifest', '/manifest.webmanifest'], ['apple-touch-icon', '/apple-touch-icon.png']].map(([rel, href]) => {
      const l = document.createElement('link');
      l.rel = rel;
      l.href = href;
      document.head.appendChild(l);
      return l;
    });
    const title = document.createElement('meta');
    title.name = 'apple-mobile-web-app-title';
    title.content = app.name;
    document.head.appendChild(title);
    if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('/sw.js').catch(() => {});
    return () => [...links, title].forEach((el) => el.remove());
  }, [app?.installable, app?.name]);
}

// Which popup to show now: 'android' | 'ios' | ''.
export function useInstallOffer(app) {
  const [kind, setKind] = useState('');
  useEffect(() => {
    if (PREVIEW || !app?.installable || standalone()) return undefined;
    const last = store.get(KEY);
    if (last === 'installed' || last === today()) return undefined;
    let timer;
    const ready = () => { timer = setTimeout(() => setKind(isIOS() ? 'ios' : 'android'), 2500); };
    if (isIOS() || window.__cproInstall) {
      ready();
      return () => clearTimeout(timer);
    }
    window.addEventListener('cpro:installable', ready, { once: true });
    return () => { window.removeEventListener('cpro:installable', ready); clearTimeout(timer); };
  }, [app?.installable]);
  return [kind, () => setKind('')];
}

export function InstallPopup({ kind, app, t, onClose, demo }) {
  useLockScroll();
  useEscape(onClose);
  const [busy, setBusy] = useState(false);
  // Counted as shown for today as soon as it appears, whatever the answer.
  useEffect(() => { if (!demo) store.set(KEY, today()); }, [demo]);

  const install = async () => {
    const e = window.__cproInstall;
    if (demo || !e) { onClose(); return; }
    setBusy(true);
    try {
      e.prompt();
      const { outcome } = await e.userChoice;
      if (outcome === 'accepted') store.set(KEY, 'installed');
    } catch { /* the browser refused; nothing else to do */ }
    window.__cproInstall = null;
    onClose();
  };

  return (
    <div className="anim-fade fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-6 backdrop-blur-[3px]" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={t('installTitle', [app.name])} onClick={(e) => e.stopPropagation()}
        className="anim-swal relative w-full max-w-xs rounded-[28px] bg-bg p-6 text-center shadow-2xl">
        <button onClick={onClose} aria-label={t('close')} className="absolute end-3 top-3 flex size-8 items-center justify-center rounded-full bg-card2 text-mut"><X className="size-4" /></button>
        {app.icon
          ? <img src={app.icon} alt="" className="mx-auto size-20 rounded-[22%] object-cover shadow-lg" />
          : <span className="mx-auto flex size-20 items-center justify-center rounded-[22%] bg-p text-onp shadow-lg"><Download className="size-9" aria-hidden /></span>}
        <h2 className="mt-4 text-lg font-black leading-snug">{t('installTitle', [app.name])}</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-mut">{t('installSub')}</p>
        {kind === 'ios' ? (
          <>
            <ol className="mt-4 grid gap-2 text-start text-sm">
              <li className="flex items-center gap-3 rounded-2xl bg-card px-3 py-2.5"><Share className="size-5 shrink-0 text-p" aria-hidden />{t('iosStep1')}</li>
              <li className="flex items-center gap-3 rounded-2xl bg-card px-3 py-2.5"><SquarePlus className="size-5 shrink-0 text-p" aria-hidden />{t('iosStep2')}</li>
            </ol>
            <button onClick={onClose} className="mt-4 h-12 w-full rounded-2xl bg-p font-bold text-onp shadow-lg">{t('gotIt')}</button>
          </>
        ) : (
          <div className="mt-5 grid gap-2">
            <button onClick={install} disabled={busy} className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-p font-bold text-onp shadow-lg transition active:scale-[.98] disabled:opacity-60">
              <Download className="size-5" aria-hidden />{t('install')}
            </button>
            <button onClick={onClose} className="h-11 rounded-2xl font-semibold text-mut">{t('notNow')}</button>
          </div>
        )}
      </div>
    </div>
  );
}
