import { money, qty, orderTypes, dateTime } from './format';

// Printing goes through the OS print dialog / default printer via a hidden
// iframe. Layout targets 80mm thermal paper (72mm printable).

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const css = `
  @page { size: 80mm auto; margin: 0; }
  * { box-sizing: border-box; }
  body { width: 72mm; margin: 0 auto; padding: 4mm 0; font-family: Tahoma, 'Segoe UI', Arial, sans-serif; font-size: 12px; color: #000; direction: rtl; }
  h1 { font-size: 16px; margin: 0 0 2px; text-align: center; }
  .c { text-align: center; } .muted { font-size: 11px; }
  hr { border: 0; border-top: 1px dashed #000; margin: 6px 0; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 2px 0; vertical-align: top; }
  td.n { text-align: left; white-space: nowrap; }
  .mod { font-size: 11px; padding-right: 8px; }
  .big { font-size: 15px; font-weight: bold; }
  .xl { font-size: 22px; font-weight: bold; }
`;

function printHTML(body) {
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0';
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  doc.open();
  doc.write(`<!doctype html><html dir="rtl"><head><meta charset="utf-8"><style>${css}</style></head><body>${body}</body></html>`);
  doc.close();
  setTimeout(() => {
    frame.contentWindow.focus();
    frame.contentWindow.print();
    setTimeout(() => frame.remove(), 2000);
  }, 150);
}

export function printReceipt(order, settings, { change = 0, copy = false } = {}) {
  const lines = order.lines.filter((l) => !l.voided).map((l) => `
    <tr><td>${esc(l.name)} × ${qty(l.qty_milli)}</td><td class="n">${money(l.net_minor)}</td></tr>
    ${l.modifiers.map((m) => `<tr><td class="mod">+ ${esc(m.name)}</td><td></td></tr>`).join('')}
    ${l.notes ? `<tr><td class="mod">* ${esc(l.notes)}</td><td></td></tr>` : ''}`).join('');
  const row = (label, v, cls = '') => (v ? `<tr class="${cls}"><td>${label}</td><td class="n">${money(v)}</td></tr>` : '');
  const methods = Object.fromEntries((settings.payment_methods || []).map((m) => [m.code, m.name]));
  const pays = order.payments.filter((p) => p.amount_minor > 0)
    .map((p) => `<tr><td>${esc(methods[p.method] || p.method)}</td><td class="n">${money(p.amount_minor)}</td></tr>`).join('');

  printHTML(`
    <h1>${esc(settings.restaurant_name)}</h1>
    ${settings.address ? `<div class="c muted">${esc(settings.address)}</div>` : ''}
    ${settings.phone ? `<div class="c muted">${esc(settings.phone)}</div>` : ''}
    ${settings.tax_number ? `<div class="c muted">الرقم الضريبي: ${esc(settings.tax_number)}</div>` : ''}
    ${settings.receipt_header ? `<div class="c">${esc(settings.receipt_header)}</div>` : ''}
    <hr>
    <table>
      <tr><td>فاتورة</td><td class="n">${esc(order.invoice_number || '—')}</td></tr>
      <tr><td>طلب رقم</td><td class="n big">${order.number}</td></tr>
      <tr><td>${orderTypes[order.type]}${order.table_name ? ' — ' + esc(order.table_name) : ''}</td><td class="n">${dateTime(order.closed_at || order.created_at)}</td></tr>
      <tr><td>الكاشير</td><td class="n">${esc(order.payments[0]?.user_name || order.user_name)}</td></tr>
      ${order.customer_name ? `<tr><td>العميل</td><td class="n">${esc(order.customer_name)} ${esc(order.customer_phone)}</td></tr>` : ''}
      ${order.type === 'delivery' && order.customer_address ? `<tr><td colspan="2">العنوان: ${esc(order.customer_address)}</td></tr>` : ''}
    </table>
    <hr><table>${lines}</table><hr>
    <table>
      ${row('الإجمالي قبل الخصم', order.subtotal_minor)}
      ${row('خصم', order.line_discounts_minor + order.order_discount_minor)}
      ${row('خدمة', order.service_minor)}
      ${row(settings.tax_inclusive ? 'ضريبة (شاملة)' : 'ضريبة', order.tax_minor)}
      ${row('توصيل', order.delivery_fee_minor)}
      <tr class="xl"><td>الإجمالي</td><td class="n">${money(order.total_minor)}</td></tr>
    </table>
    ${pays ? `<hr><table>${pays}${change ? `<tr><td>الباقي</td><td class="n">${money(change)}</td></tr>` : ''}</table>` : ''}
    ${order.refunded_minor ? `<hr><table>${row('مرتجع', order.refunded_minor)}</table>` : ''}
    <hr>
    ${copy ? '<div class="c big">نسخة</div>' : ''}
    <div class="c">${esc(settings.receipt_footer)}</div>
  `);
}

// Kitchen ticket for lines just sent (or the whole order on reprint).
export function printKitchenTicket(order, lines) {
  const body = lines.map((l) => `
    <tr><td class="big">${qty(l.qty_milli)} × ${esc(l.name)}</td></tr>
    ${l.modifiers.map((m) => `<tr><td class="mod">+ ${esc(m.name)}</td></tr>`).join('')}
    ${l.notes ? `<tr><td class="mod">* ${esc(l.notes)}</td></tr>` : ''}`).join('');
  printHTML(`
    <div class="c xl">#${order.number}</div>
    <div class="c big">${orderTypes[order.type]}${order.table_name ? ' — ' + esc(order.table_name) : ''}</div>
    <div class="c muted">${esc(order.user_name)} — ${dateTime(new Date().toISOString())}</div>
    ${order.notes ? `<div class="c">ملاحظات: ${esc(order.notes)}</div>` : ''}
    <hr><table>${body}</table><hr>
  `);
}

// Generic printable report (tables of rows).
export function printReport(title, subtitle, sections) {
  const html = sections.map(({ heading, head, rows }) => `
    ${heading ? `<div class="big" style="margin-top:6px">${esc(heading)}</div>` : ''}
    <table>${head ? `<tr>${head.map((h) => `<td><b>${esc(h)}</b></td>`).join('')}</tr>` : ''}
    ${rows.map((r) => `<tr>${r.map((c, i) => `<td class="${i ? 'n' : ''}">${esc(c)}</td>`).join('')}</tr>`).join('')}</table><hr>`).join('');
  printHTML(`<h1>${esc(title)}</h1><div class="c muted">${esc(subtitle)}</div><hr>${html}`);
}
