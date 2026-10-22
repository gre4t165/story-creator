import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts'
import { EDGE_FALLBACK_VOICES } from '@shared/models'
import type { KeyTestResult, VoiceOption, WordTiming } from '@shared/types'
import { readCache, writeCache } from '../settings'

/**
 * Microsoft Edge "Read Aloud" voices: free, no account and no key, with the exact time of every word, so
 * caption karaoke is precise without Whisper. It is the same service Edge uses to read pages aloud, not a
 * product Microsoft documents or promises, so it can change or be blocked without notice. The app says so
 * in Settings and keeps Gemini and ElevenLabs as the dependable options.
 */

const FORMAT = OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3
/** Voice languages the app offers, plus the English variants worth listing. */
const LOCALES = /^(id|ms|jv|su|es|ar)-|^en-(US|GB|AU)$/i
const DAY = 24 * 60 * 60 * 1000

/**
 * The narration as plain spoken text. Edge ignores most SSML, so the voice tags become punctuation, which
 * it does pause on: a short pause is a comma, a long one a full stop. Other tags are dropped.
 */
export function plainForEdge(text: string): string {
  let out = ''
  const push = (piece: string): void => {
    out += piece
  }
  const last = (): string => out.trimEnd().slice(-1)
  for (const part of text.split(/(<[^<>]{1,40}>|\[[^[\]]{1,40}\])/)) {
    const tag = /^[<[]\s*([^<>[\]]+?)\s*[>\]]$/.exec(part)?.[1]?.toLowerCase()
    if (!tag) push(part)
    else if (tag === 'short pause' && !/[.,;:!?…]/.test(last())) out = `${out.trimEnd()}, `
    else if (tag === 'long pause' && !/[.!?…]/.test(last())) out = `${out.trimEnd().replace(/[,;:]$/, '')}. `
    else push(' ')
  }
  return out.replace(/\s+/g, ' ').trim()
}

