// Renders src/renderer/src/assets/logo.svg into build/icon.png and build/icon.ico (the installer, exe and taskbar
// icon), so the app icon is always the logo the app shows. Run with Electron, which draws the SVG exactly as the
// app does:  npx electron scripts/make-icon.cjs
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const svg = fs.readFileSync(path.join(root, 'src', 'renderer', 'src', 'assets', 'logo.svg'), 'utf8')
// Each size is drawn on its own rather than scaled down from a big one, so small icons stay sharp.
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]
const PNG_SIZE = 512

/** One window big enough for the largest size: each size is drawn in its top-left corner and cut out from there. */
async function renderer() {
  const win = new BrowserWindow({ width: 600, height: 600, useContentSize: true, show: false, frame: false, transparent: true, webPreferences: { offscreen: true } })
  const src = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
  const html = `<html><body style="margin:0;background:transparent;overflow:hidden"><img id="logo" src="${src}" style="display:block"></body></html>`
  await win.loadURL(`data:text/html;base64,${Buffer.from(html).toString('base64')}`)
  return {
    async draw(size) {
      await win.webContents.executeJavaScript(`(() => { const i = document.getElementById('logo'); i.style.width = i.style.height = '${size}px'; return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))) })()`)
      await new Promise((r) => setTimeout(r, 120))
      let img = await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size })
      const s = img.getSize()
      if (s.width !== size || s.height !== size) img = img.resize({ width: size, height: size, quality: 'best' })
      return img.toPNG()
    },
    close: () => win.destroy()
  }
}

/** An .ico that holds PNG images, which Windows reads from Vista on. */
function ico(pngs) {
  const head = Buffer.alloc(6)
  head.writeUInt16LE(0, 0)
  head.writeUInt16LE(1, 2)
  head.writeUInt16LE(pngs.length, 4)
  const entries = []
  let offset = 6 + 16 * pngs.length
  for (const { size, data } of pngs) {
    const e = Buffer.alloc(16)
    e.writeUInt8(size >= 256 ? 0 : size, 0)
    e.writeUInt8(size >= 256 ? 0 : size, 1)
    e.writeUInt8(0, 2)
    e.writeUInt8(0, 3)
    e.writeUInt16LE(1, 4)
    e.writeUInt16LE(32, 6)
    e.writeUInt32LE(data.length, 8)
    e.writeUInt32LE(offset, 12)
    offset += data.length
    entries.push(e)
  }
  return Buffer.concat([head, ...entries, ...pngs.map((p) => p.data)])
}

app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  const out = path.join(root, 'build')
  fs.mkdirSync(out, { recursive: true })
  const r = await renderer()
  const pngs = []
  for (const size of ICO_SIZES) pngs.push({ size, data: await r.draw(size) })
  fs.writeFileSync(path.join(out, 'icon.ico'), ico(pngs))
  fs.writeFileSync(path.join(out, 'icon.png'), await r.draw(PNG_SIZE))
  r.close()
  console.log(`build/icon.ico (${ICO_SIZES.join(', ')} px) dan build/icon.png (${PNG_SIZE} px) dibuat`)
  app.quit()
})
