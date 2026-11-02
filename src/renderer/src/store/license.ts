import { create } from 'zustand'
import type { LicenseFeature, LicenseState } from '@shared/license'
import { proMessage, PRO_PREFIX } from '@shared/license'
import { useApp } from './app'

interface LicenseStore {
  state: LicenseState | null
  load(): Promise<void>
  set(state: LicenseState): void
  /**
   * True when the feature may be used. Otherwise the upgrade dialog opens and this is false. The renderer only
   * decides what to show; the main process checks again before anything that matters (export, imports).
   */
  ensure(feature: LicenseFeature): Promise<boolean>
}

export const useLicense = create<LicenseStore>((set, get) => ({
  state: null,
  load: async () => set({ state: await window.api.license.get() }),
  set: (state) => set({ state }),
  ensure: async (feature) => {
    try {
      await window.api.license.require(feature)
      return true
    } catch {
      useApp.getState().openUpgrade(proMessage(feature).slice(PRO_PREFIX.length))
      return false
    } finally {
      // The answer may have changed since the state was loaded (a license that expired or was renewed).
      void get().load()
    }
  }
}))

export const useIsPro = (): boolean => useLicense((s) => s.state?.plan === 'pro')
