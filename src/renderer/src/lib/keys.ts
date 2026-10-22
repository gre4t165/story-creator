import { DEFAULT_FREE_IMAGE_MODEL, getFreeImageModel } from '@shared/freemodels'
import { DEFAULT_IMAGE_MODEL } from '@shared/higgsfield'
import type { ApiProvider, KeyStatus, TtsProvider } from '@shared/types'

export const TTS_NAMES: Record<TtsProvider, string> = { gemini: 'Gemini TTS', elevenlabs: 'ElevenLabs', edge: 'Edge (gratis)', local: 'Voicebox (lokal)' }

/** Narrator services in the order pickers show them. */
export const TTS_ORDER: TtsProvider[] = ['gemini', 'elevenlabs', 'edge', 'local']

/** A key counts once it is saved and did not fail its last check. */
export function keyOk(keys: KeyStatus[], provider: ApiProvider): boolean {
  const k = keys.find((x) => x.provider === provider)
  return !!k?.configured && k.lastOk !== false
}

/**
 * Whether each narrator voice service can be used. Gemini and ElevenLabs need a saved key that did not fail
 * its last check; Edge needs nothing, and the local server is checked when its voices are listed. `reason`
 * says why not, for disabled options.
 */
export function ttsReadiness(keys: KeyStatus[]): Record<TtsProvider, { ok: boolean; reason: string | null }> {
  const one = (p: 'gemini' | 'elevenlabs'): { ok: boolean; reason: string | null } => {
    const k = keys.find((x) => x.provider === p)
    const name = p === 'gemini' ? 'Gemini' : 'ElevenLabs'
    if (!k?.configured) return { ok: false, reason: `Kunci ${name} belum diisi` }
    if (k.lastOk === false) return { ok: false, reason: `Kunci ${name} tidak valid` }
    return { ok: true, reason: null }
  }
  return { gemini: one('gemini'), elevenlabs: one('elevenlabs'), edge: { ok: true, reason: null }, local: { ok: true, reason: null } }
}

/** The preferred provider when it is usable, otherwise another usable one (Edge always is). */
export function usableTts(preferred: TtsProvider, keys: KeyStatus[]): TtsProvider {
  const ready = ttsReadiness(keys)
  if (ready[preferred].ok) return preferred
  return (['gemini', 'elevenlabs', 'edge'] as const).find((p) => ready[p].ok) ?? preferred
}

/**
 * The image model to start with: the current one when its service has a working key, otherwise one that does.
 * Free models are preferred over nothing, never over a working Higgsfield key the user already chose.
 */
export function usableImageModel(current: string | null, keys: KeyStatus[]): string {
  const free = getFreeImageModel(current)
  const have = (p: ApiProvider): boolean => keyOk(keys, p)
  if (free ? have(free.provider) : have('higgsfield')) return current ?? DEFAULT_IMAGE_MODEL
  if (free && have('higgsfield')) return DEFAULT_IMAGE_MODEL
  if (have('cloudflare')) return DEFAULT_FREE_IMAGE_MODEL
  if (have('pollinations')) return 'pollinations/default'
  return current ?? DEFAULT_IMAGE_MODEL
}
