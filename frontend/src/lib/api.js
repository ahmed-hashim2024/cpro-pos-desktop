// Thin client for the Go API. The same build runs inside the desktop window
// (same origin via the Wails asset server) and on LAN devices.

import { saveBlob } from './save';
import { T } from '@/lib/i18n';

const TOKEN_KEY = 'cpro.token';
const DEVICE_KEY = 'cpro.device';

export const session = {
  get token() {
    try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; }
  },
  set token(v) {
    try { v ? localStorage.setItem(TOKEN_KEY, v) : localStorage.removeItem(TOKEN_KEY); } catch { /* storage blocked */ }
  },
};

// A LAN device remembers its own id so the server can recognise it.
export function deviceId() {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = ulid();
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return '';
  }
}

const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export function ulid() {
  let t = Date.now();
  let time = '';
  for (let i = 0; i < 10; i++) { time = B32[t % 32] + time; t = Math.floor(t / 32); }
  const rnd = crypto.getRandomValues(new Uint8Array(16));
  let r = '';
  for (let i = 0; i < 16; i++) r += B32[rnd[i] % 32];
  return time + r;
}

// message is translated for display; raw is the server's original text.
export class ApiError extends Error {
  constructor(status, raw) {
    super(T(raw));
    this.status = status;
    this.raw = raw;
  }
}

let onUnauthorized = () => {};
export function setUnauthorizedHandler(fn) { onUnauthorized = fn; }

async function request(method, path, body, { idempotent = false } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (session.token) headers.Authorization = `Bearer ${session.token}`;
  if (idempotent) headers['Idempotency-Key'] = ulid();
  let res;
  try {
    res = await fetch(`/api/v1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, 'تعذر الاتصال بالنظام');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && path !== '/auth/login') onUnauthorized();
    throw new ApiError(res.status, data.error || 'حدث خطأ');
  }
  return data;
}

const qs = (params) => {
  const p = new URLSearchParams();
  Object.entries(params || {}).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') p.set(k, v); });
  const s = p.toString();
  return s ? `?${s}` : '';
};

export const api = {
  get: (path, params) => request('GET', path + qs(params)),
  post: (path, body, opts) => request('POST', path, body ?? {}, opts),
  put: (path, body) => request('PUT', path, body ?? {}),

  async download(path, filename, params) {
    const res = await fetch(`/api/v1${path}${qs(params)}`, { headers: { Authorization: `Bearer ${session.token}` } });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new ApiError(res.status, data.error || 'تعذر التحميل');
    }
    const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '')?.[1] || filename;
    return saveBlob(await res.blob(), name);
  },

  // Multipart upload of one file under the field name "file".
  async upload(path, file, params) {
    const body = new FormData();
    body.append('file', file);
    let res;
    try {
      res = await fetch(`/api/v1${path}${qs(params)}`, { method: 'POST', headers: { Authorization: `Bearer ${session.token}` }, body });
    } catch {
      throw new ApiError(0, 'تعذر الاتصال بالنظام');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, data.error || 'حدث خطأ');
    return data;
  },
};
