import type { AspectRatio, KeyTestResult } from '@shared/types'
import { freeImageSize, type FreeImageModel } from '@shared/freemodels'
import { getSecret, requireSecret } from '../secrets'
import { ApiError, readError, downloadTo, sleep } from './http'

/**
 * Pollinations. A free key (from enter.pollinations.ai) comes with a small daily allowance of "pollen".
 * This uses the OpenAI-compatible images endpoint and leaves the model unset, so Pollinations picks
 * whichever free model it currently offers. Written from the public API docs and not tested against
 * the live service, which is why the picker labels it experimental.
 */

const BASE = 'https://gen.pollinations.ai'

function friendly(status: number, detail: string): ApiError {
  if (status === 401 || status === 403)
    return new ApiError('Pollinations menolak kunci, atau jatah pollen harianmu habis. Periksa kuncinya di Pengaturan.', status)
  if (status === 402) return new ApiError('Jatah pollen Pollinations habis. Coba lagi besok, atau pilih model gambar lain.', status)
  if (status === 429 || status === 503) return new ApiError('Pollinations sedang sibuk atau membatasi permintaan. Coba lagi sebentar.', status, true)
  if (status >= 500) return new ApiError(`Server Pollinations sedang bermasalah (${status}).`, status, true)
  return new ApiError(`Pollinations gagal: ${detail}`, status)
}

export async function generateImage(
  model: FreeImageModel,
  prompt: string,
  aspect: AspectRatio,
  signal?: AbortSignal
): Promise<{ bytes: Buffer; contentType: string }> {
  const key = requireSecret('pollinations')
  const size = freeImageSize(aspect, model.longSide)
  const body: Record<string, unknown> = { prompt, size: `${size.width}x${size.height}`, response_format: 'b64_json', n: 1 }
  if (model.remote) body.model = model.remote
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(`${BASE}/v1/images/generations`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal
      })
      if (!res.ok) throw friendly(res.status, await readError(res))
      const out = (await res.json()) as { data?: { b64_json?: string; url?: string }[] }
      const item = out.data?.[0]
      if (item?.b64_json) return { bytes: Buffer.from(item.b64_json, 'base64'), contentType: 'image/png' }
      if (item?.url) return downloadTo(item.url, signal)
      throw new Error('Pollinations tidak mengirim gambar')
    } catch (e) {
      if (e instanceof ApiError && e.retryable && attempt < 3 && !signal?.aborted) {
        await sleep(3000 * (attempt + 1), signal)
        continue
      }
      throw e
    }
  }
}

/** Only the key's shape can be checked for free; a real picture is the first proof the key and allowance work. */
export async function testKey(key?: string): Promise<KeyTestResult> {
  const k = key ?? getSecret('pollinations')
  if (!k) return { ok: false, message: 'Kunci belum diatur' }
  if (!/^(sk|pk)_[A-Za-z0-9_-]{8,}$/.test(k.trim()))
    return { ok: false, message: 'Kunci Pollinations diawali sk_ atau pk_. Salin dari enter.pollinations.ai.' }
  return { ok: true, message: 'Kunci tersimpan. Bentuknya benar; yang pasti baru kelihatan saat membuat gambar pertama.' }
}
