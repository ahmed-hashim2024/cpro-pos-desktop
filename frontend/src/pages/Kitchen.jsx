import { useEffect, useRef, useState } from 'react';
import { CheckCheck, Clock, Flame, ChefHat, LayoutDashboard } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import { toastError } from '@/lib/store';
import { orderTypes, qty, minutesSince } from '@/lib/format';
import { Button, Select, Spinner, Empty, cx, useLoad } from '@/components/ui';

const STATION_KEY = 'cpro.kdsStation';

// Kitchen display: tickets oldest first, colour by waiting time. Tap a line
// to move it along (new → preparing → ready); "تم" bumps the whole ticket.
export default function Kitchen() {
  const navigate = useNavigate();
  const [station, setStation] = useState(() => { try { return localStorage.getItem(STATION_KEY) || ''; } catch { return ''; } });
  const stations = useLoad(() => api.get('/stations'));
  const board = useLoad(() => api.get('/kitchen', { station }), [station], { poll: 4000 });
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 30000); return () => clearInterval(t); }, []);

  // Beep when a new ticket arrives.
  const seen = useRef(null);
  useEffect(() => {
    const ids = new Set((board.data || []).map((t) => t.order_id + t.lines.length));
    if (seen.current && [...ids].some((id) => !seen.current.has(id))) beep();
    seen.current = ids;
  }, [board.data]);

  const setStatus = async (lineIds, status) => {
    try {
      await api.post('/kitchen/status', { line_ids: lineIds, status });
      board.reload(true);
    } catch (e) { toastError(e); }
  };
  const next = { sent: 'preparing', preparing: 'ready', ready: 'sent' };

  return (
    <div className="flex h-full flex-col bg-[#0b1020] text-white">
      <div className="flex items-center gap-3 border-b border-white/10 px-5 py-3">
        <button onClick={() => navigate('/')} aria-label="الرجوع" className="flex size-10 items-center justify-center rounded-xl bg-white/10 hover:bg-white/20"><LayoutDashboard className="size-5" /></button>
        <span className="bg-brand flex size-10 items-center justify-center rounded-xl"><ChefHat className="size-5" aria-hidden /></span>
        <h1 className="text-xl font-bold">شاشة المطبخ</h1>
        <Select className="w-56 text-fg" value={station} onChange={(e) => { setStation(e.target.value); try { localStorage.setItem(STATION_KEY, e.target.value); } catch { /* ignore */ } }}>
          <option value="">كل المحطات</option>
          {(stations.data || []).filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
        <div className="mr-auto rounded-full bg-white/10 px-3 py-1 text-sm">{board.data?.length || 0} طلب</div>
      </div>
      {!board.data ? <Spinner /> : !board.data.length ? <Empty icon={Flame}>لا توجد طلبات حالياً</Empty> : (
        <div className="grid flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3 overflow-y-auto p-3">
          {board.data.map((t) => {
            const mins = minutesSince(t.sent_at);
            const active = t.lines.filter((l) => !l.voided);
            const allReady = active.every((l) => l.status === 'ready');
            return (
              <div key={t.order_id} className={cx('flex flex-col overflow-hidden rounded-xl bg-surface text-fg',
                mins >= 20 ? 'ring-4 ring-red-500' : mins >= 10 ? 'ring-4 ring-amber-400' : '')}>
                <div className={cx('flex items-center justify-between px-3 py-2 text-white', allReady ? 'bg-primary' : mins >= 20 ? 'bg-danger' : 'bg-stone-700')}>
                  <div className="text-2xl font-black">#{t.number}</div>
                  <div className="text-left text-sm">
                    <div>{orderTypes[t.type]}{t.table_name ? ` — ${t.table_name}` : ''}</div>
                    <div className="flex items-center gap-1 opacity-90"><Clock className="size-3" />{mins} د · {t.user_name}</div>
                  </div>
                </div>
                {t.notes && <div className="bg-warning-soft px-3 py-1 text-sm">{t.notes}</div>}
                <div className="flex-1 divide-y divide-line">
                  {t.lines.map((l) => (
                    <button key={l.id} onClick={() => !l.voided && setStatus([l.id], next[l.status])}
                      className={cx('block w-full px-3 py-2 text-right', l.voided && 'bg-danger-soft',
                        l.status === 'preparing' && 'bg-warning-soft', l.status === 'ready' && 'bg-primary-soft')}>
                      <div className={cx('text-lg font-bold', l.voided && 'text-danger line-through', l.status === 'ready' && 'text-primary')}>
                        {qty(l.qty_milli)} × {l.name}
                      </div>
                      {l.modifiers.map((m, i) => <div key={i} className="text-sm text-muted">+ {m.name}</div>)}
                      {l.notes && <div className="text-sm font-semibold text-warning">* {l.notes}</div>}
                      {l.voided && <div className="text-sm font-bold text-danger">ملغي — أوقف التحضير</div>}
                      {!l.voided && <div className="text-xs text-muted">{{ sent: 'جديد', preparing: 'قيد التحضير', ready: 'جاهز' }[l.status]}</div>}
                    </button>
                  ))}
                </div>
                <Button className="m-2" onClick={() => setStatus(t.lines.map((l) => l.id), 'served')}>
                  <CheckCheck className="size-5" />تم التسليم
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function beep() {
  try {
    const ctx = new AudioContext();
    const o = ctx.createOscillator();
    o.frequency.value = 880;
    o.connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.25);
  } catch { /* audio not allowed */ }
}
