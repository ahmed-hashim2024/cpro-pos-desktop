import { useEffect, useMemo, useState } from 'react';
import { X, SearchX, Tag } from 'lucide-react';
import { cx, Thumb, Stepper, Sheet, SheetHeader, Badge, useLockScroll, useEscape } from './lib';
import { SearchBar, ItemCard, FamilyBanner } from './Home';

// ---- filters ---------------------------------------------------------------------------

export const emptyFilters = { q: '', cat: '', min: '', max: '' };
export const isFiltered = (f) => !!(f.cat || f.min || f.max);

const toMinor = (v) => {
  const n = Number(String(v).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(',', '.'));
  return v === '' || !Number.isFinite(n) || n < 0 ? null : Math.round(n * 100);
};

export function applyFilters(menu, f) {
  const term = f.q.trim().toLowerCase();
  const min = toMinor(f.min);
  const max = toMinor(f.max);
  return menu.categories
    .filter((c) => !f.cat || c.id === f.cat)
    .map((c) => ({
      ...c,
      items: c.items.filter((i) => (!term || `${i.name} ${i.description}`.toLowerCase().includes(term))
        && (min == null || i.price_minor >= min) && (max == null || i.price_minor <= max)),
    }))
    .filter((c) => c.items.length);
}

export function FilterSheet({ menu, t, filters, onApply, onClose }) {
  const [f, setF] = useState(filters);
  return (
    <Sheet onClose={onClose} label={t('filter')}>
      <SheetHeader title={t('filter')} onClose={onClose} t={t} />
      <div className="overflow-y-auto px-5 py-4">
        <h3 className="mb-2 font-bold">{t('category')}</h3>
        <div className="flex flex-wrap gap-2">
          {[{ id: '', name: t('allCats') }, ...menu.categories].map((c) => (
            <button key={c.id} onClick={() => setF({ ...f, cat: c.id })} aria-pressed={f.cat === c.id}
              className={cx('rounded-full px-4 py-2 text-sm font-semibold transition', f.cat === c.id ? 'bg-p text-onp' : 'bg-card2 text-mut')}>{c.name}</button>
          ))}
        </div>
        <h3 className="mb-2 mt-5 font-bold">{t('priceRange')}</h3>
        <div className="flex items-center gap-3">
          {['min', 'max'].map((k) => (
            <label key={k} className="flex h-12 min-w-0 flex-1 items-center gap-2 rounded-2xl border border-line bg-card px-4 focus-within:border-p">
              <span className="shrink-0 text-xs text-mut">{t(k === 'min' ? 'from' : 'to')}</span>
              <input value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} inputMode="decimal" dir="ltr" size={1}
                className="num h-full w-full min-w-0 flex-1 bg-transparent text-start outline-none rtl:text-end" />
            </label>
          ))}
        </div>
      </div>
      <div className="flex gap-3 border-t border-line bg-card px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4">
        <button onClick={() => onApply({ ...emptyFilters, q: f.q })} className="h-12 flex-1 rounded-2xl bg-card2 font-bold">{t('reset')}</button>
        <button onClick={() => onApply(f)} className="h-12 flex-[2] rounded-2xl bg-p font-bold text-onp shadow-lg">{t('apply')}</button>
      </div>
    </Sheet>
  );
}

// ---- full menu ---------------------------------------------------------------------------

