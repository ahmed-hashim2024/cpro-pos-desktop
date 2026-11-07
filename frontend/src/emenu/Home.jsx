import { useEffect, useRef, useState } from 'react';
import { Search, SlidersHorizontal, Bell, BellRing, Plus, ArrowLeft, ArrowRight, Languages, ChevronDown, Utensils, Phone, MapPin, MessageCircle, Globe, Link as LinkIcon } from 'lucide-react';
import { cx, Thumb, Badge, PriceTag, SectionTitle, offerShade, safeHref, social, waLink } from './lib';
import { langNames } from './i18n';
import { OfferSticker } from '../lib/sticker';

// ---- header ----------------------------------------------------------------------

export function Header({ menu, t, lang, onLang, order, tracking, onBell }) {
  const r = menu.restaurant;
  const [open, setOpen] = useState(false);
  const ready = order?.stage === 'ready';
  return (
    <header className="flex items-center gap-3 px-4 pb-3 pt-[max(1rem,env(safe-area-inset-top))]">
      {r.logo && <img src={r.logo} alt="" className="size-11 shrink-0 rounded-xl object-cover shadow" />}
      <div className="min-w-0 flex-1 leading-tight">
        <h1 className="truncate text-xl font-black uppercase tracking-tight">{r.name}</h1>
        {r.tagline && <p className="truncate text-[11px] font-semibold uppercase tracking-[.18em] text-mut">{r.tagline}</p>}
      </div>
      {menu.languages.length > 1 && (
        <div className="relative">
          <button onClick={() => setOpen(!open)} aria-expanded={open} aria-label={t('language')}
            className="flex h-10 items-center gap-1 rounded-full bg-card px-3 text-xs font-bold shadow-sm">
            <Languages className="size-4" aria-hidden />{lang.toUpperCase()}<ChevronDown className="size-3" aria-hidden />
          </button>
          {open && (
            <ul className="anim-fade absolute end-0 z-30 mt-2 min-w-36 overflow-hidden rounded-2xl border border-line bg-card shadow-2xl">
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
      <button onClick={onBell} aria-label={ready ? t('orderReady') : t('notifications')}
        className={cx('relative flex size-11 items-center justify-center rounded-full shadow-sm transition', ready ? 'anim-pulse bg-p text-onp' : 'bg-card')}>
        {ready ? <BellRing className="size-5" aria-hidden /> : <Bell className="size-5" aria-hidden />}
        {tracking && !ready && <span className="anim-pop absolute end-2.5 top-2.5 size-2.5 rounded-full bg-p ring-2 ring-card" />}
      </button>
    </header>
  );
}

// ---- search + filter ---------------------------------------------------------------------

export function SearchBar({ t, value, onChange, onFilter, filtered, autoFocus }) {
  return (
    <div className="flex gap-2 px-4">
      {/* min-w-0 + size=1: WebKit won't shrink an input below its ~20-character natural width otherwise. */}
      <label className="flex h-12 min-w-0 flex-1 items-center gap-2 rounded-2xl bg-card px-4 shadow-sm focus-within:ring-2 focus-within:ring-p/40">
        <Search className="size-5 shrink-0 text-mut" aria-hidden />
        <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={t('searchMeal')} aria-label={t('search')} autoFocus={autoFocus} size={1}
          className="h-full w-full min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-mut" />
      </label>
      <button onClick={onFilter} aria-label={t('filter')} title={t('filter')}
        className={cx('relative flex size-12 shrink-0 items-center justify-center rounded-2xl shadow-sm transition', filtered ? 'bg-p text-onp' : 'bg-card')}>
        <SlidersHorizontal className="size-5" aria-hidden />
        {filtered && <span className="absolute end-2 top-2 size-2 rounded-full bg-onp" />}
      </button>
    </div>
  );
}

// ---- hero slider (single offers) ---------------------------------------------------------

export function HeroSlider({ offers, t, money, showPrices, onPick }) {
  const ref = useRef(null);
  const [i, setI] = useState(0);
  const cur = useRef(0);
  const paused = useRef(false);
  cur.current = i;

  useEffect(() => {
    const root = ref.current;
    if (!root) return undefined;
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) setI(Number(e.target.dataset.i)); }), { root, threshold: 0.6 });
    root.querySelectorAll('[data-i]').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [offers]);

  const go = (n) => ref.current?.querySelector(`[data-i="${n}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' });

  // Auto-advance while the slider is fully on screen and untouched.
  useEffect(() => {
    if (offers.length < 2) return undefined;
    const id = setInterval(() => {
      const el = ref.current;
      if (!el || paused.current || document.hidden) return;
      const r = el.getBoundingClientRect();
      if (r.top < 0 || r.bottom > window.innerHeight) return;
      go((cur.current + 1) % offers.length);
    }, 5000);
    return () => clearInterval(id);
  }, [offers.length]);
  const holdTimer = useRef(0);
  useEffect(() => () => clearTimeout(holdTimer.current), []);
  const hold = () => { paused.current = true; clearTimeout(holdTimer.current); holdTimer.current = setTimeout(() => { paused.current = false; }, 6000); };

  if (!offers.length) return null;
  return (
    <section className="mt-4" aria-roledescription="carousel" aria-label={t('offers')}>
      <div ref={ref} onPointerDown={hold} onTouchStart={hold} className="no-scrollbar flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth px-4">
        {offers.map((o, n) => (
          <article key={o.id} data-i={n} className="relative aspect-[12/7] w-full shrink-0 snap-start md:w-[calc(50%-0.375rem)] overflow-hidden rounded-[26px] text-white shadow-xl" style={offerShade(o).card}>
            {o.item.image && <img src={o.item.image} alt="" className="absolute inset-0 size-full object-cover" />}
            <div className="relative flex h-full flex-col items-start justify-end gap-1 p-4" style={offerShade(o).shade}>
              {o.badge && <span className="rounded-full bg-p/90 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-onp">{o.badge}</span>}
              <h2 className="line-clamp-2 text-xl font-black leading-tight drop-shadow">{o.item.name}</h2>
              {o.item.description && <p className="line-clamp-1 text-xs leading-relaxed text-white/85 drop-shadow">{o.item.description}</p>}
              <div className="mt-1 flex items-center gap-2">
                <button onClick={() => onPick(o.item)} className="flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-p px-4 text-xs font-bold uppercase text-onp shadow-lg transition active:scale-95">
                  {t('addToCart')}<Arrow />
                </button>
                {showPrices && <PriceTag item={o.item} money={money} className="whitespace-nowrap text-sm font-bold drop-shadow" wasClassName="text-white/70" />}
              </div>
            </div>
          </article>
        ))}
      </div>
      {offers.length > 1 && (
        <div className="mt-2.5 flex justify-center gap-1.5">
          {offers.map((o, n) => (
            <button key={o.id} onClick={() => { hold(); go(n); }} aria-label={`${n + 1}`} aria-current={n === i}
              className={cx('h-1.5 rounded-full transition-all', n === i ? 'w-5 bg-p' : 'w-1.5 bg-mut/40')} />
          ))}
        </div>
      )}
    </section>
  );
}

function Arrow() {
  return document.documentElement.dir === 'rtl' ? <ArrowLeft className="size-4" aria-hidden /> : <ArrowRight className="size-4" aria-hidden />;
}

// ---- categories --------------------------------------------------------------------------

export function CategoryRail({ categories, active, onPick }) {
  if (!categories.length) return null;
  return (
    <nav className="no-scrollbar mt-5 flex snap-x gap-4 overflow-x-auto px-4 pb-1" aria-label="categories">
      {categories.map((c, n) => (
        <button key={c.id} onClick={() => onPick(c.id)} style={{ animationDelay: `${Math.min(n, 8) * 50}ms` }}
          className="anim-rise group flex w-[68px] shrink-0 snap-start flex-col items-center gap-1.5">
          <span className={cx('flex size-[64px] items-center justify-center overflow-hidden rounded-full shadow-md transition duration-300 group-active:scale-90',
            active === c.id ? 'bg-p ring-4 ring-p/25' : 'bg-card')}>
            {c.image
              ? <img src={c.image} alt="" loading="lazy" className="size-full object-cover transition duration-500 group-hover:scale-110" />
              : <span className={cx('text-xl font-bold', active === c.id ? 'text-onp' : 'text-p')}>{c.name.slice(0, 1)}</span>}
          </span>
          <span className={cx('line-clamp-1 text-xs font-semibold', active === c.id && 'text-p')}>{c.name}</span>
        </button>
      ))}
    </nav>
  );
}

// ---- item cards ----------------------------------------------------------------------------

export function ItemCard({ item, badge, t, money, showPrices, canOrder, count, onPick, className }) {
  return (
    <button onClick={() => onPick(item)} className={cx('relative flex flex-col rounded-2xl bg-card p-2 text-start shadow-sm transition active:scale-[.98]', className)}>
      <div className="relative overflow-hidden rounded-xl">
        <Thumb item={item} className="aspect-square w-full transition duration-500 hover:scale-105" />
        {badge && <span className="absolute start-1.5 top-1.5"><Badge kind={badge} t={t} /></span>}
        {count > 0 && <span className="num anim-pop absolute end-1.5 top-1.5 flex size-6 items-center justify-center rounded-full bg-fg text-[11px] font-bold text-bg">{count}</span>}
      </div>
      <h3 className="mt-2 line-clamp-1 px-0.5 text-sm font-bold">{item.name}</h3>
      {item.note
        ? <p className="line-clamp-1 px-0.5 text-[11px] font-semibold text-p">{item.note}</p>
        : item.description && <p className="line-clamp-1 px-0.5 text-[11px] text-mut">{item.description}</p>}
      <div className="mt-auto flex items-center justify-between gap-1 px-0.5 pt-1.5">
        {showPrices ? <PriceTag item={item} money={money} className="font-black" /> : <span />}
        {canOrder && <span className="flex size-7 items-center justify-center rounded-full bg-p text-onp shadow"><Plus className="size-4" aria-hidden /></span>}
      </div>
    </button>
  );
}

export function Popular({ featured, t, money, showPrices, canOrder, inCart, onPick, onAll }) {
  if (!featured.length) return null;
  return (
    <section className="mt-6">
      <SectionTitle title={t('popular')} action={`${t('viewAll')} ${document.documentElement.dir === 'rtl' ? '←' : '→'}`} onAction={onAll} />
      <div className="no-scrollbar flex snap-x gap-3 overflow-x-auto px-4 pb-1">
        {featured.map((f) => (
          <ItemCard key={f.item.id} item={f.item} badge={f.badge} t={t} money={money} showPrices={showPrices} canOrder={canOrder}
            count={inCart[f.item.id]} onPick={onPick} className="w-[42%] shrink-0 snap-start md:w-[calc((100%-1.5rem)/3)] lg:w-[calc((100%-3rem)/5)]" />
        ))}
      </div>
    </section>
  );
}

// ---- family offers (wide banners) -----------------------------------------------------------

export function FamilyBanner({ offer, t, money, showPrices, onPick }) {
  const it = offer.item;
  return (
    <button onClick={() => onPick(it)} className="relative block aspect-[5/2] w-full overflow-hidden rounded-[22px] text-start text-white shadow-lg transition active:scale-[.99]"
      style={{ ...offerShade(offer).card, containerType: 'inline-size', '--sticker-bg': 'var(--p)', '--sticker-fg': 'var(--onp)' }}>
      {it.image && <img src={it.image} alt="" loading="lazy" className="absolute inset-0 size-full object-cover" />}
      <div className="relative flex h-full flex-col justify-end gap-0.5 p-3.5" style={offerShade(offer).shade}>
        {offer.badge && <span className="text-[10px] font-bold uppercase tracking-wider text-white/90 drop-shadow">{offer.badge}</span>}
        <h3 className="line-clamp-1 text-lg font-black leading-tight drop-shadow">{it.name}</h3>
        {it.description && <p className="line-clamp-1 text-[11px] text-white/85 drop-shadow">{it.description}</p>}
        {showPrices && <span className="mt-0.5"><PriceTag item={it} money={money} className="text-sm font-bold drop-shadow" wasClassName="text-white/70" /></span>}
      </div>
      <OfferSticker text={offer.highlight} x={offer.highlight_x} y={offer.highlight_y} size={offer.highlight_size} motion={offer.highlight_motion} />
    </button>
  );
}

export function FamilyOffers({ offers, t, money, showPrices, onPick }) {
  if (!offers.length) return null;
  return (
    <section className="mt-6">
      <SectionTitle title={t('familyOffers')} />
      <div className="grid gap-3 px-4 md:grid-cols-2">
        {offers.map((o) => <FamilyBanner key={o.id} offer={o} t={t} money={money} showPrices={showPrices} onPick={onPick} />)}
      </div>
    </section>
  );
}

// ---- contact ----------------------------------------------------------------------------------

export function Info({ menu, t }) {
  const r = menu.restaurant;
  const links = [
    r.phone && { href: `tel:${r.phone.replace(/[^\d+]/g, '')}`, icon: Phone, label: t('call') },
    r.whatsapp && { href: waLink(r.whatsapp), icon: MessageCircle, label: t('whatsapp') },
    safeHref(r.map_url) && { href: safeHref(r.map_url), icon: MapPin, label: t('directions') },
    r.instagram && { href: social('instagram', r.instagram), icon: LinkIcon, label: 'Instagram' },
    r.facebook && { href: social('facebook', r.facebook), icon: Globe, label: 'Facebook' },
    r.tiktok && { href: social('tiktok', r.tiktok), icon: LinkIcon, label: 'TikTok' },
  ].filter(Boolean);
  return (
    <footer className="mt-8 px-4">
      {(links.length > 0 || r.address) && (
        <div className="rounded-3xl bg-card p-5 shadow-sm">
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
      <p className="py-6 text-center text-xs text-mut">{r.footer ? `${r.footer} · ` : ''}{t('poweredBy')}</p>
    </footer>
  );
}

export function TableChip({ menu, t }) {
  if (!menu.table) return null;
  return (
    <div className="px-4">
      <span className="inline-flex items-center gap-1.5 rounded-full bg-p/15 px-3 py-1 text-xs font-bold text-p">
        <Utensils className="size-3.5" aria-hidden />{t('table')} {menu.table}
      </span>
    </div>
  );
}
