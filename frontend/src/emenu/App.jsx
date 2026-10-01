import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BellRing, Receipt, Search, X, Plus, Minus, ShoppingBag, ChevronDown, Phone, MapPin, MessageCircle, Globe,
  Clock3, CheckCircle2, XCircle, Utensils, Languages, Loader2, Trash2, Link as LinkIcon,
} from 'lucide-react';
import DOMPurify from 'dompurify';
import { menuApi } from './api';
import { makeT, pickLang, saveLang, langNames } from './i18n';

const cx = (...c) => c.filter(Boolean).join(' ');
const tableToken = (window.location.pathname.match(/^\/t\/([A-Za-z0-9]+)/) || [])[1] || '';
const ORDER_KEY = `cpro.menu.order.${tableToken || 'web'}`;
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch { /* blocked */ } },
};

// Readable text colour on top of the owner's primary colour.
function onColor(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return '#1a1206';
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? '#1a1206' : '#ffffff';
}
const validHex = (h) => /^#[0-9a-f]{6}$/i.test(h || '');

function social(kind, v) {
  if (!v) return '';
  if (/^https?:\/\//i.test(v)) return v;
  const h = v.replace(/^@/, '');
  return { instagram: `https://instagram.com/${h}`, facebook: `https://facebook.com/${h}`, tiktok: `https://www.tiktok.com/@${h}` }[kind];
}
const waLink = (n) => `https://wa.me/${String(n).replace(/[^\d]/g, '')}`;

export default function MenuApp() {
  const [menu, setMenu] = useState(null);
  const [failed, setFailed] = useState(null);
  const [lang, setLang] = useState('ar');
  const [cart, setCart] = useState([]);
  const [sheet, setSheet] = useState(null); // {kind:'item', item} | {kind:'cart'} | {kind:'status'}
  const [orderToken, setOrderToken] = useState(() => store.get(ORDER_KEY));
  const [toast, setToast] = useState('');
  const t = useMemo(() => makeT(lang), [lang]);

  const load = useCallback(async () => {
    setFailed(null);
    try {
      const m = await menuApi.menu(tableToken);
      setMenu(m);
      setLang(pickLang(m.languages, m.default_language));
    } catch (e) {
      setFailed(e.status === 404 ? 'closed' : 'error');
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (orderToken) setSheet({ kind: 'status' }); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Theme, direction and title follow the menu settings and language.
  useEffect(() => {
    const root = document.documentElement;
    root.lang = lang;
    root.dir = t.dir;
    if (!menu) return;
    root.dataset.theme = (menu.theme.name || 'midnight').toLowerCase();
    if (validHex(menu.theme.primary)) {
      root.style.setProperty('--p', menu.theme.primary);
      root.style.setProperty('--onp', onColor(menu.theme.primary));
    }
    if (validHex(menu.theme.accent)) root.style.setProperty('--a', menu.theme.accent);
    document.title = `${menu.restaurant.name} — ${t('menu')}`;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', getComputedStyle(root).getPropertyValue('--bg').trim());
  }, [menu, lang, t]);

  const flash = (msg) => { setToast(msg); setTimeout(() => setToast(''), 2800); };
  const money = useCallback((minor) => {
    const n = new Intl.NumberFormat(t.locale, { maximumFractionDigits: 2 }).format((minor || 0) / 100);
    return `${n} ${t.currency(menu?.restaurant.currency || 'EGP')}`;
  }, [t, menu]);

  if (failed) return <Fallback t={t} kind={failed} onRetry={load} />;
  if (!menu) return <Skeleton />;

  const canOrder = menu.ordering.dine_in || menu.ordering.takeaway;
  const count = cart.reduce((s, l) => s + l.qty, 0);
  const total = cart.reduce((s, l) => s + lineTotal(l), 0);
  const addToCart = (line) => {
    setCart((c) => {
      const same = c.find((l) => l.key === line.key);
      return same ? c.map((l) => (l === same ? { ...l, qty: Math.min(l.qty + line.qty, 50) } : l)) : [...c, line];
    });
    setSheet(null);
    flash(`${line.item.name} ✓`);
  };
  const placed = (token) => {
    store.set(ORDER_KEY, token);
    setOrderToken(token);
    setCart([]);
    setSheet({ kind: 'status' });
  };

  return (
    <div className="mx-auto min-h-dvh max-w-2xl pb-32">
      <Hero menu={menu} t={t} lang={lang} onLang={(l) => { saveLang(l); setLang(l); }} />
      <Catalog menu={menu} t={t} money={money} canOrder={canOrder} cart={cart} onPick={(item) => setSheet({ kind: 'item', item })} />
      <Info menu={menu} t={t} />

      {menu.ordering.call_waiter && !sheet && <ServiceButtons t={t} flash={flash} raised={count > 0} />}
      {count > 0 && !sheet && (
        <button onClick={() => setSheet({ kind: 'cart' })}
          className="anim-pop fixed inset-x-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-30 mx-auto flex max-w-[calc(42rem-2rem)] items-center gap-3 rounded-2xl bg-p px-4 py-3.5 text-onp shadow-2xl shadow-black/40">
          <span className="num flex size-8 items-center justify-center rounded-full bg-black/15 text-sm font-bold">{count}</span>
          <span className="flex-1 text-start font-bold">{t('viewCart')}</span>
          <span className="num font-bold">{money(total)}</span>
        </button>
      )}
      {orderToken && !sheet && (
        <button onClick={() => setSheet({ kind: 'status' })}
          className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] start-4 z-30 flex items-center gap-2 rounded-full border border-line bg-card px-4 py-2.5 text-sm font-semibold shadow-xl">
          <Clock3 className="size-4 text-p" aria-hidden />{t('yourOrder')}
        </button>
      )}

      {sheet?.kind === 'item' && (
        <ItemSheet item={sheet.item} t={t} money={money} canOrder={canOrder} showPrices={menu.show_prices}
          onClose={() => setSheet(null)} onAdd={addToCart} />
      )}
      {sheet?.kind === 'cart' && (
        <CartSheet menu={menu} t={t} money={money} cart={cart} setCart={setCart} total={total}
          onClose={() => setSheet(null)} onPlaced={placed} />
      )}
      {sheet?.kind === 'status' && orderToken && (
        <StatusSheet token={orderToken} t={t} money={money}
          onClose={() => setSheet(null)}
          onDone={() => { store.set(ORDER_KEY, ''); setOrderToken(null); setSheet(null); }} />
      )}
      {toast && (
        <div role="status" className="anim-fade fixed inset-x-0 top-4 z-50 mx-auto w-fit max-w-[90vw] rounded-full bg-fg px-4 py-2 text-sm font-semibold text-bg shadow-xl">{toast}</div>
      )}
    </div>
  );
}

const lineTotal = (l) => (l.item.price_minor + l.mods.reduce((s, m) => s + m.price_minor, 0)) * l.qty;

// ---- hero ------------------------------------------------------------------------

function Hero({ menu, t, lang, onLang }) {
  const r = menu.restaurant;
  const [open, setOpen] = useState(false);
  return (
    <header className="relative">
      <div className={cx('relative overflow-hidden', r.cover ? 'h-56 sm:h-64' : 'h-40')}>
        {r.cover
          ? <img src={r.cover} alt="" className="size-full object-cover" />
          : <div className="size-full" style={{ background: 'radial-gradient(120% 90% at 85% 0%, var(--p) 0%, transparent 55%), radial-gradient(90% 80% at 0% 100%, var(--a) 0%, transparent 60%), var(--card2)' }} />}
        <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-black/20 to-bg" />
        {menu.languages.length > 1 && (
          <div className="absolute end-3 top-[max(.75rem,env(safe-area-inset-top))] z-10">
            <button onClick={() => setOpen(!open)} aria-expanded={open} aria-label={t('language')}
              className="flex h-10 items-center gap-1.5 rounded-full bg-black/45 px-3 text-sm font-semibold text-white backdrop-blur">
              <Languages className="size-4" aria-hidden />{langNames[lang]}<ChevronDown className="size-3.5" aria-hidden />
            </button>
            {open && (
              <ul className="anim-fade absolute end-0 mt-2 min-w-36 overflow-hidden rounded-2xl border border-line bg-card shadow-2xl">
                {menu.languages.map((l) => (
                  <li key={l}>
                    <button onClick={() => { onLang(l); setOpen(false); }}
                      className={cx('block w-full px-4 py-3 text-start text-sm', l === lang ? 'font-bold text-p' : 'hover:bg-card2')}>{langNames[l]}</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
      <div className="relative -mt-16 px-5">
        <div className="flex items-end gap-4">
          {r.logo
            ? <img src={r.logo} alt="" className="size-20 shrink-0 rounded-2xl border-4 border-bg bg-card object-cover shadow-xl" />
            : <div className="flex size-20 shrink-0 items-center justify-center rounded-2xl border-4 border-bg bg-p text-3xl font-bold text-onp shadow-xl">{r.name.slice(0, 1)}</div>}
          {menu.table && (
            <span className="mb-1 ms-auto inline-flex items-center gap-1.5 rounded-full bg-a px-3 py-1.5 text-sm font-bold text-white shadow-lg">
              <Utensils className="size-3.5" aria-hidden />{t('table')} {menu.table}
            </span>
          )}
        </div>
        <h1 className="mt-3 text-[1.7rem] font-bold leading-tight tracking-tight">{r.name}</h1>
        {r.tagline && <p className="mt-1 text-mut">{r.tagline}</p>}
        {r.welcome && <p className="mt-3 rounded-2xl border border-line bg-card px-4 py-3 text-sm leading-relaxed">{r.welcome}</p>}
      </div>
    </header>
  );
}

// ---- catalogue ---------------------------------------------------------------------

function Catalog({ menu, t, money, canOrder, cart, onPick }) {
  const [active, setActive] = useState(menu.categories[0]?.id);
  const [q, setQ] = useState('');
  const barRef = useRef(null);
  const compact = menu.theme.card_style === 'Compact List';
  const inCart = useMemo(() => {
    const m = {};
    cart.forEach((l) => { m[l.item.id] = (m[l.item.id] || 0) + l.qty; });
    return m;
  }, [cart]);

  // Scroll-spy: highlight the category in view and keep its chip visible.
  useEffect(() => {
    if (q) return undefined;
    const io = new IntersectionObserver((entries) => {
      const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (vis) setActive(vis.target.dataset.cat);
    }, { rootMargin: '-120px 0px -65% 0px' });
    document.querySelectorAll('[data-cat]').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [menu, q]);
  useEffect(() => {
    barRef.current?.querySelector(`[data-chip="${active}"]`)?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  }, [active]);

  const term = q.trim().toLowerCase();
  const cats = term
    ? [{ id: 'search', name: '', items: menu.categories.flatMap((c) => c.items).filter((i) => (i.name + ' ' + i.description + ' ' + (i.code || '')).toLowerCase().includes(term)) }]
    : menu.categories;

  return (
    <main className="mt-5">
      <nav className="sticky top-0 z-20 border-b border-line bg-bg/90 backdrop-blur-md">
        <div className="px-4 pt-3">
          <label className="flex h-11 items-center gap-2 rounded-2xl border border-line bg-card px-3 focus-within:border-p">
            <Search className="size-4 text-mut" aria-hidden />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('search')} aria-label={t('search')}
              className="h-full flex-1 bg-transparent text-[15px] outline-none placeholder:text-mut" />
            {q && <button onClick={() => setQ('')} aria-label={t('close')} className="text-mut"><X className="size-4" /></button>}
          </label>
        </div>
        {!term && (
          <div ref={barRef} className="no-scrollbar flex gap-2 overflow-x-auto px-4 py-3">
            {menu.categories.map((c) => (
              <a key={c.id} href={`#c-${c.id}`} data-chip={c.id}
                className={cx('shrink-0 rounded-full px-4 py-2 text-sm font-semibold transition-colors',
                  active === c.id ? 'bg-p text-onp shadow-md' : 'bg-card2 text-mut hover:text-fg')}>{c.name}</a>
            ))}
          </div>
        )}
      </nav>

      {!canOrder && <p className="mx-4 mt-4 flex items-center gap-2 rounded-2xl bg-card2 px-4 py-3 text-sm text-mut"><BellRing className="size-4 text-a" aria-hidden />{t('browseOnly')}</p>}

      {cats.map((c) => (
        <section key={c.id} id={`c-${c.id}`} data-cat={c.id} className="scroll-mt-32 px-4 pt-6">
          {c.name && <h2 className="mb-3 flex items-center gap-3 text-xl font-bold"><span className="h-6 w-1.5 rounded-full bg-p" />{c.name}</h2>}
          {!c.items.length && <p className="py-10 text-center text-mut">{term ? t('noResults') : t('empty')}</p>}
          <div className={compact ? 'divide-y divide-line overflow-hidden rounded-3xl border border-line bg-card' : 'grid grid-cols-2 gap-3 sm:grid-cols-3'}>
            {c.items.map((i) => compact
              ? <CompactItem key={i.id} item={i} money={money} showPrices={menu.show_prices} count={inCart[i.id]} onPick={onPick} canOrder={canOrder} />
              : <PhotoItem key={i.id} item={i} money={money} showPrices={menu.show_prices} count={inCart[i.id]} onPick={onPick} canOrder={canOrder} />)}
          </div>
        </section>
      ))}
    </main>
  );
}

function Thumb({ item, className }) {
  return item.image
    ? <img src={item.image} alt="" loading="lazy" className={cx('object-cover', className)} />
    : (
      <div className={cx('flex items-center justify-center text-p', className)}
        style={{ background: 'radial-gradient(circle at 30% 25%, color-mix(in srgb, var(--p) 28%, transparent), transparent 65%), var(--card2)' }}>
        <span className="text-3xl font-bold opacity-80">{item.name.slice(0, 1)}</span>
      </div>
    );
}

function CountBadge({ count }) {
  return count ? <span className="num anim-pop absolute end-2 top-2 flex size-7 items-center justify-center rounded-full bg-a text-xs font-bold text-white shadow-lg">{count}</span> : null;
}

function PhotoItem({ item, money, showPrices, count, onPick, canOrder }) {
  return (
    <button onClick={() => onPick(item)} className="group relative flex flex-col overflow-hidden rounded-3xl border border-line bg-card text-start shadow-sm transition active:scale-[.98]">
      <div className="relative">
        <Thumb item={item} className="aspect-[4/3] w-full transition duration-500 group-hover:scale-105" />
        <CountBadge count={count} />
      </div>
      <div className="flex flex-1 flex-col p-3">
        <h3 className="line-clamp-2 font-bold leading-snug">{item.name}</h3>
        {item.description && <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-mut">{item.description}</p>}
        <div className="mt-auto flex items-center justify-between pt-2.5">
          {showPrices ? <span className="num font-bold text-p">{money(item.price_minor)}</span> : <span />}
          {canOrder && <span className="flex size-8 items-center justify-center rounded-full bg-p text-onp shadow-md"><Plus className="size-4" aria-hidden /></span>}
        </div>
      </div>
    </button>
  );
}

function CompactItem({ item, money, showPrices, count, onPick, canOrder }) {
  return (
    <button onClick={() => onPick(item)} className="relative flex w-full items-center gap-3 p-3 text-start transition active:bg-card2">
      <div className="min-w-0 flex-1">
        <h3 className="font-bold">{item.name}{item.code && <span className="ms-2 text-xs font-normal text-mut">{item.code}</span>}</h3>
        {item.description && <p className="mt-0.5 line-clamp-2 text-xs text-mut">{item.description}</p>}
        {showPrices && <div className="num mt-1.5 font-bold text-p">{money(item.price_minor)}</div>}
      </div>
      <div className="relative shrink-0">
        <Thumb item={item} className="size-20 rounded-2xl" />
        {canOrder && <span className="absolute -bottom-2 start-1/2 flex size-7 -translate-x-1/2 items-center justify-center rounded-full bg-p text-onp shadow-md rtl:translate-x-1/2"><Plus className="size-3.5" aria-hidden /></span>}
        <CountBadge count={count} />
      </div>
    </button>
  );
}

// ---- sheets --------------------------------------------------------------------------

function Sheet({ onClose, children, label }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose]);
  return (
    <div className="anim-fade fixed inset-0 z-40 flex items-end justify-center bg-black/60 backdrop-blur-[2px]" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={label} onClick={(e) => e.stopPropagation()}
        className="anim-sheet flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-[28px] bg-bg shadow-2xl">
        {children}
      </div>
    </div>
  );
}

function SheetHeader({ title, onClose, t }) {
  return (
    <div className="flex items-center gap-3 border-b border-line px-5 py-4">
      <h2 className="flex-1 text-lg font-bold">{title}</h2>
      <button onClick={onClose} aria-label={t('close')} className="flex size-9 items-center justify-center rounded-full bg-card2"><X className="size-4" /></button>
    </div>
  );
}

function groupHint(g, t) {
  if (g.max === 1) return g.min ? t('chooseOne') : t('optional');
  if (g.min && g.max) return `${t('chooseAtLeast', [g.min])} · ${t('chooseUpTo', [g.max])}`;
  if (g.min) return t('chooseAtLeast', [g.min]);
  if (g.max) return t('chooseUpTo', [g.max]);
  return t('optional');
}

function ItemSheet({ item, t, money, canOrder, showPrices, onClose, onAdd }) {
  const [picked, setPicked] = useState({}); // groupId -> [modifier]
  const [qty, setQty] = useState(1);
  const [notes, setNotes] = useState('');
  const toggle = (g, m) => setPicked((p) => {
    const cur = p[g.id] || [];
    if (cur.some((x) => x.id === m.id)) return { ...p, [g.id]: cur.filter((x) => x.id !== m.id) };
    if (g.max === 1) return { ...p, [g.id]: [m] };
    if (g.max && cur.length >= g.max) return p;
    return { ...p, [g.id]: [...cur, m] };
  });
  const mods = item.groups.flatMap((g) => picked[g.id] || []);
  const valid = item.groups.every((g) => (picked[g.id]?.length || 0) >= g.min);
  const unit = item.price_minor + mods.reduce((s, m) => s + m.price_minor, 0);
  const add = () => onAdd({
    key: `${item.id}|${mods.map((m) => m.id).sort().join(',')}|${notes.trim()}`,
    item, qty, notes: notes.trim(), mods,
  });

  return (
    <Sheet onClose={onClose} label={item.name}>
      <div className="overflow-y-auto">
        <div className="relative">
          {item.image ? <img src={item.image} alt="" className="aspect-[16/10] w-full object-cover" /> : <div className="h-6" />}
          <button onClick={onClose} aria-label={t('close')} className="absolute end-3 top-3 flex size-10 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur"><X className="size-5" /></button>
        </div>
        <div className="px-5 pb-4 pt-4">
          <h2 className="text-2xl font-bold leading-tight">{item.name}</h2>
          {item.description && <p className="mt-2 leading-relaxed text-mut">{item.description}</p>}
          {showPrices && <p className="num mt-3 text-xl font-bold text-p">{money(item.price_minor)}</p>}
        </div>
        {item.groups.map((g) => (
          <fieldset key={g.id} className="border-t border-line px-5 py-4">
            <legend className="sr-only">{g.name}</legend>
            <div className="mb-3 flex items-baseline justify-between gap-2">
              <h3 className="font-bold">{g.name}</h3>
              <span className={cx('rounded-full px-2.5 py-0.5 text-xs font-semibold', g.min ? 'bg-a/15 text-a' : 'bg-card2 text-mut')}>
                {g.min ? `${t('required')} · ` : ''}{groupHint(g, t)}
              </span>
            </div>
            <div className="grid gap-2">
              {g.modifiers.map((m) => {
                const on = (picked[g.id] || []).some((x) => x.id === m.id);
                return (
                  <button key={m.id} type="button" disabled={!canOrder} onClick={() => toggle(g, { id: m.id, name: m.name, price_minor: m.price_minor })}
                    aria-pressed={on}
                    className={cx('flex min-h-12 items-center gap-3 rounded-2xl border px-4 text-start transition',
                      on ? 'border-p bg-p/10' : 'border-line bg-card')}>
                    <span className={cx('flex size-5 shrink-0 items-center justify-center border-2', g.max === 1 ? 'rounded-full' : 'rounded-md', on ? 'border-p bg-p' : 'border-mut/50')}>
                      {on && <span className={cx('bg-onp', g.max === 1 ? 'size-2 rounded-full' : 'size-2.5 rounded-sm')} />}
                    </span>
                    <span className="flex-1">{m.name}</span>
                    {showPrices && m.price_minor > 0 && <span className="num text-sm text-mut">+{money(m.price_minor)}</span>}
                  </button>
                );
              })}
            </div>
          </fieldset>
        ))}
        {canOrder && (
          <div className="border-t border-line px-5 py-4">
            <label className="mb-2 block font-bold" htmlFor="item-notes">{t('notes')}</label>
            <input id="item-notes" value={notes} maxLength={120} onChange={(e) => setNotes(e.target.value)} placeholder={t('notesPh')}
              className="h-12 w-full rounded-2xl border border-line bg-card px-4 outline-none focus:border-p" />
          </div>
        )}
      </div>
      {canOrder && (
        <div className="flex items-center gap-3 border-t border-line bg-card px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4">
          <Stepper value={qty} onChange={setQty} t={t} />
          <button onClick={add} disabled={!valid}
            className="flex h-13 flex-1 items-center justify-between gap-2 rounded-2xl bg-p px-5 py-3.5 font-bold text-onp shadow-lg transition active:scale-[.98] disabled:opacity-40">
            <span>{t('addToCart')}</span>{showPrices && <span className="num">{money(unit * qty)}</span>}
          </button>
        </div>
      )}
    </Sheet>
  );
}

function Stepper({ value, onChange, min = 1, small, t }) {
  const b = cx('flex items-center justify-center rounded-full bg-card2 transition active:scale-90', small ? 'size-8' : 'size-11');
  return (
    <div className="flex items-center gap-2">
      <button type="button" className={b} aria-label={t('decrease')} onClick={() => onChange(Math.max(min, value - 1))}><Minus className="size-4" /></button>
      <span className={cx('num text-center font-bold', small ? 'w-5' : 'w-7 text-lg')}>{value}</span>
      <button type="button" className={b} aria-label={t('increase')} onClick={() => onChange(Math.min(50, value + 1))}><Plus className="size-4" /></button>
    </div>
  );
}

function CartSheet({ menu, t, money, cart, setCart, total, onClose, onPlaced }) {
  const atTable = !!menu.table && menu.ordering.dine_in;
  const [name, setName] = useState(() => store.get('cpro.menu.name') || '');
  const [phone, setPhone] = useState(() => store.get('cpro.menu.phone') || '');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const setQty = (l, q) => setCart((c) => c.map((x) => (x === l ? { ...x, qty: q } : x)));
  const remove = (l) => setCart((c) => { const n = c.filter((x) => x !== l); if (!n.length) onClose(); return n; });
  const needContact = !atTable;
  const ready = !needContact || (name.trim() && (!menu.ordering.require_phone || phone.trim().length >= 7));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      if (needContact) { store.set('cpro.menu.name', name.trim()); store.set('cpro.menu.phone', phone.trim()); }
      const r = await menuApi.order({
        table_token: atTable ? tableToken : '',
        customer_name: name.trim(), phone: phone.trim(), notes: notes.trim(),
        lines: cart.map((l) => ({ item_id: l.item.id, qty: l.qty, modifier_ids: l.mods.map((m) => m.id), notes: l.notes })),
      });
      onPlaced(r.token);
    } catch (ex) {
      setErr(ex.status === 0 ? t('error') : ex.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet onClose={onClose} label={t('cart')}>
      <SheetHeader title={t('cart')} onClose={onClose} t={t} />
      <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
        <div className="overflow-y-auto px-5 py-3">
          <div className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-card2 px-3 py-1 text-xs font-semibold text-mut">
            {atTable ? <><Utensils className="size-3.5" aria-hidden />{t('dineIn')} · {t('table')} {menu.table}</> : <><ShoppingBag className="size-3.5" aria-hidden />{t('takeaway')}</>}
          </div>
          <ul className="divide-y divide-line">
            {cart.map((l) => (
              <li key={l.key} className="flex gap-3 py-3">
                <Thumb item={l.item} className="size-16 shrink-0 rounded-2xl" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start gap-2">
                    <h3 className="flex-1 font-bold leading-snug">{l.item.name}</h3>
                    <button type="button" onClick={() => remove(l)} aria-label={t('remove')} className="text-mut"><Trash2 className="size-4" /></button>
                  </div>
                  {l.mods.length > 0 && <p className="text-xs text-mut">+ {l.mods.map((m) => m.name).join('، ')}</p>}
                  {l.notes && <p className="text-xs text-a">{l.notes}</p>}
                  <div className="mt-2 flex items-center justify-between">
                    <Stepper small value={l.qty} onChange={(q) => setQty(l, q)} t={t} />
                    {menu.show_prices && <span className="num font-bold">{money(lineTotal(l))}</span>}
                  </div>
                </div>
              </li>
            ))}
          </ul>
          {needContact && (
            <div className="mt-2 grid gap-3">
              <input required value={name} onChange={(e) => setName(e.target.value)} placeholder={t('name')} autoComplete="name" maxLength={60}
                className="h-12 rounded-2xl border border-line bg-card px-4 outline-none focus:border-p" />
              <input required={menu.ordering.require_phone} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={t('phone')}
                type="tel" inputMode="tel" autoComplete="tel" dir="ltr" maxLength={20}
                className="num h-12 rounded-2xl border border-line bg-card px-4 text-start outline-none focus:border-p rtl:text-end" />
            </div>
          )}
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('orderNotesPh')} maxLength={300} rows={2}
            className="mt-3 w-full rounded-2xl border border-line bg-card px-4 py-3 outline-none focus:border-p" />
          {menu.ordering.note && <p className="mt-2 rounded-2xl bg-card2 px-4 py-3 text-sm text-mut">{menu.ordering.note}</p>}
          {err && <p role="alert" className="mt-3 rounded-2xl bg-a/15 px-4 py-3 text-sm font-semibold text-a">{err}</p>}
        </div>
        <div className="border-t border-line bg-card px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4">
          {menu.show_prices && (
            <div className="mb-3 flex items-baseline justify-between">
              <span className="text-sm text-mut">{t('estTotal')}</span>
              <span className="num text-xl font-bold">{money(total)}</span>
            </div>
          )}
          <button disabled={busy || !ready}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-p py-4 text-lg font-bold text-onp shadow-lg transition active:scale-[.98] disabled:opacity-40">
            {busy && <Loader2 className="size-5 animate-spin" aria-hidden />}{t('send')}
          </button>
        </div>
      </form>
    </Sheet>
  );
}

function StatusSheet({ token, t, money, onClose, onDone }) {
  const [o, setO] = useState(null);
  const [gone, setGone] = useState(false);
  useEffect(() => {
    let timer;
    let stop = false;
    const poll = async () => {
      try {
        const r = await menuApi.status(token);
        if (stop) return;
        setO(r);
        if (r.status === 'pending') timer = setTimeout(poll, 4000);
      } catch (e) {
        if (e.status === 404) setGone(true);
        else if (!stop) timer = setTimeout(poll, 6000);
      }
    };
    poll();
    return () => { stop = true; clearTimeout(timer); };
  }, [token]);
  useEffect(() => { if (gone) onDone(); }, [gone, onDone]);

  const view = {
    pending: { icon: Clock3, tone: 'text-p bg-p/15', title: t('pending'), sub: t('pendingSub'), spin: true },
    accepted: { icon: CheckCircle2, tone: 'text-emerald-500 bg-emerald-500/15', title: t('accepted'), sub: t('acceptedSub', [o?.order_number]) },
    rejected: { icon: XCircle, tone: 'text-a bg-a/15', title: t('rejected'), sub: o?.reject_reason },
    expired: { icon: Clock3, tone: 'text-mut bg-card2', title: t('expired'), sub: t('expiredSub') },
  }[o?.status || 'pending'];
  const Icon = view.icon;
  return (
    <Sheet onClose={onClose} label={t('yourOrder')}>
      <SheetHeader title={t('yourOrder')} onClose={onClose} t={t} />
      <div className="overflow-y-auto px-5 py-6">
        <div className="flex flex-col items-center text-center">
          <span className={cx('anim-pop relative flex size-20 items-center justify-center rounded-full', view.tone)}>
            {view.spin && <span className="absolute inset-0 animate-ping rounded-full bg-current opacity-20 motion-reduce:hidden" />}
            <Icon className="size-10" aria-hidden />
          </span>
          <h2 className="mt-4 text-xl font-bold">{view.title}</h2>
          {view.sub && <p className="mt-1 text-mut">{view.sub}</p>}
        </div>
        {o && (
          <ul className="mt-6 divide-y divide-line rounded-3xl border border-line bg-card px-4">
            {o.lines.map((l, i) => (
              <li key={i} className="flex gap-2 py-3 text-sm">
                <span className="num font-bold text-p">{l.qty}×</span>
                <span className="flex-1">{l.name}{l.modifiers?.length > 0 && <span className="block text-xs text-mut">+ {l.modifiers.map((m) => m.name).join('، ')}</span>}</span>
                <span className="num">{money(l.total_minor)}</span>
              </li>
            ))}
            <li className="flex justify-between py-3 font-bold"><span>{t('total')}</span><span className="num">{money(o.total_minor)}</span></li>
          </ul>
        )}
      </div>
      {o && o.status !== 'pending' && (
        <div className="border-t border-line bg-card px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4">
          <button onClick={onDone} className="w-full rounded-2xl bg-p py-4 font-bold text-onp">{o.status === 'accepted' ? t('backToMenu') : t('newOrder')}</button>
        </div>
      )}
    </Sheet>
  );
}

// ---- service, info, states ----------------------------------------------------------------

function ServiceButtons({ t, flash, raised }) {
  const [busy, setBusy] = useState('');
  const call = async (kind) => {
    setBusy(kind);
    try {
      await menuApi.call(tableToken, kind);
      flash(kind === 'bill' ? t('billComing') : t('waiterComing'));
    } catch (e) {
      flash(e.status === 0 ? t('error') : e.message);
    } finally {
      setBusy('');
    }
  };
  return (
    <div className={cx('fixed end-4 z-30 flex items-center overflow-hidden rounded-full bg-a text-white shadow-xl shadow-black/30',
      raised ? 'bottom-[max(5.5rem,calc(env(safe-area-inset-bottom)+5rem))]' : 'bottom-[max(1rem,env(safe-area-inset-bottom))]')}>
      <button onClick={() => call('waiter')} disabled={!!busy} className="flex h-12 items-center gap-2 ps-4 pe-3 text-sm font-bold transition active:bg-black/15">
        {busy === 'waiter' ? <Loader2 className="size-5 animate-spin" /> : <BellRing className="size-5" aria-hidden />}{t('callWaiter')}
      </button>
      <span className="h-6 w-px bg-white/30" aria-hidden />
      <button onClick={() => call('bill')} disabled={!!busy} aria-label={t('askBill')} title={t('askBill')}
        className="flex h-12 items-center justify-center ps-3 pe-4 transition active:bg-black/15">
        {busy === 'bill' ? <Loader2 className="size-5 animate-spin" /> : <Receipt className="size-5" aria-hidden />}
      </button>
    </div>
  );
}

function Info({ menu, t }) {
  const r = menu.restaurant;
  const html = useMemo(() => (r.custom_html ? DOMPurify.sanitize(r.custom_html, {
    USE_PROFILES: { html: true }, FORBID_TAGS: ['style', 'form', 'input', 'button', 'iframe'], FORBID_ATTR: ['style'],
  }) : ''), [r.custom_html]);
  const links = [
    r.phone && { href: `tel:${r.phone}`, icon: Phone, label: t('call') },
    r.whatsapp && { href: waLink(r.whatsapp), icon: MessageCircle, label: t('whatsapp') },
    r.map_url && { href: r.map_url, icon: MapPin, label: t('directions') },
    r.instagram && { href: social('instagram', r.instagram), icon: LinkIcon, label: 'Instagram' },
    r.facebook && { href: social('facebook', r.facebook), icon: Globe, label: 'Facebook' },
    r.tiktok && { href: social('tiktok', r.tiktok), icon: LinkIcon, label: 'TikTok' },
  ].filter(Boolean);
  if (!html && !links.length && !r.address && !r.footer) return null;
  return (
    <footer className="mt-10 px-4">
      {html && <div className="custom-html mb-6 rounded-3xl border border-line bg-card p-5" dangerouslySetInnerHTML={{ __html: html }} />}
      {(links.length > 0 || r.address) && (
        <div className="rounded-3xl border border-line bg-card p-5">
          <h2 className="mb-3 font-bold">{t('contact')}</h2>
          {r.address && <p className="mb-3 flex items-start gap-2 text-sm text-mut"><MapPin className="mt-0.5 size-4 shrink-0" aria-hidden />{r.address}</p>}
          <div className="flex flex-wrap gap-2">
            {links.map(({ href, icon: Icon, label }) => (
              <a key={label} href={href} target="_blank" rel="noopener noreferrer"
                className="flex h-10 items-center gap-2 rounded-full bg-card2 px-4 text-sm font-semibold transition hover:bg-p hover:text-onp">
                <Icon className="size-4" aria-hidden />{label}
              </a>
            ))}
          </div>
        </div>
      )}
      <p className="py-8 text-center text-xs text-mut">{r.footer ? `${r.footer} · ` : ''}{t('poweredBy')}</p>
    </footer>
  );
}

function Fallback({ t, kind, onRetry }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 p-8 text-center">
      <span className="flex size-16 items-center justify-center rounded-full bg-card2 text-mut"><Utensils className="size-8" aria-hidden /></span>
      <h1 className="text-xl font-bold">{kind === 'closed' ? t('closed') : t('error')}</h1>
      <p className="text-mut">{t('closedSub')}</p>
      <button onClick={onRetry} className="mt-2 rounded-full bg-p px-6 py-3 font-bold text-onp">{t('retry')}</button>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="mx-auto max-w-2xl" aria-busy="true">
      <div className="skeleton h-56" />
      <div className="px-5">
        <div className="skeleton -mt-10 size-20 rounded-2xl" />
        <div className="skeleton mt-4 h-7 w-2/3 rounded-lg" />
        <div className="skeleton mt-2 h-4 w-1/2 rounded-lg" />
      </div>
      <div className="mt-8 grid grid-cols-2 gap-3 px-4">
        {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton aspect-[4/5] rounded-3xl" />)}
      </div>
    </div>
  );
}
