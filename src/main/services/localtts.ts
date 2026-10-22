import type { KeyTestResult, VoiceOption } from '@shared/types'
import { getSettings } from '../settings'
import { plainForEdge } from './edgetts'
import { readError, sleep } from './http'

/**
 * A narrator voice server running on this computer, so voice-over costs nothing and never leaves the machine.
 * Voicebox (default port 17493) is spoken to through its own API, which lists the user's cloned and preset
 * voice profiles. Other local voice studios usually offer the OpenAI `/v1/audio/speech` shape, which is
 * the fallback when the server has no Voicebox profile list.
 */

const VOICEBOX_LANGS = /^(zh|en|ja|ko|de|fr|ru|pt|es|it|he|ar|da|el|fi|hi|id|ms|nl|no|pl|sv|sw|tr)$/
/** Cloned voices on a CPU can take minutes for a long scene. */
const GENERATE_TIMEOUT_MS = 20 * 60 * 1000

export function baseUrl(): string {
  return (getSettings().localTtsUrl || 'http://127.0.0.1:17493').trim().replace(/\/+$/, '')
}

function friendly(e: unknown): Error {
  const msg = (e as Error)?.message ?? String(e)
  if (/Dibatalkan/.test(msg)) return e as Error
  if (/ECONNREFUSED|fetch failed|ENOTFOUND|ETIMEDOUT|ECONNRESET/i.test(msg))
    return new Error(`Server suara lokal di ${baseUrl()} tidak menjawab. Buka Voicebox atau voice studio kamu dulu, lalu coba lagi.`)
  return new Error(`Suara lokal gagal: ${msg}`)
}

async function request(path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<Response> {
  const { timeoutMs = 15_000, signal, ...rest } = init
  const timeout = AbortSignal.timeout(timeoutMs)
  return fetch(`${baseUrl()}${path}`, { ...rest, signal: signal ? AbortSignal.any([signal, timeout]) : timeout })
}

interface VoiceboxProfile {
  id: string
  name: string
  description?: string | null
  language?: string | null
  voice_type?: string | null
}

/** Voicebox profiles, or null when the server is not Voicebox (no profile list). */
async function voiceboxProfiles(): Promise<VoiceboxProfile[] | null> {
  const res = await request('/profiles')
  if (res.status === 404) return null
  if (!res.ok) throw new Error(await readError(res))
  const body = (await res.json()) as unknown
  return Array.isArray(body) ? (body as VoiceboxProfile[]) : null
}

/** Voices from an OpenAI-compatible server; many publish no list, so a single default voice stands in. */
async function openAiVoices(): Promise<VoiceOption[]> {
  for (const path of ['/v1/audio/voices', '/v1/voices', '/voices']) {
    try {
      const res = await request(path, { timeoutMs: 5000 })
      if (!res.ok) continue
      const body = (await res.json()) as unknown
      const raw = Array.isArray(body) ? body : ((body as { voices?: unknown[]; data?: unknown[] })?.voices ?? (body as { data?: unknown[] })?.data ?? [])
      const list = raw
        .map((v): VoiceOption | null => {
          if (typeof v === 'string') return { id: v, name: v, description: 'Voice studio lokal' }
          const o = v as { id?: string; voice_id?: string; name?: string; description?: string }
          const id = o.id ?? o.voice_id ?? o.name
          return id ? { id, name: o.name ?? id, description: o.description ?? 'Voice studio lokal' } : null
        })
        .filter((v): v is VoiceOption => !!v)
      if (list.length) return list
    } catch {
      // Try the next common path.
    }
  }
  return [{ id: 'alloy', name: 'Suara bawaan', description: 'Voice studio lokal (OpenAI-compatible)' }]
}

export async function listVoices(language?: string): Promise<VoiceOption[]> {
  try {
    const profiles = await voiceboxProfiles()
    if (!profiles) return await openAiVoices()
    const lang = (language ?? '').toLowerCase()
    const list = profiles.map((p) => ({
      id: p.id,
      name: p.name,
      description: [p.voice_type === 'cloned' ? 'Kloning' : p.voice_type === 'preset' ? 'Preset' : null, p.language?.toUpperCase(), p.description]
        .filter(Boolean)
        .join(' · '),
      lang: (p.language ?? '').toLowerCase()
    }))
    return list.sort((a, b) => Number(b.lang === lang) - Number(a.lang === lang)).map(({ lang: _l, ...v }) => v)
  } catch (e) {
    throw friendly(e)
  }
}

interface Generation {
  id: string
  status?: string
  error?: string | null
}

async function voiceboxSpeak(text: string, profileId: string, language: string, signal?: AbortSignal): Promise<Buffer> {
  const res = await request('/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profile_id: profileId, text, ...(VOICEBOX_LANGS.test(language) ? { language } : {}) }),
    signal,
    timeoutMs: GENERATE_TIMEOUT_MS
  })
  if (!res.ok) throw new Error(await readError(res))
  let gen = (await res.json()) as Generation
  const started = Date.now()
  // Generation runs in the background on the server; the history entry says when the file is ready.
  try {
    while (gen.status !== 'completed') {
      if (gen.status === 'failed') throw new Error(gen.error || 'Voicebox gagal membuat suara')
      if (Date.now() - started > GENERATE_TIMEOUT_MS) throw new Error('Voicebox terlalu lama membuat suara')
      await sleep(1000, signal)
      const r = await request(`/history/${encodeURIComponent(gen.id)}`, { signal })
      if (!r.ok) throw new Error(await readError(r))
      gen = (await r.json()) as Generation
    }
  } catch (e) {
    if (signal?.aborted) void request(`/generate/${encodeURIComponent(gen.id)}/cancel`, { method: 'POST' }).catch(() => undefined)
    throw e
  }
  const audio = await request(`/audio/${encodeURIComponent(gen.id)}`, { signal, timeoutMs: 60_000 })
  if (!audio.ok) throw new Error(await readError(audio))
  return Buffer.from(await audio.arrayBuffer())
}

