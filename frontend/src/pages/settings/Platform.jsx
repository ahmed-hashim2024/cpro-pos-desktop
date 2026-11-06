import { Link } from 'react-router-dom';
import { useMemo, useState } from 'react';
import {
  RefreshCw, ExternalLink, Copy, Printer, QrCode, Globe, ShieldCheck, RotateCcw, Info, MonitorSmartphone,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useApp, toast, toastError } from '@/lib/store';
import { dateTime } from '@/lib/format';
import { printTableQRs } from '@/lib/print';
import { qrSVG } from '@/lib/qr';
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
    <Card title={T('المنيو الإلكتروني')} icon={Globe} actions={url && <Badge tone={tone} dot>{label}</Badge>}>
      {!platform.linked ? (
        <p className="text-sm text-muted">{T('المنيو الإلكتروني يحتاج ربط البرنامج بحسابك.')}</p>
      ) : !platform.features?.emenu ? (
        <p className="text-sm text-muted">{T('المنيو الإلكتروني غير متاح في اشتراكك الحالي')}</p>
      ) : !url ? (
        <DomainForm name={settings?.restaurant_name} />
      ) : (
        <div className="grid gap-3">
          <div className="flex items-center gap-3">
            <div className="size-28 shrink-0 rounded-xl border border-line bg-white p-1.5 [&_svg]:size-full" dangerouslySetInnerHTML={{ __html: qrSVG(url, { margin: 1 }) }} />
            <div className="min-w-0 flex-1 space-y-2">
              <a dir="ltr" className="block truncate font-bold text-primary" href={url} onClick={(e) => { e.preventDefault(); openExternal(url); }}>{url}</a>
              <p className="text-xs text-muted">{T('رابط عام للتيك أواي ومشاركته على السوشيال. لكل طاولة كود خاص بالأسفل.')}</p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" icon={Copy} onClick={copy}>{T('نسخ')}</Button>
                <Button size="sm" variant="secondary" icon={ExternalLink} onClick={() => openExternal(url)}>{T('فتح')}</Button>
                <Button size="sm" variant="ghost" icon={MonitorSmartphone} onClick={() => openExternal('http://127.0.0.1:8788/')}>{T('معاينة على الجهاز')}</Button>
              </div>
            </div>
          </div>
          {platform.tunnel?.state === 'error' && <p className="rounded-xl bg-danger-soft p-2 text-xs text-danger" dir="auto">{platform.tunnel.error}</p>}
          {!platform.menu_enabled && <p className="rounded-xl bg-warning-soft p-2 text-xs text-warning">{T('المنيو مقفول للضيوف — افتحه من المنيو ← المنيو الإلكتروني')}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <p className="flex-1 text-xs text-muted">{T('الشكل والألوان والعروض والطلب أونلاين ونداء الويتر تتظبط من المنيو ← المنيو الإلكتروني')}</p>
            <Link to="/menu?tab=emenu" className="text-sm font-bold text-primary hover:underline">{T('تصميم المنيو')}</Link>
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
  const printHall = () => printTableQRs(settings?.restaurant_name || '', [{ title: T('منيو الصالة'), svg: qrSVG(hallLink) }]);
  const printAll = () => printTableQRs(settings?.restaurant_name || '', list.map((t) => ({ title: t.name, svg: qrSVG(link(t)) })));
  const regenerate = async (t) => {
    if (!await confirm({ title: T('تجديد كود {0}', [t.name]), message: T('الكود المطبوع حالياً لن يعمل بعد التجديد. اطبع الكود الجديد.'), action: T('تجديد') })) return;
    setBusy(t.id);
    try {
      await api.post(`/tables/${t.id}/qr`);
      tables.reload(true);
      toast(T('تم تجديد الكود'));
    } catch (e) {
      toastError(e);
    } finally {
      setBusy('');
    }
  };
  return (
    <Card title={T('أكواد الطاولات')} icon={QrCode} className="xl:col-span-2"
      actions={list.length > 0 && <Button size="sm" icon={Printer} onClick={printAll}>{T('طباعة كل الأكواد')}</Button>}>
      <div className="mb-3 flex flex-wrap items-center gap-3 rounded-xl bg-surface-2 p-3">
        <div className="size-14 shrink-0 rounded-lg bg-white p-0.5 [&_svg]:size-full" dangerouslySetInnerHTML={{ __html: qrSVG(hallLink, { margin: 1 }) }} />
        <div className="min-w-0 flex-1">
          <div className="font-bold">{T('كود الصالة (واحد لكل الترابيزات)')}</div>
          <p className="text-sm text-muted">{T('الضيف بيختار ترابيزته من قايمة. كود الترابيزة بيحددها لوحده، واللينك العادي للتوصيل والتصفح بس.')}</p>
          <span dir="ltr" className="num block truncate text-xs text-muted">{hallLink}</span>
        </div>
        <Button size="sm" variant="secondary" icon={Printer} onClick={printHall}>{T('طباعة')}</Button>
      </div>
      {tables.loading && !tables.data ? <Spinner /> : (
        <Table head={[T('الطاولة'), T('الكود'), T('الرابط'), '']} empty={T('لا توجد طاولات — أضفها من المنيو ← الطاولات')}>
          {list.map((t) => (
            <tr key={t.id} className="border-t border-line">
              <Td className="font-bold">{t.name}</Td>
              <Td><div className="size-14 rounded-lg bg-white p-0.5 [&_svg]:size-full" dangerouslySetInnerHTML={{ __html: qrSVG(link(t), { margin: 1 }) }} /></Td>
              <Td><span dir="ltr" className="num text-xs text-muted">{link(t)}</span></Td>
              <Td className="text-end">
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
