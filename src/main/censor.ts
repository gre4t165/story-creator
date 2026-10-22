import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import type { CensorStyle } from '@shared/content'
import { binPath } from './paths'
import { probeDurationMs, probeSize } from './services/audio'
import * as gemini from './services/gemini'

/**
 * The face check behind the content rules: every finished picture and AI video is shown to Gemini, and any
 * face of a person or animal it finds is blurred (or pixelated) with ffmpeg before the file is stored.
 * Prompts already ask for faces to be hidden; this catches the ones the image or video model drew anyway.
 */

export interface Region {
  x: number
  y: number
  w: number
  h: number
  /** Seconds, for videos only: when the region is covered. */
  from?: number
  to?: number
}

function ffmpeg(args: string[], signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('Dibatalkan'))
    const p = spawn(binPath(ffmpegStatic as unknown as string), ['-hide_banner', '-nostdin', '-v', 'error', '-y', ...args], { windowsHide: true })
    let err = ''
    const abort = (): void => {
      p.kill('SIGKILL')
    }
    signal?.addEventListener('abort', abort, { once: true })
    p.stderr.on('data', (d) => (err = (err + d).slice(-3000)))
    p.on('error', (e) => reject(new Error(`FFmpeg tidak bisa dijalankan: ${e.message}`)))
    p.on('close', (code) => {
      signal?.removeEventListener('abort', abort)
      if (signal?.aborted) return reject(new Error('Dibatalkan'))
      if (code === 0) resolve()
      else reject(new Error(`Sensor wajah gagal (ffmpeg): ${err.trim().slice(-300) || `kode ${code}`}`))
    })
  })
}

const even = (n: number): number => Math.max(2, Math.round(n / 2) * 2)

/**
 * A face box grown so hair, ears and a little movement stay covered, in pixels of a W×H frame, with even
 * position and size (needed for 4:2:0 video).
 */
export function toPixels(b: gemini.FaceBox, W: number, H: number, grow: number): Region {
  const cx = (b.x + b.w / 2) * W
  const cy = (b.y + b.h / 2) * H
  // A face is roughly as wide as it is tall; growing from the larger side keeps thin detections covered.
  const side = Math.max(b.w * W, b.h * H)
  const w = Math.min(W, Math.max(b.w * W, side * 0.85) * (1 + grow))
  const h = Math.min(H, Math.max(b.h * H, side * 0.85) * (1 + grow))
  let x = Math.max(0, Math.min(W - w, cx - w / 2))
  let y = Math.max(0, Math.min(H - h, cy - h / 2))
  const ew = Math.min(even(w), W - (W % 2))
  const eh = Math.min(even(h), H - (H % 2))
  x = Math.max(0, Math.min(W - ew, Math.floor(x / 2) * 2))
  y = Math.max(0, Math.min(H - eh, Math.floor(y / 2) * 2))
  return { x, y, w: ew, h: eh }
}

/** The filter that turns one cropped face region into an unrecognisable patch. */
export function patchFilter(style: CensorStyle, w: number, h: number): string {
  if (style === 'mosaic') {
    // About nine blocks across the larger side: clearly censored, no features left.
    const block = Math.max(2, Math.max(w, h) / 9)
    return `scale=${Math.max(1, Math.round(w / block))}:${Math.max(1, Math.round(h / block))}:flags=area,scale=${w}:${h}:flags=neighbor`
  }
  // Shrinking hard then blurring and enlarging again removes all detail, with soft edges inside the patch.
  return `scale=${Math.max(2, Math.round(w / 14))}:${Math.max(2, Math.round(h / 14))}:flags=area,gblur=sigma=1.5,scale=${w}:${h}:flags=bicubic`
}

/** One filter graph that covers every region; video regions are only switched on during their time window. */
export function censorGraph(regions: Region[], style: CensorStyle, pixFmt: 'rgb24' | 'yuv420p'): string {
  const n = regions.length
  const parts = [`[0:v]format=${pixFmt},split=${n + 1}[base]${regions.map((_, i) => `[s${i}]`).join('')}`]
  regions.forEach((r, i) => parts.push(`[s${i}]crop=${r.w}:${r.h}:${r.x}:${r.y},${patchFilter(style, r.w, r.h)},format=${pixFmt}[p${i}]`))
  let prev = 'base'
  regions.forEach((r, i) => {
    const out = i === n - 1 ? 'out' : `o${i}`
    const when = r.from != null && r.to != null ? `:enable='between(t,${r.from.toFixed(3)},${r.to.toFixed(3)})'` : ''
    parts.push(`[${prev}][p${i}]overlay=${r.x}:${r.y}${when}[${out}]`)
    prev = out
  })
  return parts.join(';')
}

