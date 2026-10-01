import { useState } from 'react';
import { Printer, Undo2, Receipt } from 'lucide-react';
import { api } from '@/lib/api';
import { useApp, toast } from '@/lib/store';
import { money, orderTypes, orderStatus, dateTime, today, qty, kitchenStatus } from '@/lib/format';
import { printReceipt } from '@/lib/print';
import { exportCSV } from '@/lib/csv';
import { Button, Badge, DateRange, Field, Input, Modal, PageHeader, Select, Table, Td, Checkbox, useLoad, useAction } from '@/components/ui';
import { withApproval } from '@/components/Approval';
import { T } from '@/lib/i18n';

const statusTone = { paid: 'green', void: 'red', open: 'blue', held: 'amber' };

export default function Orders() {
  const [f, setF] = useState({ from: today(), to: today(), status: '', type: '', q: '' });
  const list = useLoad(() => api.get('/orders', f), [f.from, f.to, f.status, f.type, f.q]);
  const [openId, setOpenId] = useState(null);

  const rows = list.data || [];
  const total = rows.filter((o) => o.status === 'paid').reduce((s, o) => s + o.total_minor - o.refunded_minor, 0);

  return (
    <div>
      <PageHeader title={T('الطلبات والفواتير')} icon={Receipt} subtitle={T('البحث في الطلبات، إعادة الطباعة والمرتجعات')} crumb={T('المبيعات')}>
        <DateRange from={f.from} to={f.to} onChange={(from, to) => setF({ ...f, from, to })} />
        <Select className="w-32" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
          <option value="">{T('كل الحالات')}</option><option value="paid">{T('مدفوع')}</option><option value="void">{T('ملغي')}</option>
        </Select>
        <Select className="w-32" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
          <option value="">{T('كل الأنواع')}</option>
          {Object.entries(orderTypes).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <Input className="w-56" placeholder={T('رقم الطلب / الفاتورة / العميل')} value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
        <Button variant="secondary" onClick={() => exportCSV(`orders-${f.from}-${f.to}`,
          [T('رقم'), T('فاتورة'), T('التاريخ'), T('النوع'), T('الحالة'), T('الطاولة'), T('العميل'), T('المستخدم'), T('الإجمالي'), T('مرتجع')],
          rows.map((o) => [o.number, o.invoice_number, dateTime(o.closed_at || o.created_at), orderTypes[o.type], orderStatus[o.status], o.table_name, o.customer_name, o.user_name, money(o.total_minor), money(o.refunded_minor)]))}>
          {T('تصدير Excel')}
        </Button>
      </PageHeader>
      <div className="mb-3 text-muted">{rows.length} {T('طلب — صافي المدفوع:')} <b className="num">{money(total)}</b></div>
      <Table head={['#', T('الفاتورة'), T('الوقت'), T('النوع'), T('الطاولة / العميل'), T('المستخدم'), T('الإجمالي'), T('الحالة')]}>
        {rows.map((o) => (
          <tr key={o.id} className="cursor-pointer hover:bg-surface-2" onClick={() => setOpenId(o.id)}>
            <Td className="font-bold">{o.number}</Td>
            <Td className="num">{o.invoice_number}</Td>
            <Td>{dateTime(o.closed_at || o.created_at)}</Td>
            <Td>{orderTypes[o.type]}</Td>
            <Td>{o.table_name || o.customer_name || '—'}</Td>
            <Td>{o.user_name}</Td>
            <Td className="num font-semibold">{money(o.total_minor)}{o.refunded_minor > 0 && <span className="text-danger"> (−{money(o.refunded_minor)})</span>}</Td>
            <Td><Badge tone={statusTone[o.status]}>{orderStatus[o.status]}</Badge></Td>
          </tr>
        ))}
      </Table>
      {openId && <OrderDetail id={openId} onClose={() => { setOpenId(null); list.reload(true); }} />}
    </div>
  );
}

export function OrderDetail({ id, onClose }) {
  const settings = useApp((s) => s.settings);
  const order = useLoad(() => api.get(`/orders/${id}`), [id]);
  const [refund, setRefund] = useState(false);
  const o = order.data;
  if (!o) return null;
  const methods = Object.fromEntries(settings.payment_methods.map((m) => [m.code, m.name]));
  const refundable = o.status === 'paid' && o.lines.some((l) => !l.voided && l.qty_milli > l.refunded_qty_milli);

  return (
    <Modal open onClose={onClose} title={T('طلب #{0} {1}', [o.number, o.invoice_number ? `— ${o.invoice_number}` : ''])} size="lg"
      footer={<>
        {refundable && <Button variant="secondary" onClick={() => setRefund(true)}><Undo2 className="size-4" />{T('مرتجع')}</Button>}
        {o.status === 'paid' && <Button variant="secondary" onClick={() => printReceipt(o, settings, { copy: true })}><Printer className="size-4" />{T('إعادة طباعة')}</Button>}
        <Button onClick={onClose}>{T('إغلاق')}</Button>
      </>}>
      <div className="mb-3 grid grid-cols-3 gap-2 text-sm">
        <Info k={T('النوع')} v={`${orderTypes[o.type]}${o.table_name ? ` — ${o.table_name}` : ''}`} />
        <Info k={T('الحالة')} v={orderStatus[o.status]} />
        <Info k={T('المستخدم')} v={o.user_name} />
        <Info k={T('فُتح')} v={dateTime(o.created_at)} />
        <Info k={T('أُغلق')} v={dateTime(o.closed_at)} />
        <Info k={T('العميل')} v={[o.customer_name, o.customer_phone].filter(Boolean).join(' ')} />
        {o.void_reason && <Info k={T('سبب الإلغاء')} v={o.void_reason} />}
        {o.discount_reason && <Info k={T('سبب الخصم')} v={o.discount_reason} />}
      </div>
      <Table head={[T('الصنف'), T('الكمية'), T('السعر'), T('الصافي'), T('الحالة')]}>
        {o.lines.map((l) => (
          <tr key={l.id} className={l.voided ? 'text-danger line-through' : ''}>
            <Td>{l.name}{l.modifiers.map((m) => <div key={m.name} className="text-xs text-muted">+ {m.name}</div>)}</Td>
            <Td className="num">{qty(l.qty_milli)}{l.refunded_qty_milli > 0 && <span className="text-danger"> ({T('مرتجع')} {qty(l.refunded_qty_milli)})</span>}</Td>
            <Td className="num">{money(l.unit_price_minor)}</Td>
            <Td className="num">{money(l.net_minor)}</Td>
            <Td>{l.voided ? T('ملغي: {0}', [l.void_reason]) : kitchenStatus[l.kitchen_status]}</Td>
          </tr>
        ))}
      </Table>
      <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
        <div>
          {o.payments.map((p) => (
            <div key={p.id} className="flex justify-between"><span>{methods[p.method] || p.method} · {p.user_name}</span><span className="num">{money(p.amount_minor)}</span></div>
          ))}
        </div>
        <div className="grid gap-0.5">
          <Line k={T('الإجمالي')} v={o.subtotal_minor} /><Line k={T('الخصم')} v={o.line_discounts_minor + o.order_discount_minor} />
          <Line k={T('الخدمة')} v={o.service_minor} /><Line k={T('الضريبة')} v={o.tax_minor} /><Line k={T('التوصيل')} v={o.delivery_fee_minor} />
          <div className="flex justify-between text-lg font-bold"><span>{T('المطلوب')}</span><span className="num">{money(o.total_minor)}</span></div>
          {o.refunded_minor > 0 && <div className="flex justify-between text-danger"><span>{T('مرتجع')}</span><span className="num">{money(o.refunded_minor)}</span></div>}
        </div>
      </div>
      {refund && <RefundDialog order={o} onClose={() => setRefund(false)} onDone={() => { setRefund(false); order.reload(); }} />}
    </Modal>
  );
}

function RefundDialog({ order, onClose, onDone }) {
  const { settings, shift } = useApp();
  const [lines, setLines] = useState({});
  const [reason, setReason] = useState('');
  const [method, setMethod] = useState(settings.payment_methods.find((m) => m.is_cash)?.code);
  const [restock, setRestock] = useState(false);
  const [busy, run] = useAction();
  const avail = order.lines.filter((l) => !l.voided && l.qty_milli > l.refunded_qty_milli);
  const picked = Object.entries(lines).filter(([, q]) => q > 0).map(([line_id, q]) => ({ line_id, qty_milli: q * 1000 }));

  const submit = () => run(async () => {
    const res = await withApproval((pin) => api.post(`/orders/${order.id}/refund`, { lines: picked, reason, method, restock, approver_pin: pin }, { idempotent: true }));
    if (res) { toast(T('تم تسجيل المرتجع')); onDone(); }
  });

  return (
    <Modal open onClose={onClose} title={T('مرتجع')} size="lg"
      footer={<><Button variant="secondary" onClick={onClose}>{T('إلغاء')}</Button>
        <Button variant="danger" busy={busy} disabled={!picked.length || !reason.trim() || !shift} onClick={submit}>{T('تأكيد المرتجع')}</Button></>}>
      {!shift && <div className="mb-3 rounded-lg bg-danger-soft p-3 text-danger">{T('يجب فتح وردية لصرف المرتجع من الدرج')}</div>}
      <Table head={[T('الصنف'), T('المتاح'), T('الكمية المرتجعة')]}>
        {avail.map((l) => {
          const max = (l.qty_milli - l.refunded_qty_milli) / 1000;
          return (
            <tr key={l.id}>
              <Td>{l.name}</Td>
              <Td className="num">{max}</Td>
              <Td><Input type="number" min={0} max={max} className="w-24" value={lines[l.id] || ''}
                onChange={(e) => setLines({ ...lines, [l.id]: Math.min(max, Math.max(0, Number(e.target.value))) })} /></Td>
            </tr>
          );
        })}
      </Table>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <Field label={T('السبب')}><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <Field label={T('طريقة الرد')}>
          <Select value={method} onChange={(e) => setMethod(e.target.value)}>
            {settings.payment_methods.filter((m) => m.active).map((m) => <option key={m.code} value={m.code}>{m.name}</option>)}
          </Select>
        </Field>
        <Checkbox label={T('إرجاع الخامات للمخزون (أصناف مغلقة لم تُستهلك)')} checked={restock} onChange={setRestock} />
      </div>
    </Modal>
  );
}

const Info = ({ k, v }) => <div className="rounded-lg bg-surface-2 p-2"><div className="text-xs text-muted">{k}</div><div className="font-semibold">{v || '—'}</div></div>;
const Line = ({ k, v }) => (v ? <div className="flex justify-between text-muted"><span>{k}</span><span className="num">{money(v)}</span></div> : null);
