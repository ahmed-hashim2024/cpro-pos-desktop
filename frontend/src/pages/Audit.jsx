import { useState } from 'react';
import { ScrollText } from 'lucide-react';
import { api } from '@/lib/api';
import { dateTime, today, money } from '@/lib/format';
import { exportCSV } from '@/lib/csv';
import { Button, DateRange, PageHeader, Select, Table, Td, useLoad } from '@/components/ui';
import { T } from '@/lib/i18n';

const actions = {
  'auth.login': T('تسجيل دخول'), 'auth.login_failed': T('محاولة دخول فاشلة'), setup: T('إعداد النظام'),
  'order.pay': T('دفع طلب'), 'order.void': T('إلغاء طلب'), 'order.void_line': T('إلغاء صنف'), 'order.discount': T('خصم على طلب'),
  'order.line_discount': T('خصم على صنف'), 'order.refund': T('مرتجع'), 'order.merge': T('دمج طلبات'), 'order.transfer_table': T('نقل طاولة'),
  'shift.open': T('فتح وردية'), 'shift.close': T('إغلاق وردية'), 'shift.cash_in': T('إيداع نقدي'), 'shift.cash_out': T('صرف نقدي'), 'shift.recount': T('تصحيح عد وردية'),
  'item.save': T('تعديل صنف'), 'category.save': T('تعديل قسم'), 'modifier_group.save': T('تعديل إضافات'), 'table.save': T('تعديل طاولة'), 'station.save': T('تعديل محطة'),
  'ingredient.save': T('تعديل خامة'), 'stock.adjust': T('تسوية مخزون'), 'purchase.receive': T('استلام مشتريات'), 'waste.record': T('تسجيل هالك'),
  'count.start': T('بدء جرد'), 'count.post': T('ترحيل جرد'), 'count.cancel': T('إلغاء جرد'),
  'user.create': T('إضافة مستخدم'), 'user.update': T('تعديل مستخدم'), 'user.change_password': T('تغيير كلمة المرور'),
  'settings.update': T('تعديل الإعدادات'),
  'item.delete': T('حذف صنف'), 'category.delete': T('حذف قسم'), 'table.delete': T('حذف طاولة'), 'station.delete': T('حذف محطة'),
  'modifier_group.delete': T('حذف مجموعة إضافات'), 'catalog.set_active': T('إظهار / إخفاء'), 'import.insert': T('استيراد (إضافة)'), 'import.update': T('استيراد (تحديث)'), 'backup.create': T('نسخة احتياطية'), 'device.revoke': T('إيقاف جهاز'), 'customer.save': T('تعديل عميل'),
};

const groups = [['', T('الكل')], ['order', T('الطلبات')], ['shift', T('الورديات')], ['auth', T('الدخول')], ['stock', T('المخزون')], ['count', T('الجرد')], ['user', T('المستخدمون')], ['settings', T('الإعدادات')]];

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
    <div>
      <PageHeader title={T('سجل النشاط')} icon={ScrollText} subtitle={T('كل عملية مسجلة بالمستخدم والجهاز والوقت')} crumb={T('الإدارة')}>
        <DateRange from={f.from} to={f.to} onChange={(from, to) => setF({ ...f, from, to })} />
        <Select className="w-40" value={f.action} onChange={(e) => setF({ ...f, action: e.target.value })}>
          {groups.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <Button variant="secondary" onClick={() => exportCSV('audit', [T('الوقت'), T('المستخدم'), T('الجهاز'), T('القناة'), T('الإجراء'), T('التفاصيل')],
          (list.data || []).map((e) => [dateTime(e.at), e.user_name, e.device_name, e.channel, actions[e.action] || e.action, details(e.data)]))}>{T('تصدير Excel')}</Button>
      </PageHeader>
      <p className="mb-3 text-sm text-muted">{T('السجل للقراءة فقط ولا يمكن تعديله أو حذفه من أي مستخدم.')}</p>
      <Table head={[T('الوقت'), T('المستخدم'), T('الجهاز'), T('الإجراء'), T('التفاصيل')]}>
        {(list.data || []).map((e) => (
          <tr key={e.id} className={e.action.includes('void') || e.action.includes('failed') || e.action.includes('refund') ? 'bg-danger-soft' : ''}>
            <Td className="whitespace-nowrap">{dateTime(e.at)}</Td><Td>{e.user_name}</Td><Td>{e.device_name}</Td>
            <Td className="font-semibold">{actions[e.action] || e.action}</Td><Td className="text-xs text-muted">{details(e.data)}</Td>
          </tr>
        ))}
      </Table>
    </div>
  );
}
