import { useState } from 'react';
import { Plus, UserCog } from 'lucide-react';
import { api } from '@/lib/api';
import { useApp, toast } from '@/lib/store';
import { roles, dateTime } from '@/lib/format';
import { Badge, Button, Checkbox, Field, Input, Modal, PageHeader, Select, Table, Td, useLoad, useAction } from '@/components/ui';
import { T } from '@/lib/i18n';

const roleHelp = {
  owner: T('كل الصلاحيات'),
  manager: T('كل شيء عدا المستخدمين والإعدادات — ويوافق على الإلغاء والخصم والمرتجع'),
  cashier: T('البيع والدفع والوردية'),
  waiter: T('فتح الطلبات وإرسالها للمطبخ بدون تحصيل'),
  kitchen: T('شاشة المطبخ وتسجيل الهالك'),
};

export default function Users() {
  const me = useApp((s) => s.me);
  const list = useLoad(() => api.get('/users'));
  const [edit, setEdit] = useState(null);
  const [busy, run] = useAction();
  const save = () => run(async () => {
    if (edit.id) await api.put(`/users/${edit.id}`, edit);
    else await api.post('/users', edit);
    toast(T('تم الحفظ'));
    setEdit(null);
    list.reload(true);
  });
  return (
    <div>
      <PageHeader title={T('المستخدمون')} icon={UserCog} subtitle={T('الحسابات والأدوار والأرقام السرية')} crumb={T('الإدارة')}>
        <Button onClick={() => setEdit({ full_name: '', username: '', role: 'cashier', password: '', pin: '', active: true })}><Plus className="size-4" />{T('مستخدم')}</Button>
      </PageHeader>
      <Table head={[T('الاسم'), T('اسم المستخدم'), T('الدور'), T('رقم سري'), T('الحالة'), T('أُنشئ')]}>
        {(list.data || []).map((u) => (
          <tr key={u.id} className="cursor-pointer hover:bg-surface-2" onClick={() => setEdit({ ...u, password: '', pin: '' })}>
            <Td className="font-semibold">{u.full_name}</Td><Td className="num">{u.username}</Td><Td>{roles[u.role]}</Td>
            <Td>{u.has_pin ? '✓' : '—'}</Td>
            <Td>{u.active ? <Badge tone="green">{T('نشط')}</Badge> : <Badge tone="red">{T('معطّل')}</Badge>}</Td>
            <Td>{dateTime(u.created_at)}</Td>
          </tr>
        ))}
      </Table>
      {edit && (
        <Modal open onClose={() => setEdit(null)} title={edit.id ? edit.full_name : T('مستخدم جديد')} footer={<Button busy={busy} onClick={save}>{T('حفظ')}</Button>}>
          <div className="grid grid-cols-2 gap-3">
            <Field label={T('الاسم')}><Input autoFocus value={edit.full_name} onChange={(e) => setEdit({ ...edit, full_name: e.target.value })} /></Field>
            <Field label={T('اسم المستخدم')}><Input disabled={!!edit.id} value={edit.username} onChange={(e) => setEdit({ ...edit, username: e.target.value })} /></Field>
            <Field label={T('الدور')} className="col-span-2" hint={roleHelp[edit.role]}>
              <Select value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value })}>
                {Object.entries(roles).filter(([k]) => k !== 'owner' || me.role === 'owner').map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
            </Field>
            <Field label={edit.id ? T('كلمة مرور جديدة (اختياري)') : T('كلمة المرور')} hint={T('8 أحرف على الأقل وتحتوي حرفاً ورقماً')}>
              <Input type="password" value={edit.password} onChange={(e) => setEdit({ ...edit, password: e.target.value })} />
            </Field>
            <Field label={edit.id ? T('رقم سري جديد (اختياري)') : T('الرقم السري للدخول السريع')} hint={T('4–6 أرقام')}>
              <Input inputMode="numeric" maxLength={6} value={edit.pin} onChange={(e) => setEdit({ ...edit, pin: e.target.value.replace(/\D/g, '') })} />
            </Field>
            <Checkbox label={T('نشط')} checked={edit.active} onChange={(v) => setEdit({ ...edit, active: v })} />
          </div>
          {edit.id && <p className="mt-3 text-sm text-muted">{T('تعطيل المستخدم أو تغيير كلمة المرور يُخرجه من كل الأجهزة فوراً.')}</p>}
        </Modal>
      )}
    </div>
  );
}
