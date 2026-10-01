import { create } from 'zustand';
import { AlertTriangle } from 'lucide-react';
import { T } from '@/lib/i18n';
import { Modal, Button } from './ui';

// confirm({ title, message, action }) → Promise<boolean>, rendered by <ConfirmModal/>.
const useConfirm = create(() => ({ open: false }));

export function confirm({ title, message, action }) {
  return new Promise((resolve) => useConfirm.setState({ open: true, title, message, action, resolve }));
}

export function ConfirmModal() {
  const { open, title, message, action, resolve } = useConfirm();
  const close = (v) => { resolve?.(v); useConfirm.setState({ open: false, resolve: null }); };
  return (
    <Modal open={open} onClose={() => close(false)} title={title} icon={AlertTriangle} size="sm"
      footer={<><Button variant="secondary" onClick={() => close(false)}>{T('إلغاء')}</Button><Button variant="danger" autoFocus onClick={() => close(true)}>{action || T('حذف')}</Button></>}>
      <p className="text-fg">{message}</p>
    </Modal>
  );
}
