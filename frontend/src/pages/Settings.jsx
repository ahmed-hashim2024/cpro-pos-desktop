import { useState } from 'react';
import { Plus, Trash2, Download, HardDriveDownload, Settings as SettingsIcon } from 'lucide-react';
import { api } from '@/lib/api';
import { useTab } from '@/lib/useTab';
import { useTheme, fontScales } from '@/lib/theme';
import { useApp, toast } from '@/lib/store';
import { toMinor, minorInput, toBP, dateTime } from '@/lib/format';
import { Badge, Button, Card, Checkbox, Field, Input, PageHeader, Select, Spinner, Table, Td, Tabs, Textarea, useLoad, useAction } from '@/components/ui';
import { T, lang, languages, setLang } from '@/lib/i18n';

export default function Settings() {
  const [tab, setTab] = useTab('general');
  return (
    <div>
      <PageHeader title={T('الإعدادات')} icon={SettingsIcon} subtitle={T('بيانات المطعم والضرائب والطباعة والأجهزة')} crumb={T('الإدارة')} />
      <Tabs value={tab} onChange={setTab} tabs={[['general', T('عام')], ['display', T('العرض')], ['payments', T('طرق الدفع')], ['devices', T('الأجهزة والشبكة')], ['backups', T('النسخ الاحتياطي')], ['account', T('حسابي')]]} />
      {tab === 'general' && <General />}
      {tab === 'display' && <Display />}
      {tab === 'payments' && <Payments />}
      {tab === 'devices' && <Devices />}
      {tab === 'backups' && <Backups />}
      {tab === 'account' && <Account />}
    </div>
  );
}

function useSettingsForm() {
  const loadSettings = useApp((s) => s.loadSettings);
  const data = useLoad(() => api.get('/settings'));
  const [busy, run] = useAction();
  const save = (s) => run(async () => {
    await api.put('/settings', s);
    await loadSettings();
    toast(T('تم حفظ الإعدادات'));
    data.reload(true);
  });
  return { data, busy, save };
}

