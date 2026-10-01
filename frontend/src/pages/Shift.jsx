import { useState } from 'react';
import { ArrowDownCircle, ArrowUpCircle, Lock, Printer, Wallet, TrendingUp, Undo2, Percent } from 'lucide-react';
import { api } from '@/lib/api';
import { useApp, toast } from '@/lib/store';
import { money, toMinor, dateTime, daysAgo, today } from '@/lib/format';
import { printReport } from '@/lib/print';
import { Button, Card, DateRange, Field, Input, Modal, PageHeader, Stat, Table, Td, Badge, Spinner, useLoad, useAction } from '@/components/ui';
import { OpenShiftDialog } from './pos/dialogs';
import { T } from '@/lib/i18n';

export default function Shift() {
  const { shift, can, loadShift } = useApp();
  const [dialog, setDialog] = useState(null);
  const report = useLoad(() => (shift ? api.get(`/shifts/${shift.id}/report`) : null), [shift?.id], { poll: 30000 });
  const [range, setRange] = useState({ from: daysAgo(7), to: today() });
  const history = useLoad(() => api.get('/shifts', range), [range.from, range.to]);
  const [view, setView] = useState(null);

  return (
    <div>
      <PageHeader title={T('الوردية')} icon={Wallet} subtitle={T('الدرج والنقدية وتقارير X و Z')} crumb={T('المبيعات')}>
        {shift ? (
          <>
            <Button variant="secondary" onClick={() => setDialog('in')}><ArrowDownCircle className="size-4" />{T('إيداع نقدي')}</Button>
            <Button variant="secondary" onClick={() => setDialog('out')}><ArrowUpCircle className="size-4" />{T('صرف نقدي')}</Button>
            <Button variant="secondary" onClick={() => report.data && printShift(report.data, 'X')}><Printer className="size-4" />{T('تقرير X')}</Button>
            <Button variant="danger" onClick={() => setDialog('close')}><Lock className="size-4" />{T('إغلاق الوردية')}</Button>
          </>
        ) : <Button onClick={() => setDialog('open')}>{T('فتح وردية')}</Button>}
      </PageHeader>

      {shift && (report.data ? <ShiftSummary r={report.data} /> : <Spinner />)}
      {!shift && <div className="mb-6 rounded-xl bg-surface p-8 text-center text-muted">{T('لا توجد وردية مفتوحة لك على هذا الجهاز')}</div>}

      <Card title={T('سجل الورديات')} className="mt-6" actions={<DateRange from={range.from} to={range.to} onChange={(from, to) => setRange({ from, to })} />}>
        <Table head={[T('المستخدم'), T('الجهاز'), T('فُتحت'), T('أُغلقت'), T('الافتتاح'), T('المتوقع'), T('المعدود'), T('الفرق'), '']}>
          {(history.data || []).map((s) => {
            const diff = s.counted_cash_minor != null ? s.counted_cash_minor - s.expected_cash_minor : null;
            return (
              <tr key={s.id}>
                <Td>{s.user_name}</Td><Td>{s.device_name}</Td>
                <Td>{dateTime(s.opened_at)}</Td><Td>{s.closed_at ? dateTime(s.closed_at) : <Badge tone="green">{T('مفتوحة')}</Badge>}</Td>
                <Td className="num">{money(s.opening_float_minor)}</Td>
                <Td className="num">{s.expected_cash_minor != null ? money(s.expected_cash_minor) : '—'}</Td>
                <Td className="num">{s.counted_cash_minor != null ? money(s.counted_cash_minor) : '—'}</Td>
                <Td className={`num font-bold ${diff < 0 ? 'text-danger' : diff > 0 ? 'text-warning' : ''}`}>{diff != null ? money(diff) : '—'}</Td>
                <Td><Button size="sm" variant="ghost" onClick={() => setView(s.id)}>{T('التفاصيل')}</Button></Td>
              </tr>
            );
          })}
        </Table>
      </Card>

      {dialog === 'open' && <OpenShiftDialog onClose={() => setDialog(null)} onOpened={() => setDialog(null)} />}
      {(dialog === 'in' || dialog === 'out') && <CashDialog kind={dialog} onClose={() => setDialog(null)} onDone={() => { setDialog(null); report.reload(true); }} />}
      {dialog === 'close' && report.data && (
        <CloseDialog report={report.data} onClose={() => setDialog(null)}
          onDone={(z) => { setDialog(null); printShift(z, 'Z'); loadShift(); history.reload(true); }} />
      )}
      {view && <ShiftView id={view} onClose={() => setView(null)} canManage={can('shift.manage')} onChanged={() => history.reload(true)} />}
    </div>
  );
}

