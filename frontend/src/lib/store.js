import { create } from 'zustand';
import { api, session } from './api';
import { setCurrency } from './format';

// Session + settings shared by every screen.
export const useApp = create((set, get) => ({
  me: null,
  settings: null,
  shift: null,
  ready: false,

  can: (perm) => !!get().me?.permissions?.includes(perm),

  async boot() {
    if (!session.token) return set({ ready: true, me: null });
    try {
      const me = await api.get('/me');
      set({ me });
      await Promise.all([get().loadSettings(), get().loadShift()]);
    } catch {
      session.token = '';
      set({ me: null });
    }
    set({ ready: true });
  },

  async signedIn({ token, me }) {
    session.token = token;
    set({ me });
    await Promise.all([get().loadSettings(), get().loadShift()]);
  },

  async loadSettings() {
    const settings = await api.get('/settings');
    setCurrency(settings.currency);
    set({ settings });
  },

  async loadShift() {
    if (!get().can('shift.cash')) return set({ shift: null });
    const { shift } = await api.get('/shifts/current');
    set({ shift });
  },

  async logout() {
    try { await api.post('/auth/logout'); } catch { /* already gone */ }
    session.token = '';
    set({ me: null, shift: null });
  },

  expired() {
    session.token = '';
    set({ me: null, shift: null });
  },
}));

// Tiny toast queue.
export const useToast = create((set) => ({
  items: [],
  push(msg, kind = 'ok') {
    const id = Math.random();
    set((s) => ({ items: [...s.items, { id, msg, kind }] }));
    setTimeout(() => set((s) => ({ items: s.items.filter((t) => t.id !== id) })), kind === 'error' ? 5000 : 2500);
  },
}));

export const toast = (msg) => useToast.getState().push(msg);
export const toastError = (e) => useToast.getState().push(e?.message || String(e), 'error');