function General() {
  const { data, busy, save } = useSettingsForm();
  const [f, setF] = useState(null);
  if (!data.data) return <Spinner />;
  const s = f || {
    ...data.data, tax: String(data.data.tax_rate_bp / 100), service: String(data.data.service_rate_bp / 100), delivery: minorInput(data.data.delivery_fee_minor),
  };
  const set = (patch) => setF({ ...s, ...patch });
  const submit = () => save({
    ...s, tax_rate_bp: toBP(s.tax) ?? 0, service_rate_bp: toBP(s.service) ?? 0, delivery_fee_minor: toMinor(s.delivery) ?? 0,
    day_start_hour: Number(s.day_start_hour), auto_backup_hours: Number(s.auto_backup_hours), backup_keep: Number(s.backup_keep), lan_port: Number(s.lan_port),
  });
  const toggleService = (t, on) => set({ service_order_types: on ? [...s.service_order_types, t] : s.service_order_types.filter((x) => x !== t) });
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Card title={T('بيانات المطعم')}>
        <div className="grid grid-cols-2 gap-3">
          <Field label={T('اسم المطعم')} className="col-span-2"><Input value={s.restaurant_name} onChange={(e) => set({ restaurant_name: e.target.value })} /></Field>
          <Field label={T('العنوان')} className="col-span-2"><Input value={s.address} onChange={(e) => set({ address: e.target.value })} /></Field>
          <Field label={T('الهاتف')}><Input value={s.phone} onChange={(e) => set({ phone: e.target.value })} /></Field>
          <Field label={T('الرقم الضريبي')}><Input value={s.tax_number} onChange={(e) => set({ tax_number: e.target.value })} /></Field>
          <Field label={T('العملة')}>
            <Select value={s.currency} onChange={(e) => set({ currency: e.target.value })}>
              <option value="EGP">{T('جنيه مصري')}</option><option value="SAR">{T('ريال سعودي')}</option><option value="AED">{T('درهم إماراتي')}</option><option value="USD">{T('دولار')}</option>
            </Select>
          </Field>
          <Field label={T('بداية يوم العمل (ساعة)')} hint={T('مبيعات ما بعد منتصف الليل تُحسب لليوم السابق حتى هذه الساعة')}>
            <Input type="number" min={0} max={12} value={s.day_start_hour} onChange={(e) => set({ day_start_hour: e.target.value })} />
          </Field>
        </div>
      </Card>
      <Card title={T('الضريبة والخدمة والتوصيل')}>
        <div className="grid grid-cols-2 gap-3">
          <Field label={T('نسبة الضريبة %')}><Input className="num" value={s.tax} onChange={(e) => set({ tax: e.target.value })} /></Field>
          <Field label={T('نسبة الخدمة %')}><Input className="num" value={s.service} onChange={(e) => set({ service: e.target.value })} /></Field>
          <Checkbox label={T('الأسعار شاملة الضريبة')} checked={s.tax_inclusive} onChange={(v) => set({ tax_inclusive: v })} />
          <Checkbox label={T('الضريبة تُحسب على الخدمة')} checked={s.service_taxable} onChange={(v) => set({ service_taxable: v })} />
          <div className="col-span-2 flex gap-3">
            <span className="text-sm text-muted">{T('الخدمة على:')}</span>
            <Checkbox label={T('صالة')} checked={s.service_order_types.includes('dine_in')} onChange={(v) => toggleService('dine_in', v)} />
            <Checkbox label={T('تيك أواي')} checked={s.service_order_types.includes('takeaway')} onChange={(v) => toggleService('takeaway', v)} />
            <Checkbox label={T('توصيل')} checked={s.service_order_types.includes('delivery')} onChange={(v) => toggleService('delivery', v)} />
          </div>
          <Field label={T('رسوم التوصيل')}><Input className="num" value={s.delivery} onChange={(e) => set({ delivery: e.target.value })} /></Field>
        </div>
      </Card>
      <Card title={T('الطباعة')}>
        <div className="grid gap-3">
          <Field label={T('رأس الفاتورة')}><Textarea value={s.receipt_header} onChange={(e) => set({ receipt_header: e.target.value })} /></Field>
          <Field label={T('تذييل الفاتورة')}><Textarea value={s.receipt_footer} onChange={(e) => set({ receipt_footer: e.target.value })} /></Field>
          <Checkbox label={T('طباعة الفاتورة تلقائياً بعد الدفع')} checked={s.auto_print_receipt} onChange={(v) => set({ auto_print_receipt: v })} />
          <Checkbox label={T('طباعة بون المطبخ عند الإرسال')} checked={s.print_kitchen} onChange={(v) => set({ print_kitchen: v })} />
        </div>
      </Card>
      <div className="lg:col-span-2"><Button busy={busy} size="lg" onClick={submit}>{T('حفظ الإعدادات')}</Button></div>
    </div>
  );
}

function Payments() {
  const { data, busy, save } = useSettingsForm();
  const [methods, setMethods] = useState(null);
  if (!data.data) return <Spinner />;
  const list = methods || data.data.payment_methods;
  const update = (i, patch) => setMethods(list.map((m, j) => (j === i ? { ...m, ...patch } : m)));
  return (
    <Card title={T('طرق الدفع')}>
      <div className="grid gap-2">
        {list.map((m, i) => (
          <div key={i} className="flex items-center gap-3">
            <Input className="w-32" placeholder={T('الكود')} value={m.code} disabled={!!data.data.payment_methods.find((x) => x.code === m.code) && !methods?.[i]?.isNew}
              onChange={(e) => update(i, { code: e.target.value })} />
            <Input className="flex-1" placeholder={T('الاسم')} value={m.name} onChange={(e) => update(i, { name: e.target.value })} />
            <Checkbox label={T('نقدي')} checked={m.is_cash} onChange={(v) => update(i, { is_cash: v })} />
            <Checkbox label={T('مفعّل')} checked={m.active} onChange={(v) => update(i, { active: v })} />
            {m.isNew && <button onClick={() => setMethods(list.filter((_, j) => j !== i))}><Trash2 className="size-4 text-danger" /></button>}
          </div>
        ))}
      </div>
      <div className="mt-3 flex gap-2">
        <Button variant="secondary" onClick={() => setMethods([...list, { code: '', name: '', is_cash: false, active: true, isNew: true }])}><Plus className="size-4" />{T('طريقة دفع')}</Button>
        <Button busy={busy} onClick={() => save({ ...data.data, payment_methods: list.map(({ isNew, ...m }) => m) })}>{T('حفظ')}</Button>
      </div>
      <p className="mt-3 text-sm text-muted">{T('لا يمكن حذف طريقة دفع استُخدمت من قبل، يمكنك إيقافها فقط.')}</p>
    </Card>
  );
}

