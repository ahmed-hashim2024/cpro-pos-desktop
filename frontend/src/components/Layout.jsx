import { useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  ShoppingCart, LayoutGrid, ChefHat, Receipt, Wallet, BarChart3, LayoutDashboard, UtensilsCrossed,
  Boxes, Users, UserCog, ScrollText, Settings, LogOut, ChevronDown, Moon, Sun, Clock, Search,
  Wheat, Truck, Trash2, ClipboardCheck, ArrowUpDown, Layers, ListPlus, Armchair, Flame, PanelRightClose, PanelRightOpen,
  TrendingUp, PieChart, FlaskConical, Ban, Store,
} from 'lucide-react';
import { useApp } from '@/lib/store';
import { useTheme } from '@/lib/theme';
import { roles } from '@/lib/format';
import { cx } from './ui';

// One navigation tree drives the sidebar, the header search and the routes.
export const navTree = [
  { to: '/dashboard', label: 'الرئيسية', icon: LayoutDashboard, perm: 'reports.view' },
  { label: 'المبيعات', icon: ShoppingCart, children: [
    { to: '/pos', label: 'نقطة البيع', icon: ShoppingCart, perm: 'pos.sell' },
    { to: '/tables', label: 'الطاولات', icon: LayoutGrid, perm: 'pos.sell' },
    { to: '/kitchen', label: 'شاشة المطبخ', icon: ChefHat, perm: 'kitchen.view' },
    { to: '/orders', label: 'الطلبات والفواتير', icon: Receipt, perm: ['order.view_all', 'pos.pay'] },
    { to: '/shift', label: 'الوردية', icon: Wallet, perm: 'shift.cash' },
  ] },
  { label: 'المنيو', icon: UtensilsCrossed, children: [
    { to: '/menu?tab=items', label: 'الأصناف', icon: UtensilsCrossed, perm: 'catalog.manage' },
    { to: '/menu?tab=categories', label: 'الأقسام', icon: Layers, perm: 'catalog.manage' },
    { to: '/menu?tab=modifiers', label: 'الإضافات', icon: ListPlus, perm: 'catalog.manage' },
    { to: '/menu?tab=tables', label: 'إعداد الطاولات', icon: Armchair, perm: 'catalog.manage' },
    { to: '/menu?tab=stations', label: 'محطات المطبخ', icon: Flame, perm: 'catalog.manage' },
  ] },
  { label: 'المخزون', icon: Boxes, children: [
    { to: '/inventory?tab=stock', label: 'المواد الخام', icon: Wheat, perm: 'inventory.view' },
    { to: '/inventory?tab=purchases', label: 'المشتريات', icon: Truck, perm: 'inventory.manage' },
    { to: '/inventory?tab=suppliers', label: 'الموردون', icon: Store, perm: 'inventory.manage' },
    { to: '/inventory?tab=waste', label: 'الهالك', icon: Trash2, perm: 'inventory.view' },
    { to: '/inventory?tab=counts', label: 'الجرد', icon: ClipboardCheck, perm: 'inventory.count' },
    { to: '/inventory?tab=movements', label: 'حركة المخزون', icon: ArrowUpDown, perm: 'inventory.view' },
  ] },
  { label: 'التقارير', icon: BarChart3, children: [
    { to: '/reports?tab=sales', label: 'ملخص المبيعات', icon: TrendingUp, perm: 'reports.view' },
    { to: '/reports?tab=items', label: 'الأصناف والربحية', icon: PieChart, perm: 'reports.view' },
    { to: '/reports?tab=breakdown', label: 'تفاصيل المبيعات', icon: BarChart3, perm: 'reports.view' },
    { to: '/reports?tab=consumption', label: 'استهلاك الخامات', icon: FlaskConical, perm: 'reports.view' },
    { to: '/reports?tab=voids', label: 'الإلغاءات والهالك', icon: Ban, perm: 'reports.view' },
  ] },
  { to: '/customers', label: 'العملاء', icon: Users, perm: 'pos.sell' },
  { label: 'الإدارة', icon: UserCog, children: [
    { to: '/users', label: 'المستخدمون', icon: UserCog, perm: 'users.manage' },
    { to: '/audit', label: 'سجل النشاط', icon: ScrollText, perm: 'audit.view' },
    { to: '/settings', label: 'الإعدادات', icon: Settings, perm: 'settings.manage' },
  ] },
];

export const allowed = (can, perm) => (Array.isArray(perm) ? perm.some(can) : can(perm));
const leaves = (tree) => tree.flatMap((n) => (n.children ? n.children.map((c) => ({ ...c, group: n.label })) : [n]));
export const navLeaves = leaves(navTree);
const pathOf = (to) => to.split('?')[0];

function isActive(loc, to) {
  const [p, q] = to.split('?');
  if (loc.pathname !== p) return false;
  if (!q) return true;
  const want = new URLSearchParams(q).get('tab');
  const have = new URLSearchParams(loc.search).get('tab');
  return want === have || (!have && navLeaves.find((n) => pathOf(n.to) === p)?.to === to);
}

