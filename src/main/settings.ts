import { DEFAULT_CONTENT_RULES, normalizeRules } from '@shared/content'
import { resolveImageModelId } from '@shared/freemodels'
import { DEFAULT_IMAGE_MODEL, DEFAULT_VIDEO_MODEL, getVideoModel } from '@shared/higgsfield'
import type { AppSettings } from '@shared/types'
import { getDb } from './db'

export const DEFAULT_SETTINGS: AppSettings = {
  defaultTtsProvider: 'gemini',
  defaultLanguage: 'id',
  exportFolder: null,
  llmProvider: 'gemini',
  llmModels: { gemini: 'gemini-3.8-flash', openrouter: '', groq: '', custom: '' },
  customBaseUrl: '',
  geminiTtsModel: 'gemini-3.8-flash-tts',
  elevenModel: 'eleven_multilingual_v2',
  localTtsUrl: 'http://127.0.0.1:17493',
  imageModel: DEFAULT_IMAGE_MODEL,
  videoModel: DEFAULT_VIDEO_MODEL,
  whisperAuto: true,
  contentRules: DEFAULT_CONTENT_RULES
}

export function getSettings(): AppSettings {
  const rows = getDb().prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[]
  const out: AppSettings = { ...DEFAULT_SETTINGS, llmModels: { ...DEFAULT_SETTINGS.llmModels } }
  for (const r of rows) {
    if (!(r.key in out)) continue
    const value = JSON.parse(r.value)
    if (r.key === 'llmModels') out.llmModels = { ...out.llmModels, ...value }
    else if (r.key === 'contentRules') out.contentRules = normalizeRules(value)
    else (out as unknown as Record<string, unknown>)[r.key] = value
  }
  // A provider that no longer exists (e.g. from an older build) falls back to Gemini.
  if (!(out.llmProvider in DEFAULT_SETTINGS.llmModels)) out.llmProvider = 'gemini'
  // Models dropped from the catalogs fall back to the defaults. Free image models are valid here too.
  out.imageModel = resolveImageModelId(out.imageModel)
  out.videoModel = getVideoModel(out.videoModel).id
  return out
}

export function setSettings(patch: Partial<AppSettings>): AppSettings {
  const current = getSettings()
  const stmt = getDb().prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  )
  getDb().transaction(() => {
    for (const [k, v] of Object.entries(patch)) {
      if (!(k in DEFAULT_SETTINGS)) continue
      const value =
        k === 'llmModels'
          ? { ...current.llmModels, ...(v as object) }
          : k === 'contentRules'
            ? normalizeRules({ ...current.contentRules, ...(v as object) })
            : v
      stmt.run(k, JSON.stringify(value))
    }
  })()
  return getSettings()
}

// ---------- small key/value cache (model lists) ----------

export function readCache<T>(key: string): { value: T; updatedAt: number } | null {
  const row = getDb().prepare('SELECT value, updated_at FROM cache WHERE key = ?').get(key) as
    | { value: string; updated_at: number }
    | undefined
  return row ? { value: JSON.parse(row.value) as T, updatedAt: row.updated_at } : null
}

export function writeCache(key: string, value: unknown): number {
  const now = Date.now()
  getDb()
    .prepare('INSERT INTO cache (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
    .run(key, JSON.stringify(value), now)
  return now
}

export function dropCache(prefix: string): void {
  getDb().prepare('DELETE FROM cache WHERE key LIKE ?').run(`${prefix}%`)
}

/** The model name stored on a narration asset, for the history list. */
export function ttsModelName(provider: AppSettings['defaultTtsProvider']): string {
  const s = getSettings()
  return provider === 'gemini' ? s.geminiTtsModel : provider === 'edge' ? 'edge-tts' : provider === 'local' ? 'voicebox' : s.elevenModel
}
