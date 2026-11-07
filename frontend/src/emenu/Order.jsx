import { useEffect, useRef, useState } from 'react';
import { Trash2, Loader2, Utensils, Clock3, CheckCircle2, XCircle, Bell, BellRing, Receipt, ShoppingCart, Bike, ConciergeBell, TriangleAlert, ChefHat, Heart, NotebookPen, GlassWater, Hourglass, MessageSquareMore, Banknote, CreditCard } from 'lucide-react';
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
    <form onSubmit={submit} className="px-4 pt-[max(1rem,env(safe-area-inset-top))] md:mx-auto md:max-w-2xl md:pt-6">
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
          {!(mode === 'hall' && menu.table) && ( // a table QR leaves nothing to edit
            <button type="button" onClick={onDetails} className="shrink-0 text-sm font-bold text-p">{ready ? t('edit') : t('addDetails')}</button>
          )}
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

export const orderFinished = (o) => o.status === 'rejected' || o.status === 'expired' || o.stage === 'closed';

// Follows the guest's order while the page is open, so the bell can change
// with the sheet closed. onChange(order, previous) runs on each reply; order
// is null when the server no longer knows it.
export function useOrderTracker(token, onChange) {
  const [order, setOrder] = useState(null);
  const notify = useRef(onChange);
  notify.current = onChange;
  useEffect(() => {
    setOrder(null);
    if (!token) return undefined;
    let timer;
    let stop = false;
    let prev = null;
    const poll = async () => {
      if (document.hidden) { timer = setTimeout(poll, 5000); return; }
      try {
        const r = await menuApi.status(token);
        if (stop) return;
        setOrder(r);
        notify.current(r, prev);
        prev = r;
        if (!orderFinished(r)) timer = setTimeout(poll, r.status === 'pending' ? 4000 : r.stage === 'ready' ? 15000 : 6000);
      } catch (e) {
        if (stop) return;
        if (e.status === 404) notify.current(null, prev);
        else timer = setTimeout(poll, 6000);
      }
    };
    poll();
    return () => { stop = true; clearTimeout(timer); };
  }, [token]);
  return order;
}

function orderView(o, t) {
  const eta = o.eta_minutes > 0 ? t('etaSub', [t.num(o.eta_minutes)]) : t('etaNone');
  if (o.status === 'pending') return { icon: CheckCircle2, tone: 'text-p bg-p/15', title: t('orderPlaced'), sub: eta };
  if (o.status === 'rejected') return { icon: XCircle, tone: 'text-red-500 bg-red-500/15', title: t('rejected'), sub: o.reject_reason };
  if (o.status === 'expired') return { icon: Clock3, tone: 'text-mut bg-card2', title: t('expired'), sub: t('expiredSub') };
  if (o.stage === 'ready') return { icon: BellRing, tone: 'text-emerald-500 bg-emerald-500/15', title: t('orderReady'), sub: t(o.type === 'delivery' ? 'readyDelivery' : 'readyHall'), ring: true };
  if (o.stage === 'closed') return { icon: Heart, tone: 'text-p bg-p/15', title: t('orderDone'), sub: t('orderDoneSub') };
  return { icon: ChefHat, tone: 'text-p bg-p/15', title: t('accepted'), sub: `${t('acceptedSub', [t.num(o.order_number)])} · ${eta}` };
}

export function StatusSheet({ order: o, tracking, t, money, onClose, onDone }) {
  if (!o) {
    return (
      <Sheet onClose={onClose} label={t('notifications')}>
        <SheetHeader title={t('notifications')} onClose={onClose} t={t} />
        <div className="flex flex-col items-center gap-2 px-8 py-12 text-center text-mut">
          {tracking ? <Loader2 className="size-8 animate-spin" aria-hidden /> : (
            <>
              <Bell className="size-10" aria-hidden />
              <p className="font-bold text-fg">{t('noNotifications')}</p>
              <p className="text-sm">{t('noNotificationsSub')}</p>
            </>
          )}
        </div>
      </Sheet>
    );
  }
  const view = orderView(o, t);
  const Icon = view.icon;
  // While the order is being made the button only closes the sheet: the bell
  // must keep following it until it's ready.
  const finished = orderFinished(o) || o.stage === 'ready';
  return (
    <Sheet onClose={onClose} label={t('yourOrder')}>
      <SheetHeader title={t('yourOrder')} onClose={onClose} t={t} />
      <div className="overflow-y-auto px-5 py-6">
        <div className="flex flex-col items-center text-center">
          <span className={cx('anim-pop relative flex size-20 items-center justify-center rounded-full', view.tone)}>
            {view.ring && <span className="absolute inset-0 animate-ping rounded-full bg-current opacity-20 motion-reduce:hidden" />}
            <Icon className="size-10" aria-hidden />
          </span>
          <h2 className="mt-4 text-xl font-bold">{view.title}</h2>
          {view.sub && <p className="mt-1 text-mut">{view.sub}</p>}
        </div>
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
      </div>
      {o.status !== 'pending' && (
        <div className="border-t border-line bg-card px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4">
          <button onClick={finished ? onDone : onClose} className="w-full rounded-2xl bg-p py-4 font-bold text-onp">{o.status === 'accepted' ? t('backToMenu') : t('newOrder')}</button>
        </div>
      )}
    </Sheet>
  );
}

