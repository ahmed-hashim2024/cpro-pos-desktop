import { useEffect, useMemo, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  ShoppingCart, LayoutGrid, ChefHat, Receipt, Wallet, BarChart3, LayoutDashboard, UtensilsCrossed,
  Boxes, Users, UserCog, ScrollText, Settings, LogOut, ChevronDown, Search,
  Wheat, Truck, Trash2, ClipboardCheck, ArrowUpDown, Layers, ListPlus, Armchair, Flame, PanelRightClose, PanelRightOpen, PanelLeftClose, PanelLeftOpen, Menu, X, CircleHelp,
  TrendingUp, PieChart, FlaskConical, Ban, Store, FileSpreadsheet, Languages, Moon, Sun, ZoomIn, Smartphone,
} from 'lucide-react';
import { useApp } from '@/lib/store';
import { useTheme, fontScales } from '@/lib/theme';
import { roles } from '@/lib/format';
import { cx } from './ui';
import { T, lang, languages, setLang, dir } from '@/lib/i18n';
import { LicenseBanner } from '@/components/License';
import { UpdateBanner } from '@/components/Update';

// One navigation tree drives the sidebar, the header search and the routes.
export const navTree = [
  { to: '/dashboard', label: T('الرئيسية'), icon: LayoutDashboard, perm: 'reports.view' },
  { label: T('المبيعات'), icon: ShoppingCart, children: [
    { to: '/pos', label: T('نقطة البيع'), icon: ShoppingCart, perm: 'pos.sell' },
    { to: '/tables', label: T('الطاولات'), icon: LayoutGrid, perm: 'pos.sell' },
    { to: '/kitchen', label: T('شاشة المطبخ'), icon: ChefHat, perm: 'kitchen.view' },
    { to: '/orders', label: T('الطلبات والفواتير'), icon: Receipt, perm: ['order.view_all', 'pos.pay'] },
    { to: '/shift', label: T('الوردية'), icon: Wallet, perm: 'shift.cash' },
  ] },
  { label: T('قائمة الطعام'), icon: UtensilsCrossed, children: [
    { to: '/menu?tab=items', label: T('الأصناف'), icon: UtensilsCrossed, perm: 'catalog.manage' },
    { to: '/menu?tab=categories', label: T('الأقسام'), icon: Layers, perm: 'catalog.manage' },
    { to: '/menu?tab=modifiers', label: T('الإضافات'), icon: ListPlus, perm: 'catalog.manage' },
    { to: '/menu?tab=tables', label: T('إعداد الطاولات'), icon: Armchair, perm: 'catalog.manage' },
    { to: '/menu?tab=stations', label: T('محطات المطبخ'), icon: Flame, perm: 'catalog.manage' },
    { to: '/menu?tab=emenu', label: T('قائمة الطعام الإلكترونية'), icon: Smartphone, perm: 'catalog.manage' },
  ] },
  { label: T('المخزون'), icon: Boxes, children: [
    { to: '/inventory?tab=stock', label: T('المواد الخام'), icon: Wheat, perm: 'inventory.view' },
    { to: '/inventory?tab=purchases', label: T('المشتريات'), icon: Truck, perm: 'inventory.manage' },
    { to: '/inventory?tab=suppliers', label: T('الموردون'), icon: Store, perm: 'inventory.manage' },
    { to: '/inventory?tab=waste', label: T('الهالك'), icon: Trash2, perm: 'inventory.view' },
    { to: '/inventory?tab=counts', label: T('الجرد'), icon: ClipboardCheck, perm: 'inventory.count' },
    { to: '/inventory?tab=movements', label: T('حركة المخزون'), icon: ArrowUpDown, perm: 'inventory.view' },
  ] },
  { label: T('التقارير'), icon: BarChart3, children: [
    { to: '/reports?tab=sales', label: T('ملخص المبيعات'), icon: TrendingUp, perm: 'reports.view' },
    { to: '/reports?tab=items', label: T('الأصناف والربحية'), icon: PieChart, perm: 'reports.view' },
    { to: '/reports?tab=breakdown', label: T('تفاصيل المبيعات'), icon: BarChart3, perm: 'reports.view' },
    { to: '/reports?tab=consumption', label: T('استهلاك الخامات'), icon: FlaskConical, perm: 'reports.view' },
    { to: '/reports?tab=voids', label: T('الإلغاءات والهالك'), icon: Ban, perm: 'reports.view' },
  ] },
  { to: '/customers', label: T('العملاء'), icon: Users, perm: 'pos.sell' },
  { to: '/import', label: T('استيراد وتصدير البيانات'), icon: FileSpreadsheet, perm: ['catalog.manage', 'inventory.manage'] },
  { label: T('الإدارة'), icon: UserCog, children: [
    { to: '/users', label: T('المستخدمون'), icon: UserCog, perm: 'users.manage' },
    { to: '/audit', label: T('سجل النشاط'), icon: ScrollText, perm: 'audit.view' },
    { to: '/settings', label: T('الإعدادات'), icon: Settings, perm: 'settings.manage' },
    // Open to everyone: the help tab is the part of Settings anyone may see.
    { to: '/settings?tab=help', label: T('المساعدة والمصطلحات'), icon: CircleHelp, perm: 'any' },
  ] },
];

