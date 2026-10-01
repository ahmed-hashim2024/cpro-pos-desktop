import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  ShoppingCart, LayoutGrid, ChefHat, Receipt, Wallet, BarChart3, LineChart, UtensilsCrossed,
  Boxes, Users, UserCog, ScrollText, Settings, LogOut,
} from 'lucide-react';
import { useApp } from '@/lib/store';
import { roles } from '@/lib/format';
import { cx } from './ui';

export const nav = [
  { to: '/pos', label: 'نقطة البيع', icon: ShoppingCart, perm: 'pos.sell' },
  { to: '/tables', label: 'الطاولات', icon: LayoutGrid, perm: 'pos.sell' },
  { to: '/kitchen', label: 'المطبخ', icon: ChefHat, perm: 'kitchen.view' },
  { to: '/orders', label: 'الطلبات', icon: Receipt, perm: ['order.view_all', 'pos.pay'] },
  { to: '/shift', label: 'الوردية', icon: Wallet, perm: 'shift.cash' },
  { to: '/dashboard', label: 'الرئيسية', icon: LineChart, perm: 'reports.view' },
  { to: '/reports', label: 'التقارير', icon: BarChart3, perm: 'reports.view' },
  { to: '/menu', label: 'المنيو', icon: UtensilsCrossed, perm: 'catalog.manage' },
  { to: '/inventory', label: 'المخزون', icon: Boxes, perm: 'inventory.view' },
  { to: '/customers', label: 'العملاء', icon: Users, perm: 'pos.sell' },
  { to: '/users', label: 'المستخدمون', icon: UserCog, perm: 'users.manage' },
  { to: '/audit', label: 'سجل النشاط', icon: ScrollText, perm: 'audit.view' },
  { to: '/settings', label: 'الإعدادات', icon: Settings, perm: 'settings.manage' },
];

export const allowed = (can, perm) => (Array.isArray(perm) ? perm.some(can) : can(perm));

export default function Layout() {
  const { me, settings, shift, can, logout } = useApp();
  const navigate = useNavigate();
  return (
    <div className="flex h-full">
      <aside className="flex w-24 shrink-0 flex-col items-stretch bg-brand-900 py-3 text-white/80">
        <div className="mb-3 px-2 text-center text-xs font-bold leading-tight text-gold">{settings?.restaurant_name || 'CPro'}</div>
        <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-2">
          {nav.filter((n) => allowed(can, n.perm)).map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to}
              className={({ isActive }) => cx('flex flex-col items-center gap-1 rounded-xl px-1 py-2 text-[11px] font-semibold',
                isActive ? 'bg-white/15 text-white' : 'hover:bg-white/10')}>
              <Icon className="size-5" />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-2 border-t border-white/10 px-2 pt-2 text-center text-[11px]">
          <div className="font-bold text-white">{me?.name}</div>
          <div>{roles[me?.role]}</div>
          {can('shift.cash') && (
            <div className={cx('mt-1 rounded px-1', shift ? 'bg-brand-500/40' : 'bg-red-500/40')}>{shift ? 'وردية مفتوحة' : 'لا توجد وردية'}</div>
          )}
          <button onClick={async () => { await logout(); navigate('/login'); }}
            className="mt-2 flex w-full flex-col items-center gap-1 rounded-xl py-2 hover:bg-white/10">
            <LogOut className="size-5" />تبديل / خروج
          </button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
