import { Link } from 'react-router-dom';
import { useMemo, useState } from 'react';
import {
  RefreshCw, ExternalLink, Copy, Printer, QrCode, Globe, ShieldCheck, RotateCcw, Info, MonitorSmartphone, Download, Earth, UserCog,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useApp, toast, toastError } from '@/lib/store';
import { dateTime } from '@/lib/format';
import { printTableQRs } from '@/lib/print';
import { qrSVG } from '@/lib/qr';
import { downloadQR, downloadQRZip } from '@/lib/qrimage';
import { openExternal, copyText } from '@/lib/open';
import { confirm } from '@/components/Confirm';
import { ConnectGoogle, licenseReason, openAccount } from '@/components/License';
import { DomainForm } from '@/components/Domain';
import { CheckUpdateButton } from '@/components/Update';
import { Badge, Button, Card, Spinner, Table, Td, useLoad } from '@/components/ui';
import { T } from '@/lib/i18n';

const stateBadge = {
  active: ['green', T('مفعّل')],
  trial: ['blue', T('فترة تجريبية')],
  grace: ['amber', T('مهلة بدون اتصال')],
  restricted: ['red', T('متوقف')],
};
const tunnelBadge = {
  connected: ['green', T('متصل')],
  starting: ['amber', T('جارٍ الاتصال')],
  error: ['red', T('خطأ في الاتصال')],
  off: ['gray', T('غير متصل')],
};

export default function Platform() {
  const { platform, loadPlatform } = useApp();
  const [busy, setBusy] = useState('');
  const act = async (key, fn) => {
    setBusy(key);
    try {
      await fn();
      await loadPlatform();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy('');
    }
  };
  if (!platform) return <Spinner />;
  if (!platform.enabled) {
    return <Card title={T('الاشتراك')}><p className="text-muted">{T('نسخة تطوير: الربط بالمنصة غير مفعّل في هذه النسخة')}</p></Card>;
  }
  const [tone, label] = stateBadge[platform.state] || stateBadge.restricted;
  const sync = () => act('sync', async () => { await api.post('/platform/sync'); toast(T('تمت المزامنة')); });

  return (
    <div className="grid gap-3 xl:grid-cols-2">
      <Card title={T('الاشتراك والتفعيل')} icon={ShieldCheck} actions={<Badge tone={tone} dot>{label}</Badge>}>
        {!platform.linked ? (
          <div className="grid gap-3">
            <p className="text-sm text-muted">{licenseReason(platform)}</p>
            <ConnectGoogle onDone={loadPlatform} />
          </div>
        ) : (
          <div className="grid gap-3">
            {platform.state === 'restricted' && <p className="rounded-xl bg-danger-soft p-3 text-sm text-danger">{licenseReason(platform)}</p>}
            {platform.state === 'restricted' && platform.reason === 'revoked' && <ConnectGoogle onDone={loadPlatform} />}
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
              <dt className="text-muted">{T('المطعم')}</dt><dd className="font-bold">{platform.tenant_name}</dd>
              <dt className="text-muted">{T('الخطة')}</dt><dd>{{ active: T('اشتراك مدفوع'), trial: T('فترة تجريبية'), suspended: T('موقوف') }[platform.plan] || T('لم يتم الاشتراك بعد')}</dd>
              <dt className="text-muted">{T('الترخيص صالح حتى')}</dt><dd className="num">{dateTime(platform.expires_at)}</dd>
              {platform.grace_until && <><dt className="text-muted">{T('يعمل بدون إنترنت حتى')}</dt><dd className="num">{dateTime(platform.grace_until)}</dd></>}
              <dt className="text-muted">{T('آخر مزامنة')}</dt><dd className="num">{dateTime(platform.last_sync) || '—'}</dd>
              <dt className="text-muted">{T('معرّف الجهاز')}</dt><dd className="num text-xs" dir="ltr">{platform.device_id}</dd>
            </dl>
            {platform.last_error && <p className="rounded-xl bg-warning-soft p-2 text-xs text-warning" dir="auto">{T('آخر خطأ')}: {platform.last_error}</p>}
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" icon={RefreshCw} busy={busy === 'sync'} onClick={sync}>{T('مزامنة الآن')}</Button>
              {platform.url && <Button variant="ghost" icon={ExternalLink} onClick={() => openAccount(platform)}>{T('حسابي على المنصة')}</Button>}
            </div>
          </div>
        )}
      </Card>

      <EMenuCard platform={platform} />
      {platform.linked && <RemoteCard platform={platform} />}
      {platform.linked && <TableQRs platform={platform} />}
      <AboutCard platform={platform} />
    </div>
  );
}