export const allowed = (can, perm) => perm === 'any' || (Array.isArray(perm) ? perm.some(can) : can(perm));
const leaves = (tree) => tree.flatMap((n) => (n.children ? n.children.map((c) => ({ ...c, group: n.label })) : [n]));
export const navLeaves = leaves(navTree);
const pathOf = (to) => to.split('?')[0];

function isActive(loc, to) {
  const [p, q] = to.split('?');
  if (loc.pathname !== p) return false;
  const have = new URLSearchParams(loc.search).get('tab');
  // A plain link (e.g. Settings) gives way to a sibling that names this tab (Help).
  if (!q) return !navLeaves.some((n) => n.to !== to && pathOf(n.to) === p && new URLSearchParams(n.to.split('?')[1]).get('tab') === have);
  const want = new URLSearchParams(q).get('tab');
  return want === have || (!have && navLeaves.find((n) => pathOf(n.to) === p)?.to === to);
}

// Screen sizes, matching Tailwind's md (tablet) and lg (computer).
function useMedia(query) {
  const [match, setMatch] = useState(() => window.matchMedia?.(query).matches ?? true);
  useEffect(() => {
    const m = window.matchMedia?.(query);
    if (!m) return undefined;
    const on = () => setMatch(m.matches);
    on();
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, [query]);
  return match;
}

// The side menu by screen size:
//   computer — always there; the button folds it to icons (remembered);
//   tablet   — there by default; the button hides it and brings it back;
//   phone    — hidden; the button opens it over the page, and picking a
//              screen, tapping outside or Esc closes it.
export default function Layout() {
  const { can } = useApp();
  const loc = useLocation();
  const computer = useMedia('(min-width: 1024px)');
  const tablet = useMedia('(min-width: 768px)') && !computer;
  const phone = !computer && !tablet;
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem('cpro.sidebar') === '1'; } catch { return false; } });
  const [tabletShown, setTabletShown] = useState(true);
  const [drawer, setDrawer] = useState(false);
  const tree = useMemo(() => navTree
    .map((n) => (n.children ? { ...n, children: n.children.filter((c) => allowed(can, c.perm)) } : n))
    .filter((n) => (n.children ? n.children.length : allowed(can, n.perm))), [can]);
  const toggle = () => {
    if (phone) { setDrawer((o) => !o); return; }
    if (tablet) { setTabletShown((o) => !o); return; }
    setCollapsed(!collapsed);
    try { localStorage.setItem('cpro.sidebar', collapsed ? '0' : '1'); } catch { /* ignore */ }
  };
  useEffect(() => { setDrawer(false); }, [loc.pathname, phone]);
  useEffect(() => {
    if (!drawer) return undefined;
    const onKey = (e) => e.key === 'Escape' && setDrawer(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawer]);
  // What the header button shows: is the menu out of the way right now?
  const hidden = phone ? !drawer : tablet ? !tabletShown : collapsed;

  return (
    <div className="flex h-full bg-bg">
      {computer && <Sidebar tree={tree} collapsed={collapsed} loc={loc} />}
      {tablet && tabletShown && <Sidebar tree={tree} loc={loc} />}
      {phone && drawer && (
        <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true" aria-label={T('الشريط الجانبي')}>
          <div className="absolute inset-0 bg-black/45" onClick={() => setDrawer(false)} aria-hidden />
          <div className="relative h-full w-[280px] max-w-[85vw] shadow-2xl">
            <Sidebar tree={tree} loc={loc} drawer onClose={() => setDrawer(false)} />
          </div>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <Header hidden={hidden} phone={phone} computer={computer} onToggle={toggle} />
        <LicenseBanner />
        <UpdateBanner />
        <main className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1600px] p-4"><Outlet /></div>
        </main>
      </div>
    </div>
  );
}

export function Logo({ compact }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="bg-brand flex size-9 items-center justify-center rounded-xl text-lg font-black text-white shadow-md shadow-primary/30">C</span>
      {!compact && (
        <div className="leading-tight">
          <div className="text-brand text-xl font-black tracking-tight" dir="ltr">CPro</div>
          <div className="text-xs font-semibold text-muted">{T('نظام المطاعم')}</div>
        </div>
      )}
    </div>
  );
}

