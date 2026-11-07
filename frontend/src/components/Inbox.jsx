import { useEffect, useRef, useState } from 'react';
import { Bell, BellRing, Check, X, Receipt, ShoppingBag, Utensils, Smartphone, Bike, MapPin, TriangleAlert, NotebookPen, GlassWater, Hourglass, MessageSquareMore } from 'lucide-react';
import { api } from '@/lib/api';
import { useApp, toast, toastError } from '@/lib/store';
import { money, minutesSince } from '@/lib/format';
import { Badge, Button, Empty, Input, Modal, cx } from '@/components/ui';
import { T } from '@/lib/i18n';

// Online orders and waiter calls from the e-menu. Polled while a selling
// screen is open; a short chime announces anything new.

// An urgent call (a problem with the food, a late order) sounds sharper and
// longer, so it isn't mistaken for a routine one across the hall.
function chime(urgent) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const notes = urgent ? [[0, 1320], [0.16, 1760], [0.32, 1320], [0.48, 1760]] : [[0, 880], [0.18, 1175]];
    notes.forEach(([at, hz]) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = urgent ? 'square' : 'sine';
      o.frequency.value = hz;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + at);
      g.gain.exponentialRampToValueAtTime(urgent ? 0.12 : 0.25, ctx.currentTime + at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.35);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + at);
      o.stop(ctx.currentTime + at + 0.4);
    });
    setTimeout(() => ctx.close(), 1000);
  } catch { /* no audio */ }
}

const empty = { orders: [], requests: [] };

