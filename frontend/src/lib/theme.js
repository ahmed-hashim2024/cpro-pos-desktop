import { create } from 'zustand';

const KEY = 'cpro.theme';
const read = () => { try { return localStorage.getItem(KEY); } catch { return null; } };

function apply(dark) {
  document.documentElement.classList.toggle('dark', dark);
}

// Light by default; the choice is remembered per device.
export const useTheme = create((set, get) => ({
  dark: read() === 'dark',
  toggle() {
    const dark = !get().dark;
    try { localStorage.setItem(KEY, dark ? 'dark' : 'light'); } catch { /* storage blocked */ }
    apply(dark);
    set({ dark });
  },
}));

apply(useTheme.getState().dark);
