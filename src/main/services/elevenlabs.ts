import { isTagToken, toElevenLabsText } from '@shared/speech'
import type { KeyTestResult, ModelOption, VoiceOption, WordTiming } from '@shared/types'
import { getSecret, requireSecret } from '../secrets'
import { getSettings } from '../settings'
import { readError } from './http'

const BASE = 'https://api.elevenlabs.io'

async function el<T>(path: string, init: RequestInit & { key?: string } = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'xi-api-key': init.key ?? requireSecret('elevenlabs'),
      'Content-Type': 'application/json',
      ...(init.headers ?? {})
    }
  })
  if (!res.ok) {
    const detail = await readError(res)
    if (res.status === 401) throw new Error('Kunci ElevenLabs tidak valid atau tidak punya izin ini.')
    if (res.status === 402 || /quota|credits/i.test(detail)) throw new Error('Kuota karakter ElevenLabs habis.')
    if (res.status === 404) throw new Error('Suara ElevenLabs tidak ditemukan. Pilih suara lain.')
    if (res.status === 429) throw new Error('ElevenLabs sedang sibuk. Coba lagi sebentar.')
    throw new Error(`ElevenLabs gagal: ${detail}`)
  }
  return (await res.json()) as T
}

export async function testKey(key?: string): Promise<KeyTestResult> {
  const k = key ?? getSecret('elevenlabs')
  if (!k) return { ok: false, message: 'Kunci belum diatur' }
  try {
    const s = await el<{ character_count: number; character_limit: number }>('/v1/user/subscription', { key: k })
    const left = Math.max(0, s.character_limit - s.character_count)
    return { ok: true, message: `Terhubung · sisa ${left.toLocaleString('id-ID')} karakter` }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}

export async function listVoices(): Promise<VoiceOption[]> {
  const out: VoiceOption[] = []
  let token: string | undefined
  for (let page = 0; page < 5; page++) {
    const q = new URLSearchParams({ page_size: '100', include_total_count: 'false' })
    if (token) q.set('next_page_token', token)
    const r = await el<{
      voices: { voice_id: string; name: string; category?: string; labels?: Record<string, string>; preview_url?: string }[]
      has_more: boolean
      next_page_token?: string
    }>(`/v2/voices?${q}`)
    for (const v of r.voices) {
      const labels = Object.values(v.labels ?? {}).filter(Boolean).slice(0, 3).join(', ')
      out.push({ id: v.voice_id, name: v.name, description: labels || v.category || '', previewUrl: v.preview_url ?? null })
    }
    if (!r.has_more || !r.next_page_token) break
    token = r.next_page_token
  }
  return out
}

/** Live list of ElevenLabs models that can do text-to-speech. */
export async function listModels(): Promise<ModelOption[]> {
  const r = await el<
    {
      model_id: string
      name?: string
      description?: string
      can_do_text_to_speech?: boolean
      languages?: { language_id: string; name: string }[]
      maximum_text_length_per_request?: number
    }[]
  >('/v1/models')
  return r
    .filter((m) => m.can_do_text_to_speech !== false)
    .map((m) => {
      const langs = m.languages ?? []
      const indo = langs.some((l) => /^(id|ind)$/i.test(l.language_id) || /indonesia/i.test(l.name))
      const limit = m.maximum_text_length_per_request
      return {
        id: m.model_id,
        name: m.name ?? m.model_id,
        description: [m.description?.slice(0, 200), limit ? `Maks ${limit.toLocaleString('id-ID')} karakter per permintaan` : '']
          .filter(Boolean)
          .join(' · '),
        contextLength: null,
        priceIn: null,
        priceOut: null,
        tags: [...(indo ? ['Indonesia'] : []), ...(langs.length ? [`${langs.length} bahasa`] : [])]
      }
    })
}

interface Alignment {
  characters: string[]
  character_start_times_seconds: number[]
  character_end_times_seconds: number[]
}

function toWords(a: Alignment): WordTiming[] {
  const out: WordTiming[] = []
  let cur: WordTiming | null = null
  a.characters.forEach((ch, i) => {
    if (/\s/.test(ch)) {
      if (cur) out.push(cur)
      cur = null
      return
    }
    const s = a.character_start_times_seconds[i]
    const e = a.character_end_times_seconds[i]
    if (!cur) cur = { text: ch, start: s, end: e }
    else {
      cur.text += ch
      cur.end = e
    }
  })
  if (cur) out.push(cur)
  // Audio tags and <break> markup show up as characters but are not spoken words.
  return out.filter((w) => !isTagToken(w.text))
}

/**
 * Speaks narration and returns MP3 bytes plus exact word timings. `context` passes the text around this
 * part of a longer take, so ElevenLabs keeps the delivery continuous across requests.
 */
export async function speak(
  text: string,
  voiceId: string,
  languageCode: string,
  signal?: AbortSignal,
  context?: { previous?: string; next?: string }
): Promise<{ audio: Buffer; words: WordTiming[] }> {
  const model = getSettings().elevenModel
  const body: Record<string, unknown> = { text: toElevenLabsText(text, model), model_id: model }
  if (context?.previous) body.previous_text = toElevenLabsText(context.previous, model)
  if (context?.next) body.next_text = toElevenLabsText(context.next, model)
  // multilingual_v2 does not take a language_code; newer models do.
  if (model !== 'eleven_multilingual_v2') body.language_code = languageCode
  const r = await el<{ audio_base64: string; alignment?: Alignment }>(
    `/v1/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps?output_format=mp3_44100_128`,
    { method: 'POST', body: JSON.stringify(body), signal }
  )
  return { audio: Buffer.from(r.audio_base64, 'base64'), words: r.alignment ? toWords(r.alignment) : [] }
}
