import { useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Send, PauseCircle, Percent, Trash2, User, Printer, Plus, Minus, ChefHat, ClipboardList, X, Utensils,
  LayoutDashboard, LayoutGrid, RefreshCw, ShoppingBag, CreditCard, Store, Lock, Timer, Wallet,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useApp, toast, toastError } from '@/lib/store';
import { money, moneyC, orderTypes, qty, kitchenStatus, currencyLabel } from '@/lib/format';
import { printReceipt, printKitchenTicket } from '@/lib/print';
import { Button, Badge, Modal, Select, Spinner, Empty, IconButton, SearchInput, Segmented, cx, useLoad } from '@/components/ui';
import { withApproval } from '@/components/Approval';
import { ModifierDialog, LineDialog, VoidDialog, DiscountDialog, CustomerDialog, OpenShiftDialog, PayDialog } from './dialogs';

export default function POS() {
  const { settings, shift, can } = useApp();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const menu = useLoad(async () => {
    const [items, categories, groups, tables] = await Promise.all([
      api.get('/items'), api.get('/categories'), api.get('/modifier-groups'), api.get('/tables'),
    ]);
    return {
      items: items.filter((i) => i.active),
      categories: categories.filter((c) => c.active),
      groups: Object.fromEntries(groups.map((g) => [g.id, g])),
      tables: tables.filter((t) => t.active),
    };
  });
  const openOrders = useLoad(() => api.get('/orders/open'), [], { poll: 15000 });

  const [order, setOrder] = useState(null);
  const [draft, setDraft] = useState({ type: 'takeaway', table_id: '', customer: null, guests: 0 });
  const [cat, setCat] = useState('');
  const [search, setSearch] = useState('');
  const [dialog, setDialog] = useState(null);
  const [busy, setBusy] = useState(false);

  // Open an existing order from ?order=ID (tables screen, orders list).
  const orderParam = params.get('order');
  useEffect(() => {
    if (!orderParam) return;
    api.get(`/orders/${orderParam}`).then((o) => {
      setOrder(o);
    }).catch(toastError);
  }, [orderParam]);
  // Start a table order from ?table=ID.
  const tableParam = params.get('table');
  useEffect(() => {
    if (!tableParam) return;
    setOrder(null);
    setDraft((d) => ({ ...d, type: 'dine_in', table_id: tableParam }));
  }, [tableParam]);

  const run = useCallback(async (fn) => {
    setBusy(true);
    try {
      const o = await fn();
      if (o?.id) setOrder(o);
      openOrders.reload(true);
      return o;
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  }, [openOrders]);

  const ensureOrder = async () => {
    if (order) return order;
    const o = await api.post('/orders', {
      type: draft.type, table_id: draft.type === 'dine_in' ? draft.table_id : '', customer_id: draft.customer?.id || '', guests: Number(draft.guests) || 0,
    }, { idempotent: true });
    setOrder(o);
    setParams({ order: o.id }, { replace: true });
    return o;
  };

  const addItem = async (item, extra = {}) => {
    if (draft.type === 'dine_in' && !order && !draft.table_id && menu.data.tables.length) {
      return toastError(new Error('اختر الطاولة أولاً'));
    }
    await run(async () => {
      const o = await ensureOrder();
      // Tapping a plain item again bumps its unsent line instead of adding a new one.
      const same = !extra.modifier_ids?.length && !extra.notes &&
        o.lines.find((l) => l.item_id === item.id && !l.sent_at && !l.voided && !l.modifiers.length && !l.notes && !l.discount_kind);
      if (same) return api.put(`/orders/${o.id}/lines/${same.id}`, { ...lineBody(same), qty_milli: same.qty_milli + (extra.qty_milli || 1000) });
      return api.post(`/orders/${o.id}/lines`, { item_id: item.id, qty_milli: 1000, ...extra });
    });
  };
  const pickItem = (item) => {
    const hasMods = item.modifier_group_ids.some((id) => menu.data.groups[id]?.active);
    if (hasMods) setDialog({ kind: 'mods', item });
    else addItem(item);
  };

  const newOrder = () => {
    setOrder(null);
    setDraft({ type: draft.type === 'dine_in' ? 'dine_in' : draft.type, table_id: '', customer: null, guests: 0 });
    setParams({}, { replace: true });
  };

  const updateHeader = (patch) => {
    if (!order) return setDraft({ ...draft, ...patch });
    const body = {
      type: patch.type ?? order.type,
      table_id: patch.table_id ?? order.table_id,
      customer_id: patch.customer ? patch.customer.id : patch.customer === null ? '' : order.customer_id,
      guests: Number(patch.guests ?? order.guests) || 0,
      notes: order.notes,
    };
    run(() => api.put(`/orders/${order.id}`, body));
  };

  const send = async () => {
    const pending = order.lines.filter((l) => !l.sent_at && !l.voided);
    const o = await run(() => api.post(`/orders/${order.id}/send`));
    if (o && pending.length) {
      toast('تم الإرسال للمطبخ');
      if (settings.print_kitchen) printKitchenTicket(o, pending);
    }
  };

  const hold = async () => {
    const o = await run(() => api.post(`/orders/${order.id}/hold`, { held: true }));
    if (o) { toast(`تم تعليق الطلب #${o.number}`); newOrder(); }
  };

  const paid = ({ order: o, change_minor: change }) => {
    setDialog(null);
    if (settings.auto_print_receipt) printReceipt(o, settings, { change });
    toast(change ? `تم الدفع — الباقي ${money(change)}` : 'تم الدفع');
    openOrders.reload(true);
    if (o.type === 'dine_in') navigate('/tables');
    newOrder();
  };

  const startPay = () => {
    if (!shift) return setDialog({ kind: 'shift', then: 'pay' });
    setDialog({ kind: 'pay' });
  };

  const items = useMemo(() => {
    if (!menu.data) return [];
    const s = search.trim().toLowerCase();
    return menu.data.items.filter((i) => (s ? i.name.toLowerCase().includes(s) || i.code.toLowerCase().includes(s) : !cat || i.category_id === cat));
  }, [menu.data, cat, search]);

  if (menu.loading && !menu.data) return <Spinner />;
  const live = order?.lines.filter((l) => !l.voided) || [];
  const pending = live.filter((l) => !l.sent_at).length;
  const type = order?.type || draft.type;
  const tableId = order?.table_id || draft.table_id;
  const customerName = order?.customer_name || draft.customer?.name;
  const inCart = Object.fromEntries(live.map((l) => [l.item_id, 0]));
  live.forEach((l) => { inCart[l.item_id] += l.qty_milli / 1000; });
  const countBy = (id) => menu.data.items.filter((i) => i.category_id === id).length;

  return (
    <div className="flex h-full bg-bg">
      {/* menu side */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="space-y-3 border-b border-line bg-surface px-5 py-4">
          <div className="flex items-center gap-2">
            <SearchInput className="flex-1" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ابحث عن صنف بالاسم أو الكود…" aria-label="بحث في الأصناف" />
            <IconButton icon={LayoutDashboard} label="الرجوع للوحة التحكم" onClick={() => navigate('/')} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ShiftPill shift={shift} canCash={can('shift.cash')} onOpen={() => setDialog({ kind: 'shift' })} onGo={() => navigate('/shift')} />
            <span className="flex items-center gap-1.5 rounded-xl border border-line bg-surface px-3 py-2 text-sm font-semibold text-muted"><Store className="size-4" aria-hidden />{settings.restaurant_name}</span>
            <div className="mr-auto flex items-center gap-2">
              <Button variant="secondary" icon={ClipboardList} onClick={() => setDialog({ kind: 'open' })}>
                الطلبات المفتوحة <span className="num rounded-full bg-warning-soft px-2 text-warning">{openOrders.data?.length || 0}</span>
              </Button>
              <IconButton icon={LayoutGrid} label="الطاولات" onClick={() => navigate('/tables')} />
              <IconButton icon={RefreshCw} label="تحديث المنيو" onClick={() => { menu.reload(); openOrders.reload(true); }} />
            </div>
          </div>
        </div>
        <div className="flex gap-2 overflow-x-auto px-5 py-3" role="tablist" aria-label="الأقسام">
          <CatPill active={!cat && !search} onClick={() => { setCat(''); setSearch(''); }} count={menu.data.items.length}>الكل</CatPill>
          {menu.data.categories.map((c) => (
            <CatPill key={c.id} active={cat === c.id && !search} count={countBy(c.id)} onClick={() => { setCat(c.id); setSearch(''); }}>{c.name}</CatPill>
          ))}
        </div>
        <div className="grid flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-4 overflow-y-auto px-5 pb-5">
          {items.map((i) => (
            <button key={i.id} onClick={() => pickItem(i)} disabled={busy}
              className={cx('group relative flex flex-col overflow-hidden rounded-card border bg-surface text-right shadow-card transition duration-150 hover:-translate-y-0.5 hover:shadow-pop active:scale-[.98]',
                inCart[i.id] ? 'border-primary ring-2 ring-primary/20' : 'border-line')}>
              {i.image ? <img src={i.image} alt="" className="aspect-[4/3] w-full object-cover" loading="lazy" /> : (
                <div className="flex aspect-[4/3] items-center justify-center bg-gradient-to-br from-primary-soft to-surface-2 text-primary">
                  <Utensils className="size-10 opacity-70" aria-hidden />
                </div>
              )}
              {inCart[i.id] > 0 && <span className="bg-brand num absolute left-2 top-2 flex size-7 items-center justify-center rounded-full text-sm font-bold text-white shadow">{inCart[i.id]}</span>}
              {i.modifier_group_ids.length > 0 && <span className="absolute right-2 top-2 rounded-full bg-surface/90 px-2 py-0.5 text-xs font-semibold text-muted shadow-sm">+ إضافات</span>}
              <div className="flex flex-1 flex-col justify-between gap-2 p-3">
                <div className="line-clamp-2 font-semibold leading-snug">{i.name}</div>
                <div className="num text-lg font-bold text-primary">{money(i.price_minor)} <span className="text-xs font-semibold text-muted">{currencyLabel()}</span></div>
              </div>
            </button>
          ))}
          {!items.length && <div className="col-span-full"><Empty icon={Utensils} title="لا توجد أصناف">{search ? 'لا نتائج للبحث' : 'أضف الأصناف من صفحة المنيو'}</Empty></div>}
        </div>
      </div>

      {/* order panel */}
      <aside className="flex w-[440px] shrink-0 flex-col border-r border-line bg-surface">
        <div className="flex items-center gap-3 border-b border-line px-5 py-4">
          <span className="bg-brand flex size-11 items-center justify-center rounded-xl text-white shadow-md shadow-primary/30"><ShoppingBag className="size-5" aria-hidden /></span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-lg font-bold">{order ? `طلب #${order.number}` : 'طلب جديد'}
              {order?.status === 'held' && <Badge tone="warning">معلّق</Badge>}
            </div>
            <div className="text-sm text-muted">{live.length ? `${live.length} صنف` : 'الطلب فارغ'}</div>
          </div>
          <Button variant="soft" size="sm" icon={Plus} onClick={newOrder}>جديد</Button>
          {order && <Button variant="danger-soft" size="sm" icon={X} onClick={() => setDialog({ kind: 'voidOrder' })}>إلغاء</Button>}
        </div>

        <div className="space-y-2 border-b border-line px-5 py-3">
          <Segmented options={Object.entries(orderTypes)} value={type} onChange={(k) => updateHeader({ type: k })} />
          <div className="flex gap-2">
            {type === 'dine_in' && (
              <Select value={tableId} onChange={(e) => updateHeader({ table_id: e.target.value })} className="flex-1" aria-label="الطاولة">
                <option value="">— اختر الطاولة —</option>
                {menu.data.tables.map((t) => <option key={t.id} value={t.id}>{t.area ? `${t.area} / ` : ''}{t.name}</option>)}
              </Select>
            )}
            <button onClick={() => setDialog({ kind: 'customer' })}
              className="flex h-10 flex-1 items-center gap-2 truncate rounded-xl border border-line px-3 text-sm font-semibold hover:bg-surface-2">
              <User className="size-4 text-primary" aria-hidden /><span className="truncate">{customerName || 'عميل مباشر'}</span>
            </button>
            {customerName && <IconButton icon={X} label="إزالة العميل" onClick={() => updateHeader({ customer: null })} />}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-2">
          {live.length === 0 && <Empty icon={ShoppingBag} title="الطلب فارغ">اختر صنفاً لبدء البيع</Empty>}
          {order?.lines.map((l) => (
            <div key={l.id} className={cx('mb-2 rounded-2xl border p-3 transition', l.voided ? 'border-danger/20 bg-danger-soft/50 opacity-70' : 'border-line bg-surface hover:border-primary/40')}>
              <div className="flex items-start gap-2">
                <button className="min-w-0 flex-1 text-right" disabled={l.voided} onClick={() => setDialog({ kind: 'line', line: l })}>
                  <div className={cx('font-bold', l.voided && 'line-through')}>{l.name}</div>
                  {l.modifiers.map((m, i) => <div key={i} className="text-xs text-muted">+ {m.name}{m.price_minor ? ` (${money(m.price_minor)})` : ''}</div>)}
                  {l.notes && <div className="text-xs font-semibold text-warning">✎ {l.notes}</div>}
                  {l.discount_kind && <div className="text-xs font-semibold text-danger">خصم {money(l.gross_minor - l.net_minor)}</div>}
                  {l.voided && <div className="text-xs font-semibold text-danger">ملغي: {l.void_reason}</div>}
                  {!l.voided && l.sent_at && <span className="mt-1 inline-block"><Badge tone="success" dot>{kitchenStatus[l.kitchen_status]}</Badge></span>}
                </button>
                <div className="num text-left font-bold">{money(l.net_minor)}</div>
              </div>
              {!l.voided && (
                <div className="mt-2 flex items-center justify-between">
                  {!l.sent_at ? (
                    <div className="flex items-center gap-1 rounded-xl bg-surface-2 p-1">
                      <QtyBtn label="إنقاص" onClick={() => l.qty_milli > 1000 ? run(() => api.put(`/orders/${order.id}/lines/${l.id}`, { ...lineBody(l), qty_milli: l.qty_milli - 1000 })) : run(() => api.post(`/orders/${order.id}/lines/${l.id}/remove`, {}))}>
                        {l.qty_milli > 1000 ? <Minus className="size-4" /> : <Trash2 className="size-4 text-danger" />}
                      </QtyBtn>
                      <span className="num w-8 text-center font-bold">{qty(l.qty_milli)}</span>
                      <QtyBtn label="زيادة" onClick={() => run(() => api.put(`/orders/${order.id}/lines/${l.id}`, { ...lineBody(l), qty_milli: l.qty_milli + 1000 }))}><Plus className="size-4" /></QtyBtn>
                    </div>
                  ) : <span className="num text-sm font-bold text-muted">× {qty(l.qty_milli)}</span>}
                  <span className="num text-xs text-muted">{money(l.unit_price_minor)} للوحدة</span>
                  {l.sent_at && <Button variant="ghost" size="sm" icon={Trash2} className="text-danger" onClick={() => setDialog({ kind: 'voidLine', line: l })}>إلغاء</Button>}
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="border-t border-line bg-surface-2/50 px-5 py-3 text-sm">
          <Row label="المجموع الفرعي" v={order?.subtotal_minor || 0} always />
          <Row label="الخصم" v={-((order?.line_discounts_minor || 0) + (order?.order_discount_minor || 0))} />
          <Row label="الخدمة" v={order?.service_minor} />
          <Row label={settings.tax_inclusive ? 'الضريبة (شاملة)' : 'الضريبة'} v={order?.tax_minor} />
          <Row label="التوصيل" v={order?.delivery_fee_minor} />
          <div className="mt-2 flex items-center justify-between rounded-xl bg-primary-soft px-4 py-3">
            <span className="text-lg font-bold">الإجمالي</span>
            <span className="num text-2xl font-black text-primary-ink">{moneyC(order?.total_minor || 0)}</span>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-2 border-t border-line px-5 py-3">
          <ActionBtn icon={Send} label={pending ? `إرسال (${pending})` : 'إرسال'} disabled={!order || !pending || busy} onClick={send} />
          <ActionBtn icon={PauseCircle} label="تعليق" disabled={!order || !live.length || busy} onClick={hold} />
          <ActionBtn icon={Percent} label="خصم" disabled={!order || !live.length} onClick={() => setDialog({ kind: 'discount' })} />
          <ActionBtn icon={Printer} label="فاتورة مبدئية" disabled={!order || !live.length} onClick={() => printReceipt(order, settings)} />
        </div>
        <div className="flex gap-2 px-5 pb-4">
          <IconButton icon={ChefHat} label="طباعة للمطبخ" className="size-14 shrink-0 rounded-2xl" disabled={!order || !live.some((l) => l.sent_at)}
            onClick={() => printKitchenTicket(order, live.filter((l) => l.sent_at))} />
          {can('pos.pay') ? (
            <Button size="xl" icon={CreditCard} className="flex-1" disabled={!order || !live.length || busy} onClick={startPay}>
              الدفع <span className="num">{order ? money(order.total_minor) : ''}</span>
            </Button>
          ) : (
            <Button size="xl" icon={Send} className="flex-1" disabled={!order || !pending || busy} onClick={send}>إرسال للمطبخ</Button>
          )}
        </div>
      </aside>

      {dialog?.kind === 'mods' && (
        <ModifierDialog item={dialog.item} groups={menu.data.groups} onClose={() => setDialog(null)}
          onAdd={(extra) => { setDialog(null); addItem(dialog.item, extra); }} />
      )}
      {dialog?.kind === 'line' && (
        <LineDialog line={dialog.line} onClose={() => setDialog(null)}
          onSave={async (body) => {
            const o = await run(() => withApproval((pin) => api.put(`/orders/${order.id}/lines/${dialog.line.id}`, { ...body, approver_pin: pin })));
            if (o) setDialog(null);
          }} />
      )}
      {dialog?.kind === 'voidLine' && (
        <VoidDialog title={`إلغاء ${dialog.line.name}`} sent onClose={() => setDialog(null)}
          onConfirm={async (v) => {
            const o = await run(() => withApproval((pin) => api.post(`/orders/${order.id}/lines/${dialog.line.id}/remove`, { ...v, approver_pin: pin })));
            if (o) setDialog(null);
          }} />
      )}
      {dialog?.kind === 'voidOrder' && (
        <VoidDialog title={`إلغاء الطلب #${order.number}`} sent={live.some((l) => l.sent_at)} onClose={() => setDialog(null)}
          onConfirm={async (v) => {
            const ok = await run(async () => { await withApproval((pin) => api.post(`/orders/${order.id}/void`, { ...v, approver_pin: pin })); return { done: true }; });
            if (ok) { setDialog(null); toast('تم إلغاء الطلب'); newOrder(); }
          }} />
      )}
      {dialog?.kind === 'discount' && (
        <DiscountDialog order={order} onClose={() => setDialog(null)}
          onSave={async (body) => {
            const o = await run(() => withApproval((pin) => api.post(`/orders/${order.id}/discount`, { ...body, approver_pin: pin })));
            if (o) setDialog(null);
          }} />
      )}
      {dialog?.kind === 'customer' && (
        <CustomerDialog onClose={() => setDialog(null)} onPick={(c) => { setDialog(null); updateHeader({ customer: c }); }} />
      )}
      {dialog?.kind === 'shift' && (
        <OpenShiftDialog onClose={() => setDialog(null)} onOpened={() => setDialog(dialog.then === 'pay' ? { kind: 'pay' } : null)} />
      )}
      {dialog?.kind === 'pay' && <PayDialog order={order} onClose={() => setDialog(null)} onPaid={paid} />}
      {dialog?.kind === 'open' && (
        <Modal open onClose={() => setDialog(null)} title="الطلبات المفتوحة" size="lg">
          <div className="grid grid-cols-2 gap-2">
            {(openOrders.data || []).map((o) => (
              <button key={o.id} onClick={() => { setDialog(null); setParams({ order: o.id }); }}
                className="rounded-xl border border-line p-3 text-right hover:border-primary">
                <div className="flex justify-between font-bold"><span>#{o.number} {orderTypes[o.type]}</span><span className="num">{money(o.total_minor)}</span></div>
                <div className="text-sm text-muted">{o.table_name || o.customer_name || '—'} · {o.user_name}</div>
                {o.status === 'held' && <Badge tone="amber">معلّق</Badge>}
                {o.pending_lines > 0 && <Badge tone="red">{o.pending_lines} لم تُرسل</Badge>}
              </button>
            ))}
            {!openOrders.data?.length && <div className="col-span-2 p-6 text-center text-muted/70">لا توجد طلبات مفتوحة</div>}
          </div>
        </Modal>
      )}
    </div>
  );
}

const lineBody = (l) => ({
  qty_milli: l.qty_milli, notes: l.notes, discount_kind: l.discount_kind, discount_rate_bp: l.discount_rate_bp, discount_amount_minor: l.discount_amount_minor,
});

function Row({ label, v, always }) {
  if (!v && !always) return null;
  return <div className="flex justify-between py-0.5 text-muted"><span>{label}</span><span className="num font-semibold text-fg">{money(v)}</span></div>;
}

const CatPill = ({ active, count, children, ...p }) => (
  <button {...p} role="tab" aria-selected={active}
    className={cx('flex shrink-0 items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition',
      active ? 'bg-brand border-transparent text-white shadow-md shadow-primary/25' : 'border-line bg-surface text-fg hover:border-primary/40')}>
    {children}
    <span className={cx('num rounded-full px-2 text-xs', active ? 'bg-white/25' : 'bg-surface-2 text-muted')}>{count}</span>
  </button>
);
const QtyBtn = ({ label, ...p }) => <button {...p} aria-label={label} className="flex size-8 items-center justify-center rounded-lg bg-surface text-fg shadow-sm hover:text-primary" />;
const ActionBtn = ({ icon: Icon, label, ...p }) => (
  <button {...p} className="flex flex-col items-center gap-1 rounded-xl border border-line bg-surface py-2.5 text-xs font-semibold text-fg transition hover:border-primary/40 hover:bg-primary-soft hover:text-primary-ink disabled:pointer-events-none disabled:opacity-40">
    <Icon className="size-5" aria-hidden />{label}
  </button>
);

// Shift status with a running timer since it opened.
function ShiftPill({ shift, canCash, onOpen, onGo }) {
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t); }, []);
  if (!canCash) return null;
  if (!shift) {
    return <button onClick={onOpen} className="flex items-center gap-2 rounded-xl border border-warning/30 bg-warning-soft px-3 py-2 text-sm font-bold text-warning"><Lock className="size-4" aria-hidden />فتح وردية</button>;
  }
  const secs = Math.max(0, Math.floor((Date.now() - new Date(shift.opened_at).getTime()) / 1000));
  const hh = String(Math.floor(secs / 3600)).padStart(2, '0');
  const mm = String(Math.floor((secs % 3600) / 60)).padStart(2, '0');
  const ss = String(secs % 60).padStart(2, '0');
  return (
    <button onClick={onGo} title="تفاصيل الوردية" className="flex items-center gap-3 rounded-xl border border-success/30 bg-success-soft px-3 py-2 text-sm font-bold text-success">
      <span className="flex items-center gap-1.5"><span className="size-2 animate-pulse rounded-full bg-success" /><Timer className="size-4" aria-hidden /><span className="num">{hh}:{mm}:{ss}</span></span>
      <span className="h-4 w-px bg-success/30" />
      <span className="flex items-center gap-1.5"><Wallet className="size-4" aria-hidden />درج <span className="num">{money(shift.opening_float_minor)}</span></span>
    </button>
  );
}
