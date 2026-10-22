import type { KeyTestResult, LlmProvider, ModelList, ModelOption, ModelSource } from '@shared/types'
import { getSecret, PROVIDER_NAMES } from '../secrets'
import { getSettings, readCache, writeCache } from '../settings'
import * as eleven from './elevenlabs'
import * as gemini from './gemini'
import { readError } from './http'
import { extractJson } from './json'

const STALE_MS = 24 * 60 * 60 * 1000
const GENERATE_TIMEOUT_MS = 4 * 60 * 1000

type CompatProvider = Exclude<LlmProvider, 'gemini'>

interface Compat {
  provider: CompatProvider
  base: string
  key: string | null
  headers: Record<string, string>
}

export class LlmError extends Error {
  constructor(
    message: string,
    public status = 0,
    public detail = ''
  ) {
    super(message)
  }
}

function compat(provider: CompatProvider, keyOverride?: string | null, baseOverride?: string): Compat {
  const key = keyOverride !== undefined ? keyOverride : getSecret(provider)
  if (provider === 'openrouter') {
    // App attribution; OpenRouter asks apps without a public URL to send the title header.
    return { provider, base: 'https://openrouter.ai/api/v1', key, headers: { 'X-OpenRouter-Title': 'Story Creator', 'X-Title': 'Story Creator' } }
  }
  if (provider === 'groq') return { provider, base: 'https://api.groq.com/openai/v1', key, headers: {} }
  const base = (baseOverride ?? getSettings().customBaseUrl).trim().replace(/\/+$/, '')
  if (!base) throw new LlmError('Alamat endpoint custom belum diisi. Buka Pengaturan untuk menambahkannya.')
  return { provider, base, key, headers: {} }
}

function requireKey(c: Compat): void {
  if (c.provider !== 'custom' && !c.key)
    throw new LlmError(`Kunci API ${PROVIDER_NAMES[c.provider]} belum diatur. Buka Pengaturan untuk menambahkannya.`)
}

const KEY_PROBLEM = /api key|credential|unauthenticated|unauthori[sz]ed|user not found/i

function friendlyStatus(c: Compat, status: number, detail: string): string {
  const name = PROVIDER_NAMES[c.provider]
  if (status === 401 || (status === 400 && KEY_PROBLEM.test(detail))) return `Kunci ${name} ditolak. Periksa kunci di Pengaturan.`
  if (status === 402) return `Saldo atau limit kredit ${name} habis. Isi ulang lalu coba lagi.`
  if (status === 403) return `${name} menolak permintaan ini: ${detail}`
  if (status === 404) return `Model atau layanan tidak ditemukan di ${name}: ${detail}`
  if (status === 408 || status === 504 || status === 524) return `${name} terlalu lama merespons. Coba lagi atau pilih model yang lebih cepat.`
  if (status === 413) return `Permintaan terlalu panjang untuk model ini. Pilih model dengan konteks lebih besar.`
  if (status === 429) return `${name} sedang membatasi permintaan (rate limit). Tunggu sebentar lalu coba lagi.`
  if (status >= 500) return `Server ${name} sedang bermasalah (${status}). Coba lagi nanti atau pilih model lain.`
  return `${name} menolak permintaan (${status}): ${detail}`
}

async function call<T>(c: Compat, path: string, init: RequestInit = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${c.base}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(c.key ? { Authorization: `Bearer ${c.key}` } : {}),
        ...c.headers,
        ...(init.headers ?? {})
      }
    })
  } catch (e) {
    if ((e as Error).name === 'TimeoutError') throw new LlmError(`${PROVIDER_NAMES[c.provider]} terlalu lama merespons.`, 408)
    if ((e as Error).name === 'AbortError') throw e
    throw new LlmError(`Tidak bisa terhubung ke ${c.provider === 'custom' ? c.base : PROVIDER_NAMES[c.provider]}: ${(e as Error).message}`)
  }
  if (!res.ok) {
    const detail = await readError(res)
    throw new LlmError(friendlyStatus(c, res.status, detail), res.status, detail)
  }
  return (await res.json()) as T
}

// ---------- model lists ----------

const perMillion = (v: unknown): number | null => {
  const n = Number(v)
  // Router models such as openrouter/auto report "-1" (variable price).
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 1e6 * 10000) / 10000 : null
}