function ShiftSummary({ r }) {
  const s = useApp((st) => st.settings);
  const name = Object.fromEntries(s.payment_methods.map((m) => [m.code, m.name]));
  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={T('المبيعات')} icon={TrendingUp} value={money(r.sales_minor)} sub={T('{0} طلب', [r.orders])} tone="success" />
        <Stat label={T('النقدية المتوقعة في الدرج')} icon={Wallet} value={money(r.expected_cash_minor)} tone="warning" />
        <Stat label={T('المرتجعات')} icon={Undo2} value={money(r.refunds_minor)} tone={r.refunds_minor ? 'bad' : 'default'} />
        <Stat label={T('الخصومات')} icon={Percent} value={money(r.discounts_minor)} sub={T('{0} طلب ملغي', [r.voided_orders])} />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Card title={T('حسب طريقة الدفع')}>
          {r.by_method.map((m) => <div key={m.method} className="flex justify-between py-1"><span>{name[m.method] || m.name} ({m.count})</span><span className="num font-semibold">{money(m.amount_minor)}</span></div>)}
          {!r.by_method.length && <div className="text-muted/70">{T('لا توجد مدفوعات')}</div>}
        </Card>
        <Card title={T('الدرج')}>
          <Row k={T('رصيد الافتتاح')} v={r.shift.opening_float_minor} />
          <Row k={T('مبيعات نقدية (بعد المرتجع)')} v={r.cash_sales_minor} />
          <Row k={T('إيداعات')} v={r.cash_in_minor} />
          <Row k={T('مصروفات')} v={-r.cash_out_minor} />
          <div className="mt-1 flex justify-between border-t pt-1 font-bold"><span>{T('المتوقع')}</span><span className="num">{money(r.expected_cash_minor)}</span></div>
          {r.cash_movements.map((m) => (
            <div key={m.id} className="flex justify-between text-sm text-muted"><span>{m.kind === 'in' ? T('إيداع') : T('صرف')}: {m.reason}</span><span className="num">{money(m.amount_minor)}</span></div>
          ))}
        </Card>
      </div>
    </div>
  );
}

const Row = ({ k, v }) => <div className="flex justify-between py-0.5"><span>{k}</span><span className="num">{money(v)}</span></div>;

function CashDialog({ kind, onClose, onDone }) {
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [busy, run] = useAction();
  const save = () => run(async () => {
    await api.post('/shifts/cash', { kind, amount_minor: toMinor(amount), reason });
    toast(T('تم التسجيل'));
    onDone();
  });
  return (
    <Modal open onClose={onClose} title={kind === 'in' ? T('إيداع نقدي في الدرج') : T('صرف نقدي من الدرج')} size="sm"
      footer={<Button busy={busy} disabled={!toMinor(amount) || !reason.trim()} onClick={save}>{T('تسجيل')}</Button>}>
      <div className="grid gap-3">
        <Field label={T('المبلغ')}><Input autoFocus className="num" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label={T('السبب')}><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={kind === 'out' ? T('شراء خضار، مواصلات…') : T('فكة…')} /></Field>
      </div>
    </Modal>
  );
}

