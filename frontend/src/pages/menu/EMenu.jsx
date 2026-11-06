import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus, Trash2, Check, Smartphone, ExternalLink, Copy, Palette, Store, Images, LayoutGrid, Star, Users, ShoppingBag, Languages,
  Phone, ArrowUp, ArrowDown, Eye, EyeOff, Save, Undo2, Tag, CircleAlert, Loader2, Download,
} from 'lucide-react';
import { api } from '@/lib/api';
import { toast, toastError } from '@/lib/store';
import { confirm } from '@/components/Confirm';
import { money, minorInput, toMinor } from '@/lib/format';
import { Badge, Button, Card, Checkbox, Field, Input, Modal, PositionSelect, Segmented, Select, Spinner, Switch, Textarea, cx, useAction, useLoad } from '@/components/ui';
import { ImagePick } from '@/components/ImagePick';
import { T } from '@/lib/i18n';
import { openExternal, copyText } from '@/lib/open';
import { makeAppIcons } from '@/lib/image';
import { overlayGradient } from '@/lib/overlay';

// Recommended picture sizes (they match how the guest page shows them).
export const SIZES = {
  slider: { side: 1600, hint: '1200 × 700 px — الصورة بتملى الكارت كله' },
  family: { side: 1600, hint: '1200 × 480 px — الصورة بتملى البانر كله' },
  category: { side: 512, hint: '400 × 400 px — مربعة' },
  logo: { side: 512, hint: '400 × 400 px — مربعة' },
  appIcon: { hint: '512 × 512 px — مربعة، من غير كلام صغير' },
};