// ---- calling the staff from the table (table and hall QR) ----------------------------------

// The reasons a table calls the staff. Some send at a tap; the others open a
// short step first (how they'll pay, what they need, what went wrong).
// The kinds and codes match the server (app/emenu.go serviceKinds).
const REASONS = [
  { kind: 'waiter', icon: BellRing, label: 'callWaiter', sent: 'waiterComing' },
  { kind: 'order', icon: NotebookPen, label: 'readyToOrder', sent: 'orderComing' },
  { kind: 'bill', icon: Receipt, label: 'askBill', sent: 'billComing', step: true },
  { kind: 'extras', icon: GlassWater, label: 'needExtras', sent: 'extrasComing', step: true },
  { kind: 'late', icon: Hourglass, label: 'orderLate', sent: 'lateSent' },
  { kind: 'issue', icon: TriangleAlert, label: 'foodIssue', sent: 'issueSent', step: true },
  { kind: 'other', icon: MessageSquareMore, label: 'otherRequest', sent: 'otherSent', step: true, wide: true },
];
const EXTRAS = ['water', 'napkins', 'cutlery', 'ice', 'plates', 'clean'];

// Floating «Need help?» button: the same panel as the Contact tab, in a sheet.
export function ServiceButton({ menu, t, flash, contact, onTable }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}
        className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] end-[max(1rem,calc(50%-14rem+1rem))] md:end-[max(1rem,calc(50%-24rem+1rem))] lg:end-[max(1rem,calc(50%-36rem+1rem))] z-30 flex h-11 items-center gap-2 rounded-full bg-fg px-4 text-sm font-bold text-bg shadow-xl transition active:opacity-70">
        <ConciergeBell className="size-5" aria-hidden />{t('needHelp')}
      </button>
      {open && (
        <Sheet onClose={() => setOpen(false)} label={t('needHelp')}>
          <SheetHeader title={t('needHelp')} onClose={() => setOpen(false)} t={t} />
          <div className="overflow-y-auto px-5 py-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
            <ServicePanel menu={menu} t={t} flash={flash} contact={contact} onTable={onTable} onSent={() => setOpen(false)} />
          </div>
        </Sheet>
      )}
    </>
  );
}

