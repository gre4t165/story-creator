import { createReadStream, statSync } from 'node:fs'
import { extname, join, normalize, sep } from 'node:path'
import { Readable } from 'node:stream'
import { protocol } from 'electron'
import { fontsDir, projectsRoot, sfxDir } from './paths'

const TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.ttf': 'font/ttf'
}

export function registerSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'studio', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }
  ])
}

/** Serves project assets, caption fonts and the sound effect library to the renderer, with Range support so audio and video can seek. */
export function handleStudioProtocol(): void {
  protocol.handle('studio', (req) => {
    const url = new URL(req.url)
    const root = url.hostname === 'fonts' ? fontsDir() : url.hostname === 'asset' ? projectsRoot() : url.hostname === 'sfx' ? sfxDir() : null
    if (!root) return new Response('Not found', { status: 404 })
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '')
    const abs = normalize(join(root, rel))
    if (!abs.startsWith(normalize(root) + sep)) return new Response('Forbidden', { status: 403 })
    let size: number
    try {
      size = statSync(abs).size
    } catch {
      return new Response('Not found', { status: 404 })
    }
    const type = TYPES[extname(abs).toLowerCase()] ?? 'application/octet-stream'
    const range = req.headers.get('range')
    const m = range ? /bytes=(\d*)-(\d*)/.exec(range) : null
    if (m) {
      const start = m[1] ? parseInt(m[1], 10) : Math.max(0, size - parseInt(m[2], 10))
      const end = m[1] && m[2] ? Math.min(parseInt(m[2], 10), size - 1) : size - 1
      if (start >= size || start > end) {
        return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
      }
      const body = Readable.toWeb(createReadStream(abs, { start, end })) as ReadableStream
      return new Response(body, {
        status: 206,
        headers: {
          'Content-Type': type,
          'Content-Length': String(end - start + 1),
          'Content-Range': `bytes ${start}-${end}/${size}`,
          'Accept-Ranges': 'bytes'
        }
      })
    }
    const body = Readable.toWeb(createReadStream(abs)) as ReadableStream
    return new Response(body, {
      status: 200,
      headers: { 'Content-Type': type, 'Content-Length': String(size), 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' }
    })
  })
}
