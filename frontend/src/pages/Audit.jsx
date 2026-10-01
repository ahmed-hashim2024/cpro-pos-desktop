import { useState } from 'react';
import { api } from '@/lib/api';
import { dateTime, today, money } from '@/lib/format';
import { exportCSV } from '@/lib/csv';
import { Button, DateRange, PageHeader, Select, Table, Td, useLoad } from '@/components/ui';

const actions = {
  'auth.login': 'تسجيل دخول', 'auth.login_failed': 'محاولة دخول فاشلة', setup: 'إعداد النظام',
  'order.pay': 'دفع طلب', 'order.void': 'إلغاء طلب', 'order.void_line': 'إلغاء صنف', 'order.discount': 'خصم على طلب',
  'order.line_discount': 'خصم على صنف', 'order.refund': 'مرتجع', 'order.merge': 'دمج طلبات', 'order.transfer_table': 'نقل طاولة',
  'shift.open': 'فتح وردية', 'shift.close': 'إغلاق وردية', 'shift.cash_in': 'إيداع نقدي', 'shift.cash_out': 'صرف نقدي',
  'item.save': 'تعديل صنف', 'category.save': 'تعديل قسم', 'modifier_group.save': 'تعديل إضافات', 'table.save': 'تعديل طاولة', 'station.save': 'تعديل محطة',
  'ingredient.save': 'تعديل خامة', 'stock.adjust': 'تسوية مخزون', 'purchase.receive': 'استلام مشتريات', 'waste.record': 'تسجيل هالك',
  'count.start': 'بدء جرد', 'count.post': 'ترحيل جرد', 'count.cancel': 'إلغاء جرد',
  'user.create': 'إضافة مستخدم', 'user.update': 'تعديل مستخدم', 'user.change_password': 'تغيير كلمة المرور',
  'settings.update': 'تعديل الإعدادات', 'backup.create': 'نسخة احتياطية', 'device.revoke': 'إيقاف جهاز', 'customer.save': 'تعديل عميل',
};

const groups = [['', 'الكل'], ['order', 'الطلبات'], ['shift', 'الورديات'], ['auth', 'الدخول'], ['stock', 'المخزون'], ['count', 'الجرد'], ['user', 'المستخدمون'], ['settings', 'الإعدادات']];

// Render the stored JSON details in a readable way (money fields formatted).
function details(raw) {
  try {
    const d = JSON.parse(raw);
    return Object.entries(d).filter(([k, v]) => k !== 'id' && v !== '' && v !== null && typeof v !== 'object')
      .map(([k, v]) => `${k}: ${/amount|total|float|expected|counted|cost/.test(k) && typeof v === 'number' ? money(v) : v}`).join(' · ');
  } catch {
    return raw;
  }
}

export default function Audit() {
  const [f, setF] = useState({ from: today(), to: today(), action: '' });
  const list = useLoad(() => api.get('/audit', f), [f.from, f.to, f.action]);
  return (
    <div className="p-5">
      <PageHeader title="سجل النشاط">
        <DateRange from={f.from} to={f.to} onChange={(from, to) => setF({ ...f, from, to })} />
        <Select className="w-40" value={f.action} onChange={(e) => setF({ ...f, action: e.target.value })}>
          {groups.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <Button variant="secondary" onClick={() => exportCSV('audit', ['الوقت', 'المستخدم', 'الجهاز', 'القناة', 'الإجراء', 'التفاصيل'],
          (list.data || []).map((e) => [dateTime(e.at), e.user_name, e.device_name, e.channel, actions[e.action] || e.action, details(e.data)]))}>تصدير Excel</Button>
      </PageHeader>
      <p className="mb-3 text-sm text-stone-500">السجل للقراءة فقط ولا يمكن تعديله أو حذفه من أي مستخدم.</p>
      <Table head={['الوقت', 'المستخدم', 'الجهاز', 'الإجراء', 'التفاصيل']}>
        {(list.data || []).map((e) => (
          <tr key={e.id} className={e.action.includes('void') || e.action.includes('failed') || e.action.includes('refund') ? 'bg-red-50/50' : ''}>
            <Td className="whitespace-nowrap">{dateTime(e.at)}</Td><Td>{e.user_name}</Td><Td>{e.device_name}</Td>
            <Td className="font-semibold">{actions[e.action] || e.action}</Td><Td className="text-xs text-stone-600">{details(e.data)}</Td>
          </tr>
        ))}
      </Table>
    </div>
  );
}
