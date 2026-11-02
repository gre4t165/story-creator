import { createHash, createPublicKey, randomUUID, verify } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { hostname } from 'node:os'
import { app } from 'electron'
import { LICENSE_PUBLIC_KEY, LICENSE_SERVER_URL, BUY_URL } from '@shared/license-config'
import { FREE_LIMITS, TOKEN_RECHECK_MS, proMessage, type LicenseFeature, type LicenseState, type LicenseToken } from '@shared/license'
import { getDb } from './db'
import { listProjects } from './repo'

/**
 * Free or Pro, decided here so the editor cannot be talked into anything. Pro is a token that the license server
 * signed for this computer after it checked the activation code with the payment platform. The signature is
 * checked offline, so a Pro computer keeps working without a connection; the token is renewed in the background
 * every 30 days, and stops working after 35 if the app could never reach the server.
 */

interface Stored {
  code: string
  token: string
  activatedAt: number
}

// Tests (the dev harness) point the app at their own key and server. An installed build only trusts what was built in.
const dev = !app.isPackaged
const publicKeyB64 = (dev && process.env.STUDIO_LICENSE_PUBKEY) || LICENSE_PUBLIC_KEY
const serverUrl = ((dev && process.env.STUDIO_LICENSE_SERVER) || LICENSE_SERVER_URL).replace(/\/+$/, '')

const configured = (): boolean => !!publicKeyB64 && !!serverUrl

// ---------- which computer ----------

let device: string | null = null

/** A stable id of this Windows installation (its MachineGuid), hashed so it says nothing about the machine. */
export function deviceId(): string {
  if (device) return device
  let raw = ''
  try {
    const out = execFileSync('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'], { windowsHide: true, encoding: 'utf8' })
    raw = /MachineGuid\s+REG_SZ\s+(\S+)/.exec(out)?.[1] ?? ''
  } catch {
    // Not Windows, or the registry is locked down: use a random id kept with the app's data instead.
  }
  if (!raw) {
    const row = getDb().prepare("SELECT value FROM settings WHERE key = 'license.device'").get() as { value: string } | undefined
    raw = row ? (JSON.parse(row.value) as string) : randomUUID()
    if (!row) getDb().prepare("INSERT INTO settings (key, value) VALUES ('license.device', ?)").run(JSON.stringify(raw))
  }
  device = createHash('sha256').update(`story-creator:${raw}`).digest('hex').slice(0, 32)
  return device
}

// ---------- storage ----------

function load(): Stored | null {
  const row = getDb().prepare("SELECT value FROM settings WHERE key = 'license'").get() as { value: string } | undefined
  if (!row) return null
  try {
    const s = JSON.parse(row.value) as Stored
    return typeof s.token === 'string' && typeof s.code === 'string' ? s : null
  } catch {
    return null
  }
}

