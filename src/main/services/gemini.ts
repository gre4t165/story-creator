import { GoogleGenAI } from '@google/genai'
import { GEMINI_LIBRARY_VOICES, GEMINI_VOICES, geminiVoiceName, geminiVoiceTone } from '@shared/models'
import type { KeyTestResult, ModelOption, VoiceOption } from '@shared/types'
import { getSecret, requireSecret } from '../secrets'
import { getSettings, readCache, writeCache } from '../settings'
import { isWav, pcmToWav } from './audio'
import { extractJson } from './json'

function client(key?: string): GoogleGenAI {
  return new GoogleGenAI({ apiKey: key ?? requireSecret('gemini') })
}

function friendly(e: unknown): Error {
  const msg = (e as Error)?.message ?? String(e)
  if (/API key not valid|API_KEY_INVALID|PERMISSION_DENIED|401|403/i.test(msg))
    return new Error('Kunci Gemini ditolak. Periksa kunci di Pengaturan.')
  if (/RESOURCE_EXHAUSTED|429/i.test(msg)) return new Error('Kuota Gemini habis atau terlalu banyak permintaan. Coba lagi sebentar.')
  if (/not found|404/i.test(msg)) return new Error(`Model Gemini tidak tersedia untuk kunci ini: ${msg}`)
  return new Error(`Gemini gagal: ${msg}`)
}

export async function testKey(key?: string): Promise<KeyTestResult> {
  const k = key ?? getSecret('gemini')
  if (!k) return { ok: false, message: 'Kunci belum diatur' }
  try {
    const pager = await client(k).models.list({ config: { pageSize: 50 } })
    return { ok: true, message: `Terhubung · ${pager.page.length}+ model tersedia` }
  } catch (e) {
    return { ok: false, message: friendly(e).message }
  }
}

const NOT_TEXT = /tts|embedding|imagen|image|veo|native-audio|live|aqa|transcribe|robotics|computer-use|lyria/i

/** Live model list: 'text' models for writing stories, or 'tts' models for narration. */
export async function listModels(kind: 'text' | 'tts'): Promise<ModelOption[]> {
  const out: ModelOption[] = []
  try {
    const pager = await client().models.list({ config: { pageSize: 200 } })
    for await (const m of pager) {
      const id = (m.name ?? '').replace(/^models\//, '')
      if (!id) continue
      const actions = m.supportedActions ?? []
      if (!actions.includes('generateContent')) continue
      const isTts = /tts/i.test(id)
      if (kind === 'tts' ? !isTts : NOT_TEXT.test(id)) continue
      out.push({
        id,
        name: m.displayName || id,
        description: m.description?.slice(0, 280),
        contextLength: m.inputTokenLimit ?? null,
        priceIn: null,
        priceOut: null,
        tags: kind === 'text' && id.startsWith('gemini') ? ['JSON'] : []
      })
    }
  } catch (e) {
    throw friendly(e)
  }
  // Gemini models first, newest versions first (3.8 before 3.5 before 2.5).
  return out.sort((a, b) => {
    const ga = a.id.startsWith('gemini') ? 0 : 1
    const gb = b.id.startsWith('gemini') ? 0 : 1
    return ga - gb || b.id.localeCompare(a.id, 'en', { numeric: true })
  })
}

/** Structured JSON output; falls back to schema-in-prompt for models without JSON mode (e.g. Gemma). */
export async function generateJson(model: string, system: string, prompt: string, schema: object): Promise<unknown> {
  const ai = client()
  try {
    const res = await ai.models.generateContent({
      model,
      contents: prompt,
      config: { systemInstruction: system, responseMimeType: 'application/json', responseJsonSchema: schema }
    })
    return JSON.parse(res.text ?? '')
  } catch (e) {
    const msg = (e as Error)?.message ?? ''
    if (!/json|schema|mime|not supported|INVALID_ARGUMENT|Unexpected token|Expected/i.test(msg)) throw friendly(e)
  }
  try {
    const res = await ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        systemInstruction: `${system}\n\nReply with ONE JSON object only (no markdown, no commentary) that matches this JSON Schema:\n${JSON.stringify(schema)}`
      }
    })
    return extractJson(res.text ?? '')
  } catch (e) {
    throw friendly(e)
  }
}