export default function Layout() {
  const { can } = useApp();
  const loc = useLocation();
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem('cpro.sidebar') === '1'; } catch { return false; } });
  const tree = useMemo(() => navTree
    .map((n) => (n.children ? { ...n, children: n.children.filter((c) => allowed(can, c.perm)) } : n))
    .filter((n) => (n.children ? n.children.length : allowed(can, n.perm))), [can]);
  const toggleCollapsed = () => {
    setCollapsed(!collapsed);
    try { localStorage.setItem('cpro.sidebar', collapsed ? '0' : '1'); } catch { /* ignore */ }
  };

  return (
    <div className="flex h-full bg-bg">
      <Sidebar tree={tree} collapsed={collapsed} loc={loc} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header collapsed={collapsed} onToggle={toggleCollapsed} />
        <main className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1600px] p-6"><Outlet /></div>
        </main>
      </div>
    </div>
  );
}

export function Logo({ compact }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="bg-brand flex size-10 items-center justify-center rounded-xl text-lg font-black text-white shadow-md shadow-primary/30">C</span>
      {!compact && (
        <div className="leading-tight">
          <div className="text-brand text-xl font-black tracking-tight" dir="ltr">CPro</div>
          <div className="text-xs font-semibold text-muted">نظام المطاعم</div>
        </div>
      )}
    </div>
  );
}

function Sidebar({ tree, collapsed, loc }) {
  const { logout, can } = useApp();
  const navigate = useNavigate();
  const groupOfLoc = tree.find((n) => n.children?.some((c) => isActive(loc, c.to)))?.label;
  const [open, setOpen] = useState(() => new Set(groupOfLoc ? [groupOfLoc] : ['المبيعات']));
  useEffect(() => { if (groupOfLoc) setOpen((s) => new Set(s).add(groupOfLoc)); }, [groupOfLoc]);
  const toggle = (g) => setOpen((s) => { const n = new Set(s); n.has(g) ? n.delete(g) : n.add(g); return n; });

  return (
    <aside className={cx('flex shrink-0 flex-col border-l border-line bg-surface transition-[width] duration-200', collapsed ? 'w-[76px]' : 'w-[264px]')}>
      <div className={cx('flex h-[72px] items-center border-b border-line', collapsed ? 'justify-center' : 'justify-between px-5')}>
        <Logo compact={collapsed} />
        {!collapsed && can('pos.sell') && (
          <button onClick={() => navigate('/pos')} className="bg-brand flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-bold text-white shadow-md shadow-primary/30 hover:brightness-110">
            <ShoppingCart className="size-4" />كاشير
          </button>
        )}
      </div>
      <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label="القائمة الرئيسية">
        {tree.map((n) => {
          if (!n.children) return <NavItem key={n.to} item={n} collapsed={collapsed} active={isActive(loc, n.to)} />;
          const isOpen = open.has(n.label) || collapsed;
          const hasActive = n.children.some((c) => isActive(loc, c.to));
          return (
            <div key={n.label} className={cx(!collapsed && 'border-b border-line/70 py-1 last:border-0')}>
              {!collapsed && (
                <button onClick={() => toggle(n.label)} aria-expanded={isOpen}
                  className={cx('flex w-full items-center gap-3 rounded-xl px-3 py-2.5 font-bold transition hover:bg-surface-2', hasActive ? 'text-fg' : 'text-fg/85')}>
                  <n.icon className={cx('size-5', hasActive ? 'text-primary' : 'text-muted')} aria-hidden />
                  <span className="flex-1 text-right">{n.label}</span>
                  <ChevronDown className={cx('size-4 text-muted transition', isOpen && 'rotate-180')} aria-hidden />
                </button>
              )}
              {isOpen && (
                <div className={cx(!collapsed && 'mb-1 mr-4 border-r border-line pr-2')}>
                  {n.children.map((c) => <NavItem key={c.to} item={c} collapsed={collapsed} sub active={isActive(loc, c.to)} />)}
                </div>
              )}
            </div>
          );
        })}
      </nav>
      <div className="border-t border-line p-3">
        <button onClick={async () => { await logout(); navigate('/login'); }} title="تبديل المستخدم / خروج"
          className={cx('flex w-full items-center justify-center gap-2 rounded-xl bg-danger-soft py-2.5 font-bold text-danger transition hover:brightness-95')}>
          <LogOut className="size-5" aria-hidden />{!collapsed && 'تبديل / خروج'}
        </button>
      </div>
    </aside>
  );
}

