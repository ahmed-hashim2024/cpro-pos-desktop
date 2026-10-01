import { useState } from 'react';
import { Plus, Users } from 'lucide-react';
import { api } from '@/lib/api';
import { useApp, toast } from '@/lib/store';
import { money, dateTime } from '@/lib/format';
import { exportCSV } from '@/lib/csv';
import { Button, Field, Input, Modal, PageHeader, Table, Td, Textarea, useLoad, useAction } from '@/components/ui';
import { T } from '@/lib/i18n';

export default function Customers() {
  const can = useApp((s) => s.can);
  const [q, setQ] = useState('');
  const list = useLoad(() => api.get('/customers', { q }), [q]);
  const [edit, setEdit] = useState(null);
  const [busy, run] = useAction();
  const save = () => run(async () => { await api.post('/customers', edit); toast(T('تم الحفظ')); setEdit(null); list.reload(true); });
  return (
    <div>
      <PageHeader title={T('العملاء')} icon={Users} subtitle={T('بيانات العملاء وسجل مشترياتهم')} crumb={T('العملاء')}>
        <Input className="w-64" placeholder={T('بحث بالاسم أو الهاتف')} value={q} onChange={(e) => setQ(e.target.value)} />
        <Button onClick={() => setEdit({ name: '', phone: '', address: '', notes: '' })}><Plus className="size-4" />{T('عميل')}</Button>
        <Button variant="secondary" onClick={() => exportCSV('customers', [T('الاسم'), T('الهاتف'), T('العنوان'), T('عدد الطلبات'), T('إجمالي المشتريات'), T('آخر طلب')],
          (list.data || []).map((c) => [c.name, c.phone, c.address, c.orders, money(c.total_spent_minor), dateTime(c.last_order_at)]))}>{T('تصدير Excel')}</Button>
      </PageHeader>
      <Table head={[T('الاسم'), T('الهاتف'), T('العنوان'), T('الطلبات'), T('إجمالي المشتريات'), T('آخر طلب')]}>
        {(list.data || []).map((c) => (
          <tr key={c.id} className={can('customers.manage') ? 'cursor-pointer hover:bg-surface-2' : ''} onClick={() => can('customers.manage') && setEdit(c)}>
            <Td className="font-semibold">{c.name}</Td><Td className="num">{c.phone}</Td><Td>{c.address}</Td>
            <Td>{c.orders}</Td><Td className="num">{money(c.total_spent_minor)}</Td><Td>{dateTime(c.last_order_at)}</Td>
          </tr>
        ))}
      </Table>
      {edit && (
        <Modal open onClose={() => setEdit(null)} title={T('عميل')} footer={<Button busy={busy} onClick={save}>{T('حفظ')}</Button>}>
          <div className="grid grid-cols-2 gap-3">
            <Field label={T('الاسم')}><Input autoFocus value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label={T('الهاتف')}><Input className="num" value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></Field>
            <Field label={T('العنوان')} className="col-span-2"><Textarea value={edit.address} onChange={(e) => setEdit({ ...edit, address: e.target.value })} /></Field>
            <Field label={T('ملاحظات')} className="col-span-2"><Input value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></Field>
          </div>
        </Modal>
      )}
    </div>
  );
}
