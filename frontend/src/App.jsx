import { useEffect, useState, lazy, Suspense } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useApp } from '@/lib/store';
import { setUnauthorizedHandler } from '@/lib/api';
import '@/lib/theme';
import Layout, { navLeaves, allowed } from '@/components/Layout';
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
// Work screens run full-screen, without the sidebar.
const fullScreen = new Set(['/pos', '/kitchen']);

// A path is reachable if any nav entry pointing at it is allowed.
function permittedPaths(can) {
  const ok = new Set();
  navLeaves.forEach((n) => { if (allowed(can, n.perm)) ok.add(n.to.split('?')[0]); });
  return [...ok];
}

// Where to land after login: a one-off target set by the login screen
// (first-run setup, kitchen devices), else the first screen the role can use.
function Home() {
  const can = useApp((s) => s.can);
  const paths = permittedPaths(can);
  const [next] = useState(() => sessionStorage.getItem('cpro.next'));
  useEffect(() => sessionStorage.removeItem('cpro.next'), []);
  const first = [next, '/dashboard', '/pos', '/kitchen'].find((p) => p && paths.includes(p)) || paths[0];
  return <Navigate to={first || '/login'} replace />;
}

export default function App() {
  const { ready, me, boot, expired, can } = useApp();
  useEffect(() => {
    setUnauthorizedHandler(expired);
    boot();
  }, [boot, expired]);

  if (!ready) return <Spinner />;
  const paths = me ? permittedPaths(can) : [];
  const route = (p) => { const Page = pages[p]; return <Route key={p} path={`${p}/*`} element={<Page />} />; };
  return (
    <HashRouter>
      <Suspense fallback={<Spinner />}>
        <Routes>
          <Route path="/login" element={me ? <Navigate to="/" replace /> : <Login />} />
          {!me && <Route path="*" element={<Navigate to="/login" replace />} />}
          {me && paths.filter((p) => fullScreen.has(p)).map(route)}
          {me && (
            <Route element={<Layout />}>
              <Route index element={<Home />} />
              {paths.filter((p) => !fullScreen.has(p)).map(route)}
              <Route path="*" element={<Home />} />
            </Route>
          )}
        </Routes>
      </Suspense>
      <ApprovalModal />
      <Toasts />
    </HashRouter>
  );
}
