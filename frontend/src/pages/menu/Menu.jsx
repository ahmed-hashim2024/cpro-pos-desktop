import { useState } from 'react';
import { Plus, Trash2, ImagePlus, Utensils, UtensilsCrossed } from 'lucide-react';
import { api } from '@/lib/api';
import { useTab } from '@/lib/useTab';
import { toast } from '@/lib/store';
import { money, minorInput, toMinor, toMilli, milliInput, units, pct } from '@/lib/format';
import { Button, Badge, Checkbox, Field, Input, Modal, PageHeader, Select, Table, Td, Tabs, Textarea, useLoad, useAction } from '@/components/ui';
import { T, lang } from '@/lib/i18n';

export default function Menu() {
  const [tab, setTab] = useTab('items');
  return (
    <div>
      <PageHeader title={T('المنيو')} icon={UtensilsCrossed} subtitle={T('الأصناف والوصفات والإضافات والطاولات')} crumb={T('المنيو')} />
      <Tabs value={tab} onChange={setTab} tabs={[['items', T('الأصناف')], ['categories', T('الأقسام')], ['modifiers', T('الإضافات')], ['tables', T('الطاولات')], ['stations', T('محطات المطبخ')]]} />
      {tab === 'items' && <Items />}
      {tab === 'categories' && <Categories />}
      {tab === 'modifiers' && <ModifierGroups />}
      {tab === 'tables' && <Tables />}
      {tab === 'stations' && <Stations />}
    </div>
  );
}

// ---- items -------------------------------------------------------------------

function Items() {
  const data = useLoad(async () => {
    const [items, categories, groups, ingredients] = await Promise.all([
      api.get('/items'), api.get('/categories'), api.get('/modifier-groups'), api.get('/ingredients').catch(() => []),
    ]);
    return { items, categories, groups, ingredients };
  });
  const [edit, setEdit] = useState(null);
  const [cat, setCat] = useState('');
  const d = data.data;
  const catName = Object.fromEntries((d?.categories || []).map((c) => [c.id, c.name]));
  const rows = (d?.items || []).filter((i) => !cat || i.category_id === cat);
  return (
    <>
      <div className="mb-3 flex gap-2">
        <Select className="w-56" value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="">{T('كل الأقسام')}</option>{d?.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <Button onClick={() => setEdit({ name: '', code: '', category_id: cat, price_minor: 0, active: true, description: '', sort: 0, modifier_group_ids: [], recipe: [] })}>
          <Plus className="size-4" />{T('صنف جديد')}
        </Button>
      </div>
      <Table head={['', T('الكود'), T('الصنف'), T('القسم'), T('السعر'), T('تكلفة الوصفة'), T('هامش الربح'), T('الحالة')]}>
        {rows.map((i) => {
          const margin = i.price_minor ? Math.round(((i.price_minor - i.cost_minor) / i.price_minor) * 10000) : 0;
          return (
            <tr key={i.id} className="cursor-pointer hover:bg-surface-2" onClick={() => setEdit(i)}>
              <Td>{i.image ? <img src={i.image} className="size-10 rounded object-cover" alt="" /> : <Utensils className="size-5 text-muted/70" />}</Td>
              <Td className="num">{i.code}</Td><Td className="font-semibold">{i.name}</Td><Td>{catName[i.category_id] || '—'}</Td>
              <Td className="num">{money(i.price_minor)}</Td>
              <Td className="num">{i.recipe.length ? money(i.cost_minor) : <span className="text-warning">{T('بدون وصفة')}</span>}</Td>
              <Td className={`num ${margin < 5000 ? 'text-danger' : 'text-primary'}`}>{i.recipe.length ? pct(margin) : '—'}</Td>
              <Td>{i.active ? <Badge tone="green">{T('متاح')}</Badge> : <Badge>{T('موقوف')}</Badge>}</Td>
            </tr>
          );
        })}
      </Table>
      {edit && <ItemDialog item={edit} data={d} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); data.reload(true); }} />}
    </>
  );
}

