import type { AspectRatio, KeyTestResult } from '@shared/types'
import { freeImageSize, type FreeImageModel } from '@shared/freemodels'
import { getSecret, requireSecret } from '../secrets'
import { ApiError, readError, sleep } from './http'

/**
 * Cloudflare Workers AI. Its free plan gives 10,000 "neurons" a day (the allowance resets at 00:00 UTC,
 * 07:00 WIB), enough for roughly 170 FLUX.1 schnell pictures. The stored key is `ACCOUNT_ID:API_TOKEN`,
 * the same shape as the Higgsfield key, because the REST API needs both.
 */

const BASE = 'https://api.cloudflare.com/client/v4'

export function splitCredentials(raw: string): { accountId: string; token: string } {
  const i = raw.indexOf(':')
  const accountId = raw.slice(0, i).trim()
  const token = raw.slice(i + 1).trim()
  if (i < 0 || !/^[0-9a-f]{32}$/i.test(accountId) || !token)
    throw new Error('Format kunci Cloudflare salah. Tulis ACCOUNT_ID:API_TOKEN, yaitu Account ID (32 karakter) lalu titik dua lalu token.')
  return { accountId, token }
}

function friendly(status: number, detail: string): ApiError {
  if (/neurons|daily free allocation|free allocation|4006/i.test(detail))
    return new ApiError('Jatah gratis harian Cloudflare habis. Jatahnya terisi lagi pukul 07:00 WIB, atau pilih model gambar lain.', status)
  if (status === 401 || status === 403 || /authentication|permission/i.test(detail))
    return new ApiError(
      'Cloudflare menolak kunci. Pastikan Account ID benar dan tokennya punya izin "Workers AI" (template "Workers AI" saat membuat token).',
      status
    )
  if (status === 429) return new ApiError('Cloudflare sedang membatasi permintaan. Coba lagi sebentar.', status, true)
  if (status === 400 || status === 422) return new ApiError(`Cloudflare menolak permintaan: ${detail}`, status)
  if (status >= 500) return new ApiError(`Server Cloudflare sedang bermasalah (${status}).`, status, true)
  return new ApiError(`Cloudflare gagal: ${detail}`, status)
}

/** A short pause-and-retry loop for the errors that clear up by themselves (rate limit, a busy server). */
async function withRetry<T>(fn: () => Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn()
    } catch (e) {
      if (e instanceof ApiError && e.retryable && attempt < 3 && !signal?.aborted) {
        await sleep(2500 * (attempt + 1), signal)
        continue
      }
      throw e
    }
  }
}

/** Draws one picture. Cloudflare answers with the PNG itself or with JSON holding it in base64, by model. */
export async function generateImage(
  model: FreeImageModel,
  prompt: string,
  aspect: AspectRatio,
  signal?: AbortSignal
): Promise<{ bytes: Buffer; contentType: string }> {
  const { accountId, token } = splitCredentials(requireSecret('cloudflare'))
  const body: Record<string, unknown> = { prompt }
  if (model.id === 'cloudflare/flux-1-schnell') {
    // Four steps is the model's default and what the free allowance is priced for; eight is its ceiling.
    body.steps = 4
  } else {
    const size = freeImageSize(aspect, model.longSide)
    body.width = size.width
    body.height = size.height
    body.num_steps = 8
  }
  return withRetry(async () => {
    const res = await fetch(`${BASE}/accounts/${accountId}/ai/run/${model.remote}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal
    })
    if (!res.ok) throw friendly(res.status, await readCloudflareError(res))
    const type = res.headers.get('content-type') ?? ''
    if (/^image\//i.test(type)) return { bytes: Buffer.from(await res.arrayBuffer()), contentType: type }
    const json = (await res.json()) as { result?: { image?: string }; success?: boolean; errors?: { message?: string }[] }
    const b64 = json.result?.image
    if (!b64) throw new Error(`Cloudflare tidak mengirim gambar${json.errors?.[0]?.message ? `: ${json.errors[0].message}` : ''}`)
    return { bytes: Buffer.from(b64, 'base64'), contentType: 'image/jpeg' }
  }, signal)
}

/** Cloudflare errors look like `{ errors: [{ code, message }] }`; fall back to the shared reader for anything else. */
async function readCloudflareError(res: Response): Promise<string> {
  const text = await res.text().catch(() => '')
  try {
    const body = JSON.parse(text) as { errors?: { code?: number; message?: string }[] }
    const e = body.errors?.[0]
    if (e) return `${e.code ? `${e.code}: ` : ''}${e.message ?? ''}`.trim()
  } catch {
    // not JSON
  }
  return text.slice(0, 300) || `HTTP ${res.status}`
}

/** Checks that the token is active. It cannot see the "Workers AI" permission, so a wrong scope shows up on the first picture. */
export async function testKey(raw?: string): Promise<KeyTestResult> {
  const value = raw ?? getSecret('cloudflare')
  if (!value) return { ok: false, message: 'Kunci belum diatur' }
  try {
    const { accountId, token } = splitCredentials(value)
    const res = await fetch(`${BASE}/accounts/${accountId}/tokens/verify`, { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) throw friendly(res.status, await readError(res))
    const out = (await res.json()) as { result?: { status?: string } }
    if (out.result?.status && out.result.status !== 'active') return { ok: false, message: `Token Cloudflare tidak aktif (${out.result.status})` }
    return { ok: true, message: 'Terhubung · token aktif. Jatah gratis 10.000 neuron per hari' }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}
