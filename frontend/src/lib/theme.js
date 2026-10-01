import { create } from 'zustand';
import { T } from '@/lib/i18n';

const THEME_KEY = 'cpro.theme';
const SCALE_KEY = 'cpro.fontScale';
const read = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } };

// Interface text size. Everything is sized in rem, so changing the root
// font size scales the whole UI. Per device: a 13" laptop and a 21" touch
// screen at the counter need different sizes.
export const fontScales = [
  ['xs', T('صغير جداً'), 12],
  ['sm', T('صغير'), 13],
  ['md', T('متوسط'), 14],
  ['lg', T('كبير'), 15],
  ['xl', T('كبير جداً'), 16],
];
const DEFAULT_SCALE = 'sm';
const px = (key) => (fontScales.find(([k]) => k === key) || fontScales.find(([k]) => k === DEFAULT_SCALE))[2];

function apply(dark, scale) {
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.style.fontSize = `${px(scale)}px`;
}

export const useTheme = create((set, get) => ({
  dark: read(THEME_KEY) === 'dark',
  scale: read(SCALE_KEY) || DEFAULT_SCALE,
  toggle() {
    const dark = !get().dark;
    write(THEME_KEY, dark ? 'dark' : 'light');
    apply(dark, get().scale);
    set({ dark });
  },
  setScale(scale) {
    write(SCALE_KEY, scale);
    apply(get().dark, scale);
    set({ scale });
  },
  // Step one size up or down (header A−/A+ buttons).
  // Next text size, wrapping from the largest back to the smallest.
  cycleScale() {
    const i = fontScales.findIndex(([k]) => k === get().scale);
    get().setScale(fontScales[(i + 1) % fontScales.length][0]);
  },
}));

apply(useTheme.getState().dark, useTheme.getState().scale);