// The reasons as tiles. onSent runs after a call reaches the restaurant. On
// the hall QR the guest picks the table here, unless the page passes it in.
export function ServicePanel({ menu, t, flash, contact, onTable, onSent, onBill, table: given }) {
  const [own, setTable] = useState(() => (menu.tables?.includes(contact.table) ? contact.table : ''));
  const table = given ?? own;
  const [step, setStep] = useState(''); // the reason whose extra step is open
  const [picks, setPicks] = useState([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [sent, setSent] = useState({}); // kind → true, to mark the tile

  const open = (r) => {
    setErr('');
    if (!r.step) { send(r.kind); return; }
    setStep(step === r.kind ? '' : r.kind);
    setPicks([]);
    setNote('');
  };
  const send = async (kind, details = [], text = '') => {
    if (menu.preview) { flash(t('previewOnly')); return; }
    if (!menu.table && !table) { setErr(t('chooseTable')); return; }
    setBusy(kind);
    setErr('');
    try {
      await menuApi.call({ table: tableToken, table_number: menu.table ? '' : table, kind, details, note: text.trim() });
      if (!menu.table) onTable(table);
      flash(t(REASONS.find((r) => r.kind === kind).sent));
      navigator.vibrate?.(60);
      setSent((s) => ({ ...s, [kind]: true }));
      setStep('');
      onSent?.();
    } catch (ex) {
      setErr(ex.status === 0 ? t('error') : ex.message);
    } finally {
      setBusy('');
    }
  };
  const toggle = (code) => setPicks((p) => (p.includes(code) ? p.filter((c) => c !== code) : [...p, code]));
  const field = 'w-full rounded-2xl border border-line bg-card px-4 py-3 outline-none focus:border-p';
  const primary = 'flex h-12 items-center justify-center gap-2 rounded-2xl bg-p font-bold text-onp shadow-lg transition active:scale-[.98] disabled:opacity-40';

  return (
    <div className="grid gap-3">
      {!menu.table && given === undefined && (
        <label className="grid gap-1.5">
          <span className="text-sm font-bold">{t('tableNumber')} *</span>
          <select value={table} onChange={(e) => { setTable(e.target.value); setErr(''); }} className={`h-12 ${field} py-0`}>
            <option value="">{t('chooseTable')}</option>
            {menu.tables.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
      )}
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3">
        {REASONS.map((r) => (
          <button key={r.kind} onClick={() => open(r)} disabled={!!busy} aria-expanded={r.step ? step === r.kind : undefined}
            className={cx('relative flex rounded-2xl bg-card p-3 text-start text-sm font-bold shadow-sm ring-2 transition active:scale-[.97] disabled:opacity-50',
              step === r.kind ? 'ring-p' : 'ring-transparent',
              r.wide ? 'col-span-2 md:col-span-3 min-h-14 flex-row items-center gap-3' : 'min-h-[4.5rem] flex-col items-start justify-center gap-1.5')}>
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-p/15 text-p">
              {busy === r.kind ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <r.icon className="size-5" aria-hidden />}
            </span>
            {t(r.label)}
            {sent[r.kind] && <CheckCircle2 className="absolute end-2.5 top-2.5 size-4 text-emerald-500" aria-label={t('sentMark')} />}
          </button>
        ))}
      </div>

      {step === 'bill' && (
        <div className="anim-fade grid gap-2 rounded-2xl bg-card p-4 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-bold">{t('payHow')}</p>
            {onBill && <button type="button" onClick={onBill} className="text-sm font-bold text-p">{t('seeBill')}</button>}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {[['cash', Banknote, 'payCash'], ['card', CreditCard, 'payCard']].map(([code, Icon, label]) => (
              <button key={code} onClick={() => send('bill', [code])} disabled={!!busy}
                className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-p font-bold text-onp shadow transition active:scale-[.98] disabled:opacity-40">
                <Icon className="size-5" aria-hidden />{t(label)}
              </button>
            ))}
          </div>
        </div>
      )}
      {step === 'extras' && (
        <div className="anim-fade grid gap-3 rounded-2xl bg-card p-4 shadow-sm">
          <p className="text-sm font-bold">{t('extrasWhat')}</p>
          <div className="flex flex-wrap gap-2">
            {EXTRAS.map((code) => (
              <button key={code} type="button" onClick={() => toggle(code)} aria-pressed={picks.includes(code)}
                className={cx('rounded-full border px-3.5 py-2 text-sm font-semibold transition', picks.includes(code) ? 'border-p bg-p text-onp' : 'border-line bg-card2')}>
                {t(`extra_${code}`)}
              </button>
            ))}
          </div>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('extrasPh')} maxLength={200} className={field} aria-label={t('extrasPh')} />
          <button onClick={() => send('extras', picks, note)} disabled={!!busy || (!picks.length && !note.trim())} className={primary}>{t('sendIssue')}</button>
        </div>
      )}
      {(step === 'issue' || step === 'other') && (
        <div className="anim-fade grid gap-2">
          <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder={t(step === 'issue' ? 'issuePh' : 'otherPh')}
            aria-label={t(step === 'issue' ? 'foodIssue' : 'otherRequest')} maxLength={200} rows={2} autoFocus className={field} />
          <button onClick={() => send(step, [], note)} disabled={!!busy || (step === 'other' && !note.trim())} className={primary}>{t('sendIssue')}</button>
        </div>
      )}
      {err && <p role="alert" className="rounded-2xl bg-red-500/15 px-4 py-3 text-sm font-semibold text-red-500">{err}</p>}
    </div>
  );
}
