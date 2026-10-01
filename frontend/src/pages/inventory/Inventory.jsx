import { useMemo, useState } from 'react';
import { Plus, Trash2, AlertTriangle, ClipboardCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { useApp, toast } from '@/lib/store';
import { money, toMinor, minorInput, toMilli, milliInput, qty, units, dateTime, daysAgo, today, movementKinds, monthStart } from '@/lib/format';
import { exportCSV } from '@/lib/csv';
import { Button, Badge, Checkbox, DateRange, Field, Input, Modal, PageHeader, Select, Stat, Table, Td, Tabs, useLoad, useAction } from '@/components/ui';

export default function Inventory() {
  const can = useApp((s) => s.can);
  const tabs = [['stock', 'الخامات والأرصدة']];
  if (can('inventory.manage')) tabs.push(['purchases', 'المشتريات'], ['suppliers', 'الموردون']);
  tabs.push(['waste', 'الهالك']);
  if (can('inventory.count')) tabs.push(['counts', 'الجرد']);
  tabs.push(['movements', 'حركة المخزون']);
  const [tab, setTab] = useState('stock');
  return (
    <div className="p-5">
      <PageHeader title="المخزون" />
      <Tabs value={tab} onChange={setTab} tabs={tabs} />
      {tab === 'stock' && <Stock />}
      {tab === 'purchases' && <Purchases />}
      {tab === 'suppliers' && <Suppliers />}
      {tab === 'waste' && <Waste />}
      {tab === 'counts' && <Counts />}
      {tab === 'movements' && <Movements />}
    </div>
  );
}

const useIngredients = () => useLoad(() => api.get('/ingredients'));

// ---- stock -------------------------------------------------------------------

function Stock() {
  const can = useApp((s) => s.can);
  const data = useIngredients();
  const [edit, setEdit] = useState(null);
  const [adjust, setAdjust] = useState(null);
  const [onlyLow, setOnlyLow] = useState(false);
  const rows = (data.data || []).filter((g) => !onlyLow || g.low);
  const value = (data.data || []).reduce((s, g) => s + g.value_minor, 0);
  const low = (data.data || []).filter((g) => g.low).length;
  return (
    <>
      <div className="mb-4 grid grid-cols-3 gap-3">
        <Stat label="عدد الخامات" value={data.data?.length || 0} />
        <Stat label="قيمة المخزون" value={money(value)} tone="gold" />
        <Stat label="خامات تحت الحد الأدنى" value={low} tone={low ? 'bad' : 'good'} />
      </div>
      <div className="mb-3 flex items-center gap-3">
        {can('inventory.manage') && <Button onClick={() => setEdit({ name: '', unit: 'kg', min_stock_milli: 0, cost_minor: 0, active: true })}><Plus className="size-4" />خامة جديدة</Button>}
        <Checkbox label="الناقص فقط" checked={onlyLow} onChange={setOnlyLow} />
        <Button variant="secondary" className="mr-auto" onClick={() => exportCSV('stock', ['الخامة', 'الوحدة', 'الرصيد', 'الحد الأدنى', 'متوسط التكلفة', 'القيمة'],
          rows.map((g) => [g.name, units[g.unit], milliInput(g.stock_milli), milliInput(g.min_stock_milli), money(g.cost_minor), money(g.value_minor)]))}>تصدير Excel</Button>
      </div>
      <Table head={['الخامة', 'الرصيد', 'الحد الأدنى', 'متوسط التكلفة', 'القيمة', 'تُستخدم في', '']}>
        {rows.map((g) => (
          <tr key={g.id} className={g.low ? 'bg-red-50/60' : ''}>
            <Td className="font-semibold">{g.name} {!g.active && <Badge>موقوفة</Badge>}</Td>
            <Td className={`num font-bold ${g.stock_milli < 0 ? 'text-red-600' : ''}`}>{qty(g.stock_milli, g.unit)} {g.low && <AlertTriangle className="inline size-4 text-red-600" />}</Td>
            <Td className="num">{qty(g.min_stock_milli, g.unit)}</Td>
            <Td className="num">{money(g.cost_minor)} / {units[g.unit]}</Td>
            <Td className="num">{money(g.value_minor)}</Td>
            <Td>{g.used_in} صنف</Td>
            <Td className="whitespace-nowrap">
              {can('inventory.manage') && <>
                <Button size="sm" variant="ghost" onClick={() => setEdit(g)}>تعديل</Button>
                <Button size="sm" variant="ghost" onClick={() => setAdjust(g)}>تسوية</Button>
              </>}
            </Td>
          </tr>
        ))}
      </Table>
      {edit && <IngredientDialog g={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); data.reload(true); }} />}
      {adjust && <AdjustDialog g={adjust} onClose={() => setAdjust(null)} onSaved={() => { setAdjust(null); data.reload(true); }} />}
    </>
  );
}

