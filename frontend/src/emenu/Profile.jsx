import { useState } from 'react';
import { Armchair, Bike, Check, Utensils } from 'lucide-react';
import { cx, orderModes, effectiveMode, contactReady, saveContact } from './lib';

// «My details»: in the hall (table number) or delivery (name, phone,
// address). Kept on this phone only and sent with each order.
export function ProfilePage({ menu, t, contact, setContact, flash, onDone }) {
  const [c, setC] = useState(() => ({ ...contact, mode: effectiveMode(menu, contact) }));
  const modes = orderModes(menu);
  const set = (k) => (e) => setC({ ...c, [k]: e.target.value });
  const ready = contactReady(menu, c);
  const save = (e) => {
    e.preventDefault();
    if (!ready) return;
    const next = { ...c, name: c.name.trim(), phone: c.phone.trim(), address: c.address.trim(), table: c.table.trim() };
    saveContact(next);
    setContact(next);
    flash(t('detailsSaved'));
    onDone?.();
  };
  const field = 'h-12 w-full rounded-2xl border border-line bg-card px-4 outline-none focus:border-p';

  if (!modes.length) {
    return (
      <div className="px-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <h1 className="text-2xl font-black">{t('myDetails')}</h1>
        <p className="mt-4 rounded-2xl bg-card2 px-4 py-3 text-sm text-mut">{t('browseOnly')}</p>
      </div>
    );
  }

  return (
    <form onSubmit={save} className="px-4 pt-[max(1rem,env(safe-area-inset-top))]">
      <h1 className="text-2xl font-black">{t('myDetails')}</h1>
      <p className="mt-1 text-sm text-mut">{t('detailsSub')}</p>

      {modes.length > 1 && (
        <div className="mt-4 grid grid-cols-2 gap-2 rounded-2xl bg-card p-1.5 shadow-sm" role="radiogroup" aria-label={t('myDetails')}>
          {[['hall', Armchair, t('inHall')], ['delivery', Bike, t('delivery')]].map(([k, Icon, label]) => (
            <button key={k} type="button" role="radio" aria-checked={c.mode === k} onClick={() => setC({ ...c, mode: k })}
              className={cx('flex h-11 items-center justify-center gap-2 rounded-xl text-sm font-bold transition', c.mode === k ? 'bg-p text-onp shadow' : 'text-mut')}>
              <Icon className="size-4" aria-hidden />{label}
            </button>
          ))}
        </div>
      )}

      <div className="mt-4 grid gap-3 rounded-3xl bg-card p-5 shadow-sm">
        {c.mode === 'hall' && (menu.table ? (
          <p className="flex items-center gap-2 font-bold"><Utensils className="size-4 text-p" aria-hidden />{t('table')} {menu.table}</p>
        ) : (
          <label className="grid gap-1.5">
            <span className="text-sm font-bold">{t('tableNumber')} *</span>
            <select required value={menu.tables.includes(c.table) ? c.table : ''} onChange={set('table')} className={field}>
              <option value="">{t('chooseTable')}</option>
              {menu.tables.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
        ))}
        <label className="grid gap-1.5">
          <span className="text-sm font-bold">{t('name')}{c.mode === 'delivery' && ' *'}</span>
          <input required={c.mode === 'delivery'} value={c.name} onChange={set('name')} autoComplete="name" maxLength={60} className={field} />
        </label>
        <label className="grid gap-1.5">
          <span className="text-sm font-bold">{t('phone')}{c.mode === 'delivery' && ' *'}</span>
          <input required={c.mode === 'delivery'} value={c.phone} onChange={set('phone')} type="tel" inputMode="tel" autoComplete="tel" dir="ltr" maxLength={20}
            className={`${field} num text-start rtl:text-end`} />
        </label>
        {c.mode === 'delivery' && (
          <label className="grid gap-1.5">
            <span className="text-sm font-bold">{t('address')} *</span>
            <textarea required value={c.address} onChange={set('address')} placeholder={t('addressPh')} autoComplete="street-address" maxLength={200} rows={3}
              className="w-full rounded-2xl border border-line bg-card px-4 py-3 outline-none focus:border-p" />
          </label>
        )}
        <button disabled={!ready} className="mt-1 flex h-12 items-center justify-center gap-2 rounded-2xl bg-p font-bold text-onp shadow-lg transition active:scale-[.98] disabled:opacity-40">
          <Check className="size-5" aria-hidden />{t('save')}
        </button>
      </div>
      <p className="mt-3 px-2 text-xs leading-relaxed text-mut">{t('detailsNote')}</p>
    </form>
  );
}
