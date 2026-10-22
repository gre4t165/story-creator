// Rebuilds src/shared/sfx-catalog.json from resources/sfx: one group per sound, with every variant and its length.
// Run after adding or removing .ogg files: node scripts/sfx-catalog.cjs
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const ffmpeg = require('ffmpeg-static')
const dir = path.join(root, 'resources', 'sfx')
const groups = {}
for (const pack of fs.readdirSync(dir)) {
  for (const f of fs.readdirSync(path.join(dir, pack)).filter((x) => x.endsWith('.ogg')).sort()) {
    // ffmpeg -i without an output prints the stream info and exits with an error, which is expected here.
    let info = ''
    try {
      execFileSync(ffmpeg, ['-hide_banner', '-i', path.join(dir, pack, f)], { stdio: 'pipe' })
    } catch (e) {
      info = String(e.stderr)
    }
    const m = /Duration:\s*(\d+):(\d+):([\d.]+)/.exec(info)
    const ms = m ? Math.round((+m[1] * 3600 + +m[2] * 60 + +m[3]) * 1000) : 0
    // Variants share a name and differ by a trailing number: footstep_wood_000.ogg, doorOpen_1.ogg, whoosh2.ogg.
    const base = f.replace(/\.ogg$/, '').replace(/_?\d+$/, '') || f.replace(/\.ogg$/, '')
    const id = `${pack}/${base}`
    ;(groups[id] ??= { id, files: [] }).files.push({ file: `${pack}/${f}`, ms })
  }
}
fs.writeFileSync(path.join(root, 'src', 'shared', 'sfx-catalog.json'), JSON.stringify(Object.values(groups)) + '\n')
console.log(`${Object.keys(groups).length} suara ditulis ke src/shared/sfx-catalog.json`)
