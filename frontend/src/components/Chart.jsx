import { money } from '@/lib/format';

// Minimal bar chart: one series, labels underneath, value on hover.
export function Bars({ data, height = 180 }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  if (!data.length) return <div className="flex items-center justify-center text-stone-400" style={{ height }}>لا توجد بيانات</div>;
  return (
    <div className="flex items-end gap-1" style={{ height }} dir="ltr">
      {data.map((d) => (
        <div key={d.label} className="group flex flex-1 flex-col items-center justify-end gap-1" style={{ height: '100%' }}>
          <div className="relative w-full rounded-t bg-brand-500 transition group-hover:bg-brand-700" style={{ height: `${(d.value / max) * 85}%`, minHeight: 2 }}>
            <div className="num pointer-events-none absolute -top-6 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded bg-ink px-1.5 py-0.5 text-xs text-white group-hover:block">
              {money(d.value)}
            </div>
          </div>
          <div className="num truncate text-[10px] text-stone-500">{d.label}</div>
        </div>
      ))}
    </div>
  );
}