/** Several scenes as one take: each ends on sentence punctuation, so the voice breathes between them. */
export function joinScenes(scenes: string[]): string {
  return scenes
    .map(plainForEdge)
    .filter(Boolean)
    .map((s) => (/[.!?…]["')\]]?$/.test(s) ? s : `${s}.`))
    .join(' ')
}

const escapeXml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')

/** One WordBoundary event as the service sends it: times in 100-nanosecond ticks. */
interface Boundary {
  Type?: string
  Data?: { Offset?: number; Duration?: number; text?: { Text?: string } }
}

/**
 * The word timings in a metadata stream. Punctuation arrives as its own "word" for some voices; it is not
 * spoken or captioned, so only tokens with a letter or digit are kept.
 */
export function parseBoundaries(chunks: string[]): WordTiming[] {
  const out: WordTiming[] = []
  for (const chunk of chunks) {
    let parsed: { Metadata?: Boundary[] }
    try {
      parsed = JSON.parse(chunk)
    } catch {
      continue
    }
    for (const item of parsed.Metadata ?? []) {
      if (item.Type !== 'WordBoundary') continue
      const text = item.Data?.text?.Text?.trim()
      const offset = item.Data?.Offset
      if (!text || offset == null || !/[\p{L}\p{N}]/u.test(text)) continue
      const start = offset / 1e7
      out.push({ text, start, end: start + Math.max(0.05, (item.Data?.Duration ?? 0) / 1e7) })
    }
  }
  // Words never overlap: a long final syllable must not run into the next word.
  for (let i = 0; i < out.length - 1; i++) out[i].end = Math.min(out[i].end, out[i + 1].start)
  return out
}

function friendly(e: unknown): Error {
  const msg = (e as Error)?.message ?? String(e)
  if (/Dibatalkan/.test(msg)) return e as Error
  if (/403|401|forbidden/i.test(msg))
    return new Error('Microsoft menolak sambungan Edge TTS. Layanan ini tidak resmi dan kadang diblokir. Coba lagi nanti, atau pakai suara Gemini atau ElevenLabs.')
  if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|network|socket|WebSocket/i.test(msg))
    return new Error('Tidak bisa tersambung ke layanan suara Edge. Periksa koneksi internet, lalu coba lagi.')
  return new Error(`Suara Edge gagal: ${msg}`)
}

/** Speaks narration and returns MP3 bytes with the time of each spoken word. */
export async function speak(text: string, voice: string, signal?: AbortSignal): Promise<{ audio: Buffer; words: WordTiming[] }> {
  const plain = plainForEdge(text)
  if (!plain) throw new Error('Naskah kosong setelah tag suara dibuang')
  if (!voice) throw new Error('Pilih suara Edge dulu di langkah Ide cerita.')
  const tts = new MsEdgeTTS()
  let abort: (() => void) | undefined
  try {
    await tts.setMetadata(voice, FORMAT, { wordBoundaryEnabled: true })
    const { audioStream, metadataStream } = tts.toStream(escapeXml(plain))
    const audio: Buffer[] = []
    const meta: string[] = []
    await new Promise<void>((resolve, reject) => {
      // The service goes quiet instead of failing when it dislikes a request, so a stall has to end the wait.
      let idle = setTimeout(() => reject(new Error('Layanan suara Edge tidak merespons')), 45_000)
      const touch = (): void => {
        clearTimeout(idle)
        idle = setTimeout(() => reject(new Error('Layanan suara Edge berhenti merespons di tengah jalan')), 45_000)
      }
      abort = (): void => {
        clearTimeout(idle)
        audioStream.destroy()
        metadataStream?.destroy()
        reject(new Error('Dibatalkan'))
      }
      if (signal?.aborted) return abort()
      signal?.addEventListener('abort', abort, { once: true })
      audioStream.on('data', (d: Buffer) => {
        audio.push(d)
        touch()
      })
      metadataStream?.on('data', (d: Buffer) => meta.push(d.toString()))
      // `on`, not `once`: closing the socket can raise a second error, and an unhandled one would crash the app.
      audioStream.on('error', (e) => {
        clearTimeout(idle)
        reject(e)
      })
      metadataStream?.on('error', () => undefined)
      audioStream.once('close', () => {
        clearTimeout(idle)
        resolve()
      })
    })
    const bytes = Buffer.concat(audio)
    if (!bytes.length) throw new Error('Layanan suara Edge tidak mengirim audio')
    return { audio: bytes, words: parseBoundaries(meta) }
  } catch (e) {
    if (signal?.aborted) throw new Error('Dibatalkan')
    throw friendly(e)
  } finally {
    if (abort) signal?.removeEventListener('abort', abort)
    tts.close()
  }
}

const shortName = (id: string): string =>
  id
    .split('-')
    .slice(2)
    .join('-')
    .replace(/Neural$/, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')

const describe = (gender: string, locale: string): string => `${/^male$/i.test(gender) ? 'Pria' : 'Wanita'} · ${locale}`

/** Voices for the languages the app writes in, the project's language first. Falls back to a built-in list. */
export async function listVoices(language?: string): Promise<VoiceOption[]> {
  let all = readCache<VoiceOption[]>('voices:edge')
  if (!all || Date.now() - all.updatedAt > DAY || !all.value.length) {
    try {
      const voices = await new MsEdgeTTS().getVoices()
      const list = voices
        .filter((v) => LOCALES.test(v.Locale) && (!v.Status || /^ga$/i.test(v.Status)))
        .map((v) => ({ id: v.ShortName, name: shortName(v.ShortName), description: describe(v.Gender, v.Locale) }))
      if (list.length) {
        writeCache('voices:edge', list)
        all = { value: list, updatedAt: Date.now() }
      }
    } catch (e) {
      console.warn('[edge] voice list:', (e as Error).message)
    }
  }
  const list = all?.value ?? EDGE_FALLBACK_VOICES.map((v) => ({ id: v.id, name: shortName(v.id), description: describe(v.gender, v.locale) }))
  const lang = (language ?? '').toLowerCase()
  const rank = (v: VoiceOption): number => (lang && v.id.toLowerCase().startsWith(`${lang}-`) ? 0 : 1)
  return [...list].sort((a, b) => rank(a) - rank(b))
}

/** Speaks a short sample, to show in Settings that the service answers from this computer. */
export async function testConnection(): Promise<KeyTestResult> {
  try {
    const r = await speak('Halo, ini tes suara.', 'id-ID-ArdiNeural')
    const spoken = r.words.length
    return { ok: true, message: `Terhubung · suara Edge menjawab (${Math.round(r.audio.length / 1024)} KB, ${spoken} kata bertanda waktu)` }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}