export default function EMenuDesigner() {
  const data = useLoad(async () => {
    const [adm, cats, items] = await Promise.all([api.get('/emenu'), api.get('/categories'), api.get('/items')]);
    return { adm, cats, items };
  });
  const [draft, setDraft] = useState(null);
  const [logo, setLogo] = useState(''); // '' keep · data URL new · '-' remove
  const [appIcon, setAppIcon] = useState(null); // null keep · {512, 192} new · '-' remove
  const [installDemo, setInstallDemo] = useState(null); // {kind, n}: show the popup in the preview
  const [showPreview, setShowPreview] = useState(true);
  const [previewTab, setPreviewTab] = useState('home');
  const [version, setVersion] = useState(0); // bump after instant saves to refresh the preview
  const [busy, run] = useAction();
  const d = data.data;

  useEffect(() => { if (d && !draft) setDraft(d.adm.settings); }, [d, draft]);
  const saved = d?.adm.settings;
  const dirty = !!draft && !!saved && (JSON.stringify(draft) !== JSON.stringify(saved) || logo !== '' || appIcon !== null);
  const set = (k) => (v) => setDraft((s) => ({ ...s, [k]: v?.target ? v.target.value : v }));
  const refresh = useCallback(async () => { await data.reload(true); setVersion((v) => v + 1); }, [data]);

  const save = () => run(async () => {
    const icon = appIcon === '-' ? { app_icon_512_data: '-' } : appIcon ? { app_icon_512_data: appIcon[512], app_icon_192_data: appIcon[192] } : {};
    const adm = await api.put('/emenu/settings', { ...draft, logo_data: logo, ...icon });
    setDraft(adm.settings);
    setLogo('');
    setAppIcon(null);
    await data.reload(true);
    setVersion((v) => v + 1);
    toast(T('تم حفظ إعدادات المنيو الإلكتروني'));
  });
  const undo = () => { setDraft(saved); setLogo(''); setAppIcon(null); };

  if (!d || !draft) return <Spinner />;
  const logoSrc = logo === '-' ? '' : logo || d.adm.logo_url;
  const appIconSrc = appIcon === '-' ? '' : appIcon?.[512] || d.adm.app_icon_url;

  return (
    <div className={cx('grid items-start gap-4', showPreview && 'lg:grid-cols-[minmax(0,1fr)_310px]')}>
      <div className="grid min-w-0 gap-4">
        <div className="sticky top-0 z-10 -mx-1 flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-surface/95 px-3 py-2 shadow-card backdrop-blur">
          <span className="text-sm text-muted">{dirty ? T('فيه تعديلات لم تُحفظ') : T('كل التعديلات محفوظة')}</span>
          <div className="ms-auto flex flex-wrap gap-2">
            <Button variant="secondary" icon={showPreview ? EyeOff : Eye} onClick={() => setShowPreview(!showPreview)}>{showPreview ? T('إخفاء المعاينة') : T('معاينة على الموبايل')}</Button>
            {dirty && <Button variant="secondary" icon={Undo2} onClick={undo}>{T('تراجع')}</Button>}
            <Button icon={Save} busy={busy} disabled={!dirty} onClick={save}>{T('حفظ الإعدادات')}</Button>
          </div>
        </div>

        <StatusCard status={d.adm.status} enabled={!!draft.enabled} onEnabled={set('enabled')} />

        <Card title={T('الهوية')} icon={Store}>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label={T('الاسم اللي فوق في المنيو')} hint={T('لو سبته فاضي هيظهر اسم المطعم من الإعدادات')}>
              <Input value={draft.display_name} maxLength={40} onChange={set('display_name')} />
            </Field>
            <Field label={T('سطر تحت الاسم')} hint={T('مثلاً: برجر هاوس')}>
              <Input value={draft.tagline} maxLength={60} onChange={set('tagline')} />
            </Field>
            <div className="flex items-center gap-3 md:col-span-2">
              {logoSrc ? <img src={logoSrc} alt="" className="size-14 rounded-xl border border-line object-cover" /> : <span className="flex size-14 items-center justify-center rounded-xl bg-surface-2 text-xs text-muted">{T('بدون')}</span>}
              <ImagePick label={T('لوجو (اختياري)')} onPick={setLogo} maxSide={SIZES.logo.side} shape="square" />
              {logoSrc && <Button variant="ghost" icon={Trash2} onClick={() => setLogo('-')}>{T('إزالة')}</Button>}
              <span className="text-xs text-muted" dir="auto">{T(SIZES.logo.hint)}</span>
            </div>
          </div>
        </Card>

        <Card title={T('الألوان')} icon={Palette}>
          <Swatches label={T('لون الأزرار')} list={d.adm.button_colors} value={draft.button_color} onChange={set('button_color')} />
          <Swatches label={T('لون الخلفية')} list={d.adm.backgrounds} value={draft.background} onChange={set('background')} className="mt-4" big />
        </Card>

        <OffersCard kind="single" offers={d.adm.offers.filter((o) => o.kind === 'single')} allOffers={d.adm.offers} items={d.items} overlays={d.adm.overlays} onChanged={refresh} />
        <CategoryImages cats={d.cats} onChanged={refresh} />
        <FeaturedCard featured={d.adm.featured} items={d.items} offers={d.adm.offers} onChanged={refresh} />
        <OffersCard kind="family" offers={d.adm.offers.filter((o) => o.kind === 'family')} allOffers={d.adm.offers} items={d.items} overlays={d.adm.overlays} onChanged={refresh} />

        <Card title={T('الطلب من المنيو')} icon={ShoppingBag}>
          {!d.adm.status.ordering && (
            <p className="mb-3 flex items-center gap-2 rounded-xl bg-warning-soft p-2.5 text-sm text-warning"><CircleAlert className="size-4 shrink-0" />{T('الطلب أونلاين مش مفعّل في باقتك على المنصة — الضيوف هيقدروا يتصفحوا بس')}</p>
          )}
          <div className="grid gap-2.5 sm:grid-cols-2">
            <Toggle label={T('الطلب من الصالة (كود الترابيزة أو كود الصالة)')} checked={draft.allow_dine_in_orders} onChange={set('allow_dine_in_orders')} />
            <Toggle label={T('الطلب توصيل (الاسم والتليفون والعنوان)')} checked={draft.allow_takeaway_orders} onChange={set('allow_takeaway_orders')} />
            <Toggle label={T('زر المساعدة: الويتر والحساب ومشكلة في الأكل (من الأكواد فقط)')} checked={draft.allow_call_waiter} onChange={set('allow_call_waiter')} />
            <Toggle label={T('إظهار الأسعار')} checked={draft.show_prices} onChange={set('show_prices')} />
          </div>
          <p className="mt-3 text-xs text-muted">{T('كل الطلبات بتوصل لصندوق الطلبات الأونلاين في الكاشير ومش بتدخل المطبخ غير لما حد يقبلها. طلب التوصيل بيتسجل على العميل برقم تليفونه.')}</p>
          <Field label={T('وقت التوصيل التقديري (دقيقة)')} hint={T('بيتضاف لوقت تحضير الطلب في طلبات التوصيل')} className="mt-3 max-w-xs">
            <Input className="num" type="number" min={0} max={240} value={draft.delivery_minutes || ''} onChange={(e) => set('delivery_minutes')(Math.max(0, Number(e.target.value) || 0))} />
          </Field>
          <Field label={T('ملاحظة تظهر في السلة')} className="mt-3"><Textarea value={draft.order_note} maxLength={200} onChange={set('order_note')} /></Field>
        </Card>

        <Card title={T('اللغات')} icon={Languages}>
          <div className="flex flex-wrap items-end gap-5">
            <Checkbox label="العربية" checked={draft.lang_ar} onChange={set('lang_ar')} />
            <Checkbox label="English" checked={draft.lang_en} onChange={set('lang_en')} />
            <Checkbox label="Français" checked={draft.lang_fr} onChange={set('lang_fr')} />
            <Field label={T('اللغة الافتراضية')} className="w-48">
              <Select value={draft.default_language} onChange={set('default_language')}>
                <option value="ar">العربية</option><option value="en">English</option><option value="fr">Français</option>
              </Select>
            </Field>
          </div>
        </Card>

        <Card title={T('تطبيق الموبايل')} icon={Download}>
          <p className="mb-3 text-sm text-muted">{T('الضيف يقدر يثبّت المنيو كتطبيق على موبايله. لما يفتح اللينك بتظهرله رسالة تثبيت مرة واحدة في اليوم بس (على الآيفون بتشرحله الخطوتين لأن سفاري مفيهوش زرار تثبيت).')}</p>
          <Toggle label={T('اقتراح تثبيت التطبيق للضيوف (مرة في اليوم)')} checked={draft.install_prompt} onChange={set('install_prompt')} />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            {appIconSrc
              ? <img src={appIconSrc} alt="" className="size-16 rounded-[22%] border border-line object-cover shadow" />
              : <span className="flex size-16 items-center justify-center rounded-[22%] bg-surface-2 text-xs text-muted">{T('بدون')}</span>}
            <div className="grid gap-1">
              <div className="flex flex-wrap gap-2">
                <ImagePick label={appIconSrc ? T('تغيير الأيقونة') : T('أيقونة التطبيق')} prepare={makeAppIcons} onPick={setAppIcon} maxSide={1024} shape="square" />
                {appIconSrc && <Button variant="ghost" icon={Trash2} onClick={() => setAppIcon('-')}>{T('إزالة')}</Button>}
              </div>
              <span className="text-xs text-muted" dir="auto">{T(SIZES.appIcon.hint)}</span>
            </div>
          </div>
          {draft.install_prompt && !appIconSrc && (
            <p className="mt-3 flex items-center gap-2 rounded-xl bg-warning-soft p-2.5 text-sm text-warning"><CircleAlert className="size-4 shrink-0" />{T('ارفع أيقونة عشان رسالة التثبيت تظهر للضيوف')}</p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" icon={Eye} onClick={() => { setShowPreview(true); setInstallDemo((x) => ({ kind: 'android', n: (x?.n || 0) + 1 })); }}>{T('معاينة الرسالة (أندرويد)')}</Button>
            <Button size="sm" variant="secondary" icon={Eye} onClick={() => { setShowPreview(true); setInstallDemo((x) => ({ kind: 'ios', n: (x?.n || 0) + 1 })); }}>{T('معاينة الرسالة (آيفون)')}</Button>
          </div>
        </Card>

        <Card title={T('التواصل')} icon={Phone}>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label={T('التليفون')}><Input dir="ltr" value={draft.phone} maxLength={20} onChange={set('phone')} /></Field>
            <Field label={T('واتساب')}><Input dir="ltr" value={draft.whatsapp} maxLength={20} onChange={set('whatsapp')} /></Field>
            <Field label={T('العنوان')} className="md:col-span-2"><Input value={draft.address} maxLength={160} onChange={set('address')} /></Field>
            <Field label={T('رابط الخريطة')} hint="https://…" className="md:col-span-2"><Input dir="ltr" value={draft.map_url} onChange={set('map_url')} /></Field>
            <Field label="Instagram"><Input dir="ltr" value={draft.instagram} placeholder="@name" onChange={set('instagram')} /></Field>
            <Field label="Facebook"><Input dir="ltr" value={draft.facebook} placeholder="@name" onChange={set('facebook')} /></Field>
            <Field label="TikTok"><Input dir="ltr" value={draft.tiktok} placeholder="@name" onChange={set('tiktok')} /></Field>
            <Field label={T('نص أسفل الصفحة')}><Input value={draft.footer_text} maxLength={120} onChange={set('footer_text')} /></Field>
          </div>
        </Card>
      </div>

      {showPreview && (
        <aside className="sticky top-0 grid justify-items-center gap-3">
          <Segmented className="w-full" value={previewTab} onChange={setPreviewTab}
            options={[['home', T('الرئيسية')], ['menu', T('المنيو')], ['offers', T('العروض')], ['cart', T('السلة')], ['profile', T('بياناتي')]]} />
          <PhonePreview draft={draft} logo={logo} appIcon={appIconSrc} version={version} tab={previewTab} installDemo={installDemo} />
          <p className="text-center text-xs text-muted">{T('المعاينة بتتحدث مع كل تعديل، حتى قبل الحفظ')}</p>
        </aside>
      )}
    </div>
  );
}

// ---- status ----------------------------------------------------------------------------

function StatusCard({ status, enabled, onEnabled }) {
  const url = status.menu_url;
  return (
    <Card title={T('حالة المنيو الإلكتروني')} icon={Smartphone}>
      <div className="flex flex-wrap items-center gap-3">
        <Switch checked={enabled} onChange={onEnabled} label={T('المنيو متاح للضيوف')} />
        <span className="font-semibold">{T('المنيو متاح للضيوف')}</span>
        <span className="ms-auto flex flex-wrap gap-2">
          {status.licensed ? <Badge tone="green" dot>{T('مفعّل في باقتك')}</Badge> : <Badge tone="amber" dot>{T('غير مفعّل في باقتك')}</Badge>}
          {status.open ? <Badge tone="green" dot>{T('شغال للضيوف')}</Badge> : <Badge tone="gray" dot>{T('مقفول للضيوف')}</Badge>}
        </span>
      </div>
      {url ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-surface-2 p-2.5">
          <span className="num min-w-0 flex-1 truncate font-semibold" dir="ltr">{url}</span>
          <Button size="sm" variant="secondary" icon={Copy} onClick={async () => { if (await copyText(url)) toast(T('تم نسخ الرابط')); }}>{T('نسخ')}</Button>
          <Button size="sm" variant="secondary" icon={ExternalLink} onClick={() => openExternal(url)}>{T('فتح')}</Button>
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted">{T('رابط المنيو بيظهر هنا لما الدومين يتفعّل من المنصة. تقدر تجهز المنيو وتشوفه في المعاينة من دلوقتي.')}</p>
      )}
    </Card>
  );
}

function Toggle({ label, checked, onChange }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-surface-2 px-3 py-2">
      <span className="text-sm font-semibold">{label}</span>
      <Switch checked={!!checked} onChange={onChange} label={label} />
    </div>
  );
}

