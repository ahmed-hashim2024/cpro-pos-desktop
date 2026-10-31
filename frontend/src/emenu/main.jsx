import React from 'react';
import ReactDOM from 'react-dom/client';
import MenuApp from './App.jsx';
import './emenu.css';

// Chrome/Android announce the app can be installed, sometimes before React
// renders: keep the event for the install popup (Install.jsx) and skip
// Chrome's own bar, since the popup replaces it.
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  window.__cproInstall = e;
  window.dispatchEvent(new Event('cpro:installable'));
});
window.addEventListener('appinstalled', () => {
  window.__cproInstall = null;
  try { localStorage.setItem('cpro.menu.install', 'installed'); } catch { /* blocked */ }
});

ReactDOM.createRoot(document.getElementById('menu')).render(
  <React.StrictMode>
    <MenuApp />
  </React.StrictMode>,
);