async function openRouterModels(): Promise<ModelOption[]> {
  const c = compat('openrouter')
  // Without parameters the list holds text-output models only.
  const r = await call<{ data: any[] }>(c, '/models')
  return r.data
    .filter((m) => !String(m.id).endsWith(':batch'))
    .filter((m) => !m.architecture?.output_modalities || m.architecture.output_modalities.includes('text'))
    .map((m): ModelOption => {
      const params: string[] = m.supported_parameters ?? []
      const priceIn = perMillion(m.pricing?.prompt)
      const priceOut = perMillion(m.pricing?.completion)
      const tags: string[] = []
      if (params.includes('structured_outputs') || params.includes('response_format')) tags.push('JSON')
      if (priceIn === 0 && priceOut === 0) tags.push('Gratis')
      if (m.reasoning || params.includes('reasoning')) tags.push('Reasoning')
      if (m.architecture?.input_modalities?.includes('image')) tags.push('Gambar')
      return {
        id: m.id,
        name: m.name ?? m.id,
        description: typeof m.description === 'string' ? m.description.slice(0, 280) : undefined,
        contextLength: m.context_length ?? m.top_provider?.context_length ?? null,
        priceIn,
        priceOut,
        tags
      }
    })
}

/** Groq lists speech and safety models next to chat models; keep the ones that write text. */
const GROQ_NOT_CHAT = /whisper|tts|orpheus|playai|guard|safeguard|embed/i

async function groqModels(): Promise<ModelOption[]> {
  const c = compat('groq')
  requireKey(c)
  const r = await call<{ data: { id: string; owned_by?: string; active?: boolean; context_window?: number; max_completion_tokens?: number }[] }>(c, '/models')
  return r.data
    .filter((m) => m.active !== false && !GROQ_NOT_CHAT.test(m.id))
    .map(
      (m): ModelOption => ({
        id: m.id,
        name: m.id,
        description: m.max_completion_tokens ? `Maks ${m.max_completion_tokens.toLocaleString('id-ID')} token keluaran` : undefined,
        contextLength: m.context_window ?? null,
        priceIn: null,
        priceOut: null,
        tags: m.owned_by ? [m.owned_by] : []
      })
    )
    .sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }))
}

async function customModels(): Promise<ModelOption[]> {
  const c = compat('custom')
  const r = await call<{ data?: { id: string; owned_by?: string }[]; models?: { name?: string; model?: string; id?: string }[] }>(c, '/models')
  const list = r.data ?? r.models?.map((m) => ({ id: m.id ?? m.model ?? m.name ?? '', owned_by: undefined })) ?? []
  return list
    .filter((m) => m.id)
    .map((m) => ({ id: m.id, name: m.id, description: m.owned_by ? `Pemilik: ${m.owned_by}` : undefined, tags: [] }))
}

async function fetchModels(source: ModelSource): Promise<ModelOption[]> {
  switch (source) {
    case 'gemini':
      return gemini.listModels('text')
    case 'gemini-tts':
      return gemini.listModels('tts')
    case 'elevenlabs':
      return eleven.listModels()
    case 'openrouter':
      return openRouterModels()
    case 'groq':
      return groqModels()
    case 'custom':
      return customModels()
  }
}

function cacheKey(source: ModelSource): string {
  return source === 'custom' ? `models:custom:${getSettings().customBaseUrl.trim()}` : `models:${source}`
}

export async function listModels(source: ModelSource, refresh = false): Promise<ModelList> {
  const key = cacheKey(source)
  const cached = readCache<ModelOption[]>(key)
  if (cached && !refresh && Date.now() - cached.updatedAt < STALE_MS) return { models: cached.value, fetchedAt: cached.updatedAt }
  const models = await fetchModels(source)
  const fetchedAt = writeCache(key, models)
  return { models, fetchedAt }
}

// ---------- key checks ----------

export async function testLlm(provider: LlmProvider, key?: string | null, baseUrl?: string): Promise<KeyTestResult> {
  if (provider === 'gemini') return gemini.testKey(key ?? undefined)
  try {
    const c = compat(provider, key, baseUrl)
    requireKey(c)
    if (provider === 'openrouter') {
      const r = await call<{
        data?: { limit_remaining?: number | null; usage?: number; is_free_tier?: boolean }
      }>(c, '/key')
      const d = r.data ?? {}
      const parts = ['Terhubung']
      if (d.limit_remaining != null) parts.push(`sisa limit kunci $${d.limit_remaining.toFixed(2)}`)
      else if (d.usage != null) parts.push(`terpakai $${d.usage.toFixed(2)}`)
      if (d.is_free_tier) parts.push('akun belum pernah top up, hanya model gratis dengan batas harian')
      return { ok: true, message: parts.join(' · ') }
    }
    // Groq and OpenAI-compatible servers have no key-info endpoint; listing models proves the key works.
    const models = provider === 'groq' ? await groqModels() : await customModels()
    return { ok: true, message: `Terhubung · ${models.length} model tersedia` }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}

// ---------- structured generation ----------

function contentText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map((p) => (typeof p === 'string' ? p : (p?.text ?? ''))).join('')
  return ''
}

