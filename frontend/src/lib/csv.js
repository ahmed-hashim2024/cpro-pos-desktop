import { saveBlob } from './save';

// Excel-friendly CSV export (UTF-8 BOM so Arabic opens correctly).
export function exportCSV(filename, head, rows) {
  const cell = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const text = [head, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
  return saveBlob(new Blob(['\ufeff' + text], { type: 'text/csv;charset=utf-8' }), filename.endsWith('.csv') ? filename : `${filename}.csv`);
}