function ItemDialog({ item, data, onClose, onSaved }) {
  const [f, setF] = useState({ ...item, price: minorInput(item.price_minor) });
  const [image, setImage] = useState('');
  const [busy, run] = useAction();
  const ing = Object.fromEntries(data.ingredients.map((g) => [g.id, g]));
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const recipeCost = f.recipe.reduce((s, r) => s + Math.round(((ing[r.ingredient_id]?.cost_minor || 0) * (r.qty_milli || 0)) / 1000), 0);

  const pickImage = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setImage(reader.result);
    reader.readAsDataURL(file);
  };
  const save = () => run(async () => {
    const price = toMinor(f.price);
    if (price == null) throw new Error(T('السعر غير صحيح'));
    await api.post('/items', { ...f, price_minor: price, sort: Number(f.sort) || 0, image_data: image, recipe: f.recipe.filter((r) => r.ingredient_id && r.qty_milli > 0) });
    toast(T('تم الحفظ'));
    onSaved();
  });

  return (
    <Modal open onClose={onClose} title={item.id ? item.name : T('صنف جديد')} size="xl"
      footer={<><Button variant="secondary" onClick={onClose}>{T('إلغاء')}</Button><Button busy={busy} onClick={save}>{T('حفظ')}</Button></>}>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="grid content-start gap-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label={T('اسم الصنف')} className="col-span-2"><Input autoFocus value={f.name} onChange={set('name')} /></Field>
            <Field label={T('السعر')}><Input className="num" value={f.price} onChange={set('price')} /></Field>
            <Field label={T('الكود')} hint={T('يُولَّد تلقائياً إن تُرك فارغاً')}><Input className="num" value={f.code} onChange={set('code')} /></Field>
            <Field label={T('القسم')}>
              <Select value={f.category_id} onChange={set('category_id')}>
                <option value="">{T('— بدون —')}</option>{data.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
            <Field label={T('الترتيب')}><Input type="number" value={f.sort} onChange={set('sort')} /></Field>
          </div>
          <Field label={T('الوصف')}><Textarea value={f.description} onChange={set('description')} /></Field>
          <div className="flex items-center gap-3">
            {(image || f.image) && <img src={image || f.image} className="size-20 rounded-lg object-cover" alt="" />}
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-line px-3 py-2">
              <ImagePlus className="size-4" />{T('صورة')}<input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={pickImage} />
            </label>
            <Checkbox label={T('متاح للبيع')} checked={f.active} onChange={(v) => setF({ ...f, active: v })} />
          </div>
          <Field label={T('مجموعات الإضافات')}>
            <div className="flex flex-wrap gap-2">
              {data.groups.map((g) => {
                const on = f.modifier_group_ids.includes(g.id);
                return (
                  <Button key={g.id} size="sm" variant={on ? 'primary' : 'secondary'}
                    onClick={() => setF({ ...f, modifier_group_ids: on ? f.modifier_group_ids.filter((x) => x !== g.id) : [...f.modifier_group_ids, g.id] })}>
                    {g.name}
                  </Button>
                );
              })}
              {!data.groups.length && <span className="text-sm text-muted/70">{T('لا توجد مجموعات إضافات')}</span>}
            </div>
          </Field>
        </div>
        <RecipeEditor title={T('الوصفة (الخامات المستهلكة لكل وحدة)')} recipe={f.recipe} ingredients={data.ingredients}
          onChange={(recipe) => setF({ ...f, recipe })}
          footer={<div className="flex justify-between font-semibold"><span>{T('تكلفة الوصفة')}</span>
            <span className="num">{money(recipeCost)} {toMinor(f.price) ? T('— هامش {0}', [pct(Math.round(((toMinor(f.price) - recipeCost) / toMinor(f.price)) * 10000))]) : ''}</span></div>} />
      </div>
    </Modal>
  );
}

