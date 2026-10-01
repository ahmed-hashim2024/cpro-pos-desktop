// Interface language. Arabic is the source language: every UI string is
// written in Arabic and looked up in the English/French catalogues, falling
// back to the Arabic text when a translation is missing.
//
// The language is chosen per device and applied at start-up, so changing it
// reloads the app; module-level labels (menus, status names) pick it up too.
import en from './locales/en.json';
import fr from './locales/fr.json';

const KEY = 'cpro.lang';

export const languages = [
  ['ar', 'العربية'],
  ['en', 'English'],
  ['fr', 'Français'],
];

const stored = (() => { try { return localStorage.getItem(KEY); } catch { return null; } })();
export const lang = languages.some(([k]) => k === stored) ? stored : 'ar';
export const dir = lang === 'ar' ? 'rtl' : 'ltr';
export const locale = { ar: 'ar-EG', en: 'en-GB', fr: 'fr-FR' }[lang];

const catalog = { en, fr }[lang] || {};

// T('تمت إضافة {0} سجل', [5]) → "5 records added"
export function T(text, args) {
  let out = catalog[text] ?? text;
  if (args) out = out.replace(/\{(\w+)\}/g, (m, k) => (args[k] ?? m));
  return out;
}

export function setLang(next) {
  try { localStorage.setItem(KEY, next); } catch { /* storage blocked */ }
  window.location.reload();
}

document.documentElement.lang = lang;
document.documentElement.dir = dir;
