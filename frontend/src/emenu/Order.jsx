import { useEffect, useState } from 'react';
import { Trash2, Loader2, Utensils, Clock3, CheckCircle2, XCircle, BellRing, Receipt, ShoppingCart, Bike } from 'lucide-react';
import { menuApi } from './api';
import { cx, Thumb, Stepper, Sheet, SheetHeader, lineTotal, tableToken, effectiveMode, contactReady } from './lib';

// ---- cart ------------------------------------------------------------------------

export function CartPage({ menu, t, money, cart, setCart, contact, onPlaced, onBrowse, onDetails, flash }) {
  const mode = effectiveMode(menu, contact);
  const ready = contactReady(menu, contact);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const subtotal = cart.reduce((s, l) => s + lineTotal(l), 0);
  const fee = mode === 'delivery' ? menu.ordering.delivery_fee_minor || 0 : 0;
  const setQty = (l, q) => setCart((c) => c.map((x) => (x === l ? { ...x, qty: q } : x)));
  const remove = (l) => setCart((c) => c.filter((x) => x !== l));

  const submit = async (e) => {
    e.preventDefault();
    if (!ready) { onDetails(); return; }
    if (menu.preview) { flash(t('previewOnly')); return; }
    setBusy(true);
    setErr('');
    try {
      const r = await menuApi.order({
        type: mode === 'hall' ? 'dine_in' : 'delivery',
        table_token: mode === 'hall' && menu.table ? tableToken : '',
        table_number: mode === 'hall' && !menu.table ? contact.table : '',
        customer_name: contact.name, phone: contact.phone, address: mode === 'delivery' ? contact.address : '', notes: notes.trim(),
        lines: cart.map((l) => ({ item_id: l.item.id, qty: l.qty, modifier_ids: l.mods.map((m) => m.id), notes: l.notes })),
      });
      onPlaced(r.token);
    } catch (ex) {
      setErr(ex.status === 0 ? t('error') : ex.message);
    } finally {
      setBusy(false);
    }
  };

  if (!cart.length) {
    return (
      <div className="flex min-h-[70dvh] flex-col items-center justify-center gap-3 px-8 text-center">
        <span className="flex size-20 items-center justify-center rounded-full bg-card text-p shadow-sm"><ShoppingCart className="size-9" aria-hidden /></span>
        <h1 className="text-xl font-bold">{t('cartEmpty')}</h1>
        <p className="text-mut">{t('cartEmptySub')}</p>
        <button onClick={onBrowse} className="mt-2 rounded-full bg-p px-6 py-3 font-bold text-onp shadow-lg">{t('browseMenu')}</button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="px-4 pt-[max(1rem,env(safe-area-inset-top))]">
      <h1 className="mb-3 text-2xl font-black">{t('cart')}</h1>
      <ul className="grid gap-2.5">
        {cart.map((l) => (
          <li key={l.key} className="flex gap-3 rounded-2xl bg-card p-2.5 shadow-sm">
            <Thumb item={l.item} className="size-[72px] shrink-0 rounded-xl" />
            <div className="min-w-0 flex-1">
              <div className="flex items-start gap-2">
                <h3 className="flex-1 text-sm font-bold leading-snug">{l.item.name}</h3>
                <button type="button" onClick={() => remove(l)} aria-label={t('remove')} className="text-mut"><Trash2 className="size-4" /></button>
              </div>
              {l.mods.length > 0 && <p className="text-xs text-mut">+ {l.mods.map((m) => m.name).join('، ')}</p>}
              {l.notes && <p className="text-xs text-p">{l.notes}</p>}
              <div className="mt-1.5 flex items-center justify-between">
                <Stepper small value={l.qty} onChange={(q) => setQty(l, q)} t={t} />
                {menu.show_prices && <span className="num text-sm font-black">{money(lineTotal(l))}</span>}
              </div>
            </div>
          </li>
        ))}
      </ul>

      {!mode ? (
        <p className="mt-4 flex items-center gap-2 rounded-2xl bg-card2 px-4 py-3 text-sm text-mut"><BellRing className="size-4 text-p" aria-hidden />{t('browseOnly')}</p>
      ) : (
        <div className="mt-4 flex items-start gap-3 rounded-2xl bg-card p-4 shadow-sm">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-p/15 text-p">
            {mode === 'hall' ? <Utensils className="size-5" aria-hidden /> : <Bike className="size-5" aria-hidden />}
          </span>
          <div className="min-w-0 flex-1 text-sm">
            {ready ? (
              <>
                <div className="font-bold">{mode === 'hall' ? `${t('inHall')} · ${t('table')} ${menu.table || contact.table}` : t('deliverTo')}</div>
                {(contact.name || contact.phone) && (
                  <div className="text-mut">{contact.name}{contact.name && contact.phone && ' · '}{contact.phone && <bdi className="num" dir="ltr">{contact.phone}</bdi>}</div>
                )}
                {mode === 'delivery' && <div className="line-clamp-2 text-mut">{contact.address}</div>}
              </>
            ) : <div className="font-bold">{mode === 'hall' ? t('needTable') : t('needAddress')}</div>}
          </div>
          <button type="button" onClick={onDetails} className="shrink-0 text-sm font-bold text-p">{ready ? t('edit') : t('addDetails')}</button>
        </div>
      )}
      {mode && (
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('orderNotesPh')} maxLength={300} rows={2}
          className="mt-3 w-full rounded-2xl border border-line bg-card px-4 py-3 outline-none focus:border-p" />
      )}
      {menu.ordering.note && <p className="mt-2 rounded-2xl bg-card2 px-4 py-3 text-sm text-mut">{menu.ordering.note}</p>}
      {err && <p role="alert" className="mt-3 rounded-2xl bg-red-500/15 px-4 py-3 text-sm font-semibold text-red-500">{err}</p>}

      {mode && (
        <div className="sticky bottom-20 mt-4 rounded-3xl bg-card p-4 shadow-xl">
          {menu.show_prices && (
            <div className="mb-3 grid gap-1">
              {fee > 0 && (
                <>
                  <div className="flex justify-between text-sm text-mut"><span>{t('subtotal')}</span><span className="num">{money(subtotal)}</span></div>
                  <div className="flex justify-between text-sm text-mut"><span>{t('deliveryFee')}</span><span className="num">{money(fee)}</span></div>
                </>
              )}
              <div className="flex items-baseline justify-between">
                <span className="text-sm text-mut">{t('estTotal')}</span>
                <span className="num text-xl font-black">{money(subtotal + fee)}</span>
              </div>
            </div>
          )}
          <button disabled={busy}
            className="flex h-13 w-full items-center justify-center gap-2 rounded-2xl bg-p py-3.5 text-lg font-bold text-onp shadow-lg transition active:scale-[.98] disabled:opacity-40">
            {busy && <Loader2 className="size-5 animate-spin" aria-hidden />}{ready ? t('confirmOrder') : t('addDetails')}
          </button>
        </div>
      )}
    </form>
  );
}