async function openAiSpeak(text: string, voice: string, signal?: AbortSignal): Promise<Buffer> {
  const res = await request('/v1/audio/speech', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'tts-1', input: text, voice: voice || 'alloy', response_format: 'wav' }),
    signal,
    timeoutMs: GENERATE_TIMEOUT_MS
  })
  if (!res.ok) throw new Error(await readError(res))
  return Buffer.from(await res.arrayBuffer())
}

/** Speaks narration and returns WAV bytes. Voice tags become pauses, like with Edge. */
export async function speak(text: string, voice: string, language: string, signal?: AbortSignal): Promise<Buffer> {
  const plain = plainForEdge(text)
  if (!plain) throw new Error('Naskah kosong setelah tag suara dibuang')
  try {
    const profiles = await voiceboxProfiles()
    if (profiles) {
      // A voice JSON may name a profile instead of giving its id.
      const profile = profiles.find((p) => p.id === voice) ?? profiles.find((p) => p.name.toLowerCase() === voice.trim().toLowerCase())
      if (!profile) throw new Error(voice ? `Profil suara "${voice}" tidak ada di Voicebox` : 'Pilih suara Voicebox dulu di langkah Ide cerita.')
      return await voiceboxSpeak(plain, profile.id, language.toLowerCase(), signal)
    }
    return await openAiSpeak(plain, voice, signal)
  } catch (e) {
    if (signal?.aborted) throw new Error('Dibatalkan')
    throw friendly(e)
  }
}

export async function testConnection(): Promise<KeyTestResult> {
  try {
    const profiles = await voiceboxProfiles()
    if (profiles) return { ok: true, message: `Terhubung ke Voicebox · ${profiles.length} profil suara` }
    const voices = await openAiVoices()
    return { ok: true, message: `Terhubung ke voice studio lokal · ${voices.length} suara` }
  } catch (e) {
    return { ok: false, message: friendly(e).message }
  }
}
