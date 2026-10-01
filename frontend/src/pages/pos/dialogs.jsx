import { useEffect, useMemo, useState } from 'react';
import { Banknote, CreditCard, Plus, Search, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useApp, toastError } from '@/lib/store';
import { money, moneyC, toMinor, minorInput, qty as fmtQty, toBP } from '@/lib/format';
import { Button, Field, Input, Modal, Select, Textarea, Checkbox, cx } from '@/components/ui';
import { T } from '@/lib/i18n';

// ---- modifiers -------------------------------------------------------------

export function ModifierDialog({ item, groups, onClose, onAdd }) {
  const [picked, setPicked] = useState({});
  const [notes, setNotes] = useState('');
  const [count, setCount] = useState(1);
  const itemGroups = item.modifier_group_ids.map((id) => groups[id]).filter((g) => g?.active);

  const toggle = (g, m) => {
    const cur = picked[g.id] || [];
    let next = cur.includes(m.id) ? cur.filter((x) => x !== m.id) : [...cur, m.id];
    if (g.max_select === 1) next = cur.includes(m.id) ? [] : [m.id];
    else if (g.max_select > 0 && next.length > g.max_select) return;
    setPicked({ ...picked, [g.id]: next });
  };
  const missing = itemGroups.find((g) => (picked[g.id]?.length || 0) < g.min_select);
  const extra = itemGroups.flatMap((g) => g.modifiers.filter((m) => picked[g.id]?.includes(m.id))).reduce((s, m) => s + m.price_minor, 0);

  return (
    <Modal open onClose={onClose} title={item.name} size="lg"
      footer={<>
        <div className="me-auto flex items-center gap-2">
          <Button variant="secondary" onClick={() => setCount(Math.max(1, count - 1))}>−</Button>
          <span className="num w-8 text-center text-xl font-bold">{count}</span>
          <Button variant="secondary" onClick={() => setCount(count + 1)}>+</Button>
        </div>
        <Button size="lg" disabled={!!missing} onClick={() => onAdd({ modifier_ids: Object.values(picked).flat(), notes, qty_milli: count * 1000 })}>
          {T('إضافة —')} {moneyC((item.price_minor + extra) * count)}
        </Button>
      </>}>
      <div className="grid gap-5">
        {itemGroups.map((g) => (
          <div key={g.id}>
            <div className="mb-2 flex items-center gap-2 font-bold">
              {g.name}
              <span className="text-xs font-normal text-muted">
                {g.min_select > 0 ? T('إجباري ({0})', [g.min_select]) : T('اختياري')}{g.max_select > 0 ? ` ${T('— حتى {0}', [g.max_select])}` : ''}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {g.modifiers.filter((m) => m.active).map((m) => {
                const on = picked[g.id]?.includes(m.id);
                return (
                  <button key={m.id} onClick={() => toggle(g, m)}
                    className={cx('rounded-xl border-2 p-3 text-start', on ? 'border-primary bg-primary-soft' : 'border-line hover:border-primary')}>
                    <div className="font-semibold">{m.name}</div>
                    {m.price_minor > 0 && <div className="num text-sm text-muted">+{money(m.price_minor)}</div>}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        <Field label={T('ملاحظات للمطبخ')}><Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={T('بدون بصل، حار…')} /></Field>
      </div>
    </Modal>
  );
}

// ---- line edit -------------------------------------------------------------

export function LineDialog({ line, onClose, onSave }) {
  const sent = !!line.sent_at;
  const [count, setCount] = useState(line.qty_milli / 1000);
  const [notes, setNotes] = useState(line.notes);
  const [kind, setKind] = useState(line.discount_kind || '');
  const [value, setValue] = useState(line.discount_kind === 'percent' ? String(line.discount_rate_bp / 100) : minorInput(line.discount_amount_minor));
  const save = () => {
    const body = { qty_milli: Math.round(count * 1000), notes, discount_kind: kind, discount_rate_bp: 0, discount_amount_minor: 0 };
    if (kind === 'percent') body.discount_rate_bp = toBP(value) ?? 0;
    if (kind === 'fixed') body.discount_amount_minor = toMinor(value) ?? 0;
    onSave(body);
  };
  return (
    <Modal open onClose={onClose} title={line.name}
      footer={<><Button variant="secondary" onClick={onClose}>{T('إلغاء')}</Button><Button onClick={save}>{T('حفظ')}</Button></>}>
      <div className="grid gap-4">
        <Field label={T('الكمية')} hint={sent ? T('أُرسل للمطبخ — لا يمكن تغيير الكمية') : ''}>
          <div className="flex items-center gap-2">
            <Button variant="secondary" disabled={sent} onClick={() => setCount(Math.max(1, count - 1))}>−</Button>
            <Input className="num w-24 text-center" disabled={sent} value={count} onChange={(e) => setCount(Number(e.target.value) || 1)} />
            <Button variant="secondary" disabled={sent} onClick={() => setCount(count + 1)}>+</Button>
          </div>
        </Field>
        <Field label={T('ملاحظات')}><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={T('خصم على الصنف')}>
            <Select value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="">{T('بدون')}</option><option value="percent">{T('نسبة %')}</option><option value="fixed">{T('مبلغ')}</option>
            </Select>
          </Field>
          {kind && <Field label={kind === 'percent' ? T('النسبة %') : T('المبلغ')}><Input className="num" value={value} onChange={(e) => setValue(e.target.value)} /></Field>}
        </div>
      </div>
    </Modal>
  );
}

// ---- void / remove ---------------------------------------------------------

export function VoidDialog({ title, sent, onClose, onConfirm }) {
  const [reason, setReason] = useState('');
  const [waste, setWaste] = useState(false);
  const reasons = [T('طلب العميل'), T('خطأ في الطلب'), T('تأخير'), T('جودة الطعام')];
  return (
    <Modal open onClose={onClose} title={title}
      footer={<><Button variant="secondary" onClick={onClose}>{T('رجوع')}</Button>
        <Button variant="danger" disabled={sent && !reason.trim()} onClick={() => onConfirm({ reason, waste })}>{T('تأكيد الإلغاء')}</Button></>}>
      {sent ? (
        <div className="grid gap-3">
          <p className="text-muted">{T('تم إرسال الأصناف للمطبخ. سيُسجَّل الإلغاء في سجل النشاط ويتطلب صلاحية المدير.')}</p>
          <div className="flex flex-wrap gap-2">
            {reasons.map((r) => <Button key={r} size="sm" variant={reason === r ? 'primary' : 'secondary'} onClick={() => setReason(r)}>{r}</Button>)}
          </div>
          <Field label={T('السبب')}><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          <Checkbox label={T('تم تحضيره بالفعل — احسب الخامات كهالك')} checked={waste} onChange={setWaste} />
        </div>
      ) : <p>{T('سيتم حذف الأصناف التي لم تُرسل للمطبخ.')}</p>}
    </Modal>
  );
}

// ---- order discount --------------------------------------------------------

export function DiscountDialog({ order, onClose, onSave }) {
  const [kind, setKind] = useState(order.discount_kind || 'percent');
  const [value, setValue] = useState(order.discount_kind === 'fixed' ? minorInput(order.discount_amount_minor) : order.discount_rate_bp ? String(order.discount_rate_bp / 100) : '');
  const [reason, setReason] = useState(order.discount_reason || '');
  const body = (k) => ({
    kind: k, reason,
    rate_bp: k === 'percent' ? toBP(value) ?? 0 : 0,
    amount_minor: k === 'fixed' ? toMinor(value) ?? 0 : 0,
  });
  return (
    <Modal open onClose={onClose} title={T('خصم على الطلب')}
      footer={<>
        {order.discount_kind && <Button variant="ghost" onClick={() => onSave({ kind: '', reason: '' })}>{T('إزالة الخصم')}</Button>}
        <Button variant="secondary" onClick={onClose}>{T('إلغاء')}</Button>
        <Button disabled={!value || !reason.trim()} onClick={() => onSave(body(kind))}>{T('تطبيق')}</Button>
      </>}>
      <div className="grid gap-3">
        <div className="flex gap-2">
          <Button variant={kind === 'percent' ? 'primary' : 'secondary'} onClick={() => setKind('percent')}>{T('نسبة %')}</Button>
          <Button variant={kind === 'fixed' ? 'primary' : 'secondary'} onClick={() => setKind('fixed')}>{T('مبلغ ثابت')}</Button>
        </div>
        {kind === 'percent' && (
          <div className="flex gap-2">{[5, 10, 15, 20, 25, 50].map((p) => <Button key={p} size="sm" variant="secondary" onClick={() => setValue(String(p))}>{p}%</Button>)}</div>
        )}
        <Field label={kind === 'percent' ? T('النسبة') : T('المبلغ')}><Input className="num" autoFocus value={value} onChange={(e) => setValue(e.target.value)} /></Field>
        <Field label={T('السبب')}><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={T('عميل دائم، تعويض…')} /></Field>
      </div>
    </Modal>
  );
}

// ---- customer ----------------------------------------------------------------

export function CustomerDialog({ onClose, onPick }) {
  const [q, setQ] = useState('');
  const [list, setList] = useState([]);
  const [form, setForm] = useState(null);
  useEffect(() => {
    const t = setTimeout(() => api.get('/customers', { q }).then(setList).catch(toastError), 200);
    return () => clearTimeout(t);
  }, [q]);
  const save = async () => {
    try { onPick(await api.post('/customers', form)); } catch (e) { toastError(e); }
  };
  return (
    <Modal open onClose={onClose} title={T('العميل')} size="lg"
      footer={form ? <><Button variant="secondary" onClick={() => setForm(null)}>{T('رجوع')}</Button><Button onClick={save}>{T('حفظ واختيار')}</Button></> : null}>
      {form ? (
        <div className="grid grid-cols-2 gap-3">
          <Field label={T('الاسم')}><Input autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label={T('الهاتف')}><Input className="num" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
          <Field label={T('العنوان')} className="col-span-2"><Textarea value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></Field>
        </div>
      ) : (
        <div className="grid gap-3">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute start-3 top-2.5 size-5 text-muted/70" />
              <Input autoFocus className="ps-10" placeholder={T('ابحث بالاسم أو الهاتف')} value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <Button onClick={() => setForm({ name: /\d/.test(q) ? '' : q, phone: /\d/.test(q) ? q : '', address: '', notes: '' })}><Plus className="size-4" />{T('عميل جديد')}</Button>
          </div>
          <div className="max-h-96 divide-y overflow-y-auto rounded-xl border">
            {list.map((c) => (
              <button key={c.id} onClick={() => onPick(c)} className="flex w-full justify-between px-4 py-3 text-start hover:bg-surface-2">
                <div><div className="font-semibold">{c.name}</div><div className="text-sm text-muted">{c.address}</div></div>
                <div className="num text-muted">{c.phone}</div>
              </button>
            ))}
            {!list.length && <div className="p-6 text-center text-muted/70">{T('لا يوجد عملاء')}</div>}
          </div>
        </div>
      )}
    </Modal>
  );
}

// ---- open shift --------------------------------------------------------------

export function OpenShiftDialog({ onClose, onOpened }) {
  const [float, setFloat] = useState('');
  const [busy, setBusy] = useState(false);
  const open = async () => {
    setBusy(true);
    try {
      await api.post('/shifts', { opening_float_minor: toMinor(float) ?? 0 });
      await useApp.getState().loadShift();
      onOpened?.();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title={T('فتح وردية')} size="sm"
      footer={<Button busy={busy} onClick={open}>{T('فتح الوردية')}</Button>}>
      <Field label={T('النقدية في الدرج عند البداية')}><Input autoFocus className="num text-xl" value={float} onChange={(e) => setFloat(e.target.value)} placeholder="0" /></Field>
    </Modal>
  );
}

// ---- payment -----------------------------------------------------------------

export function PayDialog({ order, onClose, onPaid }) {
  const settings = useApp((s) => s.settings);
  const methods = settings.payment_methods.filter((m) => m.active);
  const cashCode = methods.find((m) => m.is_cash)?.code;
  const [tenders, setTenders] = useState([]);
  const [method, setMethod] = useState(cashCode);
  const [amount, setAmount] = useState('');
  const [received, setReceived] = useState('');
  const [busy, setBusy] = useState(false);

  const paid = tenders.reduce((s, t) => s + t.amount_minor, 0);
  const remaining = order.total_minor - paid;
  const isCash = methods.find((m) => m.code === method)?.is_cash;
  const amt = amount === '' ? remaining : toMinor(amount) ?? 0;
  const got = toMinor(received);
  const change = isCash && got ? Math.max(0, got - amt) : 0;
  const quick = useMemo(() => {
    // Likely notes the customer hands over: round-ups and the next bills.
    const r = remaining / 100;
    const ups = [5, 10, 50, 100, 200].map((n) => Math.ceil(r / n) * n);
    return [...new Set([...ups, 200, 500, 1000])].filter((v) => v * 100 >= remaining).sort((a, b) => a - b).slice(0, 5);
  }, [remaining]);

  const add = (override) => {
    const a = override?.amount ?? amt;
    if (a <= 0 || a > remaining) return toastError(new Error(T('المبلغ أكبر من المتبقي')));
    const r = override?.received ?? got;
    if (isCash && r && r < a) return toastError(new Error(T('المبلغ المستلم أقل من المطلوب')));
    const t = { method, amount_minor: a, tendered_minor: isCash && r ? r : 0, reference: '' };
    setTenders([...tenders, t]);
    setAmount('');
    setReceived('');
    return t;
  };

  const pay = async (list) => {
    setBusy(true);
    try {
      const res = await api.post(`/orders/${order.id}/pay`, { tenders: list }, { idempotent: true });
      onPaid(res);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  // One-tap exact payment in the selected method.
  const payNow = (receivedMinor) => {
    const list = remaining > 0 ? [...tenders, { method, amount_minor: remaining, tendered_minor: isCash && receivedMinor ? receivedMinor : 0, reference: '' }] : tenders;
    pay(list);
  };

  return (
    <Modal open onClose={onClose} title={T('دفع الطلب #{0}', [order.number])} size="lg">
      <div className="grid gap-5 md:grid-cols-2">
        <div className="grid content-start gap-3">
          <div className="bg-brand rounded-2xl p-5 text-white shadow-md shadow-primary/30">
            <div className="text-sm opacity-80">{T('الإجمالي')}</div>
            <div className="num text-4xl font-black" style={{ direction: 'inherit' }}>{moneyC(order.total_minor)}</div>
            {paid > 0 && <div className="mt-2 font-semibold text-white/90">{T('المتبقي:')} <span className="num">{money(remaining)}</span></div>}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {methods.map((m) => (
              <button key={m.code} onClick={() => setMethod(m.code)}
                className={cx('flex items-center gap-2 rounded-xl border-2 p-3 font-semibold', method === m.code ? 'border-primary bg-primary-soft' : 'border-line')}>
                {m.is_cash ? <Banknote className="size-5" /> : <CreditCard className="size-5" />}{m.name}
              </button>
            ))}
          </div>
          {tenders.length > 0 && (
            <div className="divide-y rounded-xl border">
              {tenders.map((t, i) => (
                <div key={i} className="flex items-center justify-between px-3 py-2">
                  <span>{methods.find((m) => m.code === t.method)?.name}</span>
                  <span className="num">{money(t.amount_minor)}</span>
                  <button onClick={() => setTenders(tenders.filter((_, j) => j !== i))}><Trash2 className="size-4 text-danger" /></button>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="grid content-start gap-3">
          {remaining > 0 ? (
            <>
              <Field label={T('المبلغ من هذه الطريقة')} hint={T('اتركه فارغاً لدفع المتبقي بالكامل')}>
                <Input className="num text-xl" value={amount} placeholder={money(remaining)} onChange={(e) => setAmount(e.target.value)} />
              </Field>
              {isCash && (
                <>
                  <Field label={T('المبلغ المستلم من العميل')}>
                    <Input className="num text-xl" value={received} onChange={(e) => setReceived(e.target.value)} />
                  </Field>
                  <div className="flex flex-wrap gap-2">
                    {quick.map((v) => <Button key={v} variant="secondary" onClick={() => setReceived(String(v))}>{v}</Button>)}
                  </div>
                  {change > 0 && <div className="rounded-xl bg-warning-soft p-3 text-lg font-bold text-warning">{T('الباقي للعميل:')} <span className="num">{money(change)}</span></div>}
                </>
              )}
              <div className="flex gap-2">
                <Button variant="secondary" className="flex-1" onClick={() => add()} disabled={amt <= 0 || amt >= remaining}>{T('تقسيم الدفع')}</Button>
                <Button size="lg" className="flex-1" busy={busy} disabled={amt !== remaining && amount !== ''}
                  onClick={() => payNow(got)}>{T('دفع')} {money(remaining)}</Button>
              </div>
            </>
          ) : (
            <Button size="lg" busy={busy} onClick={() => pay(tenders)}>{T('إتمام الدفع')}</Button>
          )}
        </div>
      </div>
    </Modal>
  );
}

export const describeLine = (l) => `${fmtQty(l.qty_milli)} × ${l.name}`;