function Sidebar({ tree, collapsed = false, loc, drawer = false, onClose }) {
  const { logout, can } = useApp();
  const navigate = useNavigate();
  const groupOfLoc = tree.find((n) => n.children?.some((c) => isActive(loc, c.to)))?.label;
  const [open, setOpen] = useState(() => new Set(groupOfLoc ? [groupOfLoc] : [T('المبيعات')]));
  useEffect(() => { if (groupOfLoc) setOpen((s) => new Set(s).add(groupOfLoc)); }, [groupOfLoc]);
  const toggle = (g) => setOpen((s) => { const n = new Set(s); n.has(g) ? n.delete(g) : n.add(g); return n; });

  return (
    <aside className={cx('flex h-full shrink-0 flex-col border-e border-line bg-surface transition-[width] duration-200',
      drawer ? 'w-full' : collapsed ? 'w-[68px]' : 'w-[236px]')}>
      <div className={cx('flex h-14 shrink-0 items-center gap-2 border-b border-line', collapsed ? 'justify-center' : 'justify-between px-4')}>
        <Logo compact={collapsed} />
        <div className="flex items-center gap-1">
          {!collapsed && can('pos.sell') && (
            <button onClick={() => navigate('/pos')} className="bg-brand flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm font-bold text-white shadow-md shadow-primary/30 hover:brightness-110">
              <ShoppingCart className="size-4" />{T('نقطة البيع')}
            </button>
          )}
          {drawer && <button onClick={onClose} className={iconBtn} aria-label={T('إغلاق الشريط الجانبي')}><X className="size-5" aria-hidden /></button>}
        </div>
      </div>
      <nav className="flex-1 overflow-y-auto px-2.5 py-3" aria-label={T('الشريط الجانبي')}>
        {tree.map((n) => {
          if (!n.children) return <NavItem key={n.to} item={n} collapsed={collapsed} active={isActive(loc, n.to)} />;
          const isOpen = open.has(n.label) || collapsed;
          const hasActive = n.children.some((c) => isActive(loc, c.to));
          return (
            <div key={n.label} className={cx(!collapsed && 'border-b border-line/70 py-1 last:border-0')}>
              {!collapsed && (
                <button onClick={() => toggle(n.label)} aria-expanded={isOpen}
                  className={cx('flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 font-bold transition hover:bg-surface-2', hasActive ? 'text-fg' : 'text-fg/85')}>
                  <n.icon className={cx('size-5', hasActive ? 'text-primary' : 'text-muted')} aria-hidden />
                  <span className="flex-1 text-start">{n.label}</span>
                  <ChevronDown className={cx('size-4 text-muted transition', isOpen && 'rotate-180')} aria-hidden />
                </button>
              )}
              {isOpen && (
                <div className={cx(!collapsed && 'mb-1 ms-3.5 border-s border-line ps-1.5')}>
                  {n.children.map((c) => <NavItem key={c.to} item={c} collapsed={collapsed} sub active={isActive(loc, c.to)} />)}
                </div>
              )}
            </div>
          );
        })}
      </nav>
      <div className="border-t border-line p-2.5">
        {drawer && <div className="mb-2 flex justify-center"><HeaderIcons /></div>}
        <button onClick={async () => { await logout(); navigate('/login'); }} title={T('تبديل المستخدم / خروج')}
          className={cx('flex w-full items-center justify-center gap-2 rounded-xl bg-danger-soft py-2 font-bold text-danger transition hover:brightness-95')}>
          <LogOut className="size-5" aria-hidden />{!collapsed && T('تبديل المستخدم / خروج')}
        </button>
      </div>
    </aside>
  );
}