export function RecipeEditor({ title, recipe, ingredients, onChange, footer }) {
  const ing = Object.fromEntries(ingredients.map((g) => [g.id, g]));
  const [draft, setDraft] = useState({});
  const update = (i, patch) => onChange(recipe.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="rounded-xl bg-surface-2 p-3">
      <div className="mb-2 font-bold">{title}</div>
      {!ingredients.length && <div className="text-sm text-muted">{T('أضف الخامات أولاً من صفحة المخزون')}</div>}
      <div className="grid gap-2">
        {recipe.map((r, i) => (
          <div key={i} className="flex items-center gap-2">
            <Select className="flex-1" value={r.ingredient_id} onChange={(e) => update(i, { ingredient_id: e.target.value })}>
              <option value="">{T('— خامة —')}</option>
              {ingredients.filter((g) => g.active || g.id === r.ingredient_id).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </Select>
            <Input className="num w-24" value={draft[i] ?? milliInput(r.qty_milli)}
              onChange={(e) => { setDraft({ ...draft, [i]: e.target.value }); const m = toMilli(e.target.value); if (m != null) update(i, { qty_milli: m }); }} />
            <span className="w-12 text-sm text-muted">{units[ing[r.ingredient_id]?.unit] || ''}</span>
            <button onClick={() => onChange(recipe.filter((_, j) => j !== i))}><Trash2 className="size-4 text-danger" /></button>
          </div>
        ))}
      </div>
      <Button size="sm" variant="secondary" className="mt-2" disabled={!ingredients.length}
        onClick={() => onChange([...recipe, { ingredient_id: '', qty_milli: 0 }])}><Plus className="size-4" />{T('خامة')}</Button>
      {footer && <div className="mt-3 border-t pt-2">{footer}</div>}
    </div>
  );
}

// ---- categories --------------------------------------------------------------

function Categories() {
  const data = useLoad(async () => ({ cats: await api.get('/categories'), stations: await api.get('/stations') }));
  const [edit, setEdit] = useState(null);
  const [busy, run] = useAction();
  const st = Object.fromEntries((data.data?.stations || []).map((s) => [s.id, s.name]));
  const save = () => run(async () => {
    await api.post('/categories', { ...edit, sort: Number(edit.sort) || 0 });
    setEdit(null);
    data.reload(true);
  });
  return (
    <>
      <Button className="mb-3" onClick={() => setEdit({ name: '', kitchen_station_id: '', sort: 0, active: true })}><Plus className="size-4" />{T('قسم جديد')}</Button>
      <Table head={[T('القسم'), T('محطة المطبخ'), T('الترتيب'), T('الحالة')]}>
        {(data.data?.cats || []).map((c) => (
          <tr key={c.id} className="cursor-pointer hover:bg-surface-2" onClick={() => setEdit(c)}>
            <Td className="font-semibold">{c.name}</Td><Td>{st[c.kitchen_station_id] || '—'}</Td><Td>{c.sort}</Td>
            <Td>{c.active ? <Badge tone="green">{T('ظاهر')}</Badge> : <Badge>{T('مخفي')}</Badge>}</Td>
          </tr>
        ))}
      </Table>
      {edit && (
        <Modal open onClose={() => setEdit(null)} title={T('القسم')} size="sm" footer={<Button busy={busy} onClick={save}>{T('حفظ')}</Button>}>
          <div className="grid gap-3">
            <Field label={T('الاسم')}><Input autoFocus value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label={T('محطة المطبخ')} hint={T('تحدد أي شاشة مطبخ تستقبل أصناف هذا القسم')}>
              <Select value={edit.kitchen_station_id} onChange={(e) => setEdit({ ...edit, kitchen_station_id: e.target.value })}>
                <option value="">{T('— كل الشاشات —')}</option>{data.data.stations.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </Field>
            <Field label={T('الترتيب')}><Input type="number" value={edit.sort} onChange={(e) => setEdit({ ...edit, sort: e.target.value })} /></Field>
            <Checkbox label={T('ظاهر في نقطة البيع')} checked={edit.active} onChange={(v) => setEdit({ ...edit, active: v })} />
          </div>
        </Modal>
      )}
    </>
  );
}

// ---- modifier groups ---------------------------------------------------------

function ModifierGroups() {
  const data = useLoad(async () => ({ groups: await api.get('/modifier-groups'), ingredients: await api.get('/ingredients').catch(() => []) }));
  const [edit, setEdit] = useState(null);
  const [busy, run] = useAction();
  const save = () => run(async () => {
    const modifiers = edit.modifiers.map((m) => ({ ...m, price_minor: toMinor(m.price) ?? 0, recipe: (m.recipe || []).filter((r) => r.ingredient_id && r.qty_milli > 0) }));
    await api.post('/modifier-groups', { ...edit, min_select: Number(edit.min_select) || 0, max_select: Number(edit.max_select) || 0, modifiers });
    setEdit(null);
    data.reload(true);
  });
  const open = (g) => setEdit({ ...g, modifiers: g.modifiers.filter((m) => m.active).map((m) => ({ ...m, price: minorInput(m.price_minor) })) });
  const [recipeFor, setRecipeFor] = useState(null);
  return (
    <>
      <Button className="mb-3" onClick={() => setEdit({ name: '', min_select: 0, max_select: 0, active: true, modifiers: [] })}><Plus className="size-4" />{T('مجموعة جديدة')}</Button>
      <Table head={[T('المجموعة'), T('الاختيار'), T('الإضافات'), T('الحالة')]}>
        {(data.data?.groups || []).map((g) => (
          <tr key={g.id} className="cursor-pointer hover:bg-surface-2" onClick={() => open(g)}>
            <Td className="font-semibold">{g.name}</Td>
            <Td>{g.min_select > 0 ? T('إجباري {0}', [g.min_select]) : T('اختياري')}{g.max_select ? ` ${T('— حتى {0}', [g.max_select])}` : ''}</Td>
            <Td>{g.modifiers.filter((m) => m.active).map((m) => m.name).join(lang === 'ar' ? '، ' : ', ')}</Td>
            <Td>{g.active ? <Badge tone="green">{T('مفعّل')}</Badge> : <Badge>{T('موقوف')}</Badge>}</Td>
          </tr>
        ))}
      </Table>
      {edit && (
        <Modal open onClose={() => setEdit(null)} title={T('مجموعة إضافات')} size="lg" footer={<Button busy={busy} onClick={save}>{T('حفظ')}</Button>}>
          <div className="grid gap-3">
            <div className="grid grid-cols-3 gap-3">
              <Field label={T('الاسم')} className="col-span-3"><Input autoFocus value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder={T('الحجم، الإضافات، درجة الاستواء…')} /></Field>
              <Field label={T('أقل عدد للاختيار')} hint={T('1 = إجباري')}><Input type="number" min={0} value={edit.min_select} onChange={(e) => setEdit({ ...edit, min_select: e.target.value })} /></Field>
              <Field label={T('أقصى عدد')} hint={T('0 = بلا حد، 1 = اختيار واحد')}><Input type="number" min={0} value={edit.max_select} onChange={(e) => setEdit({ ...edit, max_select: e.target.value })} /></Field>
              <div className="flex items-end pb-2"><Checkbox label={T('مفعّلة')} checked={edit.active} onChange={(v) => setEdit({ ...edit, active: v })} /></div>
            </div>
            {edit.modifiers.map((m, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input className="flex-1" placeholder={T('الاسم')} value={m.name} onChange={(e) => setEdit({ ...edit, modifiers: edit.modifiers.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
                <Input className="num w-28" placeholder={T('السعر')} value={m.price} onChange={(e) => setEdit({ ...edit, modifiers: edit.modifiers.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)) })} />
                <Button size="sm" variant="secondary" onClick={() => setRecipeFor(i)}>{T('وصفة (')}{(m.recipe || []).length})</Button>
                <button onClick={() => setEdit({ ...edit, modifiers: edit.modifiers.filter((_, j) => j !== i) })}><Trash2 className="size-4 text-danger" /></button>
              </div>
            ))}
            <Button variant="secondary" onClick={() => setEdit({ ...edit, modifiers: [...edit.modifiers, { name: '', price: '', active: true, recipe: [] }] })}><Plus className="size-4" />{T('إضافة')}</Button>
          </div>
          {recipeFor != null && (
            <Modal open onClose={() => setRecipeFor(null)} title={T('وصفة: {0}', [edit.modifiers[recipeFor].name])} footer={<Button onClick={() => setRecipeFor(null)}>{T('تم')}</Button>}>
              <RecipeEditor title={T('الخامات المستهلكة عند اختيار هذه الإضافة')} recipe={edit.modifiers[recipeFor].recipe || []} ingredients={data.data.ingredients}
                onChange={(recipe) => setEdit({ ...edit, modifiers: edit.modifiers.map((x, j) => (j === recipeFor ? { ...x, recipe } : x)) })} />
            </Modal>
          )}
        </Modal>
      )}
    </>
  );
}

// ---- tables & stations --------------------------------------------------------

function Tables() {
  const data = useLoad(() => api.get('/tables'));
  const [edit, setEdit] = useState(null);
  const [bulk, setBulk] = useState(null);
  const [busy, run] = useAction();
  const save = () => run(async () => {
    await api.post('/tables', { ...edit, seats: Number(edit.seats) || 4, sort: Number(edit.sort) || 0 });
    setEdit(null);
    data.reload(true);
  });
  const addBulk = () => run(async () => {
    const n = Number(bulk.count) || 0;
    const start = Number(bulk.start) || 1;
    for (let i = 0; i < n; i++) await api.post('/tables', { name: `${bulk.prefix}${start + i}`, area: bulk.area, seats: Number(bulk.seats) || 4, sort: start + i, active: true });
    setBulk(null);
    data.reload(true);
  });
  return (
    <>
      <div className="mb-3 flex gap-2">
        <Button onClick={() => setEdit({ name: '', area: '', seats: 4, sort: 0, active: true })}><Plus className="size-4" />{T('طاولة')}</Button>
        <Button variant="secondary" onClick={() => setBulk({ prefix: 'T', start: 1, count: 10, area: T('الصالة'), seats: 4 })}>{T('إضافة مجموعة طاولات')}</Button>
      </div>
      <Table head={[T('الطاولة'), T('المنطقة'), T('المقاعد'), T('الحالة')]}>
        {(data.data || []).map((t) => (
          <tr key={t.id} className="cursor-pointer hover:bg-surface-2" onClick={() => setEdit(t)}>
            <Td className="font-semibold">{t.name}</Td><Td>{t.area}</Td><Td>{t.seats}</Td>
            <Td>{t.active ? <Badge tone="green">{T('مفعّلة')}</Badge> : <Badge>{T('موقوفة')}</Badge>}</Td>
          </tr>
        ))}
      </Table>
      {edit && (
        <Modal open onClose={() => setEdit(null)} title={T('طاولة')} size="sm" footer={<Button busy={busy} onClick={save}>{T('حفظ')}</Button>}>
          <div className="grid gap-3">
            <Field label={T('الاسم / الرقم')}><Input autoFocus value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label={T('المنطقة')}><Input value={edit.area} onChange={(e) => setEdit({ ...edit, area: e.target.value })} placeholder={T('الصالة، التراس، الدور الثاني')} /></Field>
            <Field label={T('عدد المقاعد')}><Input type="number" value={edit.seats} onChange={(e) => setEdit({ ...edit, seats: e.target.value })} /></Field>
            <Checkbox label={T('مفعّلة')} checked={edit.active} onChange={(v) => setEdit({ ...edit, active: v })} />
          </div>
        </Modal>
      )}
      {bulk && (
        <Modal open onClose={() => setBulk(null)} title={T('إضافة مجموعة طاولات')} size="sm" footer={<Button busy={busy} onClick={addBulk}>{T('إضافة')}</Button>}>
          <div className="grid grid-cols-2 gap-3">
            <Field label={T('البادئة')}><Input value={bulk.prefix} onChange={(e) => setBulk({ ...bulk, prefix: e.target.value })} /></Field>
            <Field label={T('يبدأ من')}><Input type="number" value={bulk.start} onChange={(e) => setBulk({ ...bulk, start: e.target.value })} /></Field>
            <Field label={T('العدد')}><Input type="number" value={bulk.count} onChange={(e) => setBulk({ ...bulk, count: e.target.value })} /></Field>
            <Field label={T('المقاعد')}><Input type="number" value={bulk.seats} onChange={(e) => setBulk({ ...bulk, seats: e.target.value })} /></Field>
            <Field label={T('المنطقة')} className="col-span-2"><Input value={bulk.area} onChange={(e) => setBulk({ ...bulk, area: e.target.value })} /></Field>
          </div>
        </Modal>
      )}
    </>
  );
}

function Stations() {
  const data = useLoad(() => api.get('/stations'));
  const [edit, setEdit] = useState(null);
  const [busy, run] = useAction();
  const save = () => run(async () => {
    await api.post('/stations', edit);
    setEdit(null);
    data.reload(true);
  });
  return (
    <>
      <p className="mb-3 text-sm text-muted">{T('قسّم المطبخ لمحطات (مشويات، مشروبات، حلويات…) واربط كل قسم من المنيو بمحطة، ثم افتح شاشة المطبخ على كل محطة.')}</p>
      <Button className="mb-3" onClick={() => setEdit({ name: '', printer: '', active: true })}><Plus className="size-4" />{T('محطة')}</Button>
      <Table head={[T('المحطة'), T('الحالة')]}>
        {(data.data || []).map((s) => (
          <tr key={s.id} className="cursor-pointer hover:bg-surface-2" onClick={() => setEdit(s)}>
            <Td className="font-semibold">{s.name}</Td><Td>{s.active ? <Badge tone="green">{T('مفعّلة')}</Badge> : <Badge>{T('موقوفة')}</Badge>}</Td>
          </tr>
        ))}
      </Table>
      {edit && (
        <Modal open onClose={() => setEdit(null)} title={T('محطة مطبخ')} size="sm" footer={<Button busy={busy} onClick={save}>{T('حفظ')}</Button>}>
          <div className="grid gap-3">
            <Field label={T('الاسم')}><Input autoFocus value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Checkbox label={T('مفعّلة')} checked={edit.active} onChange={(v) => setEdit({ ...edit, active: v })} />
          </div>
        </Modal>
      )}
    </>
  );
}
