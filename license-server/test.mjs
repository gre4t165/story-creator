// Tests the license server without Cloudflare or Mayar: a fake KV, a fake Mayar, and the token checked the same way
// the app checks it (Node crypto). Run: npm run license:test
import assert from 'node:assert/strict'
import { generateKeyPairSync, createPublicKey, verify } from 'node:crypto'
import worker from './src/index.js'

const { publicKey, privateKey } = generateKeyPairSync('ed25519')
const spki = publicKey.export({ type: 'spki', format: 'der' })
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' })

const store = new Map()
const env = {
  LICENSE_PRIVATE_KEY: pem,
  MAYAR_API_KEY: 'test-key',
  MAYAR_PRODUCT_ID: 'prod-1',
  MAX_DEVICES: '2',
  DEVICES: {
    get: async (k) => (store.has(k) ? JSON.parse(store.get(k)) : null),
    put: async (k, v) => void store.set(k, v)
  }
}

const GOOD = 'ABCD-1234-EFGH'
let mayarDown = false
const mayarCalls = []
globalThis.fetch = async (url, init) => {
  mayarCalls.push({ url: String(url), auth: init.headers.Authorization, body: JSON.parse(init.body) })
  if (mayarDown) throw new Error('network')
  const body = JSON.parse(init.body)
  return new Response(JSON.stringify({ statusCode: 200, isLicenseActive: body.licenseCode === GOOD && body.productId === 'prod-1' }), { status: 200 })
}

const D1 = 'a'.repeat(32)
const D2 = 'b'.repeat(32)
const D3 = 'c'.repeat(32)
const call = async (path, body) => {
  const res = await worker.fetch(new Request(`https://lic.example${path}`, { method: 'POST', body: JSON.stringify(body) }), env)
  return { status: res.status, data: await res.json() }
}

/** Exactly what main/license.ts does with a token. */
const b64 = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
function read(token, device) {
  const [payload, sig] = token.split('.')
  const key = createPublicKey({ key: spki, format: 'der', type: 'spki' })
  if (!verify(null, Buffer.from(payload), key, b64(sig))) return null
  const t = JSON.parse(b64(payload).toString('utf8'))
  return t.device === device ? t : null
}

let n = 0
const ok = (name) => console.log(`${String(++n).padStart(2)} ok  ${name}`)

// 1
let r = await call('/activate', { code: GOOD, device: D1, name: 'PC-1' })
assert.equal(r.status, 200)
const t1 = read(r.data.token, D1)
assert.ok(t1, 'token verifies for its device')
assert.equal(t1.plan, 'pro')
assert.equal(t1.code, '1234'.slice(0, 0) + 'EFGH')
assert.ok(Math.abs(t1.exp - t1.iat - 35 * 86400000) < 1000)
ok('activate: signed token for this computer, 35 days, last 4 characters of the code')

// 2 Mayar is asked the way its docs say
const c = mayarCalls[0]
assert.equal(c.url, 'https://api.mayar.id/saas/v1/license/verify')
assert.equal(c.auth, 'Bearer test-key')
assert.deepEqual(c.body, { licenseCode: GOOD, productId: 'prod-1' })
ok('verify call: URL, Bearer key, licenseCode + productId')

// 3 the same token is no good on another computer, and a tampered one is no good anywhere
assert.equal(read(r.data.token, D2), null)
const [p, s] = r.data.token.split('.')
const forged = Buffer.from(JSON.stringify({ ...JSON.parse(b64(p).toString()), exp: Date.now() + 9e12 })).toString('base64url')
assert.equal(read(`${forged}.${s}`, D1), null)
ok('a token only works on its computer; editing it breaks the signature')

// 4 second computer fits, third does not
assert.equal((await call('/activate', { code: GOOD, device: D2, name: 'PC-2' })).status, 200)
r = await call('/activate', { code: GOOD, device: D3, name: 'PC-3' })
assert.equal(r.status, 409)
assert.match(r.data.message, /2 komputer/)
ok('device limit: 2 computers fit, the 3rd is refused with a clear message')

// 5 re-activating on a computer that already has a place is fine
assert.equal((await call('/activate', { code: GOOD, device: D1, name: 'PC-1' })).status, 200)
ok('the same computer can activate again')

// 6 deactivating frees a place
assert.equal((await call('/deactivate', { code: GOOD, device: D2 })).status, 200)
assert.equal((await call('/activate', { code: GOOD, device: D3, name: 'PC-3' })).status, 200)
ok('deactivate frees the place for another computer')

// 7 refresh renews
r = await call('/refresh', { code: GOOD, device: D1 })
assert.equal(r.status, 200)
assert.ok(read(r.data.token, D1))
ok('refresh: a new token')

// 8 wrong code
r = await call('/activate', { code: 'NOPE-0000', device: D1 })
assert.equal(r.status, 404)
assert.match(r.data.message, /tidak ditemukan/)
ok('unknown code: 404 with a message')

// 9 a code that stops being valid (refund) revokes on refresh
const realFetch = globalThis.fetch
globalThis.fetch = async () => new Response(JSON.stringify({ statusCode: 200, isLicenseActive: false }), { status: 200 })
r = await call('/refresh', { code: GOOD, device: D1 })
assert.equal(r.status, 403)
assert.equal(r.data.revoked, true)
globalThis.fetch = realFetch
ok('refund: refresh answers 403 + revoked, so the app drops its license')

// 10 Mayar down is not the buyer's fault
mayarDown = true
r = await call('/activate', { code: GOOD, device: D1 })
assert.equal(r.status, 503)
assert.equal(r.data.revoked, undefined)
mayarDown = false
ok('Mayar unreachable: 503, never "revoked"')

// 11 junk input
assert.equal((await call('/activate', { code: '', device: D1 })).status, 400)
assert.equal((await call('/activate', { code: GOOD, device: 'not hex!' })).status, 400)
assert.equal((await call('/nope', { code: GOOD, device: D1 })).status, 404)
assert.equal((await worker.fetch(new Request('https://lic.example/', { method: 'GET' }), env)).status, 200)
ok('bad input is refused; GET / is a health check')

// 12 the product id is part of the check: a code of another product must not pass
globalThis.fetch = async (url, init) => new Response(JSON.stringify({ isLicenseActive: JSON.parse(init.body).productId === 'other' }), { status: 200 })
assert.equal((await call('/activate', { code: GOOD, device: D1 })).status, 404)
globalThis.fetch = realFetch
ok('the code is only valid for our product id')

console.log(`\n${n} pengujian server lisensi lolos`)