function IngredientDialog({ g, onClose, onSaved }) {
  const [f, setF] = useState({ ...g, min: milliInput(g.min_stock_milli), cost: minorInput(g.cost_minor), opening: '' });
  const [busy, run] = useAction();
  const save = () => run(async () => {
    await api.post('/ingredients', {
      ...f, min_stock_milli: toMilli(f.min) ?? 0, cost_minor: toMinor(f.cost) ?? 0, opening_stock_milli: toMilli(f.opening) ?? 0,
    });
    toast('تم الحفظ');
    onSaved();
  });
  return (
    <Modal open onClose={onClose} title={g.id ? g.name : 'خامة جديدة'} footer={<Button busy={busy} onClick={save}>حفظ</Button>}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="الاسم" className="col-span-2"><Input autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="وحدة القياس" hint={g.id ? 'لا يمكن تغيير الوحدة بعد الإنشاء' : 'الوصفات تستخدم نفس الوحدة (مثلاً 0.150 كجم)'}>
          <Select disabled={!!g.id} value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })}>
            {Object.entries(units).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </Field>
        <Field label="الحد الأدنى للتنبيه"><Input className="num" value={f.min} onChange={(e) => setF({ ...f, min: e.target.value })} /></Field>
        {!g.id && <>
          <Field label="الرصيد الافتتاحي"><Input className="num" value={f.opening} onChange={(e) => setF({ ...f, opening: e.target.value })} /></Field>
          <Field label={`التكلفة لكل ${units[f.unit]}`} hint="تتحدث تلقائياً بمتوسط سعر المشتريات"><Input className="num" value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value })} /></Field>
        </>}
        <Checkbox label="مفعّلة" checked={f.active} onChange={(v) => setF({ ...f, active: v })} />
      </div>
    </Modal>
  );
}

