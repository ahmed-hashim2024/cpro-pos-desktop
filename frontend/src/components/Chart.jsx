import { useId } from 'react';
import { money } from '@/lib/format';
import { T } from '@/lib/i18n';

const toneVar = { primary: 'var(--primary)', success: 'var(--success)', warning: 'var(--warning)', danger: 'var(--danger)', info: 'var(--info)' };

// Bar chart: one series, labels underneath, exact value on hover/focus.
export function Bars({ data, height = 200, tone = 'primary' }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  if (!data.length) return <div className="flex items-center justify-center text-muted" style={{ height }}>{T('لا توجد بيانات للفترة')}</div>;
  return (
    <div className="flex items-end gap-1.5" style={{ height }} dir="ltr" role="img" aria-label={T('رسم بياني')}>
      {data.map((d) => (
        <div key={d.label} className="group flex flex-1 flex-col items-center justify-end gap-1.5" style={{ height: '100%' }}>
          <div tabIndex={0} className="relative w-full max-w-12 rounded-t-lg opacity-85 transition group-hover:opacity-100 focus:opacity-100"
            style={{ height: `${Math.max(2, (d.value / max) * 86)}%`, background: `linear-gradient(180deg, ${toneVar[tone]}, color-mix(in srgb, ${toneVar[tone]} 55%, transparent))` }}>
            <div className="num pointer-events-none absolute -top-8 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded-lg bg-fg px-2 py-1 text-xs text-bg shadow-pop group-hover:block">
              {money(d.value)}
            </div>
          </div>
          <div className="num truncate text-xs text-muted">{d.label}</div>
        </div>
      ))}
    </div>
  );
}

// Small smooth area line for stat cards.
export function Spark({ values, tone = 'primary', height = 48 }) {
  const id = useId();
  const v = values.length > 1 ? values : [0, ...(values.length ? values : [0]), 0];
  const max = Math.max(1, ...v);
  const w = 100;
  const pts = v.map((y, i) => [(i / (v.length - 1)) * w, height - 4 - (y / max) * (height - 10)]);
  const d = pts.reduce((acc, [x, y], i) => {
    if (!i) return `M${x},${y}`;
    const [px, py] = pts[i - 1];
    const cx = (px + x) / 2;
    return `${acc} C${cx},${py} ${cx},${y} ${x},${y}`;
  }, '');
  const color = toneVar[tone];
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className="w-full" style={{ height }} aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${d} L${w},${height} L0,${height} Z`} fill={`url(#${id})`} />
      <path d={d} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
