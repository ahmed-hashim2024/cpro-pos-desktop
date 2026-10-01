import { AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api';
import { money, pct, qty } from '@/lib/format';
import { Card, PageHeader, Spinner, Stat, Table, Td, useLoad } from '@/components/ui';
import { Bars } from '@/components/Chart';

export default function Dashboard() {
  const d = useLoad(() => api.get('/reports/dashboard'), [], { poll: 60000 });
  if (!d.data) return <Spinner />;
  const { today: t } = d.data;
  return (
    <div className="p-5">
      <PageHeader title={`ملخص اليوم — ${d.data.business_date}`} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="صافي المبيعات" value={money(t.net_sales_minor)} sub={`${t.orders} طلب`} tone="good" />
        <Stat label="مجمل الربح" value={money(t.gross_profit_minor)} sub={`هامش ${pct(t.margin_bp)}`} tone="gold" />
        <Stat label="طلبات مفتوحة الآن" value={d.data.open_orders} sub={`بقيمة ${money(d.data.open_value_minor)}`} />
        <Stat label="الطاولات المشغولة" value={`${d.data.open_tables} / ${d.data.tables}`} sub={`${d.data.open_shifts} وردية مفتوحة`} />
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Card title="آخر 7 أيام"><Bars data={d.data.last_7_days.map((b) => ({ label: b.key.slice(5), value: b.amount_minor }))} /></Card>
        <Card title="اليوم حسب الساعة"><Bars data={d.data.by_hour.map((b) => ({ label: b.key, value: b.amount_minor }))} /></Card>
        <Card title="الأكثر مبيعاً اليوم">
          <Table head={['الصنف', 'الكمية', 'المبيعات']}>
            {d.data.top_items.map((i) => <tr key={i.item_id}><Td>{i.name}</Td><Td className="num">{qty(i.qty_milli)}</Td><Td className="num">{money(i.net_minor)}</Td></tr>)}
          </Table>
        </Card>
        <Card title={<span className="flex items-center gap-2"><AlertTriangle className="size-5 text-red-600" />خامات تحت الحد الأدنى</span>}>
          <Table head={['الخامة', 'الرصيد', 'الحد الأدنى']} empty="كل الخامات فوق الحد الأدنى">
            {d.data.low_stock.map((g) => <tr key={g.id}><Td>{g.name}</Td><Td className="num text-red-600">{qty(g.stock_milli, g.unit)}</Td><Td className="num">{qty(g.min_stock_milli, g.unit)}</Td></tr>)}
          </Table>
        </Card>
      </div>
    </div>
  );
}
