// Guest API (/api/public/v1). Errors carry the server's message (Arabic).
async function req(method, path, body) {
  let res;
  try {
    res = await fetch(`/api/public/v1${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw Object.assign(new Error('offline'), { status: 0 });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'error'), { status: res.status });
  return data;
}

export const menuApi = {
  menu: (table) => req('GET', `/menu${table ? `?table=${encodeURIComponent(table)}` : ''}`),
  call: (table, kind) => req('POST', '/call', { table, kind }),
  order: (body) => req('POST', '/orders', body),
  status: (token) => req('GET', `/orders/${encodeURIComponent(token)}`),
};