export function FullMenu({ menu, t, money, canOrder, inCart, filters, setFilters, onFilter, onPick }) {
  const cats = useMemo(() => applyFilters(menu, filters), [menu, filters]);
  useEffect(() => {
    if (filters.cat) document.getElementById(`c-${filters.cat}`)?.scrollIntoView({ block: 'start' });
  }, [filters.cat]);
  return (
    <div>
      <div className="sticky top-0 z-20 bg-bg/90 pb-2 pt-[max(1rem,env(safe-area-inset-top))] backdrop-blur-md">
        <h1 className="mb-3 px-4 text-2xl font-black">{t('menuTab')}</h1>
        <SearchBar t={t} value={filters.q} onChange={(q) => setFilters({ ...filters, q })} onFilter={onFilter} filtered={isFiltered(filters)} autoFocus={!!filters.q} />
        <div className="no-scrollbar mt-3 flex gap-2 overflow-x-auto px-4">
          {[{ id: '', name: t('allCats') }, ...menu.categories].map((c) => (
            <button key={c.id} onClick={() => setFilters({ ...filters, cat: c.id })}
              className={cx('shrink-0 rounded-full px-4 py-2 text-sm font-semibold transition', filters.cat === c.id ? 'bg-p text-onp shadow' : 'bg-card text-mut shadow-sm')}>{c.name}</button>
          ))}
        </div>
      </div>
      {!cats.length && (
        <div className="flex flex-col items-center gap-2 px-8 py-16 text-center text-mut">
          <SearchX className="size-10" aria-hidden /><p>{t('noResults')}</p>
          <button onClick={() => setFilters(emptyFilters)} className="mt-2 rounded-full bg-card2 px-5 py-2 text-sm font-bold text-fg">{t('reset')}</button>
        </div>
      )}
      {cats.map((c) => (
        <section key={c.id} id={`c-${c.id}`} className="scroll-mt-44 px-4 pt-5">
          <h2 className="mb-3 flex items-center gap-2.5 text-lg font-bold">
            {c.image ? <img src={c.image} alt="" className="size-8 rounded-full object-cover" /> : <span className="h-5 w-1.5 rounded-full bg-p" />}{c.name}
          </h2>
          <div className="grid grid-cols-2 gap-3">
            {c.items.map((i) => (
              <ItemCard key={i.id} item={i} t={t} money={money} showPrices={menu.show_prices} canOrder={canOrder} count={inCart[i.id]} onPick={onPick} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

// ---- offers page -------------------------------------------------------------------------

export function OffersPage({ menu, t, money, onPick }) {
  const single = menu.offers.filter((o) => o.kind === 'single');
  const family = menu.offers.filter((o) => o.kind === 'family');
  return (
    <div className="pt-[max(1rem,env(safe-area-inset-top))]">
      <h1 className="mb-4 px-4 text-2xl font-black">{t('offers')}</h1>
      {!menu.offers.length && (
        <div className="flex flex-col items-center gap-2 px-8 py-16 text-center text-mut"><Tag className="size-10" aria-hidden /><p>{t('noOffers')}</p></div>
      )}
      <div className="grid gap-3 px-4">
        {single.map((o) => (
          <button key={o.id} onClick={() => onPick(o.item)} className="flex gap-3 rounded-3xl bg-card p-2.5 text-start shadow-sm transition active:scale-[.99]">
            <Thumb item={o.item} className="size-24 shrink-0 rounded-2xl" />
            <div className="flex min-w-0 flex-1 flex-col justify-center gap-1 py-1">
              {o.badge && <span className="w-fit rounded-full bg-p/15 px-2 py-0.5 text-[10px] font-bold text-p">{o.badge}</span>}
              <h3 className="line-clamp-1 font-bold">{o.item.name}</h3>
              {o.item.description && <p className="line-clamp-2 text-xs text-mut">{o.item.description}</p>}
              {menu.show_prices && <span className="num font-black">{money(o.item.price_minor)}</span>}
            </div>
          </button>
        ))}
        {family.length > 0 && single.length > 0 && <h2 className="mt-3 text-lg font-bold">{t('familyOffers')}</h2>}
        {family.map((o) => <FamilyBanner key={o.id} offer={o} t={t} money={money} showPrices={menu.show_prices} onPick={onPick} />)}
      </div>
    </div>
  );
}

// ---- item popup ----------------------------------------------------------------------------

function groupHint(g, t) {
  if (g.max === 1) return g.min ? t('chooseOne') : t('optional');
  if (g.min && g.max) return `${t('chooseAtLeast', [g.min])} · ${t('chooseUpTo', [g.max])}`;
  if (g.min) return t('chooseAtLeast', [g.min]);
  if (g.max) return t('chooseUpTo', [g.max]);
  return t('optional');
}

// A centred alert-style card: picture, name, description, price, options,
// quantity and "add to cart".
export function ItemModal({ item, badge, t, money, canOrder, showPrices, onClose, onAdd }) {
  useLockScroll();
  useEscape(onClose);
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
  const add = () => onAdd({ key: `${item.id}|${mods.map((m) => m.id).sort().join(',')}|${notes.trim()}`, item, qty, notes: notes.trim(), mods });

  return (
    <div className="anim-fade fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-[3px]" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={item.name} onClick={(e) => e.stopPropagation()}
        className="anim-swal flex max-h-[88dvh] w-full max-w-sm flex-col overflow-hidden rounded-[28px] bg-bg shadow-2xl">
        <div className="overflow-y-auto">
          <div className="relative">
            <Thumb item={item} className="aspect-[4/3] w-full" />
            <button onClick={onClose} aria-label={t('close')} className="absolute end-3 top-3 flex size-9 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur"><X className="size-5" /></button>
            {badge && <span className="absolute start-3 top-3"><Badge kind={badge} t={t} /></span>}
          </div>
          <div className="px-5 pt-4 text-center">
            <h2 className="text-xl font-black leading-tight">{item.name}</h2>
            {item.description && <p className="mt-2 text-sm leading-relaxed text-mut">{item.description}</p>}
            {showPrices && <p className="num mt-2 text-2xl font-black text-p">{money(item.price_minor)}</p>}
          </div>
          {item.groups.map((g) => (
            <fieldset key={g.id} className="mx-5 mt-4 border-t border-line pt-3">
              <legend className="sr-only">{g.name}</legend>
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <h3 className="text-sm font-bold">{g.name}</h3>
                <span className={cx('rounded-full px-2 py-0.5 text-[11px] font-semibold', g.min ? 'bg-p/15 text-p' : 'bg-card2 text-mut')}>
                  {g.min ? `${t('required')} · ` : ''}{groupHint(g, t)}
                </span>
              </div>
              <div className="grid gap-1.5">
                {g.modifiers.map((m) => {
                  const on = (picked[g.id] || []).some((x) => x.id === m.id);
                  return (
                    <button key={m.id} type="button" disabled={!canOrder} onClick={() => toggle(g, { id: m.id, name: m.name, price_minor: m.price_minor })} aria-pressed={on}
                      className={cx('flex min-h-11 items-center gap-3 rounded-2xl border px-3.5 text-start text-sm transition', on ? 'border-p bg-p/10' : 'border-line bg-card')}>
                      <span className={cx('flex size-5 shrink-0 items-center justify-center border-2', g.max === 1 ? 'rounded-full' : 'rounded-md', on ? 'border-p bg-p' : 'border-mut/50')}>
                        {on && <span className={cx('bg-onp', g.max === 1 ? 'size-2 rounded-full' : 'size-2.5 rounded-sm')} />}
                      </span>
                      <span className="flex-1">{m.name}</span>
                      {showPrices && m.price_minor > 0 && <span className="num text-xs text-mut">+{money(m.price_minor)}</span>}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          ))}
          {canOrder && (
            <div className="mx-5 mt-4">
              <input value={notes} maxLength={120} onChange={(e) => setNotes(e.target.value)} placeholder={t('notesPh')} aria-label={t('notes')}
                className="h-11 w-full rounded-2xl border border-line bg-card px-4 text-sm outline-none focus:border-p" />
            </div>
          )}
          <div className="h-4" />
        </div>
        {canOrder ? (
          <div className="flex items-center gap-3 border-t border-line bg-card px-4 py-3.5">
            <Stepper value={qty} onChange={setQty} t={t} small />
            <button onClick={add} disabled={!valid}
              className="flex h-12 flex-1 items-center justify-between gap-2 rounded-2xl bg-p px-4 font-bold text-onp shadow-lg transition active:scale-[.98] disabled:opacity-40">
              <span>{t('addToCart')}</span>{showPrices && <span className="num">{money(unit * qty)}</span>}
            </button>
          </div>
        ) : (
          <div className="border-t border-line bg-card px-4 py-3.5">
            <button onClick={onClose} className="h-12 w-full rounded-2xl bg-p font-bold text-onp">{t('close')}</button>
          </div>
        )}
      </div>
    </div>
  );
}
