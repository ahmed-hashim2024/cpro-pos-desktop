// Excel-friendly CSV export (UTF-8 BOM so Arabic opens correctly).
export function exportCSV(filename, head, rows) {
  const cell = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const text = [head, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename.endsWith('.csv') ? filename : `${filename}.csv` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