function EMenuCard({ platform }) {
  const settings = useApp((s) => s.settings);
  const [tone, label] = tunnelBadge[platform.tunnel?.state] || tunnelBadge.off;
  const url = platform.menu_url;
  const copy = async () => { if (await copyText(url)) toast(T('تم نسخ الرابط')); };
  return (
    <Card title={T('قائمة الطعام الإلكترونية')} icon={Globe} actions={url && <Badge tone={tone} dot>{label}</Badge>}>
      {!platform.linked ? (
        <p className="text-sm text-muted">{T('تتطلب قائمة الطعام الإلكترونية ربط البرنامج بحسابك.')}</p>
      ) : !platform.features?.emenu ? (
        <p className="text-sm text-muted">{T('قائمة الطعام الإلكترونية غير متاحة في اشتراكك الحالي')}</p>
      ) : !url ? (
        <DomainForm name={settings?.restaurant_name} />
      ) : (
        <div className="grid gap-3">
          <div className="flex items-center gap-3">
            <QRThumb url={url} title={T('قائمة الطعام الإلكترونية')} restaurant={settings?.restaurant_name} className="size-28 rounded-xl border border-line p-1.5" />
            <div className="min-w-0 flex-1 space-y-2">
              <a dir="ltr" className="block truncate font-bold text-primary" href={url} onClick={(e) => { e.preventDefault(); openExternal(url); }}>{url}</a>
              <p className="text-xs text-muted">{T('رابط عام للطلبات الخارجية وللمشاركة على وسائل التواصل الاجتماعي، ولكل طاولة رمز خاص أدناه.')}</p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" icon={Copy} onClick={copy}>{T('نسخ')}</Button>
                <Button size="sm" variant="secondary" icon={ExternalLink} onClick={() => openExternal(url)}>{T('فتح')}</Button>
                <Button size="sm" variant="ghost" icon={MonitorSmartphone} onClick={() => openExternal('http://127.0.0.1:8788/')}>{T('معاينة على الجهاز')}</Button>
              </div>
            </div>
          </div>
          {platform.tunnel?.state === 'error' && <p className="rounded-xl bg-danger-soft p-2 text-xs text-danger" dir="auto">{platform.tunnel.error}</p>}
          {!platform.menu_enabled && <p className="rounded-xl bg-warning-soft p-2 text-xs text-warning">{T('قائمة الطعام مغلقة أمام الضيوف — افتحها من: قائمة الطعام ← قائمة الطعام الإلكترونية')}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <p className="flex-1 text-xs text-muted">{T('تُضبط الألوان والعروض والطلب الإلكتروني ونداء النادل من: قائمة الطعام ← قائمة الطعام الإلكترونية')}</p>
            <Link to="/menu?tab=emenu" className="text-sm font-bold text-primary hover:underline">{T('تصميم قائمة الطعام')}</Link>
          </div>
        </div>
      )}
    </Card>
  );
}

function TableQRs({ platform }) {
  const tables = useLoad(() => api.get('/tables'));
  const settings = useApp((s) => s.settings);
  const [busy, setBusy] = useState('');
  const base = platform.menu_url;
  const list = useMemo(() => (tables.data || []).filter((t) => t.active), [tables.data]);
  if (!platform.features?.emenu || !base) return null;
  const link = (t) => `${base}/t/${t.qr_token}`;
  const hallLink = `${base}/hall`;
  const printHall = () => printTableQRs(settings?.restaurant_name || '', [{ title: T('قائمة طعام الصالة'), svg: qrSVG(hallLink) }]);
  const printAll = () => printTableQRs(settings?.restaurant_name || '', list.map((t) => ({ title: t.name, svg: qrSVG(link(t)) })));
  // One ZIP: the hall code and a PNG card per table.
  const saveAll = async () => {
    const restaurant = settings?.restaurant_name || '';
    const hint = T('امسح الرمز لعرض قائمة الطعام والطلب');
    setBusy('zip');
    try {
      const cards = [{ url: hallLink, title: T('قائمة طعام الصالة'), restaurant, hint }, ...list.map((t) => ({ url: link(t), title: t.name, restaurant, hint }))];
      if (await downloadQRZip(cards, T('رموز الطاولات') + (restaurant ? ` - ${restaurant}` : ''))) toast(T('تم حفظ الرموز'));
    } catch (e) {
      toastError(e);
    } finally {
      setBusy('');
    }
  };
  const regenerate = async (t) => {
    if (!await confirm({ title: T('تجديد رمز {0}', [t.name]), message: T('لن يعمل الرمز المطبوع حالياً بعد التجديد، فاطبع الرمز الجديد.'), action: T('تجديد') })) return;
    setBusy(t.id);
    try {
      await api.post(`/tables/${t.id}/qr`);
      tables.reload(true);
      toast(T('تم تجديد الرمز'));
    } catch (e) {
      toastError(e);
    } finally {
      setBusy('');
    }
  };
  return (
    <Card title={T('رموز الطاولات')} icon={QrCode} className="xl:col-span-2"
      actions={list.length > 0 && (
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" icon={Download} busy={busy === 'zip'} onClick={saveAll}>{T('تنزيل جميع الرموز')}</Button>
          <Button size="sm" icon={Printer} onClick={printAll}>{T('طباعة جميع الرموز')}</Button>
        </div>
      )}>
      <div className="mb-3 flex flex-wrap items-center gap-3 rounded-xl bg-surface-2 p-3">
        <QRThumb url={hallLink} title={T('قائمة طعام الصالة')} restaurant={settings?.restaurant_name} className="size-14 rounded-lg p-0.5" />
        <div className="min-w-0 flex-1">
          <div className="font-bold">{T('رمز الصالة (رمز واحد لجميع الطاولات)')}</div>
          <p className="text-sm text-muted">{T('يختار الضيف طاولته من قائمة. أما رمز الطاولة فيحددها تلقائياً، والرابط العام مخصص للتوصيل والتصفح فقط.')}</p>
          <span dir="ltr" className="num block truncate text-xs text-muted">{hallLink}</span>
        </div>
        <Button size="sm" variant="secondary" icon={Download} onClick={() => saveQR({ url: hallLink, title: T('قائمة طعام الصالة'), restaurant: settings?.restaurant_name })}>{T('تنزيل')}</Button>
        <Button size="sm" variant="secondary" icon={Printer} onClick={printHall}>{T('طباعة')}</Button>
      </div>
      {tables.loading && !tables.data ? <Spinner /> : (
        <Table head={[T('الطاولة'), T('الرمز'), T('الرابط'), '']} empty={T('لا توجد طاولات — أضفها من: قائمة الطعام ← الطاولات')}>
          {list.map((t) => (
            <tr key={t.id} className="border-t border-line">
              <Td className="font-bold">{t.name}</Td>
              <Td><QRThumb url={link(t)} title={t.name} restaurant={settings?.restaurant_name} className="size-14 rounded-lg p-0.5" /></Td>
              <Td><span dir="ltr" className="num text-xs text-muted">{link(t)}</span></Td>
              <Td className="text-end">
                <Button size="sm" variant="ghost" icon={Download} onClick={() => saveQR({ url: link(t), title: t.name, restaurant: settings?.restaurant_name })}>{T('تنزيل')}</Button>
                <Button size="sm" variant="ghost" icon={Printer} onClick={() => printTableQRs(settings?.restaurant_name || '', [{ title: t.name, svg: qrSVG(link(t)) }])}>{T('طباعة')}</Button>
                <Button size="sm" variant="ghost" icon={RotateCcw} busy={busy === t.id} onClick={() => regenerate(t)}>{T('تجديد')}</Button>
              </Td>
            </tr>
          ))}
        </Table>
      )}
    </Card>
  );
}

// Saves a QR code as a PNG card (restaurant, title, code, «scan me»).
async function saveQR({ url, title, restaurant }) {
  try {
    if (await downloadQR({ url, title, restaurant: restaurant || '', hint: T('امسح الرمز لعرض قائمة الطعام والطلب') })) toast(T('تم حفظ الرمز'));
  } catch (e) {
    toastError(e);
  }
}

// A QR code that downloads itself as a picture when clicked.
function QRThumb({ url, title, restaurant, className }) {
  return (
    <button type="button" onClick={() => saveQR({ url, title, restaurant })} title={T('اضغط لتنزيل الرمز صورةً')} aria-label={T('تنزيل رمز {0}', [title])}
      className={`group relative block shrink-0 cursor-pointer bg-white transition hover:ring-2 hover:ring-primary [&_svg]:size-full ${className}`}>
      <span className="block size-full" dangerouslySetInnerHTML={{ __html: qrSVG(url, { margin: 1 }) }} />
      <span className="absolute inset-0 flex items-center justify-center rounded-[inherit] bg-black/45 text-white opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">
        <Download className="size-5" aria-hidden />
      </span>
    </button>
  );
}

// Signing in to the whole system from anywhere, through the same tunnel on
// its own address («<name>-pos»). Who may do it is set per user.
function RemoteCard({ platform }) {
  const me = useApp((s) => s.me);
  const users = useLoad(() => (me?.role === 'owner' ? api.get('/users') : Promise.resolve([])), [me?.role]);
  const url = platform.remote_url;
  const allowed = (users.data || []).filter((u) => u.active && u.remote_access);
  const copy = async () => { if (await copyText(url)) toast(T('تم نسخ الرابط')); };
  const [tone, label] = !platform.features?.remote_access ? ['gray', T('غير مشمول في الاشتراك')] : url ? tunnelBadge[platform.tunnel?.state] || tunnelBadge.off : ['amber', T('جارٍ التجهيز')];
  return (
    <Card title={T('الدخول عن بُعد')} icon={Earth} actions={<Badge tone={tone} dot>{label}</Badge>}>
      {!platform.features?.remote_access ? (
        <p className="text-sm text-muted">{T('استخدم النظام بالكامل (التقارير والطلبات والإعدادات) من أي مكان في العالم عبر عنوان خاص بك. هذه الخدمة غير مشمولة في اشتراكك الحالي، ويمكنك تفعيلها من حسابك على المنصة.')}</p>
      ) : !url ? (
        <p className="text-sm text-muted">{platform.domain ? T('جارٍ تجهيز عنوان الدخول عن بُعد، وسيظهر هنا خلال دقيقة.') : T('اختر أولاً عنوان قائمة الطعام من بطاقة قائمة الطعام الإلكترونية؛ إذ يُنشأ عنوان الدخول عن بُعد معه.')}</p>
      ) : (
        <div className="grid gap-3">
          <div>
            <a dir="ltr" className="block truncate font-bold text-primary" href={url} onClick={(e) => { e.preventDefault(); openExternal(url); }}>{url}</a>
            <p className="mt-1 text-xs text-muted">{T('افتحه من أي هاتف محمول أو حاسوب، وسجّل الدخول باسم المستخدم وكلمة المرور. لا يعمل الرقم السري (PIN) من خارج المطعم، ويجب أن يكون هذا الجهاز قيد التشغيل ومتصلاً بالإنترنت.')}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" icon={Copy} onClick={copy}>{T('نسخ')}</Button>
              <Button size="sm" variant="secondary" icon={ExternalLink} onClick={() => openExternal(url)}>{T('فتح')}</Button>
            </div>
          </div>
          {me?.role === 'owner' && (
            <div className="rounded-xl bg-surface-2 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-bold">{T('المأذون لهم بالدخول عن بُعد')}</span>
                <Link to="/users" className="flex items-center gap-1 text-sm font-bold text-primary hover:underline"><UserCog className="size-4" aria-hidden />{T('المستخدمون')}</Link>
              </div>
              {allowed.length ? (
                <div className="mt-2 flex flex-wrap gap-1.5">{allowed.map((u) => <Badge key={u.id} tone="blue">{u.full_name}</Badge>)}</div>
              ) : <p className="mt-1 text-xs text-muted">{T('لا يوجد أحد بعد، ولا حتى أنت. افتح المستخدم وحدّد «يمكنه الدخول إلى النظام من خارج المطعم».')}</p>}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function AboutCard({ platform }) {
  return (
    <Card title={T('عن البرنامج')} icon={Info}>
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
        <span>{T('إصدار البرنامج')}: <span className="num">{platform.app_version}</span></span>
        {platform.update?.checked_at && <span>{T('آخر بحث عن تحديث')}: <span className="num">{dateTime(platform.update.checked_at)}</span></span>}
        <span className="ms-auto"><CheckUpdateButton /></span>
      </div>
    </Card>
  );
}