const colorNames = {
  ember: 'برتقالي', red: 'أحمر', gold: 'ذهبي', green: 'أخضر', teal: 'تركواز', blue: 'أزرق', purple: 'بنفسجي', pink: 'وردي', black: 'أسود',
  cream: 'كريمي', white: 'أبيض', fresh: 'نعناعي', midnight: 'ليلي', espresso: 'إسبريسو',
};

function Swatches({ label, list, value, onChange, className, big }) {
  return (
    <div className={className}>
      <div className="mb-2 text-sm font-semibold">{label}</div>
      <div className="flex flex-wrap gap-2.5" role="radiogroup" aria-label={label}>
        {list.map((c) => (
          <button key={c.id} role="radio" aria-checked={value === c.id} title={T(colorNames[c.id] || c.id)} onClick={() => onChange(c.id)}
            className={cx('flex flex-col items-center gap-1 rounded-xl p-1 text-xs transition', value === c.id ? 'bg-primary-soft text-primary-ink' : 'text-muted hover:bg-surface-2')}>
            <span className={cx('flex items-center justify-center rounded-full border border-black/10 shadow-inner', big ? 'h-10 w-14 rounded-lg' : 'size-9')} style={{ background: c.hex }}>
              {value === c.id && <Check className="size-4" style={{ color: isLight(c.hex) ? '#111' : '#fff' }} />}
            </span>
            {T(colorNames[c.id] || c.id)}
          </button>
        ))}
      </div>
    </div>
  );
}

