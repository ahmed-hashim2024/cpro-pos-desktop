import qrcode from 'qrcode-generator';
import { saveBlob } from './save';
import { makeZip } from './zip';

// A table's QR code as a PNG card, ready to print or send: the restaurant's
// name, the table's name, the code and a line telling guests to scan it.
// Drawn locally on a canvas, at a size that stays sharp on a table tent.

const FONT = '"IBM Plex Sans Arabic", Tahoma, "Segoe UI", Arial, sans-serif';
const W = 1200;

// Shrinks the font until the text fits the card.
function fitText(ctx, text, y, size, weight, color, max = W - 160) {
  let s = size;
  do {
    ctx.font = `${weight} ${s}px ${FONT}`;
    s -= 2;
  } while (s > 18 && ctx.measureText(text).width > max);
  ctx.fillStyle = color;
  ctx.fillText(text, W / 2, y);
}

export async function qrCardPNG({ url, title, restaurant, hint }) {
  const q = qrcode(0, 'H'); // high correction survives scratches and folds
  q.addData(url, 'Byte');
  q.make();
  try { await document.fonts?.load(`bold 80px ${FONT}`); } catch { /* system font */ }

  const n = q.getModuleCount();
  const quiet = 4; // modules of white margin scanners need
  const cell = Math.floor(900 / (n + quiet * 2));
  const size = cell * (n + quiet * 2);
  const top = restaurant ? 290 : 240;
  const H = top + size + (hint ? 170 : 60);

  const canvas = Object.assign(document.createElement('canvas'), { width: W, height: H });
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#d4d4d8';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.roundRect(24, 24, W - 48, H - 48, 48);
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (restaurant) fitText(ctx, restaurant, 130, 52, 600, '#52525b');
  fitText(ctx, title, restaurant ? 230 : 180, 104, 800, '#111111');

  const x0 = (W - size) / 2 + quiet * cell;
  const y0 = top + quiet * cell;
  ctx.fillStyle = '#000000';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (q.isDark(r, c)) ctx.fillRect(x0 + c * cell, y0 + r * cell, cell, cell);
    }
  }
  if (hint) fitText(ctx, hint, top + size + 50, 48, 600, '#3f3f46');

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('png'))), 'image/png'));
}

const fileName = (title) => `QR - ${title}`.replace(/[\\/:*?"<>|]+/g, '-').trim();

// Saves the card through the native "Save as" dialog (or a browser download).
export async function downloadQR(card) {
  const blob = await qrCardPNG(card);
  const name = fileName(card.title);
  return saveBlob(blob, `${name}.png`);
}

// Every card in one ZIP, one PNG per table.
export async function downloadQRZip(cards, zipName) {
  const files = [];
  for (const card of cards) {
    files.push({ name: `${fileName(card.title)}.png`, data: new Uint8Array(await (await qrCardPNG(card)).arrayBuffer()) });
  }
  return saveBlob(makeZip(files), `${zipName.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'QR'}.zip`);
}
