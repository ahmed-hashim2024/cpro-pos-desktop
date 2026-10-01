import { useEffect, useRef, useState } from 'react';
import { Bell, BellRing, Check, X, Receipt, ShoppingBag, Utensils, Smartphone } from 'lucide-react';
import { api } from '@/lib/api';
import { useApp, toast, toastError } from '@/lib/store';
import { money, minutesSince } from '@/lib/format';
import { Badge, Button, Empty, Input, Modal, cx } from '@/components/ui';
import { T } from '@/lib/i18n';

// Online orders and waiter calls from the e-menu. Polled while a selling
// screen is open; a short chime announces anything new.

function chime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.18].forEach((at, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = i ? 1175 : 880;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + at);
      g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + at + 0.02);
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
    try {
      const d = await api.get('/inbox');
      const ids = new Set([...d.orders.map((o) => o.id), ...d.requests.map((r) => r.id)]);
      if (seen.current && [...ids].some((id) => !seen.current.has(id))) chime();
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
    <button type="button" onClick={onClick} aria-label={T('الطلبات الأونلاين والنداءات')} title={T('الطلبات الأونلاين والنداءات')}
      className={cx('relative flex h-10 items-center gap-1.5 rounded-xl border px-3 text-sm font-semibold transition',
        n ? 'border-warning bg-warning text-white shadow-pop animate-pulse motion-reduce:animate-none' : 'border-line bg-surface text-muted hover:text-fg')}>
      <Icon className="size-4" aria-hidden />
      <span className="hidden xl:inline">{T('أونلاين')}</span>
      {n > 0 && <span className="num rounded-full bg-white/25 px-1.5">{n}</span>}
    </button>
  );
}

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
    <Modal open={open} onClose={onClose} title={T('الطلبات الأونلاين والنداءات')} icon={Smartphone} size="lg">
      {!orders.length && !requests.length && <Empty icon={Bell} title={T('لا يوجد شيء جديد')}>{T('الطلبات من المنيو الإلكتروني ونداءات الطاولات تظهر هنا')}</Empty>}

      {requests.length > 0 && (
        <section className="mb-4">
          <h3 className="mb-2 text-sm font-bold text-muted">{T('نداءات الطاولات')}</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {requests.map((r) => (
              <div key={r.id} className="flex items-center gap-3 rounded-xl border border-warning/40 bg-warning-soft p-3">
                {r.kind === 'bill' ? <Receipt className="size-5 text-warning" aria-hidden /> : <BellRing className="size-5 text-warning" aria-hidden />}
                <div className="flex-1">
                  <div className="font-bold">{r.table_name}</div>
                  <div className="text-xs text-muted">{r.kind === 'bill' ? T('يطلب الحساب') : T('ينادي الويتر')} · {T('منذ')} {minutesSince(r.created_at)} {T('دقيقة')}</div>
                </div>
                <Button size="sm" variant="secondary" icon={Check} busy={busy === r.id} onClick={() => done(r)}>{T('تم')}</Button>
              </div>
            ))}
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
                  {o.type === 'dine_in'
                    ? <Badge tone="blue"><Utensils className="size-3" aria-hidden /> {o.table_name}</Badge>
                    : <Badge tone="amber"><ShoppingBag className="size-3" aria-hidden /> {T('تيك أواي')}</Badge>}
                  {o.customer_name && <span className="font-bold">{o.customer_name}</span>}
                  {o.phone && <a dir="ltr" className="num text-sm text-primary" href={`tel:${o.phone}`}>{o.phone}</a>}
                  <span className="ms-auto text-xs text-muted">{T('منذ')} {minutesSince(o.created_at)} {T('دقيقة')}</span>
                </header>
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