function isLight(hex) {
  const n = parseInt(hex.slice(1), 16);
  return ((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114 > 160;
}

// ---- offers ---------------------------------------------------------------------------

function OffersCard({ kind, offers, allOffers, items, overlays, onChanged }) {
  const [edit, setEdit] = useState(null);
  const open = (o, i) => setEdit({ ...o, price: minorInput(o.price_minor), sort: i + 1, prep: o.prep_minutes || '' });
  const family = kind === 'family';
  const toggle = async (o, active) => {
    try { await api.post('/emenu/offers', { ...o, active }); onChanged(); } catch (e) { toastError(e); }
  };
  return (
    <Card title={family ? T('العروض المجمعة (للعيلة)') : T('عروض السلايدر (للفرد)')} icon={family ? Users : Images}
      actions={<Button size="sm" icon={Plus} onClick={() => setEdit({ kind, name: '', description: '', price: '', badge: '', highlight: '', sort: offers.length + 1, prep: '', contents: [], overlay_opacity: 75, overlay_color: 'black', active: true })}>{T('عرض جديد')}</Button>}>
      <p className="mb-3 text-sm text-muted">
        {family ? T('بانرات عريضة تحت الأصناف المميزة — للوجبات المجمعة والعروض العائلية.') : T('الصور المتحركة أعلى المنيو. الضيف يدوس «اطلب الآن» فيضاف العرض للسلة بنفس السعر اللي هنا.')}
      </p>
      {!offers.length && <p className="rounded-xl bg-surface-2 p-4 text-center text-sm text-muted">{T('لا توجد عروض بعد')}</p>}
      <div className="grid gap-2">
        {offers.map((o, i) => (
          <div key={o.id} role="button" tabIndex={0} onClick={() => open(o, i)} onKeyDown={(e) => e.key === 'Enter' && open(o, i)}
            className="flex cursor-pointer items-center gap-3 rounded-xl border border-line p-2 transition hover:bg-surface-2">
            {o.image ? <img src={o.image} alt="" className={cx('rounded-lg object-cover', family ? 'h-12 w-20' : 'size-12')} /> : <span className="size-12 rounded-lg bg-surface-2" />}
            <div className="min-w-0 flex-1">
              <div className="truncate font-bold">{o.name}</div>
              <div className="truncate text-xs text-muted">{contentsLabel(o.contents) || o.description}</div>
            </div>
            {o.badge && <Badge tone="primary">{o.badge}</Badge>}
            {o.highlight && <Badge tone="amber">{o.highlight}</Badge>}
            <span className="num font-bold">{money(o.price_minor)}</span>
            <Switch checked={o.active} onChange={(v) => toggle(o, v)} label={T('ظاهر')} />
          </div>
        ))}
      </div>
      {edit && <OfferDialog offer={edit} count={offers.length + (edit.id ? 0 : 1)} allOffers={allOffers} items={items} overlays={overlays} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); onChanged(); }} />}
    </Card>
  );
}

