// Prepares a picture for upload: under 1 MB, in high quality. Pictures that
// already fit are sent untouched; larger ones are resized to at most maxSide
// pixels and re-encoded (WEBP where the WebView can, else JPEG, or PNG when
// the picture has transparency), lowering quality only as far as needed.

import { T } from '@/lib/i18n';

export const MAX_UPLOAD = 1000 * 1024;
const MAX_SOURCE = 30 * 1024 * 1024;
const TYPES = ['image/png', 'image/jpeg', 'image/webp'];

const readAsDataURL = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(new Error(T('تعذر قراءة الصورة')));
  r.readAsDataURL(blob);
});

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(T('تعذر قراءة الصورة'))); };
    img.src = url;
  });
}

function checkFile(file) {
  if (!file) throw new Error(T('اختر صورة'));
  if (!TYPES.includes(file.type)) throw new Error(T('الصورة يجب أن تكون PNG أو JPG أو WEBP'));
  if (file.size > MAX_SOURCE) throw new Error(T('الصورة كبيرة جداً'));
}

// A picture to frame on screen; its blob URL stays alive (the caller revokes it).
export function openImage(file) {
  checkFile(file);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => { URL.revokeObjectURL(img.src); reject(new Error(T('تعذر قراءة الصورة'))); };
    img.src = URL.createObjectURL(file);
  });
}

const toBlob = (canvas, type, quality) => new Promise((resolve) => canvas.toBlob(resolve, type, quality));

// Any transparent pixel? Checked on a small copy to stay fast.
function hasAlpha(img) {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0, 64, 64);
  const d = g.getImageData(0, 0, 64, 64).data;
  for (let i = 3; i < d.length; i += 4) if (d[i] < 250) return true;
  return false;
}

// Cuts box (in the picture's own pixels) out of img as a new file, at most
// maxSide wide or high and never enlarged. Keeps transparency unless JPEG.
export async function cropImage(img, box, { maxSide = 1600, type = 'image/png' } = {}) {
  const scale = Math.min(1, maxSide / Math.max(box.w, box.h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(box.w * scale));
  c.height = Math.max(1, Math.round(box.h * scale));
  const g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, box.x, box.y, box.w, box.h, 0, 0, c.width, c.height);
  const blob = await toBlob(c, type === 'image/jpeg' ? 'image/jpeg' : 'image/png', 0.95);
  if (!blob) throw new Error(T('تعذر قراءة الصورة'));
  return new File([blob], 'picture', { type: blob.type });
}

export async function prepareImage(file, { maxSide = 1600 } = {}) {
  checkFile(file);
  const img = await loadImage(file);
  const w0 = img.naturalWidth;
  const h0 = img.naturalHeight;
  if (file.size <= MAX_UPLOAD && Math.max(w0, h0) <= maxSide) return readAsDataURL(file);

  const alpha = file.type !== 'image/jpeg' && hasAlpha(img);
  const formats = alpha ? ['image/webp', 'image/png'] : ['image/webp', 'image/jpeg'];
  let scale = Math.min(1, maxSide / Math.max(w0, h0));
  const canvas = document.createElement('canvas');
  for (let round = 0; round < 6; round++) {
    canvas.width = Math.max(1, Math.round(w0 * scale));
    canvas.height = Math.max(1, Math.round(h0 * scale));
    const g = canvas.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.drawImage(img, 0, 0, canvas.width, canvas.height);
    for (const type of formats) {
      for (const q of type === 'image/png' ? [undefined] : [0.92, 0.88, 0.84, 0.8]) {
        const blob = await toBlob(canvas, type, q);
        if (!blob || blob.type !== type) break; // this WebView can't encode it
        if (blob.size <= MAX_UPLOAD) return readAsDataURL(blob);
      }
    }
    scale *= 0.82;
  }
  throw new Error(T('تعذر تصغير الصورة لأقل من 1 ميجا'));
}

// App (PWA) icon: the picture cropped to a centred square and drawn at
// 512 and 192 px as PNG (what browsers and iOS ask for).
export async function makeAppIcons(file) {
  checkFile(file);
  const img = await loadImage(file);
  const side = Math.min(img.naturalWidth, img.naturalHeight);
  const sx = (img.naturalWidth - side) / 2;
  const sy = (img.naturalHeight - side) / 2;
  const draw = (size) => {
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, sx, sy, side, side, 0, 0, size, size);
    return c.toDataURL('image/png');
  };
  return { 512: draw(512), 192: draw(192) };
}
