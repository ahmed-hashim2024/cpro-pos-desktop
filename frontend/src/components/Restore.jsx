import { useRef, useState } from 'react';
import { RotateCcw, Upload } from 'lucide-react';
import { api } from '@/lib/api';
import { toastError } from '@/lib/store';
import { Button, Card, Modal, Spinner } from '@/components/ui';
import { T } from '@/lib/i18n';

// Shown until the window closes: the app starts again on the restored data.
function Restarting() {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-bg">
      <Spinner />
      <p className="font-bold">{T('تم الاسترجاع، وجارٍ إعادة تشغيل البرنامج…')}</p>
    </div>
  );
}

function PickButton({ busy, onPick, children }) {
  const input = useRef(null);
  return (
    <>
      <input ref={input} type="file" accept=".db" hidden onChange={(e) => { const f = e.target.files[0]; e.target.value = ''; if (f) onPick(f); }} />
      <Button variant="secondary" busy={busy} onClick={() => input.current.click()}><Upload className="size-4" />{children}</Button>
    </>
  );
}

// On a new computer of a returning owner: carry on from a backup.
export function RestoreFirstRun() {
  const [state, setState] = useState('idle');
  const upload = async (file) => {
    setState('busy');
    try {
      await api.upload('/setup/restore', file);
      setState('done');
    } catch (e) {
      toastError(e);
      setState('idle');
    }
  };
  return (
    <div className="grid gap-2 rounded-card border border-line bg-surface p-4 shadow-card">
      <div>
        <h3 className="font-bold">{T('هل لديك نسخة احتياطية؟')}</h3>
        <p className="text-sm text-muted">{T('ارفعها لمتابعة العمل بجميع بياناتك ومستخدميك كما كانت.')}</p>
      </div>
      <PickButton busy={state === 'busy'} onPick={upload}>{T('رفع نسخة احتياطية')}</PickButton>
      {state === 'done' && <Restarting />}
    </div>
  );
}

export function RestoreCard({ onPick }) {
  return (
    <Card title={T('استرجاع نسخة احتياطية')} icon={RotateCcw}>
      <p className="mb-3 text-sm text-muted">{T('ارفع ملف نسخة احتياطية (‎.db) من هذا الجهاز أو من وسيط آخر، مثل ذاكرة USB أو مجلد النسخ الاحتياطية.')}</p>
      <PickButton onPick={onPick}>{T('رفع نسخة احتياطية')}</PickButton>
    </Card>
  );
}

// target: { file } uploaded from anywhere, or { name } kept on this computer.
export function RestoreConfirm({ target, onClose }) {
  const [state, setState] = useState('idle');
  const confirm = async () => {
    setState('busy');
    try {
      if (target.file) await api.upload('/backups/restore', target.file);
      else await api.post(`/backups/restore?name=${encodeURIComponent(target.name)}`);
      setState('done');
    } catch (e) {
      toastError(e);
      setState('idle');
      onClose();
    }
  };
  if (state === 'done') return <Restarting />;
  return (
    <Modal open={!!target} onClose={onClose} title={T('استرجاع نسخة احتياطية')} footer={(
      <>
        <Button variant="danger" busy={state === 'busy'} onClick={confirm}>{T('استرجاع وإعادة التشغيل')}</Button>
        <Button variant="secondary" onClick={onClose}>{T('إلغاء')}</Button>
      </>
    )}>
      <p dir="auto" className="num mb-2 font-bold">{target?.file?.name || target?.name}</p>
      <p>{T('ستُستبدل جميع بيانات هذا الجهاز ببيانات هذه النسخة. وستُنشأ أولاً نسخة من البيانات الحالية، فيمكنك الرجوع إليها من الشاشة نفسها.')}</p>
    </Modal>
  );
}
