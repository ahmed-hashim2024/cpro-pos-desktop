import { useCallback, useEffect, useMemo, useState } from 'react';
import { Home as HomeIcon, LayoutGrid, ShoppingBag, Tag, UserRound, Utensils, Clock3, Eye, MessagesSquare } from 'lucide-react';
import { menuApi } from './api';
import { makeT, pickLang, saveLang } from './i18n';
import { cx, store, tableToken, hallLink, PREVIEW, validHex, onColor, loadContact, saveContact, emptyContact, orderModes } from './lib';
import { Header, SearchBar, HeroSlider, CategoryRail, Popular, FamilyOffers, Info, TableChip } from './Home';
import { FullMenu, OffersPage, ItemModal, FilterSheet, emptyFilters, isFiltered } from './Browse';
import { CartPage, StatusSheet, ServiceButton, useOrderTracker, orderFinished } from './Order';
import { ProfilePage } from './Profile';
import { ContactPage } from './Contact';
import { useAppLinks, useInstallOffer, InstallPopup } from './Install';

const ORDER_KEY = `cpro.menu.order.${tableToken || (hallLink ? 'hall' : 'web')}`;
const SEEN_KEY = `${ORDER_KEY}.seen`; // the bad news the guest already saw

export default function MenuApp() {
  const [menu, setMenu] = useState(null);
  const [failed, setFailed] = useState(null);
  const [lang, setLang] = useState('ar');
  const [tab, setTab] = useState('home');
  const [cart, setCart] = useState([]);
  const [picked, setPicked] = useState(null); // {item, badge}
  const [filters, setFilters] = useState(emptyFilters);
  const [filterOpen, setFilterOpen] = useState(false);
  const [orderToken, setOrderToken] = useState(() => (PREVIEW ? null : store.get(ORDER_KEY)));
  const [statusOpen, setStatusOpen] = useState(false);
  const [contact, setContact] = useState(() => (PREVIEW ? emptyContact : loadContact()));
  const [toast, setToast] = useState('');
  const [backToCart, setBackToCart] = useState(false);
  const [installDemo, setInstallDemo] = useState(''); // designer preview only
  const t = useMemo(() => makeT(lang), [lang]);

  const load = useCallback(async () => {
    setFailed(null);
    try {
      const m = await menuApi.menu(tableToken, hallLink);
      setMenu(m);
      setLang(pickLang(m.languages, m.default_language));
    } catch (e) {
      setFailed(e.status === 404 ? 'closed' : 'error');
    }
  }, []);

  // Live menu, or the designer's preview fed by the parent window.
  useEffect(() => {
    if (!PREVIEW) { load(); return undefined; }
    const onMsg = (e) => {
      if (e.origin !== window.location.origin || e.source !== window.parent || e.data?.type !== 'cpro:emenu-preview') return;
      const m = e.data.menu;
      setMenu(m);
      setLang((l) => (m.languages.includes(l) && !e.data.resetLang ? l : m.default_language));
      if (e.data.tab) setTab(e.data.tab);
      if (e.data.install) setInstallDemo(e.data.install);
    };
    window.addEventListener('message', onMsg);
    window.parent.postMessage({ type: 'cpro:emenu-ready' }, '/');
    return () => window.removeEventListener('message', onMsg);
  }, [load]);

  // Theme, direction and title follow the settings and language.
  useEffect(() => {
    const root = document.documentElement;
    root.lang = lang;
    root.dir = t.dir;
    if (!menu) return;
    root.dataset.theme = menu.theme.background || 'white';
    if (validHex(menu.theme.primary)) {
      root.style.setProperty('--p', menu.theme.primary);
      root.style.setProperty('--onp', onColor(menu.theme.primary));
    }
    document.title = `${menu.restaurant.name} — ${t('menu')}`;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', getComputedStyle(root).getPropertyValue('--bg').trim());
  }, [menu, lang, t]);

  useEffect(() => { window.scrollTo(0, 0); }, [tab]);
  useAppLinks(menu?.app);
  const [installKind, closeInstall] = useInstallOffer(menu?.app);

  const flash = useCallback((msg) => { setToast(msg); setTimeout(() => setToast(''), 2600); }, []);
  const money = useCallback((minor) => {
    const n = new Intl.NumberFormat(t.locale, { maximumFractionDigits: 2 }).format((minor || 0) / 100);
    return `${n} ${t.currency(menu?.restaurant.currency || 'EGP')}`;
  }, [t, menu]);
  const doneStatus = useCallback(() => { store.set(ORDER_KEY, ''); store.set(SEEN_KEY, ''); setOrderToken(null); setStatusOpen(false); }, []);

  // The order sheet opens by itself only for news the guest hasn't seen: after
  // placing an order or when it's refused. A reload never repeats a message.
  const order = useOrderTracker(orderToken, (o, prev) => {
    if (!o) { doneStatus(); return; }
    if (orderFinished(o)) {
      if (o.stage === 'closed' || store.get(SEEN_KEY) === o.status) { doneStatus(); return; }
      store.set(SEEN_KEY, o.status);
      setStatusOpen(true);
    } else if (prev && o.stage === 'ready' && prev.stage !== 'ready') {
      flash(t('orderReady'));
      navigator.vibrate?.(200);
    }
  });

  const inCart = useMemo(() => {
    const m = {};
    cart.forEach((l) => { m[l.item.id] = (m[l.item.id] || 0) + l.qty; });
    return m;
  }, [cart]);

  if (failed) return <Fallback t={t} kind={failed} onRetry={load} />;
  if (!menu) return <Skeleton />;

  const canOrder = orderModes(menu).length > 0;
  // At a table (its QR or the hall QR) «My details» becomes «Contact»: the
  // table is known, so the guest calls the staff and reaches the restaurant.
  const atTable = !!menu.table || menu.tables?.length > 0;
  const page = tab === 'profile' && atTable ? 'contact' : tab;
  const count = cart.reduce((s, l) => s + l.qty, 0);
  const badgeOf = (id) => menu.featured.find((f) => f.item.id === id)?.badge || '';
  const pick = (item) => setPicked({ item, badge: badgeOf(item.id) });
  const addToCart = (line) => {
    setCart((c) => {
      const same = c.find((l) => l.key === line.key);
      return same ? c.map((l) => (l === same ? { ...l, qty: Math.min(l.qty + line.qty, 50) } : l)) : [...c, line];
    });
    setPicked(null);
    flash(`${line.item.name} ✓`);
  };
  const placed = (token) => {
    store.set(ORDER_KEY, token);
    store.set(SEEN_KEY, '');
    setOrderToken(token);
    setCart([]);
    setStatusOpen(true);
    setTab('home');
  };
  const browse = (f) => { setFilters(f); setTab('menu'); };
  const single = menu.offers.filter((o) => o.kind === 'single');
  const family = menu.offers.filter((o) => o.kind === 'family');

  return (
    <div className="mx-auto min-h-dvh max-w-md pb-[calc(5.5rem+env(safe-area-inset-bottom))] md:max-w-3xl md:px-2 lg:max-w-6xl lg:px-4">
      {menu.preview && (
        <div className="sticky top-0 z-40 flex items-center justify-center gap-1.5 bg-fg py-1 text-[11px] font-bold text-bg"><Eye className="size-3.5" aria-hidden />{t('previewBanner')}</div>
      )}

      {page === 'home' && (
        <>
          <Header menu={menu} t={t} lang={lang} onLang={(l) => { saveLang(l); setLang(l); }} order={order} tracking={!!orderToken} onBell={() => setStatusOpen(true)} />
          <TableChip menu={menu} t={t} />
          <div className="mt-2">
            <SearchBar t={t} value="" onChange={(q) => browse({ ...filters, q })} onFilter={() => setFilterOpen(true)} filtered={isFiltered(filters)} />
          </div>
          <HeroSlider offers={single} t={t} money={money} showPrices={menu.show_prices} onPick={pick} />
          <CategoryRail categories={menu.categories} active={filters.cat} onPick={(cat) => browse({ ...emptyFilters, cat })} />
          <Popular featured={menu.featured} t={t} money={money} showPrices={menu.show_prices} canOrder={canOrder} inCart={inCart} onPick={pick}
            onAll={() => browse(emptyFilters)} />
          <FamilyOffers offers={family} t={t} money={money} showPrices={menu.show_prices} onPick={pick} />
          {!menu.featured.length && !menu.offers.length && (
            <div className="mt-6 px-4">
              <button onClick={() => browse(emptyFilters)} className="w-full rounded-3xl bg-card p-5 text-start shadow-sm">
                <span className="font-bold">{t('menuTab')}</span><span className="block text-sm text-mut">{t('browseMenu')}</span>
              </button>
            </div>
          )}
          <Info menu={menu} t={t} />
        </>
      )}
      {page === 'menu' && (
        <FullMenu menu={menu} t={t} money={money} canOrder={canOrder} inCart={inCart} filters={filters} setFilters={setFilters}
          onFilter={() => setFilterOpen(true)} onPick={pick} />
      )}
      {page === 'offers' && <OffersPage menu={menu} t={t} money={money} onPick={pick} />}
      {page === 'cart' && (
        <CartPage menu={menu} t={t} money={money} cart={cart} setCart={setCart} contact={contact} flash={flash} onPlaced={placed}
          onBrowse={() => browse(emptyFilters)} onDetails={() => { setBackToCart(true); setTab('profile'); }} />
      )}
      {page === 'contact' && (
        <ContactPage menu={menu} t={t} money={money} flash={flash} contact={contact} setContact={setContact} tracking={!!orderToken} order={order}
          onStatus={() => setStatusOpen(true)}
          onDone={backToCart && cart.length ? () => { setBackToCart(false); setTab('cart'); } : undefined} />
      )}
      {page === 'profile' && (
        <ProfilePage key={menu.preview ? JSON.stringify(menu.ordering) : 'p'} menu={menu} t={t} contact={contact} setContact={setContact} flash={flash}
          onDone={backToCart && cart.length ? () => { setBackToCart(false); setTab('cart'); } : undefined} />
      )}

      {menu.ordering.call_waiter && atTable && page !== 'contact' && (
        <ServiceButton menu={menu} t={t} flash={flash} contact={contact}
          onTable={(table) => { const next = { ...contact, table }; if (!PREVIEW) saveContact(next); setContact(next); }} />
      )}
      {orderToken && !statusOpen && page !== 'contact' && (
        <button onClick={() => setStatusOpen(true)}
          className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] start-[max(1rem,calc(50%-14rem+1rem))] z-30 flex items-center gap-2 rounded-full bg-card px-4 py-2.5 md:start-[max(1rem,calc(50%-24rem+1rem))] lg:start-[max(1rem,calc(50%-36rem+1rem))] text-sm font-semibold shadow-xl">
          <Clock3 className="size-4 text-p" aria-hidden />{order?.stage === 'ready' ? t('orderReady') : t('yourOrder')}
        </button>
      )}

      <BottomNav t={t} tab={tab} setTab={setTab} count={count} atTable={atTable} />

      {picked && (
        <ItemModal item={picked.item} badge={picked.badge} t={t} money={money} canOrder={canOrder} showPrices={menu.show_prices}
          onClose={() => setPicked(null)} onAdd={addToCart} />
      )}
      {filterOpen && <FilterSheet menu={menu} t={t} filters={filters} onClose={() => setFilterOpen(false)} onApply={(f) => { setFilterOpen(false); browse(f); }} />}
      {statusOpen && <StatusSheet order={order} tracking={!!orderToken} t={t} money={money} onClose={() => setStatusOpen(false)} onDone={doneStatus} />}
      {installDemo && <InstallPopup kind={installDemo} app={menu.app} t={t} demo onClose={() => setInstallDemo('')} />}
      {installKind && !picked && !statusOpen && !filterOpen && <InstallPopup kind={installKind} app={menu.app} t={t} onClose={closeInstall} />}
      {toast && <div role="status" className="anim-fade fixed inset-x-0 top-4 z-[60] mx-auto w-fit max-w-[90vw] rounded-full bg-fg px-4 py-2 text-sm font-semibold text-bg shadow-xl">{toast}</div>}
    </div>
  );
}

