import { useSearchParams } from 'react-router-dom';

// The active tab lives in ?tab= so sidebar links and back/forward work.
export function useTab(fallback) {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || fallback;
  const setTab = (t) => setParams((p) => { const n = new URLSearchParams(p); n.set('tab', t); return n; }, { replace: true });
  return [tab, setTab];
}