// «2 مارجريتا + 2 برجر»
const contentsLabel = (list) => (list || []).map((c) => `${c.qty} ${c.name}`).join(' + ');

const overlayNames = { black: 'أسود', brown: 'بني', navy: 'كحلي', green: 'أخضر', red: 'أحمر', purple: 'بنفسجي' };

function OfferDialog({ offer, count, allOffers, items, overlays, onClose, onSaved }) {
  const [f, setF] = useState(offer);
  const [image, setImage] = useState('');
  const [busy, run] = useAction();
  const family = f.kind === 'family';
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = () => run(async () => {
    const price = toMinor(f.price);
    if (!price || price <= 0) throw new Error(T('سعر العرض يجب أن يكون أكبر من صفر'));
    if (!f.id && !image) throw new Error(T('اختر صورة للعرض'));
    await api.post('/emenu/offers', { ...f, price_minor: price, prep_minutes: Number(f.prep) || 0, image_data: image });
    toast(T('تم الحفظ'));
    onSaved();
  });
  const remove = async () => {
    if (!(await confirm({ title: T('حذف «{0}»', [f.name]), message: T('هيتحذف العرض والصنف بتاعه. لو العرض اتباع قبل كده هيتأرشف مع الاحتفاظ بالسجل.') }))) return;
    try { await api.del(`/emenu/offers/${f.id}`); toast(T('تم الحذف')); onSaved(); } catch (e) { toastError(e); }
  };
  const src = image || f.image;
  const overlayHex = overlays.find((c) => c.id === f.overlay_color)?.hex || '#000000';
  return (
    <Modal open onClose={onClose} title={f.id ? f.name : family ? T('عرض مجمع جديد') : T('عرض سلايدر جديد')} size="lg"
      footer={<>{f.id && <Button variant="danger-soft" icon={Trash2} className="me-auto" onClick={remove}>{T('حذف')}</Button>}<Button variant="secondary" onClick={onClose}>{T('إلغاء')}</Button><Button busy={busy} onClick={save}>{T('حفظ')}</Button></>}>
      <div className="grid gap-4 md:grid-cols-[1fr_220px]">
        <div className="grid content-start gap-3">
          <Field label={T('اسم العرض')}><Input autoFocus value={f.name} maxLength={80} onChange={set('name')} placeholder={family ? T('برجر + بطاطس + مشروب') : T('برجر مشوي على الفحم')} /></Field>
          <Field label={T('المكونات / الوصف')} hint={T('يظهر للضيف تحت اسم العرض')}><Textarea value={f.description} maxLength={300} onChange={set('description')} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={T('السعر')}><Input className="num" value={f.price} onChange={set('price')} inputMode="decimal" /></Field>
            <Field label={T('الترتيب')}><PositionSelect count={count} value={f.sort} onChange={(v) => setF({ ...f, sort: v })} /></Field>
            <Field label={T('شارة صغيرة')} hint={T('مثلاً: ساخن وطازة')}><Input value={f.badge} maxLength={20} onChange={set('badge')} /></Field>
            {family && <Field label={T('ملصق التوفير')} hint={T('شارة صغيرة في ركن الصورة، مثلاً: وفّر 20%')}><Input value={f.highlight} maxLength={16} onChange={set('highlight')} /></Field>}
            <Field label={T('وقت التحضير التقديري (دقيقة)')} hint={T('لو سبته فاضي هيتحسب من أطول صنف في العرض')}><Input className="num" type="number" min={0} max={240} value={f.prep} onChange={set('prep')} /></Field>
          </div>
          <OfferContents offer={f} items={items} allOffers={allOffers} onChange={(next) => setF(next)} />
          <Checkbox label={T('ظاهر في المنيو ونقطة البيع')} checked={f.active} onChange={(v) => setF({ ...f, active: v })} />
          <p className="text-xs text-muted">{T('العرض بيتسجل كصنف في قسم «العروض»، فيتباع من نقطة البيع ويطلع في التقارير والمطبخ زي أي صنف.')}</p>
        </div>
        <div className="grid content-start justify-items-center gap-2">
          <div className={cx('relative w-full overflow-hidden rounded-2xl border border-line', family ? 'aspect-[5/2]' : 'aspect-[12/7]')} style={{ backgroundColor: overlayHex }}>
            {src && <img src={src} alt="" className="absolute inset-0 size-full object-cover" />}
            <div className="absolute inset-0 flex flex-col justify-end p-2.5 text-white" style={{ backgroundImage: overlayGradient(overlayHex, f.overlay_opacity) }}>
              <span className="line-clamp-1 text-sm font-black drop-shadow" dir="auto">{f.name || T('اسم العرض')}</span>
              {f.price && <span className="num text-xs font-bold drop-shadow">{f.price}</span>}
            </div>
          </div>
          <ImagePick label={src ? T('تغيير الصورة') : T('اختيار صورة')} onPick={setImage} maxSide={1600} shape={family ? 'family' : 'slider'} />
          <label className="grid w-full gap-1 text-sm font-semibold">
            <span className="flex justify-between">{T('درجة الغمقان')}<span className="num text-muted">{f.overlay_opacity}%</span></span>
            <input type="range" min={0} max={100} step={5} value={f.overlay_opacity} onChange={(e) => setF({ ...f, overlay_opacity: Number(e.target.value) })} className="accent-[var(--primary)]" />
          </label>
          <div className="w-full">
            <div className="mb-1.5 text-sm font-semibold">{T('لون الخلفية')}</div>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={T('لون الخلفية')}>
              {overlays.map((c) => (
                <button key={c.id} type="button" role="radio" aria-checked={f.overlay_color === c.id} aria-label={T(overlayNames[c.id] || c.id)} title={T(overlayNames[c.id] || c.id)}
                  onClick={() => setF({ ...f, overlay_color: c.id })}
                  className={cx('flex size-8 items-center justify-center rounded-full border border-black/10 shadow-inner', f.overlay_color === c.id && 'ring-2 ring-primary ring-offset-2 ring-offset-surface')} style={{ background: c.hex }}>
                  {f.overlay_color === c.id && <Check className="size-4 text-white" aria-hidden />}
                </button>
              ))}
            </div>
          </div>
          <span className="text-center text-xs text-muted" dir="auto">{T('المقاس المناسب')}: {T(SIZES[family ? 'family' : 'slider'].hint)}</span>
        </div>
      </div>
    </Modal>
  );
}

