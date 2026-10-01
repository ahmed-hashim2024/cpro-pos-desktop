import { useEffect, lazy, Suspense } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useApp } from '@/lib/store';
import { setUnauthorizedHandler } from '@/lib/api';
import Layout, { nav, allowed } from '@/components/Layout';
import { Toasts, Spinner } from '@/components/ui';
import { ApprovalModal } from '@/components/Approval';
import Login from '@/pages/Login';

const pages = {
  '/pos': lazy(() => import('@/pages/pos/POS')),
  '/tables': lazy(() => import('@/pages/Tables')),
  '/kitchen': lazy(() => import('@/pages/Kitchen')),
  '/orders': lazy(() => import('@/pages/Orders')),
  '/shift': lazy(() => import('@/pages/Shift')),
  '/dashboard': lazy(() => import('@/pages/Dashboard')),
  '/reports': lazy(() => import('@/pages/reports/Reports')),
  '/menu': lazy(() => import('@/pages/menu/Menu')),
  '/inventory': lazy(() => import('@/pages/inventory/Inventory')),
  '/customers': lazy(() => import('@/pages/Customers')),
  '/users': lazy(() => import('@/pages/Users')),
  '/audit': lazy(() => import('@/pages/Audit')),
  '/settings': lazy(() => import('@/pages/Settings')),
};

function Home() {
  const can = useApp((s) => s.can);
  const first = nav.find((n) => allowed(can, n.perm));
  return <Navigate to={first?.to || '/login'} replace />;
}

export default function App() {
  const { ready, me, boot, expired, can } = useApp();
  useEffect(() => {
    setUnauthorizedHandler(expired);
    boot();
  }, [boot, expired]);

  if (!ready) return <Spinner />;
  return (
    <HashRouter>
      <Suspense fallback={<Spinner />}>
        <Routes>
          <Route path="/login" element={me ? <Navigate to="/" replace /> : <Login />} />
          <Route element={me ? <Layout /> : <Navigate to="/login" replace />}>
            <Route index element={<Home />} />
            {nav.filter((n) => allowed(can, n.perm)).map((n) => {
              const Page = pages[n.to];
              return <Route key={n.to} path={`${n.to}/*`} element={<Page />} />;
            })}
            <Route path="*" element={<Home />} />
          </Route>
        </Routes>
      </Suspense>
      <ApprovalModal />
      <Toasts />
    </HashRouter>
  );
}