type Mode = 'json_schema' | 'json_object' | 'plain'

/** The model answered, but not with usable JSON; a stricter prompt in the next mode may fix it. */
class BadReply extends Error {}

/** A 4xx that says the model or its route cannot do this response format, so a simpler format is worth trying. */
function formatUnsupported(e: unknown): boolean {
  if (!(e instanceof LlmError)) return false
  if (![400, 404, 422].includes(e.status)) return false
  if (KEY_PROBLEM.test(e.detail) || /does not exist|model.*not found/i.test(e.detail)) return false
  if (e.status === 400) return true
  return /response_format|json|schema|structured|parameter|endpoint|support/i.test(e.detail)
}

async function chatJson(c: Compat, model: string, system: string, prompt: string, schema: object, name: string, signal?: AbortSignal): Promise<unknown> {
  requireKey(c)
  const schemaText = JSON.stringify(schema)
  const modes: Mode[] = ['json_schema', 'json_object', 'plain']
  let lastError: unknown = null
  for (const mode of modes) {
    const sys =
      mode === 'json_schema'
        ? system
        : `${system}\n\nReply with ONE JSON object only (no markdown, no commentary) that matches this JSON Schema:\n${schemaText}`
    const body: Record<string, unknown> = {
      model,
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: prompt }
      ]
    }
    if (mode === 'json_schema') body.response_format = { type: 'json_schema', json_schema: { name, strict: true, schema } }
    if (mode === 'json_object') body.response_format = { type: 'json_object' }
    if (c.provider === 'openrouter' && mode === 'json_schema') {
      // Only route to providers that really enforce the schema, and let OpenRouter repair near-miss JSON.
      body.provider = { require_parameters: true }
      body.plugins = [{ id: 'response-healing' }]
    }
    try {
      const timeout = AbortSignal.timeout(GENERATE_TIMEOUT_MS)
      const r = await call<{
        choices?: { message?: { content?: unknown; refusal?: string | null }; finish_reason?: string; error?: { message?: string } }[]
        error?: { message?: string }
      }>(c, '/chat/completions', {
        method: 'POST',
        body: JSON.stringify(body),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout
      })
      // A 200 can still carry an error.
      const choice = r.choices?.[0]
      const inlineError = r.error?.message ?? (choice?.finish_reason === 'error' ? (choice.error?.message ?? 'error') : null)
      if (inlineError) throw new LlmError(`${PROVIDER_NAMES[c.provider]} gagal: ${inlineError}`, 400, inlineError)
      if (choice?.message?.refusal) throw new LlmError(`Model menolak permintaan: ${choice.message.refusal}`, 403, choice.message.refusal)
      const text = contentText(choice?.message?.content)
      if (!text.trim()) throw new BadReply(choice?.finish_reason === 'length' ? 'length' : 'empty')
      try {
        return extractJson(text)
      } catch {
        throw new BadReply('not json')
      }
    } catch (e) {
      if (signal?.aborted) throw e
      lastError = e
      if (e instanceof BadReply || formatUnsupported(e)) continue
      throw e
    }
  }
  if (lastError instanceof LlmError) throw lastError
  if (lastError instanceof BadReply && lastError.message === 'length')
    throw new LlmError(`Jawaban model "${model}" terpotong sebelum selesai. Coba durasi video lebih pendek atau model dengan output lebih panjang.`)
  throw new LlmError(`Model "${model}" tidak menghasilkan JSON yang valid. Coba pilih model lain di Pengaturan.`)
}

export interface ActiveLlm {
  provider: LlmProvider
  model: string
}

export function activeLlm(): ActiveLlm {
  const s = getSettings()
  return { provider: s.llmProvider, model: s.llmModels[s.llmProvider]?.trim() ?? '' }
}

/** Generates a JSON object that follows `schema` with whichever LLM the user made active. */
export async function generateJson<T>(req: { system: string; prompt: string; schema: object; name: string; signal?: AbortSignal }): Promise<T> {
  const { provider, model } = activeLlm()
  if (!model) throw new LlmError(`Pilih model ${PROVIDER_NAMES[provider]} dulu di Pengaturan › Kunci API dan model.`)
  if (provider === 'gemini') return (await gemini.generateJson(model, req.system, req.prompt, req.schema)) as T
  return (await chatJson(compat(provider), model, req.system, req.prompt, req.schema, req.name, req.signal)) as T
}