// ---- order status ---------------------------------------------------------------------

export function StatusSheet({ token, t, money, onClose, onDone }) {
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
    rejected: { icon: XCircle, tone: 'text-red-500 bg-red-500/15', title: t('rejected'), sub: o?.reject_reason },
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

// ---- waiter / bill (table QR only) ----------------------------------------------------------

export function ServiceButtons({ t, flash, preview }) {
  const [busy, setBusy] = useState('');
  const call = async (kind) => {
    if (preview) { flash(t('previewOnly')); return; }
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
    <div className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] end-[max(1rem,calc(50%-14rem+1rem))] z-30 flex items-center overflow-hidden rounded-full bg-fg text-bg shadow-xl">
      <button onClick={() => call('waiter')} disabled={!!busy} className="flex h-11 items-center gap-2 ps-4 pe-3 text-sm font-bold transition active:opacity-70">
        {busy === 'waiter' ? <Loader2 className="size-5 animate-spin" /> : <BellRing className="size-5" aria-hidden />}{t('callWaiter')}
      </button>
      <span className="h-6 w-px bg-bg/30" aria-hidden />
      <button onClick={() => call('bill')} disabled={!!busy} aria-label={t('askBill')} title={t('askBill')} className="flex h-11 items-center justify-center ps-3 pe-4 transition active:opacity-70">
        {busy === 'bill' ? <Loader2 className="size-5 animate-spin" /> : <Receipt className="size-5" aria-hidden />}
      </button>
    </div>
  );
}