function Devices() {
  const me = useApp((st) => st.me);
  const { data, busy, save } = useSettingsForm();
  const devices = useLoad(() => api.get('/devices'));
  const [, run] = useAction();
  if (!data.data) return <Spinner />;
  const s = data.data;
  const kinds = { terminal: T('كاشير'), waiter: T('ويتر'), kds: T('شاشة مطبخ'), display: T('شاشة عميل'), remote: T('دخول عن بعد') };
  return (
    <div className="grid gap-3">
      <Card title={T('الشبكة المحلية (تابلت الويتر وشاشات المطبخ)')}>
        <div className="grid gap-3">
          <Checkbox label={T('السماح للأجهزة على نفس الشبكة بالاتصال')} checked={s.lan_enabled} onChange={(v) => save({ ...s, lan_enabled: v })} />
          <Field label={T('المنفذ')} className="w-40"><Input type="number" defaultValue={s.lan_port} onBlur={(e) => Number(e.target.value) !== s.lan_port && save({ ...s, lan_port: Number(e.target.value) })} /></Field>
          <p className="text-sm text-muted">
            {T('بعد التفعيل أعد تشغيل البرنامج، ثم افتح من التابلت أو شاشة المطبخ المتصفح على العنوان:')}
            <b className="num mx-1">http://[{T('عنوان-هذا-الجهاز')}]:{s.lan_port}</b>
            {T('وسجّل الدخول. كل جهاز يظهر في القائمة بالأسفل ويمكنك إيقافه في أي وقت.')}
          </p>
          {busy && <Spinner />}
        </div>
      </Card>
      <Card title={T('الأجهزة')}>
        <Table head={[T('الجهاز'), T('النوع'), T('أول اتصال'), T('آخر نشاط'), '']}>
          {(devices.data || []).map((d) => (
            <tr key={d.id}>
              <Td className="font-semibold">{d.name}</Td><Td>{kinds[d.kind]}</Td><Td>{dateTime(d.paired_at)}</Td><Td>{dateTime(d.last_seen)}</Td>
              <Td>{d.revoked ? <Badge tone="red">{T('موقوف')}</Badge> : d.id !== me?.device_id ? (
                <Button size="sm" variant="ghost" onClick={() => run(async () => { await api.post(`/devices/${d.id}/revoke`); devices.reload(true); })}>{T('إيقاف')}</Button>
              ) : <Badge tone="green">{T('هذا الجهاز')}</Badge>}</Td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}

function Backups() {
  const { data, busy, save } = useSettingsForm();
  const list = useLoad(() => api.get('/backups'));
  const [creating, run] = useAction();
  if (!data.data) return <Spinner />;
  const s = data.data;
  return (
    <div className="grid gap-3">
      <Card title={T('النسخ التلقائي')}>
        <div className="flex flex-wrap items-end gap-3">
          <Field label={T('كل (ساعة)')} hint={T('0 = إيقاف')}><Input type="number" className="w-28" defaultValue={s.auto_backup_hours} id="bh" /></Field>
          <Field label={T('الاحتفاظ بآخر')} hint={T('نسخة')}><Input type="number" className="w-28" defaultValue={s.backup_keep} id="bk" /></Field>
          <Button busy={busy} onClick={() => save({ ...s, auto_backup_hours: Number(document.getElementById('bh').value), backup_keep: Number(document.getElementById('bk').value) })}>{T('حفظ')}</Button>
        </div>
        <p className="mt-2 text-sm text-muted">{T('تُؤخذ نسخة أيضاً عند إغلاق البرنامج. احتفظ بنسخة خارج الجهاز (فلاشة أو سحابة) بشكل دوري.')}</p>
      </Card>
      <Card title={T('النسخ المحفوظة')} actions={<Button busy={creating} onClick={() => run(async () => { await api.post('/backups'); toast(T('تم إنشاء نسخة')); list.reload(true); })}><HardDriveDownload className="size-4" />{T('نسخة الآن')}</Button>}>
        <Table head={[T('الملف'), T('الحجم'), T('التاريخ'), '']}>
          {(list.data || []).map((b) => (
            <tr key={b.name}>
              <Td className="num">{b.name}</Td><Td className="num">{(b.size / 1024 / 1024).toFixed(2)} MB</Td><Td>{dateTime(b.created_at)}</Td>
              <Td><Button size="sm" variant="ghost" onClick={() => api.download(`/backups/${b.name}`, b.name)}><Download className="size-4" />{T('تحميل')}</Button></Td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}

function Account() {
  const [f, setF] = useState({ current: '', next: '' });
  const [busy, run] = useAction();
  return (
    <Card title={T('تغيير كلمة المرور')} className="max-w-md">
      <div className="grid gap-3">
        <Field label={T('كلمة المرور الحالية')}><Input type="password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} /></Field>
        <Field label={T('كلمة المرور الجديدة')}><Input type="password" value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} /></Field>
        <Button busy={busy} onClick={() => run(async () => { await api.post('/me/password', { Current: f.current, Next: f.next }); toast(T('تم التغيير')); setF({ current: '', next: '' }); })}>{T('حفظ')}</Button>
      </div>
    </Card>
  );
}

// Per-device display preferences (stored on this device only).
export function Display() {
  const { scale, setScale, dark, toggle } = useTheme();
  return (
    <div className="grid max-w-3xl gap-3">
      <Card title={T('اللغة')}>
        <p className="mb-4 text-sm text-muted">{T('لغة الواجهة على هذا الجهاز. سيُعاد تحميل البرنامج لتطبيقها.')}</p>
        <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label={T('اللغة')}>
          {languages.map(([k, label]) => (
            <button key={k} role="radio" aria-checked={lang === k} onClick={() => lang !== k && setLang(k)}
              className={`flex items-center justify-center gap-2 rounded-2xl border-2 p-4 font-bold transition ${lang === k ? 'border-primary bg-primary-soft text-primary-ink' : 'border-line bg-surface hover:border-primary/40'}`}>
              <span className="num rounded-md bg-surface-2 px-1.5 text-xs uppercase text-muted">{k}</span>{label}
            </button>
          ))}
        </div>
      </Card>
      <Card title={T('حجم الخط')}>
        <p className="mb-4 text-sm text-muted">{T('يُطبَّق على هذا الجهاز فقط — اختر الحجم المناسب لشاشة الكاشير أو التابلت.')}</p>
        <div className="grid grid-cols-5 gap-2" role="radiogroup" aria-label={T('حجم الخط')}>
          {fontScales.map(([k, label, size]) => (
            <button key={k} role="radio" aria-checked={scale === k} onClick={() => setScale(k)}
              className={`flex flex-col items-center gap-2 rounded-2xl border-2 p-4 transition ${scale === k ? 'border-primary bg-primary-soft text-primary-ink' : 'border-line bg-surface hover:border-primary/40'}`}>
              <span className="font-bold leading-none" style={{ fontSize: size + 6 }}>{T('أب')}</span>
              <span className="text-sm font-semibold">{label}</span>
              <span className="num text-xs text-muted">{size}px</span>
            </button>
          ))}
        </div>
      </Card>
      <Card title={T('المظهر')}>
        <div className="flex gap-2">
          <Button variant={dark ? 'secondary' : 'primary'} onClick={() => dark && toggle()}>{T('فاتح')}</Button>
          <Button variant={dark ? 'primary' : 'secondary'} onClick={() => !dark && toggle()}>{T('داكن')}</Button>
        </div>
      </Card>
    </div>
  );
}