/** Speaks one narration line. Returns a WAV file (24 kHz mono 16-bit). */
export async function speak(text: string, voice: string, languageCode: string, signal?: AbortSignal): Promise<Buffer> {
  try {
    const res = await client().models.generateContent({
      model: getSettings().geminiTtsModel,
      contents: [
        {
          role: 'user',
          parts: [{ text, speechMetadata: { style: 'natural storytelling narrator, clear and engaging, steady pace' } }]
        }
      ],
      config: {
        abortSignal: signal,
        responseModalities: ['AUDIO'],
        speechConfig: {
          languageCode,
          voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } }
        }
      }
    })
    const part = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)
    if (!part?.inlineData?.data) throw new Error('Gemini tidak mengirim audio')
    const bytes = Buffer.from(part.inlineData.data, 'base64')
    if (isWav(bytes)) return bytes
    const rate = Number(/rate=(\d+)/.exec(part.inlineData.mimeType ?? '')?.[1] ?? 24000)
    return pcmToWav(bytes, rate)
  } catch (e) {
    if (signal?.aborted) throw new Error('Dibatalkan')
    throw friendly(e)
  }
}

interface LibraryVoice {
  id?: string
  name?: string
  display_name?: string
  displayName?: string
  description?: string
  persona?: string | string[]
  language_code?: string
  languageCode?: string
}

/**
 * Prebuilt voices from Gemini's Voice Library (GET /v1beta/voices), kept for a day. Falls back to the
 * voices the app ships samples for, plus the classic 30, when the list cannot be fetched.
 */
