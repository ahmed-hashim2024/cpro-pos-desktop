import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeftRight, Combine, Users } from 'lucide-react';
import { api } from '@/lib/api';
import { toast, toastError } from '@/lib/store';
import { money, minutesSince } from '@/lib/format';
import { Button, PageHeader, Spinner, Badge, cx, useLoad } from '@/components/ui';

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
    (data.data?.tables || []).forEach((t) => { (m[t.area || 'الصالة'] ||= []).push(t); });
    return Object.entries(m);
  }, [data.data]);
  const others = (data.data?.open || []).filter((o) => !o.table_id);

  if (!data.data) return <Spinner />;

  const pick = async (t) => {
    const o = byTable[t.id];
    if (!action) return navigate(o ? `/pos?order=${o.id}` : `/pos?table=${t.id}`);
    try {
      if (action.kind === 'move') {
        if (o) return toastError(new Error('الطاولة مشغولة، استخدم الدمج'));
        const full = await api.get(`/orders/${action.order.id}`);
        await api.put(`/orders/${full.id}`, { type: 'dine_in', table_id: t.id, customer_id: full.customer_id, guests: full.guests, notes: full.notes });
        toast(`تم نقل الطلب إلى ${t.name}`);
      } else {
        if (!o || o.id === action.order.id) return toastError(new Error('اختر طاولة عليها طلب آخر'));
        await api.post(`/orders/${o.id}/merge`, { source_id: action.order.id });
        toast(`تم دمج الطلب في ${t.name}`);
      }
      setAction(null);
      data.reload(true);
    } catch (e) {
      toastError(e);
    }
  };

  return (
    <div className="p-5">
      <PageHeader title="الطاولات">
        <Badge tone="green">{Object.keys(byTable).length} مشغولة</Badge>
        <Badge>{data.data.tables.length - Object.keys(byTable).length} متاحة</Badge>
      </PageHeader>
      {action && (
        <div className="mb-4 flex items-center justify-between rounded-xl bg-amber-50 p-3 text-amber-900">
          <span>{action.kind === 'move' ? `اختر الطاولة الجديدة للطلب #${action.order.number}` : `اختر الطاولة التي سيُدمج فيها الطلب #${action.order.number}`}</span>
          <Button variant="secondary" size="sm" onClick={() => setAction(null)}>إلغاء</Button>
        </div>
      )}
      {!data.data.tables.length && <div className="rounded-xl bg-white p-10 text-center text-stone-400">لا توجد طاولات — أضفها من المنيو ← الطاولات</div>}
      {areas.map(([area, tables]) => (
        <div key={area} className="mb-6">
          <h2 className="mb-2 font-bold text-stone-600">{area}</h2>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3">
            {tables.map((t) => {
              const o = byTable[t.id];
              const mins = o ? minutesSince(o.created_at) : 0;
              return (
                <div key={t.id} className={cx('relative rounded-2xl border-2 p-3 transition',
                  o ? 'border-brand-600 bg-brand-50' : 'border-stone-200 bg-white', action && 'ring-2 ring-amber-300')}>
                  <button onClick={() => pick(t)} className="block w-full text-right">
                    <div className="flex items-center justify-between">
                      <span className="text-xl font-black">{t.name}</span>
                      <span className="flex items-center gap-1 text-sm text-stone-500"><Users className="size-4" />{o?.guests || t.seats}</span>
                    </div>
                    {o ? (
                      <div className="mt-2 text-sm">
                        <div className="num text-lg font-bold text-brand-700">{money(o.total_minor)}</div>
                        <div className="text-stone-600">#{o.number} · {o.user_name}</div>
                        <div className={cx('text-xs', mins > 60 ? 'text-red-600' : 'text-stone-500')}>منذ {mins} دقيقة</div>
                        {o.pending_lines > 0 && <Badge tone="red">{o.pending_lines} لم تُرسل</Badge>}
                      </div>
                    ) : <div className="mt-6 text-sm text-stone-400">متاحة</div>}
                  </button>
                  {o && !action && (
                    <div className="mt-2 flex gap-1">
                      <Button size="sm" variant="secondary" className="flex-1" onClick={() => setAction({ kind: 'move', order: o })}><ArrowLeftRight className="size-3" />نقل</Button>
                      <Button size="sm" variant="secondary" className="flex-1" onClick={() => setAction({ kind: 'merge', order: o })}><Combine className="size-3" />دمج</Button>
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
          <h2 className="mb-2 font-bold text-stone-600">طلبات بدون طاولة</h2>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
            {others.map((o) => (
              <button key={o.id} onClick={() => navigate(`/pos?order=${o.id}`)} className="rounded-xl border border-stone-200 bg-white p-3 text-right hover:border-brand-500">
                <div className="flex justify-between font-bold"><span>#{o.number}</span><span className="num">{money(o.total_minor)}</span></div>
                <div className="text-sm text-stone-500">{o.customer_name || o.user_name}</div>
                {o.status === 'held' && <Badge tone="amber">معلّق</Badge>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