function workDir(): string {
  return mkdtempSync(join(tmpdir(), 'storycreator-censor-'))
}

function mimeOf(contentType: string): string {
  return /jpe?g/.test(contentType) ? 'image/jpeg' : /webp/.test(contentType) ? 'image/webp' : 'image/png'
}

/**
 * Checks one picture and covers every face found. Returns the picture to store (PNG when anything was covered,
 * otherwise the original bytes) and how many faces were covered.
 */
export async function censorImage(
  bytes: Buffer,
  contentType: string,
  style: CensorStyle,
  signal?: AbortSignal
): Promise<{ bytes: Buffer; contentType: string; faces: number }> {
  const [boxes] = await gemini.detectFaces([{ data: bytes, mimeType: mimeOf(contentType) }], signal)
  if (!boxes?.length) return { bytes, contentType, faces: 0 }
  const dir = workDir()
  try {
    const ext = mimeOf(contentType).split('/')[1].replace('jpeg', 'jpg')
    const input = join(dir, `in.${ext}`)
    writeFileSync(input, bytes)
    const size = await probeSize(input)
    if (!size) throw new Error('Ukuran gambar tidak terbaca untuk sensor wajah.')
    const regions = boxes.map((b) => toPixels(b, size.width, size.height, 0.3))
    const output = join(dir, 'out.png')
    await ffmpeg(['-i', input, '-filter_complex', censorGraph(regions, style, 'rgb24'), '-map', '[out]', '-frames:v', '1', output], signal)
    return { bytes: readFileSync(output), contentType: 'image/png', faces: boxes.length }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * Checks an AI video: frames are sampled (up to 3 a second, at most 30), all faces are found in as few
 * requests as possible, and each face is covered from shortly before to shortly after the frame it was
 * seen in, with extra margin so movement between samples stays covered.
 */
export async function censorVideo(
  bytes: Buffer,
  style: CensorStyle,
  signal?: AbortSignal,
  onStep?: (fraction: number) => void
): Promise<{ bytes: Buffer; contentType: string; faces: number }> {
  const dir = workDir()
  try {
    const input = join(dir, 'in.mp4')
    writeFileSync(input, bytes)
    const [size, durationMs] = await Promise.all([probeSize(input), probeDurationMs(input).catch(() => 0)])
    if (!size || !durationMs) throw new Error('Video tidak terbaca untuk sensor wajah.')
    const dur = durationMs / 1000
    const rate = Math.min(3, 30 / dur)
    await ffmpeg(['-i', input, '-vf', `fps=${rate.toFixed(4)},scale=640:-2`, '-q:v', '4', join(dir, 'f%03d.jpg')], signal)
    const frames = readdirSync(dir)
      .filter((f) => /^f\d+\.jpg$/.test(f))
      .sort()
      .map((f) => readFileSync(join(dir, f)))
    if (!frames.length) throw new Error('Tidak ada frame yang bisa diperiksa.')
    onStep?.(0.2)
    const found: gemini.FaceBox[][] = []
    for (let i = 0; i < frames.length; i += 16) {
      found.push(...(await gemini.detectFaces(frames.slice(i, i + 16).map((data) => ({ data, mimeType: 'image/jpeg' })), signal)))
      onStep?.(0.2 + 0.5 * Math.min(1, (i + 16) / frames.length))
    }
    const half = 0.75 / rate
    const regions: Region[] = []
    found.forEach((boxes, i) => {
      const t = i / rate
      // The first and last samples also cover the very start and end of the clip.
      const from = i === 0 ? 0 : Math.max(0, t - half)
      const to = i === found.length - 1 ? dur + 1 : Math.min(dur + 1, t + half)
      for (const b of boxes) regions.push({ ...toPixels(b, size.width, size.height, 0.45), from, to })
    })
    const faces = found.reduce((s, f) => s + f.length, 0)
    if (!regions.length) return { bytes, contentType: 'video/mp4', faces: 0 }
    const output = join(dir, 'out.mp4')
    await ffmpeg(
      [
        '-i', input,
        '-filter_complex', censorGraph(regions.slice(0, 150), style, 'yuv420p'),
        '-map', '[out]', '-map', '0:a?',
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '17', '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart',
        output
      ],
      signal
    )
    onStep?.(1)
    return { bytes: readFileSync(output), contentType: 'video/mp4', faces }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
