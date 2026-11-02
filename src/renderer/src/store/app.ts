import { create } from 'zustand'
import { PRO_PREFIX } from '@shared/license'

export type SettingsTab = 'services' | 'content' | 'general' | 'license' | 'about'
export type Route = { name: 'home' } | { name: 'settings'; back?: Route; tab?: SettingsTab } | { name: 'project'; id: string }

export interface Toast {
  id: number
  kind: 'error' | 'info' | 'success'
  text: string
  action?: { label: string; run: () => void }
}

interface AppState {
  route: Route
  toasts: Toast[]
  /** The "Fitur Pro" dialog: what was asked for, or null when it is closed. */
  upgrade: { message: string } | null
  openUpgrade(message?: string): void
  closeUpgrade(): void
  go(route: Route): void
  toast(kind: Toast['kind'], text: string, action?: Toast['action']): void
  dismiss(id: number): void
}

let nextId = 1

export const useApp = create<AppState>((set, get) => ({
  route: { name: 'home' },
  toasts: [],
  upgrade: null,
  openUpgrade: (message) => set({ upgrade: { message: message ?? 'Fitur ini khusus versi Pro.' } }),
  closeUpgrade: () => set({ upgrade: null }),
  go: (route) => set({ route }),
  toast: (kind, text, action) => {
    // The main process says "this needs Pro" with a marked error; it deserves the upgrade dialog, not a red toast.
    if (kind === 'error' && text.startsWith(PRO_PREFIX)) return get().openUpgrade(text.slice(PRO_PREFIX.length))
    const id = nextId++
    set({ toasts: [...get().toasts, { id, kind, text, action }].slice(-4) })
    setTimeout(() => get().dismiss(id), kind === 'error' ? 8000 : 4500)
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) })
}))