export async function listVoices(): Promise<VoiceOption[]> {
  const cached = readCache<VoiceOption[]>('voices:gemini')
  if (cached && Date.now() - cached.updatedAt < 24 * 60 * 60 * 1000 && cached.value.length) return cached.value
  const fallback = (): VoiceOption[] => [
    ...GEMINI_LIBRARY_VOICES.map((v) => ({ id: v.id, name: v.name, description: v.tone })),
    ...GEMINI_VOICES.map((v) => ({ id: v.id, name: v.id, description: v.tone }))
  ]
  try {
    const out: VoiceOption[] = []
    let page = ''
    for (let i = 0; i < 10; i++) {
      const url = `https://generativelanguage.googleapis.com/v1beta/voices?type=prebuilt&page_size=1000${page ? `&page_token=${encodeURIComponent(page)}` : ''}`
      const res = await fetch(url, { headers: { 'x-goog-api-key': requireSecret('gemini') } })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const body = (await res.json()) as { voices?: LibraryVoice[]; next_page_token?: string; nextPageToken?: string }
      for (const v of body.voices ?? []) {
        const id = (v.id ?? v.name ?? '').replace(/^voices\//, '')
        if (!id) continue
        const persona = Array.isArray(v.persona) ? v.persona.join(', ') : v.persona
        out.push({ id, name: v.display_name ?? v.displayName ?? geminiVoiceName(id), description: geminiVoiceTone(id) ?? persona ?? v.description?.slice(0, 80) ?? '' })
      }
      page = body.next_page_token ?? body.nextPageToken ?? ''
      if (!page) break
    }
    if (!out.length) return fallback()
    // Voices with a bundled sample first, then the classic set, then the rest of the library.
    const rank = (id: string): number => (GEMINI_LIBRARY_VOICES.some((v) => v.id === id) ? 0 : GEMINI_VOICES.some((v) => v.id === id) ? 1 : 2)
    out.sort((a, b) => rank(a.id) - rank(b.id))
    writeCache('voices:gemini', out)
    return out
  } catch (e) {
    console.warn('[gemini] voice list:', (e as Error).message)
    return fallback()
  }
}

/** A character sheet sent along with an image prompt. */
export interface ImageRef {
  data: Buffer
  mimeType: string
}

/**
 * The Gemini API has no free tier for image output. On a key without billing the call fails with a quota of
 * zero, which reads like a busy server, so that case gets its own message.
 */
function friendlyImage(e: unknown): Error {
  const msg = (e as Error)?.message ?? String(e)
  if (/Dibatalkan|aborted/i.test(msg)) return new Error('Dibatalkan')
  if (/limit:\s*0|free_tier|FreeTier|billing/i.test(msg))
    return new Error(
      'Gambar Gemini (Nano Banana) tidak termasuk tier gratis. Aktifkan billing di Google AI Studio untuk proyek kunci ini, atau pilih model gambar gratis (Cloudflare).'
    )
  if (/SAFETY|blocked|PROHIBITED|IMAGE_SAFETY/i.test(msg))
    return new Error('Gemini menolak menggambar adegan ini karena aturan keamanannya. Ubah sedikit prompt gambarnya lalu coba lagi.')
  if (/not found|404|not supported/i.test(msg))
    return new Error(`Model gambar ini belum tersedia untuk kunci Gemini-mu. Coba model Nano Banana yang lain. (${msg.slice(0, 160)})`)
  return friendly(e)
}

/**
 * Draws one picture with a Nano Banana model through the Interactions API, which is what Google documents for
 * image output now. Character sheets go in as image parts after the prompt, in the order the prompt names them.
 */
export async function generateImage(
  model: { remote: string; imageSize?: string },
  prompt: string,
  aspect: '16:9' | '9:16',
  refs: ImageRef[],
  signal?: AbortSignal
): Promise<{ bytes: Buffer; contentType: string }> {
  const input = refs.length
    ? [
        { type: 'text' as const, text: prompt },
        ...refs.map((r) => ({ type: 'image' as const, mime_type: r.mimeType as 'image/png', data: r.data.toString('base64') }))
      ]
    : prompt
  for (let attempt = 0; ; attempt++) {
    try {
      const interaction = await client().interactions.create(
        {
          model: model.remote,
          input,
          response_format: { type: 'image', aspect_ratio: aspect, ...(model.imageSize ? { image_size: model.imageSize } : {}) }
        },
        // The SDK's own retries would also repeat a zero free-tier quota; the loop here only repeats what can clear up.
        { signal, maxRetries: 0 }
      )
      const image = interaction.output_image ?? findImage(interaction)
      if (!image?.data) {
        const said = typeof (interaction as { output_text?: string }).output_text === 'string' ? (interaction as { output_text?: string }).output_text : ''
        throw new Error(`Gemini tidak mengirim gambar${said ? `: ${said.slice(0, 200)}` : ' (mungkin ditahan filter keamanan)'}`)
      }
      return { bytes: Buffer.from(image.data, 'base64'), contentType: image.mime_type ?? 'image/png' }
    } catch (e) {
      if (signal?.aborted) throw new Error('Dibatalkan')
      const msg = (e as Error)?.message ?? ''
      // A busy server clears up; an exhausted free-tier quota (limit 0) never does, so it is not retried.
      const transient = /\b(429|500|502|503|504)\b|RESOURCE_EXHAUSTED|UNAVAILABLE|overloaded|ECONNRESET|ETIMEDOUT/i.test(msg) && !/limit:\s*0|billing/i.test(msg)
      if (transient && attempt < 3) {
        await new Promise((r) => setTimeout(r, 4000 * (attempt + 1)))
        continue
      }
      throw /Gemini tidak mengirim gambar/.test(msg) ? e : friendlyImage(e)
    }
  }
}

/** Some answers put the picture in a step instead of the `output_image` shortcut (mixed text and image output). */
function findImage(interaction: unknown): { data?: string; mime_type?: string } | undefined {
  const steps = (interaction as { steps?: { content?: { type?: string; data?: string; mime_type?: string }[] }[] }).steps ?? []
  for (const step of steps) for (const c of step.content ?? []) if (c.type === 'image' && c.data) return c
  return undefined
}

// ---------- face check (for the content rules) ----------

/** A face found in a picture, as fractions of the picture's width and height. */
export interface FaceBox {
  x: number
  y: number
  w: number
  h: number
}

const FACE_SCHEMA = {
  type: 'object',
  properties: {
    images: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          image: { type: 'integer', description: 'The image number, starting at 1.' },
          faces: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                label: { type: 'string', description: 'Short label, e.g. "woman", "cat", "cartoon boy".' },
                box_2d: { type: 'array', items: { type: 'integer' }, description: '[ymin, xmin, ymax, xmax], each scaled 0 to 1000.' }
              },
              required: ['label', 'box_2d']
            }
          }
        },
        required: ['image', 'faces']
      }
    }
  },
  required: ['images']
}

