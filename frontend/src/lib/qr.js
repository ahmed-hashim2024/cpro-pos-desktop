import qrcode from 'qrcode-generator';

// SVG markup of a QR code for text (generated locally, no network).
export function qrSVG(text, { margin = 2 } = {}) {
  const q = qrcode(0, 'M');
  q.addData(text, 'Byte');
  q.make();
  return q.createSvgTag({ cellSize: 4, margin, scalable: true });
}
