import { useEffect } from 'react';
import { Minus, Plus, X } from 'lucide-react';
import { overlayGradient } from '../lib/overlay';

export const cx = (...c) => c.filter(Boolean).join(' ');

// /t/{token} is a table's QR code, /hall the shared QR in the hall (the guest
// picks their table); ?preview is the designer's phone preview.
export const tableToken = (window.location.pathname.match(/^\/t\/([A-Za-z0-9]+)/) || [])[1] || '';
export const hallLink = window.location.pathname === '/hall';
export const PREVIEW = new URLSearchParams(window.location.search).has('preview');

export const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch { /* blocked */ } },
};

// The guest's details (name, phone, address or table) live on their phone
// only and travel with each order.
const CONTACT_KEY = 'cpro.menu.contact';
export const emptyContact = { mode: '', name: '', phone: '', address: '', table: '' };
export function loadContact() {
  try { return { ...emptyContact, ...JSON.parse(localStorage.getItem(CONTACT_KEY) || '{}') }; } catch { return { ...emptyContact }; }
}
export function saveContact(c) {
  try { localStorage.setItem(CONTACT_KEY, JSON.stringify(c)); } catch { /* blocked */ }
}

// Which way this guest orders: from a table QR it's always the hall.
export function orderModes(menu) {
  if (menu.table) return menu.ordering.dine_in ? ['hall'] : [];
  return [menu.ordering.dine_in && menu.tables?.length > 0 && 'hall', menu.ordering.delivery && 'delivery'].filter(Boolean);
}
export function effectiveMode(menu, contact) {
  const modes = orderModes(menu);
  return modes.includes(contact.mode) ? contact.mode : modes[0] || '';
}
export const phoneOK = (p) => (p.match(/[0-9٠-٩]/g) || []).length >= 7;
export function contactReady(menu, contact) {
  const mode = effectiveMode(menu, contact);
  if (mode === 'hall') return !!(menu.table || menu.tables?.includes(contact.table));
  if (mode === 'delivery') return !!(contact.name.trim() && phoneOK(contact.phone) && contact.address.trim());
  return false;
}

export const validHex = (h) => /^#[0-9a-f]{6}$/i.test(h || '');

// Readable text colour on top of the button colour.
export function onColor(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return '#ffffff';
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? '#1a1206' : '#ffffff';
}

// Links from settings: only http(s) ever becomes an href (the server checks
// this too).
export const safeHref = (u) => (/^https?:\/\//i.test(u || '') ? u : '');

export function social(kind, v) {
  if (!v) return '';
  if (/^https?:\/\//i.test(v)) return v;
  const h = encodeURIComponent(v.replace(/^@/, ''));
  return { instagram: `https://instagram.com/${h}`, facebook: `https://facebook.com/${h}`, tiktok: `https://www.tiktok.com/@${h}` }[kind];
}
export const waLink = (n) => `https://wa.me/${String(n).replace(/[^\d]/g, '')}`;

export const lineTotal = (l) => (l.item.price_minor + l.mods.reduce((s, m) => s + m.price_minor, 0)) * l.qty;

// ---- small pieces ----------------------------------------------------------------

// The price, with the old one struck out next to it when there is a discount.
export function PriceTag({ item, money, className, wasClassName = 'text-mut' }) {
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-1.5">
      <span className={cx('num', className)}>{money(item.price_minor)}</span>
      {item.was_price_minor > item.price_minor && <s className={cx('num text-[0.75em] font-medium', wasClassName)}>{money(item.was_price_minor)}</s>}
    </span>
  );
}

// Colours and shade of an offer card. The colour is only ever a preset the
// server sends, but it reaches a style attribute, so it's checked here too.
export function offerShade(offer) {
  const hex = validHex(offer.overlay_color) ? offer.overlay_color : '#000000';
  return { card: { backgroundColor: hex }, shade: { backgroundImage: overlayGradient(hex, offer.overlay_opacity ?? 75) } };
}

export function Thumb({ item, className }) {
  return item.image
    ? <img src={item.image} alt="" loading="lazy" className={cx('object-cover', className)} />
    : (
      <div className={cx('flex items-center justify-center text-p', className)}
        style={{ background: 'radial-gradient(circle at 30% 25%, color-mix(in srgb, var(--p) 28%, transparent), transparent 65%), var(--card2)' }}>
        <span className="text-3xl font-bold opacity-80">{item.name.slice(0, 1)}</span>
      </div>
    );
}

export function Stepper({ value, onChange, min = 1, small, t }) {
  const b = cx('flex items-center justify-center rounded-full bg-card2 transition active:scale-90', small ? 'size-8' : 'size-11');
  return (
    <div className="flex items-center gap-2">
      <button type="button" className={b} aria-label={t('decrease')} onClick={() => onChange(Math.max(min, value - 1))}><Minus className="size-4" /></button>
      <span className={cx('num text-center font-bold', small ? 'w-5' : 'w-7 text-lg')}>{value}</span>
      <button type="button" className={b} aria-label={t('increase')} onClick={() => onChange(Math.min(50, value + 1))}><Plus className="size-4" /></button>
    </div>
  );
}

export function useLockScroll() {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);
}

export function useEscape(onClose) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
}

// Bottom sheet.
export function Sheet({ onClose, children, label }) {
  useLockScroll();
  useEscape(onClose);
  return (
    <div className="anim-fade fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-[2px] md:items-center md:p-6" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={label} onClick={(e) => e.stopPropagation()}
        className="anim-sheet flex max-h-[92dvh] w-full max-w-md flex-col overflow-hidden rounded-t-[28px] bg-bg shadow-2xl md:max-h-[85dvh] md:max-w-lg md:rounded-[28px]">
        {children}
      </div>
    </div>
  );
}

export function SheetHeader({ title, onClose, t }) {
  return (
    <div className="flex items-center gap-3 border-b border-line px-5 py-4">
      <h2 className="flex-1 text-lg font-bold">{title}</h2>
      <button onClick={onClose} aria-label={t('close')} className="flex size-9 items-center justify-center rounded-full bg-card2"><X className="size-4" /></button>
    </div>
  );
}

export function Badge({ kind, t }) {
  if (!kind) return null;
  return <span className="rounded-full bg-p px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-onp shadow">{t(`badge_${kind}`)}</span>;
}

export function SectionTitle({ title, action, onAction }) {
  return (
    <div className="mb-3 flex items-center justify-between px-4">
      <h2 className="text-lg font-bold">{title}</h2>
      {action && <button onClick={onAction} className="text-sm font-semibold text-p">{action}</button>}
    </div>
  );
}
