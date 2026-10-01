import { useState } from 'react';
import { Printer, Download, BarChart3, TrendingUp, Coins, Wheat, Receipt, Percent, Undo2, Landmark, Ban, Truck, FlaskConical, Trash2, ClipboardCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { useTab } from '@/lib/useTab';
import { money, pct, qty, milliInput, orderTypes, dateTime, today, daysAgo, monthStart, units } from '@/lib/format';
import { exportCSV } from '@/lib/csv';
import { printReport } from '@/lib/print';
import { Button, Card, DateRange, PageHeader, Stat, Table, Td, Tabs, Spinner, useLoad } from '@/components/ui';
import { Bars } from '@/components/Chart';
import { T } from '@/lib/i18n';

const presets = [
  [T('اليوم'), () => [today(), today()]],
  [T('أمس'), () => [daysAgo(1), daysAgo(1)]],
  [T('آخر 7 أيام'), () => [daysAgo(6), today()]],
  [T('هذا الشهر'), () => [monthStart(), today()]],
  [T('آخر 30 يوم'), () => [daysAgo(29), today()]],
];

export default function Reports() {
  const [range, setRange] = useState({ from: today(), to: today() });
  const [tab, setTab] = useTab('sales');
  return (
    <div>
      <PageHeader title={T('التقارير')} icon={BarChart3} subtitle={T('المبيعات والربحية واستهلاك الخامات')} crumb={T('التقارير')}>
        {presets.map(([label, fn]) => (
          <Button key={label} size="sm" variant="secondary" onClick={() => { const [from, to] = fn(); setRange({ from, to }); }}>{label}</Button>
        ))}
        <DateRange from={range.from} to={range.to} onChange={(from, to) => setRange({ from, to })} />
      </PageHeader>
      <Tabs value={tab} onChange={setTab} tabs={[
        ['sales', T('ملخص المبيعات')], ['items', T('الأصناف والربحية')], ['breakdown', T('التفاصيل')],
        ['consumption', T('استهلاك الخامات')], ['voids', T('الإلغاءات والهالك')],
      ]} />
      {tab === 'consumption' ? <Consumption range={range} /> : <Sales range={range} tab={tab} />}
    </div>
  );
}

function Sales({ range, tab }) {
  const r = useLoad(() => api.get('/reports/sales', range), [range.from, range.to]);
  const waste = useLoad(() => (tab === 'voids' ? api.get('/waste', range) : []), [range.from, range.to, tab]);
  if (!r.data) return <Spinner />;
  const d = r.data;
  const s = d.summary;
  const period = `${range.from} → ${range.to}`;

  if (tab === 'sales') {
    return (
      <div className="grid gap-4">
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => printReport(T('ملخص المبيعات'), period, [
            { rows: [
              [T('عدد الطلبات'), String(s.orders)], [T('المبيعات'), money(s.sales_minor)], [T('المرتجعات'), money(s.refunds_minor)], [T('صافي المبيعات'), money(s.net_sales_minor)],
              [T('الخصومات'), money(s.discounts_minor)], [T('الخدمة'), money(s.service_minor)], [T('الضريبة'), money(s.tax_minor)], [T('رسوم التوصيل'), money(s.delivery_fees_minor)],
              [T('تكلفة البضاعة'), money(s.cost_minor)], [T('مجمل الربح'), money(s.gross_profit_minor)], [T('هامش الربح'), pct(s.margin_bp)], [T('متوسط الفاتورة'), money(s.avg_ticket_minor)],
            ] },
            { heading: T('طرق الدفع'), rows: d.by_method.map((b) => [b.label, money(b.amount_minor)]) },
            { heading: T('نوع الطلب'), rows: d.by_type.map((b) => [orderTypes[b.key], `${b.orders} — ${money(b.amount_minor)}`]) },
          ])}><Printer className="size-4" />{T('طباعة')}</Button>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label={T('صافي المبيعات')} icon={TrendingUp} value={money(s.net_sales_minor)} sub={T('{0} طلب · {1} ضيف', [s.orders, s.guests])} tone="success" />
          <Stat label={T('مجمل الربح')} icon={Coins} value={money(s.gross_profit_minor)} sub={T('هامش {0}', [pct(s.margin_bp)])} tone="warning" />
          <Stat label={T('تكلفة البضاعة المباعة')} icon={Wheat} value={money(s.cost_minor)} sub={T('من الوصفات')} />
          <Stat label={T('متوسط الفاتورة')} icon={Receipt} value={money(s.avg_ticket_minor)} />
          <Stat label={T('الخصومات')} icon={Percent} value={money(s.discounts_minor)} tone={s.discounts_minor ? 'bad' : 'default'} />
          <Stat label={T('المرتجعات')} icon={Undo2} value={money(s.refunds_minor)} tone={s.refunds_minor ? 'bad' : 'default'} />
          <Stat label={T('الضريبة / الخدمة')} icon={Landmark} value={money(s.tax_minor)} sub={T('خدمة {0}', [money(s.service_minor)])} />
          <Stat label={T('الإلغاءات والهالك')} icon={Ban} value={money(s.void_value_minor + s.waste_cost_minor)} sub={T('{0} طلب · {1} صنف', [s.void_orders, s.void_lines])} tone="danger" />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Card title={T('المبيعات حسب اليوم')}><Bars data={d.by_day.map((b) => ({ label: b.key.slice(5), value: b.amount_minor }))} /></Card>
          <Card title={T('المبيعات حسب الساعة')}><Bars data={d.by_hour.map((b) => ({ label: b.key, value: b.amount_minor }))} /></Card>
        </div>
      </div>
    );
  }

  if (tab === 'items') {
    const head = [T('الصنف'), T('القسم'), T('الكمية'), T('المبيعات'), T('التكلفة'), T('الربح'), T('الهامش')];
    const rows = d.items.map((i) => [i.name, i.category, milliInput(i.qty_milli), money(i.net_minor), money(i.cost_minor), money(i.profit_minor), pct(i.margin_bp)]);
    return (
      <>
        <ReportActions title={T('الأصناف والربحية')} period={period} head={head} rows={rows} />
        <Table head={head}>
          {d.items.map((i) => (
            <tr key={i.item_id}>
              <Td className="font-semibold">{i.name}</Td><Td>{i.category}</Td><Td className="num">{qty(i.qty_milli)}</Td>
              <Td className="num">{money(i.net_minor)}</Td><Td className="num">{money(i.cost_minor)}</Td>
              <Td className="num font-semibold">{money(i.profit_minor)}</Td>
              <Td className={`num ${i.cost_minor === 0 ? 'text-warning' : i.margin_bp < 5000 ? 'text-danger' : 'text-primary'}`}>{i.cost_minor === 0 ? T('بدون وصفة') : pct(i.margin_bp)}</Td>
            </tr>
          ))}
        </Table>
      </>
    );
  }

  if (tab === 'breakdown') {
    const block = (title, list, label = (b) => b.label) => (
      <Card title={title}>
        <Table head={['', T('الطلبات'), T('المبلغ')]}>
          {list.map((b) => <tr key={b.key}><Td>{label(b)}</Td><Td className="num">{b.orders || (b.qty_milli ? qty(b.qty_milli) : '')}</Td><Td className="num">{money(b.amount_minor)}</Td></tr>)}
        </Table>
      </Card>
    );
    return (
      <div className="grid gap-4 md:grid-cols-2">
        {block(T('طرق الدفع'), d.by_method)}
        {block(T('نوع الطلب'), d.by_type, (b) => orderTypes[b.key])}
        {block(T('حسب الكاشير'), d.by_cashier)}
        {block(T('حسب القسم'), d.by_category)}
        {block(T('حسب الساعة'), d.by_hour)}
        {block(T('حسب اليوم'), d.by_day)}
      </div>
    );
  }

  // voids & waste
  const wasteRows = waste.data || [];
  return (
    <div className="grid gap-4">
      <Card title={T('الأصناف والطلبات الملغاة')} actions={<Button size="sm" variant="secondary" onClick={() => exportCSV('voids', [T('الطلب'), T('الصنف'), T('المبلغ'), T('السبب'), T('بواسطة'), T('الوقت')], d.voids.map((v) => [v.number, v.what, money(v.amount_minor), v.reason, v.user_name, dateTime(v.at)]))}><Download className="size-4" />Excel</Button>}>
        <Table head={[T('الطلب'), T('الصنف'), T('المبلغ'), T('السبب'), T('وافق عليه'), T('الوقت')]}>
          {d.voids.map((v, i) => <tr key={i}><Td>#{v.number}</Td><Td>{v.what}</Td><Td className="num">{money(v.amount_minor)}</Td><Td>{v.reason}</Td><Td>{v.user_name}</Td><Td>{dateTime(v.at)}</Td></tr>)}
        </Table>
      </Card>
      <Card title={T('الهالك — {0}', [money(wasteRows.reduce((s, w) => s + w.cost_minor, 0))])}>
        <Table head={[T('الوقت'), T('الصنف / الخامة'), T('الكمية'), T('السبب'), T('التكلفة'), T('المستخدم')]}>
          {wasteRows.map((w) => <tr key={w.id}><Td>{dateTime(w.created_at)}</Td><Td>{w.name}</Td><Td className="num">{qty(w.qty_milli, w.kind === 'item' ? '' : w.unit)}</Td><Td>{w.reason}</Td><Td className="num">{money(w.cost_minor)}</Td><Td>{w.user_name}</Td></tr>)}
        </Table>
      </Card>
    </div>
  );
}

function ReportActions({ title, period, head, rows }) {
  return (
    <div className="mb-3 flex justify-end gap-2">
      <Button variant="secondary" onClick={() => exportCSV(`${title}-${period}`, head, rows)}><Download className="size-4" />{T('تصدير Excel')}</Button>
      <Button variant="secondary" onClick={() => printReport(title, period, [{ head, rows }])}><Printer className="size-4" />{T('طباعة')}</Button>
    </div>
  );
}

// Theoretical (recipe) usage vs what actually left the stock.
function Consumption({ range }) {
  const r = useLoad(() => api.get('/reports/consumption', range), [range.from, range.to]);
  if (!r.data) return <Spinner />;
  const { rows, total } = r.data;
  const head = [T('الخامة'), T('الوحدة'), T('أول المدة'), T('وارد'), T('استهلاك المبيعات'), T('هالك'), T('مرتجع'), T('تسويات'), T('فرق الجرد'), T('آخر المدة'), T('الاستهلاك الفعلي'), T('قيمة الاستهلاك')];
  const csv = rows.map((c) => [c.name, units[c.unit], milliInput(c.opening_milli), milliInput(c.purchased_milli), milliInput(c.sales_use_milli), milliInput(c.waste_milli),
    milliInput(c.returned_milli), milliInput(c.adjustments_milli), milliInput(c.count_variance_milli), milliInput(c.closing_milli), milliInput(c.actual_use_milli), money(c.sales_use_value_minor)]);
  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={T('قيمة المشتريات')} icon={Truck} value={money(total.purchase_value_minor)} />
        <Stat label={T('قيمة استهلاك المبيعات (نظري)')} icon={FlaskConical} value={money(total.sales_use_value_minor)} tone="warning" />
        <Stat label={T('قيمة الهالك')} icon={Trash2} value={money(total.waste_value_minor)} tone="danger" />
        <Stat label={T('فروق الجرد والتسويات')} icon={ClipboardCheck} value={money(total.variance_value_minor)} tone={total.variance_value_minor < 0 ? 'bad' : 'good'}
          sub={T('السالب = عجز في المخزون')} />
      </div>
      <p className="text-sm text-muted">
        <b>{T('الاستهلاك الفعلي')}</b> {T('= أول المدة + الوارد − آخر المدة. الفرق بينه وبين استهلاك المبيعات والهالك يظهر في عمود فرق الجرد، وهو ما يكشف الهدر غير المسجل أو أخطاء الوصفات.')}
      </p>
      <ReportActions title={T('استهلاك الخامات')} period={`${range.from} → ${range.to}`} head={head} rows={csv} />
      <Table head={head.filter((h) => h !== T('الوحدة'))}>
        {rows.map((c) => (
          <tr key={c.ingredient_id}>
            <Td className="font-semibold">{c.name}</Td>
            {[c.opening_milli, c.purchased_milli, c.sales_use_milli, c.waste_milli, c.returned_milli, c.adjustments_milli].map((v, i) => (
              <Td key={i} className="num">{qty(v, c.unit)}</Td>
            ))}
            <Td className={`num font-bold ${c.count_variance_milli < 0 ? 'text-danger' : c.count_variance_milli > 0 ? 'text-warning' : ''}`}>{qty(c.count_variance_milli, c.unit)}</Td>
            <Td className="num">{qty(c.closing_milli, c.unit)}</Td>
            <Td className="num font-semibold">{qty(c.actual_use_milli, c.unit)}</Td>
            <Td className="num">{money(c.sales_use_value_minor)}</Td>
          </tr>
        ))}
      </Table>
    </div>
  );
}