function NavItem({ item, collapsed, active, sub }) {
  const Icon = item.icon;
  return (
    // A plain Link: «current» follows isActive (path and tab), not the path alone.
    <Link to={item.to} title={collapsed ? item.label : undefined} aria-current={active ? 'page' : undefined}
      className={cx('group relative my-px flex items-center gap-2.5 rounded-xl transition',
        collapsed ? 'justify-center py-2' : sub ? 'px-2.5 py-1.5 text-sm' : 'px-2.5 py-2 font-bold',
        active ? 'bg-primary-soft text-primary-ink' : 'text-muted hover:bg-surface-2 hover:text-fg')}>
      <Icon className={cx(sub ? 'size-[18px]' : 'size-5', active && 'text-primary')} aria-hidden />
      {!collapsed && <span>{item.label}</span>}
      {active && <span className="absolute -end-3 top-1/2 h-7 w-1 -translate-y-1/2 rounded-full bg-primary" />}
    </Link>
  );
}

// The side panel icons point at the menu's own side: right in Arabic.
const PanelClose = dir === 'rtl' ? PanelRightClose : PanelLeftClose;
const PanelOpen = dir === 'rtl' ? PanelRightOpen : PanelLeftOpen;

function Header({ hidden, phone, computer, onToggle }) {
  const { me, shift, can } = useApp();
  const navigate = useNavigate();
  const initials = (me?.name || '?').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('');
  const label = phone ? (hidden ? T('فتح الشريط الجانبي') : T('إغلاق الشريط الجانبي'))
    : computer ? (hidden ? T('توسيع الشريط الجانبي') : T('طيّ الشريط الجانبي'))
      : (hidden ? T('إظهار الشريط الجانبي') : T('إخفاء الشريط الجانبي'));
  const shiftLabel = shift ? T('الوردية مفتوحة') : T('لا توجد وردية');

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line bg-surface px-2 md:gap-3 md:px-4">
      <button onClick={onToggle} aria-label={label} title={label} aria-expanded={!hidden} className="shrink-0 rounded-xl p-2 text-muted hover:bg-surface-2 hover:text-fg">
        {phone ? <Menu className="size-5" aria-hidden /> : hidden ? <PanelOpen className="size-5" aria-hidden /> : <PanelClose className="size-5" aria-hidden />}
      </button>
      <QuickSearch />
      <div className="ms-auto flex shrink-0 items-center gap-1.5 md:gap-2">
        {can('shift.cash') && (
          <button onClick={() => navigate('/shift')} title={shiftLabel} aria-label={shiftLabel}
            className={cx('flex items-center gap-2 rounded-full px-2.5 py-1.5 text-sm font-semibold sm:px-3', shift ? 'bg-success-soft text-success' : 'bg-warning-soft text-warning')}>
            <span className={cx('size-2 rounded-full', shift ? 'bg-success animate-pulse' : 'bg-warning')} />
            <span className="hidden sm:inline">{shiftLabel}</span>
          </button>
        )}
        {!phone && <HeaderIcons />}
        <div className="mx-1 hidden h-8 w-px bg-line md:block" />
        <div className="flex items-center gap-2 md:gap-3">
          <div className="hidden text-end leading-tight md:block">
            <div className="font-bold">{me?.name}</div>
            <div className="text-xs text-muted">{roles[me?.role]}</div>
          </div>
          <span className="bg-brand flex size-8 items-center justify-center rounded-full text-sm font-bold text-white">{initials}</span>
          <button onClick={() => navigate('/settings?tab=help')} className={iconBtn} aria-label={T('المساعدة والمصطلحات')} title={T('المساعدة والمصطلحات')}>
            <CircleHelp className="size-5" aria-hidden />
          </button>
          {can('settings.manage') && (
            <button onClick={() => navigate('/settings')} className={iconBtn} aria-label={T('الإعدادات')} title={T('الإعدادات')}>
              <Settings className="size-5" aria-hidden />
            </button>
          )}
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
    <div className="relative w-full min-w-0 max-w-md">
      <Search className="pointer-events-none absolute start-3 top-1/2 size-[18px] -translate-y-1/2 text-muted" aria-hidden />
      <input value={q} onChange={(e) => setQ(e.target.value)} onFocus={() => setFocus(true)} onBlur={() => setTimeout(() => setFocus(false), 150)}
        onKeyDown={(e) => e.key === 'Enter' && results[0] && go(results[0].to)}
        placeholder={T('انتقل إلى… (قائمة الطعام، الجرد، التقارير)')} aria-label={T('بحث سريع في الشاشات')}
        className="h-9 w-full rounded-xl border border-transparent bg-surface-2 ps-10 pe-3 text-fg outline-none transition placeholder:text-muted/80 focus:border-primary focus:bg-surface focus:ring-4 focus:ring-primary/15" />
      {focus && results.length > 0 && (
        <div className="absolute inset-x-0 top-10 z-30 overflow-hidden rounded-xl border border-line bg-surface shadow-pop">
          {results.map((r) => (
            <button key={r.to} onMouseDown={() => go(r.to)} className="flex w-full items-center gap-3 px-4 py-2.5 text-start hover:bg-surface-2">
              <r.icon className="size-4 text-primary" aria-hidden /><span className="font-semibold">{r.label}</span>
              {r.group && <span className="ms-auto text-xs text-muted">{r.group}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const iconBtn = 'flex size-9 items-center justify-center rounded-xl text-muted transition hover:bg-surface-2 hover:text-fg';

// Theme, language and text size: icons only; names show as tooltips.
function HeaderIcons() {
  const { dark, toggle, cycleScale, scale } = useTheme();
  const sizeLabel = fontScales.find(([k]) => k === scale)?.[1];
  return (
    <div className="flex items-center gap-0.5">
      <button onClick={cycleScale} className={iconBtn} aria-label={T('حجم الخط')} title={`${T('حجم الخط')}: ${sizeLabel}`}>
        <ZoomIn className="size-5" aria-hidden />
      </button>
      <LangMenu />
      <button onClick={toggle} className={iconBtn} aria-label={dark ? T('الوضع الفاتح') : T('الوضع الداكن')} title={dark ? T('الوضع الفاتح') : T('الوضع الداكن')}>
        {dark ? <Sun className="size-5" aria-hidden /> : <Moon className="size-5" aria-hidden />}
      </button>
    </div>
  );
}

export function LangMenu() {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)} aria-expanded={open} aria-label={T('اللغة')} title={T('اللغة')} className={iconBtn}>
        <Languages className="size-5" aria-hidden />
      </button>
      {open && (
        <div className="absolute end-0 top-10 z-30 w-40 overflow-hidden rounded-xl border border-line bg-surface shadow-pop" onMouseLeave={() => setOpen(false)}>
          {languages.map(([k, label]) => (
            <button key={k} onClick={() => (k === lang ? setOpen(false) : setLang(k))}
              className={cx('flex w-full items-center justify-between px-4 py-2.5 text-start hover:bg-surface-2', k === lang && 'font-bold text-primary-ink')}>
              {label}<span className="text-xs uppercase text-muted">{k}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