function AdjustDialog({ g, onClose, onSaved }) {
  const [v, setV] = useState(milliInput(g.stock_milli));
  const [reason, setReason] = useState('');
  const [busy, run] = useAction();
  const save = () => run(async () => {
    await api.post(`/ingredients/${g.id}/adjust`, { qty_milli: toMilli(v), reason });
    toast('تمت التسوية');
    onSaved();
  });
  return (
    <Modal open onClose={onClose} title={`تسوية رصيد ${g.name}`} size="sm"
      footer={<Button busy={busy} disabled={toMilli(v) == null || !reason.trim()} onClick={save}>حفظ</Button>}>
      <div className="grid gap-3">
        <div className="text-stone-600">الرصيد الحالي: <b className="num">{qty(g.stock_milli, g.unit)}</b></div>
        <Field label={`الرصيد الصحيح (${units[g.unit]})`}><Input autoFocus className="num" value={v} onChange={(e) => setV(e.target.value)} /></Field>
        <Field label="السبب"><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

// ---- purchases -----------------------------------------------------------------

function Purchases() {
  const [range, setRange] = useState({ from: monthStart(), to: today() });
  const list = useLoad(() => api.get('/purchases', range), [range.from, range.to]);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(null);
  return (
    <>
      <div className="mb-3 flex gap-2">
        <Button onClick={() => setOpen(true)}><Plus className="size-4" />استلام مشتريات</Button>
        <DateRange from={range.from} to={range.to} onChange={(from, to) => setRange({ from, to })} />
        <div className="mr-auto self-center">الإجمالي: <b className="num">{money((list.data || []).reduce((s, p) => s + p.total_minor, 0))}</b></div>
      </div>
      <Table head={['التاريخ', 'المورد', 'رقم الفاتورة', 'الأصناف', 'الإجمالي', 'المستخدم']}>
        {(list.data || []).map((p) => (
          <tr key={p.id} className="cursor-pointer hover:bg-stone-50" onClick={() => setView(p)}>
            <Td>{dateTime(p.received_at)}</Td><Td>{p.supplier_name || '—'}</Td><Td className="num">{p.reference}</Td>
            <Td>{p.lines.length}</Td><Td className="num font-semibold">{money(p.total_minor)}</Td><Td>{p.user_name}</Td>
          </tr>
        ))}
      </Table>
      {open && <PurchaseDialog onClose={() => setOpen(false)} onSaved={() => { setOpen(false); list.reload(true); }} />}
      {view && (
        <Modal open onClose={() => setView(null)} title={`فاتورة مشتريات ${view.reference}`} size="lg">
          <Table head={['الخامة', 'الكمية', 'سعر الوحدة', 'الإجمالي']}>
            {view.lines.map((l, i) => <tr key={i}><Td>{l.name}</Td><Td className="num">{qty(l.qty_milli, l.unit)}</Td><Td className="num">{money(l.unit_cost_minor)}</Td><Td className="num">{money(l.total_minor)}</Td></tr>)}
          </Table>
          {view.notes && <p className="mt-2 text-stone-600">{view.notes}</p>}
        </Modal>
      )}
    </>
  );
}

function PurchaseDialog({ onClose, onSaved }) {
  const data = useLoad(async () => ({ ingredients: (await api.get('/ingredients')).filter((g) => g.active), suppliers: await api.get('/suppliers') }));
  const [f, setF] = useState({ supplier_id: '', reference: '', notes: '' });
  const [lines, setLines] = useState([{ ingredient_id: '', qty: '', cost: '' }]);
  const [busy, run] = useAction();
  const ing = Object.fromEntries((data.data?.ingredients || []).map((g) => [g.id, g]));
  const total = lines.reduce((s, l) => s + Math.round(((toMinor(l.cost) || 0) * (toMilli(l.qty) || 0)) / 1000), 0);
  const set = (i, patch) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const save = () => run(async () => {
    const body = lines.filter((l) => l.ingredient_id).map((l) => ({ ingredient_id: l.ingredient_id, qty_milli: toMilli(l.qty), unit_cost_minor: toMinor(l.cost) }));
    if (body.some((l) => !l.qty_milli || l.unit_cost_minor == null)) throw new Error('راجع الكميات والأسعار');
    await api.post('/purchases', { ...f, lines: body });
    toast('تم استلام المشتريات وتحديث الأرصدة والتكلفة');
    onSaved();
  });
  return (
    <Modal open onClose={onClose} title="استلام مشتريات" size="xl"
      footer={<><span className="ml-auto text-lg">الإجمالي: <b className="num">{money(total)}</b></span><Button busy={busy} onClick={save}>حفظ واستلام</Button></>}>
      <div className="mb-4 grid grid-cols-3 gap-3">
        <Field label="المورد">
          <Select value={f.supplier_id} onChange={(e) => setF({ ...f, supplier_id: e.target.value })}>
            <option value="">— بدون —</option>{data.data?.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </Field>
        <Field label="رقم فاتورة المورد"><Input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>
        <Field label="ملاحظات"><Input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      </div>
      <div className="grid gap-2">
        {lines.map((l, i) => (
          <div key={i} className="flex items-center gap-2">
            <Select className="flex-1" value={l.ingredient_id} onChange={(e) => set(i, { ingredient_id: e.target.value, cost: minorInput(ing[e.target.value]?.cost_minor) })}>
              <option value="">— الخامة —</option>{data.data?.ingredients.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </Select>
            <Input className="num w-28" placeholder="الكمية" value={l.qty} onChange={(e) => set(i, { qty: e.target.value })} />
            <span className="w-12 text-sm text-stone-500">{units[ing[l.ingredient_id]?.unit] || ''}</span>
            <Input className="num w-32" placeholder="سعر الوحدة" value={l.cost} onChange={(e) => set(i, { cost: e.target.value })} />
            <span className="num w-28 text-left">{money(Math.round(((toMinor(l.cost) || 0) * (toMilli(l.qty) || 0)) / 1000))}</span>
            <button onClick={() => setLines(lines.filter((_, j) => j !== i))}><Trash2 className="size-4 text-red-600" /></button>
          </div>
        ))}
        <Button variant="secondary" onClick={() => setLines([...lines, { ingredient_id: '', qty: '', cost: '' }])}><Plus className="size-4" />سطر</Button>
      </div>
    </Modal>
  );
}

function Suppliers() {
  const data = useLoad(() => api.get('/suppliers'));
  const [edit, setEdit] = useState(null);
  const [busy, run] = useAction();
  const save = () => run(async () => { await api.post('/suppliers', edit); setEdit(null); data.reload(true); });
  return (
    <>
      <Button className="mb-3" onClick={() => setEdit({ name: '', phone: '', notes: '' })}><Plus className="size-4" />مورد</Button>
      <Table head={['المورد', 'الهاتف', 'إجمالي المشتريات', 'ملاحظات']}>
        {(data.data || []).map((s) => (
          <tr key={s.id} className="cursor-pointer hover:bg-stone-50" onClick={() => setEdit(s)}>
            <Td className="font-semibold">{s.name}</Td><Td className="num">{s.phone}</Td><Td className="num">{money(s.purchases_minor)}</Td><Td>{s.notes}</Td>
          </tr>
        ))}
      </Table>
      {edit && (
        <Modal open onClose={() => setEdit(null)} title="مورد" size="sm" footer={<Button busy={busy} onClick={save}>حفظ</Button>}>
          <div className="grid gap-3">
            <Field label="الاسم"><Input autoFocus value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="الهاتف"><Input value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></Field>
            <Field label="ملاحظات"><Input value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></Field>
          </div>
        </Modal>
      )}
    </>
  );
}

// ---- waste ---------------------------------------------------------------------

function Waste() {
  const [range, setRange] = useState({ from: daysAgo(7), to: today() });
  const list = useLoad(() => api.get('/waste', range), [range.from, range.to]);
  const [open, setOpen] = useState(false);
  const total = (list.data || []).reduce((s, w) => s + w.cost_minor, 0);
  return (
    <>
      <div className="mb-3 flex gap-2">
        <Button onClick={() => setOpen(true)}><Plus className="size-4" />تسجيل هالك</Button>
        <DateRange from={range.from} to={range.to} onChange={(from, to) => setRange({ from, to })} />
        <div className="mr-auto self-center">تكلفة الهالك: <b className="num text-red-600">{money(total)}</b></div>
      </div>
      <Table head={['الوقت', 'الصنف / الخامة', 'النوع', 'الكمية', 'السبب', 'التكلفة', 'المستخدم']}>
        {(list.data || []).map((w) => (
          <tr key={w.id}>
            <Td>{dateTime(w.created_at)}</Td><Td className="font-semibold">{w.name}</Td>
            <Td>{w.kind === 'item' ? <Badge tone="amber">صنف جاهز</Badge> : <Badge>خامة</Badge>}</Td>
            <Td className="num">{w.kind === 'item' ? qty(w.qty_milli) : qty(w.qty_milli, w.unit)}</Td><Td>{w.reason}</Td>
            <Td className="num text-red-600">{money(w.cost_minor)}</Td><Td>{w.user_name}</Td>
          </tr>
        ))}
      </Table>
      {open && <WasteDialog onClose={() => setOpen(false)} onSaved={() => { setOpen(false); list.reload(true); }} />}
    </>
  );
}

function WasteDialog({ onClose, onSaved }) {
  const data = useLoad(async () => ({ items: (await api.get('/items')).filter((i) => i.active), ingredients: (await api.get('/ingredients')).filter((g) => g.active) }));
  const [kind, setKind] = useState('ingredient');
  const [id, setId] = useState('');
  const [q, setQ] = useState('');
  const [reason, setReason] = useState('');
  const [busy, run] = useAction();
  const list = kind === 'item' ? data.data?.items : data.data?.ingredients;
  const unit = kind === 'ingredient' ? units[data.data?.ingredients.find((g) => g.id === id)?.unit] : 'وحدة';
  const save = () => run(async () => {
    await api.post('/waste', { [kind === 'item' ? 'item_id' : 'ingredient_id']: id, qty_milli: toMilli(q), reason });
    toast('تم تسجيل الهالك');
    onSaved();
  });
  return (
    <Modal open onClose={onClose} title="تسجيل هالك" footer={<Button busy={busy} disabled={!id || !toMilli(q) || !reason.trim()} onClick={save}>تسجيل</Button>}>
      <div className="grid gap-3">
        <div className="flex gap-2">
          <Button variant={kind === 'ingredient' ? 'primary' : 'secondary'} onClick={() => { setKind('ingredient'); setId(''); }}>خامة</Button>
          <Button variant={kind === 'item' ? 'primary' : 'secondary'} onClick={() => { setKind('item'); setId(''); }}>صنف جاهز (حسب الوصفة)</Button>
        </div>
        <Field label={kind === 'item' ? 'الصنف' : 'الخامة'}>
          <Select value={id} onChange={(e) => setId(e.target.value)}>
            <option value="">— اختر —</option>{(list || []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </Select>
        </Field>
        <Field label={`الكمية (${unit || ''})`}><Input className="num" value={q} onChange={(e) => setQ(e.target.value)} /></Field>
        <Field label="السبب"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="منتهي الصلاحية، تالف، وقع…" /></Field>
      </div>
    </Modal>
  );
}

// ---- stock counts (جرد) -----------------------------------------------------------

function Counts() {
  const list = useLoad(() => api.get('/counts'));
  const [openId, setOpenId] = useState(null);
  const [busy, run] = useAction();
  const draft = (list.data || []).find((c) => c.status === 'draft');
  const start = () => run(async () => { const { id } = await api.post('/counts', { notes: '' }); list.reload(true); setOpenId(id); });
  const status = { draft: ['amber', 'جارٍ'], posted: ['green', 'مُرحّل'], cancelled: ['gray', 'ملغي'] };
  return (
    <>
      <div className="mb-3 flex gap-2">
        {draft ? <Button onClick={() => setOpenId(draft.id)}><ClipboardCheck className="size-4" />متابعة الجرد المفتوح</Button>
          : <Button busy={busy} onClick={start}><Plus className="size-4" />بدء جرد جديد</Button>}
      </div>
      <Table head={['التاريخ', 'الحالة', 'بدأه', 'رحّله', 'خامات معدودة', 'قيمة الفروق']}>
        {(list.data || []).map((c) => (
          <tr key={c.id} className="cursor-pointer hover:bg-stone-50" onClick={() => setOpenId(c.id)}>
            <Td>{dateTime(c.created_at)}</Td><Td><Badge tone={status[c.status][0]}>{status[c.status][1]}</Badge></Td>
            <Td>{c.created_by}</Td><Td>{c.posted_by ? `${c.posted_by} — ${dateTime(c.posted_at)}` : '—'}</Td>
            <Td>{c.counted}</Td><Td className={`num ${c.variance_cost_minor < 0 ? 'text-red-600' : ''}`}>{c.status === 'posted' ? money(c.variance_cost_minor) : '—'}</Td>
          </tr>
        ))}
      </Table>
      {openId && <CountSheet id={openId} onClose={() => { setOpenId(null); list.reload(true); }} />}
    </>
  );
}

function CountSheet({ id, onClose }) {
  const can = useApp((s) => s.can);
  const count = useLoad(() => api.get(`/counts/${id}`), [id]);
  const [edits, setEdits] = useState({});
  const [busy, run] = useAction();
  const c = count.data;
  const draft = c?.status === 'draft';
  const dirty = Object.keys(edits).length > 0;

  const saveLines = async () => {
    const body = {};
    for (const [ing, v] of Object.entries(edits)) {
      if (v.trim() === '') body[ing] = null;
      else {
        const m = toMilli(v);
        if (m == null || m < 0) throw new Error('كمية غير صحيحة');
        body[ing] = m;
      }
    }
    await api.put(`/counts/${id}/lines`, body);
    setEdits({});
  };
  const save = () => run(async () => { await saveLines(); toast('تم الحفظ'); count.reload(true); });
  const post = () => run(async () => {
    if (dirty) await saveLines();
    await api.post(`/counts/${id}/post`);
    toast('تم ترحيل الجرد وتسوية الأرصدة');
    count.reload(true);
  });
  const cancel = () => run(async () => { await api.post(`/counts/${id}/cancel`); onClose(); });

  const preview = useMemo(() => (c?.lines || []).map((l) => {
    const v = edits[l.ingredient_id];
    const counted = v !== undefined ? (v.trim() === '' ? null : toMilli(v)) : l.counted_milli;
    const variance = counted == null ? null : counted - l.expected_milli;
    return { ...l, counted, variance, varianceCost: variance == null ? 0 : Math.round((variance * l.cost_minor) / 1000) };
  }), [c, edits]);
  const totalVar = preview.reduce((s, l) => s + l.varianceCost, 0);

  return (
    <Modal open onClose={onClose} title={`جرد ${c ? dateTime(c.created_at) : ''}`} size="xl"
      footer={c && <>
        <span className={`ml-auto text-lg ${totalVar < 0 ? 'text-red-600' : ''}`}>قيمة الفروق: <b className="num">{money(totalVar)}</b></span>
        {draft && <Button variant="ghost" onClick={cancel}>إلغاء الجرد</Button>}
        {draft && <Button variant="secondary" busy={busy} disabled={!dirty} onClick={save}>حفظ</Button>}
        {draft && can('inventory.manage') && <Button busy={busy} onClick={post}>ترحيل وتسوية الأرصدة</Button>}
        <Button variant="secondary" onClick={() => exportCSV('stock-count', ['الخامة', 'الوحدة', 'المتوقع', 'المعدود', 'الفرق', 'قيمة الفرق'],
          preview.map((l) => [l.name, units[l.unit], milliInput(l.expected_milli), l.counted == null ? '' : milliInput(l.counted), l.variance == null ? '' : milliInput(l.variance), money(l.varianceCost)]))}>تصدير</Button>
      </>}>
      {draft && <p className="mb-3 text-sm text-stone-600">أدخل الكمية الفعلية لكل خامة. الخامات المتروكة فارغة لن تتأثر. عند الترحيل يصبح الرصيد = المعدود، ويُسجَّل الفرق في تقرير الاستهلاك.</p>}
      <Table head={['الخامة', 'الرصيد في النظام', 'المعدود فعلياً', 'الفرق', 'قيمة الفرق']}>
        {preview.map((l) => (
          <tr key={l.ingredient_id}>
            <Td className="font-semibold">{l.name}</Td>
            <Td className="num">{qty(l.expected_milli, l.unit)}</Td>
            <Td>{draft ? (
              <div className="flex items-center gap-2">
                <Input className="num w-28" value={edits[l.ingredient_id] ?? (l.counted_milli == null ? '' : milliInput(l.counted_milli))}
                  onChange={(e) => setEdits({ ...edits, [l.ingredient_id]: e.target.value })} />
                <span className="text-sm text-stone-500">{units[l.unit]}</span>
              </div>
            ) : <span className="num">{l.counted == null ? '—' : qty(l.counted, l.unit)}</span>}</Td>
            <Td className={`num font-bold ${l.variance < 0 ? 'text-red-600' : l.variance > 0 ? 'text-amber-600' : ''}`}>{l.variance == null ? '—' : qty(l.variance, l.unit)}</Td>
            <Td className="num">{l.variance == null ? '—' : money(l.varianceCost)}</Td>
          </tr>
        ))}
      </Table>
    </Modal>
  );
}

// ---- movements ledger --------------------------------------------------------------

function Movements() {
  const [f, setF] = useState({ from: daysAgo(7), to: today(), ingredient: '', kind: '' });
  const ingredients = useIngredients();
  const list = useLoad(() => api.get('/movements', f), [f.from, f.to, f.ingredient, f.kind]);
  return (
    <>
      <div className="mb-3 flex flex-wrap gap-2">
        <DateRange from={f.from} to={f.to} onChange={(from, to) => setF({ ...f, from, to })} />
        <Select className="w-48" value={f.ingredient} onChange={(e) => setF({ ...f, ingredient: e.target.value })}>
          <option value="">كل الخامات</option>{(ingredients.data || []).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </Select>
        <Select className="w-44" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
          <option value="">كل الحركات</option>{Object.entries(movementKinds).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <Button variant="secondary" onClick={() => exportCSV('movements', ['الوقت', 'الخامة', 'الحركة', 'الكمية', 'القيمة', 'السبب', 'المستخدم'],
          (list.data || []).map((m) => [dateTime(m.created_at), m.ingredient, movementKinds[m.kind], milliInput(m.qty_milli), money(m.value_minor), m.reason, m.user_name]))}>تصدير Excel</Button>
      </div>
      <Table head={['الوقت', 'الخامة', 'الحركة', 'الكمية', 'القيمة', 'السبب', 'المستخدم']}>
        {(list.data || []).map((m) => (
          <tr key={m.id}>
            <Td>{dateTime(m.created_at)}</Td><Td className="font-semibold">{m.ingredient}</Td><Td>{movementKinds[m.kind]}</Td>
            <Td className={`num font-semibold ${m.qty_milli < 0 ? 'text-red-600' : 'text-brand-700'}`}>{qty(m.qty_milli, m.unit)}</Td>
            <Td className="num">{money(m.value_minor)}</Td><Td>{m.reason}</Td><Td>{m.user_name}</Td>
          </tr>
        ))}
      </Table>
    </>
  );
}
