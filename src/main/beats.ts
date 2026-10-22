import { execFile } from 'node:child_process'
import ffmpegStatic from 'ffmpeg-static'
import { binPath } from './paths'

/**
 * Rough beat times of a song, so picture cuts can land on the music. Not a real beat tracker: it finds the
 * moments where loudness jumps (drums, chord changes), which is what an edit on the beat follows anyway.
 */

const RATE = 11025
const HOP = 256
const MIN_GAP_SEC = 0.3

function decode(absPath: string): Promise<Int16Array> {
  return new Promise((resolve, reject) => {
    execFile(
      binPath(ffmpegStatic!),
      ['-hide_banner', '-nostats', '-i', absPath, '-vn', '-ac', '1', '-ar', String(RATE), '-f', 's16le', '-'],
      { windowsHide: true, encoding: 'buffer', maxBuffer: 512 * 1024 * 1024 },
      (err, stdout) => {
        if (err && !stdout?.length) return reject(new Error('Musik tidak bisa dibaca untuk mencari ketukan'))
        const buf = stdout as Buffer
        resolve(new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 2)))
      }
    )
  })
}

export async function detectBeats(absPath: string): Promise<number[]> {
  const pcm = await decode(absPath)
  const frames = Math.floor(pcm.length / HOP)
  if (frames < 8) return []
  // Loudness per hop on a log scale, then how much it rose since the previous hop (onset strength).
  const flux = new Float64Array(frames)
  let prev = 0
  for (let f = 0; f < frames; f++) {
    let sum = 0
    for (let i = f * HOP; i < (f + 1) * HOP; i++) sum += pcm[i] * pcm[i]
    const level = Math.log10(1e-3 + sum / HOP)
    flux[f] = Math.max(0, level - prev)
    prev = level
  }
  // A peak counts when it stands clearly above its surroundings (about one second either side).
  const win = Math.round(RATE / HOP)
  const minGap = Math.round((MIN_GAP_SEC * RATE) / HOP)
  const beats: number[] = []
  let last = -minGap
  for (let f = 1; f < frames - 1; f++) {
    if (flux[f] < flux[f - 1] || flux[f] < flux[f + 1] || f - last < minGap) continue
    let mean = 0
    let n = 0
    for (let k = Math.max(0, f - win); k < Math.min(frames, f + win); k++) {
      mean += flux[k]
      n++
    }
    mean /= n
    if (flux[f] > mean * 1.8 && flux[f] > 0.05) {
      beats.push((f * HOP) / RATE)
      last = f
    }
  }
  return beats
}
