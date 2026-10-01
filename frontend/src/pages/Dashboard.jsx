import { useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, TrendingUp, Coins, Receipt, Armchair, AlertTriangle, ShoppingCart, ChefHat, Boxes, BarChart3, Flame,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useApp } from '@/lib/store';
import { money, pct, qty } from '@/lib/format';
import { Card, PageHeader, Spinner, Table, Td, Badge, cx, useLoad } from '@/components/ui';
import { Bars, Spark } from '@/components/Chart';
import { T } from '@/lib/i18n';

export default function Dashboard() {
  const navigate = useNavigate();
  const can = useApp((s) => s.can);
  const d = useLoad(() => api.get('/reports/dashboard'), [], { poll: 60000 });
  if (!d.data) return <Spinner />;
  const { today: t } = d.data;
  const week = d.data.last_7_days.map((b) => b.amount_minor);
  const hours = d.data.by_hour.map((b) => b.amount_minor);

  return (
    <div>
      <PageHeader title={T('الرئيسية')} icon={LayoutDashboard} subtitle={T('نظرة شاملة على أداء المطعم — يوم العمل {0}', [d.data.business_date])} crumb={T('الرئيسية')} />

      <div className="mb-4 flex flex-wrap gap-2">
        <Chip icon={Flame} tone="info">{T('ذروة اليوم:')} {d.data.by_hour.length ? `${[...d.data.by_hour].sort((a, b) => b.amount_minor - a.amount_minor)[0].label}` : '—'}</Chip>
        <Chip icon={TrendingUp} tone="success">{T('الأعلى مبيعاً:')} {d.data.top_items[0]?.name || '—'}</Chip>
        {d.data.low_stock.length > 0 && <Chip icon={AlertTriangle} tone="danger">{d.data.low_stock.length} {T('خامة تحت الحد الأدنى')}</Chip>}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KPI label={T('صافي مبيعات اليوم')} value={money(t.net_sales_minor)} sub={T('{0} طلب · متوسط {1}', [t.orders, money(t.avg_ticket_minor)])} icon={TrendingUp} tone="success" spark={hours} />
        <KPI label={T('مجمل الربح')} value={money(t.gross_profit_minor)} sub={T('هامش {0} · تكلفة {1}', [pct(t.margin_bp), money(t.cost_minor)])} icon={Coins} tone="primary" spark={week} />
        <KPI label={T('طلبات مفتوحة الآن')} value={d.data.open_orders} sub={T('بقيمة {0}', [money(d.data.open_value_minor)])} icon={Receipt} tone="info" />
        <KPI label={T('الطاولات المشغولة')} value={`${d.data.open_tables} / ${d.data.tables}`} sub={T('{0} وردية مفتوحة', [d.data.open_shifts])} icon={Armchair} tone="warning" />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {can('pos.sell') && <Quick icon={ShoppingCart} label={T('نقطة البيع')} onClick={() => navigate('/pos')} primary />}
        {can('kitchen.view') && <Quick icon={ChefHat} label={T('شاشة المطبخ')} onClick={() => navigate('/kitchen')} />}
        {can('inventory.view') && <Quick icon={Boxes} label={T('المخزون')} onClick={() => navigate('/inventory')} />}
        <Quick icon={BarChart3} label={T('التقارير')} onClick={() => navigate('/reports')} />
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-5">
        <Card title={T('مبيعات آخر 7 أيام')} icon={BarChart3} className="lg:col-span-3">
          <Bars data={d.data.last_7_days.map((b) => ({ label: b.key.slice(5), value: b.amount_minor }))} />
        </Card>
        <Card title={T('ملخص اليوم')} icon={Receipt} className="lg:col-span-2" bodyClass="p-0">
          <dl className="divide-y divide-line">
            {[
              [T('الخصومات'), t.discounts_minor, 'warning'], [T('المرتجعات'), t.refunds_minor, 'danger'],
              [T('الخدمة'), t.service_minor], [T('الضريبة'), t.tax_minor],
              [T('الإلغاءات'), t.void_value_minor, 'danger'], [T('الهالك'), t.waste_cost_minor, 'danger'],
            ].map(([k, v, tone]) => (
              <div key={k} className="flex items-center justify-between px-4 py-3">
                <dt className="text-muted">{k}</dt>
                <dd className={cx('num font-bold', v && tone === 'danger' && 'text-danger', v && tone === 'warning' && 'text-warning')}>{money(v)}</dd>
              </div>
            ))}
          </dl>
        </Card>
        <Card title={T('الأكثر مبيعاً اليوم')} icon={TrendingUp} className="lg:col-span-3" bodyClass="p-0">
          <Table head={[T('الصنف'), T('الكمية'), T('المبيعات'), T('الهامش')]} className="rounded-none border-0 shadow-none" empty={T('لا توجد مبيعات اليوم بعد')}>
            {d.data.top_items.map((i) => (
              <tr key={i.item_id}>
                <Td className="font-semibold">{i.name}</Td><Td className="num">{qty(i.qty_milli)}</Td>
                <Td className="num">{money(i.net_minor)}</Td>
                <Td>{i.cost_minor ? <Badge tone={i.margin_bp < 5000 ? 'danger' : 'success'}>{pct(i.margin_bp)}</Badge> : <Badge tone="warning">{T('بدون وصفة')}</Badge>}</Td>
              </tr>
            ))}
          </Table>
        </Card>
        <Card title={T('خامات تحت الحد الأدنى')} icon={AlertTriangle} className="lg:col-span-2" bodyClass="p-0">
          <Table head={[T('الخامة'), T('الرصيد'), T('الحد')]} className="rounded-none border-0 shadow-none" empty={T('كل الخامات فوق الحد الأدنى')}>
            {d.data.low_stock.map((g) => (
              <tr key={g.id}><Td className="font-semibold">{g.name}</Td><Td className="num font-bold text-danger">{qty(g.stock_milli, g.unit)}</Td><Td className="num">{qty(g.min_stock_milli, g.unit)}</Td></tr>
            ))}
          </Table>
        </Card>
      </div>
    </div>
  );
}

