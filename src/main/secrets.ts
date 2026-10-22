import { safeStorage } from 'electron'
import type { ApiProvider, KeyStatus } from '@shared/types'
import { getDb } from './db'
import { getSettings } from './settings'

const PROVIDERS: ApiProvider[] = ['higgsfield', 'gemini', 'elevenlabs', 'openrouter', 'groq', 'custom', 'cloudflare', 'pollinations']

export const PROVIDER_NAMES: Record<ApiProvider, string> = {
  higgsfield: 'Higgsfield',
  gemini: 'Google Gemini',
  elevenlabs: 'ElevenLabs',
  openrouter: 'OpenRouter',
  groq: 'Groq',
  custom: 'endpoint custom',
  cloudflare: 'Cloudflare',
  pollinations: 'Pollinations'
}

interface SecretRow {
  provider: ApiProvider
  value: Buffer
  last_ok: number | null
  last_message: string | null
  checked_at: number | null
}

/**
 * safeStorage (DPAPI on Windows) keeps its encryption key in Chromium's "Local State" file, which is only
 * written about ten seconds after the key is first created. Creating the key at startup means it is on disk
 * long before the user saves an API key, so killing the app (e.g. restarting the dev server) cannot orphan it.
 */
export function warmUpEncryption(): void {
  try {
    if (safeStorage.isEncryptionAvailable()) safeStorage.encryptString('bang-story')
  } catch {
    // Encryption unavailable; keys fall back to plain storage below.
  }
}

function decrypt(value: Buffer): string | null {
  try {
    return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(value) : value.toString('utf8')
  } catch {
    return null
  }
}

function mask(key: string): string {
  if (key.length <= 10) return '•'.repeat(Math.max(4, key.length))
  return `${key.slice(0, Math.min(8, Math.floor(key.length / 3)))}${'•'.repeat(10)}${key.slice(-4)}`
}

function row(provider: ApiProvider): SecretRow | undefined {
  return getDb().prepare('SELECT * FROM secrets WHERE provider = ?').get(provider) as SecretRow | undefined
}

export function setSecret(provider: ApiProvider, value: string): void {
  const enc = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(value) : Buffer.from(value, 'utf8')
  getDb()
    .prepare(
      `INSERT INTO secrets (provider, value) VALUES (?, ?)
       ON CONFLICT(provider) DO UPDATE SET value = excluded.value, last_ok = NULL, last_message = NULL, checked_at = NULL`
    )
    .run(provider, enc)
}

export function getSecret(provider: ApiProvider): string | null {
  const r = row(provider)
  if (!r || r.value.length === 0) return null
  const value = decrypt(r.value)
  if (value == null)
    throw new Error(
      `Kunci ${PROVIDER_NAMES[provider]} tersimpan tapi tidak bisa dibuka lagi (biasanya karena aplikasi ditutup paksa sesaat setelah kunci disimpan). Masukkan ulang kuncinya di Pengaturan.`
    )
  return value
}

export function requireSecret(provider: ApiProvider): string {
  const key = getSecret(provider)
  if (!key) throw new Error(`Kunci API ${PROVIDER_NAMES[provider]} belum diatur. Buka Pengaturan untuk menambahkannya.`)
  return key
}

/** Full key for the "show key" button; null when missing or unreadable. */
export function revealSecret(provider: ApiProvider): string | null {
  const r = row(provider)
  return r && r.value.length ? decrypt(r.value) : null
}

export function clearSecret(provider: ApiProvider): void {
  getDb().prepare('DELETE FROM secrets WHERE provider = ?').run(provider)
}

/** Test results for the custom endpoint are kept even when it has no key (local servers). */
export function recordCheck(provider: ApiProvider, ok: boolean, message: string): void {
  const now = Date.now()
  const res = getDb()
    .prepare('UPDATE secrets SET last_ok = ?, last_message = ?, checked_at = ? WHERE provider = ?')
    .run(ok ? 1 : 0, message, now, provider)
  if (res.changes === 0 && provider === 'custom') {
    getDb()
      .prepare('INSERT INTO secrets (provider, value, last_ok, last_message, checked_at) VALUES (?, ?, ?, ?, ?)')
      .run(provider, Buffer.alloc(0), ok ? 1 : 0, message, now)
  }
}

export function keyStatuses(): KeyStatus[] {
  const rows = getDb().prepare('SELECT * FROM secrets').all() as SecretRow[]
  const customUrl = getSettings().customBaseUrl.trim()
  return PROVIDERS.map((provider) => {
    const r = rows.find((x) => x.provider === provider)
    const hasKey = !!r && r.value.length > 0
    const value = hasKey ? decrypt(r!.value) : null
    const unreadable = hasKey && value == null
    return {
      provider,
      configured: provider === 'custom' ? !!customUrl : hasKey,
      lastOk: unreadable ? false : r?.last_ok == null ? null : r.last_ok === 1,
      lastMessage: unreadable ? 'Kunci tersimpan tapi tidak bisa dibuka lagi. Masukkan ulang kuncinya.' : (r?.last_message ?? null),
      checkedAt: r?.checked_at ?? null,
      preview: value ? mask(value) : null,
      unreadable
    }
  })
}
