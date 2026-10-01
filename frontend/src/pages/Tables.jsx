import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeftRight, Combine, Users, LayoutGrid } from 'lucide-react';
import { api } from '@/lib/api';
import { toast, toastError } from '@/lib/store';
import { money, minutesSince } from '@/lib/format';
import { Button, PageHeader, Spinner, Badge, cx, useLoad } from '@/components/ui';
import { T } from '@/lib/i18n';

export default function Tables() {
  const navigate = useNavigate();
  const data = useLoad(async () => {
    const [tables, open] = await Promise.all([api.get('/tables'), api.get('/orders/open')]);
    return { tables: tables.filter((t) => t.active), open };
  }, [], { poll: 10000 });
  const [action, setAction] = useState(null); // {kind: 'move'|'merge', order}

  const byTable = useMemo(() => Object.fromEntries((data.data?.open || []).filter((o) => o.table_id).map((o) => [o.table_id, o])), [data.data]);
  const areas = useMemo(() => {
    const m = {};
    (data.data?.tables || []).forEach((t) => { (m[t.area || T('الصالة')] ||= []).push(t); });
    return Object.entries(m);
  }, [data.data]);
  const others = (data.data?.open || []).filter((o) => !o.table_id);

  if (!data.data) return <Spinner />;

  const pick = async (t) => {
    const o = byTable[t.id];
    if (!action) return navigate(o ? `/pos?order=${o.id}` : `/pos?table=${t.id}`);
    try {
      if (action.kind === 'move') {
        if (o) return toastError(new Error(T('الطاولة مشغولة، استخدم الدمج')));
        const full = await api.get(`/orders/${action.order.id}`);
        await api.put(`/orders/${full.id}`, { type: 'dine_in', table_id: t.id, customer_id: full.customer_id, guests: full.guests, notes: full.notes });
        toast(T('تم نقل الطلب إلى {0}', [t.name]));
      } else {
        if (!o || o.id === action.order.id) return toastError(new Error(T('اختر طاولة عليها طلب آخر')));
        await api.post(`/orders/${o.id}/merge`, { source_id: action.order.id });
        toast(T('تم دمج الطلب في {0}', [t.name]));
      }
      setAction(null);
      data.reload(true);
    } catch (e) {
      toastError(e);
    }
  };

  return (
    <div>
      <PageHeader title={T('الطاولات')} icon={LayoutGrid} subtitle={T('حالة الصالة لحظياً — اضغط على طاولة لفتح طلبها')} crumb={T('المبيعات')}>
        <Badge tone="green">{Object.keys(byTable).length} {T('مشغولة')}</Badge>
        <Badge>{data.data.tables.length - Object.keys(byTable).length} {T('متاحة')}</Badge>
      </PageHeader>
      {action && (
        <div className="mb-4 flex items-center justify-between rounded-xl bg-warning-soft p-3 text-warning">
          <span>{action.kind === 'move' ? T('اختر الطاولة الجديدة للطلب #{0}', [action.order.number]) : T('اختر الطاولة التي سيُدمج فيها الطلب #{0}', [action.order.number])}</span>
          <Button variant="secondary" size="sm" onClick={() => setAction(null)}>{T('إلغاء')}</Button>
        </div>
      )}
      {!data.data.tables.length && <div className="rounded-xl bg-surface p-10 text-center text-muted/70">{T('لا توجد طاولات — أضفها من المنيو ← الطاولات')}</div>}
      {areas.map(([area, tables]) => (
        <div key={area} className="mb-6">
          <h2 className="mb-2 font-bold text-muted">{area}</h2>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3">
            {tables.map((t) => {
              const o = byTable[t.id];
              const mins = o ? minutesSince(o.created_at) : 0;
              return (
                <div key={t.id} className={cx('relative rounded-2xl border-2 p-3 transition',
                  o ? 'border-primary bg-primary-soft' : 'border-line bg-surface', action && 'ring-2 ring-warning/40')}>
                  <button onClick={() => pick(t)} className="block w-full text-start">
                    <div className="flex items-center justify-between">
                      <span className="text-xl font-black">{t.name}</span>
                      <span className="flex items-center gap-1 text-sm text-muted"><Users className="size-4" />{o?.guests || t.seats}</span>
                    </div>
                    {o ? (
                      <div className="mt-2 text-sm">
                        <div className="num text-lg font-bold text-primary">{money(o.total_minor)}</div>
                        <div className="text-muted">#{o.number} · {o.user_name}</div>
                        <div className={cx('text-xs', mins > 60 ? 'text-danger' : 'text-muted')}>{T('منذ')} {mins} {T('دقيقة')}</div>
                        {o.pending_lines > 0 && <Badge tone="red">{o.pending_lines} {T('لم تُرسل')}</Badge>}
                      </div>
                    ) : <div className="mt-6 text-sm text-muted/70">{T('متاحة')}</div>}
                  </button>
                  {o && !action && (
                    <div className="mt-2 flex gap-1">
                      <Button size="sm" variant="secondary" className="flex-1" onClick={() => setAction({ kind: 'move', order: o })}><ArrowLeftRight className="size-3" />{T('نقل')}</Button>
                      <Button size="sm" variant="secondary" className="flex-1" onClick={() => setAction({ kind: 'merge', order: o })}><Combine className="size-3" />{T('دمج')}</Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
      {others.length > 0 && (
        <div>
          <h2 className="mb-2 font-bold text-muted">{T('طلبات بدون طاولة')}</h2>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
            {others.map((o) => (
              <button key={o.id} onClick={() => navigate(`/pos?order=${o.id}`)} className="rounded-xl border border-line bg-surface p-3 text-start hover:border-primary">
                <div className="flex justify-between font-bold"><span>#{o.number}</span><span className="num">{money(o.total_minor)}</span></div>
                <div className="text-sm text-muted">{o.customer_name || o.user_name}</div>
                {o.status === 'held' && <Badge tone="amber">{T('معلّق')}</Badge>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