function BottomNav({ t, tab, setTab, count, atTable }) {
  const item = (key, Icon, label) => (
    <button key={key} onClick={() => setTab(key)} aria-current={tab === key ? 'page' : undefined}
      className={cx('flex flex-1 flex-col items-center gap-0.5 text-[10px] font-semibold transition', tab === key ? 'text-p' : 'text-mut')}>
      <Icon className="size-5" aria-hidden strokeWidth={tab === key ? 2.4 : 1.8} />{label}
    </button>
  );
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 mx-auto max-w-md px-3 pb-[max(.5rem,env(safe-area-inset-bottom))] md:max-w-lg md:pb-4" aria-label={t('menu')}>
      <div className="flex h-14 items-center rounded-[22px] bg-card px-1.5 shadow-[0_-4px_24px_rgba(0,0,0,.10)]">
        {item('home', HomeIcon, t('home'))}
        {item('menu', LayoutGrid, t('menuTab'))}
        <button onClick={() => setTab('cart')} aria-current={tab === 'cart' ? 'page' : undefined} aria-label={t('cartTab')} className="flex flex-1 justify-center">
          <span className={cx('relative -mt-7 flex size-13 items-center justify-center rounded-full bg-p text-onp shadow-lg ring-4 ring-bg transition active:scale-95', count > 0 && 'anim-pulse')}>
            <ShoppingBag className="size-6" aria-hidden />
            {count > 0 && <span className="num absolute -end-1 -top-1 flex size-5 items-center justify-center rounded-full bg-fg text-[10px] font-bold text-bg">{count}</span>}
          </span>
        </button>
        {item('offers', Tag, t('offers'))}
        {atTable ? item('profile', MessagesSquare, t('contactTab')) : item('profile', UserRound, t('profile'))}
      </div>
    </nav>
  );
}

function Fallback({ t, kind, onRetry }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 p-8 text-center">
      <span className="flex size-16 items-center justify-center rounded-full bg-card2 text-mut"><Utensils className="size-8" aria-hidden /></span>
      <h1 className="text-xl font-bold">{kind === 'closed' ? t('closed') : t('error')}</h1>
      <p className="text-mut">{t('closedSub')}</p>
      {!PREVIEW && <button onClick={onRetry} className="mt-2 rounded-full bg-p px-6 py-3 font-bold text-onp">{t('retry')}</button>}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="mx-auto max-w-md px-4 pt-5 md:max-w-3xl lg:max-w-6xl" aria-busy="true">
      <div className="skeleton h-8 w-1/2 rounded-lg" />
      <div className="skeleton mt-4 h-12 rounded-2xl" />
      <div className="skeleton mt-4 h-52 rounded-[26px]" />
      <div className="mt-5 flex gap-4">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="skeleton size-16 rounded-full" />)}</div>
      <div className="mt-6 grid grid-cols-2 gap-3">{[0, 1].map((i) => <div key={i} className="skeleton aspect-[4/5] rounded-2xl" />)}</div>
    </div>
  );
}
