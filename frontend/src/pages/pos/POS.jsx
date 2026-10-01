import { useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Search, Send, PauseCircle, Percent, Trash2, User, Printer, Plus, Minus, ChefHat, ClipboardList, X, Utensils,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useApp, toast, toastError } from '@/lib/store';
import { money, moneyC, orderTypes, qty, kitchenStatus } from '@/lib/format';
import { printReceipt, printKitchenTicket } from '@/lib/print';
import { Button, Badge, Modal, Select, Spinner, cx, useLoad } from '@/components/ui';
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

  return (
    <div className="flex h-full">
      {/* menu */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-stone-200 bg-white p-3">
          <div className="relative w-72">
            <Search className="absolute right-3 top-2.5 size-5 text-stone-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="بحث بالاسم أو الكود"
              className="h-10 w-full rounded-lg border border-stone-300 pr-10 outline-none focus:border-brand-500" />
          </div>
          <Button variant="secondary" onClick={() => setDialog({ kind: 'open' })}>
            <ClipboardList className="size-4" />الطلبات المفتوحة
            <Badge tone="amber">{openOrders.data?.length || 0}</Badge>
          </Button>
        </div>
        <div className="flex gap-2 overflow-x-auto border-b border-stone-200 bg-white px-3 py-2">
          <CatButton active={!cat && !search} onClick={() => { setCat(''); setSearch(''); }}>الكل</CatButton>
          {menu.data.categories.map((c) => (
            <CatButton key={c.id} active={cat === c.id && !search} onClick={() => { setCat(c.id); setSearch(''); }}>{c.name}</CatButton>
          ))}
        </div>
        <div className="grid flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3 overflow-y-auto p-3">
          {items.map((i) => (
            <button key={i.id} onClick={() => pickItem(i)} disabled={busy}
              className="flex flex-col overflow-hidden rounded-xl border border-stone-200 bg-white text-right shadow-sm transition hover:border-brand-500 hover:shadow active:scale-[.98]">
              {i.image ? <img src={i.image} alt="" className="h-24 w-full object-cover" /> : (
                <div className="flex h-24 items-center justify-center bg-brand-50 text-brand-500"><Utensils className="size-8" /></div>
              )}
              <div className="p-2">
                <div className="line-clamp-2 font-semibold leading-tight">{i.name}</div>
                <div className="num mt-1 font-bold text-brand-700">{money(i.price_minor)}</div>
              </div>
            </button>
          ))}
          {!items.length && <div className="col-span-full p-10 text-center text-stone-400">لا توجد أصناف — أضفها من صفحة المنيو</div>}
        </div>
      </div>

      {/* order panel */}
      <aside className="flex w-[420px] shrink-0 flex-col border-r border-stone-200 bg-white">
        <div className="grid gap-2 border-b border-stone-200 p-3">
          <div className="flex items-center justify-between">
            <div className="text-lg font-bold">{order ? `طلب #${order.number}` : 'طلب جديد'}
              {order?.status === 'held' && <Badge tone="amber">معلّق</Badge>}
            </div>
            <Button variant="ghost" size="sm" onClick={newOrder}><Plus className="size-4" />جديد</Button>
          </div>
          <div className="grid grid-cols-3 gap-1 rounded-lg bg-stone-100 p-1">
            {Object.entries(orderTypes).map(([k, v]) => (
              <button key={k} onClick={() => updateHeader({ type: k })}
                className={cx('rounded-md py-1.5 text-sm font-semibold', type === k ? 'bg-white shadow-sm text-brand-700' : 'text-stone-600')}>{v}</button>
            ))}
          </div>
          <div className="flex gap-2">
            {type === 'dine_in' && (
              <Select value={tableId} onChange={(e) => updateHeader({ table_id: e.target.value })} className="flex-1">
                <option value="">— الطاولة —</option>
                {menu.data.tables.map((t) => <option key={t.id} value={t.id}>{t.area ? `${t.area} / ` : ''}{t.name}</option>)}
              </Select>
            )}
            <Button variant="secondary" className="flex-1 truncate" onClick={() => setDialog({ kind: 'customer' })}>
              <User className="size-4" />{customerName || 'عميل'}
            </Button>
            {customerName && <Button variant="ghost" onClick={() => updateHeader({ customer: null })}><X className="size-4" /></Button>}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {live.length === 0 && <div className="p-10 text-center text-stone-400">اضغط على صنف لإضافته</div>}
          {order?.lines.map((l) => (
            <div key={l.id} className={cx('border-b border-stone-100 px-3 py-2', l.voided && 'opacity-50')}>
              <div className="flex items-start gap-2">
                <button className="min-w-0 flex-1 text-right" disabled={l.voided} onClick={() => setDialog({ kind: 'line', line: l })}>
                  <div className={cx('font-semibold', l.voided && 'line-through')}>{l.name}</div>
                  {l.modifiers.map((m, i) => <div key={i} className="text-xs text-stone-500">+ {m.name}{m.price_minor ? ` (${money(m.price_minor)})` : ''}</div>)}
                  {l.notes && <div className="text-xs text-amber-700">* {l.notes}</div>}
                  {l.discount_kind && <div className="text-xs text-red-600">خصم {money(l.gross_minor - l.net_minor)}</div>}
                  {l.voided && <div className="text-xs text-red-600">ملغي: {l.void_reason}</div>}
                  {!l.voided && l.sent_at && <Badge tone="green">{kitchenStatus[l.kitchen_status]}</Badge>}
                </button>
                {!l.voided && (
                  <div className="flex items-center gap-1">
                    {!l.sent_at && (
                      <>
                        <IconBtn onClick={() => l.qty_milli > 1000 ? run(() => api.put(`/orders/${order.id}/lines/${l.id}`, { ...lineBody(l), qty_milli: l.qty_milli - 1000 })) : run(() => api.post(`/orders/${order.id}/lines/${l.id}/remove`, {}))}><Minus className="size-4" /></IconBtn>
                        <span className="num w-6 text-center font-bold">{qty(l.qty_milli)}</span>
                        <IconBtn onClick={() => run(() => api.put(`/orders/${order.id}/lines/${l.id}`, { ...lineBody(l), qty_milli: l.qty_milli + 1000 }))}><Plus className="size-4" /></IconBtn>
                      </>
                    )}
                    {l.sent_at && <span className="num px-2 font-bold">×{qty(l.qty_milli)}</span>}
                    <span className="num w-20 text-left font-semibold">{money(l.net_minor)}</span>
                    {l.sent_at && <IconBtn onClick={() => setDialog({ kind: 'voidLine', line: l })}><Trash2 className="size-4 text-red-600" /></IconBtn>}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {order && (
          <div className="border-t border-stone-200 p-3 text-sm">
            <Row label="الإجمالي" v={order.subtotal_minor} />
            <Row label="الخصم" v={-(order.line_discounts_minor + order.order_discount_minor)} />
            <Row label="الخدمة" v={order.service_minor} />
            <Row label={settings.tax_inclusive ? 'الضريبة (شاملة)' : 'الضريبة'} v={order.tax_minor} />
            <Row label="التوصيل" v={order.delivery_fee_minor} />
            <div className="mt-2 flex items-center justify-between text-2xl font-black">
              <span>المطلوب</span><span className="num">{moneyC(order.total_minor)}</span>
            </div>
          </div>
        )}

        <div className="grid grid-cols-4 gap-2 border-t border-stone-200 p-3">
          <ActionBtn icon={Send} label={pending ? `إرسال (${pending})` : 'إرسال'} disabled={!order || !pending || busy} onClick={send} />
          <ActionBtn icon={PauseCircle} label="تعليق" disabled={!order || !live.length || busy} onClick={hold} />
          <ActionBtn icon={Percent} label="خصم" disabled={!order || !live.length} onClick={() => setDialog({ kind: 'discount' })} />
          <ActionBtn icon={Printer} label="فاتورة مبدئية" disabled={!order || !live.length} onClick={() => printReceipt(order, settings)} />
          <ActionBtn icon={ChefHat} label="طباعة للمطبخ" disabled={!order || !live.some((l) => l.sent_at)} onClick={() => printKitchenTicket(order, live.filter((l) => l.sent_at))} />
          <ActionBtn icon={Trash2} label="إلغاء الطلب" danger disabled={!order} onClick={() => setDialog({ kind: 'voidOrder' })} />
          {can('pos.pay') ? (
            <Button size="lg" className="col-span-2 h-auto" disabled={!order || !live.length || busy} onClick={startPay}>
              دفع {order ? money(order.total_minor) : ''}
            </Button>
          ) : (
            <Button size="lg" className="col-span-2 h-auto" disabled={!order || !pending || busy} onClick={send}>إرسال للمطبخ</Button>
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
                className="rounded-xl border border-stone-200 p-3 text-right hover:border-brand-500">
                <div className="flex justify-between font-bold"><span>#{o.number} {orderTypes[o.type]}</span><span className="num">{money(o.total_minor)}</span></div>
                <div className="text-sm text-stone-500">{o.table_name || o.customer_name || '—'} · {o.user_name}</div>
                {o.status === 'held' && <Badge tone="amber">معلّق</Badge>}
                {o.pending_lines > 0 && <Badge tone="red">{o.pending_lines} لم تُرسل</Badge>}
              </button>
            ))}
            {!openOrders.data?.length && <div className="col-span-2 p-6 text-center text-stone-400">لا توجد طلبات مفتوحة</div>}
          </div>
        </Modal>
      )}
    </div>
  );
}

const lineBody = (l) => ({
  qty_milli: l.qty_milli, notes: l.notes, discount_kind: l.discount_kind, discount_rate_bp: l.discount_rate_bp, discount_amount_minor: l.discount_amount_minor,
});

function Row({ label, v }) {
  if (!v) return null;
  return <div className="flex justify-between py-0.5 text-stone-600"><span>{label}</span><span className="num">{money(v)}</span></div>;
}

const CatButton = ({ active, children, ...p }) => (
  <button {...p} className={cx('shrink-0 rounded-full px-4 py-2 text-sm font-semibold', active ? 'bg-brand-600 text-white' : 'bg-stone-100 text-stone-700 hover:bg-stone-200')}>{children}</button>
);
const IconBtn = (p) => <button {...p} className="rounded-md p-1.5 hover:bg-stone-100" />;
const ActionBtn = ({ icon: Icon, label, danger, ...p }) => (
  <button {...p} className={cx('flex flex-col items-center gap-1 rounded-xl border border-stone-200 py-2 text-xs font-semibold hover:bg-stone-50 disabled:opacity-40', danger && 'text-red-600')}>
    <Icon className="size-5" />{label}
  </button>
);
