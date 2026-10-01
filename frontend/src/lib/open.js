// Opens a link in the system browser. Inside the desktop window the WebView
// would otherwise navigate away from the app.
export function openExternal(url) {
  if (window.runtime?.BrowserOpenURL) return window.runtime.BrowserOpenURL(url);
  window.open(url, '_blank', 'noopener');
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