const toneCls = { primary: 'bg-primary-soft text-primary-ink', success: 'bg-success-soft text-success', warning: 'bg-warning-soft text-warning', danger: 'bg-danger-soft text-danger', info: 'bg-info-soft text-info' };

function KPI({ label, value, sub, icon: Icon, tone, spark }) {
  return (
    <div className="overflow-hidden rounded-card border border-line bg-surface shadow-card">
      <div className="p-4 pb-2">
        <div className="flex items-start justify-between gap-3">
          <div className="font-semibold text-muted">{label}</div>
          <span className={cx('flex size-11 items-center justify-center rounded-xl', toneCls[tone])}><Icon className="size-5" aria-hidden /></span>
        </div>
        <div className="num mt-1 text-3xl font-bold" style={{ direction: 'inherit' }}>{value}</div>
        <div className="mt-1 text-sm text-muted">{sub}</div>
      </div>
      {spark ? <Spark values={spark} tone={tone} /> : <div className="h-12" />}
    </div>
  );
}

function Chip({ icon: Icon, tone, children }) {
  const map = { success: 'border-success/30 bg-success-soft text-success', info: 'border-info/30 bg-info-soft text-info', danger: 'border-danger/30 bg-danger-soft text-danger' };
  return <span className={cx('inline-flex items-center gap-2 rounded-xl border px-3 py-1.5 text-sm font-semibold', map[tone])}><Icon className="size-4" aria-hidden />{children}</span>;
}

function Quick({ icon: Icon, label, onClick, primary }) {
  return (
    <button onClick={onClick}
      className={cx('flex items-center gap-3 rounded-card border p-4 text-start font-bold shadow-card transition hover:-translate-y-0.5',
        primary ? 'bg-brand border-transparent text-white' : 'border-line bg-surface hover:border-primary/40')}>
      <span className={cx('flex size-11 items-center justify-center rounded-xl', primary ? 'bg-white/20' : 'bg-primary-soft text-primary')}><Icon className="size-5" aria-hidden /></span>
      {label}
    </button>
  );
}

