/**
 * License server for Story Creator, a Cloudflare Worker.
 *
 * The app never talks to the payment platform: that needs a secret API key, which cannot live in an app anyone can
 * unpack. The app sends the activation code here; this server asks Mayar whether the code is valid, keeps the list
 * of computers a code is used on, and answers with a token signed for one computer (Ed25519). The app checks the
 * signature offline, so a license keeps working without internet.
 *
 * Secrets (npx wrangler secret put ...):  LICENSE_PRIVATE_KEY (PEM), MAYAR_API_KEY, MAYAR_PRODUCT_ID
 * Variables (wrangler.toml, optional):    MAYAR_BASE (default https://api.mayar.id), MAX_DEVICES (default 2)
 * KV namespace:                           DEVICES
 */

const TOKEN_LIFETIME_MS = 35 * 24 * 60 * 60 * 1000

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

async function sha256Hex(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

let signingKey = null
async function privateKey(env) {
  if (signingKey) return signingKey
  const pem = String(env.LICENSE_PRIVATE_KEY || '')
  const der = Uint8Array.from(atob(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')), (c) => c.charCodeAt(0))
  signingKey = await crypto.subtle.importKey('pkcs8', der, { name: 'Ed25519' }, false, ['sign'])
  return signingKey
}

/** token = base64url(payload JSON) + "." + base64url(signature of that first part). */
async function signToken(env, device, code) {
  const now = Date.now()
  const payload = b64url(new TextEncoder().encode(JSON.stringify({ v: 1, plan: 'pro', device, code: code.slice(-4).toUpperCase(), iat: now, exp: now + TOKEN_LIFETIME_MS })))
  const sig = await crypto.subtle.sign('Ed25519', await privateKey(env), new TextEncoder().encode(payload))
  return `${payload}.${b64url(sig)}`
}

/**
 * Asks Mayar whether the code is a valid, active license of our product.
 * Returns true, false (not valid), or throws (Mayar unreachable or our key refused: not the buyer's fault).
 */
async function mayarSaysValid(env, code) {
  const base = String(env.MAYAR_BASE || 'https://api.mayar.id').replace(/\/+$/, '')
  const res = await fetch(`${base}/saas/v1/license/verify`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.MAYAR_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ licenseCode: code, productId: env.MAYAR_PRODUCT_ID })
  })
  if (res.status === 401 || res.status === 403) throw new Error('Mayar menolak API key server ini')
  const body = await res.json().catch(() => ({}))
  const active = body?.isLicenseActive ?? body?.data?.isLicenseActive
  return res.ok && active === true
}

const cleanCode = (v) => String(v || '').trim().replace(/\s+/g, '')
const cleanDevice = (v) => (/^[0-9a-f]{16,64}$/i.test(String(v || '')) ? String(v).toLowerCase() : '')

async function registry(env, code) {
  const key = `lic:${await sha256Hex(code)}`
  const stored = await env.DEVICES.get(key, 'json')
  return { key, devices: stored?.devices ?? {} }
}

/** Gives the computer a place on the code (or confirms it has one), then answers with its token. */
async function grant(env, { code, device, name }) {
  const max = Math.max(1, Number(env.MAX_DEVICES) || 2)
  const reg = await registry(env, code)
  if (!reg.devices[device]) {
    if (Object.keys(reg.devices).length >= max) {
      return json(409, {
        message: `Kode ini sudah dipakai di ${max} komputer. Nonaktifkan di komputer lama (Pengaturan › Lisensi › Nonaktifkan) lalu coba lagi, atau hubungi penjual.`
      })
    }
    reg.devices[device] = { name: String(name || '').slice(0, 60), at: Date.now() }
    await env.DEVICES.put(reg.key, JSON.stringify({ devices: reg.devices }))
  }
  return json(200, { token: await signToken(env, device, code) })
}

async function handle(request, env) {
  const url = new URL(request.url)
  if (request.method === 'GET') return json(200, { ok: true, service: 'story-creator-license' })
  if (request.method !== 'POST') return json(405, { message: 'Metode tidak didukung.' })

  const body = await request.json().catch(() => ({}))
  const code = cleanCode(body.code)
  const device = cleanDevice(body.device)
  if (!code || !device) return json(400, { message: 'Kode atau ID komputer tidak lengkap.' })

  if (url.pathname === '/deactivate') {
    const reg = await registry(env, code)
    if (reg.devices[device]) {
      delete reg.devices[device]
      await env.DEVICES.put(reg.key, JSON.stringify({ devices: reg.devices }))
    }
    return json(200, { ok: true })
  }

  if (url.pathname !== '/activate' && url.pathname !== '/refresh') return json(404, { message: 'Alamat tidak dikenal.' })

  let valid
  try {
    valid = await mayarSaysValid(env, code)
  } catch (e) {
    console.error('license check failed:', e instanceof Error ? e.message : e)
    return json(503, { message: 'Server lisensi sedang bermasalah. Coba lagi beberapa menit lagi.' })
  }
  if (!valid) {
    // On a renewal this means the code was refunded or switched off: the app drops its license.
    return json(url.pathname === '/refresh' ? 403 : 404, { revoked: true, message: 'Kode aktivasi tidak ditemukan atau sudah tidak berlaku. Periksa lagi kodenya.' })
  }
  return grant(env, { code, device, name: body.name })
}

export default {
  async fetch(request, env) {
    try {
      return await handle(request, env)
    } catch (e) {
      console.error('license server error:', e instanceof Error ? e.message : e)
      return json(500, { message: 'Terjadi kesalahan di server lisensi.' })
    }
  }
}
