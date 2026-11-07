import { useCallback, useEffect, useState } from 'react';
import { Banknote, CreditCard, Loader2, ReceiptText, RefreshCw } from 'lucide-react';
import { menuApi } from './api';
import { Sheet, SheetHeader, tableToken } from './lib';

// The table's bill as the restaurant has it: what was served, service, tax
// and what's left to pay. Only behind the table's own QR code. From here the
// guest asks for the bill and says how they'll pay.
export function BillSheet({ menu, t, money, flash, onClose }) {
  const [bill, setBill] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    setErr('');
    if (menu.preview) { setBill({ table: menu.table || '', lines: [], total_minor: 0, due_minor: 0 }); return; }
    try {
      setBill(await menuApi.bill(tableToken));
    } catch (ex) {
      setErr(ex.status === 0 ? t('error') : ex.message);
    }
  }, [menu, t]);
  useEffect(() => { load(); }, [load]);

  const ask = async (pay) => {
    if (menu.preview) { flash(t('previewOnly')); return; }
    setBusy(pay);
    try {
      await menuApi.call({ table: tableToken, kind: 'bill', details: [pay] });
      flash(t('billComing'));
      navigator.vibrate?.(60);
      onClose();
    } catch (ex) {
      setErr(ex.status === 0 ? t('error') : ex.message);
    } finally {
      setBusy('');
    }
  };

  const row = (label, minor, cls = 'text-mut') => minor > 0 && (
    <div className={`flex justify-between text-sm ${cls}`}><span>{label}</span><span className="num">{money(minor)}</span></div>
  );
  const qty = (milli) => t.num(milli / 1000);

  return (
    <Sheet onClose={onClose} label={t('yourBill')}>
      <SheetHeader title={t('yourBill')} onClose={onClose} t={t} />
      <div className="overflow-y-auto px-5 py-4">
        {!bill && !err && <div className="flex justify-center py-12"><Loader2 className="size-8 animate-spin text-mut" aria-hidden /></div>}
        {err && <p role="alert" className="rounded-2xl bg-red-500/15 px-4 py-3 text-sm font-semibold text-red-500">{err}</p>}
        {bill && !bill.lines.length && (
          <div className="flex flex-col items-center gap-2 py-10 text-center text-mut">
            <ReceiptText className="size-10" aria-hidden />
            <p className="font-bold text-fg">{t('billEmpty')}</p>
            <p className="text-sm">{t('billEmptySub')}</p>
          </div>
        )}
        {bill?.lines.length > 0 && (
          <>
            <ul className="divide-y divide-line rounded-3xl border border-line bg-card px-4">
              {bill.lines.map((l, i) => (
                <li key={i} className="flex gap-2 py-3 text-sm">
                  <span className="num font-bold text-p">{qty(l.qty_milli)}×</span>
                  <span className="flex-1">{l.name}{l.modifiers.length > 0 && <span className="block text-xs text-mut">+ {l.modifiers.join('، ')}</span>}</span>
                  <span className="num">{money(l.total_minor)}</span>
                </li>
              ))}
            </ul>
            <div className="mt-4 grid gap-1.5 rounded-3xl bg-card p-4 shadow-sm">
              {row(t('subtotal'), bill.subtotal_minor)}
              {bill.discounts_minor > 0 && (
                <div className="flex justify-between text-sm text-emerald-600"><span>{t('discount')}</span><span className="num" dir="ltr">− {money(bill.discounts_minor)}</span></div>
              )}
              {row(t('serviceCharge'), bill.service_minor)}
              {row(t('tax'), bill.tax_minor)}
              {row(t('total'), bill.total_minor, 'font-bold')}
              {row(t('paidAlready'), bill.paid_minor)}
              <div className="mt-1 flex items-baseline justify-between border-t border-line pt-2">
                <span className="font-bold">{t('amountDue')}</span>
                <span className="num text-2xl font-black text-p">{money(bill.due_minor)}</span>
              </div>
            </div>
            <button onClick={load} className="mx-auto mt-3 flex items-center gap-1.5 text-sm font-semibold text-mut">
              <RefreshCw className="size-4" aria-hidden />{t('refresh')}
            </button>
          </>
        )}
      </div>
      {bill?.lines.length > 0 && menu.ordering.call_waiter && (
        <div className="border-t border-line bg-card px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4">
          <p className="mb-2 text-sm font-bold">{t('askBillHow')}</p>
          <div className="grid grid-cols-2 gap-2">
            {[['cash', Banknote, 'payCash'], ['card', CreditCard, 'payCard']].map(([code, Icon, label]) => (
              <button key={code} onClick={() => ask(code)} disabled={!!busy}
                className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-p font-bold text-onp shadow transition active:scale-[.98] disabled:opacity-40">
                {busy === code ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <Icon className="size-5" aria-hidden />}{t(label)}
              </button>
            ))}
          </div>
        </div>
      )}
    </Sheet>
  );
}