export function useInbox() {
  const { can, platform } = useApp();
  const enabled = can('pos.sell') && (!platform?.enabled || platform.features?.emenu);
  const [data, setData] = useState(empty);
  const seen = useRef(null);
  const load = async () => {
    if (document.hidden) return; // nothing to see; the next tick catches up
    try {
      const d = await api.get('/inbox');
      const ids = new Set([...d.orders.map((o) => o.id), ...d.requests.map((r) => r.id)]);
      if (seen.current && [...ids].some((id) => !seen.current.has(id))) {
        chime(d.requests.some((r) => !seen.current.has(r.id) && requestKinds[r.kind]?.urgent));
      }
      seen.current = ids;
      setData(d);
    } catch { /* offline for a moment; the next poll retries */ }
  };
  useEffect(() => {
    if (!enabled) return undefined;
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);
  return { enabled, data, reload: load, count: data.orders.length + data.requests.length };
}

export function InboxButton({ inbox, onClick }) {
  if (!inbox.enabled) return null;
  const n = inbox.count;
  const Icon = n ? BellRing : Bell;
  return (
    <button type="button" onClick={onClick} aria-label={T('الطلبات الإلكترونية والنداءات')} title={T('الطلبات الإلكترونية والنداءات')}
      className={cx('relative flex h-10 items-center gap-1.5 rounded-xl border px-3 text-sm font-semibold transition',
        n ? 'border-warning bg-warning text-white shadow-pop animate-pulse motion-reduce:animate-none' : 'border-line bg-surface text-muted hover:text-fg')}>
      <Icon className="size-4" aria-hidden />
      <span className="hidden xl:inline">{T('الطلبات')}</span>
      {n > 0 && <span className="num rounded-full bg-white/25 px-1.5">{n}</span>}
    </button>
  );
}

// What a table calls for (the server's serviceKinds). Urgent ones are red.
export const requestKinds = {
  waiter: { icon: BellRing, label: () => T('ينادي النادل') },
  order: { icon: NotebookPen, label: () => T('جاهزون للطلب') },
  bill: { icon: Receipt, label: () => T('يطلب الفاتورة') },
  extras: { icon: GlassWater, label: () => T('يحتاجون شيئاً') },
  late: { icon: Hourglass, label: () => T('تأخر الطلب'), urgent: true },
  issue: { icon: TriangleAlert, label: () => T('مشكلة في الأكل'), urgent: true },
  other: { icon: MessageSquareMore, label: () => T('طلب آخر') },
};

// The guest's picks, sent as codes so they read in this screen's language.
const requestDetails = {
  cash: () => T('الدفع نقداً'),
  card: () => T('الدفع بالبطاقة — أحضر جهاز الدفع'),
  water: () => T('ماء'),
  napkins: () => T('مناديل'),
  cutlery: () => T('أدوات المائدة'),
  ice: () => T('ثلج'),
  plates: () => T('أطباق إضافية'),
  clean: () => T('تنظيف الطاولة'),
};

const quickReasons = () => [T('الصنف غير متاح الآن'), T('المطبخ مشغول جداً'), T('المطعم مغلق حالياً')];

export function InboxPanel({ open, onClose, inbox, onAccepted }) {
  const [rejecting, setRejecting] = useState(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState('');
  const { orders, requests } = inbox.data;

  const act = async (key, fn) => {
    setBusy(key);
    try {
      await fn();
      await inbox.reload();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy('');
    }
  };
  const accept = (o) => act(o.id, async () => {
    const order = await api.post(`/online-orders/${o.id}/accept`);
    toast(T('تم قبول الطلب وإرساله للمطبخ — طلب #{0}', [order.number]));
    onAccepted?.(order);
  });
  const reject = () => act(rejecting.id, async () => {
    await api.post(`/online-orders/${rejecting.id}/reject`, { reason });
    setRejecting(null);
    setReason('');
    toast(T('تم رفض الطلب'));
  });
  const done = (r) => act(r.id, () => api.post(`/service-requests/${r.id}/done`));

  return (
    <Modal open={open} onClose={onClose} title={T('الطلبات الإلكترونية والنداءات')} icon={Smartphone} size="lg">
      {!orders.length && !requests.length && <Empty icon={Bell} title={T('لا يوجد شيء جديد')}>{T('تظهر هنا الطلبات الواردة من قائمة الطعام الإلكترونية ونداءات الطاولات')}</Empty>}

      {requests.length > 0 && (
        <section className="mb-4">
          <h3 className="mb-2 text-sm font-bold text-muted">{T('نداءات الطاولات')}</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {requests.map((r) => {
              const kind = requestKinds[r.kind] || requestKinds.waiter;
              const urgent = kind.urgent;
              return (
                <div key={r.id} className={cx('flex items-center gap-3 rounded-xl border p-3', urgent ? 'border-danger/40 bg-danger-soft' : 'border-warning/40 bg-warning-soft')}>
                  <kind.icon className={cx('size-5 shrink-0', urgent ? 'text-danger' : 'text-warning')} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="font-bold">{r.table_name}</div>
                    <div className="text-xs text-muted">{kind.label()} · {T('منذ')} {minutesSince(r.created_at)} {T('دقيقة')}</div>
                    {r.details?.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {r.details.map((d) => <span key={d} className="rounded-full bg-surface px-2 py-0.5 text-xs font-semibold">{requestDetails[d]?.() || d}</span>)}
                      </div>
                    )}
                    {r.note && <p className="mt-1 text-sm" dir="auto">{r.note}</p>}
                  </div>
                  <Button size="sm" variant="secondary" icon={Check} busy={busy === r.id} onClick={() => done(r)}>{T('تم')}</Button>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {orders.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-bold text-muted">{T('طلبات بانتظار القبول')}</h3>
          <div className="grid gap-3">
            {orders.map((o) => (
              <article key={o.id} className="rounded-2xl border border-line bg-surface p-3 shadow-card">
                <header className="mb-2 flex flex-wrap items-center gap-2">
                  {o.type === 'dine_in' && <Badge tone="blue"><Utensils className="size-3" aria-hidden /> {o.table_name}</Badge>}
                  {o.type === 'delivery' && <Badge tone="green"><Bike className="size-3" aria-hidden /> {T('توصيل')}</Badge>}
                  {o.type === 'takeaway' && <Badge tone="amber"><ShoppingBag className="size-3" aria-hidden /> {T('طلب خارجي')}</Badge>}
                  {o.customer_name && <span className="font-bold">{o.customer_name}</span>}
                  {o.phone && <a dir="ltr" className="num text-sm text-primary" href={`tel:${o.phone}`}>{o.phone}</a>}
                  <span className="ms-auto text-xs text-muted">{T('منذ')} {minutesSince(o.created_at)} {T('دقيقة')}</span>
                </header>
                {o.address && <p className="mb-2 flex items-start gap-1.5 rounded-xl bg-surface-2 px-3 py-2 text-sm" dir="auto"><MapPin className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />{o.address}</p>}
                <ul className="divide-y divide-line text-sm">
                  {o.lines.map((l, i) => (
                    <li key={i} className="flex gap-2 py-1.5">
                      <span className="num font-bold">{l.qty}×</span>
                      <span className="flex-1">
                        {l.name}
                        {l.modifiers?.length > 0 && <span className="block text-xs text-muted">+ {l.modifiers.map((m) => m.name).join('، ')}</span>}
                        {l.notes && <span className="block text-xs text-warning">{l.notes}</span>}
                      </span>
                      <span className="num">{money(l.total_minor)}</span>
                    </li>
                  ))}
                </ul>
                {o.notes && <p className="mt-2 rounded-lg bg-surface-2 p-2 text-sm">{o.notes}</p>}
                <footer className="mt-3 flex items-center gap-2">
                  <span className="num text-lg font-black text-primary">{money(o.total_minor)}</span>
                  <span className="text-xs text-muted">{T('قبل الضريبة والخدمة')}</span>
                  <Button className="ms-auto" variant="secondary" icon={X} onClick={() => { setRejecting(o); setReason(''); }}>{T('رفض')}</Button>
                  <Button icon={Check} busy={busy === o.id} onClick={() => accept(o)}>{T('قبول وإرسال للمطبخ')}</Button>
                </footer>
              </article>
            ))}
          </div>
        </section>
      )}

      <Modal open={!!rejecting} onClose={() => setRejecting(null)} title={T('سبب الرفض')} size="sm"
        footer={<Button variant="danger" busy={busy === rejecting?.id} disabled={!reason.trim()} onClick={reject}>{T('رفض الطلب')}</Button>}>
        <div className="mb-3 flex flex-wrap gap-2">
          {quickReasons().map((r) => (
            <button key={r} type="button" onClick={() => setReason(r)}
              className={cx('rounded-full border px-3 py-1 text-sm', reason === r ? 'border-primary bg-primary-soft text-primary' : 'border-line')}>{r}</button>
          ))}
        </div>
        <Input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder={T('السبب يظهر للعميل')} />
      </Modal>
    </Modal>
  );
}