function CloseDialog({ report, onClose, onDone }) {
  const [counted, setCounted] = useState('');
  const [busy, run] = useAction();
  const c = toMinor(counted);
  const diff = c != null ? c - report.expected_cash_minor : null;
  const close = () => run(async () => {
    const z = await api.post(`/shifts/${report.shift.id}/close`, { counted_cash_minor: c });
    toast(T('تم إغلاق الوردية'));
    onDone(z);
  });
  return (
    <Modal open onClose={onClose} title={T('إغلاق الوردية')} size="sm"
      footer={<Button variant="danger" busy={busy} disabled={c == null} onClick={close}>{T('إغلاق وطباعة تقرير Z')}</Button>}>
      <div className="grid gap-3">
        <Field label={T('عُدّ النقدية في الدرج وأدخل المبلغ')}><Input autoFocus className="num text-xl" value={counted} onChange={(e) => setCounted(e.target.value)} /></Field>
        {diff != null && (
          <div className={`rounded-lg p-3 font-bold ${diff === 0 ? 'bg-primary-soft text-primary' : diff < 0 ? 'bg-danger-soft text-danger' : 'bg-warning-soft text-warning'}`}>
            {diff === 0 ? T('الدرج مطابق') : diff < 0 ? T('عجز {0}', [money(-diff)]) : T('زيادة {0}', [money(diff)])}
          </div>
        )}
      </div>
    </Modal>
  );
}

function ShiftView({ id, onClose, canManage, onChanged }) {
  const r = useLoad(() => api.get(`/shifts/${id}/report`), [id]);
  const [counted, setCounted] = useState('');
  const [busy, run] = useAction();
  return (
    <Modal open onClose={onClose} title={T('تفاصيل الوردية')} size="xl"
      footer={<>
        {r.data && <Button variant="secondary" onClick={() => printShift(r.data, r.data.shift.status === 'closed' ? 'Z' : 'X')}><Printer className="size-4" />{T('طباعة')}</Button>}
        {canManage && r.data?.shift.status === 'open' && (
          <>
            <Input className="num w-32" placeholder={T('المعدود')} value={counted} onChange={(e) => setCounted(e.target.value)} />
            <Button variant="danger" busy={busy} disabled={toMinor(counted) == null}
              onClick={() => run(async () => { await api.post(`/shifts/${id}/close`, { counted_cash_minor: toMinor(counted) }); toast(T('تم الإغلاق')); r.reload(); onChanged(); })}>
              {T('إغلاق الوردية')}
            </Button>
          </>
        )}
      </>}>
      {r.data ? <ShiftSummary r={r.data} /> : <Spinner />}
    </Modal>
  );
}

export function printShift(r, kind) {
  const diff = r.difference_minor;
  printReport(T('تقرير {0} — {1}', [kind, r.shift.user_name]), `${dateTime(r.shift.opened_at)} — ${r.shift.closed_at ? dateTime(r.shift.closed_at) : T('مفتوحة')}`, [
    { rows: [
      [T('عدد الطلبات'), String(r.orders)], [T('المبيعات'), money(r.sales_minor)], [T('الخصومات'), money(r.discounts_minor)],
      [T('الخدمة'), money(r.service_minor)], [T('الضريبة'), money(r.tax_minor)], [T('المرتجعات'), money(r.refunds_minor)], [T('طلبات ملغاة'), String(r.voided_orders)],
    ] },
    { heading: T('طرق الدفع'), rows: r.by_method.map((m) => [m.name, money(m.amount_minor)]) },
    { heading: T('الدرج'), rows: [
      [T('رصيد الافتتاح'), money(r.shift.opening_float_minor)], [T('مبيعات نقدية'), money(r.cash_sales_minor)],
      [T('إيداعات'), money(r.cash_in_minor)], [T('مصروفات'), money(r.cash_out_minor)], [T('المتوقع'), money(r.expected_cash_minor)],
      ...(r.shift.counted_cash_minor != null ? [[T('المعدود'), money(r.shift.counted_cash_minor)], [T('الفرق'), money(diff)]] : []),
    ] },
  ]);
}