const FACE_PROMPT = [
  'You check pictures for visible faces. The pictures above are numbered in order, starting at 1.',
  'For EACH picture, list every face of a person or an animal where any of the eyes, nose, mouth, beak or muzzle can be seen:',
  'real, drawn, cartoon, stick-figure with features, 3D, painted or statue faces; faces in profile, partly hidden, tiny or in the background; faces on screens, posters and photos inside the picture.',
  'Do not list the back of a head, a head fully covered by a hood or hair, or a dark silhouette with no features.',
  'box_2d is [ymin, xmin, ymax, xmax] scaled 0 to 1000 and covers the whole face from forehead to chin and ear to ear (for animals the whole head front).',
  'Return every picture, with an empty faces list when it has none. When unsure whether something is a visible face, list it.'
].join(' ')

/** The writing model when it is a Gemini one (they all see pictures), then stable fallbacks. */
function faceModels(): string[] {
  const own = getSettings().llmModels?.gemini
  return [...new Set([own && /^gemini/i.test(own) ? own : '', 'gemini-2.5-flash', 'gemini-flash-latest'].filter(Boolean))]
}

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n))

/**
 * Finds the faces of people and animals in up to 16 pictures with one request. Returns one list per
 * picture, in order. A busy or rate-limited server is retried; a model the key cannot use moves on to the next.
 */
export async function detectFaces(images: ImageRef[], signal?: AbortSignal): Promise<FaceBox[][]> {
  if (!getSecret('gemini')) throw new Error('Sensor wajah butuh kunci Google Gemini (gratis). Isi dulu di Pengaturan.')
  const contents = [
    {
      role: 'user',
      parts: [
        ...images.flatMap((im, i) => [{ text: `Picture ${i + 1}:` }, { inlineData: { mimeType: im.mimeType, data: im.data.toString('base64') } }]),
        { text: FACE_PROMPT }
      ]
    }
  ]
  let lastError: unknown = null
  for (const model of faceModels()) {
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const res = await client().models.generateContent({
          model,
          contents,
          config: { abortSignal: signal, temperature: 0, responseMimeType: 'application/json', responseJsonSchema: FACE_SCHEMA }
        })
        const body = (JSON.parse(res.text ?? '') ?? {}) as { images?: { image?: number; faces?: { box_2d?: number[] }[] }[] }
        const out: FaceBox[][] = images.map(() => [])
        for (const [k, entry] of (body.images ?? []).entries()) {
          // Answers are numbered from 1; an answer without a usable number is taken in order.
          const n = Number(entry.image)
          const idx = Number.isInteger(n) && n >= 1 && n <= images.length ? n - 1 : k
          if (idx < 0 || idx >= images.length) continue
          for (const f of entry.faces ?? []) {
            const b = f.box_2d
            if (!Array.isArray(b) || b.length !== 4 || b.some((v) => !Number.isFinite(Number(v)))) continue
            const [y0, x0, y1, x1] = b.map((v) => clamp01(Number(v) / 1000))
            const x = Math.min(x0, x1)
            const y = Math.min(y0, y1)
            const w = Math.abs(x1 - x0)
            const h = Math.abs(y1 - y0)
            if (w > 0.002 && h > 0.002) out[idx].push({ x, y, w, h })
          }
        }
        return out
      } catch (e) {
        if (signal?.aborted) throw new Error('Dibatalkan')
        lastError = e
        const msg = (e as Error)?.message ?? ''
        if (/not found|404|not supported|INVALID_ARGUMENT/i.test(msg)) break
        if (/\b(429|500|502|503|504)\b|RESOURCE_EXHAUSTED|UNAVAILABLE|overloaded|ECONNRESET|ETIMEDOUT|Unexpected token|JSON/i.test(msg) && attempt < 3) {
          await new Promise((r) => setTimeout(r, [5000, 12000, 25000][attempt]))
          continue
        }
        throw friendly(e)
      }
    }
  }
  throw friendly(lastError ?? new Error('tidak ada model Gemini yang bisa memeriksa gambar'))
}
