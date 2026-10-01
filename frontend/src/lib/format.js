// Money travels as integer minor units (piasters), quantities as thousandths,
// rates as basis points. These helpers convert to and from what people type.

let currency = 'EGP';
export function setCurrency(c) { currency = c || 'EGP'; }

const nf = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const money = (minor) => nf.format((minor || 0) / 100);
export const moneyC = (minor) => `${money(minor)} ${currencyLabel()}`;
export const currencyLabel = () => ({ EGP: 'ج.م', SAR: 'ر.س', AED: 'د.إ', USD: '$' }[currency] || currency);

// "12.5" -> 1250; returns null when not a valid amount.
export function toMinor(v) {
  const s = String(v ?? '').trim().replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(',', '.');
  if (s === '' || !/^\d+(\.\d{0,2})?$/.test(s)) return null;
  const [w, f = ''] = s.split('.');
  return Number(w) * 100 + Number((f + '00').slice(0, 2));
}
export const minorInput = (minor) => (minor ? String((minor / 100).toFixed(2)).replace(/\.00$/, '') : '');

export function toMilli(v) {
  const s = String(v ?? '').trim().replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(',', '.');
  if (s === '' || !/^-?\d+(\.\d{0,3})?$/.test(s)) return null;
  return Math.round(Number(s) * 1000);
}
export const milliInput = (m) => (m || m === 0 ? String(+(m / 1000).toFixed(3)) : '');

export const units = { kg: 'كجم', g: 'جم', l: 'لتر', ml: 'مل', pcs: 'قطعة' };
export const qty = (milli, unit) => {
  const n = +(milli / 1000).toFixed(3);
  return unit ? `${n.toLocaleString('en-US')} ${units[unit] || unit}` : n.toLocaleString('en-US');
};

export const pct = (bp) => `${+(bp / 100).toFixed(2)}%`;
export const toBP = (v) => {
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
};

const dtf = new Intl.DateTimeFormat('ar-EG', { dateStyle: 'short', timeStyle: 'short' });
const tf = new Intl.DateTimeFormat('ar-EG', { timeStyle: 'short' });
export const dateTime = (s) => (s ? dtf.format(new Date(s)) : '');
export const time = (s) => (s ? tf.format(new Date(s)) : '');
export const minutesSince = (s) => Math.max(0, Math.floor((Date.now() - new Date(s).getTime()) / 60000));

export const today = () => new Date().toLocaleDateString('en-CA');
export const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toLocaleDateString('en-CA');
};
export const monthStart = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toLocaleDateString('en-CA');
};

export const orderTypes = { dine_in: 'صالة', takeaway: 'تيك أواي', delivery: 'توصيل' };
export const orderStatus = { open: 'مفتوح', held: 'معلّق', paid: 'مدفوع', void: 'ملغي' };
export const kitchenStatus = { pending: 'لم يُرسل', sent: 'جديد', preparing: 'قيد التحضير', ready: 'جاهز', served: 'تم التقديم' };
export const roles = { owner: 'المالك', manager: 'مدير', cashier: 'كاشير', waiter: 'ويتر', kitchen: 'مطبخ' };
export const movementKinds = {
  opening: 'رصيد افتتاحي', purchase: 'مشتريات', sale: 'استهلاك مبيعات', refund: 'مرتجع',
  waste: 'هالك', adjustment: 'تسوية', count: 'فرق جرد',
};
