// Makes the key pair that signs licenses.
//   npm run license:keys
// The PUBLIC key goes into src/shared/license-config.ts (the app checks signatures with it). The PRIVATE key goes
// to license-server/private-key.pem (never committed) and from there to the license server as a secret. Running
// this again replaces the keys and invalidates every license already sold, so it refuses unless given --force.
const { generateKeyPairSync } = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const config = path.join(root, 'src', 'shared', 'license-config.ts')
const privatePath = path.join(root, 'license-server', 'private-key.pem')
const force = process.argv.includes('--force')

const source = fs.readFileSync(config, 'utf8')
const already = /LICENSE_PUBLIC_KEY\s*=\s*'[^']+'/.test(source)
if ((already || fs.existsSync(privatePath)) && !force) {
  console.error('Kunci sudah ada. Membuat ulang membuat SEMUA lisensi yang sudah terjual tidak berlaku.\nKalau memang itu yang kamu mau: npm run license:keys -- --force')
  process.exit(1)
}

const { publicKey, privateKey } = generateKeyPairSync('ed25519')
const pub = publicKey.export({ type: 'spki', format: 'der' }).toString('base64')
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' })

fs.mkdirSync(path.dirname(privatePath), { recursive: true })
fs.writeFileSync(privatePath, pem, { mode: 0o600 })
fs.writeFileSync(config, source.replace(/(LICENSE_PUBLIC_KEY\s*=\s*)'[^']*'/, `$1'${pub}'`))

console.log('Kunci dibuat.')
console.log('  Kunci publik  -> src/shared/license-config.ts (ikut di aplikasi)')
console.log('  Kunci privat  -> license-server/private-key.pem (JANGAN di-commit, jangan dibagikan)')
console.log('\nLangkah berikutnya: pasang kunci privat ke server lisensi, lalu bangun ulang aplikasinya.')
console.log('  cd license-server && npx wrangler secret put LICENSE_PRIVATE_KEY < private-key.pem')
console.log('Panduan lengkap: license-server/README.md')