function NavItem({ item, collapsed, active, sub }) {
  const Icon = item.icon;
  return (
    <NavLink to={item.to} title={collapsed ? item.label : undefined}
      className={cx('group relative my-0.5 flex items-center gap-3 rounded-xl transition',
        collapsed ? 'justify-center py-2.5' : sub ? 'px-3 py-2 text-sm' : 'px-3 py-2.5 font-bold',
        active ? 'bg-primary-soft text-primary-ink' : 'text-muted hover:bg-surface-2 hover:text-fg')}>
      <Icon className={cx(sub ? 'size-[18px]' : 'size-5', active && 'text-primary')} aria-hidden />
      {!collapsed && <span>{item.label}</span>}
      {active && <span className="absolute -left-3 top-1/2 h-7 w-1 -translate-y-1/2 rounded-full bg-primary" />}
    </NavLink>
  );
}

function Header({ collapsed, onToggle }) {
  const { me, shift, can } = useApp();
  const { dark, toggle, step, scale } = useTheme();
  const navigate = useNavigate();
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(t); }, []);
  const initials = (me?.name || '?').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('');

  return (
    <header className="flex h-[72px] shrink-0 items-center gap-3 border-b border-line bg-surface px-5">
      <button onClick={onToggle} aria-label={collapsed ? 'توسيع القائمة' : 'طي القائمة'} className="rounded-xl p-2 text-muted hover:bg-surface-2 hover:text-fg">
        {collapsed ? <PanelRightOpen className="size-5" /> : <PanelRightClose className="size-5" />}
      </button>
      <QuickSearch />
      <div className="mr-auto flex items-center gap-2">
        {can('shift.cash') && (
          <button onClick={() => navigate('/shift')}
            className={cx('flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-semibold', shift ? 'bg-success-soft text-success' : 'bg-warning-soft text-warning')}>
            <span className={cx('size-2 rounded-full', shift ? 'bg-success animate-pulse' : 'bg-warning')} />
            {shift ? 'الوردية مفتوحة' : 'لا توجد وردية'}
          </button>
        )}
        <span className="hidden items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-sm text-muted lg:flex">
          <Clock className="size-4" aria-hidden />{now.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}
        </span>
        <div className="flex items-center rounded-xl border border-line" role="group" aria-label="حجم الخط">
          <button onClick={() => step(-1)} disabled={scale === 'xs'} aria-label="تصغير الخط" className="px-2.5 py-1.5 text-sm font-bold text-muted hover:text-fg disabled:opacity-30">A−</button>
          <span className="h-5 w-px bg-line" />
          <button onClick={() => step(1)} disabled={scale === 'xl'} aria-label="تكبير الخط" className="px-2.5 py-1.5 text-sm font-bold text-muted hover:text-fg disabled:opacity-30">A+</button>
        </div>
        <button onClick={toggle} aria-label={dark ? 'الوضع الفاتح' : 'الوضع الداكن'} className="rounded-xl p-2.5 text-muted hover:bg-surface-2 hover:text-fg">
          {dark ? <Sun className="size-5" /> : <Moon className="size-5" />}
        </button>
        <div className="mx-1 h-8 w-px bg-line" />
        <div className="flex items-center gap-3">
          <div className="text-left leading-tight">
            <div className="font-bold">{me?.name}</div>
            <div className="text-xs text-muted">{roles[me?.role]}</div>
          </div>
          <span className="bg-brand flex size-10 items-center justify-center rounded-full text-sm font-bold text-white">{initials}</span>
        </div>
      </div>
    </header>
  );
}

// Jump to any screen by typing its name.
function QuickSearch() {
  const can = useApp((s) => s.can);
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [focus, setFocus] = useState(false);
  const results = q.trim() ? navLeaves.filter((n) => allowed(can, n.perm) && (n.label.includes(q.trim()) || n.group?.includes(q.trim()))).slice(0, 7) : [];
  const go = (to) => { setQ(''); navigate(to); };
  return (
    <div className="relative w-full max-w-md">
      <Search className="pointer-events-none absolute right-3 top-1/2 size-[18px] -translate-y-1/2 text-muted" aria-hidden />
      <input value={q} onChange={(e) => setQ(e.target.value)} onFocus={() => setFocus(true)} onBlur={() => setTimeout(() => setFocus(false), 150)}
        onKeyDown={(e) => e.key === 'Enter' && results[0] && go(results[0].to)}
        placeholder="اذهب إلى… (المنيو، الجرد، التقارير)" aria-label="بحث سريع في الشاشات"
        className="h-11 w-full rounded-xl border border-transparent bg-surface-2 pr-10 pl-3 text-fg outline-none transition placeholder:text-muted/80 focus:border-primary focus:bg-surface focus:ring-4 focus:ring-primary/15" />
      {focus && results.length > 0 && (
        <div className="absolute inset-x-0 top-12 z-30 overflow-hidden rounded-xl border border-line bg-surface shadow-pop">
          {results.map((r) => (
            <button key={r.to} onMouseDown={() => go(r.to)} className="flex w-full items-center gap-3 px-4 py-2.5 text-right hover:bg-surface-2">
              <r.icon className="size-4 text-primary" aria-hidden /><span className="font-semibold">{r.label}</span>
              {r.group && <span className="mr-auto text-xs text-muted">{r.group}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
