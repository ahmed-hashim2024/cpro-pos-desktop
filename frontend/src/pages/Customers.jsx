import { useState } from 'react';
import { Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { useApp, toast } from '@/lib/store';
import { money, dateTime } from '@/lib/format';
import { exportCSV } from '@/lib/csv';
import { Button, Field, Input, Modal, PageHeader, Table, Td, Textarea, useLoad, useAction } from '@/components/ui';

export default function Customers() {
  const can = useApp((s) => s.can);
  const [q, setQ] = useState('');
  const list = useLoad(() => api.get('/customers', { q }), [q]);
  const [edit, setEdit] = useState(null);
  const [busy, run] = useAction();
  const save = () => run(async () => { await api.post('/customers', edit); toast('تم الحفظ'); setEdit(null); list.reload(true); });
  return (
    <div className="p-5">
      <PageHeader title="العملاء">
        <Input className="w-64" placeholder="بحث بالاسم أو الهاتف" value={q} onChange={(e) => setQ(e.target.value)} />
        <Button onClick={() => setEdit({ name: '', phone: '', address: '', notes: '' })}><Plus className="size-4" />عميل</Button>
        <Button variant="secondary" onClick={() => exportCSV('customers', ['الاسم', 'الهاتف', 'العنوان', 'عدد الطلبات', 'إجمالي المشتريات', 'آخر طلب'],
          (list.data || []).map((c) => [c.name, c.phone, c.address, c.orders, money(c.total_spent_minor), dateTime(c.last_order_at)]))}>تصدير Excel</Button>
      </PageHeader>
      <Table head={['الاسم', 'الهاتف', 'العنوان', 'الطلبات', 'إجمالي المشتريات', 'آخر طلب']}>
        {(list.data || []).map((c) => (
          <tr key={c.id} className={can('customers.manage') ? 'cursor-pointer hover:bg-stone-50' : ''} onClick={() => can('customers.manage') && setEdit(c)}>
            <Td className="font-semibold">{c.name}</Td><Td className="num">{c.phone}</Td><Td>{c.address}</Td>
            <Td>{c.orders}</Td><Td className="num">{money(c.total_spent_minor)}</Td><Td>{dateTime(c.last_order_at)}</Td>
          </tr>
        ))}
      </Table>
      {edit && (
        <Modal open onClose={() => setEdit(null)} title="عميل" footer={<Button busy={busy} onClick={save}>حفظ</Button>}>
          <div className="grid grid-cols-2 gap-3">
            <Field label="الاسم"><Input autoFocus value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="الهاتف"><Input className="num" value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></Field>
            <Field label="العنوان" className="col-span-2"><Textarea value={edit.address} onChange={(e) => setEdit({ ...edit, address: e.target.value })} /></Field>
            <Field label="ملاحظات" className="col-span-2"><Input value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></Field>
          </div>
        </Modal>
      )}
    </div>
  );
}