// What the offer is made of, from items already on the menu. The kitchen gets
// this list and stock is deducted from these items' recipes.
function OfferContents({ offer, items, allOffers, onChange }) {
  const [pick, setPick] = useState('');
  const [qty, setQty] = useState(1);
  const contents = offer.contents || [];
  const offerItems = useMemo(() => new Set(allOffers.map((o) => o.item_id)), [allOffers]);
  const candidates = items.filter((i) => i.active && !offerItems.has(i.id) && !contents.some((c) => c.item_id === i.id));
  const worth = contents.reduce((s, c) => s + c.price_minor * c.qty, 0);
  const price = toMinor(offer.price) || 0;

  // Keep the suggested name in step until the owner writes their own.
  const update = (next) => onChange({ ...offer, contents: next, name: !offer.name || offer.name === contentsLabel(contents) ? contentsLabel(next) : offer.name });
  const add = () => {
    const it = items.find((i) => i.id === pick);
    if (!it) return;
    update([...contents, { item_id: it.id, name: it.name, price_minor: it.price_minor, qty: Math.max(1, Number(qty) || 1) }]);
    setPick('');
    setQty(1);
  };
  return (
    <div className="rounded-xl bg-surface-2 p-3">
      <div className="font-bold">{T('مكونات العرض من أصناف المنيو')}</div>
      <p className="mb-2 text-xs text-muted">{T('اختياري: المكونات بتظهر للمطبخ والضيف، والمخزون بيتخصم من وصفاتها.')}</p>
      <div className="flex gap-2">
        <Select className="min-w-0 flex-1" value={pick} aria-label={T('صنف')} onChange={(e) => setPick(e.target.value)}>
          <option value="">{T('— اختر صنف —')}</option>
          {candidates.map((i) => <option key={i.id} value={i.id}>{i.name} — {money(i.price_minor)}</option>)}
        </Select>
        <Input className="num w-16" type="number" min={1} max={50} aria-label={T('الكمية')} value={qty} onChange={(e) => setQty(e.target.value)} />
        <Button variant="secondary" icon={Plus} disabled={!pick || contents.length >= 12} onClick={add}>{T('إضافة')}</Button>
      </div>
      {contents.length > 0 && (
        <div className="mt-2 grid gap-1.5">
          {contents.map((c) => (
            <div key={c.item_id} className="flex items-center gap-2 rounded-lg bg-surface px-2 py-1.5">
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">{c.name}</span>
              <span className="num text-xs text-muted">{money(c.price_minor)}</span>
              <Input className="num w-16" type="number" min={1} max={50} aria-label={T('الكمية')} value={c.qty}
                onChange={(e) => update(contents.map((x) => (x === c ? { ...x, qty: Math.min(50, Math.max(1, Number(e.target.value) || 1)) } : x)))} />
              <button type="button" aria-label={T('إزالة')} onClick={() => update(contents.filter((x) => x !== c))} className="rounded-lg p-1.5 text-danger hover:bg-danger-soft"><Trash2 className="size-4" /></button>
            </div>
          ))}
          <p className="text-sm text-muted">
            {T('سعرهم منفصلين')}: <span className="num font-bold">{money(worth)}</span>
            {price > 0 && price < worth && <> · {T('الضيف بيوفر')} <span className="num font-bold text-primary">{money(worth - price)}</span></>}
          </p>
        </div>
      )}
    </div>
  );
}

// ---- category pictures ------------------------------------------------------------------