function save(s: Stored | null): void {
  if (!s) getDb().prepare("DELETE FROM settings WHERE key = 'license'").run()
  else getDb().prepare("INSERT INTO settings (key, value) VALUES ('license', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(s))
}

// ---------- tokens ----------

const b64urlToBuf = (s: string): Buffer => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')

/** The token's content when its signature is ours and it was issued for this computer; otherwise null. */
export function readToken(token: string): LicenseToken | null {
  if (!publicKeyB64) return null
  const [payload, sig] = token.split('.')
  if (!payload || !sig) return null
  try {
    const key = createPublicKey({ key: Buffer.from(publicKeyB64, 'base64'), format: 'der', type: 'spki' })
    if (!verify(null, Buffer.from(payload), key, b64urlToBuf(sig))) return null
    const t = JSON.parse(b64urlToBuf(payload).toString('utf8')) as LicenseToken
    if (t.v !== 1 || t.plan !== 'pro' || t.device !== deviceId() || !Number.isFinite(t.iat) || !Number.isFinite(t.exp)) return null
    return t
  } catch {
    return null
  }
}

function current(): { stored: Stored; token: LicenseToken } | null {
  const stored = load()
  const token = stored ? readToken(stored.token) : null
  return stored && token ? { stored, token } : null
}

/**
 * A build without a license key and server has no way to sell or activate Pro, so it applies no limits at all:
 * shipping one by mistake must never lock people out of what they had. The limits start when both are filled in
 * (see shared/license-config.ts).
 */
const unrestricted = (): boolean => !configured()

export function isPro(): boolean {
  if (unrestricted()) return true
  const c = current()
  return !!c && Date.now() < c.token.exp
}

export function licenseState(): LicenseState {
  if (unrestricted()) {
    return { plan: 'pro', status: 'active', code: null, activatedAt: null, nextCheckAt: null, deviceId: deviceId().slice(0, 8).toUpperCase(), configured: false, buyUrl: BUY_URL }
  }
  const c = current()
  const active = !!c && Date.now() < c.token.exp
  return {
    plan: active ? 'pro' : 'free',
    status: active ? 'active' : c ? 'recheck' : 'free',
    code: c ? `••••-${c.token.code}` : null,
    activatedAt: c?.stored.activatedAt ?? null,
    nextCheckAt: c ? c.token.iat + TOKEN_RECHECK_MS : null,
    deviceId: deviceId().slice(0, 8).toUpperCase(),
    configured: configured(),
    buyUrl: BUY_URL
  }
}

/** Throws the "Pro only" error the editor turns into the upgrade dialog. */
export function requirePro(feature: LicenseFeature): void {
  if (!isPro()) throw new Error(proMessage(feature))
}

/** A free project count that is already over the limit (made before Pro existed) is left alone; only new ones are refused. */
export function assertCanAddProject(): void {
  if (!isPro() && listProjects().length >= FREE_LIMITS.maxProjects) throw new Error(proMessage('more-projects'))
}

// ---------- talking to the license server ----------

interface ServerAnswer {
  token?: string
  message?: string
  /** The code is no longer valid (refunded, disabled): the license must be dropped. */
  revoked?: boolean
}

async function ask(path: string, body: Record<string, unknown>): Promise<{ status: number; data: ServerAnswer }> {
  if (!configured()) throw new Error('Server lisensi belum diatur di versi aplikasi ini.')
  let res: Response
  try {
    res = await fetch(`${serverUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, device: deviceId() }),
      signal: AbortSignal.timeout(20_000)
    })
  } catch {
    throw new Error('Tidak bisa tersambung ke server lisensi. Periksa koneksi internet, lalu coba lagi.')
  }
  const data = (await res.json().catch(() => ({}))) as ServerAnswer
  return { status: res.status, data }
}

const clean = (code: string): string => code.trim().replace(/\s+/g, '')

export async function activate(code: string): Promise<LicenseState> {
  const c = clean(code)
  if (c.length < 6) throw new Error('Kode aktivasi terlalu pendek. Salin utuh dari email atau halaman pembelian.')
  const { status, data } = await ask('/activate', { code: c, name: hostname() })
  if (status !== 200 || !data.token) throw new Error(data.message ?? 'Kode tidak bisa diaktifkan.')
  if (!readToken(data.token)) throw new Error('Jawaban server lisensi tidak bisa dipercaya (tanda tangannya salah). Hubungi penjual.')
  save({ code: c, token: data.token, activatedAt: Date.now() })
  return licenseState()
}

/** Frees this computer's place on the code, so it can be used on another one. */
export async function deactivate(): Promise<LicenseState> {
  const stored = load()
  if (stored && configured()) {
    // If the server cannot be reached the license is still dropped here; the place is freed at the next try from another computer.
    await ask('/deactivate', { code: stored.code }).catch(() => undefined)
  }
  save(null)
  return licenseState()
}

/** Renews the token when it is 30 days old. A refused code (refunded) ends Pro; no connection changes nothing. */
export async function refreshLicense(force = false): Promise<void> {
  const c = current()
  const stored = load()
  if (!stored || !configured()) return
  if (!force && c && Date.now() < c.token.iat + TOKEN_RECHECK_MS) return
  try {
    const { status, data } = await ask('/refresh', { code: stored.code })
    if (status === 200 && data.token && readToken(data.token)) save({ ...stored, token: data.token })
    else if (data.revoked || status === 403 || status === 404) save(null)
  } catch {
    // Offline: the old token keeps working until it expires.
  }
}

/** Checks at startup and then twice a day while the app stays open. */
export function startLicenseChecks(): void {
  void refreshLicense()
  setInterval(() => void refreshLicense(), 12 * 60 * 60 * 1000).unref()
}
