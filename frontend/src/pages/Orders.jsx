import { useState } from 'react';
import { Printer, Undo2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useApp, toast } from '@/lib/store';
import { money, orderTypes, orderStatus, dateTime, today, qty, kitchenStatus } from '@/lib/format';
import { printReceipt } from '@/lib/print';
import { exportCSV } from '@/lib/csv';
import { Button, Badge, DateRange, Field, Input, Modal, PageHeader, Select, Table, Td, Checkbox, useLoad, useAction } from '@/components/ui';
import { withApproval } from '@/components/Approval';

const statusTone = { paid: 'green', void: 'red', open: 'blue', held: 'amber' };

export default function Orders() {
  const [f, setF] = useState({ from: today(), to: today(), status: '', type: '', q: '' });
  const list = useLoad(() => api.get('/orders', f), [f.from, f.to, f.status, f.type, f.q]);
  const [openId, setOpenId] = useState(null);

  const rows = list.data || [];
  const total = rows.filter((o) => o.status === 'paid').reduce((s, o) => s + o.total_minor - o.refunded_minor, 0);

  return (
    <div className="p-5">
      <PageHeader title="الطلبات والفواتير">
        <DateRange from={f.from} to={f.to} onChange={(from, to) => setF({ ...f, from, to })} />
        <Select className="w-32" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
          <option value="">كل الحالات</option><option value="paid">مدفوع</option><option value="void">ملغي</option>
        </Select>
        <Select className="w-32" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
          <option value="">كل الأنواع</option>
          {Object.entries(orderTypes).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <Input className="w-56" placeholder="رقم الطلب / الفاتورة / العميل" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
        <Button variant="secondary" onClick={() => exportCSV(`orders-${f.from}-${f.to}`,
          ['رقم', 'فاتورة', 'التاريخ', 'النوع', 'الحالة', 'الطاولة', 'العميل', 'المستخدم', 'الإجمالي', 'مرتجع'],
          rows.map((o) => [o.number, o.invoice_number, dateTime(o.closed_at || o.created_at), orderTypes[o.type], orderStatus[o.status], o.table_name, o.customer_name, o.user_name, money(o.total_minor), money(o.refunded_minor)]))}>
          تصدير Excel
        </Button>
      </PageHeader>
      <div className="mb-3 text-stone-600">{rows.length} طلب — صافي المدفوع: <b className="num">{money(total)}</b></div>
      <Table head={['#', 'الفاتورة', 'الوقت', 'النوع', 'الطاولة / العميل', 'المستخدم', 'الإجمالي', 'الحالة']}>
        {rows.map((o) => (
          <tr key={o.id} className="cursor-pointer hover:bg-stone-50" onClick={() => setOpenId(o.id)}>
            <Td className="font-bold">{o.number}</Td>
            <Td className="num">{o.invoice_number}</Td>
            <Td>{dateTime(o.closed_at || o.created_at)}</Td>
            <Td>{orderTypes[o.type]}</Td>
            <Td>{o.table_name || o.customer_name || '—'}</Td>
            <Td>{o.user_name}</Td>
            <Td className="num font-semibold">{money(o.total_minor)}{o.refunded_minor > 0 && <span className="text-red-600"> (−{money(o.refunded_minor)})</span>}</Td>
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
    <Modal open onClose={onClose} title={`طلب #${o.number} ${o.invoice_number ? `— ${o.invoice_number}` : ''}`} size="lg"
      footer={<>
        {refundable && <Button variant="secondary" onClick={() => setRefund(true)}><Undo2 className="size-4" />مرتجع</Button>}
        {o.status === 'paid' && <Button variant="secondary" onClick={() => printReceipt(o, settings, { copy: true })}><Printer className="size-4" />إعادة طباعة</Button>}
        <Button onClick={onClose}>إغلاق</Button>
      </>}>
      <div className="mb-3 grid grid-cols-3 gap-2 text-sm">
        <Info k="النوع" v={`${orderTypes[o.type]}${o.table_name ? ` — ${o.table_name}` : ''}`} />
        <Info k="الحالة" v={orderStatus[o.status]} />
        <Info k="المستخدم" v={o.user_name} />
        <Info k="فُتح" v={dateTime(o.created_at)} />
        <Info k="أُغلق" v={dateTime(o.closed_at)} />
        <Info k="العميل" v={[o.customer_name, o.customer_phone].filter(Boolean).join(' ')} />
        {o.void_reason && <Info k="سبب الإلغاء" v={o.void_reason} />}
        {o.discount_reason && <Info k="سبب الخصم" v={o.discount_reason} />}
      </div>
      <Table head={['الصنف', 'الكمية', 'السعر', 'الصافي', 'الحالة']}>
        {o.lines.map((l) => (
          <tr key={l.id} className={l.voided ? 'text-red-600 line-through' : ''}>
            <Td>{l.name}{l.modifiers.map((m) => <div key={m.name} className="text-xs text-stone-500">+ {m.name}</div>)}</Td>
            <Td className="num">{qty(l.qty_milli)}{l.refunded_qty_milli > 0 && <span className="text-red-600"> (مرتجع {qty(l.refunded_qty_milli)})</span>}</Td>
            <Td className="num">{money(l.unit_price_minor)}</Td>
            <Td className="num">{money(l.net_minor)}</Td>
            <Td>{l.voided ? `ملغي: ${l.void_reason}` : kitchenStatus[l.kitchen_status]}</Td>
          </tr>
        ))}
      </Table>
      <div className="mt-3 grid grid-cols-2 gap-4 text-sm">
        <div>
          {o.payments.map((p) => (
            <div key={p.id} className="flex justify-between"><span>{methods[p.method] || p.method} · {p.user_name}</span><span className="num">{money(p.amount_minor)}</span></div>
          ))}
        </div>
        <div className="grid gap-0.5">
          <Line k="الإجمالي" v={o.subtotal_minor} /><Line k="الخصم" v={o.line_discounts_minor + o.order_discount_minor} />
          <Line k="الخدمة" v={o.service_minor} /><Line k="الضريبة" v={o.tax_minor} /><Line k="التوصيل" v={o.delivery_fee_minor} />
          <div className="flex justify-between text-lg font-bold"><span>المطلوب</span><span className="num">{money(o.total_minor)}</span></div>
          {o.refunded_minor > 0 && <div className="flex justify-between text-red-600"><span>مرتجع</span><span className="num">{money(o.refunded_minor)}</span></div>}
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
    if (res) { toast('تم تسجيل المرتجع'); onDone(); }
  });

  return (
    <Modal open onClose={onClose} title="مرتجع" size="lg"
      footer={<><Button variant="secondary" onClick={onClose}>إلغاء</Button>
        <Button variant="danger" busy={busy} disabled={!picked.length || !reason.trim() || !shift} onClick={submit}>تأكيد المرتجع</Button></>}>
      {!shift && <div className="mb-3 rounded-lg bg-red-50 p-3 text-red-700">يجب فتح وردية لصرف المرتجع من الدرج</div>}
      <Table head={['الصنف', 'المتاح', 'الكمية المرتجعة']}>
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
        <Field label="السبب"><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <Field label="طريقة الرد">
          <Select value={method} onChange={(e) => setMethod(e.target.value)}>
            {settings.payment_methods.filter((m) => m.active).map((m) => <option key={m.code} value={m.code}>{m.name}</option>)}
          </Select>
        </Field>
        <Checkbox label="إرجاع الخامات للمخزون (أصناف مغلقة لم تُستهلك)" checked={restock} onChange={setRestock} />
      </div>
    </Modal>
  );
}

const Info = ({ k, v }) => <div className="rounded-lg bg-stone-50 p-2"><div className="text-xs text-stone-500">{k}</div><div className="font-semibold">{v || '—'}</div></div>;
const Line = ({ k, v }) => (v ? <div className="flex justify-between text-stone-600"><span>{k}</span><span className="num">{money(v)}</span></div> : null);
