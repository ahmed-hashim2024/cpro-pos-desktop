import { useState } from 'react';
import { create } from 'zustand';
import { ShieldCheck } from 'lucide-react';
import { Modal, Button, Input } from './ui';
import { T } from '@/lib/i18n';

// When a cashier does something that needs a manager (void after sending to
// the kitchen, discount, refund) the server answers 403 asking for approval.
// withApproval() then asks for a manager PIN and retries the same call.

const usePIN = create((set) => ({ open: false, resolve: null, set }));

function askPIN() {
  return new Promise((resolve) => usePIN.setState({ open: true, resolve }));
}

export async function withApproval(fn) {
  try {
    return await fn('');
  } catch (e) {
    // Match the server's original (untranslated) message.
    if (e.status !== 403 || !e.raw?.includes('موافقة المدير')) throw e;
    const pin = await askPIN();
    if (!pin) return undefined;
    return fn(pin);
  }
}

export function ApprovalModal() {
  const { open, resolve } = usePIN();
  const [pin, setPin] = useState('');
  const close = (value) => {
    resolve?.(value);
    setPin('');
    usePIN.setState({ open: false, resolve: null });
  };
  return (
    <Modal open={open} onClose={() => close(null)} title={T('موافقة المدير')} size="sm"
      footer={<><Button variant="secondary" onClick={() => close(null)}>{T('إلغاء')}</Button><Button onClick={() => close(pin)} disabled={pin.length < 4}>{T('موافقة')}</Button></>}>
      <div className="flex flex-col items-center gap-3">
        <ShieldCheck className="size-10 text-warning" />
        <p className="text-center text-muted">{T('هذا الإجراء يتطلب الرقم السري لمدير أو المالك')}</p>
        <Input type="password" inputMode="numeric" autoFocus maxLength={6} value={pin} className="text-center text-2xl tracking-[0.5em]"
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} onKeyDown={(e) => e.key === 'Enter' && pin.length >= 4 && close(pin)} />
      </div>
    </Modal>
  );
}
