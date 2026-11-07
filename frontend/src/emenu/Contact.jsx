import { useState } from 'react';
import { ArrowLeft, ArrowRight, Clock3, ReceiptText, Utensils } from 'lucide-react';
import { BillSheet } from './Bill';
import { ServicePanel } from './Order';
import { Info } from './Home';
import { PREVIEW, saveContact } from './lib';

// «Contact»: what a guest at a table needs instead of «My details». The
// table comes from its QR code (or is picked once on the hall QR), so there
// is nothing to fill in: they call the staff for a reason, follow their
// order, and reach the restaurant.
export function ContactPage({ menu, t, money, flash, contact, setContact, tracking, order, onStatus, onDone }) {
  const [billOpen, setBillOpen] = useState(false);
  const pickTable = (table) => {
    const next = { ...contact, mode: 'hall', table };
    if (!PREVIEW) saveContact(next);
    setContact(next);
  };
  const table = menu.table || (menu.tables.includes(contact.table) ? contact.table : '');
  const Back = t.dir === 'rtl' ? ArrowLeft : ArrowRight;

  return (
    <div className="pt-[max(1rem,env(safe-area-inset-top))] md:mx-auto md:max-w-2xl md:pt-6">
      <div className="px-4">
        <h1 className="text-2xl font-black">{t('contactTab')}</h1>
        <p className="mt-1 text-sm text-mut">{t('contactSub')}</p>

        {menu.table ? (
          <p className="mt-4 flex items-center gap-2 rounded-2xl bg-card px-4 py-3 font-bold shadow-sm">
            <span className="flex size-9 items-center justify-center rounded-full bg-p/15 text-p"><Utensils className="size-4" aria-hidden /></span>
            {t('youAreAt')} {t('table')} {menu.table}
          </p>
        ) : (
          <label className="mt-4 grid gap-1.5">
            <span className="text-sm font-bold">{t('tableNumber')} *</span>
            <select value={table} onChange={(e) => pickTable(e.target.value)}
              className="h-12 w-full rounded-2xl border border-line bg-card px-4 outline-none focus:border-p">
              <option value="">{t('chooseTable')}</option>
              {menu.tables.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
        )}
        {onDone && table && (
          <button onClick={onDone} className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-p font-bold text-onp shadow-lg">
            {t('backToCart')}<Back className="size-4" aria-hidden />
          </button>
        )}

        {tracking && (
          <button onClick={onStatus} className="mt-3 flex w-full items-center gap-3 rounded-2xl bg-card px-4 py-3 text-start shadow-sm">
            <span className="flex size-9 items-center justify-center rounded-full bg-p/15 text-p"><Clock3 className="size-4" aria-hidden /></span>
            <span className="flex-1 font-bold">{order?.stage === 'ready' ? t('orderReady') : t('yourOrder')}</span>
            <Back className="size-4 text-mut" aria-hidden />
          </button>
        )}

        {menu.table && ( // the hall QR lets anyone pick any table, so only a table's own code shows its bill
          <button onClick={() => setBillOpen(true)} className="mt-3 flex w-full items-center gap-3 rounded-2xl bg-card px-4 py-3 text-start shadow-sm">
            <span className="flex size-9 items-center justify-center rounded-full bg-p/15 text-p"><ReceiptText className="size-4" aria-hidden /></span>
            <span className="flex-1"><span className="block font-bold">{t('yourBill')}</span><span className="block text-xs text-mut">{t('yourBillSub')}</span></span>
            <Back className="size-4 text-mut" aria-hidden />
          </button>
        )}

        {menu.ordering.call_waiter ? (
          <section className="mt-6">
            <h2 className="mb-3 text-lg font-bold">{t('askStaff')}</h2>
            <ServicePanel menu={menu} t={t} flash={flash} contact={contact} table={table} onTable={pickTable}
              onBill={menu.table ? () => setBillOpen(true) : undefined} />
          </section>
        ) : (
          <p className="mt-6 rounded-2xl bg-card2 px-4 py-3 text-sm text-mut">{t('askStaffInPerson')}</p>
        )}
      </div>
      <Info menu={menu} t={t} />
      {billOpen && <BillSheet menu={menu} t={t} money={money} flash={flash} onClose={() => setBillOpen(false)} />}
    </div>
  );
}