function CategoryImages({ cats, onChanged }) {
  const [busyId, setBusyId] = useState('');
  const setImage = async (c, data) => {
    setBusyId(c.id);
    try { await api.put(`/categories/${c.id}/image`, { image_data: data }); await onChanged(); } catch (e) { toastError(e); } finally { setBusyId(''); }
  };
  const shown = cats.filter((c) => c.active);
  return (
    <Card title={T('أيقونات الأقسام')} icon={LayoutGrid}>
      <p className="mb-3 text-sm text-muted">{T('صورة دائرية لكل قسم في الشريط المتحرك تحت السلايدر. الأقسام نفسها بتتعدل من تبويب «الأقسام».')} <span dir="auto">({T(SIZES.category.hint)})</span></p>
      {!shown.length && <p className="rounded-xl bg-surface-2 p-4 text-center text-sm text-muted">{T('لا توجد أقسام ظاهرة')}</p>}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-3">
        {shown.map((c) => (
          <div key={c.id} className="flex flex-col items-center gap-2 rounded-xl border border-line p-3">
            <span className="flex size-16 items-center justify-center overflow-hidden rounded-full bg-surface-2">
              {c.image ? <img src={c.image} alt="" className="size-full object-cover" /> : <span className="text-xl font-bold text-primary">{c.name.slice(0, 1)}</span>}
            </span>
            <span className="line-clamp-1 text-sm font-semibold">{c.name}</span>
            <div className="flex gap-1">
              {busyId === c.id ? <Loader2 className="size-5 animate-spin text-primary" /> : <ImagePick size="sm" maxSide={SIZES.category.side} shape="round" label={c.image ? T('تغيير') : T('صورة')} onPick={(data) => setImage(c, data)} />}
              {c.image && busyId !== c.id && (
                <button onClick={() => setImage(c, '-')} aria-label={T('إزالة')} title={T('إزالة')} className="flex size-8 items-center justify-center rounded-lg text-danger hover:bg-danger-soft"><Trash2 className="size-4" /></button>
              )}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ---- featured items -------------------------------------------------------------------

const badges = [['', 'بدون شارة'], ['bestseller', 'الأكثر مبيعاً'], ['hot_deal', 'عرض ساخن'], ['new', 'جديد']];

function FeaturedCard({ featured, items, offers, onChanged }) {
  const [list, setList] = useState(featured);
  const [pick, setPick] = useState('');
  const [busy, run] = useAction();
  useEffect(() => setList(featured), [featured]);
  const offerItems = useMemo(() => new Set(offers.map((o) => o.item_id)), [offers]);
  const byId = useMemo(() => Object.fromEntries(items.map((i) => [i.id, i])), [items]);
  const candidates = items.filter((i) => i.active && !offerItems.has(i.id) && !list.some((f) => f.item_id === i.id));

  const commit = (next) => run(async () => {
    setList(next);
    await api.put('/emenu/featured', next.map(({ item_id: id, badge, note, deal_price_minor: deal }) => ({ item_id: id, badge, note, deal_price_minor: deal })));
    await onChanged();
  });
  const move = (i, by) => {
    const next = [...list];
    const j = i + by;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    commit(next);
  };

  return (
    <Card title={T('الأصناف المميزة')} icon={Star}>
      <p className="mb-3 text-sm text-muted">{T('تظهر في صف «الأكثر طلباً» مع شارة لكل صنف. «عرض الكل» بيفتح المنيو كامل مترتب بالأقسام.')} {T('سعر «عرض ساخن» بيطبق على الطلب من المنيو الإلكتروني بس، مش على البيع من الكاشير.')}</p>
      <div className="mb-3 flex gap-2">
        <Select className="flex-1" value={pick} onChange={(e) => setPick(e.target.value)}>
          <option value="">{T('— اختر صنف —')}</option>
          {candidates.map((i) => <option key={i.id} value={i.id}>{i.name} — {money(i.price_minor)}</option>)}
        </Select>
        <Button icon={Plus} disabled={!pick || busy || list.length >= 24} onClick={() => { commit([...list, { item_id: pick, badge: '', note: '', deal_price_minor: 0 }]); setPick(''); }}>{T('إضافة')}</Button>
      </div>
      {!list.length && <p className="rounded-xl bg-surface-2 p-4 text-center text-sm text-muted">{T('لا توجد أصناف مميزة بعد')}</p>}
      <div className="grid gap-2">
        {list.map((f, i) => {
          const it = byId[f.item_id] || f;
          const patch = (p) => commit(list.map((x) => (x === f ? { ...x, ...p } : x)));
          const setDeal = (e) => {
            const v = e.target.value.trim() ? toMinor(e.target.value) : 0;
            if (v == null || v < 0 || (v > 0 && v >= it.price_minor)) {
              toastError(new Error(T('سعر العرض لازم يكون أقل من سعر الصنف')));
              e.target.value = f.deal_price_minor ? minorInput(f.deal_price_minor) : '';
            } else if (v !== f.deal_price_minor) patch({ deal_price_minor: v });
          };
          return (
            <div key={f.item_id} className="rounded-xl border border-line p-2">
              <div className="flex items-center gap-3">
                {it.image ? <img src={it.image} alt="" className="size-11 rounded-lg object-cover" /> : <span className="flex size-11 items-center justify-center rounded-lg bg-surface-2"><Tag className="size-4 text-muted" /></span>}
                <div className="min-w-0 flex-1">
                  <div className="truncate font-bold">{it.name}</div>
                  <div className="num text-xs text-muted">
                    {f.deal_price_minor > 0 ? <><span className="font-bold text-primary">{money(f.deal_price_minor)}</span> <s>{money(it.price_minor)}</s></> : money(it.price_minor)}
                  </div>
                </div>
                <Select className="w-40" value={f.badge} aria-label={T('الشارة')} onChange={(e) => patch({ badge: e.target.value, deal_price_minor: e.target.value === 'hot_deal' ? f.deal_price_minor : 0 })}>
                  {badges.map(([k, l]) => <option key={k} value={k}>{T(l)}</option>)}
                </Select>
                <button disabled={i === 0 || busy} onClick={() => move(i, -1)} aria-label={T('لأعلى')} className="rounded-lg p-1.5 text-muted hover:bg-surface-2 disabled:opacity-30"><ArrowUp className="size-4" /></button>
                <button disabled={i === list.length - 1 || busy} onClick={() => move(i, 1)} aria-label={T('لأسفل')} className="rounded-lg p-1.5 text-muted hover:bg-surface-2 disabled:opacity-30"><ArrowDown className="size-4" /></button>
                <button disabled={busy} onClick={() => commit(list.filter((x) => x !== f))} aria-label={T('إزالة')} className="rounded-lg p-1.5 text-danger hover:bg-danger-soft"><Trash2 className="size-4" /></button>
              </div>
              {f.badge && (
                <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_140px]">
                  <Input defaultValue={f.note} maxLength={40} placeholder={T('معلومة قصيرة للضيف، مثلاً: لفترة محدودة')} aria-label={T('معلومة قصيرة للضيف')}
                    onBlur={(e) => { if (e.target.value.trim() !== f.note) patch({ note: e.target.value.trim() }); }} />
                  {f.badge === 'hot_deal' && (
                    <Input className="num" inputMode="decimal" defaultValue={f.deal_price_minor ? minorInput(f.deal_price_minor) : ''} placeholder={T('سعر العرض')} aria-label={T('سعر العرض')} onBlur={setDeal} />
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ---- phone preview ------------------------------------------------------------------------

// The real guest page in an iframe, fed the menu built by the server from
// the unsaved draft. Same origin, so messages are checked both ways.
function PhonePreview({ draft, logo, appIcon, version, tab, installDemo }) {
  const frame = useRef(null);
  const latest = useRef(null);
  const [error, setError] = useState('');

  const send = useCallback((resetLang) => {
    const w = frame.current?.contentWindow;
    if (w && latest.current) w.postMessage({ type: 'cpro:emenu-preview', menu: latest.current, tab, resetLang }, '/');
  }, [tab]);

  useEffect(() => {
    const onMsg = (e) => {
      if (e.origin === window.location.origin && e.source === frame.current?.contentWindow && e.data?.type === 'cpro:emenu-ready') send(true);
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [send]);

  // Rebuild (debounced) whenever the draft or saved content changes.
  useEffect(() => {
    let stale = false;
    const id = setTimeout(async () => {
      try {
        const m = await api.post('/emenu/preview', draft);
        if (stale) return;
        if (logo === '-') m.restaurant.logo = '';
        else if (logo) m.restaurant.logo = logo;
        m.app = { ...m.app, icon: appIcon || '' };
        latest.current = m;
        setError('');
        send(false);
      } catch (e) {
        if (!stale) setError(e.message);
      }
    }, 300);
    return () => { stale = true; clearTimeout(id); };
  }, [draft, logo, appIcon, version, send]);

  // «Preview the message» buttons: show the install popup inside the phone.
  useEffect(() => {
    const w = frame.current?.contentWindow;
    if (installDemo && w && latest.current) w.postMessage({ type: 'cpro:emenu-preview', menu: latest.current, install: installDemo.kind }, '/');
  }, [installDemo]);

  useEffect(() => { send(false); }, [tab, send]);

  // A real 390 × 844 phone screen, drawn at 70% so it fits beside the form.
  const scale = 0.7;
  const W = 390 + 20;
  const H = 844 + 20;
  return (
    <div className="relative" style={{ width: W * scale, height: H * scale }}>
      <div className="absolute overflow-hidden rounded-[46px] border-[10px] border-neutral-900 bg-neutral-900 shadow-pop"
        style={{ width: W, height: H, left: 0, top: 0, transform: `scale(${scale})`, transformOrigin: '0 0' }}>
        <span className="absolute left-1/2 top-0 z-10 h-6 w-32 -translate-x-1/2 rounded-b-2xl bg-neutral-900" aria-hidden />
        <iframe ref={frame} title={T('معاينة المنيو')} src="/menu.html?preview=1" className="size-full rounded-[36px] bg-white" />
      </div>
      {error && <p className="absolute inset-x-2 bottom-3 rounded-xl bg-danger-soft p-2 text-center text-xs font-semibold text-danger">{error}</p>}
    </div>
  );
}
